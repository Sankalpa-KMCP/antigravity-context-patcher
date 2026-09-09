#!/usr/bin/env node
// src/index.js
// Main entry point for Antigravity Context Patcher — Phase 1M-A Scanner.
// Strictly READ-ONLY. Proves structural rediscovery and generates dry-run plan.

const fs = require('fs');
const { discoverBinary } = require('./binary-discovery');
const { PEParser } = require('./pe-parser');
const { ConverterScanner } = require('./converter-scanner');
const { ModelScanner } = require('./model-scanner');
const { PatchPlanner } = require('./patch-planner');
const { Verifier } = require('./verifier');

function runScan(binaryPath = null) {
  console.log('===============================================================');
  console.log('ANTIGRAVITY CONTEXT PATCH SCANNER — PHASE 1M-A (READ-ONLY)');
  console.log('===============================================================\n');

  // 1. Discover Binary
  console.log('[1/5] Discovering Active Binary...');
  const binaryInfo = discoverBinary(binaryPath);
  if (!binaryInfo.found) {
    console.error(`ERROR: ${binaryInfo.error}`);
    process.exit(1);
  }
  console.log(`  Path:           ${binaryInfo.path}`);
  console.log(`  Size:           ${binaryInfo.sizeBytes.toLocaleString()} bytes`);
  console.log(`  SHA-256:        ${binaryInfo.sha256}`);
  console.log(`  IDE Version:    ${binaryInfo.ideVersion}`);
  console.log(`  Ext Version:    ${binaryInfo.extensionVersion}`);
  console.log(`  Classification: ${binaryInfo.classification}\n`);

  // 2. Parse PE Structures
  console.log('[2/5] Parsing PE32+ Sections and Relocations...');
  // Read full binary once into memory buffer for high-speed scanning
  const fullBuffer = fs.readFileSync(binaryInfo.path);
  const peParser = new PEParser(fullBuffer);
  peParser.parse();
  const textSec  = peParser.getSection('.text');
  const rdataSec = peParser.getSection('.rdata');
  console.log(`  ImageBase: 0x${peParser.optionalHeader.imageBase.toString(16)}`);
  console.log(`  .text:     RVA 0x${textSec.virtualAddress.toString(16)} | FileOffset 0x${textSec.pointerToRawData.toString(16)} | Size ${textSec.sizeOfRawData.toLocaleString()} bytes`);
  console.log(`  .rdata:    RVA 0x${rdataSec.virtualAddress.toString(16)} | FileOffset 0x${rdataSec.pointerToRawData.toString(16)} | Size ${rdataSec.sizeOfRawData.toLocaleString()} bytes\n`);

  // 3. Scan Model Structures
  console.log('[3/5] Structural Model Scanning (M318 & ModelInfo)...');
  const modelScanner = new ModelScanner(peParser, fullBuffer);
  const modelScan = modelScanner.scan();
  if (!modelScan.found) {
    console.error(`  ERROR: ${modelScan.error}`);
  } else {
    console.log(`  Model ID:          ${modelScan.modelIdentifier}`);
    console.log(`  Display Name:      ${modelScan.displayName}`);
    console.log(`  Backend ID:        ${modelScan.backendModelId}`);
    console.log(`  Nominal Context:   ${modelScan.modelInfoStruct.currentNominalMaxTokens.toLocaleString()} tokens (${modelScan.modelInfoStruct.currentNominalHex})`);
    console.log(`  Field Layout:      MaxTokens @ offset ${modelScan.modelInfoStruct.maxTokensFieldOffset}, ReserveFloor @ offset ${modelScan.modelInfoStruct.reservedTokensFieldOffset}`);
    console.log(`  Downstream Paths:  ${modelScan.modelInfoStruct.accessSiteOffsetsHex.length} verified consumers in .text`);
    console.log(`  Model Confidence:  ${modelScan.confidence}\n`);
  }

  // 4. Scan Converter Clamp
  console.log('[4/5] Structural Converter Clamp Scanning...');
  const converterScanner = new ConverterScanner(peParser, fullBuffer);
  const converterScan = converterScanner.scan();
  if (!converterScan.found) {
    console.error(`  ERROR: ${converterScan.error}`);
  } else {
    console.log(`  Anchor Offset:     ${converterScan.anchorOffsetHex}`);
    console.log(`  Reserve Floor:     ${converterScan.reserveFloor.toLocaleString()} tokens`);
    console.log(`  Site 1 (Ceiling):  ${converterScan.site1.instructionHex} (${converterScan.site1.instructionAsm}) @ ${converterScan.site1.opcodeOffsetHex}`);
    console.log(`  Site 2 (Assign):   ${converterScan.site2.instructionHex} (${converterScan.site2.instructionAsm}) @ ${converterScan.site2.opcodeOffsetHex}`);
    console.log(`  Post-Clamp:        ${converterScan.postClamp.instructionHex} (${converterScan.postClamp.instructionAsm}) @ ${converterScan.postClamp.offsetHex}`);
    console.log(`  Current Clamp:     ${converterScan.currentEngineClamp.toLocaleString()} tokens`);
    console.log(`  Semantic Sequence: VERIFIED UNIQUE IN .TEXT\n`);
  }

  // 5. Build Classification & Update Resilience
  console.log('[5/5] Build Classification & 1M Target Planning...');
  const classification = Verifier.classifyBuild(binaryInfo, converterScan, modelScan);
  console.log(`  Build Classification: ${classification.status} (Eligible: ${classification.eligible})`);
  classification.reasons.forEach(r => console.log(`    - ${r}`));

  const tokenMonitorCheck = Verifier.verifyTokenMonitorCompatibility();
  console.log(`  Token Monitor Check:  Compatible=${tokenMonitorCheck.compatibleWith1M}, Label=${tokenMonitorCheck.clampInspectorLabel}`);
  if (tokenMonitorCheck.recommendedAdjustment) {
    console.log(`    Note: ${tokenMonitorCheck.recommendedAdjustment}`);
  }

  // Generate 1M Patch Plan
  const patchPlanner = new PatchPlanner(binaryInfo, converterScan, modelScan);
  const planResult = patchPlanner.generatePlan();

  if (planResult.feasible) {
    console.log('\n--- 1M TARGET DRY-RUN MANIFEST ---');
    console.log(JSON.stringify(planResult.manifest, null, 2));
    console.log('------------------------------------\n');
  } else {
    console.error(`\nPatch plan generation blocked: ${planResult.error}\n`);
  }

  return {
    binaryInfo,
    converterScan,
    modelScan,
    classification,
    tokenMonitorCheck,
    planResult
  };
}

if (require.main === module) {
  const customPath = process.argv[2] || null;
  runScan(customPath);
}

module.exports = { runScan };
