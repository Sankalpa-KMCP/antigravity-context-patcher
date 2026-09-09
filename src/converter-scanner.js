// src/converter-scanner.js
// Version-independent structural scanner for Antigravity's TrajectoryChatConverter clamp.
// Discovers the semantic sequence:
//   reserved = max(40000, configuredReserve)
//   available = ModelInfo.MaxTokens - reserved
//   converter = min(available, EngineClamp)

const { SignatureScanner } = require('./signature-scanner');

class ConverterScanner {
  /**
   * @param {PEParser} peParser
   * @param {Buffer} [fullBuffer] Pre-loaded full binary Buffer
   */
  constructor(peParser, fullBuffer = null) {
    this.peParser = peParser;
    this.buffer = fullBuffer;
  }

  /**
   * Scan the binary for the unique TrajectoryChatConverter clamp sequence.
   * @returns {object} Scan result and site offsets.
   */
  scan() {
    const textSec = this.peParser.getSection('.text');
    if (!textSec) {
      return {
        found: false,
        error: 'PE is missing .text section'
      };
    }

    const textStart = textSec.pointerToRawData;
    const textSize = textSec.sizeOfRawData;
    const textEnd = textStart + textSize;

    // Semantic signature:
    // 81 F9 40 9C 00 00  ; cmp ecx, 40000
    // BA 40 9C 00 00     ; mov edx, 40000
    // 0F 4F D1           ; cmovg edx, ecx
    // 8B 4C 24 ??        ; mov ecx, [rsp + ??]
    // 29 D1              ; sub ecx, edx
    // 81 F9 ?? ?? ?? ??  ; cmp ecx, imm32 (Site 1)
    // BA ?? ?? ?? ??     ; mov edx, imm32 (Site 2)
    // 0F 42 D1           ; cmovb edx, ecx (Post-clamp)
    // 89 54 24 ??        ; mov [rsp + ??], edx
    const semanticPattern = [
      0x81, 0xF9, 0x40, 0x9C, 0x00, 0x00, // cmp ecx, 40000
      0xBA, 0x40, 0x9C, 0x00, 0x00,       // mov edx, 40000
      0x0F, 0x4F, 0xD1,                   // cmovg edx, ecx
      0x8B, 0x4C, 0x24, -1,               // mov ecx, [rsp + offset]
      0x29, 0xD1,                         // sub ecx, edx
      0x81, 0xF9, -1, -1, -1, -1,         // cmp ecx, imm32 (Site 1)
      0xBA, -1, -1, -1, -1,               // mov edx, imm32 (Site 2)
      0x0F, 0x42, 0xD1,                   // cmovb edx, ecx
      0x89, 0x54, 0x24                    // mov [rsp + offset], edx
    ];

    const result = SignatureScanner.findUnique(this.buffer, semanticPattern, textStart, textEnd);

    if (!result.unique) {
      return {
        found: false,
        count: result.count,
        error: result.error || 'Failed uniqueness constraint'
      };
    }

    const anchorOffset = result.offset;

    // Calculate exact offsets within the matched block
    // anchorOffset + 0: 81 F9 40 9C 00 00 (6 bytes)
    // anchorOffset + 6: BA 40 9C 00 00    (5 bytes)
    // anchorOffset + 11: 0F 4F D1         (3 bytes)
    // anchorOffset + 14: 8B 4C 24 ??      (4 bytes)
    // anchorOffset + 18: 29 D1            (2 bytes)
    // anchorOffset + 20: 81 F9 ?? ?? ?? ?? (Site 1 opcode at +20, imm at +22)
    // anchorOffset + 26: BA ?? ?? ?? ??    (Site 2 opcode at +26, imm at +27)
    // anchorOffset + 31: 0F 42 D1          (Post-clamp cmovb at +31)
    // anchorOffset + 34: 89 54 24 ??       (mov [rsp + ??], edx at +34)

    const site1OpcodeOffset = anchorOffset + 20;
    const site1ImmOffset    = anchorOffset + 22;
    const site2OpcodeOffset = anchorOffset + 26;
    const site2ImmOffset    = anchorOffset + 27;
    const postClampOffset   = anchorOffset + 31;
    const storeOffset       = anchorOffset + 34;

    const imm1 = this.buffer.readUInt32LE(site1ImmOffset);
    const imm2 = this.buffer.readUInt32LE(site2ImmOffset);

    // Consistency verification
    if (imm1 !== imm2) {
      return {
        found: false,
        error: `Engine clamp sites disagree: Site 1 = ${imm1}, Site 2 = ${imm2}`
      };
    }

    const cmov0 = this.buffer[postClampOffset];
    const cmov1 = this.buffer[postClampOffset + 1];
    const cmov2 = this.buffer[postClampOffset + 2];
    const hasCmovb = (cmov0 === 0x0F && cmov1 === 0x42 && cmov2 === 0xD1);

    if (!hasCmovb) {
      return {
        found: false,
        error: `cmovb instruction missing at post-clamp offset 0x${postClampOffset.toString(16)}`
      };
    }

    const reserveFloor = this.buffer.readUInt32LE(anchorOffset + 2); // 40000

    return {
      found: true,
      anchorOffsetHex: '0x' + anchorOffset.toString(16),
      reserveFloor,
      site1: {
        opcodeOffsetHex: '0x' + site1OpcodeOffset.toString(16),
        immOffsetHex: '0x' + site1ImmOffset.toString(16),
        currentValue: imm1,
        immBytesHex: this.buffer.subarray(site1ImmOffset, site1ImmOffset + 4).toString('hex').toUpperCase().match(/../g).join(' '),
        instructionHex: this.buffer.subarray(site1OpcodeOffset, site1OpcodeOffset + 6).toString('hex').toUpperCase().match(/../g).join(' '),
        instructionAsm: `cmp ecx, 0x${imm1.toString(16)}`
      },
      site2: {
        opcodeOffsetHex: '0x' + site2OpcodeOffset.toString(16),
        immOffsetHex: '0x' + site2ImmOffset.toString(16),
        currentValue: imm2,
        immBytesHex: this.buffer.subarray(site2ImmOffset, site2ImmOffset + 4).toString('hex').toUpperCase().match(/../g).join(' '),
        instructionHex: this.buffer.subarray(site2OpcodeOffset, site2OpcodeOffset + 5).toString('hex').toUpperCase().match(/../g).join(' '),
        instructionAsm: `mov edx, 0x${imm2.toString(16)}`
      },
      postClamp: {
        offsetHex: '0x' + postClampOffset.toString(16),
        instructionHex: this.buffer.subarray(postClampOffset, postClampOffset + 3).toString('hex').toUpperCase(),
        instructionAsm: 'cmovb edx, ecx',
        verified: true
      },
      currentEngineClamp: imm1,
      semanticSequenceVerified: true
    };
  }
}

module.exports = { ConverterScanner };
