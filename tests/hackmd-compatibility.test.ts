import test from 'node:test';
import assert from 'node:assert/strict';
import MarkdownIt from 'markdown-it';
import katex from 'katex';
import { prepareHackmd } from '../src/lib/hackmd-format.ts';

/*
 * Independent compatibility checks for the parsing failure in the user's
 * HackMD screenshot. The original markup becomes a Setext heading before a
 * later inline math pass can see its complete delimiters.
 *
 * HackMD's public VSCode extension lists markdown-it-mathjax, whose rules run
 * in the inline pass:
 * https://github.com/hackmdio/vscode-hackmd/blob/master/package.json
 * https://github.com/classeur/markdown-it-mathjax/blob/master/markdown-it-mathjax.js
 *
 * These tests deliberately use an ordinary Markdown block pass plus KaTeX
 * semantic checks. They are not a replica or a live test of hackmd.io, and do
 * not claim that KaTeX accepts every MathJax extension.
 */
const markdown = new MarkdownIt({ html: false, linkify: false, typographer: false });
const metric = String.raw`ds_{\mathrm{ind}}^2
=
-\sin^2\theta_0\,dt^2
+4L^2\sin^2\theta_0\,d\Omega_5^2.`;
const susceptibility = String.raw`\left.
\frac{\partial\mu}{\partial Q_c}
\right|_{U,\mu=1}
=
\frac{4Gb(b^2+2)}
{(b^2+1)(3b^4+4b^2+2)}
>0.`;

function tokens(source: string) {
  return markdown.parse(source, {});
}

/** Only paired delimiters within the same block reach a later inline math pass. */
function displayMathAfterBlockParsing(source: string): string[] {
  return tokens(source).filter((token) => token.type === 'inline').flatMap((token) => {
    // The controlled fixtures below have no escaped dollar signs inside TeX.
    return [...token.content.matchAll(/\$\$([\s\S]*?)\$\$/g)].map((match) => match[1]);
  });
}

/** Compare the rendered math tree, excluding the annotation of its source text. */
function renderedMath(tex: string): string {
  return katex.renderToString(tex, {
    displayMode: true,
    output: 'mathml',
    throwOnError: true,
    strict: 'error',
    trust: false,
  }).replace(/<annotation\b[^>]*>[\s\S]*?<\/annotation>/g, '');
}

function assertOneIntactDisplay(source: string, originalTex: string): void {
  assert.equal(tokens(source).filter((token) => token.type === 'heading_open').length, 0);
  assert.equal(tokens(source).filter((token) => token.type === 'blockquote_open').length, 0);
  const equations = displayMathAfterBlockParsing(source);
  assert.equal(equations.length, 1, 'The complete equation must remain in one Markdown block.');
  assert.equal(renderedMath(equations[0]), renderedMath(originalTex));
}

test('the reported original dollar equation really collides with Setext heading parsing', () => {
  const source = '$$\n' + metric + '\n$$';
  const parsed = tokens(source);
  assert.equal(parsed.filter((token) => token.type === 'heading_open').length, 1);
  const heading = parsed.findIndex((token) => token.type === 'heading_open');
  assert.equal(parsed[heading].tag, 'h1');
  assert.equal(parsed[heading + 1].content, '$$\n' + String.raw`ds_{\mathrm{ind}}^2`);
  assert.equal(displayMathAfterBlockParsing(source).length, 0);
});

for (const [name, open, close] of [
  ['the original backslash equation', String.raw`\[`, String.raw`\]`],
  ['the dollar equation from the screenshot', '$$', '$$'],
] as const) {
  test('HackMD output preserves the metric and avoids heading parsing for ' + name, () => {
    const source = open + '\n' + metric + '\n' + close;
    const result = prepareHackmd(source);
    assert.notEqual(result.source, source);
    assert.deepEqual(result.issues, []);
    assertOneIntactDisplay(result.source, metric);
  });
}

test('converted mathematics does not consume neighboring paragraphs or real headings', () => {
  const source = '# Geometry\n\nBefore the metric.\n\n'
    + String.raw`\[` + '\n' + metric + '\n' + String.raw`\]`
    + '\n\n## Interpretation\n\nThe sphere has radius ' + String.raw`\(2L\sin\theta_0\)` + '.';
  const result = prepareHackmd(source);
  const parsed = tokens(result.source);
  assert.deepEqual(parsed.filter((token) => token.type === 'heading_open').map((token) => token.tag), ['h1', 'h2']);
  assert.ok(parsed.some((token) => token.type === 'inline' && token.content === 'Before the metric.'));
  assert.match(result.source, /The sphere has radius \$2L\\sin\\theta_0\$\./);
  const equations = displayMathAfterBlockParsing(result.source);
  assert.equal(equations.length, 1);
  assert.equal(renderedMath(equations[0]), renderedMath(metric));
});

test('fenced and inline examples remain literal while the actual neighboring equation converts', () => {
  const example = '$$\n' + metric + '\n$$';
  const source = 'Literal delimiters: ' + '\x60' + String.raw`\[x=1\]` + '\x60'
    + '.\n\n\x60\x60\x60markdown\n' + example + '\n\x60\x60\x60\n\n' + example;
  const result = prepareHackmd(source);
  const parsed = tokens(result.source);
  assert.equal(parsed.find((token) => token.type === 'fence')?.content, example + '\n');
  const codeSpans = parsed.flatMap((token) => token.children ?? []).filter((token) => token.type === 'code_inline');
  assert.deepEqual(codeSpans.map((token) => token.content), [String.raw`\[x=1\]`]);
  assertOneIntactDisplay(result.source, metric);
});

test('aligned equations keep mathematical row breaks and alignment after conversion', () => {
  const tex = String.raw`\begin{aligned}
E &= mc^2 \\
p^2c^2 &= E^2 - m^2c^4
\end{aligned}`;
  const result = prepareHackmd(String.raw`\[` + '\n' + tex + '\n' + String.raw`\]`);
  assert.deepEqual(result.issues, []);
  assertOneIntactDisplay(result.source, tex);
  const equations = displayMathAfterBlockParsing(result.source);
  assert.equal((renderedMath(equations[0]).match(/<mtr>/g) ?? []).length, 2);
});

test('matrix rows and row-spacing commands preserve their rendered mathematical structure', () => {
  const tex = String.raw`\begin{pmatrix}
1 & 0 \\[4pt]
0 & -1
\end{pmatrix}`;
  const result = prepareHackmd(String.raw`\[` + '\n' + tex + '\n' + String.raw`\]`);
  assert.deepEqual(result.issues, []);
  assertOneIntactDisplay(result.source, tex);
  assert.match(result.source, /\\\\\[4pt\]/);
});

test('the successfully escaped bracket workaround remains byte-for-byte intact', () => {
  const escapedMetric = metric.replace('\n=\n', '\n' + String.raw`\\=` + '\n');
  const source = String.raw`\\[` + '\n' + escapedMetric + '\n' + String.raw`\\]`;
  const result = prepareHackmd(source);
  assert.equal(result.source, source);
  assert.equal(tokens(result.source).filter((token) => token.type === 'heading_open').length, 0);
});

test('the successfully escaped dollar workaround is not rewritten into the reported failure', () => {
  const source = '$$\n' + metric.replace('\n=\n', '\n' + String.raw`\\=` + '\n') + '\n$$';
  const result = prepareHackmd(source);
  assert.equal(result.source, source);
  assert.equal(tokens(result.source).filter((token) => token.type === 'heading_open').length, 0);
  assert.equal(displayMathAfterBlockParsing(result.source).length, 1);
});

test('comment-sensitive equations keep the equals sign outside the TeX comment', () => {
  const tex = String.raw`x % This comment must not absorb the equals sign.
=
y+1`;
  const source = '$$\n' + tex + '\n$$';
  const result = prepareHackmd(source);
  const equations = displayMathAfterBlockParsing(result.source);
  if (equations.length === 1) {
    assert.equal(renderedMath(equations[0]), renderedMath(tex));
  } else {
    assert.ok(result.issues.length > 0, 'An unresolved block conflict must be reported.');
    assert.equal(result.source, source, 'An unsafe repair must preserve the source for review.');
  }
  assert.doesNotMatch(result.source, /%[^\n]* =/);
});

test('running the converter again preserves an already compatible metric and its math tree', () => {
  const original = String.raw`\[` + '\n' + metric + '\n' + String.raw`\]`;
  const first = prepareHackmd(original);
  const second = prepareHackmd(first.source);
  assert.equal(second.source, first.source);
  assert.equal(second.changes.length, 0);
  assert.deepEqual(second.issues, []);
  assertOneIntactDisplay(second.source, metric);
});

test('other Markdown block conflicts inside equations are reported for review', () => {
  for (const tex of ['x\n---\ny', 'x\n\ny']) {
    const source = '$$\n' + tex + '\n$$';
    assert.equal(displayMathAfterBlockParsing(source).length, 0);
    const result = prepareHackmd(source);
    assert.equal(result.source, source);
    assert.ok(result.issues.length > 0, 'Math split across Markdown blocks must not pass the compatibility checks silently.');
  }
});

test('the reported susceptibility source creates both a heading and a blockquote before math rendering', () => {
  const source = '$$\n' + susceptibility + '\n$$';
  const parsed = tokens(source);
  assert.equal(parsed.filter((token) => token.type === 'heading_open').length, 1);
  assert.equal(parsed.filter((token) => token.type === 'blockquote_open').length, 1);
  assert.equal(displayMathAfterBlockParsing(source).length, 0);
  assert.doesNotThrow(() => renderedMath(susceptibility));
});

for (const [name, open, close] of [
  ['bracket', String.raw`\[`, String.raw`\]`],
  ['dollar', '$$', '$$'],
] as const) {
  test('the exact susceptibility equation survives HackMD block parsing from ' + name + ' delimiters', () => {
    const source = open + '\n' + susceptibility + '\n' + close;
    const result = prepareHackmd(source);
    assert.notEqual(result.source, source);
    assert.deepEqual(result.issues, []);
    assertOneIntactDisplay(result.source, susceptibility);
  });
}

test('greater-than and greater-or-equal continuation lines retain their mathematical meaning', () => {
  for (const continuation of ['>0.', '> 0', '>=0', '> = 0', '  > 0', '> B']) {
    const tex = 'x\n' + continuation;
    const source = '$$\n' + tex + '\n$$';
    assert.equal(tokens(source).filter((token) => token.type === 'blockquote_open').length, 1);
    const result = prepareHackmd(source);
    assert.deepEqual(result.issues, [], continuation);
    assertOneIntactDisplay(result.source, tex);
  }
});

test('real prose blockquotes outside a converted inequality are preserved', () => {
  const before = '> The thermodynamic response is measured at fixed U.\n> Compare the two ensembles.\n\n';
  const after = '\n\n> This quoted interpretation must remain a blockquote.\n';
  const source = before + String.raw`\[` + '\n' + susceptibility + '\n' + String.raw`\]` + after;
  const result = prepareHackmd(source);
  assert.deepEqual(result.issues, []);
  assert.ok(result.source.startsWith(before));
  assert.ok(result.source.endsWith(after));
  const parsed = tokens(result.source);
  assert.equal(parsed.filter((token) => token.type === 'blockquote_open').length, 2);
  assert.equal(parsed.filter((token) => token.type === 'heading_open').length, 0);
  const equations = displayMathAfterBlockParsing(result.source);
  assert.equal(equations.length, 1);
  assert.equal(renderedMath(equations[0]), renderedMath(susceptibility));
});

test('inequality reflow does not absorb a comparison into a TeX comment or rewrite macro definitions', () => {
  for (const tex of [
    'x % Keep the comparison outside this comment.\n>0',
    'x\n>0 % The next comparison must remain outside this comment.\n>-1',
    String.raw`\def\bound{0}
x
>\bound`,
  ]) {
    const source = '$$\n' + tex + '\n$$';
    const result = prepareHackmd(source);
    assert.equal(result.source, source);
    assert.ok(result.issues.length > 0);
  }
});

test('the converted susceptibility equation is stable on a second preparation', () => {
  const source = String.raw`\[` + '\n' + susceptibility + '\n' + String.raw`\]`;
  const first = prepareHackmd(source);
  const second = prepareHackmd(first.source);
  assert.equal(second.source, first.source);
  assert.deepEqual(second.changes, []);
  assert.deepEqual(second.issues, []);
  assertOneIntactDisplay(second.source, susceptibility);
});
