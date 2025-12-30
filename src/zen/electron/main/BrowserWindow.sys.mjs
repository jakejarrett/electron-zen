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

import { EventEmitter } from 'resource:///modules/electron/common/EventEmitter.sys.mjs';
import { WebContents } from 'resource:///modules/electron/main/webContents.sys.mjs';
import { createLogger } from 'resource:///modules/electron/common/debug.sys.mjs';

const log = createLogger('BrowserWindow');

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  WindowManager: 'resource:///modules/electron/host/WindowManager.sys.mjs',
  AppSandbox: 'resource:///modules/electron/host/AppSandbox.sys.mjs',
  PreloadManager: 'resource:///modules/electron/renderer/PreloadManager.sys.mjs',
  BrowserWindowTracker: 'resource:///modules/BrowserWindowTracker.sys.mjs',
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

  /** @type {Object|null} - Tab reference for fallback/tab mode */
  #tab = null;

  /** @type {boolean} - True if this is a standalone window, false if it's a tab */
  #isStandalone = false;

  /** @type {WebContents} */
  #webContents;

  /** @type {boolean} */
  #isDestroyed = false;

  /** @type {boolean} */
  #isVisible = false;

  /** @type {number[]} */
  #bounds = [0, 0, 800, 600]; // [x, y, width, height]

  /** @type {Promise<void>} - Promise that resolves when the window is ready */
  #readyPromise;

  /** @type {Function} - Resolver for the ready promise */
  #readyResolve;

  /** @type {Element|null} - Custom titlebar content element (CSD mode only) */
  #titlebarContent = null;

  /**
   * Create a new BrowserWindow.
   * @param {Object} [options] - Window options
   */
  constructor(options = {}) {
    super();

    log.debug('Creating new BrowserWindow with options:', options);

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

    // Set app ID for sandboxing
    this.#appId = this.#options.appId || null;

    log.info(`BrowserWindow created with id=${this.#id}, appId=${this.#appId}`);

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

    // Register preload script if specified
    if (this.#options.webPreferences?.preload) {
      lazy.PreloadManager.register(this.#webContents.id, this.#options.webPreferences.preload, {
        nodeIntegration: this.#options.webPreferences.nodeIntegration,
        contextIsolation: this.#options.webPreferences.contextIsolation,
        appId: this.#appId,
      });
    }

    // Create a promise that resolves when the window is ready
    this.#readyPromise = new Promise(resolve => {
      this.#readyResolve = resolve;
    });

    // Create the actual window
    this.#createWindow();
  }

  /**
   * Wait for the window to be ready.
   * @returns {Promise<void>}
   */
  whenReady() {
    return this.#readyPromise;
  }

  /**
   * Create the underlying Gecko window.
   * Opens a new browser window and configures it for Electron-like behavior.
   * @private
   */
  async #createWindow() {
    try {
      log.debug(`Creating Gecko window for BrowserWindow id=${this.#id}`);

      // Build window features for the new window
      const features = this.#buildWindowFeatures();

      log.debug(`Opening browser window with features: ${features}`);

      // Use BrowserWindowTracker to open a new window
      // This creates a full browser window which we'll then customize
      const win = lazy.BrowserWindowTracker.openWindow({
        features,
      });

      if (!win) {
        throw new Error('Failed to create window');
      }

      this.#window = win;

      // Wait for window to fully load before customizing
      win.addEventListener('load', () => {
        this.#onBrowserWindowLoad();
      }, { once: true });

      // Also wait for delayed startup to ensure all browser components are ready
      const startupPromise = new Promise(resolve => {
        const observer = {
          observe(subject) {
            if (subject === win) {
              Services.obs.removeObserver(observer, 'browser-delayed-startup-finished');
              resolve();
            }
          }
        };
        Services.obs.addObserver(observer, 'browser-delayed-startup-finished');
      });

      // Set up a timeout in case delayed startup never fires
      const timeoutPromise = new Promise(resolve => {
        win.setTimeout(resolve, 5000);
      });

      Promise.race([startupPromise, timeoutPromise]).then(() => {
        this.#configureWindowForElectron();
      });

      log.info(`Browser window created for BrowserWindow id=${this.#id}`);

    } catch (e) {
      log.error('BrowserWindow: Failed to create window:', e);
      // Fall back to creating a tab in existing window
      this.#createFallbackWindow();
    }
  }

  /**
   * Configure the browser window to look like an Electron window.
   * Hides tabs, toolbars, and other browser chrome.
   * @private
   */
  #configureWindowForElectron() {
    if (!this.#window || !this.#window.document) {
      log.error('Cannot configure window - window not ready');
      return;
    }

    const doc = this.#window.document;

    log.debug('Configuring window for Electron mode');

    // Add electron-mode attribute to enable CSS targeting
    doc.documentElement.setAttribute('electron-mode', 'true');

    // Load electron mode stylesheet
    try {
      const link = doc.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'chrome://electron/content/electron-mode.css';
      doc.head.appendChild(link);
      log.debug('Electron mode stylesheet loaded');
    } catch (e) {
      log.warn('Could not load electron mode stylesheet:', e);
    }

    // Also collapse elements programmatically for immediate effect
    // (CSS might not apply immediately)

    // Hide the tabs toolbar
    const tabsToolbar = doc.getElementById('TabsToolbar');
    if (tabsToolbar) {
      tabsToolbar.collapsed = true;
      log.debug('TabsToolbar collapsed');
    }

    // Hide the nav-bar (address bar, etc) - Electron apps typically don't need this
    const navBar = doc.getElementById('nav-bar');
    if (navBar) {
      navBar.collapsed = true;
      log.debug('nav-bar collapsed');
    }

    // Disable the urlbar to prevent UrlbarValueFormatter errors
    // The urlbar continues to run even when hidden, causing errors when it
    // tries to access the editor's selectionController
    try {
      const urlbar = doc.getElementById('urlbar');
      if (urlbar) {
        // Remove the urlbar input to prevent formatting attempts
        const urlbarInput = doc.getElementById('urlbar-input');
        if (urlbarInput) {
          urlbarInput.readOnly = true;
          urlbarInput.disabled = true;
        }
        // Disable the urlbar controller if available
        if (this.#window.gURLBar) {
          // Prevent value formatting by disabling the formatter
          if (this.#window.gURLBar.valueFormatter) {
            this.#window.gURLBar.valueFormatter._isElectronMode = true;
          }
          // Clear any pending updates
          if (this.#window.gURLBar._updateValueOnLocationChange) {
            this.#window.gURLBar._updateValueOnLocationChange = () => {};
          }
        }
        log.debug('urlbar disabled for electron mode');
      }
    } catch (e) {
      log.debug('Could not disable urlbar (non-critical):', e);
    }

    // Hide the PersonalToolbar (bookmarks bar)
    const personalToolbar = doc.getElementById('PersonalToolbar');
    if (personalToolbar) {
      personalToolbar.collapsed = true;
      log.debug('PersonalToolbar collapsed');
    }

    // Hide any Zen-specific UI elements that might be visible
    const zenSidebar = doc.getElementById('zen-sidebar');
    if (zenSidebar) {
      zenSidebar.style.display = 'none';
      log.debug('zen-sidebar hidden');
    }

    const zenSidebarSplitter = doc.getElementById('zen-sidebar-splitter');
    if (zenSidebarSplitter) {
      zenSidebarSplitter.style.display = 'none';
    }

    // Hide the menu bar on platforms where it's visible
    const menubar = doc.getElementById('toolbar-menubar');
    if (menubar) {
      menubar.setAttribute('autohide', 'true');
      menubar.setAttribute('inactive', 'true');
    }

    // Add a class to mark this as an electron window for CSS purposes
    doc.documentElement.setAttribute('electron-mode', 'true');

    // Handle frame mode: true (OS decorations), false (frameless), "csd" (Client-Side Decorations)
    const frameMode = this.#options.frame;
    
    if (frameMode === false) {
      // Frameless - no window decorations at all
      doc.documentElement.setAttribute('electron-frameless', 'true');
      doc.documentElement.setAttribute('chromehidden', 'true');
      doc.documentElement.setAttribute('hidechrome', 'true');
      // Try to hide window decorations (platform-specific)
      this.#applyFramelessWindow();
    } else if (frameMode === 'csd') {
      // CSD mode - Client-Side Decorations (browser draws titlebar with window controls)
      doc.documentElement.setAttribute('electron-frame-csd', 'true');
      this.#applyCSDMode();
    } else {
      // Default (true) - OS-level window decorations
      // Disable Client-Side Decorations so the OS draws the titlebar
      this.#enableOSWindowDecorations();
    }

    // Set the window title
    if (this.#options.title) {
      doc.title = this.#options.title;
    }

    // Get the browser element from the first (and only) tab
    if (this.#window.gBrowser) {
      const tabs = this.#window.gBrowser.tabs;
      if (tabs.length > 0) {
        this.#tab = tabs[0];
        this.#browser = this.#window.gBrowser.getBrowserForTab(this.#tab);

        // Tag the browser with app ID for sandbox enforcement
        if (this.#appId && this.#browser) {
          this.#browser.__electronAppId = this.#appId;
          lazy.AppSandbox.enforceAppBoundary(this.#window, this.#appId);
        }

        // Attach webContents to browser
        if (this.#browser) {
          this.#webContents.attachBrowser(this.#browser);
        }
      }
    }

    // Mark this as a standalone window
    this.#isStandalone = true;
    this.#isVisible = this.#options.show;

    log.info(`Window configured for Electron mode, BrowserWindow id=${this.#id}`);

    // Resolve the ready promise - window is now ready for use
    if (this.#readyResolve) {
      this.#readyResolve();
    }

    this.emit('ready-to-show');

    if (this.#options.show) {
      this.emit('show');
    }
  }

  /**
   * Apply frameless window styling (hide window decorations).
   * @private
   */
  #applyFramelessWindow() {
    if (!this.#window) return;

    try {
      // On GTK (Linux), we can use the window's setChromeFlags
      const domWindow = this.#window.docShell?.domWindow;
      if (domWindow) {
        // Request no decorations
        const chromeFlags = Ci.nsIWebBrowserChrome.CHROME_WINDOW_BORDERS |
                          Ci.nsIWebBrowserChrome.CHROME_WINDOW_CLOSE |
                          Ci.nsIWebBrowserChrome.CHROME_WINDOW_RESIZE;
        // Note: Actually removing decorations requires platform-specific handling
        // For now, we just hide the chrome elements
      }

      // CSS-based approach to hide remaining chrome
      const doc = this.#window.document;
      const style = doc.createElement('style');
      style.textContent = `
        /* Hide all chrome for frameless electron window */
        #navigator-toolbox {
          display: none !important;
        }
        #browser {
          margin-top: 0 !important;
        }
        :root[electron-mode] #appcontent {
          margin-top: 0 !important;
        }
      `;
      doc.head.appendChild(style);

      log.debug('Frameless window styling applied');
    } catch (e) {
      log.warn('Could not apply frameless window styling:', e);
    }
  }

  /**
   * Enable OS-level window decorations for framed windows.
   * Disables Client-Side Decorations (CSD) so the OS draws the titlebar.
   * @private
   */
  #enableOSWindowDecorations() {
    if (!this.#window) return;

    try {
      const doc = this.#window.document;

      // Remove CSD-related attributes to let the OS draw decorations
      doc.documentElement.removeAttribute('customtitlebar');
      doc.documentElement.removeAttribute('tabsintitlebar');
      doc.documentElement.removeAttribute('chromemargin');

      // Set chromemargin to 0 to disable extended client area
      // This tells Gecko not to extend the window content into the titlebar area
      doc.documentElement.setAttribute('chromemargin', '0,0,0,0');

      // Completely hide the custom titlebar
      const titlebar = doc.getElementById('titlebar');
      if (titlebar) {
        titlebar.style.display = 'none';
      }

      // Hide the navigator toolbox completely for framed windows
      // The OS will provide the window decorations instead
      const navigatorToolbox = doc.getElementById('navigator-toolbox');
      if (navigatorToolbox) {
        navigatorToolbox.style.display = 'none';
      }

      // CSS to ensure content fills the window properly
      const style = doc.createElement('style');
      style.id = 'electron-framed-window-style';
      style.textContent = `
        /* Framed electron window - OS provides decorations */
        :root {
          -moz-appearance: -moz-window-frame-bottom !important;
        }
        #navigator-toolbox {
          display: none !important;
          height: 0 !important;
          min-height: 0 !important;
        }
        #titlebar {
          display: none !important;
          height: 0 !important;
        }
        #browser {
          margin-top: 0 !important;
        }
        #appcontent {
          margin-top: 0 !important;
        }
        /* Hide Zen sidebar */
        #zen-sidebar,
        #zen-sidebar-splitter {
          display: none !important;
        }
      `;
      doc.head.appendChild(style);

      log.debug('OS window decorations enabled (CSD disabled)');
    } catch (e) {
      log.warn('Could not enable OS window decorations:', e);
    }
  }

  /**
   * Apply Client-Side Decorations (CSD) mode.
   * Creates a custom titlebar at the TOP of the window, spanning full width.
   * The titlebar is inserted as a sibling BEFORE #zen-main-app-wrapper so it
   * appears above all other content.
   * @private
   */
  #applyCSDMode() {
    if (!this.#window) return;

    try {
      const doc = this.#window.document;
      doc.documentElement.style.setProperty('--electron-titlebar-background', 'black');

      // Keep CSD-related attributes - the browser draws the titlebar
      doc.documentElement.setAttribute('tabsintitlebar', 'true');

      // Find the main app wrapper - our titlebar goes BEFORE it
      const mainAppWrapper = doc.getElementById('zen-main-app-wrapper');
      if (!mainAppWrapper) {
        log.warn('CSD mode: zen-main-app-wrapper not found');
        return;
      }

      // Create the electron titlebar container - this will span full width at top
      const electronTitlebar = doc.createXULElement('hbox');
      electronTitlebar.id = 'electron-titlebar';
      electronTitlebar.setAttribute('align', 'center');

      // Create custom titlebar content container
      const titlebarContent = doc.createXULElement('hbox');
      titlebarContent.id = 'electron-titlebar-content';
      titlebarContent.setAttribute('flex', '1');
      titlebarContent.setAttribute('align', 'center');
      titlebarContent.style.setProperty('--electron-titlebar-background', 'black');

      // Add app icon (optional, can be set via API)
      const titlebarIcon = doc.createXULElement('image');
      titlebarIcon.id = 'electron-titlebar-icon';
      titlebarIcon.style.display = 'none'; // Hidden by default
      titlebarContent.appendChild(titlebarIcon);

      // Add title label
      const titlebarTitle = doc.createXULElement('label');
      titlebarTitle.id = 'electron-titlebar-title';
      titlebarTitle.setAttribute('flex', '1');
      titlebarTitle.setAttribute('crop', 'end');
      titlebarTitle.textContent = this.#options.title || 'Electron App';
      titlebarContent.appendChild(titlebarTitle);

      // Add a slot for custom app content (e.g., menu bar, search, etc.)
      const titlebarSlot = doc.createXULElement('hbox');
      titlebarSlot.id = 'electron-titlebar-slot';
      titlebarSlot.setAttribute('align', 'center');
      titlebarContent.appendChild(titlebarSlot);

      electronTitlebar.appendChild(titlebarContent);

      // Get window control buttons from nav-bar and clone them
      const navBar = doc.getElementById('nav-bar');
      let buttonboxContainer = navBar?.querySelector('.titlebar-buttonbox-container');
      
      if (!buttonboxContainer) {
        // Try to find it elsewhere in the document
        buttonboxContainer = doc.querySelector('.titlebar-buttonbox-container');
      }

      if (buttonboxContainer) {
        // Clone the buttons so we don't break the original nav-bar
        const clonedButtonbox = buttonboxContainer.cloneNode(true);
        electronTitlebar.appendChild(clonedButtonbox);
        log.debug('CSD mode: Cloned window control buttons to titlebar');
      } else {
        // Create window control buttons manually if not found
        log.warn('CSD mode: Window control buttons not found, creating manually');
        const buttonbox = this.#createWindowControlButtons(doc);
        electronTitlebar.appendChild(buttonbox);
      }

      // Insert the titlebar BEFORE the main app wrapper
      mainAppWrapper.parentNode.insertBefore(electronTitlebar, mainAppWrapper);

      // Update title when document title changes
      const observer = new doc.defaultView.MutationObserver(() => {
        if (doc.title && titlebarTitle) {
          titlebarTitle.textContent = doc.title;
        }
      });
      observer.observe(doc.querySelector('title') || doc.head, {
        childList: true,
        subtree: true,
        characterData: true,
      });

      // Store reference for API access
      this.#titlebarContent = titlebarContent;

      log.debug('CSD mode enabled with custom titlebar at top of window');
    } catch (e) {
      log.warn('Could not apply CSD mode:', e);
    }
  }

  /**
   * Create window control buttons (min/max/close) manually.
   * Used as fallback if buttons aren't found in the DOM.
   * @private
   */
  #createWindowControlButtons(doc) {
    const container = doc.createXULElement('hbox');
    container.className = 'titlebar-buttonbox-container';
    container.style.cssText = 'display: flex; align-items: center; -moz-window-dragging: no-drag;';

    const buttonbox = doc.createXULElement('hbox');
    buttonbox.className = 'titlebar-buttonbox';
    buttonbox.style.cssText = 'display: flex; align-items: center;';

    // Minimize button
    const minBtn = doc.createXULElement('toolbarbutton');
    minBtn.className = 'titlebar-button titlebar-min';
    minBtn.setAttribute('command', 'cmd_minimizeWindow');
    minBtn.setAttribute('data-l10n-id', 'browser-window-minimize-button');
    buttonbox.appendChild(minBtn);

    // Maximize button
    const maxBtn = doc.createXULElement('toolbarbutton');
    maxBtn.className = 'titlebar-button titlebar-max';
    maxBtn.setAttribute('command', 'cmd_maximizeWindow');
    maxBtn.setAttribute('data-l10n-id', 'browser-window-maximize-button');
    buttonbox.appendChild(maxBtn);

    // Restore button (shown when maximized)
    const restoreBtn = doc.createXULElement('toolbarbutton');
    restoreBtn.className = 'titlebar-button titlebar-restore';
    restoreBtn.setAttribute('command', 'cmd_restoreWindow');
    restoreBtn.setAttribute('data-l10n-id', 'browser-window-restore-down-button');
    buttonbox.appendChild(restoreBtn);

    // Close button
    const closeBtn = doc.createXULElement('toolbarbutton');
    closeBtn.className = 'titlebar-button titlebar-close';
    closeBtn.setAttribute('command', 'cmd_closeWindow');
    closeBtn.setAttribute('data-l10n-id', 'browser-window-close-button');
    buttonbox.appendChild(closeBtn);

    container.appendChild(buttonbox);
    return container;
  }

  /**
   * Get the custom titlebar content element (CSD mode only).
   * Apps can use this to inject custom content into the titlebar.
   * @returns {Element|null}
   */
  getTitlebarContent() {
    return this.#titlebarContent || null;
  }

  /**
   * Set the titlebar icon (CSD mode only).
   * @param {string} iconPath - Path to the icon image
   */
  setTitlebarIcon(iconPath) {
    if (!this.#window) return;
    const icon = this.#window.document.getElementById('electron-titlebar-icon');
    if (icon) {
      icon.src = iconPath;
      icon.style.display = iconPath ? '' : 'none';
    }
  }

  /**
   * Set custom CSS variables for titlebar styling (CSD mode only).
   * @param {Object} styles - Object with style properties
   * @param {string} [styles.background] - Titlebar background color
   * @param {string} [styles.color] - Titlebar text color
   * @param {string} [styles.height] - Titlebar height
   */
  setTitlebarStyle(styles) {
    if (!this.#window) return;
    const root = this.#window.document.documentElement;
    if (styles.background) {
      root.style.setProperty('--electron-titlebar-background', styles.background);
    }
    if (styles.color) {
      root.style.setProperty('--electron-titlebar-color', styles.color);
    }
    if (styles.height) {
      root.style.setProperty('--electron-titlebar-height', styles.height);
    }
  }

  // /**
  //  * Create a standalone Gecko window (legacy experimental method).
  //  * @private
  //  */
  // #createStandaloneWindow() {
  //   try {
  //     log.debug(`Creating Gecko window for BrowserWindow id=${this.#id}`);

  //     // Build window features string
  //     const features = this.#buildWindowFeatures();

  //     // Create window using Gecko's window watcher
  //     // We create a minimal chrome window that hosts a browser element
  //     const windowURL = 'chrome://electron-host/content/electron-window.xhtml';

  //     log.debug(`Opening window with URL: ${windowURL}, features: ${features}`);

  //     this.#window = Services.ww.openWindow(
  //       null, // No parent
  //       windowURL,
  //       `electron-window-${this.#id}`,
  //       features,
  //       null // No arguments for now
  //     );

  //     if (!this.#window) {
  //       throw new Error('Failed to create window');
  //     }

  //     log.info(`Gecko window created successfully for BrowserWindow id=${this.#id}`);

  //     // Wait for window to load
  //     this.#window.addEventListener(
  //       'load',
  //       () => {
  //         this.#onWindowLoad();
  //       },
  //       { once: true }
  //     );

  //     // Set up window event handlers
  //     this.#setupWindowEvents();
  //   } catch (e) {
  //     log.error('BrowserWindow: Failed to create window:', e);
  //     // Fall back to creating a browser element in existing window
  //     this.#createFallbackWindow();
  //   }
  // }

  /**
   * Called when new browser window loads (initial load event).
   * @private
   */
  #onBrowserWindowLoad() {
    log.debug('Browser window load event fired');
    // The actual configuration happens in #configureWindowForElectron
    // which is called after browser-delayed-startup-finished
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
   * Fallback: create browser in existing Zen window (as a tab).
   * Used when standalone window creation fails or for debugging.
   * @private
   */
  #createFallbackWindow() {
    log.info('BrowserWindow: Using fallback browser creation (tab mode)');

    // Get or create a host window
    const hostWindow = Services.wm.getMostRecentWindow('navigator:browser');

    if (hostWindow && hostWindow.gBrowser) {
      log.debug('Found host window, creating tab');

      // Build tab options with sandboxing
      const tabOptions = {
        triggeringPrincipal:
          Services.scriptSecurityManager.getSystemPrincipal(),
      };

      // Apply container isolation if app ID is set
      if (this.#appId) {
        const containerId = lazy.AppSandbox.getOrCreateContainer(this.#appId);
        tabOptions.userContextId = containerId;
        log.debug(`Using container ${containerId} for app ${this.#appId}`);
      }

      // Create a new tab with our content
      const tab = hostWindow.gBrowser.addTab('about:blank', tabOptions);

      // Select the tab to make it visible
      hostWindow.gBrowser.selectedTab = tab;

      this.#browser = hostWindow.gBrowser.getBrowserForTab(tab);
      this.#window = hostWindow;

      // Store reference to the tab
      this.#tab = tab;

      // Tag the browser with app ID for sandbox enforcement
      if (this.#appId) {
        this.#browser.__electronAppId = this.#appId;
        lazy.AppSandbox.enforceAppBoundary(hostWindow, this.#appId);
      }

      // Attach webContents to browser
      this.#webContents.attachBrowser(this.#browser);

      this.#isVisible = this.#options.show;

      log.info(`Fallback window (tab) ready for BrowserWindow id=${this.#id}`);

      // Resolve the ready promise
      if (this.#readyResolve) {
        this.#readyResolve();
      }

      this.emit('ready-to-show');

      if (this.#options.show) {
        this.emit('show');
      }
    } else {
      log.error('BrowserWindow: No host window available for fallback');
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
    if (this.#isDestroyed) return;

    if (this.#isStandalone && this.#window) {
      // Standalone window - close the entire window
      this.#window.close();
    } else if (this.#tab && this.#window?.gBrowser) {
      // Tab mode - just close the tab
      this.#window.gBrowser.removeTab(this.#tab);
    }
  }

  /**
   * Destroy the window.
   */
  destroy() {
    if (this.#isDestroyed) return;

    this.#isDestroyed = true;

    // Unregister preload scripts
    lazy.PreloadManager.unregister(this.#webContents.id);

    // Clean up webContents
    this.#webContents.destroy();

    // Unregister from WindowManager
    lazy.WindowManager.unregisterWindow(this.#id);

    // Close actual window/tab if still open
    if (this.#isStandalone) {
      // Standalone window
      if (this.#window && !this.#window.closed) {
        try {
          this.#window.close();
        } catch (e) {
          // Window may already be closing
        }
      }
    } else if (this.#tab && this.#window?.gBrowser) {
      // Tab mode - just close the tab
      try {
        this.#window.gBrowser.removeTab(this.#tab);
      } catch (e) {
        // Tab may already be closed
      }
    }

    this.#window = null;
    this.#browser = null;
    this.#tab = null;

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
  async loadURL(url, options = {}) {
    // Wait for the window to be ready before loading
    await this.#readyPromise;
    return this.#webContents.loadURL(url, options);
  }

  /**
   * Load a file.
   * @param {string} filePath
   * @param {Object} [options]
   * @returns {Promise<void>}
   */
  async loadFile(filePath, options = {}) {
    // Wait for the window to be ready before loading
    await this.#readyPromise;
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
