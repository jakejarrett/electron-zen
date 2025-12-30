// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

/**
 * dialog - Electron-compatible dialog module.
 *
 * Display native system dialogs for opening/saving files, alerts, etc.
 *
 * @see https://www.electronjs.org/docs/latest/api/dialog
 */

import { createLogger } from 'resource:///modules/electron/common/debug.sys.mjs';

const log = createLogger('dialog');

/**
 * Map Electron filter format to nsIFilePicker format.
 * @param {Object[]} filters - Electron-style filters [{name, extensions}]
 * @returns {string} - nsIFilePicker filter string
 */
function convertFilters(filters) {
  if (!filters || !filters.length) return null;

  return filters.map(filter => {
    const extensions = filter.extensions.map(ext => {
      if (ext === '*') return '*.*';
      return `*.${ext}`;
    }).join(';');
    return { title: filter.name, filter: extensions };
  });
}

/**
 * Get the parent window for a dialog.
 * @param {BrowserWindow} [browserWindow]
 * @returns {Window}
 */
function getParentWindow(browserWindow) {
  if (browserWindow && browserWindow._window) {
    return browserWindow._window;
  }
  return Services.wm.getMostRecentWindow('navigator:browser');
}

/**
 * Dialog module - display native system dialogs.
 */
export const dialog = {
  /**
   * Show an open file dialog.
   *
   * @param {BrowserWindow} [browserWindow] - Parent window
   * @param {Object} options - Dialog options
   * @param {string} [options.title] - Dialog title
   * @param {string} [options.defaultPath] - Default path to open
   * @param {string} [options.buttonLabel] - Custom button label
   * @param {Object[]} [options.filters] - File type filters [{name, extensions}]
   * @param {string[]} [options.properties] - Dialog properties
   * @returns {Promise<{canceled: boolean, filePaths: string[]}>}
   *
   * @example
   * const result = await dialog.showOpenDialog({
   *   properties: ['openFile', 'multiSelections'],
   *   filters: [{ name: 'Images', extensions: ['jpg', 'png', 'gif'] }]
   * });
   */
  async showOpenDialog(browserWindow, options = {}) {
    // Handle case where browserWindow is omitted
    if (browserWindow && !browserWindow.webContents) {
      options = browserWindow;
      browserWindow = null;
    }

    log.debug('showOpenDialog', options);

    const parentWindow = getParentWindow(browserWindow);
    const properties = options.properties || ['openFile'];

    const fp = Cc['@mozilla.org/filepicker;1'].createInstance(Ci.nsIFilePicker);

    // Determine mode
    let mode = Ci.nsIFilePicker.modeOpen;
    if (properties.includes('openDirectory')) {
      mode = Ci.nsIFilePicker.modeGetFolder;
    } else if (properties.includes('multiSelections')) {
      mode = Ci.nsIFilePicker.modeOpenMultiple;
    }

    fp.init(parentWindow.browsingContext, options.title || 'Open', mode);

    // Set default path
    if (options.defaultPath) {
      try {
        const defaultFile = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
        defaultFile.initWithPath(options.defaultPath);
        if (defaultFile.exists()) {
          if (defaultFile.isDirectory()) {
            fp.displayDirectory = defaultFile;
          } else {
            fp.displayDirectory = defaultFile.parent;
            fp.defaultString = defaultFile.leafName;
          }
        }
      } catch (e) {
        log.warn('Invalid defaultPath:', options.defaultPath, e);
      }
    }

    // Add filters
    if (options.filters && options.filters.length) {
      for (const filter of options.filters) {
        const extensions = filter.extensions.map(ext => ext === '*' ? '*' : `*.${ext}`).join(';');
        fp.appendFilter(filter.name, extensions);
      }
    } else {
      fp.appendFilters(Ci.nsIFilePicker.filterAll);
    }

    // Show dialog
    return new Promise((resolve) => {
      fp.open((result) => {
        if (result === Ci.nsIFilePicker.returnOK || result === Ci.nsIFilePicker.returnReplace) {
          const filePaths = [];

          if (mode === Ci.nsIFilePicker.modeOpenMultiple) {
            const files = fp.files;
            while (files.hasMoreElements()) {
              const file = files.getNext().QueryInterface(Ci.nsIFile);
              filePaths.push(file.path);
            }
          } else {
            filePaths.push(fp.file.path);
          }

          log.info('showOpenDialog selected:', filePaths);
          resolve({ canceled: false, filePaths });
        } else {
          log.debug('showOpenDialog canceled');
          resolve({ canceled: true, filePaths: [] });
        }
      });
    });
  },

  /**
   * Show a save file dialog.
   *
   * @param {BrowserWindow} [browserWindow] - Parent window
   * @param {Object} options - Dialog options
   * @param {string} [options.title] - Dialog title
   * @param {string} [options.defaultPath] - Default path/filename
   * @param {string} [options.buttonLabel] - Custom button label
   * @param {Object[]} [options.filters] - File type filters
   * @returns {Promise<{canceled: boolean, filePath: string|undefined}>}
   *
   * @example
   * const result = await dialog.showSaveDialog({
   *   defaultPath: 'untitled.txt',
   *   filters: [{ name: 'Text', extensions: ['txt'] }]
   * });
   */
  async showSaveDialog(browserWindow, options = {}) {
    // Handle case where browserWindow is omitted
    if (browserWindow && !browserWindow.webContents) {
      options = browserWindow;
      browserWindow = null;
    }

    log.debug('showSaveDialog', options);

    const parentWindow = getParentWindow(browserWindow);

    const fp = Cc['@mozilla.org/filepicker;1'].createInstance(Ci.nsIFilePicker);
    fp.init(parentWindow.browsingContext, options.title || 'Save', Ci.nsIFilePicker.modeSave);

    // Set default path/filename
    if (options.defaultPath) {
      try {
        const defaultFile = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
        defaultFile.initWithPath(options.defaultPath);
        fp.displayDirectory = defaultFile.parent;
        fp.defaultString = defaultFile.leafName;
      } catch (e) {
        // Just use as filename
        fp.defaultString = options.defaultPath;
      }
    }

    // Add filters
    if (options.filters && options.filters.length) {
      for (const filter of options.filters) {
        const extensions = filter.extensions.map(ext => ext === '*' ? '*' : `*.${ext}`).join(';');
        fp.appendFilter(filter.name, extensions);
      }
      // Set default extension from first filter
      if (options.filters[0].extensions[0] && options.filters[0].extensions[0] !== '*') {
        fp.defaultExtension = options.filters[0].extensions[0];
      }
    } else {
      fp.appendFilters(Ci.nsIFilePicker.filterAll);
    }

    return new Promise((resolve) => {
      fp.open((result) => {
        if (result === Ci.nsIFilePicker.returnOK || result === Ci.nsIFilePicker.returnReplace) {
          log.info('showSaveDialog selected:', fp.file.path);
          resolve({ canceled: false, filePath: fp.file.path });
        } else {
          log.debug('showSaveDialog canceled');
          resolve({ canceled: true, filePath: undefined });
        }
      });
    });
  },

  /**
   * Show a message box dialog.
   *
   * @param {BrowserWindow} [browserWindow] - Parent window
   * @param {Object} options - Dialog options
   * @param {string} [options.type] - 'none', 'info', 'error', 'question', 'warning'
   * @param {string[]} [options.buttons] - Button labels
   * @param {number} [options.defaultId] - Default button index
   * @param {number} [options.cancelId] - Cancel button index
   * @param {string} [options.title] - Dialog title
   * @param {string} [options.message] - Main message
   * @param {string} [options.detail] - Additional detail text
   * @param {string} [options.checkboxLabel] - Checkbox label
   * @param {boolean} [options.checkboxChecked] - Initial checkbox state
   * @returns {Promise<{response: number, checkboxChecked: boolean}>}
   *
   * @example
   * const result = await dialog.showMessageBox({
   *   type: 'question',
   *   buttons: ['Yes', 'No'],
   *   message: 'Do you want to save?'
   * });
   */
  async showMessageBox(browserWindow, options = {}) {
    // Handle case where browserWindow is omitted
    if (browserWindow && !browserWindow.webContents) {
      options = browserWindow;
      browserWindow = null;
    }

    log.debug('showMessageBox', options);

    const parentWindow = getParentWindow(browserWindow);
    const buttons = options.buttons || ['OK'];
    const title = options.title || '';
    const message = options.message || '';
    const detail = options.detail || '';

    // Map Electron type to prompt service flags
    let flags = 0;
    const type = options.type || 'none';

    // Button configuration
    if (buttons.length === 1) {
      flags |= Services.prompt.BUTTON_POS_0 * Services.prompt.BUTTON_TITLE_IS_STRING;
    } else if (buttons.length === 2) {
      flags |= Services.prompt.BUTTON_POS_0 * Services.prompt.BUTTON_TITLE_IS_STRING;
      flags |= Services.prompt.BUTTON_POS_1 * Services.prompt.BUTTON_TITLE_IS_STRING;
    } else if (buttons.length >= 3) {
      flags |= Services.prompt.BUTTON_POS_0 * Services.prompt.BUTTON_TITLE_IS_STRING;
      flags |= Services.prompt.BUTTON_POS_1 * Services.prompt.BUTTON_TITLE_IS_STRING;
      flags |= Services.prompt.BUTTON_POS_2 * Services.prompt.BUTTON_TITLE_IS_STRING;
    }

    // Default button
    if (options.defaultId === 1) {
      flags |= Services.prompt.BUTTON_POS_1_DEFAULT;
    } else if (options.defaultId === 2) {
      flags |= Services.prompt.BUTTON_POS_2_DEFAULT;
    }

    const fullMessage = detail ? `${message}\n\n${detail}` : message;

    // Handle checkbox
    const checkboxState = { value: options.checkboxChecked || false };

    return new Promise((resolve) => {
      let response;

      if (options.checkboxLabel) {
        response = Services.prompt.confirmEx(
          parentWindow,
          title,
          fullMessage,
          flags,
          buttons[0] || null,
          buttons[1] || null,
          buttons[2] || null,
          options.checkboxLabel,
          checkboxState
        );
      } else {
        response = Services.prompt.confirmEx(
          parentWindow,
          title,
          fullMessage,
          flags,
          buttons[0] || null,
          buttons[1] || null,
          buttons[2] || null,
          null,
          {}
        );
      }

      log.info('showMessageBox response:', response);
      resolve({
        response,
        checkboxChecked: checkboxState.value,
      });
    });
  },

  /**
   * Show a synchronous message box (blocking).
   * Prefer showMessageBox() for async operation.
   *
   * @param {BrowserWindow} [browserWindow]
   * @param {Object} options
   * @returns {{response: number, checkboxChecked: boolean}}
   */
  showMessageBoxSync(browserWindow, options = {}) {
    // Handle case where browserWindow is omitted
    if (browserWindow && !browserWindow.webContents) {
      options = browserWindow;
      browserWindow = null;
    }

    log.debug('showMessageBoxSync', options);

    const parentWindow = getParentWindow(browserWindow);
    const buttons = options.buttons || ['OK'];
    const title = options.title || '';
    const message = options.message || '';
    const detail = options.detail || '';

    let flags = 0;
    if (buttons.length >= 1) {
      flags |= Services.prompt.BUTTON_POS_0 * Services.prompt.BUTTON_TITLE_IS_STRING;
    }
    if (buttons.length >= 2) {
      flags |= Services.prompt.BUTTON_POS_1 * Services.prompt.BUTTON_TITLE_IS_STRING;
    }
    if (buttons.length >= 3) {
      flags |= Services.prompt.BUTTON_POS_2 * Services.prompt.BUTTON_TITLE_IS_STRING;
    }

    const fullMessage = detail ? `${message}\n\n${detail}` : message;
    const checkboxState = { value: options.checkboxChecked || false };

    const response = Services.prompt.confirmEx(
      parentWindow,
      title,
      fullMessage,
      flags,
      buttons[0] || null,
      buttons[1] || null,
      buttons[2] || null,
      options.checkboxLabel || null,
      options.checkboxLabel ? checkboxState : {}
    );

    return {
      response,
      checkboxChecked: checkboxState.value,
    };
  },

  /**
   * Show an error box dialog.
   *
   * @param {string} title - Dialog title
   * @param {string} content - Error message
   */
  showErrorBox(title, content) {
    log.error('showErrorBox:', title, content);

    const parentWindow = Services.wm.getMostRecentWindow('navigator:browser');
    Services.prompt.alert(parentWindow, title, content);
  },

  /**
   * Show a certificate trust dialog.
   * Note: Limited support in Gecko.
   *
   * @param {BrowserWindow} [browserWindow]
   * @param {Object} options
   * @returns {Promise<void>}
   */
  async showCertificateTrustDialog(browserWindow, options = {}) {
    log.warn('showCertificateTrustDialog: Limited support in Gecko Electron');
    // TODO: Implement using certificate manager
    return Promise.resolve();
  },
};

export default dialog;
