// telemetry-tracker.js
// Tracks Antigravity token telemetry using ONLY authoritative runtime sources.
// Enforces strict state machine: WAITING | EXACT | PENDING | STALE_SESSION | DISCONNECTED | AMBIGUOUS | ERROR.
// ZERO-ESTIMATION POLICY: No heuristic division, no byte conversion, no manufactured precision.

const PrecisionState = {
  WAITING: 'WAITING',           // No completed generator metadata yet
  EXACT: 'EXACT',               // Authoritative measurement matches current completed step
  PENDING: 'PENDING',           // Conversation advanced beyond last measured turn or running
  STALE_SESSION: 'STALE_SESSION', // Measurement belongs to a previous Language Server session
  DISCONNECTED: 'DISCONNECTED', // LS RPC unreachable
  AMBIGUOUS: 'AMBIGUOUS',       // Multiple simultaneous active conversations
  ERROR: 'ERROR'                // Telemetry parse error
};

class TelemetryTracker {
  constructor() {
    this._currentState = {
      precisionState: PrecisionState.WAITING,
      measurementState: 'WAITING',
      cascadeId: null,
      title: '',
      status: 'IDLE',
      stepCount: 0,
      trajectoryEstimate: null,
      confirmedTokens: null,
      measurementStep: null,
      measurementSteps: [],
      measurementTimestamp: null,
      nominalModelMetadata: null,
      modelContextLimit: null,
      patchedRuntimeLimit: null,
      checkpointThreshold: null,
      engineHardClamp: null,
      reserveTokens: null,
      effectiveLocalBudget: null,
      effectiveLimit: null,
      localRemaining: null,
      localUsage: null,
      bindingConstraint: null, // 'MODEL' | 'ENGINE' | 'BOTH' | 'CHECKPOINT / LOCAL BUDGET' | null
      usagePercent: null,
      isM318: false,
      isPatchVerified: false,
      patchState: 'NOT VERIFIED', // 'PATCH-AWARE / VERIFIED' | 'NOT VERIFIED'
      model: '',
      modelDisplay: '',
      hasBackendUsage: false,
      backendUsage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        effectivePrompt: 0
      },
      lsSessionStartTime: null,
      generatorRecordIndex: null,
      lastSyncTime: null,
      errorDetail: null
    };
  }

  getCurrentState() {
    return { ...this._currentState };
  }

  setDisconnected(errorMsg = 'Language Server RPC unavailable') {
    this._currentState = {
      ...this._currentState,
      precisionState: PrecisionState.DISCONNECTED,
      measurementState: 'DISCONNECTED',
      errorDetail: errorMsg,
      lastSyncTime: new Date().toISOString()
    };
    return this._currentState;
  }

  setAmbiguous(reason = 'Multiple active cascades in workspace') {
    this._currentState = {
      ...this._currentState,
      precisionState: PrecisionState.AMBIGUOUS,
      measurementState: 'AMBIGUOUS',
      errorDetail: reason,
      lastSyncTime: new Date().toISOString()
    };
    return this._currentState;
  }

  setError(errorMsg) {
    this._currentState = {
      ...this._currentState,
      precisionState: PrecisionState.ERROR,
      measurementState: 'ERROR',
      errorDetail: errorMsg,
      lastSyncTime: new Date().toISOString()
    };
    return this._currentState;
  }

  setWaiting(cascade = null, hardClamp = null) {
    let clampVal = null;
    if (typeof hardClamp === 'number' && hardClamp > 0) {
      clampVal = hardClamp;
    } else if (hardClamp && typeof hardClamp === 'object' && hardClamp.hardClamp > 0) {
      clampVal = hardClamp.hardClamp;
    }

    this._currentState = {
      precisionState: PrecisionState.WAITING,
      measurementState: 'WAITING',
      cascadeId: cascade ? cascade.cascadeId : null,
      title: cascade ? cascade.summary : '',
      status: cascade ? cascade.status : 'IDLE',
      stepCount: cascade ? cascade.stepCount : 0,
      trajectoryEstimate: null,
      confirmedTokens: null,
      measurementStep: null,
      measurementSteps: [],
      measurementTimestamp: null,
      nominalModelMetadata: null,
      modelContextLimit: null,
      patchedRuntimeLimit: null,
      checkpointThreshold: null,
      engineHardClamp: clampVal,
      reserveTokens: null,
      effectiveLocalBudget: null,
      effectiveLimit: null,
      localRemaining: null,
      localUsage: null,
      bindingConstraint: null,
      usagePercent: null,
      isM318: false,
      isPatchVerified: false,
      patchState: 'NOT VERIFIED',
      model: '',
      modelDisplay: '',
      hasBackendUsage: false,
      backendUsage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, effectivePrompt: 0 },
      lsSessionStartTime: null,
      generatorRecordIndex: null,
      lastSyncTime: new Date().toISOString(),
      errorDetail: null
    };
    return this._currentState;
  }

  /**
   * Process raw Generator Metadata RPC response for the active cascade.
   * Strictly enforces same-record pairing, provenance rules, and patch-aware dual-tier limits.
   *
   * @param {object} activeCascade
   * @param {object} genMetadataResp
   * @param {number|object|null} hardClamp Verified binary clamp imm32 or clamp inspection object
   * @param {string|null} lsSessionStartTime Language Server process creation ISO string
   * @param {boolean} [isPatchVerified] Explicit patch verification boolean override
   */
  updateFromGeneratorMetadata(activeCascade, genMetadataResp, hardClamp = null, lsSessionStartTime = null, isPatchVerified = false) {
    let engineHardClamp = null;
    let patchVerified = Boolean(isPatchVerified);

    if (typeof hardClamp === 'number' && hardClamp > 0) {
      engineHardClamp = hardClamp;
    } else if (hardClamp && typeof hardClamp === 'object') {
      if (typeof hardClamp.hardClamp === 'number' && hardClamp.hardClamp > 0) {
        engineHardClamp = hardClamp.hardClamp;
      }
      if (hardClamp.isPatchVerified !== undefined) {
        patchVerified = Boolean(hardClamp.isPatchVerified);
      }
    }

    if (!activeCascade || !activeCascade.cascadeId) {
      return this.setWaiting(null, engineHardClamp);
    }

    const rawList = genMetadataResp?.generatorMetadata || [];

    // Same-Record Pairing Rule:
    // Locate the latest record containing contextWindowMetadata with authoritative token usage.
    let matchedEntry = null;
    let matchedCwm = null;
    let matchedCm = null;
    let matchedCsm = null;
    let matchedStep = -1;
    let matchedSteps = [];
    let matchedIndex = -1;

    for (let i = rawList.length - 1; i >= 0; i--) {
      const entry = rawList[i];
      const cm = entry.chatModel || entry.chat_model || {};
      const csm = cm.chatStartMetadata || cm.chat_start_metadata || {};
      const cwm = csm.contextWindowMetadata || csm.context_window_metadata 
               || entry.contextWindowMetadata || entry.context_window_metadata;

      if (!cwm) continue;

      const hasTokens = (cwm.estimatedTokensUsed !== undefined || cwm.estimated_tokens_used !== undefined);

      if (hasTokens) {
        matchedEntry = entry;
        matchedCwm = cwm;
        matchedCm = cm;
        matchedCsm = csm;
        matchedIndex = i;

        const stepIndices = entry.stepIndices || entry.step_indices || [];
        matchedSteps = stepIndices;
        if (stepIndices.length > 0) {
          matchedStep = Math.max(...stepIndices);
        }
        break;
      }
    }

    if (!matchedEntry || !matchedCwm) {
      return this.setWaiting(activeCascade, engineHardClamp);
    }

    // (1) Authoritative trajectory tokens produced by TrajectoryChatConverter
    const rawTokens = matchedCwm.estimatedTokensUsed ?? matchedCwm.estimated_tokens_used;
    const trajectoryEstimate = parseInt(String(rawTokens), 10);
    const confirmedTokens = trajectoryEstimate; // Backwards compatibility alias

    // (2) Nominal Model Metadata from THAT SAME RECORD
    // Do NOT borrow from another record (Same-Record Pairing Rule).
    const rawModelLimit = matchedCwm.maxContextTokens ?? matchedCwm.max_context_tokens;
    const nominalModelMetadata = (rawModelLimit !== undefined && rawModelLimit !== null)
      ? parseInt(String(rawModelLimit), 10)
      : null;
    const modelContextLimit = nominalModelMetadata; // Backwards compatibility alias

    // (3) Model identification
    const model = matchedEntry.model || matchedEntry.responseModel || matchedCm?.model || matchedCm?.responseModel || '';
    const modelDisplay = matchedEntry.modelDisplayName || matchedEntry.model_display_name 
                      || matchedCm?.modelDisplayName || matchedCm?.model_display_name || model;

    // Strict model detection: M318 only
    const isM318 = (
      model === 'MODEL_PLACEHOLDER_M318' ||
      model === '1318' ||
      /Gemini 3\.8 Flash \(High\)/i.test(modelDisplay)
    );

    // (4) Patch-Aware Dual-Tier Limit & Effective Local Budget Logic
    let patchedRuntimeLimit = null;
    let checkpointThreshold = null;
    let reserveTokens = null;
    let effectiveLocalBudget = null;
    let bindingConstraint = null;
    let patchState = 'NOT VERIFIED';

    if (isM318 && patchVerified) {
      patchState = 'PATCH-AWARE / VERIFIED';
      patchedRuntimeLimit = 1000000;
      checkpointThreshold = 960000;
      reserveTokens = 40000;
      const clampVal = engineHardClamp ?? 1048576;

      // min(runtimeMaxTokens - reserve, checkpointLimit, engineClamp)
      effectiveLocalBudget = Math.min(
        patchedRuntimeLimit - reserveTokens,
        checkpointThreshold,
        clampVal
      );

      if (effectiveLocalBudget < clampVal) {
        bindingConstraint = 'CHECKPOINT / LOCAL BUDGET';
      } else if (clampVal < effectiveLocalBudget) {
        bindingConstraint = 'ENGINE';
      } else {
        bindingConstraint = 'BOTH';
      }
    } else {
      // Fall back to nominal metadata behavior: non-M318 or unverified patch
      patchState = 'NOT VERIFIED';
      if (nominalModelMetadata !== null && engineHardClamp !== null) {
        effectiveLocalBudget = Math.min(nominalModelMetadata, engineHardClamp);
        if (nominalModelMetadata < engineHardClamp) {
          bindingConstraint = 'MODEL';
        } else if (engineHardClamp < nominalModelMetadata) {
          bindingConstraint = 'ENGINE';
        } else {
          bindingConstraint = 'BOTH';
        }
      }
    }
    const effectiveLimit = effectiveLocalBudget; // Backwards compatibility alias

    // (5) Backend usage from last model call (must remain strictly separated)
    const u = matchedEntry.usage || matchedCm?.usage;
    let hasBackendUsage = false;
    let backendUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      effectivePrompt: 0
    };

    if (u && (u.inputTokens !== undefined || u.input_tokens !== undefined ||
              u.cacheReadTokens !== undefined || u.cache_read_tokens !== undefined ||
              u.outputTokens !== undefined || u.output_tokens !== undefined)) {
      const input = parseInt(String(u.inputTokens ?? u.input_tokens ?? 0), 10) || 0;
      const cache = parseInt(String(u.cacheReadTokens ?? u.cache_read_tokens ?? 0), 10) || 0;
      const output = parseInt(String(u.outputTokens ?? u.output_tokens ?? 0), 10) || 0;
      hasBackendUsage = true;
      backendUsage = {
        inputTokens: input,
        cacheReadTokens: cache,
        outputTokens: output,
        effectivePrompt: input + cache
      };
    }

    // Turn timestamp
    const turnTimestamp = matchedCsm?.createdAt || matchedCsm?.created_at 
                       || matchedEntry.createdAt || matchedEntry.created_at || null;

    // (6) Staleness & Exactness Evaluation
    let isStaleSession = false;
    if (turnTimestamp && lsSessionStartTime) {
      const turnTime = new Date(turnTimestamp).getTime();
      const sessionTime = new Date(lsSessionStartTime).getTime();
      if (!isNaN(turnTime) && !isNaN(sessionTime) && turnTime < sessionTime) {
        isStaleSession = true;
      }
    }

    const isRunning = (activeCascade.status === 'CASCADE_RUN_STATUS_RUNNING');
    const hasAdvanced = (matchedStep >= 0 && activeCascade.stepCount > (matchedStep + 1));

    let precisionState = PrecisionState.EXACT;
    if (isStaleSession) {
      precisionState = PrecisionState.STALE_SESSION;
    } else if (isRunning || hasAdvanced) {
      precisionState = PrecisionState.PENDING;
    }

    // Measurement State label
    let measurementState = precisionState;
    if (isM318 && patchVerified) {
      if (precisionState === PrecisionState.EXACT) {
        measurementState = 'PATCH-AWARE / VERIFIED';
      } else if (precisionState === PrecisionState.PENDING) {
        measurementState = 'PATCH-AWARE / VERIFIED (PENDING)';
      } else if (precisionState === PrecisionState.STALE_SESSION) {
        measurementState = 'PATCH-AWARE / VERIFIED (STALE_SESSION)';
      }
    }

    // (7) Local usage & remaining calculation
    let localRemaining = null;
    let localUsage = null;
    if (effectiveLocalBudget !== null && effectiveLocalBudget > 0 && trajectoryEstimate !== null) {
      localRemaining = Math.max(0, effectiveLocalBudget - trajectoryEstimate);
      if (precisionState === PrecisionState.EXACT) {
        localUsage = (trajectoryEstimate / effectiveLocalBudget) * 100;
      }
    }
    const usagePercent = localUsage; // Backwards compatibility alias

    this._currentState = {
      precisionState,
      measurementState,
      cascadeId: activeCascade.cascadeId,
      title: activeCascade.summary || activeCascade.cascadeId,
      status: activeCascade.status,
      stepCount: activeCascade.stepCount,
      trajectoryEstimate,
      confirmedTokens,
      measurementStep: matchedStep >= 0 ? matchedStep : null,
      measurementSteps: matchedSteps,
      measurementTimestamp: turnTimestamp,
      nominalModelMetadata,
      modelContextLimit,
      patchedRuntimeLimit,
      checkpointThreshold,
      engineHardClamp,
      reserveTokens,
      effectiveLocalBudget,
      effectiveLimit,
      localRemaining,
      localUsage,
      bindingConstraint,
      usagePercent,
      isM318,
      isPatchVerified: patchVerified,
      patchState,
      model,
      modelDisplay,
      hasBackendUsage,
      backendUsage,
      lsSessionStartTime: lsSessionStartTime || null,
      generatorRecordIndex: matchedIndex >= 0 ? matchedIndex : null,
      lastSyncTime: new Date().toISOString(),
      errorDetail: null
    };

    return this._currentState;
  }
}

module.exports = {
  TelemetryTracker,
  PrecisionState
};
