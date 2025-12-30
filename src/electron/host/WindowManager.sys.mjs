// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

/**
 * WindowManager - Tracks and manages all BrowserWindow instances.
 *
 * Provides centralized window management including:
 * - Window creation and destruction
 * - Window lookup by ID
 * - App-to-window mapping
 * - Focus management
 */

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  BrowserWindow:
    'resource://gre/modules/electron/main/BrowserWindow.sys.mjs',
});

class WindowManagerSingleton {
  /** @type {Map<number, BrowserWindow>} */
  #windows = new Map();

  /** @type {Map<string, Set<number>>} */
  #appWindows = new Map();

  /** @type {number} */
  #nextWindowId = 1;

  /** @type {number|null} */
  #focusedWindowId = null;

  /**
   * Generate a unique window ID.
   * @returns {number}
   */
  generateId() {
    return this.#nextWindowId++;
  }

  /**
   * Register a window with the manager.
   * @param {BrowserWindow} browserWindow - The window to register
   */
  registerWindow(browserWindow) {
    const id = browserWindow.id;
    const appId = browserWindow.appId;

    this.#windows.set(id, browserWindow);

    // Track by app
    if (appId) {
      if (!this.#appWindows.has(appId)) {
        this.#appWindows.set(appId, new Set());
      }
      this.#appWindows.get(appId).add(id);
    }

    console.log(
      `WindowManager: Registered window ${id} for app '${appId || 'default'}'`
    );
  }

  /**
   * Unregister a window from the manager.
   * @param {number} windowId - The window ID to unregister
   */
  unregisterWindow(windowId) {
    const browserWindow = this.#windows.get(windowId);
    if (!browserWindow) {
      return;
    }

    const appId = browserWindow.appId;

    this.#windows.delete(windowId);

    // Remove from app tracking
    if (appId && this.#appWindows.has(appId)) {
      this.#appWindows.get(appId).delete(windowId);
      if (this.#appWindows.get(appId).size === 0) {
        this.#appWindows.delete(appId);
      }
    }

    // Clear focused window if this was it
    if (this.#focusedWindowId === windowId) {
      this.#focusedWindowId = null;
    }

    console.log(`WindowManager: Unregistered window ${windowId}`);
  }

  /**
   * Get a window by its ID.
   * @param {number} windowId - The window ID
   * @returns {BrowserWindow|undefined}
   */
  getWindow(windowId) {
    return this.#windows.get(windowId);
  }

  /**
   * Get all windows.
   * @returns {BrowserWindow[]}
   */
  getAllWindows() {
    return Array.from(this.#windows.values());
  }

  /**
   * Get all windows for a specific app.
   * @param {string} appId - The app identifier
   * @returns {BrowserWindow[]}
   */
  getAppWindows(appId) {
    const windowIds = this.#appWindows.get(appId);
    if (!windowIds) {
      return [];
    }
    return Array.from(windowIds)
      .map((id) => this.#windows.get(id))
      .filter(Boolean);
  }

  /**
   * Close all windows for a specific app.
   * @param {string} appId - The app identifier
   */
  async closeAppWindows(appId) {
    const windows = this.getAppWindows(appId);
    for (const win of windows) {
      await win.close();
    }
  }

  /**
   * Get the currently focused window.
   * @returns {BrowserWindow|null}
   */
  getFocusedWindow() {
    if (this.#focusedWindowId === null) {
      return null;
    }
    return this.#windows.get(this.#focusedWindowId) || null;
  }

  /**
   * Set the focused window.
   * @param {number|null} windowId - The window ID, or null to clear
   */
  setFocusedWindow(windowId) {
    this.#focusedWindowId = windowId;
  }

  /**
   * Get the total number of windows.
   * @returns {number}
   */
  getWindowCount() {
    return this.#windows.size;
  }

  /**
   * Check if any windows are open.
   * @returns {boolean}
   */
  hasWindows() {
    return this.#windows.size > 0;
  }

  /**
   * Find a window by a predicate function.
   * @param {Function} predicate - Function that takes a BrowserWindow and returns boolean
   * @returns {BrowserWindow|undefined}
   */
  findWindow(predicate) {
    for (const win of this.#windows.values()) {
      if (predicate(win)) {
        return win;
      }
    }
    return undefined;
  }

  /**
   * Iterate over all windows.
   * @param {Function} callback - Function to call for each window
   */
  forEachWindow(callback) {
    this.#windows.forEach(callback);
  }
}

// Export singleton instance
export const WindowManager = new WindowManagerSingleton();
