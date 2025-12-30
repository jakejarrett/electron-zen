// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

/**
 * app - Electron-compatible app lifecycle module.
 *
 * Controls the application lifecycle with events and methods matching
 * Electron's app module API.
 *
 * @see https://www.electronjs.org/docs/latest/api/app
 */

import { EventEmitter } from 'resource:///modules/electron/common/EventEmitter.sys.mjs';
import { createLogger } from 'resource:///modules/electron/common/debug.sys.mjs';

const log = createLogger('app');

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  ElectronHost: 'resource:///modules/electron/host/ElectronHost.sys.mjs',
  pathUtils: 'resource:///modules/electron/common/pathUtils.sys.mjs',
});

/**
 * App singleton that provides Electron-compatible app lifecycle API.
 */
class AppModule extends EventEmitter {
  /** @type {boolean} */
  #isQuitting = false;

  /** @type {string|null} */
  #appPath = null;

  /** @type {Map<string, string>} */
  #customPaths = new Map();

  constructor() {
    super();
    this.#setupObservers();
  }

  /**
   * Set up Gecko observers for lifecycle events.
   * @private
   */
  #setupObservers() {
    // Listen for host events
    Services.obs.addObserver(
      {
        observe: (subject, topic) => {
          if (topic === 'electron-before-quit') {
            this.emit('before-quit', { preventDefault: () => {} });
          } else if (topic === 'electron-all-windows-closed') {
            this.emit('window-all-closed');
          }
        },
      },
      'electron-before-quit'
    );

    Services.obs.addObserver(
      {
        observe: () => {
          this.emit('window-all-closed');
        },
      },
      'electron-all-windows-closed'
    );
  }

  // ============================================
  // Lifecycle Methods
  // ============================================

  /**
   * Check if the app is ready.
   * @returns {boolean}
   */
  isReady() {
    return lazy.ElectronHost.isReady();
  }

  /**
   * Returns a Promise that resolves when the app is ready.
   * @returns {Promise<void>}
   */
  whenReady() {
    return lazy.ElectronHost.whenReady();
  }

  /**
   * Quit the application.
   */
  quit() {
    if (this.#isQuitting) {
      return;
    }

    this.#isQuitting = true;
    this.emit('before-quit', {
      preventDefault: () => {
        this.#isQuitting = false;
      },
    });

    if (this.#isQuitting) {
      this.emit('will-quit', {
        preventDefault: () => {
          this.#isQuitting = false;
        },
      });
    }

    if (this.#isQuitting) {
      lazy.ElectronHost.quit();
      this.emit('quit', 0);
    }
  }

  /**
   * Exit immediately with an exit code.
   * @param {number} [exitCode=0] - Exit code
   */
  exit(exitCode = 0) {
    lazy.ElectronHost.exit(exitCode);
  }

  /**
   * Relaunches the app when current instance exits.
   * @param {Object} [options] - Relaunch options
   */
  relaunch(options = {}) {
    // Store intent to relaunch
    Services.prefs.setBoolPref('electron.relaunch-on-exit', true);
    if (options.args) {
      Services.prefs.setStringPref(
        'electron.relaunch-args',
        JSON.stringify(options.args)
      );
    }
  }

  /**
   * Check if the app is currently quitting.
   * @returns {boolean}
   */
  isQuitting() {
    return this.#isQuitting;
  }

  // ============================================
  // Path Methods
  // ============================================

  /**
   * Get a special directory or file path.
   * @param {string} name - Path name
   * @returns {string}
   */
  getPath(name) {
    if (this.#customPaths.has(name)) {
      return this.#customPaths.get(name);
    }
    return lazy.pathUtils.getPath(name);
  }

  /**
   * Override a special path.
   * @param {string} name - Path name
   * @param {string} path - New path value
   */
  setPath(name, path) {
    this.#customPaths.set(name, path);
  }

  /**
   * Get the app's root path.
   * @returns {string}
   */
  getAppPath() {
    if (this.#appPath) {
      return this.#appPath;
    }
    // Default to current working directory or profile
    return this.getPath('userData');
  }

  /**
   * Set the app's root path.
   * @param {string} path - App path
   */
  setAppPath(path) {
    this.#appPath = path;
  }

  // ============================================
  // App Info Methods
  // ============================================

  /**
   * Get the application name.
   * @returns {string}
   */
  getName() {
    return Services.appinfo.name;
  }

  /**
   * Set the application name.
   * @param {string} name - App name
   */
  setName(name) {
    // Note: This is limited in Gecko - mainly affects userData path
    log.warn('app.setName() has limited effect in Gecko Electron');
  }

  /**
   * Get the application version.
   * @returns {string}
   */
  getVersion() {
    return Services.appinfo.version;
  }

  /**
   * Get the current application locale.
   * @returns {string}
   */
  getLocale() {
    return Services.locale.appLocaleAsBCP47;
  }

  /**
   * Get the system locale.
   * @returns {string}
   */
  getSystemLocale() {
    return Services.locale.systemLocale;
  }

  /**
   * Get preferred system languages.
   * @returns {string[]}
   */
  getPreferredSystemLanguages() {
    return Services.locale.systemLocales;
  }

  /**
   * Get the path to the application executable.
   * @returns {string}
   */
  getExePath() {
    return Services.dirsvc.get('XREExeF', Ci.nsIFile).path;
  }

  // ============================================
  // System Methods
  // ============================================

  /**
   * Check if the app is packaged.
   * @returns {boolean}
   */
  isPackaged() {
    // TODO: Implement proper check when packaging is added
    return false;
  }

  /**
   * Get the user agent string.
   * @returns {string}
   */
  getUserAgent() {
    return Cc['@mozilla.org/network/protocol;1?name=http'].getService(
      Ci.nsIHttpProtocolHandler
    ).userAgent;
  }

  /**
   * Set the user agent string for future requests.
   * @param {string} userAgent - New user agent
   */
  setUserAgent(userAgent) {
    Services.prefs.setStringPref(
      'general.useragent.override',
      userAgent
    );
  }

  /**
   * Get badge count (macOS/Linux).
   * @returns {number}
   */
  getBadgeCount() {
    // TODO: Implement platform-specific badge support
    return 0;
  }

  /**
   * Set badge count (macOS/Linux).
   * @param {number} count - Badge count
   * @returns {boolean}
   */
  setBadgeCount(count) {
    // TODO: Implement platform-specific badge support
    log.warn('app.setBadgeCount() not yet implemented');
    return false;
  }

  /**
   * Check if the current process is the main frame.
   * @returns {boolean}
   */
  isMainFrame() {
    return true;
  }

  /**
   * Focus the application.
   */
  focus(options = {}) {
    const { steal = false } = options;
    // Focus the most recently active window
    const win = Services.wm.getMostRecentWindow(null);
    if (win) {
      win.focus();
    }
  }

  /**
   * Hide the application (macOS).
   */
  hide() {
    if (Services.appinfo.OS === 'Darwin') {
      // macOS specific hiding
      const win = Services.wm.getMostRecentWindow(null);
      if (win) {
        win.minimize();
      }
    }
  }

  /**
   * Show the application (macOS).
   */
  show() {
    const win = Services.wm.getMostRecentWindow(null);
    if (win) {
      win.focus();
    }
  }

  /**
   * Check if app is hidden (macOS).
   * @returns {boolean}
   */
  isHidden() {
    return false;
  }

  // ============================================
  // Command Line
  // ============================================

  /**
   * Get the command line arguments.
   * @returns {Object}
   */
  get commandLine() {
    return {
      appendSwitch: (key, value) => {
        log.warn('commandLine.appendSwitch() not supported at runtime');
      },
      appendArgument: (value) => {
        log.warn('commandLine.appendArgument() not supported at runtime');
      },
      hasSwitch: (key) => {
        // TODO: Parse actual command line
        return false;
      },
      getSwitchValue: (key) => {
        // TODO: Parse actual command line
        return '';
      },
    };
  }

  // ============================================
  // Dock (macOS)
  // ============================================

  /**
   * Get the dock API (macOS only).
   * @returns {Object}
   */
  get dock() {
    return {
      bounce: (type = 'informational') => -1,
      cancelBounce: (id) => {},
      downloadFinished: (filePath) => {},
      setBadge: (text) => {},
      getBadge: () => '',
      hide: () => {},
      show: () => Promise.resolve(),
      isVisible: () => true,
      setMenu: (menu) => {},
      getMenu: () => null,
      setIcon: (icon) => {},
    };
  }
}

// Export singleton instance
export const app = new AppModule();
