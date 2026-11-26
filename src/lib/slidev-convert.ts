import { defaultTreeAdapter, parse, serialize, type DefaultTreeAdapterTypes } from 'parse5';
import type { BuildOptions, BuildResult, Plugin } from 'esbuild-wasm';
import { decodeText, mimeFromPath } from './deck-archive';
import { escapeScriptText, escapeStyleText, stripSourceMapComment } from './deck-linker-runtime';
import { scanModuleImports, scanStringLiterals } from './deck-linker-modules';
import { cleanReportedText } from './presentation-messages';
import { PRESENTATION_LIMITS } from './presentation-package';
import type { DeckDetection, DeckFiles, DeckIssue } from './deck-types';

/**
 * Turns an ordinary `slidev build` output into ONE self-contained HTML
 * document that the presentation sandbox plays with no network, without
 * rebuilding it. A build cannot run from a ZIP as it is: its scripts are ES
 * modules loaded by URL, its router writes the address, Vite preloads chunks
 * and styles by URL, and some assets are addressed through the base path.
 *
 * The conversion is textual and executes nothing from the deck:
 *  1. remote <link> and <script> elements are dropped, each with a note;
 *  2. Vite's preload helper is switched off (its dependency lists become []);
 *  3. every stylesheet, including code-split ones, is inlined up front, with
 *     url() assets as data: URIs;
 *  4. the router's history is replaced by an in-memory history;
 *  5. new URL(…, import.meta.url) and base-addressed asset strings become
 *     data: URIs;
 *  6. the wake lock API is removed before the app starts;
 *  7. the module graph is bundled into one classic script, keeping the
 *     identity of import() results as ES modules (see wrapDynamicImports).
 * A patch whose pattern is not found is reported, never skipped silently.
 *
 * Bundling is injected (SlidevBundler), so the same core runs in Node tests
 * with the native esbuild and in the browser inside a Worker with
 * esbuild-wasm (src/workers/slidev-convert.worker.ts).
 */

type Element = DefaultTreeAdapterTypes.Element;
type ParentNode = DefaultTreeAdapterTypes.ParentNode;
type ChildNode = DefaultTreeAdapterTypes.ChildNode;
type Attribute = Element['attrs'][number];

/** What the bundler is asked to do: one entry module and the files it may import. */
export interface SlidevBundleRequest {
  /** Deck path of the entry module; a key of `modules`. */
  entry: string;
  /** Deck path to module source, already patched. */
  modules: ReadonlyMap<string, string>;
  /** The deck path an import specifier names, or undefined when it is not part of the build. */
  resolve(specifier: string, importer: string): string | undefined;
}

/** Bundles the module graph into one classic (IIFE) script. Rejects with esbuild's errors. */
export type SlidevBundler = (request: SlidevBundleRequest) => Promise<string>;

/**
 * Steps that take long enough to tell the person about. Their wording is
 * SLIDEV_PROGRESS_TEXT in slidev-convert-browser.ts, so the page needs none
 * of this module to show it.
 */
export type SlidevConvertStep = 'preparing' | 'bundling';

export interface SlidevConvertOptions {
  signal?: AbortSignal;
  onProgress?: (step: SlidevConvertStep) => void;
  /** Largest finished document in UTF-16 code units: the player's 24 MiB limit. */
  maxHtmlLength?: number;
}

export interface SlidevConversionStats {
  /** The folder of the build inside the deck: '' or for example 'dist/'. */
  root: string;
  /** The base path the build was made for: '/', './', '/talk/' and so on. */
  base: string;
  entryModule: string;
  modules: number;
  stylesheets: number;
  /** Distinct deck files embedded as data: URIs. */
  embeddedAssets: number;
  preloadPatched: number;
  routerPatched: number;
  dynamicImports: number;
  /** Length of the finished HTML in UTF-16 code units, as the player measures it. */
  htmlLength: number;
}

export interface SlidevConversion {
  /** '' when the build cannot be played; the issues then hold at least one error. */
  html: string;
  issues: DeckIssue[];
  stats: SlidevConversionStats;
}

export const SLIDEV_CONVERT_LIMITS = Object.freeze({
  /** Scripts beyond this cannot fit in the player's document, whatever bundling saves. */
  scriptBytes: PRESENTATION_LIMITS.htmlBytes,
});

/* ------------------------------------------------------------- patterns */

/**
 * Vite's preload helper reads its dependency lists from this function. With
 * every list empty, the helper loads nothing by URL and just runs the import.
 * The list itself names the code-split stylesheets in load order.
 */
const MAP_DEPS = /__vite__mapDeps\s*=\s*\(\s*i\s*,\s*m\s*=\s*__vite__mapDeps\s*,\s*d\s*=\s*\(\s*m\.f\s*\|\|\s*\(\s*m\.f\s*=\s*\[([^\]]*)\]\s*\)\s*\)\s*\)\s*=>\s*i\.map\(\s*i\s*=>\s*d\[\s*i\s*\]\s*\)/g;
/** Slidev's createRouter({ history: createWebHistory(base), routes }) after minification. */
const ROUTER_HISTORY = /\bhistory\s*:\s*([\w$]{1,40})\(\s*([`'"])([^`'"]{0,400})\2\s*\)\s*,\s*routes\s*:/g;
/** Assets that Vite addresses relative to the module (relative base paths). */
const MODULE_URL = /new URL\(\s*([`'"])([^`'"$]{1,400})\1\s*,\s*import\.meta\.url\s*\)(\.href)?/g;
/** A Worker started from a file of the build (an emitted worker chunk). */
const WORKER_FILE = /new\s+(?:Shared)?Worker\(\s*(?:new\s+URL\(\s*)?[`'"][^`'"]{1,400}[`'"]/;
const WORKER_NAME = /(?:^|\/)[^/]*\.worker-[\w-]{4,}\.m?js$/i;
const MODULE_FILE = /\.m?js$/i;
/** Files embedded where a deck addresses them: pictures, media and fonts the player accepts as data: URIs. */
const ASSET_EXTENSIONS = 'png|jpe?g|jfif|gif|webp|avif|apng|svg|ico|bmp|mp4|m4v|webm|ogv|ogg|oga|mp3|m4a|aac|wav|opus|flac|woff2?|ttf|otf|eot';
const ASSET_FILE = new RegExp(`\\.(?:${ASSET_EXTENSIONS})$`, 'i');
const ASSET_MENTION = new RegExp(`\\.(?:${ASSET_EXTENSIONS})\\b`, 'i');
const ALLOWED_DATA = /^(?:image|audio|video|font)\/|^application\/vnd\.ms-fontobject$/;
const FONT_HOSTS = /(?:^|\.)(?:fonts\.googleapis\.com|fonts\.gstatic\.com|use\.typekit\.net|p\.typekit\.net|fonts\.bunny\.net|fonts\.cdnfonts\.com|api\.fontshare\.com|rsms\.me)$/i;
const JAVASCRIPT_TYPES = /^(?:|text\/javascript|application\/javascript|text\/ecmascript|application\/ecmascript)$/i;
const NAMED = 3;

/**
 * A vue-router RouterHistory kept in memory, as createMemoryHistory does: the
 * frame's address never changes, which an opaque sandboxed document requires.
 * Links get "#/…" addresses, so a click that is not intercepted stays put.
 */
const MEMORY_HISTORY = 'function(base){var queue=[["",{}]],position=0,listeners=[];'
  + 'function set(location,state){position++;if(position!==queue.length)queue.splice(position);queue.push([location,state||{}])}'
  + 'var history={base:String(base||"").replace(/\\/$/,""),createHref:function(location){return"#"+location},'
  + 'replace:function(to,state){queue.splice(position--,1);set(to,state)},push:function(to,state){set(to,state)},'
  + 'listen:function(callback){listeners.push(callback);return function(){var index=listeners.indexOf(callback);if(index>-1)listeners.splice(index,1)}},'
  + 'destroy:function(){listeners=[];queue=[["",{}]];position=0},'
  + 'go:function(delta,trigger){var from=this.location,direction=delta<0?"back":"forward";position=Math.max(0,Math.min(position+delta,queue.length-1));'
  + 'if(trigger!==false)for(var copy=listeners.slice(),index=0;index<copy.length;index++)copy[index](this.location,from,{direction:direction,delta:delta,type:"pop"})}};'
  + 'Object.defineProperty(history,"location",{enumerable:true,get:function(){return queue[position][0]}});'
  + 'Object.defineProperty(history,"state",{enumerable:true,get:function(){return queue[position][1]}});return history}';

/** Runs before the app: without the API, Slidev does not ask for a wake lock the frame may not have. */
const PRELUDE = '(function(){try{delete Navigator.prototype.wakeLock}catch(error){}})();';

/**
 * esbuild turns import() of a bundled module into a plain namespace object.
 * Vue's async components and vue-router's lazy routes unwrap `default` only
 * from objects tagged as modules; without the tag every slide renders empty.
 */
const MODULE_TAG = ').then(function(m){try{if(m&&m[Symbol.toStringTag]!=="Module")Object.defineProperty(m,Symbol.toStringTag,{value:"Module"})}catch(e){}return m})';

/* ---------------------------------------------------------------- paths */

const dirname = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
const shown = (value: string, limit = 160) => cleanReportedText(value, limit);
const isRemote = (url: string) => /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(url);

function hostOf(url: string): string {
  try { return new URL(url.startsWith('//') ? `https:${url}` : url).host; } catch { return ''; }
}

/** Join a relative path to a folder; undefined when it climbs above the deck. */
function joinPath(folder: string, relative: string): string | undefined {
  const parts = folder ? folder.split('/') : [];
  for (const part of relative.split('/')) {
    if (part === '..') { if (!parts.length) return undefined; parts.pop(); }
    else if (part && part !== '.') parts.push(part);
  }
  return parts.join('/');
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttribute = (value: string) => escapeHtml(value).replace(/"/g, '&quot;');

/* ----------------------------------------------------------------- tree */

const isElement = (node: ChildNode | ParentNode): node is Element => 'tagName' in node;
const attribute = (element: Element, name: string) => element.attrs.find((item) => item.name === name)?.value;

function textOf(element: Element): string {
  return element.childNodes.map((node) => (node.nodeName === '#text' ? (node as DefaultTreeAdapterTypes.TextNode).value : '')).join('');
}

function serializeAttributes(attributes: readonly Attribute[], keep: RegExp): string {
  return attributes.filter((item) => !item.prefix && keep.test(item.name))
    .map((item) => ` ${item.name}="${escapeAttribute(item.value)}"`).join('');
}

/* ----------------------------------------------------------- conversion */

class Conversion {
  readonly issues: DeckIssue[] = [];
  private readonly seen = new Set<string>();
  private readonly dataUris = new Map<string, string>();
  readonly root: string;
  base = './';
  private readonly ownFiles: string[];

  constructor(private readonly files: DeckFiles, readonly entry: string) {
    this.root = entry.includes('/') ? entry.slice(0, entry.lastIndexOf('/') + 1) : '';
    this.ownFiles = [...files.keys()].filter((path) => path.startsWith(this.root)).sort();
  }

  report(code: string, severity: DeckIssue['severity'], message: string, where?: string): void {
    const key = `${code}\u0000${where ?? message}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.issues.push({ code, severity, message, ...(where ? { where: shown(where, 200) } : {}) });
  }

  get paths(): readonly string[] { return this.ownFiles; }

  text(path: string): string | undefined {
    const bytes = this.files.get(path);
    return bytes ? decodeText(bytes, path) : undefined;
  }

  bytes(path: string): Uint8Array | undefined { return this.files.get(path); }

  /**
   * The deck path a URL in the build names: paths under the base path,
   * root-relative paths and relative paths all resolve inside the build's
   * folder. Undefined for remote URLs and paths that leave the build.
   */
  locate(url: string, fromFolder: string): string | undefined {
    if (!url || isRemote(url) || url.startsWith('#')) return undefined;
    let path = url.split(/[?#]/, 1)[0];
    try { path = decodeURIComponent(path); } catch { /* Keep it as written. */ }
    let resolved: string | undefined;
    if (this.base.startsWith('/') && this.base !== '/' && path.startsWith(this.base)) resolved = joinPath(this.root.replace(/\/$/, ''), path.slice(this.base.length));
    else if (path.startsWith('/')) resolved = joinPath(this.root.replace(/\/$/, ''), path.slice(1));
    else resolved = joinPath(fromFolder, path);
    return resolved !== undefined && resolved.startsWith(this.root) ? resolved : undefined;
  }

  /** A data: URI for a picture, media or font file of the build, made once per file. */
  dataUri(path: string): string | undefined {
    const cached = this.dataUris.get(path);
    if (cached) return cached;
    const bytes = this.files.get(path);
    const type = mimeFromPath(path);
    if (!bytes || !ALLOWED_DATA.test(type)) return undefined;
    const uri = `data:${type};base64,${base64(bytes)}`;
    this.dataUris.set(path, uri);
    return uri;
  }

  get embeddedAssets(): number { return this.dataUris.size; }
}

interface PageParts {
  title: string;
  htmlAttributes: string;
  bodyAttributes: string;
  body: string;
  entryModule?: string;
  stylesheets: { path?: string; css: string; from: string }[];
  inlineScripts: string[];
}

function readPage(conversion: Conversion): PageParts {
  const tree = parse(conversion.text(conversion.entry) ?? '');
  const html = tree.childNodes.find((node): node is Element => isElement(node) && node.tagName === 'html');
  const parts: PageParts = { title: '', htmlAttributes: '', bodyAttributes: '', body: '', stylesheets: [], inlineScripts: [] };
  if (!html) return parts;
  const keep = /^(?:lang|dir|class|style|translate|data-[a-z0-9_.-]+)$/i;
  parts.htmlAttributes = serializeAttributes(html.attrs, keep);
  const folder = dirname(conversion.entry);
  const bodyNodes: ChildNode[] = [];

  const visit = (parent: ParentNode, inBody: boolean) => {
    for (const node of [...parent.childNodes]) {
      if (!isElement(node)) { if (inBody) bodyNodes.push(node); continue; }
      const name = node.tagName;
      if (name === 'head') { visit(node, false); continue; }
      if (name === 'body') { parts.bodyAttributes = serializeAttributes(node.attrs, keep); visit(node, true); continue; }
      if (name === 'title') { parts.title ||= cleanReportedText(textOf(node), 200); continue; }
      if (name === 'meta' || name === 'base' || name === 'noscript') continue;
      if (name === 'link') { readLink(conversion, node, folder, parts); continue; }
      if (name === 'style') { parts.stylesheets.push({ css: textOf(node), from: conversion.entry }); continue; }
      if (name === 'script') { readScript(conversion, node, folder, parts); continue; }
      if (inBody) { bodyNodes.push(node); continue; }
      // Anything else in the head (rare after a build) is moved to the body as the browser would show it.
      bodyNodes.push(node);
    }
  };
  visit(html, false);
  for (const node of bodyNodes) {
    if (isElement(node)) embedElementUrls(conversion, node, folder);
  }
  const wrapper = defaultTreeAdapter.createElement('div', html.namespaceURI, []);
  for (const node of bodyNodes) { defaultTreeAdapter.detachNode(node); defaultTreeAdapter.appendChild(wrapper, node); }
  parts.body = serialize(wrapper);
  return parts;
}

function readLink(conversion: Conversion, link: Element, folder: string, parts: PageParts): void {
  const href = (attribute(link, 'href') ?? '').trim();
  const rel = (attribute(link, 'rel') ?? '').toLowerCase().split(/\s+/);
  if (!href) return;
  if (/^data:/i.test(href)) {
    // An icon written into the page is not needed; a stylesheet written into a link is too unusual to read.
    if (rel.includes('stylesheet')) conversion.report('external-stylesheet', 'warning', 'A stylesheet written into a link in index.html was left out. The slides may look different.', conversion.entry);
    return;
  }
  if (isRemote(href)) {
    const host = hostOf(href) || 'another site';
    if (rel.includes('stylesheet') && FONT_HOSTS.test(host)) {
      conversion.report('external-font', 'info', `Web fonts from ${host} are not available while the deck plays, so system fonts are used instead.`, href);
    } else if (rel.includes('stylesheet')) {
      conversion.report('external-stylesheet', 'warning', `A stylesheet from ${host} was left out, because the player works without the internet. The slides may look different.`, href);
    } else if (rel.includes('icon') || rel.includes('apple-touch-icon')) {
      conversion.report('external-icon', 'info', `The page icon from ${host} was left out. It is not needed to play the slides.`, href);
    } else if (rel.includes('preload') && (attribute(link, 'as') ?? '') === 'image') {
      conversion.report('external-image', 'warning', `A picture from ${host} was left out, because the player works without the internet. Put the picture in the presentation's public folder and build again to show it.`, href);
    } else {
      conversion.report('external-link', 'info', `A link to ${host} was left out, because the player works without the internet.`, href);
    }
    return;
  }
  if (!rel.includes('stylesheet')) return; // modulepreload, icons and the like: the inlined document needs none.
  const path = conversion.locate(href, folder);
  const css = path === undefined ? undefined : conversion.text(path);
  if (path === undefined || css === undefined) {
    conversion.report('missing-file', 'warning', `The stylesheet ${shown(href)} is not in the ZIP, so some slides may look unstyled.`, href);
    return;
  }
  parts.stylesheets.push({ path, css, from: path });
}

function readScript(conversion: Conversion, script: Element, folder: string, parts: PageParts): void {
  const src = (attribute(script, 'src') ?? '').trim();
  const type = (attribute(script, 'type') ?? '').trim().toLowerCase();
  const module = type === 'module';
  if (!module && !JAVASCRIPT_TYPES.test(type)) return; // Data blocks such as JSON-LD do nothing in a presentation.
  if (src && isRemote(src)) {
    const host = hostOf(src) || 'another site';
    conversion.report('external-script', 'warning', `A script from ${host} was left out, because the player works without the internet. Anything that needs it, such as an embedded post, will not work.`, src);
    return;
  }
  if (src) {
    const path = conversion.locate(src, folder);
    if (module && !parts.entryModule && path !== undefined && conversion.bytes(path)) { parts.entryModule = path; return; }
    conversion.report('script-left-out', 'warning', `The script ${shown(src)} was left out: a Slidev build starts from one module script, and this one is extra or missing.`, src);
    return;
  }
  const code = textOf(script);
  if (!code.trim()) return;
  if (module) {
    conversion.report('script-left-out', 'warning', 'An inline module script in index.html was left out: a Slidev build starts from one module script.', conversion.entry);
    return;
  }
  parts.inlineScripts.push(code);
}

/** Pictures and media written directly in the page's markup become data: URIs. */
function embedElementUrls(conversion: Conversion, element: Element, folder: string): void {
  for (const item of [...element.attrs]) {
    const name = item.prefix ? `${item.prefix}:${item.name}` : item.name;
    const addressed = ['src', 'poster', 'background', 'data', 'xlink:href'].includes(name) || (name === 'href' && element.tagName !== 'a' && element.tagName !== 'area');
    if (!addressed || !item.value.trim() || item.value.trim().startsWith('#') || /^data:/i.test(item.value.trim())) continue;
    const path = conversion.locate(item.value.trim(), folder);
    const uri = path === undefined ? undefined : conversion.dataUri(path);
    if (uri) item.value = uri;
    else {
      element.attrs = element.attrs.filter((other) => other !== item);
      conversion.report('missing-file', 'warning', `${shown(item.value.trim())} could not be included, so it will not show.`, item.value.trim());
    }
  }
  for (const child of element.childNodes) if (isElement(child)) embedElementUrls(conversion, child, folder);
  if (element.tagName === 'template') {
    const content = (element as DefaultTreeAdapterTypes.Template).content;
    for (const child of content.childNodes) if (isElement(child)) embedElementUrls(conversion, child, folder);
  }
}

/* ------------------------------------------------------------------ CSS */

/** Split a declaration value at commas outside brackets and quotes. */
function splitList(value: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) { if (character === '\\') index += 1; else if (character === quote) quote = ''; continue; }
    if (character === '"' || character === "'") quote = character;
    else if (character === '(') depth += 1;
    else if (character === ')') depth = Math.max(0, depth - 1);
    else if (character === ',' && depth === 0) { items.push(value.slice(start, index)); start = index + 1; }
  }
  items.push(value.slice(start));
  return items;
}

const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"']*?))\s*\)/gi;

class StyleSheets {
  private readonly remoteHosts = new Set<string>();
  private readonly missing = new Set<string>();

  constructor(private readonly conversion: Conversion) {}

  /** One stylesheet with its imports inlined and every url() embedded or removed. */
  process(css: string, path: string, depth = 0): string {
    const folder = dirname(path);
    let text = stripSourceMapComment(css).replace(/\/\*[#@]\s*sourceMappingURL=[^*]*\*\//g, '');
    text = text.replace(/@import\s+(?:url\(\s*)?(["']?)([^"')\s;]+)\1\s*\)?([^;]*);/gi, (_rule, _quote: string, url: string) => {
      if (isRemote(url)) {
        const host = hostOf(url) || 'another site';
        if (FONT_HOSTS.test(host)) this.conversion.report('external-font', 'info', `Web fonts from ${host} are not available while the deck plays, so system fonts are used instead.`, url);
        else this.conversion.report('external-stylesheet', 'warning', `A stylesheet from ${host} was left out, because the player works without the internet. The slides may look different.`, url);
        return '';
      }
      const target = this.conversion.locate(url, folder);
      const imported = target === undefined ? undefined : this.conversion.text(target);
      if (target === undefined || imported === undefined || depth >= 4) { this.missing.add(url); return ''; }
      return this.process(imported, target, depth + 1);
    });
    text = text.replace(/@font-face\s*\{[^}]*\}/gi, (block) => this.preferWoff2(block, folder));
    return text.replace(CSS_URL, (whole, double?: string, single?: string, bare?: string) => {
      const url = (double ?? single ?? bare ?? '').trim();
      if (!url || /^data:/i.test(url) || url.startsWith('#')) return whole;
      if (isRemote(url)) { this.remoteHosts.add(hostOf(url) || 'another site'); return 'none'; }
      const target = this.conversion.locate(url, folder);
      const uri = target === undefined ? undefined : this.conversion.dataUri(target);
      if (!uri) { this.missing.add(target ?? url); return 'none'; }
      return `url("${uri}")`;
    });
  }

  /**
   * KaTeX and other fonts list woff2, woff and ttf copies. Every browser the
   * player supports reads woff2, so the others are not embedded when a woff2
   * copy is in the build: the document stays about three times smaller.
   */
  private preferWoff2(block: string, folder: string): string {
    // The value runs to the first ; or } outside url(…) and quotes: data: URIs contain semicolons.
    const declaration = /(\bsrc\s*:\s*)((?:url\(\s*"[^"]*"\s*\)|url\(\s*'[^']*'\s*\)|url\([^)]*\)|"[^"]*"|'[^']*'|[^;}"'])*)/gi;
    return block.replace(declaration, (whole, label: string, value: string) => {
      const entries = splitList(value);
      const woff2 = entries.filter((entry) => {
        const url = /url\(\s*["']?([^"')]+)/i.exec(entry)?.[1]?.trim();
        if (!url || !(/\.woff2(?:[?#]|$)/i.test(url) || /format\(\s*["']?woff2/i.test(entry) || /^data:font\/woff2[;,]/i.test(url))) return false;
        // Vite inlines small fonts itself.
        if (/^data:/i.test(url)) return true;
        const target = this.conversion.locate(url, folder);
        return target !== undefined && this.conversion.bytes(target) !== undefined;
      });
      return woff2.length && woff2.length < entries.length ? `${label}${woff2.join(',').trim()}` : whole;
    });
  }

  reportProblems(): void {
    if (this.remoteHosts.size) {
      const hosts = [...this.remoteHosts].sort();
      this.conversion.report('external-css-asset', 'info',
        `Pictures or fonts that the styles load from ${hosts.slice(0, NAMED).join(', ')}${hosts.length > NAMED ? ' and other sites' : ''} were left out, because the player works without the internet.`);
    }
    if (this.missing.size) {
      const missing = [...this.missing].sort();
      this.conversion.report('missing-file', 'warning',
        `Files that the styles use are not in the ZIP, so some pictures or fonts will not show: ${missing.slice(0, NAMED).map((item) => shown(item, 120)).join(', ')}${missing.length > NAMED ? ` and ${missing.length - NAMED} more` : ''}.`,
        missing[0]);
    }
  }
}

/* ------------------------------------------------------------- modules */

interface ModulePatches {
  preload: number;
  router: number;
  dynamicImports: number;
  /** Code-split stylesheets named by the preload lists, in the order they appear. */
  preloadCss: string[];
  unpatchedPreload: string[];
  unwrapped: string[];
  missingAssets: Set<string>;
}

/**
 * Asset strings that the build resolves against the document: "/assets/x.png"
 * for an absolute base path, "./assets/x.png" for a relative one. Only whole
 * string literals that name an existing picture, media or font file change.
 */
function embedAssetStrings(conversion: Conversion, code: string, path: string): string {
  if (!ASSET_MENTION.test(code)) return code;
  const literals = scanStringLiterals(code);
  if (!literals) {
    conversion.report('slidev-script-unreadable', 'warning',
      `The script ${shown(path)} could not be read to its end, so pictures it refers to may not show.`, path);
    return code;
  }
  let result = '';
  let last = 0;
  for (const literal of literals) {
    const value = literal.value;
    if (value.length > 400 || !ASSET_FILE.test(value.split(/[?#]/, 1)[0]) || isRemote(value)) continue;
    // Strings in the build that name its files are relative to the document, which sits at the build's root.
    const target = conversion.locate(value, conversion.root.replace(/\/$/, ''));
    const uri = target === undefined ? undefined : conversion.dataUri(target);
    if (!uri) continue;
    result += code.slice(last, literal.start) + JSON.stringify(uri);
    last = literal.end;
  }
  return last ? result + code.slice(last) : code;
}

/** import(…) becomes (import(…)).then(tag) so its result stays recognisable as a module after bundling. */
function wrapDynamicImports(code: string, path: string, patches: ModulePatches): string {
  if (!/\bimport\s*\(/.test(code)) return code;
  const { imports, complete } = scanModuleImports(code);
  const dynamic = imports.filter((item) => item.kind === 'dynamic');
  if (!complete || dynamic.some((item) => item.callEnd === undefined)) {
    patches.unwrapped.push(path);
    if (!complete) return code;
  }
  let result = code;
  for (const item of dynamic.filter((entry) => entry.callEnd !== undefined).sort((left, right) => right.start - left.start)) {
    result = `${result.slice(0, item.start)}(${result.slice(item.start, item.callEnd)}${MODULE_TAG}${result.slice(item.callEnd)}`;
    patches.dynamicImports += 1;
  }
  return result;
}

function patchModule(conversion: Conversion, path: string, source: string, patches: ModulePatches): string {
  let code = stripSourceMapComment(source);
  const folder = dirname(path);
  let preloadHere = 0;
  code = code.replace(MAP_DEPS, (_whole, list: string) => {
    preloadHere += 1;
    for (const match of list.matchAll(/["'`]([^"'`]{1,400})["'`]/g)) {
      if (/\.css(?:[?#]|$)/i.test(match[1])) patches.preloadCss.push(match[1]);
    }
    return '__vite__mapDeps=()=>[]';
  });
  patches.preload += preloadHere;
  if (!preloadHere && /\b__vite__mapDeps\s*=/.test(code)) patches.unpatchedPreload.push(path);

  code = code.replace(ROUTER_HISTORY, (_whole, _factory: string, quote: string, base: string) => {
    patches.router += 1;
    return `history:(${MEMORY_HISTORY})(${quote}${base}${quote}),routes:`;
  });

  code = code.replace(MODULE_URL, (whole, _quote: string, target: string, href?: string) => {
    const resolved = conversion.locate(target, folder);
    const uri = resolved === undefined ? undefined : conversion.dataUri(resolved);
    if (!uri) {
      if (ASSET_FILE.test(target.split(/[?#]/, 1)[0])) patches.missingAssets.add(resolved ?? target);
      return whole;
    }
    return href ? JSON.stringify(uri) : `new URL(${JSON.stringify(uri)})`;
  });

  code = embedAssetStrings(conversion, code, path);
  return wrapDynamicImports(code, path, patches);
}

/* -------------------------------------------------------------- checks */

/** Refusals that need no work first: features the player cannot run, and builds that cannot fit. */
function refuse(conversion: Conversion, detection: DeckDetection, modules: readonly string[]): boolean {
  let refused = false;
  const monaco = detection.flags.slidevHasMonaco || conversion.paths.some((path) => path.slice(conversion.root.length).startsWith('assets/monaco/'));
  if (monaco) {
    conversion.report('slidev-monaco-unsupported', 'error',
      'This Slidev build includes the Monaco code editor, which cannot run in the player. Remove the {monaco} code blocks (or set "monaco: false" in the first slide\'s settings), run "npx slidev build" again, and open a ZIP of the new dist folder.',
      `${conversion.root}assets/monaco/`);
    refused = true;
  }
  const workerFiles = conversion.paths.filter((path) => WORKER_NAME.test(path));
  const workerCode = modules.filter((path) => !workerFiles.includes(path) && WORKER_FILE.test(conversion.text(path) ?? ''));
  if (detection.flags.slidevHasWorkers || workerFiles.length || workerCode.length) {
    const named = [...workerFiles, ...workerCode].slice(0, NAMED).map((path) => shown(path, 120));
    conversion.report('slidev-workers-unsupported', 'error',
      `This Slidev build starts Web Workers${named.length ? ` (${named.join(', ')})` : ''}, background scripts that the player does not allow. Remove the feature that needs them, often Monaco code blocks, build again, and open the new ZIP.`,
      named[0]);
    refused = true;
  }
  const scriptBytes = modules.reduce((sum, path) => sum + (conversion.bytes(path)?.length ?? 0), 0);
  if (scriptBytes > SLIDEV_CONVERT_LIMITS.scriptBytes) {
    const largest = [...modules].sort((left, right) => (conversion.bytes(right)?.length ?? 0) - (conversion.bytes(left)?.length ?? 0))
      .slice(0, NAMED).map((path) => `${shown(path.slice(conversion.root.length), 100)} (${formatBytes(conversion.bytes(path)?.length ?? 0)})`);
    conversion.report('slidev-build-too-large', 'error',
      `This Slidev build has ${formatBytes(scriptBytes)} of scripts, more than the ${formatBytes(PRESENTATION_LIMITS.htmlBytes)} a presentation can have here. The largest are ${largest.join(', ')}. Builds this large usually include Monaco or many diagrams; remove what the slides do not need and build again.`);
    refused = true;
  }
  return refused;
}

function emptyStats(conversion: Conversion): SlidevConversionStats {
  return {
    root: conversion.root, base: conversion.base, entryModule: '', modules: 0, stylesheets: 0, embeddedAssets: 0,
    preloadPatched: 0, routerPatched: 0, dynamicImports: 0, htmlLength: 0,
  };
}

function bundleProblem(error: unknown): string {
  const details = (error as { errors?: { text?: unknown }[] } | null)?.errors;
  const first = Array.isArray(details) && typeof details[0]?.text === 'string' ? details[0].text : error instanceof Error ? error.message : String(error);
  const text = cleanReportedText(first, 300);
  return /[.!?…]$/.test(text) ? text : `${text}.`;
}

/**
 * Convert the files of an ordinary Slidev build into one playable document.
 * `detection` must be a 'slidev-build' detection of the same files. The same
 * input always gives the same output. Errors are returned as issues with html
 * ''; only cancellation rejects (an AbortError).
 */
export async function convertSlidevFiles(
  files: DeckFiles,
  detection: DeckDetection,
  bundle: SlidevBundler,
  options: SlidevConvertOptions = {},
): Promise<SlidevConversion> {
  const entry = detection.entry && files.has(detection.entry) ? detection.entry : undefined;
  const conversion = new Conversion(files, entry ?? 'index.html');
  const fail = (): SlidevConversion => ({ html: '', issues: conversion.issues, stats: emptyStats(conversion) });
  if (detection.kind !== 'slidev-build' || !entry) {
    conversion.report('slidev-entry-missing', 'error', 'No Slidev build was found: a build has index.html next to an assets folder. Open a ZIP of the dist folder that "npx slidev build" makes.');
    return fail();
  }
  const modules = conversion.paths.filter((path) => MODULE_FILE.test(path));
  if (refuse(conversion, detection, modules)) return fail();

  const declaredBase = detection.flags.slidevBase;
  conversion.base = declaredBase && (declaredBase.startsWith('/') || declaredBase.startsWith('./')) ? declaredBase : './';
  const page = readPage(conversion);
  if (!page.entryModule) {
    conversion.report('slidev-entry-missing', 'error',
      'The build\'s index.html does not start its app from a script in the ZIP. Open a ZIP of the whole dist folder that "npx slidev build" makes, with its assets folder.',
      conversion.entry);
    return fail();
  }
  const entrySrc = page.entryModule.slice(conversion.root.length);
  options.signal?.throwIfAborted();

  const patches: ModulePatches = { preload: 0, router: 0, dynamicImports: 0, preloadCss: [], unpatchedPreload: [], unwrapped: [], missingAssets: new Set() };
  const patched = new Map<string, string>();
  // The entry first, so its preload lists order the stylesheets.
  for (const path of [page.entryModule, ...modules.filter((item) => item !== page.entryModule)]) {
    patched.set(path, patchModule(conversion, path, conversion.text(path) ?? '', patches));
  }
  options.signal?.throwIfAborted();
  if (patches.unpatchedPreload.length) {
    conversion.report('slidev-preload-unpatched', 'warning',
      `Vite's loading of slide files could not be switched off in ${patches.unpatchedPreload.slice(0, NAMED).map((path) => shown(path, 100)).join(', ')}, so some slides may stay blank. Building again with a current Slidev should help.`,
      patches.unpatchedPreload[0]);
  } else if (!patches.preload && [...patched.values()].some((code) => /\bimport\s*\(/.test(code))) {
    conversion.report('slidev-preload-unpatched', 'warning',
      'This Slidev build loads its slides in a way the converter does not recognize, probably because an older Slidev made it, so some slides may stay blank. Building again with a current Slidev should help.');
  }
  if (!patches.router) {
    conversion.report('slidev-router-unpatched', 'warning',
      'The converter could not find the Slidev router in this build, so moving between slides may not work. Building again with a current Slidev should help.',
      page.entryModule);
  }
  if (patches.unwrapped.length) {
    conversion.report('slidev-script-unreadable', 'warning',
      `The scripts ${patches.unwrapped.slice(0, NAMED).map((path) => shown(path, 100)).join(', ')} could not be read to their end, so slides they load may stay blank.`,
      patches.unwrapped[0]);
  }
  if (patches.missingAssets.size) {
    const missing = [...patches.missingAssets].sort();
    conversion.report('missing-file', 'warning',
      `Files that the scripts use are not in the ZIP, so they will not show: ${missing.slice(0, NAMED).map((item) => shown(item, 120)).join(', ')}${missing.length > NAMED ? ` and ${missing.length - NAMED} more` : ''}.`,
      missing[0]);
  }

  // Stylesheets: the page's own, then those the preload lists name, then any other in the build.
  const sheets = new StyleSheets(conversion);
  const order: { path?: string; css: string; from: string }[] = [...page.stylesheets];
  const included = new Set(page.stylesheets.flatMap((sheet) => (sheet.path ? [sheet.path] : [])));
  const cssFiles = conversion.paths.filter((path) => /\.css$/i.test(path));
  for (const listed of patches.preloadCss) {
    const path = conversion.locate(listed, conversion.root.replace(/\/$/, ''));
    if (path !== undefined && !included.has(path) && cssFiles.includes(path)) { included.add(path); order.push({ path, css: conversion.text(path) ?? '', from: path }); }
  }
  for (const path of cssFiles) {
    if (!included.has(path)) { included.add(path); order.push({ path, css: conversion.text(path) ?? '', from: path }); }
  }
  if (!order.length) conversion.report('slidev-no-styles', 'warning', 'This build has no stylesheets, so the slides will look unstyled. Open a ZIP of the whole dist folder.');
  const styles = order.map((sheet) => `<style data-qft-from="${escapeAttribute(shown(sheet.from, 200))}">${escapeStyleText(sheets.process(sheet.css, sheet.path ?? conversion.entry))}</style>`);
  sheets.reportProblems();

  options.onProgress?.('bundling');
  let script: string;
  try {
    script = await bundle({
      entry: page.entryModule,
      modules: patched,
      resolve: (specifier, importer) => {
        if (!specifier.startsWith('.') && !specifier.startsWith('/')) return undefined;
        const path = conversion.locate(specifier, dirname(importer));
        return path !== undefined && patched.has(path) ? path : undefined;
      },
    });
  } catch (error) {
    options.signal?.throwIfAborted();
    conversion.report('slidev-bundle-failed', 'error',
      `The presentation's scripts could not be combined into one file: ${bundleProblem(error)} Open a ZIP of the complete dist folder that "npx slidev build" makes.`,
      page.entryModule);
    return fail();
  }
  options.signal?.throwIfAborted();
  const leftover = scanModuleImports(script).imports.filter((item) => item.kind === 'dynamic').length;
  if (leftover) {
    conversion.report('slidev-runtime-imports', 'warning',
      `Part of this presentation loads code while it plays (${leftover} ${leftover === 1 ? 'place' : 'places'}), which cannot work here. The slides that need it may stay blank.`);
  }

  const title = page.title || 'Slidev presentation';
  const scripts = [PRELUDE, ...page.inlineScripts, script].map((code) => `<script>${escapeScriptText(code)}</script>`).join('');
  const html = `<!doctype html><html${page.htmlAttributes || ' lang="en"'}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>${styles.join('')}</head><body${page.bodyAttributes}>${page.body}${scripts}</body></html>`;
  const limit = options.maxHtmlLength ?? PRESENTATION_LIMITS.htmlBytes;
  const stats: SlidevConversionStats = {
    root: conversion.root, base: conversion.base, entryModule: entrySrc, modules: patched.size, stylesheets: order.length,
    embeddedAssets: conversion.embeddedAssets, preloadPatched: patches.preload, routerPatched: patches.router,
    dynamicImports: patches.dynamicImports, htmlLength: html.length,
  };
  if (html.length > limit) {
    conversion.report('deck-too-large', 'error',
      `The converted presentation is ${formatBytes(html.length)}, more than the ${formatBytes(limit)} the player can open. Remove large pictures, videos or diagrams the slides do not need, and build again.`);
    return { html: '', issues: conversion.issues, stats };
  }
  return { html, issues: conversion.issues, stats };
}

/* ------------------------------------------------------------- esbuild */

/** The part of esbuild's API the bundler uses; the native package and esbuild-wasm both provide it. */
export interface EsbuildApi {
  build(options: BuildOptions): Promise<BuildResult>;
}

const NAMESPACE = 'qft-slidev';

/**
 * A SlidevBundler on esbuild: one classic script, no file system, no network.
 * Imports resolve only to modules of the build; anything else fails the build.
 */
export function createEsbuildBundler(esbuild: EsbuildApi): SlidevBundler {
  return async ({ entry, modules, resolve }) => {
    const files: Plugin = {
      name: 'qft-slidev-files',
      setup(build) {
        build.onResolve({ filter: /.*/ }, (args) => {
          if (args.kind === 'entry-point') return { path: entry, namespace: NAMESPACE };
          const path = resolve(args.path, args.importer);
          return path === undefined
            ? { errors: [{ text: `${shown(args.importer, 120)} imports ${shown(args.path, 120)}, which is not in the build.` }] }
            : { path, namespace: NAMESPACE };
        });
        build.onLoad({ filter: /.*/, namespace: NAMESPACE }, (args) => ({ contents: modules.get(args.path) ?? '', loader: 'js' }));
      },
    };
    const result = await esbuild.build({
      entryPoints: [entry], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'esnext',
      minify: true, charset: 'utf8', legalComments: 'eof', logLevel: 'silent',
      // The preload helper is switched off; nothing else in a build reads these.
      define: { 'import.meta.url': '"about:blank"', 'import.meta.resolve': 'undefined' },
      plugins: [files],
    });
    const output = result.outputFiles ?? [];
    if (output.length !== 1) throw new Error('The bundler did not produce exactly one script.');
    return output[0].text;
  };
}
