// test/test-scanner.js
// Automated test suite for Antigravity Context Patcher.
// Strictly READ-ONLY. Validates scanner accuracy and 1M plan derivation.

const assert = require('assert');
const path = require('path');
const { runScan } = require('../src/index');

function runTests() {
  console.log('Running test suite for Antigravity Context Patcher...\n');

  const result = runScan();

  // 1. Binary Discovery Tests
  assert.strictEqual(result.binaryInfo.found, true, 'Binary must be discovered');
  assert.strictEqual(
    result.binaryInfo.sha256,
    'efb32d55e3c670870ef6025b12d844b12473158a78a31b06a417c1bbb30e67e7',
    'Production binary SHA-256 must match current patched hash'
  );
  assert.strictEqual(result.binaryInfo.classification, 'KNOWN_COMPATIBLE', 'Current build must be KNOWN_COMPATIBLE');

  // 2. Converter Scanner Tests
  assert.strictEqual(result.converterScan.found, true, 'Converter clamp sequence must be structurally found');
  assert.strictEqual(result.converterScan.currentEngineClamp, 524288, 'Current engine clamp must equal 524288');
  assert.strictEqual(result.converterScan.reserveFloor, 40000, 'Reserve floor must equal 40000');
  assert.strictEqual(result.converterScan.semanticSequenceVerified, true, 'Semantic sequence must be verified');
  assert.strictEqual(result.converterScan.postClamp.verified, true, 'cmovb must be verified');

  // 3. Model Scanner Tests
  assert.strictEqual(result.modelScan.found, true, 'Active model M318 must be found');
  assert.strictEqual(result.modelScan.modelIdentifier, 'MODEL_PLACEHOLDER_M318');
  assert.strictEqual(result.modelScan.modelInfoStruct.currentNominalMaxTokens, 256000);
  assert.strictEqual(result.modelScan.modelInfoStruct.downstreamConsumerVerified, true);

  // 4. Build Classification Tests
  assert.strictEqual(result.classification.eligible, true, 'Build must be eligible for planning');
  assert.strictEqual(result.classification.status, 'KNOWN_COMPATIBLE');

  // 5. 1M Patch Plan Tests
  assert.strictEqual(result.planResult.feasible, true, '1M patch plan must be feasible');
  const m = result.planResult.manifest;
  assert.strictEqual(m.targetLimits.engineClamp, 1048576, 'Target engine clamp must equal 1048576 (0x100000)');
  assert.strictEqual(m.targetLimits.modelNominal, 1000000, 'Target model limit must equal 1000000 (0xF4240)');
  assert.strictEqual(m.targetLimits.expectedUsableConverterBudget, 960000, 'Expected usable budget must equal 960000');
  assert.strictEqual(m.targetLimits.effectiveConverterLimit, 960000, 'Effective converter limit must equal 960000');
  assert.strictEqual(m.isDryRun, true, 'Plan must be marked dry-run');
  assert.strictEqual(m.ideVersion, '1.107.0', 'IDE version must match 1.107.0');
  assert.strictEqual(m.patchSites.length, 4, 'Must propose exactly 4 patch sites (2 engine + hook + cave)');
  // Site 1: ENGINE_PATCH_1
  assert.strictEqual(m.patchSites[0].code, 'ENGINE_PATCH_1');
  assert.strictEqual(m.patchSites[0].originalBytesHex, '00 00 08 00', 'Site 1 original immediate must be 0x00080000');
  assert.strictEqual(m.patchSites[0].proposedBytesHex, '00 00 10 00', 'Site 1 proposed immediate must be 0x00100000');
  // Site 2: ENGINE_PATCH_2
  assert.strictEqual(m.patchSites[1].code, 'ENGINE_PATCH_2');
  assert.strictEqual(m.patchSites[1].originalBytesHex, '00 00 08 00', 'Site 2 original immediate must be 0x00080000');
  assert.strictEqual(m.patchSites[1].proposedBytesHex, '00 00 10 00', 'Site 2 proposed immediate must be 0x00100000');
  // Site 3: M318_HOOK
  assert.strictEqual(m.patchSites[2].code, 'M318_HOOK');
  assert.strictEqual(m.patchSites[2].fileOffsetHex, '0xb3e936');
  assert.strictEqual(m.patchSites[2].lengthBytes, 11);
  assert.strictEqual(m.patchSites[2].originalBytesHex, '48 89 D9 48 89 C3 48 8B 44 24 48');
  assert.strictEqual(m.patchSites[2].proposedBytesHex, 'E9 C5 BD C8 01 66 0F 1F 44 00 00');
  // Site 4: M318_CODE_CAVE
  assert.strictEqual(m.patchSites[3].code, 'M318_CODE_CAVE');
  assert.strictEqual(m.patchSites[3].fileOffsetHex, '0x27ca700');
  assert.strictEqual(m.patchSites[3].lengthBytes, 36);
  assert.strictEqual(
    m.patchSites[3].proposedBytesHex,
    '48 89 D9 48 89 C3 48 8B 44 24 48 81 BC 24 80 00 00 00 26 05 00 00 75 07 C7 40 14 40 42 0F 00 E9 1D 42 37 FE'
  );

  // Scope proof validation
  assert.strictEqual(m.scopeProof.targetMaxTokens, 1000000);
  assert.ok(m.scopeProof.negativeScopeVerified.includes('M318->1000000'));

  // 6. Token Monitor Compatibility Tests
  assert.strictEqual(result.tokenMonitorCheck.installed, true, 'Token monitor extension must be detected');
  assert.strictEqual(result.tokenMonitorCheck.compatibleWith1M, true, 'Token monitor must be functionally compatible with 1M');

  // 7. Staged Binary Verification (if staging copy present)
  const fs = require('fs');
  const crypto = require('crypto');
  const stagedPath = path.join(__dirname, '..', 'staging', 'language_server_1m_test.exe');
  if (fs.existsSync(stagedPath)) {
    const stagedBuf = fs.readFileSync(stagedPath);
    const stagedHash = crypto.createHash('sha256').update(stagedBuf).digest('hex');
    assert.strictEqual(stagedHash, m.stagedHash, 'Staged copy SHA-256 must match planned stagedHash');
    console.log(`  Staged Copy Verified: ${stagedHash}`);
  }

  console.log('\n========================================');
  console.log('ALL TESTS PASSED SUCCESSFULLY (READ-ONLY)');
  console.log('========================================\n');
}

if (require.main === module) {
  runTests();
}

module.exports = { runTests };
