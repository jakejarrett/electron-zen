// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

/**
 * contextBridge - Electron-compatible context bridge module.
 *
 * The contextBridge module provides a safe, bidirectional, synchronous bridge
 * to expose APIs from preload scripts to the renderer process without leaking
 * privileged objects.
 *
 * This implementation uses Cu.exportFunction() and Cu.cloneInto() to safely
 * expose APIs to untrusted content, maintaining proper Gecko security boundaries.
 *
 * @see https://www.electronjs.org/docs/latest/api/context-bridge
 */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  createLogger: 'resource:///modules/electron/common/debug.sys.mjs',
});

const log = lazy.createLogger('contextBridge');

/**
 * Check if a value is a plain object.
 */
function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/**
 * Check if a value can be cloned.
 */
function isCloneable(value) {
  const type = typeof value;
  return (
    type === 'string' ||
    type === 'number' ||
    type === 'boolean' ||
    type === 'undefined' ||
    value === null ||
    Array.isArray(value) ||
    isPlainObject(value)
  );
}

/**
 * Deep clone an object, converting functions to proxied wrappers.
 * This ensures that functions execute in the privileged context
 * but receive and return values from/to the content context.
 *
 * @param {*} value - Value to clone
 * @param {Window} targetWindow - The content window to expose to
 * @param {object} options - Clone options
 * @returns {*} - Cloned value safe for content
 */
function deepCloneForContent(value, targetWindow, options = {}) {
  const seen = new WeakMap();

  function clone(val, path = '') {
    // Primitive values
    if (val === null || val === undefined) {
      return val;
    }

    const type = typeof val;

    if (type === 'string' || type === 'number' || type === 'boolean') {
      return val;
    }

    // Check for circular references
    if (type === 'object' && seen.has(val)) {
      return seen.get(val);
    }

    // Functions need special handling - export them so they run in privileged context
    if (type === 'function') {
      // Create a wrapper that will be called from content
      const wrapper = function (...args) {
        // Clone args from content to chrome
        const chromeArgs = args.map((arg) => {
          // Handle callbacks passed from content
          if (typeof arg === 'function') {
            // Wrap content callback to be callable from chrome
            return (...callbackArgs) => {
              const clonedCallbackArgs = callbackArgs.map((a) =>
                clone(a, path + '.callback')
              );
              try {
                return arg(...clonedCallbackArgs);
              } catch (e) {
                log.error('Callback error at', path, ':', e);
                throw e;
              }
            };
          }
          // Clone other args
          try {
            return Cu.cloneInto(arg, val, { cloneFunctions: false });
          } catch (e) {
            // If cloning fails, try to use the value directly
            return arg;
          }
        });

        try {
          // Call the actual function in privileged context
          const result = val.apply(this, chromeArgs);

          // Handle promises
          if (result && typeof result.then === 'function') {
            return new targetWindow.Promise((resolve, reject) => {
              result.then(
                (res) => {
                  resolve(clone(res, path + '.result'));
                },
                (err) => {
                  // Clone error to content
                  const contentError = new targetWindow.Error(
                    err?.message || String(err)
                  );
                  if (err?.stack) {
                    contentError.stack = err.stack;
                  }
                  reject(contentError);
                }
              );
            });
          }

          // Clone result to content
          return clone(result, path + '.result');
        } catch (e) {
          log.error('Function call error at', path, ':', e);
          // Re-throw as content error
          const contentError = new targetWindow.Error(e?.message || String(e));
          if (e?.stack) {
            contentError.stack = e.stack;
          }
          throw contentError;
        }
      };

      // Export the function to content
      return Cu.exportFunction(wrapper, targetWindow, {
        allowCrossOriginArguments: true,
      });
    }

    // Arrays
    if (Array.isArray(val)) {
      const clonedArray = Cu.cloneInto([], targetWindow);
      seen.set(val, clonedArray);

      for (let i = 0; i < val.length; i++) {
        clonedArray[i] = clone(val[i], `${path}[${i}]`);
      }

      return clonedArray;
    }

    // Objects
    if (isPlainObject(val)) {
      const clonedObj = Cu.cloneInto({}, targetWindow);
      seen.set(val, clonedObj);

      for (const key of Object.keys(val)) {
        const descriptor = Object.getOwnPropertyDescriptor(val, key);

        if (descriptor.get || descriptor.set) {
          // Handle getters/setters
          const propDescriptor = {};

          if (descriptor.get) {
            propDescriptor.get = Cu.exportFunction(
              function () {
                return clone(descriptor.get.call(val), `${path}.${key}`);
              },
              targetWindow
            );
          }

          if (descriptor.set) {
            propDescriptor.set = Cu.exportFunction(
              function (newVal) {
                descriptor.set.call(val, newVal);
              },
              targetWindow
            );
          }

          propDescriptor.configurable = descriptor.configurable;
          propDescriptor.enumerable = descriptor.enumerable;

          Object.defineProperty(clonedObj, key, propDescriptor);
        } else {
          clonedObj[key] = clone(val[key], `${path}.${key}`);
        }
      }

      return clonedObj;
    }

    // For complex objects (Date, Map, Set, etc.), try to clone
    try {
      return Cu.cloneInto(val, targetWindow, { cloneFunctions: false });
    } catch (e) {
      log.warn('Failed to clone value at', path, ':', e);
      return undefined;
    }
  }

  return clone(value);
}

/**
 * Create a contextBridge instance for a specific content window.
 *
 * @param {Window} contentWindow - The content window to bridge to
 * @returns {object} - contextBridge API
 */
export function createContextBridge(contentWindow) {
  if (!contentWindow) {
    throw new Error('contextBridge requires a content window');
  }

  const exposedAPIs = new Map();

  return {
    /**
     * Expose an API to the content window.
     *
     * @param {string} apiKey - The key to expose the API under (e.g., 'myAPI')
     * @param {object} api - The API object to expose
     *
     * @example
     * contextBridge.exposeInMainWorld('myAPI', {
     *   doSomething: () => ipcRenderer.invoke('do-something'),
     *   version: '1.0.0'
     * });
     *
     * // In renderer:
     * window.myAPI.doSomething();
     */
    exposeInMainWorld(apiKey, api) {
      if (typeof apiKey !== 'string' || !apiKey) {
        throw new Error('apiKey must be a non-empty string');
      }

      if (api === null || api === undefined) {
        throw new Error('api must be defined');
      }

      log.info('exposeInMainWorld:', apiKey);

      try {
        // Check if already exposed
        if (exposedAPIs.has(apiKey)) {
          log.warn(`API '${apiKey}' already exposed, replacing`);
        }

        // Clone and expose the API to content
        const exposedAPI = deepCloneForContent(api, contentWindow);

        // Define property on content window
        Object.defineProperty(contentWindow.wrappedJSObject, apiKey, {
          value: exposedAPI,
          writable: false,
          enumerable: true,
          configurable: false,
        });

        exposedAPIs.set(apiKey, exposedAPI);

        log.debug('Successfully exposed:', apiKey);
      } catch (e) {
        log.error('Failed to expose API:', apiKey, e);
        throw e;
      }
    },

    /**
     * Expose an API to an isolated world (not the main world).
     * In Gecko, this is equivalent to exposeInMainWorld since we don't
     * have the same isolated world concept as Chromium.
     *
     * @param {number} worldId - The isolated world ID
     * @param {string} apiKey - The key to expose the API under
     * @param {object} api - The API object to expose
     */
    exposeInIsolatedWorld(worldId, apiKey, api) {
      log.warn(
        'exposeInIsolatedWorld is equivalent to exposeInMainWorld in Gecko'
      );
      this.exposeInMainWorld(apiKey, api);
    },
  };
}

/**
 * contextBridge module singleton.
 *
 * Note: In Electron, contextBridge is available in preload scripts.
 * In Gecko, you need to create an instance with the target content window.
 *
 * For preload scripts, use the preloadContext which provides contextBridge.
 */
export const contextBridge = {
  /**
   * Check if context isolation is enabled.
   * In Gecko, we always operate with isolation.
   */
  get contextIsolationEnabled() {
    return true;
  },

  /**
   * Expose an API - requires a content window context.
   * This will throw if called without proper context.
   */
  exposeInMainWorld(apiKey, api) {
    throw new Error(
      'contextBridge.exposeInMainWorld requires a content window context. ' +
        'Use createContextBridge(contentWindow) instead, or access via preload context.'
    );
  },

  /**
   * Create a contextBridge for a specific window.
   */
  create: createContextBridge,
};

export default contextBridge;
