/** End-to-end checks for real Slidev playback. Run after npm run build. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const artifacts = resolve('artifacts');
await mkdir(artifacts, { recursive: true });
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:4322/';
let server;
let serverOutput = '';
let browser;
let page;
const checks = [];
const pageErrors = [];
const consoleErrors = [];
const failedRequests = [];
const externalRequests = [];
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function until(check, label, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try { const value = await check(); if (value) return value; }
    catch (error) { last = error; }
    await sleep(100);
  }
  throw new Error(`Timed out: ${label}${last ? ` (${last.message})` : ''}`);
}

async function step(name, action) {
  await action();
  checks.push(name);
  console.log(`PASS ${name}`);
}

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

async function goToDemo(frame) {
  await heading(frame, /Phase makes\s*the difference/);
  await frame.getByRole('heading', { name: /Phase makes\s*the difference/ }).click();
  // Focus an actual slide, not the outer player controls. Using press rather
  // than a synthetic KeyboardEvent exercises Slidev's real keyboard handlers.
  await frame.locator('body').press('ArrowRight');
  await heading(frame, 'Amplitudes add.');
  await frame.locator('body').press('ArrowRight');
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

function observe(targetPage) {
  targetPage.on('pageerror', error => pageErrors.push({ page: targetPage.url(), message: error.message }));
  targetPage.on('console', message => {
    if (message.type() === 'error') consoleErrors.push({ page: targetPage.url(), message: message.text() });
  });
  targetPage.on('requestfailed', request => failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
}

try {
  if (!process.env.BASE_URL) {
    server = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'preview', '--', '--port', '4322'], {
      stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32',
    });
    const capture = chunk => { serverOutput = (serverOutput + String(chunk)).slice(-12_000); };
    server.stdout.on('data', capture);
    server.stderr.on('data', capture);
    server.on('error', error => { serverOutput += `\n${error.message}`; });
  }
  await until(async () => {
    const response = await fetch(baseUrl, { signal: AbortSignal.timeout(1000) });
    return response.ok;
  }, 'the production preview server');

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const allowedOrigin = new URL(baseUrl).origin;
  // Fail closed if the application or any Slidev code tries to use a CDN.
  await context.route('**/*', route => {
    const url = route.request().url();
    if (/^https?:/.test(url) && new URL(url).origin !== allowedOrigin) {
      externalRequests.push(url);
      return route.abort();
    }
    return route.continue();
  });
  page = await context.newPage();
  observe(page);
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.locator('.cm-editor').waitFor();
  const dialog = page.locator('[data-pres-dialog]');

  await step('Open the Slidev library and load a genuine, initially inert package', async () => {
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
  await step('Start all-local Slidev, navigate, and operate the actual Vue component', async () => {
    await page.locator('[data-pres-start-button]').click();
    frame = await presentationFrame(page);
    await until(async () => (await page.locator('[data-pres-player-status]').textContent()) === 'Playing locally', 'playback readiness');
    await goToDemo(frame);
    const slider = await setDestructiveInterference(frame);
    await frame.getByRole('button', { name: 'Animate phase', exact: true }).click();
    await until(async () => Number(await slider.inputValue()) > 181, 'the phase animation to advance');
    await frame.getByRole('button', { name: 'Pause animation', exact: true }).click();
    await setDestructiveInterference(frame);
    await page.screenshot({ path: resolve(artifacts, 'presentation-desktop.png'), fullPage: true });
    assert.equal(externalRequests.length, 0, 'Playback must not request external resources');
  });

  await step('Source remains accessible and fullscreen preserves the live slide state', async () => {
    await page.locator('[data-pres-view="source"]').click();
    const source = page.locator('[data-pres-source-text]');
    assert.match(await source.inputValue(), /Quantum interference/);
    assert.equal(await source.getAttribute('readonly'), '');
    await page.locator('[data-pres-file]').selectOption('source/components/QuantumInterference.vue');
    assert.match(await source.inputValue(), /onSlideLeave\(pause\)/);
    await page.locator('[data-pres-copy]').click();
    await until(async () => /Source copied|Source selected/.test(await page.locator('[data-pres-notice]').textContent()), 'copy action feedback');
    await page.locator('[data-pres-present]').click();
    await page.locator('[data-pres-exit-fullscreen]').waitFor({ state: 'visible' });
    const fullscreenFrame = await presentationFrame(page);
    assert.equal(fullscreenFrame, frame, 'Present must reuse the running application');
    await heading(frame, 'Change the relative phase.');
    assert.equal(await frame.getByRole('slider', { name: 'Relative phase in degrees' }).inputValue(), '180');
    await page.locator('[data-pres-exit-fullscreen]').click();
  });

  let offlineFile;
  await step('Download a standalone player and verify stop, restart, and close lifecycle', async () => {
    const downloading = page.waitForEvent('download');
    await page.locator('[data-pres-html]').click();
    const download = await downloading;
    offlineFile = resolve(artifacts, 'slidev-offline-player.html');
    await download.saveAs(offlineFile);
    await page.locator('[data-pres-stop]').click();
    await page.locator('[data-pres-start-button]').waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-pres-host] iframe').count(), 0);
    await page.locator('[data-pres-start-button]').click();
    frame = await presentationFrame(page);
    await heading(frame, /Phase makes\s*the difference/);
    await page.locator('[data-pres-close]').click();
    await dialog.waitFor({ state: 'hidden' });
    await until(async () => (await page.locator('[data-pres-host] iframe').count()) === 0, 'close event to remove every playback frame');
  });

  await step('Reload the page, reopen the saved ZIP, and render the mobile layout', async () => {
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('.cm-editor').waitFor();
    await page.locator('[data-open-presentations]').click();
    await page.locator('.presentation-saved-open').first().waitFor();
    assert.match(await page.locator('.presentation-saved-open').first().textContent(), /Quantum interference/);
    await page.locator('.presentation-saved-open').first().click();
    await page.locator('[data-pres-start-button]').click();
    frame = await presentationFrame(page);
    await goToDemo(frame);
    await page.setViewportSize({ width: 390, height: 844 });
    await until(async () => {
      const bounds = await dialog.boundingBox();
      return bounds && bounds.x >= 0 && bounds.x + bounds.width <= 391;
    }, 'the responsive dialog layout');
    await frame.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: resolve(artifacts, 'presentation-mobile.png'), fullPage: true });
    const bounds = await dialog.boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 391, 'The mobile dialog must fit the viewport');
    await page.locator('[data-pres-close]').click();
    await dialog.waitFor({ state: 'hidden' });
    await until(async () => (await page.locator('[data-pres-host] iframe').count()) === 0, 'mobile playback to stop');
    await page.setViewportSize({ width: 1440, height: 1000 });
  });

  await step('Existing Markdown and Reveal.js remain editable and playable', async () => {
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

  await step('Downloaded HTML opens and runs its Vue interaction with networking disabled', async () => {
    const offlineContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, offline: true });
    const offlinePage = await offlineContext.newPage();
    observe(offlinePage);
    await offlinePage.goto(pathToFileURL(offlineFile).href, { waitUntil: 'load' });
    assert.equal(offlinePage.frames().length, 1, 'The downloaded presentation is inert until Start');
    await offlinePage.getByRole('button', { name: 'Start presentation', exact: true }).click();
    const offlineFrame = await presentationFrame(offlinePage);
    await goToDemo(offlineFrame);
    await setDestructiveInterference(offlineFrame);
    await offlinePage.screenshot({ path: resolve(artifacts, 'presentation-offline.png'), fullPage: true });
    await offlineContext.close();
  });

  assert.deepEqual(pageErrors, [], 'Browser JavaScript errors');
  assert.deepEqual(consoleErrors, [], 'Browser console errors, including CSP violations');
  assert.deepEqual(externalRequests, [], 'External network requests');
  assert.deepEqual(failedRequests, [], 'Failed resource requests');
  const result = { passed: checks.length, checks, pageErrors, consoleErrors, failedRequests, externalRequests };
  await writeFile(resolve(artifacts, 'presentation-browser-results.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  if (page) await page.screenshot({ path: resolve(artifacts, 'presentation-failure.png'), fullPage: true }).catch(() => {});
  const frames = page ? await Promise.all(page.frames().map(async frame => {
    try {
      return await frame.evaluate(() => ({
        url: location.href,
        app: document.getElementById('app')?.outerHTML.slice(0, 40_000),
        visibleText: document.body?.innerText.slice(0, 4_000),
        scripts: [...document.scripts].map(script => ({ type: script.type, src: script.getAttribute('src'), length: script.textContent?.length })),
      }));
    } catch { return { url: frame.url(), detached: true }; }
  })) : [];
  const result = { failed: error.stack || String(error), passed: checks, pageErrors, consoleErrors, failedRequests, externalRequests, frames, serverOutput };
  await writeFile(resolve(artifacts, 'presentation-browser-results.json'), JSON.stringify(result, null, 2));
  console.error(JSON.stringify(result, null, 2));
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (server?.pid) {
    try { process.kill(process.platform === 'win32' ? server.pid : -server.pid, 'SIGTERM'); }
    catch { server.kill('SIGTERM'); }
  }
}
