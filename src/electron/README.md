# Gecko Electron - Milestone 1

This directory contains the Electron compatibility layer for Gecko/Firefox, enabling you to build desktop applications using Electron-like APIs on top of the Firefox rendering engine.

## Project Status: Milestone 1 Complete ✓

### What's Implemented

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

- **Infrastructure**
  - `ElectronHost` - Singleton runtime manager
  - `WindowManager` - Tracks all BrowserWindow instances
  - `AppRegistry` - App registration and isolation
  - `EventEmitter` - Node.js-style event system
  - `pathUtils` - Cross-platform path resolution

## Quick Start

### From the Browser Console (DevTools)

```javascript
// Import and run the example
const { runExample } = ChromeUtils.importESModule(
  'resource://gre/modules/electron/examples/hello-window.sys.mjs'
);
runExample();
```

### In Your Own Module

```javascript
// Import Electron modules
const { app, BrowserWindow } = ChromeUtils.importESModule(
  'resource://gre/modules/electron/electron.sys.mjs'
);

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
├── common/
│   ├── EventEmitter.sys.mjs  # Event emitter implementation
│   └── pathUtils.sys.mjs     # Path utilities
├── host/
│   ├── ElectronHost.sys.mjs  # Runtime singleton
│   ├── WindowManager.sys.mjs # Window tracking
│   └── AppRegistry.sys.mjs   # App registration
├── main/
│   ├── app.sys.mjs           # App lifecycle
│   ├── BrowserWindow.sys.mjs # Window class
│   └── webContents.sys.mjs   # Web content control
├── renderer/                  # (Milestone 2)
├── actors/                    # (Milestone 2)
├── content/
│   └── electron-window.xhtml # Window template
└── examples/
    └── hello-window.sys.mjs  # Example app
```

## What's Coming Next

### Milestone 2: IPC System

- `ipcMain` / `ipcRenderer`
- `contextBridge.exposeInMainWorld()`
- `webContents.send()` / `webContents.invoke()`
- Preload script support

### Milestone 3: Essential APIs

- `dialog` (open/save file, message boxes)
- `shell` (openExternal, openPath)
- `clipboard`
- `Menu` / `MenuItem`
- `nativeTheme`

### Milestone 4: Multi-App Support

- Multiple isolated apps in singleton runtime
- Container-based storage isolation
- Per-app window management

## Known Limitations

1. **Window Creation**: Currently falls back to creating tabs in the main browser window if the XUL window creation fails. Native window support is in progress.

2. **DevTools**: Uses Firefox's built-in DevTools, which have a different UI than Chrome DevTools.

3. **No Node.js**: Unlike Electron, there's no Node.js runtime. You'll need to use Web APIs and Firefox-specific APIs.

4. **Preload Scripts**: Not yet implemented (Milestone 2).

5. **IPC**: Not yet implemented (Milestone 2).

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
