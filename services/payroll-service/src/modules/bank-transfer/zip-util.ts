/**
 * Minimal ZIP archive builder using Node.js built-in zlib.
 * Produces a valid ZIP file (PKZIP 2.0 compatible) in memory.
 * No external dependencies required.
 */
import { deflateRawSync } from "node:zlib";

interface ZipEntry {
  content: string;
  filename: string;
}

/**
 * Create a ZIP buffer in memory from an array of text entries.
 * Uses DEFLATE compression (method 8) via Node.js built-in zlib.
 */
export function createZipBuffer(entries: ZipEntry[]): Buffer {
  const localHeaders: Buffer[] = [];
  const centralHeaders: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const fileNameBuf = Buffer.from(entry.filename, "utf-8");
    const contentBuf = Buffer.from(entry.content, "ascii");
    const compressedBuf = deflateRawSync(contentBuf, { level: 6 });
    const crc = crc32(contentBuf);

    // Local file header (30 bytes + filename + compressed data)
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);  // Local file header signature
    localHeader.writeUInt16LE(20, 4);           // Version needed (2.0)
    localHeader.writeUInt16LE(0, 6);            // General purpose flags
    localHeader.writeUInt16LE(8, 8);            // Compression method: DEFLATE
    localHeader.writeUInt16LE(0, 10);           // Last mod time
    localHeader.writeUInt16LE(0, 12);           // Last mod date
    localHeader.writeUInt32LE(crc, 14);         // CRC-32
    localHeader.writeUInt32LE(compressedBuf.length, 18); // Compressed size
    localHeader.writeUInt32LE(contentBuf.length, 22);    // Uncompressed size
    localHeader.writeUInt16LE(fileNameBuf.length, 26);   // Filename length
    localHeader.writeUInt16LE(0, 28);           // Extra field length

    localHeaders.push(localHeader, fileNameBuf, compressedBuf);

    // Central directory header (46 bytes + filename)
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);  // Central dir signature
    centralHeader.writeUInt16LE(20, 4);           // Version made by
    centralHeader.writeUInt16LE(20, 6);           // Version needed
    centralHeader.writeUInt16LE(0, 8);            // General purpose flags
    centralHeader.writeUInt16LE(8, 10);           // Compression method
    centralHeader.writeUInt16LE(0, 12);           // Last mod time
    centralHeader.writeUInt16LE(0, 14);           // Last mod date
    centralHeader.writeUInt32LE(crc, 16);         // CRC-32
    centralHeader.writeUInt32LE(compressedBuf.length, 20); // Compressed size
    centralHeader.writeUInt32LE(contentBuf.length, 24);    // Uncompressed size
    centralHeader.writeUInt16LE(fileNameBuf.length, 28);   // Filename length
    centralHeader.writeUInt16LE(0, 30);           // Extra field length
    centralHeader.writeUInt16LE(0, 32);           // File comment length
    centralHeader.writeUInt16LE(0, 34);           // Disk number start
    centralHeader.writeUInt16LE(0, 36);           // Internal file attributes
    centralHeader.writeUInt32LE(0, 38);           // External file attributes
    centralHeader.writeUInt32LE(offset, 42);      // Relative offset of local header

    centralHeaders.push(centralHeader, fileNameBuf);

    offset += 30 + fileNameBuf.length + compressedBuf.length;
  }

  // End of central directory record (22 bytes)
  const centralDirSize = centralHeaders.reduce((sum, buf) => sum + buf.length, 0);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);         // End of central dir signature
  endRecord.writeUInt16LE(0, 4);                   // Disk number
  endRecord.writeUInt16LE(0, 6);                   // Central dir start disk
  endRecord.writeUInt16LE(entries.length, 8);      // Entries on this disk
  endRecord.writeUInt16LE(entries.length, 10);     // Total entries
  endRecord.writeUInt32LE(centralDirSize, 12);     // Central dir size
  endRecord.writeUInt32LE(offset, 16);             // Central dir offset
  endRecord.writeUInt16LE(0, 20);                  // Comment length

  return Buffer.concat([...localHeaders, ...centralHeaders, endRecord]);
}

/**
 * CRC-32 computation (ISO 3309 / ITU-T V.42 polynomial).
 */
function crc32(buf: Buffer): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i]!;
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
