/** End-to-end checks for real Slidev playback in the isolated presentation player. */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { strToU8, zipSync } from 'fflate';
import { until } from './harness.mjs';

export const title = 'Slidev presentation player';

async function presentationFrame(targetPage) {
  return until(async () => {
    for (const frame of targetPage.frames()) {
      if (frame === targetPage.mainFrame()) continue;
      if (await frame.locator('#app .slidev-layout').count().catch(() => 0)) return frame;
    }
    return false;
  }, 'the actual Slidev application frame');
}

async function heading(frame, name) {
  await frame.getByRole('heading', { name }).waitFor({ state: 'visible', timeout: 20_000 });
}

/** The player hands keyboard focus to the deck itself; a presenter must not need to click first. */
async function deckHasFocus(frame) {
  await until(() => frame.evaluate(() => document.hasFocus()), 'keyboard focus to reach the deck without a click', 10_000);
}

async function goToDemo(targetPage, frame) {
  await heading(frame, /Phase makes\s*the difference/);
  await deckHasFocus(frame);
  // Keys go to whatever the browser focused, exactly as for a presenter who
  // has not clicked inside the slide.
  await targetPage.keyboard.press('ArrowRight');
  await heading(frame, 'Amplitudes add.');
  await targetPage.keyboard.press('ArrowRight');
  await heading(frame, 'Change the relative phase.');
  return frame.getByRole('slider', { name: 'Relative phase in degrees' });
}

async function setDestructiveInterference(frame) {
  await frame.getByRole('button', { name: 'Opposite · 180°', exact: true }).click();
  const slider = frame.getByRole('slider', { name: 'Relative phase in degrees' });
  await slider.press('ArrowRight');
  assert.equal(await slider.inputValue(), '181', 'Arrow keys must operate the focused slider');
  await slider.press('ArrowLeft');
  assert.equal(await slider.inputValue(), '180');
  await heading(frame, 'Change the relative phase.');
  await until(async () => (await frame.locator('.intensity-value > strong').textContent()) === '0.00', 'destructive interference');
  return slider;
}

async function capturePresentation(t, targetPage, frame, name) {
  // Let Vue finish its natural slide fade and the nested frames publish their
  // resize paints. Forcing animations to finish during a full-page capture can
  // capture an empty compositor surface even after a successful interaction.
  await until(() => frame.evaluate(() => document.getAnimations().every(animation =>
    animation.playState !== 'running' || animation.effect?.getTiming().iterations === Infinity)), 'slide transitions to settle', 5_000);
  const child = await frame.frameElement();
  const shell = await frame.parentFrame().frameElement();
  for (const element of [child, shell, frame.locator('.slidev-page-3 .slidev-layout')]) {
    const bounds = await element.boundingBox();
    assert.ok(bounds && bounds.width > 250 && bounds.height > 100, 'The isolated slide and both frames must have usable painted dimensions');
  }
  await targetPage.waitForTimeout(350);
  await targetPage.screenshot({ path: resolve(t.artifacts, name) });
}

/** A minimal portable package whose deck fails while it is being presented. */
function failingPackage(message) {
  const html = `<!doctype html><html><body><main><h1>Failing lesson</h1></main><script>setTimeout(function () { throw new Error(${JSON.stringify(message)}); }, 1500);</script></body></html>`;
  return Buffer.from(zipSync({
    'qft-presentation.json': strToU8(JSON.stringify({ format: 'qft-presentation', version: 1, engine: 'slidev', title: 'Failing lesson', entry: 'presentation.html' })),
    'presentation.html': strToU8(html),
  }));
}

export default async function run(t) {
  const { context, page } = await t.newPage({ acceptDownloads: true });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await t.openWorkspace(page);
  const dialog = page.locator('[data-pres-dialog]');

  await t.step('Open the Slidev library and load a genuine, initially inert package', async () => {
    await page.locator('[data-open-presentations]').click();
    await page.locator('[data-pres-library]').waitFor({ state: 'visible' });
    await page.locator('[data-pres-example]').click();
    await page.locator('[data-pres-start-button]').waitFor({ state: 'visible', timeout: 30_000 });
    await until(async () => (await page.locator('[data-pres-storage]').textContent()).includes('Saved in this browser'), 'the imported ZIP to be saved');
    assert.equal(await page.locator('[data-pres-host] iframe').count(), 0, 'Importing a package must not execute its scripts');
    assert.match(await page.locator('[data-pres-title]').textContent(), /Quantum interference/);
    const bounds = await dialog.boundingBox();
    assert.ok(bounds && bounds.width > 1000, 'The desktop presentation dialog must have room for the slide canvas');
  });

  let frame;
  await t.step('Start all-local Slidev, navigate with the keyboard at once, and operate the actual Vue component', async () => {
    await page.locator('[data-pres-start-button]').click();
    frame = await presentationFrame(page);
    await until(async () => (await page.locator('[data-pres-player-status]').textContent()) === 'Playing locally', 'playback readiness');
    assert.equal(await frame.getByRole('button', { name: 'Enter fullscreen', exact: true }).count(), 0, 'The isolated deck must not offer an unavailable inner fullscreen control');
    await goToDemo(page, frame);
    const slider = await setDestructiveInterference(frame);
    await frame.getByRole('button', { name: 'Animate phase', exact: true }).click();
    await until(async () => Number(await slider.inputValue()) > 181, 'the phase animation to advance');
    await frame.getByRole('button', { name: 'Pause animation', exact: true }).click();
    await setDestructiveInterference(frame);
    await capturePresentation(t, page, frame, 'presentation-desktop.png');
    assert.equal(t.externalRequests.length, 0, 'Playback must not request external resources');
  });

  await t.step('Every slide of the example has its design, and no label runs into the text beside it', async () => {
    // The design lives in the project's style.css, which Slidev loads for the
    // whole presentation. A <style> block in slides.md reaches only the slide
    // it is written in: that is how the first three slides once played with
    // the plain theme and showed "In phaseAt φ = 0". Slidev mounts the slide
    // after the current one as well, so from the third slide all four are in
    // the page; the hidden ones have their styles too.
    await heading(frame, 'Change the relative phase.');
    await frame.locator('.slidev-page-4 .slidev-layout').waitFor({ state: 'attached', timeout: 20_000 });
    const designs = await frame.evaluate(() => [1, 2, 3, 4].map((number) => {
      const layout = document.querySelector(`.slidev-page-${number} .slidev-layout`);
      const style = (element, property) => element ? getComputedStyle(element)[property] : null;
      return {
        background: style(layout, 'backgroundColor'),
        title: style(layout?.querySelector('h1'), 'fontFamily'),
        eyebrow: style(layout?.querySelector('.eyebrow'), 'color'),
      };
    }));
    assert.deepEqual(designs, Array.from({ length: 4 }, () => ({ background: 'rgb(250, 248, 244)', title: 'Georgia, serif', eyebrow: 'rgb(138, 70, 85)' })),
      'Each of the four slides has the paper background, the serif title and the coloured eyebrow');
    const cards = frame.locator('.slidev-page-2 .concept-grid > div');
    assert.equal(await frame.locator('.slidev-page-2 .concept-grid').evaluate((grid) => getComputedStyle(grid).display), 'grid');
    assert.deepEqual(await cards.locator('strong').evaluateAll((labels) => labels.map((label) => getComputedStyle(label).display)), ['block', 'block'],
      'Each label is a line of its own');
    assert.deepEqual(await cards.allTextContents(), ['In phase At φ = 0, the contributions reinforce.', 'Out of phase At φ = π, they cancel at this detector.'],
      'The text itself keeps the label and its sentence apart');
  });

  await t.step('Source remains accessible and read-only; Present keeps the live slide state and the keyboard', async () => {
    await page.locator('[data-pres-view="source"]').click();
    const source = page.locator('[data-pres-code] .cm-content');
    await until(async () => /Quantum interference/.test(await source.textContent()), 'the main source in the viewer');
    assert.equal(await source.getAttribute('aria-readonly'), 'true');
    assert.equal(await source.getAttribute('contenteditable'), 'false');
    assert.match(await page.locator('[data-pres-source-note]').textContent(), /read-only here/);
    await page.locator('.presentation-file[data-pres-file-path="source/components/QuantumInterference.vue"]').click();
    await until(async () => (await page.locator('[data-pres-file-name]').textContent()) === 'source/components/QuantumInterference.vue', 'the component to be selected');
    await page.locator('[data-pres-copy]').click();
    await until(async () => /^Copied /.test(await page.locator('[data-pres-edit-status]').textContent()), 'copy action feedback');
    assert.match(await page.evaluate(() => navigator.clipboard.readText()), /onSlideLeave\(pause\)/);
    await page.locator('[data-pres-present]').click();
    await page.locator('[data-pres-exit-fullscreen]').waitFor({ state: 'visible' });
    const fullscreenFrame = await presentationFrame(page);
    assert.equal(fullscreenFrame, frame, 'Present must reuse the running application');
    await heading(frame, 'Change the relative phase.');
    assert.equal(await frame.getByRole('slider', { name: 'Relative phase in degrees' }).inputValue(), '180');
    // Hiding the frame for the source view released the slider's focus, so
    // the arrow keys now belong to slide navigation. They must reach the deck
    // after Present without a click on the slide.
    assert.equal(await frame.evaluate(() => document.activeElement === document.body), true);
    await deckHasFocus(frame);
    await page.keyboard.press('ArrowLeft');
    await heading(frame, 'Amplitudes add.');
    assert.deepEqual(await frame.locator('.slidev-page-2 .concept-grid > div').allInnerTexts(),
      ['In phase\nAt φ = 0, the contributions reinforce.', 'Out of phase\nAt φ = π, they cancel at this detector.'],
      'On the slide a reader sees each label on its own line above its sentence');
    await page.keyboard.press('ArrowRight');
    await heading(frame, 'Change the relative phase.');
    await page.locator('[data-pres-exit-fullscreen]').click();
  });

  let offlineFile;
  await t.step('Download a standalone player and verify stop, restart, and close lifecycle', async () => {
    const downloading = page.waitForEvent('download');
    await page.locator('[data-pres-html]').click();
    const download = await downloading;
    offlineFile = resolve(t.artifacts, 'slidev-offline-player.html');
    await download.saveAs(offlineFile);
    await page.locator('[data-pres-stop]').click();
    await page.locator('[data-pres-start-button]').waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-pres-host] iframe').count(), 0);
    await page.locator('[data-pres-start-button]').click();
    frame = await presentationFrame(page);
    await heading(frame, /Phase makes\s*the difference/);
    await page.locator('[data-pres-restart]').click();
    await until(async () => (await page.locator('[data-pres-player-status]').textContent()) === 'Playing locally', 'readiness after Restart');
    frame = await presentationFrame(page);
    await heading(frame, /Phase makes\s*the difference/);
    await deckHasFocus(frame);
    await page.keyboard.press('ArrowRight');
    await heading(frame, 'Amplitudes add.');
    await page.locator('[data-pres-close]').click();
    await dialog.waitFor({ state: 'hidden' });
    await until(async () => (await page.locator('[data-pres-host] iframe').count()) === 0, 'close event to remove every playback frame');
  });

  await t.step('Reload the page, reopen the saved ZIP, and render the mobile layout', async () => {
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('.cm-editor').waitFor();
    await page.locator('[data-open-presentations]').click();
    await page.locator('.presentation-saved-open').first().waitFor();
    assert.match(await page.locator('.presentation-saved-open').first().textContent(), /Quantum interference/);
    await page.locator('.presentation-saved-open').first().click();
    await page.locator('[data-pres-start-button]').click();
    frame = await presentationFrame(page);
    await goToDemo(page, frame);
    await page.setViewportSize({ width: 390, height: 844 });
    await until(async () => {
      const bounds = await dialog.boundingBox();
      return bounds && bounds.x >= 0 && bounds.x + bounds.width <= 391;
    }, 'the responsive dialog layout');
    await frame.evaluate(() => document.fonts.ready);
    await capturePresentation(t, page, frame, 'presentation-mobile.png');
    const bounds = await dialog.boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 391, 'The mobile dialog must fit the viewport');
    await page.locator('[data-pres-close]').click();
    await dialog.waitFor({ state: 'hidden' });
    await until(async () => (await page.locator('[data-pres-host] iframe').count()) === 0, 'mobile playback to stop');
    await page.setViewportSize({ width: 1440, height: 1000 });
  });

  await t.step('Existing Markdown and Reveal.js remain editable and playable', async () => {
    await page.locator('[data-file-input]').setInputFiles({
      name: 'reveal-regression.md', mimeType: 'text/markdown',
      buffer: Buffer.from('# Reveal still works\n\nA familiar editable workflow.\n\n---\n\n# Mathematics\n\n$$E=mc^2$$\n'),
    });
    await until(async () => (await page.locator('[data-editor]').textContent()).includes('Reveal still works'), 'the Markdown import');
    await page.locator('[data-content-mode="slides"]').click();
    await until(async () => /1\s*\/\s*2/.test(await page.locator('[data-slide-position]').textContent()), 'Reveal first slide');
    await page.locator('[data-slide-next]').click();
    await until(async () => /2\s*\/\s*2/.test(await page.locator('[data-slide-position]').textContent()), 'Reveal next slide');
    assert.ok(await page.locator('[data-slide-host] .katex').count() > 0, 'Reveal should still render mathematics');
  });

  await t.step('Downloaded HTML opens, takes the keyboard, and runs its Vue interaction with networking disabled', async () => {
    const offlineContext = await t.newContext({ viewport: { width: 1280, height: 900 }, offline: true });
    const offlinePage = t.observe(await offlineContext.newPage());
    await offlinePage.goto(pathToFileURL(offlineFile).href, { waitUntil: 'load' });
    assert.equal(offlinePage.frames().length, 1, 'The downloaded presentation is inert until Start');
    const notices = offlinePage.locator('#notices');
    assert.equal(await notices.evaluate((element) => element.open), false, 'The notices start collapsed');
    assert.ok(await offlinePage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'No sideways scrolling');
    await notices.locator('summary').click();
    assert.match(await notices.textContent(), /Copyright \(c\) 2026 Jie Ren/, 'The application notice is in the copy');
    await notices.locator('summary').click();
    await offlinePage.getByRole('button', { name: 'Start presentation', exact: true }).click();
    const offlineFrame = await presentationFrame(offlinePage);
    await goToDemo(offlinePage, offlineFrame);
    await setDestructiveInterference(offlineFrame);
    await capturePresentation(t, offlinePage, offlineFrame, 'presentation-offline.png');
    await offlineContext.close();
  });

  await t.step('Text from a failing presentation is attributed to it and stays visible in fullscreen', async () => {
    const forged = 'Your session expired. Sign in again at https://example.invalid/restore';
    // The deck's own uncaught error is the point of this check.
    t.allowConsoleError(/Your session expired/);
    t.allowPageError(/Your session expired/);
    const { page: failing } = await t.newPage();
    await t.openWorkspace(failing);
    await failing.locator('[data-file-input]').setInputFiles({ name: 'failing.zip', mimeType: 'application/zip', buffer: failingPackage(forged) });
    await failing.locator('[data-pres-start-button]').waitFor({ state: 'visible', timeout: 30_000 });
    await failing.locator('[data-pres-present]').click();
    await failing.locator('[data-pres-exit-fullscreen]').waitFor({ state: 'visible' });
    const problem = failing.locator('[data-pres-problem]');
    await problem.waitFor({ state: 'visible', timeout: 20_000 });
    assert.match(await problem.textContent(), /The presentation reported/);
    assert.ok((await problem.textContent()).includes('Your session expired'), 'The reported text is shown, as text');
    assert.ok(await failing.evaluate(() => {
      const stage = document.querySelector('[data-pres-stage]');
      const problemArea = document.querySelector('[data-pres-problem]');
      const fullscreen = document.fullscreenElement === stage || stage.classList.contains('presentation-fallback-fullscreen');
      return fullscreen && stage.contains(problemArea);
    }), 'The failure is shown inside the fullscreen stage');
    const notice = await failing.locator('[data-pres-notice]').textContent();
    assert.ok(!notice.includes('Your session expired'), 'Presentation text never appears in the application notice');
    await failing.locator('[data-pres-exit-fullscreen]').click();
  });
}
