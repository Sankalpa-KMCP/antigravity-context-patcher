// src/signature-scanner.js
// High-performance, version-independent byte pattern and instruction scanner.
// Enforces strict match-uniqueness guarantees for safe binary patching.

class SignatureScanner {
  /**
   * Parse a pattern string with wildcards into byte array representation.
   * e.g. "81 F9 40 9C 00 00 ?? BA 40 9C 00 00 0F 4F D1"
   * Wildcards can be '??' or '?'.
   * @param {string} patternStr
   * @returns {number[]} Array of integers (0-255) or -1 for wildcards.
   */
  static parsePattern(patternStr) {
    const tokens = patternStr.trim().split(/\s+/);
    return tokens.map(token => {
      if (token === '??' || token === '?') {
        return -1;
      }
      const val = parseInt(token, 16);
      if (isNaN(val) || val < 0 || val > 255) {
        throw new Error(`Invalid hex byte token in pattern: "${token}"`);
      }
      return val;
    });
  }

  /**
   * Find the first occurrence of a pattern in a Buffer.
   * @param {Buffer} buffer
   * @param {number[]|string} pattern Array of byte values (-1 for wildcards) or hex pattern string
   * @param {number} [startOffset=0]
   * @param {number} [endOffset]
   * @returns {number} Offset of match, or -1 if not found.
   */
  static findPattern(buffer, pattern, startOffset = 0, endOffset = null) {
    const pat = typeof pattern === 'string' ? SignatureScanner.parsePattern(pattern) : pattern;
    const patLen = pat.length;
    const end = endOffset === null ? buffer.length : Math.min(buffer.length, endOffset);

    if (patLen === 0 || startOffset + patLen > end) {
      return -1;
    }

    const firstByte = pat[0];

    for (let i = startOffset; i <= end - patLen; i++) {
      if (firstByte !== -1 && buffer[i] !== firstByte) {
        continue;
      }

      let match = true;
      for (let j = 1; j < patLen; j++) {
        const expected = pat[j];
        if (expected !== -1 && buffer[i + j] !== expected) {
          match = false;
          break;
        }
      }

      if (match) {
        return i;
      }
    }

    return -1;
  }

  /**
   * Find all occurrences of a pattern in a Buffer.
   * @param {Buffer} buffer
   * @param {number[]|string} pattern
   * @param {number} [startOffset=0]
   * @param {number} [endOffset]
   * @param {number} [maxMatches=100]
   * @returns {number[]} Array of matching offsets.
   */
  static findAll(buffer, pattern, startOffset = 0, endOffset = null, maxMatches = 100) {
    const pat = typeof pattern === 'string' ? SignatureScanner.parsePattern(pattern) : pattern;
    const matches = [];
    let currentOffset = startOffset;
    const end = endOffset === null ? buffer.length : Math.min(buffer.length, endOffset);

    while (currentOffset < end && matches.length < maxMatches) {
      const found = SignatureScanner.findPattern(buffer, pat, currentOffset, end);
      if (found === -1) {
        break;
      }
      matches.push(found);
      currentOffset = found + 1;
    }

    return matches;
  }

  /**
   * Find an exact, unique occurrence of a pattern.
   * Fails closed if match count !== 1 (either 0 or > 1).
   * @param {Buffer} buffer
   * @param {number[]|string} pattern
   * @param {number} [startOffset=0]
   * @param {number} [endOffset]
   * @returns {{ unique: boolean, offset: number|null, count: number, error?: string }}
   */
  static findUnique(buffer, pattern, startOffset = 0, endOffset = null) {
    const matches = SignatureScanner.findAll(buffer, pattern, startOffset, endOffset, 5);
    if (matches.length === 0) {
      return {
        unique: false,
        offset: null,
        count: 0,
        error: 'Pattern not found (0 matches)'
      };
    }
    if (matches.length > 1) {
      return {
        unique: false,
        offset: null,
        count: matches.length,
        error: `Ambiguous pattern: expected exactly 1 match, found ${matches.length} matches at [${matches.map(m => '0x' + m.toString(16)).join(', ')}]`
      };
    }
    return {
      unique: true,
      offset: matches[0],
      count: 1
    };
  }
}

module.exports = { SignatureScanner };
