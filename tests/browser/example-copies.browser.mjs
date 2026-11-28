/**
 * The site's own Slidev example replaces copies of its earlier versions that
 * the library saved. The real earlier ZIPs are 1.6 MB each, so two small
 * stand-in packages take their place: one is named as an earlier version in
 * the element's data-example-earlier attribute, the other has the example's
 * own title and file name but other bytes, as a teacher's own package might.
 * Only the first is replaced. A second tab that is playing the replaced copy
 * goes on playing it, and its list is right once it is read again.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { strToU8, zipSync } from 'fflate';
import { until } from './harness.mjs';

export const title = 'Earlier copies of the site’s example';

const EXAMPLE_TITLE = 'Quantum interference — Slidev';

/** A minimal portable package that plays without errors. */
function standIn(heading) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${heading}</title></head><body><main><h1>${heading}</h1></main></body></html>`;
  return Buffer.from(zipSync({
    'qft-presentation.json': strToU8(JSON.stringify({ format: 'qft-presentation', version: 1, engine: 'slidev', title: heading === 'Earlier example' ? heading : EXAMPLE_TITLE, entry: 'presentation.html' })),
    'presentation.html': strToU8(html),
  }));
}

/** The saved rows as people read them: title and detail line. */
function rows(page) {
  return page.locator('[data-pres-list] .presentation-saved-row').evaluateAll((items) => items.map((item) => ({
    title: item.querySelector('strong').textContent, detail: item.querySelector('small').textContent,
  })));
}

async function backToLibrary(page) {
  await page.locator('[data-pres-back]').click();
  await page.locator('[data-pres-library]').waitFor({ state: 'visible' });
  await until(async () => (await page.locator('[data-pres-list]').getAttribute('aria-busy')) === null, 'the saved list to be read');
}

async function importPackage(page, name, buffer) {
  await page.locator('[data-pres-input]').setInputFiles({ name, mimeType: 'application/zip', buffer });
  await until(async () => /Saved in this browser/.test(await page.locator('[data-pres-storage]').textContent()), `${name} to be saved`);
  await backToLibrary(page);
}

async function openExample(page) {
  await page.locator('[data-pres-example]').click();
  await page.locator('[data-pres-start-button]').waitFor({ state: 'visible', timeout: 30_000 });
  await until(async () => (await page.locator('[data-pres-title]').textContent()) === EXAMPLE_TITLE, 'the example to open');
}

export default async function run(t) {
  const { context, page } = await t.newPage();
  await t.openWorkspace(page);
  const earlier = standIn('Earlier example');
  const own = standIn('My own interference lesson');
  const notice = page.locator('[data-pres-notice]');
  let second;

  await t.step('Two stand-in packages are imported through the library: an “earlier example” and a package of one’s own with the example’s name', async () => {
    await page.locator('[data-open-presentations]').click();
    await page.locator('[data-pres-library]').waitFor({ state: 'visible' });
    await importPackage(page, 'earlier-example.zip', earlier);
    await importPackage(page, 'quantum-interference-slidev.zip', own);
    assert.equal(await page.locator('[data-pres-count]').textContent(), '2');
    const attribute = await page.locator('qft-presentation-library').getAttribute('data-example-earlier');
    assert.match(attribute, /^[0-9a-f]{64}:\d+( [0-9a-f]{64}:\d+){3,}$/, 'the page names the real earlier versions');
    // The stand-in becomes one more earlier version.
    const digest = createHash('sha256').update(earlier).digest('hex');
    await page.locator('qft-presentation-library').evaluate((element, entry) => { element.dataset.exampleEarlier += ` ${entry}`; }, `${digest}:${earlier.length}`);
  });

  await t.step('A second tab plays the earlier copy', async () => {
    second = t.observe(await context.newPage());
    await t.openWorkspace(second);
    await second.locator('[data-open-presentations]').click();
    await second.getByRole('button', { name: 'Open Earlier example' }).click();
    await second.locator('[data-pres-start-button]').click();
    await until(async () => (await second.locator('[data-pres-player-status]').textContent()) === 'Playing locally', 'the earlier copy to play in the second tab');
  });

  await t.step('Opening the example replaces the earlier copy and says so; the package of one’s own stays', async () => {
    await openExample(page);
    await until(async () => (await notice.textContent()) === 'The example was updated. It replaces the earlier copy in your library.', 'the notice about the replaced copy');
    assert.equal(await notice.isVisible(), true);
    assert.match(await page.locator('[data-pres-storage]').textContent(), /Saved in this browser/);
    await backToLibrary(page);
    const listed = await rows(page);
    assert.equal(await page.locator('[data-pres-count]').textContent(), '2');
    assert.equal(listed.length, 2);
    assert.ok(!listed.some((row) => row.title === 'Earlier example'), 'the earlier copy is gone');
    assert.deepEqual(listed.map((row) => row.title), [EXAMPLE_TITLE, EXAMPLE_TITLE], 'the example and the package of one’s own');
    assert.ok(listed.some((row) => /1\.6 MB/.test(row.detail)), 'the example’s row');
    assert.ok(listed.some((row) => / KB /.test(row.detail)), 'the package of one’s own, with the same name and title, is kept');
  });

  await t.step('Opening the example a second time changes nothing', async () => {
    const before = await rows(page);
    await openExample(page);
    await until(async () => (await notice.textContent()) === 'This presentation is already in your library, so it was not added again.', 'the example to be recognised');
    await backToLibrary(page);
    assert.deepEqual(await rows(page), before);
    assert.equal(await page.locator('[data-pres-count]').textContent(), '2');
  });

  await t.step('The second tab goes on playing the removed copy, and its list is right once read again', async () => {
    assert.equal(await second.locator('[data-pres-player-status]').textContent(), 'Playing locally');
    await second.locator('[data-pres-stop]').click();
    await backToLibrary(second);
    assert.deepEqual((await rows(second)).map((row) => row.title), [EXAMPLE_TITLE, EXAMPLE_TITLE]);
    await second.close();
  });
}
