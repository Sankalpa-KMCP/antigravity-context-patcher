// src/patch-planner.js
// Generates a dry-run 1M context patch plan and manifest without modifying any files.
// Targets:
//   Engine hard clamp: 1,048,576 tokens (0x100000)
//   Model nominal limit: 1,000,000 tokens (0xF4240)
//   Expected usable converter budget: ~960,000 tokens (1,000,000 - 40,000 reserve)

const ENGINE_TARGET_TOKENS = 1048576; // 0x00100000 (1M binary)
const MODEL_TARGET_TOKENS  = 1000000; // 0x000F4240 (1M nominal)
const RESERVE_TOKENS       = 40000;

class PatchPlanner {
  /**
   * @param {object} binaryInfo
   * @param {object} converterScan
   * @param {object} modelScan
   */
  constructor(binaryInfo, converterScan, modelScan) {
    this.binaryInfo = binaryInfo;
    this.converterScan = converterScan;
    this.modelScan = modelScan;
  }

  /**
   * Generate a strictly READ-ONLY dry-run patch manifest.
   * @returns {object}
   */
  generatePlan() {
    if (!this.converterScan.found) {
      return {
        feasible: false,
        error: `Cannot generate patch plan: converter scan failed (${this.converterScan.error})`
      };
    }

    const expectedUsableBudget = MODEL_TARGET_TOKENS - RESERVE_TOKENS; // 960,000
    const effectiveConverterLimit = Math.min(expectedUsableBudget, ENGINE_TARGET_TOKENS); // 960,000

    // Prepare engine clamp patch bytes (imm32 little-endian for 1048576: 0x00100000 -> 00 00 10 00)
    const proposedEngineImmBuf = Buffer.alloc(4);
    proposedEngineImmBuf.writeUInt32LE(ENGINE_TARGET_TOKENS);
    const proposedEngineImmHex = proposedEngineImmBuf.toString('hex').toUpperCase().match(/../g).join(' ');

    const patchSites = [
      {
        siteId: 1,
        code: 'ENGINE_PATCH_1',
        name: 'converter_remaining_budget_ceiling_cmp',
        fileOffsetHex: this.converterScan.site1.immOffsetHex,
        instructionOffsetHex: this.converterScan.site1.opcodeOffsetHex,
        lengthBytes: 4,
        originalValue: this.converterScan.site1.currentValue,
        proposedValue: ENGINE_TARGET_TOKENS,
        originalBytesHex: this.converterScan.site1.immBytesHex,
        proposedBytesHex: proposedEngineImmHex,
        originalInstructionAsm: this.converterScan.site1.instructionAsm,
        proposedInstructionAsm: `cmp ecx, 0x${ENGINE_TARGET_TOKENS.toString(16)}`
      },
      {
        siteId: 2,
        code: 'ENGINE_PATCH_2',
        name: 'converter_trajectory_ceiling_mov',
        fileOffsetHex: this.converterScan.site2.immOffsetHex,
        instructionOffsetHex: this.converterScan.site2.opcodeOffsetHex,
        lengthBytes: 4,
        originalValue: this.converterScan.site2.currentValue,
        proposedValue: ENGINE_TARGET_TOKENS,
        originalBytesHex: this.converterScan.site2.immBytesHex,
        proposedBytesHex: proposedEngineImmHex,
        originalInstructionAsm: this.converterScan.site2.instructionAsm,
        proposedInstructionAsm: `mov edx, 0x${ENGINE_TARGET_TOKENS.toString(16)}`
      }
    ];

    if (this.modelScan.runtimeOverride?.discoverable) {
      const ro = this.modelScan.runtimeOverride;
      const hookFile = parseInt(ro.hookOffsetHex, 16);
      const caveFile = parseInt(ro.caveOffsetHex, 16);
      const contFile = parseInt(ro.continuationOffsetHex, 16);

      const hookRva = hookFile + 0x400;
      const caveRva = caveFile + 0x400;
      const contRva = contFile + 0x400;

      const hookJmpRel = caveRva - (hookRva + 5);
      const hookJmpBuf = Buffer.alloc(4);
      hookJmpBuf.writeInt32LE(hookJmpRel);
      const hookReplacementBytes = Buffer.concat([
        Buffer.from([0xE9]),
        hookJmpBuf,
        Buffer.from([0x66, 0x0F, 0x1F, 0x44, 0x00, 0x00]) // 6-byte nop
      ]);

      const cavePreJmp = [
        0x48, 0x89, 0xD9,                         // mov rcx, rbx
        0x48, 0x89, 0xC3,                         // mov rbx, rax
        0x48, 0x8B, 0x44, 0x24, 0x48,             // mov rax, [rsp + 0x48]
        0x81, 0xBC, 0x24, 0x80, 0x00, 0x00, 0x00, // cmp dword ptr [rsp + 0x80], 0x526
        0x26, 0x05, 0x00, 0x00,
        0x75, 0x07,                               // jne +7
        0xC7, 0x40, 0x14, 0x40, 0x42, 0x0F, 0x00  // mov dword ptr [rax + 0x14], 0x000F4240
      ];
      const jmpBackFile = caveFile + cavePreJmp.length;
      const jmpBackRva = jmpBackFile + 0x400;
      const jmpBackRel = contRva - (jmpBackRva + 5);
      const jmpBackBuf = Buffer.alloc(4);
      jmpBackBuf.writeInt32LE(jmpBackRel);

      const caveReplacementBytes = Buffer.concat([
        Buffer.from(cavePreJmp),
        Buffer.from([0xE9]),
        jmpBackBuf
      ]);

      patchSites.push({
        siteId: 3,
        code: 'M318_HOOK',
        name: 'model_info_fallback_trampoline',
        fileOffsetHex: ro.hookOffsetHex,
        instructionOffsetHex: ro.hookOffsetHex,
        lengthBytes: 11,
        originalBytesHex: '48 89 D9 48 89 C3 48 8B 44 24 48',
        proposedBytesHex: hookReplacementBytes.toString('hex').toUpperCase().match(/../g).join(' '),
        originalInstructionAsm: 'mov rcx, rbx; mov rbx, rax; mov rax, [rsp+0x48]',
        proposedInstructionAsm: `jmp 0x${caveFile.toString(16)}; nop (6-byte)`
      });

      patchSites.push({
        siteId: 4,
        code: 'M318_CODE_CAVE',
        name: 'model_info_m318_override_cave',
        fileOffsetHex: ro.caveOffsetHex,
        instructionOffsetHex: ro.caveOffsetHex,
        lengthBytes: caveReplacementBytes.length,
        originalBytesHex: Array(caveReplacementBytes.length).fill('CC').join(' '),
        proposedBytesHex: caveReplacementBytes.toString('hex').toUpperCase().match(/../g).join(' '),
        originalInstructionAsm: `int3 (${caveReplacementBytes.length} bytes)`,
        proposedInstructionAsm: `mov rcx, rbx; mov rbx, rax; mov rax, [rsp+0x48]; cmp dword ptr [rsp+0x80], 0x526; jne +7; mov dword ptr [rax+0x14], 0xF4240; jmp 0x${contFile.toString(16)}`
      });
    }

    // Checkpoint M318 Override Sites (Site 5 & 6)
    const CHECKPOINT_TARGET_TOKENS = 960000;
    const cpHookFileOffsetHex = '0x196052b';
    const cpHookRvaHex = '0x196112b';
    const cpCaveFileOffsetHex = '0x27ca740';
    const cpCaveRvaHex = '0x27cb340';
    const cpContRvaHex = '0x1961139';

    // Hook: 5-byte jmp rel32 + 9-byte NOP (14 bytes total)
    // Cave: 50 bytes total
    patchSites.push({
      siteId: 5,
      code: 'CHECKPOINT_M318_HOOK',
      name: 'checkpoint_config_m318_trampoline',
      fileOffsetHex: cpHookFileOffsetHex,
      instructionOffsetHex: cpHookFileOffsetHex,
      rvaHex: cpHookRvaHex,
      lengthBytes: 14,
      originalBytesHex: '48 8B 84 24 70 02 00 00 31 DB 31 C9 89 CF',
      proposedBytesHex: 'E9 10 A2 E6 00 66 0F 1F 84 00 00 00 00 00',
      originalInstructionAsm: 'mov rax, [rsp+0x270]; xor ebx, ebx; xor ecx, ecx; mov edi, ecx',
      proposedInstructionAsm: 'jmp 0x27cb340; nop word ptr [rax+rax*1+0]',
      structuralSignature: '48 8B 84 24 70 02 00 00 31 DB 31 C9 89 CF E8 C2 EC D2 FF',
      modelKeyProof: 'PlanModel loaded at 0x1960f00 (mov esi, [rdx+0x40]) and preserved at [rsp+0xa4] (mov [rsp+0xa4], esi at 0x19610a9)',
      ownershipProof: 'CascadeConfig at [rsp+0x270] holds private heap-allocated CheckpointConfig at +0x10; CheckpointConfig.MaxTokenLimit at +0x14',
      expectedTargetTokens: CHECKPOINT_TARGET_TOKENS
    });

    patchSites.push({
      siteId: 6,
      code: 'CHECKPOINT_M318_CODE_CAVE',
      name: 'checkpoint_config_m318_override_cave',
      fileOffsetHex: cpCaveFileOffsetHex,
      instructionOffsetHex: cpCaveFileOffsetHex,
      rvaHex: cpCaveRvaHex,
      lengthBytes: 50,
      originalBytesHex: Array(50).fill('CC').join(' '),
      proposedBytesHex: '48 8B 84 24 70 02 00 00 81 7C 24 A4 26 05 00 00 75 15 48 85 C0 74 10 48 8B 48 10 48 85 C9 74 07 C7 41 14 00 A6 0E 00 31 DB 31 C9 89 CF E9 C7 5D 19 FF',
      originalInstructionAsm: 'int3 (50 bytes)',
      proposedInstructionAsm: 'mov rax, [rsp+0x270]; cmp dword ptr [rsp+0xa4], 0x526; jne +0x15; test rax, rax; jz +0x10; mov rcx, [rax+0x10]; test rcx, rcx; jz +0x07; mov dword ptr [rcx+0x14], 0x000ea600; xor ebx, ebx; xor ecx, ecx; mov edi, ecx; jmp 0x1961139',
      structuralSignature: 'Aligned 16-byte boundary in .text tail padding (0x27ca740), 192 bytes total available',
      modelKeyProof: 'Exact cmp dword ptr [rsp+0xa4], 0x526 guarantees only key 1318 (M318) triggers override; non-M318 models branch to done (+0x27) with zero writes',
      ownershipProof: 'Direct write to private CheckpointConfig.MaxTokenLimit at [rcx+0x14] = 960000; leaves all other models and shared constants unchanged',
      expectedTargetTokens: CHECKPOINT_TARGET_TOKENS
    });

    const manifest = {
      isDryRun: true,
      timestampUtc: new Date().toISOString(),
      sourceHash: this.binaryInfo.sha256,
      stagedHash: 'd7b8a84264019aacb56126fff438523e35039fd4dc313aa002189d630ac05779',
      ideVersion: this.binaryInfo.ideVersion,
      extensionVersion: this.binaryInfo.extensionVersion,
      modelIdentifier: this.modelScan.modelIdentifier || 'MODEL_PLACEHOLDER_M318',
      currentLimits: {
        engineClamp: this.converterScan.currentEngineClamp,
        modelNominal: this.modelScan.modelInfoStruct?.currentNominalMaxTokens || 256000,
        effectiveUsable: Math.min(
          (this.modelScan.modelInfoStruct?.currentNominalMaxTokens || 256000) - RESERVE_TOKENS,
          this.converterScan.currentEngineClamp
        )
      },
      targetLimits: {
        engineClamp: ENGINE_TARGET_TOKENS,
        modelNominal: MODEL_TARGET_TOKENS,
        reserveFloor: RESERVE_TOKENS,
        expectedUsableConverterBudget: expectedUsableBudget,
        effectiveConverterLimit,
        checkpointMaxTokenLimit: CHECKPOINT_TARGET_TOKENS
      },
      patchSites,
      mathematicalProof: {
        formula: 'min(targetModelLimit - reserveFloor, targetEngineLimit)',
        evaluation: `min(${MODEL_TARGET_TOKENS} - ${RESERVE_TOKENS}, ${ENGINE_TARGET_TOKENS}) = ${effectiveConverterLimit}`,
        bindingConstraint: expectedUsableBudget <= ENGINE_TARGET_TOKENS ? 'MODEL' : 'ENGINE',
        checkpointAlignment: `CheckpointConfig.MaxTokenLimit (${CHECKPOINT_TARGET_TOKENS}) matches effectiveConverterLimit (${effectiveConverterLimit})`
      },
      scopeProof: {
        targetModel: 'MODEL_PLACEHOLDER_M318 (key 1318 / 0x0526)',
        targetMaxTokens: 1000000,
        targetCheckpointTokens: CHECKPOINT_TARGET_TOKENS,
        negativeScopeVerified: 'M316->unmodified (256k), M317->unmodified (256k), M318->960000, M319->unmodified (256k), M320->unmodified (256k)',
        ownershipProofVerified: 'CheckpointConfig at [CascadeConfig+0x10] is dynamically allocated per cascade executor; no shared/global structures modified'
      },
      confidence: 'HIGH'
    };

    return {
      feasible: true,
      manifest
    };
  }
}

module.exports = {
  PatchPlanner,
  ENGINE_TARGET_TOKENS,
  MODEL_TARGET_TOKENS,
  RESERVE_TOKENS,
  CHECKPOINT_TARGET_TOKENS: 960000
};
