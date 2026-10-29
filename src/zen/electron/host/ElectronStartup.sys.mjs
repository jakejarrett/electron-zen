// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

/**
 * ElectronStartup - Handles automatic startup of Electron compatibility layer.
 *
 * This module observes browser startup events and initializes the Electron
 * runtime when the ELECTRON_APP_PATH environment variable is set.
 */

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  ElectronHost: 'resource:///modules/electron/host/ElectronHost.sys.mjs',
});

/**
 * Singleton for electron startup handling.
 */
export const ElectronStartup = {
  _initialized: false,

  /**
   * Initialize - called from the component manifest on browser startup.
   */
  init() {
    if (this._initialized) {
      return;
    }

    // Check if we should activate electron mode
    const appPath = Services.env.get('ELECTRON_APP_PATH');
    if (!appPath) {
      console.log('ElectronStartup: No ELECTRON_APP_PATH set, skipping');
      return;
    }

    this._initialized = true;
    console.log(`ElectronStartup: Found app path: ${appPath}`);

    // Defer actual initialization until browser is ready
    Services.obs.addObserver(this, 'browser-delayed-startup-finished');
  },

  /**
   * Observer callback.
   */
  async observe(subject, topic, data) {
    if (topic === 'browser-delayed-startup-finished') {
      Services.obs.removeObserver(this, 'browser-delayed-startup-finished');
      await this._loadApp();
    }
  },

  /**
   * Load the electron app.
   * @private
   */
  async _loadApp() {
    const appPath = Services.env.get('ELECTRON_APP_PATH');
    if (!appPath) {
      return;
    }

    console.log(`ElectronStartup: Initializing Electron runtime for ${appPath}`);

    try {
      await lazy.ElectronHost.init();
      console.log('ElectronStartup: Electron runtime initialized');
      
      await lazy.ElectronHost.loadAppFromPath(appPath);
      console.log('ElectronStartup: App loaded successfully');
    } catch (e) {
      console.error('ElectronStartup: Failed to load app:', e);
    }
  },
};
