import { decodeText, deckFromHtmlFile, isTextPath, readDeckArchive, zipDeckFiles, type DeckArchive } from './deck-archive';
import { detectDeck } from './deck-detect';
import { cleanReportedText } from './presentation-messages';
import {
  inspectDirectory, inspectPresentationArchive, PRESENTATION_LIMITS, PRESENTATION_MANIFEST, PresentationPackageError,
  type PresentationPackage,
} from './presentation-package';
import {
  DECK_EDIT_LIMITS, isEditableDeckKind, isStoredDeckKind, type DeckEdits, type SaveDeckInput, type StoredDeckKind,
} from './presentation-store';
import type { PresentationProfile } from './presentation-runtime';
import { mapLibraryPath, type VendorProvider } from './deck-vendor';
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
  /** The wrapping folder the upload had around every file, restored in downloads; absent when there was none. */
  folder?: string;
  /**
   * Text edits over the original files, by path. Only 'reveal' and 'html'
   * decks are editable, and only their existing text files.
   */
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

/**
 * Converts an ordinary Slidev build into one playable document. In the
 * browser this is convertSlidevBuild from slidev-convert-browser.ts, loaded
 * only when a Slidev build is opened; Node tests use convertSlidevFiles with
 * the native esbuild. Resolves with html '' and an error issue when the build
 * cannot be played; rejects when the converter cannot run or is cancelled.
 */
export type SlidevConverter = (
  files: DeckFiles,
  detection: DeckDetection,
  options: { signal?: AbortSignal; onProgress?: (message: string) => void },
) => Promise<{ html: string; issues: DeckIssue[] }>;

export interface BuildDeps {
  /** The bundled Reveal.js and KaTeX files; loaded only when a deck is linked. */
  vendor: () => VendorProvider | Promise<VendorProvider>;
  /** The Slidev build conversion; without it, a Slidev build is explained, not played. */
  convertSlidev?: SlidevConverter;
  /**
   * The player's own preparation, run without playing: it throws when the
   * player would refuse the document. Browser only; omitted in Node tests.
   */
  prepare?: (html: string, profile: PresentationProfile) => void;
  /** Progress text for slow steps, written by this site (never deck text). */
  onProgress?: (message: string) => void;
  /** Stops a slow build, such as a Slidev conversion, when the person moves on. */
  signal?: AbortSignal;
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

/**
 * A stored overlay replaces existing text files only. Entries for files the
 * deck does not have, or for binary files, are not applied: an overlay can
 * change what a deck says, never add files to it.
 */
function storedEdits(files: DeckFiles, edits: DeckEdits | undefined): Map<string, string> {
  return new Map(Object.entries(edits ?? {}).map(([path, text]): [string, unknown] => [files.has(path) ? path : earlierSpelling(path, files) ?? path, text])
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && files.has(entry[0]) && isTextPath(entry[0])));
}

/**
 * Earlier versions read UTF-8 names from ZIPs without the UTF-8 flag one
 * character per byte ("SchrÃ¶dinger.md"), and saved edits under that name.
 * Returns the file such a name stands for now, if the deck has it.
 */
function earlierSpelling(path: string, files: DeckFiles): string | undefined {
  if (!/[\u0080-\u00ff]/.test(path) || /[^\u0000-\u00ff]/.test(path)) return undefined;
  try {
    const name = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(path, (char) => char.charCodeAt(0))).normalize('NFC');
    return files.has(name) ? name : undefined;
  } catch { return undefined; }
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
    ...(deck.folder ? { folder: deck.folder } : {}),
    edits: isEditableDeckKind(kind) ? storedEdits(deck.files, stored?.edits) : new Map(),
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

/** The files to play: the originals with the text edits applied. Edits never add a file. */
export function filesWithEdits(project: DeckProject): DeckFiles {
  if (!project.edits.size) return project.files;
  const files: DeckFiles = new Map(project.files);
  for (const [path, text] of project.edits) if (files.has(path)) files.set(path, encoder.encode(text));
  return files;
}

/** Where the Source files view lists a file. */
export type DeckFileGroup = 'entry' | 'deck' | 'library';

/** A file as the Source files view lists it. */
export interface DeckFileInfo {
  path: string;
  /** Size of the imported file in bytes. */
  size: number;
  group: DeckFileGroup;
  /** Readable as text here; false for binary files and text too large to show. */
  text: boolean;
  /** True for text files of an editable deck within the size limit, other than library copies. */
  editable: boolean;
  /** Why a file of an editable deck cannot be edited, in plain words. */
  note?: string;
}

/** True when the deck's own source is what plays, so editing it here changes the presentation. */
export function isEditableDeck(project: DeckProject): boolean {
  return isEditableDeckKind(project.kind) && project.files.size > 0;
}

/**
 * Copies of libraries that decks ship with: Reveal.js and KaTeX files in
 * their usual layouts, installed packages, and minified files. They are shown
 * for reference and not edited; a deck is changed through its own files.
 */
export function isLibraryFile(path: string): boolean {
  return /(?:^|\/)(?:node_modules|bower_components)\//i.test(path)
    || /\.min\.(?:[cm]?js|css)$/i.test(path)
    || mapLibraryPath(path) !== undefined;
}

/** The imported text of a file; undefined for binary files and text too large to show. */
export function deckOriginalText(project: DeckProject, path: string): string | undefined {
  const bytes = project.files.get(path);
  const listed = project.sources.find((file) => file.path === path);
  if (!bytes) return listed?.text;
  if (!isTextPath(path) || bytes.length > PRESENTATION_LIMITS.sourcePreviewBytes) return undefined;
  return listed?.text ?? decodeText(bytes, path);
}

/** The text a file has now: its edit, or else the imported text. */
export function deckFileText(project: DeckProject, path: string): string | undefined {
  return project.edits.get(path) ?? deckOriginalText(project, path);
}

/**
 * Every file for the Source files view: the entry page (or a package's main
 * source) first, then the deck's own text files, then its other files, then
 * library copies, each group in path order.
 */
export function deckFileList(project: DeckProject): DeckFileInfo[] {
  const editableDeck = isEditableDeck(project);
  const first = project.source ?? project.entry;
  const order: Record<DeckFileGroup, number> = { entry: 0, deck: 1, library: 2 };
  const items = project.sources.map(({ path, size, text }): DeckFileInfo => {
    const group: DeckFileGroup = path === first ? 'entry' : isLibraryFile(path) ? 'library' : 'deck';
    const readable = project.files.has(path)
      ? isTextPath(path) && size <= PRESENTATION_LIMITS.sourcePreviewBytes
      : typeof text === 'string';
    const editable = editableDeck && readable && group !== 'library' && size <= DECK_EDIT_LIMITS.fileBytes;
    const item: DeckFileInfo = { path, size, group, text: readable, editable };
    if (editableDeck && !editable) {
      item.note = group === 'library' ? 'A copy of a library the presentation uses. It is shown for reference and not edited here.'
        : !isTextPath(path) ? 'Kept in the ZIP exactly as imported. Pictures, fonts and media cannot be edited here.'
          : 'Larger than 2 MB, so it cannot be edited here. Edit it outside the browser.';
    }
    return item;
  });
  return items.sort((left, right) => order[left.group] - order[right.group]
    || Number(right.text) - Number(left.text)
    || left.path.localeCompare(right.path));
}

/** Bytes of a string in UTF-8, as storage counts them, without encoding it. */
function utf8Length(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length
      && text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff) { bytes += 4; index += 1; }
    else bytes += 3;
  }
  return bytes;
}

/** Why an overlay cannot be kept, in plain words, or undefined when it is within the limits. */
export function deckEditsProblem(edits: ReadonlyMap<string, string>): string | undefined {
  if (edits.size > DECK_EDIT_LIMITS.files) return 'Too many files are edited to keep in this browser.';
  let total = 0;
  for (const [path, text] of edits) {
    const size = utf8Length(text);
    if (size > DECK_EDIT_LIMITS.fileBytes) {
      return `“${cleanReportedText(path, 200)}” is larger than 2 MB with your changes, so it cannot be kept in this browser. Shorten it, or edit it outside the browser.`;
    }
    total += size;
  }
  return total > DECK_EDIT_LIMITS.totalBytes
    ? 'Your edited files are larger than 8 MB together, so they cannot be kept in this browser. Discard the changes to some files, or edit them outside the browser.'
    : undefined;
}

export interface DeckEditsResult {
  /** The overlay with the changes made: what to build and save. */
  edits: Map<string, string>;
  /** Why the changes cannot be applied, in plain words; undefined when they can. */
  problem?: string;
}

/**
 * The overlay after changing some files. A file changed back to its imported
 * text loses its edit. Only editable files may change, and the result must be
 * within the overlay limits. The project itself is not changed.
 */
export function nextDeckEdits(project: DeckProject, changes: ReadonlyMap<string, string>): DeckEditsResult {
  const edits = new Map(project.edits);
  if (!isEditableDeck(project)) return { edits, problem: 'This presentation cannot be edited in the browser.' };
  const editable = new Set(deckFileList(project).filter((file) => file.editable).map((file) => file.path));
  for (const [path, text] of changes) {
    if (text === deckOriginalText(project, path)) { edits.delete(path); continue; }
    if (!editable.has(path)) return { edits, problem: `“${cleanReportedText(path, 200)}” cannot be edited here.` };
    edits.set(path, text);
  }
  const problem = deckEditsProblem(edits);
  return problem ? { edits, problem } : { edits };
}

/**
 * The deck to download as a ZIP. Unedited, it is the original upload,
 * unchanged. Edited, it holds the deck's files with the edits applied, under
 * their original names and wrapping folder; operating-system clutter and
 * files whose names could not be used are left out.
 */
export function deckArchive(project: DeckProject): Blob {
  if (!project.edits.size || !project.files.size) return project.original;
  const prefix = project.folder ? `${project.folder}/` : '';
  const files: DeckFiles = new Map();
  for (const [path, bytes] of filesWithEdits(project)) files.set(prefix + path, bytes);
  return new Blob([new Uint8Array(zipDeckFiles(files)).buffer], { type: 'application/zip' });
}

/** The download name for the original upload of an edited deck, beside the edited ZIP. */
export function originalArchiveName(project: DeckProject): string {
  return `${project.fileName.replace(/\.zip$/i, '') || 'presentation'}-original.zip`;
}

/** What the Source files view says about changing this deck. */
export function deckSourceNote(project: DeckProject): string {
  switch (project.kind) {
    case 'reveal':
    case 'html':
      return 'Edit a file, then choose Apply changes to replay the presentation on the same slide. Edits are kept in this browser beside your original file, which stays unchanged.';
    case 'qft-presentation':
      return project.source
        ? 'This package plays its compiled slides, so it is read-only here. To change it, revise the source with your editor or AI assistant, rebuild the package with the QFT Slidev tool, then open the new ZIP.'
        : 'This package holds compiled slides only, so it is read-only here. To change it, rebuild it from its Slidev project, then open the new ZIP.';
    case 'slidev-build':
      return 'This is a built Slidev presentation, so it is read-only here. To change it, edit the Slidev project, run "npx slidev build" again, then open a ZIP of the new dist folder.';
    case 'slidev-source':
      return 'This is the source of a Slidev presentation, which has to be built before it can play. Run "npx slidev build" in the project, then open a ZIP of the dist folder.';
    default:
      return 'These files are shown as they were imported.';
  }
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
 * Detection notes about references that the Slidev conversion examines again
 * and reports itself, and Monaco, which the conversion refuses as an error.
 */
const SUPERSEDED_BY_CONVERTER = new Set([
  'external-file', 'external-font', 'external-frame', 'external-image', 'external-library', 'external-media',
  'external-stylesheet', 'missing-local-file', 'slidev-monaco',
]);

/** Convert a Slidev build; any failure becomes an error issue, cancellation a short note. */
async function convertSlidevBuildForPlayback(project: DeckProject, deps: BuildDeps): Promise<{ html: string; issues: DeckIssue[] }> {
  if (!deps.convertSlidev) {
    return { html: '', issues: [{ code: 'slidev-convert-unavailable', severity: 'error', message: 'Slidev builds cannot be converted here, so this one cannot play.' }] };
  }
  try {
    return await deps.convertSlidev(project.files, project.detection, {
      ...(deps.signal ? { signal: deps.signal } : {}),
      ...(deps.onProgress ? { onProgress: deps.onProgress } : {}),
    });
  } catch (error) {
    if (deps.signal?.aborted) {
      return { html: '', issues: [{ code: 'cancelled', severity: 'error', message: 'Stopped before the presentation was ready.' }] };
    }
    const reason = cleanReportedText(error instanceof Error ? error.message : String(error), 300);
    return {
      html: '',
      issues: [{ code: 'slidev-convert-failed', severity: 'error', message: `The Slidev build could not be converted${reason ? `: ${reason}` : '.'}` }],
    };
  }
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
 * linked into one self-contained document, and Slidev builds are converted
 * into one (deps.convertSlidev); both play under the tolerant profile. Kinds
 * that cannot play return html '' and an error that says how to fix it.
 * Never executes deck code.
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
      // A build plays as built: it is converted from its files, never from edits.
      deps.onProgress?.('Preparing the Slidev presentation to play offline…');
      const converted = await convertSlidevBuildForPlayback(project, deps);
      const kept = project.issues.filter((issue) => !SUPERSEDED_BY_CONVERTER.has(issue.code));
      const issues = mergeIssues(kept, converted.issues);
      const result: PlayableDeck = { html: issues.some((issue) => issue.severity === 'error') ? '' : converted.html, issues, profile: 'tolerant' };
      if (isPlayable(result)) deps.onProgress?.('Checking the presentation…');
      return dryRun(result, deps);
    }
    case 'slidev-source': {
      const issues = project.issues.some((issue) => issue.code === 'slidev-source') ? [...project.issues] : [...project.issues, {
        code: 'slidev-source', severity: 'error' as const,
        message: 'This is the source of a Slidev presentation, which has to be built before it can play. Run "npx slidev build" in the project, then open a ZIP of the dist folder.',
      }];
      return failed(mergeIssues([], issues), 'tolerant');
    }
    default: {
      const issues = project.issues.length ? [...project.issues] : [];
      return failed(mergeIssues([{
        code: 'not-a-presentation', severity: 'error',
        message: 'No presentation was found in this file. Open a Reveal.js deck or another web page (an HTML file, or a ZIP with index.html at the top), a ZIP of a Slidev build, or a portable presentation package.',
      }], issues), 'tolerant');
    }
  }
}
