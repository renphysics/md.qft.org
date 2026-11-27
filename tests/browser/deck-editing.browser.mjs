/**
 * Editing a deck's source files in the library, as a person does: open a
 * Reveal.js project ZIP, go to a slide, change its heading in the source
 * file, apply, and see the change on the same slide; reload and find the edit
 * kept; download it; restore the original. A build error keeps the last
 * version that worked, unapplied changes are not lost by closing, and a
 * portable package stays read-only. Nothing leaves the page.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { tsImport } from 'tsx/esm/api';
import { until } from './harness.mjs';
import { deckFrame } from './player-host.mjs';

export const title = 'Editing a deck in the browser';

const ORIGINAL_HEADING = 'Next: the picture slide';
const EDITED_HEADING = 'Next: an edited picture slide';

const status = (page) => page.locator('[data-pres-player-status]').textContent();
const editStatus = (page) => page.locator('[data-pres-edit-status]').textContent();
const fileButton = (page, path) => page.locator(`.presentation-file[data-pres-file-path="${path}"]`);
const badge = (page, path) => fileButton(page, path).locator('.presentation-file-badge');
const editorText = (page) => page.locator('[data-pres-code] .cm-content').textContent();

async function revealReady(frame) {
  await until(() => frame.evaluate(() => /** @type {any} */ (window).Reveal?.isReady?.()), 'Reveal.js to be ready');
}

/** The deck frame that shows `text`, once Reveal.js is ready in it. */
async function deckShowing(page, text) {
  const frame = await until(async () => {
    for (const candidate of page.frames()) {
      if (candidate.isDetached() || !candidate.url().startsWith('blob:')) continue;
      const found = await candidate.evaluate((wanted) => !!document.querySelector('.reveal .slides') && document.body.textContent.includes(wanted), text).catch(() => false);
      if (found) return candidate;
    }
    return false;
  }, `a deck frame showing “${text}”`);
  await revealReady(frame);
  return frame;
}

async function currentSlide(frame) {
  return frame.evaluate(() => ({ ...Reveal.getIndices(), text: Reveal.getCurrentSlide().textContent.replace(/\s+/g, ' ').trim() }));
}

async function startAndGoToThirdSlide(page) {
  await page.locator('[data-pres-start-button]').waitFor({ state: 'visible', timeout: 60_000 });
  await page.locator('[data-pres-start-button]').click();
  await until(async () => (await status(page)) === 'Playing locally', 'the deck to play');
  const frame = await deckFrame(page, '.reveal .slides');
  await revealReady(frame);
  await until(() => frame.evaluate(() => document.hasFocus()), 'the keyboard to reach the deck', 10_000);
  await page.keyboard.press('ArrowRight');
  await until(async () => (await currentSlide(frame)).h === 1, 'the second slide');
  await page.keyboard.press('ArrowRight');
  await until(async () => (await currentSlide(frame)).h === 2, 'the third slide');
  return frame;
}

async function openSourceFiles(page) {
  await page.locator('[data-pres-view="source"]').click();
  await page.locator('[data-pres-source]').waitFor({ state: 'visible' });
  await fileButton(page, 'index.html').waitFor();
}

async function selectFile(page, path, contains) {
  await fileButton(page, path).click();
  await until(async () => (await fileButton(page, path).getAttribute('aria-current')) === 'true', `${path} to be selected`);
  await until(async () => (await editorText(page)).includes(contains), `${path} in the editor`);
}

/** Replace one line of the file in the editor by typing, as a person does. */
async function retypeLine(page, find, replacement) {
  await page.locator('[data-pres-code] .cm-line', { hasText: find }).click();
  await page.keyboard.press('End');
  await page.keyboard.press('Shift+Home');
  await page.keyboard.type(replacement);
}

async function downloadBytes(t, page, selector, name) {
  const downloading = page.waitForEvent('download');
  await page.locator(selector).click();
  const download = await downloading;
  const file = resolve(t.artifacts, name);
  await download.saveAs(file);
  return { name: download.suggestedFilename(), entries: unzipSync(new Uint8Array(readFileSync(file))) };
}

export default async function run(t) {
  const { loadFixtureDeck } = await tsImport('../helpers/deck-fixtures.ts', import.meta.url);
  const entries = {};
  for (const [path, bytes] of loadFixtureDeck('local-project')) entries[`optics-workshop/${path}`] = bytes;
  const projectZip = Buffer.from(zipSync(entries));
  const originalSlides = new TextDecoder().decode(loadFixtureDeck('local-project').get('slides.md'));
  const decode = (bytes) => new TextDecoder().decode(bytes);

  const { context, page } = await t.newPage({ acceptDownloads: true });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await t.openWorkspace(page);
  const dialog = page.locator('[data-pres-dialog]');

  await t.step('A Reveal.js project ZIP opens, is saved, and plays on its third slide', async () => {
    await page.locator('[data-pres-input]').setInputFiles({ name: 'optics-workshop.zip', mimeType: 'application/zip', buffer: projectZip });
    await until(async () => /Saved in this browser/.test(await page.locator('[data-pres-storage]').textContent()), 'the deck to be saved');
    const frame = await startAndGoToThirdSlide(page);
    assert.match((await currentSlide(frame)).text, new RegExp(ORIGINAL_HEADING));
  });

  await t.step('Source files lists the entry page first, the deck’s own files, and a picture that is kept as is', async () => {
    await openSourceFiles(page);
    const paths = await page.locator('.presentation-file').evaluateAll((buttons) => buttons.map((button) => button.dataset.presFilePath));
    assert.deepEqual(paths, ['index.html', 'css/custom.css', 'css/theme-extra.css', 'js/demo.js', 'slides.md', 'assets/pic.png']);
    assert.equal(await fileButton(page, 'index.html').getAttribute('aria-current'), 'true');
    assert.match(await fileButton(page, 'index.html').textContent(), /Start page/);
    await until(async () => (await editorText(page)).includes('<title>Optics workshop</title>'), 'the entry page in the editor');
    assert.equal(await page.locator('[data-pres-code] .cm-content').getAttribute('contenteditable'), 'true');
    assert.match(await page.locator('[data-pres-source-note]').textContent(), /Apply changes/);
    // Reached and chosen with the keyboard alone.
    await fileButton(page, 'assets/pic.png').focus();
    await page.keyboard.press('Enter');
    await until(async () => /Pictures, fonts and media cannot be edited here/.test(await page.locator('[data-pres-file-message]').textContent()), 'the binary file note');
    assert.equal(await page.locator('[data-pres-code]').isVisible(), false, 'no editor for a binary file');
    assert.match(await fileButton(page, 'assets/pic.png').textContent(), /kept as is/);
    assert.equal(await page.locator('[data-pres-discard]').isDisabled(), true);
  });

  await t.step('Changing the slide’s heading in slides.md and pressing Ctrl+S applies it on the same slide', async () => {
    await selectFile(page, 'slides.md', ORIGINAL_HEADING);
    await retypeLine(page, ORIGINAL_HEADING, `## ${EDITED_HEADING}`);
    await until(async () => (await badge(page, 'slides.md').textContent()) === 'Not applied', 'the file to show changes not applied');
    assert.match(await page.locator('[data-pres-edit-summary]').textContent(), /1 not applied/);
    await page.keyboard.press('Control+s');
    await until(async () => /^Changes applied\./.test(await editStatus(page)), 'the changes to be applied');
    assert.match(await editStatus(page), /Choose Presentation to see them on the same slide\. Your edits are saved in this browser\./);
    assert.equal(await badge(page, 'slides.md').textContent(), 'Edited');
    assert.match(await page.locator('[data-pres-edit-summary]').textContent(), /1 file edited/);
    assert.equal(await page.locator('[data-pres-code] .cm-editor').evaluate((editor) => editor.contains(document.activeElement)), true, 'the keyboard stays in the editor');
    assert.match(await page.locator('[data-pres-subtitle]').textContent(), / · Edited$/);
    assert.equal(await page.locator('[data-pres-zip-original]').isVisible(), true);
    await page.locator('[data-pres-view="preview"]').click();
    const frame = await deckShowing(page, EDITED_HEADING);
    await until(async () => (await currentSlide(frame)).h === 2, 'the deck to return to the third slide');
    const slide = await currentSlide(frame);
    assert.equal(slide.v, 0);
    assert.match(slide.text, new RegExp(EDITED_HEADING));
    await until(async () => (await status(page)) === 'Playing locally', 'the new build to play');
    await page.screenshot({ path: resolve(t.artifacts, 'deck-editing-applied.png') });
  });

  await t.step('The ZIP download holds the edited file under its original name; Original is the upload', async () => {
    const edited = await downloadBytes(t, page, '[data-pres-zip]', 'deck-editing-edited.zip');
    assert.equal(edited.name, 'optics-workshop.zip');
    assert.match(decode(edited.entries['optics-workshop/slides.md']), new RegExp(`## ${EDITED_HEADING}`));
    assert.equal(decode(edited.entries['optics-workshop/index.html']), decode(loadFixtureDeck('local-project').get('index.html')));
    assert.deepEqual(edited.entries['optics-workshop/assets/pic.png'], loadFixtureDeck('local-project').get('assets/pic.png'));
    const original = await downloadBytes(t, page, '[data-pres-zip-original]', 'deck-editing-original.zip');
    assert.equal(original.name, 'optics-workshop-original.zip');
    assert.equal(decode(original.entries['optics-workshop/slides.md']), originalSlides);
  });

  await t.step('A change that cannot be built is reported, and the last version that worked keeps playing', async () => {
    const before = await deckShowing(page, EDITED_HEADING);
    await openSourceFiles(page);
    await selectFile(page, 'index.html', '<title>Optics workshop</title>');
    // The deck now starts from a module script, which cannot be played here.
    await page.locator('[data-pres-code] .cm-content').click();
    await page.keyboard.press('Control+a');
    const html = decode(loadFixtureDeck('local-project').get('index.html'))
      .replace('<script>\n    Reveal.initialize', '<script type="module">\n    import { setUp } from "./js/missing.mjs";\n    Reveal.initialize');
    await page.keyboard.insertText(html);
    await page.locator('[data-pres-apply]').click();
    await until(async () => /^Nothing was applied/.test(await editStatus(page)), 'the build problem to be reported');
    assert.match(await page.locator('[data-pres-edit-problem]').textContent(), /start-up code \(it imports \.\/js\/missing\.mjs\) cannot run here/);
    assert.equal(await badge(page, 'index.html').textContent(), 'Not applied', 'the change stays in the editor');
    await page.locator('[data-pres-view="preview"]').click();
    assert.equal(await deckShowing(page, EDITED_HEADING), before, 'the same deck keeps playing');
    assert.equal(await status(page), 'Playing locally');
    await openSourceFiles(page);
    await page.locator('[data-pres-discard]').click();
    await until(async () => /^Unapplied changes to index\.html discarded\. Undo \(Ctrl\+Z\) in the editor brings them back\.$/.test(await editStatus(page)), 'the change to be discarded');
    assert.equal(await badge(page, 'index.html').isVisible(), false);
    await page.locator('[data-pres-copy]').click();
    await until(async () => /^Copied index\.html\./.test(await editStatus(page)), 'the copy feedback');
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), decode(loadFixtureDeck('local-project').get('index.html')), 'the editor holds the imported text again');
  });

  await t.step('Closing with changes not applied asks first, and Keep editing keeps them', async () => {
    await selectFile(page, 'css/custom.css', '');
    await page.locator('[data-pres-code] .cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText('\nh2 { letter-spacing: 0.02em; }');
    await until(async () => (await badge(page, 'css/custom.css').textContent()) === 'Not applied', 'the unapplied change');
    await page.locator('[data-pres-close]').click();
    const confirm = page.locator('[data-pres-confirm]');
    await confirm.waitFor({ state: 'visible' });
    assert.match(await page.locator('[data-pres-confirm-message]').textContent(), /changes to 1 file have not been applied/);
    assert.equal(await page.evaluate(() => document.activeElement?.hasAttribute('data-pres-confirm-cancel')), true, 'the safe choice has the focus');
    await page.keyboard.press('Enter');
    await confirm.waitFor({ state: 'hidden' });
    assert.equal(await dialog.isVisible(), true);
    assert.match(await editorText(page), /letter-spacing/);
    // Escape in the editor only leaves the editor; Escape again asks too.
    await page.locator('[data-pres-code] .cm-content').click();
    await page.keyboard.press('Escape');
    await until(() => page.evaluate(() => document.activeElement?.hasAttribute('data-pres-apply')), 'the keyboard to move to Apply changes');
    assert.equal(await confirm.isVisible(), false);
    assert.equal(await dialog.isVisible(), true);
    await page.keyboard.press('Escape');
    await confirm.waitFor({ state: 'visible' });
    // Chromium refuses a page's second "keep open" without a new click or key,
    // so these sequences used to close the dialog and lose the typing.
    // Escape is refused on its keydown, so the dialog does not even close and open again.
    await dialog.evaluate((element) => {
      /** @type {any} */ (window).dialogCloses = 0;
      element.addEventListener('close', () => { /** @type {any} */ (window).dialogCloses += 1; });
    });
    const asksAndStays = async (what, closes = 0) => {
      await confirm.waitFor({ state: 'visible' });
      await page.waitForTimeout(400);
      assert.equal(await page.evaluate(() => /** @type {any} */ (window).dialogCloses), closes, `${what}: close events of the dialog`);
      assert.equal(await dialog.isVisible(), true, `${what}: the dialog stays open`);
      assert.equal(await confirm.isVisible(), true, `${what}: the question stays`);
      assert.match(await editorText(page), /letter-spacing/, `${what}: the typing is kept`);
    };
    // Right after typing, the editor keeps Escape for its suggestions, as before.
    const settled = () => page.waitForTimeout(500);
    // Keep editing by Escape, type more, then Escape twice.
    await page.keyboard.press('Escape');
    await confirm.waitFor({ state: 'hidden' });
    await page.locator('[data-pres-code] .cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('/*MORE*/');
    await settled();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await asksAndStays('Escape twice after Keep editing by Escape');
    // The same after Keep editing by a click.
    await page.locator('[data-pres-confirm-cancel]').click();
    await confirm.waitFor({ state: 'hidden' });
    await page.locator('[data-pres-code] .cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('/*MORE*/');
    await settled();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await asksAndStays('Escape twice after Keep editing by a click');
    // Type, undo, and Escape twice at once.
    await page.keyboard.press('Escape');
    await confirm.waitFor({ state: 'hidden' });
    await page.locator('[data-pres-code] .cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('/*X*/');
    await page.waitForTimeout(300);
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await asksAndStays('Escape twice right after an undo');
    // Keep editing by Escape, then Escape again, with nothing else in between: the
    // browser would not keep the dialog open, so the keydown itself must refuse it.
    for (let round = 0; round < 2; round += 1) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }
    await asksAndStays('Keep editing by Escape and Escape again, twice');
    // Any other way the dialog closes: it opens again as it was, and asks.
    await page.keyboard.press('Escape');
    await confirm.waitFor({ state: 'hidden' });
    await dialog.evaluate((element) => element.close());
    await asksAndStays('a close the page did not ask for', 1);
    // Also while the question is on screen: it comes back above the dialog.
    await dialog.evaluate((element) => element.close());
    await asksAndStays('a close while the question is shown', 2);
    await page.locator('[data-pres-confirm-cancel]').click();
    await confirm.waitFor({ state: 'hidden' });
    assert.equal(await dialog.isVisible(), true, 'Keep editing keeps the dialog');
    await page.locator('[data-pres-close]').click();
    await confirm.waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-pres-host] iframe').count(), 1, 'the presentation still plays');
    await page.locator('[data-pres-confirm-accept]').click();
    await dialog.waitFor({ state: 'hidden' });
    await until(async () => (await page.locator('[data-pres-host] iframe').count()) === 0, 'playback to stop');
  });

  await t.step('A presentation file dropped on the open dialog asks first: Keep editing keeps the typing, Discard opens the file', async () => {
    await page.locator('[data-open-presentations]').click();
    await page.locator('.presentation-saved-open', { hasText: 'Optics workshop' }).click();
    await page.locator('[data-pres-start-button]').waitFor({ state: 'visible', timeout: 60_000 });
    await openSourceFiles(page);
    await selectFile(page, 'css/custom.css', '');
    await page.locator('[data-pres-code] .cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText('\n/* dropped-on */');
    await until(async () => (await badge(page, 'css/custom.css').textContent()) === 'Not applied', 'the unapplied change');
    // As a file dragged from the desktop: the drop reaches the workspace, which hands it to the library.
    const drop = () => page.locator('[data-pres-stage]').evaluate((stage) => {
      const data = new DataTransfer();
      data.items.add(new File(['<!doctype html><html><head><title>Dropped lesson</title></head><body><h1>Dropped lesson</h1><p>One slide.</p></body></html>'], 'dropped-lesson.html', { type: 'text/html' }));
      stage.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, composed: true, dataTransfer: data }));
    });
    const confirm = page.locator('[data-pres-confirm]');
    await drop();
    await confirm.waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-pres-confirm-title]').textContent(), 'Leave without your changes?');
    await page.locator('[data-pres-confirm-cancel]').click();
    await confirm.waitFor({ state: 'hidden' });
    await page.waitForTimeout(1000);
    assert.equal(await page.locator('[data-pres-title]').textContent(), 'Optics workshop', 'Keep editing keeps the presentation');
    assert.equal(await badge(page, 'css/custom.css').textContent(), 'Not applied');
    assert.match(await editorText(page), /dropped-on/, 'Keep editing keeps the typing');
    await drop();
    await confirm.waitFor({ state: 'visible' });
    await page.locator('[data-pres-confirm-accept]').click();
    await until(async () => (await page.locator('[data-pres-title]').textContent()) === 'Dropped lesson', 'the dropped file to open');
    await page.locator('[data-pres-close]').click();
    await dialog.waitFor({ state: 'hidden' });
  });

  await t.step('A lesson ZIP dropped on the open dialog asks nothing and keeps the typing; the workspace opens the lesson', async () => {
    await page.locator('[data-open-presentations]').click();
    await page.locator('.presentation-saved-open', { hasText: 'Optics workshop' }).click();
    await page.locator('[data-pres-start-button]').waitFor({ state: 'visible', timeout: 60_000 });
    await openSourceFiles(page);
    await selectFile(page, 'css/custom.css', '');
    await page.locator('[data-pres-code] .cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText('\n/* lesson-dropped-on */');
    await until(async () => (await badge(page, 'css/custom.css').textContent()) === 'Not applied', 'the unapplied change');
    const lesson = [...zipSync({ 'lesson.md': strToU8('# Dropped lesson notes\n\nNo slides here.\n') })];
    await page.locator('[data-pres-stage]').evaluate((stage, bytes) => {
      const data = new DataTransfer();
      data.items.add(new File([new Uint8Array(bytes)], 'lesson.zip', { type: 'application/zip' }));
      stage.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, composed: true, dataTransfer: data }));
    }, lesson);
    await until(async () => /^Lesson opened\./.test(await page.locator('[data-toast]').textContent() ?? ''), 'the workspace to open the lesson');
    assert.equal(await page.locator('[data-pres-confirm]').isVisible(), false, 'no question');
    assert.equal(await page.locator('[data-pres-notice]').isVisible(), false, 'no "Opening lesson.zip…" left behind');
    assert.equal(await page.locator('[data-pres-title]').textContent(), 'Optics workshop');
    assert.equal(await badge(page, 'css/custom.css').textContent(), 'Not applied');
    assert.match(await editorText(page), /lesson-dropped-on/, 'the typing stays');
    await page.locator('[data-pres-close]').click();
    await page.locator('[data-pres-confirm-accept]').click();
    await dialog.waitFor({ state: 'hidden' });
  });

  await t.step('After a reload the deck reopens from the library with its edit', async () => {
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('.cm-editor').waitFor();
    await page.locator('[data-open-presentations]').click();
    const row = page.locator('.presentation-saved-open', { hasText: 'Optics workshop' });
    await row.waitFor();
    assert.match(await row.textContent(), / · Edited/);
    await row.click();
    const frame = await startAndGoToThirdSlide(page);
    assert.match((await currentSlide(frame)).text, new RegExp(EDITED_HEADING));
    await openSourceFiles(page);
    assert.equal(await badge(page, 'slides.md').textContent(), 'Edited');
    assert.equal(await badge(page, 'css/custom.css').isVisible(), false, 'changes that were never applied are gone');
  });

  await t.step('Discard with typing not applied keeps the applied, saved edit; then it asks before removing that edit', async () => {
    await selectFile(page, 'slides.md', EDITED_HEADING);
    await page.locator('[data-pres-code] .cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText('\n<!-- not applied -->');
    await until(async () => (await badge(page, 'slides.md').textContent()) === 'Not applied', 'the unapplied typing');
    await page.locator('[data-pres-discard]').click();
    await until(async () => /^Unapplied changes to slides\.md discarded\. Undo/.test(await editStatus(page)), 'the typing to be discarded');
    const text = await editorText(page);
    assert.match(text, new RegExp(EDITED_HEADING), 'the applied edit stays');
    assert.doesNotMatch(text, /not applied -->/);
    assert.equal(await badge(page, 'slides.md').textContent(), 'Edited');
    assert.match(await page.locator('[data-pres-storage]').textContent(), /Saved in this browser with your edits/);
    assert.equal(await page.locator('[data-pres-code] .cm-editor').evaluate((editor) => editor.contains(document.activeElement)), true, 'the keyboard is in the editor');
    // Undo brings the typing back, as the status says.
    await page.keyboard.press('Control+z');
    await until(async () => (await editorText(page)).includes('not applied -->'), 'Undo to bring the typing back');
    await page.keyboard.press('Control+y');
    await until(async () => !(await editorText(page)).includes('not applied -->'), 'Redo to discard it again');
    // Now the file has no unapplied changes, only the saved edit: Discard asks first.
    await until(async () => (await badge(page, 'slides.md').textContent()) === 'Edited', 'no unapplied changes');
    await page.locator('[data-pres-discard]').click();
    const confirm = page.locator('[data-pres-confirm]');
    await confirm.waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-pres-confirm-title]').textContent(), 'Restore this file as imported?');
    assert.match(await page.locator('[data-pres-confirm-message]').textContent(), /applied changes to slides\.md will be removed/);
    await page.locator('[data-pres-confirm-cancel]').click();
    await confirm.waitFor({ state: 'hidden' });
    // A rebuild would start at once: give it time, then wait until nothing is busy.
    await page.waitForTimeout(1000);
    await until(async () => (await page.locator('[data-pres-source]').getAttribute('aria-busy')) === null, 'Source files to be idle');
    assert.equal(await badge(page, 'slides.md').textContent(), 'Edited', 'Keep my changes keeps the edit');
    assert.match(await editorText(page), new RegExp(EDITED_HEADING));
    assert.match(await page.locator('[data-pres-storage]').textContent(), /Saved in this browser with your edits/);
    assert.doesNotMatch(await editStatus(page), /back to its imported text/);
    // Confirmed, the file goes back to its imported text, and is saved so.
    await page.locator('[data-pres-discard]').click();
    await confirm.waitFor({ state: 'visible' });
    await page.locator('[data-pres-confirm-accept]').click();
    await until(async () => /^slides\.md is back to its imported text\. Choose Presentation to see the imported text on the same slide\. The copy saved in this browser is the original again\.$/.test(await editStatus(page)), 'the file to be restored');
    assert.equal(await badge(page, 'slides.md').isVisible(), false);
    assert.match(await editorText(page), new RegExp(ORIGINAL_HEADING));
    assert.equal(await page.locator('[data-pres-code] .cm-editor').evaluate((editor) => editor.contains(document.activeElement)), true, 'the keyboard is back in the editor');
    // Apply the edit again for the next step.
    await retypeLine(page, ORIGINAL_HEADING, `## ${EDITED_HEADING}`);
    await until(async () => (await badge(page, 'slides.md').textContent()) === 'Not applied', 'the retyped edit');
    // This time by keyboard on Apply changes: Escape leaves the editor, Enter applies.
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await until(() => page.evaluate(() => document.activeElement?.hasAttribute('data-pres-apply')), 'the keyboard to move to Apply changes');
    await page.keyboard.press('Enter');
    await until(async () => (await badge(page, 'slides.md').textContent()) === 'Edited', 'the edit to be applied again');
    await until(() => page.locator('[data-pres-code] .cm-editor').evaluate((editor) => editor.contains(document.activeElement)), 'the keyboard to be back in the editor after Apply');
  });

  await t.step('Restore original, after confirmation, brings the first text back on the same slide', async () => {
    await page.locator('[data-pres-restore]').click();
    const confirm = page.locator('[data-pres-confirm]');
    await confirm.waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-pres-confirm-title]').textContent(), 'Restore the original presentation?');
    await page.locator('[data-pres-confirm-accept]').click();
    await until(async () => /^The original presentation is restored\./.test(await editStatus(page)), 'the original to be restored');
    assert.equal(await page.locator('[data-pres-code] .cm-editor').evaluate((editor) => editor.contains(document.activeElement)), true, 'the keyboard goes to the editor, not to the page');
    assert.equal(await badge(page, 'slides.md').isVisible(), false);
    assert.equal(await page.locator('[data-pres-zip-original]').isVisible(), false);
    assert.doesNotMatch(await page.locator('[data-pres-subtitle]').textContent(), /Edited/);
    await selectFile(page, 'slides.md', ORIGINAL_HEADING);
    await page.locator('[data-pres-view="preview"]').click();
    const frame = await deckShowing(page, ORIGINAL_HEADING);
    await until(async () => (await currentSlide(frame)).h === 2, 'the third slide');
    assert.match((await currentSlide(frame)).text, new RegExp(ORIGINAL_HEADING));
    const zip = await downloadBytes(t, page, '[data-pres-zip]', 'deck-editing-restored.zip');
    assert.deepEqual(Object.keys(zip.entries).sort(), Object.keys(entries).sort(), 'the restored ZIP is the upload');
    await page.locator('[data-pres-back]').click();
    const row = page.locator('.presentation-saved-open', { hasText: 'Optics workshop' });
    await row.waitFor();
    await page.locator('[data-pres-list]:not([aria-busy])').waitFor();
    assert.doesNotMatch(await row.textContent(), /Edited/);
  });

  await t.step('A portable package is read-only: it explains how to change it and offers no editable field', async () => {
    const pkg = Buffer.from(zipSync({
      'qft-presentation.json': strToU8(JSON.stringify({ format: 'qft-presentation', version: 1, engine: 'slidev', title: 'Built lesson', entry: 'presentation.html', source: 'source/slides.md' })),
      'presentation.html': strToU8('<!doctype html><html><body><main><h1>Built lesson</h1></main></body></html>'),
      'source/slides.md': strToU8('# Built lesson\n\nThe source, for reference.\n'),
    }));
    await page.locator('[data-pres-input]').setInputFiles({ name: 'built-lesson.zip', mimeType: 'application/zip', buffer: pkg });
    await page.locator('[data-pres-start-button]').waitFor({ state: 'visible' });
    await page.locator('[data-pres-view="source"]').click();
    await fileButton(page, 'source/slides.md').waitFor();
    await until(async () => (await editorText(page)).includes('The source, for reference.'), 'the source in the viewer');
    assert.match(await page.locator('[data-pres-source-note]').textContent(), /read-only here.*rebuild the package/);
    assert.equal(await page.locator('[data-pres-apply]').isVisible(), false);
    assert.equal(await page.locator('[data-pres-discard]').isVisible(), false);
    assert.equal(await page.locator('[data-pres-restore]').isVisible(), false);
    assert.equal(await page.locator('[data-pres-source] [contenteditable="true"]').count(), 0, 'no editable field');
    assert.equal(await page.locator('[data-pres-code] .cm-content').getAttribute('aria-readonly'), 'true');
    await page.locator('[data-pres-code] .cm-content').focus();
    await page.keyboard.type('typed');
    assert.doesNotMatch(await editorText(page), /typed/);
    assert.match(await page.locator('[data-pres-edit-summary]').textContent(), /read-only/);
    await page.locator('[data-pres-copy]').click();
    await until(async () => /^Copied source\/slides\.md\./.test(await editStatus(page)), 'the copy feedback');
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '# Built lesson\n\nThe source, for reference.\n');
    await page.locator('[data-pres-close]').click();
    await dialog.waitFor({ state: 'hidden' });
  });

  await t.step('Nothing left the page', async () => {
    assert.deepEqual(t.externalRequests, []);
  });
}
