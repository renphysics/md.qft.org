export interface InteractiveDemoOptions {
  isActive?: (card: HTMLElement) => boolean;
  onLayout?: () => void;
  onEscape?: () => void;
  /** Reuse the parent's authorized nonce in a standalone HTML export. */
  scriptNonce?: string;
  /** The site's separate sandbox document avoids inheriting the editor CSP. */
  sandboxUrl?: string;
}

export interface InteractiveDemoController {
  sync(): void;
  destroy(): void;
  snapshots(): Map<string, string>;
}

/**
 * Deliberately self-contained: standalone exports embed this function's source.
 * Custom code only runs in an opaque-origin sandbox after an explicit Run click.
 */
export function createInteractiveDemos(root: HTMLElement, options: InteractiveDemoOptions = {}): InteractiveDemoController {
  type Payload = { version: number; title: string; description: string; html: string; preset?: string };
  type Entry = { card: HTMLElement; payload: Payload; frame?: HTMLIFrameElement; token?: string; active: boolean; timer?: number; ready: boolean; snapshot?: string; lastSnapshot: number; error?: string };
  const entries = new Map<HTMLElement, Entry>();
  const abort = new AbortController();
  const signal = abort.signal;
  let disposed = false;

  // This bootstrap also has no outer references. Its timers belong to the frame.
  function bootstrap(token: string): void {
    const nativeTimeout = window.setTimeout.bind(window);
    const nativeClearTimeout = window.clearTimeout.bind(window);
    const nativeFrame = window.requestAnimationFrame.bind(window);
    const nativeCancelFrame = window.cancelAnimationFrame.bind(window);
    type Task = { kind: 'timeout' | 'interval' | 'frame'; callback: (...args: any[]) => void; args: any[]; delay: number; remaining: number; due: number; handle: number };
    const tasks = new Map<number, Task>();
    let nextId = 0;
    let requestedActive = true;
    let active = document.visibilityState !== 'hidden';
    let stopped = false;
    let snapshotTimer = 0;
    let lastSnapshot = 0;
    const send = (kind: string, detail?: unknown) => parent.postMessage({ qftDemo: 1, token, kind, detail }, '*');
    const capture = () => {
      if (stopped || !active || performance.now() - lastSnapshot < 500) return;
      lastSnapshot = performance.now();
      const canvas = document.querySelector('canvas');
      if (!canvas || !canvas.width || !canvas.height || canvas.width > 4096 || canvas.height > 4096) return;
      try {
        const image = canvas.toDataURL('image/png');
        if (image.length <= 4_000_000) send('snapshot', image);
      } catch { /* A demo without a readable canvas retains its static poster. */ }
    };
    const queueCapture = () => {
      if (snapshotTimer || stopped || !active) return;
      snapshotTimer = nativeTimeout(() => { snapshotTimer = 0; capture(); }, 100);
    };
    function schedule(id: number, task: Task): void {
      if (!active || stopped) return;
      task.due = performance.now() + task.remaining;
      if (task.kind === 'frame') {
        task.handle = nativeFrame((time) => {
          if (!tasks.has(id)) return;
          tasks.delete(id);
          task.callback(time);
        });
      } else {
        task.handle = nativeTimeout(() => {
          if (!tasks.has(id)) return;
          if (task.kind === 'timeout') tasks.delete(id);
          try { task.callback(...task.args); }
          finally {
            if (task.kind === 'interval' && tasks.has(id)) {
              task.remaining = task.delay;
              schedule(id, task);
            }
          }
        }, task.remaining);
      }
    }
    function addTask(kind: Task['kind'], callback: unknown, delay: number, args: any[]): number {
      if (typeof callback !== 'function') throw new TypeError('Demo timers require a function callback.');
      const id = ++nextId;
      const duration = Math.max(kind === 'interval' ? 4 : 0, Math.min(2_147_483_647, Number(delay) || 0));
      const task: Task = { kind, callback: callback as Task['callback'], args, delay: duration, remaining: duration, due: 0, handle: 0 };
      tasks.set(id, task);
      schedule(id, task);
      return id;
    }
    function cancel(id?: unknown): void {
      if (typeof id !== 'number') return;
      const task = tasks.get(id);
      if (!task) return;
      if (task.kind === 'frame') nativeCancelFrame(task.handle);
      else nativeClearTimeout(task.handle);
      tasks.delete(id);
    }
    window.setTimeout = ((callback: TimerHandler, delay?: number, ...args: any[]) => addTask('timeout', callback, delay ?? 0, args)) as typeof window.setTimeout;
    window.setInterval = ((callback: TimerHandler, delay?: number, ...args: any[]) => addTask('interval', callback, delay ?? 0, args)) as typeof window.setInterval;
    window.clearTimeout = cancel;
    window.clearInterval = cancel;
    window.requestAnimationFrame = (callback) => addTask('frame', callback, 0, []);
    window.cancelAnimationFrame = cancel;
    function updateActivity(): void {
      const next = requestedActive && document.visibilityState !== 'hidden';
      if (next === active || stopped) return;
      active = next;
      document.documentElement.toggleAttribute('data-qft-demo-paused', !active);
      if (active) {
        for (const [id, task] of tasks) schedule(id, task);
        queueCapture();
      } else {
        for (const task of tasks.values()) {
          if (task.kind === 'frame') nativeCancelFrame(task.handle);
          else { nativeClearTimeout(task.handle); task.remaining = Math.max(0, task.due - performance.now()); }
        }
        nativeClearTimeout(snapshotTimer);
        snapshotTimer = 0;
      }
      window.dispatchEvent(new Event(active ? 'qft-demo-resume' : 'qft-demo-pause'));
    }
    window.addEventListener('message', (event) => {
      if (event.source !== parent || !event.data || event.data.qftDemo !== 1 || event.data.token !== token) return;
      if (event.data.command === 'pause' || event.data.command === 'resume') {
        requestedActive = event.data.command === 'resume';
        updateActivity();
      } else if (event.data.command === 'snapshot') capture();
    });
    document.addEventListener('visibilitychange', updateActivity);
    document.addEventListener('input', queueCapture, true);
    document.addEventListener('change', queueCapture, true);
    document.addEventListener('pointerup', queueCapture, true);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); send('escape'); }
    }, true);
    window.addEventListener('error', (event) => send('error', String(event.message || 'The demonstration encountered an error.').slice(0, 240)));
    window.addEventListener('unhandledrejection', (event) => send('error', String(event.reason?.message || event.reason || 'An asynchronous operation failed.').slice(0, 240)));
    window.addEventListener('load', () => { send('ready'); queueCapture(); });
    function tick(): void {
      if (stopped) return;
      capture();
      nativeTimeout(tick, 1000);
    }
    nativeTimeout(tick, 700);
    window.addEventListener('pagehide', () => {
      stopped = true;
      for (const id of tasks.keys()) cancel(id);
      nativeClearTimeout(snapshotTimer);
    });
  }

  function active(card: HTMLElement): boolean {
    return !document.hidden && (options.isActive ? options.isActive(card) : !!card.getClientRects().length);
  }
  function status(entry: Entry, text: string): void {
    const target = entry.card.querySelector<HTMLElement>('[data-demo-status]');
    if (target) target.textContent = text;
  }
  function controls(entry: Entry, running: boolean): void {
    const run = entry.card.querySelector<HTMLButtonElement>('[data-demo-run]');
    const stop = entry.card.querySelector<HTMLButtonElement>('[data-demo-stop]');
    const restart = entry.card.querySelector<HTMLButtonElement>('[data-demo-restart]');
    if (run) run.hidden = running;
    if (stop) stop.hidden = !running;
    if (restart) restart.hidden = !running;
  }
  function restorePoster(entry: Entry): void {
    const poster = entry.card.querySelector<HTMLElement>('[data-demo-poster]');
    if (!poster) return;
    if (entry.snapshot) {
      const image = document.createElement('img');
      image.className = 'qft-demo-print-snapshot';
      image.alt = `${entry.payload.title} — last captured view`;
      image.src = entry.snapshot;
      poster.replaceChildren(image);
    }
    poster.hidden = false;
  }
  function stop(entry: Entry, silent = false): void {
    if (entry.timer) window.clearTimeout(entry.timer);
    entry.timer = undefined;
    entry.frame?.remove();
    entry.frame = undefined;
    entry.token = undefined;
    entry.active = false;
    entry.ready = false;
    entry.error = undefined;
    entry.card.dataset.demoState = 'idle';
    controls(entry, false);
    restorePoster(entry);
    if (!silent) status(entry, 'Stopped · Run to start again');
    options.onLayout?.();
  }
  function nonce(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(18));
    return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  }
  function frameDocument(payload: Payload, token: string): string {
    // Template contents have no browsing context: even image and iframe URLs
    // remain inert while the input is parsed and inspected in the editor.
    const template = document.createElement('template');
    template.innerHTML = payload.html;
    const content = template.content;
    content.querySelectorAll('base,meta,link,iframe,frame,frameset,object,embed,portal,script[src]').forEach((element) => element.remove());
    const suppliedNonce = options.scriptNonce;
    const scriptNonce = suppliedNonce && /^[A-Za-z0-9+/_=-]{16,128}$/.test(suppliedNonce) ? suppliedNonce : nonce();
    for (const element of content.querySelectorAll('*')) {
      for (const attr of [...element.attributes]) {
        if (/^on/i.test(attr.name) || ['srcdoc', 'nonce', 'srcset', 'ping', 'action', 'formaction'].includes(attr.name)) element.removeAttribute(attr.name);
      }
      if (element.localName === 'a' && !element.getAttribute('href')?.startsWith('#')) element.removeAttribute('href');
      if (element.localName === 'form') element.removeAttribute('target');
      for (const attribute of ['src', 'href', 'xlink:href']) {
        if (!element.hasAttribute(attribute) || (element.localName === 'a' && attribute === 'href')) continue;
        if (attribute !== 'src' && element.getAttribute(attribute)?.startsWith('#')) continue;
        if (!/^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(element.getAttribute(attribute) || '')) element.removeAttribute(attribute);
      }
    }
    for (const script of content.querySelectorAll('script')) script.setAttribute('nonce', scriptNonce);
    const policy = `default-src 'none'; script-src 'nonce-${scriptNonce}'; script-src-attr 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src 'none'; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
    // A nonce alone also authorizes an external <script src> carrying that
    // nonce. This second policy intersects with the first: a script must be
    // inline AND authorized by the nonce. It never relaxes the parent policy.
    const inlineOnlyPolicy = "script-src 'unsafe-inline'; script-src-attr 'none'";
    const styles = 'html{color-scheme:light}html,body{margin:0;min-height:100%;box-sizing:border-box}body{font-family:system-ui,sans-serif}*,*::before,*::after{box-sizing:border-box}html[data-qft-demo-paused] *,html[data-qft-demo-paused] *::before,html[data-qft-demo-paused] *::after{animation-play-state:paused!important;transition:none!important}';
    // Keep the development transpiler helper local to the bootstrap closure.
    const setup = `(()=>{const __name=(value)=>value;(${bootstrap.toString()})(${JSON.stringify(token)});})();`.replace(/<\/script/gi, '<\\/script');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta http-equiv="Content-Security-Policy" content="${inlineOnlyPolicy}"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style><script nonce="${scriptNonce}">${setup}</script></head><body>${template.innerHTML}</body></html>`;
  }
  function start(entry: Entry): void {
    if (disposed || !active(entry.card)) return;
    stop(entry, true);
    const token = nonce();
    const html = frameDocument(entry.payload, token);
    if (html.length > 160_000) {
      status(entry, 'The prepared demo is too large. Shorten its HTML and JavaScript before running.');
      entry.card.dataset.demoState = 'error';
      return;
    }
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.setAttribute('allow', "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; payment 'none'; usb 'none'");
    frame.title = `${entry.payload.title} — interactive demonstration`;
    frame.tabIndex = 0;
    entry.token = token;
    entry.frame = frame;
    entry.active = true;
    entry.card.dataset.demoState = 'loading';
    controls(entry, true);
    status(entry, 'Starting demonstration…');
    if (options.sandboxUrl) {
      frame.addEventListener('load', () => {
        if (entry.frame === frame) frame.contentWindow?.postMessage({ type: 'qft-demo-load', token, html }, '*');
      }, { once: true, signal });
      frame.src = options.sandboxUrl;
    } else frame.srcdoc = html;
    entry.card.querySelector('[data-demo-frame]')?.replaceChildren(frame);
    frame.focus({ preventScroll: true });
    const poster = entry.card.querySelector<HTMLElement>('[data-demo-poster]');
    if (poster) poster.hidden = true;
    entry.timer = window.setTimeout(() => {
      if (entry.frame === frame && !entry.ready) status(entry, 'This demo has not finished loading. Check its code or restart it.');
    }, 8000);
    options.onLayout?.();
  }
  function sync(): void {
    if (disposed) return;
    for (const [card, entry] of entries) {
      if (!root.contains(card)) { stop(entry, true); entries.delete(card); }
    }
    for (const card of root.querySelectorAll<HTMLElement>('.qft-demo[data-demo-id]')) {
      if (entries.has(card)) continue;
      const template = card.querySelector<HTMLTemplateElement>('template[data-demo-source]');
      if (!template) continue;
      try {
        const payload = JSON.parse(template.content.textContent || '') as Payload;
        if (payload.version !== 1 || typeof payload.html !== 'string' || payload.html.length > 100_000
          || typeof payload.title !== 'string' || payload.title.length > 100 || typeof payload.description !== 'string' || payload.description.length > 1000) throw new Error('Invalid interactive demo');
        entries.set(card, { card, payload, active: false, ready: false, lastSnapshot: 0 });
      } catch {
        status({ card } as Entry, 'This demo could not be read. Reinsert it from the demo gallery.');
        const run = card.querySelector<HTMLButtonElement>('[data-demo-run]');
        if (run) run.disabled = true;
      }
    }
    for (const entry of entries.values()) {
      if (!entry.frame) continue;
      const next = active(entry.card);
      if (next === entry.active) continue;
      entry.active = next;
      entry.frame.contentWindow?.postMessage({ qftDemo: 1, token: entry.token, command: next ? 'resume' : 'pause' }, '*');
      entry.card.dataset.demoState = entry.error ? 'error' : next ? 'running' : 'paused';
      status(entry, entry.error ? `Demo error: ${entry.error}` : next ? 'Live · your controls are active' : 'Paused while out of view');
    }
  }
  root.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-demo-run],[data-demo-stop],[data-demo-restart]') : null;
    const card = button?.closest<HTMLElement>('.qft-demo[data-demo-id]');
    if (!button || !card || !root.contains(card)) return;
    event.preventDefault();
    event.stopPropagation();
    const entry = entries.get(card);
    if (!entry) return;
    if (button.hasAttribute('data-demo-stop')) {
      stop(entry);
      card.querySelector<HTMLButtonElement>('[data-demo-run]')?.focus({ preventScroll: true });
    }
    else start(entry);
  }, { signal });
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.qftDemo !== 1 || typeof data.token !== 'string') return;
    const entry = [...entries.values()].find((item) => item.frame?.contentWindow === event.source && item.token === data.token);
    if (!entry || !entry.frame) return;
    if (data.kind === 'ready') {
      entry.ready = true;
      if (entry.timer) window.clearTimeout(entry.timer);
      entry.timer = undefined;
      entry.card.dataset.demoState = entry.error ? 'error' : entry.active ? 'running' : 'paused';
      status(entry, entry.error ? `Demo error: ${entry.error}` : entry.active ? 'Live · your controls are active' : 'Paused while out of view');
      entry.frame.contentWindow?.postMessage({ qftDemo: 1, token: entry.token, command: entry.active ? 'resume' : 'pause' }, '*');
      options.onLayout?.();
    } else if (data.kind === 'snapshot' && typeof data.detail === 'string' && data.detail.length <= 4_000_000
      && /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(data.detail) && performance.now() - entry.lastSnapshot > 400) {
      entry.snapshot = data.detail;
      entry.lastSnapshot = performance.now();
    } else if (data.kind === 'error' && typeof data.detail === 'string') {
      entry.error = data.detail.slice(0, 240).trim() || 'The demonstration encountered an error.';
      status(entry, `Demo error: ${entry.error}`);
      entry.card.dataset.demoState = 'error';
    } else if (data.kind === 'escape' && entry.active && document.activeElement === entry.frame) {
      options.onEscape?.();
    }
  }, { signal });
  document.addEventListener('visibilitychange', sync, { signal });
  sync();
  return {
    sync,
    snapshots: () => new Map([...entries.values()].flatMap((entry) => entry.snapshot ? [[entry.card.dataset.demoId!, entry.snapshot] as [string, string]] : [])),
    destroy: () => {
      if (disposed) return;
      disposed = true;
      abort.abort();
      for (const entry of entries.values()) stop(entry, true);
      entries.clear();
    },
  };
}

/** A portable expression, including the development compiler's name helper. */
export function interactiveRuntimeSource(): string {
  return `(function(){const __name=(value)=>value;return (${createInteractiveDemos.toString()});})()`;
}
