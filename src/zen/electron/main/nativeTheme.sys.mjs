// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

/**
 * nativeTheme - Electron-compatible native theme module.
 *
 * Read and respond to changes in Chromium's native color theme.
 *
 * @see https://www.electronjs.org/docs/latest/api/native-theme
 */

import { createLogger } from 'resource:///modules/electron/common/debug.sys.mjs';

const log = createLogger('nativeTheme');

// Event emitter functionality
const listeners = new Map();

/**
 * Emit an event to all listeners.
 */
function emit(event) {
  const eventListeners = listeners.get(event);
  if (eventListeners) {
    for (const listener of eventListeners) {
      try {
        listener();
      } catch (e) {
        log.error('Event listener error:', e);
      }
    }
  }
}

// Current theme source preference ('system', 'light', 'dark')
let themeSourcePref = 'system';

// Watch for system theme changes
let mediaQueryList = null;

/**
 * Initialize the media query listener for theme changes.
 */
function initThemeWatcher() {
  if (mediaQueryList) return;

  try {
    const win = Services.wm.getMostRecentWindow('navigator:browser');
    if (win) {
      mediaQueryList = win.matchMedia('(prefers-color-scheme: dark)');
      mediaQueryList.addEventListener('change', () => {
        log.debug('System theme changed');
        emit('updated');
      });
    }
  } catch (e) {
    log.warn('Failed to initialize theme watcher:', e);
  }
}

/**
 * nativeTheme module - system theme detection and control.
 */
export const nativeTheme = {
  /**
   * Whether the OS is in dark mode.
   *
   * @type {boolean}
   * @readonly
   *
   * @example
   * if (nativeTheme.shouldUseDarkColors) {
   *   // Apply dark theme
   * }
   */
  get shouldUseDarkColors() {
    initThemeWatcher();

    // If theme source is explicitly set, use that
    if (themeSourcePref === 'dark') {
      return true;
    }
    if (themeSourcePref === 'light') {
      return false;
    }

    // Otherwise check system preference
    try {
      const win = Services.wm.getMostRecentWindow('navigator:browser');
      if (win) {
        return win.matchMedia('(prefers-color-scheme: dark)').matches;
      }
    } catch (e) {
      log.warn('Failed to check system theme:', e);
    }

    // Default to light
    return false;
  },

  /**
   * The theme source - 'system', 'light', or 'dark'.
   *
   * Setting this property to 'light' or 'dark' overrides the system setting.
   * Setting to 'system' removes the override.
   *
   * @type {string}
   *
   * @example
   * nativeTheme.themeSource = 'dark'; // Force dark mode
   * nativeTheme.themeSource = 'system'; // Follow system
   */
  get themeSource() {
    return themeSourcePref;
  },

  set themeSource(value) {
    if (!['system', 'light', 'dark'].includes(value)) {
      log.warn('Invalid themeSource:', value);
      return;
    }

    const oldValue = themeSourcePref;
    themeSourcePref = value;

    log.info('themeSource set to:', value);

    // Emit updated event if the effective theme changed
    const oldDark = oldValue === 'dark' || (oldValue === 'system' && this.shouldUseDarkColors);
    const newDark = value === 'dark' || (value === 'system' && this.shouldUseDarkColors);

    if (oldDark !== newDark) {
      emit('updated');
    }
  },

  /**
   * Whether the OS is using high contrast mode (Windows only).
   *
   * @type {boolean}
   * @readonly
   */
  get shouldUseHighContrastColors() {
    try {
      const win = Services.wm.getMostRecentWindow('navigator:browser');
      if (win) {
        return win.matchMedia('(prefers-contrast: more)').matches;
      }
    } catch (e) {
      log.warn('Failed to check high contrast:', e);
    }
    return false;
  },

  /**
   * Whether the OS is using inverted color scheme (macOS only).
   *
   * @type {boolean}
   * @readonly
   */
  get shouldUseInvertedColorScheme() {
    try {
      const win = Services.wm.getMostRecentWindow('navigator:browser');
      if (win) {
        return win.matchMedia('(inverted-colors: inverted)').matches;
      }
    } catch (e) {
      log.warn('Failed to check inverted colors:', e);
    }
    return false;
  },

  /**
   * Whether the OS is using reduced transparency (macOS only).
   *
   * @type {boolean}
   * @readonly
   */
  get inForcedColorsMode() {
    try {
      const win = Services.wm.getMostRecentWindow('navigator:browser');
      if (win) {
        return win.matchMedia('(forced-colors: active)').matches;
      }
    } catch (e) {
      log.warn('Failed to check forced colors:', e);
    }
    return false;
  },

  // Event emitter methods

  /**
   * Add a listener for the 'updated' event.
   *
   * @param {string} event - Event name ('updated')
   * @param {Function} listener - Callback function
   *
   * @example
   * nativeTheme.on('updated', () => {
   *   console.log('Theme changed to:', nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
   * });
   */
  on(event, listener) {
    if (!listeners.has(event)) {
      listeners.set(event, new Set());
    }
    listeners.get(event).add(listener);
    initThemeWatcher();
  },

  /**
   * Add a one-time listener for an event.
   *
   * @param {string} event - Event name
   * @param {Function} listener - Callback function
   */
  once(event, listener) {
    const wrapper = () => {
      this.removeListener(event, wrapper);
      listener();
    };
    this.on(event, wrapper);
  },

  /**
   * Remove a listener for an event.
   *
   * @param {string} event - Event name
   * @param {Function} listener - Callback function
   */
  removeListener(event, listener) {
    const eventListeners = listeners.get(event);
    if (eventListeners) {
      eventListeners.delete(listener);
    }
  },

  /**
   * Alias for removeListener.
   */
  off(event, listener) {
    this.removeListener(event, listener);
  },

  /**
   * Remove all listeners for an event or all events.
   *
   * @param {string} [event] - Event name (optional)
   */
  removeAllListeners(event) {
    if (event) {
      listeners.delete(event);
    } else {
      listeners.clear();
    }
  },

  /**
   * Get all listeners for an event.
   *
   * @param {string} event - Event name
   * @returns {Function[]}
   */
  listeners(event) {
    return Array.from(listeners.get(event) || []);
  },

  /**
   * Get listener count for an event.
   *
   * @param {string} event - Event name
   * @returns {number}
   */
  listenerCount(event) {
    const eventListeners = listeners.get(event);
    return eventListeners ? eventListeners.size : 0;
  },

  /**
   * Alias for on.
   */
  addListener(event, listener) {
    this.on(event, listener);
  },
};

export default nativeTheme;
