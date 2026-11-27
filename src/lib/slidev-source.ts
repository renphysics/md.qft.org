/**
 * Recognising the source of a Slidev presentation (slides.md) from its text.
 *
 * Shared by the presentation check, which meets it in a ZIP of a Slidev
 * project, and by the Markdown workspace, which meets it as a lone file or as
 * pasted text. Slidev source cannot play here: it has to be built first.
 */

const HEADMATTER_KEYS = ['theme', 'addons', 'layout', 'transition', 'mdc', 'comark', 'drawings', 'fonts', 'routerMode',
  'canvasWidth', 'aspectRatio', 'highlighter', 'lineNumbers', 'colorSchema', 'titleTemplate', 'themeConfig', 'monaco',
  'twoslash', 'seoMeta', 'presenter', 'download', 'exportFilename', 'defaults', 'background', 'clicks', 'info'];
const SLIDEV_SYNTAX = [/<v-clicks?\b/i, /\bv-click\b/, /\bv-motion\b/, /\bv-mark\b/, /\bv-drag\b/, /^::\s*[\w-]{1,40}\s*::\s*$/m,
  /```[\w-]{0,40}\s*\{monaco[\w-]{0,20}\}/, /^<<<\s+\S/m, /\$slidev\b/, /````md\s+magic-move/, /^src:\s*\S{1,200}\.md\s*$/m,
  /<(?:Toc|Tweet|Youtube|SlidevVideo|Arrow|AutoFitText|LightOrDark|RenderWhen|Transform|VDragArrow|PoweredBySlidev|SlideCurrentNo|SlidesTotal)\b/];

/** The document's own front matter: the first block between `---` lines. */
const HEAD_FRONTMATTER = /^﻿?---\r?\n([\s\S]{0,20000}?)\r?\n---/;

export function slidevMarkdownScore(text: string, path: string): { score: number; title?: string } {
  const head = HEAD_FRONTMATTER.exec(text)?.[1] ?? '';
  if (/^marp:\s*true/m.test(head)) return { score: -10 };
  const keys = HEADMATTER_KEYS.filter((key) => new RegExp(`^${key}:`, 'm').test(head)).length;
  const syntax = SLIDEV_SYNTAX.filter((pattern) => pattern.test(text)).length;
  const title = /^title:\s*["']?(.{1,200}?)["']?\s*$/m.exec(head)?.[1] ?? /^#\s+(.{1,200})$/m.exec(text)?.[1];
  return { score: keys + 2 * syntax + (/(?:^|\/)slides\.md$/i.test(path) ? 1 : 0), title };
}

/** From this score, Markdown without a Slidev package.json counts as Slidev source. */
export const SLIDEV_SOURCE_SCORE = 4;

/**
 * A slide's own front matter between two `---` lines, as Slidev writes it
 * (`---`, `layout: two-cols`, `---`). The Markdown slides of this site would
 * show it as a heading.
 */
const SLIDE_FRONTMATTER = /^---[ \t]*\r?\n(?:layout|class|transition|clicks|background|level|hideInToc|zoom|dragPos|routeAlias|src)[ \t]*:[^\n]*\r?\n(?:[\w-]+[ \t]*:[^\n]*\r?\n){0,12}---[ \t]*$/m;

/**
 * A line that is only a component tag in Vue's spelling, such as
 * `<Counter :start="1" />`. HTML tags are not written this way. The name is
 * one bounded run: two runs that can share the same letters took time with
 * the square of a long line (closing check Y2.1).
 */
const COMPONENT_LINE = /^[ \t]*<[A-Z][a-z0-9][A-Za-z0-9]{0,80}(?:\s[^<>\n]{0,300})?\/?>[ \t]*$/m;

/**
 * The text with the lines inside fenced code blocks emptied (the fence lines
 * stay, because Slidev writes some of its syntax on them). A lesson that only
 * shows Slidev syntax as an example is then not taken for Slidev source.
 */
function withoutFencedCode(text: string): string {
  let fence = '';
  return text.split('\n').map((line) => {
    const mark = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (!fence) { if (mark) fence = mark; return line; }
    if (mark && mark[0] === fence[0] && mark.length >= fence.length && !line.trim().slice(mark.length).trim()) { fence = ''; return line; }
    return '';
  }).join('\n');
}

/**
 * Whether a Markdown document that stands alone (a lone file, or the text in
 * the editor) is Slidev source. The file name does not count, so that the same
 * text gets the same answer when it is opened and when it is checked.
 */
export function looksLikeSlidevSource(text: string): boolean {
  if (typeof text !== 'string' || !text) return false;
  const outside = withoutFencedCode(text);
  const result = slidevMarkdownScore(outside, '');
  // The document's own front matter is counted by its keys above; only a
  // later slide's block counts here (a blog post also begins "layout: post").
  const slides = outside.replace(HEAD_FRONTMATTER, '');
  return result.score + (SLIDE_FRONTMATTER.test(slides) ? 2 : 0) + (COMPONENT_LINE.test(slides) ? 2 : 0) >= SLIDEV_SOURCE_SCORE;
}

/** Said when such a document is opened in the Markdown workspace. */
export const SLIDEV_SOURCE_OPENED_TEXT = 'Opened as a Markdown document. This looks like the source of a Slidev presentation, so its layouts and components show as text here. To play it as slides, run "npx slidev build" in its project and open a ZIP of the project (with dist/ inside), or ask your AI assistant for the built presentation.';

/** The same finding as a line of Check lesson. */
export const SLIDEV_SOURCE_CHECK_TEXT = 'This looks like the source of a Slidev presentation. As a Markdown lesson, its layouts, click steps and components show as text. To play it as Slidev slides, run "npx slidev build" in its project and open a ZIP of the project (with dist/ inside), or ask your AI assistant for the built presentation.';
