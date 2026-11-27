/**
 * The library on a phone, and a tab left open across a new release. At
 * 320x568 and 390x844 every toolbar button, Present included, lies inside the
 * dialog also once Original appears after an edit; the Source files view is
 * not shifted sideways, its status, Restore original and note do not overlap,
 * and Restore original can be clicked. When a part of the site that loads on
 * demand is gone (the hashed files of the old release), the library says so
 * with a Reload button instead of showing 0 presentations, and opening a file
 * shows the same plain sentence, never the browser's import error.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { until } from './harness.mjs';

export const title = 'The library on a phone and after a new release';

const LOAD_FAILURE = 'A part of this site could not be loaded: the site was updated while this page was open, or the connection was lost. Reload the page to continue. Your saved presentations and documents are kept.';

const DECK = Buffer.from(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Phone lesson</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5.2.1/dist/reveal.css"></head>
<body><div class="reveal"><div class="slides"><section><h1>Phone lesson</h1></section><section><h2>Second slide</h2></section></div></div>
<script src="https://cdn.jsdelivr.net/npm/reveal.js@5.2.1/dist/reveal.js"></script><script>Reveal.initialize({ hash: false });</script></body></html>
`);

const box = (locator) => locator.evaluate((element) => {
  const r = element.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
});
const overlaps = (a, b) => a.width > 0 && b.width > 0 && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Every visible toolbar button lies inside the dialog and is the element a tap on its middle reaches. */
async function toolbarInside(page, label) {
  const dialog = await box(page.locator('[data-pres-dialog]'));
  const buttons = page.locator('.presentation-toolbar button:visible');
  const count = await buttons.count();
  assert.ok(count >= 5, `${label}: the toolbar buttons are shown`);
  for (let index = 0; index < count; index++) {
    const button = buttons.nth(index);
    const rect = await box(button);
    const name = (await button.textContent()).trim();
    assert.ok(rect.x >= dialog.x - 0.5 && rect.x + rect.width <= dialog.x + dialog.width + 0.5, `${label}: ${name} ${JSON.stringify(rect)} inside the dialog ${JSON.stringify(dialog)}`);
    const reached = await button.evaluate((element) => {
      const r = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    });
    assert.equal(reached, true, `${label}: ${name} can be tapped`);
  }
  assert.equal(await page.locator('[data-pres-dialog]').evaluate((element) => element.scrollLeft), 0, `${label}: the dialog is not shifted sideways`);
}

async function phone(t, size) {
  const { page } = await t.newPage({ viewport: size });
  await t.openWorkspace(page);
  await page.locator('[data-file-input]').setInputFiles({ name: 'phone-lesson.html', mimeType: 'text/html', buffer: DECK });
  await page.locator('[data-pres-start-button]').waitFor({ state: 'visible', timeout: 60_000 });
  const label = `${size.width}x${size.height}`;
  await toolbarInside(page, `${label} before an edit`);

  // Present at once, by a plain click on the button.
  await page.locator('[data-pres-present]').click();
  await until(() => page.evaluate(() => !!document.fullscreenElement
    || !!document.querySelector('[data-pres-stage].presentation-fallback-fullscreen')), `${label}: Present`);
  await page.locator('[data-pres-exit-fullscreen]').click();
  await until(() => page.evaluate(() => !document.fullscreenElement
    && !document.querySelector('[data-pres-stage].presentation-fallback-fullscreen')), `${label}: leaving Present`);

  // An edit: Original appears in the toolbar.
  await page.locator('[data-pres-view="source"]').click();
  await page.locator('[data-pres-code] .cm-content').waitFor();
  await until(async () => (await page.locator('[data-pres-code] .cm-content').textContent()).includes('Phone lesson'), `${label}: the page in the editor`);
  await page.locator('[data-pres-code] .cm-line', { hasText: '<h2>Second slide</h2>' }).click();
  await page.keyboard.press('End');
  await page.keyboard.type('<!-- edited on a phone -->');
  await page.locator('[data-pres-apply]').click();
  await until(async () => /^Changes applied\./.test(await page.locator('[data-pres-edit-status]').textContent()), `${label}: the change to be applied`);
  await page.locator('[data-pres-zip-original]').waitFor({ state: 'visible' });
  await toolbarInside(page, `${label} with Original`);

  // The Source files view: nothing cut off on the left, nothing on top of anything else.
  const source = page.locator('[data-pres-source]');
  const sourceBox = await box(source);
  const dialog = await box(page.locator('[data-pres-dialog]'));
  assert.ok(sourceBox.x >= dialog.x - 0.5 && sourceBox.x + sourceBox.width <= dialog.x + dialog.width + 0.5, `${label}: the Source files view lies inside the dialog`);
  assert.ok(await source.evaluate((element) => element.scrollWidth <= element.clientWidth + 1), `${label}: the Source files view has no sideways overflow`);
  const status = page.locator('[data-pres-edit-status]');
  const restore = page.locator('[data-pres-restore]');
  const note = page.locator('[data-pres-source-note]');
  await restore.scrollIntoViewIfNeeded();
  const parts = { status: await box(status), restore: await box(restore), note: await box(note) };
  assert.equal(overlaps(parts.status, parts.restore), false, `${label}: status and Restore original ${JSON.stringify(parts)}`);
  assert.equal(overlaps(parts.status, parts.note), false, `${label}: status and note ${JSON.stringify(parts)}`);
  assert.equal(overlaps(parts.restore, parts.note), false, `${label}: Restore original and note ${JSON.stringify(parts)}`);
  const footer = await box(page.locator('.presentation-dialog-footer'));
  assert.equal(overlaps(parts.restore, footer), false, `${label}: Restore original is above the dialog footer`);
  await page.screenshot({ path: resolve(t.artifacts, `library-phone-source-${label}.png`) });

  // Restore original, with an ordinary click (no forcing past whatever lies on top).
  await restore.click();
  await page.locator('[data-pres-confirm]').waitFor({ state: 'visible' });
  await page.locator('[data-pres-confirm-accept]').click();
  await until(async () => /^The original presentation is restored\./.test(await status.textContent()), `${label}: the original to be restored`);
  assert.equal(await page.locator('[data-pres-code] .cm-editor').evaluate((editor) => editor.contains(document.activeElement)), true, `${label}: the keyboard is in the editor`);
  await page.locator('[data-pres-zip-original]').waitFor({ state: 'hidden' });
  await page.close();
}

export default async function run(t) {
  for (const size of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
    await t.step(`At ${size.width}x${size.height} Present and every toolbar button are in the dialog, and Restore original can be clicked`, () => phone(t, size));
  }

  await t.step('After a new release, the library says that a part of the site could not be loaded, with Reload, and no count of 0', async () => {
    // The 404s below are the point of this step.
    t.allowConsoleError(/Failed to load resource: the server responded with a status of 404/);
    const { page } = await t.newPage({ viewport: { width: 1280, height: 800 } });
    await t.openWorkspace(page);
    // The page has loaded; now the old release's files are gone.
    await page.route(/\/_astro\/(presentation-store|deck-project)\.[^/]*\.js$/, (route) => route.fulfill({ status: 404, body: 'Not found' }));
    await page.locator('[data-open-presentations]').click();
    const failed = page.locator('[data-pres-list] .presentation-load-failed');
    await failed.waitFor();
    assert.equal((await failed.locator('p').textContent()).trim(), LOAD_FAILURE);
    assert.equal(await failed.getAttribute('role'), 'alert');
    assert.equal(await page.locator('[data-pres-reload]').isVisible(), true);
    assert.equal(await page.locator('[data-pres-count]').isVisible(), false, 'no count of 0');
    assert.equal(await page.locator('.presentation-empty').count(), 0, 'not shown as an empty library');
    assert.doesNotMatch(await page.locator('[data-pres-dialog]').textContent(), /dynamically imported module|_astro/);
    await page.screenshot({ path: resolve(t.artifacts, 'library-phone-load-failure.png') });
    await page.keyboard.press('Escape');
    await page.locator('[data-pres-dialog]').waitFor({ state: 'hidden' });

    // Opening a file from the workspace gives the same sentence in the toast.
    await page.locator('[data-file-input]').setInputFiles({ name: 'phone-lesson.html', mimeType: 'text/html', buffer: DECK });
    await until(async () => (await page.locator('[data-toast]').textContent()) === LOAD_FAILURE, 'the plain sentence in the toast');

    // Reload reloads the page; with the files back, the library shows again.
    await page.locator('[data-open-presentations]').click();
    const reloaded = page.waitForEvent('load');
    await page.locator('[data-pres-reload]').click();
    await reloaded;
    await page.unroute(/\/_astro\/(presentation-store|deck-project)\.[^/]*\.js$/);
    await page.locator('.cm-editor').waitFor();
    await page.locator('[data-open-presentations]').click();
    await page.locator('[data-pres-list]:not([aria-busy])').waitFor();
    assert.equal(await page.locator('[data-pres-count]').isVisible(), true);
    assert.equal(await page.locator('.presentation-load-failed').count(), 0);
    await page.close();
    // The module requests that this step answered with 404 are reported as aborted; only those are expected.
    const gone = /\/_astro\/(presentation-store|deck-project)\.[^/]*\.js$/;
    const expected = t.failedRequests.filter((request) => gone.test(request.url));
    assert.ok(expected.length >= 2, 'the old release\'s files were asked for');
    t.failedRequests.splice(0, t.failedRequests.length, ...t.failedRequests.filter((request) => !gone.test(request.url)));
  });

  await t.step('After a new release, Source files, the Slidev converter and the slide preview give the fixed sentence, with Reload where it stays on screen', async () => {
    t.allowConsoleError(/Failed to load resource: the server responded with a status of 404/);
    const { page } = await t.newPage({ viewport: { width: 1280, height: 800 } });
    await t.openWorkspace(page);
    const gone = /\/_astro\/(deck-sources|deck-editor|slidev-convert-browser|slide-preview)\.[^/]*\.js$/;
    await page.locator('[data-file-input]').setInputFiles({ name: 'phone-lesson.html', mimeType: 'text/html', buffer: DECK });
    await page.locator('[data-pres-start-button]').waitFor({ state: 'visible' });
    await page.route(gone, (route) => route.fulfill({ status: 404, body: 'Not found' }));
    // Source files: in place of "Opening the files…", and in the notice, each with Reload.
    await page.locator('[data-pres-view="source"]').click();
    const message = page.locator('[data-pres-file-message]');
    await until(async () => (await message.textContent()).startsWith(LOAD_FAILURE), 'the fixed sentence in Source files');
    assert.equal(await message.locator('[data-reload-page]').isVisible(), true, 'Reload in Source files');
    await until(async () => (await page.locator('[data-pres-notice]').textContent()).startsWith(LOAD_FAILURE), 'the fixed sentence in the notice');
    assert.equal(await page.locator('[data-pres-notice] [data-reload-page]').isVisible(), true, 'Reload in the notice');
    assert.doesNotMatch(await page.locator('[data-pres-dialog]').textContent(), /dynamically imported module|_astro|Opening the files/);
    await page.locator('[data-pres-close]').click();
    await page.locator('[data-pres-dialog]').waitFor({ state: 'hidden' });
    // A Slidev build whose converter script is gone: the fixed sentence, not "check the internet connection".
    const slidev = readFileSync(new URL('../fixtures/slidev-default-build.zip', import.meta.url));
    await page.locator('[data-file-input]').setInputFiles({ name: 'slidev-build.zip', mimeType: 'application/zip', buffer: slidev });
    await until(async () => (await page.locator('[data-pres-problem]').textContent()).includes(LOAD_FAILURE), 'the fixed sentence for the converter');
    assert.doesNotMatch(await page.locator('[data-pres-dialog]').textContent(), /Check the internet connection/);
    await page.locator('[data-pres-close]').click();
    await page.locator('[data-pres-dialog]').waitFor({ state: 'hidden' });
    // The workspace's slide preview: the fixed sentence with Reload, not "Switch to Document and back".
    await page.locator('[data-content-mode="slides"]').click();
    const host = page.locator('[data-slide-host]');
    await until(async () => (await host.textContent()).startsWith(LOAD_FAILURE), 'the fixed sentence in the slide preview');
    assert.equal(await host.locator('[data-reload-page]').isVisible(), true, 'Reload in the slide preview');
    await page.unroute(gone);
    await page.close();
    t.failedRequests.splice(0, t.failedRequests.length, ...t.failedRequests.filter((request) => !gone.test(request.url)));
  });
}
