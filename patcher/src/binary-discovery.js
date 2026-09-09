// src/binary-discovery.js
// Discovers the active Antigravity language server executable, hashes, and IDE versions.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const KNOWN_HASHES = {
  '2f44b0a25eb4630afc1a2817363ef453d51a72c94bbdaa6aad8ba00e8d7aa0e1': {
    label: '128k STOCK',
    converterClamp: 128000,
    modelContextLimit: 256000,
    classification: 'KNOWN_COMPATIBLE'
  },
  '25fbb22e0ab9004eaebbfec5591e91f2e0654649cdfcaae5d639f1430aa484f2': {
    label: '256k ENGINE PATCH',
    converterClamp: 262144,
    modelContextLimit: 256000,
    classification: 'KNOWN_COMPATIBLE'
  },
  'efb32d55e3c670870ef6025b12d844b12473158a78a31b06a417c1bbb30e67e7': {
    label: '512k ENGINE PATCH (CURRENT PRODUCTION)',
    converterClamp: 524288,
    modelContextLimit: 256000,
    classification: 'KNOWN_COMPATIBLE'
  },
  '8d9f7fe4b55b1cccbcf1d79e958c493c39841d1506da822c18748041a7f0127c': {
    label: '~900k ENGINE PATCH',
    converterClamp: 917504,
    modelContextLimit: 256000,
    classification: 'KNOWN_COMPATIBLE'
  },
  'ec2f03ba0fe00630d49b035c2477b549c48fba0d8cc920dfe2d588f001d239b6': {
    label: '1M ENGINE + M318 MODELINFO PATCH (CURRENT PRODUCTION)',
    converterClamp: 1048576,
    modelContextLimit: 1000000,
    classification: 'KNOWN_COMPATIBLE'
  },
  'd7b8a84264019aacb56126fff438523e35039fd4dc313aa002189d630ac05779': {
    label: '1M ENGINE + M318 MODELINFO + CHECKPOINT OVERRIDE (STAGED TEST)',
    converterClamp: 1048576,
    modelContextLimit: 1000000,
    checkpointLimit: 960000,
    classification: 'KNOWN_COMPATIBLE'
  }
};

const DEFAULT_CANDIDATE_PATHS = [
  'D:\\Antigravity IDE\\resources\\app\\extensions\\antigravity\\bin\\language_server_windows_x64.exe',
  path.join(process.env.LOCALAPPDATA || 'C:\\Users\\Default\\AppData\\Local', 'Programs', 'Antigravity', 'resources', 'app', 'extensions', 'antigravity', 'bin', 'language_server_windows_x64.exe')
];

/**
 * Compute SHA-256 hash of a file.
 * @param {string} filePath
 * @returns {string}
 */
function computeFileSha256(filePath) {
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.alloc(65536);
  const fd = fs.openSync(filePath, 'r');
  try {
    let bytesRead;
    while ((bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex').toLowerCase();
}

/**
 * Discover the active language server binary on the host.
 * @param {string} [overridePath]
 * @returns {object}
 */
function discoverBinary(overridePath = null) {
  let targetPath = overridePath;

  if (!targetPath) {
    for (const candidate of DEFAULT_CANDIDATE_PATHS) {
      if (fs.existsSync(candidate)) {
        targetPath = candidate;
        break;
      }
    }
  }

  if (!targetPath || !fs.existsSync(targetPath)) {
    return {
      found: false,
      error: `Could not locate language_server_windows_x64.exe. Tested candidates: ${DEFAULT_CANDIDATE_PATHS.join(', ')}`
    };
  }

  const stat = fs.statSync(targetPath);
  const sha256 = computeFileSha256(targetPath);
  const known = KNOWN_HASHES[sha256] || null;

  // Discover IDE Version from product.json
  let ideVersion = 'unknown';
  let ideCommit = 'unknown';
  try {
    const ideRoot = targetPath.split('\\extensions\\')[0];
    const candidateProductJsons = [
      path.join(ideRoot, 'product.json'),
      path.join(ideRoot, '..', 'product.json')
    ];
    for (const p of candidateProductJsons) {
      if (fs.existsSync(p)) {
        const pData = JSON.parse(fs.readFileSync(p, 'utf8'));
        ideVersion = pData.version || ideVersion;
        ideCommit = pData.commit || ideCommit;
        break;
      }
    }
  } catch (_) {}

  // Discover Extension Version from package.json
  let extensionVersion = 'unknown';
  try {
    const extDir = path.dirname(path.dirname(targetPath));
    const pkgJsonPath = path.join(extDir, 'package.json');
    if (fs.existsSync(pkgJsonPath)) {
      const pkgData = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
      extensionVersion = pkgData.version || extensionVersion;
    }
  } catch (_) {}

  return {
    found: true,
    path: targetPath,
    sizeBytes: stat.size,
    lastModified: stat.mtime.toISOString(),
    sha256,
    classification: known ? known.classification : 'UNKNOWN_BUILD',
    knownProfile: known,
    ideVersion,
    ideCommit,
    extensionVersion
  };
}

module.exports = {
  discoverBinary,
  computeFileSha256,
  KNOWN_HASHES
};
