// test/test-clamp.js
// Validates clamp inspector against live 512k binary and staged 900k binary.

const assert = require('assert');
const path = require('path');
const { inspectHardClamp } = require('../clamp-inspector');

function runClampTests() {
  console.log('--- TEST A: CLAMP PARSER TEST ---');

  // 1. Current production 1M binary with verified patch
  const prodExe = 'D:\\Antigravity IDE\\resources\\app\\extensions\\antigravity\\bin\\language_server_windows_x64.exe';
  const fs = require('fs');
  const os = require('os');

  if (fs.existsSync(prodExe)) {
    const prodResult = inspectHardClamp(prodExe);
    console.log('Live Production 1M Inspection:', prodResult);
    assert.strictEqual(prodResult.valid, true, 'Live production clamp inspection should be valid');
    assert.strictEqual(prodResult.hardClamp, 1048576, 'Live production clamp must equal 1048576');
    assert.strictEqual(prodResult.label, '1M ENGINE PATCH', 'Live production label must be 1M ENGINE PATCH');
    assert.strictEqual(prodResult.site1Hex, '81F900001000', 'Site 1 hex must match cmp ecx, 0x100000');
    assert.strictEqual(prodResult.site2Hex, 'BA00001000', 'Site 2 hex must match mov edx, 0x100000');
    assert.strictEqual(prodResult.hasCmovb, true, 'cmovb instruction must be present');
    assert.strictEqual(prodResult.sha256, 'd7b8a84264019aacb56126fff438523e35039fd4dc313aa002189d630ac05779', 'Production SHA256 must match expected');
    assert.strictEqual(prodResult.isPatchVerified, true, 'Production patch must be verified');
    console.log('✓ Live production 1M clamp and patch hash verified successfully');
  } else {
    console.log('  [CI/CONTAINER] Live production binary not present; running synthetic fixture verification.');
    const synthPath = path.join(os.tmpdir(), 'synthetic_1m_clamp.bin');
    const synthBuf = Buffer.alloc(0x013aa170, 0x90);
    // Site 1: 81 F9 00 00 10 00
    synthBuf.write('81F900001000', 0x013aa156, 'hex');
    // Site 2: BA 00 00 10 00
    synthBuf.write('BA00001000', 0x013aa15C, 'hex');
    // Post-clamp: 0F 42 D1
    synthBuf.write('0F42D1', 0x013aa161, 'hex');
    fs.writeFileSync(synthPath, synthBuf);
    try {
      const synthResult = inspectHardClamp(synthPath);
      assert.strictEqual(synthResult.valid, true);
      assert.strictEqual(synthResult.hardClamp, 1048576);
      assert.strictEqual(synthResult.label, '1M ENGINE PATCH');
      console.log('✓ Synthetic 1M clamp verified successfully');
    } finally {
      if (fs.existsSync(synthPath)) fs.unlinkSync(synthPath);
    }
  }

  // 2. Staged 900k binary
  const staged900kExe = 'D:\\Antigravity-IDE-Data\\binary-backups\\antigravity-1.107.0-900k-test\\language_server_windows_x64.exe.900k';
  if (fs.existsSync(staged900kExe)) {
    const stagedResult = inspectHardClamp(staged900kExe);
    console.log('Staged 900k Inspection:', stagedResult);
    assert.strictEqual(stagedResult.valid, true, 'Staged 900k clamp inspection should be valid');
    assert.strictEqual(stagedResult.hardClamp, 917504, 'Staged 900k clamp must equal 917504');
    assert.strictEqual(stagedResult.label, '~900k ENGINE PATCH', 'Staged 900k label must be ~900k ENGINE PATCH');
    assert.strictEqual(stagedResult.site1Hex, '81F900000E00', 'Site 1 hex must match cmp ecx, 0xE0000');
    assert.strictEqual(stagedResult.site2Hex, 'BA00000E00', 'Site 2 hex must match mov edx, 0xE0000');
    assert.strictEqual(stagedResult.hasCmovb, true, 'cmovb instruction must be present');
    console.log('✓ Staged 900k clamp verified successfully');
  } else {
    console.log('  [CI/CONTAINER] Staged 900k binary not on host; running synthetic verification.');
    const synthPath = path.join(os.tmpdir(), 'synthetic_900k_clamp.bin');
    const synthBuf = Buffer.alloc(0x013aa170, 0x90);
    synthBuf.write('81F900000E00', 0x013aa156, 'hex');
    synthBuf.write('BA00000E00', 0x013aa15C, 'hex');
    synthBuf.write('0F42D1', 0x013aa161, 'hex');
    fs.writeFileSync(synthPath, synthBuf);
    try {
      const synthResult = inspectHardClamp(synthPath);
      assert.strictEqual(synthResult.valid, true);
      assert.strictEqual(synthResult.hardClamp, 917504);
      assert.strictEqual(synthResult.label, '~900k ENGINE PATCH');
      console.log('✓ Synthetic ~900k clamp verified successfully');
    } finally {
      if (fs.existsSync(synthPath)) fs.unlinkSync(synthPath);
    }
  }

  // 3. Staged 128k original binary
  const staged128kExe = 'D:\\Antigravity-IDE-Data\\binary-backups\\antigravity-1.107.0-900k-test\\language_server_windows_x64.exe.128k-original';
  if (fs.existsSync(staged128kExe)) {
    const origResult = inspectHardClamp(staged128kExe);
    console.log('Original 128k Inspection:', origResult);
    assert.strictEqual(origResult.valid, true, 'Original 128k clamp inspection should be valid');
    assert.strictEqual(origResult.hardClamp, 128000, 'Original 128k clamp must equal 128000');
    assert.strictEqual(origResult.label, '128k STOCK', 'Original 128k label must be 128k STOCK');
    console.log('✓ Original 128k clamp verified successfully');
  } else {
    console.log('  [CI/CONTAINER] Original 128k binary not on host; running synthetic verification.');
    const synthPath = path.join(os.tmpdir(), 'synthetic_128k_clamp.bin');
    const synthBuf = Buffer.alloc(0x013aa170, 0x90);
    synthBuf.write('81F900F40100', 0x013aa156, 'hex');
    synthBuf.write('BA00F40100', 0x013aa15C, 'hex');
    synthBuf.write('0F42D1', 0x013aa161, 'hex');
    fs.writeFileSync(synthPath, synthBuf);
    try {
      const origResult = inspectHardClamp(synthPath);
      assert.strictEqual(origResult.valid, true);
      assert.strictEqual(origResult.hardClamp, 128000);
      assert.strictEqual(origResult.label, '128k STOCK');
      console.log('✓ Synthetic 128k stock clamp verified successfully');
    } finally {
      if (fs.existsSync(synthPath)) fs.unlinkSync(synthPath);
    }
  }

  console.log('ALL CLAMP TESTS PASSED!\n');
  return true;
}

if (require.main === module) {
  runClampTests();
}

module.exports = { runClampTests };
