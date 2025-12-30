// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

/**
 * TypeScript type definitions for Gecko Electron.
 *
 * These types aim to be compatible with @electron/types while
 * documenting Gecko-specific behavior and limitations.
 */

declare module 'electron' {
  // ============================================
  // EventEmitter
  // ============================================

  export interface EventEmitter {
    on(event: string, listener: (...args: any[]) => void): this;
    once(event: string, listener: (...args: any[]) => void): this;
    off(event: string, listener: (...args: any[]) => void): this;
    addListener(event: string, listener: (...args: any[]) => void): this;
    removeListener(event: string, listener: (...args: any[]) => void): this;
    removeAllListeners(event?: string): this;
    emit(event: string, ...args: any[]): boolean;
    listenerCount(event: string): number;
    eventNames(): string[];
    listeners(event: string): Function[];
  }

  // ============================================
  // App
  // ============================================

  export interface App extends EventEmitter {
    // Lifecycle
    isReady(): boolean;
    whenReady(): Promise<void>;
    quit(): void;
    exit(exitCode?: number): void;
    relaunch(options?: { args?: string[]; execPath?: string }): void;
    isQuitting(): boolean;

    // Paths
    getPath(
      name:
        | 'home'
        | 'appData'
        | 'userData'
        | 'temp'
        | 'exe'
        | 'module'
        | 'desktop'
        | 'documents'
        | 'downloads'
        | 'music'
        | 'pictures'
        | 'videos'
        | 'logs'
        | 'crashDumps'
    ): string;
    setPath(name: string, path: string): void;
    getAppPath(): string;
    setAppPath(path: string): void;

    // Info
    getName(): string;
    setName(name: string): void;
    getVersion(): string;
    getLocale(): string;
    getSystemLocale(): string;
    getPreferredSystemLanguages(): string[];
    getExePath(): string;

    // System
    isPackaged(): boolean;
    getUserAgent(): string;
    setUserAgent(userAgent: string): void;
    getBadgeCount(): number;
    setBadgeCount(count: number): boolean;
    focus(options?: { steal?: boolean }): void;
    hide(): void;
    show(): void;
    isHidden(): boolean;

    // Command line
    commandLine: {
      appendSwitch(key: string, value?: string): void;
      appendArgument(value: string): void;
      hasSwitch(key: string): boolean;
      getSwitchValue(key: string): string;
    };

    // Dock (macOS)
    dock: {
      bounce(type?: 'critical' | 'informational'): number;
      cancelBounce(id: number): void;
      downloadFinished(filePath: string): void;
      setBadge(text: string): void;
      getBadge(): string;
      hide(): void;
      show(): Promise<void>;
      isVisible(): boolean;
      setMenu(menu: Menu | null): void;
      getMenu(): Menu | null;
      setIcon(icon: NativeImage | string): void;
    };
  }

  export const app: App;

  // ============================================
  // BrowserWindow
  // ============================================

  export interface BrowserWindowConstructorOptions {
    width?: number;
    height?: number;
    x?: number;
    y?: number;
    useContentSize?: boolean;
    center?: boolean;
    minWidth?: number;
    minHeight?: number;
    maxWidth?: number;
    maxHeight?: number;
    resizable?: boolean;
    movable?: boolean;
    minimizable?: boolean;
    maximizable?: boolean;
    closable?: boolean;
    focusable?: boolean;
    alwaysOnTop?: boolean;
    fullscreen?: boolean;
    fullscreenable?: boolean;
    simpleFullscreen?: boolean;
    skipTaskbar?: boolean;
    kiosk?: boolean;
    title?: string;
    icon?: NativeImage | string;
    show?: boolean;
    frame?: boolean;
    parent?: BrowserWindow;
    modal?: boolean;
    acceptFirstMouse?: boolean;
    disableAutoHideCursor?: boolean;
    autoHideMenuBar?: boolean;
    enableLargerThanScreen?: boolean;
    backgroundColor?: string;
    hasShadow?: boolean;
    opacity?: number;
    darkTheme?: boolean;
    transparent?: boolean;
    titleBarStyle?: 'default' | 'hidden' | 'hiddenInset' | 'customButtonsOnHover';
    webPreferences?: WebPreferences;
  }

  export interface WebPreferences {
    nodeIntegration?: boolean;
    contextIsolation?: boolean;
    sandbox?: boolean;
    preload?: string;
    devTools?: boolean;
    webSecurity?: boolean;
    allowRunningInsecureContent?: boolean;
    enableRemoteModule?: boolean;
  }

  export interface Rectangle {
    x: number;
    y: number;
    width: number;
    height: number;
  }

  export class BrowserWindow extends EventEmitter {
    constructor(options?: BrowserWindowConstructorOptions);

    // Properties
    readonly id: number;
    readonly webContents: WebContents;

    // Static methods
    static getAllWindows(): BrowserWindow[];
    static getFocusedWindow(): BrowserWindow | null;
    static fromId(id: number): BrowserWindow | undefined;
    static fromWebContents(webContents: WebContents): BrowserWindow | undefined;

    // Instance methods
    isDestroyed(): boolean;

    // Window state
    show(): void;
    showInactive(): void;
    hide(): void;
    isVisible(): boolean;
    focus(): void;
    blur(): void;
    isFocused(): boolean;
    minimize(): void;
    restore(): void;
    isMinimized(): boolean;
    maximize(): void;
    unmaximize(): void;
    isMaximized(): boolean;
    setFullScreen(flag: boolean): void;
    isFullScreen(): boolean;
    close(): void;
    destroy(): void;

    // Size & position
    getBounds(): Rectangle;
    setBounds(bounds: Partial<Rectangle>, animate?: boolean): void;
    getContentBounds(): Rectangle;
    getSize(): [number, number];
    setSize(width: number, height: number, animate?: boolean): void;
    getPosition(): [number, number];
    setPosition(x: number, y: number, animate?: boolean): void;
    center(): void;

    // Content
    loadURL(url: string, options?: LoadURLOptions): Promise<void>;
    loadFile(filePath: string, options?: LoadFileOptions): Promise<void>;
    reload(): void;

    // Title & appearance
    setTitle(title: string): void;
    getTitle(): string;
    setBackgroundColor(color: string): void;
  }

  export interface LoadURLOptions {
    httpReferrer?: string;
    userAgent?: string;
    extraHeaders?: string;
    postData?: any[];
  }

  export interface LoadFileOptions {
    query?: Record<string, string>;
    search?: string;
    hash?: string;
  }

  // ============================================
  // WebContents
  // ============================================

  export class WebContents extends EventEmitter {
    readonly id: number;

    // Navigation
    loadURL(url: string, options?: LoadURLOptions): Promise<void>;
    loadFile(filePath: string, options?: LoadFileOptions): Promise<void>;
    getURL(): string;
    getTitle(): string;
    isLoading(): boolean;
    isWaitingForResponse(): boolean;
    stop(): void;
    reload(): void;
    reloadIgnoringCache(): void;
    canGoBack(): boolean;
    canGoForward(): boolean;
    goBack(): void;
    goForward(): void;
    goToIndex(index: number): void;

    // JavaScript execution
    executeJavaScript(code: string, userGesture?: boolean): Promise<any>;

    // IPC
    send(channel: string, ...args: any[]): void;
    invoke(channel: string, ...args: any[]): Promise<any>;

    // DevTools
    openDevTools(options?: { mode?: 'left' | 'right' | 'bottom' | 'undocked' | 'detach' }): void;
    closeDevTools(): void;
    isDevToolsOpened(): boolean;
    toggleDevTools(): void;

    // Focus
    focus(): void;
    isFocused(): boolean;

    // Zoom
    setZoomFactor(factor: number): void;
    getZoomFactor(): number;
    setZoomLevel(level: number): void;
    getZoomLevel(): number;

    // Printing
    print(options?: PrintOptions): Promise<void>;
    printToPDF(options?: PrintToPDFOptions): Promise<Buffer>;

    // State
    isDestroyed(): boolean;

    // Static methods
    static getAllWebContents(): WebContents[];
    static fromId(id: number): WebContents | undefined;
    static getFocusedWebContents(): WebContents | undefined;
  }

  export interface PrintOptions {
    silent?: boolean;
    printBackground?: boolean;
    deviceName?: string;
  }

  export interface PrintToPDFOptions {
    landscape?: boolean;
    displayHeaderFooter?: boolean;
    printBackground?: boolean;
    scale?: number;
    pageSize?: string | { width: number; height: number };
    margins?: {
      top?: number;
      bottom?: number;
      left?: number;
      right?: number;
    };
  }

  // ============================================
  // Placeholder types for unimplemented modules
  // ============================================

  export interface IpcMain extends EventEmitter {
    on(channel: string, listener: (event: IpcMainEvent, ...args: any[]) => void): this;
    once(channel: string, listener: (event: IpcMainEvent, ...args: any[]) => void): this;
    handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: any[]) => any): void;
    handleOnce(channel: string, listener: (event: IpcMainInvokeEvent, ...args: any[]) => any): void;
    removeHandler(channel: string): void;
  }

  export interface IpcMainEvent {
    frameId: number;
    sender: WebContents;
    reply(channel: string, ...args: any[]): void;
  }

  export interface IpcMainInvokeEvent {
    frameId: number;
    sender: WebContents;
  }

  export interface IpcRenderer extends EventEmitter {
    send(channel: string, ...args: any[]): void;
    invoke(channel: string, ...args: any[]): Promise<any>;
    on(channel: string, listener: (event: IpcRendererEvent, ...args: any[]) => void): this;
    once(channel: string, listener: (event: IpcRendererEvent, ...args: any[]) => void): this;
  }

  export interface IpcRendererEvent {
    sender: IpcRenderer;
    senderId: number;
  }

  export const ipcMain: IpcMain;
  export const ipcRenderer: IpcRenderer;

  // Placeholder interfaces for future implementation
  export interface Menu {}
  export interface MenuItem {}
  export interface Tray {}
  export interface NativeImage {}
  export interface Dialog {}
  export interface Shell {}
  export interface Clipboard {}
  export interface Screen {}
  export interface GlobalShortcut {}
  export interface PowerMonitor {}
  export interface Session {}
  export interface Protocol {}
  export interface Net {}
  export interface NativeTheme {}
  export interface SystemPreferences {}
  export interface Notification {}
  export interface AutoUpdater {}

  export const dialog: Dialog;
  export const shell: Shell;
  export const clipboard: Clipboard;
  export const screen: Screen;
  export const globalShortcut: GlobalShortcut;
  export const powerMonitor: PowerMonitor;
  export const session: Session;
  export const protocol: Protocol;
  export const net: Net;
  export const nativeTheme: NativeTheme;
  export const systemPreferences: SystemPreferences;
  export const autoUpdater: AutoUpdater;
}
