import MarkdownIt, { type Token } from 'markdown-it';
import { katex as mathPlugin } from '@mdit/plugin-katex';
import { footnote } from '@mdit/plugin-footnote';

/** Keep structural tools within the same bounded size as the live preview. */
export const DOCUMENT_TOOLS_LIMIT = 400_000;

export type CleanupId = 'unwrap-fence' | 'heading-levels' | 'outer-blank-lines';
export interface CleanupSuggestion { id: CleanupId; label: string; description: string }
export interface DocumentSection { id: string; title: string; level: number; from: number; to: number }

interface SourceLine { from: number; to: number; end: number; text: string }
interface Heading { title: string; level: number; line: number; endLine: number; markup: string }

// Parse the same mathematical delimiters as the preview, without rendering
// formulas or executing source. In particular, # inside a display formula,
// fenced code, a quote, a list, or a footnote must not become a movable section.
const parser = new MarkdownIt({ html: false, linkify: false, typographer: false })
  .use(mathPlugin, { delimiters: 'all', mathFence: false, allowInlineWithSpace: false })
  .use(footnote);

function linesOf(source: string): SourceLine[] {
  const lines: SourceLine[] = [];
  const breaks = /\r\n|\r|\n/g;
  let from = 0;
  for (let match = breaks.exec(source); match; match = breaks.exec(source)) {
    lines.push({ from, to: match.index, end: breaks.lastIndex, text: source.slice(from, match.index) });
    from = breaks.lastIndex;
  }
  lines.push({ from, to: source.length, end: source.length, text: source.slice(from) });
  return lines;
}

function parse(source: string): Token[] {
  if (typeof source !== 'string' || source.length > DOCUMENT_TOOLS_LIMIT) return [];
  try { return parser.parse(source, {}); } catch { return []; }
}

function plainInline(token: Token | undefined): string {
  return (token?.children ?? []).map((child) => {
    if (['text', 'code_inline', 'math_inline', 'image'].includes(child.type)) return child.content;
    if (child.type === 'softbreak' || child.type === 'hardbreak') return ' ';
    return '';
  }).join('').replace(/\s+/g, ' ').trim();
}

function headingsOf(source: string): Heading[] {
  const tokens = parse(source);
  const headings: Heading[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== 'heading_open' || token.level !== 0 || !token.map) continue;
    headings.push({
      title: plainInline(tokens[index + 1]) || 'Untitled section',
      level: Number(token.tag.slice(1)),
      line: token.map[0],
      endLine: token.map[1],
      markup: token.markup,
    });
  }
  return headings;
}

function unwrapMarkdownFence(source: string): string {
  const tokens = parse(source);
  if (tokens.length !== 1 || tokens[0].type !== 'fence' || !tokens[0].map
    || !/^(?:md|markdown)$/i.test(tokens[0].info.trim())) return source;
  const token = tokens[0];
  const lines = linesOf(source);
  const first = token.map![0];
  const last = token.map![1] - 1;
  if (last <= first || !lines[first] || !lines[last]) return source;
  const opening = lines[first].text.match(/^ {0,3}(`{3,}|~{3,})[ \t]*(?:md|markdown)[ \t]*$/i);
  if (!opening) return source;
  const marker = opening[1][0];
  const closing = lines[last].text.trim();
  if (closing.length < opening[1].length || [...closing].some((character) => character !== marker)) return source;
  if (source.slice(0, lines[first].from).trim() || source.slice(lines[last].end).trim()) return source;
  // Slice the original source, not token.content: Markdown parsers normalize
  // line endings and indentation, which would change copied code and formulas.
  return source.slice(0, lines[first].from)
    + source.slice(lines[first].end, lines[last].from)
    + source.slice(lines[last].end);
}

function normalizeHeadingLevels(source: string): string {
  const headings = headingsOf(source);
  if (!headings.length) return source;
  const minimum = headings.reduce((minimum, heading) => Math.min(minimum, heading.level), 6);
  if (minimum <= 1) return source;
  const shift = minimum - 1;
  const lines = linesOf(source);
  const changes: { from: number; to: number; insert: string }[] = [];
  for (const heading of headings) {
    const level = heading.level - shift;
    const line = lines[heading.line];
    if (/^#+$/.test(heading.markup)) {
      const marker = line.text.match(/^( {0,3})(#{1,6})(?:[ \t]+|$)/);
      if (!marker) continue;
      changes.push({ from: line.from + marker[1].length, to: line.from + marker[1].length + marker[2].length, insert: '#'.repeat(level) });
    } else if (heading.markup === '-' && level === 1) {
      const underline = lines[heading.endLine - 1];
      if (!underline) continue;
      const marker = underline.text.match(/^( {0,3})(-+)([ \t]*)$/);
      if (!marker) continue;
      changes.push({ from: underline.from + marker[1].length, to: underline.from + marker[1].length + marker[2].length, insert: '='.repeat(marker[2].length) });
    }
  }
  let result = source;
  for (const change of changes.sort((a, b) => b.from - a.from)) {
    result = result.slice(0, change.from) + change.insert + result.slice(change.to);
  }
  return result;
}

function trimOuterBlankLines(source: string): string {
  const lines = linesOf(source);
  const first = lines.findIndex((line) => /[^ \t]/.test(line.text));
  if (first === -1) return '';
  let last = lines.length - 1;
  while (last > first && !/[^ \t]/.test(lines[last].text)) last -= 1;
  // Preserve the final content line's original newline, when it had one.
  return source.slice(lines[first].from, lines[last].end);
}

/** Suggestions describe deterministic formatting changes, never a rewrite. */
export function getCleanupSuggestions(source: string): CleanupSuggestion[] {
  if (typeof source !== 'string' || source.length > DOCUMENT_TOOLS_LIMIT) return [];
  const suggestions: CleanupSuggestion[] = [];
  let candidate = source;
  const unwrapped = unwrapMarkdownFence(candidate);
  if (unwrapped !== candidate) {
    suggestions.push({ id: 'unwrap-fence', label: 'Remove the outer Markdown wrapper', description: 'Remove one enclosing md or markdown code fence. Keep the content, inner code blocks, and original line endings.' });
    candidate = unwrapped;
  }
  const normalized = normalizeHeadingLevels(candidate);
  if (normalized !== candidate) {
    suggestions.push({ id: 'heading-levels', label: 'Start headings at level one', description: 'Raise the document headings together, keeping their relative hierarchy. Headings inside quotes, code, mathematics, lists, and footnotes stay unchanged.' });
    candidate = normalized;
  }
  if (trimOuterBlankLines(candidate) !== candidate) {
    suggestions.push({ id: 'outer-blank-lines', label: 'Trim outer blank lines', description: 'Remove empty lines before and after the document. Preserve spacing within paragraphs, code, and equations.' });
  }
  return suggestions;
}

/** Applying an empty or unknown selection leaves the original source intact. */
export function applyCleanup(source: string, selectedIds: readonly string[]): string {
  if (typeof source !== 'string' || source.length > DOCUMENT_TOOLS_LIMIT) return source;
  const selected = new Set(selectedIds);
  let result = source;
  if (selected.has('unwrap-fence')) result = unwrapMarkdownFence(result);
  if (selected.has('heading-levels')) result = normalizeHeadingLevels(result);
  if (selected.has('outer-blank-lines')) result = trimOuterBlankLines(result);
  return result;
}

/**
 * Return complete peer sections. A unique first heading above every other
 * heading is treated as the document title and kept with the preamble.
 * Offsets refer to this exact source; refresh this list after an edit.
 */
export function getDocumentSections(source: string): DocumentSection[] {
  const headings = headingsOf(source);
  if (!headings.length) return [];
  const minimum = headings.reduce((minimum, heading) => Math.min(minimum, heading.level), 6);
  const first = headings[0];
  const hasTitle = headings.length > 1 && first.level === minimum
    && headings.filter((heading) => heading.level === minimum).length === 1;
  const candidates = hasTitle ? headings.slice(1) : headings;
  if (!candidates.length) return [];
  const level = candidates.reduce((minimum, heading) => Math.min(minimum, heading.level), 6);
  const peers = candidates.filter((heading) => heading.level === level);
  const lines = linesOf(source);
  return peers.map((heading, index) => {
    const from = lines[heading.line].from;
    const next = peers[index + 1];
    return { id: `section-${from}`, title: heading.title, level: heading.level, from, to: next ? lines[next.line].from : source.length };
  });
}

function splitSeparator(block: string): { body: string; separator: string } {
  const tail = block.match(/((?:(?:\r\n|\r|\n)[ \t]*)+)$/)?.[0] ?? '';
  return { body: block.slice(0, block.length - tail.length), separator: tail };
}

/** Move a whole peer section, keeping all source characters and separators. */
export function moveDocumentSection(source: string, id: string, direction: 'up' | 'down'): string {
  const sections = getDocumentSections(source);
  const index = sections.findIndex((section) => section.id === id);
  if (index === -1 || (direction !== 'up' && direction !== 'down')) return source;
  const other = index + (direction === 'up' ? -1 : 1);
  if (other < 0 || other >= sections.length) return source;
  const left = sections[Math.min(index, other)];
  const right = sections[Math.max(index, other)];
  const a = splitSeparator(source.slice(left.from, left.to));
  const b = splitSeparator(source.slice(right.from, right.to));
  // Keep the separator at each position. This avoids concatenating a final
  // section without a trailing newline directly into the next heading.
  return source.slice(0, left.from) + b.body + a.separator + a.body + b.separator + source.slice(right.to);
}

/** A plain-text title suggestion, suitable for an input's value/textContent. */
export function suggestDocumentTitle(source: string): string {
  const heading = headingsOf(source)[0];
  if (heading) return heading.title.slice(0, 100);
  const tokens = parse(source);
  for (let index = 0; index < tokens.length - 1; index += 1) {
    if (tokens[index].type !== 'paragraph_open' || tokens[index].level !== 0) continue;
    const text = plainInline(tokens[index + 1]);
    if (text) return text.slice(0, 100);
  }
  return 'Untitled document';
}

/** Append literal source with a deliberate boundary; no semantic merging. */
export function appendDocumentSection(source: string, addition: string, title = ''): string {
  if (!addition.trim()) return source;
  const newline = source.match(/\r\n|\r|\n/)?.[0] ?? addition.match(/\r\n|\r|\n/)?.[0] ?? '\n';
  const heading = title.replace(/[\r\n]+/g, ' ').trim().slice(0, 200).replace(/[\\`*_[\]<>#]/g, '\\$&');
  const content = heading ? `## ${heading}${newline}${newline}${addition}` : addition;
  if (!source) return content;
  const finalBreaks = splitSeparator(source).separator.match(/\r\n|\r|\n/g)?.length ?? 0;
  const separator = finalBreaks >= 2 ? '' : finalBreaks === 1 ? newline : newline + newline;
  return source + separator + content;
}
