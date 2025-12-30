// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

/**
 * clipboard - Electron-compatible clipboard module.
 *
 * Perform copy and paste operations on the system clipboard.
 *
 * @see https://www.electronjs.org/docs/latest/api/clipboard
 */

import { createLogger } from 'resource:///modules/electron/common/debug.sys.mjs';

const log = createLogger('clipboard');

// Clipboard types
const CLIPBOARD_TYPES = {
  selection: Ci.nsIClipboard?.kSelectionClipboard || 0,
  clipboard: Ci.nsIClipboard?.kGlobalClipboard || 1,
};

/**
 * Get the nsIClipboard service.
 */
function getClipboardService() {
  return Cc['@mozilla.org/widget/clipboard;1'].getService(Ci.nsIClipboard);
}

/**
 * Get the nsITransferable for data transfer.
 */
function createTransferable() {
  const transferable = Cc['@mozilla.org/widget/transferable;1']
    .createInstance(Ci.nsITransferable);
  transferable.init(null);
  return transferable;
}

/**
 * Clipboard module - system clipboard operations.
 */
export const clipboard = {
  /**
   * Read text from the clipboard.
   *
   * @param {string} [type='clipboard'] - 'clipboard' or 'selection' (Linux only)
   * @returns {string} - Clipboard text content
   *
   * @example
   * const text = clipboard.readText();
   */
  readText(type = 'clipboard') {
    log.debug('readText:', type);

    try {
      const clipboardService = getClipboardService();
      const transferable = createTransferable();

      // Add text flavors
      transferable.addDataFlavor('text/plain');

      const clipboardType = CLIPBOARD_TYPES[type] ?? CLIPBOARD_TYPES.clipboard;

      // Get data from clipboard
      clipboardService.getData(transferable, clipboardType, Services.wm.getMostRecentWindow('navigator:browser')?.browsingContext);

      const data = {};
      const dataLen = {};
      try {
        transferable.getTransferData('text/plain', data);
        if (data.value) {
          const str = data.value.QueryInterface(Ci.nsISupportsString);
          return str.data;
        }
      } catch (e) {
        // No text data
      }

      return '';
    } catch (e) {
      log.error('readText failed:', e);
      return '';
    }
  },

  /**
   * Write text to the clipboard.
   *
   * @param {string} text - Text to write
   * @param {string} [type='clipboard'] - 'clipboard' or 'selection' (Linux only)
   *
   * @example
   * clipboard.writeText('Hello, World!');
   */
  writeText(text, type = 'clipboard') {
    log.debug('writeText:', text?.length, 'chars, type:', type);

    try {
      const clipboardService = getClipboardService();
      const transferable = createTransferable();

      // Create string wrapper
      const str = Cc['@mozilla.org/supports-string;1'].createInstance(Ci.nsISupportsString);
      str.data = text;

      // Add to transferable
      transferable.addDataFlavor('text/plain');
      transferable.setTransferData('text/plain', str);

      const clipboardType = CLIPBOARD_TYPES[type] ?? CLIPBOARD_TYPES.clipboard;

      // Set clipboard data
      clipboardService.setData(transferable, null, clipboardType);

      log.debug('writeText succeeded');
    } catch (e) {
      log.error('writeText failed:', e);
      throw e;
    }
  },

  /**
   * Read HTML from the clipboard.
   *
   * @param {string} [type='clipboard'] - 'clipboard' or 'selection'
   * @returns {string} - HTML content
   *
   * @example
   * const html = clipboard.readHTML();
   */
  readHTML(type = 'clipboard') {
    log.debug('readHTML:', type);

    try {
      const clipboardService = getClipboardService();
      const transferable = createTransferable();

      transferable.addDataFlavor('text/html');

      const clipboardType = CLIPBOARD_TYPES[type] ?? CLIPBOARD_TYPES.clipboard;
      clipboardService.getData(transferable, clipboardType, Services.wm.getMostRecentWindow('navigator:browser')?.browsingContext);

      const data = {};
      try {
        transferable.getTransferData('text/html', data);
        if (data.value) {
          const str = data.value.QueryInterface(Ci.nsISupportsString);
          return str.data;
        }
      } catch (e) {
        // No HTML data
      }

      return '';
    } catch (e) {
      log.error('readHTML failed:', e);
      return '';
    }
  },

  /**
   * Write HTML to the clipboard.
   *
   * @param {string} markup - HTML to write
   * @param {string} [type='clipboard'] - 'clipboard' or 'selection'
   *
   * @example
   * clipboard.writeHTML('<b>Hello</b>');
   */
  writeHTML(markup, type = 'clipboard') {
    log.debug('writeHTML:', markup?.length, 'chars');

    try {
      const clipboardService = getClipboardService();
      const transferable = createTransferable();

      const str = Cc['@mozilla.org/supports-string;1'].createInstance(Ci.nsISupportsString);
      str.data = markup;

      transferable.addDataFlavor('text/html');
      transferable.setTransferData('text/html', str);

      // Also add plain text version
      const plainStr = Cc['@mozilla.org/supports-string;1'].createInstance(Ci.nsISupportsString);
      plainStr.data = markup.replace(/<[^>]*>/g, ''); // Strip HTML tags
      transferable.addDataFlavor('text/plain');
      transferable.setTransferData('text/plain', plainStr);

      const clipboardType = CLIPBOARD_TYPES[type] ?? CLIPBOARD_TYPES.clipboard;
      clipboardService.setData(transferable, null, clipboardType);

      log.debug('writeHTML succeeded');
    } catch (e) {
      log.error('writeHTML failed:', e);
      throw e;
    }
  },

  /**
   * Read RTF from the clipboard.
   *
   * @param {string} [type='clipboard'] - 'clipboard' or 'selection'
   * @returns {string} - RTF content
   */
  readRTF(type = 'clipboard') {
    log.debug('readRTF:', type);

    try {
      const clipboardService = getClipboardService();
      const transferable = createTransferable();

      transferable.addDataFlavor('text/rtf');

      const clipboardType = CLIPBOARD_TYPES[type] ?? CLIPBOARD_TYPES.clipboard;
      clipboardService.getData(transferable, clipboardType, Services.wm.getMostRecentWindow('navigator:browser')?.browsingContext);

      const data = {};
      try {
        transferable.getTransferData('text/rtf', data);
        if (data.value) {
          const str = data.value.QueryInterface(Ci.nsISupportsString);
          return str.data;
        }
      } catch (e) {
        // No RTF data
      }

      return '';
    } catch (e) {
      log.error('readRTF failed:', e);
      return '';
    }
  },

  /**
   * Write RTF to the clipboard.
   *
   * @param {string} text - RTF to write
   * @param {string} [type='clipboard'] - 'clipboard' or 'selection'
   */
  writeRTF(text, type = 'clipboard') {
    log.debug('writeRTF:', text?.length, 'chars');

    try {
      const clipboardService = getClipboardService();
      const transferable = createTransferable();

      const str = Cc['@mozilla.org/supports-string;1'].createInstance(Ci.nsISupportsString);
      str.data = text;

      transferable.addDataFlavor('text/rtf');
      transferable.setTransferData('text/rtf', str);

      const clipboardType = CLIPBOARD_TYPES[type] ?? CLIPBOARD_TYPES.clipboard;
      clipboardService.setData(transferable, null, clipboardType);

      log.debug('writeRTF succeeded');
    } catch (e) {
      log.error('writeRTF failed:', e);
      throw e;
    }
  },

  /**
   * Read bookmark info from the clipboard (macOS).
   *
   * @returns {Object} - { title, url }
   */
  readBookmark() {
    log.debug('readBookmark');

    // Bookmarks are primarily a macOS feature
    // Return the URL from clipboard if available
    return {
      title: '',
      url: this.readText(),
    };
  },

  /**
   * Write bookmark to the clipboard (macOS).
   *
   * @param {string} title - Bookmark title
   * @param {string} url - Bookmark URL
   */
  writeBookmark(title, url, type = 'clipboard') {
    log.debug('writeBookmark:', title, url);

    // Write as text for cross-platform support
    this.writeText(url, type);
  },

  /**
   * Find text in the clipboard (macOS).
   *
   * @returns {string} - Find pasteboard text
   */
  readFindText() {
    log.debug('readFindText');

    // macOS has a special find pasteboard
    // For other platforms, just return regular text
    return this.readText();
  },

  /**
   * Write find text to clipboard (macOS).
   *
   * @param {string} text - Text to write
   */
  writeFindText(text) {
    log.debug('writeFindText:', text);
    this.writeText(text);
  },

  /**
   * Clear the clipboard.
   *
   * @param {string} [type='clipboard'] - 'clipboard' or 'selection'
   */
  clear(type = 'clipboard') {
    log.debug('clear:', type);

    try {
      const clipboardService = getClipboardService();
      const clipboardType = CLIPBOARD_TYPES[type] ?? CLIPBOARD_TYPES.clipboard;
      clipboardService.emptyClipboard(clipboardType);
      log.debug('clear succeeded');
    } catch (e) {
      log.error('clear failed:', e);
    }
  },

  /**
   * Get available formats on the clipboard.
   *
   * @param {string} [type='clipboard'] - 'clipboard' or 'selection'
   * @returns {string[]} - Array of MIME types
   */
  availableFormats(type = 'clipboard') {
    log.debug('availableFormats:', type);

    const formats = [];
    const clipboardService = getClipboardService();
    const clipboardType = CLIPBOARD_TYPES[type] ?? CLIPBOARD_TYPES.clipboard;

    // Check for various formats
    const checkFormats = ['text/plain', 'text/html', 'text/rtf', 'image/png', 'image/jpeg'];

    for (const format of checkFormats) {
      try {
        if (clipboardService.hasDataMatchingFlavors([format], clipboardType)) {
          formats.push(format);
        }
      } catch (e) {
        // Format not available
      }
    }

    return formats;
  },

  /**
   * Check if clipboard contains specific format.
   *
   * @param {string} format - MIME type to check
   * @param {string} [type='clipboard'] - 'clipboard' or 'selection'
   * @returns {boolean}
   */
  has(format, type = 'clipboard') {
    log.debug('has:', format, type);

    try {
      const clipboardService = getClipboardService();
      const clipboardType = CLIPBOARD_TYPES[type] ?? CLIPBOARD_TYPES.clipboard;

      // Map Electron format names to MIME types
      const mimeMap = {
        'text/plain': 'text/plain',
        'text/html': 'text/html',
        'text/rtf': 'text/rtf',
        'image/png': 'image/png',
        'image/jpeg': 'image/jpeg',
      };

      const mimeType = mimeMap[format] || format;
      return clipboardService.hasDataMatchingFlavors([mimeType], clipboardType);
    } catch (e) {
      log.error('has failed:', e);
      return false;
    }
  },

  /**
   * Read an image from the clipboard.
   *
   * @param {string} [type='clipboard'] - 'clipboard' or 'selection'
   * @returns {Object|null} - NativeImage-like object or null
   */
  readImage(type = 'clipboard') {
    log.debug('readImage:', type);

    // TODO: Implement image reading with NativeImage
    // This requires the nativeImage module
    return null;
  },

  /**
   * Write an image to the clipboard.
   *
   * @param {Object} image - NativeImage object
   * @param {string} [type='clipboard'] - 'clipboard' or 'selection'
   */
  writeImage(image, type = 'clipboard') {
    log.debug('writeImage:', type);

    // TODO: Implement image writing
    throw new Error('writeImage not yet implemented');
  },

  /**
   * Read raw data from clipboard.
   *
   * @param {string} format - MIME type
   * @returns {Buffer} - Raw data
   */
  readBuffer(format) {
    log.debug('readBuffer:', format);

    // TODO: Implement buffer reading
    return new ArrayBuffer(0);
  },

  /**
   * Write raw data to clipboard.
   *
   * @param {string} format - MIME type
   * @param {Buffer} buffer - Data to write
   */
  writeBuffer(format, buffer, type = 'clipboard') {
    log.debug('writeBuffer:', format, buffer?.byteLength, 'bytes');

    // TODO: Implement buffer writing
    throw new Error('writeBuffer not yet implemented');
  },

  /**
   * Write multiple formats at once.
   *
   * @param {Object} data - { text, html, rtf, image, bookmark }
   * @param {string} [type='clipboard'] - 'clipboard' or 'selection'
   */
  write(data, type = 'clipboard') {
    log.debug('write:', Object.keys(data));

    try {
      const clipboardService = getClipboardService();
      const transferable = createTransferable();

      if (data.text) {
        const str = Cc['@mozilla.org/supports-string;1'].createInstance(Ci.nsISupportsString);
        str.data = data.text;
        transferable.addDataFlavor('text/plain');
        transferable.setTransferData('text/plain', str);
      }

      if (data.html) {
        const str = Cc['@mozilla.org/supports-string;1'].createInstance(Ci.nsISupportsString);
        str.data = data.html;
        transferable.addDataFlavor('text/html');
        transferable.setTransferData('text/html', str);
      }

      if (data.rtf) {
        const str = Cc['@mozilla.org/supports-string;1'].createInstance(Ci.nsISupportsString);
        str.data = data.rtf;
        transferable.addDataFlavor('text/rtf');
        transferable.setTransferData('text/rtf', str);
      }

      const clipboardType = CLIPBOARD_TYPES[type] ?? CLIPBOARD_TYPES.clipboard;
      clipboardService.setData(transferable, null, clipboardType);

      log.debug('write succeeded');
    } catch (e) {
      log.error('write failed:', e);
      throw e;
    }
  },
};

export default clipboard;
