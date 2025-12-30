// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

/**
 * A Node.js-style EventEmitter implementation for Gecko modules.
 * Provides the event system that Electron's app, BrowserWindow, etc. use.
 */
export class EventEmitter {
  #listeners = new Map();
  #onceListeners = new Map();

  /**
   * Adds a listener for the specified event.
   * @param {string} event - The event name
   * @param {Function} listener - The callback function
   * @returns {this}
   */
  on(event, listener) {
    if (!this.#listeners.has(event)) {
      this.#listeners.set(event, new Set());
    }
    this.#listeners.get(event).add(listener);
    return this;
  }

  /**
   * Alias for on()
   */
  addListener(event, listener) {
    return this.on(event, listener);
  }

  /**
   * Adds a one-time listener for the specified event.
   * @param {string} event - The event name
   * @param {Function} listener - The callback function
   * @returns {this}
   */
  once(event, listener) {
    if (!this.#onceListeners.has(event)) {
      this.#onceListeners.set(event, new Set());
    }
    this.#onceListeners.get(event).add(listener);
    return this;
  }

  /**
   * Removes a listener for the specified event.
   * @param {string} event - The event name
   * @param {Function} listener - The callback function
   * @returns {this}
   */
  off(event, listener) {
    if (this.#listeners.has(event)) {
      this.#listeners.get(event).delete(listener);
    }
    if (this.#onceListeners.has(event)) {
      this.#onceListeners.get(event).delete(listener);
    }
    return this;
  }

  /**
   * Alias for off()
   */
  removeListener(event, listener) {
    return this.off(event, listener);
  }

  /**
   * Removes all listeners for the specified event, or all events if none specified.
   * @param {string} [event] - The event name (optional)
   * @returns {this}
   */
  removeAllListeners(event) {
    if (event) {
      this.#listeners.delete(event);
      this.#onceListeners.delete(event);
    } else {
      this.#listeners.clear();
      this.#onceListeners.clear();
    }
    return this;
  }

  /**
   * Emits an event with the given arguments.
   * @param {string} event - The event name
   * @param {...any} args - Arguments to pass to listeners
   * @returns {boolean} - True if any listeners were called
   */
  emit(event, ...args) {
    let hadListeners = false;

    // Call regular listeners
    if (this.#listeners.has(event)) {
      for (const listener of this.#listeners.get(event)) {
        try {
          listener(...args);
          hadListeners = true;
        } catch (e) {
          console.error(`Error in event listener for '${event}':`, e);
        }
      }
    }

    // Call and remove once listeners
    if (this.#onceListeners.has(event)) {
      const onceSet = this.#onceListeners.get(event);
      for (const listener of onceSet) {
        try {
          listener(...args);
          hadListeners = true;
        } catch (e) {
          console.error(`Error in once listener for '${event}':`, e);
        }
      }
      onceSet.clear();
    }

    return hadListeners;
  }

  /**
   * Returns the number of listeners for the specified event.
   * @param {string} event - The event name
   * @returns {number}
   */
  listenerCount(event) {
    let count = 0;
    if (this.#listeners.has(event)) {
      count += this.#listeners.get(event).size;
    }
    if (this.#onceListeners.has(event)) {
      count += this.#onceListeners.get(event).size;
    }
    return count;
  }

  /**
   * Returns an array of event names with registered listeners.
   * @returns {string[]}
   */
  eventNames() {
    const names = new Set([
      ...this.#listeners.keys(),
      ...this.#onceListeners.keys(),
    ]);
    return Array.from(names);
  }

  /**
   * Returns a copy of the listeners array for the specified event.
   * @param {string} event - The event name
   * @returns {Function[]}
   */
  listeners(event) {
    const result = [];
    if (this.#listeners.has(event)) {
      result.push(...this.#listeners.get(event));
    }
    if (this.#onceListeners.has(event)) {
      result.push(...this.#onceListeners.get(event));
    }
    return result;
  }
}
