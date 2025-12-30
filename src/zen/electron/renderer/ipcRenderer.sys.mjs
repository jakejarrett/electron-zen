// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

/**
 * ipcRenderer - Renderer process IPC module.
 *
 * Provides communication from renderer to main process.
 * This module is meant to be used in preload scripts.
 *
 * Note: In the actual renderer context, ipcRenderer is exposed
 * via the ElectronIPCChild actor. This module provides a
 * chrome-context version for preload scripts.
 *
 * @see https://www.electronjs.org/docs/latest/api/ipc-renderer
 */

import { EventEmitter } from 'resource:///modules/electron/common/EventEmitter.sys.mjs';
import { createLogger } from 'resource:///modules/electron/common/debug.sys.mjs';

const log = createLogger('ipcRenderer');

/**
 * IpcRenderer class - handles IPC to main process from renderer.
 *
 * In Gecko Electron, this is a wrapper that uses the JSWindowActor
 * system to communicate with the main process.
 */
class IpcRendererModule extends EventEmitter {
  /**
   * The ElectronIPCChild actor instance.
   * Set when attached to a content window.
   * @type {ElectronIPCChild|null}
   */
  #actor = null;

  constructor() {
    super();
    log.info('ipcRenderer module loaded');
  }

  /**
   * Attach this ipcRenderer to an actor.
   * Called by the preload script system.
   * @param {ElectronIPCChild} actor - The IPC actor
   * @internal
   */
  _attachActor(actor) {
    this.#actor = actor;
    log.debug('ipcRenderer attached to actor');
  }

  /**
   * Get the attached actor, throwing if not attached.
   * @returns {ElectronIPCChild}
   * @private
   */
  #getActor() {
    if (!this.#actor) {
      throw new Error('ipcRenderer not attached to a window context');
    }
    return this.#actor;
  }

  /**
   * Send an asynchronous message to the main process.
   *
   * @param {string} channel - The channel name
   * @param {...any} args - Arguments to send
   *
   * @example
   * ipcRenderer.send('user-action', { type: 'click', target: 'button' });
   */
  send(channel, ...args) {
    log.debug(`send('${channel}')`, args);
    this.#getActor().send(channel, ...args);
  }

  /**
   * Send a synchronous message to the main process.
   *
   * WARNING: This can block the renderer. Prefer invoke() instead.
   *
   * @param {string} channel - The channel name
   * @param {...any} args - Arguments to send
   * @returns {any} - The return value set by the handler
   *
   * @example
   * const result = ipcRenderer.sendSync('get-config', 'theme');
   */
  sendSync(channel, ...args) {
    log.debug(`sendSync('${channel}')`, args);
    return this.#getActor().sendSync(channel, ...args);
  }

  /**
   * Send a message and wait for an async response.
   *
   * This is the preferred way to do request/response IPC.
   *
   * @param {string} channel - The channel name
   * @param {...any} args - Arguments to send
   * @returns {Promise<any>} - The response from the main process
   *
   * @example
   * const user = await ipcRenderer.invoke('get-user', userId);
   */
  invoke(channel, ...args) {
    log.debug(`invoke('${channel}')`, args);
    return this.#getActor().invoke(channel, ...args);
  }

  /**
   * Post a message to the main process with MessagePort support.
   *
   * @param {string} channel - The channel name
   * @param {any} message - The message to post
   * @param {Transferable[]} [transfer] - Transferable objects
   *
   * @example
   * const { port1, port2 } = new MessageChannel();
   * ipcRenderer.postMessage('setup-channel', { msg: 'hello' }, [port2]);
   */
  postMessage(channel, message, transfer) {
    log.debug(`postMessage('${channel}')`);
    this.#getActor().postMessage(channel, message, transfer);
  }

  /**
   * Send a message to a specific webContents.
   *
   * @param {number} webContentsId - The target webContents ID
   * @param {string} channel - The channel name
   * @param {...any} args - Arguments to send
   *
   * @example
   * ipcRenderer.sendTo(2, 'peer-message', 'Hello from window 1');
   */
  sendTo(webContentsId, channel, ...args) {
    log.debug(`sendTo(${webContentsId}, '${channel}')`, args);
    this.#getActor().sendTo(webContentsId, channel, ...args);
  }

  /**
   * Send a message to the host webContents (for webviews).
   *
   * @param {string} channel - The channel name
   * @param {...any} args - Arguments to send
   */
  sendToHost(channel, ...args) {
    log.debug(`sendToHost('${channel}')`, args);
    this.#getActor().sendToHost(channel, ...args);
  }

  // ============================================
  // EventEmitter methods for receiving messages
  // ============================================

  /**
   * Add a listener for messages from the main process.
   *
   * @param {string} channel - The channel to listen on
   * @param {Function} listener - The listener function (event, ...args)
   * @returns {this}
   *
   * @example
   * ipcRenderer.on('update-available', (event, version) => {
   *   console.log('New version available:', version);
   * });
   */
  on(channel, listener) {
    log.debug(`on('${channel}')`);
    this.#getActor().on(channel, listener);
    return super.on(channel, listener);
  }

  /**
   * Add a one-time listener for messages from the main process.
   *
   * @param {string} channel - The channel to listen on
   * @param {Function} listener - The listener function
   * @returns {this}
   */
  once(channel, listener) {
    log.debug(`once('${channel}')`);
    this.#getActor().once(channel, listener);
    return super.once(channel, listener);
  }

  /**
   * Remove a listener from a channel.
   *
   * @param {string} channel - The channel name
   * @param {Function} listener - The listener to remove
   * @returns {this}
   */
  removeListener(channel, listener) {
    log.debug(`removeListener('${channel}')`);
    this.#getActor().removeListener(channel, listener);
    return super.removeListener(channel, listener);
  }

  /**
   * Remove all listeners from a channel.
   *
   * @param {string} [channel] - The channel name, or all if omitted
   * @returns {this}
   */
  removeAllListeners(channel) {
    log.debug(`removeAllListeners(${channel || 'all'})`);
    this.#getActor().removeAllListeners(channel);
    return super.removeAllListeners(channel);
  }
}

/**
 * Singleton instance of ipcRenderer.
 * Note: This needs to be attached to an actor before use.
 * @type {IpcRendererModule}
 */
export const ipcRenderer = new IpcRendererModule();

/**
 * Create a new ipcRenderer instance attached to a specific actor.
 * Used by the preload system to create per-window ipcRenderer instances.
 *
 * @param {ElectronIPCChild} actor - The IPC actor for this window
 * @returns {IpcRendererModule}
 */
export function createIpcRenderer(actor) {
  const renderer = new IpcRendererModule();
  renderer._attachActor(actor);
  return renderer;
}
