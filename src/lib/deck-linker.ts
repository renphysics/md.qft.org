import { defaultTreeAdapter, html as parse5Html, parse, serialize, type DefaultTreeAdapterTypes } from 'parse5';
import { decodeText, mimeFromPath } from './deck-archive';
import {
  BUNDLED_VERSIONS, mapLibraryPath, mapLibraryUrl, mapModuleSpecifier, vendorFileKey,
  type LibraryReference, type VendorFile, type VendorLibrary, type VendorProvider,
} from './deck-vendor';
import {
  LINKER_MARKER, dependencyAdapterSource, escapeScriptText, escapeStyleText, handlerScriptSource,
  mathStandInSource, mediaHelperSource, stripSourceMapComment, type DependencyAction, type HandlerSource, type LinkerScript,
} from './deck-linker-runtime';
import { defaultImportBindings, scanModuleImports } from './deck-linker-modules';
import { cleanReportedText } from './presentation-messages';
import { PRESENTATION_LIMITS } from './presentation-package';
import type { DeckDetection, DeckFiles, DeckIssue } from './deck-types';

/**
 * Links a deck into ONE self-contained HTML document that the presentation
 * sandbox plays with no network: scripts and stylesheets inline, assets as
 * data: URIs, Reveal.js and KaTeX from the copies the site bundles, and
 * everything else that would need the internet removed and reported.
 *
 * The deck is only parsed and rewritten as text. Nothing in it is executed
 * or fetched; the output is deterministic, and linking a linked deck again
 * returns it unchanged.
 */

type Node = DefaultTreeAdapterTypes.Node;
type ParentNode = DefaultTreeAdapterTypes.ParentNode;
type ChildNode = DefaultTreeAdapterTypes.ChildNode;
type Element = DefaultTreeAdapterTypes.Element;
type Template = DefaultTreeAdapterTypes.Template;
type Document = DefaultTreeAdapterTypes.Document;
type Attribute = Element['attrs'][number];

const NS = parse5Html.NS;

export interface LinkOptions {
  /** The page to start from; otherwise the detected entry, then index.html. */
  entry?: string;
  /** Largest finished document in UTF-16 code units: the player's 24 MiB limit. */
  maxHtmlLength?: number;
}

export interface LinkStats {
  entry: string;
  /** Deck files inlined as scripts or stylesheets. */
  inlinedFiles: number;
  /** Deck files embedded as data: URIs (each distinct file once). */
  embeddedAssets: number;
  /** Bundled library files used, as "library/path", in first-use order. */
  bundledFiles: string[];
  /** References removed or replaced by a placeholder. */
  removedReferences: number;
  /** Elements whose inline event handlers became listeners. */
  convertedHandlers: number;
  /** Length of the finished HTML in UTF-16 code units, as the player measures it. */
  htmlLength: number;
  /** The largest deck files embedded or left out for their size, largest first. */
  largestAssets: { path: string; bytes: number }[];
}

export interface LinkResult {
  html: string;
  issues: DeckIssue[];
  stats: LinkStats;
}

/** Hosts whose stylesheets only deliver web fonts. */
const FONT_HOSTS = /(?:^|\.)(?:fonts\.googleapis\.com|fonts\.gstatic\.com|use\.typekit\.net|p\.typekit\.net|fonts\.bunny\.net|fonts\.cdnfonts\.com|api\.fontshare\.com|rsms\.me)$/i;
/** Elements that would load another document, which the player's policy forbids. */
const EMBEDDING = new Set(['iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'portal', 'fencedframe']);
/** Attributes the player checks on every element (see preparePresentationDocument). */
const CHECKED_ATTRIBUTES = ['src', 'href', 'xlink:href', 'poster', 'background', 'data'];
/** data: URIs the player accepts in those attributes. */
const ALLOWED_DATA = /^data:(?:image\/|audio\/|video\/|font\/|application\/(?:font-|vnd\.ms-fontobject))/i;
/** Events of <body> and <frameset> handlers that belong to the window. */
const WINDOW_EVENTS = new Set([
  'afterprint', 'beforeprint', 'beforeunload', 'blur', 'error', 'focus', 'hashchange', 'languagechange', 'load',
  'message', 'messageerror', 'offline', 'online', 'pagehide', 'pageshow', 'popstate', 'rejectionhandled', 'resize',
  'scroll', 'storage', 'unhandledrejection', 'unload',
]);
const JAVASCRIPT_TYPES = /^(?:|text\/javascript|application\/javascript|text\/ecmascript|application\/ecmascript|application\/x-javascript|application\/x-ecmascript|text\/x-javascript|text\/x-ecmascript|text\/jscript|text\/livescript|text\/javascript1\.[0-5])$/;
const MAX_DEPTH = 1000;
const MAX_IMPORT_DEPTH = 16;
const NAMED_LARGEST = 5;
const EXTRA_TYPES: Record<string, string> = {
  mov: 'video/quicktime', m4v: 'video/mp4', mpeg: 'video/mpeg', mpg: 'video/mpeg', aac: 'audio/aac', flac: 'audio/flac',
  weba: 'audio/webm', jfif: 'image/jpeg', apng: 'image/apng', jxl: 'image/jxl', tif: 'image/tiff', tiff: 'image/tiff',
};

/** A grey box: what a picture that the deck links from the internet shows instead. */
const PICTURE_PLACEHOLDER = `data:image/svg+xml;base64,${base64(new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180"><rect x="1" y="1" width="318" height="178" rx="8" fill="#f2f1ee" stroke="#8d8a85" stroke-width="2" stroke-dasharray="8 6"/><text x="160" y="96" text-anchor="middle" font-family="system-ui,sans-serif" font-size="16" fill="#3d3b38">Picture not available offline</text></svg>'))}`;

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const dirname = (path: string) => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';

/* ------------------------------------------------------------------ tree */

const qualifiedName = (attribute: Attribute) => attribute.prefix ? `${attribute.prefix}:${attribute.name}` : attribute.name;

function getAttribute(element: Element, name: string): string | undefined {
  return element.attrs.find((attribute) => qualifiedName(attribute) === name)?.value;
}

function hasAttribute(element: Element, name: string): boolean {
  return element.attrs.some((attribute) => qualifiedName(attribute) === name);
}

function setAttribute(element: Element, name: string, value: string): void {
  const existing = element.attrs.find((attribute) => qualifiedName(attribute) === name);
  if (existing) existing.value = value;
  else element.attrs.push({ name, value });
}

function removeAttribute(element: Element, name: string): void {
  element.attrs = element.attrs.filter((attribute) => qualifiedName(attribute) !== name);
}

const isElement = (node: Node): node is Element => 'tagName' in node;
const localName = (element: Element) => element.tagName.toLowerCase();
const isTemplate = (element: Element): element is Template => element.tagName === 'template' && element.namespaceURI === NS.HTML;

function textOf(element: Element): string {
  const parent: ParentNode = isTemplate(element) ? element.content : element;
  return parent.childNodes.map((node) => (node.nodeName === '#text' ? (node as DefaultTreeAdapterTypes.TextNode).value : '')).join('');
}

function setText(element: Element, value: string): void {
  for (const child of [...element.childNodes]) defaultTreeAdapter.detachNode(child);
  if (value) defaultTreeAdapter.insertText(element, value);
}

function createElement(tagName: string, attributes: Record<string, string> = {}, namespace: string = NS.HTML): Element {
  return defaultTreeAdapter.createElement(tagName, namespace as never,
    Object.entries(attributes).map(([name, value]) => ({ name, value })));
}

function scriptElement(code: string, attributes: Record<string, string> = {}, namespace: string = NS.HTML): Element {
  const element = createElement('script', attributes, namespace);
  setText(element, escapeScriptText(code));
  return element;
}

function insertBefore(reference: ChildNode, nodes: ChildNode[]): void {
  const parent = reference.parentNode;
  if (!parent) return;
  for (const node of nodes) defaultTreeAdapter.insertBefore(parent, node, reference);
}

function prepend(parent: Element, node: ChildNode): void {
  const first = parent.childNodes[0];
  if (first) defaultTreeAdapter.insertBefore(parent, node, first);
  else defaultTreeAdapter.appendChild(parent, node);
}

function replaceNode(reference: ChildNode, nodes: ChildNode[]): void {
  insertBefore(reference, nodes);
  defaultTreeAdapter.detachNode(reference);
}

function children(parent: ParentNode): ChildNode[] {
  return isElement(parent as Node) && isTemplate(parent as Element) ? (parent as Template).content.childNodes : parent.childNodes;
}

/** Elements in document order, template contents included, without recursion. */
function elementsOf(root: ParentNode): Element[] {
  const result: Element[] = [];
  const stack: ChildNode[] = [...children(root)].reverse();
  while (stack.length) {
    const node = stack.pop()!;
    if (!isElement(node)) continue;
    result.push(node);
    const nested = children(node);
    for (let index = nested.length - 1; index >= 0; index -= 1) stack.push(nested[index]);
  }
  return result;
}

function treeDepth(root: ParentNode): number {
  let deepest = 0;
  const stack: [ChildNode, number][] = children(root).map((node) => [node, 1]);
  while (stack.length) {
    const [node, depth] = stack.pop()!;
    deepest = Math.max(deepest, depth);
    if (deepest > MAX_DEPTH) return deepest;
    if (isElement(node)) for (const child of children(node)) stack.push([child, depth + 1]);
  }
  return deepest;
}

function isAttached(node: Node): boolean {
  let current: Node | null = node;
  while (current) {
    if (current.nodeName === '#document') return true;
    if (current.nodeName === '#document-fragment') {
      // Template contents: attached when their template is.
      const owner = templateOwners.get(current as DefaultTreeAdapterTypes.DocumentFragment);
      if (!owner) return false;
      current = owner;
      continue;
    }
    current = (current as ChildNode).parentNode;
  }
  return false;
}

const templateOwners = new WeakMap<DefaultTreeAdapterTypes.DocumentFragment, Template>();

function insideTemplate(element: Element): boolean {
  let current: Node | null = element.parentNode;
  while (current) {
    if (current.nodeName === '#document-fragment') return true;
    current = (current as ChildNode).parentNode;
  }
  return false;
}

/* ------------------------------------------------------------- references */

type Target =
  | { kind: 'local'; path: string; suffix: string }
  | { kind: 'missing'; path: string }
  | { kind: 'vendor'; file: VendorFile; reference?: LibraryReference; suffix: string }
  | { kind: 'remote'; url: string; host: string; where: string }
  | { kind: 'data'; value: string }
  | { kind: 'fragment' }
  | { kind: 'other'; value: string };

type Purpose = 'image' | 'media' | 'font' | 'style-asset';

function safeDecode(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

function remoteTarget(value: string): Target {
  try {
    const url = new URL(value.startsWith('//') ? `https:${value}` : value);
    const file = url.pathname.split('/').filter(Boolean).pop() ?? '';
    const where = cleanReportedText(`${url.hostname}${file ? `/${safeDecode(file)}` : ''}`, 120);
    return { kind: 'remote', url: url.href, host: url.hostname.toLowerCase(), where };
  } catch {
    return { kind: 'other', value };
  }
}

/** Sniffs the type of a file whose extension says nothing. */
function sniffType(bytes: Uint8Array): string | undefined {
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  const ascii = (from: number, text: string) => [...text].every((character, index) => bytes[from + index] === character.charCodeAt(0));
  if (starts(0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (ascii(0, 'GIF8')) return 'image/gif';
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp';
  if (ascii(0, 'RIFF') && ascii(8, 'WAVE')) return 'audio/wav';
  if (ascii(4, 'ftypavif')) return 'image/avif';
  if (ascii(4, 'ftyp')) return 'video/mp4';
  if (starts(0x1a, 0x45, 0xdf, 0xa3)) return 'video/webm';
  if (ascii(0, 'OggS')) return 'audio/ogg';
  if (ascii(0, 'ID3') || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return 'audio/mpeg';
  if (ascii(0, 'wOF2')) return 'font/woff2';
  if (ascii(0, 'wOFF')) return 'font/woff';
  if (ascii(0, 'BM')) return 'image/bmp';
  if (starts(0, 0, 1, 0)) return 'image/x-icon';
  const head = new TextDecoder().decode(bytes.subarray(0, 512)).replace(/^\ufeff/, '').trimStart();
  if (/^(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)) return 'image/svg+xml';
  return undefined;
}

function assetType(path: string, bytes: Uint8Array): string {
  const known = mimeFromPath(path);
  if (known !== 'application/octet-stream') return known;
  const extension = /\.([A-Za-z0-9]+)$/.exec(path)?.[1].toLowerCase() ?? '';
  return EXTRA_TYPES[extension] ?? sniffType(bytes) ?? known;
}

function fitsPurpose(type: string, purpose: Purpose): boolean {
  if (purpose === 'image') return type.startsWith('image/');
  if (purpose === 'media') return type.startsWith('video/') || type.startsWith('audio/');
  if (purpose === 'font') return type.startsWith('font/') || type === 'application/vnd.ms-fontobject' || type.startsWith('application/font-');
  return type.startsWith('image/') || type.startsWith('font/') || type === 'application/vnd.ms-fontobject';
}

/** A @font-face src entry's preference: woff2 first. */
function fontRank(format: string, url: string): number {
  const hint = `${format} ${url.replace(/[?#].*$/, '')}`.toLowerCase();
  if (/woff2/.test(hint)) return 0;
  if (/woff/.test(hint)) return 1;
  if (/truetype|opentype|\.ttf\b|\.otf\b/.test(hint)) return 2;
  if (/embedded-opentype|\.eot\b/.test(hint)) return 3;
  return 4;
}

/* --------------------------------------------------------------- CSS text */

function cssUnescape(value: string): string {
  return value.replace(/\\(?:([0-9a-fA-F]{1,6})\s?|(\r\n|[\n\f\r])|([\s\S]))/g, (_match, hex, newline, other) => {
    if (hex) {
      const code = parseInt(hex, 16);
      return code && code <= 0x10ffff ? String.fromCodePoint(code) : '\ufffd';
    }
    return newline ? '' : other;
  });
}

/** Reads a url( token's value starting after "url("; undefined when the token is malformed. */
function readCssUrl(css: string, from: number): { value: string; end: number } | undefined {
  let index = from;
  while (/\s/.test(css[index] ?? '')) index += 1;
  const quote = css[index];
  let value: string;
  if (quote === '"' || quote === "'") {
    let end = index + 1;
    for (; end < css.length && css[end] !== quote; end += 1) {
      if (css[end] === '\\') end += 1;
      else if (css[end] === '\n') return undefined;
    }
    value = css.slice(index + 1, Math.min(end, css.length));
    index = end + 1;
    while (/\s/.test(css[index] ?? '')) index += 1;
    if (index < css.length && css[index] !== ')') return undefined;
  } else {
    let end = index;
    for (; end < css.length && css[end] !== ')'; end += 1) {
      if (css[end] === '\\') end += 1;
      else if (/["'(\s]/.test(css[end])) {
        const rest = css.slice(end).match(/^\s*(?:\)|$)/);
        if (rest) break;
        return undefined;
      }
    }
    value = css.slice(index, Math.min(end, css.length)).trim();
    index = end;
    while (/\s/.test(css[index] ?? '')) index += 1;
  }
  // The end of the stylesheet also closes a url( token.
  return { value: cssUnescape(value), end: Math.min(index + 1, css.length) };
}

/** The end of an at-rule statement (after its semicolon), skipping strings, comments and brackets. */
function statementEnd(css: string, from: number): number {
  let depth = 0;
  for (let index = from; index < css.length; index += 1) {
    const character = css[index];
    if (character === '/' && css[index + 1] === '*') {
      const end = css.indexOf('*/', index + 2);
      index = end < 0 ? css.length : end + 1;
    } else if (character === '"' || character === "'") {
      for (index += 1; index < css.length && css[index] !== character && css[index] !== '\n'; index += 1) {
        if (css[index] === '\\') index += 1;
      }
    } else if (character === '(') depth += 1;
    else if (character === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0 && character === ';') return index + 1;
    else if (depth === 0 && (character === '{' || character === '}')) return index;
  }
  return css.length;
}

/** The block of a @font-face rule: offsets of "{" and just after its "}". */
function blockRange(css: string, from: number): { open: number; end: number } | undefined {
  let index = from;
  while (index < css.length && /\s/.test(css[index])) index += 1;
  if (css[index] !== '{') return undefined;
  const open = index;
  for (index += 1; index < css.length; index += 1) {
    const character = css[index];
    if (character === '/' && css[index + 1] === '*') {
      const end = css.indexOf('*/', index + 2);
      index = end < 0 ? css.length : end + 1;
    } else if (character === '"' || character === "'") {
      for (index += 1; index < css.length && css[index] !== character && css[index] !== '\n'; index += 1) {
        if (css[index] === '\\') index += 1;
      }
    } else if (character === '}') return { open, end: index + 1 };
  }
  return undefined;
}

/** Splits at a separator outside strings, comments and brackets. */
function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '/' && text[index + 1] === '*') {
      const end = text.indexOf('*/', index + 2);
      index = end < 0 ? text.length : end + 1;
    } else if (character === '"' || character === "'") {
      for (index += 1; index < text.length && text[index] !== character; index += 1) if (text[index] === '\\') index += 1;
    } else if (character === '(') depth += 1;
    else if (character === ')') depth = Math.max(0, depth - 1);
    else if (character === separator && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

const CSS_SCAN = String.raw`\/\*[\s\S]*?(?:\*\/|$)|"(?:[^"\\\n]|\\[\s\S])*["\n]?|'(?:[^'\\\n]|\\[\s\S])*['\n]?|(@import)\b|(@font-face)\b|(@namespace)\b|\b(url)\(`;

type CssOrigin = { kind: 'deck'; dir: string } | { kind: 'vendor'; library: VendorLibrary; dir: string };

/* ----------------------------------------------------------------- linker */

class DeckLinker {
  readonly issues: DeckIssue[] = [];
  private readonly issueKeys = new Set<string>();
  private readonly lowerIndex = new Map<string, string | null>();
  private readonly dataUris = new Map<string, string | null>();
  private readonly assetSizes = new Map<string, number>();
  private readonly includedVendor = new Set<string>();
  private readonly bundled: string[] = [];
  private readonly versionNotes = new Set<string>();
  private readonly deferred: ChildNode[] = [];
  private readonly handlerScripts: Element[] = [];
  private readonly importMap = new Map<string, string>();
  private readonly classicTexts: string[] = [];
  private readonly moduleTexts: string[] = [];
  private readonly failedModuleTexts: string[] = [];
  private document!: Document;
  private baseDir: string;
  private embeddedChars = 0;
  private inlinedFiles = 0;
  private removedReferences = 0;
  private convertedHandlers = 0;
  private nextHandlerId = 1;
  private mathInserted = false;
  private katexInDeck = { script: false, autoRender: false, style: false };
  private mhchem = false;
  private embeddedVideo = false;
  private unsupportedModules: string[] = [];

  constructor(
    private readonly files: DeckFiles,
    private readonly vendor: VendorProvider,
    entry: string,
    private readonly detection: DeckDetection,
    private readonly maxLength: number,
  ) {
    this.baseDir = dirname(entry);
    for (const path of files.keys()) {
      const key = path.toLowerCase();
      this.lowerIndex.set(key, this.lowerIndex.has(key) ? null : path);
    }
  }

  /* ---------------------------------------------------------- reporting */

  report(code: string, severity: DeckIssue['severity'], message: string, where?: string): void {
    const key = `${code}\u0000${where ?? message}`;
    if (this.issueKeys.has(key)) return;
    this.issueKeys.add(key);
    this.issues.push({ code, severity, message: cleanReportedText(message, 350), ...(where ? { where: cleanReportedText(where, 200) } : {}) });
  }

  private reportRemote(target: Extract<Target, { kind: 'remote' }>, kind: 'image' | 'media' | 'script' | 'style' | 'font' | 'page' | 'markdown'): void {
    this.removedReferences += 1;
    if (kind === 'font' || (kind === 'style' && FONT_HOSTS.test(target.host))) {
      this.report('external-font', 'info', `Web fonts from ${target.host} need the internet, so they are left out; the slides use fonts installed on this device instead.`, target.host);
    } else if (kind === 'script') {
      this.report('external-library', 'warning', `The script ${target.where} would have to come from the internet, so it is left out. Anything that needs it will not work here.`, target.where);
    } else if (kind === 'style') {
      this.report('external-style', 'warning', `The stylesheet ${target.where} would have to come from the internet, so it is left out.`, target.where);
    } else if (kind === 'image') {
      this.report('external-image', 'warning', `The picture ${target.where} is on the internet rather than in the deck, so it is left out.`, target.where);
    } else if (kind === 'media') {
      this.report('external-media', 'warning', `The video or sound ${target.where} is on the internet rather than in the deck, so it is left out.`, target.where);
    } else if (kind === 'markdown') {
      this.report('external-markdown', 'warning', `The slides in ${target.where} are on the internet rather than in the deck, so they are left out.`, target.where);
    } else {
      this.report('embedded-page', 'warning', `The embedded page from ${target.host} cannot be shown here, so a placeholder takes its place.`, target.host);
    }
  }

  private reportMissing(path: string): void {
    this.removedReferences += 1;
    this.report('missing-file', 'warning', `The deck refers to ${path}, but that file is not in it.`, path);
  }

  private reportOther(value: string): void {
    this.removedReferences += 1;
    const shown = cleanReportedText(value, 80);
    this.report('unsupported-reference', 'warning', `A reference to ${shown} cannot be used here, so it is removed.`, shown);
  }

  private noteBundled(reference: LibraryReference, from: string | undefined): void {
    for (const path of reference.files) {
      const key = vendorFileKey({ library: reference.library, path });
      if (!this.bundled.includes(key)) this.bundled.push(key);
    }
    if (reference.role === 'not-needed' || reference.role === 'reveal-math') return;
    const name = reference.library === 'katex' ? 'KaTeX' : 'Reveal.js';
    const bundled = BUNDLED_VERSIONS[reference.library];
    if (reference.requested === bundled) return;
    const key = `${reference.library}|${reference.host ?? ''}|${reference.requested ?? ''}`;
    if (this.versionNotes.has(key)) return;
    this.versionNotes.add(key);
    const message = reference.host
      ? `${name}${reference.requested && !/^latest$/i.test(reference.requested) ? ` ${reference.requested}` : ''} from ${reference.host} is replaced by the ${name} ${bundled} built into this site.`
      : `The deck uses ${name} files it does not include, such as ${from ?? reference.files[0]}; the ${name} ${bundled} built into this site is used instead.`;
    this.report('bundled-library', 'info', message, reference.host ?? from);
  }

  /* --------------------------------------------------------- references */

  /** Classifies a URL written in the deck, relative to a deck folder. */
  resolve(raw: string, dir: string): Target {
    const value = raw.replace(/[\t\n\r]/g, '').trim();
    if (!value || value.startsWith('#')) return { kind: 'fragment' };
    if (/^data:/i.test(value)) return { kind: 'data', value };
    if (value.startsWith('//') || /^https?:/i.test(value)) return remoteTarget(value);
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return { kind: 'other', value };
    const hash = value.indexOf('#');
    const suffix = hash >= 0 ? value.slice(hash) : '';
    const pathPart = value.replace(/[?#][\s\S]*$/, '').replace(/\\/g, '/');
    const segments = pathPart.startsWith('/') ? [] : dir.split('/').filter(Boolean);
    for (const segment of pathPart.split('/')) {
      if (!segment || segment === '.') continue;
      if (segment === '..') segments.pop();
      else segments.push(safeDecode(segment));
    }
    const path = segments.join('/').normalize('NFC');
    if (!path || pathPart.endsWith('/')) return { kind: 'missing', path: path || pathPart };
    if (this.files.has(path)) return { kind: 'local', path, suffix };
    const folded = this.lowerIndex.get(path.toLowerCase());
    if (folded) return { kind: 'local', path: folded, suffix };
    return { kind: 'missing', path };
  }

  /** Like resolve, inside a bundled library or the deck. */
  private resolveIn(raw: string, origin: CssOrigin): Target {
    if (origin.kind === 'deck') {
      const target = this.resolve(raw, origin.dir);
      if (target.kind === 'missing') {
        const reference = mapLibraryPath(target.path);
        if (reference?.files.length === 1) {
          return { kind: 'vendor', file: { library: reference.library, path: reference.files[0] }, reference, suffix: '' };
        }
      }
      return target;
    }
    const value = raw.replace(/[\t\n\r]/g, '').trim();
    if (!value || value.startsWith('#')) return { kind: 'fragment' };
    if (/^data:/i.test(value)) return { kind: 'data', value };
    if (value.startsWith('//') || /^https?:/i.test(value)) return remoteTarget(value);
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return { kind: 'other', value };
    const segments = origin.dir.split('/').filter(Boolean);
    for (const segment of value.replace(/[?#][\s\S]*$/, '').split('/')) {
      if (!segment || segment === '.') continue;
      if (segment === '..') segments.pop(); else segments.push(segment);
    }
    return { kind: 'vendor', file: { library: origin.library, path: segments.join('/') }, suffix: '' };
  }

  /** A deck file as a data: URI, if it suits the purpose and fits the budget. */
  private async embedLocal(path: string, purpose: Purpose): Promise<string | undefined> {
    const bytes = this.files.get(path);
    if (!bytes) return undefined;
    const type = assetType(path, bytes);
    if (!fitsPurpose(type, purpose)) {
      this.removedReferences += 1;
      this.report('unsupported-asset', 'warning', `The file ${path} is not a picture, video, sound or font that a slide can show, so it is left out.`, path);
      return undefined;
    }
    return this.dataUri(path, bytes, type);
  }

  private dataUri(key: string, bytes: Uint8Array, type: string): string | undefined {
    this.assetSizes.set(key, bytes.length);
    const cached = this.dataUris.get(key);
    if (cached !== undefined) {
      if (cached) this.embeddedChars += cached.length;
      return cached ?? undefined;
    }
    const length = 5 + type.length + 8 + Math.ceil(bytes.length / 3) * 4;
    if (length > this.maxLength || this.embeddedChars + length > this.maxLength * 2) {
      this.dataUris.set(key, null);
      this.removedReferences += 1;
      this.report('asset-too-large', 'warning', `${key} (${formatBytes(bytes.length)}) is too large to include, so it is left out.`, key);
      return undefined;
    }
    const uri = `data:${type};base64,${base64(bytes)}`;
    this.dataUris.set(key, uri);
    this.embeddedChars += uri.length;
    return uri;
  }

  /** A target as a data: URI (local or bundled), with issues for anything else. */
  private async assetFor(target: Target, purpose: Purpose, kind: 'image' | 'media' | 'font' = purpose === 'media' ? 'media' : 'image'): Promise<string | undefined> {
    switch (target.kind) {
      case 'local': {
        const uri = await this.embedLocal(target.path, purpose);
        return uri && uri + target.suffix;
      }
      case 'vendor': {
        const bytes = await this.vendor.bytes(target.file);
        if (!bytes) { this.reportMissing(target.file.path); return undefined; }
        if (target.reference) this.noteBundled(target.reference, target.file.path);
        const key = vendorFileKey(target.file);
        if (!this.bundled.includes(key)) this.bundled.push(key);
        return this.dataUri(key, bytes, assetType(target.file.path, bytes));
      }
      case 'missing': this.reportMissing(target.path); return undefined;
      case 'remote': this.reportRemote(target, kind); return undefined;
      case 'other': this.reportOther(target.value); return undefined;
      default: return undefined;
    }
  }

  /* ---------------------------------------------------------------- CSS */

  async rewriteCss(css: string, origin: CssOrigin, chain: string[] = []): Promise<string> {
    const scan = new RegExp(CSS_SCAN, 'gi');
    let output = '';
    let last = 0;
    for (let match; (match = scan.exec(css));) {
      if (match[1] || match[3]) {
        const end = statementEnd(css, scan.lastIndex);
        const replacement = match[1] ? await this.importRule(css.slice(scan.lastIndex, end), origin, chain) : css.slice(match.index, end);
        output += css.slice(last, match.index) + replacement;
        last = end;
        scan.lastIndex = end;
      } else if (match[2]) {
        const block = blockRange(css, scan.lastIndex);
        if (!block) continue;
        output += css.slice(last, match.index) + await this.fontFace(css.slice(match.index, block.open), css.slice(block.open + 1, block.end - 1), origin);
        last = block.end;
        scan.lastIndex = block.end;
      } else if (match[4]) {
        const token = readCssUrl(css, scan.lastIndex);
        if (!token) {
          // A malformed url( loads nothing in a browser; make sure it never can.
          output += `${css.slice(last, match.index)}x-url(`;
          last = scan.lastIndex;
          continue;
        }
        output += css.slice(last, match.index) + await this.cssUrl(token.value, origin, css.slice(match.index, token.end));
        last = token.end;
        scan.lastIndex = token.end;
      }
    }
    return output + css.slice(last);
  }

  private async cssUrl(value: string, origin: CssOrigin, original: string): Promise<string> {
    const target = this.resolveIn(value, origin);
    if (target.kind === 'fragment' || target.kind === 'data') return original;
    const uri = await this.assetFor(target, 'style-asset', target.kind === 'remote' && FONT_HOSTS.test(target.host) ? 'font' : 'image');
    return uri ? `url("${uri}")` : 'none';
  }

  private async fontFace(prelude: string, body: string, origin: CssOrigin): Promise<string> {
    const declarations = splitTopLevel(body, ';');
    const rewritten: string[] = [];
    for (const declaration of declarations) {
      const colon = declaration.indexOf(':');
      if (colon < 0 || declaration.slice(0, colon).trim().toLowerCase() !== 'src') {
        rewritten.push(await this.rewriteCss(declaration, origin));
        continue;
      }
      const kept: string[] = [];
      let best: { rank: number; target: Target; format: string } | undefined;
      let remote: Extract<Target, { kind: 'remote' }> | undefined;
      let missing: string | undefined;
      for (const item of splitTopLevel(declaration.slice(colon + 1), ',')) {
        const text = item.trim();
        if (/^local\(/i.test(text)) { kept.push(text); continue; }
        const url = /^url\(/i.test(text) ? readCssUrl(text, 4) : undefined;
        if (!url) continue;
        const format = /format\(([^)]*)\)/i.exec(text.slice(url.end))?.[1] ?? '';
        const target = this.resolveIn(url.value, origin);
        let usable = target.kind === 'data' || target.kind === 'local';
        if (target.kind === 'vendor') usable = !!(await this.vendor.bytes(target.file));
        if (target.kind === 'remote') remote ??= target;
        if (target.kind === 'missing') missing ??= target.path;
        if (target.kind === 'vendor' && !usable) missing ??= target.file.path;
        const rank = fontRank(format, url.value);
        if (usable && (!best || rank < best.rank)) best = { rank, target, format };
      }
      if (best) {
        const uri = best.target.kind === 'data' ? best.target.value : await this.assetFor(best.target, 'font', 'font');
        if (uri) kept.push(`url("${uri}")${best.format ? ` format(${best.format.trim()})` : ''}`);
      } else if (remote) this.reportRemote(remote, 'font');
      else if (missing) this.reportMissing(missing);
      if (!kept.length) return '';
      rewritten.push(`${declaration.slice(0, colon + 1)}${kept.join(',')}`);
    }
    return `${prelude}{${rewritten.join(';')}}`;
  }

  private async importRule(prelude: string, origin: CssOrigin, chain: string[]): Promise<string> {
    const match = /^\s*(?:url\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^)\s]*))\s*\)|"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')([\s\S]*?);?\s*$/.exec(prelude);
    if (!match) return '';
    const url = cssUnescape(match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? '');
    let conditions = match[6].trim();
    const wrappers: string[] = [];
    const layer = /^layer(?:\(\s*([\w.-]+)\s*\))?(?=\s|$)/i.exec(conditions);
    if (layer) { wrappers.push(layer[1] ? `@layer ${layer[1]}` : '@layer'); conditions = conditions.slice(layer[0].length).trim(); }
    const supports = /^supports\(/i.exec(conditions);
    if (supports) {
      let depth = 0;
      let end = 0;
      for (let index = 8; index < conditions.length; index += 1) {
        if (conditions[index] === '(') depth += 1;
        else if (conditions[index] === ')' && --depth === 0) { end = index + 1; break; }
      }
      if (!end) return '';
      wrappers.push(`@supports ${conditions.slice(8, end)}`);
      conditions = conditions.slice(end).trim();
    }
    if (conditions) wrappers.push(`@media ${conditions}`);
    const content = await this.importedCss(url, origin, chain);
    if (!content) return '';
    return wrappers.reduceRight((inner, wrapper) => `${wrapper}{${inner}}`, `\n${content}\n`);
  }

  /** Text of an imported or linked stylesheet, rewritten; '' when it cannot be included. */
  private async importedCss(url: string, origin: CssOrigin, chain: string[]): Promise<string> {
    const target = this.resolveIn(url, origin);
    if (target.kind === 'remote') {
      const reference = mapLibraryUrl(target.url);
      if (reference) return this.libraryCss(reference, chain, url);
      this.reportRemote(target, 'style');
      return '';
    }
    if (target.kind === 'vendor') {
      if (target.reference) return this.libraryCss(target.reference, chain, url);
      return this.vendorCss(target.file, chain);
    }
    if (target.kind === 'local') {
      const key = `deck:${target.path}`;
      if (chain.includes(key) || chain.length >= MAX_IMPORT_DEPTH) return '';
      this.inlinedFiles += 1;
      return this.rewriteCss(decodeText(this.files.get(target.path)!, target.path), { kind: 'deck', dir: dirname(target.path) }, [...chain, key]);
    }
    if (target.kind === 'missing') {
      const reference = mapLibraryPath(target.path);
      if (reference) return this.libraryCss(reference, chain, target.path);
      this.reportMissing(target.path);
    } else if (target.kind === 'data') {
      const css = decodeDataText(target.value);
      if (css !== undefined) return this.rewriteCss(css, origin, chain);
    } else if (target.kind === 'other') this.reportOther(target.value);
    return '';
  }

  private async libraryCss(reference: LibraryReference, chain: string[], from: string): Promise<string> {
    if (!['reveal-style', 'reveal-theme', 'highlight-theme', 'katex-style', 'not-needed'].includes(reference.role)) return '';
    this.noteBundled(reference, from);
    const parts: string[] = [];
    for (const path of reference.files) parts.push(await this.vendorCss({ library: reference.library, path }, chain));
    return parts.filter(Boolean).join('\n');
  }

  private async vendorCss(file: VendorFile, chain: string[]): Promise<string> {
    const key = vendorFileKey(file);
    if (chain.includes(key) || this.includedVendor.has(key)) return '';
    const css = await this.vendor.text(file);
    if (css === undefined) { this.reportMissing(file.path); return ''; }
    this.includedVendor.add(key);
    if (!this.bundled.includes(key)) this.bundled.push(key);
    return this.rewriteCss(stripSourceMapComment(css), { kind: 'vendor', library: file.library, dir: dirname(file.path) }, [...chain, key]);
  }

  /* ------------------------------------------------------------ scripts */

  private async vendorScripts(reference: LibraryReference, from: string, attributes: Record<string, string> = {}, note = true): Promise<Element[]> {
    if (note) this.noteBundled(reference, from);
    if (reference.role === 'reveal-math') return this.mathElements();
    const elements: Element[] = [];
    for (const path of reference.files) {
      const file = { library: reference.library, path };
      const key = vendorFileKey(file);
      if (this.includedVendor.has(key)) continue;
      if (!this.bundled.includes(key)) this.bundled.push(key);
      if (path.endsWith('.css')) {
        const css = await this.vendorCss(file, []);
        if (css) elements.push(styleElement(css, { 'data-qft-from': from }));
        continue;
      }
      const code = await this.vendor.text(file);
      if (code === undefined) { this.reportMissing(path); continue; }
      this.includedVendor.add(key);
      elements.push(scriptElement(stripSourceMapComment(code), { ...attributes, 'data-qft-from': cleanReportedText(from, 300) }));
    }
    return elements;
  }

  /** KaTeX (unless the deck brings its own), then the stand-in for Reveal's math plugin, once. */
  private async mathElements(): Promise<Element[]> {
    if (this.mathInserted) return [];
    this.mathInserted = true;
    const elements: Element[] = [];
    const library = 'katex';
    const add = async (role: LibraryReference['role'], path: string) => {
      elements.push(...await this.vendorScripts({ library, role, files: [path] }, `${library}/${path}`, {}, false));
    };
    if (!this.katexInDeck.style) await add('katex-style', 'dist/katex.min.css');
    if (!this.katexInDeck.script) await add('katex', 'dist/katex.min.js');
    if (!this.katexInDeck.autoRender) await add('katex-extension', 'dist/contrib/auto-render.min.js');
    if (this.mhchem) await add('katex-extension', 'dist/contrib/mhchem.min.js');
    elements.push(scriptElement(mathStandInSource(), { [LINKER_MARKER]: 'math' satisfies LinkerScript }));
    return elements;
  }

  /** The deck's own copy of Reveal's math plugin also loads from a CDN, so it is replaced too. */
  private isMathPlugin(path: string): boolean {
    if (mapLibraryPath(path)?.role === 'reveal-math') return true;
    const bytes = this.files.get(path);
    if (!bytes) return false;
    const head = new TextDecoder().decode(bytes.subarray(0, 1200));
    return /\bRevealMath\s*=/.test(head) && /mathjax/i.test(decodeText(bytes, path));
  }

  private async processScript(element: Element): Promise<void> {
    if (getAttribute(element, LINKER_MARKER)) return;
    const typeValue = (getAttribute(element, 'type') ?? '').trim().toLowerCase().replace(/;.*$/, '');
    const isModule = typeValue === 'module';
    const src = getAttribute(element, 'src') ?? getAttribute(element, 'href') ?? getAttribute(element, 'xlink:href');
    if (typeValue === 'importmap' || typeValue === 'speculationrules') { defaultTreeAdapter.detachNode(element); return; }
    if (!isModule && !JAVASCRIPT_TYPES.test(typeValue)) {
      // A data block (templates, JSON): the browser never loads its src.
      for (const name of ['src', 'href', 'xlink:href']) removeAttribute(element, name);
      return;
    }
    if (hasAttribute(element, 'nomodule')) { defaultTreeAdapter.detachNode(element); return; }
    if (isModule) { await this.processModule(element, src); return; }
    if (src === undefined) {
      this.processInlineScript(element);
      return;
    }
    const replacement = await this.classicScript(src, element);
    const deferred = hasAttribute(element, 'defer') && !hasAttribute(element, 'async');
    if (deferred && replacement.length) {
      defaultTreeAdapter.detachNode(element);
      this.deferred.push(...replacement);
    } else replaceNode(element, replacement);
  }

  /** The inline elements that replace a classic script with a src. */
  private async classicScript(src: string, element: Element): Promise<Element[]> {
    const target = this.resolve(src, this.baseDir);
    const attributes: Record<string, string> = {};
    const id = getAttribute(element, 'id');
    if (id) attributes.id = id;
    const namespace = element.namespaceURI;
    switch (target.kind) {
      case 'local': {
        if (this.isMathPlugin(target.path)) return this.mathElements();
        const code = stripSourceMapComment(decodeText(this.files.get(target.path)!, target.path));
        this.inlinedFiles += 1;
        this.classicTexts.push(code);
        return [scriptElement(code, { ...attributes, 'data-qft-from': target.path }, namespace)];
      }
      case 'missing': {
        const reference = mapLibraryPath(target.path);
        if (reference) return this.vendorScripts(reference, target.path, attributes);
        this.reportMissing(target.path);
        return [];
      }
      case 'remote': {
        const reference = mapLibraryUrl(target.url);
        if (reference && !['reveal-style', 'reveal-theme', 'highlight-theme', 'katex-style', 'katex-font'].includes(reference.role)) {
          return this.vendorScripts(reference, target.url, attributes);
        }
        this.reportRemote(target, 'script');
        return [];
      }
      case 'data': {
        const code = decodeDataText(target.value);
        if (code !== undefined) {
          this.classicTexts.push(code);
          return [scriptElement(code, attributes, namespace)];
        }
        this.reportOther('a script written as a data: address');
        return [];
      }
      default:
        if (target.kind === 'other') this.reportOther(target.value);
        return [];
    }
  }

  private processInlineScript(element: Element): void {
    let code = textOf(element);
    // The 3.x template loads a print stylesheet by script; 6.x builds it in.
    if (/css\/print\/pdf\.css/.test(code) && /css\/print\/paper\.css/.test(code) && /createElement\(\s*['"]link['"]\s*\)/.test(code) && code.length < 2000) {
      defaultTreeAdapter.detachNode(element);
      return;
    }
    this.classicTexts.push(code);
    const rewritten = this.rewriteConfigFiles(code);
    if (rewritten !== code) { code = rewritten; setText(element, code); }
  }

  /** parallaxBackgroundImage in a Reveal configuration names a file; embed it. */
  private rewriteConfigFiles(code: string): string {
    return code.replace(/(\bparallaxBackgroundImage\s*:\s*)(['"])([^'"\\\n]*)\2/g, (whole, prefix, quote, value) => {
      if (!value || /^data:/i.test(value)) return whole;
      const target = this.resolve(value, this.baseDir);
      if (target.kind === 'local') {
        const bytes = this.files.get(target.path)!;
        const type = assetType(target.path, bytes);
        const uri = type.startsWith('image/') ? this.dataUri(target.path, bytes, type) : undefined;
        if (uri) return `${prefix}${quote}${uri}${quote}`;
      } else if (target.kind === 'remote') this.reportRemote(target, 'image');
      else if (target.kind === 'missing') this.reportMissing(target.path);
      return `${prefix}${quote}${quote}`;
    });
  }

  /**
   * Reveal.js 3.x loads its plugins through `dependencies` in the call to
   * Reveal.initialize. Inline the listed files before that call and insert an
   * adapter that tells Reveal they are already there.
   */
  private async adaptDependencies(element: Element): Promise<void> {
    if (hasAttribute(element, 'data-qft-dependencies')) return;
    const code = textOf(element);
    const start = code.search(/\bdependencies\s*:\s*\[/);
    if (start < 0 || !/\bReveal\s*\.\s*initialize\b/.test(code)) return;
    const list = code.slice(start, listEnd(code, code.indexOf('[', start)));
    const sources = [...new Set([...list.matchAll(/\bsrc\s*:\s*(['"])((?:\\.|(?!\1)[^\\\n])*)\1/g)].map((match) => match[2]))];
    if (!sources.length) return;
    const actions: Record<string, DependencyAction> = {};
    const elements: Element[] = [];
    for (const src of sources) {
      const target = this.resolve(src, this.baseDir);
      let reference: LibraryReference | undefined;
      if (target.kind === 'local') {
        if (this.isMathPlugin(target.path)) {
          elements.push(...await this.mathElements());
          actions[src] = { plugin: 'RevealMath' };
          continue;
        }
        const source = stripSourceMapComment(decodeText(this.files.get(target.path)!, target.path));
        this.inlinedFiles += 1;
        this.classicTexts.push(source);
        elements.push(scriptElement(source, { 'data-qft-from': target.path }));
        actions[src] = { inlined: true };
        continue;
      }
      if (target.kind === 'missing') reference = mapLibraryPath(target.path);
      else if (target.kind === 'remote') reference = mapLibraryUrl(target.url);
      if (reference && (reference.role === 'reveal-plugin' || reference.role === 'reveal-math')) {
        elements.push(...await this.vendorScripts(reference, src));
        actions[src] = { plugin: reference.global! };
      } else if (reference?.role === 'not-needed') {
        this.noteBundled(reference, src);
        actions[src] = { skip: true };
      } else {
        if (target.kind === 'missing') this.reportMissing(target.path);
        else if (target.kind === 'remote') this.reportRemote(target, 'script');
        else if (target.kind === 'other') this.reportOther(target.value);
        actions[src] = { skip: true };
      }
    }
    elements.push(scriptElement(dependencyAdapterSource(actions), { [LINKER_MARKER]: 'dependencies' satisfies LinkerScript }));
    insertBefore(element, elements);
    setAttribute(element, 'data-qft-dependencies', '');
  }

  /**
   * Module scripts cannot import anything in the player: every import needs
   * a fetch. Imports of Reveal.js and KaTeX become their bundled classic
   * builds and the globals those define. Anything else is reported.
   */
  private async processModule(element: Element, src: string | undefined): Promise<void> {
    let code: string;
    let dir = this.baseDir;
    let where = 'an inline module script';
    if (src !== undefined) {
      const target = this.resolve(src, this.baseDir);
      let reference: LibraryReference | undefined;
      if (target.kind === 'missing') reference = mapLibraryPath(target.path);
      else if (target.kind === 'remote') reference = mapLibraryUrl(target.url);
      else if (target.kind === 'local') reference = mapLibraryPath(target.path);
      if (reference && reference.role !== 'not-needed') {
        replaceNode(element, await this.vendorScripts(reference, src));
        return;
      }
      if (target.kind !== 'local') {
        if (target.kind === 'missing') this.reportMissing(target.path);
        else if (target.kind === 'remote') this.reportRemote(target, 'script');
        else if (target.kind === 'other') this.reportOther(target.value);
        defaultTreeAdapter.detachNode(element);
        return;
      }
      code = stripSourceMapComment(decodeText(this.files.get(target.path)!, target.path));
      dir = dirname(target.path);
      where = target.path;
      this.inlinedFiles += 1;
    } else code = textOf(element);
    this.moduleTexts.push(code);

    const { imports, complete } = scanModuleImports(code);
    if (!imports.length && complete) {
      const rewritten = this.rewriteConfigFiles(code);
      if (src !== undefined || rewritten !== code) {
        replaceNode(element, [scriptElement(rewritten, { type: 'module', ...(src ? { 'data-qft-from': where } : {}) })]);
      }
      return;
    }
    const libraries: LibraryReference[] = [];
    const bindings: string[] = [];
    const unsupported: string[] = [];
    const replacements: { start: number; end: number; text: string }[] = [];
    if (!complete) unsupported.push(where);
    for (const statement of imports) {
      const reference = statement.specifier === undefined ? undefined : this.moduleLibrary(statement.specifier, dir);
      const script = reference && !['reveal-style', 'reveal-theme', 'highlight-theme', 'katex-style', 'katex-font', 'not-needed'].includes(reference.role);
      if (!reference || statement.kind === 'export-from') { unsupported.push(statement.specifier ?? 'a computed import'); continue; }
      if (statement.kind === 'import') {
        const names = script ? defaultImportBindings(statement.clause ?? '') : undefined;
        if (!names || !reference.global) { unsupported.push(statement.specifier!); continue; }
        for (const { local, imported } of names) {
          const value = `globalThis[${JSON.stringify(reference.global)}]`;
          bindings.push(`const ${local} = ${imported === '*' ? `Object.freeze({ __proto__: null, default: ${value} })` : value};`);
        }
        replacements.push({ start: statement.start, end: statement.end, text: '' });
      } else if (statement.kind === 'dynamic') {
        if (!script || !reference.global) { unsupported.push(statement.specifier!); continue; }
        replacements.push({ start: statement.start, end: statement.end, text: `Promise.resolve(Object.freeze({ __proto__: null, default: globalThis[${JSON.stringify(reference.global)}] }))` });
      } else replacements.push({ start: statement.start, end: statement.end, text: '' });
      libraries.push(reference);
    }
    if (unsupported.length) {
      this.unsupportedModules.push(...unsupported);
      this.removedReferences += 1;
      const shown = unsupported.slice(0, 3).join(', ');
      this.failedModuleTexts.push(code);
      this.report('es-modules-unsupported', 'warning', `A module script imports ${shown}, and module imports cannot be played here yet, so that script is left out.`, shown);
      defaultTreeAdapter.detachNode(element);
      return;
    }
    const nodes: ChildNode[] = [];
    for (const reference of libraries) {
      if (['reveal-style', 'reveal-theme', 'highlight-theme', 'katex-style'].includes(reference.role)) {
        const css = await this.libraryCss(reference, [], reference.files[0] ?? '');
        if (css) nodes.push(styleElement(css));
      } else nodes.push(...await this.vendorScripts(reference, reference.files[0] ?? ''));
    }
    let rewritten = code;
    for (const { start, end, text } of replacements.sort((a, b) => b.start - a.start)) {
      rewritten = rewritten.slice(0, start) + text + rewritten.slice(end);
    }
    rewritten = this.rewriteConfigFiles(`${bindings.join('\n')}${bindings.length ? '\n' : ''}${rewritten}`);
    nodes.push(scriptElement(rewritten, { type: 'module', 'data-qft-from': where }));
    replaceNode(element, nodes);
  }

  private moduleLibrary(specifier: string, dir: string): LibraryReference | undefined {
    const mapped = this.importMap.get(specifier) ?? specifier;
    const bare = mapModuleSpecifier(mapped);
    if (bare) return bare;
    if (/^(?:\.{0,2}\/)/.test(mapped)) {
      const target = this.resolve(mapped, dir);
      if (target.kind === 'local' || target.kind === 'missing') {
        const reference = mapLibraryPath(target.path);
        if (reference && reference.role !== 'not-needed') return reference;
      }
    }
    return undefined;
  }

  /* ------------------------------------------------------------- styles */

  private async processLink(element: Element): Promise<void> {
    const rel = (getAttribute(element, 'rel') ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!rel.includes('stylesheet') || rel.includes('alternate') || hasAttribute(element, 'disabled')) {
      defaultTreeAdapter.detachNode(element);
      return;
    }
    const href = getAttribute(element, 'href') ?? '';
    const css = await this.importedCss(href, { kind: 'deck', dir: this.baseDir }, []);
    const attributes: Record<string, string> = { 'data-qft-from': cleanReportedText(href, 300) };
    for (const name of ['id', 'media', 'title']) {
      const value = getAttribute(element, name);
      if (value) attributes[name] = value;
    }
    replaceNode(element, css ? [styleElement(css, attributes)] : []);
  }

  /* --------------------------------------------------------- Markdown */

  /** Pictures and media inside Markdown slides, which become elements only at run time. */
  private async rewriteMarkdown(text: string): Promise<string> {
    let output = text;
    const replaceAsync = async (pattern: RegExp, replace: (match: RegExpExecArray) => Promise<string>) => {
      const parts: string[] = [];
      let last = 0;
      for (let match; (match = pattern.exec(output));) {
        parts.push(output.slice(last, match.index), await replace(match));
        last = match.index + match[0].length;
        if (match[0].length === 0) pattern.lastIndex += 1;
      }
      parts.push(output.slice(last));
      output = parts.join('');
    };
    const picture = async (url: string): Promise<string> => {
      const target = this.resolve(url, this.baseDir);
      if (target.kind === 'fragment' || target.kind === 'data') return url;
      return (await this.assetFor(target, 'image')) ?? PICTURE_PLACEHOLDER;
    };
    // ![alt](url "title")
    await replaceAsync(/(!\[(?:[^\[\]\\\n]|\\.)*\]\(\s*)(<[^<>\n]*>|[^\s()<>]+)((?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^()\n]*\)))?\s*\))/g,
      async (match) => {
        const url = match[2].startsWith('<') ? match[2].slice(1, -1) : match[2];
        return `${match[1]}${await picture(url)}${match[3]}`;
      });
    // [label]: url, for labels that pictures use
    const labels = new Set<string>();
    for (const match of output.matchAll(/!\[([^\]\n]*)\](?:\[([^\]\n]*)\])?/g)) labels.add((match[2] || match[1]).trim().toLowerCase());
    await replaceAsync(/^( {0,3}\[([^\]\n]+)\]:[ \t]*)(<[^<>\n]*>|\S+)/gm, async (match) => {
      if (!labels.has(match[2].trim().toLowerCase())) return match[0];
      const url = match[3].startsWith('<') ? match[3].slice(1, -1) : match[3];
      return `${match[1]}${await picture(url)}`;
    });
    output = output.replace(/<iframe\b[^>]*>(?:[\s\S]*?<\/iframe>)?/gi, (tag) => {
      const src = /\ssrc\s*=\s*(["'])([^"']*)\1/i.exec(tag)?.[2] ?? '';
      this.embeddedPage(this.resolve(src, this.baseDir), src);
      return `<div style="${PLACEHOLDER_STYLE}">${escapeHtml(placeholderText(this.resolve(src, this.baseDir)))}</div>`;
    });
    // HTML inside the Markdown, including <!-- .slide: data-background-image="…" -->
    await replaceAsync(/(\s)(src|poster|data-src|data-background-image|data-background-video|data-background|data-preview-image|data-preview-video|data-background-iframe|data-preview-link)(\s*=\s*)(["'])([^"'<>\n]*)\4/gi,
      async (match) => {
        const name = match[2].toLowerCase();
        const value = match[5];
        if (name === 'data-background-iframe' || name === 'data-preview-link') {
          if (!value || value.startsWith('#')) return match[0];
          this.embeddedPage(this.resolve(value, this.baseDir), value);
          return `${match[1]}${match[2]}${match[3]}${match[4]}${match[4]}`;
        }
        if (name === 'data-background' && !looksLikePicture(value)) return match[0];
        const target = this.resolve(value, this.baseDir);
        if (target.kind === 'fragment' || target.kind === 'data') return match[0];
        const media = name === 'data-background-video' || name === 'data-preview-video';
        if (media) this.embeddedVideo ||= name === 'data-background-video';
        const uri = await this.assetFor(target, media ? 'media' : 'image');
        const replacement = uri ?? (name === 'src' && !media ? PICTURE_PLACEHOLDER : '');
        return `${match[1]}${match[2]}${match[3]}${match[4]}${replacement}${match[4]}`;
      });
    if (/<[a-z][^>]*\son[a-z]+\s*=/i.test(output)) {
      this.report('inline-script-unsupported', 'warning', 'A button or link inside Markdown slides uses an inline script (such as onclick), which does not run here.');
    }
    return output;
  }

  private async processMarkdownSection(section: Element): Promise<void> {
    const source = getAttribute(section, 'data-markdown') ?? '';
    if (source.trim()) {
      const target = this.resolve(source, this.baseDir);
      let text: string;
      if (target.kind === 'local') {
        text = decodeText(this.files.get(target.path)!, target.path);
        this.inlinedFiles += 1;
      } else {
        if (target.kind === 'remote') this.reportRemote(target, 'markdown');
        else if (target.kind === 'missing') this.reportMissing(target.path);
        else this.reportOther(source);
        text = `## Slides not included\n\nThe slides in ${source.replace(/[\\`*_[\]<>#]/g, '')} are not part of this deck.`;
      }
      // Reveal removes the indentation of an inline template's first line from
      // every line; external files never had that, so keep the first line flush.
      text = text.replace(/^(?:[ \t]*\r?\n)+/, '');
      if (/^[ \t]/.test(text)) text = `<!-- -->\n${text}`;
      const template = createElement('textarea', { 'data-template': '' });
      setText(template, await this.rewriteMarkdown(text));
      for (const child of [...section.childNodes]) defaultTreeAdapter.detachNode(child);
      defaultTreeAdapter.appendChild(section, template);
      setAttribute(section, 'data-markdown', '');
      removeAttribute(section, 'data-charset');
      return;
    }
    const template = elementsOf(section).find((element) => hasAttribute(element, 'data-template'))
      ?? elementsOf(section).find((element) => localName(element) === 'script');
    if (!template) return;
    const text = textOf(template);
    const rewritten = await this.rewriteMarkdown(text);
    if (rewritten !== text) setText(template, localName(template) === 'script' ? rewritten.replace(/<\/script/gi, '__SCRIPT_END__') : rewritten);
  }

  /* ------------------------------------------------------------- assets */

  private embeddedPage(target: Target, value: string): void {
    this.removedReferences += 1;
    if (target.kind === 'remote') this.reportRemote(target, 'page');
    else if (target.kind === 'fragment') {
      this.report('embedded-page', 'warning', 'An embedded page cannot be shown inside the slides here, so a placeholder takes its place.');
    } else {
      const shown = cleanReportedText(target.kind === 'local' || target.kind === 'missing' ? target.path : value, 120);
      this.report('embedded-page', 'warning', `The embedded page ${shown} cannot be shown inside the slides here, so a placeholder takes its place.`, shown);
    }
  }

  private async processEmbedding(element: Element): Promise<void> {
    const name = localName(element);
    const value = getAttribute(element, name === 'object' ? 'data' : 'src') ?? getAttribute(element, 'data-src') ?? '';
    const target = this.resolve(value, this.baseDir);
    // A picture shown through <object> or <embed> can become an <img>.
    if ((name === 'object' || name === 'embed') && target.kind === 'local') {
      const bytes = this.files.get(target.path)!;
      const type = assetType(target.path, bytes);
      if (type.startsWith('image/')) {
        const uri = this.dataUri(target.path, bytes, type);
        if (uri) {
          const attributes: Record<string, string> = { src: uri, alt: '' };
          for (const attribute of ['id', 'class', 'style', 'width', 'height', 'title']) {
            const kept = getAttribute(element, attribute);
            if (kept) attributes[attribute] = kept;
          }
          replaceNode(element, [createElement('img', attributes)]);
          return;
        }
      }
    }
    this.embeddedPage(target, value);
    replaceNode(element, [placeholderElement(element, target)]);
  }

  private async processAssets(element: Element): Promise<void> {
    const name = localName(element);
    const svg = element.namespaceURI === NS.SVG;
    const image = async (attribute: string, purpose: Purpose = 'image', placeholder = false) => {
      const value = getAttribute(element, attribute);
      if (value === undefined) return;
      const target = this.resolve(value, this.baseDir);
      if (target.kind === 'fragment' || (target.kind === 'data' && (ALLOWED_DATA.test(target.value) || !CHECKED_ATTRIBUTES.includes(attribute)))) return;
      if (target.kind === 'data') { this.reportOther('an embedded file of an unsupported type'); removeAttribute(element, attribute); return; }
      const uri = await this.assetFor(target, purpose);
      if (uri) setAttribute(element, attribute, uri);
      else if (placeholder) setAttribute(element, attribute, PICTURE_PLACEHOLDER);
      else removeAttribute(element, attribute);
    };
    const mediaPurpose: Purpose = name === 'img' || name === 'input' || name === 'image' ? 'image' : 'media';

    if (!svg && (name === 'img' || (name === 'input' && (getAttribute(element, 'type') ?? '').toLowerCase() === 'image'))) {
      const srcset = getAttribute(element, 'srcset');
      if (srcset !== undefined) {
        removeAttribute(element, 'srcset');
        removeAttribute(element, 'sizes');
        if (getAttribute(element, 'src') === undefined) {
          const candidate = pickSrcset(srcset);
          if (candidate) setAttribute(element, 'src', candidate);
        }
      }
      await image('src', 'image', true);
      await image('data-src', 'image', true);
    } else if (!svg && ['video', 'audio', 'source', 'track'].includes(name)) {
      if (name === 'source' && getAttribute(element, 'srcset') !== undefined && element.parentNode && isElement(element.parentNode as Node)
        && localName(element.parentNode as Element) === 'picture') {
        // The <img> inside <picture> is what plays here.
        defaultTreeAdapter.detachNode(element);
        return;
      }
      if (name === 'track') {
        if (getAttribute(element, 'src')) {
          this.report('captions-left-out', 'info', 'Caption tracks cannot be included, so videos play without captions.');
        }
        removeAttribute(element, 'src');
      } else {
        await image('src', name === 'source' ? sourcePurpose(element) : mediaPurpose);
        await image('data-src', name === 'source' ? sourcePurpose(element) : mediaPurpose);
      }
      await image('poster');
    } else if (svg && (name === 'image' || name === 'feimage')) {
      await image('href', 'image', true);
      await image('xlink:href', 'image', true);
    } else if (svg && name === 'use') {
      await this.processUse(element);
    }

    if (hasAttribute(element, 'data-background-image')) {
      const value = getAttribute(element, 'data-background-image')!;
      // Reveal splits a list of pictures at commas; keep the first.
      if (!/^\s*data:/i.test(value) && value.includes(',')) setAttribute(element, 'data-background-image', value.split(',')[0].trim());
      await image('data-background-image');
    }
    if (hasAttribute(element, 'data-background-video')) {
      const value = getAttribute(element, 'data-background-video')!;
      if (!/^\s*data:/i.test(value) && value.includes(',')) setAttribute(element, 'data-background-video', this.firstPlayable(value));
      await image('data-background-video', 'media');
      if (/^data:/i.test(getAttribute(element, 'data-background-video') ?? '')) this.embeddedVideo = true;
    }
    const background = getAttribute(element, 'data-background');
    if (background !== undefined && looksLikePicture(background)) {
      removeAttribute(element, 'data-background');
      setAttribute(element, 'data-background-image', background);
      await image('data-background-image');
    }
    await image('data-preview-image');
    await image('data-preview-video', 'media');
    for (const attribute of ['data-background-iframe', 'data-preview-link']) {
      const value = getAttribute(element, attribute);
      if (value === undefined) continue;
      // An empty data-preview-link previews the element's own href, which is removed.
      if (value && value.startsWith('#')) continue;
      this.embeddedPage(this.resolve(value || getAttribute(element, 'href') || '', this.baseDir), value || attribute);
      removeAttribute(element, attribute);
      if (attribute === 'data-background-iframe' && localName(element) === 'section') {
        prepend(element, placeholderElement(element, this.resolve(value, this.baseDir), true));
      }
    }
    await image('background');
    const style = getAttribute(element, 'style');
    if (style && /url\(/i.test(style)) setAttribute(element, 'style', await this.rewriteCss(style, { kind: 'deck', dir: this.baseDir }));
  }

  /** Of a comma-separated list of video sources, the first the deck contains. */
  private firstPlayable(list: string): string {
    const sources = list.split(',').map((part) => part.trim()).filter(Boolean);
    return sources.find((source) => this.resolve(source, this.baseDir).kind === 'local') ?? sources[0] ?? '';
  }

  /** <use href="icons.svg#star">: browsers do not load external SVG for <use> from data: URIs; inline the symbol. */
  private async processUse(element: Element): Promise<void> {
    for (const attribute of ['href', 'xlink:href']) {
      const value = getAttribute(element, attribute);
      if (value === undefined || value.trim().startsWith('#')) continue;
      const target = this.resolve(value, this.baseDir);
      const hash = target.kind === 'local' ? target.suffix.slice(1) : '';
      if (target.kind === 'local' && hash && /^[\w:.-]+$/.test(hash)) {
        const sprite = await this.spriteSymbol(target.path, hash);
        if (sprite) { setAttribute(element, attribute, `#${sprite}`); continue; }
      }
      if (target.kind === 'remote') this.reportRemote(target, 'image');
      else if (target.kind === 'missing') this.reportMissing(target.path);
      else if (target.kind === 'local') this.reportMissing(`${target.path}${target.suffix}`);
      else if (target.kind === 'other') this.reportOther(target.value);
      removeAttribute(element, attribute);
    }
  }

  private readonly sprites = new Map<string, string | null>();

  private async spriteSymbol(path: string, id: string): Promise<string | undefined> {
    const key = `${path}#${id}`;
    if (this.sprites.has(key)) return this.sprites.get(key) ?? undefined;
    const sprite = `qft-sprite-${this.sprites.size + 1}`;
    const source = parse(`<svg>${decodeText(this.files.get(path)!, path).replace(/<\?xml[^>]*>|<!DOCTYPE[^>]*>/gi, '')}</svg>`);
    const found = elementsOf(source).find((element) => getAttribute(element, 'id') === id && element.namespaceURI === NS.SVG);
    if (!found) { this.sprites.set(key, null); return undefined; }
    defaultTreeAdapter.detachNode(found);
    setAttribute(found, 'id', sprite);
    const holder = createElement('svg', { width: '0', height: '0', 'aria-hidden': 'true', style: 'position:absolute;width:0;height:0;overflow:hidden' }, NS.SVG);
    const definitions = createElement('defs', {}, NS.SVG);
    defaultTreeAdapter.appendChild(definitions, found);
    defaultTreeAdapter.appendChild(holder, definitions);
    for (const nested of elementsOf(holder)) await this.processAssets(nested);
    prepend(this.body(), holder);
    this.sprites.set(key, sprite);
    return sprite;
  }

  /* ----------------------------------------------------------- handlers */

  private collectHandlers(element: Element): void {
    const attributes = element.attrs.filter((attribute) => !attribute.prefix && /^on[a-z]+$/i.test(attribute.name));
    const href = localName(element) === 'a' || localName(element) === 'area' ? getAttribute(element, 'href') : undefined;
    const script = href !== undefined && /^\s*javascript:/i.test(href) ? safeDecode(href.trim().slice(11)) : undefined;
    if (!attributes.length && script === undefined) return;
    for (const attribute of attributes) removeAttribute(element, attribute.name);
    if (script !== undefined) removeAttribute(element, 'href');
    if (insideTemplate(element)) {
      this.report('inline-script-unsupported', 'warning', 'Some elements inside templates use inline scripts (such as onclick), which do not run here.');
      return;
    }
    const tag = localName(element);
    const windowHandlers: HandlerSource[] = [];
    const handlers: HandlerSource[] = [];
    for (const attribute of attributes) {
      const event = attribute.name.slice(2).toLowerCase();
      const handler = { event, code: attribute.value };
      if ((tag === 'body' || tag === 'frameset') && WINDOW_EVENTS.has(event)) windowHandlers.push(handler);
      else handlers.push(handler);
    }
    if (script !== undefined && !/^\s*(?:void\s*\(?\s*0\s*\)?\s*;?|;)?\s*$/.test(script)) {
      handlers.push({ event: 'click', code: script, prevent: true });
      handlers.push({ event: 'keydown', code: "if (event.key === 'Enter') this.click();" });
      if (!hasAttribute(element, 'tabindex')) setAttribute(element, 'tabindex', '0');
      if (!hasAttribute(element, 'role')) setAttribute(element, 'role', 'button');
    }
    if (windowHandlers.length) this.handlerScripts.push(scriptElement(handlerScriptSource('window', windowHandlers), { [LINKER_MARKER]: 'handlers' satisfies LinkerScript }));
    if (handlers.length) {
      const id = String(this.nextHandlerId++);
      setAttribute(element, 'data-qft-on', id);
      this.handlerScripts.push(scriptElement(handlerScriptSource(`[data-qft-on="${id}"]`, handlers), { [LINKER_MARKER]: 'handlers' satisfies LinkerScript }));
    }
    this.convertedHandlers += 1;
  }

  /* --------------------------------------------------------------- run */

  private body(): Element {
    const html = this.document.childNodes.find((node): node is Element => isElement(node) && localName(node) === 'html')!;
    return html.childNodes.find((node): node is Element => isElement(node) && localName(node) === 'body')!;
  }

  /** Facts about the deck that change how earlier elements are treated. */
  private survey(elements: Element[]): void {
    for (const element of elements) {
      const name = localName(element);
      const handlerId = Number(getAttribute(element, 'data-qft-on'));
      if (Number.isSafeInteger(handlerId) && handlerId >= this.nextHandlerId) this.nextHandlerId = handlerId + 1;
      if (name === 'base' && !insideTemplate(element)) {
        const href = getAttribute(element, 'href');
        if (href !== undefined) {
          const target = this.resolve(href.endsWith('/') ? `${href}x` : href, this.baseDir);
          if (target.kind === 'local' || target.kind === 'missing') this.baseDir = dirname(target.path);
          else this.report('document-base', 'info', 'The page sets a base address on the internet; its files are looked up in the deck instead.');
        }
      }
      if (name === 'script') {
        const type = (getAttribute(element, 'type') ?? '').trim().toLowerCase();
        if (type === 'importmap') {
          try {
            const value = JSON.parse(textOf(element));
            for (const [specifier, url] of Object.entries(value?.imports ?? {})) {
              if (typeof url === 'string') this.importMap.set(specifier, url);
            }
          } catch { /* An unreadable import map maps nothing. */ }
        }
        const src = getAttribute(element, 'src');
        const reference = src === undefined ? undefined : this.libraryOf(src);
        if (reference?.role === 'katex') this.katexInDeck.script = true;
        if (reference?.global === 'renderMathInElement') this.katexInDeck.autoRender = true;
        if (src === undefined && /\bmhchem\b/.test(textOf(element))) this.mhchem = true;
      }
      if (name === 'link' && /stylesheet/i.test(getAttribute(element, 'rel') ?? '')) {
        const href = getAttribute(element, 'href');
        if (href !== undefined && this.libraryOf(href)?.role === 'katex-style') this.katexInDeck.style = true;
      }
    }
  }

  /** The library a script or stylesheet reference names, whether the deck has the file or not. */
  private libraryOf(value: string): LibraryReference | undefined {
    const target = this.resolve(value, this.baseDir);
    if (target.kind === 'remote') return mapLibraryUrl(target.url);
    if (target.kind === 'local') {
      const reference = mapLibraryPath(target.path);
      // A deck's own KaTeX counts only when it is really there.
      return reference;
    }
    if (target.kind === 'missing') return mapLibraryPath(target.path);
    return undefined;
  }

  async link(text: string): Promise<string | undefined> {
    this.document = parse(text);
    if (treeDepth(this.document) > MAX_DEPTH) {
      this.report('deck-unreadable', 'error', 'This page is nested too deeply to prepare for playback.');
      return undefined;
    }
    const elements = elementsOf(this.document);
    for (const element of elements) if (isTemplate(element)) templateOwners.set(element.content, element);
    this.survey(elements);
    for (const element of elements) {
      if (!isAttached(element)) continue;
      const name = localName(element);
      if (name === 'script') { await this.processScript(element); continue; }
      if (name === 'link') { await this.processLink(element); continue; }
      if (name === 'base') { defaultTreeAdapter.detachNode(element); continue; }
      if (name === 'meta' && hasAttribute(element, 'http-equiv')) {
        if ((getAttribute(element, 'http-equiv') ?? '').trim().toLowerCase() === 'refresh') {
          this.report('page-redirect', 'warning', 'The page asks to open another address, which is not possible here, so that instruction is removed.');
        }
        defaultTreeAdapter.detachNode(element);
        continue;
      }
      if (name === 'style') {
        const css = textOf(element);
        const rewritten = await this.rewriteCss(css, { kind: 'deck', dir: this.baseDir });
        if (rewritten !== css) setText(element, element.namespaceURI === NS.HTML ? escapeStyleText(rewritten) : rewritten);
      }
      if (EMBEDDING.has(name) && element.namespaceURI === NS.HTML) { await this.processEmbedding(element); continue; }
      if (name === 'section' && hasAttribute(element, 'data-markdown')) await this.processMarkdownSection(element);
      await this.processAssets(element);
      this.collectHandlers(element);
    }
    // Inline scripts that call Reveal.initialize with a 3.x dependency list.
    for (const element of elementsOf(this.document)) {
      if (localName(element) === 'script' && !getAttribute(element, 'src') && !getAttribute(element, LINKER_MARKER)
        && JAVASCRIPT_TYPES.test((getAttribute(element, 'type') ?? '').trim().toLowerCase())) {
        await this.adaptDependencies(element);
      }
    }
    this.finish();
    return serialize(this.document);
  }

  private finish(): void {
    const body = this.body();
    for (const node of this.deferred) defaultTreeAdapter.appendChild(body, node);
    for (const node of this.handlerScripts) defaultTreeAdapter.appendChild(body, node);
    if (this.embeddedVideo && !elementsOf(this.document).some((element) => getAttribute(element, LINKER_MARKER) === 'media')) {
      prepend(body, scriptElement(mediaHelperSource(), { [LINKER_MARKER]: 'media' satisfies LinkerScript }));
    }
    this.sweep();
    this.mathNote();
    this.moduleNote();
  }

  /** Whatever is still left that the player would refuse is removed and reported. */
  private sweep(): void {
    for (const element of elementsOf(this.document)) {
      const name = localName(element);
      if (insideTemplate(element)) continue;
      if (name === 'script' && (hasAttribute(element, 'src') || hasAttribute(element, 'href') || hasAttribute(element, 'xlink:href'))) {
        for (const attribute of ['src', 'href', 'xlink:href']) removeAttribute(element, attribute);
      }
      for (const attribute of CHECKED_ATTRIBUTES) {
        const value = getAttribute(element, attribute);
        if (value === undefined) continue;
        const trimmed = value.trim();
        if (!trimmed || trimmed.startsWith('#') || ALLOWED_DATA.test(trimmed) || name === 'a' || name === 'area') continue;
        removeAttribute(element, attribute);
        const target = this.resolve(trimmed, this.baseDir);
        if (target.kind === 'remote') this.reportRemote(target, 'image');
        else if (target.kind === 'missing' || target.kind === 'local') this.reportOther(target.path);
        else this.reportOther(trimmed);
      }
    }
  }

  private mathNote(): void {
    if (!this.mathInserted) return;
    const flavour = this.detection.flags.mathPlugin;
    const code = [...this.classicTexts, ...this.moduleTexts].join('\n');
    const mathjax = flavour ? flavour !== 'katex'
      : /\bRevealMath\s*\.\s*MathJax[234]\b|\bRevealMath\s*[,\])]|\bmath\s*:\s*\{|\bmathjax[234]?\s*:/.test(code) || !/\bRevealMath\s*\.\s*KaTeX\b/.test(code);
    if (mathjax) {
      this.report('math-rendered-with-katex', 'info', 'Formulas are typeset with the KaTeX built into this site instead of MathJax. A few MathJax-only commands may show as errors.');
    }
  }

  /** A module that cannot be played is fatal when it is what starts the deck. */
  private moduleNote(): void {
    if (!this.unsupportedModules.length) return;
    const starts = /\bReveal\s*\.\s*initialize\s*\(|\bnew\s+Reveal\s*\(|\.initialize\s*\(/;
    if (this.classicTexts.some((code) => starts.test(code)) || !this.failedModuleTexts.some((code) => starts.test(code))) return;
    for (const issue of this.issues) {
      if (issue.code !== 'es-modules-unsupported') continue;
      issue.severity = 'error';
      issue.message = cleanReportedText(`This deck starts from a module script that imports ${issue.where}, and module imports cannot be played here yet.`, 350);
    }
  }

  stats(entry: string, htmlLength: number): LinkStats {
    return {
      entry,
      inlinedFiles: this.inlinedFiles,
      embeddedAssets: [...this.dataUris.entries()].filter(([key, value]) => value && this.files.has(key)).length,
      bundledFiles: [...this.bundled],
      removedReferences: this.removedReferences,
      convertedHandlers: this.convertedHandlers,
      htmlLength,
      largestAssets: [...this.assetSizes.entries()].filter(([path]) => this.files.has(path))
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, NAMED_LARGEST).map(([path, bytes]) => ({ path, bytes })),
    };
  }
}

/* ---------------------------------------------------------------- helpers */

function styleElement(css: string, attributes: Record<string, string> = {}): Element {
  const element = createElement('style', attributes);
  setText(element, escapeStyleText(css));
  return element;
}

function listEnd(code: string, open: number): number {
  let depth = 0;
  for (let index = open; index < code.length; index += 1) {
    const character = code[index];
    if (character === '"' || character === "'" || character === '`') {
      for (index += 1; index < code.length && code[index] !== character; index += 1) if (code[index] === '\\') index += 1;
    } else if (character === '/' && code[index + 1] === '/') {
      const end = code.indexOf('\n', index);
      index = end < 0 ? code.length : end;
    } else if (character === '/' && code[index + 1] === '*') {
      const end = code.indexOf('*/', index + 2);
      index = end < 0 ? code.length : end + 1;
    } else if (character === '[') depth += 1;
    else if (character === ']' && --depth === 0) return index + 1;
  }
  return code.length;
}

function decodeDataText(value: string): string | undefined {
  const comma = value.indexOf(',');
  if (comma < 0) return undefined;
  const header = value.slice(5, comma);
  const body = value.slice(comma + 1);
  try {
    if (/;base64$/i.test(header)) {
      const binary = atob(body.replace(/\s+/g, ''));
      return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
    }
    return decodeURIComponent(body);
  } catch { return undefined; }
}

function looksLikePicture(value: string): boolean {
  return /^(?:https?:|file:|\/\/)/i.test(value.trim()) || /\.(?:svg|png|jpe?g|gif|bmp|webp|avif)(?:[?#\s]|$)/i.test(value);
}

/** One candidate of a srcset: the 1x one, or the first. */
function pickSrcset(srcset: string): string | undefined {
  const candidates = srcset.split(/,(?=\s|[^,]*(?:\s|$))/).map((part) => part.trim().split(/\s+/)).filter((parts) => parts[0]);
  return (candidates.find((parts) => !parts[1] || parts[1] === '1x') ?? candidates[0])?.[0];
}

function sourcePurpose(element: Element): Purpose {
  const parent = element.parentNode;
  return parent && isElement(parent as Node) && localName(parent as Element) === 'picture' ? 'image' : 'media';
}

const PLACEHOLDER_STYLE = 'display:flex;align-items:center;justify-content:center;box-sizing:border-box;max-width:100%;min-height:4em;padding:1em;border:2px dashed #8d8a85;border-radius:8px;background:#f2f1ee;color:#3d3b38;font:600 0.6em/1.35 system-ui,sans-serif;text-align:center';

function placeholderText(target: Target): string {
  if (target.kind === 'remote') return `An embedded page from ${target.host} is not available offline.`;
  return 'An embedded page is not available here.';
}

function placeholderElement(original: Element, target: Target, inSlide = false): Element {
  const dimension = (name: string) => {
    const value = (getAttribute(original, name) ?? '').trim();
    return /^\d+(?:\.\d+)?$/.test(value) ? `${value}px` : /^\d+(?:\.\d+)?%$/.test(value) ? value : '';
  };
  const width = inSlide ? '' : dimension('width');
  const height = inSlide ? '' : dimension('height');
  const attributes: Record<string, string> = {
    role: 'note',
    'data-qft-placeholder': 'embedded-page',
    style: `${PLACEHOLDER_STYLE}${width ? `;width:${width}` : ''}${height ? `;height:${height}` : ''}`,
  };
  for (const name of ['id', 'class']) {
    const value = getAttribute(original, name);
    if (value && !inSlide) attributes[name] = value;
  }
  const element = createElement('div', attributes);
  defaultTreeAdapter.insertText(element, placeholderText(target));
  return element;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function chooseEntry(files: DeckFiles, detection: DeckDetection, options: LinkOptions): string | undefined {
  for (const candidate of [options.entry, detection.entry]) {
    if (candidate && files.has(candidate) && /\.html?$/i.test(candidate)) return candidate;
  }
  if (files.has('index.html')) return 'index.html';
  if (files.has('index.htm')) return 'index.htm';
  return [...files.keys()].filter((path) => /\.html?$/i.test(path))
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))[0];
}

/**
 * Link a deck into one self-contained HTML document for the presentation
 * player. The result has no external reference in a loading position and no
 * inline event-handler attribute, and passes preparePresentationDocument().
 * Issues with severity 'error' mean the result should not be played.
 */
export async function linkDeck(files: DeckFiles, detection: DeckDetection, vendor: VendorProvider, options: LinkOptions = {}): Promise<LinkResult> {
  const maxLength = options.maxHtmlLength ?? PRESENTATION_LIMITS.htmlBytes;
  const entry = chooseEntry(files, detection, options);
  if (!entry) {
    const empty: LinkStats = {
      entry: '', inlinedFiles: 0, embeddedAssets: 0, bundledFiles: [], removedReferences: 0,
      convertedHandlers: 0, htmlLength: 0, largestAssets: [],
    };
    return { html: '', issues: [{ code: 'entry-missing', severity: 'error', message: 'This deck has no HTML page to start from.' }], stats: empty };
  }
  const linker = new DeckLinker(files, vendor, entry, detection, maxLength);
  const html = await linker.link(decodeText(files.get(entry)!, entry)) ?? '';
  const stats = linker.stats(entry, html.length);
  if (html.length > maxLength) {
    const largest = stats.largestAssets.slice(0, 3).map(({ path, bytes }) => `${path} (${formatBytes(bytes)})`).join(', ');
    linker.report('deck-too-large', 'error',
      `The deck is ${formatBytes(html.length)} once its files are included, more than the ${formatBytes(maxLength)} that can be played here.${largest ? ` The largest files are ${largest}.` : ''}`);
  }
  return { html, issues: linker.issues, stats };
}
