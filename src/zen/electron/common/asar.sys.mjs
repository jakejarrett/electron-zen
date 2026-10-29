// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

/**
 * asar - Electron Archive format support for Gecko.
 *
 * Provides functionality to read, extract, and list contents of .asar archives.
 * The asar format is a simple archive format used by Electron applications.
 *
 * Format specification:
 * - 4 bytes: header size (little-endian uint32)
 * - 4 bytes: header object size (little-endian uint32)
 * - 4 bytes: header string size (little-endian uint32)
 * - 4 bytes: header string size repeated (little-endian uint32)
 * - N bytes: JSON header (describes file structure)
 * - Rest: file contents concatenated
 *
 * @module asar
 */

import { createLogger } from 'resource:///modules/electron/common/debug.sys.mjs';

const log = createLogger('asar');

/**
 * Read a 32-bit unsigned integer from a Uint8Array at the given offset (little-endian).
 * @param {Uint8Array} buffer - The buffer to read from
 * @param {number} offset - The offset to start reading
 * @returns {number}
 */
function readUInt32LE(buffer, offset) {
  return (
    buffer[offset] |
    (buffer[offset + 1] << 8) |
    (buffer[offset + 2] << 16) |
    (buffer[offset + 3] << 24)
  ) >>> 0;
}

/**
 * Write a 32-bit unsigned integer to a Uint8Array at the given offset (little-endian).
 * @param {Uint8Array} buffer - The buffer to write to
 * @param {number} offset - The offset to start writing
 * @param {number} value - The value to write
 */
function writeUInt32LE(buffer, offset, value) {
  buffer[offset] = value & 0xff;
  buffer[offset + 1] = (value >> 8) & 0xff;
  buffer[offset + 2] = (value >> 16) & 0xff;
  buffer[offset + 3] = (value >> 24) & 0xff;
}

/**
 * Parse the asar header from archive data.
 * @param {Uint8Array} data - The archive data
 * @returns {{ header: object, headerSize: number }} - Parsed header and total header size
 */
function parseHeader(data) {
  if (data.length < 16) {
    throw new Error('Invalid asar archive: file too small');
  }

  // Asar uses Chromium's Pickle format for the header
  // Header structure:
  // - 4 bytes: Pickle size (always 4 for the initial size field)
  // - 4 bytes: Header pickle size (includes the header info fields)
  // - 4 bytes: Header size 
  // - 4 bytes: JSON string size
  // - N bytes: JSON header string
  // - Padding to align to 4 bytes
  
  const pickleSize = readUInt32LE(data, 0);
  const headerPickleSize = readUInt32LE(data, 4);
  const headerInfoSize = readUInt32LE(data, 8);
  const jsonSize = readUInt32LE(data, 12);

  log.debug(`Pickle size: ${pickleSize}, Header pickle: ${headerPickleSize}, Header info: ${headerInfoSize}, JSON size: ${jsonSize}`);

  // The header data starts at offset 16 (after the 4 size fields)
  const jsonStart = 16;
  const totalHeaderSize = 8 + headerPickleSize; // 8 bytes for first two fields + pickle data

  if (data.length < jsonStart + jsonSize) {
    throw new Error('Invalid asar archive: header truncated');
  }

  // Extract and parse the JSON header
  const jsonBytes = data.slice(jsonStart, jsonStart + jsonSize);
  const decoder = new TextDecoder('utf-8');
  const jsonString = decoder.decode(jsonBytes);

  let header;
  try {
    header = JSON.parse(jsonString);
  } catch (e) {
    // Log the first part of the string for debugging
    log.error(`Failed to parse JSON. First 100 chars: ${jsonString.substring(0, 100)}`);
    throw new Error(
      `Invalid asar archive: failed to parse header JSON: ${e.message}`
    );
  }

  return { header, headerSize: totalHeaderSize };
}

/**
 * Recursively collect all files from the header structure.
 * @param {object} node - Current node in the header tree
 * @param {string} currentPath - Current path prefix
 * @param {Array} files - Array to collect file info
 */
function collectFiles(node, currentPath, files) {
  if (node.files) {
    for (const [name, entry] of Object.entries(node.files)) {
      const fullPath = currentPath ? `${currentPath}/${name}` : name;
      if (entry.files) {
        // Directory
        collectFiles(entry, fullPath, files);
      } else {
        // File
        files.push({
          path: fullPath,
          offset: entry.offset,
          size: entry.size,
          unpacked: entry.unpacked || false,
          executable: entry.executable || false,
          integrity: entry.integrity,
        });
      }
    }
  }
}

/**
 * Recursively collect all entries (files and directories) from the header.
 * @param {object} node - Current node in the header tree
 * @param {string} currentPath - Current path prefix
 * @param {Array} entries - Array to collect entries
 */
function collectEntries(node, currentPath, entries) {
  if (node.files) {
    for (const [name, entry] of Object.entries(node.files)) {
      const fullPath = currentPath ? `${currentPath}/${name}` : name;
      if (entry.files) {
        // Directory
        entries.push({ path: fullPath, isDirectory: true });
        collectEntries(entry, fullPath, entries);
      } else {
        // File
        entries.push({
          path: fullPath,
          isDirectory: false,
          size: entry.size,
          unpacked: entry.unpacked || false,
        });
      }
    }
  }
}

/**
 * Get a file entry from the header by path.
 * @param {object} header - The parsed header
 * @param {string} filePath - Path to the file
 * @returns {object|null} - File entry or null if not found
 */
function getFileEntry(header, filePath) {
  const parts = filePath.split('/').filter((p) => p);
  let current = header;

  for (let i = 0; i < parts.length; i++) {
    if (!current.files || !current.files[parts[i]]) {
      return null;
    }
    current = current.files[parts[i]];
  }

  // Return null if this is a directory (has files property)
  if (current.files) {
    return null;
  }

  return current;
}

/**
 * Get a directory entry from the header by path.
 * @param {object} header - The parsed header
 * @param {string} dirPath - Path to the directory
 * @returns {object|null} - Directory entry or null if not found
 */
function getDirEntry(header, dirPath) {
  if (!dirPath || dirPath === '/' || dirPath === '.') {
    return header;
  }

  const parts = dirPath.split('/').filter((p) => p);
  let current = header;

  for (const part of parts) {
    if (!current.files || !current.files[part]) {
      return null;
    }
    current = current.files[part];
  }

  return current.files ? current : null;
}

/**
 * Class representing an asar archive.
 */
export class AsarArchive {
  #path;
  #data;
  #header;
  #headerSize;

  /**
   * Create an AsarArchive instance.
   * @param {string} archivePath - Path to the asar file
   */
  constructor(archivePath) {
    this.#path = archivePath;
    this.#data = null;
    this.#header = null;
    this.#headerSize = 0;
  }

  /**
   * Load and parse the archive.
   * @returns {Promise<void>}
   */
  async load() {
    log.info(`Loading asar archive: ${this.#path}`);

    this.#data = await IOUtils.read(this.#path);
    const { header, headerSize } = parseHeader(this.#data);
    this.#header = header;
    this.#headerSize = headerSize;

    log.debug(`Loaded archive with ${this.listFiles().length} files`);
  }

  /**
   * Check if the archive is loaded.
   * @returns {boolean}
   */
  isLoaded() {
    return this.#header !== null;
  }

  /**
   * Get the path to the archive file.
   * @returns {string}
   */
  getPath() {
    return this.#path;
  }

  /**
   * List all files in the archive.
   * @returns {Array<{path: string, size: number, unpacked: boolean}>}
   */
  listFiles() {
    this.#ensureLoaded();
    const files = [];
    collectFiles(this.#header, '', files);
    return files;
  }

  /**
   * List all entries (files and directories) in the archive.
   * @returns {Array<{path: string, isDirectory: boolean, size?: number}>}
   */
  listEntries() {
    this.#ensureLoaded();
    const entries = [];
    collectEntries(this.#header, '', entries);
    return entries;
  }

  /**
   * Check if a file exists in the archive.
   * @param {string} filePath - Path to the file
   * @returns {boolean}
   */
  hasFile(filePath) {
    this.#ensureLoaded();
    return getFileEntry(this.#header, filePath) !== null;
  }

  /**
   * Check if a directory exists in the archive.
   * @param {string} dirPath - Path to the directory
   * @returns {boolean}
   */
  hasDirectory(dirPath) {
    this.#ensureLoaded();
    return getDirEntry(this.#header, dirPath) !== null;
  }

  /**
   * Get file info without reading the content.
   * @param {string} filePath - Path to the file
   * @returns {object|null} - File info or null
   */
  getFileInfo(filePath) {
    this.#ensureLoaded();
    const entry = getFileEntry(this.#header, filePath);
    if (!entry) return null;

    return {
      path: filePath,
      size: entry.size,
      unpacked: entry.unpacked || false,
      executable: entry.executable || false,
      integrity: entry.integrity,
    };
  }

  /**
   * Read a file from the archive as a Uint8Array.
   * @param {string} filePath - Path to the file
   * @returns {Uint8Array}
   */
  readFile(filePath) {
    this.#ensureLoaded();

    const entry = getFileEntry(this.#header, filePath);
    if (!entry) {
      throw new Error(`File not found in archive: ${filePath}`);
    }

    if (entry.unpacked) {
      throw new Error(
        `File is unpacked and must be read from disk: ${filePath}`
      );
    }

    const offset = this.#headerSize + parseInt(entry.offset, 10);
    const size = entry.size;

    return this.#data.slice(offset, offset + size);
  }

  /**
   * Read a file from the archive as a string (UTF-8).
   * @param {string} filePath - Path to the file
   * @returns {string}
   */
  readFileAsString(filePath) {
    const data = this.readFile(filePath);
    const decoder = new TextDecoder('utf-8');
    return decoder.decode(data);
  }

  /**
   * Read the contents of a directory.
   * @param {string} dirPath - Path to the directory
   * @returns {Array<string>} - Names of entries in the directory
   */
  readdir(dirPath) {
    this.#ensureLoaded();

    const entry = getDirEntry(this.#header, dirPath);
    if (!entry) {
      throw new Error(`Directory not found in archive: ${dirPath}`);
    }

    return Object.keys(entry.files || {});
  }

  /**
   * Ensure the archive is loaded.
   * @private
   */
  #ensureLoaded() {
    if (!this.#header) {
      throw new Error('Archive not loaded. Call load() first.');
    }
  }
}

/**
 * Create a file on disk, creating parent directories as needed.
 * @param {string} filePath - Destination path
 * @param {Uint8Array} data - File content
 * @param {object} options - Write options
 */
async function writeFileWithDirs(filePath, data, options = {}) {
  const parentDir = PathUtils.parent(filePath);
  await IOUtils.makeDirectory(parentDir, { createAncestors: true });
  await IOUtils.write(filePath, data, options);
}

/**
 * Extract all files from an asar archive to a destination directory.
 * @param {string} src - Path to the asar archive
 * @param {string} dest - Destination directory
 * @returns {Promise<void>}
 */
export async function extractAll(src, dest) {
  log.info(`Extracting ${src} to ${dest}`);

  const archive = new AsarArchive(src);
  await archive.load();

  const files = archive.listFiles();
  const entries = archive.listEntries();

  // Create all directories first
  for (const entry of entries) {
    if (entry.isDirectory) {
      // Normalize path separators and join properly
      const normalizedPath = entry.path.split('/').filter(p => p);
      const dirPath = PathUtils.join(dest, ...normalizedPath);
      log.debug(`Creating directory: ${dirPath}`);
      await IOUtils.makeDirectory(dirPath, { createAncestors: true });
    }
  }

  // Extract all files
  let extractedCount = 0;
  for (const file of files) {
    if (file.unpacked) {
      log.debug(`Skipping unpacked file: ${file.path}`);
      continue;
    }

    // Normalize path separators and join properly
    const normalizedPath = file.path.split('/').filter(p => p);
    const filePath = PathUtils.join(dest, ...normalizedPath);
    const data = archive.readFile(file.path);

    await writeFileWithDirs(filePath, data);
    extractedCount++;

    // Set executable permission if needed (Unix only)
    if (file.executable && Services.appinfo.OS !== 'WINNT') {
      try {
        await IOUtils.setPermissions(filePath, 0o755);
      } catch (e) {
        log.warn(`Failed to set executable permission on ${filePath}:`, e);
      }
    }
  }

  log.info(`Extracted ${extractedCount} files`);
}

/**
 * Extract a single file from an asar archive.
 * @param {string} src - Path to the asar archive
 * @param {string} filePath - Path to the file within the archive
 * @param {string} dest - Destination file path
 * @returns {Promise<void>}
 */
export async function extractFile(src, filePath, dest) {
  const archive = new AsarArchive(src);
  await archive.load();

  const data = archive.readFile(filePath);
  await writeFileWithDirs(dest, data);

  const info = archive.getFileInfo(filePath);
  if (info?.executable && Services.appinfo.OS !== 'WINNT') {
    try {
      await IOUtils.setPermissions(dest, 0o755);
    } catch (e) {
      log.warn(`Failed to set executable permission on ${dest}:`, e);
    }
  }
}

/**
 * List all files in an asar archive.
 * @param {string} src - Path to the asar archive
 * @returns {Promise<string[]>} - Array of file paths
 */
export async function listPackage(src) {
  const archive = new AsarArchive(src);
  await archive.load();
  return archive.listFiles().map((f) => f.path);
}

/**
 * Get the raw header of an asar archive.
 * @param {string} src - Path to the asar archive
 * @returns {Promise<object>} - The header object
 */
export async function getRawHeader(src) {
  const data = await IOUtils.read(src);
  const { header } = parseHeader(data);
  return header;
}

/**
 * Read a file from an asar archive without extracting.
 * @param {string} src - Path to the asar archive
 * @param {string} filePath - Path to the file within the archive
 * @returns {Promise<Uint8Array>}
 */
export async function readFile(src, filePath) {
  const archive = new AsarArchive(src);
  await archive.load();
  return archive.readFile(filePath);
}

/**
 * Read a file from an asar archive as a string.
 * @param {string} src - Path to the asar archive
 * @param {string} filePath - Path to the file within the archive
 * @returns {Promise<string>}
 */
export async function readFileAsString(src, filePath) {
  const archive = new AsarArchive(src);
  await archive.load();
  return archive.readFileAsString(filePath);
}

/**
 * Check if a file exists within an asar archive.
 * @param {string} src - Path to the asar archive
 * @param {string} filePath - Path to the file within the archive
 * @returns {Promise<boolean>}
 */
export async function fileExists(src, filePath) {
  const archive = new AsarArchive(src);
  await archive.load();
  return archive.hasFile(filePath);
}

/**
 * Stat information for a file or directory in an asar archive.
 * @param {string} src - Path to the asar archive
 * @param {string} entryPath - Path to the entry within the archive
 * @returns {Promise<object>} - Stat-like object
 */
export async function stat(src, entryPath) {
  const archive = new AsarArchive(src);
  await archive.load();

  // Check if it's a file
  const fileInfo = archive.getFileInfo(entryPath);
  if (fileInfo) {
    return {
      isFile: true,
      isDirectory: false,
      size: fileInfo.size,
      unpacked: fileInfo.unpacked,
      executable: fileInfo.executable,
    };
  }

  // Check if it's a directory
  if (archive.hasDirectory(entryPath)) {
    return {
      isFile: false,
      isDirectory: true,
      size: 0,
    };
  }

  throw new Error(`Entry not found in archive: ${entryPath}`);
}

/**
 * Create an asar archive from a directory.
 * @param {string} src - Source directory to archive
 * @param {string} dest - Destination asar file path
 * @param {object} [options] - Options for archive creation
 * @param {string[]} [options.unpack] - Glob patterns for files to leave unpacked
 * @param {string[]} [options.unpackDir] - Glob patterns for directories to leave unpacked
 * @param {Function} [options.transform] - Transform function for file contents
 * @returns {Promise<void>}
 */
export async function createPackage(src, dest, options = {}) {
  void options; // Reserved for future: unpack, unpackDir, transform options
  log.info(`Creating asar archive from ${src} to ${dest}`);

  // Collect all files recursively
  const files = [];

  async function collectFilesRecursive(dir, prefix = '') {
    const children = await IOUtils.getChildren(dir);

    for (const childPath of children) {
      const name = PathUtils.filename(childPath);
      const relativePath = prefix ? `${prefix}/${name}` : name;

      const info = await IOUtils.stat(childPath);

      if (info.type === 'directory') {
        await collectFilesRecursive(childPath, relativePath);
      } else {
        files.push({
          absolutePath: childPath,
          relativePath,
          size: info.size,
        });
      }
    }
  }

  await collectFilesRecursive(src);

  // Build the header
  const header = { files: {} };
  let currentOffset = 0;

  // Read all file contents and build header
  const fileContents = [];

  for (const file of files) {
    const parts = file.relativePath.split('/');
    let current = header;

    // Create directory structure in header
    for (let i = 0; i < parts.length - 1; i++) {
      if (!current.files[parts[i]]) {
        current.files[parts[i]] = { files: {} };
      }
      current = current.files[parts[i]];
    }

    // Read file content
    const content = await IOUtils.read(file.absolutePath);
    fileContents.push(content);

    // Add file entry
    const fileName = parts[parts.length - 1];
    current.files[fileName] = {
      offset: String(currentOffset),
      size: content.length,
    };

    currentOffset += content.length;
  }

  // Serialize header
  const encoder = new TextEncoder();
  const headerJson = encoder.encode(JSON.stringify(header));

  // Pad header to 4-byte alignment
  const paddedHeaderSize = Math.ceil(headerJson.length / 4) * 4;
  const paddedHeader = new Uint8Array(paddedHeaderSize);
  paddedHeader.set(headerJson);

  // Create the pickle header
  const pickleHeader = new Uint8Array(8);
  writeUInt32LE(pickleHeader, 0, paddedHeaderSize + 4); // pickle size
  writeUInt32LE(pickleHeader, 4, headerJson.length); // json size

  // Calculate total size
  const totalSize = 8 + paddedHeaderSize + currentOffset;
  const archive = new Uint8Array(totalSize);

  // Write pickle header
  archive.set(pickleHeader, 0);

  // Write padded header
  archive.set(paddedHeader, 8);

  // Write file contents
  let writeOffset = 8 + paddedHeaderSize;
  for (const content of fileContents) {
    archive.set(content, writeOffset);
    writeOffset += content.length;
  }

  // Write archive to disk
  await IOUtils.write(dest, archive);

  log.info(`Created archive with ${files.length} files`);
}

/**
 * Alias for createPackage (for compatibility with @electron/asar API).
 */
export const createPackageWithOptions = createPackage;

/**
 * Default export containing all asar functions.
 */
export default {
  AsarArchive,
  extractAll,
  extractFile,
  listPackage,
  getRawHeader,
  readFile,
  readFileAsString,
  fileExists,
  stat,
  createPackage,
  createPackageWithOptions,
};
