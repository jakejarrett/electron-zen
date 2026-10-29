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
 * import { app, BrowserWindow, ipcMain } from 'resource:///modules/electron/electron.sys.mjs';
 *
 * @module electron
 */

// Re-export all main process modules
export { app } from 'resource:///modules/electron/main/app.sys.mjs';
export { BrowserWindow } from 'resource:///modules/electron/main/BrowserWindow.sys.mjs';
export { WebContents } from 'resource:///modules/electron/main/webContents.sys.mjs';
export { ipcMain } from 'resource:///modules/electron/main/ipcMain.sys.mjs';

// Quick win modules (Milestone 3)
export { dialog } from 'resource:///modules/electron/main/dialog.sys.mjs';
export { shell } from 'resource:///modules/electron/main/shell.sys.mjs';
export { clipboard } from 'resource:///modules/electron/main/clipboard.sys.mjs';
export { nativeTheme } from 'resource:///modules/electron/main/nativeTheme.sys.mjs';

// Archive support
export {
  default as asar,
  AsarArchive,
  extractAll,
  extractFile,
  listPackage,
  createPackage,
} from 'resource:///modules/electron/common/asar.sys.mjs';

// Renderer process modules (for preload scripts)
export { ipcRenderer, createIpcRenderer } from 'resource:///modules/electron/renderer/ipcRenderer.sys.mjs';
export { contextBridge, createContextBridge } from 'resource:///modules/electron/renderer/contextBridge.sys.mjs';
export { PreloadManager } from 'resource:///modules/electron/renderer/PreloadManager.sys.mjs';

// Host management (internal, but exposed for advanced use)
export { ElectronHost } from 'resource:///modules/electron/host/ElectronHost.sys.mjs';
export { WindowManager } from 'resource:///modules/electron/host/WindowManager.sys.mjs';
export { AppRegistry } from 'resource:///modules/electron/host/AppRegistry.sys.mjs';
export { AppSandbox } from 'resource:///modules/electron/host/AppSandbox.sys.mjs';

// Common utilities
export { EventEmitter } from 'resource:///modules/electron/common/EventEmitter.sys.mjs';
export * as pathUtils from 'resource:///modules/electron/common/pathUtils.sys.mjs';
export { createLogger, ElectronDebug, setLogLevel, LOG_LEVELS } from 'resource:///modules/electron/common/debug.sys.mjs';

/**
 * Initialize the Electron compatibility layer.
 * This should be called once during browser startup.
 *
 * @returns {Promise<void>}
 */
export async function init() {
  const { ElectronHost } = ChromeUtils.importESModule(
    'resource:///modules/electron/host/ElectronHost.sys.mjs'
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

// Dialog - Coming in Milestone 3
// (Now implemented - see exports above)

// Other common modules - Future milestones
// shell, clipboard, nativeTheme - now implemented
export const Menu = notImplemented('Menu');
export const MenuItem = notImplemented('MenuItem');
export const Tray = notImplemented('Tray');
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
  // Implemented - lazy loaded below
  app: null,
  BrowserWindow: null,
  WebContents: null,
  ipcMain: null,
  ipcRenderer: null,
  dialog: null,
  shell: null,
  clipboard: null,
  nativeTheme: null,
  asar: null,

  // Not implemented yet
  Menu,
  MenuItem,
  Tray,
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
    'resource:///modules/electron/main/app.sys.mjs'
  );
  return app;
});

ChromeUtils.defineLazyGetter(electronDefault, 'BrowserWindow', () => {
  const { BrowserWindow } = ChromeUtils.importESModule(
    'resource:///modules/electron/main/BrowserWindow.sys.mjs'
  );
  return BrowserWindow;
});

ChromeUtils.defineLazyGetter(electronDefault, 'WebContents', () => {
  const { WebContents } = ChromeUtils.importESModule(
    'resource:///modules/electron/main/webContents.sys.mjs'
  );
  return WebContents;
});

ChromeUtils.defineLazyGetter(electronDefault, 'ipcMain', () => {
  const { ipcMain } = ChromeUtils.importESModule(
    'resource:///modules/electron/main/ipcMain.sys.mjs'
  );
  return ipcMain;
});

ChromeUtils.defineLazyGetter(electronDefault, 'ipcRenderer', () => {
  const { ipcRenderer } = ChromeUtils.importESModule(
    'resource:///modules/electron/renderer/ipcRenderer.sys.mjs'
  );
  return ipcRenderer;
});

ChromeUtils.defineLazyGetter(electronDefault, 'dialog', () => {
  const { dialog } = ChromeUtils.importESModule(
    'resource:///modules/electron/main/dialog.sys.mjs'
  );
  return dialog;
});

ChromeUtils.defineLazyGetter(electronDefault, 'shell', () => {
  const { shell } = ChromeUtils.importESModule(
    'resource:///modules/electron/main/shell.sys.mjs'
  );
  return shell;
});

ChromeUtils.defineLazyGetter(electronDefault, 'clipboard', () => {
  const { clipboard } = ChromeUtils.importESModule(
    'resource:///modules/electron/main/clipboard.sys.mjs'
  );
  return clipboard;
});

ChromeUtils.defineLazyGetter(electronDefault, 'nativeTheme', () => {
  const { nativeTheme } = ChromeUtils.importESModule(
    'resource:///modules/electron/main/nativeTheme.sys.mjs'
  );
  return nativeTheme;
});

ChromeUtils.defineLazyGetter(electronDefault, 'asar', () => {
  const asar = ChromeUtils.importESModule(
    'resource:///modules/electron/common/asar.sys.mjs'
  );
  return asar.default;
});

export default electronDefault;
