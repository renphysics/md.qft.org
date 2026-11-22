/*
 * Slidev portable playback adapters (MIT).
 * A presentation in an opaque-origin iframe cannot use browser storage or
 * BroadcastChannel. Give this presentation its own ephemeral equivalents.
 * Nothing is shared with md.qft.org, other decks, tabs, or the network.
 */
(() => {
  const memoryStorage = () => {
    const values = new Map();
    return {
      get length() { return values.size; },
      key(index) { return [...values.keys()][Number(index)] ?? null; },
      getItem(key) { return values.get(String(key)) ?? null; },
      setItem(key, value) { values.set(String(key), String(value)); },
      removeItem(key) { values.delete(String(key)); },
      clear() { values.clear(); },
    };
  };
  for (const name of ['localStorage', 'sessionStorage']) {
    // The md.qft.org runner supplies a memory store. Standalone sandbox players
    // may not; only install our fallback when storage access is unavailable.
    try { window[name].getItem('__qft_slidev_probe__'); }
    catch { Object.defineProperty(window, name, { configurable: true, value: memoryStorage() }); }
  }
  const channels = new Map();
  class PresentationChannel extends EventTarget {
    constructor(name) {
      super();
      this.name = String(name);
      this.onmessage = null;
      this.onmessageerror = null;
      this.closed = false;
      if (!channels.has(this.name)) channels.set(this.name, new Set());
      channels.get(this.name).add(this);
    }
    postMessage(value) {
      if (this.closed) throw new DOMException('Channel is closed', 'InvalidStateError');
      const copy = structuredClone(value);
      for (const channel of channels.get(this.name) ?? []) {
        if (channel === this) continue;
        queueMicrotask(() => {
          if (channel.closed) return;
          const event = new MessageEvent('message', { data: structuredClone(copy) });
          channel.dispatchEvent(event);
          channel.onmessage?.(event);
        });
      }
    }
    close() {
      this.closed = true;
      channels.get(this.name)?.delete(this);
      if (!channels.get(this.name)?.size) channels.delete(this.name);
    }
  }
  Object.defineProperty(window, 'BroadcastChannel', { configurable: true, value: PresentationChannel });
})();
