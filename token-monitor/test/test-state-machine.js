// test/test-state-machine.js
// Tests the exactness state machine, dual-tier limit architecture, staleness, and failure handling.

const assert = require('assert');
const { TelemetryTracker, PrecisionState } = require('../telemetry-tracker');
const { buildStatusText } = require('../statusbar');
const { ActiveCascadeResolver } = require('../active-cascade-resolver');
const { inspectHardClamp } = require('../clamp-inspector');
const fs = require('fs');
const os = require('os');
const path = require('path');

function runStateMachineTests() {
  console.log('--- TEST C & E: STATE MACHINE & DUAL-TIER LIMIT ARCHITECTURE TEST ---');

  const tracker = new TelemetryTracker();

  // 1. Initial State -> WAITING
  const initial = tracker.getCurrentState();
  assert.strictEqual(initial.precisionState, PrecisionState.WAITING);
  assert.strictEqual(initial.confirmedTokens, null);
  assert.strictEqual(initial.usagePercent, null);
  console.log('✓ Initial state correctly WAITING with null tokens');

  const currentSessionStart = '2026-09-07T19:19:54.000Z';

  // ─────────────────────────────────────────────────────────────────────────────
  // VALIDATION SUITE A: Patched M318 (Verified binary + M318 model)
  // - effective budget = 960000 (min(1000000 - 40000, 960000, 1048576))
  // - 217025 => 22.61%
  // - remaining = 742975
  // - nominal 256k visible but non-binding
  // - measurement state = PATCH-AWARE / VERIFIED
  // ─────────────────────────────────────────────────────────────────────────────
  const mockPatchedM318 = {
    generatorMetadata: [
      {
        stepIndices: [100, 101],
        chatModel: {
          chatStartMetadata: {
            createdAt: '2026-09-08T12:00:00.000Z',
            contextWindowMetadata: {
              estimatedTokensUsed: 217025,
              maxContextTokens: 256000
            }
          },
          usage: {
            inputTokens: 12000,
            outputTokens: 250,
            cacheReadTokens: 195000
          },
          model: 'MODEL_PLACEHOLDER_M318',
          modelDisplayName: 'Gemini 3.8 Flash (High)'
        }
      }
    ]
  };

  const cascadeM318 = {
    cascadeId: 'test-m318-patch',
    summary: 'Antigravity Context Verification Protocol',
    status: 'CASCADE_RUN_STATUS_IDLE',
    stepCount: 102
  };

  const patchClampInfo = {
    valid: true,
    hardClamp: 1048576,
    label: '1M ENGINE PATCH',
    sha256: 'd7b8a84264019aacb56126fff438523e35039fd4dc313aa002189d630ac05779',
    isPatchVerified: true
  };

  const stateValA = tracker.updateFromGeneratorMetadata(cascadeM318, mockPatchedM318, patchClampInfo, currentSessionStart);
  console.log('VALIDATION A State:', {
    tokens: stateValA.trajectoryEstimate,
    nominal: stateValA.nominalModelMetadata,
    patchedLimit: stateValA.patchedRuntimeLimit,
    checkpoint: stateValA.checkpointThreshold,
    clamp: stateValA.engineHardClamp,
    effectiveBudget: stateValA.effectiveLocalBudget,
    remaining: stateValA.localRemaining,
    usage: stateValA.localUsage?.toFixed(2),
    measState: stateValA.measurementState,
    patchState: stateValA.patchState
  });

  assert.strictEqual(stateValA.isM318, true, 'Model must be identified as M318');
  assert.strictEqual(stateValA.isPatchVerified, true, 'Patch must be verified');
  assert.strictEqual(stateValA.patchState, 'PATCH-AWARE / VERIFIED', 'Patch state must be PATCH-AWARE / VERIFIED');
  assert.strictEqual(stateValA.measurementState, 'PATCH-AWARE / VERIFIED', 'Measurement state must be PATCH-AWARE / VERIFIED');
  assert.strictEqual(stateValA.nominalModelMetadata, 256000, 'Nominal model metadata 256k must be preserved');
  assert.strictEqual(stateValA.patchedRuntimeLimit, 1000000, 'Patched runtime limit must be 1000000');
  assert.strictEqual(stateValA.checkpointThreshold, 960000, 'Checkpoint threshold must be 960000');
  assert.strictEqual(stateValA.engineHardClamp, 1048576, 'Engine hard clamp must be 1048576');
  assert.strictEqual(stateValA.effectiveLocalBudget, 960000, 'Effective local budget must be min(1000000-40000, 960000, 1048576) = 960000');
  assert.strictEqual(stateValA.trajectoryEstimate, 217025, 'Trajectory estimate must be 217025');
  assert.strictEqual(stateValA.localRemaining, 742975, 'Local remaining must be 960000 - 217025 = 742975');
  assert.strictEqual(stateValA.localUsage?.toFixed(2), '22.61', 'Local usage must be 217025 / 960000 = 22.61%');
  assert.strictEqual(stateValA.bindingConstraint, 'CHECKPOINT / LOCAL BUDGET', 'Binding constraint must be CHECKPOINT / LOCAL BUDGET');
  assert.notStrictEqual(stateValA.effectiveLocalBudget, stateValA.nominalModelMetadata, 'Nominal 256k must NOT bind effective budget for patched M318');

  const statusTextValA = buildStatusText(stateValA, patchClampInfo);
  assert.strictEqual(statusTextValA, '⚡ 217k / 960k | 22.6%');
  console.log('✓ VALIDATION A PASSED (Patched M318: 960k budget, 22.61% usage, 742975 remaining, nominal 256k non-binding)');

  // ─────────────────────────────────────────────────────────────────────────────
  // VALIDATION SUITE B: Unpatched / Unknown Binary
  // - no fabricated 1M values
  // - use nominal metadata
  // - patch state clearly unverified
  // ─────────────────────────────────────────────────────────────────────────────
  const unpatchedClampInfo = {
    valid: true,
    hardClamp: 524288,
    label: '512k ENGINE PATCH',
    sha256: 'efb32d55e3c670870ef6025b12d844b12473158a78a31b06a417c1bbb30e67e7',
    isPatchVerified: false
  };

  const stateValB = tracker.updateFromGeneratorMetadata(cascadeM318, mockPatchedM318, unpatchedClampInfo, currentSessionStart);
  assert.strictEqual(stateValB.isM318, true, 'Model is M318');
  assert.strictEqual(stateValB.isPatchVerified, false, 'Patch is NOT verified');
  assert.strictEqual(stateValB.patchState, 'NOT VERIFIED', 'Patch state must be NOT VERIFIED');
  assert.strictEqual(stateValB.patchedRuntimeLimit, null, 'Must NOT fabricate 1M patched runtime limit');
  assert.strictEqual(stateValB.checkpointThreshold, null, 'Must NOT fabricate 960k checkpoint threshold');
  assert.strictEqual(stateValB.nominalModelMetadata, 256000, 'Nominal model metadata must be used');
  assert.strictEqual(stateValB.effectiveLocalBudget, 256000, 'Effective budget must fall back to nominal metadata min(256000, 524288) = 256000');
  assert.strictEqual(stateValB.bindingConstraint, 'MODEL', 'Binding constraint must be MODEL');
  console.log('✓ VALIDATION B PASSED (Unpatched binary: no fabricated 1M values, uses nominal metadata, patch state unverified)');

  // ─────────────────────────────────────────────────────────────────────────────
  // VALIDATION SUITE C: Non-M318 Model (e.g. M316, M317, M319, M320, claude-3.5-sonnet)
  // - must not inherit M318 override even if binary has verified 1M patch
  // ─────────────────────────────────────────────────────────────────────────────
  const nonM318Models = [
    { model: 'MODEL_PLACEHOLDER_M316', display: 'Gemini 3.5 Pro' },
    { model: 'MODEL_PLACEHOLDER_M317', display: 'Gemini 3.5 Flash' },
    { model: 'MODEL_PLACEHOLDER_M319', display: 'Gemini 3.0 Pro' },
    { model: 'MODEL_PLACEHOLDER_M320', display: 'Gemini Ultra' },
    { model: 'claude-3-5-sonnet-20241022', display: 'Claude 3.5 Sonnet' }
  ];

  for (const m of nonM318Models) {
    const mockNonM318 = {
      generatorMetadata: [
        {
          stepIndices: [10],
          chatModel: {
            chatStartMetadata: {
              createdAt: '2026-09-08T12:05:00.000Z',
              contextWindowMetadata: {
                estimatedTokensUsed: 50000,
                maxContextTokens: 200000
              }
            },
            model: m.model,
            modelDisplayName: m.display
          }
        }
      ]
    };

    const stateValC = tracker.updateFromGeneratorMetadata(cascadeM318, mockNonM318, patchClampInfo, currentSessionStart);
    assert.strictEqual(stateValC.isM318, false, `${m.model} must NOT be treated as M318`);
    assert.strictEqual(stateValC.patchedRuntimeLimit, null, `${m.model} must NOT inherit patched runtime limit`);
    assert.strictEqual(stateValC.checkpointThreshold, null, `${m.model} must NOT inherit checkpoint threshold`);
    assert.strictEqual(stateValC.nominalModelMetadata, 200000, `${m.model} must retain its own nominal metadata`);
    assert.strictEqual(stateValC.effectiveLocalBudget, 200000, `${m.model} effective budget must be nominal limit min(200000, 1048576) = 200000`);
    assert.strictEqual(stateValC.patchState, 'NOT VERIFIED', `${m.model} patch state must be NOT VERIFIED`);
  }
  console.log('✓ VALIDATION C PASSED (Non-M318 models M316/M317/M319/M320 do not inherit M318 override)');

  // ─────────────────────────────────────────────────────────────────────────────
  // VALIDATION SUITE D: No backend generation metadata
  // - backend field reports unavailable rather than estimated
  // - never estimate backend prompt by converting local trajectory counter
  // ─────────────────────────────────────────────────────────────────────────────
  const mockNoBackendUsage = {
    generatorMetadata: [
      {
        stepIndices: [20],
        chatModel: {
          chatStartMetadata: {
            createdAt: '2026-09-08T12:10:00.000Z',
            contextWindowMetadata: {
              estimatedTokensUsed: 80000,
              maxContextTokens: 256000
            }
          },
          model: 'MODEL_PLACEHOLDER_M318',
          modelDisplayName: 'Gemini 3.8 Flash (High)'
          // NOTE: NO usage field!
        }
      }
    ]
  };

  const stateValD = tracker.updateFromGeneratorMetadata(cascadeM318, mockNoBackendUsage, patchClampInfo, currentSessionStart);
  assert.strictEqual(stateValD.hasBackendUsage, false, 'hasBackendUsage must be false when usage metadata absent');
  assert.strictEqual(stateValD.backendUsage.inputTokens, 0);
  assert.strictEqual(stateValD.backendUsage.cacheReadTokens, 0);
  assert.strictEqual(stateValD.backendUsage.effectivePrompt, 0);
  assert.strictEqual(stateValD.backendUsage.outputTokens, 0);
  assert.notStrictEqual(stateValD.backendUsage.effectivePrompt, stateValD.trajectoryEstimate, 'Backend prompt must NEVER be estimated from trajectory estimate');
  console.log('✓ VALIDATION D PASSED (No backend metadata: reports unavailable, zero heuristic estimation)');

  // ─────────────────────────────────────────────────────────────────────────────
  // VALIDATION SUITE E: Legacy Unpatched Architecture (512k clamp, unverified patch)
  // Trajectory = 142078, Model Context = 256000, Engine Clamp = 524288
  // Expected: effectiveLimit = 256000, binding = MODEL, status = '⚡ 142.1k / 256k | 55.5%'
  // ─────────────────────────────────────────────────────────────────────────────
  const mockGenMetadataLegacy = {
    generatorMetadata: [
      {
        stepIndices: [4509, 4510],
        chatModel: {
          chatStartMetadata: {
            createdAt: '2026-09-07T20:03:37.060Z',
            contextWindowMetadata: {
              estimatedTokensUsed: 142078,
              maxContextTokens: 256000
            }
          },
          usage: {
            inputTokens: 4445,
            outputTokens: 160,
            cacheReadTokens: 144343
          },
          model: 'MODEL_PLACEHOLDER_M318',
          modelDisplayName: 'Gemini 3.8 Flash (High)'
        }
      }
    ]
  };

  const cascadeLegacy = {
    cascadeId: '63d75f2b-73cd-4376-bdb3-3571aa9eb122',
    summary: 'Active Task',
    status: 'CASCADE_RUN_STATUS_IDLE',
    stepCount: 4511
  };
  const cascadeA = cascadeLegacy;
  const mockGenMetadataA = mockGenMetadataLegacy;

  const stateLegacy = tracker.updateFromGeneratorMetadata(cascadeLegacy, mockGenMetadataLegacy, 524288, currentSessionStart);
  assert.strictEqual(stateLegacy.precisionState, PrecisionState.EXACT);
  assert.strictEqual(stateLegacy.confirmedTokens, 142078);
  assert.strictEqual(stateLegacy.nominalModelMetadata, 256000);
  assert.strictEqual(stateLegacy.engineHardClamp, 524288);
  assert.strictEqual(stateLegacy.effectiveLocalBudget, 256000, 'Effective limit must be min(256000, 524288) = 256000');
  assert.strictEqual(stateLegacy.bindingConstraint, 'MODEL', 'Binding constraint must be MODEL');
  assert.strictEqual(stateLegacy.localUsage?.toFixed(1), '55.5', 'Usage percent must be 142078/256000 = 55.5%');

  const statusTextLegacy = buildStatusText(stateLegacy, { valid: true, hardClamp: 524288, label: '512k ENGINE PATCH' });
  assert.strictEqual(statusTextLegacy, '⚡ 142.1k / 256k | 55.5%');
  console.log('✓ VALIDATION E.1 PASSED (Legacy architecture: unverified model binds at 256k)');

  // ─────────────────────────────────────────────────────────────────────────────
  // CASE B: Engine Binds
  // Trajectory = 200000, Model Context = 1048576 (1M), Engine Clamp = 524288
  // Expected: effectiveLimit = 524288, binding = ENGINE
  // ─────────────────────────────────────────────────────────────────────────────
  const mockGenMetadataB = {
    generatorMetadata: [
      {
        stepIndices: [10, 11],
        chatModel: {
          chatStartMetadata: {
            createdAt: '2026-09-07T20:10:00.000Z',
            contextWindowMetadata: {
              estimatedTokensUsed: 200000,
              maxContextTokens: 1048576
            }
          }
        }
      }
    ]
  };

  const stateB = tracker.updateFromGeneratorMetadata(cascadeA, mockGenMetadataB, 524288, currentSessionStart);
  assert.strictEqual(stateB.effectiveLimit, 524288, 'Effective limit must be min(1048576, 524288) = 524288');
  assert.strictEqual(stateB.bindingConstraint, 'ENGINE', 'Binding constraint must be ENGINE');
  console.log('✓ CASE B PASSED (Engine binds when model context > engine clamp)');

  // ─────────────────────────────────────────────────────────────────────────────
  // CASE C: Future 900k Engine
  // Trajectory = 500000, Model Context = 1048576 (1M), Engine Clamp = 917504
  // Expected: effectiveLimit = 917504, binding = ENGINE
  // ─────────────────────────────────────────────────────────────────────────────
  const mockGenMetadataC = {
    generatorMetadata: [
      {
        stepIndices: [10, 11],
        chatModel: {
          chatStartMetadata: {
            createdAt: '2026-09-07T20:15:00.000Z',
            contextWindowMetadata: {
              estimatedTokensUsed: 500000,
              maxContextTokens: 1048576
            }
          }
        }
      }
    ]
  };

  const stateC = tracker.updateFromGeneratorMetadata(cascadeA, mockGenMetadataC, 917504, currentSessionStart);
  assert.strictEqual(stateC.effectiveLimit, 917504);
  assert.strictEqual(stateC.bindingConstraint, 'ENGINE');
  console.log('✓ CASE C PASSED (Future 900k engine binds with 1M model)');

  // ─────────────────────────────────────────────────────────────────────────────
  // CASE D: 900k Engine with Current 256k Model
  // Trajectory = 200000, Model Context = 256000, Engine Clamp = 917504
  // Expected: effectiveLimit = 256000, binding = MODEL
  // ─────────────────────────────────────────────────────────────────────────────
  const mockGenMetadataD = {
    generatorMetadata: [
      {
        stepIndices: [10, 11],
        chatModel: {
          chatStartMetadata: {
            createdAt: '2026-09-07T20:20:00.000Z',
            contextWindowMetadata: {
              estimatedTokensUsed: 200000,
              maxContextTokens: 256000
            }
          }
        }
      }
    ]
  };

  const stateD = tracker.updateFromGeneratorMetadata(cascadeA, mockGenMetadataD, 917504, currentSessionStart);
  assert.strictEqual(stateD.effectiveLimit, 256000);
  assert.strictEqual(stateD.bindingConstraint, 'MODEL', 'Must be MODEL even with 900k engine');
  console.log('✓ CASE D PASSED (900k engine with 256k model correctly clamps at 256k model limit)');

  // ─────────────────────────────────────────────────────────────────────────────
  // CASE E: Stale Session
  // Turn timestamp < LS process/session start
  // Expected: state = STALE_SESSION, usagePercent = null
  // ─────────────────────────────────────────────────────────────────────────────
  const mockGenMetadataE = {
    generatorMetadata: [
      {
        stepIndices: [1000, 1001],
        chatModel: {
          chatStartMetadata: {
            createdAt: '2026-09-07T18:00:00.000Z', // 18:00 is older than currentSessionStart 19:19:54
            contextWindowMetadata: {
              estimatedTokensUsed: 142078,
              maxContextTokens: 256000
            }
          }
        }
      }
    ]
  };

  const stateE = tracker.updateFromGeneratorMetadata(cascadeA, mockGenMetadataE, 524288, currentSessionStart);
  console.log('CASE E State:', stateE.precisionState);
  assert.strictEqual(stateE.precisionState, PrecisionState.STALE_SESSION);
  assert.strictEqual(stateE.usagePercent, null, 'Usage percent MUST be null in STALE_SESSION');

  const statusTextE = buildStatusText(stateE, { valid: true, hardClamp: 524288, label: '512k ENGINE PATCH' });
  console.log('CASE E Status Bar:', statusTextE);
  assert.strictEqual(statusTextE, '⚡ 142.1k+ | model 256k | awaiting current-session turn');
  console.log('✓ CASE E PASSED (Stale session correctly identified and percentage suppressed)');

  // ─────────────────────────────────────────────────────────────────────────────
  // CASE F: Same-Record Pairing Rule
  // Token count and modelContextTokens must come from the same generator record.
  // ─────────────────────────────────────────────────────────────────────────────
  const mockGenMetadataF = {
    generatorMetadata: [
      {
        // Record 0 has limit 256000 but no token count
        stepIndices: [1],
        chatModel: {
          chatStartMetadata: {
            createdAt: '2026-09-07T20:25:00.000Z',
            contextWindowMetadata: { maxContextTokens: 256000 }
          }
        }
      },
      {
        // Record 1 has token count 150000 but missing maxContextTokens
        stepIndices: [4509, 4510],
        chatModel: {
          chatStartMetadata: {
            createdAt: '2026-09-07T20:26:00.000Z',
            contextWindowMetadata: { estimatedTokensUsed: 150000 }
          }
        }
      }
    ]
  };

  const stateF = tracker.updateFromGeneratorMetadata(cascadeA, mockGenMetadataF, 524288, currentSessionStart);
  // Record 1 is selected because it has estimatedTokensUsed, but its maxContextTokens is null
  assert.strictEqual(stateF.confirmedTokens, 150000);
  assert.strictEqual(stateF.modelContextLimit, null, 'Must NOT steal maxContextTokens from Record 0');
  assert.strictEqual(stateF.effectiveLimit, null, 'Effective limit must be null when modelContextLimit is null');
  assert.strictEqual(stateF.precisionState, PrecisionState.EXACT, 'Turn measurement is EXACT for completed turn');

  const statusTextF = buildStatusText(stateF, { valid: true, hardClamp: 524288 });
  console.log('CASE F Status Bar:', statusTextF);
  assert.strictEqual(statusTextF, '⚡ 150k / model limit unavailable');
  console.log('✓ CASE F PASSED (Same-record pairing enforced; cross-record borrowing rejected)');

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. Pending State when Conversation Advances
  // ─────────────────────────────────────────────────────────────────────────────
  const cascadeAdv = {
    cascadeId: cascadeA.cascadeId,
    summary: 'Active Task',
    status: 'CASCADE_RUN_STATUS_RUNNING',
    stepCount: 4600
  };
  const statePending = tracker.updateFromGeneratorMetadata(cascadeAdv, mockGenMetadataA, 524288, currentSessionStart);
  assert.strictEqual(statePending.precisionState, PrecisionState.PENDING);
  assert.strictEqual(statePending.usagePercent, null);
  const statusPending = buildStatusText(statePending, { valid: true, hardClamp: 524288 });
  assert.strictEqual(statusPending, '⚡ 142.1k+ / 256k | pending');
  console.log('✓ Pending state formatting verified: ⚡ 142.1k+ / 256k | pending');

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. Missing Generator Metadata -> WAITING
  // ─────────────────────────────────────────────────────────────────────────────
  const stateWaiting = tracker.updateFromGeneratorMetadata(cascadeA, { generatorMetadata: [] }, 524288, currentSessionStart);
  assert.strictEqual(stateWaiting.precisionState, PrecisionState.WAITING);
  console.log('✓ Missing metadata correctly transitions to WAITING');

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. Ambiguity Detection Test
  // ─────────────────────────────────────────────────────────────────────────────
  const resolver = new ActiveCascadeResolver();
  const multiRunning = [
    { cascadeId: 'c1', summary: 'Run 1', status: 'CASCADE_RUN_STATUS_RUNNING', workspaceUris: ['file:///ws'] },
    { cascadeId: 'c2', summary: 'Run 2', status: 'CASCADE_RUN_STATUS_RUNNING', workspaceUris: ['file:///ws'] }
  ];
  const res = resolver.resolveActiveCascade(multiRunning, ['file:///ws']);
  assert.strictEqual(res.status, 'AMBIGUOUS');
  console.log('✓ ActiveCascadeResolver ambiguity detection verified');

  // ─────────────────────────────────────────────────────────────────────────────
  // 6. Clamp Failure Handling: Corrupted Binary
  // ─────────────────────────────────────────────────────────────────────────────
  const tempCorruptFile = path.join(os.tmpdir(), `corrupt_ls_${Date.now()}.exe`);
  const dummyBuf = Buffer.alloc(0x013aa200);
  dummyBuf[0x013aa156] = 0x90; // NOP instead of 81 F9
  fs.writeFileSync(tempCorruptFile, dummyBuf);

  try {
    const corruptResult = inspectHardClamp(tempCorruptFile);
    assert.strictEqual(corruptResult.valid, false);
    assert.strictEqual(corruptResult.hardClamp, null);
    assert.strictEqual(corruptResult.label, 'UNKNOWN INSTRUCTION');
    console.log('✓ Clamp inspector rejects corrupt instruction structure without guessing');
  } finally {
    try { fs.unlinkSync(tempCorruptFile); } catch (_) {}
  }

  console.log('\nALL STATE MACHINE & DUAL-TIER LIMIT TESTS PASSED!\n');
  return true;
}

if (require.main === module) {
  runStateMachineTests();
}

module.exports = { runStateMachineTests };
