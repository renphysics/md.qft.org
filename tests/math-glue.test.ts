import test from 'node:test';
import assert from 'node:assert/strict';
import katex from 'katex';
import { KEEP_LIMIT, divideText, keepWithMath, leadingKeep, trailingKeep } from '../src/lib/math-glue.ts';

const typeset = (tex: string) => katex.renderToString(tex, { displayMode: false, output: 'htmlAndMathml', throwOnError: true });
const KEEP = '<span class="math-keep" style="white-space:nowrap">';
const KATEX_KEPT = '<span class="katex" style="white-space:nowrap">';
const count = (html: string, part: string) => html.split(part).length - 1;
/** A formula kept whole: its own KaTeX span does not wrap either (see math-glue.ts). */
const nowrap = (html: string) => html.replace(/^<span class="katex">/, KATEX_KEPT);

test('the text after a formula keeps its closing punctuation and attached letters', () => {
  const cases: [string, string][] = [
    [', then it does so for ever', ','],
    ['. Positive values give growth', '.'],
    [') that satisfies the relation', ')'],
    ['), which is the result', '),'],
    ['-th term of the long series', '-th'],
    ['’s values with the second', '’s'],
    ["'s values", "'s"],
    ['-decay within a few seconds', '-decay'],
    ['th power', 'th'],
    ['; it does not depend on scale', ';'],
    ['… and so on', '…'],
    ['% of the total', '%'],
    ['°C at noon', '°C'],
    ['–5 inclusive', '–5'],
    [' : une valeur', ' :'],
    ['»', '»'],
    ['，它是一个实数变量', '，'],
    ['。下一句', '。'],
    ['）的值', '）'],
    ['-фактор', '-фактор'],
    ['-ά', '-ά'],
  ];
  for (const [text, kept] of cases) assert.equal(trailingKeep(text), kept, JSON.stringify(text));
});

test('nothing is kept after a formula when a space, a Chinese character or a markup character follows it', () => {
  for (const text of [' grows at a rate', '', '\n', '是一个实数变量', '的值', ' , spaced', '*', '[', '<b>', '&amp;', '—which']) {
    assert.equal(trailingKeep(text), '', JSON.stringify(text));
  }
});

test('the text before a formula keeps its opening punctuation and attached letters or digits', () => {
  const cases: [string, string][] = [
    ['the population is doubled every time (', '('],
    ['one full turn is an angle of 2', '2'],
    ['the famous and short relation (', '('],
    ['quoted “', '“'],
    ['German „', '„'],
    ['« ', ''],
    ['« ', '« '],
    ['（', '（'],
    ['记作「', '「'],
    ['a [', '['],
    ['¿', '¿'],
  ];
  for (const [text, kept] of cases) assert.equal(leadingKeep(text), kept, JSON.stringify(text));
  for (const text of ['at a constant rate ', '', '其中我们把这个量记作', 'end.', 'x)', 'value:']) assert.equal(leadingKeep(text), '', JSON.stringify(text));
});

test('a kept run is at most 16 characters; beyond that only the punctuation stays', () => {
  assert.equal(KEEP_LIMIT, 16);
  assert.equal(trailingKeep('-abcdefghijklmno rest'), '-abcdefghijklmno', 'exactly 16 is kept');
  assert.equal(trailingKeep('-abcdefghijklmnop rest'), '-', '17 keeps only the hyphen');
  assert.equal(trailingKeep('abcdefghijklmnopqrstuvwxyz'), '');
  assert.equal(trailingKeep(')'.repeat(30)), ')'.repeat(16));
  assert.equal(leadingKeep('x (abcdefghijklmno'), '(abcdefghijklmno', 'exactly 16 is kept');
  assert.equal(leadingKeep('x (abcdefghijklmnop'), '', 'a run of 17 that ends in a letter keeps nothing');
  assert.equal(leadingKeep('x (Superlongwordindeed'), '', 'the bracket of a long word is not beside the formula');
  assert.equal(leadingKeep(`x ${'y'.repeat(20)}((`), '((', 'a long run keeps the brackets beside the formula');
  assert.equal(leadingKeep('Understandingexponential'), '');
  assert.equal(leadingKeep('('.repeat(30)), '('.repeat(16));
});

test('text between two formulas belongs first to the formula before it', () => {
  assert.deepEqual(divideText('/', true, true), { forPrevious: '/', rest: '', forNext: '' });
  assert.deepEqual(divideText(', ', true, true), { forPrevious: ',', rest: ' ', forNext: '' });
  assert.deepEqual(divideText(') and (', true, true), { forPrevious: ')', rest: ' and ', forNext: '(' });
  assert.deepEqual(divideText('-2', true, true), { forPrevious: '-2', rest: '', forNext: '' });
  assert.deepEqual(divideText(') and (', false, true), { forPrevious: '', rest: ') and ', forNext: '(' });
  assert.deepEqual(divideText(') and (', true, false), { forPrevious: ')', rest: ' and (', forNext: '' });
  assert.deepEqual(divideText(') and (', false, false), { forPrevious: '', rest: ') and (', forNext: '' });
  for (const text of ['x', '((', '))', '-th (', 'a', '', '(2', '2(']) {
    for (const before of [false, true]) for (const after of [false, true]) {
      const parts = divideText(text, before, after);
      assert.equal(parts.forPrevious + parts.rest + parts.forNext, text, 'nothing is lost or doubled');
    }
  }
});

test('a formula of one box is wrapped whole with its kept text', () => {
  const html = typeset('r');
  assert.equal(count(html, 'class="katex-base"'), 1);
  assert.equal(keepWithMath('', html, ','), `${KEEP}${nowrap(html)},</span>`);
  assert.equal(keepWithMath('(', html, ')'), `${KEEP}(${nowrap(html)})</span>`);
  assert.equal(keepWithMath('', html, ''), html, 'without kept text the formula is unchanged');
});

test('the last box goes with the text after, the first with the text before, and the MathML stays once', () => {
  const html = typeset('a+b=c');
  assert.equal(count(html, 'class="katex-base"'), 3);
  const both = keepWithMath('(', html, '),');
  assert.equal(count(both, 'class="katex-mathml"'), 1);
  assert.equal(count(both, 'class="katex-base"'), 3);
  assert.equal(count(both, KEEP), 2);
  const [, first, middle, last] = /^(<span class="math-keep"[^>]*>\(<span class="katex" style="white-space:nowrap"><span class="katex-html" aria-hidden="true"><span class="katex-base">.*?<\/span><\/span><\/span>)(<span class="katex"><span class="katex-mathml">.*)(<span class="math-keep"[^>]*><span class="katex" style="white-space:nowrap"><span class="katex-html" aria-hidden="true"><span class="katex-base">.*\),<\/span>)$/.exec(both) ?? [];
  assert.ok(first && middle && last, both);
  assert.equal(count(middle, 'class="katex-base"'), 1, 'the middle box stays with the MathML');
  // Taking the wrappers away gives the original boxes in their order.
  const boxes = (markup: string) => markup.match(/<span class="katex-base">/g)?.length ?? 0;
  assert.equal(boxes(first) + boxes(middle) + boxes(last), 3);
  const visual = (markup: string) => markup.replace(/<span class="katex-mathml">.*?<\/math><\/span>/g, '').replace(/<[^>]+>/g, '');
  assert.equal(visual(both), `(${visual(html)}),`, 'the same visible characters, in the same order');

  const after = keepWithMath('', typeset('E=mc^2'), '.');
  assert.equal(count(after, KEEP), 1);
  assert.match(after, /^<span class="katex"><span class="katex-mathml">/, 'the first box stays with the MathML');
  assert.match(after, /<\/span><\/span>\.<\/span>$/);
  const before = keepWithMath('(', typeset('E=mc^2'), '');
  assert.match(before, /^<span class="math-keep" style="white-space:nowrap">\(<span class="katex" style="white-space:nowrap"><span class="katex-html" aria-hidden="true"><span class="katex-base">/);
  assert.equal(count(before, KEEP), 1);
});

test('two boxes with kept text on both sides: each box goes with its own text', () => {
  const html = typeset('E=mc^2');
  const both = keepWithMath('(', html, ')');
  assert.equal(count(both, KEEP), 2);
  assert.equal(count(both, 'class="katex-mathml"'), 1);
  assert.match(both, /<span class="katex-html" aria-hidden="true"><\/span>/, 'the MathML part keeps an empty visual part');
});

test('kept text is escaped like the rest of the text', () => {
  const html = typeset('x');
  assert.equal(keepWithMath('<&"', html, '>\''), `${KEEP}&lt;&amp;&quot;${nowrap(html)}&gt;'</span>`);
  const long = typeset('a+b');
  const both = keepWithMath('"', long, '"&');
  assert.ok(both.startsWith(`${KEEP}&quot;${KATEX_KEPT}`));
  assert.ok(both.endsWith('&quot;&amp;</span>'));
});

test('an unexpected shape of KaTeX markup is wrapped whole; an error is left as it is, with its text beside it', () => {
  const lines = typeset('a\\\\ b');
  assert.match(lines, /katex-newline/);
  assert.equal(keepWithMath('(', lines, ')'), `${KEEP}(${nowrap(lines)})</span>`, 'a line break inside the formula');
  const mathml = katex.renderToString('a+b', { output: 'mathml' });
  assert.equal(keepWithMath('', mathml, ','), `${KEEP}${nowrap(mathml)},</span>`, 'no visual part');
  const textBetween = typeset('a+b').replace('</span><span class="katex-base">', '</span>stray<span class="katex-base">');
  assert.equal(keepWithMath('', textBetween, ','), `${KEEP}${nowrap(textBetween)},</span>`, 'text between the boxes');
  const unclosed = '<span class="katex"><span class="katex-html" aria-hidden="true"><span class="katex-base"><br>';
  assert.equal(keepWithMath('', unclosed, ','), `${KEEP}${nowrap(unclosed)},</span>`, 'markup that does not close');
  const error = '<span class="math-error" title="x">\\frac{</span>';
  assert.equal(keepWithMath('(', error, ')'), `(${error})`, 'a formula that failed keeps its text beside it, without a wrapper');
});
