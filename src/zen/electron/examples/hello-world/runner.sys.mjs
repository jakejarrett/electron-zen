// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

/**
 * Hello World Example Runner
 *
 * This demonstrates how to run the official Electron "Hello World" example
 * using the Gecko Electron compatibility layer.
 *
 * Run this from the Browser Console or as a module.
 */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  app: 'resource:///modules/electron/main/app.sys.mjs',
  BrowserWindow: 'resource:///modules/electron/main/BrowserWindow.sys.mjs',
  pathUtils: 'resource:///modules/electron/common/pathUtils.sys.mjs',
});

// Base URL for the example files (using chrome:// from jar.mn)
const EXAMPLE_BASE = 'chrome://electron-examples/content/hello-world';

/**
 * Create the main window.
 */
function createWindow() {
  const win = new lazy.BrowserWindow({
    width: 800,
    height: 600,
    title: 'Hello World - Gecko Electron',
    webPreferences: {
      preload: `${EXAMPLE_BASE}/preload.js`,
      contextIsolation: true,
      sandbox: true,
    },
  });

  // Load the index.html file
  win.loadURL(`${EXAMPLE_BASE}/index.html`);

  return win;
}

/**
 * Run the Hello World example.
 */
export async function runHelloWorld() {
  console.log('[HelloWorld] Starting example...');

  // Wait for app to be ready
  await lazy.app.whenReady();

  console.log('[HelloWorld] App ready, creating window...');

  // Create the window
  const win = createWindow();

  // Handle macOS activate (clicking dock icon)
  lazy.app.on('activate', () => {
    if (lazy.BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  // Quit when all windows are closed (except on macOS)
  lazy.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      lazy.app.quit();
    }
  });

  console.log('[HelloWorld] Example running!');
  return win;
}

// Export for use as a module
export { createWindow };
