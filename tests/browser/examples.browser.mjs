/** End-to-end checks for the built-in examples: a Markdown document comes first wherever they are listed. */
import assert from 'node:assert/strict';
import { until } from './harness.mjs';

export const title = 'Built-in examples';

/** Which of the workspace's two views is on: "document" or "slides". */
function contentMode(page) {
  return page.locator('[data-content-mode][aria-pressed="true"]').getAttribute('data-content-mode');
}

/** Wait until the workspace shows the example with this title, and say in which view. */
async function opened(page, name) {
  await page.locator('.cm-editor').waitFor();
  await until(async () => (await page.locator('[data-document-title]').textContent()) === name, `the example "${name}" to open`);
  return contentMode(page);
}

export default async function run(t) {
  const { page } = await t.newPage();
  let listed;

  await t.step('The Examples page starts with the Markdown documents; the slide decks and the Slidev lesson follow', async () => {
    await page.goto(new URL('examples/', t.baseUrl).href, { waitUntil: 'networkidle' });
    listed = await page.locator('.example-card').evaluateAll((cards) => cards.map((card) => {
      const link = card.querySelector('a');
      const label = link.textContent.trim();
      return {
        number: card.querySelector('.example-number').textContent,
        title: card.querySelector('h2').textContent,
        id: new URL(link.href).searchParams.get('example'),
        kind: label === 'Open example' ? 'document' : label === 'Open slide deck' ? 'slides' : label === 'Open Slidev presentation' ? 'slidev' : label,
      };
    }));
    assert.equal(listed[0].kind, 'document', 'The first example is a Markdown document');
    assert.equal(listed[0].number, '01');
    assert.match(listed.map((card) => card.kind).join(' '), /^(document )+(slides )+slidev$/, 'Documents, then slide decks, then the compiled Slidev lesson');
  });

  await t.step('The first card opens in the Document view', async () => {
    await page.locator('.example-card a').first().click();
    assert.equal(await opened(page, listed[0].title), 'document');
    assert.doesNotMatch(page.url(), /example=/, 'The application consumes its example parameter');
    await until(async () => (await page.locator('[data-preview] h1').first().textContent().catch(() => '')) === listed[0].title, 'the document preview');
    assert.equal(await page.locator('[data-slide-host] .reveal').count(), 0, 'No slide preview is loaded for a document');
  });

  await t.step('For a first-time visitor, “Try an example” offers the same order and its first choice is a document', async () => {
    const visitor = await t.newPage();
    await t.openWorkspace(visitor.page);
    assert.equal(await contentMode(visitor.page), 'document', 'The workspace itself starts in the Document view');
    await visitor.page.locator('[data-welcome-examples]').click();
    await visitor.page.locator('[data-examples-dialog]').waitFor({ state: 'visible' });
    const options = visitor.page.locator('[data-examples-list] .example-option');
    assert.deepEqual(await options.evaluateAll((items) => items.map((item) => item.dataset.exampleId)), listed.filter((card) => card.id).map((card) => card.id),
      'The dialog lists the examples in the order of the Examples page');
    await options.first().click();
    await visitor.page.locator('[data-examples-dialog]').waitFor({ state: 'hidden' });
    assert.equal(await opened(visitor.page, listed[0].title), 'document');
    await visitor.context.close();
  });

  await t.step('A slide deck further down the list still opens in the Slides view', async () => {
    const deck = listed.find((card) => card.kind === 'slides');
    await page.locator('[data-show-examples]').click();
    await page.locator('[data-examples-dialog]').waitFor({ state: 'visible' });
    await page.locator(`[data-examples-list] [data-example-id="${deck.id}"]`).click();
    assert.equal(await opened(page, deck.title), 'slides');
    await page.locator('[data-slide-host] .reveal').waitFor();
  });
}
