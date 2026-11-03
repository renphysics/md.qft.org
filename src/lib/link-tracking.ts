import MarkdownIt, { type Token } from 'markdown-it';
import { katex as mathPlugin } from '@mdit/plugin-katex';
import { footnote } from '@mdit/plugin-footnote';
import { DOCUMENT_TOOLS_LIMIT } from './document-tools';

interface Message { line: number; message: string }
export interface LinkTrackingResult { source: string; changes: Message[]; issues: Message[] }
interface Destination { source: string; from: number; to: number; url: string; unescape: boolean }
interface Scan { source: string; destinations: Destination[]; escapedClosings: [number, number]; inlineClosing: number }
interface Edit { from: number; to: number; insert: string }

const clickIds = new Set(['gclid', 'dclid', 'fbclid', 'msclkid', 'gbraid', 'wbraid', 'mc_cid', 'mc_eid']);
const signatureKeys = new Set(['signature', 'sig', 'hmac', 'x-amz-signature', 'x-goog-signature', 'awsaccesskeyid', 'googleaccessid']);
const isTracker = (key: string) => /^utm_[a-z0-9_]+$/.test(key) || clickIds.has(key);

function escapedAt(source: string, offset: number): boolean {
  let count = 0;
  for (let index = offset - 1; index >= 0 && source[index] === '\\'; index -= 1) count += 1;
  return count % 2 === 1;
}

function lastInlineClosing(source: string): number {
  for (let index = source.lastIndexOf('\\)'); index >= 0; index = source.lastIndexOf('\\)', index - 1)) {
    if (!escapedAt(source, index)) return index;
    if (index === 0) break;
  }
  return -1;
}

/** Remove query segments in place; never reserialize retained URL parameters. */
function cleanDestination(raw: string, unescape: boolean, decode: (text: string) => string) {
  const spans: { from: number; to: number }[] = [];
  const entity = /&(?:#[xX][\da-fA-F]+|#\d+|[A-Za-z][A-Za-z\d]+);/y;
  let decoded = '';
  for (let from = 0; from < raw.length;) {
    let to = from + 1;
    if (unescape && raw[from] === '\\' && decode(raw.slice(from, from + 2)) !== raw.slice(from, from + 2)) to += 1;
    else if (unescape && raw[from] === '&') {
      entity.lastIndex = from;
      const match = entity.exec(raw);
      if (match) to = entity.lastIndex;
    }
    const text = unescape ? decode(raw.slice(from, to)) : raw.slice(from, to);
    decoded += text;
    for (let index = 0; index < text.length; index += 1) spans.push({ from, to });
    from = to;
  }
  const unchanged = { source: raw, removed: [] as string[], signed: false };
  if (!/^https?:\/\//i.test(decoded)) return unchanged;
  const question = decoded.indexOf('?');
  const hash = decoded.indexOf('#');
  if (question < 0 || (hash >= 0 && hash < question)) return unchanged;
  const end = hash < 0 ? decoded.length : hash;
  const parts: { raw: string; separator: string; key: string; empty: boolean }[] = [];
  let from = question + 1;
  let separator = '';
  while (from <= end) {
    const amp = decoded.indexOf('&', from);
    const to = amp < 0 || amp >= end ? end : amp;
    const segment = decoded.slice(from, to);
    let key = segment.split('=', 1)[0];
    try { key = decodeURIComponent(key.replace(/\+/g, ' ')); } catch { /* Keep malformed keys unchanged. */ }
    parts.push({
      raw: raw.slice(spans[from]?.from ?? raw.length, spans[to]?.from ?? raw.length),
      separator, key: key.toLowerCase(), empty: !segment,
    });
    if (to === end) break;
    separator = raw.slice(spans[to].from, spans[to].to);
    from = to + 1;
  }
  const removed = [...new Set(parts.filter((part) => isTracker(part.key)).map((part) => part.key))];
  if (!removed.length) return unchanged;
  if (parts.some((part) => signatureKeys.has(part.key))) return { ...unchanged, signed: true };
  const kept = parts.filter((part) => !isTracker(part.key) && !part.empty);
  const query = kept.length
    ? raw.slice(spans[question].from, spans[question].to) + kept.map((part, index) => (index ? part.separator : '') + part.raw).join('')
    : '';
  return {
    source: raw.slice(0, spans[question].from) + query + (hash < 0 ? '' : raw.slice(spans[hash].from)),
    removed, signed: false,
  };
}

/** Clean actual Markdown destinations, without changing code, TeX, labels, or titles. */
export function cleanLinkTracking(source: string): LinkTrackingResult {
  const result: LinkTrackingResult = { source, changes: [], issues: [] };
  if (source.length > DOCUMENT_TOOLS_LIMIT) return result;
  const lines: { from: number; normalizedFrom: number; text: string; ending: string }[] = [];
  let originalFrom = 0, normalizedFrom = 0;
  for (const match of source.matchAll(/([^\r\n]*)(\r\n|\r|\n|$)/g)) {
    if (originalFrom === source.length && lines.length && !lines[lines.length - 1].ending) break;
    lines.push({ from: originalFrom, normalizedFrom, text: match[1], ending: match[2] });
    originalFrom += match[0].length;
    normalizedFrom += match[1].length + (match[2] ? 1 : 0);
  }
  const normalized = lines.map((line) => line.text + (line.ending ? '\n' : '')).join('');
  const lineAt = (offset: number) => {
    let lower = 0, upper = lines.length;
    while (lower + 1 < upper) {
      const middle = (lower + upper) >>> 1;
      if (lines[middle].normalizedFrom <= offset) lower = middle;
      else upper = middle;
    }
    return lower;
  };
  const originalOffset = (offset: number) => {
    const line = lines[lineAt(offset)];
    return line.from + offset - line.normalizedFrom;
  };
  const parser = new MarkdownIt({ html: true, linkify: false, typographer: false })
    .use(mathPlugin, { delimiters: 'all', mathFence: false }).use(footnote);
  const originals = new MarkdownIt().use(mathPlugin, { delimiters: 'all', mathFence: false });
  const scans = new WeakMap<Token[], Scan>();
  const absolute: Destination[] = [];
  let scan: Scan | undefined;
  let frame: Destination[] | undefined;
  const parseInline = parser.inline.parse;
  parser.inline.parse = (text, md, environment, tokens) => {
    const previous = scan;
    const current: Scan = {
      source: text, destinations: [], inlineClosing: lastInlineClosing(text),
      escapedClosings: [text.lastIndexOf(String.raw`\\)`), text.lastIndexOf(String.raw`\\]`)],
    };
    scan = current;
    try { parseInline.call(parser.inline, text, md, environment, tokens); }
    finally { scans.set(tokens, current); scan = previous; }
  };
  const parseDestination = parser.helpers.parseLinkDestination;
  // Clone helpers: MarkdownIt shares the default helpers between instances.
  parser.helpers = { ...parser.helpers, parseLinkDestination(text, start, max) {
    const destination = parseDestination(text, start, max);
    if (destination.ok && frame) {
      const angle = text[start] === '<';
      frame.push({ source: text, from: start + Number(angle), to: destination.pos - Number(angle), url: destination.str, unescape: true });
    }
    return destination;
  } };
  // An unmatched opener must not repeatedly scan the rest of a long paste.
  originals.inline.ruler.enableOnly('math_inline_bracket');
  const inlineMath = originals.inline.ruler.getRules('')[0];
  parser.inline.ruler.at('math_inline_bracket', (state, silent) =>
    state.src.startsWith('\\(', state.pos) && state.pos < (scan?.inlineClosing ?? -1) && inlineMath(state, silent));
  let displayClosing = -1;
  for (const match of normalized.matchAll(/\\\][ \t]*(?=\n|$)/g)) {
    if (!escapedAt(normalized, match.index)) displayClosing = match.index;
  }
  originals.block.ruler.enableOnly('math_block_bracket');
  const displayMath = originals.block.ruler.getRules('')[0];
  parser.block.ruler.at('math_block_bracket', (state, start, end, silent) =>
    state.bMarks[start] + state.tShift[start] < displayClosing && displayMath(state, start, end, silent),
  { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
  // HackMD can render these already-working double escapes after Markdown has
  // unescaped them. Keep their TeX opaque to the link parser as well.
  const lastEscapedDisplayClose = normalized.lastIndexOf(String.raw`\\]`);
  parser.block.ruler.before('math_block_bracket', 'escaped_math', (state, start, end, silent) => {
    const from = state.bMarks[start] + state.tShift[start];
    if (from >= lastEscapedDisplayClose || !state.src.startsWith(String.raw`\\[`, from)) return false;
    const close = state.src.indexOf(String.raw`\\]`, from + 3);
    if (close < 0 || close >= (state.bMarks[end] ?? state.src.length)) return false;
    let next = start + 1;
    while (next < end && state.bMarks[next] <= close) next += 1;
    if (state.src.slice(close + 3, state.eMarks[next - 1]).trim()) return false;
    if (silent) return true;
    const token = state.push('escaped_math', '', 0);
    token.map = [start, next];
    state.line = next;
    return true;
  }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
  parser.inline.ruler.before('escape', 'escaped_math', (state, silent) => {
    const from = state.pos;
    const bracket = state.src.startsWith(String.raw`\\[`, from);
    if (!bracket && !state.src.startsWith(String.raw`\\(`, from)) return false;
    if (!scan || from >= scan.escapedClosings[bracket ? 1 : 0]) return false;
    const close = state.src.indexOf(bracket ? String.raw`\\]` : String.raw`\\)`, from + 3);
    if (close < 0 || close + 3 > state.posMax) return false;
    state.pos = close + 3;
    if (!silent) state.push('text', '', 0).content = state.src.slice(from, state.pos);
    return true;
  });
  for (const name of ['link', 'image']) {
    originals.inline.ruler.enableOnly(name);
    const rule = originals.inline.ruler.getRules('')[0];
    parser.inline.ruler.at(name, (state, silent) => {
      const previous = frame, candidates: Destination[] = [];
      frame = silent ? undefined : candidates;
      const start = state.pos, tokenStart = state.tokens.length;
      let matched: boolean;
      try { matched = rule(state, silent); } finally { frame = previous; }
      if (matched && !silent && scan) {
        const token = state.tokens.slice(tokenStart).find((token) => token.type === (name === 'link' ? 'link_open' : 'image'));
        const href = token?.attrGet(name === 'link' ? 'href' : 'src');
        scan.destinations.push(...candidates.filter((item) => item.source === state.src && item.from >= start
          && item.to <= state.pos && parser.normalizeLink(item.url) === href));
      }
      return matched;
    });
  }
  originals.inline.ruler.enableOnly('autolink');
  const autolink = originals.inline.ruler.getRules('')[0];
  parser.inline.ruler.at('autolink', (state, silent) => {
    const from = state.pos + 1;
    const matched = autolink(state, silent);
    if (matched && !silent && scan) scan.destinations.push({
      source: state.src, from, to: state.pos - 1, url: state.src.slice(from, state.pos - 1), unescape: false,
    });
    return matched;
  });
  originals.block.ruler.enableOnly('reference');
  const reference = originals.block.ruler.getRules('')[0];
  parser.block.ruler.at('reference', (state, start, end, silent) => {
    const previous = frame, candidates: Destination[] = [];
    frame = silent ? undefined : candidates;
    let matched: boolean;
    try { matched = reference(state, start, end, silent); } finally { frame = previous; }
    if (matched && !silent) absolute.push(...candidates.filter((item) => item.source === normalized));
    return matched;
  });
  let tokens: Token[];
  try { tokens = parser.parse(normalized, {}); }
  catch {
    result.issues.push({ line: 1, message: 'Link destinations could not be safely analyzed. Their source was preserved.' });
    return result;
  }
  let range: [number, number] = [0, lines.length], cursor = 0, mappingBlocked = false;
  for (const token of tokens) {
    if (token.map) { range = token.map; cursor = lines[range[0]]?.normalizedFrom ?? 0; mappingBlocked = false; }
    if (token.type !== 'inline' || !token.children) continue;
    const current = scans.get(token.children);
    if (!current) continue;
    const reportUnmapped = () => {
      if (current.destinations.some((item) => {
        const raw = item.source.slice(item.from, item.to);
        const clean = cleanDestination(raw, item.unescape, parser.utils.unescapeAll);
        return clean.source !== raw || clean.signed;
      })) result.issues.push({ line: range[0] + 1, message: 'A link in complex Markdown source was preserved because its exact URL position could not be mapped safely.' });
    };
    if (mappingBlocked) { reportUnmapped(); continue; }
    // Inline parsing strips list/quote prefixes. Map each content line back to
    // its original source line; table cells use a cursor within their row.
    const offsets: { from: number; to: number; original: number }[] = [];
    let contentFrom = 0, nextLine = range[0];
    for (const contentLine of current.source.split('\n')) {
      let found = -1;
      for (; nextLine < range[1] && nextLine < lines.length; nextLine += 1) {
        const line = lines[nextLine];
        const within = line.text.indexOf(contentLine, Math.max(0, cursor - line.normalizedFrom));
        if (within >= 0) { found = line.normalizedFrom + within; break; }
      }
      if (found < 0) { mappingBlocked = true; break; }
      offsets.push({ from: contentFrom, to: contentFrom + contentLine.length, original: found });
      cursor = found + contentLine.length;
      contentFrom += contentLine.length + 1;
      nextLine += 1;
    }
    // A table cell may contain parser-normalized escapes. Once a cell cannot
    // be mapped, a later cell must not accidentally match text inside it.
    if (mappingBlocked) { reportUnmapped(); continue; }
    for (const item of current.destinations) {
      let lower = 0, upper = offsets.length;
      while (lower + 1 < upper) {
        const middle = (lower + upper) >>> 1;
        if (offsets[middle].from <= item.from) lower = middle;
        else upper = middle;
      }
      const offset = offsets[lower];
      if (!offset || item.from < offset.from || item.to > offset.to) continue;
      absolute.push({ ...item, source: normalized, from: offset.original + item.from - offset.from, to: offset.original + item.to - offset.from });
    }
  }
  const edits: Edit[] = [];
  const seen = new Set<string>();
  for (const item of absolute.sort((a, b) => a.from - b.from)) {
    const key = `${item.from}:${item.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const raw = normalized.slice(item.from, item.to);
    const clean = cleanDestination(raw, item.unescape, parser.utils.unescapeAll);
    const line = lineAt(item.from) + 1;
    if (clean.signed) result.issues.push({ line, message: 'A signed link was preserved because removing query parameters could invalidate it.' });
    if (clean.source === raw) continue;
    edits.push({ from: originalOffset(item.from), to: originalOffset(item.to), insert: clean.source });
    result.changes.push({ line, message: `Removed link tracking ${clean.removed.length === 1 ? 'parameter' : 'parameters'}: ${clean.removed.join(', ')}.` });
  }
  const parts: string[] = [];
  let from = 0;
  for (const edit of edits) {
    if (edit.from < from) return { source, changes: [], issues: [{ line: 1, message: 'Overlapping link destinations need manual review. Their source was preserved.' }] };
    parts.push(source.slice(from, edit.from), edit.insert);
    from = edit.to;
  }
  parts.push(source.slice(from));
  result.source = parts.join('');
  return result;
}
