import MarkdownIt, { type MarkdownIt as MarkdownParser, type Token } from 'markdown-it';
import { katex as mathPlugin } from '@mdit/plugin-katex';
import { footnote } from '@mdit/plugin-footnote';
import { DOCUMENT_TOOLS_LIMIT } from './document-tools';

export interface HackmdMessage { line: number; message: string }
export interface HackmdPreparation { source: string; changes: HackmdMessage[]; issues: HackmdMessage[] }

interface SourceLine { from: number; to: number; end: number; normalizedFrom: number; text: string; ending: string }
interface Edit { from: number; to: number; insert: string }
interface InlineMath { from: number; to: number; body: string }
interface InlineScan { source: string; math: InlineMath[]; notices: { offset: number; message: string }[]; escaped: boolean; lastClosing: number }
type InlineRule = ReturnType<MarkdownParser['inline']['ruler']['getRules']>[number];
type BlockRule = ReturnType<MarkdownParser['block']['ruler']['getRules']>[number];

function sourceLines(source: string): SourceLine[] {
  const result: SourceLine[] = [];
  const newline = /\r\n|\r|\n/g;
  let from = 0;
  let normalizedFrom = 0;
  for (let match = newline.exec(source); match; match = newline.exec(source)) {
    const text = source.slice(from, match.index);
    result.push({ from, to: match.index, end: newline.lastIndex, normalizedFrom, text, ending: match[0] });
    normalizedFrom += text.length + 1;
    from = newline.lastIndex;
  }
  result.push({ from, to: source.length, end: source.length, normalizedFrom, text: source.slice(from), ending: '' });
  return result;
}

function lineIndex(lines: SourceLine[], offset: number, normalized = false): number {
  let lower = 0;
  let upper = lines.length;
  while (lower + 1 < upper) {
    const middle = (lower + upper) >>> 1;
    if ((normalized ? lines[middle].normalizedFrom : lines[middle].from) <= offset) lower = middle;
    else upper = middle;
  }
  return lower;
}

function originalOffset(lines: SourceLine[], normalizedOffset: number): number {
  const line = lines[lineIndex(lines, normalizedOffset, true)];
  return line.from + normalizedOffset - line.normalizedFrom;
}

function escapedAt(source: string, offset: number): boolean {
  let backslashes = 0;
  for (let index = offset - 1; index >= 0 && source[index] === '\\'; index -= 1) backslashes += 1;
  return backslashes % 2 === 1;
}

function hasComment(line: string): boolean {
  for (let index = line.indexOf('%'); index !== -1; index = line.indexOf('%', index + 1)) {
    if (!escapedAt(line, index)) return true;
  }
  return false;
}

function lastBracketClosing(source: string): number {
  for (let index = source.lastIndexOf('\\)'); index !== -1; index = source.lastIndexOf('\\)', index - 1)) {
    if (!escapedAt(source, index)) return index;
    if (index === 0) break;
  }
  return -1;
}

/** Only public MarkdownIt ruler APIs are used to retain its code/link parsing. */
function makeParser(normalizedSource: string): { parser: MarkdownParser; scans: WeakMap<Token[], InlineScan> } {
  const options = { delimiters: 'all' as const, mathFence: false, allowInlineWithSpace: false };
  const parser = new MarkdownIt({ html: true, linkify: false, typographer: false }).use(mathPlugin, options).use(footnote);
  const originals = new MarkdownIt({ html: true, linkify: false, typographer: false }).use(mathPlugin, options).use(footnote);
  const inlineRule = (name: string): InlineRule => {
    originals.inline.ruler.enableOnly(name);
    return originals.inline.ruler.getRules('')[0];
  };
  const blockRule = (name: string): BlockRule => {
    originals.block.ruler.enableOnly(name);
    return originals.block.ruler.getRules('')[0];
  };
  const scans = new WeakMap<Token[], InlineScan>();
  const parseInline = parser.inline.parse;
  let current: InlineScan | undefined;
  let suspended = 0;

  parser.inline.parse = (source, md, environment, tokens) => {
    const previous = current;
    const scan: InlineScan = { source, math: [], notices: [], escaped: false, lastClosing: lastBracketClosing(source) };
    current = scan;
    try { parseInline.call(parser.inline, source, md, environment, tokens); }
    finally { scans.set(tokens, scan); current = previous; }
  };

  // Link destinations, image labels, and their recursively parsed contents are
  // source syntax, not places where this exporter may rewrite delimiters.
  for (const name of ['link', 'image', 'autolink']) {
    const rule = inlineRule(name);
    parser.inline.ruler.at(name, (state, silent) => {
      suspended += 1;
      try { return rule(state, silent); }
      finally { suspended -= 1; }
    });
  }

  const bracket = inlineRule('math_inline_bracket');
  parser.inline.ruler.at('math_inline_bracket', (state, silent) => {
    if (!state.src.startsWith('\\(', state.pos)) return false;
    const from = state.pos;
    // Avoid repeatedly scanning the rest of a large document for unmatched
    // opening delimiters. A successful parse consumes the matched expression.
    const matched = (current?.lastClosing ?? -1) > from && bracket(state, silent);
    if (!silent && !suspended && current) {
      if (matched) current.math.push({ from, to: state.pos, body: state.src.slice(from + 2, state.pos - 2) });
      else current.notices.push({ offset: from, message: 'An inline math delimiter has no matching closing delimiter. The source was preserved.' });
    }
    return matched;
  });

  parser.inline.ruler.before('escape', 'hackmd_math_notices', (state, silent) => {
    if (silent || suspended || !current || state.src[state.pos] !== '\\') return false;
    const part = state.src.slice(state.pos, state.pos + 3);
    if (part === '\\\\[' || part === '\\\\(') {
      current.escaped = true;
      current.notices.push({ offset: state.pos, message: 'Existing doubled math delimiters were preserved. Review this working escape form in HackMD before changing it.' });
    } else if (state.src.startsWith('\\[', state.pos)) {
      current.notices.push({ offset: state.pos, message: 'Display math could not be safely recognized here. Put its opening and closing delimiters on their own lines before converting.' });
    } else if (state.src.startsWith('\\)', state.pos) || state.src.startsWith('\\]', state.pos)) {
      current.notices.push({ offset: state.pos, message: 'A closing math delimiter could not be matched safely. The source was preserved.' });
    }
    return false;
  });

  let lastDisplayClosing = -1;
  const closes = /\\\][ \t]*(?=\n|$)/g;
  for (let match = closes.exec(normalizedSource); match; match = closes.exec(normalizedSource)) {
    if (!escapedAt(normalizedSource, match.index)) lastDisplayClosing = match.index;
  }
  const display = blockRule('math_block_bracket');
  parser.block.ruler.at('math_block_bracket', (state, start, end, silent) => {
    if (state.bMarks[start] + state.tShift[start] >= lastDisplayClosing) return false;
    return display(state, start, end, silent);
  }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
  return { parser, scans };
}

function mathLineConflict(text: string): 'heading' | 'blockquote' | undefined {
  if (/^[ \t]*=[ \t]*$/.test(text)) return 'heading';
  if (/^[ \t]*>/.test(text)) return 'blockquote';
}

/** Join source lines that Markdown would interpret as structure, keeping TeX intact. */
function reflowMathLines(body: string, firstLine: number): { body: string; changes: HackmdMessage[]; issue?: HackmdMessage } {
  const lines = sourceLines(body);
  if (!lines.some((line) => mathLineConflict(line.text))) return { body, changes: [] };
  if (/\\(?:[gex]?def|let|futurelet|newcommand|renewcommand|providecommand|catcode|verb)\b|\\begin\{(?:verbatim|Verbatim)\}/.test(body)) {
    return { body, changes: [], issue: { line: firstLine, message: 'Math containing a macro definition or verbatim command needs manual review before its source lines can be joined for HackMD.' } };
  }
  const result: { parts: string[]; ending: string; safe: boolean }[] = [];
  const changes: HackmdMessage[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const conflict = mathLineConflict(line.text);
    if (!conflict) {
      result.push({ parts: [line.text], ending: line.ending, safe: !!line.text.trim() && !hasComment(line.text) });
      continue;
    }
    const previous = result[result.length - 1];
    if (!previous?.safe) {
      const problem = conflict === 'heading'
        ? 'A standalone equals sign may become a Markdown heading in HackMD.'
        : 'A math line starting with > may become a Markdown blockquote in HackMD.';
      return { body, changes: [], issue: { line: firstLine + index, message: `${problem} Its preceding line is blank or contains a TeX comment, so it was left unchanged for review.` } };
    }
    previous.parts.push(conflict === 'heading' ? ' =' : ' ' + line.text);
    previous.ending = line.ending;
    // A joined inequality may end in a comment. Keep its newline so another
    // continuation cannot be swallowed by that comment on a subsequent pass.
    previous.safe = !hasComment(line.text);
    changes.push({ line: firstLine + index, message: conflict === 'heading'
      ? 'Joined a standalone equals sign to the preceding math line so HackMD cannot interpret it as a heading.'
      : 'Joined a math line starting with > to the preceding math line so HackMD cannot interpret it as a blockquote.' });
  }
  return { body: result.map((line) => line.parts.join('') + line.ending).join(''), changes };
}

function inlineProblem(math: InlineMath, source: string): string | undefined {
  if (/[\r\n]/.test(math.body)) return 'Multiline inline math was preserved. Use display math or put this expression on one source line before converting.';
  if (hasComment(math.body)) return 'Inline math containing a TeX comment was preserved so the comment cannot consume a new delimiter.';
  if (!math.body.trim()) return 'An empty inline math expression was preserved for review.';
  const trailing = math.body.match(/[ \t]+$/);
  if (trailing && escapedAt(math.body, math.body.length - trailing[0].length)) {
    return 'Inline math ends in an escaped space. It was preserved rather than trimming part of a TeX command.';
  }
  for (let index = math.body.indexOf('$'); index !== -1; index = math.body.indexOf('$', index + 1)) {
    if (!escapedAt(math.body, index)) return 'Inline math contains a dollar sign that would conflict with dollar delimiters. Its original delimiters were preserved.';
  }
  if (/[A-Za-z0-9_$\\]/.test(source[math.from - 1] ?? '') || /[A-Za-z0-9_$]/.test(source[math.to] ?? '')) {
    return 'Inline math touches surrounding text or a dollar sign. Add separating spaces before changing its delimiters for HackMD.';
  }
  return undefined;
}

/**
 * Prepare a copy for HackMD without reserializing Markdown or evaluating TeX.
 * Ambiguous syntax is kept verbatim and reported instead of being unescaped.
 */
export function prepareHackmd(source: string): HackmdPreparation {
  const result: HackmdPreparation = { source, changes: [], issues: [] };
  if (typeof source !== 'string') return { source: '', changes: [], issues: [{ line: 1, message: 'Markdown source must be text.' }] };
  if (source.length > DOCUMENT_TOOLS_LIMIT) {
    result.issues.push({ line: 1, message: `HackMD preparation supports up to ${DOCUMENT_TOOLS_LIMIT.toLocaleString('en-US')} characters. The original source was preserved.` });
    return result;
  }
  const lines = sourceLines(source);
  const normalized = lines.map((line) => line.text + (line.ending ? '\n' : '')).join('');
  const { parser, scans } = makeParser(normalized);
  const blockCompatibility = new MarkdownIt({ html: true, linkify: false, typographer: false });
  let tokens: Token[];
  try { tokens = parser.parse(normalized, {}); }
  catch {
    result.issues.push({ line: 1, message: 'This Markdown could not be safely analyzed. The original source was preserved.' });
    return result;
  }
  const edits: Edit[] = [];
  const issueKeys = new Set<string>();
  const issue = (line: number, message: string): void => {
    const key = `${line}:${message}`;
    if (!issueKeys.has(key)) { issueKeys.add(key); result.issues.push({ line, message }); }
  };
  let nearestLine = 0;

  for (const token of tokens) {
    if (token.map) nearestLine = token.map[0];
    if (token.type === 'fence' && /^interactive(?:\s|$)/.test(token.info.trim())) {
      issue(nearestLine + 1, 'Interactive demos remain code in HackMD. Use a static image or a link to the interactive lesson when sharing it there.');
    }
    for (const child of token.children ?? []) {
      if (child.type !== 'image') continue;
      const destination = String(child.attrGet('src') ?? '');
      if (!/^(?:https?:\/\/|\/\/|data:)/i.test(destination)) {
        issue(nearestLine + 1, 'A local or relative image will need to be uploaded to HackMD or replaced with an accessible image URL.');
      }
    }

    if (token.type === 'math_block' && token.map) {
      const [first, end] = token.map;
      const opening = lines[first]?.text.match(/^( {0,3})(\\\[|\$\$)/);
      const last = lines[end - 1];
      const closing = token.markup === '\\[' ? '\\]' : '$$';
      if (token.level !== 0 || !opening || !last) {
        if (token.markup === '\\[' || token.content.split('\n').some((line) => mathLineConflict(line))) {
          issue(first + 1, 'Math inside a list, quote, or another Markdown container was preserved. Convert it outside the container or review its indentation manually.');
        }
        continue;
      }
      const from = lines[first].from + opening[1].length;
      const trimmedLast = last.text.replace(/[ \t]+$/, '');
      const closingOffset = last.from + trimmedLast.length - closing.length;
      if (!trimmedLast.endsWith(closing) || closingOffset <= from + 1 || escapedAt(source, closingOffset)) {
        issue(first + 1, 'Display math has no safely matched closing delimiter. Its source was preserved.');
        continue;
      }
      const body = source.slice(from + 2, closingOffset);
      let ambiguousBracket = false;
      if (token.markup === '\\[') {
        for (let index = body.indexOf('\\'); index !== -1; index = body.indexOf('\\', index + 1)) {
          if ((body[index + 1] === '[' || body[index + 1] === ']') && !escapedAt(body, index)) {
            ambiguousBracket = true;
            break;
          }
        }
      }
      if (ambiguousBracket) {
        issue(first + 1, 'Display math contains additional bracket delimiters. Its source was preserved because the intended boundary is ambiguous.');
        continue;
      }
      if (/(?:^|\r\n|\r|\n)[ \t]*\\{2,}=[ \t]*(?=\r\n|\r|\n|$)/.test(body)) {
        issue(first + 1, 'An existing escaped equals-sign workaround was preserved. Review it in HackMD before changing its backslashes.');
        continue;
      }
      const reflow = reflowMathLines(body, first + 1);
      if (reflow.issue) { issue(reflow.issue.line, reflow.issue.message); continue; }
      let inner = reflow.body;
      if (token.markup === '\\[') {
        if (!inner.trim()) { issue(first + 1, 'Empty display math was preserved for review.'); continue; }
        const newline = lines[first].ending || lines.find((line) => line.ending)?.ending || '\n';
        if (!/^[ \t]*(?:\r\n|\r|\n)/.test(inner)) inner = newline + inner;
        if (!/(?:\r\n|\r|\n)[ \t]*$/.test(inner)) inner += newline;
      }
      const candidate = '$$' + inner + '$$';
      const candidateBlocks = blockCompatibility.parse(candidate, {});
      if (candidateBlocks.length !== 3 || candidateBlocks[0].type !== 'paragraph_open'
        || candidateBlocks[1].type !== 'inline' || candidateBlocks[2].type !== 'paragraph_close') {
        issue(first + 1, 'This equation contains a Markdown block boundary, such as a blank line, heading, or list. Its source was preserved; review its line layout in HackMD.');
        continue;
      }
      if (token.markup === '$$' && !reflow.changes.length) continue;
      if (token.markup === '\\[') result.changes.push({ line: first + 1, message: 'Changed display math delimiters to dollars on separate source lines for HackMD.' });
      result.changes.push(...reflow.changes);
      edits.push({ from, to: closingOffset + 2, insert: candidate });
      continue;
    }

    if (token.type !== 'inline' || !token.children) continue;
    const scan = scans.get(token.children);
    if (!scan || (!scan.math.length && !scan.notices.length)) continue;
    const first = token.map?.[0] ?? nearestLine;
    const end = token.map?.[1] ?? first + 1;
    const start = lines[first]?.normalizedFrom ?? 0;
    const limit = lines[end]?.normalizedFrom ?? normalized.length;
    const relative = normalized.slice(start, limit).indexOf(token.content);
    const found = start + relative;
    const exact = relative !== -1;
    const lineFor = (offset: number): number => exact ? lineIndex(lines, found + offset, true) + 1 : first + 1;
    if (token.children.some((child) => child.type === 'html_inline')) {
      issue(first + 1, 'Math mixed with raw HTML was preserved. Review the HTML separately before converting its math.');
      continue;
    }
    for (const notice of scan.notices) issue(lineFor(notice.offset), notice.message);
    if (scan.escaped) continue;
    if (!exact || !token.map || (token.level !== 1 && /\n/.test(token.content))) {
      if (scan.math.length) issue(first + 1, 'Inline math in a Markdown container was preserved because its exact source positions could not be changed safely.');
      continue;
    }
    for (const math of scan.math) {
      const problem = inlineProblem(math, scan.source);
      if (problem) { issue(lineFor(math.from), problem); continue; }
      edits.push({
        from: originalOffset(lines, found + math.from),
        to: originalOffset(lines, found + math.to),
        insert: '$' + math.body.replace(/^[ \t]+|[ \t]+$/g, '') + '$',
      });
      result.changes.push({ line: lineFor(math.from), message: 'Changed inline math delimiters to single dollars for HackMD.' });
    }
  }

  // Assemble once, rather than repeatedly splicing a potentially large source.
  edits.sort((a, b) => a.from - b.from);
  const parts: string[] = [];
  let cursor = 0;
  for (const edit of edits) {
    if (edit.from < cursor) {
      return { source, changes: [], issues: [{ line: lineIndex(lines, edit.from) + 1, message: 'Overlapping Markdown constructs need manual review. The original source was preserved.' }] };
    }
    parts.push(source.slice(cursor, edit.from), edit.insert);
    cursor = edit.to;
  }
  parts.push(source.slice(cursor));
  result.source = parts.join('');
  result.changes.sort((a, b) => a.line - b.line);
  result.issues.sort((a, b) => a.line - b.line);
  return result;
}
