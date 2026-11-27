import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import vm from 'node:vm';
import { zipSync } from 'fflate';
import { detectDeck } from '../src/lib/deck-detect.ts';
import { linkDeck, repairFormulaTags, typesetsSingleDollars, type LinkOptions, type LinkResult } from '../src/lib/deck-linker.ts';
import { buildPlayable, isPlayable, openDeck } from '../src/lib/deck-project.ts';
import type { DeckFiles } from '../src/lib/deck-types.ts';
import { nodeVendorProvider } from './helpers/deck-vendor-node.ts';

/*
 * The linker after the second review round (findings VF1, VF2a, VF2b, VF5,
 * VF6, VUX and VM of the independent verification).
 */

const encoder = new TextEncoder();
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
const page = (body: string, head = '') => `<!doctype html><html><head><meta charset="utf-8"><title>T</title>${head}</head><body>${body}</body></html>`;
const REVEAL_SCRIPT = '<script src="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/reveal.js"></script>';
const REVEAL_STYLE = '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/reveal.css">';
const reveal = (slides: string, { init = 'Reveal.initialize();', head = REVEAL_STYLE, outside = '' } = {}) =>
  page(`<div class="reveal">${outside}<div class="slides">${slides}</div></div>${REVEAL_SCRIPT}<script>${init}</script>`, head);

function deck(files: Record<string, string | Uint8Array>): DeckFiles {
  return new Map(Object.entries(files).map(([path, value]) => [path, typeof value === 'string' ? encoder.encode(value) : value]));
}

async function link(files: Record<string, string | Uint8Array>, options: LinkOptions = {}): Promise<LinkResult> {
  const map = deck(files);
  return linkDeck(map, detectDeck(map), nodeVendorProvider(), options);
}

function zipFile(files: Record<string, string | Uint8Array>, name = 'deck.zip'): File {
  const entries = Object.fromEntries(Object.entries(files).map(([path, data]) => [path, typeof data === 'string' ? encoder.encode(data) : data]));
  return new File([new Uint8Array(zipSync(entries)).buffer], name, { type: 'application/zip' });
}

const codes = (result: { issues: { code: string }[] }) => result.issues.map((item) => item.code);
const issue = (result: { issues: { code: string; message: string; severity: string }[] }, code: string) => result.issues.find((item) => item.code === code);

describe('removals (VF1.1, VF1.3)', () => {
  it('uses only the first <base href>, as HTML does', async () => {
    const result = await link({
      'index.html': page('<img src="pic.png" alt="">', '<base href="a/"><base href="b/"><base href="c/">'),
      'a/pic.png': PNG,
      'a/b/pic.png': encoder.encode('wrong'),
    });
    assert.ok(!codes(result).includes('missing-file'), JSON.stringify(result.issues));
    assert.match(result.html, /src="data:image\/png;base64,iVBOR/);
    assert.doesNotMatch(result.html, /<base/);
  });

  it('keeps the page in order when it removes and replaces many siblings', async () => {
    const result = await link({
      'index.html': page('<p>1</p><noscript>n</noscript><p>2</p><script src="a.js"></script><p>3</p><iframe src="https://x.example/"></iframe><p>4</p><meta http-equiv="refresh" content="0"><p>5</p>'),
      'a.js': 'window.a = 1;',
    });
    const body = result.html.slice(result.html.indexOf('<body>'));
    const order = [...body.matchAll(/<p>(\d)<\/p>|window\.a = 1|data-qft-placeholder/g)].map((match) => match[1] ?? match[0]);
    assert.deepEqual(order, ['1', '2', 'window.a = 1', '3', 'data-qft-placeholder', '4', '5']);
    assert.doesNotMatch(result.html, /noscript|http-equiv/);
  });
});

describe('class names that Reveal.js uses (VF2a.1)', () => {
  it('sees them on a slide itself and under .reveal outside the slides', async () => {
    const onSlide = await link({ 'index.html': reveal('<section><h2>A</h2></section><section class="progress"><h2>C</h2></section>') });
    assert.match(issue(onSlide, 'reveal-class-name')?.message ?? '', /“progress”/);
    const outside = await link({ 'index.html': reveal('<section><h2>A</h2></section>', { outside: '<div class="progress">my own progress bar text</div>' }) });
    assert.match(issue(outside, 'reveal-class-name')?.message ?? '', /“progress”/);
    const deeper = await link({ 'index.html': reveal('<section>A</section>', { outside: '<div class="tools"><div class="controls"><button>Go</button></div></div>' }) });
    assert.match(issue(deeper, 'reveal-class-name')?.message ?? '', /“controls”/);
  });

  it('leaves the .slides element and Reveal.js parts written in the markup of old templates alone', async () => {
    const result = await link({
      'index.html': reveal('<section><h2>A</h2></section>', {
        outside: '<aside class="controls"><a class="left" href="#">&#x25C4;</a><a class="right" href="#">&#x25BA;</a></aside><div class="progress"><span></span></div>',
      }),
    });
    assert.ok(!codes(result).includes('reveal-class-name'), JSON.stringify(result.issues));
    const outsideReveal = await link({ 'index.html': page('<div class="controls">x</div><div class="reveal"><div class="slides"><section>A</section></div></div><script src="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/reveal.js"></script><script>Reveal.initialize();</script>', REVEAL_STYLE) });
    assert.ok(!codes(outsideReveal).includes('reveal-class-name'));
  });
});

describe('a "<" in a formula (VF2a.2, VM.3)', () => {
  const dollars = { singleDollar: true };

  it('repairs $ … $ when the presentation typesets single dollars, by the rule that leaves prices alone', () => {
    assert.deepEqual(repairFormulaTags('<p>Single $a<b$ here</p>', dollars), { html: '<p>Single $a&lt;b$ here</p>', repaired: 1 });
    assert.deepEqual(repairFormulaTags('<p>$0<x<y$, then $$c<d$$</p>', dollars), { html: '<p>$0&lt;x&lt;y$, then $$c&lt;d$$</p>', repaired: 3 });
    const untouched = [
      '<p>Single $a<b$ here</p>'.replace('$a', '$ a'),
      '<p>It costs $5 and <b>more</b>, or $10.</p>',
      '<p>$a<b $ here</p>',
      '<p>$a<b$5 here</p>',
      '<p>$a<b\nc$</p>',
      '<p>\\$a<b\\$</p>',
      `<p>$a<x${'y'.repeat(400)}$</p>`,
      '<p>$a</p><div>x</div><p>$</p>',
      '<p>$a<!-- c -->$</p>',
      '<p title="$a<b$">x</p>',
    ];
    for (const html of untouched) assert.deepEqual(repairFormulaTags(html, dollars), { html, repaired: 0 }, html);
    assert.deepEqual(repairFormulaTags('<p>Single $a<b$ here</p>'), { html: '<p>Single $a<b$ here</p>', repaired: 0 }, 'not without single dollars');
  });

  it('knows which presentations typeset single dollars', () => {
    const none = { flags: {} };
    assert.equal(typesetsSingleDollars('Reveal.initialize({ plugins: [RevealMath.KaTeX] })', none), true);
    assert.equal(typesetsSingleDollars('x', { flags: { mathPlugin: 'mathjax3' } }), true);
    assert.equal(typesetsSingleDollars("renderMathInElement(document.body, { delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }] })", none), true);
    assert.equal(typesetsSingleDollars("window.MathJax = { tex: { inlineMath: [['\\\\(', '\\\\)'], ['$', '$']] } }", none), true);
    assert.equal(typesetsSingleDollars("renderMathInElement(document.body, { delimiters: [{ left: '$$', right: '$$', display: true }] })", none), false);
    assert.equal(typesetsSingleDollars('<p>It costs $5.</p>', none), false);
  });

  it('repairs single dollars in a Reveal.js presentation with the math plugin', async () => {
    const result = await link({ 'index.html': reveal('<section><p id="f8">Single $a<b$ here</p><p>After</p></section>', { init: 'Reveal.initialize({ plugins: [RevealMath.KaTeX] });' })
      .replace(REVEAL_SCRIPT, `${REVEAL_SCRIPT}<script src="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/plugin/math/math.js"></script>`) });
    assert.match(result.html, /Single \$a&lt;b\$ here/);
    assert.ok(codes(result).includes('formula-less-than'));
  });

  it('leaves a span with an end tag or a comment, and a span beyond its reach, unchanged', () => {
    for (const html of ['\\( a</p><div>x</div><p>\\)', `\\( a<x${'y'.repeat(5000)}\\)`, '\\( a<!-- c --> \\)', '$$ a<x</b>$$', `$$ a<x${'y'.repeat(5000)}$$`]) {
      assert.deepEqual(repairFormulaTags(html), { html, repaired: 0 }, html);
    }
    assert.deepEqual(repairFormulaTags(`\\( a<x${'y'.repeat(3000)}\\)`).repaired, 1, 'within reach');
  });
});

describe('links that are not web pages (VF2a.3, VF2b.4)', () => {
  it('keeps a link without its scheme as an https website link', async () => {
    const result = await link({ 'index.html': page('<a id="l" href="//example.org/x?q=1#f">site</a>') });
    assert.match(result.html, /<a id="l" href="https:\/\/example\.org\/x\?q=1#f">/);
    assert.ok(!codes(result).includes('file-links'));
  });

  it('names e-mail and phone links, which cannot open from the player', async () => {
    const result = await link({ 'index.html': page('<a href="mailto:teacher@example.com?subject=Hi">Mail</a> <a href=" tel:+41%2044 123">Call</a> <a href="mailto:teacher@example.com">again</a>') });
    const note = issue(result, 'contact-links');
    assert.equal(note?.message, 'E-mail and phone links do not open in the player: mailto:teacher@example.com, tel:+41 44 123. Show the address as text on the slide.');
    assert.equal(note?.severity, 'warning');
  });
});

describe('an empty start page (VF2a.5)', () => {
  it('gives only its error, not also the note that it plays as an ordinary page', async () => {
    for (const text of ['<!doctype html><html><head><title>Only a title</title></head><body></body></html>', '<!-- only a comment -->', '&nbsp;']) {
      const project = await openDeck(zipFile({ 'index.html': text }));
      assert.ok(project);
      const playable = await buildPlayable(project, { vendor: () => nodeVendorProvider() });
      assert.equal(isPlayable(playable), false);
      assert.deepEqual(playable.issues.map((item) => item.code), ['page-empty'], text);
    }
  });
});

describe('too large (VUX.6)', () => {
  const nextStep = 'Make the largest pictures smaller, for example under 500 KB each, or ask your AI assistant to compress them; then open the new ZIP.';

  it('ends the per-file note and the error with what to do, also with long file names', async () => {
    const one = await link({ 'index.html': page('<video src="b.mp4"></video>'), 'b.mp4': new Uint8Array(3000).fill(7) }, { maxHtmlLength: 2000 });
    assert.equal(issue(one, 'asset-too-large')?.message, `b.mp4 (3 KB) is too large to include, so it is left out. ${nextStep}`);
    const name = (letter: string) => `pictures/${letter.repeat(120)}.png`;
    const files: Record<string, string | Uint8Array> = { 'index.html': page(['a', 'b', 'c'].map((letter) => `<img src="${name(letter)}" alt="">`).join('')) };
    for (const letter of ['a', 'b', 'c']) files[name(letter)] = new Uint8Array([...PNG, ...new Uint8Array(400)]);
    const many = await link(files, { maxHtmlLength: 1800 });
    const error = issue(many, 'deck-too-large');
    assert.equal(error?.severity, 'error');
    assert.ok(error!.message.endsWith(nextStep), error!.message);
    assert.match(error!.message, /The largest files? (?:is|are) pictures\//);
  });
});

describe('Reveal.js plugins that were left out (VF2b.8)', () => {
  it('stubs names written as window.Name or globalThis.Name, and calls on a stub do nothing', async () => {
    const result = await link({
      'index.html': reveal('<section>A</section>', {
        init: `Reveal.initialize({ plugins: [RevealNotes, window.RevealPointer, globalThis . RevealChalkboard, window.RevealMath.KaTeX],
  keyboard: { 67: () => RevealChalkboard.toggleNotesCanvas() } });`,
      }).replace(REVEAL_SCRIPT, `${REVEAL_SCRIPT}<script src="https://cdn.jsdelivr.net/npm/reveal.js-plugins@4.2.5/chalkboard/plugin.js"></script>`),
    });
    assert.deepEqual(result.issues.filter((item) => item.code === 'plugin-unavailable').map((item) => item.where), ['RevealPointer', 'RevealChalkboard']);
    const stub = /<script data-qft-linker="plugins">([\s\S]*?)<\/script>/.exec(result.html)?.[1];
    assert.ok(stub);
    const context = vm.createContext({});
    context.window = context;
    vm.runInContext(stub, context);
    const chalkboard = context.RevealChalkboard as ((() => Record<string, unknown>) & Record<string | symbol, unknown>);
    assert.equal(typeof chalkboard, 'function');
    assert.equal((chalkboard.toggleNotesCanvas as () => unknown)(), undefined, 'a key binding to the plugin does nothing');
    assert.equal(chalkboard.then, undefined, 'not taken for a promise');
    assert.equal(chalkboard[Symbol.iterator], undefined);
    const plugin = chalkboard();
    assert.equal(plugin.id, 'RevealChalkboard-unavailable');
    assert.equal((plugin.init as () => unknown)(), undefined);
    assert.equal(typeof plugin.destroy, 'function');
    assert.equal(plugin.then, undefined);
    assert.equal(typeof context.RevealPointer, 'function');
  });
});
