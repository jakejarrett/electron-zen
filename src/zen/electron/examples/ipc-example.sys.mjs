// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

/**
 * Example demonstrating IPC communication in Gecko Electron.
 *
 * This shows how to use ipcMain and ipcRenderer for bidirectional
 * communication between main and renderer processes.
 *
 * Usage:
 *   From browser console:
 *
 *   const { runIPCExample, testIPC } = ChromeUtils.importESModule(
 *     'resource:///modules/electron/examples/ipc-example.sys.mjs'
 *   );
 *   runIPCExample();
 *
 * Or just test the IPC handlers:
 *   testIPC();
 */

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  app: 'resource:///modules/electron/main/app.sys.mjs',
  BrowserWindow: 'resource:///modules/electron/main/BrowserWindow.sys.mjs',
  ipcMain: 'resource:///modules/electron/main/ipcMain.sys.mjs',
  ElectronHost: 'resource:///modules/electron/host/ElectronHost.sys.mjs',
});

/**
 * Set up IPC handlers for the example.
 */
function setupIPCHandlers() {
  // Handle synchronous ping
  lazy.ipcMain.on('ping', (event) => {
    console.log('Received ping from renderer');
    event.returnValue = 'pong';
  });

  // Handle async request
  lazy.ipcMain.on('async-message', (event, message) => {
    console.log('Received async message:', message);
    // Reply back to the renderer
    event.reply('async-reply', { received: message, timestamp: Date.now() });
  });

  // Handle invoke-style request
  lazy.ipcMain.handle('get-data', async (event, key) => {
    console.log('Handling get-data request for key:', key);

    // Simulate async data fetch
    await new Promise((resolve) => setTimeout(resolve, 100));

    const data = {
      'user': { name: 'Test User', id: 123 },
      'settings': { theme: 'dark', fontSize: 14 },
      'app-info': {
        name: lazy.app.getName(),
        version: lazy.app.getVersion(),
        locale: lazy.app.getLocale(),
      },
    };

    return data[key] || null;
  });

  // Handle multiple arguments
  lazy.ipcMain.handle('calculate', async (event, operation, a, b) => {
    console.log(`Calculating ${operation}(${a}, ${b})`);

    switch (operation) {
      case 'add':
        return a + b;
      case 'subtract':
        return a - b;
      case 'multiply':
        return a * b;
      case 'divide':
        return b !== 0 ? a / b : null;
      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  });

  // Handle with error
  lazy.ipcMain.handle('might-fail', async (event, shouldFail) => {
    if (shouldFail) {
      throw new Error('This was expected to fail!');
    }
    return 'Success!';
  });

  console.log('IPC handlers set up');
}

/**
 * Create a window that demonstrates IPC.
 */
function createIPCWindow() {
  const win = new lazy.BrowserWindow({
    width: 900,
    height: 700,
    title: 'Gecko Electron IPC Demo',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <title>IPC Demo</title>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #1a1a2e;
            color: #eaeaea;
            padding: 2rem;
            min-height: 100vh;
          }
          h1 {
            color: #00d4ff;
            margin-bottom: 1.5rem;
          }
          .section {
            background: #16213e;
            border-radius: 10px;
            padding: 1.5rem;
            margin-bottom: 1.5rem;
          }
          .section h2 {
            color: #00d4ff;
            font-size: 1.1rem;
            margin-bottom: 1rem;
            padding-bottom: 0.5rem;
            border-bottom: 1px solid #0f3460;
          }
          button {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            padding: 0.75rem 1.5rem;
            border-radius: 5px;
            cursor: pointer;
            font-size: 0.9rem;
            margin: 0.25rem;
            transition: transform 0.1s, box-shadow 0.1s;
          }
          button:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
          }
          button:active {
            transform: translateY(0);
          }
          .output {
            background: #0f3460;
            border-radius: 5px;
            padding: 1rem;
            margin-top: 1rem;
            font-family: 'Monaco', 'Menlo', monospace;
            font-size: 0.85rem;
            max-height: 200px;
            overflow-y: auto;
          }
          .output .log {
            padding: 0.25rem 0;
            border-bottom: 1px solid rgba(255,255,255,0.05);
          }
          .output .log:last-child {
            border-bottom: none;
          }
          .output .time {
            color: #666;
            margin-right: 0.5rem;
          }
          .output .channel {
            color: #00d4ff;
            margin-right: 0.5rem;
          }
          .output .data {
            color: #a8e6cf;
          }
          .output .error {
            color: #ff6b6b;
          }
          input {
            background: #0f3460;
            border: 1px solid #1e4d7b;
            color: white;
            padding: 0.5rem;
            border-radius: 5px;
            margin-right: 0.5rem;
          }
          .flex {
            display: flex;
            gap: 0.5rem;
            flex-wrap: wrap;
            align-items: center;
          }
          .status {
            display: inline-block;
            padding: 0.25rem 0.75rem;
            border-radius: 20px;
            font-size: 0.8rem;
            background: #0f3460;
          }
          .status.ready {
            background: #1b4332;
            color: #95d5b2;
          }
          .status.pending {
            background: #5a3d0a;
            color: #ffc107;
          }
        </style>
      </head>
      <body>
        <h1>🔌 Gecko Electron IPC Demo</h1>
        <p style="margin-bottom: 1.5rem; opacity: 0.7;">
          Test IPC communication between main and renderer processes.
          Open the browser console to see main process logs.
        </p>

        <div class="section">
          <h2>Basic IPC</h2>
          <div class="flex">
            <button onclick="sendPing()">Send Ping (sync)</button>
            <button onclick="sendAsyncMessage()">Send Async Message</button>
            <span class="status" id="ipc-status">Ready</span>
          </div>
          <div class="output" id="basic-output"></div>
        </div>

        <div class="section">
          <h2>IPC Invoke (Request/Response)</h2>
          <div class="flex">
            <button onclick="getData('user')">Get User</button>
            <button onclick="getData('settings')">Get Settings</button>
            <button onclick="getData('app-info')">Get App Info</button>
          </div>
          <div class="output" id="invoke-output"></div>
        </div>

        <div class="section">
          <h2>IPC with Arguments</h2>
          <div class="flex">
            <input type="number" id="num-a" value="10" style="width: 60px;">
            <select id="operation" style="background: #0f3460; color: white; border: 1px solid #1e4d7b; padding: 0.5rem; border-radius: 5px;">
              <option value="add">+</option>
              <option value="subtract">-</option>
              <option value="multiply">×</option>
              <option value="divide">÷</option>
            </select>
            <input type="number" id="num-b" value="5" style="width: 60px;">
            <button onclick="calculate()">Calculate</button>
          </div>
          <div class="output" id="calc-output"></div>
        </div>

        <div class="section">
          <h2>Error Handling</h2>
          <div class="flex">
            <button onclick="testError(false)">Success Request</button>
            <button onclick="testError(true)">Failing Request</button>
          </div>
          <div class="output" id="error-output"></div>
        </div>

        <script>
          // Helper to log to output areas
          function logTo(elementId, channel, data, isError = false) {
            const output = document.getElementById(elementId);
            const time = new Date().toLocaleTimeString();
            const div = document.createElement('div');
            div.className = 'log';
            div.innerHTML = \`
              <span class="time">\${time}</span>
              <span class="channel">[\${channel}]</span>
              <span class="\${isError ? 'error' : 'data'}">\${JSON.stringify(data)}</span>
            \`;
            output.insertBefore(div, output.firstChild);
          }

          function setStatus(text, type = 'ready') {
            const status = document.getElementById('ipc-status');
            status.textContent = text;
            status.className = 'status ' + type;
          }

          // Note: In a real app, ipcRenderer would be exposed via preload script
          // For this demo, we're showing what the API would look like

          async function sendPing() {
            setStatus('Sending...', 'pending');
            logTo('basic-output', 'ping', 'Sending ping...');
            
            // Simulated - in real use this would be ipcRenderer.sendSync('ping')
            setTimeout(() => {
              logTo('basic-output', 'pong', 'Received: pong');
              setStatus('Ready', 'ready');
            }, 100);
          }

          async function sendAsyncMessage() {
            setStatus('Sending...', 'pending');
            const message = { text: 'Hello from renderer!', time: Date.now() };
            logTo('basic-output', 'async-message', message);
            
            // Simulated response
            setTimeout(() => {
              logTo('basic-output', 'async-reply', { received: message, timestamp: Date.now() });
              setStatus('Ready', 'ready');
            }, 150);
          }

          async function getData(key) {
            logTo('invoke-output', 'get-data', { key });
            
            // Simulated response
            setTimeout(() => {
              const data = {
                'user': { name: 'Test User', id: 123 },
                'settings': { theme: 'dark', fontSize: 14 },
                'app-info': { name: 'Zen Browser', version: '1.0', locale: 'en-US' },
              };
              logTo('invoke-output', 'response', data[key] || null);
            }, 200);
          }

          async function calculate() {
            const a = parseFloat(document.getElementById('num-a').value);
            const b = parseFloat(document.getElementById('num-b').value);
            const op = document.getElementById('operation').value;
            
            logTo('calc-output', 'calculate', { operation: op, a, b });
            
            // Simulated response
            setTimeout(() => {
              let result;
              switch (op) {
                case 'add': result = a + b; break;
                case 'subtract': result = a - b; break;
                case 'multiply': result = a * b; break;
                case 'divide': result = b !== 0 ? a / b : 'Division by zero!'; break;
              }
              logTo('calc-output', 'result', result);
            }, 100);
          }

          async function testError(shouldFail) {
            logTo('error-output', 'might-fail', { shouldFail });
            
            // Simulated response
            setTimeout(() => {
              if (shouldFail) {
                logTo('error-output', 'error', 'This was expected to fail!', true);
              } else {
                logTo('error-output', 'success', 'Success!');
              }
            }, 100);
          }
        </script>
      </body>
    </html>
  `;

  const dataURL = 'data:text/html;charset=utf-8,' + encodeURIComponent(htmlContent);
  win.loadURL(dataURL);

  win.on('ready-to-show', () => {
    console.log('IPC demo window ready');
  });

  return win;
}

/**
 * Run the IPC example application.
 */
export async function runIPCExample() {
  console.log('Starting IPC example...');

  // Initialize the Electron host if needed
  if (!lazy.ElectronHost.isReady()) {
    await lazy.ElectronHost.init();
  }

  // Set up IPC handlers
  setupIPCHandlers();

  // Wait for app to be ready
  await lazy.app.whenReady();

  // Create the window
  createIPCWindow();

  console.log('IPC example started!');
}

/**
 * Test IPC handlers directly from console.
 */
export async function testIPC() {
  console.log('=== Testing IPC Handlers ===');

  // Set up handlers
  setupIPCHandlers();

  // Create a mock event
  const mockEvent = {
    returnValue: undefined,
    reply: (channel, data) => {
      console.log(`Reply on ${channel}:`, data);
    },
    sender: { id: 1 },
  };

  // Test sync ping
  console.log('\n--- Testing ping ---');
  lazy.ipcMain._emit('ping', mockEvent);
  console.log('returnValue:', mockEvent.returnValue);

  // Test async message
  console.log('\n--- Testing async-message ---');
  lazy.ipcMain._emit('async-message', mockEvent, { test: 'hello' });

  // Test invoke
  console.log('\n--- Testing get-data invoke ---');
  try {
    const userData = await lazy.ipcMain._handleInvoke('get-data', mockEvent, 'user');
    console.log('User data:', userData);

    const appInfo = await lazy.ipcMain._handleInvoke('get-data', mockEvent, 'app-info');
    console.log('App info:', appInfo);
  } catch (e) {
    console.error('Invoke error:', e);
  }

  // Test calculate
  console.log('\n--- Testing calculate invoke ---');
  try {
    const sum = await lazy.ipcMain._handleInvoke('calculate', mockEvent, 'add', 10, 5);
    console.log('10 + 5 =', sum);

    const product = await lazy.ipcMain._handleInvoke('calculate', mockEvent, 'multiply', 7, 8);
    console.log('7 × 8 =', product);
  } catch (e) {
    console.error('Calculate error:', e);
  }

  // Test error handling
  console.log('\n--- Testing error handling ---');
  try {
    await lazy.ipcMain._handleInvoke('might-fail', mockEvent, false);
    console.log('No-fail: Success');
  } catch (e) {
    console.error('Unexpected error:', e);
  }

  try {
    await lazy.ipcMain._handleInvoke('might-fail', mockEvent, true);
    console.log('Should have failed!');
  } catch (e) {
    console.log('Expected error caught:', e.message);
  }

  console.log('\n=== IPC Test Complete ===');
}
