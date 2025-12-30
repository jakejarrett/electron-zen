// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

/**
 * ElectronIPCParent - Parent-side (chrome/main process) IPC actor.
 *
 * Handles messages from renderer processes and routes them to ipcMain handlers.
 * This actor runs in the parent/chrome process.
 */

import { createLogger } from 'resource:///modules/electron/common/debug.sys.mjs';

const log = createLogger('ElectronIPCParent');

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  ipcMain: 'resource:///modules/electron/main/ipcMain.sys.mjs',
});

/**
 * Parent actor for Electron IPC communication.
 * Receives messages from ElectronIPCChild and dispatches to ipcMain handlers.
 */
export class ElectronIPCParent extends JSWindowActorParent {
  /**
   * Get the webContents ID for this actor's browsing context.
   * @returns {number|null}
   */
  get webContentsId() {
    // Try to get the webContents ID from the browser element
    const browser = this.browsingContext?.embedderElement;
    if (browser) {
      // Look for our custom attribute
      return parseInt(browser.getAttribute('electron-webcontents-id'), 10) || null;
    }
    return null;
  }

  /**
   * Get the BrowserWindow ID for this actor's browsing context.
   * @returns {number|null}
   */
  get browserWindowId() {
    const browser = this.browsingContext?.embedderElement;
    if (browser) {
      return parseInt(browser.getAttribute('electron-window-id'), 10) || null;
    }
    return null;
  }

  /**
   * Handle incoming messages from the child (renderer) process.
   * @param {Object} message - The message object
   * @param {string} message.name - The message name
   * @param {Object} message.data - The message data
   * @returns {Promise<any>}
   */
  async receiveMessage(message) {
    const { name, data } = message;

    log.debug(`Received message: ${name}`, data);

    switch (name) {
      case 'electron:ipc:send': {
        // Async send from renderer to main (fire-and-forget)
        return this.#handleSend(data);
      }

      case 'electron:ipc:invoke': {
        // Async invoke from renderer to main (expects response)
        return this.#handleInvoke(data);
      }

      case 'electron:ipc:sendSync': {
        // Synchronous send from renderer to main
        return this.#handleSendSync(data);
      }

      case 'electron:ipc:postMessage': {
        // MessagePort-style posting
        return this.#handlePostMessage(data);
      }

      default:
        log.warn(`Unknown IPC message: ${name}`);
        return undefined;
    }
  }

  /**
   * Handle async send (fire-and-forget).
   * @param {Object} data
   * @param {string} data.channel - The IPC channel name
   * @param {any[]} data.args - Arguments to pass
   * @private
   */
  #handleSend({ channel, args }) {
    log.debug(`IPC send on channel '${channel}'`, args);

    // Create an event object similar to Electron's IpcMainEvent
    const event = this.#createEvent(false);

    // Dispatch to ipcMain handlers
    lazy.ipcMain._emit(channel, event, ...args);
  }

  /**
   * Handle async invoke (expects response).
   * @param {Object} data
   * @param {string} data.channel - The IPC channel name
   * @param {any[]} data.args - Arguments to pass
   * @returns {Promise<any>}
   * @private
   */
  async #handleInvoke({ channel, args }) {
    log.debug(`IPC invoke on channel '${channel}'`, args);

    // Create an event object similar to Electron's IpcMainInvokeEvent
    const event = this.#createEvent(true);

    // Get the response from ipcMain handler
    try {
      const result = await lazy.ipcMain._handleInvoke(channel, event, ...args);
      return { success: true, result };
    } catch (error) {
      log.error(`IPC invoke error on channel '${channel}':`, error);
      return {
        success: false,
        error: {
          message: error.message || String(error),
          stack: error.stack,
        },
      };
    }
  }

  /**
   * Handle synchronous send.
   * @param {Object} data
   * @param {string} data.channel - The IPC channel name
   * @param {any[]} data.args - Arguments to pass
   * @returns {any}
   * @private
   */
  #handleSendSync({ channel, args }) {
    log.debug(`IPC sendSync on channel '${channel}'`, args);

    // Create an event object with returnValue
    const event = this.#createEvent(false);
    event.returnValue = undefined;

    // Dispatch to ipcMain handlers
    lazy.ipcMain._emit(channel, event, ...args);

    // Return whatever the handler set as returnValue
    return event.returnValue;
  }

  /**
   * Handle MessagePort-style posting.
   * @param {Object} data
   * @param {string} data.channel - The IPC channel name
   * @param {any} data.message - The message to post
   * @param {Transferable[]} data.transfer - Transferable objects
   * @private
   */
  #handlePostMessage({ channel, message, transfer }) {
    log.debug(`IPC postMessage on channel '${channel}'`);

    const event = this.#createEvent(false);
    event.ports = transfer || [];

    lazy.ipcMain._emit(channel, event, message);
  }

  /**
   * Create an IPC event object.
   * @param {boolean} isInvoke - Whether this is an invoke event
   * @returns {Object}
   * @private
   */
  #createEvent(isInvoke) {
    const parent = this;

    return {
      /**
       * The frame ID that sent this message.
       * @type {number}
       */
      frameId: this.browsingContext?.id || 0,

      /**
       * The process ID of the renderer.
       * @type {number}
       */
      processId: this.browsingContext?.currentWindowGlobal?.osPid || 0,

      /**
       * The webContents that sent this message.
       * @type {Object}
       */
      get sender() {
        // Lazily get the WebContents instance
        const wcId = parent.webContentsId;
        if (wcId) {
          // TODO: Look up actual WebContents instance from WindowManager
          return { id: wcId };
        }
        return null;
      },

      /**
       * Reply to the sender (for send/sendSync).
       * @param {string} channel - Reply channel name
       * @param {...any} args - Reply arguments
       */
      reply(channel, ...args) {
        parent.sendAsyncMessage('electron:ipc:message', { channel, args });
      },

      /**
       * Value to return for sendSync calls.
       * @type {any}
       */
      returnValue: undefined,

      /**
       * MessagePorts (for postMessage).
       * @type {MessagePort[]}
       */
      ports: [],

      /**
       * Same-origin policy check.
       * @type {boolean}
       */
      senderFrame: {
        url: this.browsingContext?.currentWindowGlobal?.documentURI?.spec || '',
        origin:
          this.browsingContext?.currentWindowGlobal?.documentPrincipal?.origin ||
          '',
      },
    };
  }

  /**
   * Send a message to the renderer process.
   * @param {string} channel - The IPC channel name
   * @param {...any} args - Arguments to pass
   */
  sendToRenderer(channel, ...args) {
    log.debug(`Sending to renderer on channel '${channel}'`, args);
    this.sendAsyncMessage('electron:ipc:message', { channel, args });
  }
}
