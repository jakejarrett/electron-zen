// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

/**
 * BrowserWindow - Electron-compatible window class.
 *
 * Creates and controls browser windows with web content.
 *
 * @see https://www.electronjs.org/docs/latest/api/browser-window
 */

import { EventEmitter } from 'resource://gre/modules/electron/common/EventEmitter.sys.mjs';
import { WebContents } from 'resource://gre/modules/electron/main/webContents.sys.mjs';

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  WindowManager: 'resource://gre/modules/electron/host/WindowManager.sys.mjs',
});

/**
 * Default window options matching Electron defaults.
 */
const DEFAULT_OPTIONS = {
  width: 800,
  height: 600,
  x: undefined,
  y: undefined,
  useContentSize: false,
  center: true,
  minWidth: 0,
  minHeight: 0,
  maxWidth: Infinity,
  maxHeight: Infinity,
  resizable: true,
  movable: true,
  minimizable: true,
  maximizable: true,
  closable: true,
  focusable: true,
  alwaysOnTop: false,
  fullscreen: false,
  fullscreenable: true,
  simpleFullscreen: false,
  skipTaskbar: false,
  kiosk: false,
  title: 'Electron',
  icon: null,
  show: true,
  frame: true,
  parent: null,
  modal: false,
  acceptFirstMouse: false,
  disableAutoHideCursor: false,
  autoHideMenuBar: false,
  enableLargerThanScreen: false,
  backgroundColor: '#FFFFFF',
  hasShadow: true,
  opacity: 1.0,
  darkTheme: false,
  transparent: false,
  titleBarStyle: 'default',
  webPreferences: {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    preload: null,
    devTools: true,
  },
};

/**
 * BrowserWindow class - creates and manages browser windows.
 */
export class BrowserWindow extends EventEmitter {
  /** @type {number} */
  #id;

  /** @type {string|null} */
  #appId = null;

  /** @type {Object} */
  #options;

  /** @type {ChromeWindow|null} */
  #window = null;

  /** @type {XULBrowserElement|null} */
  #browser = null;

  /** @type {WebContents} */
  #webContents;

  /** @type {boolean} */
  #isDestroyed = false;

  /** @type {boolean} */
  #isVisible = false;

  /** @type {number[]} */
  #bounds = [0, 0, 800, 600]; // [x, y, width, height]

  /**
   * Create a new BrowserWindow.
   * @param {Object} [options] - Window options
   */
  constructor(options = {}) {
    super();

    // Merge options with defaults
    this.#options = {
      ...DEFAULT_OPTIONS,
      ...options,
      webPreferences: {
        ...DEFAULT_OPTIONS.webPreferences,
        ...options.webPreferences,
      },
    };

    // Generate unique ID
    this.#id = lazy.WindowManager.generateId();

    // Create WebContents
    this.#webContents = new WebContents(this.#id, this.#options.webPreferences);

    // Register with WindowManager
    lazy.WindowManager.registerWindow(this);

    // Initialize bounds
    this.#bounds = [
      this.#options.x ?? 0,
      this.#options.y ?? 0,
      this.#options.width,
      this.#options.height,
    ];

    // Create the actual window
    this.#createWindow();
  }

  /**
   * Create the underlying Gecko window.
   * @private
   */
  #createWindow() {
    try {
      // Build window features string
      const features = this.#buildWindowFeatures();

      // Create window using Gecko's window watcher
      // We create a minimal chrome window that hosts a browser element
      const windowURL = 'chrome://electron-host/content/electron-window.xhtml';

      this.#window = Services.ww.openWindow(
        null, // No parent
        windowURL,
        `electron-window-${this.#id}`,
        features,
        null // No arguments for now
      );

      if (!this.#window) {
        throw new Error('Failed to create window');
      }

      // Wait for window to load
      this.#window.addEventListener(
        'load',
        () => {
          this.#onWindowLoad();
        },
        { once: true }
      );

      // Set up window event handlers
      this.#setupWindowEvents();
    } catch (e) {
      console.error('BrowserWindow: Failed to create window:', e);
      // Fall back to creating a browser element in existing window
      this.#createFallbackWindow();
    }
  }

  /**
   * Build Gecko window features string from options.
   * @returns {string}
   * @private
   */
  #buildWindowFeatures() {
    const features = [];

    features.push(`width=${this.#options.width}`);
    features.push(`height=${this.#options.height}`);

    if (this.#options.x !== undefined) {
      features.push(`left=${this.#options.x}`);
    }
    if (this.#options.y !== undefined) {
      features.push(`top=${this.#options.y}`);
    }

    if (!this.#options.frame) {
      features.push('chromehidden');
    }

    if (this.#options.resizable) {
      features.push('resizable');
    }

    if (this.#options.alwaysOnTop) {
      features.push('alwaysRaised');
    }

    if (this.#options.modal && this.#options.parent) {
      features.push('modal');
    }

    return features.join(',');
  }

  /**
   * Fallback: create browser in existing Zen window.
   * @private
   */
  #createFallbackWindow() {
    console.log('BrowserWindow: Using fallback browser creation');

    // Get or create a host window
    const hostWindow = Services.wm.getMostRecentWindow('navigator:browser');

    if (hostWindow && hostWindow.gBrowser) {
      // Create a new tab with our content
      const tab = hostWindow.gBrowser.addTab('about:blank', {
        triggeringPrincipal:
          Services.scriptSecurityManager.getSystemPrincipal(),
      });

      this.#browser = hostWindow.gBrowser.getBrowserForTab(tab);
      this.#window = hostWindow;

      // Attach webContents to browser
      this.#webContents.attachBrowser(this.#browser);

      this.#isVisible = this.#options.show;

      this.emit('ready-to-show');

      if (this.#options.show) {
        this.emit('show');
      }
    } else {
      console.error('BrowserWindow: No host window available');
    }
  }

  /**
   * Called when the window has loaded.
   * @private
   */
  #onWindowLoad() {
    // Find or create the browser element in the window
    this.#browser = this.#window.document.getElementById('electron-browser');

    if (!this.#browser) {
      // Create browser element dynamically
      this.#browser = this.#window.document.createXULElement('browser');
      this.#browser.setAttribute('id', 'electron-browser');
      this.#browser.setAttribute('type', 'content');
      this.#browser.setAttribute('remote', 'true');
      this.#browser.setAttribute('flex', '1');

      const container = this.#window.document.getElementById('browser-container');
      if (container) {
        container.appendChild(this.#browser);
      } else {
        this.#window.document.documentElement.appendChild(this.#browser);
      }
    }

    // Attach webContents to browser
    this.#webContents.attachBrowser(this.#browser);

    // Apply initial properties
    this.setTitle(this.#options.title);

    if (this.#options.backgroundColor) {
      this.setBackgroundColor(this.#options.backgroundColor);
    }

    this.#isVisible = this.#options.show;

    // Emit ready event
    this.emit('ready-to-show');

    if (this.#options.show) {
      this.show();
    }
  }

  /**
   * Set up window event listeners.
   * @private
   */
  #setupWindowEvents() {
    if (!this.#window) return;

    // Window close
    this.#window.addEventListener('close', (e) => {
      // Allow preventing close
      const event = { preventDefault: () => e.preventDefault() };
      this.emit('close', event);
    });

    this.#window.addEventListener('unload', () => {
      this.#onClosed();
    });

    // Focus events
    this.#window.addEventListener('focus', () => {
      lazy.WindowManager.setFocusedWindow(this.#id);
      this.emit('focus');
    });

    this.#window.addEventListener('blur', () => {
      if (lazy.WindowManager.getFocusedWindow()?.id === this.#id) {
        lazy.WindowManager.setFocusedWindow(null);
      }
      this.emit('blur');
    });

    // Resize events
    this.#window.addEventListener('resize', () => {
      this.#updateBounds();
      this.emit('resize');
    });

    // Move events
    this.#window.addEventListener('MozAfterPaint', () => {
      const newX = this.#window.screenX;
      const newY = this.#window.screenY;
      if (newX !== this.#bounds[0] || newY !== this.#bounds[1]) {
        this.#bounds[0] = newX;
        this.#bounds[1] = newY;
        this.emit('move');
      }
    });
  }

  /**
   * Update stored bounds from window.
   * @private
   */
  #updateBounds() {
    if (this.#window) {
      this.#bounds = [
        this.#window.screenX,
        this.#window.screenY,
        this.#window.outerWidth,
        this.#window.outerHeight,
      ];
    }
  }

  /**
   * Called when window is closed.
   * @private
   */
  #onClosed() {
    this.emit('closed');
    this.destroy();
  }

  // ============================================
  // Properties
  // ============================================

  /**
   * Get the window ID.
   * @returns {number}
   */
  get id() {
    return this.#id;
  }

  /**
   * Get the app ID this window belongs to.
   * @returns {string|null}
   */
  get appId() {
    return this.#appId;
  }

  /**
   * Set the app ID.
   * @param {string} appId
   */
  setAppId(appId) {
    this.#appId = appId;
  }

  /**
   * Get the webContents for this window.
   * @returns {WebContents}
   */
  get webContents() {
    return this.#webContents;
  }

  /**
   * Check if window is destroyed.
   * @returns {boolean}
   */
  isDestroyed() {
    return this.#isDestroyed;
  }

  // ============================================
  // Window State Methods
  // ============================================

  /**
   * Show the window.
   */
  show() {
    if (this.#window && !this.#isDestroyed) {
      this.#window.focus();
      this.#isVisible = true;
      this.emit('show');
    }
  }

  /**
   * Show the window without focusing.
   */
  showInactive() {
    if (this.#window && !this.#isDestroyed) {
      // Gecko doesn't have a direct equivalent, just show
      this.#isVisible = true;
      this.emit('show');
    }
  }

  /**
   * Hide the window.
   */
  hide() {
    if (this.#window && !this.#isDestroyed) {
      // Minimize as a form of hiding
      this.#window.minimize?.();
      this.#isVisible = false;
      this.emit('hide');
    }
  }

  /**
   * Check if window is visible.
   * @returns {boolean}
   */
  isVisible() {
    return this.#isVisible && !this.#isDestroyed;
  }

  /**
   * Focus the window.
   */
  focus() {
    if (this.#window && !this.#isDestroyed) {
      this.#window.focus();
    }
  }

  /**
   * Blur (unfocus) the window.
   */
  blur() {
    if (this.#window && !this.#isDestroyed) {
      this.#window.blur();
    }
  }

  /**
   * Check if window is focused.
   * @returns {boolean}
   */
  isFocused() {
    return lazy.WindowManager.getFocusedWindow()?.id === this.#id;
  }

  /**
   * Minimize the window.
   */
  minimize() {
    if (this.#window && !this.#isDestroyed) {
      this.#window.minimize?.();
      this.emit('minimize');
    }
  }

  /**
   * Restore minimized window.
   */
  restore() {
    if (this.#window && !this.#isDestroyed) {
      this.#window.restore?.();
      this.emit('restore');
    }
  }

  /**
   * Check if minimized.
   * @returns {boolean}
   */
  isMinimized() {
    if (!this.#window) return false;
    return this.#window.windowState === this.#window.STATE_MINIMIZED;
  }

  /**
   * Maximize the window.
   */
  maximize() {
    if (this.#window && !this.#isDestroyed) {
      this.#window.maximize?.();
      this.emit('maximize');
    }
  }

  /**
   * Unmaximize the window.
   */
  unmaximize() {
    if (this.#window && !this.#isDestroyed) {
      this.#window.restore?.();
      this.emit('unmaximize');
    }
  }

  /**
   * Check if maximized.
   * @returns {boolean}
   */
  isMaximized() {
    if (!this.#window) return false;
    return this.#window.windowState === this.#window.STATE_MAXIMIZED;
  }

  /**
   * Enter fullscreen.
   * @param {boolean} flag
   */
  setFullScreen(flag) {
    if (this.#window && !this.#isDestroyed) {
      this.#window.fullScreen = flag;
      this.emit(flag ? 'enter-full-screen' : 'leave-full-screen');
    }
  }

  /**
   * Check if fullscreen.
   * @returns {boolean}
   */
  isFullScreen() {
    if (!this.#window) return false;
    return this.#window.fullScreen;
  }

  /**
   * Close the window.
   */
  close() {
    if (this.#window && !this.#isDestroyed) {
      this.#window.close();
    }
  }

  /**
   * Destroy the window.
   */
  destroy() {
    if (this.#isDestroyed) return;

    this.#isDestroyed = true;

    // Clean up webContents
    this.#webContents.destroy();

    // Unregister from WindowManager
    lazy.WindowManager.unregisterWindow(this.#id);

    // Close actual window if still open
    if (this.#window && !this.#window.closed) {
      try {
        this.#window.close();
      } catch (e) {
        // Window may already be closing
      }
    }

    this.#window = null;
    this.#browser = null;

    this.removeAllListeners();
  }

  // ============================================
  // Size & Position Methods
  // ============================================

  /**
   * Get window bounds.
   * @returns {Object}
   */
  getBounds() {
    this.#updateBounds();
    return {
      x: this.#bounds[0],
      y: this.#bounds[1],
      width: this.#bounds[2],
      height: this.#bounds[3],
    };
  }

  /**
   * Set window bounds.
   * @param {Object} bounds - {x, y, width, height}
   * @param {boolean} [animate=false]
   */
  setBounds(bounds, animate = false) {
    if (!this.#window || this.#isDestroyed) return;

    if (bounds.x !== undefined) this.#window.moveTo(bounds.x, bounds.y ?? this.#bounds[1]);
    if (bounds.y !== undefined) this.#window.moveTo(bounds.x ?? this.#bounds[0], bounds.y);
    if (bounds.width !== undefined || bounds.height !== undefined) {
      this.#window.resizeTo(
        bounds.width ?? this.#bounds[2],
        bounds.height ?? this.#bounds[3]
      );
    }

    this.#updateBounds();
  }

  /**
   * Get content bounds.
   * @returns {Object}
   */
  getContentBounds() {
    if (!this.#window) return { x: 0, y: 0, width: 0, height: 0 };
    return {
      x: this.#window.screenX,
      y: this.#window.screenY,
      width: this.#window.innerWidth,
      height: this.#window.innerHeight,
    };
  }

  /**
   * Get window size.
   * @returns {number[]}
   */
  getSize() {
    this.#updateBounds();
    return [this.#bounds[2], this.#bounds[3]];
  }

  /**
   * Set window size.
   * @param {number} width
   * @param {number} height
   * @param {boolean} [animate=false]
   */
  setSize(width, height, animate = false) {
    if (this.#window && !this.#isDestroyed) {
      this.#window.resizeTo(width, height);
      this.#updateBounds();
    }
  }

  /**
   * Get window position.
   * @returns {number[]}
   */
  getPosition() {
    this.#updateBounds();
    return [this.#bounds[0], this.#bounds[1]];
  }

  /**
   * Set window position.
   * @param {number} x
   * @param {number} y
   * @param {boolean} [animate=false]
   */
  setPosition(x, y, animate = false) {
    if (this.#window && !this.#isDestroyed) {
      this.#window.moveTo(x, y);
      this.#updateBounds();
    }
  }

  /**
   * Center the window on screen.
   */
  center() {
    if (!this.#window || this.#isDestroyed) return;

    const screen = this.#window.screen;
    const x = Math.round((screen.availWidth - this.#bounds[2]) / 2);
    const y = Math.round((screen.availHeight - this.#bounds[3]) / 2);
    this.setPosition(x, y);
  }

  // ============================================
  // Content Methods
  // ============================================

  /**
   * Load a URL.
   * @param {string} url
   * @param {Object} [options]
   * @returns {Promise<void>}
   */
  loadURL(url, options = {}) {
    return this.#webContents.loadURL(url, options);
  }

  /**
   * Load a file.
   * @param {string} filePath
   * @param {Object} [options]
   * @returns {Promise<void>}
   */
  loadFile(filePath, options = {}) {
    return this.#webContents.loadFile(filePath, options);
  }

  /**
   * Reload the page.
   */
  reload() {
    this.#webContents.reload();
  }

  // ============================================
  // Title & Icon
  // ============================================

  /**
   * Set the window title.
   * @param {string} title
   */
  setTitle(title) {
    if (this.#window && !this.#isDestroyed) {
      this.#window.document.title = title;
    }
  }

  /**
   * Get the window title.
   * @returns {string}
   */
  getTitle() {
    if (!this.#window) return '';
    return this.#window.document.title;
  }

  /**
   * Set the background color.
   * @param {string} color - Hex color string
   */
  setBackgroundColor(color) {
    if (this.#window && !this.#isDestroyed) {
      this.#window.document.documentElement.style.backgroundColor = color;
    }
  }

  // ============================================
  // Static Methods
  // ============================================

  /**
   * Get all open BrowserWindows.
   * @returns {BrowserWindow[]}
   */
  static getAllWindows() {
    return lazy.WindowManager.getAllWindows();
  }

  /**
   * Get the focused BrowserWindow.
   * @returns {BrowserWindow|null}
   */
  static getFocusedWindow() {
    return lazy.WindowManager.getFocusedWindow();
  }

  /**
   * Get a BrowserWindow by ID.
   * @param {number} id
   * @returns {BrowserWindow|undefined}
   */
  static fromId(id) {
    return lazy.WindowManager.getWindow(id);
  }

  /**
   * Get the BrowserWindow that owns a webContents.
   * @param {WebContents} webContents
   * @returns {BrowserWindow|undefined}
   */
  static fromWebContents(webContents) {
    return lazy.WindowManager.getWindow(webContents.browserWindowId);
  }
}
