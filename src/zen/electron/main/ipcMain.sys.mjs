// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

/**
 * ipcMain - Main process IPC module.
 *
 * Handles asynchronous and synchronous communication from renderer processes.
 * Provides an Electron-compatible API for IPC in the main process.
 *
 * @see https://www.electronjs.org/docs/latest/api/ipc-main
 */

import { EventEmitter } from 'resource:///modules/electron/common/EventEmitter.sys.mjs';
import { createLogger } from 'resource:///modules/electron/common/debug.sys.mjs';

const log = createLogger('ipcMain');

/**
 * IpcMain class - handles IPC from renderer processes.
 */
class IpcMainModule extends EventEmitter {
  /**
   * Map of channel -> handler function for invoke calls.
   * @type {Map<string, Function>}
   */
  #handlers = new Map();

  constructor() {
    super();
    log.info('ipcMain initialized');
  }

  /**
   * Add a handler for an invokeable IPC channel.
   * Only one handler can be registered per channel.
   *
   * @param {string} channel - The channel name
   * @param {Function} listener - The handler function (event, ...args) => Promise<any>
   * @throws {Error} If a handler is already registered for this channel
   *
   * @example
   * ipcMain.handle('get-user', async (event, userId) => {
   *   return await fetchUser(userId);
   * });
   */
  handle(channel, listener) {
    if (this.#handlers.has(channel)) {
      throw new Error(`Handler already registered for channel '${channel}'`);
    }

    log.debug(`Registering handle for channel '${channel}'`);
    this.#handlers.set(channel, listener);
  }

  /**
   * Add a handler that can be overwritten.
   *
   * @param {string} channel - The channel name
   * @param {Function} listener - The handler function
   *
   * @example
   * ipcMain.handleOnce('setup', async (event) => {
   *   // This handler will be removed after first call
   *   return await doSetup();
   * });
   */
  handleOnce(channel, listener) {
    const wrappedListener = async (event, ...args) => {
      this.removeHandler(channel);
      return listener(event, ...args);
    };

    log.debug(`Registering handleOnce for channel '${channel}'`);
    this.#handlers.set(channel, wrappedListener);
  }

  /**
   * Remove the handler for a channel.
   *
   * @param {string} channel - The channel name
   *
   * @example
   * ipcMain.removeHandler('get-user');
   */
  removeHandler(channel) {
    log.debug(`Removing handler for channel '${channel}'`);
    this.#handlers.delete(channel);
  }

  /**
   * Internal method to handle invoke calls from ElectronIPCParent.
   * @param {string} channel - The channel name
   * @param {Object} event - The IPC event
   * @param {...any} args - Arguments from the renderer
   * @returns {Promise<any>}
   * @internal
   */
  async _handleInvoke(channel, event, ...args) {
    const handler = this.#handlers.get(channel);

    if (!handler) {
      throw new Error(`No handler registered for channel '${channel}'`);
    }

    log.debug(`Invoking handler for channel '${channel}'`);
    return handler(event, ...args);
  }

  /**
   * Internal method to emit events from ElectronIPCParent.
   * @param {string} channel - The channel name
   * @param {Object} event - The IPC event
   * @param {...any} args - Arguments from the renderer
   * @internal
   */
  _emit(channel, event, ...args) {
    log.debug(`Emitting on channel '${channel}'`);
    this.emit(channel, event, ...args);
  }

  // ============================================
  // EventEmitter overrides for IPC-specific behavior
  // ============================================

  /**
   * Add a listener for an IPC channel.
   * @param {string} channel - The channel name
   * @param {Function} listener - The listener function
   * @returns {this}
   *
   * @example
   * ipcMain.on('message', (event, data) => {
   *   console.log('Received:', data);
   *   event.reply('message-reply', 'Got it!');
   * });
   */
  on(channel, listener) {
    log.debug(`Adding listener for channel '${channel}'`);
    return super.on(channel, listener);
  }

  /**
   * Add a one-time listener for an IPC channel.
   * @param {string} channel - The channel name
   * @param {Function} listener - The listener function
   * @returns {this}
   */
  once(channel, listener) {
    log.debug(`Adding once listener for channel '${channel}'`);
    return super.once(channel, listener);
  }

  /**
   * Remove a listener from a channel.
   * @param {string} channel - The channel name
   * @param {Function} listener - The listener to remove
   * @returns {this}
   */
  removeListener(channel, listener) {
    log.debug(`Removing listener from channel '${channel}'`);
    return super.removeListener(channel, listener);
  }

  /**
   * Remove all listeners from a channel.
   * @param {string} [channel] - The channel name, or all if omitted
   * @returns {this}
   */
  removeAllListeners(channel) {
    if (channel) {
      log.debug(`Removing all listeners from channel '${channel}'`);
    } else {
      log.debug('Removing all listeners from all channels');
    }
    return super.removeAllListeners(channel);
  }
}

/**
 * Singleton instance of ipcMain.
 * @type {IpcMainModule}
 */
export const ipcMain = new IpcMainModule();
