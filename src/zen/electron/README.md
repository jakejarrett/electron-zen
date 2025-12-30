# Gecko Electron - Milestones 1 & 2

This directory contains the Electron compatibility layer for Gecko/Firefox, enabling you to build desktop applications using Electron-like APIs on top of the Firefox rendering engine.

## Project Status: Milestone 2 Complete ✓

### What's Implemented

#### Milestone 1: Core APIs ✓

- **`app` module** - Application lifecycle management

  - `app.whenReady()` / `app.isReady()`
  - `app.quit()` / `app.exit()`
  - `app.getPath()` / `app.setPath()`
  - `app.getName()` / `app.getVersion()` / `app.getLocale()`
  - Event emitter (ready, before-quit, will-quit, quit, window-all-closed)

- **`BrowserWindow` class** - Window management

  - Window creation with options (size, position, frame, etc.)
  - `loadURL()` / `loadFile()`
  - `show()` / `hide()` / `focus()` / `close()` / `destroy()`
  - `minimize()` / `maximize()` / `setFullScreen()`
  - `getBounds()` / `setBounds()` / `setSize()` / `setPosition()`
  - `setTitle()` / `getTitle()`
  - Static methods: `getAllWindows()`, `getFocusedWindow()`, `fromId()`

- **`WebContents` class** - Web page control
  - `loadURL()` / `loadFile()`
  - Navigation: `goBack()`, `goForward()`, `reload()`, `stop()`
  - `executeJavaScript()`
  - `getURL()` / `getTitle()`
  - `setZoomFactor()` / `getZoomFactor()`
  - DevTools: `openDevTools()` / `closeDevTools()` / `toggleDevTools()`
  - Event emitter (did-finish-load, did-start-loading, dom-ready, etc.)

#### Milestone 2: IPC System ✓

- **`ipcMain`** - Main process IPC handling

  - `ipcMain.on(channel, listener)` - Listen for async messages
  - `ipcMain.once(channel, listener)` - One-time listener
  - `ipcMain.handle(channel, listener)` - Handle invoke requests
  - `ipcMain.handleOnce(channel, listener)` - One-time invoke handler
  - `ipcMain.removeHandler(channel)` - Remove invoke handler
  - `ipcMain.removeListener(channel, listener)` - Remove listener
  - `ipcMain.removeAllListeners([channel])` - Remove all listeners

- **`ipcRenderer`** - Renderer process IPC

  - `ipcRenderer.send(channel, ...args)` - Async message to main
  - `ipcRenderer.sendSync(channel, ...args)` - Sync message (blocking)
  - `ipcRenderer.invoke(channel, ...args)` - Request/response pattern
  - `ipcRenderer.postMessage(channel, message, [transfer])` - MessagePort support
  - `ipcRenderer.sendTo(webContentsId, channel, ...args)` - Send to specific window
  - `ipcRenderer.sendToHost(channel, ...args)` - Send to webview host
  - `ipcRenderer.on(channel, listener)` - Listen for messages from main
  - `ipcRenderer.once(channel, listener)` - One-time listener
  - `ipcRenderer.removeListener(channel, listener)` - Remove listener
  - `ipcRenderer.removeAllListeners([channel])` - Remove all listeners

- **JSWindowActors** - IPC infrastructure

  - `ElectronIPCParent` - Parent (chrome) side IPC actor
  - `ElectronIPCChild` - Child (content) side IPC actor

- **Infrastructure**
  - `ElectronHost` - Singleton runtime manager
  - `WindowManager` - Tracks all BrowserWindow instances
  - `AppRegistry` - App registration and isolation
  - `EventEmitter` - Node.js-style event system
  - `pathUtils` - Cross-platform path resolution
  - `createLogger()` - Debug logging utilities

## Quick Start

### From the Browser Console (DevTools)

```javascript
// Import and run the example
const { runExample } = ChromeUtils.importESModule(
  'resource:///modules/electron/examples/hello-window.sys.mjs'
);
runExample();

// Or test the IPC system
const { testIPC, runIPCExample } = ChromeUtils.importESModule(
  'resource:///modules/electron/examples/ipc-example.sys.mjs'
);
testIPC(); // Test IPC handlers in console
runIPCExample(); // Run full IPC demo window
```

### In Your Own Module

```javascript
// Import Electron modules
const { app, BrowserWindow, ipcMain } = ChromeUtils.importESModule(
  'resource:///modules/electron/electron.sys.mjs'
);

// Set up IPC handlers
ipcMain.handle('get-data', async (event, key) => {
  return { key, value: 'Hello from main!' };
});

ipcMain.on('log-message', (event, msg) => {
  console.log('Renderer says:', msg);
  event.reply('log-reply', 'Got it!');
});

// Wait for app to be ready
await app.whenReady();

// Create a window
const win = new BrowserWindow({
  width: 800,
  height: 600,
  title: 'My App',
});

// Load content
win.loadURL('https://example.com');
// or
win.loadFile('/path/to/index.html');
```

## Directory Structure

```
electron/
├── electron.sys.mjs          # Main entry point
├── @types/
│   └── electron.d.ts         # TypeScript definitions
├── actors/
│   ├── ElectronIPCParent.sys.mjs  # Parent-side IPC actor
│   └── ElectronIPCChild.sys.mjs   # Child-side IPC actor
├── common/
│   ├── EventEmitter.sys.mjs  # Event emitter implementation
│   ├── debug.sys.mjs         # Logging utilities
│   └── pathUtils.sys.mjs     # Path utilities
├── host/
│   ├── ElectronHost.sys.mjs  # Runtime singleton
│   ├── WindowManager.sys.mjs # Window tracking
│   └── AppRegistry.sys.mjs   # App registration
├── main/
│   ├── app.sys.mjs           # App lifecycle
│   ├── BrowserWindow.sys.mjs # Window class
│   ├── ipcMain.sys.mjs       # Main process IPC
│   └── webContents.sys.mjs   # Web content control
├── renderer/
│   ├── ipcRenderer.sys.mjs   # Renderer process IPC
│   └── preload-bootstrap.js  # Preload script loader
├── content/
│   └── electron-window.xhtml # Window template
└── examples/
    ├── hello-window.sys.mjs  # Basic example
    └── ipc-example.sys.mjs   # IPC demo
```

## What's Coming Next

### Milestone 3: Essential APIs

- `dialog` (open/save file, message boxes)
- `shell` (openExternal, openPath)
- `clipboard`
- `Menu` / `MenuItem`
- `nativeTheme`
- `contextBridge.exposeInMainWorld()`
- Full preload script support

### Milestone 4: Multi-App Support

- Multiple isolated apps in singleton runtime
- Container-based storage isolation
- Per-app window management

## Known Limitations

1. **Window Creation**: Currently falls back to creating tabs in the main browser window if the XUL window creation fails. Native window support is in progress.

2. **DevTools**: Uses Firefox's built-in DevTools, which have a different UI than Chrome DevTools.

3. **No Node.js**: Unlike Electron, there's no Node.js runtime. You'll need to use Web APIs and Firefox-specific APIs.

4. **Preload Scripts**: Basic preload support via actors. Full `contextBridge` support coming in Milestone 3.

5. **IPC in Content**: The `ipcRenderer` API is exposed to content via a custom event (`electron-ipc-ready`). Full contextIsolation support coming in Milestone 3.

## API Differences from Electron

| Feature       | Electron        | Gecko Electron           |
| ------------- | --------------- | ------------------------ |
| JS Engine     | V8 (Chromium)   | SpiderMonkey (Firefox)   |
| Node.js       | Built-in        | Not available            |
| DevTools      | Chrome DevTools | Firefox DevTools         |
| Process Model | Multi-process   | Fission (site isolation) |
| Module System | CommonJS + ESM  | ES Modules only          |

## Contributing

This is an experimental project. Contributions are welcome! Key areas:

- Testing on different platforms
- Implementing missing APIs
- Documentation improvements
- Example apps

## License

MPL-2.0 (same as Firefox)
