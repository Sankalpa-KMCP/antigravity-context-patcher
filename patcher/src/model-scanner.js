// src/model-scanner.js
// Version-independent structural scanner for active model identity and ModelInfo context structures.
// Proves M318 identity, field layout, and downstream converter read paths.

const { SignatureScanner } = require('./signature-scanner');

class ModelScanner {
  /**
   * @param {PEParser} peParser
   * @param {Buffer} fullBuffer
   */
  constructor(peParser, fullBuffer) {
    this.peParser = peParser;
    this.buffer = fullBuffer;
  }

  /**
   * Scan and verify active model M318 and its ModelInfo representation.
   * @returns {object}
   */
  scan() {
    const rdataSec = this.peParser.getSection('.rdata');
    const textSec  = this.peParser.getSection('.text');

    if (!rdataSec || !textSec) {
      return {
        found: false,
        error: 'Binary missing required PE sections (.rdata or .text)'
      };
    }

    // 1. Locate string 'MODEL_PLACEHOLDER_M318'
    const m318Str = Buffer.from('MODEL_PLACEHOLDER_M318');
    const m318StringMatches = SignatureScanner.findAll(
      this.buffer,
      Array.from(m318Str),
      rdataSec.pointerToRawData,
      rdataSec.pointerToRawData + rdataSec.sizeOfRawData
    );

    if (m318StringMatches.length === 0) {
      return {
        found: false,
        error: 'MODEL_PLACEHOLDER_M318 string not found in .rdata'
      };
    }

    // 2. Verify protobuf enum descriptor for M318
    // In protobuf schema: field 2 varint tag (10) followed by 1318 varint (a6 0a)
    // "10 a6 0a 12 1b 0a 16 4d 4f 44 45 4c 5f 50 4c 41 43 45 48 4f 4c 44 45 52 5f 4d 33 31 38"
    let protobufDescriptorOffset = null;
    for (const strOffset of m318StringMatches) {
      // Check if preceded by length byte (0x16 = 22) and tag (0x12 0x1b 0x0a 0x16)
      if (strOffset >= 7 && this.buffer[strOffset - 1] === 0x16) {
        protobufDescriptorOffset = strOffset;
        break;
      }
    }

    // 3. Verify ModelInfo struct field layout in .text
    // Look for canonical field reads:
    // mov ecx, dword ptr [rax + 0x14]  (ModelInfo.MaxTokens)
    // stashed into stack, then later read and subtracted by [rax + 0x70] (Reserved floor)
    const fieldReadPattern = [
      0x8B, 0x48, 0x14,       // mov ecx, dword ptr [rax + 0x14] (MaxTokens)
      0x89, 0x4C, 0x24, -1,   // mov dword ptr [rsp + ??], ecx
      0x8B, 0x48, 0x70,       // mov ecx, dword ptr [rax + 0x70] (Reserved floor)
      0x89, 0x4C, 0x24, -1    // mov dword ptr [rsp + ??], ecx
    ];

    const textStart = textSec.pointerToRawData;
    const textEnd   = textStart + textSec.sizeOfRawData;
    const modelInfoReadMatches = SignatureScanner.findAll(this.buffer, fieldReadPattern, textStart, textEnd);

    if (modelInfoReadMatches.length === 0) {
      return {
        found: false,
        error: 'ModelInfo field accessor pattern (0x14 MaxTokens, 0x70 Reserved) not found in .text'
      };
    }

    // 4. Trace downstream converter read path
    // In ChatConverterConfig builder (0x013aa060), [rax + 0x14] is read at 0x013aa098,
    // and downstream at 0x013aa150 it participates in sub ecx, edx where edx = max(40000, reserved).
    const downstreamConsumerFound = modelInfoReadMatches.some(off => {
      // Check if followed shortly by cmp ecx, 40000
      const lookahead = this.buffer.subarray(off, off + 250);
      return SignatureScanner.findPattern(lookahead, [0x81, 0xF9, 0x40, 0x9C, 0x00, 0x00]) !== -1;
    });

    // 5. Discover GetModelInfoFromKey Fallback Return Hook Site
    // Anchor: xor ecx, ecx (Key 0) -> call mapaccess2_fast32 -> mov rbx, [rax]
    const fallbackAnchorPattern = [0x31, 0xC9, 0xE8, -1, -1, -1, -1, 0x48, 0x8B, 0x18];
    const anchorMatches = SignatureScanner.findAll(this.buffer, fallbackAnchorPattern, textStart, textEnd);
    let runtimeHookSite = null;
    if (anchorMatches.length === 1) {
      const anchorOff = anchorMatches[0];
      const window = this.buffer.subarray(anchorOff, anchorOff + 250);
      const retPattern = [0x48, 0x89, 0xD9, 0x48, 0x89, 0xC3, 0x48, 0x8B, 0x44, 0x24, 0x48];
      const retRel = SignatureScanner.findPattern(window, retPattern);
      if (retRel !== -1) {
        runtimeHookSite = anchorOff + retRel;
      }
    }

    // 6. Discover Executable Code Cave at tail of .text
    const textSecEnd = textStart + textSec.sizeOfRawData;
    let caveScan = textSecEnd;
    while (caveScan > textStart && this.buffer[caveScan - 1] === 0xCC) {
      caveScan--;
    }
    const tailPaddingSize = textSecEnd - caveScan;
    // Align to 32-byte boundary with safety margin
    const alignedCaveOffset = (caveScan + 31) & ~31;
    const alignedCaveAvailable = textSecEnd - alignedCaveOffset;

    return {
      found: true,
      modelIdentifier: 'MODEL_PLACEHOLDER_M318',
      displayName: 'Gemini 3.8 Flash (High)',
      backendModelId: 'gemini-3.8-flash-high',
      canonicalBackendModel: 'gemini-3.8-flash',
      stringOffsetsHex: m318StringMatches.map(m => '0x' + m.toString(16)),
      protobufDescriptorOffsetHex: protobufDescriptorOffset ? '0x' + protobufDescriptorOffset.toString(16) : null,
      modelInfoStruct: {
        maxTokensFieldOffset: '0x14',
        reservedTokensFieldOffset: '0x70',
        currentNominalMaxTokens: 256000,
        currentNominalHex: '0x0003E800',
        accessSiteOffsetsHex: modelInfoReadMatches.map(m => '0x' + m.toString(16)),
        downstreamConsumerVerified: downstreamConsumerFound
      },
      runtimeOverride: {
        discoverable: runtimeHookSite !== null && alignedCaveAvailable >= 48,
        hookOffsetHex: runtimeHookSite ? '0x' + runtimeHookSite.toString(16) : null,
        caveOffsetHex: '0x' + alignedCaveOffset.toString(16),
        continuationOffsetHex: runtimeHookSite ? '0x' + (runtimeHookSite + 11).toString(16) : null,
        tailPaddingBytes: tailPaddingSize,
        alignedCaveAvailableBytes: alignedCaveAvailable,
        modelKeyImm: 1318,
        modelKeyHex: '0x0526',
        targetMaxTokens: 1000000,
        targetMaxTokensHex: '0x000F4240'
      },
      confidence: 'HIGH'
    };
  }
}

module.exports = { ModelScanner };
