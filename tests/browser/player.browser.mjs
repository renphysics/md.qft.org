/**
 * The player's tolerant profile, end to end in Chromium: a small Reveal.js 6
 * deck, made by inlining node_modules/reveal.js/dist into one HTML string,
 * plays through the real runtime, the production runner page and its opaque
 * sandbox, with every request to another origin blocked. The same deck under
 * the strict profile still stops, as packages made with the site's tool do.
 *
 * Firefox is not run here. There, assigning location.hash inside the deck
 * throws a TypeError instead of being ignored; under the tolerant profile any
 * uncaught error is only a warning, which the "errors are warnings" step
 * checks with the same message.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tsImport } from 'tsx/esm/api';
import { until } from './harness.mjs';
import { deckFrame, openHost } from './player-host.mjs';

export const title = 'Tolerant presentation player';

const revealFile = (path) => readFile(fileURLToPath(new URL(`../../node_modules/reveal.js/dist/${path}`, import.meta.url)), 'utf8');
const scriptText = (code) => code.replace(/<\/script/gi, '<\\/script');

/**
 * Reveal's own template: hash: true, no id on the first slide, the notes
 * plugin. The deck also carries what the player must keep (title, body id and
 * a class with ">", attributes on <html>, the deck's own box model) and what
 * it must not trust: a "<body" string in a script, an inline handler, and a
 * picture that cannot be decoded.
 */
async function revealDeck({ heading = 'Waves', note = 'In phase', handler = true } = {}) {
  const [reset, styles, core, notes] = await Promise.all(['reset.css', 'reveal.css', 'reveal.js', 'plugin/notes.js'].map(revealFile));
  return `<!doctype html><html lang="en" data-deck="waves"><head><meta charset="utf-8"><title>Tolerant deck</title>
<script>window.decoy = '<body class="from-a-script-string" id="wrong">';</script>
<style>${reset}</style><style>${styles}</style><style>.probe{width:200px;padding:50px}</style></head>
<body id="deck-body" class="deck [&>p]:mt-2"${handler ? ' onload="window.inlineHandler = true"' : ''}>
<div class="reveal"><div class="slides">
<section><h1>${heading}</h1><p>First slide, without an id.</p></section>
<section><h2>Amplitudes add</h2><p class="fragment">${note}</p><p class="fragment">Out of phase</p><aside class="notes">Speaker note.</aside></section>
<section><section><h2>Stack top</h2></section><section><h2>Stack bottom</h2></section></section>
<section><h2>A broken picture</h2><img alt="Broken" src="data:image/png;base64,iVBORw0KGgo="></section>
</div></div>
<div class="probe" id="probe"></div>
<script>${scriptText(core)}</script><script>${scriptText(notes)}</script>
<script>Reveal.initialize({ hash: true, transition: 'none', plugins: [RevealNotes] });</script>
</body></html>`;
}

const events = (page) => page.evaluate(() => /** @type {any} */ (window).events);

async function revealFrame(page) {
  const frame = await deckFrame(page, '.reveal .slides');
  await until(() => frame.evaluate(() => /** @type {any} */ (window).Reveal?.isReady?.()), 'Reveal.js to be ready');
  return frame;
}

const indices = (frame) => frame.evaluate(() => Reveal.getIndices());

/** Press a key as a presenter does: no click into the deck first. */
async function press(page, key, position) {
  await page.keyboard.press(key);
  if (position) await until(async () => (await events(page)).positions.at(-1) === position, `the host to hear ${position} after ${key}`);
}

export default async function run(t) {
  const { exportPresentationHtml } = await tsImport('../../src/lib/presentation-runtime.ts', import.meta.url);
  // Deliberate failures inside the deck: Chromium reports them, the player must not stop.
  t.allowPageError(/Cannot set properties of null \(setting 'marked'\)/);
  t.allowPageError(/Late failure in a click handler|Rejected inside the deck|Location\.hash setter/);
  t.allowConsoleError(/Blocked opening 'about:blank' in a new window because the request was made in a sandboxed frame/);
  t.allowConsoleError(/(?:Refused to load|Loading) the image 'https:\/\/images\.example\.invalid\//);
  t.allowBlockedRequest(/^https:\/\/images\.example\.invalid\//);
  // The strict profile stops at Reveal's refused History call, as before.
  t.allowPageError(/replaceState/);

  const deck = await revealDeck();
  const { context, page } = await t.newPage({ viewport: { width: 1320, height: 760 } });
  await openHost(t, context, page);

  let frame;
  await t.step('A Reveal.js deck with hash: true and no id on its first slide starts under the tolerant profile', async () => {
    assert.equal(await page.evaluate((html) => window.play(html, 'tolerant'), deck), 'ready');
    frame = await revealFrame(page);
    await until(async () => (await events(page)).warnings.includes('A picture in the presentation could not be shown.'), 'the broken picture to be a warning');
    const reported = await events(page);
    assert.deepEqual(reported.errors, []);
    assert.deepEqual(reported.states, ['stopped', 'loading', 'ready']);
    assert.deepEqual(reported.slides, [5]);
    assert.equal(reported.positions[0], '0/0');
    const fidelity = await frame.evaluate(() => ({
      title: document.title, id: document.body.id, classes: [...document.body.classList],
      deck: document.documentElement.dataset.deck, handler: document.body.getAttribute('onload'), inlineHandler: window.inlineHandler,
      // No box-sizing rule of the player's: 200px wide plus 2 x 50px padding.
      probe: document.getElementById('probe').offsetWidth,
    }));
    assert.equal(fidelity.title, 'Tolerant deck');
    assert.equal(fidelity.id, 'deck-body');
    assert.ok(fidelity.classes.includes('deck') && fidelity.classes.includes('[&>p]:mt-2'), fidelity.classes.join(' '));
    assert.ok(!fidelity.classes.includes('from-a-script-string'));
    assert.equal(fidelity.deck, 'waves');
    assert.equal(fidelity.handler, null);
    assert.equal(fidelity.inlineHandler, undefined);
    assert.equal(fidelity.probe, 300);
  });

  await t.step('The keyboard reaches the deck at once and the host follows slides and fragments', async () => {
    await until(() => frame.evaluate(() => document.hasFocus()), 'keyboard focus to reach the deck without a click', 10_000);
    await press(page, 'ArrowRight', '1/0');
    await press(page, 'ArrowRight', '1/0/0');
    await press(page, 'ArrowRight', '1/0/1');
    await press(page, 'ArrowRight', '2/0');
    await press(page, 'ArrowDown', '2/1');
    assert.deepEqual(await indices(frame), { h: 2, v: 1, f: undefined });
    // The guarded History calls still write the fragment Reveal.js asked for
    // (Reveal.js writes at most once a second).
    await until(() => frame.evaluate(() => location.hash === '#/2/1'), 'Reveal.js to write the slide into the address', 5_000);
    assert.equal(await page.evaluate(() => window.player.currentPosition()), '2/1');
  });

  await t.step('F asks the host for fullscreen, S only warns, and the deck keeps playing', async () => {
    await page.keyboard.press('f');
    await until(async () => (await events(page)).fullscreen[0]?.result === 'done', 'the host to enter fullscreen');
    const [request] = (await events(page)).fullscreen;
    assert.equal(request.request, 'enter');
    assert.equal(request.active, true, 'the key press in the deck gave the host user activation');
    assert.equal(await page.evaluate(() => document.fullscreenElement?.id), 'stage');
    await until(() => frame.evaluate(() => document.hasFocus()), 'the deck to keep the keyboard in fullscreen', 10_000);
    await press(page, 'ArrowUp', '2/0');
    await page.evaluate(() => document.exitFullscreen());
    await until(() => page.evaluate(() => !document.fullscreenElement), 'fullscreen to end');
    // Present from the host while the deck still has the keyboard: the
    // keyboard must stay with the deck.
    await page.getByRole('button', { name: 'Present' }).click();
    await until(() => page.evaluate(() => document.fullscreenElement?.id === 'stage'), 'Present to show the stage in fullscreen');
    await until(() => frame.evaluate(() => document.hasFocus()), 'the deck to take the keyboard after Present', 10_000);
    await press(page, 'ArrowDown', '2/1');
    await press(page, 'ArrowUp', '2/0');
    await page.evaluate(() => document.exitFullscreen());
    await until(() => page.evaluate(() => !document.fullscreenElement), 'fullscreen to end');

    await page.keyboard.press('s');
    await until(async () => (await events(page)).warnings.some((text) => /setting 'marked'/.test(text)), 'the speaker view failure to be a warning');
    await page.keyboard.press('ArrowLeft');
    await until(async () => (await events(page)).positions.at(-1) === '1/0/1', 'the deck to keep playing after S');
    const reported = await events(page);
    assert.deepEqual(reported.errors, []);
    assert.equal(reported.states.at(-1), 'ready');
    assert.equal(await page.locator('#host iframe').count(), 1);
  });

  await t.step('Errors, rejections and blocked requests inside the deck are warnings', async () => {
    await frame.evaluate(() => {
      setTimeout(() => { throw new Error('Late failure in a click handler'); });
      // What Firefox throws when a deck assigns location.hash in a blob: document.
      setTimeout(() => { throw new TypeError("Location.hash setter: Access to 'blob:null/deck#x' from script denied."); });
      void Promise.reject(new Error('Rejected inside the deck'));
      const picture = new Image();
      picture.src = 'https://images.example.invalid/cat.png';
      document.body.append(picture);
    });
    const expected = [
      /Late failure in a click handler/, /Location\.hash setter/, /Rejected inside the deck/,
      /^The player blocked a picture \(img-src, images\.example\.invalid\)\.$/,
    ];
    await until(async () => {
      const { warnings } = await events(page);
      return expected.every((pattern) => warnings.some((text) => pattern.test(text)));
    }, 'each problem to arrive as a warning');
    const reported = await events(page);
    assert.deepEqual(reported.errors, []);
    assert.equal(reported.states.at(-1), 'ready');
    assert.ok(reported.warnings.every((text) => typeof text === 'string' && text.length <= 350));
    await press(page, 'ArrowRight', '2/0');
  });

  await t.step('update() replays an edited deck at the same slide and fragment', async () => {
    await frame.evaluate(() => Reveal.slide(1, 0, 1));
    await until(async () => (await events(page)).positions.at(-1) === '1/0/1', 'the host to hear 1/0/1');
    const edited = await revealDeck({ heading: 'Waves, edited', note: 'In phase, edited' });
    assert.equal(await page.evaluate((html) => /** @type {any} */ (window).update(html), edited), 'ready');
    frame = await revealFrame(page);
    assert.deepEqual(await indices(frame), { h: 1, v: 0, f: 1 });
    assert.equal(await frame.locator('.reveal .slides p.fragment').first().textContent(), 'In phase, edited');
    assert.equal((await events(page)).positions.at(-1), '1/0/1');

    await frame.evaluate(() => Reveal.slide(2, 1));
    await until(async () => (await events(page)).positions.at(-1) === '2/1', 'the host to hear 2/1');
    assert.equal(await page.evaluate((html) => /** @type {any} */ (window).update(html), deck), 'ready');
    frame = await revealFrame(page);
    assert.deepEqual(await indices(frame), { h: 2, v: 1, f: undefined });
    assert.equal(await frame.locator('h1').textContent(), 'Waves');
    await until(() => frame.evaluate(() => document.hasFocus()), 'the replayed deck to take the keyboard', 10_000);
    await press(page, 'ArrowUp', '2/0');
  });

  await t.step('start() opens the deck at a given slide; Restart begins at the first', async () => {
    assert.equal(await page.evaluate(() => window.begin({ position: '3/0' })), 'ready');
    frame = await revealFrame(page);
    assert.deepEqual(await indices(frame), { h: 3, v: 0, f: undefined });
    assert.equal(await page.evaluate(() => window.begin('restart')), 'ready');
    frame = await revealFrame(page);
    assert.deepEqual(await indices(frame), { h: 0, v: 0, f: undefined });
    await page.screenshot({ path: resolve(t.artifacts, 'player-tolerant.png') });
  });

  await t.step('The same deck under the strict profile still stops as before', async () => {
    const result = await page.evaluate((html) => window.play(html, 'strict'), deck);
    assert.match(result, /^presentation: /);
    const reported = await events(page);
    assert.equal(reported.states.at(-1), 'error');
    assert.deepEqual(reported.warnings, []);
    assert.equal(await page.locator('#host iframe').count(), 0, 'the deck is removed');
    await page.evaluate(() => window.player.destroy());
  });

  await t.step('A tolerant standalone export plays offline, and F in the deck makes it fullscreen', async () => {
    // The export page's own policy reports any inline handler attribute while
    // the deck is parsed (inertly) for playback; linked decks have none.
    const exported = exportPresentationHtml(await revealDeck({ handler: false }), 'Waves', { profile: 'tolerant' });
    const url = new URL('__tolerant-export__/', t.baseUrl).href;
    await context.route(url, (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: exported }));
    const standalone = t.observe(await context.newPage());
    await standalone.goto(url, { waitUntil: 'load' });
    await standalone.getByRole('button', { name: 'Start presentation' }).click();
    await until(async () => (await standalone.locator('#status').textContent()) === 'Live · use the slide controls or arrow keys', 'the export to play');
    const exportedFrame = await revealFrame(standalone);
    await until(() => exportedFrame.evaluate(() => document.hasFocus()), 'the exported deck to take the keyboard', 10_000);
    await standalone.keyboard.press('ArrowRight');
    await until(async () => (await indices(exportedFrame)).h === 1, 'the arrow key to change slides');
    await standalone.keyboard.press('f');
    await until(() => standalone.evaluate(() => document.fullscreenElement?.id === 'stage'), 'the export to enter fullscreen');
    assert.notEqual(await standalone.locator('#status').textContent(), 'Fullscreen is unavailable. Use the browser fullscreen command.');
    await standalone.keyboard.press('ArrowRight');
    await until(async () => (await indices(exportedFrame)).f === 0, 'the deck to keep the keyboard in fullscreen');
    await standalone.evaluate(() => document.exitFullscreen());
    await standalone.close();
  });

  await t.step('Nothing left the page', async () => {
    assert.deepEqual(t.externalRequests, []);
  });
}
