import { zipSync, type Zippable } from 'fflate';
import {
  inspectDirectory, isIgnoredPath, isTextPath, readEntry, safePresentationPath,
  PRESENTATION_LIMITS, PresentationPackageError, type ArchiveEntry,
} from './presentation-package';
import { cleanReportedText } from './presentation-messages';
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
 * Turn an archive name into a deck path: backslashes become slashes and empty
 * or "." segments go. Throws for names that try to leave the archive's folder.
 * `usable` is false for names that fail the safe-path rule.
 */
function normalisePath(name: string): { path: string; usable: boolean } {
  const slashed = name.replace(/\\/g, '/');
  if (slashed.startsWith('/') || /^[A-Za-z]:/.test(slashed)
    || slashed.split('/').some((part) => part === '..')) {
    return unreadable('A file path points outside the archive: ' + cleanReportedText(name, 200));
  }
  const path = slashed.split('/').filter((part) => part !== '' && part !== '.').join('/').normalize('NFC');
  return { path, usable: safePresentationPath(path) };
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
  if (!file.size || file.size > PRESENTATION_LIMITS.archiveBytes) {
    throw new PresentationPackageError('Choose a presentation ZIP smaller than 60 MB.');
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const directory = inspectDirectory(bytes, false);
  const issues: DeckIssue[] = [];
  const kept: { path: string; entry: ArchiveEntry }[] = [];
  const unchecked: ArchiveEntry[] = [];
  let skipped = 0;
  for (const entry of directory) {
    const { path, usable } = normalisePath(entry.name);
    if (entry.directory) continue;
    if (isIgnoredPath(path)) { unchecked.push(entry); continue; }
    if (!usable) {
      unchecked.push(entry);
      skipped += 1;
      if (skipped <= NAMED_SKIPS) {
        const shown = cleanReportedText(entry.name, 200);
        issues.push({
          code: 'archive-path-skipped', severity: 'warning', where: shown,
          message: 'Skipped a file whose name cannot be used in a presentation: ' + shown,
        });
      }
      continue;
    }
    kept.push({ path, entry });
  }
  if (skipped > NAMED_SKIPS) {
    issues.push({
      code: 'archive-path-skipped', severity: 'warning',
      message: `Skipped ${skipped - NAMED_SKIPS} more files whose names cannot be used in a presentation.`,
    });
  }
  if (!kept.length) unreadable('It contains no usable files.');

  const first = kept[0].path.split('/')[0];
  const wrapped = kept.every(({ path }) => path.includes('/') && path.split('/')[0] === first);
  if (wrapped) for (const item of kept) item.path = item.path.slice(first.length + 1);

  const seen = new Map<string, boolean>();
  for (const { path } of kept) {
    const key = path.toLowerCase();
    if (seen.has(key)) unreadable('It contains duplicate or ambiguous paths: ' + cleanReportedText(path, 200));
    seen.set(key, false);
  }
  for (const { path } of kept) {
    const parts = path.toLowerCase().split('/');
    for (let index = 1; index < parts.length; index += 1) {
      if (seen.get(parts.slice(0, index).join('/')) === false) {
        unreadable('A path is used both as a file and as a folder: ' + cleanReportedText(path, 200));
      }
    }
  }

  const files: DeckFiles = new Map();
  for (const { path, entry } of kept.sort((left, right) => left.path.localeCompare(right.path))) {
    const data = readEntry(bytes, entry, true)!;
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
  };
}

/**
 * A single HTML page becomes a one-file deck at index.html, stored as a ZIP
 * like every other deck. The ZIP is deterministic, so importing the same page
 * twice gives the same bytes and the same content hash.
 */
export async function deckFromHtmlFile(file: File): Promise<DeckArchive> {
  if (!file.size || file.size > PRESENTATION_LIMITS.htmlBytes) {
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
