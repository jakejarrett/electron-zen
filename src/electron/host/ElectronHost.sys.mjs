// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

/**
 * ElectronHost - The singleton that manages the Gecko Electron runtime.
 *
 * This is the central coordinator for all Electron-compatible apps running
 * in the shared Gecko runtime. It handles:
 * - Runtime lifecycle (startup, shutdown)
 * - App registration and isolation
 * - Window management coordination
 * - IPC routing between apps
 */

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  WindowManager: 'resource://gre/modules/electron/host/WindowManager.sys.mjs',
  AppRegistry: 'resource://gre/modules/electron/host/AppRegistry.sys.mjs',
});

/**
 * @typedef {Object} ElectronHostState
 * @property {boolean} initialized - Whether the host has been initialized
 * @property {boolean} ready - Whether the host is ready for apps
 * @property {boolean} shuttingDown - Whether shutdown is in progress
 */

class ElectronHostSingleton {
  /** @type {ElectronHostState} */
  #state = {
    initialized: false,
    ready: false,
    shuttingDown: false,
  };

  /** @type {Set<string>} */
  #runningApps = new Set();

  /** @type {Promise<void>|null} */
  #readyPromise = null;

  /** @type {Function|null} */
  #readyResolver = null;

  constructor() {
    // Set up the ready promise
    this.#readyPromise = new Promise((resolve) => {
      this.#readyResolver = resolve;
    });
  }

  /**
   * Initialize the Electron host runtime.
   * This should be called once during browser startup.
   */
  async init() {
    if (this.#state.initialized) {
      console.warn('ElectronHost: Already initialized');
      return;
    }

    console.log('ElectronHost: Initializing...');

    try {
      // Register for shutdown notifications
      Services.obs.addObserver(this, 'quit-application-requested');
      Services.obs.addObserver(this, 'quit-application');

      // Initialize subsystems
      // WindowManager and AppRegistry will be lazily loaded when needed

      this.#state.initialized = true;
      this.#state.ready = true;

      // Resolve the ready promise
      if (this.#readyResolver) {
        this.#readyResolver();
      }

      console.log('ElectronHost: Initialized successfully');
    } catch (e) {
      console.error('ElectronHost: Initialization failed:', e);
      throw e;
    }
  }

  /**
   * Check if the host is ready.
   * @returns {boolean}
   */
  isReady() {
    return this.#state.ready;
  }

  /**
   * Wait for the host to be ready.
   * @returns {Promise<void>}
   */
  whenReady() {
    return this.#readyPromise;
  }

  /**
   * Register a new app with the host.
   * @param {string} appId - Unique identifier for the app
   * @param {Object} manifest - App manifest/configuration
   * @returns {Promise<Object>} - App context object
   */
  async registerApp(appId, manifest) {
    if (this.#runningApps.has(appId)) {
      throw new Error(`App already registered: ${appId}`);
    }

    console.log(`ElectronHost: Registering app '${appId}'`);

    const appContext = {
      id: appId,
      manifest,
      startTime: Date.now(),
      windows: new Set(),
    };

    this.#runningApps.add(appId);

    return appContext;
  }

  /**
   * Unregister an app from the host.
   * @param {string} appId - The app identifier
   */
  async unregisterApp(appId) {
    if (!this.#runningApps.has(appId)) {
      console.warn(`ElectronHost: App not registered: ${appId}`);
      return;
    }

    console.log(`ElectronHost: Unregistering app '${appId}'`);

    // Close all windows for this app
    await lazy.WindowManager.closeAppWindows(appId);

    this.#runningApps.delete(appId);

    // If no more apps running and we're not in browser mode, consider shutdown
    if (this.#runningApps.size === 0) {
      this.#onAllAppsClosed();
    }
  }

  /**
   * Get the list of running app IDs.
   * @returns {string[]}
   */
  getRunningApps() {
    return Array.from(this.#runningApps);
  }

  /**
   * Get the WindowManager instance.
   * @returns {WindowManager}
   */
  get windowManager() {
    return lazy.WindowManager;
  }

  /**
   * Get the AppRegistry instance.
   * @returns {AppRegistry}
   */
  get appRegistry() {
    return lazy.AppRegistry;
  }

  /**
   * Called when all apps have closed.
   * @private
   */
  #onAllAppsClosed() {
    // Emit event for app module to handle
    Services.obs.notifyObservers(null, 'electron-all-windows-closed');
  }

  /**
   * Request application shutdown.
   * @param {number} [exitCode=0] - Exit code
   */
  quit(exitCode = 0) {
    if (this.#state.shuttingDown) {
      return;
    }

    console.log(`ElectronHost: Quit requested (exitCode: ${exitCode})`);
    this.#state.shuttingDown = true;

    // Notify apps of impending shutdown
    Services.obs.notifyObservers(null, 'electron-before-quit');

    // Use Gecko's quit mechanism
    const cancelQuit = Cc['@mozilla.org/supports-PRBool;1'].createInstance(
      Ci.nsISupportsPRBool
    );
    Services.obs.notifyObservers(cancelQuit, 'quit-application-requested');

    if (!cancelQuit.data) {
      Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);
    } else {
      this.#state.shuttingDown = false;
    }
  }

  /**
   * Force immediate exit.
   * @param {number} [exitCode=0] - Exit code
   */
  exit(exitCode = 0) {
    console.log(`ElectronHost: Force exit (exitCode: ${exitCode})`);
    Services.startup.quit(Ci.nsIAppStartup.eForceQuit);
  }

  /**
   * Observer notification handler.
   */
  observe(subject, topic, data) {
    switch (topic) {
      case 'quit-application-requested':
        Services.obs.notifyObservers(null, 'electron-before-quit');
        break;

      case 'quit-application':
        this.#cleanup();
        break;
    }
  }

  /**
   * Clean up resources on shutdown.
   * @private
   */
  #cleanup() {
    console.log('ElectronHost: Cleaning up...');

    try {
      Services.obs.removeObserver(this, 'quit-application-requested');
      Services.obs.removeObserver(this, 'quit-application');
    } catch (e) {
      // Observers may already be removed
    }

    this.#runningApps.clear();
    this.#state.ready = false;
    this.#state.shuttingDown = false;
  }
}

// Export singleton instance
export const ElectronHost = new ElectronHostSingleton();
