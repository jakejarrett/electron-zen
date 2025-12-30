// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

/**
 * AppRegistry - Manages registered Electron apps and their configurations.
 *
 * Handles:
 * - App manifest parsing and validation
 * - App discovery and registration
 * - Container/isolation assignment
 * - App metadata storage
 */

/**
 * @typedef {Object} AppManifest
 * @property {string} name - App name
 * @property {string} main - Main script entry point
 * @property {string} [version] - App version
 * @property {Object} [geckoElectron] - Gecko-electron specific config
 * @property {string} [geckoElectron.appId] - Unique app identifier
 * @property {string} [geckoElectron.containerId] - Container for isolation
 * @property {string[]} [geckoElectron.permissions] - Required permissions
 * @property {boolean} [geckoElectron.sandbox] - Enable sandbox
 */

/**
 * @typedef {Object} RegisteredApp
 * @property {string} id - Unique app identifier
 * @property {AppManifest} manifest - Parsed manifest
 * @property {string} basePath - App's base directory
 * @property {number} containerId - Assigned container ID
 * @property {Date} registeredAt - Registration timestamp
 */

class AppRegistrySingleton {
  /** @type {Map<string, RegisteredApp>} */
  #apps = new Map();

  /** @type {number} */
  #nextContainerId = 1000; // Start high to avoid conflicts with Firefox containers

  /**
   * Register an app with the registry.
   * @param {string} appId - Unique identifier for the app
   * @param {AppManifest} manifest - App manifest
   * @param {string} basePath - Base path of the app
   * @returns {RegisteredApp}
   */
  register(appId, manifest, basePath) {
    if (this.#apps.has(appId)) {
      throw new Error(`App already registered: ${appId}`);
    }

    const app = {
      id: appId,
      manifest,
      basePath,
      containerId: this.#assignContainer(appId, manifest),
      registeredAt: new Date(),
    };

    this.#apps.set(appId, app);
    console.log(`AppRegistry: Registered app '${appId}' from ${basePath}`);

    return app;
  }

  /**
   * Unregister an app.
   * @param {string} appId - The app identifier
   * @returns {boolean} - True if app was found and removed
   */
  unregister(appId) {
    const existed = this.#apps.delete(appId);
    if (existed) {
      console.log(`AppRegistry: Unregistered app '${appId}'`);
    }
    return existed;
  }

  /**
   * Get a registered app by ID.
   * @param {string} appId - The app identifier
   * @returns {RegisteredApp|undefined}
   */
  get(appId) {
    return this.#apps.get(appId);
  }

  /**
   * Check if an app is registered.
   * @param {string} appId - The app identifier
   * @returns {boolean}
   */
  has(appId) {
    return this.#apps.has(appId);
  }

  /**
   * Get all registered apps.
   * @returns {RegisteredApp[]}
   */
  getAll() {
    return Array.from(this.#apps.values());
  }

  /**
   * Get all app IDs.
   * @returns {string[]}
   */
  getAllIds() {
    return Array.from(this.#apps.keys());
  }

  /**
   * Parse and validate an app manifest.
   * @param {Object} rawManifest - Raw manifest object (usually from package.json)
   * @returns {AppManifest}
   */
  parseManifest(rawManifest) {
    if (!rawManifest.name) {
      throw new Error('Manifest must have a name');
    }

    if (!rawManifest.main) {
      throw new Error('Manifest must have a main entry point');
    }

    return {
      name: rawManifest.name,
      main: rawManifest.main,
      version: rawManifest.version || '0.0.0',
      geckoElectron: {
        appId:
          rawManifest['gecko-electron']?.appId ||
          this.#generateAppId(rawManifest.name),
        containerId: rawManifest['gecko-electron']?.containerId || null,
        permissions: rawManifest['gecko-electron']?.permissions || [],
        sandbox: rawManifest['gecko-electron']?.sandbox ?? true,
      },
    };
  }

  /**
   * Load a manifest from a file path.
   * @param {string} manifestPath - Path to package.json or manifest file
   * @returns {Promise<AppManifest>}
   */
  async loadManifest(manifestPath) {
    try {
      const content = await IOUtils.readUTF8(manifestPath);
      const rawManifest = JSON.parse(content);
      return this.parseManifest(rawManifest);
    } catch (e) {
      throw new Error(`Failed to load manifest from ${manifestPath}: ${e.message}`);
    }
  }

  /**
   * Generate a unique app ID from the app name.
   * @param {string} name - App name
   * @returns {string}
   * @private
   */
  #generateAppId(name) {
    // Convert name to lowercase, replace spaces with dashes, remove special chars
    const base = name
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
    return `app.${base}`;
  }

  /**
   * Assign a container ID for app isolation.
   * @param {string} appId - The app identifier
   * @param {AppManifest} manifest - App manifest
   * @returns {number}
   * @private
   */
  #assignContainer(appId, manifest) {
    // If manifest specifies a container name, generate consistent ID
    if (manifest.geckoElectron?.containerId) {
      return this.#hashString(manifest.geckoElectron.containerId);
    }

    // Otherwise assign sequential container
    return this.#nextContainerId++;
  }

  /**
   * Simple string hash for consistent container IDs.
   * @param {string} str - String to hash
   * @returns {number}
   * @private
   */
  #hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash) + 1000; // Ensure positive and above Firefox containers
  }
}

// Export singleton instance
export const AppRegistry = new AppRegistrySingleton();
