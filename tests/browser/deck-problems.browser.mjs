/**
 * What the library tells a teacher when a presentation misbehaves while it
 * plays, end to end in the real library: a Reveal.js deck whose start-up
 * script stops before Reveal.initialize is started with basic settings and
 * says so in a strip above the slides; one that cannot be started shows a
 * problem on the stage and the status line does not claim it plays; links to
 * websites open only from the page's own button, in a new tab, also in
 * Present; and applying an edit to a plain page says that it starts again
 * from the beginning. Every other request to another origin is blocked.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { until } from './harness.mjs';
import { deckFrame } from './player-host.mjs';

export const title = 'Problems and links while a presentation plays';

const REVEAL = 'https://cdn.jsdelivr.net/npm/reveal.js@5.2.1';

/** A Reveal.js 5 deck from jsDelivr, as AI assistants write them, with the given start-up script. */
function revealDeck(title, startup, { body = '' } = {}) {
  const head = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<link rel="stylesheet" href="${REVEAL}/dist/reset.css"><link rel="stylesheet" href="${REVEAL}/dist/reveal.css"><link rel="stylesheet" href="${REVEAL}/dist/theme/white.css"></head>
<body><div class="reveal"><div class="slides">
<section><h1>${title}</h1>${body}</section>
<section><h2>Second slide</h2></section>
<section><h2>Third slide</h2></section>
</div></div>`;
  return Buffer.from(`${head}<script src="${REVEAL}/dist/reveal.js"></script><script>${startup}</script></body></html>`);
}

const status = (page) => page.locator('[data-pres-player-status]').textContent();

async function open(page, name, buffer) {
  await page.locator('[data-pres-input]').setInputFiles({ name, mimeType: 'text/html', buffer });
  await until(async () => /Saved in this browser/.test(await page.locator('[data-pres-storage]').textContent()), `${name} to be saved`);
}

async function start(page) {
  await page.locator('[data-pres-start-button]').waitFor({ state: 'visible', timeout: 60_000 });
  await page.locator('[data-pres-start-button]').click();
  return deckFrame(page, '.reveal .slides');
}

async function back(page) {
  await page.locator('[data-pres-back]').click();
  await page.locator('[data-pres-library]').waitFor({ state: 'visible' });
}

/** Download the open presentation's standalone HTML and open it at a private address. */
async function exported(t, context, page, name) {
  const downloading = page.waitForEvent('download');
  await page.locator('[data-pres-html]').click();
  const file = resolve(t.artifacts, `deck-problems-${name}.html`);
  await (await downloading).saveAs(file);
  const url = new URL(`__deck-problems-${name}__/`, t.baseUrl).href;
  const body = readFileSync(file, 'utf8');
  await context.route(url, (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body }));
  const standalone = t.observe(await context.newPage());
  await standalone.goto(url, { waitUntil: 'load' });
  return standalone;
}

export default async function run(t) {
  t.allowPageError(/missingHelper is not defined|undefinedSetting is not defined|gtag is not defined/);
  const { context, page } = await t.newPage({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  await t.openWorkspace(page);
  await page.locator('[data-open-presentations]').click();
  await page.locator('[data-pres-library]').waitFor({ state: 'visible' });

  await t.step('A deck whose start-up script throws before Reveal.initialize is started with basic settings, and a strip says so', async () => {
    const deck = revealDeck('Rescued lesson', 'const theme = undefinedSetting.colour; Reveal.initialize({ hash: true, transition: "fade" });');
    await open(page, 'rescued.html', deck);
    const frame = await start(page);
    const strip = page.locator('[data-pres-rescued]');
    await strip.waitFor({ state: 'visible', timeout: 15_000 });
    assert.match(await strip.textContent(), /start-up script stopped with an error, so the slides are shown with basic settings\. Some parts may be missing\./);
    await until(() => frame.evaluate(() => /** @type {any} */ (window).Reveal?.isReady?.()), 'Reveal.js to be ready');
    assert.equal(await frame.locator('section.present h1').isVisible(), true, 'the first slide shows');
    assert.equal(await page.locator('[data-pres-stalled]').isVisible(), false);
    assert.equal(await status(page), 'Playing locally · 1 problem reported');
    assert.equal(await page.locator('[data-pres-notes]').evaluate((details) => details.open), true, 'the notes open for a start-up problem');
    assert.match(await page.locator('[data-pres-runtime-list]').textContent(), /undefinedSetting is not defined/);
    // The strip is above the slides, not over them.
    const [stripBox, frameBox] = await Promise.all([strip.boundingBox(), page.locator('[data-pres-host] iframe').boundingBox()]);
    assert.ok(stripBox.y + stripBox.height <= frameBox.y + 1, `strip ${JSON.stringify(stripBox)} frame ${JSON.stringify(frameBox)}`);
    await page.keyboard.press('ArrowRight');
    await until(() => frame.evaluate(() => /** @type {any} */ (window).Reveal.getIndices().h === 1), 'the keyboard to change slides');
    await page.screenshot({ path: resolve(t.artifacts, 'deck-problems-rescued.png') });
  });

  await t.step('The rescue strip stays visible in Present', async () => {
    await page.locator('[data-pres-present]').click();
    await until(() => page.evaluate(() => document.fullscreenElement === document.querySelector('[data-pres-stage]')), 'Present to show the stage in fullscreen');
    assert.equal(await page.locator('[data-pres-rescued]').isVisible(), true);
    assert.equal(await page.evaluate(() => document.fullscreenElement.contains(document.querySelector('[data-pres-rescued]'))), true);
    await page.screenshot({ path: resolve(t.artifacts, 'deck-problems-rescued-present.png') });
    await page.locator('[data-pres-exit-fullscreen]').click();
    await until(() => page.evaluate(() => !document.fullscreenElement), 'fullscreen to end');
    await page.locator('[data-pres-restart]').click();
    await until(async () => (await page.locator('[data-pres-rescued]').isVisible()) === false || (await status(page)) === 'Opening presentation…', 'Restart to clear the strip');
    await page.locator('[data-pres-rescued]').waitFor({ state: 'visible', timeout: 15_000 });
    await back(page);
  });

  await t.step('A deck that cannot be started shows a problem on the stage, not “Playing locally”', async () => {
    // Reveal.initialize runs, but a plugin's start-up fails: a second
    // initialize is refused, so the player cannot start it either.
    const deck = revealDeck('Broken plugin lesson', 'Reveal.initialize({ hash: true, plugins: [{ id: "broken", init() { missingHelper(); } }] });');
    await open(page, 'broken-plugin.html', deck);
    await start(page);
    const problem = page.locator('[data-pres-stalled]');
    await problem.waitFor({ state: 'visible', timeout: 15_000 });
    assert.equal(await problem.getAttribute('role'), 'alert');
    const text = await problem.textContent();
    assert.match(text, /^The slides did not start\. The presentation's own start-up script stopped with an error\./);
    assert.match(text, /The presentation reported: “?.*missingHelper is not defined/);
    assert.match(text, /Open the notes below, or copy the report for your AI assistant\.$/);
    assert.equal(await status(page), 'The slides did not start');
    assert.equal(await page.locator('[data-pres-host] iframe').count(), 1, 'the frame stays');
    assert.equal(await page.locator('[data-pres-notes]').evaluate((details) => details.open), true);
    assert.equal(await page.locator('[data-pres-rescued]').isVisible(), false);
    await page.screenshot({ path: resolve(t.artifacts, 'deck-problems-blank.png') });
    await page.locator('[data-pres-stop]').click();
    await until(async () => (await status(page)) === 'Ready to start', 'Stop');
    assert.equal(await problem.isVisible(), false, 'Stop clears the problem');
    await back(page);
  });

  await t.step('A link to a website shows a strip and opens only from its button, in a new tab without an opener', async () => {
    const body = '<p><a id="wiki" href="https://en.wikipedia.org/wiki/Wave">Waves on Wikipedia</a> <a id="phet" href="https://phet.colorado.edu/en/simulations/wave-on-a-string" target="_blank">PhET</a> <a id="local" href="page2.html">Page two</a></p>';
    await open(page, 'links.html', revealDeck('Linked lesson', 'Reveal.initialize({ hash: true });', { body }));
    const frame = await start(page);
    await until(() => frame.evaluate(() => /** @type {any} */ (window).Reveal?.isReady?.()), 'Reveal.js to be ready');
    await until(async () => (await status(page)) === 'Playing locally', 'the deck to play without problems');
    // Only the page's own button may open it: give the opened tab something to show.
    await context.route('https://en.wikipedia.org/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Wave</title>' }));
    const opened = [];
    context.on('page', (tab) => opened.push(tab));

    await frame.locator('#local').click();
    await page.waitForTimeout(300);
    assert.equal(await page.locator('[data-pres-link]').isVisible(), false, 'a link to another file only stays cancelled');
    const before = await frame.evaluate(() => location.href);
    await frame.locator('#wiki').click();
    const strip = page.locator('[data-pres-link]');
    await strip.waitFor({ state: 'visible' });
    assert.equal(await strip.locator('strong').textContent(), 'en.wikipedia.org');
    assert.equal(await page.locator('[data-pres-link-text]').textContent(), 'The presentation links to en.wikipedia.org/wiki/Wave.');
    assert.equal(await frame.evaluate(() => location.href), before, 'the deck did not navigate');
    assert.equal(opened.length, 0, 'nothing opened by itself');
    await page.screenshot({ path: resolve(t.artifacts, 'deck-problems-link.png') });

    const tab = context.waitForEvent('page');
    await page.locator('[data-pres-link-open]').click();
    const newTab = await tab;
    await newTab.waitForLoadState();
    assert.equal(newTab.url(), 'https://en.wikipedia.org/wiki/Wave');
    assert.equal(await newTab.evaluate(() => window.opener), null);
    await newTab.close();
    assert.equal(await strip.isVisible(), false);

    // A slide change removes the strip; Dismiss does too.
    await frame.locator('#phet').click();
    await strip.waitFor({ state: 'visible' });
    assert.equal(await strip.locator('strong').textContent(), 'phet.colorado.edu');
    await page.keyboard.press('ArrowRight');
    await until(async () => !(await strip.isVisible()), 'a slide change to remove the strip');
    assert.equal(opened.length, 1, 'only the confirmed link opened');
  });

  await t.step('The link strip shows in Present, inside the fullscreen stage', async () => {
    const frame = await deckFrame(page, '.reveal .slides');
    await frame.evaluate(() => /** @type {any} */ (window).Reveal.slide(0, 0));
    await frame.locator('section.present #wiki').waitFor({ state: 'visible' });
    await page.locator('[data-pres-present]').click();
    await until(() => page.evaluate(() => document.fullscreenElement === document.querySelector('[data-pres-stage]')), 'Present');
    // Let the slides settle at the fullscreen size; a late slide report would remove the strip.
    await page.waitForTimeout(800);
    await until(async () => {
      if (!(await page.locator('[data-pres-link]').isVisible())) await frame.locator('#wiki').click();
      return page.locator('[data-pres-link]').isVisible();
    }, 'the link strip in Present', 15_000);
    assert.equal(await page.evaluate(() => document.fullscreenElement.contains(document.querySelector('[data-pres-link]'))), true);
    await page.screenshot({ path: resolve(t.artifacts, 'deck-problems-link-present.png') });
    await page.locator('[data-pres-link-dismiss]').click();
    assert.equal(await page.locator('[data-pres-link]').isVisible(), false);
    await page.locator('[data-pres-exit-fullscreen]').click();
    await until(() => page.evaluate(() => !document.fullscreenElement), 'fullscreen to end');
  });

  await t.step('The standalone HTML export offers links the same way, and shows the rescue strip', async () => {
    const standalone = await exported(t, context, page, 'links');
    await standalone.getByRole('button', { name: 'Start presentation' }).click();
    const frame = await deckFrame(standalone, '.reveal .slides');
    await until(() => frame.evaluate(() => /** @type {any} */ (window).Reveal?.isReady?.()), 'Reveal.js to be ready in the export');
    await frame.locator('#wiki').click();
    const strip = standalone.locator('#link');
    await strip.waitFor({ state: 'visible' });
    assert.equal(await standalone.locator('#link-text').textContent(), 'The presentation links to en.wikipedia.org/wiki/Wave.');
    assert.equal(await standalone.locator('#link-text strong').textContent(), 'en.wikipedia.org');
    const tab = context.waitForEvent('page');
    await standalone.locator('#link-open').click();
    const newTab = await tab;
    await newTab.waitForLoadState();
    assert.equal(newTab.url(), 'https://en.wikipedia.org/wiki/Wave');
    await newTab.close();
    assert.equal(await strip.isVisible(), false);
    await until(() => standalone.evaluate(() => document.activeElement?.localName === 'iframe'), 'the keyboard to go back to the slides after Open');
    await standalone.close();

    await back(page);
    await page.locator('.presentation-saved-open', { hasText: 'Rescued lesson' }).click();
    await page.locator('[data-pres-start-button]').waitFor({ state: 'visible', timeout: 60_000 });
    const rescued = await exported(t, context, page, 'rescued');
    await rescued.getByRole('button', { name: 'Start presentation' }).click();
    await rescued.locator('#rescued').waitFor({ state: 'visible', timeout: 15_000 });
    const rescuedFrame = await deckFrame(rescued, '.reveal .slides');
    await until(() => rescuedFrame.evaluate(() => /** @type {any} */ (window).Reveal?.isReady?.()), 'the export to start the slides');
    assert.equal(await rescued.locator('#stalled').isVisible(), false);
    // Both Dismiss buttons look alike; only Start is the primary button.
    const looks = await rescued.evaluate(() => ['rescued-dismiss', 'link-dismiss', 'start'].map((id) => getComputedStyle(document.getElementById(id)).backgroundColor));
    assert.equal(looks[0], looks[1], `Dismiss buttons: ${looks.join(' / ')}`);
    assert.notEqual(looks[0], looks[2]);
    await rescued.close();
  });

  await t.step('A deck that starts Reveal.js late, after the rescue, keeps its own settings and the strip goes', async () => {
    await back(page);
    // The error first, the deck's own start three and a half seconds later (after its fonts, say).
    const deck = revealDeck('Late lesson', 'setTimeout(() => Reveal.initialize({ hash: true, slideNumber: "c/t", controls: false }), 3500); const theme = undefinedSetting.colour;');
    await open(page, 'late.html', deck);
    const frame = await start(page);
    await until(() => frame.evaluate(() => /** @type {any} */ (window).Reveal?.getConfig?.().slideNumber === 'c/t'), 'the deck\'s own settings', 15_000);
    await until(async () => !(await page.locator('[data-pres-rescued]').isVisible()), 'the basic-settings strip to go');
    const config = await frame.evaluate(() => { const c = /** @type {any} */ (window).Reveal.getConfig(); return { controls: c.controls, hash: c.hash }; });
    assert.deepEqual(config, { controls: false, hash: true });
    assert.equal(await status(page), 'Playing locally · 1 problem reported', 'the deck\'s own error only');
    assert.doesNotMatch(await page.locator('[data-pres-runtime-list]').textContent(), /already been initialized/);
    await page.keyboard.press('ArrowRight');
    await until(() => frame.evaluate(() => /** @type {any} */ (window).Reveal.getIndices().h === 1), 'the slides to play');
  });

  await t.step("A plain page with Reveal.js-like markup and an error is not taken over, and the player's limits read as its own words", async () => {
    await back(page);
    const own = Buffer.from(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Own slides</title>
<style>.slides section{display:none}.slides section.on{display:block}</style></head>
<body><div class="reveal"><div class="slides"><section class="on"><h1>Own slide one</h1><button id="ask" type="button">Ask</button></section><section><h2>Own slide two</h2></section></div></div>
<script>document.getElementById('ask').addEventListener('click', () => { window.answer = confirm('Ready?'); });
document.addEventListener('keydown', (event) => { if (event.key === 'ArrowRight') { const all = document.querySelectorAll('.slides section'); all[0].classList.remove('on'); all[1].classList.add('on'); } });
gtag('config', 'G-1');</script></body></html>`);
    await open(page, 'own-slides.html', own);
    await page.locator('[data-pres-start-button]').click();
    const frame = await deckFrame(page, '#ask');
    await until(async () => (await status(page)) === 'Playing locally · 1 problem reported', 'the ordinary run-time note');
    await page.waitForTimeout(3500);
    assert.equal(await page.locator('[data-pres-stalled]').isVisible(), false, 'no "did not start" box');
    assert.equal(await page.locator('[data-pres-rescued]').isVisible(), false);
    assert.equal(await status(page), 'Playing locally · 1 problem reported');
    await frame.locator('#ask').click();
    await until(async () => (await status(page)) === 'Playing locally · 2 problems reported', 'the question to be noted');
    const items = await page.locator('[data-pres-runtime-list] > li').allTextContents();
    assert.ok(items.some((text) => /^The presentation reported: .*gtag is not defined/.test(text)), items.join(' | '));
    assert.ok(items.includes('The presentation asked a question in a pop-up window. The player cannot show those, so the question got no answer. Ask your AI assistant to put the question on the slide instead.'),
      `the player's sentence, without the label: ${items.join(' | ')}`);
    await page.keyboard.press('ArrowRight');
    await until(() => frame.locator('h2').isVisible(), 'its own navigation to work');
  });

  await t.step('Applying an edit to a plain page says it starts again from the beginning', async () => {
    await back(page);
    const plain = Buffer.from('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Plain lesson</title></head><body><h1 id="heading">Plain page</h1><p>One page.</p></body></html>');
    await page.locator('[data-pres-input]').setInputFiles({ name: 'plain.html', mimeType: 'text/html', buffer: plain });
    await until(async () => /Saved in this browser/.test(await page.locator('[data-pres-storage]').textContent()), 'the page to be saved');
    await page.locator('[data-pres-start-button]').click();
    await until(async () => (await status(page)) === 'Playing locally', 'the page to play');
    await page.locator('[data-pres-view="source"]').click();
    await page.locator('[data-pres-code] .cm-line', { hasText: 'Plain page' }).click();
    await page.keyboard.press('End');
    await page.keyboard.type(' edited');
    await page.locator('[data-pres-apply]').click();
    await until(async () => /Changes applied\./.test(await page.locator('[data-pres-edit-status]').textContent()), 'the edit to apply');
    const text = await page.locator('[data-pres-edit-status]').textContent();
    assert.match(text, /Choose Presentation to see them\. The presentation starts again from the beginning\./);
    assert.doesNotMatch(text, /same slide/);
  });

  await t.step('Nothing else left the page', async () => {
    assert.deepEqual(t.externalRequests, []);
  });
}
