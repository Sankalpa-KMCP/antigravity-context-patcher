// test/test-integrity-audit.js
// Scans all JavaScript source files in the extension to verify the Non-Negotiable Data Integrity Rule.
// Checks for forbidden token-guessing keywords:
//   - "/ 4" (character-to-token division)
//   - "chars" (character-based token heuristic)
//   - "approx" (token approximation)
//   - "estimate" (token estimation functions)

const fs = require('fs');
const path = require('path');
const assert = require('assert');

function runIntegrityAudit() {
  console.log('--- TEST F: TOKEN ESTIMATION & SOURCE INTEGRITY AUDIT ---');

  const rootDir = path.resolve(__dirname, '..');
  const jsFiles = fs.readdirSync(rootDir)
    .filter(f => f.endsWith('.js'))
    .map(f => path.join(rootDir, f));

  console.log(`Auditing ${jsFiles.length} extension root source files:`, jsFiles.map(f => path.basename(f)));

  const forbiddenPatterns = [
    { pattern: /\/\s*4\b/, name: 'Divide-by-4 token heuristic (/ 4)' },
    { pattern: /\bchars\b/i, name: 'Character-based heuristic (chars)' },
    { pattern: /\bapprox(?:imate|imation)?\b/i, name: 'Approximation heuristic' }
  ];

  let totalViolations = 0;

  for (const filePath of jsFiles) {
    const filename = path.basename(filePath);
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split(/\r?\n/);

    for (let lineNum = 1; lineNum <= lines.length; lineNum++) {
      const line = lines[lineNum - 1];

      for (const { pattern, name } of forbiddenPatterns) {
        if (pattern.test(line)) {
          console.error(`VIOLATION in ${filename}:${lineNum}: [${name}] -> "${line.trim()}"`);
          totalViolations++;
        }
      }

      // Check "estimate" - permitted for authoritative protobuf field names ("estimatedTokensUsed", "estimated_tokens_used"),
      // canonical UI metric labels ("Trajectory Estimate", "trajectoryEstimate"), and the conservative disclaimer note.
      // Any custom estimation calculation function (e.g. estimateTokens, estimateDelta, etc.) remains strictly prohibited.
      const estimateMatch = line.match(/\bestimate\w*\b/i);
      if (estimateMatch) {
        const word = estimateMatch[0];
        const isPermitted = /estimatedTokensUsed|estimated_tokens_used|trajectoryEstimate|Trajectory Estimate|conservative local estimate/i.test(line);
        if (!isPermitted) {
          console.error(`SUSPICIOUS ESTIMATE WORD in ${filename}:${lineNum}: "${word}" -> "${line.trim()}"`);
          totalViolations++;
        }
      }
    }
  }

  assert.strictEqual(totalViolations, 0, `Integrity audit found ${totalViolations} forbidden estimation patterns!`);
  console.log('✓ Token estimation audit PASSED: ZERO forbidden heuristics, ZERO chars/4, ZERO token approximation found in source code.');
  console.log('ALL INTEGRITY AUDIT TESTS PASSED!\n');
  return true;
}

if (require.main === module) {
  runIntegrityAudit();
}

module.exports = { runIntegrityAudit };
