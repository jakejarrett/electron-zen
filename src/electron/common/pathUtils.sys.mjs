// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

/**
 * Path utilities that map Electron's path names to Gecko's directory service.
 * Provides cross-platform path resolution similar to Electron's app.getPath().
 */

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  FileUtils: 'resource://gre/modules/FileUtils.sys.mjs',
});

/**
 * Maps Electron path names to Gecko directory service keys.
 * @see https://www.electronjs.org/docs/latest/api/app#appgetpathname
 */
const PATH_MAP = {
  // User's home directory
  home: 'Home',

  // Per-user application data directory
  appData: 'AppData', // Falls back based on platform

  // Directory for storing app's configuration files
  userData: 'ProfD', // Profile directory

  // Temporary directory
  temp: 'TmpD',

  // Current executable path
  exe: 'XREExeF',

  // App's resources directory
  module: 'XCurProcD',

  // Directory for crash dumps
  crashDumps: 'DefProfRt', // We'll use profile root

  // Desktop directory
  desktop: 'Desk',

  // Downloads directory
  downloads: 'DfltDwnld',

  // Documents directory
  documents: 'Docs',

  // Music directory
  music: 'Music',

  // Pictures directory
  pictures: 'Pict',

  // Videos directory
  videos: 'Vids',

  // Logs directory (app-specific)
  logs: 'ProfD', // We'll append /logs
};

/**
 * Platform-specific adjustments
 */
function getPlatformAppData() {
  const platform = Services.appinfo.OS;
  switch (platform) {
    case 'WINNT':
      return 'AppData';
    case 'Darwin':
      return 'ULibDir'; // ~/Library
    default:
      // Linux/Unix - use XDG_CONFIG_HOME or ~/.config
      return 'Home';
  }
}

/**
 * Get the absolute path for a named directory.
 * @param {string} name - The Electron path name
 * @returns {string} - The absolute path
 * @throws {Error} - If the path name is unknown
 */
export function getPath(name) {
  let dirKey = PATH_MAP[name];

  if (!dirKey) {
    throw new Error(`Unknown path name: ${name}`);
  }

  // Special handling for appData
  if (name === 'appData') {
    dirKey = getPlatformAppData();
  }

  try {
    const dir = Services.dirsvc.get(dirKey, Ci.nsIFile);
    let path = dir.path;

    // Special handling for logs - append subdirectory
    if (name === 'logs') {
      path = PathUtils.join(path, 'logs');
    }

    // Special handling for Linux appData
    if (name === 'appData' && Services.appinfo.OS === 'Linux') {
      path = PathUtils.join(path, '.config');
    }

    return path;
  } catch (e) {
    console.error(`Failed to get path for '${name}':`, e);
    throw new Error(`Could not resolve path: ${name}`);
  }
}

/**
 * Set a custom path for a named directory.
 * Note: This only affects the Electron layer, not Gecko internals.
 */
const customPaths = new Map();

export function setPath(name, path) {
  customPaths.set(name, path);
}

/**
 * Get path with custom override support.
 */
export function getPathWithOverride(name) {
  if (customPaths.has(name)) {
    return customPaths.get(name);
  }
  return getPath(name);
}

/**
 * Join path segments.
 * @param {...string} segments - Path segments to join
 * @returns {string}
 */
export function join(...segments) {
  return PathUtils.join(...segments);
}

/**
 * Get the directory name of a path.
 * @param {string} path - The file path
 * @returns {string}
 */
export function dirname(path) {
  return PathUtils.parent(path);
}

/**
 * Get the base name of a path.
 * @param {string} path - The file path
 * @returns {string}
 */
export function basename(path) {
  return PathUtils.filename(path);
}

/**
 * Check if a path is absolute.
 * @param {string} path - The file path
 * @returns {boolean}
 */
export function isAbsolute(path) {
  return PathUtils.isAbsolute(path);
}

/**
 * Normalize a path.
 * @param {string} path - The file path
 * @returns {string}
 */
export function normalize(path) {
  return PathUtils.normalize(path);
}
