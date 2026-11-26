import type { PresentationMessageOrigin } from './presentation-runtime';

/** The runner relays at most this many characters of deck-supplied text. */
export const MAX_REPORTED_TEXT = 350;
/** Problems kept for display per playback; later ones are only counted. */
export const MAX_SHOWN_PROBLEMS = 3;

export interface PresentationProblem {
  origin: PresentationMessageOrigin;
  text: string;
}

/**
 * Deck text is untrusted: make it a single bounded line of plain text. Callers
 * must still insert it with textContent, never as markup.
 */
export function cleanReportedText(value: unknown, limit = MAX_REPORTED_TEXT): string {
  if (typeof value !== 'string') return '';
  // Control and bidirectional-override characters could disguise the text.
  const text = value.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/** A bounded record of what went wrong during one playback. */
export class PresentationProblemLog {
  private items: PresentationProblem[] = [];
  private extra = 0;

  constructor(private readonly limit = MAX_SHOWN_PROBLEMS) {}

  /** Returns false when the problem was only counted, not kept. */
  add(origin: PresentationMessageOrigin, text: unknown): boolean {
    const cleaned = cleanReportedText(text) || (origin === 'presentation'
      ? 'An error without a description.' : 'The presentation could not continue.');
    if (this.items.some((item) => item.origin === origin && item.text === cleaned)) return false;
    if (this.items.length >= this.limit) { this.extra += 1; return false; }
    this.items.push({ origin, text: cleaned });
    return true;
  }

  get problems(): readonly PresentationProblem[] { return this.items; }
  /** Problems beyond the display limit. */
  get hidden(): number { return this.extra; }
  get size(): number { return this.items.length; }

  clear(): void { this.items = []; this.extra = 0; }
}
