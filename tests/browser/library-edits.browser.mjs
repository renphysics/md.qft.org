/**
 * Saved edits and the editor around them, as a person meets them: a deck
 * that only plays thanks to an edit is found again when its original file is
 * opened again; two tabs cannot silently replace each other's edits; Escape
 * in the code editor leaves the editor, not the presentation; Apply waits for
 * a change; names with invisible characters are shown visibly; problems on
 * the stage are readable at desktop and phone sizes; focus returns to a
 * visible control; a large file is announced at once; and Original gives a
 * page imported as one HTML file back as that file.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { tsImport } from 'tsx/esm/api';
import { until } from './harness.mjs';

export const title = 'Saved edits, the editor and the library';

const storage = (page) => page.locator('[data-pres-storage]').textContent();
const editStatus = (page) => page.locator('[data-pres-edit-status]').textContent();
const editorText = (page) => page.locator('[data-pres-code] .cm-content').textContent();

async function openSourceFiles(page) {
  await page.locator('[data-pres-view="source"]').click();
  await page.locator('[data-pres-source]').waitFor({ state: 'visible' });
  await page.locator('.presentation-file').first().waitFor();
}

async function selectFile(page, path, contains) {
  await page.locator(`.presentation-file[data-pres-file-path="${path}"]`).click();
  await until(async () => (await editorText(page)).includes(contains), `${path} in the editor`);
}

/** Replace the whole text of the open file, as pasting does. */
async function replaceText(page, text) {
  await page.locator('[data-pres-code] .cm-content').click();
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText(text);
}

async function applied(page, pattern = /^Changes applied\./) {
  await page.locator('[data-pres-apply]').click();
  await until(async () => pattern.test(await editStatus(page)), 'the changes to be applied');
}

async function openLibraryRow(page, name) {
  await page.locator('[data-open-presentations]').click();
  const row = page.locator('.presentation-saved-open', { hasText: name });
  await row.waitFor();
  await page.locator('[data-pres-list]:not([aria-busy])').waitFor();
  await row.first().click();
  await page.locator('[data-pres-start-button]').waitFor({ state: 'visible', timeout: 60_000 });
}

export default async function run(t) {
  const { loadFixtureDeck } = await tsImport('../helpers/deck-fixtures.ts', import.meta.url);
  const decode = (bytes) => new TextDecoder().decode(bytes);
  const fixture = loadFixtureDeck('local-project');
  const goodHtml = decode(fixture.get('index.html'));
  // Starts from a module script, which cannot play here: the deck only plays after an edit.
  const brokenHtml = goodHtml.replace('<script>\n    Reveal.initialize', '<script type="module">\n    import { setUp } from "./js/missing.mjs";\n    Reveal.initialize');
  assert.notEqual(brokenHtml, goodHtml);
  const zipOf = (files) => {
    const entries = {};
    for (const [path, bytes] of files) entries[`optics/${path}`] = bytes;
    return Buffer.from(zipSync(entries));
  };
  const brokenZip = zipOf(new Map([...fixture, ['index.html', strToU8(brokenHtml)]]));

  const { context, page } = await t.newPage({ acceptDownloads: true });
  await t.openWorkspace(page);
  const dialog = page.locator('[data-pres-dialog]');

  await t.step('A deck that cannot play is fixed by an edit and saved with it', async () => {
    await page.locator('[data-file-input]').setInputFiles({ name: 'optics-broken.zip', mimeType: 'application/zip', buffer: brokenZip });
    await until(async () => /Not saved/.test(await storage(page)), 'the deck to be reported as not playable');
    await openSourceFiles(page);
    await selectFile(page, 'index.html', 'missing.mjs');
    await replaceText(page, goodHtml);
    await applied(page);
    assert.match(await editStatus(page), /now saved in this browser, with your edits/);
    await page.locator('[data-pres-close]').click();
    await dialog.waitFor({ state: 'hidden' });
  });

  await t.step('Opening the same original file again opens the saved copy with its fix', async () => {
    await page.locator('[data-file-input]').setInputFiles({ name: 'optics-broken.zip', mimeType: 'application/zip', buffer: brokenZip });
    await until(async () => /already in your library, with your edits/.test(await page.locator('[data-pres-notice]').textContent()), 'the library copy to open');
    assert.match(await storage(page), /Saved in this browser with your edits/);
    assert.equal(await page.locator('[data-pres-start-button]').isVisible(), true, 'it plays');
    await openSourceFiles(page);
    await selectFile(page, 'index.html', '<title>');
    assert.doesNotMatch(await editorText(page), /missing\.mjs/, 'the editor holds the fixed text');
    // A second edit builds on the first one.
    await selectFile(page, 'css/custom.css', '');
    await page.locator('[data-pres-code] .cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText('\n/* second edit */');
    await applied(page);
    assert.match(await editStatus(page), /Your edits are saved in this browser/);
    await page.locator('[data-pres-close]').click();
    await dialog.waitFor({ state: 'hidden' });
    await openLibraryRow(page, 'Optics workshop');
    await openSourceFiles(page);
    await selectFile(page, 'index.html', '<title>');
    assert.doesNotMatch(await editorText(page), /missing\.mjs/, 'the first fix is kept');
    await selectFile(page, 'css/custom.css', 'second edit');
    await page.locator('[data-pres-close]').click();
    await dialog.waitFor({ state: 'hidden' });
  });

  await t.step('Apply waits for a change, and Escape in the editor leaves the editor, not the presentation', async () => {
    await openLibraryRow(page, 'Optics workshop');
    await openSourceFiles(page);
    await selectFile(page, 'index.html', '<title>');
    const apply = page.locator('[data-pres-apply]');
    assert.equal(await apply.isDisabled(), true, 'nothing to apply yet');
    await page.locator('[data-pres-code] .cm-content').click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    assert.equal(await dialog.isVisible(), true, 'the dialog stays open');
    assert.equal(await page.evaluate(() => document.activeElement?.closest('.presentation-file')?.dataset.presFilePath), 'index.html', 'the keyboard is on the file list');
    await page.locator('[data-pres-code] .cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText('\n<!-- typed -->');
    await until(async () => !(await apply.isDisabled()), 'Apply to be enabled by the change');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    assert.equal(await dialog.isVisible(), true);
    assert.equal(await page.locator('[data-pres-confirm]').isVisible(), false, 'nothing to confirm yet');
    assert.equal(await page.evaluate(() => document.activeElement?.hasAttribute('data-pres-apply')), true, 'the keyboard is on Apply changes');
    assert.equal(await page.locator('[data-pres-storage]').getAttribute('role'), 'status', 'the saved state is announced');
    // Escape outside the editor asks before the unapplied change is lost.
    await page.keyboard.press('Escape');
    await page.locator('[data-pres-confirm]').waitFor({ state: 'visible' });
    await page.locator('[data-pres-confirm-accept]').click();
    await dialog.waitFor({ state: 'hidden' });
  });

  await t.step('Two tabs editing the same deck: the second is told, and the first one’s edit stays', async () => {
    const other = t.observe(await context.newPage());
    await t.openWorkspace(other);
    await openLibraryRow(page, 'Optics workshop');
    await openLibraryRow(other, 'Optics workshop');
    await openSourceFiles(page);
    await openSourceFiles(other);
    await selectFile(page, 'slides.md', '##');
    await page.locator('[data-pres-code] .cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText('\n<!-- TAB-ONE -->');
    await applied(page);
    assert.match(await editStatus(page), /Your edits are saved in this browser/);
    await selectFile(other, 'slides.md', '##');
    await other.locator('[data-pres-code] .cm-content').click();
    await other.keyboard.press('Control+End');
    await other.keyboard.insertText('\n<!-- TAB-TWO -->');
    await applied(other);
    assert.match(await other.locator('[data-pres-edit-problem]').textContent(), /changed in another tab or window.*Reopen the presentation/);
    assert.equal(await other.locator('[data-pres-edit-problem]').isVisible(), true);
    assert.match(await storage(other), /not saved in this browser/);
    await other.locator('[data-pres-close]').click();
    await other.locator('[data-pres-confirm]').waitFor({ state: 'visible' });
    assert.match(await other.locator('[data-pres-confirm-message]').textContent(), /could not be saved/);
    await other.locator('[data-pres-confirm-accept]').click();
    await other.close();
    await page.locator('[data-pres-close]').click();
    await dialog.waitFor({ state: 'hidden' });
    await openLibraryRow(page, 'Optics workshop');
    await openSourceFiles(page);
    await selectFile(page, 'slides.md', 'TAB-ONE');
    assert.doesNotMatch(await editorText(page), /TAB-TWO/);
    await page.locator('[data-pres-close]').click();
    await dialog.waitFor({ state: 'hidden' });
  });

  await t.step('A file name with a direction override is shown with a visible mark', async () => {
    const name = 'evil\u202egnp.js';
    const zip = Buffer.from(zipSync({ 'index.html': strToU8('<!doctype html><title>Names</title><h1>Names</h1><script src="evil\u202egnp.js"></script>'), [name]: strToU8('void 0;') }));
    await page.locator('[data-file-input]').setInputFiles({ name: 'names.zip', mimeType: 'application/zip', buffer: zip });
    await page.locator('[data-pres-deck]').waitFor({ state: 'visible' });
    await openSourceFiles(page);
    const shown = await page.locator('.presentation-file-name').allTextContents();
    assert.ok(shown.includes('evil\ufffdgnp.js'), `the name is marked: ${JSON.stringify(shown)}`);
    assert.ok(!shown.some((text) => text.includes('\u202e')));
    await page.locator(`.presentation-file[data-pres-file-path="${name}"]`).click();
    assert.equal(await page.locator('[data-pres-file-name]').textContent(), 'evil\ufffdgnp.js');
    await page.locator('[data-pres-close]').click();
    await dialog.waitFor({ state: 'hidden' });
  });

  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    await t.step(`Several problems on the stage are readable at ${viewport.width}×${viewport.height}`, async () => {
      await page.setViewportSize(viewport);
      await page.locator('[data-file-input]').setInputFiles({ name: 'optics-broken-2.zip', mimeType: 'application/zip', buffer: zipOf(new Map([...fixture, ['index.html', strToU8(brokenHtml.replace('Optics workshop', 'Optics workshop 2'))]])) });
      const box = page.locator('[data-pres-problem]');
      await box.waitFor({ state: 'visible', timeout: 60_000 });
      // Three long problems, as a Slidev build with Monaco gives.
      await box.evaluate((element) => {
        const sentence = 'This Slidev build includes the Monaco code editor, which cannot run in the player. Remove the {monaco} code blocks, run "npx slidev build" again, and open a ZIP of the new dist folder. ';
        element.replaceChildren(...[1, 2, 3].map((n) => Object.assign(document.createElement('p'), { textContent: `${n}. ${sentence.repeat(2)}` })));
      });
      const layout = await box.evaluate((element) => {
        const panel = element.closest('.presentation-start');
        const paragraphs = [...element.querySelectorAll('p')];
        const tops = paragraphs.map((p) => p.getBoundingClientRect().top);
        return {
          squeezed: element.scrollHeight > element.clientHeight + 1,
          separateLines: tops.every((top, i) => i === 0 || top > tops[i - 1] + 10),
          panelScrolls: panel.scrollHeight > panel.clientHeight ? getComputedStyle(panel).overflowY : 'fits',
          pageOverflow: document.documentElement.scrollWidth > window.innerWidth,
        };
      });
      assert.equal(layout.squeezed, false, 'the box shows all its text');
      assert.equal(layout.separateLines, true, 'one problem per paragraph');
      assert.ok(['auto', 'fits'].includes(layout.panelScrolls), `the panel scrolls when needed: ${layout.panelScrolls}`);
      assert.equal(layout.pageOverflow, false);
      // Every paragraph can be brought into view inside the stage.
      for (const paragraph of await box.locator('p').all()) {
        await paragraph.scrollIntoViewIfNeeded();
        const inside = await paragraph.evaluate((p) => {
          const stage = p.closest('[data-pres-stage]').getBoundingClientRect();
          const rect = p.getBoundingClientRect();
          return rect.top >= stage.top - 1 && rect.bottom <= stage.bottom + 1;
        });
        assert.equal(inside, true, 'the paragraph is visible inside the stage');
      }
      await page.screenshot({ path: resolve(t.artifacts, `library-edits-problems-${viewport.width}.png`) });
      await page.locator('[data-pres-close]').click();
      await dialog.waitFor({ state: 'hidden' });
    });
  }

  await t.step('At 320 px, closing gives the keyboard to the sidebar toggle', async () => {
    await page.setViewportSize({ width: 320, height: 700 });
    if (!(await page.locator('[data-open-presentations]').isVisible())) await page.locator('[data-toggle-sidebar]').click();
    await page.locator('[data-open-presentations]').click();
    await dialog.waitFor({ state: 'visible' });
    await page.locator('[data-pres-close]').click();
    await dialog.waitFor({ state: 'hidden' });
    await until(() => page.evaluate(() => document.activeElement?.hasAttribute('data-toggle-sidebar')), 'the sidebar toggle to have the focus', 5_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
  });

  await t.step('A large file is announced at once, before it is read', async () => {
    const noise = new Uint8Array(2.2 * 1024 * 1024);
    for (let i = 0; i < noise.length; i += 65536) crypto.getRandomValues(noise.subarray(i, i + 65536));
    const zip = Buffer.from(zipSync({ 'index.html': strToU8('<!doctype html><title>Large</title><h1>Large</h1><img src="noise.png">'), 'noise.png': [noise, { level: 0 }] }));
    await page.evaluate(() => {
      window.__toasts = [];
      new MutationObserver(() => { const toast = document.querySelector('[data-toast]'); if (toast && !toast.hidden) window.__toasts.push(toast.textContent); })
        .observe(document.querySelector('[data-toast]'), { childList: true, characterData: true, subtree: true, attributes: true });
    });
    await page.locator('[data-file-input]').setInputFiles({ name: 'large-deck.zip', mimeType: 'application/zip', buffer: zip });
    await page.locator('[data-pres-deck]').waitFor({ state: 'visible', timeout: 60_000 });
    assert.ok((await page.evaluate(() => window.__toasts)).includes('Opening large-deck.zip…'));
    await page.locator('[data-pres-close]').click();
    await dialog.waitFor({ state: 'hidden' });
  });

  await t.step('Original gives a presentation imported as one HTML file back as that file', async () => {
    const html = '<!doctype html><html><head><title>Single page</title></head><body><h1>Single page</h1></body></html>';
    await page.locator('[data-file-input]').setInputFiles({ name: 'single-page.html', mimeType: 'text/html', buffer: Buffer.from(html) });
    await page.locator('[data-pres-deck]').waitFor({ state: 'visible' });
    await openSourceFiles(page);
    await selectFile(page, 'index.html', 'Single page');
    await page.locator('[data-pres-code] .cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText('\n<!-- edited -->');
    await applied(page);
    const downloading = page.waitForEvent('download');
    await page.locator('[data-pres-zip-original]').click();
    const download = await downloading;
    assert.equal(download.suggestedFilename(), 'single-page.html');
    const file = resolve(t.artifacts, 'library-edits-original.html');
    await download.saveAs(file);
    assert.equal(readFileSync(file, 'utf8'), html);
    await page.locator('[data-pres-close]').click();
    await dialog.waitFor({ state: 'hidden' });
  });

  await t.step('Nothing left the page', async () => {
    assert.deepEqual(t.externalRequests, []);
  });
}
