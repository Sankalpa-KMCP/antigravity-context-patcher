// test/test-formatting.js
// Tests number formatting, string generation, and status bar text representation.

const assert = require('assert');
const { formatTokenValue, buildStatusText } = require('../statusbar');
const { PrecisionState } = require('../telemetry-tracker');

function runFormattingTests() {
  console.log('--- TEST D: FORMATTING TEST ---');

  // 1. formatTokenValue tests
  assert.strictEqual(formatTokenValue(142078), '142.1k');
  assert.strictEqual(formatTokenValue(223536), '223.5k');
  assert.strictEqual(formatTokenValue(256000), '256k');
  assert.strictEqual(formatTokenValue(512000), '512k');
  assert.strictEqual(formatTokenValue(524288), '524.3k');
  assert.strictEqual(formatTokenValue(917504), '917.5k');
  assert.strictEqual(formatTokenValue(1048576), '1M');
  assert.strictEqual(formatTokenValue(1000000, 2), '1.00M');
  assert.strictEqual(formatTokenValue(1048576, 3), '1.049M');
  assert.strictEqual(formatTokenValue(217025), '217k');
  assert.strictEqual(formatTokenValue(960000), '960k');
  assert.strictEqual(formatTokenValue(742975), '743k');
  assert.strictEqual(formatTokenValue(1500000), '1.5M');
  assert.strictEqual(formatTokenValue(999), '999');
  assert.strictEqual(formatTokenValue(0), '0');
  assert.strictEqual(formatTokenValue(null), '--');
  console.log('✓ Token value abbreviation formatting verified');

  // 2. Status Bar String Formatting Logic using actual buildStatusText from statusbar.js

  // Case 1: EXACT (Current Real State: 142078 tokens / 256000 model limit)
  const exactT = {
    precisionState: PrecisionState.EXACT,
    confirmedTokens: 142078,
    modelContextLimit: 256000,
    engineHardClamp: 524288,
    effectiveLimit: 256000,
    usagePercent: (142078 / 256000) * 100
  };
  const exactText = buildStatusText(exactT, { valid: true, hardClamp: 524288, label: '512k ENGINE PATCH' });
  console.log('Formatted Exact Text:', exactText);
  assert.strictEqual(exactText, '⚡ 142.1k / 256k | 55.5%');
  console.log('✓ Exact status bar text matches required specification: ⚡ 142.1k / 256k | 55.5%');

  // Case 2: PENDING (142078+ / 256k | pending)
  const pendingT = {
    precisionState: PrecisionState.PENDING,
    confirmedTokens: 142078,
    modelContextLimit: 256000,
    engineHardClamp: 524288,
    effectiveLimit: 256000,
    usagePercent: null
  };
  const pendingText = buildStatusText(pendingT, { valid: true, hardClamp: 524288, label: '512k ENGINE PATCH' });
  console.log('Formatted Pending Text:', pendingText);
  assert.strictEqual(pendingText, '⚡ 142.1k+ / 256k | pending');
  console.log('✓ Pending status bar text matches required specification: ⚡ 142.1k+ / 256k | pending');

  // Case 3: STALE_SESSION (142078+ | model 256k | awaiting current-session turn)
  const staleT = {
    precisionState: PrecisionState.STALE_SESSION,
    confirmedTokens: 142078,
    modelContextLimit: 256000,
    engineHardClamp: 524288,
    effectiveLimit: 256000,
    usagePercent: null
  };
  const staleText = buildStatusText(staleT, { valid: true, hardClamp: 524288, label: '512k ENGINE PATCH' });
  console.log('Formatted Stale-Session Text:', staleText);
  assert.strictEqual(staleText, '⚡ 142.1k+ | model 256k | awaiting current-session turn');
  console.log('✓ Stale session text matches required specification: ⚡ 142.1k+ | model 256k | awaiting current-session turn');

  // Case 4: WAITING with known model context limit
  const waitingModelT = {
    precisionState: PrecisionState.WAITING,
    confirmedTokens: null,
    modelContextLimit: 256000,
    engineHardClamp: 524288,
    effectiveLimit: null,
    usagePercent: null
  };
  const waitingModelText = buildStatusText(waitingModelT, { valid: true, hardClamp: 524288, label: '512k ENGINE PATCH' });
  console.log('Formatted Waiting Text (with model):', waitingModelText);
  assert.strictEqual(waitingModelText, '⚡ model 256k | waiting for turn');
  console.log('✓ Waiting text with model context limit matches: ⚡ model 256k | waiting for turn');

  // Case 5: WAITING with engine clamp fallback (no model context limit yet)
  const waitingClampT = {
    precisionState: PrecisionState.WAITING,
    confirmedTokens: null,
    modelContextLimit: null,
    engineHardClamp: 524288,
    effectiveLimit: null,
    usagePercent: null
  };
  const waitingClampText = buildStatusText(waitingClampT, { valid: true, hardClamp: 524288, label: '512k ENGINE PATCH' });
  console.log('Formatted Waiting Text (with clamp):', waitingClampText);
  assert.strictEqual(waitingClampText, '⚡ clamp 524.3k | waiting');
  console.log('✓ Waiting text with clamp matches: ⚡ clamp 524.3k | waiting');

  // Case 6: DISCONNECTED
  const discT = { precisionState: PrecisionState.DISCONNECTED };
  const discText = buildStatusText(discT, { valid: true, hardClamp: 524288 });
  assert.strictEqual(discText, '⚡ Token Monitor: disconnected');
  console.log('✓ Disconnected text matches specification: ⚡ Token Monitor: disconnected');

  // Case 7: AMBIGUOUS
  const ambigT = { precisionState: PrecisionState.AMBIGUOUS };
  const ambigText = buildStatusText(ambigT, { valid: true, hardClamp: 524288 });
  assert.strictEqual(ambigText, '⚡ Token Monitor: select conversation');
  console.log('✓ Ambiguous text matches specification: ⚡ Token Monitor: select conversation');

  // Case 8: MODEL LIMIT UNAVAILABLE (exact state with missing model context limit)
  const noModelLimitT = {
    precisionState: PrecisionState.EXACT,
    confirmedTokens: 142078,
    modelContextLimit: null,
    engineHardClamp: 524288,
    effectiveLimit: null,
    usagePercent: null
  };
  const noModelText = buildStatusText(noModelLimitT, { valid: true, hardClamp: 524288 });
  console.log('Formatted Missing Model Limit Text:', noModelText);
  assert.strictEqual(noModelText, '⚡ 142.1k / model limit unavailable');
  console.log('✓ Missing model limit text matches specification: ⚡ 142.1k / model limit unavailable');

  // Case 9: VERIFIED PATCHED M318 (217025 tokens / 960000 effective local budget = 22.61%)
  const patchedM318T = {
    precisionState: PrecisionState.EXACT,
    measurementState: 'PATCH-AWARE / VERIFIED',
    trajectoryEstimate: 217025,
    confirmedTokens: 217025,
    nominalModelMetadata: 256000,
    modelContextLimit: 256000,
    patchedRuntimeLimit: 1000000,
    checkpointThreshold: 960000,
    engineHardClamp: 1048576,
    effectiveLocalBudget: 960000,
    effectiveLimit: 960000,
    localRemaining: 742975,
    localUsage: (217025 / 960000) * 100,
    usagePercent: (217025 / 960000) * 100,
    isM318: true,
    isPatchVerified: true,
    patchState: 'PATCH-AWARE / VERIFIED'
  };
  const patchedStatusText = buildStatusText(patchedM318T, { valid: true, hardClamp: 1048576, label: '1M ENGINE PATCH' });
  console.log('Formatted Patched M318 Text:', patchedStatusText);
  assert.strictEqual(patchedStatusText, '⚡ 217k / 960k | 22.6%');
  console.log('✓ Patched M318 status text matches required specification: ⚡ 217k / 960k | 22.6%');

  // Case 10: VERIFIED PATCHED M318 PENDING
  const patchedPendingT = {
    ...patchedM318T,
    precisionState: PrecisionState.PENDING,
    localUsage: null,
    usagePercent: null
  };
  const patchedPendingText = buildStatusText(patchedPendingT, { valid: true, hardClamp: 1048576, label: '1M ENGINE PATCH' });
  console.log('Formatted Patched M318 Pending Text:', patchedPendingText);
  assert.strictEqual(patchedPendingText, '⚡ 217k+ / 960k | pending');
  console.log('✓ Patched M318 pending status text matches: ⚡ 217k+ / 960k | pending');

  console.log('ALL FORMATTING TESTS PASSED!\n');
  return true;
}

if (require.main === module) {
  runFormattingTests();
}

module.exports = { runFormattingTests };
