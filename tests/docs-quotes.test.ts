import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatDeckReport } from '../src/lib/deck-report';
import { describePresentationLimit } from '../src/lib/presentation-runtime';

/** A documentation file with its line breaks and Markdown emphasis folded away, so a wrapped quotation reads as one line. */
function doc(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\*\*/g, '').replace(/\s+/g, ' ');
}

test('the documentation quotes the player\'s form and print sentences as the code writes them', () => {
  const readme = doc('README.md');
  const architecture = doc('docs/ARCHITECTURE.md');
  for (const code of ['form', 'print']) {
    const text = describePresentationLimit(code)?.text;
    assert.ok(text, code);
    assert.ok(readme.includes(text), `README.md quotes the ${code} sentence`);
    assert.ok(architecture.includes(text), `docs/ARCHITECTURE.md quotes the ${code} sentence`);
  }
});

test('the documentation quotes the report\'s Reveal.js rule for files and its reply for a ZIP as the code writes them', () => {
  const report = formatDeckReport({ kind: 'reveal', engine: 'reveal', entry: 'index.html', issues: [{ code: 'page-empty', severity: 'error', message: 'index.html is empty.', where: 'index.html' }] });
  const rule = 'Every other script, stylesheet, font and picture must be inside the presentation (inline in a single HTML file, pictures as data: URIs or inline SVG, or files in the ZIP beside it); nothing else may load from the internet while the presentation plays.';
  const reply = 'Reply: send back the complete corrected presentation as a ZIP with the same file names (the entry above at the top), fixing the notes above and changing nothing else.';
  assert.ok(report.includes(rule), 'the Reveal.js rules line');
  assert.ok(report.split('\n').includes(reply), 'the reply for a ZIP');
  for (const path of ['README.md', 'docs/ARCHITECTURE.md']) {
    const text = doc(path);
    assert.ok(text.includes(rule), `${path} quotes the rule`);
    assert.ok(text.includes(reply), `${path} quotes the reply`);
  }
});
