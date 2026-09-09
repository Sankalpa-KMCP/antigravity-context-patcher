// clamp-inspector.js
// Inspects Antigravity Language Server binary for the hard-coded trajectory clamp.
// Zero heuristics - reads exact instruction immediates at verified offsets.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_EXE_PATH = 'D:\\Antigravity IDE\\resources\\app\\extensions\\antigravity\\bin\\language_server_windows_x64.exe';
const EXPECTED_M318_PATCH_SHA256 = 'd7b8a84264019aacb56126fff438523e35039fd4dc313aa002189d630ac05779';

const OFFSET_SITE1_OPCODE = 0x013aa156; // 81 F9 (cmp ecx, imm32)
const OFFSET_SITE1_IMM    = 0x013aa158; // 32-bit uint immediate
const OFFSET_SITE2_OPCODE = 0x013aa15C; // BA (mov edx, imm32)
const OFFSET_SITE2_IMM    = 0x013aa15D; // 32-bit uint immediate
const OFFSET_POST_CLAMP   = 0x013aa161; // 0F 42 D1 (cmovb edx, ecx)

// In-memory cache for SHA-256 to avoid redundant disk I/O on large binaries
const hashCache = new Map();

/**
 * Compute or retrieve cached SHA-256 of binary.
 * @param {string} filePath
 * @returns {string|null}
 */
function getFileSha256(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const stat = fs.statSync(filePath);
    const cacheKey = `${filePath}:${stat.mtimeMs}:${stat.size}`;
    if (hashCache.has(cacheKey)) {
      return hashCache.get(cacheKey);
    }
    const buf = fs.readFileSync(filePath);
    const sha = crypto.createHash('sha256').update(buf).digest('hex').toLowerCase();
    hashCache.set(cacheKey, sha);
    return sha;
  } catch (_) {
    return null;
  }
}

/**
 * Inspect language server binary and extract the hard clamp immediate and patch status.
 * @param {string} [exePath]
 * @returns {{ valid: boolean, hardClamp: number|null, label: string, path: string, sha256: string|null, isPatchVerified: boolean, site1Hex?: string, site2Hex?: string, hasCmovb?: boolean, error?: string }}
 */
function inspectHardClamp(exePath = DEFAULT_EXE_PATH) {
  if (!fs.existsSync(exePath)) {
    return {
      valid: false,
      hardClamp: null,
      label: 'EXE NOT FOUND',
      path: exePath,
      sha256: null,
      isPatchVerified: false,
      error: `Binary not found at ${exePath}`
    };
  }

  let fd;
  try {
    const sha256 = getFileSha256(exePath);
    const isPatchVerified = (sha256 === EXPECTED_M318_PATCH_SHA256);

    fd = fs.openSync(exePath, 'r');
    const readLen = 0x20; // Read 32 bytes from Site 1
    const buffer = Buffer.alloc(readLen);
    const bytesRead = fs.readSync(fd, buffer, 0, readLen, OFFSET_SITE1_OPCODE);

    if (bytesRead < 16) {
      return {
        valid: false,
        hardClamp: null,
        label: 'READ INCOMPLETE',
        path: exePath,
        sha256,
        isPatchVerified: false,
        error: `Could not read clamp instruction region`
      };
    }

    // Verify Site 1 opcode: 81 F9
    const op1_0 = buffer[0];
    const op1_1 = buffer[1];
    if (op1_0 !== 0x81 || op1_1 !== 0xF9) {
      return {
        valid: false,
        hardClamp: null,
        label: 'UNKNOWN INSTRUCTION',
        path: exePath,
        sha256,
        isPatchVerified: false,
        site1Hex: buffer.subarray(0, 6).toString('hex').toUpperCase(),
        error: `Site 1 opcode mismatch at 0x${OFFSET_SITE1_OPCODE.toString(16)}: expected 81 F9, got ${op1_0.toString(16)} ${op1_1.toString(16)}`
      };
    }

    // Read Site 1 immediate (little-endian uint32 at offset +2)
    const imm1 = buffer.readUInt32LE(2);

    // Verify Site 2 opcode: BA at offset +6 (0x013aa15C - 0x013aa156)
    const op2 = buffer[6];
    if (op2 !== 0xBA) {
      return {
        valid: false,
        hardClamp: null,
        label: 'UNKNOWN INSTRUCTION',
        path: exePath,
        sha256,
        isPatchVerified: false,
        site2Hex: buffer.subarray(6, 11).toString('hex').toUpperCase(),
        error: `Site 2 opcode mismatch at 0x${OFFSET_SITE2_OPCODE.toString(16)}: expected BA, got ${op2.toString(16)}`
      };
    }

    // Read Site 2 immediate (little-endian uint32 at offset +7)
    const imm2 = buffer.readUInt32LE(7);

    // Verify cmovb edx, ecx (0F 42 D1) at offset +11
    const cmov0 = buffer[11];
    const cmov1 = buffer[12];
    const cmov2 = buffer[13];
    const hasCmov = (cmov0 === 0x0F && cmov1 === 0x42 && cmov2 === 0xD1);

    if (imm1 !== imm2 || !hasCmov) {
      return {
        valid: false,
        hardClamp: null,
        label: 'MISMATCHED CLAMP SITES',
        path: exePath,
        sha256,
        isPatchVerified: false,
        error: `Site 1 (${imm1}) and Site 2 (${imm2}) disagree or cmovb missing (${hasCmov})`
      };
    }

    const label = formatClampLabel(imm1);

    return {
      valid: true,
      hardClamp: imm1,
      label,
      path: exePath,
      sha256,
      isPatchVerified,
      site1Hex: buffer.subarray(0, 6).toString('hex').toUpperCase(),
      site2Hex: buffer.subarray(6, 11).toString('hex').toUpperCase(),
      hasCmovb: hasCmov
    };
  } catch (err) {
    return {
      valid: false,
      hardClamp: null,
      label: 'INSPECTION ERROR',
      path: exePath,
      sha256: null,
      isPatchVerified: false,
      error: err.message
    };
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch (_) {}
    }
  }
}

/**
 * Format a human-readable clamp label from the raw immediate integer.
 * @param {number} clamp
 * @returns {string}
 */
function formatClampLabel(clamp) {
  switch (clamp) {
    case 128000:
      return '128k STOCK';
    case 262144:
      return '256k ENGINE PATCH';
    case 524288:
      return '512k ENGINE PATCH';
    case 917504:
      return '~900k ENGINE PATCH';
    case 1048576:
      return '1M ENGINE PATCH';
    default:
      if (clamp > 0) {
        return `CUSTOM (${clamp})`;
      }
      return 'INVALID';
  }
}

/**
 * Check if the language server binary has verified M318 patch applied.
 * @param {string} [exePath]
 * @returns {{ verified: boolean, sha256: string|null, hardClamp: number|null, expectedSha256: string }}
 */
function verifyBinaryPatch(exePath = DEFAULT_EXE_PATH) {
  const result = inspectHardClamp(exePath);
  return {
    verified: Boolean(result.isPatchVerified),
    sha256: result.sha256,
    hardClamp: result.hardClamp,
    expectedSha256: EXPECTED_M318_PATCH_SHA256
  };
}

/**
 * Set up a file watcher on the binary to automatically detect updates or rollbacks.
 * @param {string} exePath
 * @param {function(object): void} onChangeCallback
 * @returns {{ dispose: function(): void }}
 */
function watchHardClamp(exePath = DEFAULT_EXE_PATH, onChangeCallback) {
  let watcher = null;
  try {
    const dir = path.dirname(exePath);
    const targetFile = path.basename(exePath).toLowerCase();
    
    if (fs.existsSync(dir)) {
      watcher = fs.watch(dir, (eventType, filename) => {
        if (filename && filename.toLowerCase() === targetFile) {
          // Debounce read slightly in case of in-progress atomic copy
          setTimeout(() => {
            const result = inspectHardClamp(exePath);
            onChangeCallback(result);
          }, 200);
        }
      });
    }
  } catch (err) {
    console.error(`[TokenMonitor] Error establishing file watcher on ${exePath}:`, err);
  }

  return {
    dispose: () => {
      if (watcher) {
        try { watcher.close(); } catch (_) {}
        watcher = null;
      }
    }
  };
}

module.exports = {
  inspectHardClamp,
  formatClampLabel,
  verifyBinaryPatch,
  watchHardClamp,
  DEFAULT_EXE_PATH,
  EXPECTED_M318_PATCH_SHA256
};
