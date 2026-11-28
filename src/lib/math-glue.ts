/**
 * Keep the text that belongs to an inline formula on the formula's line.
 *
 * KaTeX draws an inline formula as a row of boxes (one per stretch between
 * relations and operators), and Chromium allows a line break before and after
 * each box whatever character stands beside it, so a comma could start a line
 * and an opening bracket could end one. Only the white-space of a box's parent
 * decides that break. We therefore move the first and the last box into a
 * KaTeX span of their own that does not wrap and put each, with its
 * neighbouring text, into a span that does not wrap either; the boxes between
 * them can still wrap as before. A formula of one box is kept whole.
 *
 * What stays with a formula: after it, closing punctuation, an apostrophe or a
 * hyphen and a directly attached run of Latin, Greek or Cyrillic letters or
 * digits (as in "-th", "’s", "°C"); before it, opening punctuation and such a
 * run (as the 2 in 2π). A non-breaking space is kept on either side, because
 * whoever typed it asked for no break there. Chinese or Japanese text is not
 * kept: a break beside it is normal there. A full-width comma is kept.
 */

/** A kept run longer than this keeps only its punctuation. */
export const KEEP_LIMIT = 16;

const WORD = String.raw`\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Nd}\p{M}`;
// A no-break space and a narrow no-break space, written as escapes because they cannot be seen in source.
const SPACE = String.raw`\u00a0\u202f`;
const CLOSERS = String.raw`,.;:!?%)\]}'"\-\/‐‑–’”»›…‰°′″`
  + String.raw`、。，．：；！？）］｝〉》」』】〕〗` + SPACE;
const OPENERS = String.raw`(\[{'"‘‚“„«‹¿¡`
  + String.raw`（［｛〈《「『【〔〖` + SPACE;
const AFTER = new RegExp(`^[${CLOSERS}${WORD}]+`, 'u');
const AFTER_PUNCTUATION = new RegExp(`^[${CLOSERS}]+`, 'u');
const BEFORE = new RegExp(`[${OPENERS}${WORD}]+$`, 'u');
const BEFORE_PUNCTUATION = new RegExp(`[${OPENERS}]+$`, 'u');

/** The characters at the start of the text after a formula that stay with it. */
export function trailingKeep(text: string): string {
  const head = text.slice(0, KEEP_LIMIT + 1);
  const run = AFTER.exec(head)?.[0] ?? '';
  if (run.length <= KEEP_LIMIT) return run;
  return (AFTER_PUNCTUATION.exec(head)?.[0] ?? '').slice(0, KEEP_LIMIT);
}

/** The characters at the end of the text before a formula that stay with it. */
export function leadingKeep(text: string): string {
  // Only the end of the text can matter; a long paragraph is never searched.
  const tail = text.slice(-(KEEP_LIMIT + 1));
  const run = BEFORE.exec(tail)?.[0] ?? '';
  if (run.length <= KEEP_LIMIT) return run;
  return (BEFORE_PUNCTUATION.exec(tail)?.[0] ?? '').slice(-KEEP_LIMIT);
}

export interface DividedText {
  /** Kept by the formula before this text. */
  forPrevious: string;
  /** Shown as ordinary text. */
  rest: string;
  /** Kept by the formula after this text. */
  forNext: string;
}

/**
 * Share a text between the formulas beside it. The renderer asks this both
 * for the text itself and for each formula, so every character is shown
 * exactly once. Text between two formulas goes first to the one before it.
 */
export function divideText(text: string, afterFormula: boolean, beforeFormula: boolean): DividedText {
  const forPrevious = afterFormula ? trailingKeep(text) : '';
  const remaining = text.slice(forPrevious.length);
  const forNext = beforeFormula ? leadingKeep(remaining) : '';
  return { forPrevious, rest: remaining.slice(0, remaining.length - forNext.length), forNext };
}

/** The same escaping as markdown-it gives a text token. */
function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const KEEP = '<span class="math-keep" style="white-space:nowrap">';
const KATEX_OPEN = '<span class="katex">';
// The site's style sheets reset text-wrap on .katex (to undo text-wrap:
// pretty), and that also resets the inherited nowrap. A style on the KaTeX
// span itself wins over any style sheet, so a kept box's parent never wraps.
const KATEX_KEPT = '<span class="katex" style="white-space:nowrap">';
const HTML_OPEN = '<span class="katex-html" aria-hidden="true">';
const BOX_OPEN = '<span class="katex-base">';
const TAG = /<(\/)?[A-Za-z][\w:-]*[^>]*?(\/)?>/g;

/** KaTeX's inline markup split into what stands before its boxes, the boxes, and what follows them. */
function splitBoxes(html: string): { before: string; boxes: string[]; after: string } | undefined {
  const start = html.indexOf(HTML_OPEN);
  if (start < 0) return undefined;
  const from = start + HTML_OPEN.length;
  const tag = new RegExp(TAG.source, 'g');
  tag.lastIndex = from;
  const boxes: string[] = [];
  let depth = 0;
  let begin = from;
  for (let match; (match = tag.exec(html));) {
    if (match[1]) {
      if (depth === 0) return match.index === begin ? { before: html.slice(0, from), boxes, after: html.slice(match.index) } : undefined;
      depth -= 1;
      if (depth === 0) {
        boxes.push(html.slice(begin, tag.lastIndex));
        begin = tag.lastIndex;
      }
    } else if (!match[2]) {
      // Text between two boxes is not a shape we know.
      if (depth === 0 && match.index !== begin) return undefined;
      depth += 1;
    }
  }
  return undefined;
}

/** One box drawn as a formula of its own; it carries no MathML, which stays once with the rest. */
const alone = (box: string) => `${KATEX_KEPT}${HTML_OPEN}${box}</span></span>`;

/**
 * The markup of a typeset inline formula with the text kept before and after
 * it. Markup that is not KaTeX's (a formula that failed) gets its text beside
 * it; KaTeX markup of an unexpected shape is kept whole on one line.
 */
export function keepWithMath(leading: string, html: string, trailing: string): string {
  if (!leading && !trailing) return html;
  if (!html.startsWith(KATEX_OPEN)) return `${escapeText(leading)}${html}${escapeText(trailing)}`;
  const split = splitBoxes(html);
  if (!split || split.boxes.length < 2 || !split.boxes.every((box) => box.startsWith(BOX_OPEN))) {
    return `${KEEP}${escapeText(leading)}${KATEX_KEPT}${html.slice(KATEX_OPEN.length)}${escapeText(trailing)}</span>`;
  }
  const boxes = [...split.boxes];
  const first = leading ? boxes.shift()! : '';
  const last = trailing ? boxes.pop()! : '';
  return (first ? `${KEEP}${escapeText(leading)}${alone(first)}</span>` : '')
    + `${split.before}${boxes.join('')}${split.after}`
    + (last ? `${KEEP}${alone(last)}${escapeText(trailing)}</span>` : '');
}
