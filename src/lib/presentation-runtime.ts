/** Presentation applications run in an opaque-origin frame, never in the editor. */
export type PresentationPlayerState = 'stopped' | 'loading' | 'ready' | 'error';

export interface PresentationPlayerOptions {
  title: string;
  /** A separately served runner avoids inheriting the editor's script policy. */
  sandboxUrl?: string;
  /** Portable exports reuse the outer document's nonce for their srcdoc child. */
  scriptNonce?: string;
  onState?: (state: PresentationPlayerState) => void;
  onError?: (message: string) => void;
  onEscape?: () => void;
}

export interface PresentationPlayer {
  start(): void;
  stop(): void;
  restart(): void;
  destroy(): void;
  focus(): void;
  isRunning(): boolean;
}

/**
 * Only this trusted shell owns the application iframe. Its blob-only frame
 * policy also prevents the application navigating itself to an HTTP URL.
 * Kept self-contained for the static runner and standalone classroom exports.
 */
function presentationSandboxBootstrap(): void {
  if (window.parent === window || window.origin !== 'null') return;
  let used = false;
  let token = '';
  let frame: HTMLIFrameElement | undefined;
  let objectUrl: string | undefined;
  const send = (kind: string, detail?: string) => parent.postMessage({ qftPresentation: 1, token, kind, detail }, '*');
  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || typeof message !== 'object') return;
    if (frame && event.source === frame.contentWindow) {
      if (message.qftPresentation !== 1 || message.token !== token) return;
      if (message.kind === 'ready' || message.kind === 'escape') send(message.kind);
      else if (message.kind === 'error' && typeof message.detail === 'string') send('error', message.detail.slice(0, 350));
      return;
    }
    if (event.source !== window.parent) return;
    if (used) {
      if (message.type === 'qft-presentation-focus' && message.token === token) frame?.focus({ preventScroll: true });
      return;
    }
    // Message sizes use JavaScript string length (UTF-16 code units), matching
    // preparePresentationDocument; ZIP/archive budgets are measured in bytes.
    if (message.type !== 'qft-presentation-load' || typeof message.token !== 'string'
      || !/^[a-f0-9]{36}$/.test(message.token)
      || typeof message.html !== 'string' || !message.html.length || message.html.length > 26 * 1024 * 1024) return;
    used = true;
    token = message.token;
    frame = document.createElement('iframe');
    frame.title = 'Interactive presentation';
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.setAttribute('allow', "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; payment 'none'; usb 'none'; serial 'none'; fullscreen 'none'");
    frame.style.cssText = 'position:fixed;inset:0;display:block;border:0;width:100%;height:100%;background:#fff';
    objectUrl = URL.createObjectURL(new Blob([message.html], { type: 'text/html;charset=utf-8' }));
    frame.src = objectUrl;
    document.body.replaceChildren(frame);
    frame.focus({ preventScroll: true });
  });
  document.addEventListener('securitypolicyviolation', (event) => {
    if (used) send('error', `The presentation attempted an unsupported navigation or resource (${event.effectiveDirective}). Use a fully bundled offline presentation.`);
  });
  window.addEventListener('pagehide', () => { if (objectUrl) URL.revokeObjectURL(objectUrl); }, { once: true });
}

/** Both the public runner and exported runner use this exact shell. */
export function presentationRunnerDocument(scriptNonce?: string): string {
  if (scriptNonce !== undefined && !/^[A-Za-z0-9+/_=-]{16,128}$/.test(scriptNonce)) throw new Error('The presentation runner could not be initialized.');
  // Blob children inherit their creator's policy. The served runner therefore
  // allows inline scripts; the prepared application adds its per-run nonce.
  // In a portable export every layer uses the outer export's same nonce.
  const scriptPolicy = scriptNonce ? `'nonce-${scriptNonce}'` : "'unsafe-inline'";
  const policy = `default-src 'none'; script-src ${scriptPolicy}; script-src-attr 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src blob:; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
  const setup = `(()=>{const __name=(value)=>value;(${presentationSandboxBootstrap.toString()})();})();`.replace(/<\/script/gi, '<\\/script');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta http-equiv="Content-Security-Policy" content="script-src 'unsafe-inline'; script-src-attr 'none'"><meta name="referrer" content="no-referrer"><meta name="robots" content="noindex, nofollow"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Isolated presentation player</title><style>body{margin:0;padding:24px;background:#faf8f4;color:#66616a;font:14px/1.6 system-ui,sans-serif}</style></head><body><p>Open a presentation from the Markdown workspace.</p><script${scriptNonce ? ` nonce="${scriptNonce}"` : ''}>${setup}</script></body></html>`;
}

/** No outer references: also serialized into the isolated document. */
function presentationBootstrap(token: string): void {
  let failed = false;
  let reportedErrors = 0;
  const send = (kind: string, detail?: string) => parent.postMessage({ qftPresentation: 1, token, kind, detail }, '*');
  const fail = (message: string) => {
    failed = true;
    if (reportedErrors++ < 3) send('error', message.slice(0, 350));
  };

  // Slidev and Vue utilities can consult Web Storage. Opaque frames have no
  // storage origin; offer bounded, ephemeral storage without sharing drafts.
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    try { void window[name].length; }
    catch {
      const values = new Map<string, string>();
      const storage: Storage = {
        get length() { return values.size; },
        key(index: number) { return [...values.keys()][index] ?? null; },
        getItem(key: string) { return values.get(String(key)) ?? null; },
        setItem(key: string, value: string) {
          key = String(key); value = String(value);
          let size = key.length + value.length;
          for (const [existingKey, existingValue] of values) if (existingKey !== key) size += existingKey.length + existingValue.length;
          if (size > 1_000_000) throw new DOMException('Presentation storage is full.', 'QuotaExceededError');
          values.set(key, value);
        },
        removeItem(key: string) { values.delete(String(key)); },
        clear() { values.clear(); },
      };
      try { Object.defineProperty(window, name, { value: storage, configurable: false }); }
      catch { /* A component can still use its normal storage-unavailable fallback. */ }
    }
  }

  window.addEventListener('error', (event) => {
    if (event instanceof ErrorEvent) fail(event.message || 'The presentation encountered an error.');
    else fail('A presentation resource could not be loaded. Rebuild the package with all assets included.');
  }, true);
  window.addEventListener('unhandledrejection', (event) => fail(String(event.reason?.message || event.reason || 'An asynchronous presentation operation failed.')));
  document.addEventListener('securitypolicyviolation', (event) => {
    fail(`This presentation requested an unsupported resource (${event.effectiveDirective}). Rebuild it with the portable Slidev packaging tool.`);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    // Let Slidev close its own overlays as well as notifying the outer player.
    send('escape');
  }, true);
  // External hyperlinks are inert in the offline player. Scripts remain inside
  // the sandbox and the enclosing document also restricts frame navigation.
  document.addEventListener('click', (event) => {
    const element = event.target instanceof Element ? event.target.closest('a,area') : null;
    if (element && !element.getAttribute('href')?.startsWith('#')) event.preventDefault();
  }, true);
  document.addEventListener('submit', (event) => event.preventDefault(), true);
  window.addEventListener('load', () => {
    // Module scripts finish before load. Two animation frames allow Vue's
    // initial layout and reactive updates to settle before announcing readiness.
    requestAnimationFrame(() => requestAnimationFrame(() => { if (!failed) send('ready'); }));
  }, { once: true });
}

/**
 * Parse in an inert template: imported URLs never load in the editor. Required
 * application resources must be embedded; do not silently strip a broken build.
 */
export function preparePresentationDocument(html: string, token: string, scriptNonce: string): string {
  if (typeof html !== 'string' || !html.trim() || html.length > 24 * 1024 * 1024) throw new Error('The presentation HTML must be smaller than 24 MB.');
  if (!/^[a-f0-9]{36}$/.test(token) || !/^[A-Za-z0-9+/_=-]{16,128}$/.test(scriptNonce)) throw new Error('The presentation could not be initialized.');
  const template = document.createElement('template');
  template.innerHTML = html;
  const content = template.content;
  if (content.querySelector('script[src],script[href],script[xlink\\:href]')) {
    throw new Error('This presentation has separate JavaScript files. Create a portable ZIP with the Slidev packaging tool before opening it.');
  }
  if (content.querySelector('link[rel~="stylesheet"]')) {
    throw new Error('This presentation has separate stylesheets. Create a portable ZIP with the Slidev packaging tool before opening it.');
  }
  if (content.querySelector('iframe,frame,frameset,object,embed,portal')) {
    throw new Error('Embedded websites are not supported in an offline Slidev package. Include the demonstration directly in the presentation.');
  }
  if (content.querySelector('script[type="importmap"]')) throw new Error('This presentation still needs JavaScript imports. Rebuild it with the portable Slidev packaging tool.');

  // Supplied metadata cannot weaken the policy, navigate the frame, or alter
  // URL resolution. Preload/icon links are unnecessary in a complete package.
  content.querySelectorAll('base,meta,link,title').forEach((element) => element.remove());
  for (const element of content.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) {
      if (/^on/i.test(attribute.name) || ['nonce', 'srcdoc', 'srcset', 'ping', 'action', 'formaction', 'target', 'download', 'autofocus'].includes(attribute.name.toLowerCase())) element.removeAttribute(attribute.name);
    }
    for (const name of ['src', 'href', 'xlink:href', 'poster', 'background', 'data']) {
      if (!element.hasAttribute(name)) continue;
      const value = element.getAttribute(name)?.trim() ?? '';
      if (value.startsWith('#')) continue;
      if (/^data:(?:image\/|audio\/|video\/|font\/|application\/(?:font-|vnd\.ms-fontobject))/i.test(value)) continue;
      if (element.localName === 'a' || element.localName === 'area') { element.removeAttribute(name); continue; }
      if (value) throw new Error('This presentation references an asset outside its HTML. Rebuild the portable package with its pictures, fonts, and media included.');
      element.removeAttribute(name);
    }
  }
  for (const script of content.querySelectorAll('script')) script.setAttribute('nonce', scriptNonce);
  const policy = `default-src 'none'; script-src 'nonce-${scriptNonce}'; script-src-attr 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
  // Nonces alone also authorize external scripts carrying the nonce. The second
  // policy intersects with the first and restricts all execution to inline code.
  const inlineOnly = "script-src 'unsafe-inline'; script-src-attr 'none'";
  const setup = `(()=>{const __name=(value)=>value;(${presentationBootstrap.toString()})(${JSON.stringify(token)});})();`.replace(/<\/script/gi, '<\\/script');
  const escapeAttribute = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // HTML template parsing discards the outer html/body tags. Retain useful
  // declarative language/theme attributes, without executing anything to read them.
  const rootAttributes = (tag: string) => {
    const match = html.match(new RegExp(`<${tag}\\b([^>]*)>`, 'i'));
    if (!match) return '';
    const attributes = document.createElement('template');
    attributes.innerHTML = `<div${match[1]}></div>`;
    const source = attributes.content.querySelector('div');
    if (!source) return '';
    return [...source.attributes].filter((attribute) => /^(?:lang|dir|class|style|data-[a-z0-9_-]+)$/i.test(attribute.name))
      .map((attribute) => ` ${attribute.name}="${escapeAttribute(attribute.value)}"`).join('');
  };
  const htmlAttributes = rootAttributes('html');
  const prepared = `<!doctype html><html${htmlAttributes || ' lang="en"'}><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta http-equiv="Content-Security-Policy" content="${inlineOnly}"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}body{font-family:system-ui,sans-serif}*,*::before,*::after{box-sizing:border-box}</style><script nonce="${scriptNonce}">${setup}</script></head><body${rootAttributes('body')}>${template.innerHTML}</body></html>`;
  // Serialization can expand entities and nonce-bearing elements. Bound the
  // finished message in UTF-16 code units, exactly as the runner does, so a
  // valid input cannot silently exceed the receiving limit and time out.
  if (prepared.length > 26 * 1024 * 1024) throw new Error('The presentation is too large after preparing it for playback. Reduce its embedded assets or split the deck, then rebuild the portable ZIP.');
  return prepared;
}

/** Creation is inert. Only start/restart creates a browsing context. */
export function createPresentationPlayer(host: HTMLElement, html: string, options: PresentationPlayerOptions): PresentationPlayer {
  const abort = new AbortController();
  let frame: HTMLIFrameElement | undefined;
  let token: string | undefined;
  let timeout: number | undefined;
  let disposed = false;
  let state: PresentationPlayerState = 'stopped';
  let errors = 0;
  const setState = (value: PresentationPlayerState) => { state = value; options.onState?.(value); };
  const nonce = () => [...crypto.getRandomValues(new Uint8Array(18))].map((value) => value.toString(16).padStart(2, '0')).join('');
  const stop = () => {
    if (timeout !== undefined) window.clearTimeout(timeout);
    timeout = undefined;
    frame?.remove(); frame = undefined; token = undefined;
    if (!disposed) setState('stopped');
  };
  const fail = (message: string) => {
    if (timeout !== undefined) window.clearTimeout(timeout);
    timeout = undefined;
    // A failed or incompatible application must not keep executing behind the
    // error overlay. Restart creates a fresh, isolated browsing context.
    frame?.remove(); frame = undefined; token = undefined;
    setState('error');
    if (errors++ < 3) options.onError?.(message.slice(0, 350));
  };
  const start = () => {
    if (disposed) return;
    stop(); errors = 0;
    token = nonce();
    let prepared: string;
    const scriptNonce = options.scriptNonce ?? nonce();
    try { prepared = preparePresentationDocument(html, token, scriptNonce); }
    catch (error) { fail(error instanceof Error ? error.message : 'The presentation could not be prepared.'); return; }
    frame = document.createElement('iframe');
    const current = frame;
    current.className = 'presentation-frame';
    current.title = `${options.title} — Slidev presentation`;
    current.setAttribute('sandbox', 'allow-scripts');
    current.setAttribute('referrerpolicy', 'no-referrer');
    current.setAttribute('allow', "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; payment 'none'; usb 'none'; serial 'none'; fullscreen 'none'");
    current.style.cssText = 'display:block;border:0;width:100%;height:100%;background:#fff';
    current.tabIndex = 0;
    current.addEventListener('load', () => {
      if (frame === current && token) current.contentWindow?.postMessage({ type: 'qft-presentation-load', token, html: prepared }, '*');
    }, { once: true, signal: abort.signal });
    if (options.sandboxUrl) current.src = options.sandboxUrl;
    else current.srcdoc = presentationRunnerDocument(scriptNonce);
    host.replaceChildren(current);
    setState('loading');
    timeout = window.setTimeout(() => {
      if (frame === current && state === 'loading') fail('The presentation has not finished loading. Try Restart, or rebuild it with the portable Slidev packaging tool.');
    }, 20_000);
    current.focus({ preventScroll: true });
  };
  window.addEventListener('message', (event) => {
    if (!frame || event.source !== frame.contentWindow || !event.data || typeof event.data !== 'object') return;
    const message = event.data;
    if (message.qftPresentation !== 1 || message.token !== token) return;
    if (message.kind === 'ready' && state === 'loading') {
      if (timeout !== undefined) window.clearTimeout(timeout);
      timeout = undefined;
      setState('ready');
    } else if (message.kind === 'error' && typeof message.detail === 'string') fail(message.detail);
    else if (message.kind === 'escape') options.onEscape?.();
  }, { signal: abort.signal });
  return {
    start, stop, restart: start,
    destroy() { if (disposed) return; stop(); disposed = true; abort.abort(); },
    focus() {
      frame?.focus({ preventScroll: true });
      if (frame && token) frame.contentWindow?.postMessage({ type: 'qft-presentation-focus', token }, '*');
    },
    isRunning() { return !!frame; },
  };
}

/** A portable expression with no dependency on the website or external scripts. */
export function presentationRuntimeSource(): string {
  return `(function(){const __name=(value)=>value;const presentationSandboxBootstrap=(${presentationSandboxBootstrap.toString()});const presentationRunnerDocument=(${presentationRunnerDocument.toString()});const presentationBootstrap=(${presentationBootstrap.toString()});const preparePresentationDocument=(${preparePresentationDocument.toString()});return (${createPresentationPlayer.toString()});})()`;
}

/** A standalone classroom copy. Imported code stays inert until Start is chosen. */
export function exportPresentationHtml(html: string, title: string): string {
  if (typeof html !== 'string' || !html.trim() || html.length > 24 * 1024 * 1024) throw new Error('The presentation HTML must be smaller than 24 MB.');
  const nonce = [...crypto.getRandomValues(new Uint8Array(18))].map((value) => value.toString(16).padStart(2, '0')).join('');
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const json = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const script = `const createPlayer=${presentationRuntimeSource()};const host=document.getElementById('presentation');const status=document.getElementById('status');const start=document.getElementById('start');const stop=document.getElementById('stop');const fullscreen=document.getElementById('fullscreen');const player=createPlayer(host,${json(html)},{title:${json(title)},scriptNonce:${json(nonce)},onState(state){start.textContent=state==='stopped'?'Start presentation':'Restart';stop.disabled=state==='stopped';status.textContent=state==='stopped'?'Ready to present · works offline':state==='loading'?'Opening presentation…':state==='ready'?'Live · use the slide controls or arrow keys':'Presentation needs attention';document.getElementById('placeholder').hidden=state!=='stopped';},onError(message){status.textContent=message;},onEscape(){if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});}});start.addEventListener('click',()=>player.start());stop.addEventListener('click',()=>player.stop());fullscreen.addEventListener('click',async()=>{if(!player.isRunning())player.start();try{if(!document.fullscreenElement)await document.getElementById('stage').requestFullscreen();else await document.exitFullscreen();player.focus();}catch{status.textContent='Fullscreen is unavailable. Use the browser fullscreen command.';}});window.addEventListener('pagehide',()=>player.destroy(),{once:true});`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; script-src-attr 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; frame-src 'self' blob:; connect-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><meta http-equiv="Content-Security-Policy" content="script-src 'unsafe-inline'; script-src-attr 'none'"><title>${escape(title)}</title><style>:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#f6f4f0;color:#292626;font:14px/1.5 system-ui,sans-serif}header{display:flex;gap:16px;align-items:center;padding:10px 18px;border-bottom:1px solid #e1ddd7;min-height:52px}h1{font-size:15px;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}nav{display:flex;gap:8px;flex-wrap:wrap}button{font:inherit;border:1px solid #d3cdc4;border-radius:6px;background:#fff;padding:7px 12px;cursor:pointer}button:first-child{background:#773b49;border-color:#773b49;color:#fff}button:disabled{opacity:.5;cursor:default}button:focus-visible{outline:3px solid #b17683;outline-offset:3px}#stage{position:relative;height:calc(100dvh - 96px);min-height:240px;background:#fff}#stage:fullscreen{height:100dvh;width:100vw}#presentation{height:100%;width:100%}#placeholder{position:absolute;inset:0;display:grid;place-content:center;padding:30px;text-align:center;pointer-events:none}#placeholder[hidden]{display:none}#placeholder strong{font-size:clamp(22px,4vw,42px);font-weight:600}#status{margin:0;padding:10px 18px;font-size:12px;min-height:44px}@media(max-width:600px){header{flex-wrap:wrap}h1{flex-basis:100%}#stage{height:calc(100dvh - 140px)}}</style></head><body><header><h1>${escape(title)}</h1><nav aria-label="Presentation controls"><button id="start">Start presentation</button><button id="stop" disabled>Stop</button><button id="fullscreen">Fullscreen</button></nav></header><main id="stage"><div id="presentation"></div><div id="placeholder"><strong>${escape(title)}</strong><p>Choose Start presentation to run the interactive slides.</p></div></main><p id="status" role="status" aria-live="polite">Ready to present · works offline</p><script nonce="${nonce}">${script.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
}
