import { STALL_BLANK_TEXT, STALL_RESCUED_TEXT, linkParts } from './presentation-messages';

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
 *   what the player cannot do for the deck (pop-up questions, new windows,
 *   printing, files from the internet) is reported by a short code that the
 *   host turns into its own sentence (onLimit); with startCheck 'reveal', a
 *   Reveal.js deck whose start-up script failed is started with basic
 *   settings when possible and reported (onStalled); a click on a link to a
 *   website is passed to the host (onLink), which opens nothing by itself.
 */
export type PresentationProfile = 'strict' | 'tolerant';
/** What a deck asked the host to do: enter fullscreen, or leave it. */
export type PresentationFullscreenRequest = 'enter' | 'exit';
/**
 * Tolerant profile only: which start-up check runs. 'reveal' (for decks the
 * check detected as Reveal.js) starts a deck whose own start-up script
 * failed with basic settings, and reports it (onStalled). Without it, no
 * deck is started by the player and no stall is reported.
 */
export type PresentationStartCheck = 'reveal';

/**
 * Something the player could not do for the deck. The deck can only choose
 * the code (and, for the blocked-* codes, a host name that passes the strict
 * check of presentationHostName); the text is the player's own.
 */
export type PresentationLimitCode =
  | 'question' | 'new-window' | 'speaker-view' | 'print' | 'form'
  | 'blocked-picture' | 'blocked-font' | 'blocked-style' | 'blocked-script' | 'blocked-media'
  | 'blocked-request' | 'blocked-page' | 'blocked-other'
  | 'missing-picture' | 'missing-media' | 'missing-file'
  | 'failed-step' | 'link-too-long';

export interface PresentationLimit {
  code: PresentationLimitCode;
  /** Only for blocked-* codes, when the address had one: as the URL parser gives it (punycode), with a port if any. */
  host?: string;
  /** The player's own sentence for this limit, with what to do next. Plain text. */
  text: string;
  /** false for information that is no problem of the deck (the speaker view, printing). */
  counted: boolean;
}

/**
 * The deck replaced itself with a page at another address (a script set
 * location.href to a website): the browser refused it, and the deck is gone
 * from its frame. See onLeft.
 */
export interface PresentationLeft {
  /**
   * The host of that address when it is http or https and passes the strict
   * check (presentationHostName), with a port if any; undefined otherwise.
   * Chosen by the deck: show it only inside the app's own sentence.
   */
  host?: string;
  /**
   * Whether the runner had user activation when the deck left
   * (navigator.userActivation.isActive there), that is, whether the person
   * had just acted inside the presentation. Only input in the deck's frame
   * or the runner gives the runner activation, not the click on Start in
   * this page. False when the runner says nothing about it.
   */
  active: boolean;
}

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
   * Tolerant profile with startCheck 'reveal' only, at most once per
   * playback: a Reveal.js deck whose start-up script stopped with an error
   * did not start by itself. 'rescued': the player started it with basic
   * settings and the slides show; 'blank': it could not, and the stage stays
   * empty. After 'rescued', 'recovered' may follow once: the deck started
   * Reveal.js itself after all and its own settings now apply, so withdraw
   * the notice. `firstError` is the deck's own text for the first error (at
   * most 350 characters; insert it as text); undefined for 'recovered'.
   */
  onStalled?: (detail: PresentationStall, firstError: string | undefined) => void;
  /**
   * Tolerant profile only: the person clicked a link to a website in the
   * deck, which cannot open it itself. The bootstrap sends it only for a
   * trusted click or middle click that the deck did not cancel; the host
   * checks the address (http or https, no user name or password, at most
   * 2000 characters) and wants recent user activation in the page. A deck
   * can still forge the message while there is such activation, so show
   * only the address, and open it only on another action on the host page.
   */
  onLink?: (url: URL) => void;
  /**
   * Tolerant profile only: something the player could not do for the deck
   * (see PresentationLimit). Each code and host once per playback, at most
   * 20 per playback. The text is the player's own; show it as such.
   */
  onLimit?: (limit: PresentationLimit) => void;
  /** Tolerant profile only: pass 'reveal' for a deck detected as Reveal.js. See PresentationStartCheck. */
  startCheck?: PresentationStartCheck;
  /**
   * Tolerant profile only, at most once per playback: the deck replaced
   * itself with a page at another address (see PresentationLeft). No later
   * message of that playback is accepted; the frame shows the browser's
   * error page until the host calls start(), update() or stop(). Without
   * this option (and always in the strict profile), the player stops with
   * an error in its own words (onError with origin 'player'):
   * "The presentation tried to replace its slides with a page from HOST, so
   * the player stopped it. Choose Start to play it again. Ask your AI
   * assistant to use an ordinary link for that page."
   */
  onLeft?: (left: PresentationLeft) => void;
}

/**
 * How a Reveal.js deck that stopped during start-up was left: see onStalled.
 * 'recovered' comes at most once, only after 'rescued' in the same playback:
 * the deck then started Reveal.js itself (late), and its own settings now apply.
 */
export type PresentationStall = 'rescued' | 'blank' | 'recovered';

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
  /** Tolerant profile only: see PresentationStartCheck. */
  startCheck?: PresentationStartCheck;
}

export interface PresentationExportOptions {
  /** Defaults to 'strict'. */
  profile?: PresentationProfile;
  /** Tolerant profile only: see PresentationStartCheck. */
  startCheck?: PresentationStartCheck;
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
   * A host name the player may put in its own sentences: labels of 1 to 63
   * characters from a-z, 0-9 and "-" that neither start nor end with a dash,
   * joined by single dots, at most 253 characters, at least two labels or
   * exactly "localhost", and an optional port from 1 to 65535. Anything else
   * gives the sentence without a host. No outer references: the runner and
   * the deck's bootstrap get this exact function as an argument.
   */
  function presentationHostName(value: unknown): boolean {
    if (typeof value !== 'string' || !value || value.length > 259) return false;
    const colon = value.indexOf(':');
    const name = colon < 0 ? value : value.slice(0, colon);
    if (colon >= 0) {
      const port = value.slice(colon + 1);
      if (!/^[1-9]\d{0,4}$/.test(port) || Number(port) > 65535) return false;
    }
    if (!name || name.length > 253) return false;
    const labels = name.split('.');
    if (labels.length < 2 && name !== 'localhost') return false;
    for (const label of labels) if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) return false;
    return true;
  }

  /**
   * Only this trusted shell owns the application iframe. Its blob-only frame
   * policy also prevents the application navigating itself to an HTTP URL.
   * Kept self-contained for the static runner and standalone classroom exports.
   */
  function presentationSandboxBootstrap(isHost: (value: unknown) => boolean): void {
    if (window.parent === window || window.origin !== 'null') return;
    let used = false;
    let left = false;
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
        // 'left' is not among them: only this shell says that the deck left.
        const kind = message.kind;
        const detail = message.detail;
        const space = typeof detail === 'string' ? detail.indexOf(' ') : -1;
        if (kind === 'ready' || kind === 'escape') send(kind);
        else if (kind === 'stalled' && (detail === 'rescued' || detail === 'blank' || detail === 'recovered')) send(kind, detail);
        // A limit is a code from the player's fixed list, for blocked files
        // followed by one host name; the host writes the sentence for it.
        else if (kind === 'limit' && typeof detail === 'string' && detail.length <= 300
          && /^(?:question|new-window|speaker-view|print|form|blocked-(?:picture|font|style|script|media|request|page|other)|missing-(?:picture|media|file)|failed-step|link-too-long)$/.test(space < 0 ? detail : detail.slice(0, space))
          && (space < 0 || isHost(detail.slice(space + 1)))) send(kind, detail);
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
    // This shell loads nothing itself: a violation here is the deck's frame
    // going to another address (a script set location.href to a website),
    // which the frame policy refuses. The deck is then gone from its frame.
    // Say so once, with the host when the address has a plain one (the
    // browser gives only the origin here); the host page decides what next.
    document.addEventListener('securitypolicyviolation', (event) => {
      if (!used || left) return;
      left = true;
      let host = '';
      try {
        const url = new URL(String(event.blockedURI ?? ''));
        if ((url.protocol === 'http:' || url.protocol === 'https:') && isHost(url.host)) host = url.host;
      } catch { /* No address. */ }
      // Whether the person just acted inside the deck (or this shell): only
      // input there gives this frame activation, not the click on Start.
      let active = false;
      try { active = navigator.userActivation?.isActive === true; } catch { /* Not known: not active. */ }
      parent.postMessage({ qftPresentation: 1, token, kind: 'left', detail: host, active }, '*');
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
    const setup = `(()=>{const __name=(value)=>value;(${presentationSandboxBootstrap.toString()})(${presentationHostName.toString()});})();`.replace(/<\/script/gi, '<\\/script');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta http-equiv="Content-Security-Policy" content="script-src 'unsafe-inline'; script-src-attr 'none'"><meta name="referrer" content="no-referrer"><meta name="robots" content="noindex, nofollow"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Isolated presentation player</title><style>body{margin:0;padding:24px;background:#faf8f4;color:#66616a;font:14px/1.6 system-ui,sans-serif}</style></head><body><p>Open a presentation from the Markdown workspace.</p><script${scriptNonce ? ` nonce="${scriptNonce}"` : ''}>${setup}</script></body></html>`;
  }

  /**
   * No outer references: also serialized into the isolated document, where it
   * runs before any deck code. `tolerant` selects the tolerant profile;
   * `revealCheck` (tolerant only) runs the Reveal.js start-up check;
   * `isHost` is presentationHostName.
   */
  function presentationBootstrap(token: string, tolerant: boolean, revealCheck: boolean | undefined, isHost: (value: unknown) => boolean): void {
    let failed = false;
    let reportedErrors = 0;
    const warned = new Set<string>();
    const limits = new Set<string>();
    const send = (kind: string, detail?: string) => parent.postMessage({ qftPresentation: 1, token, kind, detail }, '*');
    // Strict: the first problem stops the deck, which the host then removes.
    // Tolerant: each distinct problem is reported once and the deck plays on.
    // Only text that the deck supplied (its error messages) goes this way.
    const report = (message: string) => {
      const text = message.slice(0, 350);
      if (tolerant) {
        if (warned.size < 20 && !warned.has(text)) { warned.add(text); send('warning', text); }
        return;
      }
      failed = true;
      if (reportedErrors++ < 3) send('error', text);
    };
    // Tolerant only: what the player itself could not do, as a code from a
    // fixed list (and a host name): the host writes the sentence for it.
    // Each code and host once, at most 20 per playback.
    const limit = (code: string, host?: string) => {
      if (!tolerant) return;
      const detail = host ? `${code} ${host}` : code;
      if (limits.size >= 20 || limits.has(detail)) return;
      limits.add(detail);
      send('limit', detail);
    };
    // The deck's own text for an error or a rejection, or '' when it has none.
    const describe = (value: unknown) => {
      try { return String((value as { message?: unknown } | null | undefined)?.message || value || ''); }
      catch { return ''; }
    };
    // Tolerant only: a link to a website, passed to the host (at most 30 per
    // playback); the host shows the address and opens it only on its own
    // button. Too long to offer: a limit instead.
    let links = 0;
    const offerLink = (href: string) => {
      if (href.length > 2000) { limit('link-too-long'); return; }
      if (links >= 30) return;
      links += 1;
      send('link', href);
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
      // While the box shows, the rest of the document is inert, so that a
      // screen reader cannot reach the slides behind it. Only the elements
      // that were not inert before are changed, and only those are restored.
      let madeInert: Element[] = [];
      const restoreInert = () => {
        for (const element of madeInert) { try { element.removeAttribute('inert'); } catch { /* Leave it. */ } }
        madeInert = [];
      };
      const showNext = () => {
        const text = queued.shift();
        if (text === undefined) {
          messageHost?.remove();
          messageHost = messageText = messageButton = undefined;
          restoreInert();
          const previous = returnFocus as { focus?: (options?: FocusOptions) => void } | null | undefined;
          returnFocus = undefined;
          try { previous?.focus?.({ preventScroll: true }); } catch { /* Focus stays where it is. */ }
          return;
        }
        if (!messageHost) {
          returnFocus = document.activeElement;
          try {
            for (const element of Array.from(document.body?.children ?? [])) {
              if (element.hasAttribute('inert')) continue;
              element.setAttribute('inert', '');
              madeInert.push(element);
            }
          } catch { /* The box still works without it. */ }
          // An unknown element name and inline !important styles: the deck's
          // own rules cannot hide or restyle it, and the closed shadow root
          // keeps its insides out of the deck's reach.
          const element = document.createElement('qft-message');
          element.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;display:block!important';
          const root = element.attachShadow({ mode: 'closed' });
          const style = document.createElement('style');
          // A column: the text scrolls, and OK always stays in view, also
          // in a frame only about 160 pixels high (the library on a phone).
          style.textContent = '.backdrop{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;background:rgba(20,18,22,.45);font:16px/1.5 system-ui,sans-serif}'
            + '.box{box-sizing:border-box;display:flex;flex-direction:column;width:min(560px,100%);max-height:100%;padding:20px 22px 16px;border-radius:10px;background:#fff;color:#222;box-shadow:0 12px 40px rgba(0,0,0,.35)}'
            + '.text{flex:0 1 auto;min-height:1.5em;overflow:auto;margin:0 0 16px;white-space:pre-wrap;overflow-wrap:anywhere}.actions{flex:none;text-align:right}'
            + 'button{font:inherit;min-width:88px;padding:8px 16px;border:1px solid #773b49;border-radius:6px;background:#773b49;color:#fff;cursor:pointer}'
            + 'button:focus-visible{outline:3px solid #b17683;outline-offset:2px}'
            + '@media (max-height:320px){.backdrop{padding:6px}.box{padding:8px 12px}.text{margin-bottom:6px}button{padding:4px 14px}}';
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
      replace('confirm', function confirm() { limit('question'); return false; });
      replace('prompt', function prompt() { limit('question'); return null; });
      // Whether the person has just acted in the deck: the browser's user
      // activation, or where it has none, a trusted pointer or key event
      // within the last second.
      let lastInput = -Infinity;
      const activation = (() => { try { return (navigator as { userActivation?: { isActive?: unknown } }).userActivation; } catch { return undefined; } })();
      if (!activation) {
        for (const type of ['pointerdown', 'mousedown', 'touchend', 'keydown', 'click']) {
          window.addEventListener(type, (event) => { if (event.isTrusted === true) lastInput = Date.now(); }, true);
        }
      }
      const acted = () => {
        try { if (activation) return activation.isActive === true; } catch { return false; }
        return Date.now() - lastInput < 1000;
      };
      replace('open', function open(url?: unknown, name?: unknown) {
        // Reveal.js's notes plugin names its window; that is the speaker
        // view (S key), a documented limit of the player and no problem.
        let speaker = false;
        try { speaker = String(name) === 'reveal.js - Notes'; } catch { /* Another window. */ }
        // A button that opens a website, right after the person's action:
        // offer the address as a link, as for a clicked link. Relative
        // addresses are not resolved.
        let address = '';
        if (!speaker) { try { address = String(url); } catch { address = ''; } }
        if (!speaker && /^https?:\/\/[^\s]+$/i.test(address) && acted()) offerLink(address);
        else limit(speaker ? 'speaker-view' : 'new-window');
        opening = true;
        setTimeout(() => { opening = false; }, 0);
        return null;
      });
      replace('print', function print() { limit('print'); });
      ignoreError = (event: ErrorEvent) => {
        if (!opening) return false;
        try {
          const error = event.error as { name?: unknown } | null | undefined;
          return error instanceof TypeError || error?.name === 'TypeError';
        } catch { return false; }
      };
    }

    // Problems in the strict profile keep the wording that points to the
    // packaging tool; in the tolerant one the host says what was lost.
    const missing = (target: EventTarget | null) => {
      const name = (target as Element | null)?.localName;
      if (name === 'img' || name === 'image' || name === 'input') return 'missing-picture';
      if (name === 'video' || name === 'audio' || name === 'source') return 'missing-media';
      return 'missing-file';
    };
    // A file that the policy blocked also fires an error on its element:
    // that is the same problem. Remember the blocked elements and addresses
    // (bounded), and decide on an element's error a moment later, as the two
    // events come in either order.
    const blockedTargets = new WeakSet<object>();
    // Addresses (and their origins) of link previews that were offered.
    const previewed = new Set<string>();
    const blockedAddresses = new Set<string>();
    const blocked = (event: SecurityPolicyViolationEvent) => {
      try { const target = event.target; if (target && typeof target === 'object' && target !== document) blockedTargets.add(target); } catch { /* Only the address is known. */ }
      let address = '';
      try { address = String(event.blockedURI ?? ''); } catch { address = ''; }
      if (address && address.length <= 4096 && blockedAddresses.size < 500) blockedAddresses.add(address);
      let directive = '';
      try { directive = String(event.effectiveDirective || event.violatedDirective || ''); } catch { directive = ''; }
      const kinds: Record<string, string> = { img: 'picture', font: 'font', style: 'style', script: 'script', media: 'media', connect: 'request', frame: 'page', child: 'page' };
      const kind = Object.prototype.hasOwnProperty.call(kinds, directive.split('-')[0]) ? kinds[directive.split('-')[0]] : 'other';
      let host = '';
      let origin = '';
      try {
        const url = new URL(address);
        if (url.protocol === 'http:' || url.protocol === 'https:') origin = url.origin;
        if (origin && isHost(url.host)) host = url.host;
      } catch { /* Not an address, for example 'inline' or 'eval'. */ }
      // A Reveal.js link preview of a link that was just offered: the notice
      // stands for it, and no page is embedded in a slide.
      if (kind === 'page' && (previewed.has(address) || (origin && previewed.has(origin)))) return;
      limit(`blocked-${kind}`, host);
    };
    const wasBlocked = (target: EventTarget | null) => {
      try {
        if (target && blockedTargets.has(target)) return true;
        const element = target as (Element & { currentSrc?: unknown; src?: unknown }) | null;
        for (const value of [element?.currentSrc, element?.src, element?.getAttribute?.('src'), element?.getAttribute?.('href')]) {
          if (typeof value === 'string' && value && blockedAddresses.has(value)) return true;
        }
      } catch { /* Then it counts as missing. */ }
      return false;
    };
    // The first uncaught error or rejection: if a Reveal.js deck then never
    // starts, this is most likely why (tolerant profile, see below).
    let firstError = '';
    let sawError = false;
    window.addEventListener('error', (event) => {
      if (event instanceof ErrorEvent) {
        if (ignoreError(event)) return;
        let text = describe(event.message);
        // throw '' (or undefined, or null) gives only the browser's prefix.
        if (/^\s*Uncaught(?:\s+(?:undefined|null|''|""))?\s*$/.test(text)) text = '';
        sawError = true;
        if (!firstError && text) firstError = text.slice(0, 350);
        if (text) report(text);
        else if (tolerant) limit('failed-step');
        else report('The presentation encountered an error.');
      } else if (!tolerant) report('A presentation resource could not be loaded. Rebuild the package with all assets included.');
      else {
        const target = (event as Event).target;
        // A <track> without its file (the linker cannot keep caption files)
        // fires an error although its video plays: that is no lost video.
        if ((target as Element | null)?.localName === 'track') return;
        setTimeout(() => { if (!wasBlocked(target)) limit(missing(target)); }, 300);
      }
    }, true);
    window.addEventListener('unhandledrejection', (event) => {
      const text = describe(event.reason);
      sawError = true;
      if (!firstError && text) firstError = text.slice(0, 350);
      if (text) report(text);
      else if (tolerant) limit('failed-step');
      else report('An asynchronous presentation operation failed.');
    });
    document.addEventListener('securitypolicyviolation', (event) => {
      if (tolerant) blocked(event);
      else report(`This presentation requested an unsupported resource (${event.effectiveDirective}). Rebuild it with the portable Slidev packaging tool.`);
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
    // addresses) is passed to the host instead, but only for a trusted
    // click or middle click (not a scripted a.click()), and only when the
    // deck's own handlers did not cancel the click themselves (a link the
    // deck handles itself, such as "show more"): that is known once the
    // event has finished. The host also wants recent user activation in the
    // page and shows only the address, until the person chooses its own
    // button. The deck can still send a link message itself; it can at most
    // put a labelled address on the stage.
    // Tolerant only: clicks that the deck's own code cancelled. The
    // bootstrap's own preventDefault() below does not count.
    const cancelledByDeck = new WeakSet<object>();
    let ownCancel = false;
    if (tolerant) {
      const mark = (event: unknown) => { if (!ownCancel) { try { cancelledByDeck.add(event as object); } catch { /* Not an event. */ } } };
      try {
        const original = Event.prototype.preventDefault;
        if (typeof original === 'function') {
          const preventDefault = function preventDefault(this: Event) { mark(this); return original.call(this); };
          try { Object.defineProperty(preventDefault, 'name', { value: 'preventDefault' }); } catch { /* Keep the name it has. */ }
          Object.defineProperty(Event.prototype, 'preventDefault', { configurable: true, writable: true, value: preventDefault });
        }
      } catch { /* Then every website link is offered, as before. */ }
      // event.returnValue = false cancels too.
      try {
        const descriptor = Object.getOwnPropertyDescriptor(Event.prototype, 'returnValue');
        const get = descriptor?.get;
        const set = descriptor?.set;
        if (descriptor && get && set) {
          Object.defineProperty(Event.prototype, 'returnValue', {
            configurable: true, enumerable: descriptor.enumerable,
            get() { return get.call(this); },
            set(value: unknown) { if (!value) mark(this); set.call(this, value); },
          });
        }
      } catch { /* Then such a link is offered. */ }
      // element.onclick = function () { ...; return false; } cancels the click
      // without calling preventDefault(): wrap the handler as it is assigned.
      // Reading the property still gives the function the deck assigned.
      const owners: unknown[] = [];
      try { owners.push(HTMLElement.prototype, SVGElement.prototype, Document.prototype, window); } catch { /* Fewer owners. */ }
      for (const owner of owners) {
        for (const name of ['onclick', 'onauxclick']) {
          try {
            const descriptor = Object.getOwnPropertyDescriptor(owner, name);
            const get = descriptor?.get;
            const set = descriptor?.set;
            if (!descriptor || !get || !set) continue;
            const assigned = new WeakMap<object, [unknown, unknown]>();
            Object.defineProperty(owner, name, {
              configurable: true, enumerable: descriptor.enumerable,
              get() {
                const value = get.call(this);
                const entry = assigned.get(this);
                return entry && value === entry[1] ? entry[0] : value;
              },
              set(handler: unknown) {
                if (typeof handler !== 'function') { assigned.delete(this); set.call(this, handler); return; }
                const wrapper = function (this: unknown, event: unknown) {
                  const result = (handler as (...values: unknown[]) => unknown).apply(this, arguments as unknown as unknown[]);
                  if (result === false) mark(event);
                  return result;
                };
                assigned.set(this, [handler, wrapper]);
                set.call(this, wrapper);
              },
            });
          } catch { /* Then such a link is offered. */ }
        }
      }
    }
    // Reveal.js link previews (data-preview-link, or previewLinks) cancel the
    // click themselves and cannot load in the player: offer those links.
    const preview = (element: Element) => {
      try {
        if (element.closest('[data-preview-link]:not([data-preview-link="false"])')) return true;
        if (element.closest('[data-preview-link="false"]')) return false;
        const reveal = (window as { Reveal?: { getConfig?: () => { previewLinks?: unknown } } }).Reveal;
        return !!element.closest('.reveal .slides') && typeof reveal?.getConfig === 'function' && reveal.getConfig().previewLinks === true;
      } catch { return false; }
    };
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
      ownCancel = true;
      try { event.preventDefault(); } finally { ownCancel = false; }
      if (!tolerant || event.isTrusted !== true) return;
      if (event.type !== 'click' && !(event.type === 'auxclick' && (event as MouseEvent).button === 1)) return;
      if (!/^https?:\/\/[^\s]+$/i.test(href)) return;
      if (href.length > 2000) { limit('link-too-long'); return; }
      if (links >= 30) return;
      const offered = preview(element);
      if (offered && previewed.size < 60) {
        previewed.add(href);
        try { previewed.add(new URL(href).origin); } catch { /* The address alone. */ }
      }
      setTimeout(() => {
        if (!offered && cancelledByDeck.has(event)) return;
        offerLink(href);
      }, 0);
    };
    window.addEventListener('click', follow, true);
    window.addEventListener('auxclick', follow, true);
    // A form never goes to a server from the player. In the tolerant
    // profile only the browser's own (trusted) submit events are cancelled
    // here, so that the deck's handlers alone decide about the ones below.
    let nativeSubmits = 0;
    document.addEventListener('submit', (event) => {
      if (tolerant) {
        if (event.isTrusted !== true) return;
        nativeSubmits += 1;
      }
      ownCancel = true;
      try { event.preventDefault(); } finally { ownCancel = false; }
    }, true);
    if (tolerant) {
      // The sandbox has no allow-forms: Chromium drops a submission before
      // its submit event, so a quiz's submit handler would never run. Fire
      // the event the browser dropped, as the browser would: validation
      // first, then a cancelable submit event. Nothing is ever sent; when no
      // handler cancels it, the form would have gone to a server: a limit.
      const isSubmitButton = (element: unknown): element is HTMLButtonElement | HTMLInputElement => {
        try {
          if (element instanceof HTMLButtonElement) return element.type === 'submit';
          if (element instanceof HTMLInputElement) return element.type === 'submit' || element.type === 'image';
        } catch { /* Not an element of this document. */ }
        return false;
      };
      const submit = (form: HTMLFormElement, submitter: HTMLButtonElement | HTMLInputElement | null) => {
        try {
          if (!form.isConnected) return;
          if (!form.noValidate && !submitter?.formNoValidate && !form.reportValidity()) return;
          const init = { bubbles: true, cancelable: true, submitter };
          const event = typeof SubmitEvent === 'function' ? new SubmitEvent('submit', init) : new Event('submit', init);
          if (!form.dispatchEvent(event)) return;
          // A dialog form only closes its dialog.
          const method = (submitter?.getAttribute('formmethod') || form.getAttribute('method') || '').trim().toLowerCase();
          const dialog = method === 'dialog' ? form.closest('dialog') : null;
          if (dialog) dialog.close(submitter?.value ?? '');
          else if (method !== 'dialog') limit('form');
        } catch { /* The deck's own handlers report their errors themselves. */ }
      };
      let submitClicks = 0;
      window.addEventListener('click', (event) => {
        if (event.isTrusted !== true) return;
        let button: Element | null = null;
        try {
          const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
          button = ((path[0] ?? event.target) as Element | null)?.closest?.('button,input') ?? null;
        } catch { button = null; }
        if (!isSubmitButton(button) || button.matches(':disabled') || !button.form) return;
        const form = button.form;
        const before = nativeSubmits;
        submitClicks += 1;
        setTimeout(() => { if (!event.defaultPrevented && nativeSubmits === before) submit(form, button as HTMLButtonElement | HTMLInputElement); }, 0);
      }, true);
      // Enter in a single-line field: with a submit button, the browser
      // clicks it (above); without one, implicit submission applies when the
      // form has at most one such field.
      const single = ['text', 'search', 'url', 'tel', 'email', 'password', 'date', 'month', 'week', 'time', 'datetime-local', 'number'];
      window.addEventListener('keypress', (event) => {
        if (event.isTrusted !== true || event.key !== 'Enter' || event.isComposing) return;
        let form: HTMLFormElement | null = null;
        try {
          const field = event.target;
          if (field instanceof HTMLInputElement && single.includes(field.type)) form = field.form;
        } catch { form = null; }
        if (!form) return;
        const before = nativeSubmits;
        const clicks = submitClicks;
        setTimeout(() => {
          if (!form || event.defaultPrevented || nativeSubmits !== before || submitClicks !== clicks) return;
          try {
            const elements = Array.from(form.elements);
            if (elements.some(isSubmitButton)) return;
            if (elements.filter((element) => element instanceof HTMLInputElement && single.includes(element.type)).length > 1) return;
          } catch { return; }
          submit(form, null);
        }, 0);
      }, true);
      // requestSubmit() does nothing in the sandbox either: do the same steps
      // after the browser's own checks of the submitter. submit() never
      // fires an event; it stays as it is, with the limit.
      try {
        const prototype = HTMLFormElement.prototype;
        const request = prototype.requestSubmit;
        if (typeof request === 'function') {
          Object.defineProperty(prototype, 'requestSubmit', {
            configurable: true, writable: true,
            value: function requestSubmit(this: HTMLFormElement, submitter?: HTMLElement | null) {
              const before = nativeSubmits;
              request.apply(this, arguments as unknown as [HTMLElement?]);
              if (nativeSubmits === before) submit(this, isSubmitButton(submitter) ? submitter : null);
            },
          });
        }
        const send = prototype.submit;
        if (typeof send === 'function') {
          Object.defineProperty(prototype, 'submit', {
            configurable: true, writable: true,
            value: function submit(this: HTMLFormElement) { limit('form'); return send.call(this); },
          });
        }
      } catch { /* Keep the browser's behaviour. */ }
    }
    // Tolerant, and only when the host says the deck is a Reveal.js one: a
    // deck whose start-up script stopped with an error before
    // Reveal.initialize shows a blank stage. Two seconds after load, try to
    // start it with the plugins the page defines, and tell the host either
    // way: 'rescued' when the slides then start, 'blank' when not.
    let stalled = false;
    let rescuedSent = false;
    let recovered = false;
    const stall = (detail: 'rescued' | 'blank') => {
      if (stalled) return;
      stalled = true;
      // The host shows the first error beside the problem: send it again as
      // the last warning before the stall (the host keeps the latest one).
      if (detail === 'blank' && firstError) send('warning', firstError);
      if (detail === 'rescued') rescuedSent = true;
      send('stalled', detail);
    };
    // After the rescue, the deck may still call Reveal.initialize itself (a
    // late start, after a timer or its fonts). Reveal.js would refuse a
    // second start; apply the deck's own settings and plugins to the running
    // slides instead, and withdraw the notice.
    type RevealApi = {
      initialize?: unknown; isReady?: unknown; configure?: unknown; registerPlugin?: unknown; hasPlugin?: unknown;
      on?: unknown; off?: unknown; addEventListener?: unknown; removeEventListener?: unknown;
      getIndices?: unknown; getCurrentSlide?: unknown; getRevealElement?: unknown;
    };
    // The deck started late while the rescue's own start had not become
    // ready yet: the check below decides, and stays silent if it does.
    let lateStarted = false;
    const adopt = (reveal: RevealApi) => {
      // 'ready' has already fired (or will) for the rescue's own start, so
      // handlers that the deck registers for it from now on would never run:
      // remember them (at most 50) and call each once after a late start.
      let readyHandlers: unknown[] | undefined = [];
      const record = (name: 'on' | 'addEventListener' | 'off' | 'removeEventListener') => {
        const original = reveal[name];
        if (typeof original !== 'function') return;
        const adding = name === 'on' || name === 'addEventListener';
        const value = function (this: unknown, type?: unknown, handler?: unknown, ...rest: unknown[]) {
          if (type === 'ready' && readyHandlers) {
            if (!adding) readyHandlers = readyHandlers.filter((entry) => entry !== handler);
            else if (handler && readyHandlers.length < 50) readyHandlers.push(handler);
          }
          return (original as (...values: unknown[]) => unknown).call(this, type, handler, ...rest);
        };
        try { Object.defineProperty(reveal, name, { configurable: true, writable: true, value }); } catch { /* Not recorded. */ }
      };
      for (const name of ['on', 'addEventListener', 'off', 'removeEventListener'] as const) record(name);
      const callReady = () => {
        const handlers = readyHandlers ?? [];
        readyHandlers = undefined;
        try { if (typeof reveal.isReady !== 'function' || !reveal.isReady()) return; } catch { return; }
        let event: Event;
        try {
          event = new Event('ready');
          const indices = typeof reveal.getIndices === 'function' ? reveal.getIndices() as { h?: unknown; v?: unknown } : {};
          Object.assign(event, { indexh: indices?.h, indexv: indices?.v, currentSlide: typeof reveal.getCurrentSlide === 'function' ? reveal.getCurrentSlide() : undefined });
        } catch { return; }
        for (const handler of handlers) {
          try {
            if (typeof handler === 'function') handler.call(reveal, event);
            else (handler as { handleEvent?: (event: Event) => unknown }).handleEvent?.(event);
          } catch (error) { report(describe(error) || 'The presentation encountered an error.'); }
        }
      };
      const lateStart = function initialize(options?: unknown) {
        try {
          if (options && typeof options === 'object') {
            const settings: Record<string, unknown> = {};
            for (const key of Object.keys(options)) {
              if (key !== 'plugins' && key !== 'dependencies') settings[key] = (options as Record<string, unknown>)[key];
            }
            try { if (typeof reveal.configure === 'function') reveal.configure(settings); } catch { /* Keep the basic settings. */ }
            const plugins = (options as { plugins?: unknown }).plugins;
            if (Array.isArray(plugins) && typeof reveal.registerPlugin === 'function') {
              for (const plugin of plugins.slice(0, 50)) {
                try {
                  const id = plugin && typeof plugin === 'object' ? (plugin as { id?: unknown }).id : undefined;
                  if (typeof id === 'string' && typeof reveal.hasPlugin === 'function' && reveal.hasPlugin(id)) continue;
                  reveal.registerPlugin(plugin);
                } catch { /* Leave that plugin out. */ }
              }
            }
          }
        } catch { /* Keep the basic settings. */ }
        // After the task that called initialize, so that handlers registered
        // right after the call are included.
        if (readyHandlers) setTimeout(callReady, 0);
        if (rescuedSent && !recovered) { recovered = true; send('stalled', 'recovered'); }
        // Started before the rescue was confirmed: no notice at all, once
        // Reveal.js is ready; until then the check below still decides.
        else if (!stalled) {
          if (revealReady) stalled = true;
          else lateStarted = true;
        }
        return Promise.resolve(reveal);
      };
      try { Object.defineProperty(reveal, 'initialize', { configurable: true, writable: true, value: lateStart }); }
      catch { try { reveal.initialize = lateStart; } catch { /* Then the deck's call is refused, as before. */ } }
      // Reveal.js 4 and later: the global is also the constructor. A late
      // new Reveal(element, options) on the rescued element gives the running
      // slides, whose initialize() is the late start above; another element
      // gets a new deck as usual.
      if (typeof (reveal as unknown) !== 'function') return;
      try {
        const root = typeof reveal.getRevealElement === 'function' ? reveal.getRevealElement() : undefined;
        const Constructor = reveal as unknown as new (...values: unknown[]) => object;
        const wrapped: typeof Constructor = new Proxy(Constructor, {
          construct(target, values, newTarget): object {
            const [element, settings] = values;
            const node = typeof Node === 'function' && element instanceof Node;
            const own = !!root && (element === root || (!node && settings === undefined && document.querySelector('.reveal') === root));
            if (!own) return Reflect.construct(target, values, newTarget === wrapped ? target : newTarget);
            const given = element === root ? settings : element;
            const instance = Object.create(reveal) as Record<string, unknown>;
            instance.initialize = (more?: unknown) => lateStart({ ...(given && typeof given === 'object' ? given : {}), ...(more && typeof more === 'object' ? more : {}) });
            return instance;
          },
        });
        (window as { Reveal?: unknown }).Reveal = wrapped;
      } catch { /* Then a second deck starts on the same element, as before. */ }
    };
    const rescue = () => {
      if (stalled || revealReady || !sawError) return;
      // Reveal.js needs .reveal > .slides; a page that only uses a "reveal"
      // class (scroll animations often do) is no Reveal.js deck.
      try { if (!document.querySelector('.reveal .slides')) return; } catch { return; }
      let reveal: RevealApi | undefined;
      try { reveal = (window as { Reveal?: RevealApi }).Reveal; } catch { reveal = undefined; }
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
          adopt(reveal);
        }
      } catch { started = false; }
      if (!started) { stall('blank'); return; }
      // Say 'rescued' only once Reveal.js reports ready, so the host never
      // promises slides that do not show; nothing if the deck has started
      // itself late by then.
      const settle = () => {
        if (stalled) return;
        if (revealReady && lateStarted) { stalled = true; return; }
        stall(revealReady ? 'rescued' : 'blank');
      };
      if (revealReady) { settle(); return; }
      document.addEventListener('ready', () => { if (revealReady) settle(); });
      setTimeout(settle, 3000);
    };
    window.addEventListener('load', () => {
      // Module scripts finish before load. Two animation frames allow Vue's
      // initial layout and reactive updates to settle before announcing readiness.
      requestAnimationFrame(() => requestAnimationFrame(() => { if (!failed) send('ready'); }));
      if (tolerant && revealCheck === true) setTimeout(rescue, 2000);
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
    const revealCheck = tolerant && options?.startCheck === 'reveal';
    const setup = `(()=>{const __name=(value)=>value;(${presentationBootstrap.toString()})(${JSON.stringify(token)},${tolerant},${revealCheck},${presentationHostName.toString()});})();`.replace(/<\/script/gi, '<\\/script');
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

  /**
   * A limit message from the deck ("code" or "code host"), checked again
   * here, with the player's own sentence for it; undefined for anything else.
   */
  function presentationLimit(detail: unknown): PresentationLimit | undefined {
    if (typeof detail !== 'string' || detail.length > 300) return undefined;
    const match = /^([a-z-]{1,20})(?: (\S{1,259}))?$/.exec(detail);
    if (!match) return undefined;
    const code = match[1] as PresentationLimitCode;
    const host = match[2];
    if (host !== undefined && !presentationHostName(host)) return undefined;
    // What happened, then what to do: "Ask your AI assistant to ...", since
    // the teacher cannot add files to the presentation here.
    const fixed: Partial<Record<PresentationLimitCode, string>> = {
      question: 'The presentation asked a question in a pop-up window. The player cannot show those, so the question got no answer. Ask your AI assistant to put the question on the slide instead.',
      'new-window': 'The presentation tried to open a new window, which the player cannot do. Ask your AI assistant to show that content on a slide instead.',
      'speaker-view': 'The speaker view (S key) is not available in the player.',
      print: "The presentation tried to print, which the player cannot do. To print the slides, open the presentation's HTML file in your web browser (unzip a ZIP first) and print from there.",
      form: `The presentation tried to send a form, and the player sends nothing anywhere. If the quiz still shows its result, nothing is lost. Ask your AI assistant to give the button type="button", or to cancel the form's submission in its script.`,
      'missing-picture': 'A picture could not be shown: its file is missing or damaged. Ask your AI assistant to check that file and include it in the presentation.',
      'missing-media': 'A video or sound could not be played: its file is missing, damaged or in a format this browser cannot play. Ask your AI assistant to check that file and include it in the presentation.',
      'missing-file': 'A file that the presentation uses could not be loaded: it is missing or damaged. Ask your AI assistant to check that file and include it in the presentation.',
      'failed-step': "A step in the presentation's code failed without saying why. If something on the slides does not work, ask your AI assistant to check the presentation's scripts.",
      'link-too-long': 'A link in the presentation is too long to offer here. Ask your AI assistant for a shorter link.',
    };
    // Files from the internet: with the host name where the address had one.
    const remote: Partial<Record<PresentationLimitCode, [string, string]>> = {
      'blocked-picture': [`A picture from ${host} needs the internet, so it is not shown. Ask your AI assistant to put the picture inside the presentation.`,
        'A picture could not be loaded, because the player works offline. Ask your AI assistant to put the picture inside the presentation.'],
      'blocked-font': [`A font from ${host} needs the internet, so the slides use a font installed on this device instead. If the font matters, ask your AI assistant to put it inside the presentation.`,
        'A font could not be loaded, so the slides use a font installed on this device instead. If the font matters, ask your AI assistant to put it inside the presentation.'],
      'blocked-style': [`A stylesheet from ${host} needs the internet, so it is left out and the slides may look different. Ask your AI assistant to put the styles inside the presentation.`,
        'A stylesheet could not be loaded, so the slides may look different. Ask your AI assistant to put the styles inside the presentation.'],
      'blocked-script': [`A script from ${host} needs the internet, so it did not run. Ask your AI assistant to put the script inside the presentation.`,
        'The player stopped some code of the presentation from running (for example eval or an inline event handler). Ask your AI assistant to put all code in ordinary script elements and attach actions with addEventListener.'],
      'blocked-media': [`A video or sound from ${host} needs the internet, so it does not play. Ask your AI assistant to put the video or sound inside the presentation.`,
        'A video or sound could not be loaded, because the player works offline. Ask your AI assistant to put the video or sound inside the presentation.'],
      'blocked-request': [`The presentation tried to load data from ${host}. The player works offline, so the request was stopped. Ask your AI assistant to put the data inside the presentation.`,
        'The presentation tried to load data. The player works offline, so the request was stopped. Ask your AI assistant to put the data inside the presentation.'],
      'blocked-page': [`A page from ${host} is embedded in a slide. The player works offline, so it is not shown. Ask your AI assistant to show a picture or a link instead.`,
        'A page is embedded in a slide. The player works offline, so it is not shown. Ask your AI assistant to show a picture or a link instead.'],
      'blocked-other': [`The presentation tried to load a file from ${host}. The player works offline, so it was not loaded. Ask your AI assistant to put the file inside the presentation.`,
        'The player stopped something that the presentation tried to load or run. Ask your AI assistant to keep everything the slides need inside the presentation.'],
    };
    const pair = Object.prototype.hasOwnProperty.call(remote, code) ? remote[code] : undefined;
    if (pair) return { code, ...(host ? { host } : {}), text: host ? pair[0] : pair[1], counted: true };
    const text = !host && Object.prototype.hasOwnProperty.call(fixed, code) ? fixed[code] : undefined;
    // Information about the player, no fault of the presentation: listed, not counted.
    return text ? { code, text, counted: code !== 'speaker-view' && code !== 'print' } : undefined;
  }

  /**
   * The player's own sentence when the presentation replaced itself with a
   * page at another address (see onLeft); `next` says how to play it again.
   */
  function presentationLeftText(host: string | undefined, next: string): string {
    return `The presentation tried to replace its slides with a page${host ? ` from ${host}` : ''}, so the player stopped it. ${next} Ask your AI assistant to use an ordinary link for that page.`;
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
    let stalled: PresentationStall | undefined;
    let recovered = false;
    let links = 0;
    // Set when the deck left its frame: nothing more of that playback counts.
    let ended = false;
    const limits = new Set<string>();
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
      lastWarning = undefined; stalled = undefined; recovered = false; links = 0; ended = false; limits.clear();
      const requested = startOptions?.position;
      const restore = isPresentationPosition(requested) ? requested : undefined;
      position = restore;
      token = nonce();
      let prepared: string;
      const scriptNonce = options.scriptNonce ?? nonce();
      try {
        prepared = preparePresentationDocument(html, token, scriptNonce, tolerant
          ? { profile: 'tolerant', ...(options.startCheck === 'reveal' ? { startCheck: 'reveal' as const } : {}) } : { profile: 'strict' });
      }
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
      if (message.qftPresentation !== 1 || message.token !== token || ended) return;
      const kind = message.kind;
      const detail: unknown = message.detail;
      if (kind === 'left') {
        // Only the runner sends this (it never relays one from the deck),
        // but check its detail again: a plain host name, or nothing.
        if (typeof detail !== 'string' || (detail !== '' && !presentationHostName(detail))) return;
        ended = true;
        if (timeout !== undefined) window.clearTimeout(timeout);
        timeout = undefined;
        const host = detail || undefined;
        // The runner's own activation: this page still has the Start click's.
        if (tolerant && options.onLeft) options.onLeft({ ...(host ? { host } : {}), active: message.active === true });
        else fail(presentationLeftText(host, 'Choose Start to play it again.'), 'player');
      } else if (kind === 'ready' && state === 'loading') {
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
        if (!tolerant) return;
        if (!stalled && (detail === 'rescued' || detail === 'blank')) { stalled = detail; options.onStalled?.(detail, lastWarning); }
        // Only after 'rescued' in this playback, once: the deck started itself late.
        else if (detail === 'recovered' && stalled === 'rescued' && !recovered) { recovered = true; options.onStalled?.('recovered', undefined); }
      } else if (kind === 'limit') {
        if (tolerant && typeof detail === 'string' && limits.size < 20 && !limits.has(detail)) {
          const limit = presentationLimit(detail);
          if (limit) { limits.add(detail); options.onLimit?.(limit); }
        }
      } else if (kind === 'link') {
        // The deck's bootstrap sends a link only for a trusted click on a
        // link to a website that the deck did not cancel itself. The deck can
        // still forge the message, so this gate is only the person's recent
        // activity in the page (user activation reaches this page from the
        // frame); the host then shows the address and opens it only after
        // the person's own click on its button.
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
    limit: presentationLimit,
    hostName: presentationHostName,
    leftText: presentationLeftText,
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

/**
 * A limit detail ("code" or "code host") as the player checks it, with the
 * player's own sentence; undefined when it is not one of the fixed codes.
 */
export function describePresentationLimit(detail: unknown): PresentationLimit | undefined {
  return presentationRuntimeFactory().limit(detail);
}

/**
 * The strict host check for host names in the player's own sentences: DNS
 * labels of a-z, 0-9 and "-" (1 to 63 characters, no dash at either end),
 * at least two labels or "localhost", at most 253 characters, and an
 * optional port from 1 to 65535.
 */
export function presentationHostName(value: unknown): boolean {
  return presentationRuntimeFactory().hostName(value);
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
/** The export page's own sentence when the deck replaced itself with another page, split where the host goes. */
const EXPORT_LEFT_TEXT = ['The presentation tried to replace its slides with a page', ', so the player stopped it. Choose Start presentation to play it again. Ask your AI assistant to use an ordinary link for that page.'] as const;
const EXPORT_STALL_NEXT = 'Open the presentation in the library of md.qft.org to see the notes from the check, or ask your AI assistant for a corrected version.';

export function exportPresentationHtml(html: string, title: string, options: PresentationExportOptions = {}): string {
  if (typeof html !== 'string' || !html.trim() || html.length > 24 * 1024 * 1024) throw new Error('The presentation HTML must be smaller than 24 MB.');
  const profile: PresentationProfile = options.profile === 'tolerant' ? 'tolerant' : 'strict';
  const startCheck: PresentationStartCheck | undefined = profile === 'tolerant' && options.startCheck === 'reveal' ? 'reveal' : undefined;
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
  const script = `const createPlayer=${presentationRuntimeSource()};const host=document.getElementById('presentation');const status=document.getElementById('status');const start=document.getElementById('start');const stop=document.getElementById('stop');const fullscreen=document.getElementById('fullscreen');const placeholder=document.getElementById('placeholder');const problem=document.getElementById('problem');const stalled=document.getElementById('stalled');const rescued=document.getElementById('rescued');const link=document.getElementById('link');const linkText=document.getElementById('link-text');const linkParts=(()=>{const __name=(value)=>value;return (${linkParts.toString()});})();const leftText=(host)=>${json(EXPORT_LEFT_TEXT[0])}+(host?' from '+host:'')+${json(EXPORT_LEFT_TEXT[1])};let linkUrl;let linkTimer;let rescuedDue=false;let blank=false;const live='Live · use the slide controls or arrow keys';const showNotices=()=>{link.hidden=!linkUrl;rescued.hidden=!!linkUrl||!rescuedDue;};const hideLink=()=>{window.clearTimeout(linkTimer);linkUrl=undefined;showNotices();};const startedLate=()=>{if(!blank)return;blank=false;stalled.hidden=true;status.textContent=live;};document.getElementById('link-open').addEventListener('click',()=>{const url=linkUrl;hideLink();if(url)window.open(url.href,'_blank','noopener,noreferrer');player.focus();});document.getElementById('link-dismiss').addEventListener('click',()=>{hideLink();player.focus();});document.getElementById('rescued-dismiss').addEventListener('click',()=>{rescuedDue=false;showNotices();player.focus();});const player=createPlayer(host,${json(html)},{title:${json(title)},scriptNonce:${json(nonce)},profile:${json(profile)},${startCheck ? `startCheck:${json(startCheck)},` : ''}onState(state){start.textContent=state==='stopped'?'Start presentation':'Restart';stop.disabled=state==='stopped';status.textContent=state==='stopped'?'Ready to present · works offline':state==='loading'?'Opening presentation…':state==='ready'?live:'Presentation needs attention';placeholder.hidden=state==='loading'||state==='ready';if(state!=='error')problem.hidden=true;if(state==='loading'||state==='stopped'){blank=false;stalled.hidden=true;rescuedDue=false;hideLink();}},onStalled(detail,first){if(detail==='recovered'){rescuedDue=false;showNotices();return;}if(detail==='rescued'){rescuedDue=true;showNotices();return;}blank=true;const intro=document.createElement('p');intro.textContent=${json(STALL_BLANK_TEXT)};const lines=[intro];if(first){const line=document.createElement('p');const label=document.createElement('strong');label.textContent='The presentation reported: ';const quote=document.createElement('q');quote.textContent=first;line.append(label,quote);lines.push(line);}const next=document.createElement('p');next.textContent=${json(EXPORT_STALL_NEXT)};lines.push(next);stalled.replaceChildren(...lines);stalled.hidden=false;status.textContent='The slides did not start';},onPosition(){hideLink();startedLate();},onSlides(){startedLate();},onLink(url){if(!player.isRunning())return;const parts=linkParts(url);const strong=document.createElement('strong');strong.textContent=parts.host;linkText.replaceChildren('The presentation links to ',strong,parts.rest,parts.shortened?'':'.');linkUrl=url;window.clearTimeout(linkTimer);linkTimer=window.setTimeout(hideLink,20000);showNotices();},onError(message,origin){problem.replaceChildren();if(origin==='presentation'){const label=document.createElement('strong');label.textContent='The presentation reported: ';const quote=document.createElement('q');quote.textContent=message;problem.append(label,quote);}else problem.textContent=message;problem.hidden=false;},onLeft(left){player.stop();problem.textContent=leftText(left.host);problem.hidden=false;},onEscape(){if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});},onFullscreenRequest(request){void setFullscreen(request==='enter');}});async function setFullscreen(enter){try{if(enter&&!document.fullscreenElement)await document.getElementById('stage').requestFullscreen();else if(!enter&&document.fullscreenElement)await document.exitFullscreen();player.focus();}catch{status.textContent='Fullscreen is unavailable. Use the browser fullscreen command.';}}start.addEventListener('click',()=>player.start());stop.addEventListener('click',()=>player.stop());fullscreen.addEventListener('click',()=>{if(!player.isRunning())player.start();void setFullscreen(!document.fullscreenElement);});window.addEventListener('pagehide',()=>player.destroy(),{once:true});`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; script-src-attr 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; frame-src 'self' blob:; connect-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><meta http-equiv="Content-Security-Policy" content="script-src 'unsafe-inline'; script-src-attr 'none'"><title>${escape(title)}</title><style>:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#f6f4f0;color:#292626;font:14px/1.5 system-ui,sans-serif}header{display:flex;gap:16px;align-items:center;padding:10px 18px;border-bottom:1px solid #e1ddd7;min-height:52px}h1{font-size:15px;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}nav{display:flex;gap:8px;flex-wrap:wrap}button{font:inherit;border:1px solid #d3cdc4;border-radius:6px;background:#fff;padding:7px 12px;cursor:pointer}nav button:first-child{background:#773b49;border-color:#773b49;color:#fff}button:disabled{opacity:.5;cursor:default}button:focus-visible{outline:3px solid #b17683;outline-offset:3px}#stage{position:relative;display:flex;flex-direction:column;height:calc(100dvh - 96px);min-height:240px;background:#fff}#stage:fullscreen{height:100dvh;width:100vw}#presentation{position:relative;flex:1;min-height:0;width:100%}#strips{position:absolute;top:0;left:0;right:0;height:50%;z-index:3;display:flex;flex-direction:column;overflow:hidden;pointer-events:none}.strip{flex:0 1 auto;min-height:0;display:flex;align-items:stretch;gap:6px 14px;padding:7px 14px;background:#f6efdc;color:#4a3a14;border-bottom:1px solid #d6c08f;box-shadow:0 4px 14px #0004;font-size:13px;pointer-events:auto}.strip[hidden]{display:none}.strip p{flex:1 1 auto;min-width:0;min-height:0;max-height:100%;margin:0;overflow-y:auto;overflow-wrap:anywhere;align-self:center}.strip div{flex:none;display:flex;gap:8px;align-items:center;align-self:center}.strip button{padding:4px 10px}.strip button.open{background:#773b49;border-color:#773b49;color:#fff}#stalled{position:absolute;top:16px;left:50%;transform:translateX(-50%);width:min(640px,calc(100% - 32px));max-height:calc(100% - 32px);overflow:auto;z-index:2;margin:0;padding:12px 16px;border:1px solid #cf8796;border-left-width:4px;border-radius:6px;background:#fff0f3;color:#84283d;overflow-wrap:anywhere;box-shadow:0 8px 28px #0003}#stalled[hidden]{display:none}#stalled p{margin:0}#stalled p+p{margin-top:8px}#placeholder{position:absolute;inset:0;display:grid;place-content:center;padding:30px;text-align:center;pointer-events:none}#placeholder[hidden]{display:none}#placeholder>strong{font-size:clamp(22px,4vw,42px);font-weight:600}#problem{max-width:640px;margin:8px auto 0;padding:12px 16px;border:1px solid #cf8796;border-radius:6px;background:#fff0f3;color:#84283d;overflow-wrap:anywhere}#problem[hidden]{display:none}footer{display:flex;flex-wrap:wrap;align-items:center;gap:0 16px;padding:0 18px;min-height:44px;font-size:12px}#status{flex:1 1 240px;margin:0;padding:10px 0}#notices summary{cursor:pointer;padding:10px 0;color:#5d5855}#notices summary:focus-visible{outline:3px solid #b17683;outline-offset:3px}#notices[open]{flex-basis:100%;padding-bottom:18px}#notices .notices{max-height:60vh;overflow:auto;border:1px solid #e1ddd7;border-radius:6px;background:#fff;padding:4px 14px}#notices h2{font-size:13px;margin:14px 0 6px}#notices pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace}@media(max-width:600px){header{flex-wrap:wrap}h1{flex-basis:100%}#stage{height:calc(100dvh - 140px)}.strip{gap:8px;padding:5px 8px;font-size:12px}.strip div{flex-direction:column;align-items:stretch;gap:4px}}</style></head><body><header><h1>${escape(title)}</h1><nav aria-label="Presentation controls"><button id="start">Start presentation</button><button id="stop" disabled>Stop</button><button id="fullscreen">Fullscreen</button></nav></header><main id="stage"><div id="strips"><div class="strip" id="rescued" role="status" hidden><p>${escape(STALL_RESCUED_TEXT)}</p><div><button type="button" id="rescued-dismiss">Dismiss</button></div></div><div class="strip" id="link" role="status" hidden><p id="link-text"></p><div><button type="button" class="open" id="link-open">Open link in a new tab</button><button type="button" id="link-dismiss">Dismiss</button></div></div></div><div id="presentation"></div><div id="stalled" role="alert" hidden></div><div id="placeholder"><strong>${escape(title)}</strong><p>Choose Start presentation to run the interactive slides.</p><p id="problem" role="alert" hidden></p></div></main><footer><p id="status" role="status" aria-live="polite">Ready to present · works offline</p>${noticeSection}</footer><script nonce="${nonce}">${script.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
}
