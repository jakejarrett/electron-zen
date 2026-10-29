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

import { createLogger } from 'resource:///modules/electron/common/debug.sys.mjs';

const log = createLogger('Host');

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  WindowManager: 'resource:///modules/electron/host/WindowManager.sys.mjs',
  AppRegistry: 'resource:///modules/electron/host/AppRegistry.sys.mjs',
  AsarArchive: 'resource:///modules/electron/common/asar.sys.mjs',
  BrowserWindow: 'resource:///modules/electron/main/BrowserWindow.sys.mjs',
  app: 'resource:///modules/electron/main/app.sys.mjs',
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
      log.warn('Already initialized');
      return;
    }

    log.info('Initializing Gecko Electron runtime...');
    const endTimer = log.time('Initialization');

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

      endTimer();
      log.info('✓ Gecko Electron runtime ready');
    } catch (e) {
      log.error('Initialization failed:', e);
      throw e;
    }
  }

  /**
   * Load an Electron app from a given path.
   * Supports .asar archives, .html files, .js files, and directories.
   * @param {string} appPath - Path to the app
   * @returns {Promise<void>}
   */
  async loadAppFromPath(appPath) {
    log.info(`Loading app from: ${appPath}`);

    // Check if the path exists
    let exists = false;
    let isDir = false;
    try {
      const stat = await IOUtils.stat(appPath);
      exists = true;
      isDir = stat.type === 'directory';
    } catch (e) {
      log.error(`Path does not exist: ${appPath}`);
      throw new Error(`App path does not exist: ${appPath}`);
    }

    // Determine app type and load accordingly
    if (isDir) {
      await this.#loadFromDirectory(appPath);
    } else if (appPath.endsWith('.asar')) {
      await this.#loadFromAsar(appPath);
    } else if (appPath.endsWith('.html') || appPath.endsWith('.htm')) {
      await this.#loadFromHtml(appPath);
    } else if (appPath.endsWith('.js') || appPath.endsWith('.mjs')) {
      await this.#loadFromScript(appPath);
    } else {
      throw new Error(`Unsupported app type: ${appPath}`);
    }
  }

  /**
   * Load an app from a directory (expects package.json with main entry).
   * @private
   */
  async #loadFromDirectory(dirPath) {
    log.info(`Loading app from directory: ${dirPath}`);

    const packageJsonPath = PathUtils.join(dirPath, 'package.json');
    let packageJson;

    try {
      const content = await IOUtils.readUTF8(packageJsonPath);
      packageJson = JSON.parse(content);
    } catch (e) {
      log.warn('No package.json found, looking for index.html');
      // Fall back to index.html
      const indexPath = PathUtils.join(dirPath, 'index.html');
      if (await IOUtils.exists(indexPath)) {
        return this.#loadFromHtml(indexPath);
      }
      throw new Error(`No package.json or index.html found in: ${dirPath}`);
    }

    // Get main entry point
    const main = packageJson.main || 'index.js';
    // Split by forward slash and use spread to handle path separators correctly
    const mainParts = main.split('/').filter(p => p);
    const mainPath = PathUtils.join(dirPath, ...mainParts);

    if (main.endsWith('.html') || main.endsWith('.htm')) {
      return this.#loadFromHtml(mainPath);
    } else if (main.endsWith('.js') || main.endsWith('.mjs')) {
      return this.#loadFromScript(mainPath, dirPath, packageJson);
    } else {
      throw new Error(`Unsupported main entry: ${main}`);
    }
  }

  /**
   * Load an app from an asar archive.
   * @private
   */
  async #loadFromAsar(asarPath) {
    log.info(`Loading app from asar: ${asarPath}`);

    const archive = new lazy.AsarArchive(asarPath);
    await archive.load();

    // Read package.json from the archive
    let packageJson;
    try {
      const content = archive.readFileAsString('package.json');
      packageJson = JSON.parse(content);
    } catch (e) {
      log.warn('No package.json in asar, looking for index.html');
      if (archive.hasFile('index.html')) {
        // Extract to temp and load
        return this.#extractAndLoadAsar(archive, 'index.html');
      }
      throw new Error('No package.json or index.html found in asar');
    }

    const main = packageJson.main || 'index.js';
    return this.#extractAndLoadAsar(archive, main, packageJson);
  }

  /**
   * Extract asar to temp directory and load the main entry.
   * @private
   */
  async #extractAndLoadAsar(archive, mainEntry, packageJson = null) {
    // Create temp directory for extraction
    const tempDir = PathUtils.join(
      PathUtils.tempDir,
      `electron-app-${Date.now()}`
    );
    await IOUtils.makeDirectory(tempDir, { createAncestors: true });

    log.info(`Extracting asar to: ${tempDir}`);

    // Extract all files
    const { extractAll } = ChromeUtils.importESModule(
      'resource:///modules/electron/common/asar.sys.mjs'
    );
    await extractAll(archive.getPath(), tempDir);

    // Normalize main entry path (handle forward slashes in path)
    const mainPathParts = mainEntry.split('/').filter(p => p);
    const mainPath = PathUtils.join(tempDir, ...mainPathParts);

    log.info(`Main entry path: ${mainPath}`);

    if (mainEntry.endsWith('.html') || mainEntry.endsWith('.htm')) {
      return this.#loadFromHtml(mainPath);
    } else {
      return this.#loadFromScript(mainPath, tempDir, packageJson);
    }
  }

  /**
   * Load an app from an HTML file (creates a BrowserWindow pointing to the file).
   * @private
   */
  async #loadFromHtml(htmlPath) {
    log.info(`Loading HTML app: ${htmlPath}`);

    // Wait for the app to be ready
    await lazy.app.whenReady();

    // Create a BrowserWindow and load the HTML file
    const win = new lazy.BrowserWindow({
      width: 800,
      height: 600,
      title: 'Electron App',
      show: true,
    });

    win.loadFile(htmlPath);
    log.info('HTML app loaded');
  }

  /**
   * Load an app from a JavaScript entry point.
   * This creates a Node.js-like environment and executes the main script.
   * @private
   */
  async #loadFromScript(scriptPath, appDir = null, packageJson = null) {
    log.info(`Loading JS app: ${scriptPath}`);

    // Set the app path if we have a directory
    if (appDir) {
      lazy.app.setAppPath(appDir);
    }

    try {
      // Read the script content
      const scriptContent = await IOUtils.readUTF8(scriptPath);
      log.debug(`Script loaded, ${scriptContent.length} bytes`);

      // Create a sandbox with Node.js-like globals
      const sandbox = Cu.Sandbox(Services.scriptSecurityManager.getSystemPrincipal(), {
        wantComponents: true,
        wantGlobalProperties: ['URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder', 'crypto'],
        sandboxName: `electron-app:${packageJson?.name || 'unknown'}`,
      });

      // Set up the module environment
      const dirname = PathUtils.parent(scriptPath);
      const filename = scriptPath;

      // Inject Node.js-like globals
      sandbox.__dirname = dirname;
      sandbox.__filename = filename;
      sandbox.console = console;
      sandbox.process = this.#createProcessObject(appDir, packageJson);
      sandbox.global = sandbox;
      sandbox.Buffer = this.#createBufferPolyfill();

      // Inject Electron APIs
      sandbox.electron = ChromeUtils.importESModule(
        'resource:///modules/electron/electron.sys.mjs'
      );
      
      // Create require function
      sandbox.require = this.#createRequireFunction(dirname, appDir, sandbox);
      sandbox.module = { exports: {}, id: filename, filename, loaded: false };
      sandbox.exports = sandbox.module.exports;

      // Execute the script
      log.debug(`Executing script in sandbox: ${scriptPath}`);
      Cu.evalInSandbox(
        scriptContent,
        sandbox,
        'latest',
        scriptPath,
        1
      );

      sandbox.module.loaded = true;
      log.info('JS app script executed');
    } catch (e) {
      log.error(`Failed to load script: ${e.message}`);
      log.error(e.stack);
      throw e;
    }
  }

  /**
   * Create a minimal process object for Node.js compatibility.
   * @private
   */
  #createProcessObject(appDir, packageJson) {
    return {
      platform: Services.appinfo.OS === 'WINNT' ? 'win32' : 
                Services.appinfo.OS === 'Darwin' ? 'darwin' : 'linux',
      arch: Services.appinfo.XPCOMABI?.split('-')[0] || 'x64',
      version: 'v20.0.0', // Fake Node.js version
      versions: {
        node: '20.0.0',
        electron: '35.0.0',
        chrome: Services.appinfo.platformVersion,
      },
      env: this.#createEnvProxy(),
      cwd: () => appDir || PathUtils.profileDir,
      argv: ['electron', appDir || ''],
      execPath: Services.dirsvc.get('XREExeF', Ci.nsIFile).path,
      resourcesPath: appDir,
      type: 'browser',
      pid: Services.appinfo.processID,
      ppid: 0,
      title: packageJson?.name || 'electron',
      nextTick: (callback, ...args) => {
        Services.tm.dispatchToMainThread(() => callback(...args));
      },
      on: () => {}, // Stub
      once: () => {}, // Stub
      emit: () => {}, // Stub
      removeListener: () => {}, // Stub
    };
  }

  /**
   * Create an environment proxy for process.env.
   * @private
   */
  #createEnvProxy() {
    return new Proxy({}, {
      get(target, prop) {
        return Services.env.get(String(prop)) || undefined;
      },
      set(target, prop, value) {
        Services.env.set(String(prop), String(value));
        return true;
      },
      has(target, prop) {
        return Services.env.exists(String(prop));
      },
    });
  }

  /**
   * Create a minimal Buffer polyfill.
   * @private
   */
  #createBufferPolyfill() {
    return {
      from: (data, encoding) => {
        if (typeof data === 'string') {
          return new TextEncoder().encode(data);
        }
        return new Uint8Array(data);
      },
      alloc: (size) => new Uint8Array(size),
      allocUnsafe: (size) => new Uint8Array(size),
      isBuffer: (obj) => obj instanceof Uint8Array,
    };
  }

  /**
   * Create a require function for CommonJS module loading.
   * @private
   */
  #createRequireFunction(baseDir, appDir, parentSandbox) {
    const moduleCache = new Map();
    const self = this;

    /**
     * Resolve a path, handling . and .. components.
     */
    function resolvePath(basePath, relativePath) {
      // Split paths into parts
      const baseParts = basePath.split('/').filter(p => p && p !== '.');
      const relativeParts = relativePath.split('/').filter(p => p);
      
      // Start from base
      const resultParts = [...baseParts];
      
      // Process relative parts
      for (const part of relativeParts) {
        if (part === '..') {
          resultParts.pop();
        } else if (part !== '.') {
          resultParts.push(part);
        }
      }
      
      return '/' + resultParts.join('/');
    }

    /**
     * Check if a file exists synchronously using nsIFile.
     */
    function fileExists(path) {
      try {
        const file = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
        file.initWithPath(path);
        return file.exists();
      } catch (e) {
        return false;
      }
    }

    /**
     * Read file synchronously using nsIFile.
     */
    function readFileSync(path) {
      const file = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
      file.initWithPath(path);
      
      const fstream = Cc['@mozilla.org/network/file-input-stream;1'].createInstance(Ci.nsIFileInputStream);
      fstream.init(file, -1, 0, 0);
      
      const cstream = Cc['@mozilla.org/intl/converter-input-stream;1'].createInstance(Ci.nsIConverterInputStream);
      cstream.init(fstream, 'UTF-8', 0, 0);
      
      let content = '';
      const str = {};
      while (cstream.readString(4096, str) !== 0) {
        content += str.value;
      }
      
      cstream.close();
      return content;
    }

    function require(modulePath) {
      log.debug(`require('${modulePath}') from ${baseDir}`);

      // Handle built-in Node.js modules
      if (!modulePath.startsWith('.') && !modulePath.startsWith('/')) {
        return self.#requireBuiltinOrPackage(modulePath, appDir, parentSandbox, moduleCache, require);
      }

      // Resolve relative paths
      let resolvedPath;
      if (modulePath.startsWith('.')) {
        resolvedPath = resolvePath(baseDir, modulePath);
      } else {
        resolvedPath = modulePath;
      }

      // Try different extensions if not specified
      if (!resolvedPath.endsWith('.js') && !resolvedPath.endsWith('.json') && !resolvedPath.endsWith('.node')) {
        // Try exact path first, then .js, then /index.js
        if (fileExists(resolvedPath)) {
          // It's a directory, try index.js
          if (fileExists(resolvedPath + '/index.js')) {
            resolvedPath = resolvedPath + '/index.js';
          } else if (fileExists(resolvedPath + '/index.json')) {
            resolvedPath = resolvedPath + '/index.json';
          }
        } else if (fileExists(resolvedPath + '.js')) {
          resolvedPath += '.js';
        } else if (fileExists(resolvedPath + '.json')) {
          resolvedPath += '.json';
        } else {
          // Fallback: assume .js
          resolvedPath += '.js';
        }
      }

      // Check cache
      if (moduleCache.has(resolvedPath)) {
        return moduleCache.get(resolvedPath).exports;
      }

      log.debug(`Loading module: ${resolvedPath}`);

      // Handle JSON files
      if (resolvedPath.endsWith('.json')) {
        try {
          const content = readFileSync(resolvedPath);
          const json = JSON.parse(content);
          moduleCache.set(resolvedPath, { exports: json });
          return json;
        } catch (e) {
          log.error(`Failed to load JSON module ${resolvedPath}: ${e.message}`);
          throw e;
        }
      }

      // Load JS module
      let moduleContent;
      try {
        moduleContent = readFileSync(resolvedPath);
      } catch (e) {
        log.error(`Failed to read module ${resolvedPath}: ${e.message}`);
        throw new Error(`Cannot find module '${modulePath}' from '${baseDir}'`);
      }

      const moduleDir = resolvePath(resolvedPath, '..');

      // Create module sandbox
      const moduleSandbox = Cu.Sandbox(Services.scriptSecurityManager.getSystemPrincipal(), {
        wantComponents: true,
        wantGlobalProperties: ['URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder', 'crypto'],
      });

      // Copy globals from parent
      moduleSandbox.__dirname = moduleDir;
      moduleSandbox.__filename = resolvedPath;
      moduleSandbox.console = console;
      moduleSandbox.process = parentSandbox.process;
      moduleSandbox.global = moduleSandbox;
      moduleSandbox.Buffer = parentSandbox.Buffer;
      moduleSandbox.electron = parentSandbox.electron;
      moduleSandbox.require = self.#createRequireFunction(moduleDir, appDir, moduleSandbox);
      moduleSandbox.module = { exports: {}, id: resolvedPath, filename: resolvedPath, loaded: false };
      moduleSandbox.exports = moduleSandbox.module.exports;

      // Cache before executing to handle circular dependencies
      moduleCache.set(resolvedPath, moduleSandbox.module);

      // Execute module
      Cu.evalInSandbox(
        moduleContent,
        moduleSandbox,
        'latest',
        resolvedPath,
        1
      );

      moduleSandbox.module.loaded = true;
      return moduleSandbox.module.exports;
    }

    require.resolve = (modulePath) => {
      if (modulePath.startsWith('.')) {
        return PathUtils.join(baseDir, modulePath);
      }
      return modulePath;
    };

    require.cache = moduleCache;

    return require;
  }

  /**
   * Handle built-in modules and node_modules packages.
   * @private
   */
  #requireBuiltinOrPackage(moduleName, appDir, parentSandbox, moduleCache, parentRequire) {
    log.debug(`Requiring built-in or package: ${moduleName}`);

    // Handle electron
    if (moduleName === 'electron') {
      return parentSandbox.electron;
    }

    // Handle common Node.js built-in modules with stubs
    const builtins = {
      'path': this.#createPathModule(),
      'fs': this.#createFsModule(),
      'os': this.#createOsModule(),
      'events': this.#createEventsModule(),
      'util': this.#createUtilModule(),
      'url': { URL, URLSearchParams, parse: () => ({}), format: () => '' },
      'crypto': { randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)) },
      'stream': { Readable: class {}, Writable: class {}, Transform: class {}, pipeline: () => {} },
      'child_process': { spawn: () => ({ on: () => {}, stdout: { on: () => {} }, stderr: { on: () => {} } }) },
      'http': { request: () => ({ on: () => {}, end: () => {} }), createServer: () => ({ listen: () => {} }) },
      'https': { request: () => ({ on: () => {}, end: () => {} }) },
      'net': { createConnection: () => ({ on: () => {} }) },
      'querystring': { parse: (s) => Object.fromEntries(new URLSearchParams(s)), stringify: (o) => new URLSearchParams(o).toString() },
      'zlib': { gunzip: () => {}, gzip: () => {} },
      'module': { createRequire: () => () => {} },
    };

    if (builtins[moduleName]) {
      return builtins[moduleName];
    }

    // Try to load from node_modules in appDir
    if (appDir) {
      const nodeModulesPath = appDir + '/node_modules/' + moduleName;
      const packageJsonPath = nodeModulesPath + '/package.json';
      
      try {
        // Check if package exists using sync file read
        const file = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
        file.initWithPath(packageJsonPath);
        
        if (file.exists()) {
          const fstream = Cc['@mozilla.org/network/file-input-stream;1'].createInstance(Ci.nsIFileInputStream);
          fstream.init(file, -1, 0, 0);
          
          const cstream = Cc['@mozilla.org/intl/converter-input-stream;1'].createInstance(Ci.nsIConverterInputStream);
          cstream.init(fstream, 'UTF-8', 0, 0);
          
          let pkgContent = '';
          const str = {};
          while (cstream.readString(4096, str) !== 0) {
            pkgContent += str.value;
          }
          cstream.close();
          
          const pkg = JSON.parse(pkgContent);
          const mainFile = pkg.main || 'index.js';

          log.debug(`Loading package ${moduleName} from ${nodeModulesPath}/${mainFile}`);

          // Use the parent require to load it
          const require = this.#createRequireFunction(nodeModulesPath, appDir, parentSandbox);
          return require('./' + mainFile);
        }
      } catch (e) {
        log.warn(`Could not load package ${moduleName}: ${e.message}`);
      }
    }

    // Return empty stub for unknown modules
    log.warn(`Unknown module: ${moduleName}, returning stub`);
    return {};
  }

  /**
   * Create a path module polyfill.
   * @private
   */
  #createPathModule() {
    const sep = Services.appinfo.OS === 'WINNT' ? '\\' : '/';
    return {
      sep,
      delimiter: Services.appinfo.OS === 'WINNT' ? ';' : ':',
      join: (...parts) => parts.filter(p => p).join(sep).replace(/[/\\]+/g, sep),
      dirname: (p) => PathUtils.parent(p),
      basename: (p, ext) => {
        const base = p.split(/[/\\]/).pop() || '';
        return ext && base.endsWith(ext) ? base.slice(0, -ext.length) : base;
      },
      extname: (p) => {
        const base = p.split(/[/\\]/).pop() || '';
        const dot = base.lastIndexOf('.');
        return dot > 0 ? base.slice(dot) : '';
      },
      resolve: (...parts) => {
        // Simple resolve implementation
        const result = parts.filter(p => p).join(sep);
        return result.startsWith(sep) ? result : PathUtils.join(PathUtils.profileDir, result);
      },
      isAbsolute: (p) => p.startsWith('/') || /^[A-Za-z]:/.test(p),
      normalize: (p) => p.replace(/[/\\]+/g, sep),
      parse: (p) => ({
        root: p.startsWith('/') ? '/' : '',
        dir: PathUtils.parent(p),
        base: p.split(/[/\\]/).pop() || '',
        ext: '',
        name: '',
      }),
    };
  }

  /**
   * Create an fs module polyfill with synchronous operations.
   * @private
   */
  #createFsModule() {
    // Helper for sync file read
    function readFileSyncHelper(path) {
      const file = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
      file.initWithPath(path);
      
      const fstream = Cc['@mozilla.org/network/file-input-stream;1'].createInstance(Ci.nsIFileInputStream);
      fstream.init(file, -1, 0, 0);
      
      const bstream = Cc['@mozilla.org/binaryinputstream;1'].createInstance(Ci.nsIBinaryInputStream);
      bstream.setInputStream(fstream);
      
      const bytes = bstream.readBytes(bstream.available());
      bstream.close();
      
      return bytes;
    }

    function readFileSyncUtf8(path) {
      const file = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
      file.initWithPath(path);
      
      const fstream = Cc['@mozilla.org/network/file-input-stream;1'].createInstance(Ci.nsIFileInputStream);
      fstream.init(file, -1, 0, 0);
      
      const cstream = Cc['@mozilla.org/intl/converter-input-stream;1'].createInstance(Ci.nsIConverterInputStream);
      cstream.init(fstream, 'UTF-8', 0, 0);
      
      let content = '';
      const str = {};
      while (cstream.readString(4096, str) !== 0) {
        content += str.value;
      }
      
      cstream.close();
      return content;
    }

    function fileExistsSync(path) {
      try {
        const file = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
        file.initWithPath(path);
        return file.exists();
      } catch (e) {
        return false;
      }
    }

    return {
      readFileSync: (path, options) => {
        if (options === 'utf8' || options === 'utf-8' || options?.encoding === 'utf8' || options?.encoding === 'utf-8') {
          return readFileSyncUtf8(path);
        }
        const bytes = readFileSyncHelper(path);
        return new TextEncoder().encode(bytes);
      },
      writeFileSync: (path, data) => {
        const file = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
        file.initWithPath(path);
        
        const fstream = Cc['@mozilla.org/network/file-output-stream;1'].createInstance(Ci.nsIFileOutputStream);
        fstream.init(file, 0x02 | 0x08 | 0x20, 0o644, 0); // write, create, truncate
        
        const content = typeof data === 'string' ? data : new TextDecoder().decode(data);
        const cstream = Cc['@mozilla.org/intl/converter-output-stream;1'].createInstance(Ci.nsIConverterOutputStream);
        cstream.init(fstream, 'UTF-8');
        cstream.writeString(content);
        cstream.close();
      },
      existsSync: fileExistsSync,
      mkdirSync: (path, options) => {
        const file = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
        file.initWithPath(path);
        if (!file.exists()) {
          file.create(Ci.nsIFile.DIRECTORY_TYPE, 0o755);
        }
      },
      readdirSync: (dirPath) => {
        const file = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
        file.initWithPath(dirPath);
        const entries = file.directoryEntries;
        const result = [];
        while (entries.hasMoreElements()) {
          const entry = entries.getNext().QueryInterface(Ci.nsIFile);
          result.push(entry.leafName);
        }
        return result;
      },
      statSync: (path) => {
        const file = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
        file.initWithPath(path);
        return {
          isDirectory: () => file.isDirectory(),
          isFile: () => file.isFile(),
          size: file.fileSize,
          mtime: new Date(file.lastModifiedTime),
        };
      },
      lstatSync: (path) => {
        const file = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
        file.initWithPath(path);
        return {
          isDirectory: () => file.isDirectory(),
          isFile: () => file.isFile(),
          isSymbolicLink: () => file.isSymlink(),
          size: file.fileSize,
          mtime: new Date(file.lastModifiedTime),
        };
      },
      unlinkSync: (path) => {
        const file = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
        file.initWithPath(path);
        file.remove(false);
      },
      rmdirSync: (path, options) => {
        const file = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
        file.initWithPath(path);
        file.remove(options?.recursive || false);
      },
      copyFileSync: (src, dest) => {
        const srcFile = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
        srcFile.initWithPath(src);
        const destFile = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
        destFile.initWithPath(dest);
        srcFile.copyTo(destFile.parent, destFile.leafName);
      },
      renameSync: (oldPath, newPath) => {
        const file = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
        file.initWithPath(oldPath);
        const destFile = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
        destFile.initWithPath(newPath);
        file.moveTo(destFile.parent, destFile.leafName);
      },
      promises: {
        readFile: async (path, options) => {
          const data = await IOUtils.readUTF8(path);
          return options?.encoding ? data : new TextEncoder().encode(data);
        },
        writeFile: async (path, data) => {
          await IOUtils.writeUTF8(path, typeof data === 'string' ? data : new TextDecoder().decode(data));
        },
        mkdir: async (path, options) => {
          await IOUtils.makeDirectory(path, { createAncestors: options?.recursive });
        },
        stat: async (path) => {
          const stat = await IOUtils.stat(path);
          return {
            isDirectory: () => stat.type === 'directory',
            isFile: () => stat.type === 'file',
            size: stat.size,
            mtime: new Date(stat.lastModified),
          };
        },
        unlink: (path) => IOUtils.remove(path),
        rmdir: (path, options) => IOUtils.remove(path, { recursive: options?.recursive }),
      },
    };
  }

  /**
   * Create an os module polyfill.
   * @private
   */
  #createOsModule() {
    return {
      platform: () => Services.appinfo.OS === 'WINNT' ? 'win32' : 
                      Services.appinfo.OS === 'Darwin' ? 'darwin' : 'linux',
      arch: () => Services.appinfo.XPCOMABI?.split('-')[0] || 'x64',
      homedir: () => Services.dirsvc.get('Home', Ci.nsIFile).path,
      tmpdir: () => PathUtils.tempDir,
      hostname: () => 'localhost',
      type: () => Services.appinfo.OS,
      release: () => '1.0.0',
      cpus: () => [{ model: 'Unknown', speed: 0, times: {} }],
      totalmem: () => 8 * 1024 * 1024 * 1024,
      freemem: () => 4 * 1024 * 1024 * 1024,
      EOL: Services.appinfo.OS === 'WINNT' ? '\r\n' : '\n',
    };
  }

  /**
   * Create an events module polyfill.
   * @private
   */
  #createEventsModule() {
    class EventEmitter {
      #events = new Map();
      
      on(event, listener) {
        if (!this.#events.has(event)) {
          this.#events.set(event, []);
        }
        this.#events.get(event).push(listener);
        return this;
      }
      
      once(event, listener) {
        const onceListener = (...args) => {
          this.removeListener(event, onceListener);
          listener(...args);
        };
        return this.on(event, onceListener);
      }
      
      emit(event, ...args) {
        const listeners = this.#events.get(event);
        if (listeners) {
          listeners.forEach(l => l(...args));
          return true;
        }
        return false;
      }
      
      removeListener(event, listener) {
        const listeners = this.#events.get(event);
        if (listeners) {
          const idx = listeners.indexOf(listener);
          if (idx >= 0) listeners.splice(idx, 1);
        }
        return this;
      }
      
      removeAllListeners(event) {
        if (event) {
          this.#events.delete(event);
        } else {
          this.#events.clear();
        }
        return this;
      }
    }
    
    return { EventEmitter, default: EventEmitter };
  }

  /**
   * Create a util module polyfill.
   * @private
   */
  #createUtilModule() {
    return {
      promisify: (fn) => (...args) => new Promise((resolve, reject) => {
        fn(...args, (err, result) => err ? reject(err) : resolve(result));
      }),
      inherits: (ctor, superCtor) => {
        ctor.prototype = Object.create(superCtor.prototype);
        ctor.prototype.constructor = ctor;
      },
      format: (...args) => args.map(String).join(' '),
      inspect: (obj) => JSON.stringify(obj, null, 2),
      debuglog: () => () => {},
      deprecate: (fn) => fn,
    };
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

    log.info(`Registering app '${appId}'`);
    log.debug('App manifest:', manifest);

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
      log.warn(`App not registered: ${appId}`);
      return;
    }

    log.info(`Unregistering app '${appId}'`);

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
