import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../src/lib/render-markdown.ts';
import {
  DEFAULT_DOCUMENT_SETTINGS, normalizeDocumentSettings, documentPageMetrics,
  prepareDocumentHtml, documentPresentationCss,
} from '../src/lib/document-presentation.ts';

test('invalid stored print settings fall back without becoming CSS or executable text', () => {
  const settings = normalizeDocumentSettings({
    style: '</style><script>bad()</script>', paper: 'A4; margin: 0', orientation: 'diagonal',
    margins: -100, fontSize: Symbol('bad'), spacing: '0', showTitle: 'false',
    author: '\n Ada\tLovelace\u0000 ', toc: 'true', breakBeforeSections: [],
  });
  assert.deepEqual(settings, { ...DEFAULT_DOCUMENT_SETTINGS, author: 'Ada Lovelace' });
  assert.deepEqual(normalizeDocumentSettings(null), DEFAULT_DOCUMENT_SETTINGS);
  assert.deepEqual(normalizeDocumentSettings(1), DEFAULT_DOCUMENT_SETTINGS);
  const css = documentPresentationCss(settings);
  assert.doesNotMatch(css, /script|diagonal|margin: 0/);
});

test('paper orientation and margins determine the available content area', () => {
  const portrait = documentPageMetrics();
  assert.equal(portrait.widthMm, 210);
  assert.equal(portrait.heightMm, 297);
  assert.equal(portrait.contentWidthMm, 174);
  const landscape = documentPageMetrics(normalizeDocumentSettings({ paper: 'letter', orientation: 'landscape', margins: 'wide' }));
  assert.equal(landscape.widthMm, 279.4);
  assert.equal(landscape.heightMm, 215.9);
  assert.equal(landscape.contentWidthMm, landscape.widthMm - 48);
  assert.equal(landscape.contentHeightMm, landscape.heightMm - 48);
});

test('a matching leading title is retained once, including its original heading ID', () => {
  const rendered = renderMarkdown('# A clear & **useful** title\n\nAn introduction.\n\n## Next steps\n\nKeep going.');
  const html = prepareDocumentHtml(rendered.html, 'A clear & useful title', normalizeDocumentSettings({ author: 'Ada' }));
  assert.equal([...html.matchAll(/<h1\b/g)].length, 1);
  assert.match(html, new RegExp(`id="${rendered.headings[0].id}"`));
  assert.match(html, /<strong>useful<\/strong>/);
  assert.match(html, /document-byline">Ada/);
  assert.match(html, /An introduction\./);
});

test('turning off an added title preserves headings and equations in the source', () => {
  const rendered = renderMarkdown('# Source heading\n\nThe equation is $E=mc^2$.');
  const html = prepareDocumentHtml(rendered.html, 'Different document title', normalizeDocumentSettings({ showTitle: false }));
  const originalHeading = rendered.html.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/)?.[0] ?? '';
  assert.ok(html.includes(originalHeading));
  assert.doesNotMatch(html, /Different document title/);
  assert.match(html, /<math/);
});

test('a leading source title takes precedence over copy filenames and retains its exact inline mathematics', () => {
  const rendered = renderMarkdown('# Energy $E=mc^2$\n\n## A derivation\n\nDetails.');
  const originalHeading = rendered.html.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/)?.[0] ?? '';
  for (const title of ['Energy (formatted)', 'Energy (copy)', 'An entirely different filename']) {
    const html = prepareDocumentHtml(rendered.html, title);
    assert.ok(html.includes(originalHeading));
    assert.equal([...html.matchAll(/<h1\b/g)].length, 1);
    assert.ok(!html.includes(title));
  }
});

test('author and contents follow the source title even when adding a missing title is disabled', () => {
  const rendered = renderMarkdown('# Source title\n\nAn introduction.\n\n## The first section\n\nDetails.');
  const html = prepareDocumentHtml(rendered.html, 'Filename', normalizeDocumentSettings({ showTitle: false, author: 'Ada', toc: true }));
  const heading = html.indexOf('id="qft-h-source-title"');
  const author = html.indexOf('class="document-byline"');
  const contents = html.indexOf('class="document-contents"');
  const introduction = html.indexOf('An introduction.');
  assert.ok(heading >= 0 && heading < author && author < contents && contents < introduction);
  assert.doesNotMatch(html, /Filename|href="#qft-h-source-title"/);
});

test('document details and contents labels cannot add executable HTML', () => {
  const rendered = renderMarkdown('## Literal <script>alert(1)</script>\n\nBody.');
  const html = prepareDocumentHtml(rendered.html, '<img src=x onerror=alert(1)>', normalizeDocumentSettings({ author: 'A </p><script>bad()</script>', toc: true }));
  assert.doesNotMatch(html, /<script\b|<img\b|<\/p><script/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
  assert.match(html, /href="#qft-h-literal-script-alert-1-script"/);
});

test('contents point to the renderer’s unique IDs and omit the leading title', () => {
  const rendered = renderMarkdown('# Title\n\n## Repeated\n\n### Detail\n\n## Repeated\n\n## 中文标题');
  const html = prepareDocumentHtml(rendered.html, 'Title', normalizeDocumentSettings({ toc: true }));
  const nav = html.match(/<nav class="document-contents"[\s\S]*?<\/nav>/)?.[0] ?? '';
  assert.doesNotMatch(nav, /href="#qft-h-title"/);
  for (const heading of rendered.headings.slice(1)) assert.ok(nav.includes(`href="#${heading.id}"`));
  assert.match(nav, /document-contents-level-1/);
  assert.match(nav, /中文标题/);
  assert.equal([...nav.matchAll(/<a /g)].length, 4);
});

test('a math heading has a concise contents label instead of duplicated KaTeX markup', () => {
  const rendered = renderMarkdown('# Title\n\n## Energy $E=mc^2$\n\nA derivation.');
  const html = prepareDocumentHtml(rendered.html, 'Title', normalizeDocumentSettings({ toc: true }));
  const nav = html.match(/<nav class="document-contents"[\s\S]*?<\/nav>/)?.[0] ?? '';
  assert.match(nav, /Energy E=mc2/);
  assert.doesNotMatch(nav, /<math|katex|application\/x-tex/);
  assert.equal([...nav.matchAll(/Energy/g)].length, 1);
  assert.ok(html.includes('<math'), 'the original rendered equation stays in the body');
});

test('documents without section headings do not receive an empty contents box', () => {
  const rendered = renderMarkdown('# Title\n\nA short note.');
  const html = prepareDocumentHtml(rendered.html, 'Title', normalizeDocumentSettings({ toc: true }));
  assert.doesNotMatch(html, /document-contents/);
});

test('all document styles honor paper choices and allow long code to continue across pages', () => {
  const styles = new Set<string>();
  for (const style of ['clean', 'study', 'academic'] as const) {
    const settings = normalizeDocumentSettings({ style, paper: 'letter', orientation: 'landscape', margins: 'compact', fontSize: '13', spacing: 'compact', breakBeforeSections: true });
    const css = documentPresentationCss(settings, '[data-pdf-preview]');
    styles.add(css);
    assert.match(css, /@page\{size:letter landscape;margin:12mm\}/);
    assert.match(css, /font-size:13pt/);
    assert.match(css, /break-before:page/);
    assert.match(css, /pre,\[data-pdf-preview\] blockquote\{break-inside:auto/);
    assert.ok(css.startsWith('[data-pdf-preview]'));
  }
  assert.equal(styles.size, 3);
});
