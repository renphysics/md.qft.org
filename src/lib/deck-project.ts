import { decodeText, deckFromHtmlFile, isTextPath, readDeckArchive, type DeckArchive } from './deck-archive';
import { detectDeck } from './deck-detect';
import { cleanReportedText } from './presentation-messages';
import {
  inspectDirectory, inspectPresentationArchive, PRESENTATION_LIMITS, PRESENTATION_MANIFEST, PresentationPackageError,
  type PresentationPackage,
} from './presentation-package';
import { isStoredDeckKind, type DeckEdits, type SaveDeckInput, type StoredDeckKind } from './presentation-store';
import type { PresentationProfile } from './presentation-runtime';
import type { VendorProvider } from './deck-vendor';
import type { DeckDetection, DeckEngine, DeckFiles, DeckIssue, DeckKind } from './deck-types';

/**
 * One imported deck as the library works with it, whatever its kind: what
 * arrived, what it is, and how to play it. Opening and building only read,
 * parse and rewrite text; nothing in the deck is executed or fetched here.
 */

/** A file as the source view lists it. Text is present for readable text files within the preview limits. */
export interface DeckSourceFile {
  path: string;
  size: number;
  text?: string;
}

export interface DeckProject {
  /** The library record, once saved or matched. */
  id?: string;
  title: string;
  /** Never 'markdown-bundle': those are not decks and openDeck returns null. */
  kind: DeckKind;
  engine: DeckEngine;
  /** The page the deck starts from, relative to the deck root; '' when there is none. */
  entry: string;
  /**
   * The deck's files, for kinds that are linked or converted ('reveal',
   * 'html', 'slidev-build', 'slidev-source', 'unknown'). Empty for
   * 'qft-presentation': its compiled HTML is in `package`, its readable text
   * in `sources`, and everything else stays in the original ZIP.
   */
  files: DeckFiles;
  /** The bytes to keep and download: the original ZIP, or a ZIP holding a single HTML file. */
  original: Blob;
  /** Name for the stored archive; ends in .zip. */
  fileName: string;
  /** Text edits over the original files, by path. Only 'reveal' and 'html' decks are editable. */
  edits: Map<string, string>;
  /** Notes from reading and detection; building adds the linker's. */
  issues: DeckIssue[];
  detection: DeckDetection;
  /** Every file, for the source view. */
  sources: DeckSourceFile[];
  /** The checked portable package ('qft-presentation' only). */
  package?: PresentationPackage;
  /** The main source file to show first, when the deck names one. */
  source?: string;
  aspectRatio?: '16:9' | '4:3';
}

/** What playing a deck takes: one self-contained HTML document and the player profile for it. */
export interface PlayableDeck {
  /** '' when the deck cannot be played; the issues then hold at least one error. */
  html: string;
  issues: DeckIssue[];
  profile: PresentationProfile;
}

export interface BuildDeps {
  /** The bundled Reveal.js and KaTeX files; loaded only when a deck is linked. */
  vendor: () => VendorProvider | Promise<VendorProvider>;
  /**
   * The player's own preparation, run without playing: it throws when the
   * player would refuse the document. Browser only; omitted in Node tests.
   */
  prepare?: (html: string, profile: PresentationProfile) => void;
  /** Progress text for slow steps, written by this module (never deck text). */
  onProgress?: (message: string) => void;
}

/** A saved or unsaved library record, as needed to open it again. */
export interface StoredDeckSource {
  id?: string;
  title: string;
  kind: StoredDeckKind;
  engine: DeckEngine;
  archive: Blob;
  fileName: string;
  entry?: string;
  source?: string;
  aspectRatio?: '16:9' | '4:3';
  edits?: DeckEdits;
}

export const DECK_ENGINE_LABELS: Readonly<Record<DeckEngine, string>> = Object.freeze({
  slidev: 'Slidev', reveal: 'Reveal.js', html: 'HTML',
});

const ENGINE_OF: Readonly<Record<DeckKind, DeckEngine>> = Object.freeze({
  'qft-presentation': 'slidev', 'slidev-build': 'slidev', 'slidev-source': 'slidev',
  reveal: 'reveal', html: 'html', 'markdown-bundle': 'html', unknown: 'html',
});

const encoder = new TextEncoder();
const HTML_FILE = /\.html?$/i;

function titleFrom(value: string | undefined, fallbackName: string): string {
  const stem = fallbackName.replace(/\.(?:zip|html?)$/i, '');
  return cleanReportedText(value, 200) || cleanReportedText(stem, 200) || 'Presentation';
}

/** Readable text within the preview limits; larger and binary files are listed by size only. */
function listSources(files: DeckFiles): DeckSourceFile[] {
  let budget = PRESENTATION_LIMITS.allSourcePreviewBytes;
  const result: DeckSourceFile[] = [];
  for (const [path, bytes] of files) {
    const item: DeckSourceFile = { path, size: bytes.length };
    if (isTextPath(path) && bytes.length <= PRESENTATION_LIMITS.sourcePreviewBytes && bytes.length <= budget) {
      item.text = decodeText(bytes, path);
      budget -= bytes.length;
    }
    result.push(item);
  }
  return result;
}

function fromPackage(pkg: PresentationPackage, id?: string, title?: string): DeckProject {
  return {
    ...(id ? { id } : {}),
    title: title ?? pkg.manifest.title,
    kind: 'qft-presentation',
    engine: 'slidev',
    entry: pkg.manifest.entry,
    files: new Map(),
    original: pkg.archive,
    fileName: pkg.fileName,
    edits: new Map(),
    issues: [],
    detection: { kind: 'qft-presentation', engine: 'slidev', entry: pkg.manifest.entry, title: pkg.manifest.title, issues: [], flags: {} },
    sources: pkg.files.map((file) => ({ path: file.path, size: file.size, ...(typeof file.content === 'string' ? { text: file.content } : {}) })),
    package: pkg,
    ...(pkg.manifest.source ? { source: pkg.manifest.source } : {}),
    ...(pkg.manifest.aspectRatio ? { aspectRatio: pkg.manifest.aspectRatio } : {}),
  };
}

function fromArchive(deck: DeckArchive, detection: DeckDetection, stored?: StoredDeckSource): DeckProject {
  const kind: DeckKind = stored?.kind ?? detection.kind;
  const entry = stored?.entry && deck.files.has(stored.entry) ? stored.entry : detection.entry ?? '';
  return {
    ...(stored?.id ? { id: stored.id } : {}),
    title: stored?.title ?? titleFrom(detection.title, deck.sourceName),
    kind,
    engine: stored?.engine ?? detection.engine ?? ENGINE_OF[kind],
    entry,
    files: deck.files,
    original: deck.archive,
    fileName: stored?.fileName ?? deck.fileName,
    edits: new Map(Object.entries(stored?.edits ?? {})),
    issues: [...deck.issues, ...detection.issues],
    detection: { ...detection, kind, ...(entry ? { entry } : {}) },
    sources: listSources(deck.files),
    ...(stored?.source ? { source: stored.source } : {}),
    ...(stored?.aspectRatio ? { aspectRatio: stored.aspectRatio } : {}),
  };
}

/** Names in a ZIP's directory, read without decompressing anything. */
async function archiveNames(file: File): Promise<string[]> {
  if (!file.size || file.size > PRESENTATION_LIMITS.archiveBytes) {
    throw new PresentationPackageError('Choose a presentation ZIP smaller than 60 MB.');
  }
  return inspectDirectory(new Uint8Array(await file.arrayBuffer()), false)
    .filter((entry) => !entry.directory).map((entry) => entry.name);
}

/**
 * Open a chosen file as a deck. Returns null when it is not a deck: a
 * Markdown document or lesson ZIP, any other ZIP without a presentation, or
 * a file that is neither HTML nor ZIP. The workspace's Markdown importer then
 * continues as before. Unplayable decks (Slidev source, an unrecognised page)
 * are returned, so their explanation can be shown; buildPlayable reports it.
 * Throws PresentationPackageError for files that cannot be read.
 */
export async function openDeck(file: File): Promise<DeckProject | null> {
  if (HTML_FILE.test(file.name)) {
    const deck = await deckFromHtmlFile(file);
    return fromArchive(deck, detectDeck(deck.files));
  }
  if (!/\.zip$/i.test(file.name)) return null;
  const names = await archiveNames(file);
  // Portable packages keep the strict inspector and its behaviour unchanged.
  if (names.some((name) => name === PRESENTATION_MANIFEST || name.endsWith('/' + PRESENTATION_MANIFEST))) {
    const pkg = await inspectPresentationArchive(file);
    return pkg ? fromPackage(pkg) : null;
  }
  // The established QFT lesson path, even when its inert files mention a deck.
  if (names.some((name) => /(?:^|\/)qft\.json$/.test(name))) return null;
  // Without any page there is no deck; leave the ZIP to the Markdown importer untouched.
  if (!names.some((name) => HTML_FILE.test(name) || /(?:^|\/)(?:slides\.md|package\.json)$/i.test(name))) return null;
  const deck = await readDeckArchive(file);
  const detection = detectDeck(deck.files);
  if (detection.kind === 'markdown-bundle' || detection.kind === 'unknown') return null;
  if (detection.kind === 'qft-presentation') {
    const pkg = await inspectPresentationArchive(file);
    return pkg ? fromPackage(pkg) : null;
  }
  return fromArchive(deck, detection);
}

/** Open a saved (or unsaved, kept-in-memory) library record again. */
export async function openStoredDeck(record: StoredDeckSource): Promise<DeckProject> {
  const file = new File([record.archive], record.fileName, { type: 'application/zip' });
  if (record.kind === 'qft-presentation') {
    const pkg = await inspectPresentationArchive(file);
    if (!pkg) throw new PresentationPackageError('This saved package could not be recognized. Its stored data has been preserved.');
    return fromPackage(pkg, record.id, record.title);
  }
  const deck = await readDeckArchive(file);
  return fromArchive(deck, detectDeck(deck.files), record);
}

/** The files to play: the originals with the text edits applied. */
export function filesWithEdits(project: DeckProject): DeckFiles {
  if (!project.edits.size) return project.files;
  const files: DeckFiles = new Map(project.files);
  for (const [path, text] of project.edits) files.set(path, encoder.encode(text));
  return files;
}

/** True when the result can be handed to the player. */
export function isPlayable(result: PlayableDeck): boolean {
  return !!result.html && !result.issues.some((issue) => issue.severity === 'error');
}

/** Storage details for a deck that can be saved, or undefined for kinds the library does not keep. */
export function deckSaveInput(project: DeckProject): SaveDeckInput | undefined {
  if (!isStoredDeckKind(project.kind)) return undefined;
  return {
    title: project.title, engine: project.engine, kind: project.kind,
    fileName: project.fileName, archive: project.original,
    ...(project.entry ? { entry: project.entry } : {}),
    ...(project.source ? { source: project.source } : {}),
    ...(project.aspectRatio ? { aspectRatio: project.aspectRatio } : {}),
    ...(project.edits.size ? { edits: project.edits } : {}),
  };
}

/**
 * Detection notes about references that the linker examines again, more
 * precisely, once it has run: listing both would say the same thing twice.
 * The linker also turns inline handlers into listeners, so the detection note
 * that the player blocks them no longer applies.
 */
const SUPERSEDED_BY_LINKER = new Set([
  'external-font', 'external-image', 'external-library', 'external-media', 'external-stylesheet',
  'external-frame', 'external-file', 'missing-local-file', 'library-file-supplied', 'inline-event-handler',
  'reveal-mathjax',
]);

function mergeIssues(before: readonly DeckIssue[], after: readonly DeckIssue[]): DeckIssue[] {
  const seen = new Set<string>();
  const result: DeckIssue[] = [];
  for (const issue of [...before, ...after]) {
    const key = `${issue.code}\u0000${issue.where ?? issue.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(issue);
  }
  // Errors first, then warnings, then notes; otherwise in the order found.
  const rank = { error: 0, warning: 1, info: 2 } as const;
  return result.map((issue, index) => ({ issue, index }))
    .sort((left, right) => rank[left.issue.severity] - rank[right.issue.severity] || left.index - right.index)
    .map(({ issue }) => issue);
}

const failed = (issues: DeckIssue[], profile: PresentationProfile): PlayableDeck => ({ html: '', issues, profile });

/**
 * WP7 replaces this function with the in-browser Slidev build conversion.
 * Until then a Slidev build is explained, not played.
 */
async function convertSlidevBuildForPlayback(project: DeckProject, _deps: BuildDeps): Promise<{ html: string; issues: DeckIssue[] }> {
  return {
    html: '',
    issues: [...project.issues, {
      code: 'slidev-build-not-yet', severity: 'error',
      message: 'This is a built Slidev presentation. Playing a Slidev build directly is not available yet. Package it with the QFT Slidev packaging tool (tools/slidev/README.md), then open the portable ZIP it makes.',
    }],
  };
}

/** Run the player's own checks without playing, so a deck it would refuse is reported now. */
function dryRun(result: PlayableDeck, deps: BuildDeps): PlayableDeck {
  if (!isPlayable(result) || !deps.prepare) return result;
  try {
    deps.prepare(result.html, result.profile);
    return result;
  } catch (error) {
    const message = cleanReportedText(error instanceof Error ? error.message : String(error), 350)
      || 'The player could not prepare this presentation.';
    return failed([{ code: 'player-refused', severity: 'error', message }, ...result.issues], result.profile);
  }
}

/**
 * Turn a deck into what the player plays. Portable packages play their own
 * compiled HTML under the strict profile; Reveal.js decks and other pages are
 * linked into one self-contained document and play under the tolerant
 * profile. Kinds that cannot play return html '' and an error that says how
 * to fix it. Never executes deck code.
 */
export async function buildPlayable(project: DeckProject, deps: BuildDeps): Promise<PlayableDeck> {
  switch (project.kind) {
    case 'qft-presentation': {
      if (!project.package) return failed([{ code: 'package-missing', severity: 'error', message: 'This presentation package could not be read. Open its ZIP again.' }], 'strict');
      return dryRun({ html: project.package.html, issues: [...project.issues], profile: 'strict' }, deps);
    }
    case 'reveal':
    case 'html': {
      deps.onProgress?.('Preparing the presentation to play offline…');
      const [{ linkDeck }, vendor] = await Promise.all([import('./deck-linker'), deps.vendor()]);
      const linked = await linkDeck(filesWithEdits(project), project.detection, vendor, project.entry ? { entry: project.entry } : {});
      const kept = project.issues.filter((issue) => !SUPERSEDED_BY_LINKER.has(issue.code));
      const issues = mergeIssues(kept, linked.issues);
      const result: PlayableDeck = { html: issues.some((issue) => issue.severity === 'error') ? '' : linked.html, issues, profile: 'tolerant' };
      deps.onProgress?.('Checking the presentation…');
      return dryRun(result, deps);
    }
    case 'slidev-build': {
      deps.onProgress?.('Preparing the Slidev presentation…');
      const converted = await convertSlidevBuildForPlayback(project, deps);
      const issues = mergeIssues([], converted.issues);
      return dryRun({ html: issues.some((issue) => issue.severity === 'error') ? '' : converted.html, issues, profile: 'tolerant' }, deps);
    }
    case 'slidev-source': {
      const issues = project.issues.some((issue) => issue.code === 'slidev-source') ? [...project.issues] : [...project.issues, {
        code: 'slidev-source', severity: 'error' as const,
        message: 'This is the source of a Slidev presentation, which has to be built before it can play. Run "npx slidev build" in the project and import a ZIP of the dist folder.',
      }];
      return failed(mergeIssues([], issues), 'tolerant');
    }
    default: {
      const issues = project.issues.length ? [...project.issues] : [];
      return failed(mergeIssues([{
        code: 'not-a-presentation', severity: 'error',
        message: 'No presentation was found in this file. Open an HTML page made with Reveal.js, a ZIP with index.html at the top, or a portable presentation package.',
      }], issues), 'tolerant');
    }
  }
}
