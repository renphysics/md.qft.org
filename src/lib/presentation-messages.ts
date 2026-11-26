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

/**
 * A file path from a presentation, as shown on screen: every character that
 * is invisible or reorders text (bidirectional controls, zero-width and other
 * formatting characters, line separators, control characters) becomes U+FFFD,
 * so a name such as "evil\u202Egnp.js" cannot pose as "evilsj.png". Only for
 * display: the stored path never changes. Insert the result as text.
 */
export function visiblePath(path: string): string {
  return path.replace(/[\p{Cf}\p{Cc}\u2028\u2029]/gu, '\uFFFD');
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

/** A Reveal.js deck that did not start: the first line of the problem on the stage. */
export const STALL_BLANK_TEXT = "The slides did not start. The presentation's own start-up script stopped with an error.";
/** The library's next step for that problem (the standalone copy has no notes). */
export const STALL_BLANK_NEXT = 'Open the notes below, or copy the report for your AI assistant.';
/** A Reveal.js deck that the player started itself, with basic settings. */
export const STALL_RESCUED_TEXT = "The presentation's start-up script stopped with an error, so the slides are shown with basic settings. Some parts may be missing.";

/**
 * A checked web address split for display: the host name as the URL parser
 * gives it (internationalised names in their ASCII form, so look-alike letters
 * cannot pass for another site), and the rest of the address, shortened.
 */
export function linkParts(url: URL, limit = 60): { host: string; rest: string } {
  const rest = `${url.port ? `:${url.port}` : ''}${url.pathname === '/' && !url.search && !url.hash ? '' : url.pathname}${url.search}${url.hash}`;
  return { host: url.hostname, rest: cleanReportedText(rest.length > limit ? `${rest.slice(0, limit - 1)}…` : rest, limit) };
}
