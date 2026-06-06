import { inflateRawSync } from 'node:zlib';

const localFileHeaderSignature = 0x04034b50;
const centralDirectorySignature = 0x02014b50;
const endOfCentralDirectorySignature = 0x06054b50;
const zip64Sentinel = 0xffffffff;

export function isZipBuffer(buffer) {
  return buffer?.length >= 4
    && buffer[0] === 0x50
    && buffer[1] === 0x4b
    && buffer[2] === 0x03
    && buffer[3] === 0x04;
}

export function extractZipEntries(buffer) {
  if (!isZipBuffer(buffer)) return [];

  const directory = findEndOfCentralDirectory(buffer);
  const entries = [];
  let offset = directory.centralDirectoryOffset;

  for (let index = 0; index < directory.entryCount; index += 1) {
    assertSignature(buffer, offset, centralDirectorySignature, 'central directory header');
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const fileNameStart = offset + 46;
    const fileNameEnd = fileNameStart + fileNameLength;
    const name = buffer.toString('utf8', fileNameStart, fileNameEnd);

    offset = fileNameEnd + extraLength + commentLength;

    if (!name || name.endsWith('/') || name.startsWith('__MACOSX/')) continue;
    if (compressedSize === zip64Sentinel || uncompressedSize === zip64Sentinel || localHeaderOffset === zip64Sentinel) {
      throw new Error(`ZIP entry ${name} uses ZIP64 metadata, which is not supported.`);
    }

    assertSignature(buffer, localHeaderOffset, localFileHeaderSignature, `local file header for ${name}`);
    const localFileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buffer.length) throw new Error(`ZIP entry ${name} extends beyond the archive.`);

    const compressed = buffer.subarray(dataStart, dataEnd);
    const content = decompressZipEntry(compressed, compressionMethod, name);
    if (content.length !== uncompressedSize) {
      throw new Error(`ZIP entry ${name} has an unexpected uncompressed size.`);
    }
    entries.push({ name, content });
  }

  return entries;
}

function findEndOfCentralDirectory(buffer) {
  const minOffset = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) !== endOfCentralDirectorySignature) continue;
    return {
      entryCount: buffer.readUInt16LE(offset + 10),
      centralDirectorySize: buffer.readUInt32LE(offset + 12),
      centralDirectoryOffset: buffer.readUInt32LE(offset + 16)
    };
  }
  throw new Error('ZIP archive is missing an end-of-central-directory record.');
}

function assertSignature(buffer, offset, signature, label) {
  if (offset < 0 || offset + 4 > buffer.length || buffer.readUInt32LE(offset) !== signature) {
    throw new Error(`Invalid ZIP ${label}.`);
  }
}

function decompressZipEntry(buffer, compressionMethod, name) {
  if (compressionMethod === 0) return Buffer.from(buffer);
  if (compressionMethod === 8) return inflateRawSync(buffer);
  throw new Error(`ZIP entry ${name} uses unsupported compression method ${compressionMethod}.`);
}
