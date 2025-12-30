// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

/**
 * electron - Main entry point for the Electron compatibility layer.
 *
 * This module provides the familiar Electron API surface:
 *
 * const { app, BrowserWindow, ipcMain } = require('electron');
 *
 * In Gecko context, this is imported as an ES module:
 *
 * import { app, BrowserWindow } from 'resource://gre/modules/electron/electron.sys.mjs';
 *
 * @module electron
 */

// Re-export all main process modules
export { app } from 'resource://gre/modules/electron/main/app.sys.mjs';
export { BrowserWindow } from 'resource://gre/modules/electron/main/BrowserWindow.sys.mjs';
export { WebContents } from 'resource://gre/modules/electron/main/webContents.sys.mjs';

// Host management (internal, but exposed for advanced use)
export { ElectronHost } from 'resource://gre/modules/electron/host/ElectronHost.sys.mjs';
export { WindowManager } from 'resource://gre/modules/electron/host/WindowManager.sys.mjs';
export { AppRegistry } from 'resource://gre/modules/electron/host/AppRegistry.sys.mjs';

// Common utilities
export { EventEmitter } from 'resource://gre/modules/electron/common/EventEmitter.sys.mjs';
export * as pathUtils from 'resource://gre/modules/electron/common/pathUtils.sys.mjs';

/**
 * Initialize the Electron compatibility layer.
 * This should be called once during browser startup.
 *
 * @returns {Promise<void>}
 */
export async function init() {
  const { ElectronHost } = ChromeUtils.importESModule(
    'resource://gre/modules/electron/host/ElectronHost.sys.mjs'
  );
  await ElectronHost.init();
}

/**
 * Placeholder exports for modules not yet implemented.
 * These will throw helpful errors if used.
 */

const notImplemented = (name) => {
  return new Proxy(
    {},
    {
      get(target, prop) {
        if (prop === 'then') return undefined; // For Promise detection
        throw new Error(
          `electron.${name}.${String(prop)} is not yet implemented in Gecko Electron`
        );
      },
      apply() {
        throw new Error(
          `electron.${name}() is not yet implemented in Gecko Electron`
        );
      },
    }
  );
};

// IPC - Coming in Milestone 2
export const ipcMain = notImplemented('ipcMain');
export const ipcRenderer = notImplemented('ipcRenderer');

// Dialog - Coming in Milestone 3
export const dialog = notImplemented('dialog');

// Other common modules - Future milestones
export const shell = notImplemented('shell');
export const clipboard = notImplemented('clipboard');
export const Menu = notImplemented('Menu');
export const MenuItem = notImplemented('MenuItem');
export const Tray = notImplemented('Tray');
export const nativeTheme = notImplemented('nativeTheme');
export const screen = notImplemented('screen');
export const globalShortcut = notImplemented('globalShortcut');
export const powerMonitor = notImplemented('powerMonitor');
export const session = notImplemented('session');
export const protocol = notImplemented('protocol');
export const net = notImplemented('net');
export const systemPreferences = notImplemented('systemPreferences');
export const contentTracing = notImplemented('contentTracing');
export const autoUpdater = notImplemented('autoUpdater');
export const crashReporter = notImplemented('crashReporter');
export const desktopCapturer = notImplemented('desktopCapturer');
export const nativeImage = notImplemented('nativeImage');
export const Notification = notImplemented('Notification');
export const TouchBar = notImplemented('TouchBar');

/**
 * Default export for CommonJS-style usage.
 * Note: In Gecko, you should prefer named imports.
 */
const electronDefault = {
  // Implemented
  app: null, // Lazy loaded below
  BrowserWindow: null,
  WebContents: null,

  // Not implemented yet
  ipcMain,
  ipcRenderer,
  dialog,
  shell,
  clipboard,
  Menu,
  MenuItem,
  Tray,
  nativeTheme,
  screen,
  globalShortcut,
  powerMonitor,
  session,
  protocol,
  net,
  systemPreferences,
  contentTracing,
  autoUpdater,
  crashReporter,
  desktopCapturer,
  nativeImage,
  Notification,
  TouchBar,
};

// Lazy load implemented modules
ChromeUtils.defineLazyGetter(electronDefault, 'app', () => {
  const { app } = ChromeUtils.importESModule(
    'resource://gre/modules/electron/main/app.sys.mjs'
  );
  return app;
});

ChromeUtils.defineLazyGetter(electronDefault, 'BrowserWindow', () => {
  const { BrowserWindow } = ChromeUtils.importESModule(
    'resource://gre/modules/electron/main/BrowserWindow.sys.mjs'
  );
  return BrowserWindow;
});

ChromeUtils.defineLazyGetter(electronDefault, 'WebContents', () => {
  const { WebContents } = ChromeUtils.importESModule(
    'resource://gre/modules/electron/main/webContents.sys.mjs'
  );
  return WebContents;
});

export default electronDefault;
