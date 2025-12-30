// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

/**
 * Example Electron app main process script.
 *
 * This demonstrates how to use the Gecko Electron API to create a simple
 * application with a browser window.
 *
 * Usage:
 *   From browser console or a privileged context:
 *
 *   const { runExample } = ChromeUtils.importESModule(
 *     'resource://gre/modules/electron/examples/hello-window.sys.mjs'
 *   );
 *   runExample();
 */

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  app: 'resource://gre/modules/electron/main/app.sys.mjs',
  BrowserWindow: 'resource://gre/modules/electron/main/BrowserWindow.sys.mjs',
  ElectronHost: 'resource://gre/modules/electron/host/ElectronHost.sys.mjs',
});

/**
 * Create the main window for the example app.
 * @returns {BrowserWindow}
 */
function createWindow() {
  // Create the browser window
  const win = new lazy.BrowserWindow({
    width: 800,
    height: 600,
    title: 'Hello from Gecko Electron!',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Load a simple HTML page
  // For this example, we'll load a data URL with inline HTML
  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <title>Hello Gecko Electron</title>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
          }
          .container {
            text-align: center;
            padding: 2rem;
          }
          h1 {
            font-size: 3rem;
            margin-bottom: 1rem;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.2);
          }
          p {
            font-size: 1.2rem;
            opacity: 0.9;
            margin-bottom: 2rem;
          }
          .info {
            background: rgba(255,255,255,0.1);
            border-radius: 10px;
            padding: 1.5rem;
            backdrop-filter: blur(10px);
          }
          .info h2 {
            font-size: 1.2rem;
            margin-bottom: 1rem;
          }
          .info ul {
            list-style: none;
            text-align: left;
          }
          .info li {
            padding: 0.5rem 0;
            border-bottom: 1px solid rgba(255,255,255,0.1);
          }
          .info li:last-child {
            border-bottom: none;
          }
          .badge {
            display: inline-block;
            background: rgba(255,255,255,0.2);
            padding: 0.25rem 0.75rem;
            border-radius: 20px;
            font-size: 0.9rem;
            margin-top: 1rem;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🦊 Hello, Gecko Electron!</h1>
          <p>Your Firefox-powered Electron alternative is working!</p>
          
          <div class="info">
            <h2>Runtime Information</h2>
            <ul>
              <li><strong>Platform:</strong> <span id="platform">Loading...</span></li>
              <li><strong>User Agent:</strong> <span id="userAgent">Loading...</span></li>
              <li><strong>Window Size:</strong> <span id="windowSize">Loading...</span></li>
            </ul>
          </div>
          
          <div class="badge">Milestone 1 Complete ✓</div>
        </div>
        
        <script>
          // Update runtime info
          document.getElementById('platform').textContent = navigator.platform;
          document.getElementById('userAgent').textContent = navigator.userAgent.split(' ').slice(-2).join(' ');
          document.getElementById('windowSize').textContent = window.innerWidth + ' × ' + window.innerHeight;
          
          window.addEventListener('resize', () => {
            document.getElementById('windowSize').textContent = window.innerWidth + ' × ' + window.innerHeight;
          });
        </script>
      </body>
    </html>
  `;

  // Load the HTML content via data URL
  const dataURL = 'data:text/html;charset=utf-8,' + encodeURIComponent(htmlContent);
  win.loadURL(dataURL);

  // Log window events
  win.on('ready-to-show', () => {
    console.log('Example window ready to show');
  });

  win.on('closed', () => {
    console.log('Example window closed');
  });

  win.webContents.on('did-finish-load', () => {
    console.log('Example window content loaded');
  });

  return win;
}

/**
 * Run the example application.
 */
export async function runExample() {
  console.log('Starting Gecko Electron example...');

  // Initialize the Electron host if not already done
  if (!lazy.ElectronHost.isReady()) {
    await lazy.ElectronHost.init();
  }

  // Wait for app to be ready
  await lazy.app.whenReady();
  console.log('App is ready!');

  // Create window when ready
  createWindow();

  // Handle all windows closed
  lazy.app.on('window-all-closed', () => {
    console.log('All windows closed');
    // On macOS, apps typically stay open until Cmd+Q
    if (Services.appinfo.OS !== 'Darwin') {
      // Don't quit the whole browser, just log
      console.log('Would quit app on non-macOS platform');
    }
  });

  console.log('Example app started!');
}

/**
 * Quick test function to verify imports work.
 */
export function test() {
  console.log('=== Gecko Electron Test ===');
  console.log('app module:', lazy.app);
  console.log('app.isReady():', lazy.app.isReady());
  console.log('app.getName():', lazy.app.getName());
  console.log('app.getVersion():', lazy.app.getVersion());
  console.log('app.getLocale():', lazy.app.getLocale());
  console.log('BrowserWindow:', lazy.BrowserWindow);
  console.log('=== Test Complete ===');
}
