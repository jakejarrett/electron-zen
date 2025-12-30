// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

/**
 * webContents - Controls and interacts with web page content.
 *
 * Each BrowserWindow has a webContents instance that controls the
 * rendered page content.
 *
 * @see https://www.electronjs.org/docs/latest/api/web-contents
 */

import { EventEmitter } from 'resource:///modules/electron/common/EventEmitter.sys.mjs';
import { createLogger } from 'resource:///modules/electron/common/debug.sys.mjs';

const log = createLogger('WebContents');

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  WindowManager: 'resource:///modules/electron/host/WindowManager.sys.mjs',
  PreloadManager: 'resource:///modules/electron/renderer/PreloadManager.sys.mjs',
});

/**
 * Counter for unique webContents IDs
 */
let nextWebContentsId = 1;

/**
 * WebContents class - manages web page content within a BrowserWindow.
 */
export class WebContents extends EventEmitter {
  /** @type {number} */
  #id;

  /** @type {number} */
  #browserWindowId;

  /** @type {XULBrowserElement|null} */
  #browser = null;

  /** @type {string} */
  #preloadPath = '';

  /** @type {boolean} */
  #devToolsOpen = false;

  /** @type {Object} */
  #webPreferences;

  /**
   * Create a new WebContents instance.
   * @param {number} browserWindowId - Parent BrowserWindow ID
   * @param {Object} webPreferences - Web preferences from BrowserWindow options
   */
  constructor(browserWindowId, webPreferences = {}) {
    super();

    this.#id = nextWebContentsId++;
    this.#browserWindowId = browserWindowId;
    this.#webPreferences = {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: null,
      ...webPreferences,
    };

    if (this.#webPreferences.preload) {
      this.#preloadPath = this.#webPreferences.preload;
    }
  }

  /**
   * Get the unique ID of this webContents.
   * @returns {number}
   */
  get id() {
    return this.#id;
  }

  /**
   * Get the parent BrowserWindow ID.
   * @returns {number}
   */
  get browserWindowId() {
    return this.#browserWindowId;
  }

  /**
   * Get the web preferences.
   * @returns {Object}
   */
  get webPreferences() {
    return { ...this.#webPreferences };
  }

  /**
   * Attach this webContents to a browser element.
   * @param {XULBrowserElement} browser - The XUL browser element
   * @internal
   */
  attachBrowser(browser) {
    this.#browser = browser;
    this.#setupBrowserListeners();
  }

  /**
   * Set up event listeners on the browser element.
   * @private
   */
  #setupBrowserListeners() {
    if (!this.#browser) return;

    // Execute preload scripts before DOM is ready
    // We hook into DOMWindowCreated to run preload ASAP
    this.#browser.addEventListener('DOMWindowCreated', async (event) => {
      const contentWindow = event.target.defaultView;
      if (contentWindow) {
        try {
          await lazy.PreloadManager.execute(this.#id, contentWindow);
        } catch (e) {
          log.error('Preload execution failed:', e);
        }
      }
    });

    // Navigation events
    this.#browser.addEventListener('DOMContentLoaded', () => {
      this.emit('dom-ready');
    });

    this.#browser.addEventListener('load', () => {
      this.emit('did-finish-load');
    });

    // Use progress listener for more detailed navigation events
    const progressListener = {
      QueryInterface: ChromeUtils.generateQI([
        'nsIWebProgressListener',
        'nsISupportsWeakReference',
      ]),

      onStateChange: (webProgress, request, flags, status) => {
        const WPL = Ci.nsIWebProgressListener;

        if (flags & WPL.STATE_START && flags & WPL.STATE_IS_NETWORK) {
          this.emit('did-start-loading');
        }

        if (flags & WPL.STATE_STOP && flags & WPL.STATE_IS_NETWORK) {
          this.emit('did-stop-loading');
        }
      },

      onLocationChange: (webProgress, request, location, flags) => {
        if (location) {
          this.emit('did-navigate', {
            url: location.spec,
            isMainFrame: webProgress.isTopLevel,
          });
        }
      },

      onProgressChange: () => {},
      onSecurityChange: () => {},
      onStatusChange: () => {},
      onContentBlockingEvent: () => {},
    };

    try {
      this.#browser.addProgressListener(
        progressListener,
        Ci.nsIWebProgress.NOTIFY_ALL
      );
    } catch (e) {
      log.warn('Failed to add progress listener:', e);
    }
  }

  // ============================================
  // Navigation Methods
  // ============================================

  /**
   * Load a URL in the webContents.
   * @param {string} url - The URL to load
   * @param {Object} [options] - Load options
   * @returns {Promise<void>}
   */
  async loadURL(url, options = {}) {
    if (!this.#browser) {
      throw new Error('WebContents not attached to browser');
    }

    this.emit('did-start-navigation', { url });

    return new Promise((resolve, reject) => {
      const onLoad = () => {
        this.#browser.removeEventListener('load', onLoad);
        this.#browser.removeEventListener('error', onError);
        resolve();
      };

      const onError = (e) => {
        this.#browser.removeEventListener('load', onLoad);
        this.#browser.removeEventListener('error', onError);
        reject(new Error(`Failed to load URL: ${e.message}`));
      };

      this.#browser.addEventListener('load', onLoad, { once: true });
      this.#browser.addEventListener('error', onError, { once: true });

      try {
        const loadURIOptions = {
          triggeringPrincipal:
            Services.scriptSecurityManager.getSystemPrincipal(),
        };

        if (options.httpReferrer) {
          loadURIOptions.referrerInfo = new ReferrerInfo(
            Ci.nsIReferrerInfo.ORIGIN,
            true,
            Services.io.newURI(options.httpReferrer)
          );
        }

        if (options.userAgent) {
          loadURIOptions.userAgent = options.userAgent;
        }

        if (options.postData) {
          // TODO: Implement POST data handling
        }

        this.#browser.loadURI(Services.io.newURI(url), loadURIOptions);
      } catch (e) {
        reject(e);
      }
    });
  }

  /**
   * Load a local file in the webContents.
   * @param {string} filePath - Path to the file
   * @param {Object} [options] - Load options
   * @returns {Promise<void>}
   */
  async loadFile(filePath, options = {}) {
    const fileURL = PathUtils.toFileURI(filePath);
    return this.loadURL(fileURL, options);
  }

  /**
   * Get the current URL.
   * @returns {string}
   */
  getURL() {
    if (!this.#browser) return '';
    return this.#browser.currentURI?.spec || '';
  }

  /**
   * Get the title of the current page.
   * @returns {string}
   */
  getTitle() {
    if (!this.#browser) return '';
    return this.#browser.contentTitle || '';
  }

  /**
   * Check if the page is loading.
   * @returns {boolean}
   */
  isLoading() {
    if (!this.#browser) return false;
    return this.#browser.webProgress?.isLoadingDocument || false;
  }

  /**
   * Check if the page is waiting for a response.
   * @returns {boolean}
   */
  isWaitingForResponse() {
    return this.isLoading();
  }

  /**
   * Stop any pending navigation.
   */
  stop() {
    if (this.#browser) {
      this.#browser.stop();
    }
  }

  /**
   * Reload the current page.
   */
  reload() {
    if (this.#browser) {
      this.#browser.reload();
    }
  }

  /**
   * Reload ignoring cache.
   */
  reloadIgnoringCache() {
    if (this.#browser) {
      this.#browser.reloadWithFlags(Ci.nsIWebNavigation.LOAD_FLAGS_BYPASS_CACHE);
    }
  }

  /**
   * Check if we can go back.
   * @returns {boolean}
   */
  canGoBack() {
    if (!this.#browser) return false;
    return this.#browser.canGoBack;
  }

  /**
   * Check if we can go forward.
   * @returns {boolean}
   */
  canGoForward() {
    if (!this.#browser) return false;
    return this.#browser.canGoForward;
  }

  /**
   * Go back in history.
   */
  goBack() {
    if (this.#browser && this.canGoBack()) {
      this.#browser.goBack();
    }
  }

  /**
   * Go forward in history.
   */
  goForward() {
    if (this.#browser && this.canGoForward()) {
      this.#browser.goForward();
    }
  }

  /**
   * Go to a specific history index.
   * @param {number} index - History index
   */
  goToIndex(index) {
    if (this.#browser) {
      this.#browser.gotoIndex(index);
    }
  }

  // ============================================
  // JavaScript Execution
  // ============================================

  /**
   * Execute JavaScript in the page context.
   * @param {string} code - JavaScript code to execute
   * @param {boolean} [userGesture=false] - Simulate user gesture
   * @returns {Promise<any>}
   */
  async executeJavaScript(code, userGesture = false) {
    if (!this.#browser) {
      throw new Error('WebContents not attached to browser');
    }

    return new Promise((resolve, reject) => {
      try {
        // Use browsingContext to execute in content
        const browsingContext = this.#browser.browsingContext;
        if (!browsingContext) {
          throw new Error('No browsing context available');
        }

        // Execute via WindowGlobal
        const windowGlobal = browsingContext.currentWindowGlobal;
        if (!windowGlobal) {
          throw new Error('No window global available');
        }

        // Use actor to execute script
        // For now, use direct content window access if same-process
        const contentWindow = this.#browser.contentWindow;
        if (contentWindow) {
          try {
            const result = contentWindow.eval(code);
            resolve(result);
          } catch (e) {
            reject(e);
          }
        } else {
          reject(new Error('Cannot access content window'));
        }
      } catch (e) {
        reject(e);
      }
    });
  }

  // ============================================
  // IPC
  // ============================================

  /**
   * Send a message to the renderer process.
   * @param {string} channel - Channel name
   * @param {...any} args - Arguments to send
   */
  send(channel, ...args) {
    if (!this.#browser) {
      log.warn('Cannot send: WebContents not attached');
      return;
    }

    // Use actor-based messaging
    const browsingContext = this.#browser.browsingContext;
    if (browsingContext?.currentWindowGlobal) {
      try {
        const actor = browsingContext.currentWindowGlobal.getActor('ElectronIPC');
        actor.sendAsyncMessage('electron:ipc', { channel, args });
      } catch (e) {
        log.warn('Failed to send IPC message:', e);
      }
    }
  }

  /**
   * Send a message and wait for response.
   * @param {string} channel - Channel name
   * @param {...any} args - Arguments to send
   * @returns {Promise<any>}
   */
  async invoke(channel, ...args) {
    // TODO: Implement invoke with response handling
    throw new Error('webContents.invoke() not yet implemented');
  }

  // ============================================
  // DevTools
  // ============================================

  /**
   * Open DevTools.
   * @param {Object} [options] - DevTools options
   */
  openDevTools(options = {}) {
    if (!this.#browser) return;

    const { mode = 'detach' } = options;

    // Use Firefox's built-in DevTools
    const win = this.#browser.ownerGlobal;
    if (win && typeof win.BrowserToolboxLauncher !== 'undefined') {
      win.BrowserToolboxLauncher.init();
      this.#devToolsOpen = true;
      this.emit('devtools-opened');
    } else {
      // Fallback: try to open Web Developer Tools
      try {
        const { require } = ChromeUtils.importESModule(
          'resource://devtools/shared/loader/Loader.sys.mjs'
        );
        const { gDevTools } = require('devtools/client/framework/devtools');
        gDevTools.showToolboxForTab(this.#browser);
        this.#devToolsOpen = true;
        this.emit('devtools-opened');
      } catch (e) {
        log.warn('Failed to open DevTools:', e);
      }
    }
  }

  /**
   * Close DevTools.
   */
  closeDevTools() {
    // TODO: Implement proper DevTools closing
    this.#devToolsOpen = false;
    this.emit('devtools-closed');
  }

  /**
   * Check if DevTools is open.
   * @returns {boolean}
   */
  isDevToolsOpened() {
    return this.#devToolsOpen;
  }

  /**
   * Toggle DevTools.
   */
  toggleDevTools() {
    if (this.#devToolsOpen) {
      this.closeDevTools();
    } else {
      this.openDevTools();
    }
  }

  // ============================================
  // Focus & Selection
  // ============================================

  /**
   * Focus the webContents.
   */
  focus() {
    if (this.#browser) {
      this.#browser.focus();
    }
  }

  /**
   * Check if focused.
   * @returns {boolean}
   */
  isFocused() {
    if (!this.#browser) return false;
    return this.#browser.ownerDocument.activeElement === this.#browser;
  }

  // ============================================
  // Zoom
  // ============================================

  /**
   * Set the zoom factor.
   * @param {number} factor - Zoom factor (1.0 = 100%)
   */
  setZoomFactor(factor) {
    if (this.#browser) {
      this.#browser.fullZoom = factor;
    }
  }

  /**
   * Get the zoom factor.
   * @returns {number}
   */
  getZoomFactor() {
    if (!this.#browser) return 1.0;
    return this.#browser.fullZoom || 1.0;
  }

  /**
   * Set the zoom level.
   * @param {number} level - Zoom level (0 = 100%)
   */
  setZoomLevel(level) {
    // Convert level to factor: factor = 1.2^level
    const factor = Math.pow(1.2, level);
    this.setZoomFactor(factor);
  }

  /**
   * Get the zoom level.
   * @returns {number}
   */
  getZoomLevel() {
    const factor = this.getZoomFactor();
    // Convert factor to level: level = log1.2(factor)
    return Math.log(factor) / Math.log(1.2);
  }

  // ============================================
  // Printing
  // ============================================

  /**
   * Print the page.
   * @param {Object} [options] - Print options
   * @returns {Promise<void>}
   */
  async print(options = {}) {
    if (!this.#browser) return;

    // Use Gecko's printing API
    const win = this.#browser.ownerGlobal;
    if (win) {
      win.PrintUtils.printWindow(this.#browser.browsingContext, {
        silent: options.silent || false,
        printBackground: options.printBackground || false,
      });
    }
  }

  /**
   * Print to PDF.
   * @param {Object} [options] - PDF options
   * @returns {Promise<Buffer>}
   */
  async printToPDF(options = {}) {
    // TODO: Implement PDF printing
    throw new Error('printToPDF not yet implemented');
  }

  // ============================================
  // Cleanup
  // ============================================

  /**
   * Destroy this webContents.
   * @internal
   */
  destroy() {
    if (this.#browser) {
      // Remove listeners, cleanup
      this.#browser = null;
    }
    this.removeAllListeners();
  }

  /**
   * Check if destroyed.
   * @returns {boolean}
   */
  isDestroyed() {
    return this.#browser === null;
  }
}

// ============================================
// Static Methods
// ============================================

/**
 * Get all webContents instances.
 * @returns {WebContents[]}
 */
WebContents.getAllWebContents = function () {
  const allWindows = lazy.WindowManager.getAllWindows();
  return allWindows.map((win) => win.webContents).filter(Boolean);
};

/**
 * Get a webContents by ID.
 * @param {number} id - WebContents ID
 * @returns {WebContents|undefined}
 */
WebContents.fromId = function (id) {
  const all = WebContents.getAllWebContents();
  return all.find((wc) => wc.id === id);
};

/**
 * Get the focused webContents.
 * @returns {WebContents|undefined}
 */
WebContents.getFocusedWebContents = function () {
  const focusedWindow = lazy.WindowManager.getFocusedWindow();
  return focusedWindow?.webContents;
};
