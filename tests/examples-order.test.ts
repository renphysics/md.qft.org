import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { EXAMPLES } from '../src/lib/examples';

const kind = (example: (typeof EXAMPLES)[number]) => example.mode === 'slides' ? 'slides' : 'document';

test('the first built-in example is a Markdown document, and the documents come before the slide decks', () => {
  assert.equal(kind(EXAMPLES[0]), 'document', `the first example, "${EXAMPLES[0].title}", opens in the Document view`);
  const kinds = EXAMPLES.map(kind);
  const firstDeck = kinds.indexOf('slides');
  assert.ok(firstDeck > 0, 'the list has slide decks too, after at least one document');
  assert.ok(kinds.slice(firstDeck).every((entry) => entry === 'slides'), `no document follows a slide deck: ${kinds.join(', ')}`);
});

test('the first built-in example is written as a document, not as slides in disguise', () => {
  const { source } = EXAMPLES[0];
  assert.match(source, /^# \S/, 'it starts with a title');
  assert.doesNotMatch(source, /^~~~interactive\b/m, 'it has no slide demonstrations');
  // A document may use one horizontal rule; a deck separates every slide with one.
  assert.ok((source.match(/^---$/gm) ?? []).length <= 1, 'it is not divided into slides');
});

test('every built-in example has its own id, title and description', () => {
  for (const field of ['id', 'title', 'description'] as const) {
    const values = EXAMPLES.map((example) => example[field]);
    assert.equal(new Set(values).size, values.length, `${field} values are unique`);
    assert.ok(values.every((value) => typeof value === 'string' && value.trim()), `every example has a ${field}`);
  }
});

test('the Examples page lists the built-in examples before the compiled Slidev lesson', () => {
  const page = readFileSync(new URL('../src/pages/examples.astro', import.meta.url), 'utf8');
  const list = page.indexOf('EXAMPLES.map(');
  const slidev = page.indexOf('?presentation=slidev-example');
  const grid = page.indexOf('class="example-grid"');
  assert.ok(grid > 0 && list > grid && slidev > list, 'inside the grid the list comes first, so the first card is the first example');
  assert.equal(page.slice(grid, list).includes('example-card'), false, 'no card stands before the list');
});
