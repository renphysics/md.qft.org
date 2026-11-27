/**
 * Libraries that decks load from a CDN or expect beside their HTML, and the
 * copies of them that this site bundles. Everything here is pure: it maps
 * URLs and deck paths to files of the bundled distributions. Reading those
 * files is the job of a VendorProvider: deck-vendor-browser.ts on the site,
 * tests/helpers/deck-vendor-node.ts in unit tests.
 */
export type VendorLibrary = 'reveal.js' | 'katex';

/** Versions of the bundled distributions; tests compare them with node_modules. */
export const BUNDLED_VERSIONS: Readonly<Record<VendorLibrary, string>> = Object.freeze({
  'reveal.js': '6.0.2',
  katex: '0.19.1',
});

/** A file of a bundled library, as a path inside its npm package. */
export interface VendorFile {
  library: VendorLibrary;
  path: string;
}

/** Reads bundled library files. Nothing is ever fetched from a third party. */
export interface VendorProvider {
  /** Text of a bundled script or stylesheet; undefined when it is not bundled. */
  text(file: VendorFile): Promise<string | undefined>;
  /** Bytes of a bundled binary file (fonts); undefined when it is not bundled. */
  bytes(file: VendorFile): Promise<Uint8Array | undefined>;
}

export const REVEAL_THEMES = Object.freeze([
  'beige', 'black', 'black-contrast', 'blood', 'dracula', 'league', 'moon', 'night',
  'serif', 'simple', 'sky', 'solarized', 'white', 'white-contrast',
] as const);

export const REVEAL_PLUGINS = Object.freeze(['markdown', 'highlight', 'notes', 'math', 'search', 'zoom'] as const);
export type RevealPlugin = typeof REVEAL_PLUGINS[number];

/** The global each classic plugin script defines. */
export const REVEAL_PLUGIN_GLOBALS: Readonly<Record<RevealPlugin, string>> = Object.freeze({
  markdown: 'RevealMarkdown',
  highlight: 'RevealHighlight',
  notes: 'RevealNotes',
  math: 'RevealMath',
  search: 'RevealSearch',
  zoom: 'RevealZoom',
});

/**
 * Text files the site bundles. Reveal's math plugin is deliberately absent:
 * it loads MathJax or KaTeX from a CDN at run time, so the linker replaces it
 * with a stand-in that typesets with the bundled KaTeX.
 */
export const BUNDLED_TEXT_FILES: Readonly<Record<VendorLibrary, readonly string[]>> = Object.freeze({
  'reveal.js': Object.freeze([
    'dist/reveal.js', 'dist/reset.css', 'dist/reveal.css',
    ...REVEAL_THEMES.map((theme) => `dist/theme/${theme}.css`),
    ...REVEAL_PLUGINS.filter((plugin) => plugin !== 'math').map((plugin) => `dist/plugin/${plugin}.js`),
    'dist/plugin/highlight/monokai.css', 'dist/plugin/highlight/zenburn.css',
  ]),
  katex: Object.freeze([
    'dist/katex.min.js', 'dist/katex.min.css',
    'dist/contrib/auto-render.min.js', 'dist/contrib/mhchem.min.js', 'dist/contrib/copy-tex.min.js',
  ]),
});

const KATEX_FONT = /^dist\/fonts\/KaTeX_[A-Za-z0-9]+-[A-Za-z0-9]+\.woff2$/;

/** True for files a provider may serve: the text list above and KaTeX's woff2 fonts. */
export function isBundledFile(file: VendorFile): boolean {
  if (file.library === 'katex' && KATEX_FONT.test(file.path)) return true;
  return (BUNDLED_TEXT_FILES[file.library] ?? []).includes(file.path);
}

/** Text files are served as text, fonts as bytes. */
export function isBundledTextFile(file: VendorFile): boolean {
  return (BUNDLED_TEXT_FILES[file.library] ?? []).includes(file.path);
}

export function vendorFileKey(file: VendorFile): string {
  return `${file.library}/${file.path}`;
}

/**
 * What a script, stylesheet or font reference stands for.
 *  - reveal-core, reveal-style, reveal-theme, reveal-plugin, highlight-theme:
 *    files of the bundled Reveal.js;
 *  - reveal-math: Reveal's math plugin, which the linker replaces;
 *  - katex, katex-style, katex-extension, katex-font: files of the bundled KaTeX;
 *  - not-needed: files of older layouts that the bundled version builds in
 *    (head.js, marked.js, print stylesheets, separate theme fonts).
 */
export type LibraryRole =
  | 'reveal-core' | 'reveal-style' | 'reveal-theme' | 'reveal-plugin' | 'reveal-math' | 'highlight-theme'
  | 'katex' | 'katex-style' | 'katex-extension' | 'katex-font' | 'not-needed';

export interface LibraryReference {
  library: VendorLibrary;
  role: LibraryRole;
  /** Bundled files to use instead, in load order; empty when nothing needs loading. */
  files: string[];
  /** The global its classic script defines, for ES-module imports of it. */
  global?: string;
  plugin?: RevealPlugin;
  /** The reference named an ES-module build. */
  module?: boolean;
  /** The version written in a CDN URL ('5.2.1', '^4', 'latest'); '' when it names none; absent for deck paths. */
  requested?: string;
  /** The CDN host, for URLs. */
  host?: string;
}

type FileMatch = Omit<LibraryReference, 'library' | 'requested' | 'host'>;

const stripMin = (path: string) => path.replace(/\.min\.(m?js|css)$/i, '.$1');

const core = (module: boolean): FileMatch => ({ role: 'reveal-core', files: ['dist/reveal.js'], global: 'Reveal', module });
const notNeeded = (): FileMatch => ({ role: 'not-needed', files: [] });

function revealPlugin(name: string): FileMatch | undefined {
  const plugin = name === 'zoom-js' ? 'zoom' : name;
  if (!(REVEAL_PLUGINS as readonly string[]).includes(plugin)) return undefined;
  const id = plugin as RevealPlugin;
  if (id === 'math') return { role: 'reveal-math', files: [], global: REVEAL_PLUGIN_GLOBALS.math, plugin: id };
  return { role: 'reveal-plugin', files: [`dist/plugin/${id}.js`], global: REVEAL_PLUGIN_GLOBALS[id], plugin: id };
}

/**
 * A path inside the reveal.js package, in any of its layouts: 3.x (js/, css/,
 * lib/, plugin/<name>/<name>.js), 4.x and 5.x (dist/, plugin/<name>/<name>.js,
 * .esm.js), 6.x (dist/plugin/<name>.js, .mjs), the package's export names
 * (plugin/markdown, theme/black.css), and with `flat`, the cdnjs layout that
 * drops dist/ (reveal.min.js, theme/black.min.css, plugin/markdown.min.js).
 */
export function revealPackageFile(rest: string, flat = false): FileMatch | undefined {
  let path = stripMin(rest.replace(/^\.?\/+/, '').replace(/\/+$/, ''));
  const module = /\.(?:esm\.js|mjs)$/i.test(path);
  if (flat && (/^(?:reveal|reset)\.(?:css|js)$|^reveal\.(?:esm\.js|mjs)$/i.test(path) || /^theme\//i.test(path))) path = `dist/${path}`;
  const lower = path.toLowerCase();
  if (lower === '' || lower === 'dist/reveal.js' || lower === 'js/reveal.js' || lower === 'dist/reveal.esm.js'
    || lower === 'dist/reveal.mjs' || lower === 'reveal.js' || lower === 'reveal.mjs' || lower === 'reveal.esm.js') {
    return core(module);
  }
  if (lower === 'dist/reveal.css' || lower === 'reveal.css') return { role: 'reveal-style', files: ['dist/reveal.css'] };
  // 3.x shipped its reset inside reveal.css; 4.x moved it to reset.css.
  if (lower === 'css/reveal.css') return { role: 'reveal-style', files: ['dist/reset.css', 'dist/reveal.css'] };
  if (lower === 'dist/reset.css' || lower === 'reset.css') return { role: 'reveal-style', files: ['dist/reset.css'] };
  if (/^(?:dist\/)?theme\/fonts\/|^lib\/font\//.test(lower)) return notNeeded();
  const theme = /^(?:dist\/|css\/)?theme\/([a-z0-9_-]+)\.css$/.exec(lower);
  if (theme) {
    const name = theme[1] === 'white_contrast_compact_verbatim_headers' ? 'white-contrast' : theme[1];
    return (REVEAL_THEMES as readonly string[]).includes(name) ? { role: 'reveal-theme', files: [`dist/theme/${name}.css`] } : undefined;
  }
  const highlight = /^(?:(?:dist\/)?plugin\/highlight|lib\/css)\/(monokai|zenburn)\.css$/.exec(lower);
  if (highlight) return { role: 'highlight-theme', files: [`dist/plugin/highlight/${highlight[1]}.css`] };
  if (/^lib\/js\/(?:head|classlist|html5shiv)\.js$/.test(lower) || /^css\/print\/(?:pdf|paper)\.css$/.test(lower)) return notNeeded();
  const plugin = /^(?:dist\/)?plugin\/([a-z-]+)(?:\.(?:esm\.js|mjs|js))?(?:\/([a-z.-]+))?$/.exec(lower);
  if (plugin) {
    const [, name, file] = plugin;
    if (file === undefined) {
      const match = revealPlugin(name);
      return match && { ...match, module };
    }
    if (!/\.m?js$/.test(file)) return undefined;
    const stem = file.replace(/\.(?:esm\.js|mjs|js)$/, '');
    if (name === 'markdown' && stem === 'marked') return notNeeded();
    if (name === 'print-pdf' && stem === 'print-pdf') return notNeeded();
    if (stem === name || stem === 'plugin' || stem === 'index' || (name === 'zoom-js' && stem === 'zoom')) {
      const match = revealPlugin(name);
      return match && { ...match, module: module || stem === 'plugin' };
    }
  }
  return undefined;
}

/** A path inside the katex package (with or without its dist/ folder). */
export function katexPackageFile(rest: string): FileMatch | undefined {
  const path = rest.replace(/^\.?\/+/, '').replace(/\/+$/, '').replace(/^dist\//i, '');
  const module = /\.mjs$/i.test(path);
  const lower = stripMin(path).toLowerCase();
  if (lower === '' || lower === 'katex.js' || lower === 'katex.mjs') return { role: 'katex', files: ['dist/katex.min.js'], global: 'katex', module };
  if (lower === 'katex.css') return { role: 'katex-style', files: ['dist/katex.min.css'] };
  const extension = /^contrib\/(auto-render|mhchem|copy-tex)(?:\.m?js)?$/.exec(lower);
  if (extension) {
    return {
      role: 'katex-extension', files: [`dist/contrib/${extension[1]}.min.js`], module,
      ...(extension[1] === 'auto-render' ? { global: 'renderMathInElement' } : {}),
    };
  }
  const font = /^fonts\/(katex_[a-z0-9]+-[a-z0-9]+)\.(?:woff2|woff|ttf)$/i.exec(path);
  if (font) {
    const name = path.slice(6).replace(/\.(?:woff2|woff|ttf)$/i, '');
    return { role: 'katex-font', files: [`dist/fonts/${name}.woff2`] };
  }
  return undefined;
}

function decodePath(path: string): string {
  try { return decodeURIComponent(path); } catch { return path; }
}

interface PackageLocation { name: string; version: string; rest: string; flat: boolean; module: boolean }

/** Package name, version and file of a CDN URL, for the CDNs decks use. */
function packageLocation(host: string, pathname: string, search: string): PackageLocation | undefined {
  // Old Pandoc output writes "reveal.js@^4//dist/..."; browsers send the double slash.
  const path = decodePath(pathname).replace(/\/{2,}/g, '/');
  const npm = (value: string, module: boolean, flat = false): PackageLocation | undefined => {
    const match = /^((?:@[^/@]+\/)?[^/@]+)(?:@([^/]*))?(?:\/(.*))?$/.exec(value);
    if (!match) return undefined;
    let rest = match[3] ?? '';
    let esm = module;
    if (/(?:^|\/)\+esm$/.test(rest)) { rest = rest.replace(/\/?\+esm$/, ''); esm = true; }
    return { name: match[1].toLowerCase(), version: match[2] ?? '', rest, flat, module: esm };
  };
  if (host === 'jsdelivr.net' || host.endsWith('.jsdelivr.net')) {
    if (path.startsWith('/npm/')) return npm(path.slice(5), false);
    const github = /^\/gh\/(?:hakimel\/reveal\.js|katex\/katex)(?:@([^/]*))?(?:\/(.*))?$/i.exec(path);
    if (github) {
      return { name: /reveal/i.test(path) ? 'reveal.js' : 'katex', version: github[1] ?? '', rest: github[2] ?? '', flat: false, module: false };
    }
    return undefined;
  }
  if (host === 'unpkg.com' || host === 'www.unpkg.com') return npm(path.slice(1), /(?:^|[?&])module(?:[=&]|$)/.test(search));
  if (host === 'cdnjs.cloudflare.com') {
    const match = /^\/ajax\/libs\/([^/]+)\/([^/]+)\/(.*)$/.exec(path);
    return match ? { name: match[1].toLowerCase(), version: match[2], rest: match[3], flat: true, module: false } : undefined;
  }
  if (host === 'esm.sh' || host === 'cdn.esm.sh') {
    const value = path.slice(1).replace(/^(?:v\d+|stable)\//, '');
    const location = npm(value, true);
    if (location) location.rest = location.rest.replace(/^(?:es20\d\d|esnext|denonext|deno|node)\//, '');
    return location;
  }
  if (host === 'cdn.skypack.dev') return npm(path.slice(1), true);
  if (host === 'ga.jspm.io' || host === 'jspm.dev' || host === 'dev.jspm.io') return npm(path.slice(1).replace(/^npm:/, ''), true);
  return undefined;
}

/** The bundled equivalent of a CDN URL for Reveal.js or KaTeX, if there is one. */
export function mapLibraryUrl(url: string): LibraryReference | undefined {
  const value = url.trim();
  let parsed: URL;
  try { parsed = new URL(value.startsWith('//') ? `https:${value}` : value); }
  catch { return undefined; }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined;
  const host = parsed.hostname.toLowerCase();
  const location = packageLocation(host, parsed.pathname, parsed.search);
  if (!location) return undefined;
  let match: FileMatch | undefined;
  let library: VendorLibrary;
  if (location.name === 'reveal.js') {
    library = 'reveal.js';
    match = revealPackageFile(location.rest, location.flat);
  } else if (location.name === 'katex') {
    library = 'katex';
    match = katexPackageFile(location.rest);
  } else return undefined;
  if (!match) return undefined;
  return { library, ...match, module: Boolean(match.module || location.module), requested: location.version, host };
}

/** Folders and file name of the deepest Reveal.js file a deck path can name (dist/theme/fonts/<font>/<file>, with room to spare). */
const MAX_LIBRARY_DEPTH = 8;

/**
 * The bundled equivalent of a deck path that the deck does not contain, such
 * as dist/reveal.js, plugin/notes/notes.js or vendor/katex/katex.min.js. Only
 * paths in a recognised library layout match; a missing css/style.css does not.
 */
export function mapLibraryPath(path: string): LibraryReference | undefined {
  const clean = path.replace(/\\/g, '/').replace(/[?#].*$/, '').replace(/^\/+/, '');
  const parts = clean.split('/').filter(Boolean);
  if (!parts.length) return undefined;
  const name = parts[parts.length - 1].toLowerCase();
  const local = (library: VendorLibrary, match: FileMatch | undefined): LibraryReference | undefined =>
    match && { library, ...match, module: Boolean(match.module) };

  // KaTeX: its files have distinctive names wherever a deck keeps them.
  if (/^katex(?:\.min)?\.(?:m?js|css)$/.test(name)) return local('katex', katexPackageFile(name));
  if (/^(?:auto-render|mhchem|copy-tex)(?:\.min)?\.m?js$/.test(name)) return local('katex', katexPackageFile(`contrib/${name}`));
  if (/^katex_[a-z0-9]+-[a-z0-9]+\.(?:woff2|woff|ttf)$/.test(name) && parts.length > 1 && parts[parts.length - 2].toLowerCase() === 'fonts') {
    return local('katex', katexPackageFile(`fonts/${parts[parts.length - 1]}`));
  }
  // Reveal.js: try each tail of the path, longest first, so that
  // vendor/reveal/dist/theme/black.css matches as dist/theme/black.css.
  // Every file of the package is at most a few folders deep: only the last
  // MAX_LIBRARY_DEPTH tails are tried, so a path of thousands of folders
  // costs linear time, not one join per folder.
  for (let index = Math.max(0, parts.length - MAX_LIBRARY_DEPTH); index < parts.length; index += 1) {
    const rest = parts.slice(index).join('/');
    const lower = rest.toLowerCase();
    // Bare names are too generic, except those that name Reveal.js itself.
    if (index === parts.length - 1 && !/^reveal(?:\.min)?\.(?:m?js|css)$|^reveal\.esm(?:\.min)?\.js$/.test(lower)) break;
    const match = revealPackageFile(rest);
    if (match) return local('reveal.js', match);
  }
  return undefined;
}

/**
 * The bundled equivalent of an ES-module specifier: a bare package name
 * ('reveal.js', 'reveal.js/plugin/markdown', 'katex/contrib/auto-render') or
 * a CDN URL. Relative specifiers are resolved by the caller and matched with
 * mapLibraryPath.
 */
export function mapModuleSpecifier(specifier: string): LibraryReference | undefined {
  const value = specifier.trim();
  if (/^(?:https?:)?\/\//i.test(value)) return mapLibraryUrl(value);
  const bare = /^(reveal\.js|katex)(?:\/(.*))?$/i.exec(value);
  if (!bare) return undefined;
  const library: VendorLibrary = bare[1].toLowerCase() === 'katex' ? 'katex' : 'reveal.js';
  const match = library === 'katex' ? katexPackageFile(bare[2] ?? '') : revealPackageFile(bare[2] ?? '');
  return match && { library, ...match, module: true };
}

export interface GlobSources {
  /** Lazy loaders of bundled text files, keyed by any path containing node_modules/<library>/<path>. */
  text: Record<string, () => Promise<unknown>>;
  /** URLs of bundled binary files, keyed the same way. */
  urls: Record<string, string>;
  /** Reads one of the site's own asset URLs. */
  fetchBytes(url: string): Promise<Uint8Array>;
}

/** The library file a module path such as "../../node_modules/katex/dist/katex.min.js" names. */
export function vendorFileFromModulePath(key: string): VendorFile | undefined {
  const match = /(?:^|\/)node_modules\/(reveal\.js|katex)\/(.+)$/.exec(key.replace(/\\/g, '/').replace(/[?#].*$/, ''));
  if (!match) return undefined;
  const file: VendorFile = { library: match[1] as VendorLibrary, path: match[2] };
  return isBundledFile(file) ? file : undefined;
}

/**
 * A provider over bundler-generated loaders (import.meta.glob). Each file is
 * loaded once, when a deck first needs it; failures are not cached.
 */
export function createGlobVendorProvider(sources: GlobSources): VendorProvider {
  const loaders = new Map<string, () => Promise<unknown>>();
  const urls = new Map<string, string>();
  for (const [key, load] of Object.entries(sources.text)) {
    const file = vendorFileFromModulePath(key);
    if (file && isBundledTextFile(file)) loaders.set(vendorFileKey(file), load);
  }
  for (const [key, url] of Object.entries(sources.urls)) {
    const file = vendorFileFromModulePath(key);
    if (file && !isBundledTextFile(file)) urls.set(vendorFileKey(file), url);
  }
  const texts = new Map<string, Promise<string | undefined>>();
  const binaries = new Map<string, Promise<Uint8Array | undefined>>();
  const once = <T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> => {
    let pending = cache.get(key);
    if (!pending) {
      pending = load().catch((error) => { cache.delete(key); throw error; });
      cache.set(key, pending);
    }
    return pending;
  };
  return {
    text(file) {
      const key = vendorFileKey(file);
      const load = loaders.get(key);
      if (!load) return Promise.resolve(undefined);
      return once(texts, key, async () => {
        const value = await load();
        return typeof value === 'string' ? value : undefined;
      });
    },
    bytes(file) {
      const key = vendorFileKey(file);
      const url = urls.get(key);
      if (!url) return Promise.resolve(undefined);
      return once(binaries, key, () => sources.fetchBytes(url));
    },
  };
}
