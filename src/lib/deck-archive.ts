import { zipSync, type Zippable } from 'fflate';
import {
  inspectDirectory, isIgnoredPath, isTextPath, readEntry, safePresentationPath,
  EMPTY_FILE_MESSAGE, PRESENTATION_LIMITS, PresentationPackageError, type ArchiveEntry,
} from './presentation-package';
import { cleanReportedText, visiblePath } from './presentation-messages';
import type { DeckFiles, DeckIssue } from './deck-types';

export { isTextPath };

/**
 * A deck read into memory. Reading only decompresses and checks bytes; nothing
 * in the archive is parsed as markup or executed here.
 */
export interface DeckArchive {
  files: DeckFiles;
  /** The bytes to keep: the original ZIP, or a ZIP made from a single HTML file. */
  archive: Blob;
  /** Name for the stored archive; always ends in .zip. */
  fileName: string;
  /** The name of the file the person chose, as shown to them. */
  sourceName: string;
  /** The one wrapping top-level folder removed from every path, or '' when there was none. */
  folder: string;
  expandedBytes: number;
  issues: DeckIssue[];
  /** Files left out because their names cannot be used: deck path (wrapping folder removed) and the reason in words. */
  skipped: Map<string, string>;
  /**
   * Names in a legacy code page that were read again in the code page the
   * slides match: the earlier one-character-per-byte deck path and the path now.
   */
  renamed?: Map<string, string>;
}

/** At most this many skipped files are named individually; the rest are counted. */
const NAMED_SKIPS = 10;

const unreadable = (detail: string): never => {
  throw new PresentationPackageError('This ZIP could not be opened. ' + detail);
};

function baseName(name: string, fallback: string): string {
  const base = name.split(/[\\/]/).pop()?.replace(/[\u0000-\u001f\u007f]/g, '').trim() ?? '';
  return (base || fallback).slice(0, 240);
}

function zipName(name: string): string {
  const stem = name.replace(/\.(?:zip|html?)$/i, '') || 'presentation';
  return stem.slice(0, 236) + '.zip';
}

/**
 * Why a name fails the safe-path rule (safePresentationPath), in words that
 * complete "… because ___": the first character or form that makes it unusable.
 */
export function unusableNameReason(path: string): string {
  if (!path) return 'it has no name';
  if (path.length > 1024) return 'its name is longer than 1,024 characters';
  const character = /[\\:?#%]/.exec(path)?.[0];
  if (character) return `its name contains “${character}”`;
  if (/[\u0000-\u001f\u007f]/.test(path)) return 'its name contains an invisible control character';
  const part = path.split('/').find((segment) => /[. ]$/.test(segment));
  if (part !== undefined) return `the name “${cleanReportedText(part, 80)}” ends with ${part.endsWith(' ') ? 'a space' : 'a dot'}`;
  return 'its name cannot be used in a presentation';
}

/**
 * Turn an archive name into a deck path: backslashes become slashes and empty
 * or "." segments go. Throws for names that try to leave the archive's folder.
 * `usable` is false for names that fail the safe-path rule.
 */
function normalisePath(name: string): { path: string; usable: boolean } {
  const slashed = name.replace(/\\/g, '/');
  if (slashed.startsWith('/') || /^[A-Za-z]:/.test(slashed)
    || slashed.split('/').some((part) => part === '..')) {
    return unreadable('A file path points outside the archive: ' + cleanReportedText(name, 200) + '. Make the ZIP again from the folder that holds the presentation, then open the new ZIP.');
  }
  const path = slashed.split('/').filter((part) => part !== '' && part !== '.').join('/').normalize('NFC');
  return { path, usable: safePresentationPath(path) };
}

/** The upper halves (bytes 0x80 to 0xff) of two DOS code pages that browsers do not decode. */
const CP437_HIGH = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';
const CP850_HIGH = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´­±‗¾¶§÷¸°¨·¹³²■ ';

/** A code page that ZIP tools on Windows use for names without the UTF-8 flag, named in plain words. */
interface CodePage {
  words: string;
  decode: (bytes: Uint8Array) => string | undefined;
}

function tableCodePage(words: string, high: string): CodePage {
  return { words, decode: (bytes) => Array.from(bytes, (byte) => byte < 0x80 ? String.fromCharCode(byte) : high[byte - 0x80]).join('') };
}

function browserCodePage(words: string, label: string): CodePage {
  let decoder: TextDecoder | null | undefined;
  return {
    words,
    decode: (bytes) => {
      if (decoder === undefined) {
        try { decoder = new TextDecoder(label, { fatal: true }); } catch { decoder = null; }
      }
      if (!decoder) return undefined;
      try { return decoder.decode(bytes); } catch { return undefined; }
    },
  };
}

/** In the order they are tried; the earlier one wins a tie. */
const CODE_PAGES: readonly CodePage[] = [
  browserCodePage('GBK (Chinese)', 'gb18030'),
  browserCodePage('Big5 (Traditional Chinese)', 'big5'),
  browserCodePage('Shift_JIS (Japanese)', 'shift_jis'),
  browserCodePage('EUC-KR (Korean)', 'euc-kr'),
  tableCodePage('code page 437 (older Windows in English)', CP437_HIGH),
  tableCodePage('code page 850 (older Windows in Western Europe)', CP850_HIGH),
  browserCodePage('Windows-1252 (Western Europe)', 'windows-1252'),
  browserCodePage('code page 866 (older Windows in Russian)', 'ibm866'),
  browserCodePage('Windows-1251 (Cyrillic)', 'windows-1251'),
  browserCodePage('Windows-1250 (Central Europe)', 'windows-1250'),
];

/**
 * Names read as UTF-8, scored before every code page: names without the
 * UTF-8 flag that are valid UTF-8 are read again only when another code page
 * matches strictly more of them.
 */
const UTF8_PAGE: CodePage = browserCodePage('UTF-8', 'utf-8');

/** At most this many legacy names are scored against the slides' text. */
const LEGACY_SCORED_NAMES = 2000;
/** At most this much of the slides' own text is read to score them. */
const LEGACY_TEXT_BYTES = 8 * 1024 * 1024;
/** Files whose text can name other files. */
const REFERENCING_FILE = /\.(?:html?|css|[cm]?js|md|markdown|json)$/i;
/**
 * Characters that end a file name where the slides write one (quotes,
 * brackets, slashes, spaces, query and fragment marks). Names are compared in
 * pieces between them, so a name with a space still matches.
 */
const NAME_BREAK = /[\s"'`()<>[\]{}=,;:|*?!&#+/\\]+/;
const NON_ASCII = /[^\u0000-\u007f]/;
/** A numeric character reference, as HTML writes a letter it cannot type: &#x5149; or &#20809;. */
const CHARACTER_REFERENCE = /&#(?:[xX]([0-9a-fA-F]{1,6})|([0-9]{1,7}));/g;

/** The pieces of a name or text that hold a non-ASCII letter: the only part that tells code pages apart. */
function telltalePieces(text: string): string[] {
  return text.normalize('NFC').split(NAME_BREAK).filter((piece) => NON_ASCII.test(piece));
}

/** Numeric character references replaced by their characters; others stay as written. */
function withCharacterReferences(text: string): string {
  return text.replace(CHARACTER_REFERENCE, (reference, hex: string | undefined, decimal: string | undefined) => {
    const code = hex ? parseInt(hex, 16) : Number(decimal);
    return code > 0x7f && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : reference;
  });
}

/**
 * Every telltale piece of the slides' text, as written, percent-decoded and
 * with numeric character references read. One pass over the text (two when it
 * has character references).
 */
function textPieces(texts: readonly string[]): Set<string> {
  const pieces = new Set<string>();
  for (const written of texts) {
    for (const text of written.includes('&#') ? [written, withCharacterReferences(written)] : [written]) {
      for (const token of text.normalize('NFC').split(NAME_BREAK)) {
        if (NON_ASCII.test(token)) pieces.add(token);
        else if (token.includes('%')) {
          let decoded: string | undefined;
          try { decoded = decodeURIComponent(token); } catch { decoded = undefined; }
          if (decoded) for (const piece of telltalePieces(decoded)) pieces.add(piece);
        }
      }
    }
  }
  return pieces;
}

/** The order in which files are read as evidence: HTML pages (the shallowest first), then CSS, then the rest. */
function evidenceRank(entry: ArchiveEntry): number {
  const name = entry.name.replace(/\\/g, '/');
  const depth = Math.min(name.split('/').length, 1000);
  if (/\.html?$/i.test(name)) return depth;
  return /\.css$/i.test(name) ? 2000 : 3000;
}

/** The last place at or before `at` where UTF-8 text can be cut without splitting a character. */
function utf8Boundary(data: Uint8Array, at: number): number {
  let cut = at;
  while (cut > 0 && cut > at - 4 && (data[cut] & 0xc0) === 0x80) cut -= 1;
  return cut;
}

/** A path as the deck path rule writes it, for comparing names: slashes, no empty or "." segments, NFC, any case. */
function collisionKey(name: string): string {
  return name.replace(/\\/g, '/').split('/').filter((part) => part !== '' && part !== '.').join('/').normalize('NFC').toLowerCase();
}

/** Whether every telltale piece of a name is in the slides' text (and there is one). */
function named(name: string, pieces: Set<string>): boolean {
  const telltale = telltalePieces(name);
  return telltale.length > 0 && telltale.every((piece) => pieces.has(piece));
}

/**
 * Whether the slides' text names this file when its name is read in this
 * code page: the whole path, or the path below its top-level folder, which is
 * usually the folder that was zipped and that the slides never name.
 */
function matches(page: CodePage, entry: ArchiveEntry, pieces: Set<string>): boolean {
  const name = page.decode(entry.rawName!);
  if (name === undefined) return false;
  if (named(name, pieces)) return true;
  const slash = name.search(/[\\/]/);
  return slash >= 0 && named(name.slice(slash + 1), pieces);
}

/** The code page that the most names match, when it matches at least one; the earlier one wins a tie. */
function bestCodePage(pages: readonly CodePage[], scored: readonly ArchiveEntry[], pieces: Set<string>): CodePage | undefined {
  let best: CodePage | undefined;
  let bestHits = 0;
  for (const page of pages) {
    let hits = 0;
    for (const entry of scored) if (matches(page, entry, pieces)) hits += 1;
    if (hits > bestHits) { best = page; bestHits = hits; }
  }
  return best;
}

/** The note about names that no code page could read, with one example; deck-project makes it a warning when a file is missing. */
export function legacyNamesNote(example: string, missing: boolean): string {
  const shown = cleanReportedText(example, 120);
  return missing
    ? `Some file names in this ZIP (for example ${shown}) are stored in an old spelling that this site could not read, so the slides cannot find those files. Ask your AI assistant to give the files plain names (letters, digits and dashes) and to make the ZIP again.`
    : `Some file names in this ZIP (for example ${shown}) are stored in an old spelling that this site could not read. If nothing is missing in the slides, you can ignore this.`;
}

interface LegacyNames {
  entries: ArchiveEntry[];
  issue?: DeckIssue;
}

/**
 * ZIP tools on Windows that do not set the UTF-8 flag write names in the
 * system's code page. When some names are not flagged and not plain ASCII,
 * read them in each likely code page, count how many of the decoded file
 * names the slides' own text mentions, and use the code page with the most
 * matches. Reading them as UTF-8 is scored first, because tools on Linux and
 * macOS write UTF-8 without the flag: another code page must match strictly
 * more names. When UTF-8 wins, the names that are not valid UTF-8 are scored
 * again on their own. The evidence is the archive's text (HTML first), read
 * once; names are looked up in a set of its pieces, never built into a
 * pattern. Without any match the names stay as they are, with a note.
 */
function readLegacyNames(bytes: Uint8Array, directory: ArchiveEntry[], cache: Map<ArchiveEntry, Uint8Array>): LegacyNames {
  const legacy = directory.filter((entry) => entry.rawName);
  if (!legacy.length) return { entries: directory };
  const texts: string[] = [];
  let budget = LEGACY_TEXT_BYTES;
  // The extension test needs only ASCII bytes, so files with legacy names are read too.
  const readable = directory.filter((entry) => !entry.directory && !isIgnoredPath(entry.name) && REFERENCING_FILE.test(entry.name));
  const ranked = readable.map((entry, index) => ({ entry, index, rank: evidenceRank(entry) }))
    .sort((left, right) => left.rank - right.rank || left.index - right.index);
  for (const { entry } of ranked) {
    if (budget <= 0) break;
    const data = readEntry(bytes, entry, true)!;
    cache.set(entry, data);
    texts.push(decodeText(entry.size > budget ? data.subarray(0, utf8Boundary(data, budget)) : data, entry.name));
    budget -= entry.size;
  }
  const pieces = textPieces(texts);
  const scored = legacy.filter((entry) => !entry.directory).slice(0, LEGACY_SCORED_NAMES);
  let best = bestCodePage([UTF8_PAGE, ...CODE_PAGES], scored, pieces);
  // UTF-8 won, or nothing did: the names that cannot be UTF-8 still need a code page of their own.
  let reread = legacy;
  if (!best || best === UTF8_PAGE) {
    const notUtf8 = (entry: ArchiveEntry) => UTF8_PAGE.decode(entry.rawName!) === undefined;
    reread = legacy.filter(notUtf8);
    if (!reread.length) return { entries: directory };
    best = bestCodePage(CODE_PAGES, scored.filter(notUtf8), pieces);
  }
  if (!best) {
    // Bytes that are control characters when read one per byte show as U+FFFD.
    const example = cleanReportedText(visiblePath((reread.find((entry) => !entry.directory) ?? reread[0]).name), 120);
    return {
      entries: directory,
      issue: { code: 'zip-names-not-utf8', severity: 'info', where: example, message: legacyNamesNote(example, false) },
    };
  }
  const page = best;
  // A name that the slides use as UTF-8 is never read again.
  const rereadSet = new Set(reread.filter((entry) => !matches(UTF8_PAGE, entry, pieces)));
  const taken = new Set(directory.map((entry) => collisionKey(entry.name)));
  const entries = directory.map((entry) => {
    if (!rereadSet.has(entry)) return entry;
    const name = page.decode(entry.rawName!);
    if (name === undefined || name === entry.name || taken.has(collisionKey(name))) return entry;
    taken.add(collisionKey(name));
    return { ...entry, name };
  });
  for (const [index, entry] of entries.entries()) if (cache.has(directory[index])) cache.set(entry, cache.get(directory[index])!);
  return {
    entries,
    issue: {
      code: 'zip-names-code-page', severity: 'info',
      message: `The file names in this ZIP are stored in an old spelling. They were read as ${page.words}, which matches the names the slides use.`,
    },
  };
}

/** The deck path an archive name had before its code page was found, for edits saved under it. */
function earlierPath(name: string): string | undefined {
  try { return normalisePath(name).path; } catch { return undefined; }
}

/**
 * Read a deck ZIP with the same hardened inspection as portable presentation
 * packages: encrypted, ZIP64, multi-volume, linked, overlapping, oversized and
 * damaged entries reject the whole archive, and every entry's CRC is verified.
 * Paths that climb out of the archive reject it too. Other unusable names are
 * skipped and reported, operating-system clutter is ignored, and one wrapping
 * top-level folder is removed.
 */
export async function readDeckArchive(file: File): Promise<DeckArchive> {
  if (!file.size) throw new PresentationPackageError(EMPTY_FILE_MESSAGE);
  if (file.size > PRESENTATION_LIMITS.archiveBytes) {
    throw new PresentationPackageError('Choose a presentation ZIP smaller than 60 MB.');
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const inspected = inspectDirectory(bytes, false);
  // Names in a legacy code page are read again before any path rule applies to them.
  const cache = new Map<ArchiveEntry, Uint8Array>();
  const legacyNames = readLegacyNames(bytes, inspected, cache);
  const directory = legacyNames.entries;
  const issues: DeckIssue[] = legacyNames.issue ? [legacyNames.issue] : [];
  const kept: { path: string; entry: ArchiveEntry; before?: string }[] = [];
  const unusable: string[] = [];
  const unchecked: ArchiveEntry[] = [];
  let skipped = 0;
  for (const [index, entry] of directory.entries()) {
    const { path, usable } = normalisePath(entry.name);
    if (entry.directory) continue;
    if (isIgnoredPath(path)) { unchecked.push(entry); continue; }
    if (!usable) {
      unchecked.push(entry);
      unusable.push(path);
      skipped += 1;
      if (skipped <= NAMED_SKIPS) {
        const shown = cleanReportedText(entry.name, 200);
        issues.push({
          code: 'archive-path-skipped', severity: 'warning', where: shown,
          message: `Skipped ${shown} because ${unusableNameReason(path)}, which cannot be used in a presentation. Rename it, change the references to the new name, and make the ZIP again.`,
        });
      }
      continue;
    }
    const before = inspected[index] !== entry ? earlierPath(inspected[index].name) : undefined;
    kept.push({ path, entry, ...(before !== undefined ? { before } : {}) });
  }
  if (skipped > NAMED_SKIPS) {
    issues.push({
      code: 'archive-path-skipped', severity: 'warning',
      message: `Skipped ${skipped - NAMED_SKIPS} more files whose names cannot be used in a presentation. Rename them and make the ZIP again.`,
    });
  }
  if (!kept.length) unreadable('It contains no usable files. Make the ZIP again from the folder that holds the presentation, then open the new ZIP.');

  const first = kept[0].path.split('/')[0];
  const wrapped = kept.every(({ path }) => path.includes('/') && path.split('/')[0] === first);
  if (wrapped) for (const item of kept) item.path = item.path.slice(first.length + 1);
  const renamed = new Map<string, string>();
  for (const { path, before } of kept) {
    if (before !== undefined) renamed.set(wrapped ? before.slice(before.indexOf('/') + 1) : before, path);
  }
  const skippedFiles = new Map<string, string>();
  for (const path of unusable) {
    skippedFiles.set(wrapped && path.startsWith(first + '/') ? path.slice(first.length + 1) : path, unusableNameReason(path));
  }

  const seen = new Map<string, boolean>();
  for (const { path } of kept) {
    const key = path.toLowerCase();
    if (seen.has(key)) unreadable('It contains duplicate or ambiguous paths: ' + cleanReportedText(path, 200) + '. Rename one of the files, then make the ZIP again.');
    seen.set(key, false);
  }
  for (const { path } of kept) {
    const parts = path.toLowerCase().split('/');
    for (let index = 1; index < parts.length; index += 1) {
      if (seen.get(parts.slice(0, index).join('/')) === false) {
        unreadable('A path is used both as a file and as a folder: ' + cleanReportedText(path, 200) + '. Rename the file or the folder, then make the ZIP again.');
      }
    }
  }

  const files: DeckFiles = new Map();
  for (const { path, entry } of kept.sort((left, right) => left.path.localeCompare(right.path))) {
    const data = cache.get(entry) ?? readEntry(bytes, entry, true)!;
    // Stored entries are views of the whole archive; keep each file independent.
    files.set(path, data.buffer === bytes.buffer ? data.slice() : data);
  }
  // Ignored and skipped files stay in the preserved original, so its sizes and
  // checksums must be honest too. Validate them without keeping a copy.
  for (const entry of unchecked) readEntry(bytes, entry, false);
  const sourceName = baseName(file.name, 'presentation.zip');
  return {
    files,
    archive: file.slice(0, file.size, 'application/zip'),
    fileName: zipName(sourceName),
    sourceName,
    folder: wrapped ? first : '',
    expandedBytes: directory.reduce((sum, entry) => sum + entry.size, 0),
    issues,
    skipped: skippedFiles,
    ...(renamed.size ? { renamed } : {}),
  };
}

/**
 * A single HTML page becomes a one-file deck at index.html, stored as a ZIP
 * like every other deck. The ZIP is deterministic, so importing the same page
 * twice gives the same bytes and the same content hash.
 */
export async function deckFromHtmlFile(file: File): Promise<DeckArchive> {
  if (!file.size) throw new PresentationPackageError('This HTML file is empty, perhaps because the download did not finish. Download it again or ask your AI assistant for the presentation again, then open the new file.');
  if (file.size > PRESENTATION_LIMITS.htmlBytes) {
    throw new PresentationPackageError('Choose an HTML file smaller than 24 MB.');
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const files: DeckFiles = new Map([['index.html', bytes]]);
  const zip = zipDeckFiles(files);
  const sourceName = baseName(file.name, 'presentation.html');
  return {
    files,
    archive: new Blob([new Uint8Array(zip).buffer], { type: 'application/zip' }),
    fileName: zipName(sourceName),
    sourceName,
    folder: '',
    expandedBytes: bytes.length,
    issues: [],
    skipped: new Map(),
  };
}

/** Already-compressed formats are stored rather than deflated again. */
const STORED = /\.(?:png|jpe?g|gif|webp|avif|woff2?|zip|gz|br|mp[34]|m4a|webm|ogg|ogv|opus|pdf)$/i;
/** DOS timestamps are local time; fixed local fields keep output identical everywhere. */
const FIXED_TIME = new Date(1980, 0, 1, 0, 0, 0);

/**
 * fflate collects entries in a plain object, where the key "__proto__" sets
 * the prototype instead of adding an entry. A root file with that name is
 * written under a stand-in name of the same length, renamed in the finished
 * ZIP (names are not covered by the checksums).
 */
const PROTO_KEY = '__proto__';

function standInName(files: DeckFiles): string {
  for (let serial = 0; ; serial += 1) {
    const name = `__qft${String(serial).padStart(3, '0')}_`;
    if (!files.has(name)) return name;
  }
}

function renameEntry(zip: Uint8Array, from: string, to: string): void {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const fromBytes = new TextEncoder().encode(from);
  const toBytes = new TextEncoder().encode(to);
  const eocd = zip.length - 22;
  const count = view.getUint16(eocd + 10, true);
  let position = view.getUint32(eocd + 16, true);
  for (let index = 0; index < count; index += 1) {
    const nameSize = view.getUint16(position + 28, true);
    const name = zip.subarray(position + 46, position + 46 + nameSize);
    if (nameSize === fromBytes.length && name.every((byte, at) => byte === fromBytes[at])) {
      const local = view.getUint32(position + 42, true);
      name.set(toBytes);
      zip.set(toBytes, local + 30);
    }
    position += 46 + nameSize + view.getUint16(position + 30, true) + view.getUint16(position + 32, true);
  }
}

/** Pack deck files into an ordinary ZIP with sorted paths and fixed timestamps. */
export function zipDeckFiles(files: DeckFiles): Uint8Array {
  const input: Zippable = Object.create(null);
  const standIn = files.has(PROTO_KEY) ? standInName(files) : undefined;
  for (const path of [...files.keys()].sort()) {
    if (!safePresentationPath(path)) {
      throw new PresentationPackageError('A file path cannot be stored: ' + cleanReportedText(path, 200));
    }
    input[path === PROTO_KEY ? standIn! : path] = [files.get(path)!, { level: STORED.test(path) ? 0 : 6, mtime: FIXED_TIME }];
  }
  const zip = zipSync(input, { mtime: FIXED_TIME });
  if (standIn) renameEntry(zip, standIn, PROTO_KEY);
  return zip;
}

function decodeWith(label: string, bytes: Uint8Array): string | undefined {
  try { return new TextDecoder(label, { ignoreBOM: false }).decode(bytes); }
  catch { return undefined; }
}

/**
 * Decode a text file without throwing. A byte-order mark wins; then strict
 * UTF-8; then, for HTML, a declared charset near the start; then Windows-1252,
 * which maps every byte.
 */
export function decodeText(bytes: Uint8Array, path = ''): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return decodeWith('utf-8', bytes)!;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return decodeWith('utf-16le', bytes)!;
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return decodeWith('utf-16be', bytes)!;
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { /* not UTF-8 */ }
  if (/\.html?$/i.test(path)) {
    const head = Array.from(bytes.subarray(0, 1024), (byte) => String.fromCharCode(byte)).join('');
    const label = /<meta[^>]*?charset\s*=\s*["']?\s*([A-Za-z0-9_.:-]+)/i.exec(head)?.[1];
    if (label && !/^utf-?(?:8|16)/i.test(label)) {
      const text = decodeWith(label, bytes);
      if (text !== undefined) return text;
    }
  }
  return decodeWith('windows-1252', bytes) ?? decodeWith('utf-8', bytes)!;
}

const MIME_TYPES: Record<string, string> = {
  html: 'text/html', htm: 'text/html', css: 'text/css',
  js: 'text/javascript', mjs: 'text/javascript', cjs: 'text/javascript',
  json: 'application/json', map: 'application/json', md: 'text/markdown', markdown: 'text/markdown',
  txt: 'text/plain', csv: 'text/csv', xml: 'application/xml', svg: 'image/svg+xml',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  avif: 'image/avif', ico: 'image/x-icon', bmp: 'image/bmp',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  eot: 'application/vnd.ms-fontobject',
  mp4: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', mp3: 'audio/mpeg', m4a: 'audio/mp4',
  ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav',
  pdf: 'application/pdf', wasm: 'application/wasm',
};

/** The media type a browser would expect for a deck file, from its extension. */
export function mimeFromPath(path: string): string {
  const extension = /\.([A-Za-z0-9]+)$/.exec(path)?.[1].toLowerCase() ?? '';
  return MIME_TYPES[extension] ?? 'application/octet-stream';
}
