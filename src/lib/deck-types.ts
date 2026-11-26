/**
 * Shared vocabulary for imported presentations ("decks").
 *
 * engine: what plays a deck. kind: how it arrived. Detection, linking,
 * conversion, storage and the library all speak in these terms.
 */
export type DeckEngine = 'slidev' | 'reveal' | 'html';

export type DeckKind =
  | 'qft-presentation'
  | 'reveal'
  | 'html'
  | 'slidev-build'
  | 'slidev-source'
  | 'markdown-bundle'
  | 'unknown';

/** Normalised POSIX paths (one wrapping top-level folder stripped) to file bytes. */
export type DeckFiles = Map<string, Uint8Array>;

export interface DeckIssue {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  where?: string;
}

export interface DeckDetection {
  kind: DeckKind;
  entry?: string;
  engine?: DeckEngine;
  engineVersion?: string;
  title?: string;
  issues: DeckIssue[];
  flags: {
    revealFromCdn?: boolean;
    revealMajor?: number;
    usesExternalMarkdown?: boolean;
    usesEsModules?: boolean;
    mathPlugin?: 'katex' | 'mathjax2' | 'mathjax3' | 'mathjax4';
    slidevBase?: string;
    slidevRouter?: 'history' | 'hash' | 'memory';
    slidevHasMonaco?: boolean;
    slidevHasWorkers?: boolean;
    hasSource?: boolean;
  };
}

export const DECK_ENGINES: readonly DeckEngine[] = Object.freeze(['slidev', 'reveal', 'html']);
export const DECK_KINDS: readonly DeckKind[] = Object.freeze([
  'qft-presentation', 'reveal', 'html', 'slidev-build', 'slidev-source', 'markdown-bundle', 'unknown',
]);

export function isDeckEngine(value: unknown): value is DeckEngine {
  return typeof value === 'string' && (DECK_ENGINES as readonly string[]).includes(value);
}

export function isDeckKind(value: unknown): value is DeckKind {
  return typeof value === 'string' && (DECK_KINDS as readonly string[]).includes(value);
}
