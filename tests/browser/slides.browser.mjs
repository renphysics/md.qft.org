/** End-to-end checks for the workspace's own Markdown slides (reveal.js preview, Present, Save PDF). */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { until } from './harness.mjs';

export const title = 'Markdown slides preview and PDF';

async function slidesReady(page, total = 5) {
  await until(async () => new RegExp(`1\\s*/\\s*${total}`).test(await page.locator('[data-slide-position]').textContent()), 'the first slide of the preview');
  assert.equal(await page.locator('[data-slide-host] .reveal').count(), 1, 'The slide preview must be loaded');
}

/** What reveal.js would have done had it read the page query. */
async function revealConfiguration(page) {
  return page.evaluate(() => {
    const reveal = document.querySelector('.reveal');
    const visible = (selector) => {
      const element = reveal?.querySelector(selector);
      return !!element && getComputedStyle(element).display !== 'none';
    };
    return {
      printView: document.documentElement.classList.contains('print-pdf') || document.documentElement.classList.contains('reveal-print'),
      scrollView: !!reveal?.closest('.reveal-scroll') || !!document.querySelector('.reveal-viewport.reveal-scroll, .loading-scroll-mode'),
      controls: visible('.controls'),
      progress: visible('.progress'),
      slideNumber: visible('.slide-number'),
      bodyViewport: document.body.classList.contains('reveal-viewport'),
    };
  });
}

const untouched = { printView: false, scrollView: false, controls: false, progress: false, slideNumber: false, bodyViewport: false };

export default async function run(t) {
  await t.step('The page query cannot reconfigure the embedded preview or Present', async () => {
    for (const query of ['view=scroll', 'print-pdf', 'controls=true&progress=true&slideNumber=true&embedded=false']) {
      const { context, page } = await t.newPage();
      await t.openWorkspace(page, `?example=quantum-slides&${query}`);
      await slidesReady(page);
      assert.equal(await page.locator('[data-slide-host]').getByText('Slides could not be loaded').count(), 0, `${query} must not break the preview`);
      assert.deepEqual(await revealConfiguration(page), untouched, `${query} must not reach reveal.js`);
      assert.match(page.url(), new RegExp(query.split('&')[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'Unrelated page parameters are left in place');
      assert.doesNotMatch(page.url(), /example=/, 'The application still consumes its own example parameter');
      await page.locator('[data-slide-next]').click();
      await until(async () => /2\s*\/\s*5/.test(await page.locator('[data-slide-position]').textContent()), `navigation with ${query}`);
      await page.locator('[data-slide-present]').click();
      await page.locator('.qft-slide-presentation').waitFor({ state: 'visible' });
      assert.deepEqual(await revealConfiguration(page), untouched, `${query} must not reach the Present view`);
      await page.keyboard.press('ArrowRight');
      await until(async () => /3\s*\/\s*5/.test(await page.locator('[data-presentation-counter]').textContent()), `keyboard navigation in Present with ${query}`);
      await page.keyboard.press('Escape');
      await page.locator('.qft-slide-presentation').waitFor({ state: 'detached' });
      await context.close();
    }
  });

  await t.step('The application parameter for the Slidev example still opens it', async () => {
    const { context, page } = await t.newPage();
    await t.openWorkspace(page, '?presentation=slidev-example');
    await page.locator('[data-pres-start-button]').waitFor({ state: 'visible', timeout: 30_000 });
    assert.match(await page.locator('[data-pres-title]').textContent(), /Quantum interference/);
    assert.doesNotMatch(page.url(), /presentation=/);
    await context.close();
  });

  await t.step('Save PDF reaches the print step for the site’s own slide example', async () => {
    const { context, page } = await t.newPage();
    // The real dialog would block the test; count the calls instead.
    await context.addInitScript(() => {
      window.__qftPrintCalls = 0;
      window.print = () => { window.__qftPrintCalls += 1; };
    });
    await t.openWorkspace(page, '?example=quantum-slides');
    await slidesReady(page);
    await page.evaluate(() => document.fonts.ready);
    await page.locator('[data-pdf]').click();
    await page.locator('[data-slide-pdf-dialog]').waitFor({ state: 'visible' });
    await page.locator('[data-slide-print]').click();
    await until(() => page.evaluate(() => window.__qftPrintCalls === 1), 'the browser print step', 20_000);
    const toast = await page.locator('[data-toast]').textContent();
    assert.doesNotMatch(toast ?? '', /too much content/, 'The example fits its slides');
    assert.equal(await page.locator('.qft-print-slides .qft-slide').count(), 5, 'One print page per slide');
    await context.close();
  });

  await t.step('Save PDF in the exported slide HTML reaches the print step for the same example', async () => {
    const { context, page } = await t.newPage({ acceptDownloads: true });
    // The export fetches the math fonts to embed them.
    const fonts = new Set();
    page.on('request', (request) => {
      if (request.resourceType() === 'fetch' && /\/KaTeX_[^/]+\.woff2$/.test(new URL(request.url()).pathname)) fonts.add(request.url());
    });
    await t.openWorkspace(page, '?example=quantum-slides');
    await slidesReady(page);
    await page.locator('[data-export-toggle]').click();
    const downloading = page.waitForEvent('download');
    await page.locator('[data-export-html]').click();
    const file = resolve(t.artifacts, 'quantum-slides-export.html');
    await (await downloading).saveAs(file);
    await context.close();
    // Every font the export asked for is in the file, byte for byte: the page received each of them in full.
    const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
    const embedded = new Set([...(await readFile(file, 'utf8')).matchAll(/url\("data:font\/woff2;base64,([A-Za-z0-9+/=]+)"\)/g)]
      .map((match) => digest(Buffer.from(match[1], 'base64'))));
    assert.ok(fonts.size > 0, 'the export fetched the math fonts');
    const delivered = new Set();
    for (const url of fonts) {
      const answer = await fetch(url);
      assert.equal(answer.status, 200, url);
      assert.ok(embedded.has(digest(Buffer.from(await answer.arrayBuffer()))), `${new URL(url).pathname} is embedded in full`);
      delivered.add(url);
    }
    // On GitHub's runner the browser reports some of these fetches as aborted all the same (see SuiteContext in harness.mjs).
    t.setAsideDelivered((url) => delivered.has(url));
    const offline = await t.newContext({ offline: true });
    await offline.addInitScript(() => {
      window.__qftPrintCalls = 0;
      window.print = () => { window.__qftPrintCalls += 1; };
    });
    const exported = t.observe(await offline.newPage());
    await exported.goto(pathToFileURL(file).href, { waitUntil: 'load' });
    await exported.evaluate(() => document.fonts.ready);
    await exported.locator('#save-pdf').click();
    await until(() => exported.evaluate(() => window.__qftPrintCalls === 1), 'the exported file’s print step', 20_000);
    assert.equal(await exported.locator('#export-status').isHidden(), true, 'No overflow message in the exported file');
    await offline.close();
  });

  await t.step('Save PDF still refuses a slide whose content is really clipped', async () => {
    const { context, page } = await t.newPage();
    await context.addInitScript(() => {
      window.__qftPrintCalls = 0;
      window.print = () => { window.__qftPrintCalls += 1; };
    });
    await t.openWorkspace(page);
    const long = Array.from({ length: 40 }, (_, index) => `- Point ${index + 1} with enough words to need its own line`).join('\n');
    await page.locator('[data-file-input]').setInputFiles({
      name: 'crowded.md', mimeType: 'text/markdown',
      buffer: Buffer.from(`# Fits\n\n$$\\int_0^1 x^2\\,dx = \\frac{1}{3}$$\n\n---\n\n# Too long\n\n${long}\n`),
    });
    await until(async () => (await page.locator('[data-editor]').textContent()).includes('Too long'), 'the Markdown import');
    await page.locator('[data-content-mode="slides"]').click();
    await slidesReady(page, 2);
    await page.locator('[data-pdf]').click();
    await page.locator('[data-slide-pdf-dialog]').waitFor({ state: 'visible' });
    await page.locator('[data-slide-print]').click();
    await until(async () => /Slide 2 contains too much content/.test(await page.locator('[data-toast]').textContent()), 'the overflow message for slide 2');
    assert.equal(await page.evaluate(() => window.__qftPrintCalls), 0);
    await context.close();
  });
}
