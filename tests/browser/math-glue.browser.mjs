/** End-to-end checks that the text beside an inline formula stays on the formula's line, wherever rendered Markdown is shown. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { until } from './harness.mjs';

export const title = 'Text beside inline formulas';

// [name, text before, formula, text after, whether the text after is kept]
// The text before is kept when it ends in a bracket or a digit.
const CASES = [
  ['first example', 'If a quantity $N(t)$ grows at a constant proportional rate ', 'r', ', then', true],
  ['full stop', 'the solution is ', 'N(t)=N_0e^{rt}', '. Positive values give growth', true],
  ['closing bracket', 'with a doubling time (written ', 'T', ') that satisfies the relation', true],
  ['opening bracket', 'the population is doubled every time (', 'T', ' hours) in this simple model', false],
  ['both brackets', 'a quantity that we shall call here (', 'x^2', ') for brevity in the text', true],
  ['both, two boxes', 'the famous and short relation (', 'E=mc^2', ') holds in every such frame', true],
  ['-th', 'this is true for the first and the ', 'n', '-th term of the long series', true],
  ['’s', 'we may now compare the first of ', 'f', '’s values with the second', true],
  ['-decay', 'the nucleus then undergoes a ', '\\beta', '-decay within a few seconds', true],
  // A dollar sign right after a digit does not open a formula; \( does.
  ['digit before', 'one full turn is an angle of 2', '\\(\\pi\\)', ' radians in these units', false],
  ['full-width comma', '其中我们把这个量记作', 'x', '，它是一个实数变量', true],
  ['Chinese text after', '其中我们把这个量记作', 'x', '是一个实数变量并且随时间变化的量就是这样', false],
  ['long sum', 'we then obtain the long sum ', 'a+b+c+d+e+f+g+h+i+j=k+l+m+n+o+p+q', ', which is the result', true],
  ['long, brackets', 'we then obtain the long sum (', 'a+b+c+d+e+f+g+h+i+j=k+l+m+n+o+p+q', '), which is the result', true],
  ['fraction', 'the ratio of the two is then ', '\\frac{a}{b}', '; it does not depend on scale', true],
];
const SOURCE = `# Text beside formulas\n\n${CASES.map(([, before, tex, after]) => `${before}${tex.startsWith('\\(') ? tex : `$${tex}$`}${after}`).join('\n\n')}\n`;
// The first case has a formula of its own, of one box, before the one that is measured.
const MEASURED = CASES.map(([name, before, , , keepAfter]) => ({
  name, before: before.replace(/\$[^$]*\$/g, ''), keepBefore: /[([{\d]$/.test(before), keepAfter, skipBoxes: /\$/.test(before) ? 1 : 0,
}));

/**
 * In the page: give the sized element each width in turn and record, for
 * each case paragraph, whether a kept character starts a line or is left at
 * the end of one, whether anything sticks out, and on how many lines the
 * formula's boxes sit. A width of null measures the page as it is; match
 * keeps only the paragraphs that contain that text.
 */
function sweep({ paragraphs: selector, sizer, widths, cases, match }) {
  const paragraphs = [...document.querySelectorAll(selector)].filter((p) => p.querySelector('.katex') && (!match || p.textContent.includes(match)));
  if (paragraphs.length !== cases.length) return { error: `${paragraphs.length} paragraphs with formulas for ${cases.length} cases` };
  const sized = sizer ? [document.querySelector(sizer)] : paragraphs;
  const found = { strandedAfter: [], strandedBefore: [], overflow: [], lines: {} };
  for (const width of widths) {
    for (const element of width === null ? [] : sized) {
      element.style.setProperty('width', `${width}px`, 'important');
      element.style.setProperty('max-width', 'none', 'important');
    }
    paragraphs.forEach((p, index) => {
      const item = cases[index];
      // The measured formula's boxes, wherever the keeping has put them; in
      // the first case they follow the one box of N(t).
      const boxes = [...p.querySelectorAll('.katex-html > .katex-base')].slice(item.skipBoxes);
      const first = boxes[0].getBoundingClientRect();
      const last = boxes[boxes.length - 1].getBoundingClientRect();
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      const nodes = [];
      for (let node; (node = walker.nextNode());) if (!node.parentElement.closest('.katex')) nodes.push(node);
      const at = (offset) => {
        let rest = offset;
        for (const node of nodes) {
          if (rest < node.data.length) {
            const range = document.createRange();
            range.setStart(node, rest);
            range.setEnd(node, rest + 1);
            return { rect: range.getBoundingClientRect(), char: node.data[rest] };
          }
          rest -= node.data.length;
        }
        return undefined;
      };
      const previous = at(item.before.length - 1);
      const next = at(item.before.length);
      if (item.keepAfter && next && next.rect.top > last.top + last.height * 0.6) found.strandedAfter.push(`${item.name} at ${width}`);
      if (item.keepBefore && previous && first.top > previous.rect.top + previous.rect.height * 0.6) found.strandedBefore.push(`${item.name} at ${width}`);
      const right = p.getBoundingClientRect().right;
      if (p.scrollWidth > p.clientWidth + 1 || [...p.querySelectorAll('.katex-base, .math-keep')].some((element) => element.getBoundingClientRect().right > right + 1)) {
        found.overflow.push(`${item.name} at ${width}`);
      }
      const lines = new Set(boxes.map((box) => Math.round(box.getBoundingClientRect().top))).size;
      found.lines[item.name] = Math.max(found.lines[item.name] ?? 0, lines);
    });
  }
  for (const element of sized) { element.style.removeProperty('width'); element.style.removeProperty('max-width'); }
  return found;
}

/** The markup of each case paragraph, for comparing where the same Markdown is shown. */
function caseMarkup(selector) {
  return [...document.querySelectorAll(selector)].filter((p) => p.querySelector('.katex')).map((p) => p.innerHTML);
}

const range = (from, to, step) => Array.from({ length: Math.floor((from - to) / step) + 1 }, (_, index) => from - index * step);

function assertKept(found, label) {
  assert.equal(found.error, undefined, `${label}: ${found.error}`);
  assert.deepEqual(found.strandedAfter, [], `${label}: kept text after a formula started a line`);
  assert.deepEqual(found.strandedBefore, [], `${label}: kept text before a formula was left at the end of a line`);
  assert.deepEqual(found.overflow, [], `${label}: something sticks out of its paragraph`);
}

/** Download the workspace's standalone HTML and check that the math fonts it embeds reached the page in full. */
async function exportHtml(t, page, name) {
  const fonts = new Set();
  page.on('request', (request) => {
    if (request.resourceType() === 'fetch' && /\/KaTeX_[^/]+\.woff2$/.test(new URL(request.url()).pathname)) fonts.add(request.url());
  });
  await page.locator('[data-export-toggle]').click();
  const downloading = page.waitForEvent('download');
  await page.locator('[data-export-html]').click();
  const file = resolve(t.artifacts, name);
  await (await downloading).saveAs(file);
  const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
  const embedded = new Set([...(await readFile(file, 'utf8')).matchAll(/url\("data:font\/woff2;base64,([A-Za-z0-9+/=]+)"\)/g)]
    .map((match) => digest(Buffer.from(match[1], 'base64'))));
  const delivered = new Set();
  for (const url of fonts) {
    const answer = await fetch(url);
    if (answer.ok && embedded.has(digest(Buffer.from(await answer.arrayBuffer())))) delivered.add(url);
  }
  // As in the slides suite: GitHub's runner can report such fetches as aborted all the same.
  t.setAsideDelivered((url) => delivered.has(url));
  return file;
}

async function openOffline(t, file) {
  const offline = await t.newContext({ offline: true });
  const page = t.observe(await offline.newPage());
  await page.goto(pathToFileURL(file).href, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  return { offline, page };
}

export default async function run(t) {
  const { context, page } = await t.newPage({ acceptDownloads: true, viewport: { width: 1280, height: 880 } });
  await context.addInitScript(() => { window.print = () => {}; });
  let preview;

  await t.step('In the first example, in the Split view of a window of 1280 by 880, the comma after r stays on the line of r', async () => {
    await t.openWorkspace(page, '?example=study-notes');
    const sentence = page.locator('[data-preview] p', { hasText: 'If a quantity' });
    await sentence.locator('.katex').first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    // This is the width at which the comma used to start a line.
    const found = await page.evaluate(sweep, { paragraphs: '[data-preview] p', match: 'If a quantity', sizer: null, widths: [null], cases: [MEASURED[0]] });
    assertKept(found, 'first example');
    assert.match(await sentence.locator('.math-keep').textContent(), /,$/, 'the comma is inside the kept span');
  });

  await t.step('In the preview, across 401 widths, no kept character starts or ends a line, nothing sticks out, and a long formula still wraps', async () => {
    await page.locator('[data-file-input]').setInputFiles({ name: 'beside-formulas.md', mimeType: 'text/markdown', buffer: Buffer.from(SOURCE) });
    await until(async () => (await page.locator('[data-preview] h1').first().textContent().catch(() => '')) === 'Text beside formulas', 'the imported document');
    await page.evaluate(() => document.fonts.ready);
    preview = await page.evaluate(caseMarkup, '[data-preview] p');
    assert.equal(preview.length, CASES.length);
    const found = await page.evaluate(sweep, { paragraphs: '[data-preview] p', sizer: '[data-preview]', widths: range(640, 240, 1), cases: MEASURED });
    assertKept(found, 'preview');
    assert.ok(found.lines['long sum'] >= 3 && found.lines['long, brackets'] >= 3, `the long formulas still wrap (${JSON.stringify(found.lines)})`);
    assert.equal(found.lines['first example'], 1);
  });

  await t.step('The print copy of Save PDF has the same markup and keeps the same text', async () => {
    await page.locator('[data-pdf]').click();
    await page.locator('[data-pdf-dialog]').waitFor({ state: 'visible' });
    await page.locator('[data-pdf-print]').click();
    await page.locator('.qft-print-document').waitFor({ state: 'attached' });
    await page.emulateMedia({ media: 'print' });
    try {
      await page.evaluate(() => document.fonts.ready);
      assert.deepEqual(await page.evaluate(caseMarkup, '.qft-print-document p'), preview);
      assertKept(await page.evaluate(sweep, { paragraphs: '.qft-print-document p', sizer: '.qft-print-document', widths: range(420, 240, 3), cases: MEASURED }), 'print');
    } finally {
      await page.emulateMedia({ media: 'screen' });
      await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    }
  });

  await t.step('The exported HTML document has the same markup and keeps the same text', async () => {
    const file = await exportHtml(t, page, 'math-glue-document.html');
    const { offline, page: exported } = await openOffline(t, file);
    assert.deepEqual(await exported.evaluate(caseMarkup, '.document-body p'), preview);
    assertKept(await exported.evaluate(sweep, { paragraphs: '.document-body p', sizer: null, widths: range(420, 240, 3), cases: MEASURED }), 'exported document');
    await offline.close();
  });

  await t.step('The Markdown slides preview and the exported slides have the same markup and keep the same text', async () => {
    await page.locator('[data-content-mode="slides"]').click();
    await page.locator('[data-slide-host] .reveal .slides p .katex').first().waitFor({ state: 'attached' });
    await page.evaluate(() => document.fonts.ready);
    assert.deepEqual(await page.evaluate(caseMarkup, '[data-slide-host] .reveal .slides p'), preview);
    assertKept(await page.evaluate(sweep, { paragraphs: '[data-slide-host] .reveal .slides p', sizer: null, widths: range(420, 240, 3), cases: MEASURED }), 'slides preview');
    const file = await exportHtml(t, page, 'math-glue-slides.html');
    const { offline, page: exported } = await openOffline(t, file);
    assert.deepEqual(await exported.evaluate(caseMarkup, '.reveal .slides p'), preview);
    assertKept(await exported.evaluate(sweep, { paragraphs: '.reveal .slides p', sizer: null, widths: range(420, 240, 3), cases: MEASURED }), 'exported slides');
    await offline.close();
  });

  await context.close();
}
