import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, MAX_SOURCE_LENGTH } from '../src/lib/render-markdown.ts';
import { EXAMPLES } from '../src/lib/examples.ts';

test('all four mathematical delimiters render, including Markdown containers', () => {
  const input = String.raw`Inline $x^2$ and \(y^2\).

$$z^2$$

\[a^2\]

- An item with $b^2$.

> A quote with \(c^2\).

| Value |
| --- |
| $d^2$ |`;
  const result = renderMarkdown(input);
  assert.deepEqual(result.errors, []);
  assert.equal(result.mathCount, 7);
  assert.match(result.html, /<math/);
  assert.match(result.html, /<table/);
});

test('inline code, fenced code, and escaped dollars stay literal', () => {
  const input = 'Use `$x$` and `\\(y\\)` and \\$5.\n\n```math\n$$z$$\n```';
  const result = renderMarkdown(input);
  assert.equal(result.mathCount, 0);
  assert.match(result.html, /<code>\$x\$<\/code>/);
  assert.match(result.html, /\$\$z\$\$/);
  assert.match(result.html, /\$5/);
});

test('a malformed equation does not break valid following content', () => {
  const result = renderMarkdown('# A note\n\n$\\frac{1}{$\n\nA good formula: $x+1$.');
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].line, 3);
  assert.match(result.html, /A good formula/);
  assert.equal(result.mathCount, 2);
  assert.match(result.html, /math-error/);
  assert.match(result.html, /class="katex"/);
});

test('formula diagnostics follow table rows and multiline inline code', () => {
  const table = renderMarkdown('# A note\n\n| Value |\n| --- |\n| $\\unknown$ |');
  assert.equal(table.errors[0].line, 5);
  const code = renderMarkdown('# A note\n\n`multi\nline` $\\unknown$');
  assert.equal(code.errors[0].line, 4);
  const paragraph = renderMarkdown('First line.\nSecond line with $\\unknown$.');
  assert.equal(paragraph.errors[0].line, 2);
});

test('raw HTML and script-bearing links cannot become executable markup', () => {
  const result = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[bad](javascript:alert%281%29)');
  assert.doesNotMatch(result.html, /<script|<img|href="javascript:/i);
  assert.match(result.html, /&lt;script&gt;/);
});

test('error messages and formula source remain escaped', () => {
  const result = renderMarkdown(String.raw`$\unknown{<img src=x onerror=alert(1)>}$`);
  assert.equal(result.errors.length, 1);
  assert.doesNotMatch(result.html, /<img/);
  assert.match(result.html, /&lt;img/);
});

test('math cannot introduce links, external images, or arbitrary HTML IDs', () => {
  const result = renderMarkdown(String.raw`$\href{javascript:alert(1)}{x}$ $\includegraphics{https://example.org/pixel.png}$ $\htmlId{constructor}{x}$`);
  assert.doesNotMatch(result.html, /<a\b|<img\b|id="constructor"/);
  assert.equal(result.mathCount, 3);
});

test('remote images require an explicit option; local raster data is allowed', () => {
  const source = '![Remote](https://example.org/a.png)\n\n![Embedded](data:image/png;base64,aGVsbG8=)';
  const local = renderMarkdown(source);
  assert.match(local.html, /Remote image/);
  assert.doesNotMatch(local.html, /<img src="https:/);
  assert.match(local.html, /<img src="data:image\/png/);
  const remote = renderMarkdown(source, { allowRemoteImages: true });
  assert.match(remote.html, /<img src="https:\/\/example.org\/a.png/);
  assert.match(remote.html, /referrerpolicy="no-referrer"/);
});

test('SVG images and relative files remain placeholders', () => {
  const result = renderMarkdown('![Local](figures/plot.png)\n\n![SVG](data:image/svg+xml;base64,aGVsbG8=)');
  assert.doesNotMatch(result.html, /<img/);
});

test('macros work within a document and cannot leak into another render', () => {
  const first = renderMarkdown(String.raw`$\gdef\qfttest{\mathbb{R}}$ Then $\qfttest$.`);
  assert.deepEqual(first.errors, []);
  const second = renderMarkdown(String.raw`$\qfttest$`);
  assert.equal(second.errors.length, 1);
});

test('recursive macros are bounded and report an issue', () => {
  const result = renderMarkdown(String.raw`$\def\loop{\loop}\loop$`);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].message, /expan|infinite/i);
});

test('headings have deterministic namespaced IDs and internal links resolve', () => {
  const result = renderMarkdown('# Introduction\n\n[Read](#introduction)\n\n## Introduction\n\n## 中文标题');
  assert.deepEqual(result.headings.map((heading) => heading.id), ['qft-h-introduction', 'qft-h-introduction-2', 'qft-h-中文标题']);
  assert.match(result.html, /href="#qft-h-introduction"/);
  assert.equal(result.headings[1].line, 5);
});

test('literal suffixes and duplicate headings cannot create duplicate IDs', () => {
  const result = renderMarkdown('# Part\n\n# Part\n\n# Part 2\n\n# Part');
  const ids = result.headings.map((heading) => heading.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids, ['qft-h-part', 'qft-h-part-2', 'qft-h-part-2-2', 'qft-h-part-3']);
});

test('source block anchors follow lines without rewriting source', () => {
  const source = '# Heading\n\nA paragraph.\n\n$$x^2$$';
  const original = source;
  const result = renderMarkdown(source);
  assert.match(result.html, /data-source-line="0"/);
  assert.match(result.html, /data-source-line="2"/);
  assert.match(result.html, /data-source-line="4"/);
  assert.equal(source, original);
});

test('footnotes and disabled task lists are available', () => {
  const result = renderMarkdown('A note.[^n]\n\n- [x] Done\n- [ ] Next\n\n[^n]: An explanation.');
  assert.match(result.html, /footnote/);
  assert.match(result.html, /id="footnote-qft-1"/);
  assert.match(result.html, /href="#footnote-qft-1"/);
  assert.match(result.html, /type="checkbox"/);
  assert.match(result.html, /disabled/);
});

test('oversized sources return a clear error rather than partial rendering', () => {
  const result = renderMarkdown('a'.repeat(MAX_SOURCE_LENGTH + 1));
  assert.equal(result.html, '');
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].message, /400,000/);
});

test('the included examples render their mathematics and teaching demos without errors', () => {
  for (const example of EXAMPLES) {
    const result = renderMarkdown(example.source);
    assert.deepEqual(result.errors, [], example.title);
    assert.ok(result.headings.length >= 3, example.title);
    if (example.id === 'interactive-physics') {
      const demos = [...result.html.matchAll(/data-demo-preset="([^"]+)"/g)].map(match => match[1]);
      assert.deepEqual(demos, ['wave-packet', 'bloch-sphere', 'effective-potential', 'interference']);
      assert.equal((result.html.match(/class="qft-demo"/g) ?? []).length, 4);
    } else {
      assert.ok(result.mathCount >= 3, example.title);
    }
  }
  const guide = renderMarkdown(EXAMPLES.find((example) => example.id === 'quickstart')!.source);
  assert.match(guide.html, /<code>\$x\$<\/code>/);
});

test('the quantum notation table preserves the complete ket in two columns', () => {
  const result = renderMarkdown(EXAMPLES.find((example) => example.id === 'quantum')!.source);
  const rows = [...result.html.matchAll(/<tr>\s*([\s\S]*?)<\/tr>/g)];
  const row = rows.find((match) => match[1].includes('State vector'))?.[1] ?? '';
  const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)];
  assert.equal(cells.length, 2);
  assert.match(cells[0][1], /<mi>ψ<\/mi>/);
  assert.match(cells[0][1], /\\lvert\\psi\\rangle<\/annotation>/);
  assert.equal(cells[1][1], 'State vector');
});
