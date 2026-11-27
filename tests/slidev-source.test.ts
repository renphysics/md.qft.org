import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { looksLikeSlidevSource, slidevMarkdownScore, SLIDEV_SOURCE_SCORE, SLIDEV_SOURCE_CHECK_TEXT, SLIDEV_SOURCE_OPENED_TEXT } from '../src/lib/slidev-source.ts';
import { EXAMPLES } from '../src/lib/examples.ts';

const fixture = readFileSync(new URL('./fixtures/decks/slidev-source/slides.md', import.meta.url), 'utf8');

const starter = `---
theme: seriph
background: https://cover.sli.dev
title: Welcome to Slidev
info: |
  ## Slidev Starter Template
class: text-center
drawings:
  persist: false
transition: slide-left
mdc: true
---

# Welcome to Slidev

Presentation slides for developers
`;

const minimal = `---
theme: default
title: Photosynthesis
---

# Photosynthesis

---
layout: two-cols
---

# Light reactions

<v-click>

- Water is split

</v-click>
`;

test('a lone Slidev slides.md is recognised from its own text, whatever the file is called', () => {
  assert.equal(looksLikeSlidevSource(fixture), true, 'three Slidev settings and a component line');
  assert.equal(looksLikeSlidevSource(starter), true, 'the settings of the official starter');
  assert.equal(looksLikeSlidevSource(minimal), true, 'one setting, a slide with its own layout, and a click step');
  assert.equal(looksLikeSlidevSource(`# Talk\n\n<v-clicks>\n\n- a\n\n</v-clicks>\n\n---\nlayout: center\n---\n\n# End\n`), true, 'no front matter at the top at all');
  assert.equal(looksLikeSlidevSource('\uFEFF' + starter), true, 'a byte-order mark before the front matter');
  assert.equal(looksLikeSlidevSource(starter.replace(/\n/g, '\r\n')), true, 'Windows line ends');
});

test('ordinary Markdown, a blog post, Marp slides and the examples of this site are not taken for Slidev source', () => {
  assert.equal(looksLikeSlidevSource(''), false);
  assert.equal(looksLikeSlidevSource('# Notes\n\nPlain text.\n\n---\n\n## Second slide\n\n$$E = mc^2$$\n'), false);
  assert.equal(looksLikeSlidevSource('---\nlayout: post\ntitle: Hello\ndate: 2026-01-02\ncategories: physics\n---\n\n# Hello\n\nText.\n'), false, 'a blog post');
  // Two of Slidev's keys in the document's own front matter are not a slide's block (closing check Y3.3: nothing pinned this).
  assert.equal(looksLikeSlidevSource('---\nlayout: post\ntitle: Hello\ntheme: minima\n---\n\n# Hello\n\nText.\n'), false, 'a Jekyll post with a theme');
  assert.equal(looksLikeSlidevSource('---\nmarp: true\ntheme: gaia\nclass: lead\ntransition: fade\nbackground: white\n---\n\n# Marp\n\n---\n\n<!-- _class: lead -->\n\n# End\n'), false, 'Marp says what it is');
  assert.equal(looksLikeSlidevSource('---\ntheme: default\ntitle: Waves\n---\n\n# Waves\n\n---\n\n## Second\n\nText.\n'), false, 'one setting alone is not enough');
  assert.equal(looksLikeSlidevSource('# An HTML table\n\n<DIV>\n\n<Details>\n\ntext\n'), false, 'one capitalised tag alone is not enough');
  for (const example of EXAMPLES) assert.equal(looksLikeSlidevSource(example.source), false, example.id);
});

test('Slidev syntax that a lesson only shows inside fenced code does not count', () => {
  const lesson = `# How Slidev writes slides\n\n\`\`\`md\n---\ntheme: seriph\nlayout: cover\ntransition: slide-left\nmdc: true\n---\n\n<v-click>\n\n::right::\n\n<Tweet id="20" />\n\n---\nlayout: two-cols\n---\n\`\`\`\n\nThat is all.\n`;
  assert.equal(looksLikeSlidevSource(lesson), false);
  // A longer fence closes only on a fence of the same kind that is at least as long.
  const nested = `# Example\n\n\`\`\`\`md\n\`\`\`ts {monaco}\nconst a = 1\n\`\`\`\n<v-clicks>\n\n---\nlayout: center\n---\n\`\`\`\`\n`;
  assert.equal(looksLikeSlidevSource(nested), false);
  // Syntax on the fence line itself is Slidev's own and still counts.
  assert.equal(looksLikeSlidevSource(`---\ntheme: default\ntransition: fade\n---\n\n# Code\n\n\`\`\`ts {monaco}\nconst a = 1\n\`\`\`\n`), true);
});

test('the score used for a ZIP of a Slidev project is unchanged: raw text, and one point for the name slides.md', () => {
  assert.equal(SLIDEV_SOURCE_SCORE, 4);
  assert.equal(slidevMarkdownScore(fixture, 'slides.md').score, 4);
  assert.equal(slidevMarkdownScore(fixture, 'notes.md').score, 3);
  assert.equal(slidevMarkdownScore(fixture, 'slides.md').title, 'Waves on a string');
  // One setting, and <v-click> matches both the tag and the directive pattern.
  assert.equal(slidevMarkdownScore(minimal, 'talk.md').score, 1 + 2 + 2);
  assert.ok(slidevMarkdownScore('---\nmarp: true\ntheme: gaia\n---\n', 'slides.md').score < 0);
});

test('both sentences say what the text is, what happens to it here, and what plays instead', () => {
  for (const text of [SLIDEV_SOURCE_OPENED_TEXT, SLIDEV_SOURCE_CHECK_TEXT]) {
    assert.match(text, /looks like the source of a Slidev presentation/);
    assert.match(text, /show as text/);
    assert.match(text, /run "npx slidev build" in its project and open a ZIP of the project \(with dist\/ inside\), or ask your AI assistant for the built presentation\.$/);
    assert.doesNotMatch(text, /deck/i);
  }
});

test('a component line is still told from an HTML tag', () => {
  const withLine = (line: string) => `---\ntheme: seriph\nlayout: cover\n---\n\n# Talk\n\n${line}\n`;
  for (const line of ['<Counter :start="1" />', '<Counter/>', '  <Tweet id="20">', '<A1 />', '<Ab>', `<A${'b'.repeat(81)} />`]) assert.equal(looksLikeSlidevSource(withLine(line)), true, line);
  for (const line of ['<div class="x">', '<A>', '<ABC />', '<a1 />', 'See <Counter /> here', '<Counter', `<A${'b'.repeat(82)} />`]) assert.equal(looksLikeSlidevSource(withLine(line)), false, line);
});

test('one long odd line takes time in proportion to its length (closing check Y2.1)', () => {
  // The first two took 13 s at 100,000 characters in the browser: the tab froze when such a file was opened.
  const lines = ['<A' + 'a'.repeat(390_000), '<A' + '1'.repeat(390_000), '<Ab>' + ' '.repeat(390_000) + 'x', ' '.repeat(390_000) + 'x', '<Ab ' + 'x="1" '.repeat(65_000),
    '<Ab\n'.repeat(97_000), ('<Ab ' + 'x'.repeat(299) + '\n').repeat(1300), '---\nlayout: x\n' + 'a'.repeat(390_000), '---\nlayout: x\n' + 'a-b '.repeat(97_000) + ': c'];
  for (const line of lines) {
    const started = performance.now();
    looksLikeSlidevSource(`# Notes\n\n${line}\n`);
    const elapsed = performance.now() - started;
    assert.ok(elapsed < 1000, `${line.slice(0, 20)}…: ${Math.round(elapsed)} ms`);
  }
});

test('the scan stays fast on a large awkward document', () => {
  const awkward = ('---\nlayout: x\n' + 'a: b\n'.repeat(12)).repeat(9000) + '<A'.repeat(20000) + '\n```\n'.repeat(3000);
  assert.ok(awkward.length > 390_000);
  const started = performance.now();
  looksLikeSlidevSource(awkward);
  assert.ok(performance.now() - started < 1500, `took ${Math.round(performance.now() - started)} ms`);
});
