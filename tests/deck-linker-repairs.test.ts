import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { zipSync } from 'fflate';
import { detectDeck } from '../src/lib/deck-detect.ts';
import { hasRevealLayoutRule, linkDeck, repairFormulaTags, typesetsSingleDollars, type LinkOptions, type LinkResult } from '../src/lib/deck-linker.ts';
import { buildPlayable, isPlayable, openDeck } from '../src/lib/deck-project.ts';
import { convertSlidevFiles } from '../src/lib/slidev-convert.ts';
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
    const one = await link({ 'index.html': page('<img src="b.png" alt="">'), 'b.png': new Uint8Array([...PNG, ...new Uint8Array(3000)]) }, { maxHtmlLength: 2000 });
    assert.match(issue(one, 'asset-too-large')?.message ?? '', new RegExp(`^b\\.png \\(3 KB\\) is too large to include, so it is left out\\. ${nextStep.replace(/[.()]/g, '\\$&')}$`));
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

describe('too large: the next step fits the largest file (review W3.5)', () => {
  const video = 'Make the video shorter or smaller, or leave it out and link to it online; then open the new ZIP.';
  const recording = 'Make the recording shorter or smaller, or leave it out and link to it online; then open the new ZIP.';
  const other = 'Leave out files the slides do not use; then open the new ZIP.';

  it('names videos, recordings and other files in the per-file note and the error', async () => {
    const one = await link({ 'index.html': page('<video src="b.mp4"></video>'), 'b.mp4': new Uint8Array(3000).fill(7) }, { maxHtmlLength: 2000 });
    assert.equal(issue(one, 'asset-too-large')?.message, `b.mp4 (3 KB) is too large to include, so it is left out. ${video}`);
    const sound = await link({ 'index.html': page('<audio src="a.mp3"></audio>'), 'a.mp3': new Uint8Array(3000).fill(7) }, { maxHtmlLength: 2000 });
    assert.ok(issue(sound, 'asset-too-large')?.message.endsWith(recording));
    const many = await link({
      'index.html': page('<video src="media/lecture.mp4"></video><img src="photo.png" alt="">'),
      'media/lecture.mp4': new Uint8Array(900).fill(7), 'photo.png': new Uint8Array([...PNG, ...new Uint8Array(400)]),
    }, { maxHtmlLength: 1800 });
    const error = issue(many, 'deck-too-large');
    assert.match(error?.message ?? '', /The largest files are media\/lecture\.mp4 \(1 KB\), photo\.png/);
    assert.ok(error!.message.endsWith(video), error!.message);
    const font = await link({ 'index.html': page('<style>@font-face{font-family:x;src:url(f.woff2)}</style><p>x</p>'), 'f.woff2': new Uint8Array(3000).fill(7) }, { maxHtmlLength: 2000 });
    assert.ok(issue(font, 'asset-too-large')?.message.endsWith(other), JSON.stringify(font.issues));
  });

  it('gives only the error, not also the note that the page plays as an ordinary page', async () => {
    const big = new Uint8Array(10 * 1024 * 1024).fill(7);
    // Stored, not compressed: the ZIP reader refuses files that expand far beyond their compressed size.
    const zip = zipSync({ 'index.html': encoder.encode(page('<video src="a.mp4"></video><video src="b.mp4"></video>')), 'a.mp4': [big, { level: 0 }], 'b.mp4': [big, { level: 0 }] });
    const project = await openDeck(new File([new Uint8Array(zip).buffer], 'big.zip', { type: 'application/zip' }));
    assert.ok(project);
    const playable = await buildPlayable(project, { vendor: () => nodeVendorProvider() });
    assert.equal(isPlayable(playable), false);
    assert.ok(playable.issues.some((item) => item.code === 'deck-too-large' && item.message.endsWith(video)), JSON.stringify(playable.issues.map((item) => item.message)));
    assert.ok(!playable.issues.some((item) => item.code === 'no-slides-found'));
  });
});

describe('conditions the mutation run found unpinned (review W6.1, W6.2, W6.7, W6.10)', () => {
  it('gives no browser-storage note for a Slidev build, whose own app code writes localStorage', async () => {
    const files = deck({ 'index.html': page('<div id="app"></div><script>localStorage.setItem("slidev-color-schema", "dark");</script>') });
    const slidev = await linkDeck(files, { kind: 'slidev-build', engine: 'slidev', entry: 'index.html', issues: [], flags: {} }, nodeVendorProvider());
    assert.ok(!codes(slidev).includes('browser-storage'));
    const plain = await linkDeck(files, { kind: 'html', engine: 'html', entry: 'index.html', issues: [], flags: {} }, nodeVendorProvider());
    assert.ok(codes(plain).includes('browser-storage'));
  });

  it('repairs "<" in a single-dollar formula only when the presentation typesets single dollars', async () => {
    const without = await link({ 'index.html': reveal('<section><p id="f">$a<b$</p></section>') });
    // Left to the HTML parser as written: no "&lt;" is put in.
    assert.doesNotMatch(without.html, /\$a&lt;b\$/);
    assert.ok(!codes(without).includes('formula-less-than'));
    const katex = await link({ 'index.html': reveal('<section><p id="f">$a<b$</p></section>', { init: 'Reveal.initialize({ plugins: [RevealMath.KaTeX] });' }).replace('</body>', '<script src="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/plugin/math/math.js"></script></body>') });
    assert.match(katex.html, /<p id="f">\$a&lt;b\$<\/p>/);
    assert.ok(codes(katex).includes('formula-less-than'));
  });

  it('gives no reveal-style-missing to a plain page that loads reveal.js without reveal.css', async () => {
    const result = await link({ 'index.html': page(`<main><h1>Not slides</h1></main>${REVEAL_SCRIPT}`) });
    assert.ok(!codes(result).includes('reveal-style-missing'), JSON.stringify(result.issues));
  });

  it('leaves a formula alone that holds a comment followed by a tag', () => {
    for (const html of ['<p>\\( a<!-- x --><b>y \\)</p>', '<p>$a<!-- c --><b>x$</p>', '<p>\\( x <!-- --><x \\)</p>', '<p>$a<!-- c --><x$</p>']) {
      assert.deepEqual(repairFormulaTags(html, { singleDollar: true }), { html, repaired: 0 }, html);
    }
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

describe('a Reveal.js presentation without its stylesheet (VF5.1)', () => {
  const warning = 'This Reveal.js presentation has no Reveal.js stylesheet (reveal.css), so the slides will be laid out wrongly. Ask your AI assistant to keep the links to reveal.css and a theme.';
  const handWritten = '.reveal { position: relative; } .reveal .slides { position: absolute; } .reveal .slides > section { display: none; }';

  // The layout rule of reveal.css, as the browser check of the review measured it (review W3.3).
  const layout = '.reveal .slides>section,.reveal .slides>section>section{display:none;position:absolute;width:100%}';

  it('warns when reveal.css was replaced by a hand-written file or a cosmetic rule, in a file or a style element', async () => {
    const cosmetic = '.reveal .slides section { background: #eef; }';
    const cases: Record<string, string>[] = [
      { 'index.html': reveal('<section>A</section>', { head: '<link rel="stylesheet" href="css/reveal-base.css">' }), 'css/reveal-base.css': handWritten },
      { 'index.html': reveal('<section>A</section>', { head: `<style>${handWritten}</style>` }) },
      { 'index.html': reveal('<section>A</section>', { head: `<style>${cosmetic}</style>` }) },
      // The rule in a comment, or inside the body of another rule, does not count.
      { 'index.html': reveal('<section>A</section>', { head: `<style>/* ${layout} */ ${cosmetic}</style>` }) },
      { 'index.html': reveal('<section>A</section>', { head: '<style>.reveal .slides > section { color: red } .other { position: absolute }</style>' }) },
      { 'index.html': reveal('<section>A</section>', { head: '<style>.reveal .slides > section-like { position: absolute }</style>' }) },
    ];
    for (const files of cases) {
      const result = await link(files);
      assert.deepEqual(result.issues.filter((item) => item.code === 'reveal-style-missing').map((item) => [item.severity, item.message]), [['warning', warning]], files['index.html']);
    }
  });

  it('is quiet with the bundled, a local or an inline Reveal.js stylesheet, and for pages that are not Reveal.js', async () => {
    const quiet: Record<string, string>[] = [
      { 'index.html': reveal('<section>A</section>') },
      { 'index.html': reveal('<section>A</section>', { head: '<link rel="stylesheet" href="dist/reveal.css"><link rel="stylesheet" href="dist/theme/black.css">' }), 'dist/reveal.css': '.reveal .slides{}', 'dist/theme/black.css': 'body{}' },
      { 'index.html': reveal('<section>A</section>', { head: '<link rel="stylesheet" href="css/theme.css">' }), 'css/theme.css': '@import url(../lib/reveal.min.css);', 'lib/reveal.min.css': '.reveal{}' },
      { 'index.html': reveal('<section>A</section>', { head: '<link rel="stylesheet" href="https://unpkg.com/reveal.js/dist/reveal.css">' }) },
      // By content, under any name and with any combinator spelling (review W3.3).
      { 'index.html': reveal('<section>A</section>', { head: '<link rel="stylesheet" href="css/styles.css">' }), 'css/styles.css': `body{margin:0}\n${layout}` },
      { 'index.html': reveal('<section>A</section>', { head: '<link rel="stylesheet" href="css/reveal-5.1.0.min.css">' }), 'css/reveal-5.1.0.min.css': layout },
      { 'index.html': reveal('<section>A</section>', { head: `<style>${layout}</style>` }) },
      { 'index.html': reveal('<section>A</section>', { head: '<style>@media screen { .reveal  .slides\n>\nsection { display: none; POSITION : absolute; } }</style>' }) },
      { 'index.html': reveal('<section>A</section>', { head: '<style>.reveal>.slides>section{transition:none;position:absolute}</style>' }) },
      { 'index.html': reveal('<section>A</section>', { head: '<style>.reveal .slides section { position: absolute; top: 0 }</style>' }) },
      { 'index.html': page('<div class="reveal"><div class="slides"><section>A</section></div></div><style>body{}</style>') },
    ];
    for (const files of quiet) {
      const result = await link(files);
      assert.ok(!codes(result).includes('reveal-style-missing'), files['index.html']);
    }
  });
});

describe('the content test for the Reveal.js layout (review W3.3)', () => {
  it('finds the layout in the real reveal.css of versions 3 to 6, under any name', async () => {
    const real = readFileSync(new URL('../node_modules/reveal.js/dist/reveal.css', import.meta.url), 'utf8');
    assert.equal(hasRevealLayoutRule(real), true);
    assert.equal(hasRevealLayoutRule('.reveal .slides > section, .reveal .slides > section > section {\n  display: none;\n  position: absolute;\n  width: 100%; }'), true, 'the 3.x file');
    const result = await link({ 'index.html': reveal('<section>A</section>', { head: '<link rel="stylesheet" href="css/styles.css">' }), 'css/styles.css': real });
    assert.ok(!codes(result).includes('reveal-style-missing'));
  });

  it('does not count a rule that is not closed, or a comment that is not closed', () => {
    assert.equal(hasRevealLayoutRule('.reveal .slides > section { position: absolute'), false);
    assert.equal(hasRevealLayoutRule('/* .reveal .slides > section { position: absolute }'), false);
    assert.equal(hasRevealLayoutRule('.reveal .slides > section { position: relative } x { position: absolute }'), false);
    assert.equal(hasRevealLayoutRule(''), false);
  });
});

describe('data saved in the browser (VF5.3)', () => {
  const note = 'The presentation saves data in the browser, for example progress or scores. In the player this lasts only until the presentation is stopped.';

  it('notes writes to localStorage, sessionStorage, indexedDB and cookies in the presentation\'s own scripts', async () => {
    for (const code of ['localStorage.setItem("slide", 3);', 'window.sessionStorage["score"] = 5;', 'localStorage.best = 7;', 'indexedDB.open("quiz");', 'document.cookie = "seen=1";']) {
      const result = await link({ 'index.html': page(`<p>x</p><script>${code}</script>`) });
      assert.deepEqual(result.issues.filter((item) => item.code === 'browser-storage').map((item) => [item.severity, item.message]), [['info', note]], code);
    }
    const module = await link({ 'index.html': reveal('<section>A</section>', { init: 'Reveal.initialize();' }).replace('</body>', '<script type="module" src="js/app.js"></script></body>'), 'js/app.js': 'localStorage.setItem("x", "1");' });
    assert.ok(codes(module).includes('browser-storage'));
  });

  it('is quiet for reads, comparisons and the deck\'s own copy of Reveal.js', async () => {
    for (const code of ['const slide = localStorage.getItem("slide");', 'if (document.cookie == "") {}', 'var name = "localStorage";',
      // Review W3.4: a cookie read into a variable named cookie, and writes that are only mentioned in comments.
      'var cookie = document.cookie;', '// localStorage.setItem("x", 1);\nvar y = 1;', '/* document.cookie = "a=1"; sessionStorage.x = 2; */ var z = "//";']) {
      assert.ok(!codes(await link({ 'index.html': page(`<p>x</p><script>${code}</script>`) })).includes('browser-storage'), code);
    }
    const local = await link({
      'index.html': page('<div class="reveal"><div class="slides"><section>A</section></div></div><script src="dist/reveal.js"></script><script>Reveal.initialize();</script>', '<link rel="stylesheet" href="dist/reveal.css">'),
      'dist/reveal.js': 'window.Reveal = { initialize() { sessionStorage.setItem("reveal-scroll-top", 0); } };',
      'dist/reveal.css': '.reveal .slides{}',
    });
    assert.ok(!codes(local).includes('browser-storage'), JSON.stringify(local.issues));
  });
});

describe('wording (VF6.5, VF6.8)', () => {
  const fontNote = 'Web fonts from fonts.googleapis.com need the internet, so they are left out; the slides use fonts installed on this device instead.';
  const fontLink = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">';

  it('uses one sentence for web fonts in the check, the linker and the Slidev conversion', async () => {
    const files = deck({ 'index.html': reveal('<section>A</section>', { head: `${REVEAL_STYLE}${fontLink}` }) });
    assert.deepEqual(detectDeck(files).issues.filter((item) => item.code === 'external-font').map((item) => item.message), [fontNote]);
    assert.equal(issue(await link({ 'index.html': reveal('<section>A</section>', { head: `${REVEAL_STYLE}${fontLink}` }) }), 'external-font')?.message, fontNote);
    const converted = await convert(slidevBuild({ head: fontLink }));
    assert.equal(converted.issues.find((item) => item.code === 'external-font')?.message, fontNote);
  });

  it('says what to do about a script that is not part of a Slidev build', async () => {
    const converted = await convert(slidevBuild({ head: '<script src="/extra.js"></script>' }));
    assert.equal(converted.issues.find((item) => item.code === 'script-left-out')?.message,
      'The script /extra.js is not part of the Slidev build, so it was left out. If something is missing in the slides, build again with "npx slidev build", then open a new ZIP of the project (with dist/ inside).');
  });

  it('ends the inline-script notes with a next step, and says "AI assistant"', async () => {
    const next = 'Ask your AI assistant to attach the action in a script with addEventListener instead.';
    const markdown = await link({ 'index.html': reveal('<section data-markdown><textarea data-template><button onclick="go()">Go</button></textarea></section>') });
    assert.ok(issue(markdown, 'inline-script-unsupported')?.message.endsWith(next));
    const template = await link({ 'index.html': page('<template><button onclick="go()">Go</button></template><p>x</p>') });
    assert.ok(issue(template, 'inline-script-unsupported')?.message.endsWith(next));
    const source = detectDeck(deck({ 'slides.md': '---\ntheme: default\n---\n# Hi\n', 'package.json': '{"dependencies":{"@slidev/cli":"52.0.0"}}' }));
    assert.match(source.issues.find((item) => item.code === 'slidev-source')?.message ?? '', /ask your AI assistant for the built presentation/);
  });

  it('asks for a new ZIP of the project with dist/ inside in every Slidev rebuild note, with straight quotes', async () => {
    const files = deck({ 'slides.md': '---\ntheme: default\n---\n# Hi\n', 'package.json': '{"dependencies":{"@slidev/cli":"52.0.0"}}' });
    assert.match(detectDeck(files).issues.find((item) => item.code === 'slidev-source')?.message ?? '',
      /Run "npx slidev build" in the project, which makes its dist folder, then open a new ZIP of the project \(with dist\/ inside\)/);
    const project = await openDeck(new File([zipSync({ 'slides.md': files.get('slides.md')!, 'package.json': files.get('package.json')! })], 'waves.zip'));
    assert.ok(project);
    const result = await buildPlayable(project, { vendor: () => nodeVendorProvider() });
    for (const item of result.issues.filter((entry) => entry.code === 'slidev-source')) {
      assert.match(item.message, /open a new ZIP of the project \(with dist\/ inside\)/);
      assert.doesNotMatch(item.message, /ZIP of the dist folder/);
    }
    const build = slidevBuild();
    build.set('index.html', new TextEncoder().encode(new TextDecoder().decode(build.get('index.html')).replace('src="/assets/index-abc.js"', 'src="https://example.org/app.js"')));
    const noApp = await convert(build);
    assert.equal(noApp.issues.find((item) => item.code === 'slidev-entry-missing')?.message,
      'The build\'s index.html does not start its app from a script in the ZIP. Build again with "npx slidev build", then open a new ZIP of the project (with dist/ inside and its whole assets folder).');
    assert.doesNotMatch(readFileSync('src/lib/slidev-convert.ts', 'utf8'), /[“”]npx/);
  });
});

/** A small Slidev build, as in tests/slidev-convert.test.ts. */
function slidevBuild({ head = '' } = {}): DeckFiles {
  return deck({
    'index.html': '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Waves - Slidev</title>'
      + `<meta property="slidev:version" content="53.1.0"><script type="module" crossorigin src="/assets/index-abc.js"></script>${head}`
      + '<link rel="stylesheet" crossorigin href="/assets/index-abc.css"></head><body><div id="app"></div></body></html>',
    'assets/index-abc.js': 'import{c as createRouter,ue}from"./vue-abc.js";export const router=createRouter({history:ue(`/`),routes:[]});',
    'assets/vue-abc.js': 'export function c(options){return options}export function ue(base){return base}',
    'assets/index-abc.css': 'body{margin:0}',
  });
}

async function convert(files: DeckFiles) {
  const detection = detectDeck(files);
  assert.equal(detection.kind, 'slidev-build');
  return convertSlidevFiles(files, detection, async () => 'window.bundled=1');
}
