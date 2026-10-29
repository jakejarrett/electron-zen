// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

/**
 * Debug utilities for Gecko Electron.
 *
 * Provides configurable logging, performance tracking, and debugging tools.
 */

const PREF_DEBUG_ENABLED = 'electron.debug.enabled';
const PREF_DEBUG_LEVEL = 'electron.debug.level';
const PREF_DEBUG_MODULES = 'electron.debug.modules';

/**
 * Log levels
 */
export const LogLevel = {
  NONE: 0,
  ERROR: 1,
  WARN: 2,
  INFO: 3,
  DEBUG: 4,
  TRACE: 5,
};

/**
 * ANSI color codes for console output
 */
const Colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

/**
 * Get a styled prefix for log messages
 */
function getPrefix(level, module) {
  const timestamp = new Date().toISOString().slice(11, 23);
  const levelColors = {
    ERROR: Colors.red,
    WARN: Colors.yellow,
    INFO: Colors.green,
    DEBUG: Colors.cyan,
    TRACE: Colors.dim,
  };
  const color = levelColors[level] || Colors.reset;
  return `${Colors.dim}[${timestamp}]${Colors.reset} ${color}[ELECTRON:${module}]${Colors.reset}`;
}

/**
 * Check if debugging is enabled for a module
 */
function isModuleEnabled(module) {
  try {
    const enabledModules = Services.prefs.getStringPref(PREF_DEBUG_MODULES, '*');
    if (enabledModules === '*') return true;
    const modules = enabledModules.split(',').map((m) => m.trim().toLowerCase());
    return modules.includes(module.toLowerCase()) || modules.includes('*');
  } catch {
    return true;
  }
}

/**
 * Get the current log level
 */
function getLogLevel() {
  try {
    return Services.prefs.getIntPref(PREF_DEBUG_LEVEL, LogLevel.INFO);
  } catch {
    return LogLevel.INFO;
  }
}

/**
 * Check if debugging is globally enabled
 */
function isDebugEnabled() {
  try {
    return Services.prefs.getBoolPref(PREF_DEBUG_ENABLED, true);
  } catch {
    return true;
  }
}

/**
 * Create a logger for a specific module.
 *
 * @param {string} moduleName - Name of the module
 * @returns {Object} Logger instance with error, warn, info, debug, trace methods
 */
export function createLogger(moduleName) {
  const log = (level, levelName, ...args) => {
    if (!isDebugEnabled()) return;
    if (level > getLogLevel()) return;
    if (!isModuleEnabled(moduleName)) return;

    const prefix = getPrefix(levelName, moduleName);
    const method =
      levelName === 'ERROR'
        ? 'error'
        : levelName === 'WARN'
          ? 'warn'
          : levelName === 'DEBUG' || levelName === 'TRACE'
            ? 'debug'
            : 'log';

    console[method](prefix, ...args);
  };

  return {
    error: (...args) => log(LogLevel.ERROR, 'ERROR', ...args),
    warn: (...args) => log(LogLevel.WARN, 'WARN', ...args),
    info: (...args) => log(LogLevel.INFO, 'INFO', ...args),
    debug: (...args) => log(LogLevel.DEBUG, 'DEBUG', ...args),
    trace: (...args) => log(LogLevel.TRACE, 'TRACE', ...args),

    /**
     * Log with timing information
     */
    time: (label) => {
      if (!isDebugEnabled()) return () => {};
      const start = Cu.now ? Cu.now() : Date.now();
      return () => {
        const end = Cu.now ? Cu.now() : Date.now();
        const duration = (end - start).toFixed(2);
        log(LogLevel.DEBUG, 'DEBUG', `${label}: ${duration}ms`);
      };
    },

    /**
     * Log a group of messages
     */
    group: (label, fn) => {
      if (!isDebugEnabled()) {
        fn();
        return;
      }
      console.group(getPrefix('INFO', moduleName), label);
      try {
        fn();
      } finally {
        console.groupEnd();
      }
    },

    /**
     * Assert a condition and log if false
     */
    assert: (condition, ...args) => {
      if (!condition) {
        log(LogLevel.ERROR, 'ERROR', 'Assertion failed:', ...args);
      }
    },
  };
}

/**
 * Performance tracker for measuring operation durations
 */
export class PerformanceTracker {
  #marks = new Map();
  #logger;

  constructor(moduleName) {
    this.#logger = createLogger(moduleName);
  }

  mark(name) {
    this.#marks.set(name, performance.now());
  }

  measure(name, startMark, endMark) {
    const start = this.#marks.get(startMark);
    const end = endMark ? this.#marks.get(endMark) : performance.now();
    if (start !== undefined) {
      const duration = (end - start).toFixed(2);
      this.#logger.debug(`${name}: ${duration}ms`);
      return parseFloat(duration);
    }
    return 0;
  }

  clear() {
    this.#marks.clear();
  }
}

/**
 * Decorator-style function for tracing method calls
 */
export function trace(target, propertyKey, descriptor) {
  const original = descriptor.value;
  const logger = createLogger(target.constructor.name);

  descriptor.value = function (...args) {
    logger.trace(`→ ${propertyKey}(`, ...args, ')');
    try {
      const result = original.apply(this, args);
      if (result instanceof Promise) {
        return result.then(
          (res) => {
            logger.trace(`← ${propertyKey} resolved:`, res);
            return res;
          },
          (err) => {
            logger.trace(`← ${propertyKey} rejected:`, err);
            throw err;
          }
        );
      }
      logger.trace(`← ${propertyKey} returned:`, result);
      return result;
    } catch (err) {
      logger.trace(`← ${propertyKey} threw:`, err);
      throw err;
    }
  };

  return descriptor;
}

/**
 * Dump object state for debugging
 */
export function dumpState(name, obj) {
  const logger = createLogger('State');
  logger.group(name, () => {
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'function') {
        logger.debug(`${key}: [Function]`);
      } else if (typeof value === 'object' && value !== null) {
        logger.debug(`${key}:`, JSON.stringify(value, null, 2));
      } else {
        logger.debug(`${key}:`, value);
      }
    }
  });
}

/**
 * Global debug console for interactive debugging
 */
export const ElectronDebug = {
  /**
   * Enable/disable debugging
   */
  setEnabled(enabled) {
    Services.prefs.setBoolPref(PREF_DEBUG_ENABLED, enabled);
  },

  /**
   * Set log level
   */
  setLevel(level) {
    Services.prefs.setIntPref(PREF_DEBUG_LEVEL, level);
  },

  /**
   * Set which modules to debug
   * @param {string} modules - Comma-separated module names, or '*' for all
   */
  setModules(modules) {
    Services.prefs.setStringPref(PREF_DEBUG_MODULES, modules);
  },

  /**
   * Get current debug configuration
   */
  getConfig() {
    return {
      enabled: isDebugEnabled(),
      level: getLogLevel(),
      modules: Services.prefs.getStringPref(PREF_DEBUG_MODULES, '*'),
    };
  },

  /**
   * Print help information
   */
  help() {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║               Gecko Electron Debug Console                    ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  ElectronDebug.setEnabled(true/false)  - Toggle debugging    ║
║  ElectronDebug.setLevel(0-5)           - Set log level       ║
║  ElectronDebug.setModules('*')         - Filter modules      ║
║  ElectronDebug.getConfig()             - Show config         ║
║                                                              ║
║  Log Levels:                                                 ║
║    0 = NONE, 1 = ERROR, 2 = WARN, 3 = INFO,                 ║
║    4 = DEBUG, 5 = TRACE                                      ║
║                                                              ║
║  Example:                                                    ║
║    ElectronDebug.setLevel(5)           // Enable trace       ║
║    ElectronDebug.setModules('Host,BrowserWindow')            ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
    `);
  },

  LogLevel,
};

// Export for console access
if (typeof globalThis !== 'undefined') {
  globalThis.ElectronDebug = ElectronDebug;
}

/**
 * Convenience function to set the log level directly.
 * @param {number} level - Log level (0-5)
 */
export function setLogLevel(level) {
  Services.prefs.setIntPref(PREF_DEBUG_LEVEL, level);
}

/**
 * Alias for LogLevel for compatibility
 */
export const LOG_LEVELS = LogLevel;
