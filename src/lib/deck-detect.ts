import { parse, type DefaultTreeAdapterTypes } from 'parse5';
import { decodeText } from './deck-archive';
import { cleanReportedText } from './presentation-messages';
import type { DeckDetection, DeckFiles, DeckIssue } from './deck-types';

/**
 * Work out what an imported folder or ZIP is, and what will stand in the way
 * of playing it offline. Pure: HTML goes through an inert parser (parse5),
 * text is read with bounded regular expressions, and nothing is executed,
 * rendered or fetched.
 */

type Element = DefaultTreeAdapterTypes.Element;
type ParentNode = DefaultTreeAdapterTypes.ParentNode;

export const DECK_DETECT_LIMITS = Object.freeze({
  /** HTML files larger than this are not parsed. */
  htmlBytes: 24 * 1024 * 1024,
  /** At most this many HTML files are parsed, shallowest first. */
  htmlFiles: 40,
  /** Pages with more tags than this are not parsed; a parsed tree costs memory per element. */
  htmlTags: 250_000,
  /** Script, stylesheet and manifest files read for versions and references. */
  textBytes: 8 * 1024 * 1024,
  stylesheets: 40,
  issues: 40,
});

const HTML_FILE = /\.html?$/i;
const IGNORED_FOLDER = /(?:^|\/)(?:node_modules|bower_components|__MACOSX|\.git)\//i;
/** Pages that ship inside Reveal.js itself and are never the deck. */
const REVEAL_HELPER_PAGE = /(?:^|\/)(?:plugin\/notes\/(?:notes|speaker-view)\.html?|plugin\/markdown\/example\.html?|plugin\/notes-server\/notes\.html?|speaker-view\.html?)$/i;
const TEST_FOLDER = /(?:^|\/)(?:test|tests|spec|examples?)\//i;
const README = /^readme(?:\.[\w-]+)?\.html?$/i;

const depthOf = (path: string) => path.split('/').length - 1;
const dirOf = (path: string) => path.slice(0, path.lastIndexOf('/') + 1);
const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);
const byDepth = (left: string, right: string) => depthOf(left) - depthOf(right)
  || left.length - right.length || left.localeCompare(right);
const shown = (value: string, limit = 160) => cleanReportedText(value, limit);

class IssueList {
  private readonly items: DeckIssue[] = [];
  private readonly keys = new Set<string>();
  private extra = 0;

  add(code: string, severity: DeckIssue['severity'], message: string, where?: string): void {
    const place = where === undefined ? undefined : shown(where, 300);
    const key = `${code}\u0000${place ?? message}`;
    if (this.keys.has(key)) return;
    this.keys.add(key);
    if (this.items.length >= DECK_DETECT_LIMITS.issues) { this.extra += 1; return; }
    this.items.push(place ? { code, severity, message, where: place } : { code, severity, message });
  }

  list(): DeckIssue[] {
    if (!this.extra) return this.items;
    return [...this.items, {
      code: 'more-notes', severity: 'info',
      message: `${this.extra} more ${this.extra === 1 ? 'note is' : 'notes are'} not shown.`,
    }];
  }
}

/* ------------------------------------------------------------------ HTML */

type ReferenceKind = 'script' | 'style' | 'image' | 'font' | 'frame' | 'media' | 'markdown';

interface Reference { kind: ReferenceKind; url: string; from: string }

interface ScriptTag { src?: string; type: string; text: string }

interface PageScan {
  path: string;
  text: string;
  title?: string;
  /** An element with class "slides" inside one with class "reveal". */
  revealRoot: boolean;
  sections: number;
  topSections: number;
  scripts: ScriptTag[];
  stylesheets: string[];
  styles: string[];
  references: Reference[];
  inlineHandlers: number;
  slidevVersion?: string;
  appRoot: boolean;
}

const attribute = (element: Element, name: string): string | undefined =>
  element.attrs.find((attr) => attr.name === name)?.value;

function textOf(element: Element): string {
  let text = '';
  for (const child of element.childNodes) if (child.nodeName === '#text') text += (child as DefaultTreeAdapterTypes.TextNode).value;
  return text;
}

/** srcset lists "url width, url width"; keep the URLs. */
const srcsetUrls = (value: string) => value.split(',').map((part) => part.trim().split(/\s+/)[0]).filter(Boolean);

/** Count tag openings without building anything, stopping at the limit. */
function tooManyTags(text: string): boolean {
  let count = 0;
  for (let at = text.indexOf('<'); at >= 0; at = text.indexOf('<', at + 1)) {
    const next = text.charCodeAt(at + 1) | 0x20;
    if (next >= 0x61 && next <= 0x7a && (count += 1) > DECK_DETECT_LIMITS.htmlTags) return true;
  }
  return false;
}

const IMAGE_URL = /\.(?:png|jpe?g|gif|svg|webp|avif|bmp|ico)(?:[?#]|$)/i;

/** Walk the parsed page without recursion, so deeply nested markup cannot overflow the stack. */
function scanPage(path: string, text: string): PageScan {
  const page: PageScan = {
    path, text, revealRoot: false, sections: 0, topSections: 0, scripts: [], stylesheets: [], styles: [],
    references: [], inlineHandlers: 0, appRoot: false,
  };
  const add = (kind: ReferenceKind, url: string | undefined) => {
    const value = url?.trim();
    if (value) page.references.push({ kind, url: value, from: path });
  };
  const document = parse(text);
  // Pre-order, document order: each element is examined before its children.
  type Frame = { element: Element; inReveal: boolean; inRoot: boolean; parentIsRoot: boolean };
  const stack: Frame[] = [];
  const pushChildren = (node: ParentNode, context: Omit<Frame, 'element'>) => {
    const children = node.nodeName === 'template'
      ? (node as DefaultTreeAdapterTypes.Template).content.childNodes
      : node.childNodes;
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if ('tagName' in child) stack.push({ element: child as Element, ...context });
    }
  };
  pushChildren(document, { inReveal: false, inRoot: false, parentIsRoot: false });
  while (stack.length) {
    const frame = stack.pop()!;
    const element = frame.element;
    const tag = element.tagName.toLowerCase();
    const classes = new Set((attribute(element, 'class') ?? '').split(/\s+/).filter(Boolean));
    let inRoot = frame.inRoot;
    let isRoot = false;
    if (!page.revealRoot && frame.inReveal && classes.has('slides')) {
      page.revealRoot = true;
      inRoot = true;
      isRoot = true;
    }
    if (tag === 'section' && frame.inRoot) {
      page.sections += 1;
      if (frame.parentIsRoot) page.topSections += 1;
    }
    for (const attr of element.attrs) {
      if (/^on[a-z]{2,}$/i.test(attr.name) && attr.value.trim()) page.inlineHandlers += 1;
    }
    const style = attribute(element, 'style');
    if (style) page.styles.push(style);
    switch (tag) {
      case 'script': {
        const src = attribute(element, 'src')?.trim();
        page.scripts.push({ src: src || undefined, type: (attribute(element, 'type') ?? '').trim().toLowerCase(), text: src ? '' : textOf(element) });
        if (src) add('script', src);
        break;
      }
      case 'link': {
        const rel = (attribute(element, 'rel') ?? '').toLowerCase().split(/\s+/);
        const href = attribute(element, 'href');
        if (rel.includes('stylesheet') && href) { page.stylesheets.push(href.trim()); add('style', href); }
        else if (rel.includes('modulepreload')) add('script', href);
        break;
      }
      case 'style': page.styles.push(textOf(element)); break;
      case 'title': page.title ??= textOf(element); break;
      case 'meta':
        if (attribute(element, 'property') === 'slidev:version' || attribute(element, 'name') === 'slidev:version') {
          page.slidevVersion ??= attribute(element, 'content') ?? '';
        }
        break;
      case 'img':
        add('image', attribute(element, 'src'));
        add('image', attribute(element, 'data-src'));
        for (const url of srcsetUrls(attribute(element, 'srcset') ?? '')) add('image', url);
        break;
      case 'iframe': case 'frame': case 'embed': case 'object':
        add('frame', attribute(element, 'src') ?? attribute(element, 'data-src') ?? attribute(element, 'data'));
        break;
      case 'video': case 'audio': case 'source': case 'track':
        add('media', attribute(element, 'src'));
        add('media', attribute(element, 'data-src'));
        add('image', attribute(element, 'poster'));
        break;
      case 'image': add('image', attribute(element, 'href') ?? attribute(element, 'xlink:href')); break;
      case 'div': if (attribute(element, 'id') === 'app') page.appRoot = true; break;
      default: break;
    }
    add('image', attribute(element, 'data-background-image'));
    add('media', attribute(element, 'data-background-video'));
    add('frame', attribute(element, 'data-background-iframe'));
    const background = attribute(element, 'data-background');
    if (background && (IMAGE_URL.test(background) || /^(?:https?:)?\/\//i.test(background))) add('image', background);
    const markdown = attribute(element, 'data-markdown');
    if (markdown?.trim()) add('markdown', markdown);
    pushChildren(element, { inReveal: frame.inReveal || classes.has('reveal'), inRoot, parentIsRoot: isRoot });
  }
  return page;
}

/* ------------------------------------------------------------- References */

type UrlKind = 'inert' | 'remote' | 'local';

function urlKind(url: string): UrlKind {
  if (!url || url.startsWith('#')) return 'inert';
  if (/^(?:https?:)?\/\//i.test(url)) return 'remote';
  // data:, blob:, javascript:, mailto: and every other scheme load nothing from the archive.
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return 'inert';
  return 'local';
}

/** Resolve a reference against the file that makes it; undefined when it climbs out of the archive. */
function resolvePath(from: string, reference: string): string | undefined {
  let clean = reference.replace(/[?#].*$/s, '').replace(/\\/g, '/');
  try { clean = decodeURIComponent(clean); } catch { /* keep the raw spelling */ }
  const parts = (clean.startsWith('/') ? clean.slice(1) : dirOf(from) + clean).split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (part === '..') { if (!out.length) return undefined; out.pop(); }
    else if (part && part !== '.') out.push(part);
  }
  return out.length ? out.join('/').normalize('NFC') : undefined;
}

interface CdnReference { host: string; pkg?: string; spec?: string; path: string }

function parseCdn(url: string): CdnReference {
  const match = /^(?:https?:)?\/\/([^/?#]{1,253})(\/[^?#]*)?/i.exec(url);
  const host = (match?.[1] ?? '').toLowerCase().replace(/:\d+$/, '');
  let rest = (match?.[2] ?? '').replace(/^\/+/, '');
  if (host === 'cdnjs.cloudflare.com') {
    const parts = /^ajax\/libs\/([^/]+)\/([^/]+)\/?(.*)$/.exec(rest);
    return parts ? { host, pkg: parts[1], spec: parts[2], path: parts[3] } : { host, path: rest };
  }
  const npmHost = /(?:^|\.)jsdelivr\.net$/.test(host) || /^(?:unpkg\.com|esm\.sh|esm\.run|cdn\.skypack\.dev|jspm\.dev|ga\.jspm\.io)$/.test(host);
  if (!npmHost) return { host, path: rest };
  if (/jsdelivr\.net$/.test(host) || host === 'ga.jspm.io') {
    if (!/^npm:?\//.test(rest)) return { host, path: rest };
    rest = rest.replace(/^npm:?\//, '');
  }
  const parts = /^((?:@[^/@]+\/)?[^/@]+)(?:@([^/]*))?(?:\/(.*))?$/.exec(rest);
  if (!parts) return { host, path: rest };
  return { host, pkg: parts[1].toLowerCase(), spec: parts[2], path: parts[3] ?? '' };
}

const EXACT_VERSION = /^v?(\d{1,3}\.\d{1,3}\.\d{1,4})$/;
const CORE_FILE = /(?:^|\/)reveal(?:\.esm)?(?:\.min)?\.m?js$/i;
const CORE_STYLE = /(?:^|\/)reveal(?:\.min)?\.css$/i;

/** Paths of Reveal.js and KaTeX files that the site supplies when a deck leaves them out. */
function suppliedLibrary(path: string): 'Reveal.js' | 'KaTeX' | undefined {
  const lower = path.toLowerCase();
  if (/(?:^|\/)katex(?:\.min)?\.(?:m?js|css)$|(?:^|\/)contrib\/(?:auto-render|mhchem|copy-tex)(?:\.min)?\.m?js$|(?:^|\/)katex\/(?:dist\/)?fonts\//.test(lower)) return 'KaTeX';
  if (CORE_FILE.test(lower) || CORE_STYLE.test(lower)) return 'Reveal.js';
  // Only Reveal.js's own layouts (6.x, 4.x-5.x and 3.x); third-party plugins are not supplied.
  if (/(?:^|\/)dist\/(?:reset(?:\.min)?\.css|theme\/[\w.-]+\.css|theme\/fonts\/|plugin\/)/.test(lower)) return 'Reveal.js';
  if (/(?:^|\/)plugin\/(?:markdown|highlight|notes|math|zoom|search)\/[\w.-]+\.(?:m?js|css)$/.test(lower)) return 'Reveal.js';
  if (/(?:^|\/)css\/theme\/[\w.-]+\.css$|(?:^|\/)lib\/css\/[\w.-]+\.css$/.test(lower)) return 'Reveal.js';
  return undefined;
}

const FONT_FILE = /\.(?:woff2?|ttf|otf|eot)$/i;

/** Bounded patterns over CSS text: @import targets and url() values. */
function cssReferences(css: string, from: string): Reference[] {
  const references: Reference[] = [];
  for (const match of css.matchAll(/@import\s+(?:url\(\s*)?["']?([^"'()\s;]{1,2000})/gi)) {
    references.push({ kind: 'style', url: match[1], from });
  }
  for (const match of css.matchAll(/url\(\s*(["']?)([^"'()\s]{1,4000})\1\s*\)/gi)) {
    const url = match[2];
    const kind: ReferenceKind = FONT_FILE.test(url.replace(/[?#].*$/s, '')) ? 'font' : 'image';
    references.push({ kind, url, from });
  }
  return references.filter((reference) => !/^(?:\/\*|#)/.test(reference.url));
}

interface ReferenceReport {
  revealCdn: { url: string; cdn: CdnReference }[];
  found: Set<string>;
}

/**
 * Check every reference a page makes, and those of the local stylesheets it
 * uses, and record what is missing or comes from the internet.
 */
function checkReferences(
  files: DeckFiles, page: PageScan, issues: IssueList, extra: Reference[],
  options: { revealDeck: boolean; absoluteBase?: { base: string; root: string } },
): ReferenceReport {
  const absolute = options.absoluteBase;
  const lower = new Map<string, string>();
  for (const path of files.keys()) lower.set(path.toLowerCase(), path);
  const report: ReferenceReport = { revealCdn: [], found: new Set() };
  const supplied = new Map<string, string[]>();
  const queue: Reference[] = [...page.references, ...extra];
  for (const style of page.styles) queue.push(...cssReferences(style, page.path));
  const seen = new Set<string>();
  let stylesheets = 0;

  for (let index = 0; index < queue.length; index += 1) {
    const reference = queue[index];
    const key = `${reference.kind}\u0000${reference.from}\u0000${reference.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const url = reference.url;
    const kind = urlKind(url);
    if (kind === 'inert') {
      if ((reference.kind === 'script' || reference.kind === 'style') && /^data:text\/(?:plain|html)/i.test(url)) {
        issues.add('embedded-error-page', 'warning',
          'A script or stylesheet is embedded as text, which usually means a download failed and saved an error page instead of the file. Replace it with the real file.',
          url.slice(0, 120));
      }
      continue;
    }
    if (kind === 'remote') {
      remoteReference(reference, parseCdn(url), issues, report);
      continue;
    }
    // A build made for a server path (Slidev's --base /talk/) names its files from that path.
    const target = absolute && url.startsWith(absolute.base)
      ? resolvePath(absolute.root, url.slice(absolute.base.length))
      : resolvePath(reference.from, url);
    if (target && files.has(target)) {
      report.found.add(target);
      if (reference.kind === 'style' && /\.css$/i.test(target) && stylesheets < DECK_DETECT_LIMITS.stylesheets) {
        const bytes = files.get(target)!;
        stylesheets += 1;
        if (bytes.length <= DECK_DETECT_LIMITS.textBytes) queue.push(...cssReferences(decodeText(bytes, target), target));
      }
      continue;
    }
    const actual = target ? lower.get(target.toLowerCase()) : undefined;
    if (actual) {
      report.found.add(actual);
      issues.add('file-case-mismatch', 'warning',
        `${shown(reference.from)} refers to ${shown(url)}, but the file in the ZIP is spelled ${shown(actual)}. Make the spelling match exactly.`,
        url);
      continue;
    }
    if (reference.kind === 'font' && target && hasOtherFontFormat(files, target)) continue;
    const library = target && options.revealDeck ? suppliedLibrary(target) : undefined;
    if (library) {
      const list = supplied.get(library) ?? [];
      list.push(target!);
      supplied.set(library, list);
      continue;
    }
    issues.add('missing-local-file', 'warning',
      `${shown(reference.from)} uses ${shown(url)}, which is not in the ZIP. Add the file or remove the reference.`,
      target ?? url);
  }

  for (const [library, paths] of supplied) {
    const unique = [...new Set(paths)];
    const named = unique.slice(0, 3).map((path) => shown(path, 80)).join(', ');
    const more = unique.length > 3 ? ` and ${unique.length - 3} more` : '';
    issues.add('library-file-supplied', 'info',
      `${unique.length === 1 ? 'A' : unique.length} ${library} ${unique.length === 1 ? 'file is' : 'files are'} not in the ZIP (${named}${more}). The site uses its own copy of ${library} instead.`,
      library);
  }
  return report;
}

function hasOtherFontFormat(files: DeckFiles, target: string): boolean {
  const stem = target.replace(FONT_FILE, '');
  return ['.woff2', '.woff', '.ttf', '.otf'].some((extension) => files.has(stem + extension));
}

function remoteReference(reference: Reference, cdn: CdnReference, issues: IssueList, report: ReferenceReport): void {
  const host = shown(cdn.host || 'another site', 80);
  if (cdn.pkg === 'reveal.js') { report.revealCdn.push({ url: reference.url, cdn }); return; }
  if (cdn.pkg === 'katex') return;
  const item = shown(cdn.pkg ?? (nameOf(cdn.path) || reference.url), 80);
  switch (reference.kind) {
    case 'script':
      issues.add('external-library', 'warning',
        `The deck loads ${item} from ${host}. Files from the internet are not available while the deck plays. Include the library in the ZIP or leave it out.`,
        reference.url);
      break;
    case 'style':
    case 'font':
      if (/(?:^|\.)fonts\.(?:googleapis|gstatic)\.com$|(?:^|\.)use\.typekit\.net$|(?:^|\.)fonts\.bunny\.net$/.test(cdn.host)) {
        issues.add('external-font', 'info',
          `Web fonts from ${host} are not available while the deck plays, so system fonts are used instead.`, reference.url);
      } else if (reference.kind === 'font') {
        issues.add('external-font', 'info',
          `A font comes from ${host} and is not available while the deck plays, so a system font is used instead.`, reference.url);
      } else {
        issues.add('external-stylesheet', 'warning',
          `The deck loads the stylesheet ${item} from ${host}, which is not available while the deck plays. Put the styles in the ZIP or inline them.`,
          reference.url);
      }
      break;
    case 'image':
      issues.add('external-image', 'warning',
        `An image comes from ${host} and will not show while the deck plays. Put the picture in the ZIP or embed it as a data: URI.`,
        reference.url);
      break;
    case 'frame':
      issues.add('external-frame', 'warning',
        `An embedded page comes from ${host} and will not load while the deck plays. Replace it with a picture or a local demo.`,
        reference.url);
      break;
    case 'media':
      issues.add('external-media', 'warning',
        `Audio or video comes from ${host} and will not play offline. Put the file in the ZIP.`, reference.url);
      break;
    case 'markdown':
      issues.add('external-file', 'warning',
        `Slide text is loaded from ${host}, which is not available while the deck plays. Put the Markdown file in the ZIP.`,
        reference.url);
      break;
  }
}

/* ---------------------------------------------------------------- Reveal */

const START_CALL = /\bReveal\s*\.\s*initialize\s*\(|\bnew\s+Reveal\s*\(|\.initialize\s*\(\s*\{[\s\S]{0,400}?\b(?:plugins|hash|controls|slideNumber|transition)\s*:/;
const BANNER = /reveal\.js[\s\S]{0,200}?MIT licensed[\s\S]{0,200}?Hakim El Hattab/;
// `\s+(?=[\w$*{}])` and `\sfrom`, not `\s+from`: overlapping white-space runs made this quadratic.
const MODULE_IMPORT = /\bimport\s+(?:(?=[\w$*{}])[\w$*{}\s,]{1,300}?\sfrom\s+)?["']([^"'\n]{1,500})["']|\bimport\s*\(\s*["']([^"'\n]{1,500})["']\s*\)/g;

interface RevealCandidate {
  page: PageScan;
  score: number;
  start: boolean;
  coreReferences: string[];
  inlinedCore: boolean;
  imports: string[];
  inline: string;
  initScript: string;
}

function isRevealCore(url: string): boolean {
  if (urlKind(url) === 'remote') {
    const cdn = parseCdn(url);
    if (cdn.pkg !== 'reveal.js') return CORE_FILE.test(cdn.path);
    return !cdn.path || cdn.path === '+esm' || CORE_FILE.test(cdn.path);
  }
  return url === 'reveal.js' || CORE_FILE.test(url.replace(/[?#].*$/s, ''));
}

function revealCandidate(page: PageScan): RevealCandidate {
  const inlineScripts = page.scripts.filter((script) => !script.src);
  const inline = inlineScripts.map((script) => script.text).join('\n');
  const start = START_CALL.test(inline);
  // Imports and loader paths (AMD, dependencies) live in the deck's own small
  // scripts; inlined libraries and long bundles are not searched.
  const library = (text: string) => text.length >= 200_000 || BANNER.test(text);
  const own = inlineScripts.filter((script) => !library(script.text));
  const imports = own.flatMap((script) => [...script.text.matchAll(MODULE_IMPORT)].map((match) => match[1] ?? match[2]));
  const named = own.flatMap((script) => [...script.text.matchAll(/["']([^"'\n]{0,300}reveal[^"'\n]{0,100}\.m?js)["']/gi)].map((match) => match[1]));
  const sources = page.scripts.flatMap((script) => (script.src ? [script.src] : []));
  const coreReferences = [...new Set([...sources, ...imports, ...named].filter(isRevealCore))];
  const inlinedCore = !coreReferences.length && inlineScripts.some((script) => BANNER.test(script.text));
  const initScript = inlineScripts.map((script) => script.text)
    .filter((text) => text.length < 60_000 && /\bReveal\s*\.\s*initialize\s*\(|\bnew\s+Reveal\s*\(/.test(text)).pop() ?? inline;

  const name = nameOf(page.path).toLowerCase();
  let score = 0;
  if (page.revealRoot) score += 10;
  if (start) score += 6;
  if (coreReferences.length) score += 4;
  if (page.stylesheets.some((href) => CORE_STYLE.test(href.replace(/[?#].*$/s, '')))) score += 2;
  if (inlinedCore) score += 4;
  if (/^index\.html?$/.test(name)) score += 3;
  else if (/^(?:slides?|presentation|deck|talk|lecture)\b.*\.html?$/.test(name) || /\.slides\.html?$/.test(name)) score += 2;
  score -= depthOf(page.path) * 0.5;
  if (TEST_FOLDER.test(page.path) || /^tests?[\w.-]*\.html?$/.test(name)) score -= 12;
  if (REVEAL_HELPER_PAGE.test(page.path)) score -= 20;
  if (name === 'demo.html' || name === 'demo.htm') score -= 8;
  if (page.topSections === 2 && page.sections === 2
    && /<section>\s*Slide 1\s*<\/section>\s*<section>\s*Slide 2\s*<\/section>/.test(page.text)) score -= 6;
  score += Math.min(3, page.sections / 10);
  return { page, score, start, coreReferences, inlinedCore, imports, inline, initScript };
}

const isRevealDeck = (candidate: RevealCandidate) => candidate.page.revealRoot
  && (candidate.start || candidate.coreReferences.length > 0 || candidate.inlinedCore)
  && !REVEAL_HELPER_PAGE.test(candidate.page.path) && !README.test(nameOf(candidate.page.path));

/** Every Reveal.js core build from 3.9.2 to 6.0.2 holds exactly one semver string literal. */
function versionInCore(text: string): string | undefined {
  const declared = /\bVERSION\s*[=:]\s*["'`](\d{1,3}\.\d{1,3}\.\d{1,4})["'`]/.exec(text)?.[1];
  if (declared) return declared;
  const found = new Set<string>();
  for (const match of text.matchAll(/["'`](\d{1,3}\.\d{1,3}\.\d{1,4})["'`]/g)) {
    found.add(match[1]);
    if (found.size > 1) return undefined;
  }
  return found.size === 1 ? [...found][0] : undefined;
}

function readText(files: DeckFiles, path: string): string | undefined {
  const bytes = files.get(path);
  return bytes && bytes.length <= DECK_DETECT_LIMITS.textBytes ? decodeText(bytes, path) : undefined;
}

function packageVersionNear(files: DeckFiles, corePath: string): string | undefined {
  let folder = dirOf(corePath);
  while (true) {
    const text = readText(files, folder + 'package.json');
    if (text) {
      try {
        const manifest = JSON.parse(text) as { name?: unknown; version?: unknown };
        if (manifest.name === 'reveal.js' && typeof manifest.version === 'string') {
          return EXACT_VERSION.exec(manifest.version)?.[1];
        }
      } catch { /* not JSON */ }
    }
    if (!folder) return undefined;
    folder = dirOf(folder.slice(0, -1));
  }
}

function mathPlugin(initScript: string, inline: string): DeckDetection['flags']['mathPlugin'] {
  if (/\bRevealMath\s*\.\s*KaTeX\b/.test(initScript)) return 'katex';
  if (/\bRevealMath\s*\.\s*MathJax4\b/.test(initScript)) return 'mathjax4';
  if (/\bRevealMath\s*\.\s*MathJax3\b/.test(initScript)) return 'mathjax3';
  if (/\bRevealMath\b/.test(initScript)) return 'mathjax2';
  if (/["'][^"'\n]{0,200}plugin\/math\/math(?:\.min)?\.js["']/.test(inline)) return 'mathjax2';
  return undefined;
}

function detectReveal(files: DeckFiles, candidate: RevealCandidate, others: RevealCandidate[], issues: IssueList): DeckDetection {
  const { page } = candidate;
  if (others.length) {
    const names = others.slice(0, 3).map((other) => shown(other.page.path, 80)).join(', ');
    const more = others.length > 3 ? ` and ${others.length - 3} more` : '';
    issues.add('several-decks', 'info',
      `This ZIP holds ${others.length + 1} presentations. Playing ${shown(page.path, 80)}; not playing ${names}${more}.`,
      page.path);
  }
  const extra: Reference[] = [];
  for (const specifier of candidate.imports) {
    if (/^(?:\.{0,2}\/|https?:\/\/|\/\/)/i.test(specifier)) extra.push({ kind: 'script', url: specifier, from: page.path });
    else if (!/^(?:reveal\.js|katex)(?:\/|$)/i.test(specifier) && !/^[a-z][a-z0-9+.-]*:/i.test(specifier)) {
      issues.add('external-library', 'warning',
        `The deck imports the package ${shown(specifier, 80)}, which a browser cannot find without a build step. Include the file in the ZIP and import it by its path.`,
        specifier);
    }
  }
  for (const match of candidate.initScript.matchAll(/\bsrc\s*:\s*["']([^"'\n]{1,500}\.m?js)["']/g)) {
    extra.push({ kind: 'script', url: match[1], from: page.path });
  }
  const report = checkReferences(files, page, issues, extra, { revealDeck: true });

  // Version: the local core file, an inlined core, a nearby package.json, then the CDN URL.
  let version: string | undefined;
  let major: number | undefined;
  for (const reference of candidate.coreReferences) {
    if (urlKind(reference) !== 'local') continue;
    const path = resolvePath(page.path, reference);
    if (!path || !report.found.has(path)) continue;
    const text = readText(files, path);
    version = (text && versionInCore(text)) || packageVersionNear(files, path);
    if (version) break;
  }
  if (!version && candidate.inlinedCore) {
    const core = page.scripts.find((script) => !script.src && BANNER.test(script.text))?.text ?? '';
    const at = core.search(BANNER);
    version = versionInCore(core) ?? /["'`](\d{1,3}\.\d{1,3}\.\d{1,4})["'`]/.exec(core.slice(Math.max(0, at)))?.[1];
  }
  const cdnCore = report.revealCdn.find(({ url }) => isRevealCore(url));
  const revealFromCdn = Boolean(cdnCore) || candidate.coreReferences.some((url) => urlKind(url) === 'remote');
  if (cdnCore) {
    const spec = cdnCore.cdn.spec ?? '';
    const exact = EXACT_VERSION.exec(spec)?.[1];
    if (exact) version ??= exact;
    else {
      const range = /^[~^>=<v\s]*(\d{1,3})(?:[.\s]|$)/.exec(spec);
      if (range) major = Number(range[1]);
    }
  }
  const unpinned = report.revealCdn.find(({ cdn }) => !cdn.spec || cdn.spec === 'latest');
  const ranged = report.revealCdn.find(({ cdn }) => cdn.spec && cdn.spec !== 'latest' && !EXACT_VERSION.test(cdn.spec));
  if (unpinned) {
    issues.add('reveal-unpinned-cdn', 'warning',
      `Reveal.js is loaded from ${shown(unpinned.cdn.host, 80)} without a version, so its files can change or disappear. Name an exact version, such as reveal.js@6.0.2.`,
      unpinned.url);
  } else if (ranged) {
    issues.add('reveal-unpinned-cdn', 'info',
      `Reveal.js is loaded from ${shown(ranged.cdn.host, 80)} with the version range ${shown(ranged.cdn.spec ?? '', 40)}. Name an exact version, such as reveal.js@6.0.2.`,
      ranged.url);
  }
  if (version) major = Number(version.split('.')[0]);

  const references = [
    ...page.references.map((reference) => reference.url),
    ...extra.map((reference) => reference.url),
    ...candidate.coreReferences,
  ].map((url) => url.replace(/[?#].*$/s, ''));
  if (major === undefined) {
    if (references.some((url) => /(?:^|\/)dist\/plugin\/[\w-]+(?:\.min)?\.m?js$|(?:^|\/)dist\/reveal\.mjs$/.test(url))) major = 6;
    else if (references.some((url) => /(?:^|\/)js\/reveal(?:\.min)?\.js$|(?:^|\/)css\/reveal(?:\.min)?\.css$|(?:^|\/)lib\/js\/head\.min\.js$/.test(url))) major = 3;
  }
  if (major === 6) {
    const old = references.find((url) => /(?:^|\/)plugin\/(?:markdown|highlight|notes|math|zoom|search)\/[\w.-]+\.m?js$/.test(url)
      && !/(?:^|\/)dist\/plugin\//.test(url));
    if (old) {
      issues.add('reveal-4x-plugin-paths-on-6x-files', 'warning',
        'The deck uses Reveal.js 6 but loads its plugins from the Reveal.js 4 and 5 paths, such as plugin/notes/notes.js. Reveal.js 6 keeps them at dist/plugin/notes.js.',
        old);
    }
  }
  if (major !== undefined && major < 4) {
    issues.add('reveal-old-version', 'warning',
      `This deck was made for Reveal.js ${major}. It plays with a newer Reveal.js, and some old plugins may not work. Ask for a deck made with Reveal.js 6.`,
      page.path);
  }

  const math = mathPlugin(candidate.initScript, candidate.inline);
  if (math && math !== 'katex') {
    issues.add('reveal-mathjax', 'warning',
      'The deck typesets mathematics with MathJax, which Reveal.js downloads from the internet while the deck plays. Use the RevealMath.KaTeX plugin instead.',
      page.path);
  }
  inlineHandlerIssue(page, issues);
  const usesExternalMarkdown = page.references.some((reference) => reference.kind === 'markdown');
  const usesEsModules = page.scripts.some((script) => script.type === 'module');
  const flags: DeckDetection['flags'] = { revealFromCdn, usesExternalMarkdown, usesEsModules };
  if (major !== undefined && Number.isFinite(major)) flags.revealMajor = major;
  if (math) flags.mathPlugin = math;
  return {
    kind: 'reveal', entry: page.path, engine: 'reveal', ...(version ? { engineVersion: version } : {}),
    ...titleOf(page), issues: issues.list(), flags,
  };
}

const titleOf = (page: PageScan): { title?: string } => {
  const title = cleanReportedText(page.title ?? '', 200);
  return title ? { title } : {};
};

/* ---------------------------------------------------------------- Slidev */

function slidevRouter(files: DeckFiles, entryChunk: string): DeckDetection['flags']['slidevRouter'] {
  const code = readText(files, entryChunk);
  if (!code) return undefined;
  const call = /\bhistory\s*:\s*([\w$]{1,40})\s*\(/.exec(code);
  if (call) {
    const name = call[1];
    let body: string | undefined;
    for (const match of braceLists(code, 'import', 6000, ROUTER_SEARCH_LIMIT)) {
      const from = /^\s*from\s*["'`]([^"'`]{1,300})["'`]/.exec(code.slice(match.end, match.end + 320));
      if (!from) continue;
      const binding = bindingsOf(match.inner).find((parts) => (parts[1] ?? parts[0]) === name);
      if (!binding) continue;
      const chunk = resolvePath(entryChunk, from[1]);
      const library = chunk ? readText(files, chunk) : undefined;
      const list = library ? braceLists(library, 'export', 20000, library.length).next() : undefined;
      const exported = list && !list.done ? bindingsOf(list.value.inner).find((parts) => (parts[1] ?? parts[0]) === binding[0]) : undefined;
      if (library && exported) body = functionBody(library, exported[0]);
      break;
    }
    body ??= functionBody(code, name);
    if (body) {
      if (/\blocation\.host\b/.test(body) && /#/.test(body)) return 'hash';
      if (/\[\[\s*(?:``|""|'')\s*,\s*\{\s*\}\s*\]\]/.test(body)) return 'memory';
      if (/\bhistory\.go\(|\bpauseListeners\b/.test(body)) return 'history';
    }
  }
  const declared = /["']?routerMode["']?\s*:\s*["'`](history|hash|memory)["'`]/.exec(code)?.[1];
  return declared as DeckDetection['flags']['slidevRouter'];
}

/** Import lists sit at the top of a module; the rest of a large entry chunk is not searched for them. */
const ROUTER_SEARCH_LIMIT = 200_000;

/**
 * Each `keyword { … }` in code whose keyword starts before `limit` and whose
 * list is at most maxInner characters, found in one forward pass. (A pattern
 * such as /import\s*\{([^}]{0,6000})\}/ re-read up to 6,000 characters for
 * every `import{` without a closing brace.)
 */
function* braceLists(code: string, keyword: string, maxInner: number, limit: number): Generator<{ inner: string; end: number }> {
  let nextClose = -1;
  for (let at = code.indexOf(keyword); at >= 0 && at < limit; at = code.indexOf(keyword, at + keyword.length)) {
    let open = at + keyword.length;
    while (open < code.length && /\s/.test(code[open]) && open - at < 200) open += 1;
    if (code[open] !== '{') continue;
    if (nextClose <= open) nextClose = code.indexOf('}', open);
    if (nextClose < 0) return;
    if (nextClose - open - 1 > maxInner) continue;
    yield { inner: code.slice(open + 1, nextClose), end: nextClose + 1 };
  }
}

/** `a, b as c` → [['a'], ['b', 'c']]. */
function bindingsOf(list: string): string[][] {
  return list.split(',').map((part) => {
    const words = part.trim().split(/\s+/);
    return words.length === 3 && words[1] === 'as' ? [words[0], words[2]] : [words.join(' ')];
  });
}

/** The source of a named function, found by matching braces (strings skipped), at most 4,000 characters. */
function functionBody(code: string, name: string): string | undefined {
  const escaped = name.replace(/[$]/g, '\\$');
  const start = code.search(new RegExp(`function\\s+${escaped}\\s*\\(`));
  if (start < 0) return undefined;
  const params = /\)\s*\{/.exec(code.slice(start, start + 2000));
  if (!params) return undefined;
  const open = start + params.index + params[0].length - 1;
  const end = Math.min(code.length, open + 4000);
  let depth = 0;
  for (let at = open; at < end; at += 1) {
    const char = code[at];
    if (char === '"' || char === "'" || char === '`') {
      const close = code.indexOf(char, at + 1);
      if (close < 0) break;
      at = close;
    } else if (char === '{') depth += 1;
    else if (char === '}' && (depth -= 1) === 0) return code.slice(start, at + 1);
  }
  return code.slice(start, end);
}

/**
 * A Vite worker chunk: `name.worker-hash.js`, or a name with "worker" in it and
 * a hash of six or more characters after a later dash. Checked in code on the
 * last path segment (the equivalent pattern backtracked heavily on long names).
 */
function isWorkerChunk(path: string): boolean {
  const name = path.slice(path.lastIndexOf('/') + 1);
  if (/\.worker-[\w-]+\.m?js$/i.test(name)) return true;
  const stem = /^([\w-]+)\.m?js$/i.exec(name)?.[1];
  if (!stem) return false;
  const worker = stem.toLowerCase().indexOf('worker');
  const dash = worker < 0 ? -1 : stem.indexOf('-', worker + 6);
  return dash >= 0 && stem.length - dash - 1 >= 6;
}

function detectSlidevBuild(files: DeckFiles, page: PageScan, issues: IssueList): DeckDetection {
  const root = dirOf(page.path);
  const inRoot = [...files.keys()].filter((path) => path.startsWith(root));
  const flags: DeckDetection['flags'] = {
    slidevHasMonaco: inRoot.some((path) => /(?:^|\/)assets\/monaco\//.test(path.slice(root.length))),
    slidevHasWorkers: inRoot.some(isWorkerChunk),
  };
  const entryScript = page.scripts.find((script) => script.type === 'module' && script.src && urlKind(script.src) === 'local');
  if (entryScript?.src) {
    const match = /^(.*?)assets\/([^/?#]+\.m?js)(?:[?#].*)?$/s.exec(entryScript.src);
    if (match) {
      flags.slidevBase = cleanReportedText(match[1], 200) || './';
      const chunk = root + 'assets/' + match[2];
      if (files.has(chunk)) {
        const router = slidevRouter(files, chunk);
        if (router) flags.slidevRouter = router;
      }
    }
  }
  const elsewhere = [...files.keys()].filter((path) => !path.startsWith(root) && !IGNORED_FOLDER.test(path));
  if (elsewhere.some((path) => /(?:^|\/)slides\.md$/i.test(path)) || elsewhere.some((path) => /(?:^|\/)package\.json$/.test(path) && slidevPackage(files, path))) {
    flags.hasSource = true;
    issues.add('slidev-build-with-source', 'info',
      `Playing the built presentation in ${shown(root || 'the top folder', 80)}. The source project next to it is kept, but playback uses the build.`,
      page.path);
  }
  let version: string | undefined;
  const declared = page.slidevVersion?.trim() ?? '';
  if (/^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[\w.]{1,30})?$/.test(declared)) version = declared;
  else {
    issues.add('slidev-version-unknown', 'warning',
      'This looks like a Slidev build, but it does not say which Slidev version made it. Builds from Slidev 0.49 or newer say so; older builds may not play.',
      page.path);
  }
  if (flags.slidevHasMonaco) {
    issues.add('slidev-monaco', 'warning',
      'The build includes the Monaco code editor, which cannot run in the player. Code blocks that use it will not be editable or runnable.',
      root + 'assets/monaco/');
  }
  const base = flags.slidevBase?.startsWith('/') ? flags.slidevBase : undefined;
  checkReferences(files, page, issues, [], { revealDeck: false, ...(base ? { absoluteBase: { base, root } } : {}) });
  return {
    kind: 'slidev-build', entry: page.path, engine: 'slidev', ...(version ? { engineVersion: version } : {}),
    ...titleOf(page), issues: issues.list(), flags,
  };
}

function slidevPackage(files: DeckFiles, path: string): boolean {
  const text = readText(files, path);
  if (!text || text.length > 1024 * 1024) return false;
  try {
    const manifest = JSON.parse(text) as Record<string, unknown>;
    const deps = { ...(manifest.devDependencies as object | undefined), ...(manifest.dependencies as object | undefined) } as Record<string, unknown>;
    const scripts = manifest.scripts && typeof manifest.scripts === 'object' ? Object.values(manifest.scripts).filter((value) => typeof value === 'string').join('\n') : '';
    return '@slidev/cli' in deps || /(?:^|[\s&|;(])(?:npx\s+)?slidev(?:\s|$)/m.test(scripts);
  } catch { return false; }
}

const HEADMATTER_KEYS = ['theme', 'addons', 'layout', 'transition', 'mdc', 'comark', 'drawings', 'fonts', 'routerMode',
  'canvasWidth', 'aspectRatio', 'highlighter', 'lineNumbers', 'colorSchema', 'titleTemplate', 'themeConfig', 'monaco',
  'twoslash', 'seoMeta', 'presenter', 'download', 'exportFilename', 'defaults', 'background', 'clicks', 'info'];
const SLIDEV_SYNTAX = [/<v-clicks?\b/i, /\bv-click\b/, /\bv-motion\b/, /\bv-mark\b/, /\bv-drag\b/, /^::\s*[\w-]{1,40}\s*::\s*$/m,
  /```[\w-]{0,40}\s*\{monaco[\w-]{0,20}\}/, /^<<<\s+\S/m, /\$slidev\b/, /````md\s+magic-move/, /^src:\s*\S{1,200}\.md\s*$/m,
  /<(?:Toc|Tweet|Youtube|SlidevVideo|Arrow|AutoFitText|LightOrDark|RenderWhen|Transform|VDragArrow|PoweredBySlidev|SlideCurrentNo|SlidesTotal)\b/];

function slidevMarkdownScore(text: string, path: string): { score: number; title?: string } {
  const head = /^﻿?---\r?\n([\s\S]{0,20000}?)\r?\n---/.exec(text)?.[1] ?? '';
  if (/^marp:\s*true/m.test(head)) return { score: -10 };
  const keys = HEADMATTER_KEYS.filter((key) => new RegExp(`^${key}:`, 'm').test(head)).length;
  const syntax = SLIDEV_SYNTAX.filter((pattern) => pattern.test(text)).length;
  const title = /^title:\s*["']?(.{1,200}?)["']?\s*$/m.exec(head)?.[1] ?? /^#\s+(.{1,200})$/m.exec(text)?.[1];
  return { score: keys + 2 * syntax + (/(?:^|\/)slides\.md$/i.test(path) ? 1 : 0), title };
}

function detectSlidevSource(files: DeckFiles, paths: string[], issues: IssueList): DeckDetection | undefined {
  const manifest = paths.filter((path) => /(?:^|\/)package\.json$/.test(path)).sort(byDepth).find((path) => slidevPackage(files, path));
  const markdown = paths.filter((path) => /\.md$/i.test(path) && !/(?:^|\/)(?:readme|changelog|license)[\w.-]*$/i.test(path)).sort(byDepth).slice(0, 12);
  let best: { path: string; score: number; title?: string } | undefined;
  for (const path of markdown) {
    const text = readText(files, path);
    if (!text) continue;
    const result = slidevMarkdownScore(text, path);
    const preferred = manifest && path === dirOf(manifest) + 'slides.md' ? 5 : 0;
    if (!best || result.score + preferred > best.score) best = { path, score: result.score + preferred, title: result.title };
  }
  if (!manifest && !(best && best.score >= 4)) return undefined;
  const entry = best && best.score > 0 ? best.path : undefined;
  issues.add('slidev-source', 'error',
    `This is the source of a Slidev presentation${entry ? ` (${shown(entry, 80)})` : ''}, which has to be built before it can play. Run "npx slidev build" in the project and open a ZIP of the dist folder here, or ask the AI tool for the built presentation.`,
    entry ?? manifest);
  const title = cleanReportedText(best?.title ?? '', 200);
  return {
    kind: 'slidev-source', ...(entry ? { entry } : {}), engine: 'slidev', ...(title ? { title } : {}),
    issues: issues.list(), flags: {},
  };
}

/* ------------------------------------------------------------ Entry point */

/** Classify deck files and report what playback will need. Never throws for any input. */
export function detectDeck(files: DeckFiles): DeckDetection {
  const issues = new IssueList();
  try {
    return classify(files, issues);
  } catch {
    // Parsing is designed not to throw; this guard keeps a surprise from blocking import.
    issues.add('detection-failed', 'warning', 'The files could not be examined completely.');
    return { kind: 'unknown', issues: issues.list(), flags: {} };
  }
}

function classify(files: DeckFiles, issues: IssueList): DeckDetection {
  if (files.has('qft-presentation.json')) return { kind: 'qft-presentation', issues: [], flags: {} };
  if (files.has('qft.json')) return { kind: 'markdown-bundle', issues: [], flags: {} };

  const paths = [...files.keys()].filter((path) => !IGNORED_FOLDER.test(path));
  const htmlPaths = paths.filter((path) => HTML_FILE.test(path)).sort(byDepth);
  const pages: PageScan[] = [];
  const tooLarge = new Set<string>();
  for (const path of htmlPaths) {
    const bytes = files.get(path)!;
    if (bytes.length > DECK_DETECT_LIMITS.htmlBytes) {
      tooLarge.add(path);
      issues.add('page-too-large', 'info', `${shown(path, 80)} is too large to examine and was skipped.`, path);
      continue;
    }
    if (pages.length >= DECK_DETECT_LIMITS.htmlFiles) break;
    const text = decodeText(bytes, path);
    if (tooManyTags(text)) {
      tooLarge.add(path);
      issues.add('page-too-large', 'info', `${shown(path, 80)} has too many elements to examine and was skipped.`, path);
      continue;
    }
    // Only pages that could be a deck are parsed here; a plain page is parsed later if it is the entry.
    if (/slidev:version|\breveal\b|\bslides\b|\bid\s*=\s*["']?app\b/i.test(text) || /^index\.html?$/i.test(nameOf(path))) {
      pages.push(scanPage(path, text));
    }
  }

  // A Slidev build: the version meta (or the app root with Slidev's own assets) next to assets/*.js.
  for (const page of pages) {
    if (nameOf(page.path).toLowerCase() !== 'index.html') continue;
    const root = dirOf(page.path);
    const hasScripts = paths.some((path) => path.startsWith(root + 'assets/') && /\.m?js$/i.test(path));
    if (!hasScripts) continue;
    const structural = page.appRoot && paths.some((path) => path.startsWith(root + 'assets/slidev/'));
    if (page.slidevVersion !== undefined || structural) return detectSlidevBuild(files, page, issues);
  }

  const candidates = pages.map(revealCandidate)
    .sort((left, right) => right.score - left.score || byDepth(left.page.path, right.page.path));
  const decks = candidates.filter(isRevealDeck);
  if (decks.length) return detectReveal(files, decks[0], decks.slice(1), issues);

  const source = detectSlidevSource(files, paths, issues);
  if (source) return source;

  // Any other page: an index.html at the shallowest level, or the only HTML file. A README never wins.
  const usable = htmlPaths.filter((path) => !tooLarge.has(path) && !README.test(nameOf(path)) && !REVEAL_HELPER_PAGE.test(path));
  const indexes = usable.filter((path) => /^index\.html?$/i.test(nameOf(path)));
  const top = indexes.filter((path) => depthOf(path) === depthOf(indexes[0]));
  const entry = top.length === 1 ? top[0] : !indexes.length && usable.length === 1 ? usable[0] : undefined;
  if (entry) {
    const page = pages.find((item) => item.path === entry) ?? scanPage(entry, decodeText(files.get(entry)!, entry));
    if (page.revealRoot) {
      issues.add('reveal-markup-without-script', 'info',
        'The page has Reveal.js slide markup but never loads or starts Reveal.js, so it is shown as an ordinary page. Add the Reveal.js script and a Reveal.initialize() call.',
        page.path);
    }
    checkReferences(files, page, issues, [], { revealDeck: false });
    inlineHandlerIssue(page, issues);
    return { kind: 'html', entry: page.path, engine: 'html', ...titleOf(page), issues: issues.list(), flags: {} };
  }

  // The shapes the workspace's Markdown importer accepts: exactly one Markdown document.
  const markdown = [...files.keys()].filter((path) => /\.(?:md|markdown)$/i.test(path));
  if (markdown.length === 1) return { kind: 'markdown-bundle', entry: markdown[0], issues: issues.list(), flags: {} };
  if (usable.length > 1) {
    issues.add('several-pages', 'info',
      'This ZIP holds several HTML pages and none of them is clearly the main one. Name the page to open index.html and put it at the top of the ZIP.');
  } else {
    issues.add('no-deck-found', 'info',
      'No presentation was found. Expected an HTML page made with Reveal.js, a Slidev build, or a portable presentation package.');
  }
  return { kind: 'unknown', issues: issues.list(), flags: {} };
}

function inlineHandlerIssue(page: PageScan, issues: IssueList): void {
  if (!page.inlineHandlers) return;
  issues.add('inline-event-handler', 'warning',
    `${page.inlineHandlers} ${page.inlineHandlers === 1 ? 'element uses an attribute' : 'elements use attributes'} such as onclick to run code. The player blocks these; attach handlers with addEventListener in a script instead.`,
    page.path);
}
