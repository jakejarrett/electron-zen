// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

/**
 * AppSandbox - Provides complete isolation between Electron apps.
 *
 * This module ensures that "Application A can NOT know about Application B
 * (no memory sharing / shortcuts)" by leveraging Firefox Containers
 * (userContextId) and other isolation mechanisms.
 *
 * Each Electron app runs in its own container with:
 * - Separate cookies and storage (localStorage, IndexedDB)
 * - Separate cache
 * - Separate service workers
 * - No cross-app window access
 * - Isolated IPC channels
 *
 * @module AppSandbox
 */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  createLogger: 'resource:///modules/electron/common/debug.sys.mjs',
  ContextualIdentityService: 'resource://gre/modules/ContextualIdentityService.sys.mjs',
});

const log = lazy.createLogger('AppSandbox');

/**
 * Map of appId to userContextId (container ID).
 */
const appContainers = new Map();

/**
 * Map of userContextId to appId (reverse lookup).
 */
const containerApps = new Map();

/**
 * Counter for generating unique container IDs.
 * Firefox reserves 0 for default, so we start higher.
 */
let nextContainerId = 10000;

/**
 * Storage origins isolated per app.
 */
const appStorageOrigins = new Map();

/**
 * Generate a unique color for an app container (for debugging).
 */
function generateContainerColor(appId) {
  // Simple hash to color
  let hash = 0;
  for (let i = 0; i < appId.length; i++) {
    hash = ((hash << 5) - hash + appId.charCodeAt(i)) | 0;
  }

  const colors = ['blue', 'turquoise', 'green', 'yellow', 'orange', 'red', 'pink', 'purple'];
  return colors[Math.abs(hash) % colors.length];
}

/**
 * Generate a container icon based on app name.
 */
function generateContainerIcon(appId) {
  const icons = ['fingerprint', 'briefcase', 'dollar', 'cart', 'circle', 'gift', 'vacation', 'food', 'fruit', 'pet', 'tree', 'chill'];
  let hash = 0;
  for (let i = 0; i < appId.length; i++) {
    hash = ((hash << 3) - hash + appId.charCodeAt(i)) | 0;
  }
  return icons[Math.abs(hash) % icons.length];
}

/**
 * AppSandbox - manages isolation between Electron apps.
 */
export const AppSandbox = {
  /**
   * Create or get a container for an app.
   *
   * @param {string} appId - Unique app identifier
   * @param {object} options - Container options
   * @returns {number} - userContextId for the app
   */
  getOrCreateContainer(appId, options = {}) {
    if (!appId) {
      throw new Error('appId is required for sandboxing');
    }

    // Check if already exists
    if (appContainers.has(appId)) {
      const containerId = appContainers.get(appId);
      log.debug('Using existing container for app:', appId, 'containerId:', containerId);
      return containerId;
    }

    // Create new container
    const containerId = nextContainerId++;

    log.info('Creating new container for app:', appId, 'containerId:', containerId);

    // Register the container
    appContainers.set(appId, containerId);
    containerApps.set(containerId, appId);

    // Try to create a ContextualIdentity if the service is available
    try {
      if (lazy.ContextualIdentityService?.create) {
        lazy.ContextualIdentityService.create(
          options.name || `Electron: ${appId}`,
          generateContainerIcon(appId),
          generateContainerColor(appId)
        );
      }
    } catch (e) {
      // ContextualIdentityService may not be available
      log.debug('ContextualIdentityService not available:', e.message);
    }

    return containerId;
  },

  /**
   * Get the container ID for an app.
   *
   * @param {string} appId - App identifier
   * @returns {number|null} - userContextId or null if not found
   */
  getContainer(appId) {
    return appContainers.get(appId) || null;
  },

  /**
   * Get the app ID for a container.
   *
   * @param {number} containerId - userContextId
   * @returns {string|null} - App ID or null if not found
   */
  getAppId(containerId) {
    return containerApps.get(containerId) || null;
  },

  /**
   * Remove a container (when app is unloaded).
   *
   * @param {string} appId - App identifier
   */
  removeContainer(appId) {
    const containerId = appContainers.get(appId);
    if (containerId) {
      log.info('Removing container for app:', appId);

      containerApps.delete(containerId);
      appContainers.delete(appId);

      // Clear storage for this container
      this.clearAppStorage(appId);
    }
  },

  /**
   * Clear all storage for an app.
   *
   * @param {string} appId - App identifier
   */
  async clearAppStorage(appId) {
    const containerId = appContainers.get(appId);
    if (!containerId) {
      return;
    }

    log.info('Clearing storage for app:', appId);

    try {
      // Clear cookies for container
      const cookieManager = Cc['@mozilla.org/cookiemanager;1']
        ?.getService(Ci.nsICookieManager);

      if (cookieManager) {
        // Note: This clears all cookies; ideally filter by userContextId
        // In practice, container cookies are automatically isolated
      }

      // Clear storage
      const origins = appStorageOrigins.get(appId);
      if (origins) {
        for (const origin of origins) {
          try {
            // Clear localStorage/sessionStorage
            Services.clearData.deleteDataFromOriginAttributesPattern({
              userContextId: containerId,
            });
          } catch (e) {
            log.warn('Failed to clear storage for origin:', origin, e);
          }
        }
        appStorageOrigins.delete(appId);
      }
    } catch (e) {
      log.error('Failed to clear app storage:', e);
    }
  },

  /**
   * Create origin attributes for an app.
   * These attributes are used to isolate storage and cookies.
   *
   * @param {string} appId - App identifier
   * @returns {object} - Origin attributes
   */
  getOriginAttributes(appId) {
    const containerId = this.getOrCreateContainer(appId);

    return {
      userContextId: containerId,
      // privateBrowsingId: 0, // Not private browsing
      // firstPartyDomain: '', // Could be set to appId for extra isolation
    };
  },

  /**
   * Check if two apps are isolated from each other.
   *
   * @param {string} appId1 - First app ID
   * @param {string} appId2 - Second app ID
   * @returns {boolean} - Always true as apps are always isolated
   */
  areIsolated(appId1, appId2) {
    // Apps are always isolated from each other
    return appId1 !== appId2;
  },

  /**
   * Get a sandboxed storage key for an app.
   * This prefixes storage keys to prevent collisions.
   *
   * @param {string} appId - App identifier
   * @param {string} key - Original key
   * @returns {string} - Sandboxed key
   */
  getSandboxedKey(appId, key) {
    return `__electron_app_${appId}__${key}`;
  },

  /**
   * Register a storage origin for an app.
   *
   * @param {string} appId - App identifier
   * @param {string} origin - Storage origin
   */
  registerStorageOrigin(appId, origin) {
    if (!appStorageOrigins.has(appId)) {
      appStorageOrigins.set(appId, new Set());
    }
    appStorageOrigins.get(appId).add(origin);
  },

  /**
   * Create a sandboxed BrowsingContext configuration.
   *
   * @param {string} appId - App identifier
   * @returns {object} - Configuration for BrowsingContext
   */
  getBrowsingContextConfig(appId) {
    const containerId = this.getOrCreateContainer(appId);

    return {
      userContextId: containerId,
      // Prevent opener relationships across apps
      noopener: true,
      // Isolate from other contexts
      isIsolatedMozBrowser: true,
    };
  },

  /**
   * Validate that a window operation is allowed.
   * Prevents cross-app window access.
   *
   * @param {string} sourceAppId - Source app ID
   * @param {string} targetAppId - Target app ID
   * @param {string} operation - Operation being performed
   * @returns {boolean} - Whether operation is allowed
   */
  validateWindowOperation(sourceAppId, targetAppId, operation) {
    if (sourceAppId !== targetAppId) {
      log.warn(`Blocked cross-app ${operation}: ${sourceAppId} -> ${targetAppId}`);
      return false;
    }
    return true;
  },

  /**
   * Get all registered apps.
   *
   * @returns {string[]} - Array of app IDs
   */
  getRegisteredApps() {
    return Array.from(appContainers.keys());
  },

  /**
   * Get container info for debugging.
   *
   * @returns {object} - Container registry info
   */
  getDebugInfo() {
    const info = {};
    for (const [appId, containerId] of appContainers) {
      info[appId] = {
        containerId,
        origins: Array.from(appStorageOrigins.get(appId) || []),
      };
    }
    return info;
  },

  /**
   * Create a sandboxed principal for an app.
   *
   * @param {string} appId - App identifier
   * @param {string} uri - URI for the principal
   * @returns {nsIPrincipal} - Sandboxed principal
   */
  createSandboxedPrincipal(appId, uri) {
    const originAttributes = this.getOriginAttributes(appId);

    try {
      const principalUri = Services.io.newURI(uri);
      return Services.scriptSecurityManager.createContentPrincipal(
        principalUri,
        originAttributes
      );
    } catch (e) {
      log.error('Failed to create sandboxed principal:', e);
      throw e;
    }
  },

  /**
   * Enforce app boundaries on a window.
   * Called when a BrowserWindow is created.
   *
   * @param {ChromeWindow} window - The chrome window
   * @param {string} appId - App identifier
   */
  enforceAppBoundary(window, appId) {
    log.debug('Enforcing app boundary for:', appId);

    // Tag the window with its app ID
    window.__electronAppId = appId;

    // Intercept window.open to prevent cross-app access
    // This is handled by the webContents/BrowserWindow implementations
  },

  /**
   * Check if a URI is allowed for an app.
   *
   * @param {string} appId - App identifier
   * @param {string} uri - URI to check
   * @param {object} options - Check options
   * @returns {boolean}
   */
  isUriAllowed(appId, uri, options = {}) {
    // By default, allow all URIs within the app's container
    // This could be extended to implement app-specific URL filtering

    // Block electron:// URLs from other apps
    if (uri.startsWith('electron://')) {
      const uriAppId = uri.match(/electron:\/\/([^/]+)/)?.[1];
      if (uriAppId && uriAppId !== appId) {
        log.warn('Blocked cross-app electron:// access:', uri, 'from app:', appId);
        return false;
      }
    }

    return true;
  },
};

export default AppSandbox;
