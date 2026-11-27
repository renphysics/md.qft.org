/**
 * Decks linked by src/lib/deck-linker.ts, played in Chromium through the real
 * player: the runtime from src/lib/presentation-runtime.ts, the production
 * runner page (presentation-sandbox.html), its opaque sandbox and its policy,
 * with every request to another origin blocked. Linking runs in Node with the
 * bundled libraries read from node_modules.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tsImport } from 'tsx/esm/api';
import { until } from './harness.mjs';
import { deckFrame, openHost } from './player-host.mjs';

export const title = 'Linked Reveal.js decks';

const load = (path) => tsImport(path, import.meta.url);

/** A deck from tests/fixtures/review-decks (copies of the review's evidence) as deck files. */
function reviewDeck(name) {
  const root = fileURLToPath(new URL(`../fixtures/review-decks/${name}/`, import.meta.url));
  const files = new Map();
  const walk = (folder) => {
    for (const item of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, item.name);
      if (item.isDirectory()) walk(path);
      else files.set(relative(root, path).split(sep).join('/'), new Uint8Array(readFileSync(path)));
    }
  };
  walk(root);
  return files;
}

/**
 * Plays linked HTML in the real player under the tolerant profile, as linked
 * decks are played, and returns its frame once it is ready. The tolerant
 * profile guards Reveal's History calls (hash: true with an id-less first
 * slide); every step then checks that the deck reported no warning at all.
 */
async function play(page, html, label) {
  const state = await page.evaluate((source) => window.play(source, 'tolerant'), html);
  assert.equal(state, 'ready', `${label}: the player reports`);
  return deckFrame(page, '.reveal, main, body > *');
}

async function revealState(frame) {
  await until(() => frame.evaluate(() => /** @type {any} */ (window).Reveal?.isReady?.()), 'Reveal.js to be ready');
  await frame.evaluate(() => document.fonts.ready.then(() => undefined));
  return frame.evaluate(async () => ({
    slides: Reveal.getTotalSlides(),
    formulas: document.querySelectorAll('.reveal .slides .katex').length,
    mathErrors: document.querySelectorAll('.katex-error').length,
    rawDisplayMath: [...document.querySelectorAll('.reveal .slides section')].some((section) => /\$\$/.test(section.textContent)),
    // The embedded font decodes: a face that fails to load rejects or stays unloaded.
    katexFont: await document.fonts.load('20px KaTeX_Main').then((faces) => faces.some((face) => face.status === 'loaded'), () => false),
    highlighted: document.querySelectorAll('.reveal pre code.hljs').length,
  }));
}

/** Shows the slide that contains `selector`. */
async function showSlideWith(frame, selector) {
  await frame.evaluate((query) => {
    const element = document.querySelector(query);
    const slide = element.closest('section');
    const { h, v } = Reveal.getIndices(slide);
    Reveal.slide(h, v);
  }, selector);
  await frame.locator(selector).waitFor({ state: 'visible' });
}

/**
 * A capture taken during a slide transition can show a half-composited frame,
 * so wait for Reveal's transitions to end. Decks may run animations of their
 * own forever; the capture is an artifact for review, not a check.
 */
async function screenshot(t, page, frame, name) {
  await until(() => frame.evaluate(() => document.getAnimations().every((animation) =>
    !(animation instanceof CSSTransition) || animation.playState !== 'running')), 'slide transitions to settle', 5_000).catch(() => {});
  await page.waitForTimeout(350);
  await page.screenshot({ path: resolve(t.artifacts, name) });
}

export default async function run(t) {
  const [{ linkDeck }, { readDeckArchive }, { nodeVendorProvider }, { loadFixtureDeck }, { researchDeck, RESEARCH_DECKS }] = await Promise.all([
    load('../../src/lib/deck-linker.ts'), load('../../src/lib/deck-archive.ts'), load('../helpers/deck-vendor-node.ts'),
    load('../helpers/deck-fixtures.ts'), load('../helpers/deck-corpus.ts'),
  ]);
  const detection = { kind: 'reveal', engine: 'reveal', issues: [], flags: {} };
  const linked = async (files, label) => {
    const result = await linkDeck(files, detection, nodeVendorProvider());
    assert.deepEqual(result.issues.filter((issue) => issue.severity === 'error'), [], `${label}: linking`);
    return result.html;
  };

  const { context, page } = await t.newPage({ viewport: { width: 1320, height: 760 } });
  await openHost(t, context, page, '__linked-deck-test__/');
  /** A deck step that must end with no warning and no error from the player. */
  const step = (name, action) => t.step(name, async () => {
    await action();
    const { warnings, errors } = await page.evaluate(() => /** @type {any} */ (window).events);
    assert.deepEqual(errors, [], `${name}: errors`);
    assert.deepEqual(warnings, [], `${name}: warnings`);
  });

  await step('A Reveal.js 5 deck from jsDelivr plays with KaTeX, highlighting, keyboard navigation and its slider', async () => {
    const frame = await play(page, await linked(loadFixtureDeck('cdn-reveal5-single'), 'reveal 5'), 'reveal 5');
    const state = await revealState(frame);
    assert.equal(state.slides, 8);
    assert.ok(state.formulas >= 6, `KaTeX typeset ${state.formulas} formulas`);
    assert.equal(state.mathErrors, 0);
    assert.equal(state.rawDisplayMath, false, 'no formula is left as TeX source');
    assert.equal(state.katexFont, true, 'the embedded KaTeX fonts load');
    assert.ok(state.highlighted >= 1, 'code is highlighted');
    await frame.locator('.reveal').press('ArrowRight');
    await until(() => frame.evaluate(() => Reveal.getIndices().h === 1), 'the arrow key to change slides');
    await showSlideWith(frame, '#zeta');
    assert.equal(await frame.locator('#zeta-value').textContent(), '0.20');
    await frame.locator('#zeta').press('ArrowRight');
    await until(async () => (await frame.locator('#zeta-value').textContent()) === '0.25', 'the slider to update its readout');
    await screenshot(t, page, frame, 'linked-reveal5.png');
  });

  await step('A cdnjs Reveal.js 4 deck renders its Markdown slides and the converted onclick button works', async () => {
    const frame = await play(page, await linked(loadFixtureDeck('cdn-reveal4-cdnjs'), 'reveal 4'), 'reveal 4');
    const state = await revealState(frame);
    // Four Markdown slides ("--" is no separator without data-separator-vertical) and one HTML slide.
    assert.equal(state.slides, 5);
    assert.ok(await frame.locator('.reveal .slides aside.notes').count() >= 1, 'Markdown notes become speaker notes');
    await showSlideWith(frame, '#answer');
    await frame.getByRole('button', { name: 'Show answer' }).click();
    await until(async () => (await frame.locator('#answer').textContent()) === 'Force is mass times acceleration: kg m / s²', 'the converted onclick handler');
    await screenshot(t, page, frame, 'linked-reveal4.png');
  });

  await step('A Reveal.js 6 deck from unpkg plays with math and highlighting', async () => {
    const frame = await play(page, await linked(loadFixtureDeck('cdn-reveal6-unpkg'), 'reveal 6'), 'reveal 6');
    const state = await revealState(frame);
    assert.equal(state.slides, 4);
    assert.ok(state.formulas >= 2, `KaTeX typeset ${state.formulas} formulas`);
    assert.equal(state.mathErrors, 0);
    assert.ok(state.highlighted >= 1);
  });

  await step('A local project gets the missing Reveal.js files and plays external Markdown, backgrounds, lazy images, @import and its script', async () => {
    const frame = await play(page, await linked(loadFixtureDeck('local-project'), 'local project'), 'local project');
    const state = await revealState(frame);
    assert.equal(state.slides, 7, 'three Markdown slides (one with a vertical slide) and three HTML slides');
    assert.equal(await frame.locator('.reveal .slides h2', { hasText: "Snell's law" }).count(), 1);
    await showSlideWith(frame, '.on-picture');
    const background = await frame.evaluate(() => {
      const index = Reveal.getIndices(document.querySelector('.on-picture').closest('section'));
      return Reveal.getSlideBackground(index.h, index.v).querySelector('.slide-background-content').style.backgroundImage;
    });
    assert.match(background, /^url\("data:image\/png;base64,/);
    assert.match(await frame.evaluate(() => getComputedStyle(document.querySelector('.on-picture')).backgroundImage), /^url\("data:image\/png;base64,/);
    await showSlideWith(frame, 'img[alt="A small test pattern"]');
    await until(() => frame.evaluate(() => {
      const image = document.querySelector('img[alt="A small test pattern"]');
      return image.src.startsWith('data:image/png') && image.complete && image.naturalWidth > 0;
    }), 'the lazy image to load');
    await showSlideWith(frame, '#trace');
    assert.match(await frame.evaluate(() => getComputedStyle(document.querySelector('#trace')).paddingLeft), /px$/);
    assert.notEqual(await frame.evaluate(() => getComputedStyle(document.querySelector('#trace')).paddingLeft), '0px', 'the @import-ed stylesheet applies');
    await frame.getByRole('button', { name: 'Trace a ray' }).click();
    await until(async () => (await frame.locator('#ray-count').textContent()) === '1', 'the deck script to count the click');
    await screenshot(t, page, frame, 'linked-local-project.png');
  });

  await step('A plain HTML page plays with its own stylesheet and script', async () => {
    const frame = await play(page, await linked(loadFixtureDeck('plain-html'), 'plain page'), 'plain page');
    await frame.locator('#angle').focus();
    await frame.locator('#angle').press('Home');
    await until(async () => (await frame.locator('#range').textContent()) === '7.1', 'the range readout');
    assert.equal(await frame.evaluate(() => getComputedStyle(document.body).marginTop), '32px');
  });

  await step('A deck that lists plugins whose scripts were left out (RevealMenu, RevealChalkboard) still starts', async () => {
    const files = reviewDeck('misc');
    // Chart.js is left out as well; drop the deck's call to it, which would fail after the start.
    const index = new TextDecoder().decode(files.get('index.html')).replace(/\.then\(function\(\)\{ new Chart[^\n]*\}\);/, ';');
    assert.doesNotMatch(index, /new Chart/);
    files.set('index.html', new TextEncoder().encode(index));
    const frame = await play(page, await linked(files, 'misc'), 'misc');
    const state = await revealState(frame);
    assert.equal(state.slides, 7, 'title, two Markdown slides and four HTML slides');
    assert.ok(await frame.locator('.reveal .slides h2', { hasText: 'External two' }).count() === 1, 'the Markdown slides render');
    await frame.locator('.reveal').press('ArrowRight');
    await until(() => frame.evaluate(() => Reveal.getIndices().h === 1), 'the arrow key to change slides');
  });

  await step('MathJax-only commands (\\label, \\require, \\eqref, eqnarray) show no raw TeX in the KaTeX stand-in', async () => {
    const frame = await play(page, await linked(reviewDeck('math3'), 'math3'), 'math3');
    await revealState(frame);
    const math = await frame.evaluate(() => Object.fromEntries(['m2', 'm3', 'm4'].map((id) => [id,
      [...document.querySelectorAll(`#${id} .katex`)].map((element) => element.querySelector('.katex-html')?.textContent ?? '').join(' | ')])));
    assert.ok(math.m2, 'the align environment is typeset');
    assert.doesNotMatch(math.m2, /label|eq:emc/, `align: ${math.m2}`);
    assert.doesNotMatch(math.m3, /require/, `require: ${math.m3}`);
    assert.doesNotMatch(math.m4, /eqnarray|No such environment/, `eqnarray: ${math.m4}`);
    assert.equal(await frame.locator('#m4 .katex-error').filter({ hasText: 'eqnarray' }).count(), 0);
    // References in ordinary text get the number of the labelled row (the deck sets tags: 'ams'), and \unicode gives the character (review VF2b.3).
    assert.equal(await frame.locator('#m2 p').textContent(), 'See (1) and 1.');
    assert.match(math.m4, /→/, `unicode: ${math.m4}`);
  });

  // Equation numbers follow MathJax's setting and do not depend on the slide shown (final check: a CSS counter skipped hidden slides).
  const numberedDeck = (config) => {
    const slides = Array.from({ length: 12 }, (_, index) => [1, 2, 3, 6, 12].includes(index + 1)
      ? `<section><h3>Slide ${index + 1}</h3>\\begin{align} a_{${index + 1}} &= b_{${index + 1}} \\label{eq:s${index + 1}} \\end{align}<p>See \\eqref{eq:s${index + 1}} and the first one \\eqref{eq:s1}.</p></section>`
      : `<section><h3>Slide ${index + 1}</h3><p>No equation here.</p></section>`);
    return new Map([['index.html', new TextEncoder().encode(`<!doctype html><html><head><meta charset="utf-8"><title>Numbered equations</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/reveal.css">
<script>window.MathJax = ${config};</script>
<script src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js"></script>
</head><body><div class="reveal"><div class="slides">${slides.join('\n')}</div></div>
<script src="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/reveal.js"></script>
<script>Reveal.initialize({ hash: true });</script></body></html>`)]]);
  };
  /** Presses an arrow key until slide `target` (counted from 0) shows; returns what it shows. */
  const goTo = async (frame, target) => {
    for (let current = await frame.evaluate(() => Reveal.getIndices().h); current !== target;) {
      const key = current < target ? 'ArrowRight' : 'ArrowLeft';
      await frame.locator('.reveal').press(key);
      const next = current + (key === 'ArrowRight' ? 1 : -1);
      await until(() => frame.evaluate((h) => Reveal.getIndices().h === h, next), `slide ${next + 1} to show`);
      current = next;
    }
    return frame.evaluate(() => {
      const slide = document.querySelector('.reveal .slides section.present');
      return { tags: [...slide.querySelectorAll('.katex-html .katex-tag')].map((tag) => tag.textContent.replace(/\u200b/g, '').trim()), text: slide.querySelector('p').textContent };
    });
  };

  await step('Equation numbers and \\eqref follow MathJax\'s tags setting and stay the same on every visit of a slide', async () => {
    const frame = await play(page, await linked(numberedDeck("{ tex: { tags: 'ams', inlineMath: [['$','$']] } }"), 'numbered'), 'numbered');
    await revealState(frame);
    assert.equal(await frame.evaluate(() => document.querySelectorAll('.katex-error').length), 0);
    const twelfth = await goTo(frame, 11);
    assert.deepEqual(twelfth, { tags: ['(5)'], text: 'See (5) and the first one (1).' });
    assert.deepEqual(await goTo(frame, 2), { tags: ['(3)'], text: 'See (3) and the first one (1).' });
    assert.deepEqual(await goTo(frame, 0), { tags: ['(1)'], text: 'See (1) and the first one (1).' });
    await frame.evaluate(() => MathJax.typesetPromise());
    assert.deepEqual(await goTo(frame, 11), twelfth, 'the same after going back to the first slide and typesetting again');

    const plain = await play(page, await linked(numberedDeck("{ tex: { inlineMath: [['$','$']] } }"), 'unnumbered'), 'unnumbered');
    await revealState(plain);
    assert.deepEqual(await goTo(plain, 2), { tags: [], text: 'See (?) and the first one (?).' }, 'MathJax numbers nothing by default');
    assert.equal(await plain.evaluate(() => document.querySelectorAll('.katex-html .katex-tag, .katex-html .eqn-num').length), 0);
  });

  await step('A long numbered environment is typeset with its numbers, and typesetting again leaves typeset formulas alone', async () => {
    // 90 rows that use a macro of the presentation six times each, which MathJax 3 typesets with (1) to (90):
    // \tag costs KaTeX expansions that MathJax does not count (closing check Y1.1).
    const rows = Array.from({ length: 90 }, (_, index) => `\\v{a}_{${index}} &= \\v{b} + \\v{c} + \\v{d} + \\v{e} + \\v{f}`).join(' \\\\\n');
    // Reveal.js's text copy of the current slide for screen readers, here already in the page and holding TeX: whether
    // Reveal.js's own copy held raw TeX at the first typesetting pass depended on timing (re-check W1.1).
    const status = '<div class="aria-status" aria-live="polite" style="position:absolute;height:1px;width:1px;overflow:hidden;clip:rect(1px,1px,1px,1px)">\\begin{equation} s = 1 \\end{equation}</div>';
    // Its own list of skipped tags (without annotation) and typesetting on every slide change (closing check Y1.3).
    const config = "{ tex: { tags: 'ams', macros: { v: ['\\\\mathbf{#1}', 1] } }, options: { skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre'] } }";
    const files = new Map([['index.html', new TextEncoder().encode(`<!doctype html><html><head><meta charset="utf-8"><title>Long environment</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/reveal.css">
<script>window.MathJax = ${config};</script>
<script src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js"></script>
</head><body><div class="reveal"><div class="slides">
<section><h3>Long</h3>\\begin{align}\n${rows}\n\\end{align}<p>The last is \\eqref{eq:after} minus one.</p></section>
<section><h3>After</h3>\\begin{equation} z = 1 \\label{eq:after} \\end{equation}<p>See \\eqref{eq:after}.</p></section>
</div>${status}</div>
<script src="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/reveal.js"></script>
<script>Reveal.initialize({ hash: true }); Reveal.on('slidechanged', function () { MathJax.typesetPromise(); });</script></body></html>`)]]);
    const frame = await play(page, await linked(files, 'long'), 'long');
    await revealState(frame);
    // Counted in the slides: Reveal also keeps a text copy of the current slide for screen readers (.aria-status), which changes with the slide.
    const count = () => frame.evaluate(() => ({
      errors: document.querySelectorAll('.katex-error').length, formulas: document.querySelectorAll('.reveal .slides .katex').length,
      nested: document.querySelectorAll('annotation .katex, .katex .katex, .katex-error .katex-error').length,
    }));
    // KaTeX puts the numbers of all rows into one column of tags.
    const first = await frame.evaluate(() => ({
      tags: [...document.querySelectorAll('.reveal .slides section:first-child .katex-html .katex-tag')].map((tag) => tag.textContent.replace(/[\u200b\s]/g, '')).join(' '),
      text: document.querySelector('.reveal .slides section:first-child p').textContent,
    }));
    assert.deepEqual(first, { tags: Array.from({ length: 90 }, (_, index) => `(${index + 1})`).join(''), text: 'The last is (91) minus one.' });
    const before = await count();
    assert.deepEqual({ errors: before.errors, nested: before.nested }, { errors: 0, nested: 0 });
    // The copy for screen readers is not typeset, so the equations of the slides are all that was counted.
    const counted = () => frame.evaluate(() => ({ numbers: window.__qftEquations.count, inCopy: document.querySelectorAll('.aria-status .katex, .aria-status .katex-error').length }));
    assert.deepEqual(await counted(), { numbers: 91, inCopy: 0 });
    assert.deepEqual(await goTo(frame, 1), { tags: ['(91)'], text: 'See (91).' });
    await goTo(frame, 0);
    for (let pass = 0; pass < 3; pass += 1) await frame.evaluate(() => MathJax.typesetPromise());
    assert.deepEqual(await count(), before, 'five more typesetting passes add nothing');
    assert.deepEqual(await counted(), { numbers: 91, inCopy: 0 }, 'also after Reveal.js has written the copy again');
    assert.deepEqual(await goTo(frame, 1), { tags: ['(91)'], text: 'See (91).' });
  });

  await step('A plain page that loads MathJax 3 on its own is typeset with KaTeX, also text that MathJax.typesetPromise is asked for later', async () => {
    const html = `<!doctype html><html><head><meta charset="utf-8">
<script>window.MathJax = { tex: { macros: { RR: '\\\\mathbb{R}' } } };</script>
<script id="MathJax-script" async src="https://cdn.jsdelivr.net/npm/mathjax@3.2.2/es5/tex-svg.js"></script></head><body>
<p id="inline">Inline \\(x^2 + \\RR\\) and a price of $5 and $6.</p>
<p id="display">$$\\int_0^1 x\\,dx = \\frac12$$</p>
<div id="env">\\begin{align} a &= b + c \\label{eq:one} \\\\ d &= e \\tag{*} \\end{align}</div>
<p id="later"></p>
<script>window.addLater = function () { var later = document.getElementById('later'); later.textContent = 'Added \\\\(z^3\\\\) later'; return MathJax.typesetPromise([later]).then(function () { return later.querySelectorAll('.katex').length; }); };</script>
</body></html>`;
    const result = await linkDeck(new Map([['index.html', new TextEncoder().encode(html)]]), { kind: 'html', engine: 'html', issues: [], flags: {} }, nodeVendorProvider());
    assert.ok(result.issues.some((issue) => issue.code === 'math-rendered-with-katex'));
    assert.ok(!result.issues.some((issue) => issue.code === 'external-library'), JSON.stringify(result.issues));
    const frame = await play(page, result.html, 'MathJax 3 page');
    await until(() => frame.evaluate(() => document.querySelectorAll('#display .katex-display').length === 1), 'the display formula to be typeset');
    const state = await frame.evaluate(() => ({
      inline: document.querySelectorAll('#inline .katex').length,
      errors: document.querySelectorAll('.katex-error').length,
      text: document.querySelector('#inline').textContent,
      environment: document.querySelectorAll('#env .katex-display').length,
      environmentText: document.querySelector('#env .katex-html')?.textContent ?? document.querySelector('#env').textContent,
    }));
    assert.equal(state.inline, 1, 'one inline formula: MathJax does not read single dollars by default');
    // MathJax typesets an environment written directly in the text (review W3.2).
    assert.equal(state.environment, 1, 'the bare align environment is typeset');
    assert.doesNotMatch(state.environmentText, /\\begin|\\label/);
    assert.equal(state.errors, 0, 'the macro from the configuration is known');
    assert.match(state.text, /a price of \$5 and \$6\.$/);
    assert.equal(await frame.evaluate(() => window.addLater()), 1, 'MathJax.typesetPromise typesets the added text');
  });

  // KaTeX's own documented snippet starts auto-render from the script's onload (review W3.1).
  const katexSnippet = (base) => `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="${base}katex.min.css">
<script defer src="${base}katex.min.js"></script>
<script defer src="${base}contrib/auto-render.min.js" onload="renderMathInElement(document.body);"></script>
</head><body><p id="inline">Inline \\(\\frac{a}{b}\\)</p><div id="display">$$\\int_0^1 x^2\\,dx$$</div></body></html>`;
  const katexTypeset = async (html, label) => {
    const result = await linkDeck(html instanceof Map ? html : new Map([['index.html', new TextEncoder().encode(html)]]), { kind: 'html', engine: 'html', issues: [], flags: {} }, nodeVendorProvider());
    assert.deepEqual(result.issues.filter((issue) => issue.severity === 'error'), [], `${label}: linking`);
    const frame = await play(page, result.html, label);
    await until(() => frame.evaluate(() => document.querySelectorAll('#inline .katex').length === 1 && document.querySelectorAll('#display .katex-display').length === 1), `${label}: the formulas to be typeset`);
  };

  await step("KaTeX's documented auto-render snippet (onload) typesets with the CDN addresses", async () => {
    await katexTypeset(katexSnippet('https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/'), 'KaTeX from a CDN');
  });

  await step("KaTeX's documented auto-render snippet (onload) typesets with a KaTeX copy inside the ZIP", async () => {
    const dist = fileURLToPath(new URL('../../node_modules/katex/dist/', import.meta.url));
    const files = new Map([['index.html', new TextEncoder().encode(katexSnippet('katex/'))]]);
    for (const name of ['katex.min.js', 'katex.min.css', 'contrib/auto-render.min.js']) files.set(`katex/${name}`, new Uint8Array(readFileSync(join(dist, name))));
    await katexTypeset(files, 'KaTeX in the ZIP');
  });

  await step('<script src="…/reveal.js" onload="Reveal.initialize()"> starts the slides', async () => {
    const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/reveal.css"></head><body>
<div class="reveal"><div class="slides"><section><p id="m">waiting</p></section><section>Two</section></div></div>
<script src="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/reveal.js" onload="Reveal.initialize(); document.getElementById('m').textContent = 'started by onload';"></script>
</body></html>`;
    const frame = await play(page, await linked(new Map([['index.html', new TextEncoder().encode(html)]]), 'reveal onload'), 'reveal onload');
    const state = await revealState(frame);
    assert.equal(state.slides, 2);
    assert.equal(await frame.locator('#m').textContent(), 'started by onload');
  });

  await step('A raw "<" inside a formula (the AI-made deck p2) no longer cuts the formula and the text after it', async () => {
    const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@6.0.2/dist/reveal.css"></head><body>
<div class="reveal"><div class="slides">
<section><p id="square">方波 \\(f(x)=\\begin{cases}-1,&-\\pi<x<0\\\\ \\;\\;1,&0<x<\\pi\\end{cases}\\)，周期 \\(2\\pi\\)。它在 \\(x=0,\\pm\\pi\\) 处有跳变。</p></section>
<section><p id="range">在 \\(0<x<\\pi\\) 内 \\(\\sin x>0\\)，所以。</p></section>
</div></div>
<script src="https://cdn.jsdelivr.net/npm/reveal.js@6.0.2/dist/reveal.js"></script>
<script src="https://cdn.jsdelivr.net/npm/reveal.js@6.0.2/dist/plugin/math.js"></script>
<script>Reveal.initialize({ plugins: [RevealMath.KaTeX] });</script></body></html>`;
    const frame = await play(page, await linked(new Map([['index.html', new TextEncoder().encode(html)]]), 'p2 formulas'), 'p2 formulas');
    await revealState(frame);
    await until(() => frame.evaluate(() => document.querySelectorAll('#square .katex').length === 3), 'the three formulas of the first paragraph');
    const text = await frame.evaluate(() => {
      // What shows: the typeset formulas without their hidden MathML copy of the TeX.
      const shown = (selector) => {
        const copy = document.querySelector(selector).cloneNode(true);
        for (const hidden of copy.querySelectorAll('.katex-mathml')) hidden.remove();
        return copy.textContent;
      };
      return { square: shown('#square'), range: shown('#range'), rangeFormulas: document.querySelectorAll('#range .katex').length };
    });
    assert.match(text.square, /处有跳变。$/, 'the text after the formula is there');
    assert.doesNotMatch(text.square, /\\begin|\\\(/, 'no raw TeX');
    assert.equal(text.rangeFormulas, 2);
    assert.match(text.range, /内[\s\S]*所以。$/);
  });

  for (const name of Object.keys(RESEARCH_DECKS)) {
    const file = researchDeck(name);
    if (!file) { console.log(`SKIP ${t.name}: ${name} (research archive absent)`); continue; }
    await step(`The AI-made research deck ${name} plays with its formulas and simulation`, async () => {
      const deck = await readDeckArchive(file);
      const frame = await play(page, await linked(deck.files, name), name);
      const expected = RESEARCH_DECKS[name];
      const state = await revealState(frame);
      assert.equal(state.slides, expected.slides);
      assert.ok(state.formulas >= 30, `KaTeX typeset ${state.formulas} formulas`);
      assert.equal(state.mathErrors, 0);
      assert.equal(state.katexFont, true);
      await showSlideWith(frame, expected.slider);
      const before = await frame.locator(expected.readout).textContent();
      await frame.locator(expected.slider).press('End');
      await until(async () => (await frame.locator(expected.readout).textContent()) !== before, 'the simulation readout to follow the slider');
      await screenshot(t, page, frame, `linked-${name}.png`);
    });
  }

  await t.step('Nothing left the page', async () => {
    await page.evaluate(() => window.player?.destroy());
    assert.deepEqual(t.externalRequests, []);
  });
}
