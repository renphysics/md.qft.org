import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import vm from 'node:vm';
import katex from 'katex';
import { parse, type DefaultTreeAdapterTypes } from 'parse5';
import { linkDeck, type LinkResult } from '../src/lib/deck-linker.ts';
import { mathJaxConfigSource, mathJaxStandInSource, mathStandInSource } from '../src/lib/deck-linker-runtime.ts';
import { mathJaxPathVersion, mathJaxScriptVersion } from '../src/lib/deck-vendor.ts';
import type { DeckDetection, DeckFiles } from '../src/lib/deck-types.ts';
import { nodeVendorProvider } from './helpers/deck-vendor-node.ts';

/* MathJax loaded on its own (review VF5.2) and MathJax's text references (VF2b.3). */

type Element = DefaultTreeAdapterTypes.Element;
type ChildNode = DefaultTreeAdapterTypes.ChildNode;

const encoder = new TextEncoder();
const deck = (files: Record<string, string>): DeckFiles => new Map(Object.entries(files).map(([path, value]) => [path, encoder.encode(value)]));
const detection = (kind: 'reveal' | 'html'): DeckDetection => ({ kind, engine: kind === 'reveal' ? 'reveal' : 'html', entry: 'index.html', issues: [], flags: {} } as DeckDetection);
const link = (html: string, kind: 'reveal' | 'html' = 'html', extra: Record<string, string> = {}) =>
  linkDeck(deck({ 'index.html': html, ...extra }), detection(kind), nodeVendorProvider());
const page = (head: string, body = '<p>\\(x\\)</p>') => `<!doctype html><html><head><meta charset="utf-8">${head}</head><body>${body}</body></html>`;
const codes = (result: LinkResult) => result.issues.map((issue) => issue.code);

function scripts(html: string): { marker?: string; type?: string; id?: string; from?: string; code: string }[] {
  const result: Element[] = [];
  const stack: ChildNode[] = [...parse(html).childNodes].reverse();
  while (stack.length) {
    const node = stack.pop()!;
    if (!('tagName' in node)) continue;
    if (node.tagName === 'script') result.push(node);
    stack.push(...[...node.childNodes].reverse());
  }
  const attr = (element: Element, name: string) => element.attrs.find((item) => item.name === name)?.value;
  return result.map((element) => ({
    marker: attr(element, 'data-qft-linker'), type: attr(element, 'type'), id: attr(element, 'id'), from: attr(element, 'data-qft-from'),
    code: element.childNodes.map((node) => ('value' in node ? node.value : '')).join(''),
  }));
}

describe('recognising MathJax scripts', () => {
  it('knows the CDN addresses of versions 2, 3 and 4', () => {
    const cases: [string, 2 | 3 | 4 | undefined][] = [
      ['https://cdn.jsdelivr.net/npm/mathjax@3.2.2/es5/tex-svg.js', 3],
      ['https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js', 3],
      ['https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js', 3],
      ['https://cdn.jsdelivr.net/npm/mathjax@3/es5/startup.js', 3],
      ['https://cdn.jsdelivr.net/npm/mathjax/es5/tex-svg-full.js', 3],
      ['https://cdn.jsdelivr.net/npm/mathjax@4/tex-mml-chtml.js', 4],
      ['https://cdn.jsdelivr.net/npm/mathjax@4.0.0/tex-svg.js', 4],
      ['//cdn.jsdelivr.net/npm/mathjax@2.7.9/MathJax.js?config=TeX-AMS_HTML', 2],
      ['https://unpkg.com/mathjax@3.2.2/es5/tex-chtml.js', 3],
      ['https://cdnjs.cloudflare.com/ajax/libs/mathjax/2.7.9/MathJax.js?config=TeX-MML-AM_CHTML', 2],
      ['https://cdnjs.cloudflare.com/ajax/libs/mathjax/3.2.2/es5/tex-mml-chtml.min.js', 3],
      ['https://cdn.mathjax.org/mathjax/latest/MathJax.js?config=TeX-AMS-MML_HTMLorMML', 2],
      ['http://cdn.mathjax.org/mathjax/2.7-latest/MathJax.js', 2],
      // Not MathJax for TeX, or not MathJax at all.
      ['https://cdn.jsdelivr.net/npm/mathjax@3/es5/mml-chtml.js', undefined],
      ['https://cdn.jsdelivr.net/npm/mathjax@3/es5/output/chtml/fonts/woff-v2/MathJax_Zero.woff', undefined],
      ['https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js', undefined],
      ['https://cdn.jsdelivr.net/npm/other@1/es5/tex-svg.js', undefined],
      ['https://example.com/mathjax/es5/tex-svg.js', undefined],
      ['javascript:alert(1)//mathjax/tex-svg.js', undefined],
    ];
    for (const [url, version] of cases) assert.equal(mathJaxScriptVersion(url), version, url);
  });

  it('knows a deck path to a MathJax copy that is not in the ZIP', () => {
    assert.equal(mathJaxPathVersion('lib/mathjax/es5/tex-chtml.js'), 3);
    assert.equal(mathJaxPathVersion('MathJax/MathJax.js'), 2);
    assert.equal(mathJaxPathVersion('vendor/mathjax@4.0.0/tex-svg.js'), 4);
    assert.equal(mathJaxPathVersion('js/tex-svg.js'), undefined);
    assert.equal(mathJaxPathVersion('mathjax/es5/mml-chtml.js'), undefined);
  });
});

describe('linking a page that loads MathJax on its own', () => {
  it('puts the bundled KaTeX and the stand-in in place of the MathJax script, with the KaTeX note', async () => {
    for (const kind of ['html', 'reveal'] as const) {
      const result = await link(page(`<script>window.MathJax = { tex: { inlineMath: [['\\\\(', '\\\\)']] } };</script>
<script id="MathJax-script" async src="https://cdn.jsdelivr.net/npm/mathjax@3.2.2/es5/tex-svg.js"></script>`), kind);
      assert.doesNotMatch(result.html, /mathjax@|cdn\.jsdelivr/i, kind);
      assert.deepEqual(codes(result).filter((code) => code !== 'no-slides-found'), ['math-rendered-with-katex'], kind);
      const list = scripts(result.html);
      const config = list.findIndex((script) => /window\.MathJax = \{/.test(script.code));
      const standIn = list.findIndex((script) => script.marker === 'mathjax');
      assert.ok(config >= 0 && standIn > config, 'the stand-in comes where MathJax was, after the configuration');
      assert.equal(list[standIn].id, 'MathJax-script');
      assert.match(list[standIn].code, /version: '3\.2\.2'/);
      assert.deepEqual(list.slice(standIn - 2, standIn).map((script) => script.from), ['katex/dist/katex.min.js', 'katex/dist/contrib/auto-render.min.js']);
      assert.ok(result.stats.bundledFiles.includes('katex/dist/katex.min.css'));
    }
  });

  it('turns a version 2 text/x-mathjax-config script into one that runs once the stand-in exists', async () => {
    const config = "MathJax.Hub.Config({ tex2jax: { inlineMath: [['$','$']] } });";
    const result = await link(page(`<script type="text/x-mathjax-config">${config}</script>
<script src="https://polyfill.io/v3/polyfill.min.js?features=es6"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/mathjax/2.7.9/MathJax.js?config=TeX-AMS_HTML">MathJax.Hub.Config({ TeX: { Macros: { RR: '{\\\\bf R}' } } });</script>`));
    assert.deepEqual(result.issues.map((issue) => [issue.code, issue.severity]).filter(([code]) => code !== 'no-slides-found'),
      [['polyfill-not-needed', 'info'], ['math-rendered-with-katex', 'info']]);
    assert.doesNotMatch(result.html, /polyfill\.io\/v3|cdnjs/);
    const list = scripts(result.html);
    const converted = list.filter((script) => script.marker === 'mathjax-config');
    assert.equal(converted.length, 2, 'the config block and the code inside the MathJax.js element');
    assert.equal(converted[0].type, undefined, 'an ordinary script');
    assert.ok(converted[0].code.includes(config));
    assert.ok(converted[1].code.includes('RR'));
    assert.match(list.find((script) => script.marker === 'mathjax')!.code, /version: '2\.7\.9'/);

    // Without a MathJax script the block stays data, as before.
    const alone = await link(page(`<script type="text/x-mathjax-config">${config}</script>`));
    assert.deepEqual(scripts(alone.html).map((script) => script.type), ['text/x-mathjax-config']);
  });

  it('stands in for a MathJax copy that the ZIP lacks, and keeps the stand-in once', async () => {
    const result = await link(page('<script src="mathjax/es5/tex-chtml.js"></script><script defer src="https://cdn.jsdelivr.net/npm/mathjax@4/tex-mml-chtml.js"></script>'));
    assert.ok(!codes(result).includes('missing-file'), JSON.stringify(result.issues));
    assert.equal(scripts(result.html).filter((script) => script.marker === 'mathjax').length, 1);
    const again = await link(result.html);
    assert.equal(again.html, result.html, 'linking the linked page changes nothing');
  });

  it('shares KaTeX with Reveal\'s math plugin', async () => {
    const result = await link(page('<script src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js"></script>',
      '<div class="reveal"><div class="slides"><section>\\(x\\)</section></div></div><script src="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/reveal.js"></script><script src="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/plugin/math/math.js"></script><script>Reveal.initialize({ plugins: [RevealMath.KaTeX] });</script>'), 'reveal');
    const list = scripts(result.html);
    assert.equal(list.filter((script) => script.from === 'katex/dist/katex.min.js').length, 1);
    assert.deepEqual(list.filter((script) => script.marker === 'math' || script.marker === 'mathjax').map((script) => script.marker), ['mathjax', 'math']);
  });
});

/* -------------------------------------------------------- the stand-in */

interface FakeNode { nodeType: number; nodeValue?: string; localName?: string; classList?: { contains(name: string): boolean }; lastChild?: FakeNode | null; previousSibling?: FakeNode | null }

/** A tiny DOM for replaceReferences: an element with children, a text node. */
function element(localName: string, children: FakeNode[], classes: string[] = []): FakeNode {
  children.forEach((child, index) => { child.previousSibling = children[index - 1] ?? null; });
  return { nodeType: 1, localName, classList: { contains: (name) => classes.includes(name) }, lastChild: children[children.length - 1] ?? null };
}
const textNode = (value: string): FakeNode => ({ nodeType: 3, nodeValue: value });

/** Runs the stand-in in a sandbox; `before` runs first, as the page's earlier scripts. */
function standIn(before = '', { readyState = 'complete', version = 3 as 2 | 3 | 4, render }: { readyState?: string; version?: 2 | 3 | 4; render?: (root: unknown, options: any) => void } = {}) {
  const rendered: { root: unknown; options: any }[] = [];
  const timers: (() => void)[] = [];
  const listeners: Record<string, () => void> = {};
  const body = element('body', []);
  const byId: Record<string, FakeNode> = { slide: element('section', []) };
  const context: Record<string, any> = {
    setTimeout: (callback: () => void) => { timers.push(callback); },
    document: {
      readyState, body,
      getElementById: (id: string) => byId[id] ?? null,
      querySelectorAll: (selector: string) => (selector === '.later' ? [byId.slide] : []),
      addEventListener: (name: string, callback: () => void) => { listeners[name] = callback; },
      createElement: () => ({}),
    },
    renderMathInElement: (root: unknown, options: any) => { rendered.push({ root, options }); render?.(root, options); },
    Reveal: { layouts: 0, isReady: () => true, layout() { this.layouts += 1; } },
  };
  context.window = context;
  vm.createContext(context);
  if (before) vm.runInContext(before, context);
  vm.runInContext(mathJaxStandInSource(version), context);
  const flush = async () => {
    for (let round = 0; round < 5; round += 1) {
      while (timers.length) { try { timers.shift()!(); } catch { /* an error rethrown for the page */ } }
      await new Promise((resolve) => setImmediate(resolve));
    }
  };
  return { context, rendered, flush, listeners, body, slide: byId.slide };
}

describe('the MathJax stand-in', () => {
  it('typesets the body once the page has loaded, with MathJax\'s default delimiters (no single dollars)', async () => {
    const { context, rendered, flush, listeners, body } = standIn('', { readyState: 'loading' });
    assert.equal(rendered.length, 0);
    listeners.DOMContentLoaded();
    await flush();
    assert.equal(rendered.length, 1);
    assert.equal(rendered[0].root, body);
    assert.deepEqual(JSON.parse(JSON.stringify(rendered[0].options.delimiters)), [
      { left: '$$', right: '$$', display: true }, { left: '\\[', right: '\\]', display: true }, { left: '\\(', right: '\\)', display: false }]);
    assert.ok(rendered[0].options.ignoredTags.includes('code'));
    assert.equal(context.Reveal.layouts, 1, 'Reveal.js lays the slides out again');
    assert.equal(context.MathJax.qftStandIn, true);
  });

  it('reads a version 3 configuration object, also one assigned later, and honours startup.typeset', async () => {
    const { context, rendered, flush } = standIn(`window.MathJax = { tex: { inlineMath: [['$', '$']], displayMath: [['\\\\[', '\\\\]']], macros: { RR: '\\\\mathbb{R}', bold: ['{\\\\bf #1}', 1] } }, startup: { typeset: false } };`);
    await flush();
    assert.equal(rendered.length, 0, 'typeset: false');
    let resolved = false;
    context.MathJax.startup.promise.then(() => { resolved = true; });
    await flush();
    assert.ok(resolved, 'startup.promise resolves');
    context.MathJax = { tex: { macros: { CC: '\\mathbb{C}' } } };
    assert.equal(context.MathJax.qftStandIn, true, 'a later assignment is merged, not a replacement');
    await context.MathJax.typesetPromise(['slide']);
    assert.equal(rendered.length, 1);
    const options = rendered[0].options;
    assert.deepEqual(JSON.parse(JSON.stringify(options.delimiters)), [{ left: '\\[', right: '\\]', display: true }, { left: '$', right: '$', display: false }]);
    assert.equal(options.macros['\\RR'], '\\mathbb{R}');
    assert.equal(options.macros['\\bold'], '{\\bf #1}');
    assert.equal(options.macros['\\CC'], '\\mathbb{C}');
    assert.equal(typeof options.preProcess, 'function');
    assert.equal(options.preProcess('\\begin{eqnarray}a&=&b\\end{eqnarray}'), '\\begin{align}a&=&b\\end{align}');
  });

  it('calls a configured startup.ready, which calls defaultReady', async () => {
    const { context, rendered, flush } = standIn('window.MathJax = { startup: { ready: function () { window.readyRan = true; MathJax.startup.defaultReady(); } } };');
    await flush();
    assert.equal(context.readyRan, true);
    assert.equal(rendered.length, 1);
  });

  it('runs version 2 configuration given before it, and Hub.Queue and Hub.Typeset after it', async () => {
    const config = mathJaxConfigSource("MathJax.Hub.Config({ tex2jax: { inlineMath: [['$','$'], ['\\\\(','\\\\)']], displayMath: [['$$','$$']] }, TeX: { Macros: { half: '\\\\frac12' } } });");
    const { context, rendered, flush, slide } = standIn(config, { version: 2 });
    assert.equal(context.MathJax.version, '2.7.9');
    let queued = 0;
    context.MathJax.Hub.Queue(['Typeset', context.MathJax.Hub, 'slide'], () => { queued += 1; });
    assert.equal(rendered.length, 0, 'the queue waits for the start');
    await flush();
    assert.deepEqual(rendered.map((entry) => entry.root), [context.document.body, slide]);
    assert.equal(queued, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(rendered[0].options.delimiters)), [
      { left: '$$', right: '$$', display: true }, { left: '\\(', right: '\\)', display: false }, { left: '$', right: '$', display: false }]);
    assert.equal(rendered[0].options.macros['\\half'], '\\frac12');
    // After the start: at once, and a config script that comes later runs at once too.
    vm.runInContext(mathJaxConfigSource('MathJax.Hub.Config({ TeX: { Macros: { two: "2" } } });'), context);
    context.MathJax.Hub.Typeset(slide);
    context.MathJax.Hub.Register.StartupHook('End', () => { queued += 1; });
    assert.equal(rendered.length, 3);
    assert.equal(rendered[2].options.macros['\\two'], '2');
    assert.equal(queued, 2);
  });

  it('offers the other calls presentations make, and none of them throws', async () => {
    const { context, rendered, flush } = standIn('', { render: () => { throw new Error('bad formula'); } });
    await flush();
    const mathJax = context.MathJax;
    assert.doesNotThrow(() => mathJax.typeset());
    assert.doesNotThrow(() => mathJax.typeset([null, 'no-such-id', 42]));
    await mathJax.typesetPromise();
    assert.doesNotThrow(() => mathJax.typesetClear());
    assert.doesNotThrow(() => mathJax.texReset());
    assert.doesNotThrow(() => mathJax.Hub.Queue(['NoSuchMethod', mathJax.Hub], 'not callable', null));
    assert.doesNotThrow(() => mathJax.startup.document.state(0).updateDocument());
    await mathJax.startup.defaultPageReady();
    assert.ok(rendered.length >= 3);
  });

  it('shows a placeholder for \\eqref and \\ref in ordinary text, but not in code or typeset formulas', () => {
    const { context } = standIn();
    const text = textNode('See \\eqref{eq:one} and \\ref{eq:one}, and \\reference.');
    const code = textNode('\\ref{kept}');
    const formula = textNode('\\eqref{inside}');
    const root = element('div', [element('p', [text]), element('code', [code]), element('span', [formula], ['katex'])]);
    // The stand-in replaces references after each typesetting of a root.
    context.document.getElementById = () => root;
    context.MathJax.typeset('root');
    assert.equal(text.nodeValue, 'See (?) and ?, and \\reference.');
    assert.equal(code.nodeValue, '\\ref{kept}');
    assert.equal(formula.nodeValue, '\\eqref{inside}');
  });

  it('gives \\unicode the character, in hexadecimal and decimal, through KaTeX', async () => {
    const { context, rendered, flush } = standIn();
    await flush();
    const macros = rendered[0].options.macros;
    /** The visible text of KaTeX's output. */
    const shown = (tex: string) => {
      const html = katex.renderToString(tex, { macros: { ...macros }, throwOnError: false });
      assert.doesNotMatch(html, /katex-error/, tex);
      return html.slice(html.indexOf('katex-html')).replace(/<[^>]+>/g, '').replace(/^[^>]*>/, '');
    };
    assert.equal(shown('\\unicode{x2192}'), '→');
    assert.equal(shown('\\unicode{8594}'), '→');
    assert.equal(shown('\\unicode[Arial]{x41}B'), 'AB', 'the font is ignored and the next letter is not read as a digit');
    assert.equal(shown('\\unicode{nonsense}x'), 'x');
    assert.equal(context.MathJax.version, '3.2.2');
  });
});

describe('Reveal\'s math plugin stand-in', () => {
  it('also shows the placeholder for references in text, for MathJax configurations only', () => {
    for (const [factory, expected] of [['MathJax3', 'See (?).'], ['KaTeX', 'See \\eqref{a}.']] as const) {
      const text = textNode('See \\eqref{a}.');
      const slides = element('div', [element('section', [text])]);
      const context: Record<string, any> = { document: { readyState: 'complete' }, renderMathInElement: () => {} };
      context.window = context;
      vm.runInNewContext(mathStandInSource(), context);
      context.RevealMath[factory]().init({ getConfig: () => ({}), isReady: () => true, getSlidesElement: () => slides, layout: () => {} });
      assert.equal(text.nodeValue, expected, factory);
    }
  });
});
