import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import vm from 'node:vm';
import { parse, type DefaultTreeAdapterTypes } from 'parse5';
import { readDeckArchive } from '../src/lib/deck-archive.ts';
import { detectDeck } from '../src/lib/deck-detect.ts';
import { linkDeck, type LinkOptions, type LinkResult } from '../src/lib/deck-linker.ts';
import { dependencyAdapterSource, escapeScriptText, handlerScriptSource, mathStandInSource } from '../src/lib/deck-linker-runtime.ts';
import { defaultImportBindings, scanModuleImports, scanStringLiterals } from '../src/lib/deck-linker-modules.ts';
import type { DeckDetection, DeckFiles } from '../src/lib/deck-types.ts';
import { FIXTURE_DECKS, loadFixtureDeck, type FixtureDeckName } from './helpers/deck-fixtures.ts';
import { nodeVendorProvider } from './helpers/deck-vendor-node.ts';
import { RESEARCH_DECKS, researchDeck, type ResearchDeckName } from './helpers/deck-corpus.ts';

type Element = DefaultTreeAdapterTypes.Element;
type ChildNode = DefaultTreeAdapterTypes.ChildNode;

const encoder = new TextEncoder();
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

function detection(overrides: Partial<DeckDetection> = {}): DeckDetection {
  return { kind: 'reveal', engine: 'reveal', entry: 'index.html', issues: [], flags: {}, ...overrides };
}

function deck(files: Record<string, string | Uint8Array>): DeckFiles {
  return new Map(Object.entries(files).map(([path, value]) => [path, typeof value === 'string' ? encoder.encode(value) : value]));
}

async function link(files: DeckFiles | Record<string, string | Uint8Array>, options: LinkOptions & { detection?: Partial<DeckDetection> } = {}): Promise<LinkResult> {
  const map = files instanceof Map ? files : deck(files);
  return linkDeck(map, detection(options.detection), nodeVendorProvider(), options);
}

const page = (body: string, head = '') => `<!doctype html><html><head><meta charset="utf-8">${head}</head><body>${body}</body></html>`;
const codes = (result: LinkResult) => result.issues.map((issue) => issue.code);

/* -------------------------------------------- what the player requires */

function elements(html: string): Element[] {
  const result: Element[] = [];
  const stack: ChildNode[] = [...parse(html).childNodes];
  while (stack.length) {
    const node = stack.pop()!;
    if (!('tagName' in node)) continue;
    result.push(node);
    stack.push(...node.childNodes);
    if (node.tagName === 'template') stack.push(...(node as DefaultTreeAdapterTypes.Template).content.childNodes);
  }
  return result;
}

const attr = (element: Element, name: string) => element.attrs.find((a) => (a.prefix ? `${a.prefix}:${a.name}` : a.name) === name)?.value;
const text = (element: Element) => element.childNodes.map((node) => ('value' in node ? node.value : '')).join('');
const REMOTE = /^\s*(?:https?:)?\/\//i;
const ASSET_ATTRIBUTES = ['src', 'href', 'xlink:href', 'poster', 'background', 'data', 'srcset', 'data-src', 'data-background-image',
  'data-background-video', 'data-background', 'data-background-iframe', 'data-preview-image', 'data-preview-video', 'data-preview-link'];

/**
 * The checks of preparePresentationDocument (src/lib/presentation-runtime.ts),
 * and more: no handler attributes at all, and no reference to another host in
 * any position that loads something.
 */
function assertPlayable(html: string, label = 'linked deck'): void {
  assert.ok(html.length > 0 && html.length <= 24 * 1024 * 1024, `${label}: size`);
  for (const element of elements(html)) {
    const name = element.tagName.toLowerCase();
    const where = `${label}: <${name}>`;
    if (name === 'script') {
      assert.equal(attr(element, 'src') ?? attr(element, 'href') ?? attr(element, 'xlink:href'), undefined, `${where} has a separate file`);
      assert.notEqual((attr(element, 'type') ?? '').toLowerCase(), 'importmap', `${where} import map`);
      if ((attr(element, 'type') ?? '').toLowerCase() === 'module') {
        assert.deepEqual(scanModuleImports(text(element)).imports, [], `${where} module still imports`);
      }
    }
    if (name === 'link') assert.ok(!/stylesheet/i.test(attr(element, 'rel') ?? ''), `${where} stylesheet link`);
    assert.ok(!['iframe', 'frame', 'frameset', 'object', 'embed', 'portal', 'base'].includes(name), `${where} is not allowed`);
    if (name === 'meta') assert.equal(attr(element, 'http-equiv'), undefined, `${where} http-equiv`);
    for (const attribute of element.attrs) {
      assert.ok(!/^on/i.test(attribute.name) || attribute.prefix, `${where} handler attribute ${attribute.name}`);
    }
    for (const attribute of ['src', 'href', 'xlink:href', 'poster', 'background', 'data']) {
      const value = (attr(element, attribute) ?? '').trim();
      if (!value || value.startsWith('#') || name === 'a' || name === 'area' || name === 'link') continue;
      assert.match(value, /^data:(?:image\/|audio\/|video\/|font\/|application\/(?:font-|vnd\.ms-fontobject))/i, `${where} ${attribute}=${value.slice(0, 80)}`);
    }
    for (const attribute of ASSET_ATTRIBUTES) {
      if (name === 'a' && attribute === 'href') continue;
      const value = attr(element, attribute) ?? '';
      assert.doesNotMatch(value, REMOTE, `${where} ${attribute} loads from another host`);
    }
    // @namespace names a namespace; it loads nothing.
    const css = (name === 'style' ? text(element) : attr(element, 'style') ?? '').replace(/@namespace[^;]*;/gi, '');
    assert.doesNotMatch(css, /@import\b/i, `${where} keeps an @import`);
    for (const match of css.matchAll(/(?<![\w-])url\(\s*["']?([^"')]*)/gi)) {
      assert.match(match[1], /^(?:data:|#|$)/, `${where} url(${match[1].slice(0, 80)})`);
    }
  }
}

function scripts(html: string): { from?: string; marker?: string; type?: string; code: string }[] {
  return elements(html).reverse().filter((element) => element.tagName === 'script').map((element) => ({
    from: attr(element, 'data-qft-from'), marker: attr(element, 'data-qft-linker'), type: attr(element, 'type'), code: text(element),
  }));
}

/* ------------------------------------------------------------ fixtures */

const EXPECTED: Record<FixtureDeckName, string[]> = {
  'cdn-reveal5-single': ['bundled-library'],
  'cdn-reveal4-cdnjs': ['bundled-library', 'external-font'],
  'cdn-reveal6-unpkg': [],
  'local-project': ['bundled-library'],
  'esm-project': ['bundled-library', 'external-font', 'es-modules-unsupported'],
  'plain-html': [],
  'slidev-source': ['entry-missing'],
  'not-a-deck': ['entry-missing'],
};

describe('linking the test decks', () => {
  it('turns every playable fixture into one document the player accepts, with the expected notes', async () => {
    for (const name of FIXTURE_DECKS) {
      const result = await link(loadFixtureDeck(name));
      assert.deepEqual(codes(result).sort(), [...EXPECTED[name]].sort(), name);
      if (EXPECTED[name].includes('entry-missing')) {
        assert.equal(result.html, '', name);
        continue;
      }
      assertPlayable(result.html, name);
      assert.equal(result.stats.htmlLength, result.html.length);
      assert.equal(result.stats.entry, 'index.html');
    }
  });

  it('links what detection finds, with the same result', async () => {
    for (const name of FIXTURE_DECKS) {
      const files = loadFixtureDeck(name);
      const detected = detectDeck(files);
      if (detected.kind !== 'reveal' && detected.kind !== 'html') continue;
      const result = await linkDeck(files, detected, nodeVendorProvider());
      assertPlayable(result.html, name);
      assert.deepEqual(codes(result).sort(), [...EXPECTED[name]].sort(), name);
      assert.equal(result.html, (await link(files)).html, name);
    }
  });

  it('maps a pinned Reveal.js 5 deck with math, notes and highlighting to the bundled files in order', async () => {
    const result = await link(loadFixtureDeck('cdn-reveal5-single'));
    assert.deepEqual(result.issues, [{
      code: 'bundled-library', severity: 'info', where: 'cdn.jsdelivr.net',
      message: 'Reveal.js 5.2.1 from cdn.jsdelivr.net is replaced by the Reveal.js 6.0.2 built into this site.',
    }]);
    const list = scripts(result.html);
    const order = list.map((script) => script.marker ?? (script.from?.startsWith('katex/') ? script.from : script.from?.replace(/^.*\/(?:dist|plugin)\//, '')) ?? 'inline');
    assert.deepEqual(order, ['reveal.js', 'notes/notes.js', 'katex/dist/katex.min.js', 'katex/dist/contrib/auto-render.min.js', 'math', 'highlight/highlight.js', 'inline']);
    assert.match(list[0].code, /e\.Reveal=t\(\)/);
    assert.match(list[4].code, /qftStandIn/);
    assert.match(list[6].code, /Reveal\.initialize\(\{/);
    assert.ok(result.stats.bundledFiles.includes('reveal.js/dist/theme/white.css'));
    assert.ok(result.stats.bundledFiles.includes('reveal.js/dist/plugin/highlight/monokai.css'));
    // KaTeX's stylesheet comes with its woff2 fonts and nothing else.
    assert.equal((result.html.match(/data:font\/woff2;base64,/g) ?? []).length, 20);
    assert.doesNotMatch(result.html, /KaTeX_[A-Za-z]+-[A-Za-z]+\.(?:woff|ttf)\b/);
  });

  it('converts the inline onclick button and drops the theme web font of a cdnjs Reveal.js 4 deck', async () => {
    const result = await link(loadFixtureDeck('cdn-reveal4-cdnjs'));
    assert.match(result.html, /<button data-qft-on="1">Show answer<\/button>/);
    const handler = scripts(result.html).find((script) => script.marker === 'handlers');
    assert.ok(handler?.code.includes("document.getElementById('answer').textContent = 'Force is mass times acceleration: kg m / s²'"));
    assert.equal(result.stats.convertedHandlers, 1);
    assert.doesNotMatch(result.html, /fonts\.googleapis/);
    assert.match(result.html, /<section data-markdown="">\s*<textarea data-template="">## Units and dimensions/);
    assert.equal(result.issues.find((issue) => issue.code === 'external-font')?.severity, 'info');
  });

  it('supplies the missing Reveal.js files of a local project and inlines everything else it has', async () => {
    const result = await link(loadFixtureDeck('local-project'));
    const html = result.html;
    // External Markdown becomes an inline template with its separators.
    assert.match(html, /<section data-markdown="" data-separator="\^\\n---\\n\$" data-separator-vertical="\^\\n--\\n\$" data-separator-notes="\^Note:"><textarea data-template="">## Optics workshop/);
    assert.match(html, /data-background-image="data:image\/png;base64,/);
    assert.match(html, /<img data-src="data:image\/png;base64,[^"]+" alt="A small test pattern"/);
    // css/custom.css: its @import is flattened in place and its picture embedded.
    const custom = elements(html).find((element) => attr(element, 'data-qft-from') === 'css/custom.css')!;
    assert.match(text(custom), /^\s*\.reveal button \{[\s\S]*\.reveal h2\.on-picture \{\s*background: url\("data:image\/png;base64,/);
    assert.equal(attr(elements(html).find((element) => attr(element, 'data-qft-from') === 'dist/theme/black.css')!, 'id'), 'theme');
    assert.deepEqual(scripts(html).map((script) => script.from ?? 'inline'), ['dist/reveal.js', 'plugin/markdown/markdown.js', 'js/demo.js', 'inline']);
    assert.deepEqual(result.stats.bundledFiles, ['reveal.js/dist/reset.css', 'reveal.js/dist/reveal.css', 'reveal.js/dist/theme/black.css', 'reveal.js/dist/reveal.js', 'reveal.js/dist/plugin/markdown.js']);
    assert.equal(result.stats.embeddedAssets, 1);
    assert.equal(result.stats.inlinedFiles, 4);
    assert.deepEqual(result.stats.largestAssets, [{ path: 'assets/pic.png', bytes: loadFixtureDeck('local-project').get('assets/pic.png')!.length }]);
  });

  it('reports the module deck as not playable instead of guessing', async () => {
    const result = await link(loadFixtureDeck('esm-project'));
    const issue = result.issues.find((item) => item.code === 'es-modules-unsupported');
    assert.equal(issue?.severity, 'error');
    assert.equal(issue?.where, './js/demo.mjs');
    assert.equal(scripts(result.html).length, 0);
    assert.match(result.html, /<button id="add" type="button">Add one<\/button>/);
  });

  it('inlines a plain page with its own stylesheet and script', async () => {
    const result = await link(loadFixtureDeck('plain-html'), { detection: { kind: 'html', engine: 'html' } });
    assert.deepEqual(result.issues, []);
    assert.match(result.html, /<style data-qft-from="style.css">body \{/);
    assert.match(result.html, /<script data-qft-from="app.js">const angle/);
    assert.deepEqual(result.stats.bundledFiles, []);
  });

  it('is deterministic and idempotent', async () => {
    for (const name of FIXTURE_DECKS) {
      const first = await link(loadFixtureDeck(name));
      if (!first.html) continue;
      assert.equal((await link(loadFixtureDeck(name))).html, first.html, `${name}: deterministic`);
      const again = await link({ 'index.html': first.html });
      assert.equal(again.html, first.html, `${name}: idempotent`);
      assert.deepEqual(codes(again).filter((code) => code !== 'es-modules-unsupported'), [], `${name}: nothing new to report`);
    }
  });

  it('links the AI-made research decks without network references', async (t) => {
    for (const name of Object.keys(RESEARCH_DECKS) as ResearchDeckName[]) {
      const file = researchDeck(name);
      if (!file) { t.skip('research archive absent'); return; }
      const archive = await readDeckArchive(file);
      const result = await link(archive.files);
      assertPlayable(result.html, name);
      assert.deepEqual(result.issues.filter((issue) => issue.severity !== 'info'), [], name);
      assert.equal((await link({ 'index.html': result.html })).html, result.html, `${name}: idempotent`);
    }
    const vendored = await link((await readDeckArchive(researchDeck('ai-deck-1-vendored-reveal6')!)).files);
    assert.deepEqual(vendored.stats.bundledFiles, [], 'a deck that brings its own Reveal.js and KaTeX keeps them');
    assert.deepEqual(vendored.issues, []);
    const linked = await link((await readDeckArchive(researchDeck('ai-deck-2-cdn-reveal5')!)).files);
    assert.ok(linked.stats.bundledFiles.includes('katex/dist/katex.min.js'));
    assert.equal(scripts(linked.html).filter((script) => script.marker === 'math').length, 1);
  });
});

/* -------------------------------------------------- Reveal.js versions */

describe('Reveal.js decks of every version', () => {
  it('keeps the Reveal.js files a deck brings', async () => {
    const result = await link({
      'index.html': page('<div class="reveal"><div class="slides"><section>One</section></div></div><script src="dist/reveal.js"></script><script src="plugin/notes/notes.js"></script><script>Reveal.initialize({ plugins: [RevealNotes] });</script>', '<link rel="stylesheet" href="dist/reveal.css">'),
      'dist/reveal.js': 'window.Reveal = { own: true };',
      'dist/reveal.css': '.reveal { --own: 1 }',
      'plugin/notes/notes.js': 'window.RevealNotes = { own: true };',
    });
    assert.deepEqual(result.issues, []);
    assert.deepEqual(result.stats.bundledFiles, []);
    assert.match(result.html, /<script data-qft-from="dist\/reveal.js">window.Reveal = \{ own: true \};<\/script>/);
    assert.match(result.html, /<style data-qft-from="dist\/reveal.css">\.reveal \{ --own: 1 \}<\/style>/);
  });

  it('plays a Reveal.js 3 deck: dependency loader, print stylesheet loader and head.js', async () => {
    const html = page(`<div class="reveal"><div class="slides"><section data-markdown><textarea data-template>## Hi</textarea></section></div></div>
<script src="https://cdn.jsdelivr.net/npm/reveal.js@3.9.2/lib/js/head.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/reveal.js@3.9.2/js/reveal.js"></script>
<script>
  Reveal.initialize({
    math: { config: 'TeX-AMS_HTML-full' },
    dependencies: [
      { src: 'https://cdn.jsdelivr.net/npm/reveal.js@3.9.2/plugin/markdown/marked.js', condition: function() { return !!document.querySelector('[data-markdown]'); } },
      { src: 'https://cdn.jsdelivr.net/npm/reveal.js@3.9.2/plugin/markdown/markdown.js' },
      { src: 'plugin/highlight/highlight.js', async: true, callback: function() { hljs.initHighlightingOnLoad(); } },
      { src: "plugin/math/math.js", async: true },
      { src: 'js/custom-plugin.js', callback: function () { window.customReady = true; } },
      { src: 'plugin/menu/menu.js' }
    ]
  });
</script>`, `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@3.9.2/css/reveal.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@3.9.2/css/theme/black.css" id="theme">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@3.9.2/lib/css/zenburn.css">
<script>
  var link = document.createElement( 'link' );
  link.rel = 'stylesheet';
  link.type = 'text/css';
  link.href = window.location.search.match( /print-pdf/gi ) ? 'css/print/pdf.css' : 'css/print/paper.css';
  document.getElementsByTagName( 'head' )[0].appendChild( link );
</script>`);
    const result = await link({ 'index.html': html, 'js/custom-plugin.js': 'window.CustomPlugin = 1;' });
    assertPlayable(result.html, '3.x deck');
    assert.deepEqual(codes(result).sort(), ['bundled-library', 'bundled-library', 'math-rendered-with-katex', 'missing-file']);
    assert.deepEqual(result.issues.filter((issue) => issue.code === 'bundled-library').map((issue) => issue.where), ['cdn.jsdelivr.net', 'plugin/highlight/highlight.js']);
    assert.equal(result.issues.find((issue) => issue.code === 'missing-file')?.where, 'plugin/menu/menu.js');
    assert.doesNotMatch(result.html, /css\/print\/paper\.css'/, 'the print stylesheet loader is gone');
    const list = scripts(result.html);
    const adapter = list.find((script) => script.marker === 'dependencies')!;
    const init = list.findIndex((script) => /Reveal\.initialize/.test(script.code) && !script.marker);
    assert.equal(list[init - 1], adapter, 'the adapter runs just before Reveal.initialize');
    assert.ok(list.findIndex((script) => script.from === 'js/custom-plugin.js') < init);
    assert.ok(list.some((script) => script.from === 'plugin/highlight/highlight.js'));
    assert.ok(list.some((script) => script.marker === 'math'));
    assert.deepEqual(list.filter((script) => !script.marker && !script.from).length, 1, 'only the deck\'s own inline script remains');
    assert.ok(result.stats.bundledFiles.includes('reveal.js/dist/reset.css'), '3.x reveal.css carried the reset');
    assert.ok(result.stats.bundledFiles.includes('reveal.js/dist/plugin/highlight/zenburn.css'));

    // The adapter, run as the deck would run it.
    const registered: unknown[] = [];
    const context: Record<string, any> = {
      setTimeout, RevealMarkdown: () => ({ id: 'markdown' }), RevealHighlight: () => ({ id: 'highlight' }),
      RevealMath: { id: 'mathjax2' }, document: { querySelector: () => ({}) },
    };
    context.window = context;
    context.Reveal = { initialize(options: { dependencies: unknown[] }) { registered.push(...options.dependencies); return 'started'; } };
    vm.runInNewContext(adapter.code, context);
    vm.runInNewContext(list[init].code.replace(/^\s+/, ''), context);
    assert.deepEqual(JSON.parse(JSON.stringify(registered)), [{ id: 'markdown' }, { id: 'highlight' }, { id: 'mathjax2' }]);
    assert.equal(context.customReady, true, 'callbacks of inlined deck files still run');
  });

  it('replaces every form of the math plugin, local or remote, with one stand-in', async () => {
    const body = (plugin: string, script = 'https://unpkg.com/reveal.js@4.6.1/plugin/math/math.js') => page(
      `<div class="reveal"><div class="slides"><section>$x$</section></div></div><script src="https://unpkg.com/reveal.js@4.6.1/dist/reveal.js"></script><script src="${script}"></script><script>Reveal.initialize({ plugins: [${plugin}] });</script>`);
    for (const [plugin, mathjax] of [['RevealMath.KaTeX', false], ['RevealMath', true], ['RevealMath.MathJax3', true], ['RevealMath.MathJax4', true]] as const) {
      const result = await link({ 'index.html': body(plugin) });
      assert.equal(codes(result).includes('math-rendered-with-katex'), mathjax, plugin);
      assert.equal(scripts(result.html).filter((script) => script.marker === 'math').length, 1, plugin);
      assert.doesNotMatch(result.html, /mathjax@|cdn\.jsdelivr\.net\/npm\/katex/, plugin);
    }
    const local = await link({ 'index.html': body('RevealMath.KaTeX', 'vendor/reveal/plugin/math/math.js'), 'vendor/reveal/plugin/math/math.js': 'window.RevealMath = { mathjax: "loads MathJax" };' });
    assert.doesNotMatch(local.html, /loads MathJax/);
    assert.ok(scripts(local.html).some((script) => script.marker === 'math'));
    const flagged = await link({ 'index.html': body('RevealMath.KaTeX') }, { detection: { flags: { mathPlugin: 'mathjax3' } } });
    assert.ok(codes(flagged).includes('math-rendered-with-katex'), 'the detected flavour wins');
  });

  it('typesets with the delimiters and macros of each math configuration', () => {
    const run = (factory: string, config: unknown) => {
      let options: any;
      const context: Record<string, any> = { document: { readyState: 'complete' }, renderMathInElement: (_root: unknown, value: unknown) => { options = value; } };
      context.window = context;
      vm.runInNewContext(mathStandInSource(), context);
      const source = factory ? context.RevealMath[factory] : () => context.RevealMath;
      const plugin = source();
      let laidOut = false;
      plugin.init({ getConfig: () => config, isReady: () => true, getSlidesElement: () => 'slides', layout: () => { laidOut = true; } });
      assert.ok(laidOut);
      return { id: plugin.id, options: JSON.parse(JSON.stringify(options)) };
    };
    const katex = run('KaTeX', { katex: { delimiters: [{ left: '$', right: '$', display: false }], local: 'x', version: '0.16', macros: { '\\R': '\\mathbb{R}' } } });
    assert.deepEqual(katex, { id: 'katex', options: { throwOnError: false, delimiters: [{ left: '$', right: '$', display: false }], macros: { '\\R': '\\mathbb{R}' }, ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'] } });
    const three = run('MathJax3', { mathjax3: { tex: { inlineMath: [['\\(', '\\)']], macros: { RR: '\\mathbb{R}', bold: ['{\\bf #1}', 1] } } } });
    assert.equal(three.id, 'mathjax3');
    assert.deepEqual(three.options.delimiters, [
      { left: '$$', right: '$$', display: true }, { left: '\\[', right: '\\]', display: true }, { left: '\\(', right: '\\)', display: false }]);
    assert.deepEqual(three.options.macros, { '\\RR': '\\mathbb{R}', '\\bold': '{\\bf #1}' });
    const two = run('', { math: { tex2jax: { inlineMath: [['$', '$']], displayMath: [['$$', '$$']] }, TeX: { Macros: { half: '\\frac12' } } } });
    assert.equal(two.id, 'mathjax2');
    assert.deepEqual(two.options.delimiters, [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }]);
    assert.deepEqual(two.options.macros, { '\\half': '\\frac12' });
  });

  it('maps ES-module imports of Reveal.js and KaTeX to the bundled classic builds', async () => {
    const result = await link({
      'index.html': page(`<div class="reveal"><div class="slides"><section>One</section></div></div>
<script type="importmap">{ "imports": { "reveal": "https://cdn.jsdelivr.net/npm/reveal.js@5.2.1/dist/reveal.esm.js" } }</script>
<script type="module">
  import Reveal from 'reveal';
  import Markdown from 'https://cdn.jsdelivr.net/npm/reveal.js@5.2.1/plugin/markdown/markdown.esm.js';
  import * as Notes from './dist/plugin/notes.mjs';
  import 'reveal.js/dist/reveal.css';
  const label = "import x from 'not-a-module'";
  const deck = new Reveal({ plugins: [Markdown, Notes.default] });
  deck.initialize().then(() => import('reveal.js'));
</script>`),
    });
    assertPlayable(result.html, 'module deck');
    assert.deepEqual(codes(result), ['bundled-library', 'bundled-library']);
    const list = scripts(result.html);
    assert.deepEqual(list.map((script) => script.type ?? script.from), ['https://cdn.jsdelivr.net/npm/reveal.js@5.2.1/dist/reveal.esm.js'.replace(/^.*$/, (value) => value), 'https://cdn.jsdelivr.net/npm/reveal.js@5.2.1/plugin/markdown/markdown.esm.js', 'dist/plugin/notes.js', 'module'].map((value, index) => index < 3 ? list[index].from : value));
    const module = list[list.length - 1].code;
    assert.match(module, /^const Reveal = globalThis\["Reveal"\];\nconst Markdown = globalThis\["RevealMarkdown"\];\nconst Notes = Object\.freeze\(\{ __proto__: null, default: globalThis\["RevealNotes"\] \}\);/);
    assert.match(module, /const label = "import x from 'not-a-module'";/);
    assert.match(module, /\.then\(\(\) => Promise\.resolve\(Object\.freeze\(\{ __proto__: null, default: globalThis\["Reveal"\] \}\)\)\)/);
    assert.ok(result.stats.bundledFiles.includes('reveal.js/dist/reveal.css'));
  });

  it('keeps modules without imports and leaves out those it cannot play', async () => {
    const result = await link({
      'index.html': page(`<script type="module">document.body.dataset.ready = 'yes';</script>
<script type="module">import { createApp } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.js'; createApp({}).mount('#app');</script>
<script type="module" src="js/main.js"></script>
<script nomodule src="legacy.js"></script>
<script>Reveal.initialize();</script>`),
      'js/main.js': "import { a } from './a.js';\nconsole.log(a);",
    });
    assert.deepEqual(result.issues.map(({ code, severity, where }) => [code, severity, where]), [
      ['es-modules-unsupported', 'warning', 'https://unpkg.com/vue@3/dist/vue.esm-browser.js'],
      ['es-modules-unsupported', 'warning', './a.js'],
    ]);
    const list = scripts(result.html);
    assert.deepEqual(list.map((script) => [script.type, script.code]), [['module', "document.body.dataset.ready = 'yes';"], [undefined, 'Reveal.initialize();']]);
  });
});

/* --------------------------------------------------------------- assets */

describe('assets', () => {
  it('embeds pictures, media and backgrounds in every Reveal.js attribute', async () => {
    const files = {
      'index.html': page(`<div class="reveal"><div class="slides">
<section data-background="images/bg.png"><img srcset="images/a.png 1x, images/b.png 2x" alt="a"></section>
<section data-background="#ff0000" data-background-video="media/clip.webm,media/clip.mp4" data-background-video-loop>
  <video poster="images/a.png" data-autoplay><source data-src="media/clip.mp4" type="video/mp4"><track src="subs.vtt" kind="captions"></video>
  <picture><source srcset="images/b.png" type="image/png"><img src="images/a.png" alt="b"></picture>
  <img data-preview-image="images/b.png" src="Images/A.png" alt="case">
  <img src="images/with%20space.png?v=3" alt="encoded">
  <svg><image href="images/a.png" width="1" height="1"></image><use xlink:href="icons.svg#star"></use></svg>
  <div style="background-image: url('images/a.png')">styled</div>
  <object data="images/diagram.svg" type="image/svg+xml" width="200"></object>
</section></div></div>`),
      'images/bg.png': PNG, 'images/a.png': PNG, 'images/b.png': PNG, 'images/with space.png': PNG,
      'media/clip.mp4': Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]),
      'images/diagram.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>',
      'icons.svg': '<svg xmlns="http://www.w3.org/2000/svg"><symbol id="star" viewBox="0 0 1 1"><path d="M0 0h1v1z"/></symbol></svg>',
      'subs.vtt': 'WEBVTT',
    };
    const result = await link(files);
    assertPlayable(result.html, 'assets');
    assert.deepEqual(codes(result), ['captions-left-out'], 'of two video sources, the one in the deck is used');
    const html = result.html;
    assert.match(html, /<section data-background-image="data:image\/png;base64,/);
    assert.match(html, /<section data-background="#ff0000" data-background-video="data:video\/mp4;base64,[^"]+" data-background-video-loop="">/);
    assert.ok(scripts(html)[0].marker === 'media', 'the video helper runs before the deck');
    assert.match(html, /<img alt="a" src="data:image\/png;base64,/);
    assert.match(html, /<video poster="data:image\/png;base64,[^"]+" data-autoplay=""><source data-src="data:video\/mp4;base64,[^"]+" type="video\/mp4"><\/video>/);
    assert.match(html, /<picture><img src="data:image\/png/);
    assert.match(html, /<img data-preview-image="data:image\/png;base64,[^"]+" src="data:image\/png;base64,[^"]+" alt="case">/);
    assert.match(html, /<img src="data:image\/png;base64,[^"]+" alt="encoded">/);
    assert.match(html, /<image href="data:image\/png;base64,/);
    assert.match(html, /<use xlink:href="#qft-sprite-1"><\/use>/);
    assert.match(html, /<symbol id="qft-sprite-1" viewBox="0 0 1 1">/);
    assert.match(html, /style="background-image: url\(&quot;data:image\/png;base64,/);
    assert.match(html, /<img src="data:image\/svg\+xml;base64,[^"]+" alt="" width="200">/);
    assert.equal(result.stats.embeddedAssets, 6, 'Images/A.png is images/a.png, and the sprite is inlined');
  });

  it('replaces what lives on the internet with placeholders and says so', async () => {
    const result = await link({
      'index.html': page(`<div class="reveal"><div class="slides">
<section data-background-image="https://example.org/sky.jpg"><img src="https://upload.example.org/a/b/Double-slit.svg" alt="x"></section>
<section data-background-iframe="https://phet.example.edu/sim.html"><iframe src="https://www.youtube.com/embed/abc" width="560" height="315"></iframe></section>
<section><video src="//cdn.example.com/clip.mp4"></video><a href="https://example.org/" data-preview-link>Open</a></section>
</div></div><script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>`, '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter"><link rel="stylesheet" href="https://example.org/extra.css"><link rel="preconnect" href="https://fonts.gstatic.com"><link rel="icon" href="https://example.org/favicon.ico"><style>@import url("https://fonts.googleapis.com/css?family=Lato"); @font-face { font-family: X; src: url(https://example.org/x.woff2) format("woff2"); } h1 { background: url(https://example.org/h.png) }</style>'),
    });
    assertPlayable(result.html, 'remote');
    assert.deepEqual(result.issues.map(({ code, where }) => `${code} ${where}`).sort(), [
      'embedded-page example.org',
      'embedded-page phet.example.edu',
      'embedded-page www.youtube.com',
      'external-font fonts.googleapis.com',
      'external-font example.org',
      'external-image example.org/h.png',
      'external-image example.org/sky.jpg',
      'external-image upload.example.org/Double-slit.svg',
      'external-library cdn.jsdelivr.net/chart.js@4',
      'external-media cdn.example.com/clip.mp4',
      'external-style example.org/extra.css',
    ].sort());
    assert.match(result.html, /<img src="data:image\/svg\+xml;base64,[^"]+" alt="x">/, 'a remote picture becomes a placeholder');
    assert.match(result.html, /<div role="note" data-qft-placeholder="embedded-page" style="[^"]*;width:560px;height:315px">An embedded page from www\.youtube\.com is not available offline\.<\/div>/);
    assert.match(result.html, /<section><div role="note" data-qft-placeholder="embedded-page"[^>]*>An embedded page from phet\.example\.edu is not available offline\.<\/div>/);
    assert.match(result.html, /h1 \{ background: none \}/);
    assert.doesNotMatch(result.html, /@font-face/);
  });

  it('reports files the deck refers to but does not contain, once each', async () => {
    const result = await link({
      'index.html': page('<img src="missing.png" alt=""><img src="missing.png" alt=""><img src="../outside.png" alt=""><script src="js/gone.js"></script>', '<link rel="stylesheet" href="css/gone.css"><style>body { background: url(missing.png) }</style>'),
    });
    assertPlayable(result.html, 'missing');
    assert.deepEqual(result.issues.map(({ code, where }) => `${code} ${where}`), ['missing-file css/gone.css', 'missing-file missing.png', 'missing-file outside.png', 'missing-file js/gone.js']);
    assert.equal((result.html.match(/Picture not available/g) ?? []).length, 0, 'the placeholder is an image, not text');
    assert.equal((result.html.match(/<img src="data:image\/svg\+xml;base64,/g) ?? []).length, 3);
  });

  it('flattens local @import rules with their conditions, once, and survives cycles', async () => {
    const result = await link({
      'index.html': page('', '<link rel="stylesheet" href="css/a.css" media="screen">'),
      'css/a.css': '@charset "utf-8";\n@import "b.css" print;\n@import url(c.css) layer(base) supports(display: grid) (min-width: 40em);\n@import url("a.css");\n.a { color: red }',
      'css/b.css': '@import "a.css";\n.b { color: blue }',
      'css/c.css': '.c { background: url(../img/x.png) }\n@namespace svg url(http://www.w3.org/2000/svg);',
      'img/x.png': PNG,
    });
    assertPlayable(result.html, 'imports');
    assert.deepEqual(result.issues, []);
    const css = text(elements(result.html).find((element) => element.tagName === 'style')!);
    assert.match(css, /^@charset "utf-8";\n@media print\{\n\n\.b \{ color: blue \}\n\}\n@layer base\{@supports \(display: grid\)\{@media \(min-width: 40em\)\{\n\.c \{ background: url\("data:image\/png;base64,[^"]+"\) \}\n@namespace svg url\(http:\/\/www\.w3\.org\/2000\/svg\);\n\}\}\}\n\n\.a \{ color: red \}$/);
    assert.equal(attr(elements(result.html).find((element) => element.tagName === 'style')!, 'media'), 'screen');
  });

  it('keeps one woff2 source of each font face and fills missing KaTeX fonts from the bundle', async () => {
    const result = await link({
      'index.html': page('', '<link rel="stylesheet" href="vendor/katex/katex.min.css"><style>@font-face{font-family:A;src:local("A"),url(f/a.ttf) format("truetype"),url(f/a.woff2) format("woff2")}</style>'),
      'vendor/katex/katex.min.css': '@font-face{font-family:KaTeX_Main;src:url(fonts/KaTeX_Main-Regular.woff2) format("woff2"),url(fonts/KaTeX_Main-Regular.woff) format("woff"),url(fonts/KaTeX_Main-Regular.ttf) format("truetype")}',
      'f/a.ttf': Uint8Array.from([0, 1, 0, 0]), 'f/a.woff2': Uint8Array.from([0x77, 0x4f, 0x46, 0x32]),
    });
    assertPlayable(result.html, 'fonts');
    assert.match(result.html, /@font-face\{font-family:KaTeX_Main;src:url\("data:font\/woff2;base64,d09GMg[^"]+"\) format\("woff2"\)\}/);
    assert.match(result.html, /@font-face\{font-family:A;src:local\("A"\),url\("data:font\/woff2;base64,d09GMg=="\) format\("woff2"\)\}/);
    assert.deepEqual(codes(result), ['bundled-library']);
    assert.deepEqual(result.stats.bundledFiles, ['katex/dist/fonts/KaTeX_Main-Regular.woff2']);
  });

  it('embeds pictures inside Markdown slides, inline and external', async () => {
    const result = await link({
      'index.html': page(`<div class="reveal"><div class="slides">
<section data-markdown><textarea data-template>
## One
![A picture](img/pic.png "Title")
![Remote](https://example.org/pic.png)
![Ref][logo]
<!-- .slide: data-background-image="img/pic.png" -->
<img src="img/pic.png" onclick="go()">

[logo]: img/pic.png
</textarea></section>
<section data-markdown="slides/more.md"></section>
<section data-markdown="slides/gone.md"></section>
<section data-markdown><script type="text/template">![](img/pic.png)</script></section>
</div></div>`),
      'img/pic.png': PNG,
      'slides/more.md': '\n\n  ## Indented\n\n![x](img/pic.png)\n<iframe src="https://example.org/embed"></iframe>',
    });
    assertPlayable(result.html, 'markdown');
    assert.deepEqual(result.issues.map(({ code }) => code).sort(), ['embedded-page', 'external-image', 'inline-script-unsupported', 'missing-file']);
    const templates = elements(result.html).reverse().filter((element) => element.tagName === 'textarea' || (element.tagName === 'script' && attr(element, 'type') === 'text/template'));
    assert.equal(templates.length, 4);
    const [first, second, third, fourth] = templates.map(text);
    assert.match(first, /!\[A picture\]\(data:image\/png;base64,[^ ]+ "Title"\)/);
    assert.match(first, /!\[Remote\]\(data:image\/svg\+xml;base64,/);
    assert.match(first, /<!-- \.slide: data-background-image="data:image\/png;base64,[^"]+" -->/);
    assert.match(first, /<img src="data:image\/png;base64,[^"]+" onclick="go\(\)">/);
    assert.match(first, /\[logo\]: data:image\/png;base64,/);
    assert.match(second, /^<!-- -->\n {2}## Indented\n\n!\[x\]\(data:image\/png;base64,/);
    assert.match(second, /<div style="[^"]+">An embedded page from example\.org is not available offline\.<\/div>/);
    assert.match(third, /^## Slides not included/);
    assert.match(fourth, /^!\[\]\(data:image\/png;base64,/);
    assert.equal((result.html.match(/data-markdown=""/g) ?? []).length, 4);
  });
});

/* ------------------------------------------------------------- handlers */

describe('inline event handlers', () => {
  it('become listeners with the same this, event, scope and return false', () => {
    const listeners = new Map<string, (event: unknown) => void>();
    const element = {
      value: 'element value', form: { formValue: 'form value' },
      addEventListener(type: string, listener: (event: unknown) => void) { listeners.set(type, listener); },
    };
    const context: Record<string, unknown> = { document: { querySelector: (selector: string) => (selector === '[data-qft-on="7"]' ? element : null), title: 'Deck' } };
    const code = 'this.seen = [event.type, value, formValue, title]; return false // trailing comment';
    vm.runInNewContext(handlerScriptSource('[data-qft-on="7"]', [{ event: 'click', code }, { event: 'input', code: 'this.input = true' }]), context);
    let prevented = 0;
    listeners.get('click')!.call(element, { type: 'click', preventDefault() { prevented += 1; } });
    assert.deepEqual(JSON.parse(JSON.stringify((element as any).seen)), ['click', 'element value', 'form value', 'Deck']);
    assert.equal(prevented, 1);
    listeners.get('input')!.call(element, { type: 'input', preventDefault() { prevented += 1; } });
    assert.equal((element as any).input, true);
    assert.equal(prevented, 1, 'only return false cancels');
  });

  it('cover body window events, javascript: links and elements in templates', async () => {
    const result = await link({
      'index.html': `<!doctype html><html><head></head><body onload="window.loaded = 1" onclick="clicked()"><a href="javascript:advance(2)">Next</a><a href="javascript:void(0)" onclick="go()">Go</a><template><button onclick="x()">t</button></template></body></html>`,
    });
    assertPlayable(result.html, 'handlers');
    assert.deepEqual(codes(result), ['inline-script-unsupported']);
    assert.match(result.html, /<body data-qft-on="1">/);
    assert.match(result.html, /<a tabindex="0" role="button" data-qft-on="2">Next<\/a><a data-qft-on="3">Go<\/a>/);
    const handlers = scripts(result.html).filter((script) => script.marker === 'handlers').map((script) => script.code);
    assert.equal(handlers.length, 4);
    assert.match(handlers[0], /\}\)\(window\);$/);
    assert.match(handlers[0], /window\.loaded = 1/);
    assert.match(handlers[2], /advance\(2\)[\s\S]*if \(true\) event\.preventDefault\(\);[\s\S]*"keydown"/);
    assert.match(handlers[3], /go\(\)/);
    assert.doesNotMatch(handlers.join(''), /void\(0\)/);
    assert.equal(result.stats.convertedHandlers, 3);
    for (const code of handlers) new vm.Script(code);
    const edited = await link({ 'index.html': result.html.replace('<a data-qft-on="3">Go</a>', '<a data-qft-on="3">Go</a><button onclick="more()">More</button>') });
    assert.match(edited.html, /<button data-qft-on="4">More<\/button>/, 'new handlers never reuse an id');
  });
});

/* ----------------------------------------------------- odd and hostile */

describe('unusual and hostile input', () => {
  it('keeps the document intact when inlined code contains closing tags or comment openers', async () => {
    const result = await link({
      'index.html': page('<script src="a.js"></script><p id="after">after</p>'),
      'a.js': 'var a = "</script><p id=\\"injected\\">"; var b = "<!--<script>"; // </SCRIPT>',
    });
    const all = elements(result.html);
    assert.ok(all.some((element) => attr(element, 'id') === 'after'));
    assert.ok(!all.some((element) => attr(element, 'id') === 'injected'));
    const code = scripts(result.html)[0].code;
    assert.equal(code, escapeScriptText('var a = "</script><p id=\\"injected\\">"; var b = "<!--<script>"; // </SCRIPT>'));
    assert.equal(vm.runInNewContext(`${code}\na + b`), '</script><p id="injected"><!--<script>');
    assert.equal(escapeScriptText('e.COMMENT(/<!--/, /-->/); /<script(?=\\s)/'), 'e.COMMENT(/<!--/, /-->/); /<script(?=\\s)/', 'harmless comment openers stay');
    assert.equal(escapeScriptText('a = "<!--"; b = "<script>";'), 'a = "<\\!--"; b = "<script>";');
  });

  it('honours base, drops redirects and data blocks with a src, decodes data: scripts and defers in order', async () => {
    const result = await link({
      'index.html': `<!doctype html><html><head><base href="deck/"><meta http-equiv="refresh" content="0; url=https://example.org"><meta http-equiv="Content-Security-Policy" content="default-src *"><script defer src="late.js"></script><script type="text/template" src="tpl.html"></script><script src="data:text/javascript;base64,${btoa('window.fromData = 1;')}"></script></head><body><img src="pic.png" alt=""><script>window.inline = 1;</script></body></html>`,
      'deck/late.js': 'window.late = 1;',
      'deck/pic.png': PNG,
    });
    assertPlayable(result.html, 'head');
    assert.deepEqual(codes(result), ['page-redirect']);
    assert.match(result.html, /<img src="data:image\/png;base64,/);
    assert.deepEqual(scripts(result.html).map((script) => script.code), ['', 'window.fromData = 1;', 'window.inline = 1;', 'window.late = 1;']);
  });

  it('rewrites files named in the Reveal.js configuration', async () => {
    const result = await link({
      'index.html': page("<script>Reveal.initialize({ parallaxBackgroundImage: 'img/space.png', parallaxBackgroundSize: '2100px 900px' });</script>"),
      'img/space.png': PNG,
    });
    assert.match(scripts(result.html)[0].code, /parallaxBackgroundImage: 'data:image\/png;base64,[^']+'/);
  });

  it('leaves out assets too large to play and names the largest when the deck is too large', async () => {
    const big = new Uint8Array(3000).fill(7);
    const result = await link({ 'index.html': page('<img src="a.png" alt=""><video src="b.mp4"></video>'), 'a.png': PNG, 'b.mp4': big }, { maxHtmlLength: 2000 });
    assert.deepEqual(result.issues.map(({ code, severity }) => `${code} ${severity}`), ['asset-too-large warning']);
    assert.match(result.issues[0].message, /^b\.mp4 \(3 KB\) is too large to include/);
    const many = await link({ 'index.html': page('<img src="a.png" alt=""><img src="c.png" alt="">'), 'a.png': PNG, 'c.png': new Uint8Array([...PNG, ...new Uint8Array(700)]) }, { maxHtmlLength: 1200 });
    const error = many.issues.find((issue) => issue.code === 'deck-too-large');
    assert.equal(error?.severity, 'error');
    assert.match(error!.message, /The largest files are c\.png \(1 KB\), a\.png \(1 KB\)\.$/);
  });

  it('neither throws nor hangs on hostile documents', async () => {
    const cases: Record<string, string | Uint8Array>[] = [
      { 'index.html': '<div>'.repeat(5000) },
      { 'index.html': Uint8Array.from({ length: 4096 }, (_, index) => (index * 7919) % 256) },
      { 'index.html': page('<img src="%E0%A4%A.png" alt=""><img src="javascript:alert(1)" alt=""><img src="file:///etc/passwd" alt="">'), '%E0%A4%A.png': PNG },
      { 'index.html': page('', `<style>${'url('.repeat(20000)}</style><style>/* unterminated</style><style>a{b:"unterminated</style><style>@import</style><style>@font-face</style><style>@font-face{src:</style>`) },
      { 'index.html': page('', '<link rel="stylesheet" href="a.css">'), 'a.css': '@import "a.css"; @import url(a.css); .x{}' },
      { 'index.html': page(`<section data-markdown><textarea data-template>${'![x]('.repeat(5000)}${'<img src='.repeat(5000)}</textarea></section>`) },
      { 'index.html': page(`<script type="module">${'import('.repeat(3000)}\`\${\`\${</script><script type="module">/[/]/; import x from "./y.js"; '</script>`) },
      { 'index.html': page(`<script>Reveal.initialize({ dependencies: [${"{ src: 'a.js' },".repeat(500)}`) },
      { 'index.html': page(`<div ${'onclick="x()" '.repeat(50)} ${'a'.repeat(100000)}="1">x</div>`) },
    ];
    for (const files of cases) {
      const started = Date.now();
      const result = await link(files);
      assert.ok(Date.now() - started < 5000, 'finishes promptly');
      if (result.html) assertPlayable(result.html, 'hostile');
    }
    const deep = await link({ 'index.html': '<div>'.repeat(5000) });
    assert.deepEqual(deep.issues.map(({ code, severity }) => [code, severity]), [['deck-unreadable', 'error']]);
    assert.equal(deep.html, '');
  });
});

/* --------------------------------------------------------------- pieces */

describe('module import scanning', () => {
  it('finds static, side-effect, re-export and dynamic imports, and nothing in strings, comments or regular expressions', () => {
    const code = [
      "import Reveal from 'reveal.js';",
      'import * as ns from "./ns.js"',
      "import def, { a as b } from './mixed.js' with { type: 'json' };",
      "import './side.css';",
      "export { x } from './re.js';",
      'const s = "import y from \'string\'";',
      '// import z from "comment"',
      '/* import w from "block" */',
      'const r = /import v from "regex"/g;',
      'const t = `import ${"u"} from "template"`;',
      "if (1) { import('./lazy.js'); }",
      'import(name);',
      'console.log(import.meta.url, obj.import);',
    ].join('\n');
    const { imports, complete } = scanModuleImports(code);
    assert.equal(complete, true);
    assert.deepEqual(imports.map(({ kind, specifier, clause }) => [kind, specifier, clause]), [
      ['import', 'reveal.js', 'Reveal'],
      ['import', './ns.js', '* as ns'],
      ['import', './mixed.js', 'def, { a as b }'],
      ['side-effect', './side.css', undefined],
      ['export-from', './re.js', undefined],
      ['dynamic', './lazy.js', undefined],
      ['dynamic', undefined, undefined],
    ]);
    assert.equal(code.slice(imports[2].start, imports[2].end), "import def, { a as b } from './mixed.js' with { type: 'json' };");
    assert.equal(scanModuleImports('const a = "unterminated').complete, false);
    assert.equal(scanModuleImports('`${`').complete, false);
  });

  it('finds where each import() call ends, whatever its argument', () => {
    const code = 'a=()=>import(`./slide-1.js`);b=import(name+("x")).then(f);c=import("./c.js");d=import(';
    const dynamic = scanModuleImports(code).imports.filter((item) => item.kind === 'dynamic');
    assert.deepEqual(dynamic.map((item) => item.callEnd === undefined ? undefined : code.slice(item.start, item.callEnd)),
      ['import(`./slide-1.js`)', 'import(name+("x"))', 'import("./c.js")', undefined]);
  });

  it('lists string literals and plain templates, but not tagged or substituted templates', () => {
    const code = 'a="/assets/x.png";b=\'it\\\'s\';c=`./y.svg`;d=html`<p>`;e=`${z}.png`;f=/"q"/;g=typeof`t`;// "comment"';
    const literals = scanStringLiterals(code)!;
    assert.deepEqual(literals.map((item) => [code.slice(item.start, item.end), item.value]), [
      ['"/assets/x.png"', '/assets/x.png'], ["'it\\'s'", "it's"], ['`./y.svg`', './y.svg'], ['`t`', 't'],
    ]);
    assert.equal(scanStringLiterals('a="unterminated'), undefined);
  });

  it('accepts only default and namespace bindings', () => {
    assert.deepEqual(defaultImportBindings('Reveal'), [{ local: 'Reveal', imported: 'default' }]);
    assert.deepEqual(defaultImportBindings('R, * as all'), [{ local: 'R', imported: 'default' }, { local: 'all', imported: '*' }]);
    assert.deepEqual(defaultImportBindings('{ default as R }'), [{ local: 'R', imported: 'default' }]);
    assert.equal(defaultImportBindings('{ marked }'), undefined);
    assert.equal(defaultImportBindings('R, { helper }'), undefined);
  });

  it('serialises the dependency table safely', () => {
    const source = dependencyAdapterSource({ '</script><script>alert(1)</script>': { skip: true } });
    assert.doesNotMatch(source, /<\/script/i);
    new vm.Script(source);
  });
});
