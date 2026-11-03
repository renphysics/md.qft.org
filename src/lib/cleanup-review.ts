import { applyCleanup, DOCUMENT_TOOLS_LIMIT, getCleanupSuggestions, type CleanupSuggestion } from './document-tools';
import { prepareHackmd } from './hackmd-format';

export type CleanupTarget = 'markdown' | 'hackmd';
export interface CleanupOption { id: string; label: string; description: string }
export interface CleanupReview {
  source: string;
  changed: boolean;
  limited: boolean;
  status: string;
  changes: { line?: number; message: string }[];
  issues: { line: number; message: string }[];
}

const basicMessages: Record<CleanupSuggestion['id'], string> = {
  'unwrap-fence': 'Removed the enclosing Markdown code fence.',
  'heading-levels': 'Raised document headings together, preserving their hierarchy.',
  'outer-blank-lines': 'Trimmed blank lines outside the document.',
};

export function cleanupOptions(source: string, target: CleanupTarget): CleanupOption[] {
  const options: CleanupOption[] = getCleanupSuggestions(source);
  if (target === 'hackmd' && source.length <= DOCUMENT_TOOLS_LIMIT) {
    const candidate = applyCleanup(source, options.map(({ id }) => id));
    const result = prepareHackmd(candidate);
    if (result.source !== candidate) options.push({
      id: 'hackmd-format', label: 'Prepare mathematics for HackMD',
      description: 'Convert math delimiters and repair safe line breaks that Markdown could interpret as headings or blockquotes. Keep TeX commands and equation rows intact.',
    });
  }
  return options;
}

/** Review a source copy. Neither analysis nor copying changes the draft. */
export function reviewCleanup(source: string, target: CleanupTarget, selectedIds: readonly string[]): CleanupReview {
  const review: CleanupReview = { source, changed: false, limited: false, status: '', changes: [], issues: [] };
  if (source.length > DOCUMENT_TOOLS_LIMIT) {
    review.limited = true;
    review.status = `This document exceeds the ${DOCUMENT_TOOLS_LIMIT.toLocaleString('en-US')}-character cleanup limit. You can still copy the original Markdown.`;
    return review;
  }
  const selected = new Set(selectedIds);
  for (const id of Object.keys(basicMessages) as CleanupSuggestion['id'][]) {
    if (!selected.has(id)) continue;
    const result = applyCleanup(review.source, [id]);
    if (result !== review.source) review.changes.push({ message: basicMessages[id] });
    review.source = result;
  }
  if (target === 'hackmd') {
    const result = prepareHackmd(review.source);
    review.issues = result.issues;
    if (selected.has('hackmd-format')) {
      review.source = result.source;
      review.changes.push(...result.changes);
    }
  }
  review.changed = review.source !== source;
  const count = review.changes.length;
  if (review.changed) {
    review.status = `${count} ${count === 1 ? 'change' : 'changes'} ready. Review the highlighted lines before creating or copying the result.`;
  } else if (cleanupOptions(source, target).length) {
    review.status = selected.size
      ? 'The selected changes do not alter this document. Choose another change, or copy the Markdown as it is.'
      : 'Select a change to create a formatted copy. You can still copy the Markdown as it is.';
  } else {
    review.status = target === 'hackmd'
      ? 'No changes found by the HackMD checks. You can copy the Markdown as it is.'
      : 'No basic formatting changes found. You can copy the Markdown as it is.';
  }
  if (review.issues.length) review.status += ` ${review.issues.length} ${review.issues.length === 1 ? 'item needs' : 'items need'} review below.`;
  return review;
}

export interface CleanupPreviewLine { text: string; changed: boolean }
export interface CleanupDiff { before: CleanupPreviewLine[]; after: CleanupPreviewLine[]; truncated: boolean }

/** Bounded source preview. The full result, never this preview, is copied. */
export function cleanupDiff(before: string, after: string): CleanupDiff {
  const maxCharacters = 80_000;
  const maxLines = 1_000;
  function lines(source: string) {
    const values = source.slice(0, maxCharacters).split(/\r\n|\r|\n/, maxLines + 1);
    return { values: values.slice(0, maxLines), truncated: source.length > maxCharacters || values.length > maxLines };
  }
  const a = lines(before), b = lines(after);
  const result: CleanupDiff = { before: [], after: [], truncated: a.truncated || b.truncated };
  let i = 0, j = 0;
  const addBefore = () => result.before.push({ text: a.values[i++], changed: true });
  const addAfter = () => result.after.push({ text: b.values[j++], changed: true });
  while (i < a.values.length || j < b.values.length) {
    if (i < a.values.length && j < b.values.length && a.values[i] === b.values[j]) {
      result.before.push({ text: a.values[i++], changed: false });
      result.after.push({ text: b.values[j++], changed: false });
      continue;
    }
    // Nearby anchors keep insertions/removals from highlighting the whole file.
    // Fixed lookahead bounds both runtime and memory for large pasted documents.
    let nextA = -1, nextB = -1, distance = Infinity;
    for (let x = i; x < Math.min(i + 24, a.values.length); x++) {
      for (let y = j; y < Math.min(j + 24, b.values.length); y++) {
        if (a.values[x] === b.values[y] && x - i + y - j < distance) {
          nextA = x; nextB = y; distance = x - i + y - j;
        }
      }
    }
    if (nextA >= 0) {
      while (i < nextA) addBefore();
      while (j < nextB) addAfter();
    } else {
      if (i < a.values.length) addBefore();
      if (j < b.values.length) addAfter();
    }
  }
  return result;
}
