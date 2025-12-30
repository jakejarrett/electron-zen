// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

/**
 * PreloadManager - Manages preload script execution for Electron apps.
 *
 * Preload scripts run in a privileged context before web content loads,
 * allowing them to:
 * - Access Node.js APIs (when nodeIntegration is enabled)
 * - Use contextBridge to safely expose APIs to the renderer
 * - Set up IPC communication
 *
 * In Gecko, preload scripts run as frame scripts with access to:
 * - The content window (content)
 * - Message passing (sendAsyncMessage, addMessageListener)
 * - ChromeUtils for importing modules
 *
 * @module PreloadManager
 */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  createLogger: 'resource:///modules/electron/common/debug.sys.mjs',
  createContextBridge: 'resource:///modules/electron/renderer/contextBridge.sys.mjs',
  createIpcRenderer: 'resource:///modules/electron/renderer/ipcRenderer.sys.mjs',
});

const log = lazy.createLogger('PreloadManager');

/**
 * Registry of preload scripts per app/window.
 */
const preloadRegistry = new Map();

/**
 * Create a preload execution context.
 * This provides the APIs available to preload scripts.
 *
 * @param {Window} contentWindow - The content window
 * @param {object} options - Preload options
 * @returns {object} - Preload context with Electron APIs
 */
function createPreloadContext(contentWindow, options = {}) {
  const {
    nodeIntegration = false,
    contextIsolation = true,
    webContentsId = null,
    appId = null,
  } = options;

  log.debug('Creating preload context:', { nodeIntegration, contextIsolation, webContentsId });

  // Create contextBridge for this window
  const contextBridge = lazy.createContextBridge(contentWindow);

  // Create ipcRenderer for this window
  const ipcRenderer = lazy.createIpcRenderer(webContentsId);

  // Build the preload context
  const preloadContext = {
    // Electron APIs
    contextBridge,
    ipcRenderer,

    // The content window
    window: contentWindow,

    // Process-like object for compatibility
    process: {
      type: 'renderer',
      versions: {
        electron: '28.0.0', // Compatibility version
        chrome: Services.appinfo.platformVersion,
        node: '18.18.2', // Simulated
        v8: '11.0',
      },
      platform: Services.appinfo.OS === 'Darwin' ? 'darwin' :
                Services.appinfo.OS === 'WINNT' ? 'win32' : 'linux',
      arch: Services.appinfo.XPCOMABI?.includes('x86_64') ? 'x64' :
            Services.appinfo.XPCOMABI?.includes('aarch64') ? 'arm64' : 'x86',
      env: {}, // Sandboxed - no env access
      cwd: () => '/',
      pid: Services.appinfo.processID || 0,
    },

    // Metadata
    __electronAppId: appId,
    __electronWebContentsId: webContentsId,
  };

  // If nodeIntegration is enabled, add Node-like APIs
  if (nodeIntegration) {
    log.warn('nodeIntegration is enabled - this reduces security');

    // Add require-like functionality (limited)
    preloadContext.require = (moduleName) => {
      log.debug('require:', moduleName);

      // Map common modules
      const moduleMap = {
        electron: () => {
          return ChromeUtils.importESModule(
            'resource:///modules/electron/electron.sys.mjs'
          );
        },
        path: () => {
          return ChromeUtils.importESModule(
            'resource:///modules/electron/common/pathUtils.sys.mjs'
          );
        },
        events: () => {
          const { EventEmitter } = ChromeUtils.importESModule(
            'resource:///modules/electron/common/EventEmitter.sys.mjs'
          );
          return { EventEmitter };
        },
      };

      if (moduleMap[moduleName]) {
        return moduleMap[moduleName]();
      }

      throw new Error(`Cannot find module '${moduleName}'`);
    };

    // Add global-like object
    preloadContext.global = preloadContext;
  }

  return preloadContext;
}

/**
 * Execute a preload script in the context of a content window.
 *
 * @param {string} scriptPath - Path to the preload script
 * @param {Window} contentWindow - The content window
 * @param {object} options - Execution options
 * @returns {Promise<void>}
 */
async function executePreloadScript(scriptPath, contentWindow, options = {}) {
  log.info('Executing preload script:', scriptPath);

  try {
    // Create the preload context
    const context = createPreloadContext(contentWindow, options);

    // Read the preload script
    let scriptContent;

    if (scriptPath.startsWith('resource://') || scriptPath.startsWith('chrome://')) {
      // Load from resource/chrome URL
      const response = await fetch(scriptPath);
      if (!response.ok) {
        throw new Error(`Failed to load preload script: ${response.status}`);
      }
      scriptContent = await response.text();
    } else if (scriptPath.startsWith('file://') || scriptPath.startsWith('/')) {
      // Load from file system
      const filePath = scriptPath.replace('file://', '');
      const file = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
      file.initWithPath(filePath);

      if (!file.exists()) {
        throw new Error(`Preload script not found: ${filePath}`);
      }

      const fstream = Cc['@mozilla.org/network/file-input-stream;1']
        .createInstance(Ci.nsIFileInputStream);
      fstream.init(file, -1, 0, 0);

      const sstream = Cc['@mozilla.org/scriptableinputstream;1']
        .createInstance(Ci.nsIScriptableInputStream);
      sstream.init(fstream);

      scriptContent = sstream.read(sstream.available());
      sstream.close();
      fstream.close();
    } else {
      throw new Error(`Invalid preload script path: ${scriptPath}`);
    }

    // Compile and execute the script
    // Use the content window's principal for DOM access, but with system privileges
    // for accessing chrome APIs

    // Create a sandbox that has access to the content window
    const sandbox = Cu.Sandbox(contentWindow, {
      sandboxName: `ElectronPreload:${options.appId || 'unknown'}`,
      sandboxPrototype: contentWindow,
      wantXrays: true,
      wantGlobalProperties: ['fetch', 'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder'],
      originAttributes: contentWindow.document.nodePrincipal.originAttributes,
    });

    // Copy context into sandbox - these give privileged access
    sandbox.contextBridge = context.contextBridge;
    sandbox.ipcRenderer = context.ipcRenderer;

    // Create a clean process object for the sandbox
    // We need to build this in a way that cloneInto can handle
    const processObj = {
      type: 'renderer',
      versions: {
        electron: '28.0.0',
        chrome: String(Services.appinfo.platformVersion || '120.0'),
        node: '18.18.2',
        v8: '11.0',
      },
      platform: Services.appinfo.OS === 'Darwin' ? 'darwin' :
                Services.appinfo.OS === 'WINNT' ? 'win32' : 'linux',
      arch: Services.appinfo.XPCOMABI?.includes('x86_64') ? 'x64' :
            Services.appinfo.XPCOMABI?.includes('aarch64') ? 'arm64' : 'x86',
      env: {},
      pid: Services.appinfo.processID || 0,
    };
    sandbox.process = Cu.cloneInto(processObj, sandbox);

    // Add functions to process separately (cloneInto doesn't handle functions well)
    Cu.evalInSandbox(`
      process.cwd = function() { return '/'; };
    `, sandbox);

    sandbox.require = context.require || Cu.exportFunction(() => {
      throw new Error('require is not available without nodeIntegration');
    }, sandbox);

    // DOM access - sandbox already has window via sandboxPrototype
    // But we also explicitly set these for scripts that use them directly
    sandbox.document = contentWindow.document;
    sandbox.console = contentWindow.console;

    // Execute the script directly in the sandbox (which has window as prototype)
    Cu.evalInSandbox(
      scriptContent,
      sandbox,
      'latest',
      scriptPath,
      1
    );

    log.info('Preload script executed successfully');
  } catch (e) {
    log.error('Preload script execution failed:', e);
    throw e;
  }
}

/**
 * PreloadManager - manages preload scripts for BrowserWindows.
 */
export const PreloadManager = {
  /**
   * Register a preload script for a webContents.
   *
   * @param {number} webContentsId - The webContents ID
   * @param {string} preloadPath - Path to the preload script
   * @param {object} options - Preload options
   */
  register(webContentsId, preloadPath, options = {}) {
    log.info('Registering preload for webContents:', webContentsId, preloadPath);

    if (!preloadRegistry.has(webContentsId)) {
      preloadRegistry.set(webContentsId, []);
    }

    preloadRegistry.get(webContentsId).push({
      path: preloadPath,
      options,
    });
  },

  /**
   * Unregister all preload scripts for a webContents.
   *
   * @param {number} webContentsId - The webContents ID
   */
  unregister(webContentsId) {
    log.debug('Unregistering preloads for webContents:', webContentsId);
    preloadRegistry.delete(webContentsId);
  },

  /**
   * Execute all preload scripts for a webContents.
   * Called when a document is about to load.
   *
   * @param {number} webContentsId - The webContents ID
   * @param {Window} contentWindow - The content window
   * @returns {Promise<void>}
   */
  async execute(webContentsId, contentWindow) {
    const preloads = preloadRegistry.get(webContentsId);

    if (!preloads || preloads.length === 0) {
      log.debug('No preloads registered for webContents:', webContentsId);
      return;
    }

    log.info('Executing', preloads.length, 'preload(s) for webContents:', webContentsId);

    for (const preload of preloads) {
      try {
        await executePreloadScript(preload.path, contentWindow, {
          ...preload.options,
          webContentsId,
        });
      } catch (e) {
        log.error('Preload script failed:', preload.path, e);
        // Continue with other preloads
      }
    }
  },

  /**
   * Get registered preloads for a webContents.
   *
   * @param {number} webContentsId - The webContents ID
   * @returns {Array}
   */
  getPreloads(webContentsId) {
    return preloadRegistry.get(webContentsId) || [];
  },

  /**
   * Create a preload context manually.
   * Useful for advanced use cases.
   */
  createContext: createPreloadContext,
};

export default PreloadManager;
