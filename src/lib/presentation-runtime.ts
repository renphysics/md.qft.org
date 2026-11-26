import { STALL_BLANK_TEXT, STALL_RESCUED_TEXT } from './presentation-messages';

/** Presentation applications run in an opaque-origin frame, never in the editor. */
export type PresentationPlayerState = 'stopped' | 'loading' | 'ready' | 'error';
/**
 * Who wrote an error message. Text that arrives from the frame is supplied by
 * the package (or by code running beside it) and must be presented as such;
 * 'player' messages are written by this application.
 */
export type PresentationMessageOrigin = 'presentation' | 'player';
/**
 * How the player treats a deck. Both profiles use the same sandbox and the
 * same Content Security Policy; neither gives the deck a capability.
 * - 'strict' (the default) is for packages made with the site's own tool:
 *   the first error stops playback.
 * - 'tolerant' is for linked decks and converted builds: errors, rejected
 *   promises, missing files and blocked requests become warnings; History
 *   calls that the sandboxed document refuses are guarded; the screen wake
 *   lock is hidden; fullscreen is requested from the host page; cookies and
 *   crypto.randomUUID are imitated; alert() shows a message box in the deck;
 *   a Reveal.js deck whose start-up script failed is started with basic
 *   settings when possible and reported (onStalled); a click on a link to a
 *   website is passed to the host (onLink), which opens nothing by itself.
 */
export type PresentationProfile = 'strict' | 'tolerant';
/** What a deck asked the host to do: enter fullscreen, or leave it. */
export type PresentationFullscreenRequest = 'enter' | 'exit';

export interface PresentationPlayerOptions {
  title: string;
  /** A separately served runner avoids inheriting the editor's script policy. */
  sandboxUrl?: string;
  /** Portable exports reuse the outer document's nonce for their srcdoc child. */
  scriptNonce?: string;
  /** Defaults to 'strict'. */
  profile?: PresentationProfile;
  onState?: (state: PresentationPlayerState) => void;
  onError?: (message: string, origin: PresentationMessageOrigin) => void;
  onEscape?: () => void;
  /**
   * Tolerant profile only: a problem that did not stop playback. The text
   * comes from the deck (at most 350 characters, at most 20 per playback);
   * present it as the deck's words and insert it as text, never as markup.
   */
  onWarning?: (message: string) => void;
  /**
   * The slide on show in a Reveal.js deck, whenever it changes: "h/v", or
   * "h/v/f" while fragment f is the last one shown. Digits only; pass it back
   * to start() or update() to return to that slide.
   */
  onPosition?: (position: string) => void;
  /** The number of slides in a Reveal.js deck, once per playback. */
  onSlides?: (count: number) => void;
  /**
   * Tolerant profile only: the deck asked to enter fullscreen (F in
   * Reveal.js) or to leave it. Requests that do not follow a user action in
   * the deck are dropped, so a deck cannot do this by itself.
   */
  onFullscreenRequest?: (request: PresentationFullscreenRequest) => void;
  /**
   * Tolerant profile only, at most once per playback: a Reveal.js deck whose
   * start-up script stopped with an error did not start by itself. 'rescued':
   * the player started it with basic settings and the slides show; 'blank':
   * it could not, and the stage stays empty. `firstError` is the deck's own
   * text for the first error (at most 350 characters; insert it as text).
   */
  onStalled?: (detail: PresentationStall, firstError: string | undefined) => void;
  /**
   * Tolerant profile only: the person clicked a link to a website in the
   * deck, which cannot open it itself. The address is checked (http or https,
   * no user name or password, at most 2000 characters) and comes only after
   * a user action. Opening it must take another action on the host page.
   */
  onLink?: (url: URL) => void;
}

/** How a Reveal.js deck that stopped during start-up was left: see onStalled. */
export type PresentationStall = 'rescued' | 'blank';

export interface PresentationStartOptions {
  /** Open at this slide ("h/v" or "h/v/f"); anything else starts at the first slide. */
  position?: string;
}

export interface PresentationPlayer {
  /** Start, or start again, at options.position or else the first slide. */
  start(options?: PresentationStartOptions): void;
  stop(): void;
  /** Start again at the first slide. */
  restart(): void;
  /**
   * Replace the deck's HTML. While the deck is loading, playing, or stopped
   * by an error, it restarts with the new HTML at options.position, or else
   * at the last position the deck reported. When stopped, the next start()
   * uses the new HTML.
   */
  update(html: string, options?: PresentationStartOptions): void;
  destroy(): void;
  focus(): void;
  isRunning(): boolean;
  /** The last position the deck reported, or the one it was started at. */
  currentPosition(): string | undefined;
}

export interface PresentationPrepareOptions {
  /** Defaults to 'strict'. */
  profile?: PresentationProfile;
}

export interface PresentationExportOptions {
  /** Defaults to 'strict'. */
  profile?: PresentationProfile;
  /**
   * Licence notices for the code in the copy, shown as text in a collapsed
   * "Third-party notices" section of the outer page, outside the sandbox.
   * At most 16 entries; titles up to 200 and texts up to 64 000 characters.
   */
  notices?: readonly { title: string; text: string }[];
}

const EXPORT_NOTICE_LIMIT = 16;
const EXPORT_NOTICE_TITLE = 200;
const EXPORT_NOTICE_TEXT = 64_000;

/**
 * Keep every mutually dependent helper in one lexical scope. Portable exports
 * serialize this complete factory, so a production minifier can rename its
 * local bindings without leaving references to names absent from the export.
 */
function presentationRuntimeFactory() {
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
        // The deck can read its token and forge any message, so relay only
        // known kinds, each with its detail checked again here.
        const kind = message.kind;
        const detail = message.detail;
        if (kind === 'ready' || kind === 'escape') send(kind);
        else if (kind === 'stalled' && (detail === 'rescued' || detail === 'blank')) send(kind, detail);
        else if (kind === 'link' && typeof detail === 'string' && /^https?:\/\/[^\s]{1,1990}$/i.test(detail)) send(kind, detail);
        else if ((kind === 'error' || kind === 'warning') && typeof detail === 'string') send(kind, detail.slice(0, 350));
        else if (kind === 'position' && typeof detail === 'string' && /^\d{1,4}\/\d{1,4}(?:\/\d{1,4})?$/.test(detail)) send(kind, detail);
        else if (kind === 'slides' && typeof detail === 'string' && /^\d{1,5}$/.test(detail)) send(kind, detail);
        else if (kind === 'fullscreen' && (detail === 'enter' || detail === 'exit')) send(kind, detail);
        return;
      }
      if (event.source !== window.parent) return;
      if (used) {
        // When the deck frame is already this document's active element (the
        // user had the keyboard in the deck, then chose Present or pressed F),
        // focus() alone changes nothing and the keyboard stays with the host.
        // Blurring first makes it a real focus change, as in the host.
        if (message.type === 'qft-presentation-focus' && message.token === token && frame) {
          frame.blur();
          frame.focus({ preventScroll: true });
        }
        return;
      }
      // Message sizes use JavaScript string length (UTF-16 code units), matching
      // preparePresentationDocument; ZIP/archive budgets are measured in bytes.
      if (message.type !== 'qft-presentation-load' || typeof message.token !== 'string'
        || !/^[a-f0-9]{36}$/.test(message.token)
        || typeof message.html !== 'string' || !message.html.length || message.html.length > 26 * 1024 * 1024) return;
      used = true;
      token = message.token;
      // A restore position is the only thing added to the deck's address: a
      // fragment of digits, which Reveal.js reads when it starts.
      const fragment = typeof message.fragment === 'string' && /^#\/\d{1,4}\/\d{1,4}(?:\/\d{1,4})?$/.test(message.fragment) ? message.fragment : '';
      frame = document.createElement('iframe');
      frame.title = 'Interactive presentation';
      frame.setAttribute('sandbox', 'allow-scripts');
      frame.setAttribute('referrerpolicy', 'no-referrer');
      frame.setAttribute('allow', "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; payment 'none'; usb 'none'; serial 'none'; fullscreen 'none'");
      frame.style.cssText = 'position:fixed;inset:0;display:block;border:0;width:100%;height:100%;background:#fff';
      objectUrl = URL.createObjectURL(new Blob([message.html], { type: 'text/html;charset=utf-8' }));
      frame.src = objectUrl + fragment;
      document.body.replaceChildren(frame);
      // Focusing here, before this document has focus, is refused by the
      // focus-without-user-activation policy. The host hands focus over once
      // the presentation is ready, then asks with qft-presentation-focus.
    });
    document.addEventListener('securitypolicyviolation', (event) => {
      if (used) send('error', `The presentation attempted an unsupported navigation or resource (${event.effectiveDirective}). Use a fully bundled offline presentation.`);
    });
    window.addEventListener('pagehide', () => { if (objectUrl) URL.revokeObjectURL(objectUrl); }, { once: true });
  }

  /** Both the public runner and exported runner use this exact shell. */
  function presentationRunnerDocument(scriptNonce?: string): string {
    if (scriptNonce !== undefined && !/^[A-Za-z0-9+/_=-]{16,128}$/.test(scriptNonce)) throw new Error('The presentation runner could not be initialized.');
    // Blob children inherit their creator's policy. The served runner therefore
    // allows inline scripts; the prepared application adds its per-run nonce.
    // In a portable export every layer uses the outer export's same nonce.
    const scriptPolicy = scriptNonce ? `'nonce-${scriptNonce}'` : "'unsafe-inline'";
    const policy = `default-src 'none'; script-src ${scriptPolicy}; script-src-attr 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src blob:; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
    const setup = `(()=>{const __name=(value)=>value;(${presentationSandboxBootstrap.toString()})();})();`.replace(/<\/script/gi, '<\\/script');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta http-equiv="Content-Security-Policy" content="script-src 'unsafe-inline'; script-src-attr 'none'"><meta name="referrer" content="no-referrer"><meta name="robots" content="noindex, nofollow"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Isolated presentation player</title><style>body{margin:0;padding:24px;background:#faf8f4;color:#66616a;font:14px/1.6 system-ui,sans-serif}</style></head><body><p>Open a presentation from the Markdown workspace.</p><script${scriptNonce ? ` nonce="${scriptNonce}"` : ''}>${setup}</script></body></html>`;
  }

  /**
   * No outer references: also serialized into the isolated document, where it
   * runs before any deck code. `tolerant` selects the tolerant profile.
   */
  function presentationBootstrap(token: string, tolerant: boolean): void {
    let failed = false;
    let reportedErrors = 0;
    const warned = new Set<string>();
    const send = (kind: string, detail?: string) => parent.postMessage({ qftPresentation: 1, token, kind, detail }, '*');
    // Strict: the first problem stops the deck, which the host then removes.
    // Tolerant: each distinct problem is reported once and the deck plays on.
    const report = (message: string) => {
      const text = message.slice(0, 350);
      if (tolerant) {
        if (warned.size < 20 && !warned.has(text)) { warned.add(text); send('warning', text); }
        return;
      }
      failed = true;
      if (reportedErrors++ < 3) send('error', text);
    };
    const describe = (value: unknown, fallback: string) => {
      try { return String((value as { message?: unknown } | null | undefined)?.message || value || fallback); }
      catch { return fallback; }
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

    // Tolerant only: an uncaught error that belongs to a problem already reported.
    let ignoreError: (event: ErrorEvent) => boolean = () => false;

    if (tolerant) {
      // A blob: document may change only its fragment. Reveal.js (hash: true)
      // and Slidev's router also write paths, and the refusal would stop
      // them: apply the fragment part of the address instead, if any.
      for (const name of ['pushState', 'replaceState'] as const) {
        const original = History.prototype[name];
        if (typeof original !== 'function') continue;
        Object.defineProperty(History.prototype, name, {
          configurable: true, writable: true,
          value: function (this: History, state: unknown, unused: string, url?: string | URL | null) {
            try { return original.call(this, state, unused, url); }
            catch (error) {
              if (!(error instanceof DOMException) || error.name !== 'SecurityError' || url === undefined || url === null) throw error;
              const address = String(url);
              const hash = address.indexOf('#');
              try { return original.call(this, state, unused, hash < 0 ? '#' : address.slice(hash)); }
              catch { return undefined; }
            }
          },
        });
      }
      // The frame has no permission for a wake lock, and Slidev's request for
      // one would be refused. Without the API, Slidev does not ask.
      try { delete (Navigator.prototype as { wakeLock?: unknown }).wakeLock; } catch { /* Then the refusal is a warning. */ }
      // The frame has no fullscreen permission either: ask the host page to
      // show its stage in fullscreen. The host acts only after a user action.
      const ask = (request: 'enter' | 'exit') => () => { send('fullscreen', request); return Promise.resolve(); };
      const replacements: [object, string[], () => Promise<void>][] = [
        [Element.prototype, ['requestFullscreen', 'webkitRequestFullscreen', 'webkitRequestFullScreen'], ask('enter')],
        [Document.prototype, ['exitFullscreen', 'webkitExitFullscreen', 'webkitCancelFullScreen'], ask('exit')],
      ];
      for (const [owner, names, value] of replacements) {
        for (const name of names) {
          if (name in owner) try { Object.defineProperty(owner, name, { configurable: true, writable: true, value }); } catch { /* Keep the original. */ }
        }
      }
      for (const name of ['fullscreenEnabled', 'webkitFullscreenEnabled']) {
        if (name in Document.prototype) try { Object.defineProperty(Document.prototype, name, { configurable: true, get: () => true }); } catch { /* Keep the original. */ }
      }

      // An opaque document has no cookies: reading or writing document.cookie
      // throws, which stops a deck's start-up script. Keep them in memory for
      // this playback instead. Attributes such as path are ignored; max-age=0,
      // or an expires date in the past, deletes the cookie.
      try { void document.cookie; }
      catch {
        const jar = new Map<string, string>();
        try {
          Object.defineProperty(Document.prototype, 'cookie', {
            configurable: true,
            get() { return [...jar].map(([name, value]) => (name ? `${name}=${value}` : value)).join('; '); },
            set(input: unknown) {
              let text: string;
              try { text = String(input); } catch { return; }
              const [pair, ...attributes] = text.slice(0, 8192).split(';');
              const equals = pair.indexOf('=');
              const name = (equals < 0 ? '' : pair.slice(0, equals)).trim();
              const value = (equals < 0 ? pair : pair.slice(equals + 1)).trim();
              if (name.length + value.length > 4096) return;
              let maxAge: number | undefined;
              let expires: number | undefined;
              for (const attribute of attributes) {
                const split = attribute.indexOf('=');
                const key = (split < 0 ? attribute : attribute.slice(0, split)).trim().toLowerCase();
                const data = split < 0 ? '' : attribute.slice(split + 1).trim();
                if (key === 'max-age' && /^-?\d{1,12}$/.test(data)) maxAge = Number(data);
                else if (key === 'expires') { const time = Date.parse(data); if (!Number.isNaN(time)) expires = time; }
              }
              // As in browsers, max-age wins over expires.
              if (maxAge !== undefined ? maxAge <= 0 : expires !== undefined && expires <= Date.now()) jar.delete(name);
              else if (jar.has(name) || jar.size < 50) jar.set(name, value);
            },
          });
        } catch { /* Then the deck sees the browser's refusal. */ }
      }
      // randomUUID exists only in secure contexts, and an opaque blob:
      // document is not one. getRandomValues is available everywhere.
      try {
        const random = window.crypto;
        if (random && typeof random.randomUUID !== 'function' && typeof random.getRandomValues === 'function') {
          Object.defineProperty(random, 'randomUUID', {
            configurable: true, writable: true,
            value: function randomUUID() {
              const bytes = random.getRandomValues(new Uint8Array(16));
              bytes[6] = (bytes[6] & 0x0f) | 0x40;
              bytes[8] = (bytes[8] & 0x3f) | 0x80;
              const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
              return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
            },
          });
        }
      } catch { /* Keep what the browser offers. */ }
      // Nothing else is imitated: navigator.clipboard, caches and service
      // workers stay undefined, so a deck's own feature checks still work.

      // The sandbox has no allow-modals, so alert() would do nothing. Show
      // the text in a small message box inside the deck's own document
      // instead. Unlike alert(), this returns at once and does not wait for
      // OK; several messages queue and show one after another.
      const queued: string[] = [];
      let messageHost: HTMLElement | undefined;
      let messageText: HTMLElement | undefined;
      let messageButton: HTMLButtonElement | undefined;
      let returnFocus: unknown;
      const showNext = () => {
        const text = queued.shift();
        if (text === undefined) {
          messageHost?.remove();
          messageHost = messageText = messageButton = undefined;
          const previous = returnFocus as { focus?: (options?: FocusOptions) => void } | null | undefined;
          returnFocus = undefined;
          try { previous?.focus?.({ preventScroll: true }); } catch { /* Focus stays where it is. */ }
          return;
        }
        if (!messageHost) {
          returnFocus = document.activeElement;
          // An unknown element name and inline !important styles: the deck's
          // own rules cannot hide or restyle it, and the closed shadow root
          // keeps its insides out of the deck's reach.
          const element = document.createElement('qft-message');
          element.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;display:block!important';
          const root = element.attachShadow({ mode: 'closed' });
          const style = document.createElement('style');
          style.textContent = '.backdrop{position:fixed;inset:0;display:grid;place-items:center;padding:16px;box-sizing:border-box;background:rgba(20,18,22,.45);font:16px/1.5 system-ui,sans-serif}'
            + '.box{box-sizing:border-box;width:min(560px,100%);max-height:100%;overflow:auto;padding:20px 22px 16px;border-radius:10px;background:#fff;color:#222;box-shadow:0 12px 40px rgba(0,0,0,.35)}'
            + '.text{margin:0 0 16px;white-space:pre-wrap;overflow-wrap:anywhere}.actions{text-align:right}'
            + 'button{font:inherit;min-width:88px;padding:8px 16px;border:1px solid #773b49;border-radius:6px;background:#773b49;color:#fff;cursor:pointer}'
            + 'button:focus-visible{outline:3px solid #b17683;outline-offset:2px}';
          const backdrop = document.createElement('div');
          backdrop.className = 'backdrop';
          const box = document.createElement('div');
          box.className = 'box';
          box.setAttribute('role', 'alertdialog');
          box.setAttribute('aria-modal', 'true');
          box.setAttribute('aria-label', 'Message from the presentation');
          messageText = document.createElement('p');
          messageText.className = 'text';
          messageText.id = 'text';
          box.setAttribute('aria-describedby', 'text');
          const actions = document.createElement('div');
          actions.className = 'actions';
          messageButton = document.createElement('button');
          messageButton.type = 'button';
          messageButton.textContent = 'OK';
          messageButton.addEventListener('click', () => showNext());
          // A click beside the box keeps the keyboard on OK.
          backdrop.addEventListener('mousedown', (event) => { if (event.target === backdrop) { event.preventDefault(); messageButton?.focus({ preventScroll: true }); } });
          actions.append(messageButton);
          box.append(messageText, actions);
          backdrop.append(box);
          root.append(style, backdrop);
          document.documentElement.append(element);
          messageHost = element;
        }
        messageText!.textContent = text;
        messageButton!.focus({ preventScroll: true });
      };
      // While a message shows, no key reaches the deck (no slide change) or
      // the Escape relay below: this listener on window, in the capture
      // phase, is the first to see every key, as the bootstrap runs before
      // any deck code. Enter, Space and Escape close the message.
      for (const type of ['keydown', 'keypress', 'keyup']) {
        window.addEventListener(type, (event) => {
          if (!messageHost) return;
          event.stopImmediatePropagation();
          if (type !== 'keydown') return;
          const key = (event as KeyboardEvent).key;
          if (key === 'Enter' || key === ' ' || key === 'Spacebar' || key === 'Escape' || key === 'Esc') { event.preventDefault(); showNext(); }
          else if (key === 'Tab') { event.preventDefault(); messageButton?.focus({ preventScroll: true }); }
        }, true);
      }
      const question = 'This presentation asked a question in a pop-up window, which the player cannot show.';
      const newWindow = 'This presentation tried to open a new window, for example the speaker view (S key), which the player cannot do.';
      // Set while the task that called window.open() runs: the deck's next
      // step usually uses the window it did not get (the notes plugin sets a
      // property on it), and that TypeError is part of the same problem.
      let opening = false;
      const replace = (name: string, value: (...args: unknown[]) => unknown) => {
        try { Object.defineProperty(window, name, { configurable: true, writable: true, value }); } catch { /* Keep the sandbox's behaviour. */ }
      };
      replace('alert', function alert(message?: unknown) {
        let text = '';
        try { text = message === undefined ? '' : String(message); } catch { /* An object that cannot become text. */ }
        if (queued.length < 50) queued.push(text.slice(0, 2000));
        if (!messageHost) {
          try { showNext(); } catch { queued.length = 0; (messageHost as HTMLElement | undefined)?.remove(); messageHost = undefined; }
        }
      });
      // As in the sandbox without allow-modals: no answer. Say so once.
      replace('confirm', function confirm() { report(question); return false; });
      replace('prompt', function prompt() { report(question); return null; });
      replace('open', function open() {
        report(newWindow);
        opening = true;
        setTimeout(() => { opening = false; }, 0);
        return null;
      });
      ignoreError = (event: ErrorEvent) => {
        if (!opening) return false;
        try {
          const error = event.error as { name?: unknown } | null | undefined;
          return error instanceof TypeError || error?.name === 'TypeError';
        } catch { return false; }
      };
    }

    // Problems in the strict profile keep the wording that points to the
    // packaging tool; tolerant warnings say what was lost.
    const missing = (target: EventTarget | null) => {
      const name = (target as Element | null)?.localName;
      if (name === 'img' || name === 'image' || name === 'input') return 'A picture in the presentation could not be shown.';
      if (name === 'video' || name === 'audio' || name === 'source') return 'A video or sound in the presentation could not be played.';
      return 'A file that the presentation uses could not be loaded.';
    };
    const blocked = (event: SecurityPolicyViolationEvent) => {
      const directive = String(event.effectiveDirective || event.violatedDirective || 'unknown').slice(0, 40);
      const nouns: Record<string, string> = {
        img: 'a picture', font: 'a font', style: 'a stylesheet', script: 'a script', media: 'a video or sound',
        connect: 'a network request', frame: 'an embedded page', worker: 'a background script', object: 'a plug-in',
      };
      let host = '';
      try {
        const address = new URL(event.blockedURI);
        if (address.protocol === 'http:' || address.protocol === 'https:') host = `, ${address.host}`;
      } catch { /* Not an address, for example 'inline'. */ }
      return `The player blocked ${nouns[directive.split('-')[0]] ?? 'a resource'} (${directive}${host}).`;
    };
    // The first uncaught error or rejection: if a Reveal.js deck then never
    // starts, this is most likely why (tolerant profile, see below).
    let firstError = '';
    window.addEventListener('error', (event) => {
      if (event instanceof ErrorEvent) {
        if (ignoreError(event)) return;
        const text = describe(event.message, 'The presentation encountered an error.');
        if (!firstError) firstError = text.slice(0, 350);
        report(text);
      } else if (!tolerant) report('A presentation resource could not be loaded. Rebuild the package with all assets included.');
      // A <track> without its file (the linker cannot keep caption files)
      // fires an error although its video plays: that is no lost video.
      else if (((event as Event).target as Element | null)?.localName !== 'track') report(missing((event as Event).target));
    }, true);
    window.addEventListener('unhandledrejection', (event) => {
      const text = describe(event.reason, 'An asynchronous presentation operation failed.');
      if (!firstError) firstError = text.slice(0, 350);
      report(text);
    });
    document.addEventListener('securitypolicyviolation', (event) => {
      report(tolerant ? blocked(event) : `This presentation requested an unsupported resource (${event.effectiveDirective}). Rebuild it with the portable Slidev packaging tool.`);
    });

    // Reveal.js dispatches its events on the .reveal element and lets them
    // bubble, so this works without window.Reveal (ES-module decks): h and v
    // come from the event, the fragment from the slide, as Reveal computes it.
    let restore: number[] | undefined;
    try {
      const match = /^#\/(\d{1,4})\/(\d{1,4})(?:\/(\d{1,4}))?$/.exec(location.hash);
      if (match) restore = [Number(match[1]), Number(match[2]), match[3] === undefined ? -1 : Number(match[3])];
    } catch { /* No restore position. */ }
    let horizontal = 0;
    let vertical = 0;
    let reportedPosition = '';
    let reportedSlides = '';
    const index = (value: number) => Number.isInteger(value) && value >= 0 && value <= 9999;
    const positionOf = (root: Element) => {
      if (!index(horizontal) || !index(vertical)) return '';
      const present = root.querySelectorAll('.slides section.present');
      const slide = present[present.length - 1];
      let fragment = -1;
      if (slide?.querySelector('.fragment')) {
        const current = slide.querySelector('.current-fragment');
        fragment = current?.hasAttribute('data-fragment-index')
          ? parseInt(current.getAttribute('data-fragment-index')!, 10)
          : slide.querySelectorAll('.fragment.visible').length - 1;
      }
      return `${horizontal}/${vertical}${index(fragment) ? `/${fragment}` : ''}`;
    };
    const observe = (event: Event) => {
      const root = (event.target as Element | null)?.closest?.('.reveal');
      if (!root) return;
      const data = event as Event & { indexh?: unknown; indexv?: unknown };
      if (typeof data.indexh === 'number') horizontal = data.indexh;
      if (typeof data.indexv === 'number') vertical = data.indexv;
      if (event.type === 'ready' && restore) {
        // Reveal.js 3 does not restore a fragment from the address, and
        // hashOneBasedIndex shifts the slide by one: correct both once. The
        // slide change reports itself; the lines below then change nothing.
        const [h, v, f] = restore;
        restore = undefined;
        const reveal = (window as { Reveal?: { slide?: unknown; getRevealElement?: unknown } }).Reveal;
        if (positionOf(root) !== `${h}/${v}${f >= 0 ? `/${f}` : ''}` && reveal && typeof reveal.slide === 'function'
          && (typeof reveal.getRevealElement !== 'function' || reveal.getRevealElement() === root)) {
          try { reveal.slide(h, v, f); } catch { /* Keep the slide Reveal.js chose. */ }
        }
      }
      const position = positionOf(root);
      if (position && position !== reportedPosition) { reportedPosition = position; send('position', position); }
      const slides = String(root.querySelectorAll('.slides section:not(.stack):not([data-visibility="uncounted"])').length);
      if (slides !== reportedSlides && slides.length <= 5) { reportedSlides = slides; send('slides', slides); }
    };
    let revealReady = false;
    document.addEventListener('ready', (event) => { if ((event.target as Element | null)?.closest?.('.reveal')) revealReady = true; });
    for (const type of ['ready', 'slidechanged', 'fragmentshown', 'fragmenthidden']) document.addEventListener(type, observe);
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      // Let Slidev close its own overlays as well as notifying the outer player.
      send('escape');
    }, true);
    // Links never navigate the deck: the player has nothing to show at
    // another address, and the frame policies refuse it anyway. This
    // listener on window, in the capture phase, runs before any of the
    // deck's own (the bootstrap runs first), so the default is always
    // cancelled. A link to a website (the tolerant profile keeps those
    // addresses) is passed to the host instead, which offers to open it in
    // a new tab of the browser after the person confirms there.
    let links = 0;
    const follow = (event: Event) => {
      let element: Element | null = null;
      try {
        const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
        const target = (path[0] ?? event.target) as Element | null;
        element = target?.closest?.('a,area') ?? null;
      } catch { element = null; }
      if (!element) return;
      const href = (element.getAttribute('href') ?? element.getAttribute('xlink:href') ?? '').trim();
      if (href.startsWith('#')) return;
      event.preventDefault();
      if (!tolerant || event.type !== 'click' || links >= 30 || href.length > 2000 || !/^https?:\/\/[^\s]+$/i.test(href)) return;
      links += 1;
      send('link', href);
    };
    window.addEventListener('click', follow, true);
    window.addEventListener('auxclick', follow, true);
    document.addEventListener('submit', (event) => event.preventDefault(), true);
    // Tolerant only: a Reveal.js deck whose start-up script stopped with an
    // error before Reveal.initialize shows a blank stage. Two seconds after
    // load, try to start it with the plugins the page defines, and tell the
    // host either way: 'rescued' when the slides then start, 'blank' when not.
    let stalled = false;
    const stall = (detail: 'rescued' | 'blank') => {
      if (stalled) return;
      stalled = true;
      // The host shows the first error beside the problem: send it again as
      // the last warning before the stall (the host keeps the latest one).
      if (detail === 'blank') send('warning', firstError);
      send('stalled', detail);
    };
    const rescue = () => {
      if (stalled || revealReady || !firstError) return;
      // Reveal.js needs .reveal > .slides; a page that only uses a "reveal"
      // class (scroll animations often do) is no Reveal.js deck.
      try { if (!document.querySelector('.reveal .slides')) return; } catch { return; }
      let reveal: { initialize?: unknown; isReady?: unknown } | undefined;
      try { reveal = (window as { Reveal?: typeof reveal }).Reveal; } catch { reveal = undefined; }
      let started = false;
      try {
        if (reveal && typeof reveal.initialize === 'function' && typeof reveal.isReady === 'function' && !reveal.isReady()) {
          const plugins: unknown[] = [];
          const global = window as unknown as Record<string, unknown>;
          for (const name of ['RevealMarkdown', 'RevealHighlight', 'RevealNotes', 'RevealMath', 'RevealSearch', 'RevealZoom']) {
            try {
              let plugin = global[name];
              if (name === 'RevealMath') plugin = plugin ? (plugin as { KaTeX?: unknown }).KaTeX : undefined;
              if (plugin) plugins.push(plugin);
            } catch { /* Leave that plugin out. */ }
          }
          const result = reveal.initialize({ plugins }) as { catch?: (handler: () => void) => unknown } | undefined;
          // A failure while the plugins load leaves the stage blank; the
          // check below reports it, so the rejection need not be a warning.
          try { if (result && typeof result.catch === 'function') result.catch(() => {}); } catch { /* No promise. */ }
          started = true;
        }
      } catch { started = false; }
      if (!started) { stall('blank'); return; }
      // Say 'rescued' only once Reveal.js reports ready, so the host never
      // promises slides that do not show.
      if (revealReady) { stall('rescued'); return; }
      document.addEventListener('ready', () => { if (revealReady) stall('rescued'); });
      setTimeout(() => stall(revealReady ? 'rescued' : 'blank'), 3000);
    };
    window.addEventListener('load', () => {
      // Module scripts finish before load. Two animation frames allow Vue's
      // initial layout and reactive updates to settle before announcing readiness.
      requestAnimationFrame(() => requestAnimationFrame(() => { if (!failed) send('ready'); }));
      if (tolerant) setTimeout(rescue, 2000);
    }, { once: true });
  }

  /**
   * Parse in an inert template: imported URLs never load in the editor. Required
   * application resources must be embedded; do not silently strip a broken build.
   * The tolerant profile keeps the deck's title and adds no styles of its own.
   */
  function preparePresentationDocument(html: string, token: string, scriptNonce: string, options?: PresentationPrepareOptions): string {
    if (typeof html !== 'string' || !html.trim() || html.length > 24 * 1024 * 1024) throw new Error('The presentation HTML must be smaller than 24 MB.');
    if (!/^[a-f0-9]{36}$/.test(token) || !/^[A-Za-z0-9+/_=-]{16,128}$/.test(scriptNonce)) throw new Error('The presentation could not be initialized.');
    // Anything but an explicit 'tolerant' is the stricter profile.
    const tolerant = options?.profile === 'tolerant';
    // A linked deck has no separate files left; if one remains, say so without
    // pointing to the Slidev packaging tool, which does not apply to it.
    const unsupported = (strict: string, linked: string) => new Error(tolerant ? linked : strict);
    const webAddress = (value: string) => {
      if (!/^https?:\/\/\S+$/i.test(value)) return false;
      try { const url = new URL(value); return url.protocol === 'http:' || url.protocol === 'https:'; } catch { return false; }
    };
    const template = document.createElement('template');
    template.innerHTML = html;
    const content = template.content;
    // Template contents are parsed as if scripts were off, so a <noscript>
    // fallback (a web-font stylesheet, a picture) would look like a separate
    // file. Scripts always run in the player: that content never applies.
    for (const element of [...content.querySelectorAll('noscript')]) element.remove();
    if (content.querySelector('script[src],script[href],script[xlink\\:href]')) {
      throw unsupported('This presentation has separate JavaScript files. Create a portable ZIP with the Slidev packaging tool before opening it.',
        'This presentation still loads a separate script file, which the player cannot open.');
    }
    if (content.querySelector('link[rel~="stylesheet"]')) {
      throw unsupported('This presentation has separate stylesheets. Create a portable ZIP with the Slidev packaging tool before opening it.',
        'This presentation still loads a separate stylesheet, which the player cannot open.');
    }
    if (content.querySelector('iframe,frame,frameset,object,embed,portal')) {
      throw unsupported('Embedded websites are not supported in an offline Slidev package. Include the demonstration directly in the presentation.',
        'This presentation embeds another web page or a plug-in, which the player cannot show.');
    }
    if (content.querySelector('script[type="importmap"]')) {
      throw unsupported('This presentation still needs JavaScript imports. Rebuild it with the portable Slidev packaging tool.',
        'This presentation still needs JavaScript imports, which the player cannot resolve.');
    }

    const title = tolerant ? (content.querySelector('title')?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) : '';
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
        if (element.localName === 'a' || element.localName === 'area') {
          // Tolerant: a link to a website keeps its address. The deck still
          // cannot follow it (see the click guard in the bootstrap); the host
          // offers to open it in a new tab once the person confirms there.
          if (tolerant && (name === 'href' || name === 'xlink:href') && webAddress(value)) continue;
          element.removeAttribute(name);
          continue;
        }
        if (value) {
          throw unsupported('This presentation references an asset outside its HTML. Rebuild the portable package with its pictures, fonts, and media included.',
            'This presentation still refers to a file outside its HTML, which the player cannot load.');
        }
        element.removeAttribute(name);
      }
    }
    for (const script of content.querySelectorAll('script')) script.setAttribute('nonce', scriptNonce);
    const policy = `default-src 'none'; script-src 'nonce-${scriptNonce}'; script-src-attr 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
    // Nonces alone also authorize external scripts carrying the nonce. The second
    // policy intersects with the first and restricts all execution to inline code.
    const inlineOnly = "script-src 'unsafe-inline'; script-src-attr 'none'";
    const setup = `(()=>{const __name=(value)=>value;(${presentationBootstrap.toString()})(${JSON.stringify(token)},${tolerant});})();`.replace(/<\/script/gi, '<\\/script');
    const escapeAttribute = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // Template parsing discards the html and body tags, so read their
    // attributes with the browser's own parser in an inert document, which
    // runs and loads nothing. Unlike a pattern, it is not misled by a ">" in
    // an attribute value or by "<body" inside a script. Only declarative
    // attributes are kept.
    const roots = /<(?:html|body)[\s/>]/i.test(html) ? new DOMParser().parseFromString(html, 'text/html') : undefined;
    const rootAttributes = (element: Element | null | undefined) => (element ? [...element.attributes] : [])
      .filter((attribute) => /^(?:lang|dir|class|style|id|role|translate|data-[a-z0-9_.-]+|aria-[a-z]+)$/i.test(attribute.name))
      .map((attribute) => ` ${attribute.name}="${escapeAttribute(attribute.value)}"`).join('');
    const htmlAttributes = rootAttributes(roots?.documentElement);
    const bodyAttributes = rootAttributes(roots?.body?.localName === 'body' ? roots.body : undefined);
    const titleElement = title ? `<title>${title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</title>` : '';
    const styles = tolerant ? '' : '<style>html,body{margin:0;width:100%;height:100%;overflow:hidden}body{font-family:system-ui,sans-serif}*,*::before,*::after{box-sizing:border-box}</style>';
    const prepared = `<!doctype html><html${htmlAttributes || ' lang="en"'}><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta http-equiv="Content-Security-Policy" content="${inlineOnly}"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1">${titleElement}${styles}<script nonce="${scriptNonce}">${setup}</script></head><body${bodyAttributes}>${template.innerHTML}</body></html>`;
    // Serialization can expand entities and nonce-bearing elements. Bound the
    // finished message in UTF-16 code units, exactly as the runner does, so a
    // valid input cannot silently exceed the receiving limit and time out.
    if (prepared.length > 26 * 1024 * 1024) {
      throw unsupported('The presentation is too large after preparing it for playback. Reduce its embedded assets or split the deck, then rebuild the portable ZIP.',
        'The presentation is too large after preparing it for playback. Reduce its embedded pictures and media, or split it into two presentations.');
    }
    return prepared;
  }

  /** "h/v" or "h/v/f", digits only: a slide position the player can restore. */
  function isPresentationPosition(value: unknown): value is string {
    return typeof value === 'string' && /^\d{1,4}\/\d{1,4}(?:\/\d{1,4})?$/.test(value);
  }

  /** Creation is inert. Only start/restart creates a browsing context. */
  function createPresentationPlayer(host: HTMLElement, initialHtml: string, options: PresentationPlayerOptions): PresentationPlayer {
    const abort = new AbortController();
    const tolerant = options.profile === 'tolerant';
    let html = initialHtml;
    let frame: HTMLIFrameElement | undefined;
    let token: string | undefined;
    let timeout: number | undefined;
    let disposed = false;
    let state: PresentationPlayerState = 'stopped';
    let errors = 0;
    let warnings = 0;
    // The latest known slide survives stop() and an error, so update() and
    // start({ position }) can return to it; a start without a position, and
    // restart(), begin again at the first slide. The reported values are per
    // playback.
    let position: string | undefined;
    let reportedPosition = '';
    let reportedSlides = -1;
    let lastWarning: string | undefined;
    let stalled = false;
    let links = 0;
    const setState = (value: PresentationPlayerState) => { state = value; options.onState?.(value); };
    const nonce = () => [...crypto.getRandomValues(new Uint8Array(18))].map((value) => value.toString(16).padStart(2, '0')).join('');
    const stop = () => {
      if (timeout !== undefined) window.clearTimeout(timeout);
      timeout = undefined;
      frame?.remove(); frame = undefined; token = undefined;
      if (!disposed) setState('stopped');
    };
    const fail = (message: string, origin: PresentationMessageOrigin) => {
      if (timeout !== undefined) window.clearTimeout(timeout);
      timeout = undefined;
      // A failed or incompatible application must not keep executing behind the
      // error overlay. Restart creates a fresh, isolated browsing context.
      frame?.remove(); frame = undefined; token = undefined;
      setState('error');
      if (errors++ < 3) options.onError?.(message.slice(0, 350), origin);
    };
    // A frame focused before its document loaded does not pass the keyboard on
    // in Chromium. Blurring first makes the next focus() a real focus change,
    // which gives the runner document focus; the runner then focuses the deck.
    const handOffFocus = (current: HTMLIFrameElement) => {
      current.blur();
      current.focus({ preventScroll: true });
      if (token) current.contentWindow?.postMessage({ type: 'qft-presentation-focus', token }, '*');
    };
    const start = (startOptions?: PresentationStartOptions) => {
      if (disposed) return;
      stop(); errors = 0; warnings = 0; reportedPosition = ''; reportedSlides = -1;
      lastWarning = undefined; stalled = false; links = 0;
      const requested = startOptions?.position;
      const restore = isPresentationPosition(requested) ? requested : undefined;
      position = restore;
      token = nonce();
      let prepared: string;
      const scriptNonce = options.scriptNonce ?? nonce();
      try { prepared = preparePresentationDocument(html, token, scriptNonce, { profile: tolerant ? 'tolerant' : 'strict' }); }
      catch (error) { fail(error instanceof Error ? error.message : 'The presentation could not be prepared.', 'player'); return; }
      frame = document.createElement('iframe');
      const current = frame;
      current.className = 'presentation-frame';
      current.title = `${options.title} — ${tolerant ? 'presentation' : 'Slidev presentation'}`;
      current.setAttribute('sandbox', 'allow-scripts');
      current.setAttribute('referrerpolicy', 'no-referrer');
      current.setAttribute('allow', "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; payment 'none'; usb 'none'; serial 'none'; fullscreen 'none'");
      current.style.cssText = 'display:block;border:0;width:100%;height:100%;background:#fff';
      current.tabIndex = 0;
      // The runner appends the fragment to the deck's blob: address.
      const load = restore ? { type: 'qft-presentation-load', token, html: prepared, fragment: `#/${restore}` } : { type: 'qft-presentation-load', token, html: prepared };
      current.addEventListener('load', () => {
        if (frame === current && token) current.contentWindow?.postMessage(load, '*');
      }, { once: true, signal: abort.signal });
      if (options.sandboxUrl) current.src = options.sandboxUrl;
      else current.srcdoc = presentationRunnerDocument(scriptNonce);
      host.replaceChildren(current);
      setState('loading');
      timeout = window.setTimeout(() => {
        if (frame === current && state === 'loading') {
          fail(tolerant ? 'The presentation has not finished loading after 20 seconds. Try Restart.'
            : 'The presentation has not finished loading. Try Restart, or rebuild it with the portable Slidev packaging tool.', 'player');
        }
      }, 20_000);
      current.focus({ preventScroll: true });
    };
    // Everything here comes from the deck, through the runner: check the type
    // and size of each detail, bound the counts, and pass on text only.
    window.addEventListener('message', (event) => {
      if (!frame || event.source !== frame.contentWindow || !event.data || typeof event.data !== 'object') return;
      const message = event.data;
      if (message.qftPresentation !== 1 || message.token !== token) return;
      const kind = message.kind;
      const detail: unknown = message.detail;
      if (kind === 'ready' && state === 'loading') {
        if (timeout !== undefined) window.clearTimeout(timeout);
        timeout = undefined;
        setState('ready');
        // Keep the keyboard with the deck unless the user has moved on, for
        // example to the source view or another control, while it loaded.
        if (frame && document.activeElement === frame) handOffFocus(frame);
      } else if (kind === 'error' && typeof detail === 'string') fail(detail, 'presentation');
      else if (kind === 'escape') options.onEscape?.();
      else if (kind === 'warning') {
        if (tolerant && typeof detail === 'string') {
          lastWarning = detail.slice(0, 350);
          if (warnings < 20) { warnings += 1; options.onWarning?.(lastWarning); }
        }
      } else if (kind === 'stalled') {
        if (tolerant && !stalled && (detail === 'rescued' || detail === 'blank')) { stalled = true; options.onStalled?.(detail, lastWarning); }
      } else if (kind === 'link') {
        // As for fullscreen: a link message without a user action in the
        // deck is the deck acting by itself, so drop it.
        const activation = typeof navigator === 'undefined' ? undefined : navigator.userActivation;
        if (tolerant && typeof detail === 'string' && detail.length <= 2000 && links < 30 && activation?.isActive !== false) {
          let url: URL | undefined;
          try { url = new URL(detail); } catch { url = undefined; }
          if (url && (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname) {
            links += 1;
            url.username = '';
            url.password = '';
            options.onLink?.(url);
          }
        }
      } else if (kind === 'position') {
        if (isPresentationPosition(detail) && detail !== reportedPosition) { reportedPosition = detail; position = detail; options.onPosition?.(detail); }
      } else if (kind === 'slides') {
        const count = typeof detail === 'string' && /^\d{1,5}$/.test(detail) ? Number(detail) : -1;
        if (count >= 0 && count !== reportedSlides) { reportedSlides = count; options.onSlides?.(count); }
      } else if (kind === 'fullscreen') {
        // User activation reaches the ancestors of the frame the user acted
        // in, so a key press in the deck lets this page enter fullscreen. A
        // request without one is the deck acting by itself: drop it.
        const activation = typeof navigator === 'undefined' ? undefined : navigator.userActivation;
        if (tolerant && (detail === 'enter' || detail === 'exit') && activation?.isActive !== false) options.onFullscreenRequest?.(detail);
      }
    }, { signal: abort.signal });
    return {
      start: (startOptions?: PresentationStartOptions) => start(startOptions),
      stop,
      restart: () => start(),
      update(next: string, updateOptions?: PresentationStartOptions) {
        if (disposed) return;
        html = next;
        if (state !== 'stopped') start({ position: updateOptions?.position ?? position });
      },
      destroy() { if (disposed) return; stop(); disposed = true; abort.abort(); },
      focus() { if (frame) handOffFocus(frame); },
      isRunning() { return !!frame; },
      currentPosition() { return position; },
    };
  }
  return {
    createPlayer: createPresentationPlayer,
    prepareDocument: preparePresentationDocument,
    runnerDocument: presentationRunnerDocument,
    isPosition: isPresentationPosition,
  };
}

/** Creation is inert. Only start/restart creates a browsing context. */
export function createPresentationPlayer(host: HTMLElement, html: string, options: PresentationPlayerOptions): PresentationPlayer {
  return presentationRuntimeFactory().createPlayer(host, html, options);
}

/** Validate and prepare one fully bundled application without running it. */
export function preparePresentationDocument(html: string, token: string, scriptNonce: string, options: PresentationPrepareOptions = {}): string {
  return presentationRuntimeFactory().prepareDocument(html, token, scriptNonce, options);
}

/** "h/v" or "h/v/f", digits only: a slide position that start() and update() accept. */
export function isPresentationPosition(value: unknown): value is string {
  return presentationRuntimeFactory().isPosition(value);
}

/** Both the public runner and exported runner use this exact shell. */
export function presentationRunnerDocument(scriptNonce?: string): string {
  return presentationRuntimeFactory().runnerDocument(scriptNonce);
}

/** A portable expression with no dependency on the website or external scripts. */
export function presentationRuntimeSource(): string {
  return `(function(){const __name=(value)=>value;return (${presentationRuntimeFactory.toString()})().createPlayer;})()`;
}

/**
 * A standalone classroom copy. Imported code stays inert until Start is
 * chosen. It plays with the given profile; under 'tolerant' the deck's own
 * fullscreen requests (F in Reveal.js) work as the Fullscreen button does.
 */
/** The standalone copy has no notes or report, so its next step differs from the library's. */
const EXPORT_STALL_NEXT = 'Open the presentation in the library of md.qft.org to see the notes from the check, or ask your AI assistant for a corrected version.';

export function exportPresentationHtml(html: string, title: string, options: PresentationExportOptions = {}): string {
  if (typeof html !== 'string' || !html.trim() || html.length > 24 * 1024 * 1024) throw new Error('The presentation HTML must be smaller than 24 MB.');
  const profile: PresentationProfile = options.profile === 'tolerant' ? 'tolerant' : 'strict';
  const nonce = [...crypto.getRandomValues(new Uint8Array(18))].map((value) => value.toString(16).padStart(2, '0')).join('');
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const json = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const notices = (Array.isArray(options.notices) ? options.notices : [])
    .filter((notice) => notice && typeof notice.title === 'string' && typeof notice.text === 'string' && notice.title.trim() && notice.text.trim())
    .slice(0, EXPORT_NOTICE_LIMIT)
    .map((notice) => `<section><h2>${escape(notice.title.slice(0, EXPORT_NOTICE_TITLE))}</h2><pre>${escape(notice.text.slice(0, EXPORT_NOTICE_TEXT))}</pre></section>`);
  const noticeSection = notices.length
    ? `<details id="notices"><summary>Third-party notices</summary><div class="notices"><p>This copy contains the code and fonts listed here. Their licences ask for these notices to travel with every copy.</p>${notices.join('')}</div></details>`
    : '';
  const script = `const createPlayer=${presentationRuntimeSource()};const host=document.getElementById('presentation');const status=document.getElementById('status');const start=document.getElementById('start');const stop=document.getElementById('stop');const fullscreen=document.getElementById('fullscreen');const placeholder=document.getElementById('placeholder');const problem=document.getElementById('problem');const stalled=document.getElementById('stalled');const rescued=document.getElementById('rescued');const link=document.getElementById('link');const linkText=document.getElementById('link-text');let linkUrl;let linkTimer;let blank=false;const live='Live · use the slide controls or arrow keys';const hideLink=()=>{window.clearTimeout(linkTimer);linkUrl=undefined;link.hidden=true;};const startedLate=()=>{if(!blank)return;blank=false;stalled.hidden=true;status.textContent=live;};document.getElementById('link-open').addEventListener('click',()=>{const url=linkUrl;hideLink();if(url)window.open(url.href,'_blank','noopener,noreferrer');});document.getElementById('link-dismiss').addEventListener('click',()=>{hideLink();player.focus();});document.getElementById('rescued-dismiss').addEventListener('click',()=>{rescued.hidden=true;player.focus();});const player=createPlayer(host,${json(html)},{title:${json(title)},scriptNonce:${json(nonce)},profile:${json(profile)},onState(state){start.textContent=state==='stopped'?'Start presentation':'Restart';stop.disabled=state==='stopped';status.textContent=state==='stopped'?'Ready to present · works offline':state==='loading'?'Opening presentation…':state==='ready'?live:'Presentation needs attention';placeholder.hidden=state==='loading'||state==='ready';if(state!=='error')problem.hidden=true;if(state==='loading'||state==='stopped'){blank=false;stalled.hidden=true;rescued.hidden=true;hideLink();}},onStalled(detail,first){if(detail==='rescued'){rescued.hidden=false;return;}blank=true;const intro=document.createElement('p');intro.textContent=${json(STALL_BLANK_TEXT)};const lines=[intro];if(first){const line=document.createElement('p');const label=document.createElement('strong');label.textContent='The presentation reported: ';const quote=document.createElement('q');quote.textContent=first;line.append(label,quote);lines.push(line);}const next=document.createElement('p');next.textContent=${json(EXPORT_STALL_NEXT)};lines.push(next);stalled.replaceChildren(...lines);stalled.hidden=false;status.textContent='The slides did not start';},onPosition(){hideLink();startedLate();},onSlides(){startedLate();},onLink(url){if(!player.isRunning())return;const rest=(url.port?':'+url.port:'')+(url.pathname==='/'&&!url.search&&!url.hash?'':url.pathname)+url.search+url.hash;const strong=document.createElement('strong');strong.textContent=url.hostname;linkText.replaceChildren('The presentation links to ',strong,rest.length>60?rest.slice(0,59)+'…':rest,'.');linkUrl=url;link.hidden=false;window.clearTimeout(linkTimer);linkTimer=window.setTimeout(hideLink,20000);},onError(message,origin){problem.replaceChildren();if(origin==='presentation'){const label=document.createElement('strong');label.textContent='The presentation reported: ';const quote=document.createElement('q');quote.textContent=message;problem.append(label,quote);}else problem.textContent=message;problem.hidden=false;},onEscape(){if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});},onFullscreenRequest(request){void setFullscreen(request==='enter');}});async function setFullscreen(enter){try{if(enter&&!document.fullscreenElement)await document.getElementById('stage').requestFullscreen();else if(!enter&&document.fullscreenElement)await document.exitFullscreen();player.focus();}catch{status.textContent='Fullscreen is unavailable. Use the browser fullscreen command.';}}start.addEventListener('click',()=>player.start());stop.addEventListener('click',()=>player.stop());fullscreen.addEventListener('click',()=>{if(!player.isRunning())player.start();void setFullscreen(!document.fullscreenElement);});window.addEventListener('pagehide',()=>player.destroy(),{once:true});`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; script-src-attr 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; frame-src 'self' blob:; connect-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><meta http-equiv="Content-Security-Policy" content="script-src 'unsafe-inline'; script-src-attr 'none'"><title>${escape(title)}</title><style>:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#f6f4f0;color:#292626;font:14px/1.5 system-ui,sans-serif}header{display:flex;gap:16px;align-items:center;padding:10px 18px;border-bottom:1px solid #e1ddd7;min-height:52px}h1{font-size:15px;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}nav{display:flex;gap:8px;flex-wrap:wrap}button{font:inherit;border:1px solid #d3cdc4;border-radius:6px;background:#fff;padding:7px 12px;cursor:pointer}button:first-child{background:#773b49;border-color:#773b49;color:#fff}button:disabled{opacity:.5;cursor:default}button:focus-visible{outline:3px solid #b17683;outline-offset:3px}#stage{position:relative;display:flex;flex-direction:column;height:calc(100dvh - 96px);min-height:240px;background:#fff}#stage:fullscreen{height:100dvh;width:100vw}#presentation{position:relative;flex:1;min-height:0;width:100%}.strip{display:flex;align-items:center;gap:6px 14px;flex-wrap:wrap;padding:7px 14px;background:#f6efdc;color:#4a3a14;border-bottom:1px solid #d6c08f;font-size:13px}.strip[hidden]{display:none}.strip p{flex:1 1 260px;min-width:0;margin:0;overflow-wrap:anywhere}.strip div{display:flex;gap:8px;flex-wrap:wrap}.strip button{padding:4px 10px}.strip button.open{background:#773b49;border-color:#773b49;color:#fff}#stalled{position:absolute;top:16px;left:50%;transform:translateX(-50%);width:min(640px,calc(100% - 32px));max-height:calc(100% - 32px);overflow:auto;z-index:2;margin:0;padding:12px 16px;border:1px solid #cf8796;border-left-width:4px;border-radius:6px;background:#fff0f3;color:#84283d;overflow-wrap:anywhere;box-shadow:0 8px 28px #0003}#stalled[hidden]{display:none}#stalled p{margin:0}#stalled p+p{margin-top:8px}#placeholder{position:absolute;inset:0;display:grid;place-content:center;padding:30px;text-align:center;pointer-events:none}#placeholder[hidden]{display:none}#placeholder>strong{font-size:clamp(22px,4vw,42px);font-weight:600}#problem{max-width:640px;margin:8px auto 0;padding:12px 16px;border:1px solid #cf8796;border-radius:6px;background:#fff0f3;color:#84283d;overflow-wrap:anywhere}#problem[hidden]{display:none}footer{display:flex;flex-wrap:wrap;align-items:center;gap:0 16px;padding:0 18px;min-height:44px;font-size:12px}#status{flex:1 1 240px;margin:0;padding:10px 0}#notices summary{cursor:pointer;padding:10px 0;color:#5d5855}#notices summary:focus-visible{outline:3px solid #b17683;outline-offset:3px}#notices[open]{flex-basis:100%;padding-bottom:18px}#notices .notices{max-height:60vh;overflow:auto;border:1px solid #e1ddd7;border-radius:6px;background:#fff;padding:4px 14px}#notices h2{font-size:13px;margin:14px 0 6px}#notices pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace}@media(max-width:600px){header{flex-wrap:wrap}h1{flex-basis:100%}#stage{height:calc(100dvh - 140px)}}</style></head><body><header><h1>${escape(title)}</h1><nav aria-label="Presentation controls"><button id="start">Start presentation</button><button id="stop" disabled>Stop</button><button id="fullscreen">Fullscreen</button></nav></header><main id="stage"><div class="strip" id="rescued" role="status" hidden><p>${escape(STALL_RESCUED_TEXT)}</p><div><button type="button" id="rescued-dismiss">Dismiss</button></div></div><div class="strip" id="link" role="status" hidden><p id="link-text"></p><div><button type="button" class="open" id="link-open">Open link in a new tab</button><button type="button" id="link-dismiss">Dismiss</button></div></div><div id="presentation"></div><div id="stalled" role="alert" hidden></div><div id="placeholder"><strong>${escape(title)}</strong><p>Choose Start presentation to run the interactive slides.</p><p id="problem" role="alert" hidden></p></div></main><footer><p id="status" role="status" aria-live="polite">Ready to present · works offline</p>${noticeSection}</footer><script nonce="${nonce}">${script.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
}
