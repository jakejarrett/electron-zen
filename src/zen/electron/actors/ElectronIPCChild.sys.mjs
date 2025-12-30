// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

/**
 * ElectronIPCChild - Child-side (content/renderer process) IPC actor.
 *
 * Provides IPC communication from renderer to main process.
 * This actor runs in the content process and exposes ipcRenderer-like functionality.
 */

import { createLogger } from 'resource:///modules/electron/common/debug.sys.mjs';

const log = createLogger('ElectronIPCChild');

/**
 * Child actor for Electron IPC communication.
 * Sends messages to ElectronIPCParent and receives messages from main process.
 */
export class ElectronIPCChild extends JSWindowActorChild {
  /**
   * Map of channel -> Set of listeners for incoming messages.
   * @type {Map<string, Set<Function>>}
   */
  #listeners = new Map();

  /**
   * Map of channel -> listener for one-time listeners.
   * @type {Map<string, Set<Function>>}
   */
  #onceListeners = new Map();

  /**
   * Pending invoke calls waiting for response.
   * @type {Map<number, {resolve: Function, reject: Function}>}
   */
  #pendingInvokes = new Map();

  /**
   * Counter for invoke request IDs.
   * @type {number}
   */
  #invokeIdCounter = 0;

  /**
   * Whether the IPC has been initialized in this window.
   * @type {boolean}
   */
  #initialized = false;

  /**
   * Handle events from the content.
   * @param {Event} event - The DOM event
   */
  handleEvent(event) {
    if (event.type === 'DOMContentLoaded') {
      this.#onContentLoaded();
    }
  }

  /**
   * Called when content is loaded.
   * Sets up the ipcRenderer API on the window if preload allows it.
   * @private
   */
  #onContentLoaded() {
    if (this.#initialized) {
      return;
    }

    this.#initialized = true;
    log.debug('ElectronIPCChild initialized for', this.contentWindow?.location?.href);

    // Expose ipcRenderer to content if contextIsolation is disabled
    // or if we're in a privileged context
    this.#exposeIpcRenderer();
  }

  /**
   * Expose the ipcRenderer API to the content window.
   * @private
   */
  #exposeIpcRenderer() {
    const child = this;

    // Create the ipcRenderer object for content scripts
    const ipcRenderer = {
      /**
       * Send an asynchronous message to the main process.
       * @param {string} channel - The channel name
       * @param {...any} args - Arguments to send
       */
      send(channel, ...args) {
        child.send(channel, ...args);
      },

      /**
       * Send a synchronous message to the main process.
       * WARNING: This blocks the renderer. Avoid using in production.
       * @param {string} channel - The channel name
       * @param {...any} args - Arguments to send
       * @returns {any} - The return value from the handler
       */
      sendSync(channel, ...args) {
        return child.sendSync(channel, ...args);
      },

      /**
       * Send a message and wait for an async response.
       * @param {string} channel - The channel name
       * @param {...any} args - Arguments to send
       * @returns {Promise<any>} - The response from the handler
       */
      invoke(channel, ...args) {
        return child.invoke(channel, ...args);
      },

      /**
       * Post a message to the main process.
       * @param {string} channel - The channel name
       * @param {any} message - The message to post
       * @param {Transferable[]} [transfer] - Transferable objects
       */
      postMessage(channel, message, transfer) {
        child.postMessage(channel, message, transfer);
      },

      /**
       * Send a message to a specific webContents.
       * @param {number} webContentsId - The target webContents ID
       * @param {string} channel - The channel name
       * @param {...any} args - Arguments to send
       */
      sendTo(webContentsId, channel, ...args) {
        child.sendTo(webContentsId, channel, ...args);
      },

      /**
       * Send a message to the host webContents.
       * @param {string} channel - The channel name
       * @param {...any} args - Arguments to send
       */
      sendToHost(channel, ...args) {
        child.sendToHost(channel, ...args);
      },

      /**
       * Add a listener for messages on a channel.
       * @param {string} channel - The channel to listen on
       * @param {Function} listener - The listener function
       * @returns {this}
       */
      on(channel, listener) {
        child.on(channel, listener);
        return this;
      },

      /**
       * Add a one-time listener for messages on a channel.
       * @param {string} channel - The channel to listen on
       * @param {Function} listener - The listener function
       * @returns {this}
       */
      once(channel, listener) {
        child.once(channel, listener);
        return this;
      },

      /**
       * Remove a listener from a channel.
       * @param {string} channel - The channel name
       * @param {Function} listener - The listener to remove
       * @returns {this}
       */
      removeListener(channel, listener) {
        child.removeListener(channel, listener);
        return this;
      },

      /**
       * Remove all listeners from a channel.
       * @param {string} [channel] - The channel name, or all channels if omitted
       * @returns {this}
       */
      removeAllListeners(channel) {
        child.removeAllListeners(channel);
        return this;
      },
    };

    // Store reference for access
    this.ipcRenderer = ipcRenderer;

    // Try to expose to window
    // In a real Electron app with contextIsolation, this would go through contextBridge
    try {
      // Export via custom event for preload scripts
      const event = new CustomEvent('electron-ipc-ready', {
        detail: { ipcRenderer },
      });
      this.contentWindow?.dispatchEvent(event);

      log.debug('ipcRenderer exposed via electron-ipc-ready event');
    } catch (e) {
      log.warn('Could not expose ipcRenderer:', e);
    }
  }

  /**
   * Handle incoming messages from the parent (main) process.
   * @param {Object} message - The message object
   */
  receiveMessage(message) {
    const { name, data } = message;

    log.debug(`Received message from main: ${name}`, data);

    switch (name) {
      case 'electron:ipc:message': {
        // Message from main process to renderer
        this.#dispatchToListeners(data.channel, data.args);
        break;
      }

      case 'electron:ipc:invokeResponse': {
        // Response to an invoke call
        this.#handleInvokeResponse(data);
        break;
      }

      default:
        log.warn(`Unknown message from main: ${name}`);
    }
  }

  /**
   * Dispatch a message to registered listeners.
   * @param {string} channel - The channel name
   * @param {any[]} args - The arguments
   * @private
   */
  #dispatchToListeners(channel, args) {
    // Create event object
    const event = {
      sender: null, // Not available in renderer
      ports: [],
    };

    // Call regular listeners
    const listeners = this.#listeners.get(channel);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(event, ...args);
        } catch (e) {
          log.error(`Error in IPC listener for '${channel}':`, e);
        }
      }
    }

    // Call and remove once listeners
    const onceListeners = this.#onceListeners.get(channel);
    if (onceListeners) {
      for (const listener of onceListeners) {
        try {
          listener(event, ...args);
        } catch (e) {
          log.error(`Error in IPC once listener for '${channel}':`, e);
        }
      }
      this.#onceListeners.delete(channel);
    }
  }

  /**
   * Handle response to an invoke call.
   * @param {Object} data
   * @param {number} data.id - The invoke request ID
   * @param {boolean} data.success - Whether the call succeeded
   * @param {any} data.result - The result (if success)
   * @param {Object} data.error - The error (if failed)
   * @private
   */
  #handleInvokeResponse({ id, success, result, error }) {
    const pending = this.#pendingInvokes.get(id);
    if (!pending) {
      log.warn(`No pending invoke for id ${id}`);
      return;
    }

    this.#pendingInvokes.delete(id);

    if (success) {
      pending.resolve(result);
    } else {
      const err = new Error(error?.message || 'IPC invoke failed');
      err.stack = error?.stack;
      pending.reject(err);
    }
  }

  // ============================================
  // Public API Methods
  // ============================================

  /**
   * Send an asynchronous message to the main process.
   * @param {string} channel - The channel name
   * @param {...any} args - Arguments to send
   */
  send(channel, ...args) {
    log.debug(`Sending on channel '${channel}'`, args);
    this.sendAsyncMessage('electron:ipc:send', { channel, args });
  }

  /**
   * Send a synchronous message to the main process.
   * @param {string} channel - The channel name
   * @param {...any} args - Arguments to send
   * @returns {any} - The return value
   */
  sendSync(channel, ...args) {
    log.debug(`SendSync on channel '${channel}'`, args);
    // Use sendQuery for sync-like behavior
    // Note: This is actually async in Gecko, but we wrap it
    return this.sendQuery('electron:ipc:sendSync', { channel, args });
  }

  /**
   * Send a message and wait for async response.
   * @param {string} channel - The channel name
   * @param {...any} args - Arguments to send
   * @returns {Promise<any>}
   */
  async invoke(channel, ...args) {
    log.debug(`Invoke on channel '${channel}'`, args);

    try {
      const response = await this.sendQuery('electron:ipc:invoke', { channel, args });

      if (response.success) {
        return response.result;
      } else {
        const error = new Error(response.error?.message || 'IPC invoke failed');
        error.stack = response.error?.stack;
        throw error;
      }
    } catch (e) {
      log.error(`Invoke failed for channel '${channel}':`, e);
      throw e;
    }
  }

  /**
   * Post a message to the main process.
   * @param {string} channel - The channel name
   * @param {any} message - The message to post
   * @param {Transferable[]} [transfer] - Transferable objects
   */
  postMessage(channel, message, transfer) {
    log.debug(`PostMessage on channel '${channel}'`);
    this.sendAsyncMessage('electron:ipc:postMessage', { channel, message, transfer });
  }

  /**
   * Send a message to a specific webContents.
   * @param {number} webContentsId - The target webContents ID
   * @param {string} channel - The channel name
   * @param {...any} args - Arguments to send
   */
  sendTo(webContentsId, channel, ...args) {
    log.debug(`SendTo webContents ${webContentsId} on channel '${channel}'`);
    this.sendAsyncMessage('electron:ipc:sendTo', { webContentsId, channel, args });
  }

  /**
   * Send a message to the host webContents (for webviews).
   * @param {string} channel - The channel name
   * @param {...any} args - Arguments to send
   */
  sendToHost(channel, ...args) {
    log.debug(`SendToHost on channel '${channel}'`);
    this.sendAsyncMessage('electron:ipc:sendToHost', { channel, args });
  }

  /**
   * Add a listener for messages on a channel.
   * @param {string} channel - The channel to listen on
   * @param {Function} listener - The listener function
   */
  on(channel, listener) {
    if (!this.#listeners.has(channel)) {
      this.#listeners.set(channel, new Set());
    }
    this.#listeners.get(channel).add(listener);
  }

  /**
   * Add a one-time listener for messages on a channel.
   * @param {string} channel - The channel to listen on
   * @param {Function} listener - The listener function
   */
  once(channel, listener) {
    if (!this.#onceListeners.has(channel)) {
      this.#onceListeners.set(channel, new Set());
    }
    this.#onceListeners.get(channel).add(listener);
  }

  /**
   * Remove a listener from a channel.
   * @param {string} channel - The channel name
   * @param {Function} listener - The listener to remove
   */
  removeListener(channel, listener) {
    this.#listeners.get(channel)?.delete(listener);
    this.#onceListeners.get(channel)?.delete(listener);
  }

  /**
   * Remove all listeners from a channel.
   * @param {string} [channel] - The channel name, or all if omitted
   */
  removeAllListeners(channel) {
    if (channel) {
      this.#listeners.delete(channel);
      this.#onceListeners.delete(channel);
    } else {
      this.#listeners.clear();
      this.#onceListeners.clear();
    }
  }
}
