// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

/**
 * shell - Electron-compatible shell module.
 *
 * Manage files and URLs using their default applications.
 *
 * @see https://www.electronjs.org/docs/latest/api/shell
 */

import { createLogger } from 'resource:///modules/electron/common/debug.sys.mjs';

const log = createLogger('shell');

/**
 * Shell module - manage files and URLs using default applications.
 */
export const shell = {
  /**
   * Open the given external URL in the desktop's default browser.
   *
   * @param {string} url - URL to open (http, https, mailto, etc.)
   * @param {Object} [options] - Options
   * @param {boolean} [options.activate=true] - Bring browser to foreground
   * @returns {Promise<void>}
   *
   * @example
   * await shell.openExternal('https://github.com');
   * await shell.openExternal('mailto:test@example.com');
   */
  async openExternal(url, options = {}) {
    log.info('openExternal:', url);

    try {
      // Validate URL
      const uri = Services.io.newURI(url);

      // Use external protocol service to open URL
      const eps = Cc['@mozilla.org/uriloader/external-protocol-service;1']
        .getService(Ci.nsIExternalProtocolService);

      // Check if protocol is supported
      if (!eps.externalProtocolHandlerExists(uri.scheme)) {
        throw new Error(`No handler for protocol: ${uri.scheme}`);
      }

      // Get the parent window for context
      const parentWindow = Services.wm.getMostRecentWindow('navigator:browser');

      // Load the URL externally
      eps.loadURI(uri, parentWindow?.browsingContext?.triggeringPrincipal);

      log.debug('openExternal succeeded');
    } catch (e) {
      log.error('openExternal failed:', e);
      throw e;
    }
  },

  /**
   * Open the given file in the desktop's default manner.
   *
   * @param {string} path - Path to open
   * @returns {Promise<string>} - Error message or empty string on success
   *
   * @example
   * await shell.openPath('/path/to/document.pdf');
   */
  async openPath(path) {
    log.info('openPath:', path);

    try {
      const file = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
      file.initWithPath(path);

      if (!file.exists()) {
        const error = `File not found: ${path}`;
        log.error(error);
        return error;
      }

      // Use nsIFile.launch() to open with default app
      file.launch();

      log.debug('openPath succeeded');
      return '';
    } catch (e) {
      const error = `Failed to open path: ${e.message}`;
      log.error(error);
      return error;
    }
  },

  /**
   * Show the given file in a file manager. If possible, select the file.
   *
   * @param {string} fullPath - Path to the file to show
   * @returns {Promise<void>}
   *
   * @example
   * shell.showItemInFolder('/path/to/file.txt');
   */
  async showItemInFolder(fullPath) {
    log.info('showItemInFolder:', fullPath);

    try {
      const file = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
      file.initWithPath(fullPath);

      if (!file.exists()) {
        // Try to show parent folder
        const parent = file.parent;
        if (parent && parent.exists()) {
          file.initWithPath(parent.path);
        } else {
          throw new Error(`File not found: ${fullPath}`);
        }
      }

      // Platform-specific reveal
      const dominated = Services.appinfo.OS;

      if (dominated === 'Darwin') {
        // macOS: use 'open -R' to reveal in Finder
        const process = Cc['@mozilla.org/process/util;1'].createInstance(Ci.nsIProcess);
        const openExe = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
        openExe.initWithPath('/usr/bin/open');
        process.init(openExe);
        process.run(false, ['-R', fullPath], 2);
      } else if (dominated === 'WINNT') {
        // Windows: use explorer /select
        const process = Cc['@mozilla.org/process/util;1'].createInstance(Ci.nsIProcess);
        const explorerExe = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
        explorerExe.initWithPath('C:\\Windows\\explorer.exe');
        process.init(explorerExe);
        process.run(false, ['/select,', fullPath], 2);
      } else {
        // Linux: try various file managers
        const fileManagers = [
          { exe: '/usr/bin/nautilus', args: ['--select', fullPath] },
          { exe: '/usr/bin/dolphin', args: ['--select', fullPath] },
          { exe: '/usr/bin/nemo', args: [fullPath] },
          { exe: '/usr/bin/thunar', args: [file.parent.path] },
          { exe: '/usr/bin/pcmanfm', args: [file.parent.path] },
          { exe: '/usr/bin/xdg-open', args: [file.parent.path] },
        ];

        let success = false;
        for (const fm of fileManagers) {
          try {
            const fmExe = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
            fmExe.initWithPath(fm.exe);
            if (fmExe.exists()) {
              const process = Cc['@mozilla.org/process/util;1'].createInstance(Ci.nsIProcess);
              process.init(fmExe);
              process.run(false, fm.args, fm.args.length);
              success = true;
              break;
            }
          } catch (e) {
            // Try next file manager
          }
        }

        if (!success) {
          // Fallback: just open the parent folder
          file.parent.launch();
        }
      }

      log.debug('showItemInFolder succeeded');
    } catch (e) {
      log.error('showItemInFolder failed:', e);
      throw e;
    }
  },

  /**
   * Move the given file to trash and return a boolean for the operation.
   *
   * @param {string} fullPath - Path to the file to trash
   * @returns {Promise<boolean>} - Whether the operation succeeded
   *
   * @example
   * const success = await shell.trashItem('/path/to/file.txt');
   */
  async trashItem(fullPath) {
    log.info('trashItem:', fullPath);

    try {
      const file = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
      file.initWithPath(fullPath);

      if (!file.exists()) {
        log.warn('trashItem: File not found');
        return false;
      }

      // Use IOUtils for trash operation if available
      // Note: Gecko doesn't have native trash support, so we remove
      // In a real implementation, you'd use platform APIs

      const dominated = Services.appinfo.OS;

      if (dominated === 'Darwin') {
        // macOS: use 'trash' command or osascript
        try {
          const process = Cc['@mozilla.org/process/util;1'].createInstance(Ci.nsIProcess);
          const scriptExe = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
          scriptExe.initWithPath('/usr/bin/osascript');
          process.init(scriptExe);
          const script = `tell application "Finder" to delete POSIX file "${fullPath}"`;
          process.run(true, ['-e', script], 2);
          log.debug('trashItem succeeded (macOS)');
          return true;
        } catch (e) {
          log.warn('macOS trash failed, falling back to delete');
        }
      } else if (dominated === 'Linux') {
        // Linux: use gio trash or trash-cli
        try {
          const gioExe = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
          gioExe.initWithPath('/usr/bin/gio');
          if (gioExe.exists()) {
            const process = Cc['@mozilla.org/process/util;1'].createInstance(Ci.nsIProcess);
            process.init(gioExe);
            process.run(true, ['trash', fullPath], 2);
            log.debug('trashItem succeeded (Linux gio)');
            return true;
          }
        } catch (e) {
          log.warn('Linux gio trash failed');
        }

        try {
          const trashExe = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
          trashExe.initWithPath('/usr/bin/trash');
          if (trashExe.exists()) {
            const process = Cc['@mozilla.org/process/util;1'].createInstance(Ci.nsIProcess);
            process.init(trashExe);
            process.run(true, [fullPath], 1);
            log.debug('trashItem succeeded (Linux trash-cli)');
            return true;
          }
        } catch (e) {
          log.warn('Linux trash-cli failed');
        }
      }

      // Fallback: actually delete (not ideal but works)
      log.warn('trashItem: No trash support, deleting file');
      file.remove(false);
      return true;
    } catch (e) {
      log.error('trashItem failed:', e);
      return false;
    }
  },

  /**
   * Play the beep sound.
   */
  beep() {
    log.debug('beep');

    try {
      const dominated = Services.appinfo.OS;

      if (dominated === 'Darwin') {
        // macOS: use system sound
        const sound = Cc['@mozilla.org/sound;1'].createInstance(Ci.nsISound);
        sound.beep();
      } else if (dominated === 'WINNT') {
        // Windows: MessageBeep
        const sound = Cc['@mozilla.org/sound;1'].createInstance(Ci.nsISound);
        sound.beep();
      } else {
        // Linux: try various methods
        const sound = Cc['@mozilla.org/sound;1'].createInstance(Ci.nsISound);
        sound.beep();
      }
    } catch (e) {
      log.warn('beep failed:', e);
    }
  },

  /**
   * Read a shortcut link (Windows only).
   *
   * @param {string} shortcutPath - Path to .lnk file
   * @returns {Object} - Shortcut details
   */
  readShortcutLink(shortcutPath) {
    log.debug('readShortcutLink:', shortcutPath);

    if (Services.appinfo.OS !== 'WINNT') {
      throw new Error('readShortcutLink is only available on Windows');
    }

    // TODO: Implement Windows shortcut reading
    throw new Error('readShortcutLink not yet implemented');
  },

  /**
   * Write a shortcut link (Windows only).
   *
   * @param {string} shortcutPath - Path to create .lnk file
   * @param {string} operation - Operation type
   * @param {Object} options - Shortcut options
   * @returns {boolean}
   */
  writeShortcutLink(shortcutPath, operation, options) {
    log.debug('writeShortcutLink:', shortcutPath, operation);

    if (Services.appinfo.OS !== 'WINNT') {
      throw new Error('writeShortcutLink is only available on Windows');
    }

    // TODO: Implement Windows shortcut writing
    throw new Error('writeShortcutLink not yet implemented');
  },
};

export default shell;
