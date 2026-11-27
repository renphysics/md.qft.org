/**
 * The notices over the slides, at a desktop and two phone sizes: the
 * basic-settings notice and the link notice lie over the top of the stage, so
 * the frame and the Reveal.js scale do not change when one shows or goes; one
 * shows at a time; each covers at most half of the stage with its buttons in
 * view and clickable; "Open link in a new tab" gives the keyboard back to the
 * slides. A notice waits while the pointer or the keyboard is in it, and a
 * click on its text leaves the keyboard with the slides. In Present, the
 * notices and the "slides did not start" box keep clear of the Exit
 * fullscreen button.
 */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { until } from './harness.mjs';
import { deckFrame } from './player-host.mjs';

export const title = 'Notices over the slides at desktop and phone sizes';

const REVEAL = 'https://cdn.jsdelivr.net/npm/reveal.js@5.2.1';
const LONG_LINK = 'https://www.a-very-long-host-name-for-a-school-district-website.example.org/curriculum/physics/grade-9/unit-3/forces-and-motion/lesson-plans/newtons-second-law-of-motion.html';

function revealDeck(title, startup, body = '') {
  return Buffer.from(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<link rel="stylesheet" href="${REVEAL}/dist/reveal.css"><link rel="stylesheet" href="${REVEAL}/dist/theme/white.css"></head>
<body><div class="reveal"><div class="slides">
<section><h1>${title}</h1>${body}</section>
<section><h2>Second slide</h2></section>
</div></div><script src="${REVEAL}/dist/reveal.js"></script><script>${startup}</script></body></html>`);
}

const RESCUED = revealDeck('Notice lesson', 'const theme = undefinedSetting.colour; Reveal.initialize({ hash: true });',
  `<p><a id="long" href="${LONG_LINK}">Lesson plan</a></p>`);
// print() while the basic-settings notice shows, as from a Print button pressed early.
const RESCUED_PRINT = revealDeck('Rescued print', 'setTimeout(() => window.print(), 4000); const theme = undefinedSetting.colour; Reveal.initialize({ hash: true });');
const BLANK = revealDeck('Blank lesson', 'Reveal.initialize({ plugins: [{ id: "broken", init() { missingHelper(); } }] });');

const PRINTING = Buffer.from(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Handout lesson</title></head><body>
<style>.handout h1{display:none}</style><h1>Handout lesson</h1><button id="print" type="button">Print handout</button>
<script>window.onbeforeprint = () => { document.body.dataset.before = '1'; };
window.addEventListener('afterprint', () => document.body.classList.remove('handout'));
document.getElementById('print').addEventListener('click', () => { document.body.classList.add('handout'); window.print(); setTimeout(() => window.print(), 10000); });</script></body></html>`);
const PRINT_SENTENCE = 'The presentation tried to print, which the player cannot do. To print the slides, open the presentation\'s HTML file in your web browser (unzip a ZIP first) and print from there.';

const SIZES = [{ width: 1280, height: 800 }, { width: 390, height: 844 }, { width: 320, height: 568 }];

const box = (page, selector) => page.locator(selector).evaluate((element) => {
  const r = element.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
});
const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** The slides' size: the frame's box and the scale Reveal.js chose for it. */
async function slideSize(page, frame) {
  return { frame: await box(page, '[data-pres-host] iframe'), scale: await frame.evaluate(() => /** @type {any} */ (window).Reveal.getScale()) };
}

/** A notice covers at most half of the stage, inside it, and its buttons are on top where a finger lands. */
async function checkNotice(page, selector, buttons) {
  const stage = await box(page, '[data-pres-stage]');
  const notice = await box(page, selector);
  assert.ok(notice.y >= stage.y - 1 && notice.y + notice.height <= stage.y + stage.height / 2 + 1,
    `${selector} ${JSON.stringify(notice)} covers at most the top half of the stage ${JSON.stringify(stage)}`);
  for (const button of buttons) {
    const rect = await box(page, button);
    assert.ok(rect.x >= stage.x && rect.x + rect.width <= stage.x + stage.width + 1 && rect.y + rect.height <= stage.y + stage.height / 2 + 1, `${button} ${JSON.stringify(rect)} is inside the stage`);
    const onTop = await page.locator(button).evaluate((element) => {
      const r = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    });
    assert.equal(onTop, true, `${button} can be clicked`);
  }
  return { stage, notice };
}

async function openDeck(page, name, buffer) {
  // The workspace's Open file when the library is closed, the library's own button when it is open.
  const open = await page.locator('[data-pres-dialog]').evaluate((dialog) => dialog.open);
  await page.locator(open ? '[data-pres-input]' : '[data-file-input]').setInputFiles({ name, mimeType: 'text/html', buffer });
  await page.locator('[data-pres-start-button]').waitFor({ state: 'visible', timeout: 60_000 });
}

/** Present, with an ordinary click: the toolbar wraps on a phone, so the button is whole at 320 px too. */
async function present(page) {
  await page.locator('[data-pres-present]').click();
  await until(() => page.evaluate(() => !!document.fullscreenElement
    || !!document.querySelector('[data-pres-stage].presentation-fallback-fullscreen')), 'Present');
  await page.waitForTimeout(600);
}

async function leaveFullscreen(page) {
  await page.locator('[data-pres-exit-fullscreen]').click();
  await until(() => page.evaluate(() => !document.fullscreenElement
    && !document.querySelector('[data-pres-stage].presentation-fallback-fullscreen')), 'fullscreen to end');
}

export default async function run(t) {
  // The decks' own errors; at phone widths Reveal.js inside the broken "blank"
  // presentation also fails to fill one of its parts after its plugin failed.
  t.allowPageError(/undefinedSetting is not defined|missingHelper is not defined|Cannot set properties of undefined \(setting 'innerHTML'\)/);
  for (const size of SIZES) {
    const label = `${size.width}x${size.height}`;
    const { context, page } = await t.newPage({ viewport: size });
    await context.route('https://www.a-very-long-host-name-for-a-school-district-website.example.org/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Lesson plan</title>' }));
    await t.openWorkspace(page);

    await t.step(`${label}: the basic-settings notice lies over the slides and covers at most half of the stage`, async () => {
      await openDeck(page, `notices-${size.width}.html`, RESCUED);
      await page.locator('[data-pres-start-button]').click();
      const frame = await deckFrame(page, '.reveal .slides');
      await page.locator('[data-pres-rescued]').waitFor({ state: 'visible', timeout: 15_000 });
      await until(() => frame.evaluate(() => /** @type {any} */ (window).Reveal?.isReady?.()), 'Reveal.js to be ready');
      const stage = await box(page, '[data-pres-stage]');
      const { frame: frameBox } = await slideSize(page, frame);
      assert.ok(Math.abs(frameBox.y - stage.y) <= 1 && Math.abs(frameBox.height - stage.height) <= 1, `the frame ${JSON.stringify(frameBox)} fills the stage ${JSON.stringify(stage)}`);
      await checkNotice(page, '[data-pres-rescued]', ['[data-pres-rescued-dismiss]']);
      assert.match(await page.locator('[data-pres-player-status]').textContent(), /^Playing with basic settings/);
    });

    if (size.width === 1280) await t.step(`${label}: the basic-settings notice stays while the pointer is on it, and closes 12 seconds after it left`, async () => {
      const rescued = page.locator('[data-pres-rescued]');
      await rescued.hover();
      await page.waitForTimeout(13_000);
      assert.equal(await rescued.isVisible(), true, 'it waits while the pointer is on it');
      await page.mouse.move(5, 5);
      const left = Date.now();
      await rescued.waitFor({ state: 'hidden', timeout: 16_000 });
      assert.ok(Date.now() - left >= 11_000, `it closes about 12 seconds after the pointer left (${Date.now() - left} ms)`);
    });

    await t.step(`${label}: a link replaces that notice, the slides keep their size, and Open gives the keyboard back`, async () => {
      const frame = await deckFrame(page, '.reveal .slides');
      const before = await slideSize(page, frame);
      await frame.locator('#long').click();
      const link = page.locator('[data-pres-link]');
      await link.waitFor({ state: 'visible' });
      assert.equal(await page.locator('[data-pres-rescued]').isVisible(), false, 'one notice at a time');
      const text = await page.locator('[data-pres-link-text]').textContent();
      assert.ok(text.endsWith('…'), `a shortened address ends without a full stop: ${text}`);
      await checkNotice(page, '[data-pres-link]', ['[data-pres-link-open]', '[data-pres-link-dismiss]']);
      await page.waitForTimeout(400);
      assert.deepEqual(await slideSize(page, frame), before, 'the frame and the Reveal.js scale do not change');
      await page.screenshot({ path: resolve(t.artifacts, `deck-notices-link-${label}.png`) });
      await page.locator('[data-pres-link-dismiss]').click();
      assert.equal(await link.isVisible(), false);
      assert.deepEqual(await slideSize(page, frame), before);

      await frame.locator('#long').click();
      await link.waitFor({ state: 'visible' });
      const tab = context.waitForEvent('page');
      await page.locator('[data-pres-link-open]').click();
      const opened = await tab;
      await opened.waitForLoadState();
      assert.equal(opened.url(), LONG_LINK);
      await opened.close();
      await until(() => page.evaluate(() => document.activeElement?.localName === 'iframe'), 'the keyboard to go back to the slides after Open');
    });

    if (size.width === 1280) await t.step(`${label}: a click on the link notice's text leaves the keyboard with the slides, and the notice waits while the keyboard is in it`, async () => {
      const frame = await deckFrame(page, '.reveal .slides');
      const link = page.locator('[data-pres-link]');
      await frame.locator('#long').click();
      await link.waitFor({ state: 'visible' });
      await page.locator('[data-pres-link-text]').click();
      await until(() => page.evaluate(() => document.activeElement?.localName === 'iframe'), 'the keyboard to stay with the slides');
      await page.keyboard.press('ArrowRight');
      await until(() => frame.evaluate(() => /** @type {any} */ (window).Reveal.getIndices().h === 1), 'the arrow key to move the slides');
      await page.keyboard.press('ArrowLeft');
      await until(() => frame.evaluate(() => /** @type {any} */ (window).Reveal.getIndices().h === 0), 'back to the first slide');
      // The keyboard on its Dismiss button: the notice stays past its 20 seconds.
      await frame.locator('#long').click();
      await link.waitFor({ state: 'visible' });
      await page.locator('[data-pres-link-dismiss]').focus();
      await page.mouse.move(5, 5);
      await page.waitForTimeout(21_000);
      assert.equal(await link.isVisible(), true, 'it waits while the keyboard is in it');
      await page.keyboard.press('Enter');
      assert.equal(await link.isVisible(), false);
      await until(() => page.evaluate(() => document.activeElement?.localName === 'iframe'), 'Dismiss to give the keyboard back');
    });

    await t.step(`${label}: in Present the link notice stays clear of Exit fullscreen and covers at most half`, async () => {
      const frame = await deckFrame(page, '.reveal .slides');
      await present(page);
      await until(async () => {
        if (!(await page.locator('[data-pres-link]').isVisible())) await frame.locator('#long').click();
        return page.locator('[data-pres-link]').isVisible();
      }, 'the link notice in Present', 15_000);
      const exit = await box(page, '[data-pres-exit-fullscreen]');
      for (const button of ['[data-pres-link-open]', '[data-pres-link-dismiss]']) {
        assert.equal(overlaps(await box(page, button), exit), false, `${button} is clear of Exit fullscreen`);
      }
      if (size.width < 700) assert.equal(overlaps(await box(page, '[data-pres-link]'), exit), false, 'the notice is below Exit fullscreen');
      await checkNotice(page, '[data-pres-link]', ['[data-pres-link-open]', '[data-pres-link-dismiss]']);
      await page.locator('[data-pres-link-dismiss]').click();
      await leaveFullscreen(page);
    });

    await t.step(`${label}: in Present the "slides did not start" box stays clear of Exit fullscreen`, async () => {
      await page.locator('[data-pres-back]').click();
      await openDeck(page, `blank-${size.width}.html`, BLANK);
      await page.locator('[data-pres-start-button]').click();
      const problem = page.locator('[data-pres-stalled]');
      await problem.waitFor({ state: 'visible', timeout: 15_000 });
      assert.match(await problem.textContent(), /The notes list what was found; copy the report for your AI assistant\.$/);
      await present(page);
      assert.equal(await problem.isVisible(), true);
      assert.equal(overlaps(await box(page, '[data-pres-stalled]'), await box(page, '[data-pres-exit-fullscreen]')), false, 'the box is clear of Exit fullscreen');
      await page.screenshot({ path: resolve(t.artifacts, `deck-notices-blank-present-${label}.png`) });
      await leaveFullscreen(page);
    });

    if (size.width === 1280) await t.step(`${label}: a Print button gets the player's sentence over the slides, in Present too, without a problem or a line in the report, and a handout view switches back on afterprint`, async () => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.locator('[data-pres-back]').click();
      await openDeck(page, 'handout-lesson.html', PRINTING);
      await page.locator('[data-pres-start-button]').click();
      const frame = await deckFrame(page, '#print');
      await until(async () => (await page.locator('[data-pres-player-status]').textContent()) === 'Playing locally', 'the presentation to play');
      await frame.locator('#print').click();
      const clicked = Date.now();
      const notice = page.locator('[data-pres-rescued]');
      await notice.waitFor({ state: 'visible' });
      assert.equal(await page.locator('[data-pres-rescued-text]').textContent(), PRINT_SENTENCE);
      assert.equal(await frame.locator('h1').isVisible(), true, 'the slide is back after the print attempt');
      assert.equal(await frame.locator('body').getAttribute('data-before'), '1', 'window.onbeforeprint ran');
      assert.equal(await page.locator('[data-pres-player-status]').textContent(), 'Playing locally', 'no problem');
      await present(page);
      assert.equal(await notice.isVisible(), true, 'in Present');
      await checkNotice(page, '[data-pres-rescued]', ['[data-pres-rescued-dismiss]']);
      await leaveFullscreen(page);
      await page.locator('[data-pres-rescued-dismiss]').click();
      assert.equal(await notice.isVisible(), false);
      // print() again from the presentation's timer, with nobody acting: no new notice.
      await page.waitForTimeout(Math.max(0, clicked + 11_000 - Date.now()));
      assert.equal(await notice.isVisible(), false, 'a script cannot bring it back');
      await page.locator('[data-pres-notes] summary').click();
      await page.locator('[data-pres-report]').click();
      const report = await until(async () => {
        const text = await page.evaluate(() => navigator.clipboard.readText());
        return text.startsWith('qft-deck-check/1') && text;
      }, 'the report');
      assert.doesNotMatch(report, /print/, 'not in the report');
    });
    if (size.width === 1280) await t.step(`${label}: print() while the basic-settings notice shows is listed in the notes and leaves that notice in place`, async () => {
      await page.locator('[data-pres-back]').click();
      await openDeck(page, 'rescued-print.html', RESCUED_PRINT);
      await page.locator('[data-pres-start-button]').click();
      await page.locator('[data-pres-rescued]').waitFor({ state: 'visible', timeout: 15_000 });
      const basic = await page.locator('[data-pres-rescued-text]').textContent();
      assert.match(basic, /basic settings/);
      await until(async () => (await page.locator('[data-pres-runtime-list]').textContent()).includes(PRINT_SENTENCE), 'the print sentence in the notes', 15_000);
      await page.waitForTimeout(500);
      assert.equal(await page.locator('[data-pres-rescued]').isVisible(), true);
      assert.equal(await page.locator('[data-pres-rescued-text]').textContent(), basic, 'the basic-settings sentence keeps its place');
    });
    await context.close();
  }

  await t.step('Nothing else left the page', async () => {
    assert.deepEqual(t.externalRequests.filter((url) => !url.startsWith('https://www.a-very-long-host-name')), []);
  });
}
