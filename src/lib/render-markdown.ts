import MarkdownIt, { type Token } from 'markdown-it';
import { katex as mathPlugin } from '@mdit/plugin-katex';
import { footnote } from '@mdit/plugin-footnote';
import { tasklist } from '@mdit/plugin-tasklist';
import katex, { type KatexOptions } from 'katex';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import latex from 'highlight.js/lib/languages/latex';
import css from 'highlight.js/lib/languages/css';
import { isInteractiveFence, renderInteractiveFence, MAX_INTERACTIVE_DEMOS } from './interactive-demos';

for (const [name, language] of Object.entries({ javascript, typescript, python, json, bash, latex, css })) {
  hljs.registerLanguage(name, language);
}

export const MAX_SOURCE_LENGTH = 400_000;
export const MAX_SLIDE_COUNT = 200;
export interface RenderOptions {
  allowRemoteImages?: boolean;
  /** Only attachment URLs resolved by the workspace may become local object URLs. */
  imageSources?: ReadonlyMap<string, string>;
}
export interface RenderIssue { message: string; line: number }
export interface DocumentHeading { id: string; text: string; level: number; line: number }
export interface MarkdownResult {
  html: string;
  errors: RenderIssue[];
  headings: DocumentHeading[];
  words: number;
  mathCount: number;
}
export interface SlideMarkup { html: string; startLine: number; endLine: number }
export interface SlidesMarkdownResult extends MarkdownResult { slides: SlideMarkup[] }

const embeddedRaster = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/i;
const remoteImage = /^https?:\/\//i;

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function sourceLines(tokens: Token[], inlineOffsets: WeakMap<Token, number>): WeakMap<Token, number> {
  const lines = new WeakMap<Token, number>();
  let nearestLine = 1;
  for (const token of tokens) {
    if (token.map) nearestLine = token.map[0] + 1;
    lines.set(token, nearestLine);
    if (!token.children) continue;
    // Table-cell inline tokens inherit their row's map; they have no map
    // of their own. Recorded parser offsets also preserve multiline code.
    for (const child of token.children) {
      lines.set(child, nearestLine + (inlineOffsets.get(child) ?? 0));
    }
  }
  return lines;
}

function inlineText(token: Token, includeMath = true): string {
  return (token.children ?? []).map((child) => {
    if (child.type === 'text' || child.type === 'code_inline' || (includeMath && child.type === 'math_inline')) return child.content;
    if (child.type === 'softbreak' || child.type === 'hardbreak') return ' ';
    if (child.type === 'image') return child.content;
    return '';
  }).join('');
}

function slug(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 72) || 'section';
}

function countWords(text: string): number {
  if (typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
    return [...segmenter.segment(text)].filter((part) => part.isWordLike).length;
  }
  return (text.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu) ?? []).length;
}

/**
 * Render plain, untrusted Markdown. User HTML and MDX are never evaluated.
 * Each render owns fresh macro state; source is never rewritten.
 */
export function renderMarkdown(source: string, options: RenderOptions = {}): MarkdownResult {
  return renderSource(source, options, false);
}

/** A single parse and macro scope for the whole deck, including shared references. */
export function renderMarkdownSlides(source: string, options: RenderOptions = {}): SlidesMarkdownResult {
  return renderSource(source, options, true);
}

function renderSource(source: string, options: RenderOptions, slides: boolean): SlidesMarkdownResult {
  const result: SlidesMarkdownResult = { html: '', errors: [], headings: [], words: 0, mathCount: 0, slides: [] };
  if (typeof source !== 'string') {
    result.errors.push({ message: 'Markdown source must be text.', line: 1 });
    return result;
  }
  if (source.length > MAX_SOURCE_LENGTH) {
    result.errors.push({ message: 'This document exceeds the 400,000-character preview limit. You can still download its original Markdown.', line: 1 });
    return result;
  }

  const md = new MarkdownIt({
    html: false,
    linkify: false,
    typographer: false,
    highlight(code, language) {
      if (!language || !hljs.getLanguage(language)) return '';
      try { return hljs.highlight(code, { language, ignoreIllegals: true }).value; }
      catch { return ''; }
    },
  });
  md.use(mathPlugin, { delimiters: 'all', mathFence: false, allowInlineWithSpace: false });
  md.use(footnote);
  md.use(tasklist, { disabled: true });

  // Explicit interactive fences become inert cards. Only the separate sandbox
  // controller can run their code after the reader chooses Run demo.
  const ordinaryFence = md.renderer.rules.fence!;
  const interactiveCards = new WeakMap<Token, string>();
  let interactiveCount = 0;
  md.renderer.rules.fence = (tokens, index, settings, environment, renderer) => {
    const token = tokens[index];
    if (!isInteractiveFence(token.info)) return ordinaryFence(tokens, index, settings, environment, renderer);
    const existing = interactiveCards.get(token);
    if (existing) return existing;
    const line = token.map?.[0] ?? 0;
    let html: string;
    if (++interactiveCount > MAX_INTERACTIVE_DEMOS) {
      const message = `A document can preview up to ${MAX_INTERACTIVE_DEMOS} interactive demos. Additional demo source is preserved in the Markdown.`;
      if (interactiveCount === MAX_INTERACTIVE_DEMOS + 1) result.errors.push({ message, line: line + 1 });
      html = `<div class="qft-demo-error" role="note">${escapeHtml(message)}</div>\n`;
    } else {
      const rendered = renderInteractiveFence(token.info, token.content, line);
      if (rendered.error) result.errors.push({ message: rendered.error, line: line + 1 });
      html = rendered.html;
    }
    interactiveCards.set(token, html);
    return html;
  };

  const inlineOffsets = new WeakMap<Token, number>();
  const tokenizeInline = md.inline.tokenize;
  md.inline.tokenize = (state) => {
    const breaks: number[] = [];
    for (let position = state.src.indexOf('\n'); position !== -1; position = state.src.indexOf('\n', position + 1)) breaks.push(position);
    const push = state.push;
    state.push = (type, tag, nesting) => {
      const token = push.call(state, type, tag, nesting);
      if (type === 'math_inline') {
        let lower = 0;
        let upper = breaks.length;
        while (lower < upper) {
          const middle = (lower + upper) >>> 1;
          if (breaks[middle] < state.pos) lower = middle + 1;
          else upper = middle;
        }
        inlineOffsets.set(token, lower);
      }
      return token;
    };
    try { tokenizeInline.call(md.inline, state); }
    finally { state.push = push; }
  };

  const macros: NonNullable<KatexOptions['macros']> = Object.create(null);
  let lines = new WeakMap<Token, number>();

  const renderMath = (token: Token, displayMode: boolean): string => {
    result.mathCount += 1;
    try {
      return katex.renderToString(token.content, {
        displayMode,
        output: 'htmlAndMathml',
        throwOnError: true,
        trust: false,
        strict: 'ignore',
        maxExpand: 1000,
        maxSize: 20,
        macros,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'This formula could not be typeset.';
      const line = lines.get(token) ?? 1;
      result.errors.push({ message, line });
      return `<span class="math-error${displayMode ? ' math-error--display' : ''}" title="${escapeHtml(message)}">${escapeHtml(token.content)}</span>`;
    }
  };
  md.renderer.rules.math_inline = (tokens, index) => renderMath(tokens[index], false);
  md.renderer.rules.math_block = (tokens, index) => `${renderMath(tokens[index], true)}\n`;

  // The plugin's footnote/footnote-ref wrappers stay namespaced and deterministic.
  md.renderer.rules.footnote_anchor_name = (tokens, index, _settings, environment) =>
    `-qft-${slides ? `s${Number(environment?.slideIndex ?? 0) + 1}-` : ''}${Number(tokens[index].meta?.id ?? 0) + 1}`;

  // Task-list IDs also need a view namespace. A shared footnote is rendered
  // on multiple slides, so derive the prefix at render time without retaining
  // changes on the parsed tokens or rewriting literal user-authored text.
  for (const name of ['checkbox_input', 'label_open']) {
    const original = md.renderer.rules[name];
    md.renderer.rules[name] = (tokens, index, settings, environment, renderer) => {
      const token = tokens[index];
      const attr = name === 'checkbox_input' ? 'id' : 'for';
      const id = token.attrGet(attr);
      if (typeof id !== 'string' || !/^task-item-\d+$/.test(id)) {
        return original ? original(tokens, index, settings, environment, renderer) : renderer.renderToken(tokens, index, settings);
      }
      const prefix = slides ? `qft-s${Number(environment?.slideIndex ?? 0) + 1}` : 'qft';
      token.attrSet(attr, `${prefix}-task-${id.slice('task-item-'.length)}`);
      try { return original ? original(tokens, index, settings, environment, renderer) : renderer.renderToken(tokens, index, settings); }
      finally { token.attrSet(attr, id); }
    };
  }

  md.renderer.rules.image = (tokens, index, settings, environment, renderer) => {
    const token = tokens[index];
    const src = String(token.attrGet('src') ?? '');
    const alt = renderer.renderInlineAsText(token.children ?? [], settings, environment);
    const title = String(token.attrGet('title') ?? '');
    const attachment = src.startsWith('qft-image:') ? options.imageSources?.get(src) : undefined;
    if (attachment && (/^blob:/i.test(attachment) || embeddedRaster.test(attachment))) {
      return `<img src="${escapeHtml(attachment)}" alt="${escapeHtml(alt)}"${title ? ` title="${escapeHtml(title)}"` : ''} decoding="async" data-qft-image="${escapeHtml(src)}">`;
    }
    if (embeddedRaster.test(src) || (options.allowRemoteImages && remoteImage.test(src))) {
      return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"${title ? ` title="${escapeHtml(title)}"` : ''} decoding="async" referrerpolicy="no-referrer">`;
    }
    return `<span class="image-placeholder" role="img" aria-label="${escapeHtml(alt || 'Image')} — image not loaded"><span aria-hidden="true">▧</span> ${escapeHtml(alt || 'Image')}<small>${remoteImage.test(src) ? 'Remote image · enable in Settings' : src.startsWith('qft-image:') ? 'Image unavailable · insert the picture again' : 'Image not loaded · use Insert image or an image URL'}</small></span>`;
  };

  const linkOpen = md.renderer.rules.link_open;
  md.renderer.rules.link_open = (tokens, index, settings, environment, renderer) => {
    const token = tokens[index];
    if (/^https?:\/\//i.test(String(token.attrGet('href') ?? ''))) {
      token.attrSet('target', '_blank');
      token.attrSet('rel', 'noopener noreferrer');
    }
    return linkOpen ? linkOpen(tokens, index, settings, environment, renderer) : renderer.renderToken(tokens, index, settings);
  };

  // Source anchors are attached to outer blocks, including rendered equations.
  for (const name of ['heading_open', 'paragraph_open', 'bullet_list_open', 'ordered_list_open', 'blockquote_open', 'table_open', 'fence', 'code_block', 'math_block', 'hr']) {
    const original = md.renderer.rules[name];
    md.renderer.rules[name] = (tokens, index, settings, environment, renderer) => {
      const token = tokens[index];
      const html = original ? original(tokens, index, settings, environment, renderer) : renderer.renderToken(tokens, index, settings);
      if (token.level !== 0 || !token.map || token.hidden) return html;
      return html.replace(/^<[a-z][a-z0-9]*\b/u, (opening) => `${opening} data-source-line="${token.map![0]}" data-source-end-line="${token.map![1]}"`);
    };
  }

  try {
    const environment = { docId: 'qft', slideIndex: 0 };
    // YAML metadata is not slide content. Blank it instead of removing lines,
    // keeping error locations and source navigation tied to the original text.
    const sourceForParse = slides ? withoutFrontmatter(source.replace(/\r\n?/g, '\n')) : source;
    const tokens = md.parse(sourceForParse, environment);
    lines = sourceLines(tokens, inlineOffsets);
    const slugs = new Map<string, number>();
    const usedIds = new Set<string>();
    const headingLinks = new Map<string, string>();
    const headingPrefix = slides ? 'qft-slide-h-' : 'qft-h-';
    const prose: string[] = [];

    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (token.type === 'inline') prose.push(inlineText(token, false));
      if (token.type !== 'heading_open') continue;
      const text = inlineText(tokens[index + 1]).trim();
      const base = slug(text);
      let count = (slugs.get(base) ?? 0) + 1;
      let suffix = count === 1 ? '' : `-${count}`;
      while (usedIds.has(`${headingPrefix}${base}${suffix}`)) {
        count += 1;
        suffix = `-${count}`;
      }
      slugs.set(base, count);
      const id = `${headingPrefix}${base}${suffix}`;
      usedIds.add(id);
      token.attrSet('id', id);
      headingLinks.set(`${base}${suffix}`, id);
      result.headings.push({ id, text, level: Number(token.tag.slice(1)), line: (token.map?.[0] ?? 0) + 1 });
    }

    for (const token of tokens) {
      for (const child of token.children ?? []) {
        if (child.type !== 'link_open') continue;
        const href = String(child.attrGet('href') ?? '');
        if (!href.startsWith('#')) continue;
        let target = href.slice(1);
        try { target = decodeURIComponent(target); } catch { /* Keep a literal malformed fragment. */ }
        const id = headingLinks.get(target);
        if (id) child.attrSet('href', `#${id}`);
      }
    }

    result.words = countWords(prose.join(' '));
    if (!slides) result.html = md.renderer.render(tokens, md.options, environment);
    else {
      const sourceRows = sourceForParse.split('\n');
      const footnotesStart = tokens.findIndex((token) => token.type === 'footnote_block_open');
      const body = footnotesStart < 0 ? tokens : tokens.slice(0, footnotesStart);
      const footnotes = footnotesStart < 0 ? [] : tokens.slice(footnotesStart);
      const groups: { tokens: Token[]; startLine: number; endLine: number }[] = [];
      let group: Token[] = [];
      let startLine = 0;
      for (const token of body) {
        const separator = token.type === 'hr' && token.level === 0 && token.map
          && /^ {0,3}---[ \t]*$/.test(sourceRows[token.map[0]] ?? '');
        if (separator) {
          groups.push({ tokens: group, startLine, endLine: token.map![0] });
          group = [];
          startLine = token.map![1];
        } else group.push(token);
      }
      groups.push({ tokens: group, startLine, endLine: sourceRows.length });
      if (groups.length > MAX_SLIDE_COUNT) {
        result.errors.push({ message: `This presentation exceeds the ${MAX_SLIDE_COUNT}-slide preview limit. You can still download its original Markdown.`, line: 1 });
        return result;
      }
      for (let index = 0; index < groups.length; index += 1) {
        environment.slideIndex = index;
        const item = groups[index];
        const notes = footnotesForSlide(footnotes, item.tokens);
        let content = md.renderer.render(item.tokens, md.options, environment);
        if (notes.length) {
          let noteHtml = md.renderer.render(notes, md.options, environment);
          const noteIds = new Map<string, string>();
          noteHtml = noteHtml.replace(/\bid="(qft-slide-h-[^"]+)"/g, (_match, id: string) => {
            const next = `qft-s${index + 1}-h-${id.slice('qft-slide-h-'.length)}`;
            noteIds.set(id, next);
            return `id="${next}"`;
          });
          const rewriteNoteLinks = (html: string) => html.replace(/href="#(qft-slide-h-[^"]+)"/g,
            (match, id: string) => noteIds.has(id) ? `href="#${noteIds.get(id)}"` : match);
          content = rewriteNoteLinks(content) + rewriteNoteLinks(noteHtml);
        }
        if (!content.trim()) content = '<div class="qft-slide-empty"><p>Your next idea starts here.</p><small>Add Markdown to this slide. Use a line containing --- between slides.</small></div>';
        result.slides.push({
          html: `<div class="qft-slide-content">${content}</div>`,
          startLine: item.startLine,
          endLine: item.endLine,
        });
      }
      result.html = result.slides.map((slide, index) => `<section class="qft-slide" data-slide-index="${index}">${slide.html}</section>`).join('\n');
    }
  } catch (error) {
    result.errors.push({ message: error instanceof Error ? error.message : 'This Markdown document could not be rendered.', line: 1 });
    result.html = `<pre>${escapeHtml(source)}</pre>`;
  }
  return result;
}

/** Ignore a conventional leading YAML block without interpreting arbitrary YAML. */
function withoutFrontmatter(source: string): string {
  const rows = source.split('\n');
  if (!/^\uFEFF?---\r?$/.test(rows[0] ?? '')) return source;
  const closing = rows.findIndex((row, index) => index > 0 && /^(?:---|\.\.\.)\r?$/.test(row));
  if (closing < 0 || !rows.slice(1, closing).some((row) => /^[A-Za-z_][\w-]*\s*:/.test(row))) return source;
  return rows.map((row, index) => index <= closing ? '' : row).join('\n');
}

/** Render a note on each slide that references it, with unique local anchors. */
function footnotesForSlide(footnotes: Token[], body: Token[]): Token[] {
  if (!footnotes.length) return [];
  const references = new Map<number, Set<number>>();
  for (const token of body) {
    for (const child of token.children ?? []) {
      if (child.type !== 'footnote_ref') continue;
      const id = Number(child.meta?.id);
      if (!references.has(id)) references.set(id, new Set());
      references.get(id)!.add(Number(child.meta?.subId ?? 0));
    }
  }
  if (!references.size) return [];
  const selected: Token[] = [footnotes[0]];
  let include = false;
  for (const token of footnotes.slice(1, -1)) {
    if (token.type === 'footnote_open') include = references.has(Number(token.meta?.id));
    if (!include) continue;
    if (token.type === 'footnote_anchor'
      && !references.get(Number(token.meta?.id))?.has(Number(token.meta?.subId ?? 0))) continue;
    selected.push(token);
  }
  selected.push(footnotes[footnotes.length - 1]);
  return selected;
}
