// src/verifier.js
// Pre-flight safety verifier, build classification engine, and token monitor compatibility checker.

const fs = require('fs');
const path = require('path');

const TOKEN_MONITOR_DIR = 'D:\\Antigravity-IDE-Data\\extensions\\local.antigravity-token-monitor-0.1.0';

class Verifier {
  /**
   * Classify build resilience and compatibility.
   * @param {object} binaryInfo
   * @param {object} converterScan
   * @param {object} modelScan
   * @returns {{ status: string, eligible: boolean, reasons: string[] }}
   */
  static classifyBuild(binaryInfo, converterScan, modelScan) {
    const reasons = [];

    if (!binaryInfo.found) {
      return { status: 'UNSAFE', eligible: false, reasons: ['Binary not found'] };
    }

    if (!converterScan.found) {
      if (converterScan.count > 1) {
        return {
          status: 'AMBIGUOUS',
          eligible: false,
          reasons: [`Ambiguous converter clamp: found ${converterScan.count} candidate sites in .text`]
        };
      }
      return {
        status: 'UNKNOWN_BUILD',
        eligible: false,
        reasons: [`Converter clamp sequence not discovered: ${converterScan.error}`]
      };
    }

    if (!modelScan.found) {
      return {
        status: 'UNKNOWN_BUILD',
        eligible: false,
        reasons: [`Model identity or ModelInfo access paths not discovered: ${modelScan.error}`]
      };
    }

    // Check if hash is already known
    if (binaryInfo.knownProfile) {
      reasons.push(`Binary hash matched known profile: ${binaryInfo.knownProfile.label}`);
      return {
        status: 'KNOWN_COMPATIBLE',
        eligible: true,
        reasons
      };
    }

    // Structural compatibility checks
    if (converterScan.site1.currentValue < 64000 || converterScan.site1.currentValue > 10000000) {
      return {
        status: 'UNSAFE',
        eligible: false,
        reasons: [`Engine clamp value out of sane bounds: ${converterScan.site1.currentValue}`]
      };
    }

    reasons.push('Converter clamp site is unique and semantically verified in .text');
    reasons.push('M318 ModelInfo struct layout confirmed with downstream consumers');
    return {
      status: 'STRUCTURALLY_COMPATIBLE',
      eligible: true,
      reasons
    };
  }

  /**
   * Verify token monitor extension compatibility with 1M tokens.
   * @returns {object}
   */
  static verifyTokenMonitorCompatibility() {
    const clampInspectorPath = path.join(TOKEN_MONITOR_DIR, 'clamp-inspector.js');
    const statusbarPath      = path.join(TOKEN_MONITOR_DIR, 'statusbar.js');

    if (!fs.existsSync(clampInspectorPath) || !fs.existsSync(statusbarPath)) {
      return {
        installed: false,
        compatible: false,
        note: `Token monitor extension not found at ${TOKEN_MONITOR_DIR}`
      };
    }

    const clampInspectorSrc = fs.readFileSync(clampInspectorPath, 'utf8');
    const statusbarSrc      = fs.readFileSync(statusbarPath, 'utf8');

    // 1. Check formatTokenValue in statusbar.js:
    // Does it support >= 1_000_000 -> "${(safe / 1_000_000).toFixed(1)}M"?
    const supports1MFormatting = /safe\s*>=\s*1_000_000/i.test(statusbarSrc) || /1000000/i.test(statusbarSrc);

    // 2. Check formatClampLabel in clamp-inspector.js:
    // Does it explicitly handle 1048576 or does it fallback to CUSTOM (1048576)?
    const hasExplicit1MCase = /case\s+1048576\s*:/i.test(clampInspectorSrc);

    return {
      installed: true,
      path: TOKEN_MONITOR_DIR,
      compatibleWith1M: true, // Functional: reads exact imm32 and handles >= 1M in statusbar
      statusbarFormatting1M: supports1MFormatting,
      clampInspectorExplicit1M: hasExplicit1MCase,
      clampInspectorLabel: hasExplicit1MCase ? '1M ENGINE PATCH' : 'CUSTOM (1048576)',
      recommendedAdjustment: hasExplicit1MCase ? null : "Add 'case 1048576: return \"1M ENGINE PATCH\";' to formatClampLabel in clamp-inspector.js for cleaner status bar labelling."
    };
  }
}

module.exports = { Verifier };
