#!/usr/bin/env node
/**
 * scripts/verify-patch.js
 * Strictly READ-ONLY verification helper for Antigravity Context Patcher.
 * Validates executable SHA-256, engine clamp, M318 runtime limit, and checkpoint threshold.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_EXE_PATH = 'D:\\Antigravity IDE\\resources\\app\\extensions\\antigravity\\bin\\language_server_windows_x64.exe';
const EXPECTED_M318_PATCH_SHA256 = 'd7b8a84264019aacb56126fff438523e35039fd4dc313aa002189d630ac05779';

const SITES = {
  ENGINE_PATCH_1: {
    offset: 0x013aa158,
    expectedLE: 1048576,
    hex: '00001000',
    description: 'Engine Hard Clamp CMP Immediate'
  },
  ENGINE_PATCH_2: {
    offset: 0x013aa15D,
    expectedLE: 1048576,
    hex: '00001000',
    description: 'Engine Hard Clamp MOV Immediate'
  },
  M318_HOOK: {
    offset: 0x00b3e936,
    expectedHex: 'E9C5BDC801660F1F440000',
    description: 'ModelInfo M318 Trampoline Hook (jmp 0x27cb300; 6-byte nop)'
  },
  M318_CODE_CAVE: {
    offset: 0x027ca700,
    expectedHex: '4889D94889C3488B44244881BC2480000000260500007507C7401440420F00E91D4237FE',
    targetValue: 1000000,
    modelKey: 1318,
    description: 'ModelInfo M318 Code Cave (target: 1,000,000 tokens for key 1318)'
  },
  CHECKPOINT_M318_HOOK: {
    offset: 0x0196052b,
    expectedHex: 'E910A2E600660F1F840000000000',
    description: 'CheckpointConfig M318 Trampoline Hook (jmp 0x27cb340; 9-byte nop)'
  },
  CHECKPOINT_M318_CODE_CAVE: {
    offset: 0x027ca740,
    expectedHex: '488B842470020000817C24A42605000075154885C07410488B48104885C97407C7411400A60E0031DB31C989CFE9C75D19FF',
    targetValue: 960000,
    modelKey: 1318,
    description: 'CheckpointConfig M318 Code Cave (target: 960,000 tokens for key 1318)'
  }
};

function main() {
  const targetPath = process.argv[2] || DEFAULT_EXE_PATH;
  console.log('====================================================');
  console.log('ANTIGRAVITY CONTEXT PATCHER — READ-ONLY VERIFIER');
  console.log('====================================================');
  console.log(`Target Binary: ${targetPath}`);

  if (!fs.existsSync(targetPath)) {
    console.error(`\n[ERROR] File not found: ${targetPath}`);
    process.exit(1);
  }

  const stat = fs.statSync(targetPath);
  console.log(`File Size:     ${stat.size.toLocaleString()} bytes`);

  const buf = fs.readFileSync(targetPath);
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex').toLowerCase();
  console.log(`SHA-256:       ${sha256}`);

  const isHashMatch = (sha256 === EXPECTED_M318_PATCH_SHA256);
  if (isHashMatch) {
    console.log(`[PASS] Production hash matches verified 1M+960k checkpoint configuration`);
  } else {
    console.log(`[WARN] Hash differs from reference production build (${EXPECTED_M318_PATCH_SHA256})`);
  }

  console.log('\n--- 6-SITE PATCH VERIFICATION ---');
  let allSitesPass = true;

  // 1. Engine Clamp CMP
  const site1Imm = buf.readUInt32LE(SITES.ENGINE_PATCH_1.offset);
  const site1Pass = (site1Imm === SITES.ENGINE_PATCH_1.expectedLE);
  console.log(`[${site1Pass ? 'PASS' : 'FAIL'}] Site 1 (ENGINE_PATCH_1): ${site1Imm.toLocaleString()} tokens (${SITES.ENGINE_PATCH_1.description})`);
  if (!site1Pass) allSitesPass = false;

  // 2. Engine Clamp MOV
  const site2Imm = buf.readUInt32LE(SITES.ENGINE_PATCH_2.offset);
  const site2Pass = (site2Imm === SITES.ENGINE_PATCH_2.expectedLE);
  console.log(`[${site2Pass ? 'PASS' : 'FAIL'}] Site 2 (ENGINE_PATCH_2): ${site2Imm.toLocaleString()} tokens (${SITES.ENGINE_PATCH_2.description})`);
  if (!site2Pass) allSitesPass = false;

  // 3. M318 Hook
  const m318HookHex = buf.subarray(SITES.M318_HOOK.offset, SITES.M318_HOOK.offset + 11).toString('hex').toUpperCase();
  const m318HookPass = (m318HookHex === SITES.M318_HOOK.expectedHex);
  console.log(`[${m318HookPass ? 'PASS' : 'FAIL'}] Site 3 (M318_HOOK): ${SITES.M318_HOOK.description}`);
  if (!m318HookPass) allSitesPass = false;

  // 4. M318 Code Cave
  // Verify mov dword ptr [rax+0x14], 0x000F4240 (1,000,000)
  const caveOffset = SITES.M318_CODE_CAVE.offset;
  const caveSub = buf.subarray(caveOffset, caveOffset + 32);
  const has1M = caveSub.includes(Buffer.from([0x40, 0x42, 0x0F, 0x00])); // 0xF4240
  const hasKey1318 = caveSub.includes(Buffer.from([0x26, 0x05, 0x00, 0x00])); // 0x526
  const cavePass = has1M && hasKey1318;
  console.log(`[${cavePass ? 'PASS' : 'FAIL'}] Site 4 (M318_CODE_CAVE): Runtime limit 1,000,000 tokens for key 1318`);
  if (!cavePass) allSitesPass = false;

  // 5. Checkpoint Hook
  const cpHookHex = buf.subarray(SITES.CHECKPOINT_M318_HOOK.offset, SITES.CHECKPOINT_M318_HOOK.offset + 14).toString('hex').toUpperCase();
  const cpHookPass = (cpHookHex === SITES.CHECKPOINT_M318_HOOK.expectedHex);
  console.log(`[${cpHookPass ? 'PASS' : 'FAIL'}] Site 5 (CHECKPOINT_M318_HOOK): ${SITES.CHECKPOINT_M318_HOOK.description}`);
  if (!cpHookPass) allSitesPass = false;

  // 6. Checkpoint Code Cave
  const cpCaveOffset = SITES.CHECKPOINT_M318_CODE_CAVE.offset;
  const cpCaveSub = buf.subarray(cpCaveOffset, cpCaveOffset + 50);
  const has960k = cpCaveSub.includes(Buffer.from([0x00, 0xA6, 0x0E, 0x00])); // 0xEA600 = 960,000
  const hasCpKey1318 = cpCaveSub.includes(Buffer.from([0x26, 0x05, 0x00, 0x00])); // 0x526
  const cpCavePass = has960k && hasCpKey1318;
  console.log(`[${cpCavePass ? 'PASS' : 'FAIL'}] Site 6 (CHECKPOINT_M318_CODE_CAVE): Checkpoint threshold 960,000 tokens for key 1318`);
  if (!cpCavePass) allSitesPass = false;

  console.log('\n--- VERIFICATION RESULT ---');
  if (allSitesPass && isHashMatch) {
    console.log('STATUS: FULLY VERIFIED (All 6 patch sites and production SHA match expected 1M/960k configuration)');
    process.exit(0);
  } else if (allSitesPass) {
    console.log('STATUS: FUNCTIONALLY VERIFIED (All 6 patch sites valid; alternate compatible hash)');
    process.exit(0);
  } else {
    console.error('STATUS: VERIFICATION FAILED (One or more patch sites did not match specification)');
    process.exit(1);
  }
}

main();
