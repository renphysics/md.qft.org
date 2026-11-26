/**
 * Decks linked by src/lib/deck-linker.ts, played in Chromium through the real
 * player: the runtime from src/lib/presentation-runtime.ts, the production
 * runner page (presentation-sandbox.html), its opaque sandbox and its policy,
 * with every request to another origin blocked. Linking runs in Node with the
 * bundled libraries read from node_modules.
 */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { tsImport } from 'tsx/esm/api';
import { until } from './harness.mjs';

export const title = 'Linked Reveal.js decks';

const load = (path) => tsImport(path, import.meta.url);

/**
 * Reveal's hash option calls history.replaceState, which an opaque blob:
 * document refuses for its first slide unless that slide has an id. The
 * player's tolerant profile guards these calls; until it does, this test adds
 * the same guard so that it checks the linker rather than that known gap.
 */
const HISTORY_GUARD = '<script>for(const name of ["replaceState","pushState"]){const call=history[name].bind(history);history[name]=function(...args){try{return call(...args)}catch{}}}</script>';

async function runtimeBundle() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../../src/lib/presentation-runtime.ts', import.meta.url))],
    bundle: true, write: false, format: 'iife', globalName: 'QftRuntime', platform: 'browser', target: 'es2022',
  });
  return result.outputFiles[0].text;
}

function testPage(runtime) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Linked deck test</title>
<style>html,body{margin:0}#host{width:1280px;height:720px}</style></head>
<body><div id="host"></div><script>${runtime.replace(/<\/script/gi, '<\\/script')}</script><script>
window.play = (html) => new Promise((resolve) => {
  window.player?.destroy();
  const host = document.getElementById('host');
  window.player = QftRuntime.createPresentationPlayer(host, html, {
    title: 'Linked deck',
    sandboxUrl: new URL('../presentation-sandbox.html', location.href).href,
    onState(state) { if (state === 'ready') resolve('ready'); },
    onError(message, origin) { resolve(origin + ': ' + message); },
  });
  window.player.start();
});
</script></body></html>`;
}

async function deckFrame(page) {
  return until(async () => {
    for (const frame of page.frames()) {
      if (frame.url().startsWith('blob:') && await frame.evaluate(() => !!document.querySelector('.reveal, main, body > *')).catch(() => false)) return frame;
    }
    return false;
  }, 'the deck frame');
}

/** Plays linked HTML in the real player and returns its frame once it is ready. */
async function play(page, html, label) {
  const state = await page.evaluate((source) => window.play(source), html.replace(/<head>/i, `<head>${HISTORY_GUARD}`));
  assert.equal(state, 'ready', `${label}: the player reports`);
  return deckFrame(page);
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
  const pageUrl = new URL('__linked-deck-test__/', t.baseUrl).href;
  const html = testPage(await runtimeBundle());
  await context.route(pageUrl, (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
  await page.goto(pageUrl, { waitUntil: 'load' });

  await t.step('A Reveal.js 5 deck from jsDelivr plays with KaTeX, highlighting, keyboard navigation and its slider', async () => {
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

  await t.step('A cdnjs Reveal.js 4 deck renders its Markdown slides and the converted onclick button works', async () => {
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

  await t.step('A Reveal.js 6 deck from unpkg plays with math and highlighting', async () => {
    const frame = await play(page, await linked(loadFixtureDeck('cdn-reveal6-unpkg'), 'reveal 6'), 'reveal 6');
    const state = await revealState(frame);
    assert.equal(state.slides, 4);
    assert.ok(state.formulas >= 2, `KaTeX typeset ${state.formulas} formulas`);
    assert.equal(state.mathErrors, 0);
    assert.ok(state.highlighted >= 1);
  });

  await t.step('A local project gets the missing Reveal.js files and plays external Markdown, backgrounds, lazy images, @import and its script', async () => {
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

  await t.step('A plain HTML page plays with its own stylesheet and script', async () => {
    const frame = await play(page, await linked(loadFixtureDeck('plain-html'), 'plain page'), 'plain page');
    await frame.locator('#angle').focus();
    await frame.locator('#angle').press('Home');
    await until(async () => (await frame.locator('#range').textContent()) === '7.1', 'the range readout');
    assert.equal(await frame.evaluate(() => getComputedStyle(document.body).marginTop), '32px');
  });

  for (const name of Object.keys(RESEARCH_DECKS)) {
    const file = researchDeck(name);
    if (!file) { console.log(`SKIP ${t.name}: ${name} (research archive absent)`); continue; }
    await t.step(`The AI-made research deck ${name} plays with its formulas and simulation`, async () => {
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
