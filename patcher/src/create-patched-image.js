// src/create-patched-image.js
// Generates a fresh patched image from current production using the verified 4-site manifest.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { runScan } = require('./index');

const EXPECTED_PROD_HASH = 'efb32d55e3c670870ef6025b12d844b12473158a78a31b06a417c1bbb30e67e7';
const EXPECTED_PATCHED_HASH = 'ec2f03ba0fe00630d49b035c2477b549c48fba0d8cc920dfe2d588f001d239b6';

function createFreshPatchedImage() {
  console.log('--- Generating Fresh Patched Image ---');
  
  // 1. Run scanner to get dynamic plan
  const scanResult = runScan();
  const prodPath = scanResult.binaryInfo.path;
  
  // 2. Read production binary
  console.log(`Reading production binary from: ${prodPath}`);
  const prodBuf = fs.readFileSync(prodPath);
  const actualProdHash = crypto.createHash('sha256').update(prodBuf).digest('hex');
  
  if (actualProdHash !== EXPECTED_PROD_HASH) {
    throw new Error(`Production SHA-256 mismatch! Expected ${EXPECTED_PROD_HASH}, got ${actualProdHash}`);
  }
  console.log(`[PASS] Production hash matches expected: ${actualProdHash}`);
  
  // 3. Clone buffer in memory
  const patchedBuf = Buffer.from(prodBuf);
  const manifest = scanResult.planResult.manifest;
  
  if (!manifest || !manifest.patchSites || manifest.patchSites.length !== 4) {
    throw new Error(`Expected exactly 4 patch sites in manifest, got ${manifest ? manifest.patchSites.length : 0}`);
  }
  
  // 4. Apply each patch site
  for (const site of manifest.patchSites) {
    const offset = parseInt(site.fileOffsetHex, 16);
    const origBytes = Buffer.from(site.originalBytesHex.replace(/\s+/g, ''), 'hex');
    const propBytes = Buffer.from(site.proposedBytesHex.replace(/\s+/g, ''), 'hex');
    
    // Pre-patch verification at site
    const currentBytes = patchedBuf.subarray(offset, offset + origBytes.length);
    if (!currentBytes.equals(origBytes)) {
      throw new Error(`Site ${site.code} offset ${site.fileOffsetHex} bytes mismatch!\nExpected: ${origBytes.toString('hex')}\nFound:    ${currentBytes.toString('hex')}`);
    }
    
    // Apply patch
    propBytes.copy(patchedBuf, offset);
    console.log(`[APPLIED] Site ${site.code} (${site.name}) at ${site.fileOffsetHex}: ${propBytes.length} bytes`);
  }
  
  // 5. Verify patched hash
  const actualPatchedHash = crypto.createHash('sha256').update(patchedBuf).digest('hex');
  if (actualPatchedHash !== EXPECTED_PATCHED_HASH) {
    throw new Error(`Patched SHA-256 mismatch! Expected ${EXPECTED_PATCHED_HASH}, got ${actualPatchedHash}`);
  }
  console.log(`[PASS] Fresh patched buffer hash matches expected: ${actualPatchedHash}`);
  
  // 6. Write to staging/language_server_1m_verified.exe
  const stagingDir = path.join(__dirname, '..', 'staging');
  if (!fs.existsSync(stagingDir)) {
    fs.mkdirSync(stagingDir, { recursive: true });
  }
  const outputPath = path.join(stagingDir, 'language_server_1m_verified.exe');
  fs.writeFileSync(outputPath, patchedBuf);
  
  // 7. Verify disk read
  const diskBuf = fs.readFileSync(outputPath);
  const diskHash = crypto.createHash('sha256').update(diskBuf).digest('hex');
  if (diskHash !== EXPECTED_PATCHED_HASH) {
    throw new Error(`Disk verification mismatch! Expected ${EXPECTED_PATCHED_HASH}, got ${diskHash}`);
  }
  console.log(`[PASS] Written and verified on disk: ${outputPath} (${diskHash})`);
  
  return {
    prodPath,
    outputPath,
    prodHash: actualProdHash,
    patchedHash: diskHash
  };
}

if (require.main === module) {
  try {
    const res = createFreshPatchedImage();
    console.log('\nFresh patched image successfully created and verified.');
  } catch (err) {
    console.error('\nFAILURE:', err.message);
    process.exit(1);
  }
}

module.exports = { createFreshPatchedImage, EXPECTED_PROD_HASH, EXPECTED_PATCHED_HASH };
