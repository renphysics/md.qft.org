import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, renderMarkdownSlides, type MarkdownResult, type SlidesMarkdownResult } from '../src/lib/render-markdown.ts';
import { EXAMPLES } from '../src/lib/examples.ts';
import { DEFAULT_DOCUMENT_SETTINGS, prepareDocumentHtml } from '../src/lib/document-presentation.ts';

// Sources where text touches a formula in the ways people write it, and in
// the ways the renderer must leave alone (emphasis, links, footnotes, code).
const TRICKY = [
  "If a quantity $N(t)$ grows at a constant proportional rate $r$, then",
  "Lists: $a$, $b$ and $a$/$b$ and ($x$) and ($E=mc^2$). Also $a$-$b$-$c$ and $a$$b$.",
  "The $n$-th term, $f$’s values, 2$\\pi$ radians, a $\\beta$-decay, $x$th power, 20 $^\\circ$C.",
  "其中我们把这个量记作$x$，它是一个实数变量$y$是另一个（$z$）。",
  "<b>$x$</b> &amp; \"$y$\" '$z$' and <$w$> and &$v$&",
  "*$x$*, [$y$](#a), $z$[^1] and **($q$)**.\n\n[^1]: A note with $w$.",
  "A failure $\\frac{1}{$, then ($x$ and ($\\frac{$).",
  "# Heading with $x$, and ($y$)\n\nText $z$.\n\n## Second ($a+b$)'s",
  "Escaped a\\$5 $x$, and \\($y$\\) and \\(z\\), done.",
  "Long (a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+b$), done. ($a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+b$), done.",
  "| $x$, | ($y$) |\n|---|---|\n| $z$. | w |",
  "Line $x$\n, newline and (\n$y$) here.",
  "Word$x$word and Superlongwordwithoutend$y$Anotherverylongwordhere.",
  "Une valeur $x$ : nombre, « $y$ », et $z$ !",
  "- item ($x$),\n- [ ] task $y$.\n\n> quote $z$!\n\n```\ncode $x$, here\n```\n\nand `$y$`, inline.",
  "$$x = 1$$\n\nDisplay then $y$; and \\[z\\], end.",
  "Lines in a formula ($a \\\\ b$), and ($\\text{a, b}$).",
  "# S\n\n$x$, y\n\n---\n\n($z$) and $\\frac{a}{b}$.",
];
const SOURCES = [...EXAMPLES.map((example) => example.source), ...TRICKY];
const KEEP = '<span class="math-keep" style="white-space:nowrap">';

/**
 * The rendered HTML with every formula replaced by one mark and the keeping
 * spans taken away: what a reader sees outside the formulas, with its markup.
 */
function outsideFormulas(html: string): string {
  let out = '';
  let skipping = 0;
  const open: boolean[] = [];
  for (const part of html.match(/<[^>]*>|[^<]+/g) ?? []) {
    const closing = part.startsWith('</');
    const tag = part.startsWith('<');
    const voidTag = tag && (/\/>$/.test(part) || /^<(?:br|img|hr|input|wbr|path|line)\b/i.test(part));
    if (skipping) {
      if (closing) skipping -= 1;
      else if (tag && !voidTag) skipping += 1;
      continue;
    }
    if (part === '<span class="katex">') {
      skipping = 1;
      if (!out.endsWith('\u0000')) out += '\u0000';
      continue;
    }
    if (part === KEEP) { open.push(true); continue; }
    if (closing && part === '</span>' && open.length && open[open.length - 1]) { open.pop(); continue; }
    if (tag && !closing && !voidTag && /^<span\b/.test(part)) open.push(false);
    else if (closing && part === '</span>') open.pop();
    out += part;
  }
  return out;
}

/** Each formula's boxes and MathML, in the order of the document. */
function formulaParts(html: string) {
  return {
    boxes: html.match(/<span class="katex-base">/g)?.length ?? 0,
    mathml: [...html.matchAll(/<span class="katex-mathml">([\s\S]*?)<\/math><\/span>/g)].map((match) => match[1]),
    visual: [...html.matchAll(/<span class="katex-html" aria-hidden="true">/g)].length,
  };
}

const facts = ({ errors, headings, words, mathCount }: MarkdownResult) => ({ errors, headings, words, mathCount });

test('the first example keeps the comma after r with the formula', () => {
  const html = renderMarkdown('If a quantity $N(t)$ grows at a constant proportional rate $r$, then').html;
  assert.match(html, /<span class="math-keep" style="white-space:nowrap"><span class="katex">.*?<\/span>,<\/span> then<\/p>/);
  assert.doesNotMatch(html, /<\/span>, then/, 'the comma is not left as ordinary text after the formula');
  const study = renderMarkdown(EXAMPLES.find((example) => example.id === 'study-notes')!.source).html;
  assert.match(study, /rate <span class="math-keep" style="white-space:nowrap"><span class="katex">(?:(?!<\/p>).)*?<\/span>,<\/span> then<\/p>/);
});

test('an opening bracket stays with the formula after it, and a closing one with the formula before it', () => {
  const html = renderMarkdown('every time ($T$ hours) or ($E=mc^2$).').html;
  assert.match(html, /every time <span class="math-keep" style="white-space:nowrap">\(<span class="katex">/);
  assert.match(html, /<\/span>\)\.<\/span><\/p>/);
  assert.equal((html.match(/class="math-keep"/g) ?? []).length, 3, 'one span for T, two for the formula of two boxes');
});

test('for every example and tricky source, the text outside the formulas is exactly what it was', () => {
  for (const [index, source] of SOURCES.entries()) {
    for (const render of [renderMarkdown, renderMarkdownSlides]) {
      const kept = render(source);
      const plain = render(source, { keepTextWithMath: false });
      const label = `${render.name} of source ${index + 1}`;
      assert.equal(outsideFormulas(kept.html), outsideFormulas(plain.html), label);
      assert.deepEqual(formulaParts(kept.html).mathml, formulaParts(plain.html).mathml, `${label}: the MathML of each formula, once and in order`);
      assert.equal(formulaParts(kept.html).boxes, formulaParts(plain.html).boxes, `${label}: every box is still there`);
      assert.deepEqual(facts(kept), facts(plain), `${label}: headings, words, formulas and errors`);
      const failed = (kept.html.match(/class="math-error/g) ?? []).length;
      assert.equal(formulaParts(kept.html).mathml.length + failed, kept.mathCount, `${label}: one MathML part per formula`);
      const spans = (result: MarkdownResult) => 'slides' in result ? (result as SlidesMarkdownResult).slides.map((slide) => [slide.startLine, slide.endLine]) : [];
      assert.deepEqual(spans(kept), spans(plain), `${label}: the lines of each slide`);
    }
  }
});

test('the examples do have kept text, so the comparison above is not empty', () => {
  const total = SOURCES.reduce((sum, source) => sum + (renderMarkdown(source).html.match(/class="math-keep"/g) ?? []).length, 0);
  assert.ok(total > 50, `${total} kept runs`);
});

test('a source with no text beside its formulas renders byte for byte as before', () => {
  const source = '# Title $x$\n\nA formula $a+b$ in a sentence and $c$ here.\n\n$$\\int_0^1 f$$\n\n- $x$\n- *$y$*\n\n[link $z$](#title)';
  for (const render of [renderMarkdown, renderMarkdownSlides]) {
    const kept = render(source);
    assert.doesNotMatch(kept.html, /math-keep/);
    assert.deepEqual(kept, render(source, { keepTextWithMath: false }));
  }
});

test('text beside a formula that failed stays beside it, once', () => {
  const html = renderMarkdown('A failure ($\\frac{1}{$), then.').html;
  assert.match(html, /A failure \(<span class="math-error" title="[^"]*">\\frac\{1\}\{<\/span>\), then\./);
  assert.doesNotMatch(html, /math-keep/);
});

test('text that is not plain text beside a formula is left as it was', () => {
  const html = renderMarkdown('*($x$)*, [$y$](#a), $z$[^1] and `($w$)`.\n\n[^1]: Note.').html;
  assert.match(html, /<em><span class="math-keep"[^>]*>\(<span class="katex">/, 'inside the emphasis, the brackets are plain text');
  assert.match(html, /<\/em>, <a href="#a"><span class="katex">/, 'the comma after the emphasis is not kept');
  assert.match(html, /<\/span><\/a>, /, 'nor the comma after the link');
  assert.match(html, /<code>\(\$w\$\)<\/code>/);
});

test('kept text is escaped exactly like ordinary text', () => {
  const html = renderMarkdown('"$y$" and <$w$>&').html;
  assert.match(html, /<span class="math-keep" style="white-space:nowrap">&quot;<span class="katex">/);
  assert.match(html, /<\/span>&quot;<\/span> and &lt;<span class="katex">/, 'the angle bracket is not kept, and is escaped all the same');
  assert.match(html, /<\/span>&gt;&amp;<\/p>/);
});

test('the table of contents of an exported document reads the same heading text', () => {
  const source = '# Title ($x$), done\n\n## Growth of ($a+b$)’s size\n\n## The $n$-th term\n\nText.';
  const contents = (html: string) => /<nav class="document-contents"[\s\S]*?<\/nav>/.exec(prepareDocumentHtml(html, 'T', { ...DEFAULT_DOCUMENT_SETTINGS, toc: true }))?.[0];
  const kept = contents(renderMarkdown(source).html);
  assert.ok(kept?.includes('Growth of (a+b)’s size'), kept);
  assert.equal(kept, contents(renderMarkdown(source, { keepTextWithMath: false }).html));
});
