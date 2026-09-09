// src/pe-parser.js
// Standalone 64-bit PE (PE32+) parser for language_server_windows_x64.exe.
// Resolves sections, RVAs, and raw file offsets without external dependencies.

const fs = require('fs');

class PEParser {
  /**
   * @param {string|Buffer} source File path string or pre-loaded Buffer
   */
  constructor(source) {
    if (typeof source === 'string') {
      this.filePath = source;
      this.buffer = null;
    } else if (Buffer.isBuffer(source)) {
      this.filePath = null;
      this.buffer = source;
    } else {
      throw new Error('PEParser requires a file path string or Buffer');
    }

    this.isParsed = false;
    this.dosHeader = null;
    this.fileHeader = null;
    this.optionalHeader = null;
    this.sections = [];
  }

  /**
   * Parse the PE file structure.
   */
  parse() {
    let buf = this.buffer;
    let fd;

    try {
      if (!buf) {
        fd = fs.openSync(this.filePath, 'r');
        // Read header block (first 4KB covers DOS, PE header, and section table)
        buf = Buffer.alloc(0x1000);
        fs.readSync(fd, buf, 0, 0x1000, 0);
      }

      // 1. DOS Header
      if (buf.length < 0x40 || buf.readUInt16BE(0) !== 0x4D5A) { // 'MZ'
        throw new Error('Invalid DOS header signature (expected MZ)');
      }

      const e_lfanew = buf.readUInt32LE(0x3C);
      this.dosHeader = { e_magic: 'MZ', e_lfanew };

      // 2. PE Signature
      if (buf.length < e_lfanew + 4 || buf.readUInt32LE(e_lfanew) !== 0x00004550) { // 'PE\0\0'
        throw new Error('Invalid PE signature (expected PE\\0\\0)');
      }

      // 3. COFF File Header (20 bytes at e_lfanew + 4)
      const fhOffset = e_lfanew + 4;
      const machine = buf.readUInt16LE(fhOffset);
      const numberOfSections = buf.readUInt16LE(fhOffset + 2);
      const timeDateStamp = buf.readUInt32LE(fhOffset + 4);
      const sizeOfOptionalHeader = buf.readUInt16LE(fhOffset + 16);
      const characteristics = buf.readUInt16LE(fhOffset + 18);

      this.fileHeader = {
        machine,
        isX64: machine === 0x8664,
        numberOfSections,
        timeDateStamp,
        sizeOfOptionalHeader,
        characteristics
      };

      if (!this.fileHeader.isX64) {
        throw new Error(`Unsupported PE machine architecture: 0x${machine.toString(16)} (expected x64: 0x8664)`);
      }

      // 4. Optional Header (PE32+ 64-bit)
      const optOffset = fhOffset + 20;
      const magic = buf.readUInt16LE(optOffset);
      if (magic !== 0x020B) { // PE32+
        throw new Error(`Expected PE32+ optional header magic 0x20B, got 0x${magic.toString(16)}`);
      }

      const entryPointRva = buf.readUInt32LE(optOffset + 16);
      const imageBase = buf.readBigUInt64LE(optOffset + 24);
      const sectionAlignment = buf.readUInt32LE(optOffset + 32);
      const fileAlignment = buf.readUInt32LE(optOffset + 36);
      const sizeOfImage = buf.readUInt32LE(optOffset + 56);
      const sizeOfHeaders = buf.readUInt32LE(optOffset + 60);

      this.optionalHeader = {
        magic,
        entryPointRva,
        imageBase,
        sectionAlignment,
        fileAlignment,
        sizeOfImage,
        sizeOfHeaders
      };

      // 5. Section Table (NumberOfSections entries of 40 bytes each)
      const sectionTableOffset = optOffset + sizeOfOptionalHeader;
      this.sections = [];

      for (let i = 0; i < numberOfSections; i++) {
        const sOffset = sectionTableOffset + i * 40;
        const nameRaw = buf.subarray(sOffset, sOffset + 8);
        const name = nameRaw.toString('utf8').replace(/\0/g, '');
        const virtualSize = buf.readUInt32LE(sOffset + 8);
        const virtualAddress = buf.readUInt32LE(sOffset + 12);
        const sizeOfRawData = buf.readUInt32LE(sOffset + 16);
        const pointerToRawData = buf.readUInt32LE(sOffset + 20);
        const characteristicsSec = buf.readUInt32LE(sOffset + 36);

        this.sections.push({
          index: i,
          name,
          virtualSize,
          virtualAddress,
          sizeOfRawData,
          pointerToRawData,
          characteristics: characteristicsSec
        });
      }

      this.isParsed = true;
      return this;
    } finally {
      if (fd !== undefined) {
        try { fs.closeSync(fd); } catch (_) {}
      }
    }
  }

  /**
   * Convert Relative Virtual Address (RVA) to file offset.
   * @param {number} rva
   * @returns {number|null}
   */
  rvaToFileOffset(rva) {
    if (!this.isParsed) this.parse();
    for (const sec of this.sections) {
      if (rva >= sec.virtualAddress && rva < sec.virtualAddress + sec.virtualSize) {
        return sec.pointerToRawData + (rva - sec.virtualAddress);
      }
    }
    return null;
  }

  /**
   * Convert raw file offset to Relative Virtual Address (RVA).
   * @param {number} fileOffset
   * @returns {number|null}
   */
  fileOffsetToRva(fileOffset) {
    if (!this.isParsed) this.parse();
    for (const sec of this.sections) {
      if (fileOffset >= sec.pointerToRawData && fileOffset < sec.pointerToRawData + sec.sizeOfRawData) {
        return sec.virtualAddress + (fileOffset - sec.pointerToRawData);
      }
    }
    return null;
  }

  /**
   * Retrieve section by name (e.g. '.text', '.rdata').
   * @param {string} name
   */
  getSection(name) {
    if (!this.isParsed) this.parse();
    return this.sections.find(s => s.name === name) || null;
  }

  /**
   * Return a summary object of the parsed PE headers.
   */
  getSummary() {
    if (!this.isParsed) this.parse();
    return {
      machine: 'x64',
      imageBase: '0x' + this.optionalHeader.imageBase.toString(16),
      sectionCount: this.sections.length,
      sections: this.sections.map(s => ({
        name: s.name,
        rva: '0x' + s.virtualAddress.toString(16),
        virtualSize: s.virtualSize,
        rawOffset: '0x' + s.pointerToRawData.toString(16),
        rawSize: s.sizeOfRawData
      }))
    };
  }
}

module.exports = { PEParser };
