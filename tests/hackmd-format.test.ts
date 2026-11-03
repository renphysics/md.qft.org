import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareHackmd } from '../src/lib/hackmd-format.ts';
import { DOCUMENT_TOOLS_LIMIT } from '../src/lib/document-tools.ts';

const metric = String.raw`ds_{\mathrm{ind}}^2
=
-\sin^2\theta_0\,dt^2
+4L^2\sin^2\theta_0\,d\Omega_5^2.`;

test('bracket display math uses dollar lines and repairs the exact standalone equals-sign example', () => {
  const source = '\\[\n' + metric + '\n\\]';
  const result = prepareHackmd(source);
  assert.equal(result.source, '$$\n' + metric.replace('^2\n=', '^2 =') + '\n$$');
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.changes.map(({ line }) => line), [1, 3]);
});

test('existing dollar display math gets the same equals repair without extra delimiter changes', () => {
  const result = prepareHackmd('$$\n' + metric + '\n$$');
  assert.equal(result.source, '$$\n' + metric.replace('^2\n=', '^2 =') + '\n$$');
  assert.equal(result.changes.length, 1);
  assert.equal(result.changes[0].line, 3);
  assert.deepEqual(result.issues, []);
});

test('single-line display math receives source line boundaries and retains indentation', () => {
  assert.equal(prepareHackmd(String.raw`\[x + y\]`).source, '$$\nx + y\n$$');
  assert.equal(prepareHackmd(String.raw`  \[x + y\]`).source, '  $$\nx + y\n$$');
});

test('inline bracket delimiters convert with only insignificant boundary whitespace trimmed', () => {
  const result = prepareHackmd(String.raw`Energy \( E = mc^2 \), and mass \(m\). Already $x$ and \$5.`);
  assert.equal(result.source, String.raw`Energy $E = mc^2$, and mass $m$. Already $x$ and \$5.`);
  assert.equal(result.changes.length, 2);
  assert.deepEqual(result.issues, []);
});

test('already compatible dollar syntax stays byte-for-byte unchanged', () => {
  const source = String.raw`Inline $x + y$, then:

$$
x = \frac{1}{2}
$$

$$z = 2$$`;
  assert.deepEqual(prepareHackmd(source), { source, changes: [], issues: [] });
});

test('true TeX row breaks, row spacing, alignment, and matrix environments are preserved', () => {
  const body = String.raw`\begin{aligned}
a &= b \\[4pt]
c &= d
\end{aligned}
\qquad
\begin{pmatrix}
1 & 2 \\
3 & 4
\end{pmatrix}`;
  const result = prepareHackmd('\\[\n' + body + '\n\\]');
  assert.equal(result.source, '$$\n' + body + '\n$$');
  assert.deepEqual(result.issues, []);
});

test('a TeX comment before a bare equals sign is never joined across its newline', () => {
  const source = String.raw`\[
x % explanatory comment
=
y
\]`;
  const result = prepareHackmd(source);
  assert.equal(result.source, source);
  assert.deepEqual(result.changes, []);
  assert.equal(result.issues[0].line, 3);
  assert.match(result.issues[0].message, /comment/);
});

test('ordinary comment line endings survive delimiter conversion and escaped percent is not a comment', () => {
  const source = String.raw`\[
x % retain the newline
+y
\]`;
  assert.equal(prepareHackmd(source).source, source.replace('\\[', () => '$$').replace('\\]', () => '$$'));
  const percent = String.raw`\[
50\%
=
0.5
\]`;
  assert.equal(prepareHackmd(percent).source, '$$\n50\\% =\n0.5\n$$');
});

test('equation reflow does not alter macro-definition or verbatim source', () => {
  for (const command of [String.raw`\def\foo#1{#1}`, String.raw`\newcommand{\foo}{x}`, String.raw`\verb|x|`]) {
    const source = '\\[\n' + command + '\n=\ny\n\\]';
    const result = prepareHackmd(source);
    assert.equal(result.source, source);
    assert.deepEqual(result.changes, []);
    assert.match(result.issues[0].message, /macro|verbatim/);
  }
});

test('known doubled-delimiter and escaped-equals workarounds are preserved with review notices', () => {
  const cases = [
    String.raw`\\[
x
\\=
y
\\]`,
    String.raw`$$
x
\\=
y
$$`,
    String.raw`Already working \\(x\\).`,
  ];
  for (const source of cases) {
    const result = prepareHackmd(source);
    assert.equal(result.source, source);
    assert.deepEqual(result.changes, []);
    assert.ok(result.issues.length);
    assert.match(result.issues[0].message, /preserved/i);
  }
});

test('fenced code, inline code, indented code, reference URLs, link destinations, and raw HTML stay literal', () => {
  const protectedParts = [
    '```md\n\\[x\\]\n```',
    'Use `\\(x\\)` and ``code ` \\[y\\]``.',
    '    \\[x\\]\n    =',
    String.raw`[link](https://example.org/\(x\))`,
    String.raw`[link]: https://example.org/\[x\]`,
    '<script>const value = "\\(x\\)";</script>',
    '<div>\n\\[x\\]\n</div>',
    '<span>\\(x\\)</span>',
  ].join('\n\n');
  const source = protectedParts + '\n\nReal \\(y\\).';
  const result = prepareHackmd(source);
  assert.equal(result.source, protectedParts + '\n\nReal $y$.');
  assert.equal(result.changes.length, 1);
});

test('math in Markdown link labels and image descriptions is preserved along with their source syntax', () => {
  const source = String.raw`[\(x\)](https://example.org) and ![\(y\)](https://example.org/image.png)`;
  assert.equal(prepareHackmd(source).source, source);
  assert.deepEqual(prepareHackmd(source).changes, []);
});

test('one-line list and quote inline formulas convert using exact offsets and retain prefixes', () => {
  const source = '- Energy \\(E\\).\n\n> Momentum \\(p\\).\n\n1. Mass \\(m\\).';
  const result = prepareHackmd(source);
  assert.equal(result.source, '- Energy $E$.\n\n> Momentum $p$.\n\n1. Mass $m$.');
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.changes.map(({ line }) => line), [1, 3, 5]);
});

test('multiline containers and display math in containers remain unchanged with specific issues', () => {
  const cases = [
    '> \\[\n> x\n> =\n> y\n> \\]',
    '- \\[\n  x\n  \\]',
    '> First \\(x\\),\n> then another line.',
    '| Value |\n| --- |\n| \\(x\\) |',
  ];
  for (const source of cases) {
    const result = prepareHackmd(source);
    assert.equal(result.source, source);
    assert.ok(result.issues.length);
    assert.match(result.issues[0].message, /container|list|quote/i);
  }
});

test('source edits preserve CRLF and use it for new display boundaries', () => {
  const source = '# Title\r\n\r\nInline \\( x \\).\r\n\r\n\\[y\\]\r\n';
  const result = prepareHackmd(source);
  assert.equal(result.source, '# Title\r\n\r\nInline $x$.\r\n\r\n$$\r\ny\r\n$$\r\n');
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.changes.map(({ line }) => line), [3, 5]);
});

test('unmatched and ambiguous math delimiters are preserved with source lines', () => {
  for (const source of ['# Title\n\n\\(x', '# Title\n\n\\[\nx', '# Title\n\n$$\nx', '# Title\n\n\\]']) {
    const result = prepareHackmd(source);
    assert.equal(result.source, source);
    assert.deepEqual(result.changes, []);
    assert.ok(result.issues.some(({ line }) => line === 3));
  }
  const ambiguous = String.raw`\[x\] trailing text
\[y\]`;
  const result = prepareHackmd(ambiguous);
  assert.equal(result.source, ambiguous);
  assert.match(result.issues[0].message, /ambiguous/);
});

test('unsafe inline boundary changes, comments, and literal dollars request review', () => {
  for (const source of [
    String.raw`A \(x\)2.`,
    String.raw`A word\(x\).`,
    String.raw`A \(x\ \).`,
    String.raw`A \(x % comment\).`,
    String.raw`A \(x $ y\).`,
    'A \\(x\ny\\).',
  ]) {
    const result = prepareHackmd(source);
    assert.equal(result.source, source);
    assert.deepEqual(result.changes, []);
    assert.ok(result.issues.length, source);
  }
  assert.equal(prepareHackmd(String.raw`Price \(x\$\), then \(y\).`).source, String.raw`Price $x\$$, then $y$.`);
});

test('local assets and interactive demos get compatibility notices, while literal examples do not', () => {
  const source = [
    '![Local](images/figure.png)',
    '![Stored](qft-image:abc)',
    '![Temporary](blob:https://md.qft.org/123)',
    '![Remote](https://example.org/figure.png)',
    '```interactive title="Example"\n<canvas></canvas>\n```',
    '```md\n![Literal](images/literal.png)\n```',
  ].join('\n\n');
  const result = prepareHackmd(source);
  assert.equal(result.source, source);
  assert.equal(result.issues.filter(({ message }) => /image/.test(message)).length, 4);
  assert.equal(result.issues.filter(({ message }) => /Interactive demos/.test(message)).length, 1);
  assert.ok(!result.issues.some(({ line }) => line >= 13));
});

test('additional Markdown block collisions are reported without speculative equation rewriting', () => {
  for (const body of ['x\n---\ny', 'x\n\ny', 'x\n> y']) {
    const source = '$$\n' + body + '\n$$';
    const result = prepareHackmd(source);
    assert.equal(result.source, source);
    assert.deepEqual(result.changes, []);
    assert.match(result.issues[0].message, /block boundary/);
  }
});

test('conversion is idempotent, including safe reflow and conservatively preserved cases', () => {
  const cases = [
    '\\[\n' + metric + '\n\\]',
    String.raw`Energy \( x + y \).`,
    String.raw`\[x\]`,
    String.raw`\\[x\\]`,
    '> Energy \\(E\\).',
    '$$\nx % comment\n=\ny\n$$',
  ];
  for (const source of cases) {
    const first = prepareHackmd(source);
    const second = prepareHackmd(first.source);
    assert.equal(second.source, first.source);
    assert.deepEqual(second.changes, []);
  }
});

test('oversized inputs are left intact, and many unmatched delimiters remain bounded', () => {
  const oversized = 'x'.repeat(DOCUMENT_TOOLS_LIMIT + 1);
  assert.equal(prepareHackmd(oversized).source, oversized);
  assert.match(prepareHackmd(oversized).issues[0].message, /400,000/);
  const repeated = '\\( '.repeat(12_000);
  const result = prepareHackmd(repeated);
  assert.equal(result.source, repeated);
  assert.deepEqual(result.changes, []);
  assert.ok(result.issues.length);
});
