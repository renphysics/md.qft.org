import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import katex from 'katex';
import { parse, type DefaultTreeAdapterTypes } from 'parse5';
import { linkDeck, repairFormulaTags, type LinkResult } from '../src/lib/deck-linker.ts';
import { mathStandInSource } from '../src/lib/deck-linker-runtime.ts';
import type { DeckDetection, DeckFiles } from '../src/lib/deck-types.ts';
import { nodeVendorProvider } from './helpers/deck-vendor-node.ts';

/*
 * What the linker keeps working and what it tells (review findings F2b.3,
 * F2b.7, F5.2, F5.3, F5.5): plugins whose script was left out, MathJax-only
 * commands, class names Reveal.js uses itself, a raw "<" inside a formula and
 * notes for libraries that are left out.
 */

type Element = DefaultTreeAdapterTypes.Element;
type ChildNode = DefaultTreeAdapterTypes.ChildNode;

const encoder = new TextEncoder();
const REVIEW_DECKS = fileURLToPath(new URL('./fixtures/review-decks/', import.meta.url));

function reviewDeck(name: string): DeckFiles {
  const files: DeckFiles = new Map();
  const walk = (folder: string) => {
    for (const item of readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(folder, item.name);
      if (item.isDirectory()) walk(path);
      else files.set(relative(join(REVIEW_DECKS, name), path).split(sep).join('/'), new Uint8Array(readFileSync(path)));
    }
  };
  walk(join(REVIEW_DECKS, name));
  return files;
}

const deck = (files: Record<string, string>): DeckFiles => new Map(Object.entries(files).map(([path, text]) => [path, encoder.encode(text)]));
const detection = (overrides: Partial<DeckDetection> = {}): DeckDetection => ({ kind: 'reveal', engine: 'reveal', entry: 'index.html', issues: [], flags: {}, ...overrides });
const link = (files: DeckFiles | Record<string, string>, overrides: Partial<DeckDetection> = {}): Promise<LinkResult> =>
  linkDeck(files instanceof Map ? files : deck(files), detection(overrides), nodeVendorProvider());
const page = (body: string, head = '') => `<!doctype html><html><head><meta charset="utf-8">${head}</head><body>${body}</body></html>`;
const revealPage = (slides: string, tail = '', head = '') => page(`<div class="reveal"><div class="slides">${slides}</div></div>${tail}`, head);
const issue = (result: LinkResult, code: string) => result.issues.filter((item) => item.code === code);

function scriptsOf(html: string): { marker?: string; from?: string; code: string }[] {
  const result: { marker?: string; from?: string; code: string }[] = [];
  const stack: ChildNode[] = [...parse(html).childNodes];
  while (stack.length) {
    const node = stack.shift()!;
    if (!('tagName' in node)) continue;
    const element = node as Element;
    if (element.tagName === 'script') {
      const attr = (name: string) => element.attrs.find((a) => a.name === name)?.value;
      result.push({ marker: attr('data-qft-linker'), from: attr('data-qft-from'), code: element.childNodes.map((child) => ('value' in child ? child.value : '')).join('') });
    }
    stack.unshift(...element.childNodes);
  }
  return result;
}

/** Runs the deck's own scripts (not the bundled libraries) with a stand-in Reveal that records its plugins. */
function startWithFakeReveal(html: string, globals: Record<string, unknown> = {}): { ids: string[]; errors: string[] } {
  const ids: string[] = [];
  const errors: string[] = [];
  const context = vm.createContext({
    ...globals,
    Reveal: {
      initialize(options: { plugins?: unknown[] }) {
        for (const plugin of options.plugins ?? []) {
          const instance = (typeof plugin === 'function' ? (plugin as () => unknown)() : plugin) as { id?: unknown; init?: unknown };
          assert.equal(typeof instance.id, 'string', 'every plugin has an id');
          if (typeof instance.init === 'function') (instance.init as (deck: unknown) => void)({});
          ids.push(instance.id as string);
        }
        return { then() { return undefined; } };
      },
    },
  });
  context.window = context;
  for (const script of scriptsOf(html)) {
    if (script.from && /^https?:|^reveal\.js\/|^katex\//.test(script.from)) continue;
    try { vm.runInContext(script.code, context); } catch (error) { errors.push(String(error)); }
  }
  return { ids, errors };
}

describe('Reveal.js plugins whose script was left out', () => {
  it('lets the review deck misc start without RevealMenu and RevealChalkboard, and says so per plugin', async () => {
    const result = await link(reviewDeck('misc'));
    const menu = result.issues.find((item) => item.where === 'https://cdn.jsdelivr.net/npm/reveal.js-menu@2.1.0/menu.js')!;
    assert.equal(menu.code, 'external-library', 'the note keeps the full address, with the package name');
    assert.match(menu.message, /a Reveal\.js plugin/);
    assert.doesNotMatch(menu.message, /may not start/, 'the stand-in lets the slides start');
    assert.match(result.issues.find((item) => item.where === 'https://cdn.jsdelivr.net/npm/reveal.js-plugins@4.2.5/chalkboard/plugin.js')!.message, /a Reveal\.js plugin/);
    const notes = issue(result, 'plugin-unavailable');
    assert.deepEqual(notes.map((note) => note.where), ['RevealMenu', 'RevealChalkboard']);
    for (const note of notes) {
      assert.equal(note.severity, 'warning');
      assert.match(note.message, new RegExp(`${note.where}.*not available here.*slides play without it`));
    }
    const stub = scriptsOf(result.html).filter((script) => script.marker === 'plugins');
    assert.equal(stub.length, 1, 'one inserted script defines the missing names');
    const { ids, errors } = startWithFakeReveal(result.html, { RevealMarkdown: () => ({ id: 'markdown', init() {} }) });
    assert.deepEqual(errors, [], 'the start-up script runs');
    assert.deepEqual(ids, ['markdown', 'RevealMenu-unavailable', 'RevealChalkboard-unavailable']);
  });

  it('leaves misc2 (no extra plugins in the list) without plugin notes', async () => {
    const files = reviewDeck('misc');
    const index = new TextDecoder().decode(files.get('index.html')!).replace('plugins: [RevealMarkdown, RevealMenu, RevealChalkboard]', 'plugins: [RevealMarkdown]');
    files.set('index.html', encoder.encode(index));
    const result = await link(files);
    assert.deepEqual(issue(result, 'plugin-unavailable'), []);
    assert.equal(scriptsOf(result.html).some((script) => script.marker === 'plugins'), false);
  });

  it('skips bundled plugin names, member expressions and names the deck defines', async () => {
    const result = await link({
      'index.html': revealPage('<section>A</section>', `<script src="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/reveal.js"></script>
<script src="js/own.js"></script>
<script>const Local = () => ({ id: 'local' }); var Assigned; Assigned = { id: 'assigned' };
Reveal.initialize({ plugins: [ RevealNotes, RevealMath.KaTeX, RevealZoom, /* menu */ RevealSearch, Local, Assigned, OwnPlugin, RevealPointer, ] });</script>`),
      'js/own.js': 'window.OwnPlugin = { id: "own" };',
    });
    assert.deepEqual(issue(result, 'plugin-unavailable').map((note) => note.where), ['RevealPointer']);
  });

  it('defines a stub only when the name is still undefined, also in front of a module script', async () => {
    const result = await link({
      'index.html': revealPage('<section>A</section>', '<script type="module">Reveal.initialize({ plugins: [RevealMenu] });</script>'),
    });
    const stub = scriptsOf(result.html).find((script) => script.marker === 'plugins')!;
    const context = vm.createContext({});
    context.window = context;
    context.RevealMenu = 'real';
    vm.runInContext(stub.code, context);
    assert.equal(context.RevealMenu, 'real', 'a name defined by then is kept');
    const empty = vm.createContext({});
    empty.window = empty;
    vm.runInContext(stub.code, empty);
    const instance = (empty.RevealMenu as () => { id: string; init: unknown })();
    assert.equal(instance.id, 'RevealMenu-unavailable');
    assert.equal(typeof instance.init, 'function');
  });

  it('is idempotent', async () => {
    const first = await link(reviewDeck('misc'));
    const again = await link({ 'index.html': first.html });
    assert.equal(again.html, first.html);
  });
});

describe('MathJax-only commands in the KaTeX stand-in', () => {
  /** The options the stand-in passes to renderMathInElement for a configuration. */
  function standInOptions(plugin: 'MathJax3' | 'MathJax2' | 'KaTeX', config: Record<string, unknown>): Record<string, unknown> {
    let options: Record<string, unknown> | undefined;
    const context = vm.createContext({ document: { readyState: 'complete' } });
    context.window = context;
    context.renderMathInElement = (_element: unknown, given: Record<string, unknown>) => { options = given; };
    vm.runInContext(mathStandInSource(), context);
    const factory = (context.RevealMath as Record<string, () => { init(deck: unknown): void }>)[plugin];
    factory().init({ isReady: () => true, getSlidesElement: () => ({}), getConfig: () => config, layout() {} });
    assert.ok(options, 'the stand-in typesets');
    return options!;
  }

  const render = (tex: string, options: Record<string, unknown>) => {
    const preProcess = options.preProcess as ((math: string) => string) | undefined;
    return katex.renderToString(preProcess ? preProcess(tex) : tex, { displayMode: true, throwOnError: false, macros: { ...(options.macros as object) } });
  };
  const visible = (html: string) => html.replace(/<annotation[\s\S]*?<\/annotation>/g, '').replace(/<[^>]*>/g, '');

  it('drops \\label and \\require, shows a placeholder for \\eqref and \\ref, and maps eqnarray to align (math3)', () => {
    const html = new TextDecoder().decode(reviewDeck('math3').get('index.html')!);
    assert.match(html, /\\label\{eq:emc\}/);
    const options = standInOptions('MathJax3', { mathjax3: { tex: { macros: { RR: '\\mathbb{R}' } } } });
    for (const tex of ['\\begin{align} E &= mc^2 \\label{eq:emc} \\\\ F &= ma \\tag{N2} \\end{align}', '\\require{cancel}\\cancel{x}',
      '\\begin{eqnarray} a &=& b \\end{eqnarray}', 'x \\eqref{eq:emc} \\ref{eq:emc}', '\\RR^n']) {
      const out = render(tex, options);
      assert.doesNotMatch(out, /katex-error/, tex);
      assert.doesNotMatch(visible(out), /eq:emc|\\label|\\require|cancel\{/, `${tex}: no raw TeX shows`);
    }
    assert.match(visible(render('x \\eqref{eq:emc}', options)), /\(\?\)/);
  });

  it('keeps the deck\'s own macros and works for every plugin form', () => {
    const mine = standInOptions('MathJax3', { mathjax3: { tex: { macros: { label: '\\text{L}' } } } });
    assert.equal((mine.macros as Record<string, unknown>)['\\label'], '\\text{L}', 'a macro of the deck wins');
    for (const [plugin, config] of [['MathJax2', { math: {} }], ['KaTeX', { katex: {} }]] as const) {
      const out = render('a \\label{x} = b', standInOptions(plugin, config));
      assert.doesNotMatch(out, /katex-error/, plugin);
      assert.doesNotMatch(visible(out), /label/, plugin);
    }
  });
});

describe('notes for libraries that are left out', () => {
  it('names Font Awesome (n8), Mermaid and Chart.js (n7) with what goes missing and the next step', async () => {
    const result = await link({
      'index.html': revealPage('<section><i class="fa-solid fa-atom"></i></section>', `
<script src="https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<script src="https://example.org/js/helper.js"></script>`,
      '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css"><link rel="stylesheet" href="https://fonts.googleapis.com/icon?family=Material+Icons">'),
    });
    const byWhere = new Map(result.issues.map((item) => [item.where, item]));
    const fa = byWhere.get('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css')!;
    assert.equal(fa.code, 'external-style');
    assert.match(fa.message, /Font Awesome/);
    assert.match(fa.message, /icons/i);
    assert.match(fa.message, /Copy the report for your AI assistant/);
    const material = byWhere.get('https://fonts.googleapis.com/icon?family=Material+Icons')!;
    assert.equal(material.code, 'external-style', 'an icon font is more than a web font');
    assert.match(material.message, /Material Icons/);
    const mermaid = byWhere.get('https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js')!;
    assert.equal(mermaid.code, 'external-library');
    assert.match(mermaid.message, /Mermaid.*diagrams/);
    assert.match(mermaid.message, /slides may not start/);
    assert.match(mermaid.message, /Copy the report for your AI assistant/);
    assert.match(byWhere.get('https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js')!.message, /Chart\.js.*charts/);
    const unknown = byWhere.get('https://example.org/js/helper.js')!;
    assert.equal(unknown.code, 'external-library');
    assert.match(unknown.message, /helper\.js/);
    assert.match(unknown.message, /Copy the report for your AI assistant/);
  });

  it('recognises the common libraries by package or file name', async () => {
    const libraries: [string, RegExp][] = [
      ['https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css', /Bootstrap Icons/],
      ['https://cdn.jsdelivr.net/npm/d3@7', /D3/],
      ['https://cdn.plot.ly/plotly-2.27.0.min.js', /Plotly/],
      ['https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js', /ECharts/],
      ['https://unpkg.com/three@0.160.0/build/three.min.js', /Three\.js/],
      ['https://cdn.tailwindcss.com/', /Tailwind/],
      ['https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css', /Bootstrap\b(?! Icons)/],
      ['https://cdnjs.cloudflare.com/ajax/libs/animate.css/4.1.1/animate.min.css', /animate\.css/],
      ['https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/gsap.min.js', /GSAP/],
      ['https://code.jquery.com/jquery-3.7.1.min.js', /jQuery/],
      ['https://cdn.jsdelivr.net/npm/p5@1.9.0/lib/p5.min.js', /p5\.js/],
      ['https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', /Leaflet.*maps/],
      ['https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js', /highlight\.js/],
      ['https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css', /highlight\.js/],
    ];
    const tags = libraries.map(([url]) => url.endsWith('.css') ? `<link rel="stylesheet" href="${url}">` : `<script src="${url}"></script>`).join('');
    const result = await link({ 'index.html': revealPage('<section>A</section>', '', tags) });
    for (const [url, name] of libraries) {
      const found = result.issues.find((item) => item.where === url);
      assert.ok(found, url);
      assert.match(found.message, name, url);
      assert.match(found.message, /Copy the report for your AI assistant/, url);
    }
  });
});

describe('class names that Reveal.js uses itself', () => {
  it('warns about class="controls" inside a slide (p1, p3) and suggests another name', async () => {
    const result = await link({
      'index.html': revealPage(`<section><h2>Demo</h2><div class="demo"><canvas></canvas><div class="controls"><button>Pause</button></div><p class="readout">x</p></div></section>
<section><div class="row progress"></div><span class="slide-number">3</span></section>`),
    });
    const notes = issue(result, 'reveal-class-name');
    assert.equal(notes.length, 1);
    assert.equal(notes[0].severity, 'warning');
    assert.equal(notes[0].where, 'controls, progress, slide-number');
    assert.match(notes[0].message, /“controls”/);
    assert.match(notes[0].message, /hidden or misplaced/);
    assert.match(notes[0].message, /demo-controls/);
  });

  it('says nothing for Reveal.js\'s own markup outside the slides, or for a page that is not Reveal.js', async () => {
    const own = await link({ 'index.html': page('<div class="reveal"><div class="slides"><section>A</section></div><div class="controls"></div><div class="progress"></div></div>') });
    assert.deepEqual(issue(own, 'reveal-class-name'), []);
    const plain = await link({ 'index.html': page('<section><div class="controls">x</div></section>') }, { kind: 'html', engine: 'html' });
    assert.deepEqual(issue(plain, 'reveal-class-name'), []);
  });
});

describe('a raw "<" inside a formula', () => {
  const p2 = '<p class="small">方波 \\(f(x)=\\begin{cases}-1,&-\\pi<x<0\\\\ \\;\\;1,&0<x<\\pi\\end{cases}\\)，周期 \\(2\\pi\\)。它在 \\(x=0,\\pm\\pi\\) 处有跳变。</p>';

  it('repairs p2\'s formulas so their text stays text, and adds an info note', async () => {
    const result = await link({ 'index.html': revealPage(`<section>${p2}</section><section><p>在 \\(0<x<\\pi\\) 内 \\(\\sin x>0\\)，所以。</p></section><section><p>\\[a<b\\] and $$c<d$$</p></section>`) });
    const text = parse(result.html);
    const all: string[] = [];
    const stack: ChildNode[] = [...text.childNodes];
    while (stack.length) {
      const node = stack.shift()!;
      if ('value' in node && node.nodeName === '#text') all.push(node.value);
      if ('childNodes' in node) stack.unshift(...(node as Element).childNodes);
    }
    const joined = all.join('');
    assert.ok(joined.includes('\\(f(x)=\\begin{cases}-1,&-\\pi<x<0\\\\ \\;\\;1,&0<x<\\pi\\end{cases}\\)，周期'), 'the whole formula and the text after it are text');
    assert.ok(joined.includes('在 \\(0<x<\\pi\\) 内'));
    assert.ok(joined.includes('\\[a<b\\] and $$c<d$$'));
    const notes = issue(result, 'formula-less-than');
    assert.equal(notes.length, 1);
    assert.equal(notes[0].severity, 'info');
    assert.match(notes[0].message, /\\lt/);
  });

  it('leaves scripts, styles, textareas, comments, attributes, real tags and far-away delimiters alone', () => {
    const untouched = [
      '<script>var open = "\\\\("; if (a <b) x = "<b>"; var close = "\\\\)";</script>',
      '<style>/* \\( */ a<b { } /* \\) */</style>',
      '<textarea>\\(a<b\\)</textarea>',
      '<!-- \\(a<b\\) -->',
      '<p title="\\(a<b\\)">x</p>',
      '<p>\\( a <b>bold</b> c \\)</p>',
      '<p>\\(x<br>y\\)</p>',
      `<p>\\(a<b ${'x'.repeat(5000)} \\)</p>`,
      '<p>\\(a<b and no closing delimiter</p>',
      '<p>a < b and x<y without a formula</p>',
    ];
    for (const html of untouched) assert.deepEqual(repairFormulaTags(html), { html, repaired: 0 }, html);
    assert.deepEqual(repairFormulaTags('<p>\\(a<b\\) and \\(c<D\\)</p>'), { html: '<p>\\(a&lt;b\\) and \\(c&lt;D\\)</p>', repaired: 2 });
  });

  it('runs in linear time', () => {
    for (const html of ['\\('.repeat(200_000), `${'\\(<a'.repeat(100_000)}\\)`, `<p>${'$$<x'.repeat(100_000)}`, '<'.repeat(400_000), '<a "'.repeat(100_000)]) {
      const started = performance.now();
      repairFormulaTags(html);
      assert.ok(performance.now() - started < 1000, `${html.slice(0, 8)}… took ${Math.round(performance.now() - started)} ms`);
    }
  });
});
