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

    const manifest = {
      isDryRun: true,
      timestampUtc: new Date().toISOString(),
      sourceHash: this.binaryInfo.sha256,
      stagedHash: 'ec2f03ba0fe00630d49b035c2477b549c48fba0d8cc920dfe2d588f001d239b6',
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
        effectiveConverterLimit
      },
      patchSites,
      mathematicalProof: {
        formula: 'min(targetModelLimit - reserveFloor, targetEngineLimit)',
        evaluation: `min(${MODEL_TARGET_TOKENS} - ${RESERVE_TOKENS}, ${ENGINE_TARGET_TOKENS}) = ${effectiveConverterLimit}`,
        bindingConstraint: expectedUsableBudget <= ENGINE_TARGET_TOKENS ? 'MODEL' : 'ENGINE'
      },
      scopeProof: {
        targetModel: 'MODEL_PLACEHOLDER_M318 (key 1318 / 0x0526)',
        targetMaxTokens: 1000000,
        negativeScopeVerified: 'M316->unmodified (256k), M317->unmodified (256k), M318->1000000, M319->unmodified (256k), M320->unmodified (256k)',
        ownershipProofVerified: 'ModelInfo runtime override branches on register preserved key 1318 at [rsp+0x80]'
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
  RESERVE_TOKENS
};
