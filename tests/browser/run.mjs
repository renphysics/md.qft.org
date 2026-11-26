/**
 * Run every browser suite (tests/browser/*.browser.mjs) against the production
 * build. Run `npm run build` first. Pass suite names to run a subset, e.g.
 * `npm run test:browser -- slides`.
 */
import assert from 'node:assert/strict';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchBrowser, startPreview, SuiteContext } from './harness.mjs';

const folder = fileURLToPath(new URL('.', import.meta.url));
const artifacts = resolve('artifacts');
await mkdir(artifacts, { recursive: true });
const filters = process.argv.slice(2);
const suites = (await readdir(folder)).filter(name => name.endsWith('.browser.mjs')).sort()
  .filter(name => !filters.length || filters.some(filter => name.includes(filter)));
if (!suites.length) {
  console.error(`No browser suite matches ${filters.join(', ')}.`);
  process.exit(1);
}

let preview;
let browser;
const summary = [];
try {
  preview = await startPreview();
  browser = await launchBrowser();
  for (const file of suites) {
    const name = file.replace(/\.browser\.mjs$/, '');
    const suite = await import(pathToFileURL(resolve(folder, file)).href);
    const t = new SuiteContext({ browser, baseUrl: preview.baseUrl, artifacts, name });
    const started = Date.now();
    try {
      await suite.default(t);
      assert.deepEqual(t.pageErrors, [], 'Browser JavaScript errors');
      assert.deepEqual(t.consoleErrors, [], 'Browser console errors, including CSP violations');
      assert.deepEqual(t.externalRequests, [], 'External network requests');
      assert.deepEqual(t.failedRequests, [], 'Failed resource requests');
      const result = { suite: name, title: suite.title, passed: true, milliseconds: Date.now() - started, ...t.records() };
      summary.push(result);
      await writeFile(resolve(artifacts, `${name}-browser-results.json`), JSON.stringify(result, null, 2));
    } catch (error) {
      for (const [index, page] of t.observedPages.entries()) {
        if (!page.isClosed()) await page.screenshot({ path: resolve(artifacts, `${name}-failure-${index + 1}.png`) }).catch(() => {});
      }
      const result = {
        suite: name, title: suite.title, passed: false, milliseconds: Date.now() - started,
        failed: error?.stack || String(error), ...t.records(), frames: await t.frameSnapshots(), serverOutput: preview.output(),
      };
      summary.push(result);
      await writeFile(resolve(artifacts, `${name}-browser-results.json`), JSON.stringify(result, null, 2));
      console.error(`FAIL ${name}: ${error?.stack || error}`);
    } finally {
      await t.close();
    }
  }
} catch (error) {
  console.error(error?.stack || error);
  if (preview) console.error(preview.output());
  process.exitCode = 1;
} finally {
  await browser?.close();
  preview?.stop();
}

await writeFile(resolve(artifacts, 'browser-results.json'), JSON.stringify(summary.map(({ frames, serverOutput, ...rest }) => rest), null, 2));
const failed = summary.filter(result => !result.passed);
console.log(`${summary.length - failed.length} of ${suites.length} browser suite${suites.length === 1 ? '' : 's'} passed${failed.length ? `; failed: ${failed.map(result => result.suite).join(', ')}` : ''}.`);
if (failed.length || summary.length !== suites.length) process.exitCode = 1;
