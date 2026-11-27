import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildPlayable, openDeck } from '../src/lib/deck-project';
import { exportPresentationHtml } from '../src/lib/presentation-runtime';
import { APACHE_LICENSE_2, MARKED_LICENSE, presentationNotices, type PresentationLicenceTexts } from '../src/lib/presentation-notices';
import { nodeVendorProvider } from './helpers/deck-vendor-node';
import { htmlFixture } from './helpers/deck-fixtures';

const file = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

/** The same files presentation-notice-texts.ts imports with ?raw. */
const texts: PresentationLicenceTexts = {
  application: file('LICENSE'),
  reveal: file('node_modules/reveal.js/LICENSE'),
  highlight: file('node_modules/highlight.js/LICENSE'),
  katex: file('node_modules/katex/LICENSE'),
  sourceSansPro: file('node_modules/reveal.js/css/theme/fonts/source-sans-pro/LICENSE'),
};

const BSD3 = 'Redistributions in binary form must reproduce the above copyright notice';

async function linked(name: 'cdn-reveal5-single' | 'cdn-reveal4-cdnjs') {
  const project = await openDeck(htmlFixture(name));
  assert.ok(project);
  const playable = await buildPlayable(project, { vendor: () => nodeVendorProvider() });
  assert.ok(playable.html, 'the fixture links');
  return { project, playable };
}

/** The text of every notice in the outer page, unescaped. */
function noticeText(exported: string): string {
  const section = exported.match(/<details id="notices">([\s\S]*?)<\/details>/)?.[1];
  assert.ok(section, 'the export has a Third-party notices section');
  return section.replace(/<[^>]+>/g, '\n').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

test('the standalone copy of a deck with KaTeX, highlight.js and a theme font carries their notices', async () => {
  const { project, playable } = await linked('cdn-reveal5-single');
  const before = exportPresentationHtml(playable.html, 'Waves', { profile: playable.profile });
  assert.doesNotMatch(before, /Khan Academy/, 'without notices the copy has no KaTeX notice (the reported defect)');
  const notices = presentationNotices(playable.html, project.kind, texts);
  const exported = exportPresentationHtml(playable.html, 'Waves', { profile: playable.profile, notices });
  const text = noticeText(exported);
  assert.match(exported, /<details id="notices"><summary>Third-party notices<\/summary>/);
  assert.match(text, /Copyright \(c\) 2026 Jie Ren/, 'the application notice');
  assert.match(text, /Hakim El Hattab/, 'reveal.js');
  assert.match(text, /Khan Academy/, 'KaTeX');
  assert.match(text, /Ivan Sagalaev/, 'highlight.js copyright');
  assert.ok(text.includes(BSD3), 'the BSD 3-Clause text');
  assert.match(text, /SIL Open Font License/, 'the OFL for the embedded theme font');
  assert.match(text, /Source Sans Pro/);
  assert.doesNotMatch(text, /MarkedJS/, 'no markdown plugin in this deck');
  assert.doesNotMatch(text, /League Gothic/);
  // The notices sit in the outer page, not in the presentation the sandbox plays.
  const outer = exported.slice(0, exported.indexOf('<script nonce='));
  assert.ok(outer.includes('<details id="notices">'));
});

test('a deck with the markdown plugin and League Gothic gets the marked, Markdown and OFL notices', async () => {
  const { project, playable } = await linked('cdn-reveal4-cdnjs');
  const titles = presentationNotices(playable.html, project.kind, texts).map((notice) => notice.title);
  assert.equal(titles[0], 'QFT Markdown presentation player · MIT License');
  assert.ok(titles.some((title) => title.startsWith('reveal.js')));
  assert.ok(titles.some((title) => title.startsWith('marked and Markdown')));
  assert.ok(titles.some((title) => /League Gothic fonts · SIL Open Font License/.test(title)));
  assert.ok(!titles.some((title) => title.startsWith('KaTeX')), 'no KaTeX in this deck');
  const text = noticeText(exportPresentationHtml(playable.html, 'Deck', { notices: presentationNotices(playable.html, project.kind, texts) }));
  assert.match(text, /MarkedJS/);
  assert.match(text, /John Gruber/);
  assert.match(text, /The League of Moveable Type/);
});

test('a plain page gets only the application notice, and a Slidev build never more', () => {
  assert.deepEqual(presentationNotices('<p>Plain</p>', 'html', texts).map((notice) => notice.title), ['QFT Markdown presentation player · MIT License']);
  const looksLikeEverything = '/*! reveal.js Hakim El Hattab */ RevealHighlight RevealMarkdown .katex{} @font-face{font-family:Source Sans Pro;src:url(data:x)}';
  assert.equal(presentationNotices(looksLikeEverything, 'slidev-build', texts).length, 1);
  assert.equal(presentationNotices(looksLikeEverything, 'reveal', texts).length, 6);
  assert.ok(MARKED_LICENSE.includes('Christopher Jeffrey'));
});

test('the mhchem notice carries the whole Apache License 2.0, the same text as THIRD_PARTY_NOTICES.md', () => {
  const notices = presentationNotices('.katex{} \\ce mhchem', 'reveal', texts);
  const mhchem = notices.find((notice) => notice.title.startsWith('mhchem'));
  assert.ok(mhchem);
  assert.match(mhchem.text, /Martin Hensel/);
  assert.match(mhchem.text, /Apache License\n\nVersion 2\.0, January 2004/);
  assert.match(mhchem.text, /TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION[\s\S]*END OF TERMS AND CONDITIONS/);
  // Section 4 lists its four conditions as (a) to (d), as in the canonical text.
  assert.match(mhchem.text, /\n\(a\) You must give any other recipients[\s\S]*\n\(b\) You must cause any modified files[\s\S]*\n\(c\) You must retain, in the Source form[\s\S]*\n\(d\) If the Work includes a "NOTICE" text file/);
  assert.ok(mhchem.text.length < 64_000, 'within the bound the export puts on one notice');
  const notices3rd = file('THIRD_PARTY_NOTICES.md').split('\n');
  const start = notices3rd.indexOf('The Apache License 2.0:') + 3;
  const end = notices3rd.indexOf('END OF TERMS AND CONDITIONS', start);
  assert.equal(APACHE_LICENSE_2.trim(), notices3rd.slice(start, end + 1).map((line) => line.trimEnd()).join('\n'));
  const text = noticeText(exportPresentationHtml('<p>Deck</p>', 'Deck', { notices }));
  assert.ok(text.includes('END OF TERMS AND CONDITIONS'), 'the export keeps all of it');
});

test('notices are set as text and bounded', () => {
  const exported = exportPresentationHtml('<p>Deck</p>', 'Deck', {
    notices: [
      { title: '<img src=x onerror=alert(1)>', text: '</pre></details><script>alert(1)</script>' },
      { title: 'Long', text: 'x'.repeat(70_000) },
      { title: '', text: 'no title' },
      ...Array.from({ length: 20 }, (_, index) => ({ title: `N${index}`, text: 'text' })),
      null as never,
    ],
  });
  const section = exported.match(/<details id="notices">[\s\S]*?<\/details>/)?.[0] ?? '';
  assert.ok(section.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(section.includes('&lt;/pre&gt;&lt;/details&gt;&lt;script&gt;'));
  assert.doesNotMatch(section, /<img|<script/);
  assert.equal(section.match(/<section>/g)?.length, 16, 'at most 16 notices');
  assert.ok(!section.includes('x'.repeat(64_001)), 'each text is cut at 64 000 characters');
  assert.ok(!section.includes('no title'));
  assert.doesNotMatch(exportPresentationHtml('<p>Deck</p>', 'Deck'), /id="notices"/, 'no section without notices');
});
