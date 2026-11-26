/**
 * The presentation library end to end, as a person uses it: Reveal.js decks
 * and plain pages opened as a bare .html file or a ZIP, from the library's
 * file input, the workspace's Open file and drag and drop, then checked,
 * saved, played offline in the isolated player and reopened. Every request to
 * another origin is blocked and recorded by the harness.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { tsImport } from 'tsx/esm/api';
import { until } from './harness.mjs';
import { deckFrame } from './player-host.mjs';

export const title = 'Presentation library for every deck';


const status = (page) => page.locator('[data-pres-player-status]').textContent();

async function playing(page) {
  await until(async () => (await status(page)) === 'Playing locally', 'the deck to play locally');
}

/** Choose a file in an <input type=file>, as a person does. */
async function choose(page, selector, name, buffer, mimeType) {
  await page.locator(selector).setInputFiles({ name, mimeType, buffer });
}

/** Wait until the deck view offers Start, then start it and return the deck's frame. */
async function startDeck(page, selector = '.reveal .slides') {
  await page.locator('[data-pres-start-button]').waitFor({ state: 'visible', timeout: 60_000 });
  assert.equal(await page.locator('[data-pres-host] iframe').count(), 0, 'opening a deck must not run it');
  await page.locator('[data-pres-start-button]').click();
  await playing(page);
  const frame = await deckFrame(page, selector);
  // The player hands the keyboard to the deck: no click on the slide first.
  await until(() => frame.evaluate(() => document.hasFocus()), 'keyboard focus to reach the deck without a click', 10_000);
  return frame;
}

async function revealReady(frame) {
  await until(() => frame.evaluate(() => /** @type {any} */ (window).Reveal?.isReady?.()), 'Reveal.js to be ready');
}

const horizontal = (frame) => frame.evaluate(() => Reveal.getIndices().h);

/** ArrowRight from the host page, with no click into the deck, moves to the next slide. */
async function arrowRight(page, frame) {
  await revealReady(frame);
  const before = await horizontal(frame);
  await page.keyboard.press('ArrowRight');
  await until(async () => (await horizontal(frame)) === before + 1, 'ArrowRight to change the slide');
}

async function showSlideWith(frame, selector) {
  await frame.evaluate((query) => {
    const { h, v } = Reveal.getIndices(document.querySelector(query).closest('section'));
    Reveal.slide(h, v);
  }, selector);
  await frame.locator(selector).waitFor({ state: 'visible' });
}

async function slideCount(page, count) {
  await until(async () => (await page.locator('[data-pres-slides]').textContent()) === `${count} slides`, `the library to show ${count} slides`);
}

async function stopAndBack(page) {
  await page.locator('[data-pres-back]').click();
  await page.locator('[data-pres-library]').waitFor({ state: 'visible' });
  await until(async () => (await page.locator('[data-pres-host] iframe').count()) === 0, 'the deck to stop');
}

async function savedTitles(page) {
  await page.locator('[data-pres-library]').waitFor({ state: 'visible' });
  await page.locator('[data-pres-list]:not([aria-busy])').waitFor();
  return page.locator('.presentation-saved-open strong').allTextContents();
}

export default async function run(t) {
  const { loadFixtureDeck } = await tsImport('../helpers/deck-fixtures.ts', import.meta.url);
  const zipped = (name, wrap = '') => {
    const entries = {};
    for (const [path, bytes] of loadFixtureDeck(name)) entries[wrap + path] = bytes;
    return Buffer.from(zipSync(entries));
  };
  const html = (name) => Buffer.from(loadFixtureDeck(name).get('index.html'));

  const { context, page } = await t.newPage({ acceptDownloads: true });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await t.openWorkspace(page);
  const dialog = page.locator('[data-pres-dialog]');

  await t.step('A bare Reveal.js 5 HTML file from jsDelivr opens from Open file, plays offline, and its slider works', async () => {
    await choose(page, '[data-file-input]', 'damped-oscillator.html', html('cdn-reveal5-single'), 'text/html');
    await until(async () => /Saved in this browser/.test(await page.locator('[data-pres-storage]').textContent()), 'the deck to be saved');
    assert.equal(await page.locator('[data-pres-title]').textContent(), 'Damped oscillator');
    assert.equal(await page.locator('[data-pres-engine]').textContent(), 'Reveal.js');
    assert.match(await page.locator('[data-pres-subtitle]').textContent(), /^Reveal\.js · 1 file · /);
    const frame = await startDeck(page);
    await arrowRight(page, frame);
    await slideCount(page, 8);
    await showSlideWith(frame, '#zeta');
    assert.equal(await frame.locator('#zeta-value').textContent(), '0.20');
    await frame.locator('#zeta').press('ArrowRight');
    await until(async () => (await frame.locator('#zeta-value').textContent()) === '0.25', 'the slider to update its readout');
    assert.deepEqual(t.externalRequests, []);
    await page.screenshot({ path: resolve(t.artifacts, 'decks-reveal5.png') });
  });

  await t.step('Pressing F in a Reveal.js deck shows it fullscreen and does not stop it', async () => {
    const frame = await deckFrame(page, '.reveal .slides');
    // The slider kept the keyboard after the last step; give it back to the slides.
    await frame.evaluate(() => { /** @type {HTMLElement} */ (document.activeElement)?.blur(); Reveal.slide(2, 0); });
    await until(() => frame.evaluate(() => document.hasFocus()), 'the deck to keep the keyboard');
    const before = await horizontal(frame);
    await page.keyboard.press('f');
    await until(() => page.evaluate(() => document.fullscreenElement === document.querySelector('[data-pres-stage]')), 'the stage to enter fullscreen');
    assert.equal(await status(page), 'Playing locally');
    assert.equal(await deckFrame(page, '.reveal .slides'), frame, 'the same deck keeps playing');
    assert.equal(await horizontal(frame), before);
    await until(() => frame.evaluate(() => document.hasFocus()), 'the deck to keep the keyboard in fullscreen', 10_000);
    await page.keyboard.press('ArrowLeft');
    await until(async () => (await horizontal(frame)) === before - 1, 'the keyboard to work in fullscreen');
    await page.locator('[data-pres-exit-fullscreen]').click();
    await until(() => page.evaluate(() => !document.fullscreenElement), 'fullscreen to end');
    assert.equal(await status(page), 'Playing locally');
  });

  await t.step('Notes from the check list what the linker did, and Copy report for AI writes qft-deck-check/1', async () => {
    const notes = page.locator('[data-pres-notes]');
    assert.equal(await notes.isVisible(), true);
    await notes.locator('summary').click();
    assert.match(await page.locator('[data-pres-notes-list]').textContent(), /copy of Reveal\.js 6\.0\.2 that comes with this site/);
    await page.locator('[data-pres-report]').click();
    await until(async () => /Report copied/.test(await page.locator('[data-pres-notice]').textContent()), 'the report to be copied');
    const report = await page.evaluate(() => navigator.clipboard.readText());
    const lines = report.split('\n');
    assert.equal(lines[0], 'qft-deck-check/1');
    assert.ok(lines.includes('kind: reveal'));
    assert.ok(lines.includes('engine: reveal 5.2.1'));
    assert.ok(lines.includes('slides: 8'));
    assert.ok(lines.some((line) => line.startsWith('- info bundled-library (cdn.jsdelivr.net): ')));
    assert.match(lines.at(-1), /^Reply: /);
  });

  await t.step('The standalone HTML export works for a linked deck', async () => {
    const downloading = page.waitForEvent('download');
    await page.locator('[data-pres-html]').click();
    const download = await downloading;
    assert.equal(download.suggestedFilename(), 'Damped-oscillator.html');
    const file = resolve(t.artifacts, 'decks-reveal5-standalone.html');
    await download.saveAs(file);
    const text = readFileSync(file, 'utf8');
    assert.match(text, /Start presentation/);
    assert.match(text, /"profile":"tolerant"|profile:"tolerant"/);
    // The licence notices of what the copy contains, in the outer page.
    const notices = text.match(/<details id="notices">[\s\S]*?<\/details>/)?.[0] ?? '';
    assert.match(notices, /<summary>Third-party notices<\/summary>/);
    for (const needle of ['Jie Ren', 'Hakim El Hattab', 'Khan Academy', 'Ivan Sagalaev', 'Redistributions in binary form must reproduce', 'SIL Open Font License', 'Source Sans Pro']) {
      assert.ok(notices.includes(needle), `the export carries ${needle}`);
    }
    const zipping = page.waitForEvent('download');
    await page.locator('[data-pres-zip]').click();
    assert.equal((await zipping).suggestedFilename(), 'damped-oscillator.zip');
  });

  await t.step('Opening the same file twice keeps one library entry and says so', async () => {
    await choose(page, '[data-file-input]', 'damped-oscillator.html', html('cdn-reveal5-single'), 'text/html');
    await until(async () => /already in your library/.test(await page.locator('[data-pres-notice]').textContent()), 'the duplicate notice');
    assert.match(await page.locator('[data-pres-storage]').textContent(), /Already in your library/);
    await stopAndBack(page);
    const titles = await savedTitles(page);
    assert.equal(titles.filter((name) => name === 'Damped oscillator').length, 1);
  });

  await t.step('The same deck zipped plays from the library’s own Open presentation', async () => {
    await choose(page, '[data-pres-input]', 'damped-oscillator.zip', zipped('cdn-reveal5-single', 'oscillator/'), 'application/zip');
    const frame = await startDeck(page);
    await arrowRight(page, frame);
    await showSlideWith(frame, '#zeta');
    await frame.locator('#zeta').press('ArrowRight');
    await until(async () => (await frame.locator('#zeta-value').textContent()) === '0.25', 'the slider to update its readout');
    assert.deepEqual(t.externalRequests, []);
  });

  await t.step('A cdnjs Reveal.js 4 deck plays and its converted onclick button works', async () => {
    await choose(page, '[data-pres-input]', 'units.html', html('cdn-reveal4-cdnjs'), 'text/html');
    const frame = await startDeck(page);
    await arrowRight(page, frame);
    await showSlideWith(frame, '#answer');
    await frame.getByRole('button', { name: 'Show answer' }).click();
    await until(async () => (await frame.locator('#answer').textContent()) === 'Force is mass times acceleration: kg m / s²', 'the converted onclick handler');
    assert.deepEqual(t.externalRequests, []);
  });

  await t.step('A Reveal.js 6 deck from unpkg plays and its own navigation control works', async () => {
    await choose(page, '[data-file-input]', 'entropy.html', html('cdn-reveal6-unpkg'), 'text/html');
    const frame = await startDeck(page);
    await arrowRight(page, frame);
    const before = await horizontal(frame);
    await frame.locator('.reveal .controls .navigate-right').click();
    await until(async () => (await horizontal(frame)) === before + 1, 'the deck’s next-slide control');
    await slideCount(page, 4);
    assert.deepEqual(t.externalRequests, []);
  });

  await t.step('A local Reveal.js project ZIP dropped on the workspace plays with its own script', async () => {
    await page.locator('[data-pres-close]').click();
    await dialog.waitFor({ state: 'hidden' });
    const bytes = zipped('local-project', 'optics-workshop/').toString('base64');
    const transfer = await page.evaluateHandle((data) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([Uint8Array.from(atob(data), (char) => char.charCodeAt(0))], 'optics-workshop.zip', { type: 'application/zip' }));
      return transfer;
    }, bytes);
    await page.locator('.cm-editor').dispatchEvent('drop', { dataTransfer: transfer });
    const frame = await startDeck(page);
    await arrowRight(page, frame);
    await showSlideWith(frame, '#trace');
    await frame.getByRole('button', { name: 'Trace a ray' }).click();
    await until(async () => (await frame.locator('#ray-count').textContent()) === '1', 'the deck script to count the click');
    assert.deepEqual(t.externalRequests, []);
  });

  await t.step('A plain HTML page ZIP plays with its own stylesheet and script', async () => {
    await choose(page, '[data-pres-input]', 'projectile.zip', zipped('plain-html'), 'application/zip');
    const frame = await startDeck(page, '#angle');
    assert.equal(await page.locator('[data-pres-engine]').textContent(), 'HTML');
    await frame.locator('#angle').focus();
    await frame.locator('#angle').press('Home');
    await until(async () => (await frame.locator('#range').textContent()) === '7.1', 'the page’s range readout');
    assert.deepEqual(t.externalRequests, []);
  });

  await t.step('A Slidev source ZIP is explained, with the fix, and not saved', async () => {
    await stopAndBack(page);
    const before = (await savedTitles(page)).length;
    await choose(page, '[data-pres-input]', 'waves-source.zip', zipped('slidev-source'), 'application/zip');
    await page.locator('[data-pres-deck]').waitFor({ state: 'visible' });
    await until(async () => /Not saved/.test(await page.locator('[data-pres-storage]').textContent()), 'the not-saved note');
    assert.equal(await page.locator('[data-pres-start-button]').isVisible(), false);
    assert.equal(await page.locator('[data-pres-present]').isDisabled(), true);
    const problem = await page.locator('[data-pres-problem]').textContent();
    assert.match(problem, /npx slidev build/);
    assert.match(problem, /dist folder/);
    assert.equal(await page.locator('[data-pres-notes]').getAttribute('open'), '');
    assert.equal(await page.locator('[data-pres-host] iframe').count(), 0);
    await stopAndBack(page);
    assert.equal((await savedTitles(page)).length, before);
  });

  await t.step('A Markdown document ZIP and a lesson ZIP still open in the workspace', async () => {
    await page.locator('[data-pres-close]').click();
    await dialog.waitFor({ state: 'hidden' });
    await choose(page, '[data-file-input]', 'lab-notes.zip', zipped('not-a-deck'), 'application/zip');
    await until(async () => (await page.locator('[data-editor]').textContent()).includes('The pendulum period barely changed'), 'the Markdown import');
    assert.equal(await dialog.isVisible(), false, 'the presentation library stays closed');
    // A version 2 lesson ZIP, whose demo is an HTML page, is still a lesson.
    const lesson = Buffer.from(zipSync({
      'qft.json': strToU8(JSON.stringify({ format: 'qft-markdown', version: 2, projectId: 'deck-suite-lesson', document: 'slides.md', title: 'Pendulum lesson', images: [], mode: 'slides' })),
      'slides.md': strToU8('# Pendulum lesson\n\nPredict the period.\n\n---\n\n```interactive src="demos/explore.html" title="Explore"\n```\n'),
      'demos/explore.html': strToU8('<!doctype html><html><body><button id="go">Go</button><script>document.getElementById("go").addEventListener("click",()=>{});</script></body></html>'),
    }));
    await choose(page, '[data-file-input]', 'pendulum-lesson.zip', lesson, 'application/zip');
    await until(async () => (await page.locator('[data-editor]').textContent()).includes('Predict the period.'), 'the lesson import');
    assert.equal(await dialog.isVisible(), false, 'a lesson never opens as a presentation');
  });

  await t.step('The shipped Slidev example plays, takes the keyboard and its demo works', async () => {
    await page.locator('[data-open-presentations]').click();
    await page.locator('[data-pres-example]').click();
    const frame = await startDeck(page, '#app .slidev-layout');
    assert.equal(await page.locator('[data-pres-engine]').textContent(), 'Slidev');
    await frame.getByRole('heading', { name: /Phase makes\s*the difference/ }).waitFor({ timeout: 20_000 });
    await page.keyboard.press('ArrowRight');
    await frame.getByRole('heading', { name: 'Amplitudes add.' }).waitFor({ timeout: 20_000 });
    await page.keyboard.press('ArrowRight');
    await frame.getByRole('heading', { name: 'Change the relative phase.' }).waitFor({ timeout: 20_000 });
    await frame.getByRole('button', { name: 'Opposite · 180°', exact: true }).click();
    await until(async () => (await frame.locator('.intensity-value > strong').textContent()) === '0.00', 'destructive interference');
    assert.deepEqual(t.externalRequests, []);
  });

  // The two AI-made decks of the research report, from docs/research/presentation-platform/prototypes.zip.
  const { researchDeck, RESEARCH_DECKS } = await tsImport('../helpers/deck-corpus.ts', import.meta.url);
  for (const [name, deck] of Object.entries(RESEARCH_DECKS)) {
    const file = researchDeck(name);
    assert.ok(file, `${name} is in docs/research/presentation-platform/prototypes.zip`);
    await t.step(`The AI-made research deck ${file.name} plays with its simulation`, async () => {
      await choose(page, '[data-pres-input]', file.name, Buffer.from(await file.arrayBuffer()), 'application/zip');
      const frame = await startDeck(page);
      await arrowRight(page, frame);
      await slideCount(page, deck.slides);
      await showSlideWith(frame, deck.slider);
      const before = await frame.locator(deck.readout).textContent();
      await frame.locator(deck.slider).press('End');
      await until(async () => (await frame.locator(deck.readout).textContent()) !== before, 'the simulation readout to follow the slider');
      assert.deepEqual(t.externalRequests, []);
      await page.screenshot({ path: resolve(t.artifacts, `decks-${name}.png`) });
    });
  }

  await t.step('After a reload, saved decks of every engine are listed and reopen', async () => {
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('.cm-editor').waitFor();
    await page.locator('[data-open-presentations]').click();
    const titles = await savedTitles(page);
    for (const name of ['Damped oscillator', 'Units and dimensions', 'Entropy in one picture', 'Optics workshop', 'Projectile explorer', 'Quantum interference']) {
      assert.ok(titles.some((title) => title.includes(name)), `${name} is listed`);
    }
    assert.match(await page.locator('.presentation-saved-open', { hasText: 'Entropy in one picture' }).textContent(), /Reveal\.js · /);
    await page.locator('.presentation-saved-open', { hasText: 'Entropy in one picture' }).click();
    const frame = await startDeck(page);
    await arrowRight(page, frame);
    await page.locator('[data-pres-close]').click();
    await dialog.waitFor({ state: 'hidden' });
  });

  await t.step('Create with AI offers a Reveal.js prompt with no starter ZIP', async () => {
    await page.locator('[data-create-ai]').click();
    await page.locator('[data-ai-format]').selectOption('reveal');
    assert.equal(await page.locator('[data-ai-starter]').isVisible(), false);
    assert.equal(await page.locator('[data-ai-example]').isVisible(), false);
    assert.match(await page.locator('[data-ai-format-help]').textContent(), /download the HTML file or ZIP it returns, and open it here/);
    await page.locator('[data-ai-topic]').fill('Damped harmonic motion');
    await page.locator('[data-ai-form] button[type="submit"]').click();
    await until(async () => /^Copied\./.test(await page.locator('[data-ai-status]').textContent()), 'the instructions to be copied');
    const prompt = await page.evaluate(() => navigator.clipboard.readText());
    assert.match(prompt, /^Create a Reveal\.js presentation/);
    assert.match(prompt, /Damped harmonic motion/);
    assert.match(prompt, /reveal\.js@6\.0\.2/);
    await page.locator('[data-ai-format]').selectOption('qft');
    assert.equal(await page.locator('[data-ai-starter]').isVisible(), true);
    await page.locator('[data-ai-close]').click();
  });

  await t.step('A package saved by the previous library version still lists and plays', async () => {
    const legacy = Buffer.from(zipSync({
      'qft-presentation.json': strToU8(JSON.stringify({ format: 'qft-presentation', version: 1, engine: 'slidev', title: 'Legacy lesson', entry: 'presentation.html' })),
      'presentation.html': strToU8('<!doctype html><html><body><main><h1>Saved before the update</h1></main></body></html>'),
    }));
    // A fresh browser profile, with the version 1 database as the old library wrote it.
    const { page: old } = await t.newPage();
    await old.goto(new URL('robots.txt', t.baseUrl).href);
    await old.evaluate(async (data) => {
      const archive = new Blob([Uint8Array.from(atob(data), (char) => char.charCodeAt(0))], { type: 'application/zip' });
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('qft-presentations', 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore('presentations', { keyPath: 'id' });
          request.result.createObjectStore('archives', { keyPath: 'id' });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction(['presentations', 'archives'], 'readwrite');
        tx.objectStore('presentations').put({ id: 'legacy-1', title: 'Legacy lesson', engine: 'slidev', fileName: 'legacy.zip', archiveSize: archive.size, createdAt: 1, updatedAt: 1 });
        tx.objectStore('archives').put({ id: 'legacy-1', archive });
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    }, legacy.toString('base64'));
    await t.openWorkspace(old);
    await old.locator('[data-open-presentations]').click();
    const row = old.locator('.presentation-saved-open', { hasText: 'Legacy lesson' });
    await row.waitFor();
    assert.match(await row.textContent(), /Slidev · /);
    await row.click();
    const frame = await startDeck(old, 'main h1');
    assert.equal(await frame.locator('main h1').textContent(), 'Saved before the update');
    assert.equal(await old.locator('[data-pres-engine]').textContent(), 'Slidev');
  });

  await t.step('Nothing left the page', async () => {
    assert.deepEqual(t.externalRequests, []);
  });
}
