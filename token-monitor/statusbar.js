// statusbar.js
// Status bar presentation and QuickPick detail view for Antigravity Token Monitor.
// Adheres strictly to VS Code ThemeColor standards, dual-tier limit architecture, and exactness states.

let vscode;
try {
  vscode = require('vscode');
} catch (_) {
  vscode = {
    window: {
      createStatusBarItem: () => ({ show: () => {}, dispose: () => {} }),
      createQuickPick: () => ({ show: () => {}, hide: () => {}, onDidAccept: () => {} }),
      showQuickPick: async () => null,
      showInformationMessage: () => {},
      showErrorMessage: () => {}
    },
    StatusBarAlignment: { Right: 2, Left: 1 },
    ThemeColor: class { constructor(id) { this.id = id; } },
    MarkdownString: class { constructor() { this.value = ''; } appendMarkdown(s) { this.value += s; } },
    QuickPickItemKind: { Separator: -1 }
  };
}
const { PrecisionState } = require('./telemetry-tracker');

/**
 * Format a token count for display (e.g. 142078 -> "142.1k", 217025 -> "217k", 256000 -> "256k", 960000 -> "960k", 1000000 -> "1M" or "1.00M", 1048576 -> "1M" or "1.049M").
 * @param {number|null} value
 * @param {number|null} [decimals]
 * @returns {string}
 */
function formatTokenValue(value, decimals = null) {
  if (value === null || value === undefined || isNaN(value)) {
    return '--';
  }
  const safe = Math.max(0, value);
  if (safe >= 1_000_000) {
    if (decimals !== null) {
      return `${(safe / 1_000_000).toFixed(decimals)}M`;
    }
    return `${(safe / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  }
  if (safe >= 1_000) {
    if (decimals !== null) {
      return `${(safe / 1_000).toFixed(decimals)}k`;
    }
    const val = safe / 1_000;
    if (Math.round(val) === val) {
      return `${val}k`;
    }
    return `${val.toFixed(1).replace(/\.0$/, '')}k`;
  }
  return safe.toString();
}

/**
 * Format status bar display string according to authoritative telemetry and exactness rules.
 * @param {object} telemetry
 * @param {object|null} hardClampInfo
 * @returns {string}
 */
function buildStatusText(telemetry, hardClampInfo = null) {
  if (!telemetry) {
    return '⚡ Token Monitor: waiting';
  }

  switch (telemetry.precisionState) {
    case PrecisionState.DISCONNECTED:
      return '⚡ Token Monitor: disconnected';

    case PrecisionState.AMBIGUOUS:
      return '⚡ Token Monitor: select conversation';

    case PrecisionState.ERROR:
      return '⚡ Token Monitor: error';

    case PrecisionState.WAITING: {
      const modelLimit = telemetry.nominalModelMetadata ?? telemetry.modelContextLimit;
      if (modelLimit) {
        return `⚡ model ${formatTokenValue(modelLimit)} | waiting for turn`;
      }
      if (hardClampInfo?.valid && hardClampInfo?.hardClamp) {
        return `⚡ clamp ${formatTokenValue(hardClampInfo.hardClamp)} | waiting`;
      }
      return '⚡ Token Monitor: waiting';
    }

    case PrecisionState.STALE_SESSION: {
      const tokensStr = formatTokenValue(telemetry.trajectoryEstimate ?? telemetry.confirmedTokens);
      const modelLimit = telemetry.nominalModelMetadata ?? telemetry.modelContextLimit;
      const modelStr = modelLimit ? `model ${formatTokenValue(modelLimit)}` : 'model unavailable';
      return `⚡ ${tokensStr}+ | ${modelStr} | awaiting current-session turn`;
    }

    case PrecisionState.PENDING: {
      const tokensStr = formatTokenValue(telemetry.trajectoryEstimate ?? telemetry.confirmedTokens);
      const effectiveBudget = telemetry.effectiveLocalBudget ?? telemetry.effectiveLimit ?? telemetry.nominalModelMetadata ?? telemetry.modelContextLimit;
      if (!effectiveBudget) {
        return `⚡ ${tokensStr}+ / model limit unavailable`;
      }
      const limitStr = formatTokenValue(effectiveBudget);
      return `⚡ ${tokensStr}+ / ${limitStr} | pending`;
    }

    case PrecisionState.EXACT: {
      const tokensStr = formatTokenValue(telemetry.trajectoryEstimate ?? telemetry.confirmedTokens);
      const effectiveBudget = telemetry.effectiveLocalBudget ?? telemetry.effectiveLimit;
      if (!effectiveBudget) {
        return `⚡ ${tokensStr} / model limit unavailable`;
      }
      const limitStr = formatTokenValue(effectiveBudget);
      const usage = telemetry.localUsage ?? telemetry.usagePercent;
      const pct = usage !== null ? usage.toFixed(1) : '--';
      let icon = '';
      if (usage !== null && usage >= 95) {
        icon = '$(alert) ';
      } else if (usage !== null && usage >= 85) {
        icon = '$(warning) ';
      }
      return `⚡ ${icon}${tokensStr} / ${limitStr} | ${pct}%`;
    }

    default:
      return '⚡ Token Monitor: unknown';
  }
}

class StatusBarManager {
  constructor() {
    this._item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this._item.command = 'antigravityTokenMonitor.showDetails';
    this._item.name = 'Antigravity Token Monitor';
    this._currentTelemetry = null;
    this._hardClampInfo = null;

    this.renderWaiting();
    this._item.show();
  }

  dispose() {
    if (this._item) {
      this._item.dispose();
    }
  }

  setHardClampInfo(clampInfo) {
    this._hardClampInfo = clampInfo;
    if (this._currentTelemetry) {
      this.update(this._currentTelemetry);
    }
  }

  renderWaiting() {
    this._item.text = buildStatusText({ precisionState: PrecisionState.WAITING }, this._hardClampInfo);
    this._item.tooltip = 'Antigravity Token Monitor: Waiting for first completed conversation turn';
    this._item.backgroundColor = undefined;
    this._item.color = undefined;
  }

  renderDisconnected(errorMsg = '') {
    this._item.text = `⚡ Token Monitor: disconnected`;
    this._item.tooltip = `Antigravity Token Monitor: Disconnected from Language Server RPC\n${errorMsg}`;
    this._item.backgroundColor = undefined;
    this._item.color = undefined;
  }

  renderAmbiguous(reason = '') {
    this._item.text = `⚡ Token Monitor: select conversation`;
    this._item.tooltip = `Multiple active conversations detected (${reason}). Click to select.`;
    this._item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    this._item.color = undefined;
  }

  /**
   * Update status bar with authoritative telemetry state.
   * @param {object} telemetry
   */
  update(telemetry) {
    this._currentTelemetry = telemetry;

    switch (telemetry.precisionState) {
      case PrecisionState.DISCONNECTED:
        return this.renderDisconnected(telemetry.errorDetail);

      case PrecisionState.AMBIGUOUS:
        return this.renderAmbiguous(telemetry.errorDetail);

      case PrecisionState.WAITING:
        return this.renderWaiting();

      case PrecisionState.ERROR:
        this._item.text = `⚡ Token Monitor: error`;
        this._item.tooltip = `Telemetry error: ${telemetry.errorDetail}`;
        this._item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        return;

      case PrecisionState.STALE_SESSION:
        this._item.text = buildStatusText(telemetry, this._hardClampInfo);
        this._item.tooltip = this._buildTooltip(telemetry, 'STALE_SESSION');
        this._item.backgroundColor = undefined;
        return;

      case PrecisionState.PENDING:
        this._item.text = buildStatusText(telemetry, this._hardClampInfo);
        this._item.tooltip = this._buildTooltip(telemetry, 'PENDING');
        this._item.backgroundColor = undefined; // Do not escalate color on unconfirmed pending data
        return;

      case PrecisionState.EXACT: {
        const usage = telemetry.localUsage ?? telemetry.usagePercent ?? 0;
        let bgColor = undefined;
        if (usage >= 95) {
          bgColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        } else if (usage >= 70) {
          bgColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        }
        this._item.text = buildStatusText(telemetry, this._hardClampInfo);
        this._item.tooltip = this._buildTooltip(telemetry, 'EXACT');
        this._item.backgroundColor = bgColor;
        return;
      }

      default:
        return this.renderWaiting();
    }
  }

  _buildTooltip(t, stateMode) {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;

    const isVerifiedM318 = Boolean(t.isM318 && t.isPatchVerified);
    const tokens = t.trajectoryEstimate ?? t.confirmedTokens;
    const nominalMeta = t.nominalModelMetadata ?? t.modelContextLimit;
    const effectiveBudget = t.effectiveLocalBudget ?? t.effectiveLimit;
    const remaining = (effectiveBudget !== null && tokens !== null)
      ? Math.max(0, effectiveBudget - tokens)
      : null;
    const usage = t.localUsage ?? t.usagePercent;
    const recordIndex = t.generatorRecordIndex !== null ? t.generatorRecordIndex : '--';

    md.appendMarkdown(`### ⚡ Antigravity Token Monitor\n\n`);
    md.appendMarkdown(`**Conversation:** ${t.title || t.cascadeId || 'None'}  \n`);
    md.appendMarkdown(`**Monitor Version:** \`0.1.0\`  \n`);
    md.appendMarkdown(`**Monitor Build:** \`PATCH-AWARE\`  \n`);

    let stateDesc = 'EXACT (Confirmed Turn)';
    if (stateMode === 'PENDING') {
      stateDesc = 'PENDING (Turn In Progress / Step Advanced)';
    } else if (stateMode === 'STALE_SESSION') {
      stateDesc = 'STALE_SESSION (Measurement from prior LS session)';
    }

    if (isVerifiedM318) {
      const measLabel = stateMode === 'EXACT'
        ? 'PATCH-AWARE / VERIFIED'
        : `PATCH-AWARE / VERIFIED (${stateMode})`;
      md.appendMarkdown(`**Measurement State:** \`${measLabel}\`  \n\n`);
    } else {
      md.appendMarkdown(`**Measurement State:** \`${stateDesc}\`  \n`);
      md.appendMarkdown(`**Patch State:** \`NOT VERIFIED\`  \n\n`);
    }

    const plus = (stateMode !== 'EXACT' && tokens !== null) ? '+' : '';
    const tokensFormatted = formatTokenValue(tokens);
    const tokensDetailed = tokens !== null ? tokens.toLocaleString() : '--';

    // Section: LIVE TRAJECTORY
    md.appendMarkdown(`#### LIVE TRAJECTORY\n`);
    md.appendMarkdown(`- **Trajectory Estimate:** \`${tokensFormatted}${plus}\` (${tokensDetailed} tokens)\n`);
    md.appendMarkdown(`- **Trajectory Record:** \`[${recordIndex}]\`\n`);
    md.appendMarkdown(`- **Source:** \`Generator Metadata (contextWindowMetadata.estimatedTokensUsed)\`\n\n`);

    // Section: BACKEND — LAST COMPLETED GENERATION
    md.appendMarkdown(`#### BACKEND — LAST COMPLETED GENERATION\n`);
    if (t.hasBackendUsage && t.backendUsage) {
      const u = t.backendUsage;
      md.appendMarkdown(`- **Generation Record:** \`[${recordIndex}]\`\n`);
      md.appendMarkdown(`- **Uncached Prompt:** \`${u.inputTokens.toLocaleString()}\` tokens (\`inputTokens\`)\n`);
      md.appendMarkdown(`- **Cached Prompt:** \`${u.cacheReadTokens.toLocaleString()}\` tokens (\`cacheReadTokens\`)\n`);
      md.appendMarkdown(`- **Effective Prompt:** \`${(u.effectivePrompt || (u.inputTokens + u.cacheReadTokens)).toLocaleString()}\` tokens\n`);
      md.appendMarkdown(`- **Output:** \`${u.outputTokens.toLocaleString()}\` tokens (\`outputTokens\`)\n\n`);
    } else {
      md.appendMarkdown(`- **Backend Prompt:** \`unavailable\`\n\n`);
    }

    // Section: PATCH CONFIGURATION
    md.appendMarkdown(`#### PATCH CONFIGURATION\n`);
    const nominalFormatted = formatTokenValue(nominalMeta);
    const nominalDetailed = nominalMeta !== null ? nominalMeta.toLocaleString() : 'Unavailable';
    md.appendMarkdown(`- **Nominal Metadata:** \`${nominalFormatted}\` (${nominalDetailed}) [LIVE RPC]\n`);
    if (isVerifiedM318) {
      md.appendMarkdown(`- **M318 Runtime Config:** \`${formatTokenValue(t.patchedRuntimeLimit, 2)}\` (${t.patchedRuntimeLimit?.toLocaleString() ?? '--'}) [VERIFIED STATIC]\n`);
      md.appendMarkdown(`- **Checkpoint Threshold:** \`${formatTokenValue(t.checkpointThreshold)}\` (${t.checkpointThreshold?.toLocaleString() ?? '--'}) [VERIFIED STATIC]\n`);
      if (this._hardClampInfo?.valid) {
        md.appendMarkdown(`- **Engine Clamp:** \`${formatTokenValue(this._hardClampInfo.hardClamp, 3)}\` (${this._hardClampInfo.label}) [VERIFIED STATIC]\n\n`);
      }
    } else {
      if (this._hardClampInfo?.valid) {
        md.appendMarkdown(`- **Engine Clamp:** \`${formatTokenValue(this._hardClampInfo.hardClamp)}\` (${this._hardClampInfo.label})\n\n`);
      }
    }

    // Section: LOCAL BUDGET
    md.appendMarkdown(`#### LOCAL BUDGET\n`);
    if (isVerifiedM318) {
      md.appendMarkdown(`- **Effective Local Budget:** \`${formatTokenValue(effectiveBudget)}\` (${effectiveBudget?.toLocaleString() ?? '--'} tokens)\n`);
    } else {
      md.appendMarkdown(`- **Effective Limit:** \`${formatTokenValue(effectiveBudget)}\` (${effectiveBudget?.toLocaleString() ?? '--'} tokens)\n`);
    }
    if (remaining !== null) {
      md.appendMarkdown(`- **Trajectory Remaining:** \`${formatTokenValue(remaining)}\` (${remaining.toLocaleString()} tokens)\n`);
    }
    if (usage !== null && stateMode === 'EXACT') {
      md.appendMarkdown(`- **Local Usage:** **${usage.toFixed(2)}%**\n`);
    } else if (effectiveBudget && tokens) {
      const pct = ((tokens / effectiveBudget) * 100).toFixed(2);
      md.appendMarkdown(`- **Local Usage:** \`${pct}%\` *(Pending next turn)*\n`);
    }

    md.appendMarkdown(`\n---\n`);
    md.appendMarkdown(`*Trajectory usage is Antigravity's conservative local estimate and is not equivalent to Gemini backend tokenizer usage.*\n\n`);
    md.appendMarkdown(`*Click to view comprehensive token provenance & diagnostic details.*`);
    return md;
  }

  /**
   * Display rich QuickPick detailing all authoritative metrics.
   * @param {object} lsSession
   */
  async showDetailsQuickPick(lsSession = null) {
    const t = this._currentTelemetry || {};
    const c = this._hardClampInfo || {};
    const isVerifiedM318 = Boolean(t.isM318 && t.isPatchVerified);

    const tokens = t.trajectoryEstimate ?? t.confirmedTokens;
    const nominalMeta = t.nominalModelMetadata ?? t.modelContextLimit;
    const effectiveBudget = t.effectiveLocalBudget ?? t.effectiveLimit;
    const usage = t.localUsage ?? t.usagePercent;

    const items = [];

    // Category: TRAJECTORY
    items.push({ label: 'TRAJECTORY TELEMETRY', kind: vscode.QuickPickItemKind.Separator });
    items.push({
      label: `Trajectory Estimate: ${tokens?.toLocaleString() ?? 'Unavailable'} tokens`,
      description: t.precisionState === PrecisionState.PENDING ? '(At least this value; awaiting next turn)' : '(Authoritative ChatConverter count)',
      detail: `Measured at Step ${t.measurementStep ?? '--'} | Sync: ${t.measurementTimestamp ?? '--'}`
    });
    items.push({
      label: `Measurement State: ${t.measurementState ?? t.precisionState ?? 'UNKNOWN'}`,
      description: isVerifiedM318 ? 'Patched M318 context verification active' : (t.precisionState === PrecisionState.EXACT ? 'Exact match with completed turn' : 'Pending next completed turn')
    });
    const stepList = (t.measurementSteps && t.measurementSteps.length > 0) ? t.measurementSteps.join(', ') : (t.measurementStep ?? '--');
    items.push({
      label: `Measured Step(s): ${stepList}`,
      description: 'Step index producing this converter token measurement'
    });
    items.push({
      label: `Effective Local Budget: ${effectiveBudget?.toLocaleString() ?? 'Unavailable'} tokens`,
      description: isVerifiedM318 ? 'min(1000000 - 40000, 960000, 1048576) -> 960000' : `min(ModelContext, EngineHardClamp) -> ${t.bindingConstraint ? t.bindingConstraint + ' BINDING' : 'N/A'}`
    });
    if (tokens !== null && effectiveBudget !== null) {
      const rem = Math.max(0, effectiveBudget - tokens);
      items.push({
        label: `Local Remaining: ${rem.toLocaleString()} tokens`,
        description: usage !== null ? `(${usage.toFixed(2)}% used)` : '(Pending next turn)'
      });
      if (usage !== null && t.precisionState === PrecisionState.EXACT) {
        items.push({
          label: `Local Usage: ${usage.toFixed(2)}%`,
          description: `${tokens.toLocaleString()} / ${effectiveBudget.toLocaleString()} tokens`
        });
      }
    }

    // Category: LIMIT SOURCES
    items.push({ label: 'LIMIT SOURCES & CONSTRAINTS', kind: vscode.QuickPickItemKind.Separator });
    items.push({
      label: `Nominal Model Metadata: ${nominalMeta?.toLocaleString() ?? 'Unavailable'} tokens`,
      description: 'Source: contextWindowMetadata.maxContextTokens',
      detail: t.modelDisplay ? `Configured for ${t.modelDisplay}` : ''
    });
    items.push({
      label: 'Monitor Version: 0.1.0',
      description: 'Build: PATCH-AWARE'
    });
    if (isVerifiedM318) {
      items.push({
        label: `Patched Runtime Limit: ${t.patchedRuntimeLimit?.toLocaleString()} tokens`,
        description: 'Patched ModelInfo.MaxTokens (1,000,000 tokens)'
      });
      items.push({
        label: `Checkpoint Threshold: ${t.checkpointThreshold?.toLocaleString()} tokens`,
        description: 'Patched CheckpointConfig.MaxTokenLimit (960,000 tokens)'
      });
    }
    items.push({
      label: `Engine Hard Clamp: ${c.hardClamp?.toLocaleString() ?? 'Unavailable'} tokens`,
      description: 'Source: binary imm32',
      detail: c.label ? `Patch State: ${c.label}` : 'Executable immediate at 0x013aa158'
    });
    items.push({
      label: `Patch State: ${t.patchState ?? (c.isPatchVerified ? 'PATCH-AWARE / VERIFIED' : 'NOT VERIFIED')}`,
      description: isVerifiedM318 ? 'SHA256 verified against expected patched binary' : 'Unpatched or non-M318 model'
    });
    const bindingDesc = isVerifiedM318
      ? 'CHECKPOINT / LOCAL USABLE BUDGET (960k constrains 1M engine clamp)'
      : (t.bindingConstraint === 'MODEL'
        ? 'MODEL CONTEXT (Engine capacity exceeds model context ceiling)'
        : (t.bindingConstraint === 'ENGINE' ? 'ENGINE HARD CLAMP (Engine clamp constrains model context)' : 'BOTH (Model context equals engine clamp)'));
    items.push({
      label: `Binding Constraint: ${t.bindingConstraint ?? 'UNKNOWN'}`,
      description: bindingDesc
    });

    // Category: MODEL & BACKEND USAGE
    items.push({ label: 'MODEL & BACKEND INFERENCE USAGE', kind: vscode.QuickPickItemKind.Separator });
    items.push({
      label: `Active Model: ${t.modelDisplay || t.model || 'Unknown'}`,
      description: t.model ? `Internal ID: ${t.model}` : ''
    });
    if (t.hasBackendUsage && t.backendUsage) {
      const u = t.backendUsage;
      items.push({
        label: `Last Backend Prompt (Uncached): ${u.inputTokens.toLocaleString()} tokens`,
        description: 'Billed prompt tokens for last turn'
      });
      items.push({
        label: `Last Backend Prompt (Cache Read): ${u.cacheReadTokens.toLocaleString()} tokens`,
        description: 'Context served from prompt cache'
      });
      items.push({
        label: `Last Backend Prompt (Effective): ${(u.effectivePrompt || (u.inputTokens + u.cacheReadTokens)).toLocaleString()} tokens`,
        description: 'Effective serialized chat prompt tokens'
      });
      items.push({
        label: `Last Call Output Tokens: ${u.outputTokens.toLocaleString()} tokens`,
        description: 'Generated response tokens'
      });
    } else {
      items.push({
        label: 'Backend Prompt: unavailable',
        description: 'No generation metadata usage recorded for current turn'
      });
    }

    // Category: PROVENANCE
    items.push({ label: 'DATA PROVENANCE & TIMESTAMPS', kind: vscode.QuickPickItemKind.Separator });
    items.push({
      label: `Cascade ID: ${t.cascadeId || 'None'}`,
      description: `Title: ${t.title || 'Untitled'}`
    });
    items.push({
      label: `Generator Record Index: ${t.generatorRecordIndex !== null ? '[' + t.generatorRecordIndex + ']' : '--'}`,
      description: 'Authoritative generatorMetadata[] turn element'
    });
    items.push({
      label: `Turn Timestamp: ${t.measurementTimestamp || '--'}`,
      description: 'Timestamp when prompt was tokenized and sent to model'
    });
    items.push({
      label: `LS Session Start: ${lsSession?.startTime || t.lsSessionStartTime || 'Unknown'}`,
      description: lsSession ? `PID: ${lsSession.pid} | Port: ${lsSession.port}` : 'Language Server session'
    });
    const isFresh = (t.precisionState !== PrecisionState.STALE_SESSION && t.precisionState !== PrecisionState.WAITING);
    items.push({
      label: `Measurement Fresh: ${isFresh ? 'YES (Current Session)' : 'NO (Stale Session / Awaiting Turn)'}`,
      description: 'Staleness check: turnTimestamp >= lsSessionStartTime'
    });
    items.push({
      label: 'Token Source: TrajectoryChatConverter metadata',
      description: 'Connect-RPC: contextWindowMetadata.estimatedTokensUsed'
    });
    items.push({
      label: 'Note: Local Trajectory Estimate',
      description: "Trajectory usage is Antigravity's conservative local estimate and is not equivalent to Gemini backend tokenizer usage."
    });

    const qp = vscode.window.createQuickPick();
    qp.title = '⚡ Antigravity Token Monitor — Authoritative Telemetry';
    qp.items = items;
    qp.placeholder = 'Press Esc to close';
    qp.onDidAccept(() => qp.hide());
    qp.show();
  }
}

module.exports = {
  StatusBarManager,
  formatTokenValue,
  buildStatusText
};
