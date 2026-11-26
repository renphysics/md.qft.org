/**
 * An ordinary `slidev build` output, opened as a person does: the dist folder
 * zipped, chosen in the library. The site converts it in the browser (a
 * same-origin Worker running esbuild-wasm), checks it, saves it and plays it
 * offline in the isolated player, where the keyboard, click steps and its Vue
 * component work. A build that needs Monaco is refused with a reason. The
 * converter and esbuild.wasm load only when a Slidev build is opened, and no
 * request leaves the site.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strToU8, zipSync } from 'fflate';
import { until } from './harness.mjs';
import { deckFrame } from './player-host.mjs';

export const title = 'Slidev builds converted in the browser';

const FIXTURE = fileURLToPath(new URL('../fixtures/slidev-default-build.zip', import.meta.url));
/** The official create-slidev template built unchanged (Monaco, Web Workers); used only when present. */
const MONACO_BUILD = '/tmp/claude-0/-home-user-md-qft-org/62b03238-2ec2-5a4f-bd5c-e84ccde76ebd/scratchpad/research/proto/B2/starter-deck/dist';
const CONVERTER = /\/slidev-convert[^/]*\.js(?:[?#]|$)|\.wasm(?:[?#]|$)/;

const status = (page) => page.locator('[data-pres-player-status]').textContent();
const storage = (page) => page.locator('[data-pres-storage]').textContent();

/** Every text the library's notice shows, in order, kept by an observer in the page. */
async function watchNotices(page) {
  await page.evaluate(() => {
    const notice = document.querySelector('[data-pres-notice]');
    const seen = [];
    /** @type {any} */ (window).qftNotices = seen;
    new MutationObserver(() => { const text = notice.textContent; if (text && seen.at(-1) !== text) seen.push(text); })
      .observe(notice, { childList: true, characterData: true, subtree: true });
  });
}

const notices = (page) => page.evaluate(() => /** @type {any} */ (window).qftNotices.slice());

function zipFolder(folder, prefix) {
  const entries = {};
  const walk = (directory) => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) walk(path);
      else entries[prefix + relative(folder, path).split('\\').join('/')] = [readFileSync(path), { level: 0 }];
    }
  };
  walk(folder);
  return Buffer.from(zipSync(entries));
}

/** Start the deck from the library and return its frame, with the keyboard already in it. */
async function startSlidev(page) {
  await page.locator('[data-pres-start-button]').waitFor({ state: 'visible', timeout: 60_000 });
  assert.equal(await page.locator('[data-pres-host] iframe').count(), 0, 'opening a deck must not run it');
  await page.locator('[data-pres-start-button]').click();
  await until(async () => (await status(page)) === 'Playing locally', 'the deck to play locally', 30_000);
  const frame = await deckFrame(page, '#app .slidev-layout');
  await until(() => frame.evaluate(() => document.hasFocus()), 'keyboard focus to reach the deck without a click', 10_000);
  return frame;
}

export default async function run(t) {
  const { context, page } = await t.newPage({ acceptDownloads: true });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const requests = [];
  const workers = [];
  const ended = new Set();
  context.on('request', (request) => requests.push(request.url()));
  page.on('worker', (worker) => { workers.push(worker); worker.on('close', () => ended.add(worker)); });
  await t.openWorkspace(page);
  const dialog = page.locator('[data-pres-dialog]');

  await t.step('Create with AI asks for an ordinary Slidev project and its built dist folder, from an assistant that can run commands', async () => {
    await page.locator('[data-create-ai]').click();
    const format = page.locator('[data-ai-format]');
    assert.equal(await format.locator('option[value="slidev"]').textContent(), 'Slidev — Vue slides built by a coding assistant');
    await format.selectOption('slidev');
    const help = `${await page.locator('[data-ai-format-help]').textContent()} ${await page.locator('[data-ai-workflow-help]').textContent()}`;
    assert.match(help, /can run commands, or a computer with Node\.js/);
    assert.match(help, /built dist folder in one ZIP, and open that ZIP here/);
    assert.match(await page.locator('[data-ai-status]').textContent(), /starter ZIP is an optional example/);
    assert.equal(await page.locator('[data-ai-starter]').isVisible(), true, 'the starter stays as an optional example');
    assert.doesNotMatch(await page.locator('[data-ai-dialog]').textContent(), /Codex|builds the Slidev package/);
    await page.locator('[data-ai-topic]').fill('Wave packets');
    await page.locator('[data-ai-form] button[type="submit"]').click();
    await until(async () => /^Copied\./.test(await page.locator('[data-ai-status]').textContent()), 'the instructions to be copied');
    const prompt = await page.evaluate(() => navigator.clipboard.readText());
    assert.match(prompt, /Wave packets/);
    assert.match(prompt, /ordinary Slidev project/);
    assert.match(prompt, /npx slidev build/);
    assert.doesNotMatch(prompt, /ordinary dist ZIP/);
    await format.selectOption('qft');
    await page.locator('[data-ai-close]').click();
  });

  await t.step('The workspace and the library load neither the converter nor esbuild.wasm', async () => {
    await page.locator('[data-open-presentations]').click();
    await page.locator('[data-pres-library]').waitFor({ state: 'visible' });
    await page.locator('[data-pres-list]:not([aria-busy])').waitFor();
    // A Reveal.js deck goes through the same import code without needing the converter.
    const reveal = Buffer.from(zipSync({ 'index.html': strToU8('<!doctype html><html><head><title>Plain</title></head><body><main><h1>Plain page</h1></main></body></html>') }));
    await page.locator('[data-pres-input]').setInputFiles({ name: 'plain.zip', mimeType: 'application/zip', buffer: reveal });
    await page.locator('[data-pres-start-button]').waitFor({ state: 'visible' });
    assert.deepEqual(requests.filter((url) => CONVERTER.test(url)), []);
    assert.equal(workers.length, 0);
    await page.locator('[data-pres-back]').click();
    await page.locator('[data-pres-library]').waitFor({ state: 'visible' });
  });

  await t.step('An ordinary Slidev build ZIP is converted in the browser, with progress, checked and saved', async () => {
    await watchNotices(page);
    const started = Date.now();
    await page.locator('[data-pres-input]').setInputFiles({ name: 'quantum-interference-dist.zip', mimeType: 'application/zip', buffer: readFileSync(FIXTURE) });
    await until(async () => /Saved in this browser/.test(await storage(page)), 'the converted deck to be saved', 60_000);
    console.log(`  converted and checked in ${Date.now() - started} ms`);
    assert.equal(await page.locator('[data-pres-engine]').textContent(), 'Slidev');
    assert.equal(await page.locator('[data-pres-title]').textContent(), 'Quantum interference - Slidev');
    const shown = await notices(page);
    for (const text of ['Preparing the Slidev presentation to play offline…', 'Preparing the converter…', 'Bundling the presentation…', 'Checking the presentation…']) {
      assert.ok(shown.includes(text), `progress “${text}” in ${JSON.stringify(shown)}`);
    }
    assert.equal(await page.locator('[data-pres-notice]').isVisible(), false, 'progress is cleared when the deck is ready');
    // The Worker and the WebAssembly file are separate assets of this site, requested now.
    const base = new URL(t.baseUrl).origin;
    const loaded = requests.filter((url) => CONVERTER.test(url));
    assert.ok(loaded.some((url) => /slidev-convert\.worker[^/]*\.js$/.test(url)), `the Worker script in ${JSON.stringify(loaded)}`);
    assert.ok(loaded.some((url) => /esbuild[^/]*\.wasm$/.test(url)), `esbuild.wasm in ${JSON.stringify(loaded)}`);
    assert.ok(loaded.every((url) => url.startsWith(base)), 'from this site only');
    assert.equal(workers.length, 1);
    await until(() => ended.has(workers[0]), 'the Worker to be ended after the conversion', 10_000);
    const notes = page.locator('[data-pres-notes]');
    await notes.locator('summary').click();
    assert.match(await page.locator('[data-pres-notes-list]').textContent(), /fonts\.googleapis\.com[\s\S]*cdn\.jsdelivr\.net/);
  });

  await t.step('It plays locally: the keyboard works without a click, a click step advances, and the Vue component responds', async () => {
    const frame = await startSlidev(page);
    await frame.getByRole('heading', { name: 'Quantum interference' }).waitFor({ timeout: 20_000 });
    await page.keyboard.press('ArrowRight');
    await frame.getByRole('heading', { name: 'Amplitudes add' }).waitFor({ timeout: 20_000 });
    await frame.locator('.katex').first().waitFor();
    const step = (text) => frame.locator('li', { hasText: text });
    await until(async () => /slidev-vclick-hidden/.test(await step('In phase: reinforce').getAttribute('class') ?? ''), 'the first click step to be hidden');
    await page.keyboard.press('ArrowRight');
    await until(async () => !/slidev-vclick-hidden/.test(await step('In phase: reinforce').getAttribute('class') ?? ''), 'the click step to appear');
    assert.match(await step('Out of phase: cancel').getAttribute('class') ?? '', /slidev-vclick-hidden/, 'one step at a time');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await frame.getByRole('heading', { name: 'Try it' }).waitFor({ timeout: 20_000 });
    await until(async () => (await frame.locator('.intensity-value > strong').textContent()) === '1.00', 'the component at phase 0');
    await frame.getByRole('button', { name: 'Opposite · 180°', exact: true }).click();
    await until(async () => (await frame.locator('.intensity-value > strong').textContent()) === '0.00', 'the component to respond');
    assert.equal(await status(page), 'Playing locally');
    assert.deepEqual(t.externalRequests, []);
    await page.screenshot({ path: resolve(t.artifacts, 'slidev-build-playing.png') });
  });

  await t.step('The standalone HTML export carries the converted deck and its player profile', async () => {
    const downloading = page.waitForEvent('download');
    await page.locator('[data-pres-html]').click();
    const download = await downloading;
    assert.equal(download.suggestedFilename(), 'Quantum-interference---Slidev.html');
    const file = resolve(t.artifacts, 'slidev-build-standalone.html');
    await download.saveAs(file);
    const text = readFileSync(file, 'utf8');
    assert.match(text, /Start presentation/);
    assert.match(text, /"profile":"tolerant"|profile:"tolerant"/);
    assert.ok(text.includes('Quantum interference') && text.includes('mermaid-rendering-container'), 'the converted document is inside');
    const zipping = page.waitForEvent('download');
    await page.locator('[data-pres-zip]').click();
    assert.equal((await zipping).suggestedFilename(), 'quantum-interference-dist.zip', 'the ZIP download is the original upload');
  });

  await t.step('The build is read-only, with how to change it', async () => {
    await page.locator('[data-pres-view="source"]').click();
    await page.locator('[data-pres-source]').waitFor({ state: 'visible' });
    // The view and its viewer load the first time they are shown.
    await page.locator('.presentation-file[data-pres-file-path="index.html"]').waitFor();
    await until(async () => /built Slidev presentation, so it is read-only here.*npx slidev build/.test(await page.locator('[data-pres-source-note]').textContent()), 'the note on how to change the build');
    assert.equal(await page.locator('[data-pres-source] [contenteditable="true"]').count(), 0, 'no editable field');
    assert.equal(await page.locator('[data-pres-apply]').isVisible(), false);
    await page.locator('[data-pres-view="preview"]').click();
  });

  await t.step('Reopened from the library, the saved build is converted again and plays', async () => {
    await page.locator('[data-pres-back]').click();
    await page.locator('[data-pres-list]:not([aria-busy])').waitFor();
    const row = page.locator('.presentation-saved-open', { hasText: 'Quantum interference' });
    assert.match(await row.textContent(), /Slidev · /);
    await row.click();
    const frame = await startSlidev(page);
    await frame.getByRole('heading', { name: 'Quantum interference' }).waitFor({ timeout: 20_000 });
    await page.keyboard.press('ArrowRight');
    await frame.getByRole('heading', { name: 'Amplitudes add' }).waitFor({ timeout: 20_000 });
  });

  await t.step('Closing while a build converts stops the converter and opens nothing', async () => {
    await page.locator('[data-pres-close]').click();
    await dialog.waitFor({ state: 'hidden' });
    await page.locator('[data-open-presentations]').click();
    await page.locator('[data-pres-list]:not([aria-busy])').waitFor();
    const before = workers.length;
    await page.locator('[data-pres-input]').setInputFiles({ name: 'again.zip', mimeType: 'application/zip', buffer: readFileSync(FIXTURE) });
    await until(() => workers.length > before, 'the converter to start');
    const converter = workers.at(-1);
    assert.equal(ended.has(converter), false, 'still converting');
    await page.locator('[data-pres-close]').click();
    await dialog.waitFor({ state: 'hidden' });
    await until(() => ended.has(converter), 'the converter to be stopped', 5_000);
    await page.waitForTimeout(1500);
    assert.equal(await dialog.isVisible(), false, 'a cancelled conversion does not reopen the dialog');
    assert.equal(await page.locator('[data-pres-host] iframe').count(), 0);
  });

  await t.step('A build that uses Monaco is refused, naming Monaco, and not saved', async () => {
    await page.locator('[data-open-presentations]').click();
    await page.locator('[data-pres-list]:not([aria-busy])').waitFor();
    const monaco = Buffer.from(zipSync({
      'dist/index.html': strToU8('<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Code - Slidev</title><meta property="slidev:version" content="53.1.0"><script type="module" crossorigin src="/assets/index-a1.js"></script></head><body><div id="app"></div></body></html>'),
      'dist/assets/index-a1.js': strToU8('import("./monaco/editor-a1.js")'),
      'dist/assets/monaco/editor-a1.js': strToU8('export default 1'),
    }));
    await page.locator('[data-pres-input]').setInputFiles({ name: 'code-dist.zip', mimeType: 'application/zip', buffer: monaco });
    await until(async () => /Not saved/.test(await storage(page)), 'the not-saved note', 60_000);
    assert.match(await page.locator('[data-pres-problem]').textContent(), /Monaco code editor/);
    assert.equal(await page.locator('[data-pres-start-button]').isVisible(), false);
    assert.equal(await page.locator('[data-pres-host] iframe').count(), 0);
    await page.locator('[data-pres-back]').click();
    await page.locator('[data-pres-list]:not([aria-busy])').waitFor();
  });

  if (!existsSync(join(MONACO_BUILD, 'index.html'))) console.log(`SKIP ${t.name}: the official template build (research build absent)`);
  else {
    await t.step('The official Slidev template build (Monaco, 37 MB) is refused with the reason', async () => {
      await page.locator('[data-pres-input]').setInputFiles({ name: 'welcome-to-slidev-dist.zip', mimeType: 'application/zip', buffer: zipFolder(MONACO_BUILD, 'dist/') });
      await until(async () => /Not saved/.test(await storage(page)), 'the not-saved note', 90_000);
      const problem = await page.locator('[data-pres-problem]').textContent();
      assert.match(problem, /Monaco code editor/);
      assert.equal(await page.locator('[data-pres-host] iframe').count(), 0);
      await page.locator('[data-pres-close]').click();
      await dialog.waitFor({ state: 'hidden' });
    });
  }

  await t.step('When the converter cannot be downloaded, the problem says what to do, in plain words', async () => {
    // A filtered network or a new version of the site: esbuild.wasm is not there.
    const offline = await t.newPage();
    t.allowConsoleError(/status of 404/);
    await offline.context.route(/\.wasm(?:[?#]|$)/, (route) => route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not found' }));
    await t.openWorkspace(offline.page);
    await offline.page.locator('[data-open-presentations]').click();
    await offline.page.locator('[data-pres-list]:not([aria-busy])').waitFor();
    await offline.page.locator('[data-pres-input]').setInputFiles({ name: 'offline-dist.zip', mimeType: 'application/zip', buffer: readFileSync(FIXTURE) });
    await until(async () => /Not saved/.test(await offline.page.locator('[data-pres-storage]').textContent()), 'the not-saved note', 60_000);
    const problem = await offline.page.locator('[data-pres-problem]').textContent();
    assert.match(problem, /The Slidev converter could not be downloaded\. Check the internet connection, reload the page, and open the ZIP again\./);
    assert.doesNotMatch(problem, /Failed to|https?:|\.wasm/, 'no raw reason or address in the message');
    assert.equal(await offline.page.locator('[data-pres-start-button]').isVisible(), false);
    await offline.context.close();
  });

  await t.step('Nothing left the site', async () => {
    assert.deepEqual(t.externalRequests, []);
  });
}
