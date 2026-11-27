import { Inflate } from 'fflate';

/** Playback packages contain compiled code. Parsing never executes that code. */
export const PRESENTATION_MANIFEST = 'qft-presentation.json';
export const PRESENTATION_LIMITS = Object.freeze({
  archiveBytes: 60 * 1024 * 1024,
  expandedBytes: 120 * 1024 * 1024,
  htmlBytes: 24 * 1024 * 1024,
  fileBytes: 40 * 1024 * 1024,
  files: 1000,
  manifestBytes: 32 * 1024,
  sourcePreviewBytes: 2 * 1024 * 1024,
  allSourcePreviewBytes: 8 * 1024 * 1024,
});

export interface PresentationManifest {
  format: 'qft-presentation';
  version: 1;
  engine: 'slidev';
  title: string;
  entry: string;
  source?: string;
  aspectRatio?: '16:9' | '4:3';
  generator?: string;
}

export interface PresentationFile {
  path: string;
  size: number;
  /** Inert text for the source viewer; larger/binary files stay in the ZIP. */
  content?: string;
}

export interface PresentationPackage {
  manifest: PresentationManifest;
  html: string;
  files: PresentationFile[];
  archive: Blob;
  fileName: string;
  expandedBytes: number;
}

export class PresentationPackageError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PresentationPackageError';
  }
}

/** One central-directory record, already checked against its local header. */
export interface ArchiveEntry {
  name: string;
  size: number;
  compressedSize: number;
  method: number;
  crc: number;
  start: number;
  end: number;
  directory: boolean;
  /**
   * The name's bytes, kept only when the name is in an unknown legacy code
   * page: not flagged UTF-8, no Unicode Path field, and not valid UTF-8. The
   * name above then has one character per byte.
   */
  rawName?: Uint8Array;
}

const invalidZip = (detail: string): never => {
  throw new PresentationPackageError('This ZIP could not be opened. ' + detail);
};

/** What to do about a ZIP whose structure is broken: almost always a download that did not finish. */
const REMAKE = 'Download it again or make the ZIP again, then open the new file.';

const damagedZip = (reason: string): never => {
  throw new PresentationPackageError(`This ZIP could not be opened: ${reason}. ${REMAKE}`);
};

/** Keep identifiers literal: URL escapes and platform-specific paths are not paths. */
export function safePresentationPath(path: string): boolean {
  return path.length > 0 && path.length <= 1024
    && !/[\\:\u0000-\u001f\u007f?#%]/.test(path)
    && !path.startsWith('/')
    && path.split('/').every((part) => part !== '' && part !== '.' && part !== '..'
      && !/[. ]$/.test(part));
}

/** Operating-system clutter that archivers add; never part of a deck. */
export function isIgnoredPath(path: string): boolean {
  return path.startsWith('__MACOSX/')
    || /(?:^|\/)(?:\.DS_Store|Thumbs\.db|desktop\.ini)$/.test(path);
}

function decodeText(bytes: Uint8Array, name: string): string {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new PresentationPackageError('The file "' + name + '" must contain valid UTF-8 text.'); }
}

function strictUtf8(bytes: Uint8Array): string | undefined {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { return undefined; }
}

/**
 * The name in an Info-ZIP Unicode Path extra field (0x7075), when there is one
 * whose checksum matches the plain name it stands for.
 */
function unicodePathField(extra: Uint8Array, nameBytes: Uint8Array): string | undefined {
  for (let at = 0; at + 4 <= extra.length;) {
    const id = extra[at] | (extra[at + 1] << 8);
    const size = extra[at + 2] | (extra[at + 3] << 8);
    if (at + 4 + size > extra.length) return undefined;
    if (id === 0x7075 && size > 5 && extra[at + 4] === 1) {
      const crc = (extra[at + 5] | (extra[at + 6] << 8) | (extra[at + 7] << 16) | (extra[at + 8] << 24)) >>> 0;
      if (crc === crc32(nameBytes)) return strictUtf8(extra.subarray(at + 9, at + 4 + size));
    }
    at += 4 + size;
  }
  return undefined;
}

/**
 * A ZIP entry's name. With the UTF-8 flag (bit 11) the bytes must be UTF-8.
 * Without it, a matching Unicode Path extra field wins; then the bytes are
 * used as UTF-8 when they are valid UTF-8, which is what Info-ZIP's zip and
 * most tools on Linux and macOS write without setting the flag. Only bytes
 * that are not UTF-8 fall back to one character per byte (or, strict, are refused).
 */
function filename(bytes: Uint8Array, utf8: boolean, strict: boolean, extra: Uint8Array): { name: string; legacy: boolean } {
  if (utf8) return { name: decodeText(bytes, 'ZIP filename'), legacy: false };
  const unicode = unicodePathField(extra, bytes);
  if (unicode) return { name: unicode, legacy: false };
  if (!bytes.some((byte) => byte > 127)) return { name: decodeText(bytes, 'ZIP filename'), legacy: false };
  const decoded = strictUtf8(bytes);
  if (decoded !== undefined) return { name: decoded, legacy: false };
  if (strict) return invalidZip('Its file names are not stored as UTF-8. Make the ZIP with a tool that stores UTF-8 names, then open the new ZIP.');
  return { name: Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''), legacy: true };
}

/**
 * Entry names as the decoder above reads them, by the name fflate gives the
 * same entry (UTF-8 when flagged, one character per byte otherwise). For
 * readers built on fflate's unzip; an archive this cannot walk gives an empty map.
 */
export function zipEntryNames(bytes: Uint8Array): Map<string, string> {
  const names = new Map<string, string>();
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 65535); at -= 1) {
      if (view.getUint32(at, true) === 0x06054b50) { eocd = at; break; }
    }
    if (eocd < 0) return names;
    const count = view.getUint16(eocd + 10, true);
    let position = view.getUint32(eocd + 16, true);
    for (let index = 0; index < count && position + 46 <= eocd; index += 1) {
      if (view.getUint32(position, true) !== 0x02014b50) break;
      const flags = view.getUint16(position + 8, true);
      const nameSize = view.getUint16(position + 28, true);
      const extraSize = view.getUint16(position + 30, true);
      const commentSize = view.getUint16(position + 32, true);
      const nameBytes = bytes.subarray(position + 46, position + 46 + nameSize);
      const extra = bytes.subarray(position + 46 + nameSize, position + 46 + nameSize + extraSize);
      if (!(flags & 0x800)) {
        const raw = Array.from(nameBytes, (byte) => String.fromCharCode(byte)).join('');
        const { name } = filename(nameBytes, false, false, extra);
        if (name !== raw) names.set(raw, name);
      }
      position += 46 + nameSize + extraSize + commentSize;
    }
  } catch { names.clear(); }
  return names;
}

/**
 * Inspect the central directory before allocating decompressed buffers.
 * Local records are checked against it, including byte ranges and CRCs below.
 * ZIP64, encrypted files, links, and multi-volume archives are deliberately excluded.
 * With strictPaths false, names, duplicates and file/folder clashes are left
 * to the caller, which must check them before using any path.
 */
export function inspectDirectory(bytes: Uint8Array, strictPaths = true): ArchiveEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 22) return damagedZip('it is too short to be a ZIP');
  let eocd = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 65535); at -= 1) {
    if (view.getUint32(at, true) === 0x06054b50
      && at + 22 + view.getUint16(at + 20, true) === bytes.length) {
      eocd = at;
      break;
    }
  }
  if (eocd < 0) {
    throw new PresentationPackageError(`This ZIP is damaged or incomplete, perhaps because the download did not finish. ${REMAKE}`);
  }
  const count = view.getUint16(eocd + 10, true);
  const directorySize = view.getUint32(eocd + 12, true);
  const directoryStart = view.getUint32(eocd + 16, true);
  if (view.getUint16(eocd + 4, true) !== 0 || view.getUint16(eocd + 6, true) !== 0
    || view.getUint16(eocd + 8, true) !== count) return invalidZip('Multi-volume ZIPs are not supported. Make one ordinary ZIP of the folder, then open it.');
  if (count === 0xffff || directorySize === 0xffffffff || directoryStart === 0xffffffff) {
    return invalidZip('ZIP64 archives are not supported. Make an ordinary ZIP of the folder, then open it.');
  }
  if (count > PRESENTATION_LIMITS.files) {
    throw new PresentationPackageError('This ZIP has more than 1,000 files and folders. Keep at most 1,000 (leave out files the slides do not use), then make the ZIP again.');
  }
  if (directoryStart + directorySize !== eocd) return damagedZip('the boundaries of its file directory are wrong');
  let position = directoryStart;
  let total = 0;
  const entries: ArchiveEntry[] = [];
  const paths = new Map<string, boolean>();
  const ranges: { start: number; end: number }[] = [];
  for (let index = 0; index < count; index += 1) {
    if (position + 46 > eocd || view.getUint32(position, true) !== 0x02014b50) {
      return damagedZip('its file directory is damaged');
    }
    const flags = view.getUint16(position + 8, true);
    const method = view.getUint16(position + 10, true);
    const crc = view.getUint32(position + 16, true);
    const compressedSize = view.getUint32(position + 20, true);
    const size = view.getUint32(position + 24, true);
    const nameSize = view.getUint16(position + 28, true);
    const extraSize = view.getUint16(position + 30, true);
    const commentSize = view.getUint16(position + 32, true);
    const disk = view.getUint16(position + 34, true);
    const attributes = view.getUint32(position + 38, true);
    const localStart = view.getUint32(position + 42, true);
    const nameStart = position + 46;
    const next = nameStart + nameSize + extraSize + commentSize;
    if (next > eocd || !nameSize) return damagedZip('a file name in it is missing or cut off');
    const nameBytes = bytes.subarray(nameStart, nameStart + nameSize);
    const { name, legacy } = filename(nameBytes, !!(flags & 0x800), strictPaths, bytes.subarray(nameStart + nameSize, nameStart + nameSize + extraSize));
    const directory = name.endsWith('/');
    const path = directory ? name.slice(0, -1) : name;
    if (strictPaths && !safePresentationPath(path)) return invalidZip('An archive path is invalid: ' + name + '. Rename it using plain letters, digits and dashes, then make the ZIP again.');
    const normalized = path.normalize('NFC').toLowerCase();
    if (strictPaths && paths.has(normalized)) return invalidZip('The ZIP contains duplicate or ambiguous paths: ' + name + '. Rename one of the files, then make the ZIP again.');
    paths.set(normalized, directory);
    if (flags & 0x41) return invalidZip('Encrypted ZIP files are not supported. Make the ZIP again without a password.');
    if (disk || size === 0xffffffff || compressedSize === 0xffffffff || localStart === 0xffffffff) {
      return invalidZip('ZIP64 and multi-volume entries are not supported. Make an ordinary ZIP of the folder, then open it.');
    }
    if (((attributes >>> 16) & 0xf000) === 0xa000) return invalidZip('Symbolic links are not supported. Put the files themselves in the folder, then make the ZIP again.');
    if (method !== 0 && method !== 8) return invalidZip('It uses a compression method the site cannot read. Make the ZIP again with ordinary (Deflate) compression.');
    if (size > PRESENTATION_LIMITS.fileBytes) return invalidZip('A file in it is larger than 40 MB. Make that file smaller or leave it out, then make the ZIP again.');
    total += size;
    if (total > PRESENTATION_LIMITS.expandedBytes) return invalidZip('Its files are larger than 120 MB together. Leave out files the slides do not use, or make pictures and videos smaller, then make the ZIP again.');
    if (size > 1024 * 1024 && size / Math.max(1, compressedSize) > 1000) {
      return invalidZip('A file in it expands to far more than its compressed size, which the site does not accept. Make the ZIP again from the original files, then open the new ZIP.');
    }
    if (directory && size) return damagedZip('a folder entry holds data');
    if (localStart + 30 > directoryStart || view.getUint32(localStart, true) !== 0x04034b50) {
      return damagedZip('a file record is missing');
    }
    const localNameSize = view.getUint16(localStart + 26, true);
    const localExtraSize = view.getUint16(localStart + 28, true);
    const start = localStart + 30 + localNameSize + localExtraSize;
    const end = start + compressedSize;
    if (end > directoryStart || start > end
      || view.getUint16(localStart + 6, true) !== flags
      || view.getUint16(localStart + 8, true) !== method
      || localNameSize !== nameSize
      || !nameBytes.every((byte, i) => bytes[localStart + 30 + i] === byte)) {
      return damagedZip('a file does not match its directory record');
    }
    if (!(flags & 8) && (view.getUint32(localStart + 14, true) !== crc
      || view.getUint32(localStart + 18, true) !== compressedSize
      || view.getUint32(localStart + 22, true) !== size)) {
      return damagedZip('a file has inconsistent size or checksum data');
    }
    if (method === 0 && size !== compressedSize) return damagedZip('an uncompressed file has a wrong size');
    ranges.push({ start: localStart, end });
    entries.push({ name, size, compressedSize, method, crc, start, end, directory, ...(legacy ? { rawName: nameBytes.slice() } : {}) });
    position = next;
  }
  if (position !== eocd) return damagedZip('its file directory holds unexpected data');
  ranges.sort((a, b) => a.start - b.start);
  for (let index = 1; index < ranges.length; index += 1) {
    if (ranges[index].start < ranges[index - 1].end) return damagedZip('its file records overlap');
  }
  for (const [path] of strictPaths ? paths : []) {
    const parts = path.split('/');
    for (let index = 1; index < parts.length; index += 1) {
      if (paths.get(parts.slice(0, index).join('/')) === false) {
        return invalidZip('A path is used both as a file and as a folder. Rename the file or the folder, then make the ZIP again.');
      }
    }
  }
  return entries;
}

const crcTable = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  crcTable[index] = crc >>> 0;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Inflate one entry with bounded steps and verify its size and CRC. With
 * retain false the data is only validated, never kept.
 */
export function readEntry(bytes: Uint8Array, entry: ArchiveEntry, retain: boolean): Uint8Array | undefined {
  let result: Uint8Array | undefined;
  let written = 0;
  let crc = 0xffffffff;
  const consume = (chunk: Uint8Array) => {
    if (written + chunk.length > entry.size) throw new Error('Inflated data exceeds its declared size.');
    result?.set(chunk, written);
    written += chunk.length;
    for (const byte of chunk) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  };
  try {
    const compressed = bytes.subarray(entry.start, entry.end);
    if (entry.method === 0) {
      consume(compressed);
      if (retain) result = compressed;
    }
    else {
      if (retain) result = new Uint8Array(entry.size);
      // Bound each inflation step as well as the final allocation. A forged
      // small directory size must not disguise a much larger deflate stream.
      const inflater = new Inflate(consume);
      for (let at = 0; at < compressed.length; at += 4096) {
        const end = Math.min(at + 4096, compressed.length);
        inflater.push(compressed.subarray(at, end), end === compressed.length);
      }
      if (!compressed.length || written !== entry.size) throw new Error('Inflated data does not match its declared size.');
    }
  } catch (error) {
    throw new PresentationPackageError(`The ZIP contains a damaged file: ${entry.name}. ${REMAKE}`, { cause: error });
  }
  if (written !== entry.size || ((crc ^ 0xffffffff) >>> 0) !== entry.crc) {
    throw new PresentationPackageError(`The ZIP contains a damaged file: ${entry.name}. ${REMAKE}`);
  }
  return result;
}

function extract(bytes: Uint8Array, entry: ArchiveEntry): Uint8Array {
  return readEntry(bytes, entry, true)!;
}

function parseManifest(bytes: Uint8Array): PresentationManifest {
  let value: unknown;
  try { value = JSON.parse(decodeText(bytes, PRESENTATION_MANIFEST).replace(/^\uFEFF/, '')); }
  catch (error) { throw new PresentationPackageError('The presentation manifest is not valid JSON.', { cause: error }); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PresentationPackageError('The presentation manifest must be an object.');
  }
  const data = value as Record<string, unknown>;
  if (data.format !== 'qft-presentation' || data.version !== 1 || data.engine !== 'slidev') {
    throw new PresentationPackageError('This presentation package version is not supported. Use the current Slidev packaging tool.');
  }
  if (typeof data.title !== 'string' || !data.title.trim() || data.title.length > 200 || /[\u0000-\u001f]/.test(data.title)) {
    throw new PresentationPackageError('The presentation needs a title of 1–200 characters.');
  }
  if (typeof data.entry !== 'string' || !safePresentationPath(data.entry) || !/\.html?$/i.test(data.entry)) {
    throw new PresentationPackageError('The presentation manifest needs a valid HTML entry file.');
  }
  if (data.source !== undefined && (typeof data.source !== 'string' || !safePresentationPath(data.source)
    || !/\.(?:md|markdown)$/i.test(data.source))) {
    throw new PresentationPackageError('The presentation source must point to a Markdown file.');
  }
  if (data.aspectRatio !== undefined && data.aspectRatio !== '16:9' && data.aspectRatio !== '4:3') {
    throw new PresentationPackageError('The supported presentation sizes are 16:9 and 4:3.');
  }
  if (data.generator !== undefined && (typeof data.generator !== 'string' || data.generator.length > 200)) {
    throw new PresentationPackageError('The presentation generator metadata is invalid.');
  }
  return {
    format: 'qft-presentation', version: 1, engine: 'slidev',
    title: data.title.trim(), entry: data.entry,
    ...(typeof data.source === 'string' ? { source: data.source } : {}),
    ...(data.aspectRatio ? { aspectRatio: data.aspectRatio as '16:9' | '4:3' } : {}),
    ...(typeof data.generator === 'string' ? { generator: data.generator } : {}),
  };
}

/** Files the source viewer and editor treat as text. */
export function isTextPath(path: string): boolean {
  return /\.(?:md|markdown|vue|[cm]?[jt]sx?|json|css|scss|sass|less|txt|ya?ml|html?|svg|toml|xml|csv)$/i.test(path)
    || /(?:^|\/)(?:LICENSE(?:\.[^/]+)?|README|\.gitignore|\.npmrc)$/i.test(path);
}

/**
 * Check a portable presentation package (a ZIP with qft-presentation.json).
 * Returns null for a ZIP without that manifest: Markdown bundles, lessons and
 * other decks are read elsewhere (deck-project.ts sends only packages here).
 * The File bytes stay in the browser and the original ZIP is retained unchanged.
 */
export async function inspectPresentationArchive(file: File): Promise<PresentationPackage | null> {
  if (!file.size || file.size > PRESENTATION_LIMITS.archiveBytes) {
    throw new PresentationPackageError('Choose a presentation ZIP smaller than 60 MB.');
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  // Identify the format before applying the portable player's stricter path
  // rules. Ordinary Markdown bundles retain their existing filename support.
  const directory = inspectDirectory(bytes, false);
  const entries = directory.filter((entry) => !entry.directory && !isIgnoredPath(entry.name));
  const manifests = entries.filter((entry) => entry.name === PRESENTATION_MANIFEST
    || entry.name.endsWith('/' + PRESENTATION_MANIFEST));
  if (!manifests.length) return null;
  inspectDirectory(bytes);
  if (manifests.length !== 1) throw new PresentationPackageError('Choose a ZIP containing one presentation package.');
  const manifestEntry = manifests[0];
  if (manifestEntry.size > PRESENTATION_LIMITS.manifestBytes) {
    throw new PresentationPackageError('The presentation manifest exceeds 32 KB.');
  }
  const prefix = manifestEntry.name.slice(0, -PRESENTATION_MANIFEST.length);
  if (entries.some((entry) => !entry.name.startsWith(prefix))) {
    throw new PresentationPackageError('The ZIP contains files outside its presentation folder.');
  }
  const manifest = parseManifest(extract(bytes, manifestEntry));
  const verified = new Set<ArchiveEntry>([manifestEntry]);
  const byPath = new Map(entries.map((entry) => [entry.name.slice(prefix.length), entry]));
  const htmlEntry = byPath.get(manifest.entry);
  if (!htmlEntry) throw new PresentationPackageError('The playable HTML file is missing: ' + manifest.entry);
  if (htmlEntry.size > PRESENTATION_LIMITS.htmlBytes) throw new PresentationPackageError('The playable HTML file exceeds 24 MB.');
  const html = decodeText(extract(bytes, htmlEntry), manifest.entry);
  verified.add(htmlEntry);
  if (!/<html(?:\s|>)/i.test(html) || !/<body(?:\s|>)/i.test(html)) {
    throw new PresentationPackageError('The entry file must be a complete, built HTML presentation.');
  }
  if (manifest.source && !byPath.has(manifest.source)) {
    throw new PresentationPackageError('The declared source file is missing: ' + manifest.source);
  }
  let textBudget = PRESENTATION_LIMITS.allSourcePreviewBytes;
  const files: PresentationFile[] = [];
  const ordered = [...byPath.entries()].sort(([left], [right]) =>
    left === manifest.source ? -1 : right === manifest.source ? 1 : left.localeCompare(right));
  for (const [path, entry] of ordered) {
    const value: PresentationFile = { path, size: entry.size };
    if (path !== manifest.entry && isTextPath(path)
      && entry.size <= PRESENTATION_LIMITS.sourcePreviewBytes && entry.size <= textBudget) {
      value.content = decodeText(extract(bytes, entry), path);
      verified.add(entry);
      textBudget -= entry.size;
    }
    files.push(value);
  }
  // Binary, large, and ignored files remain inert, but the ZIP we preserve must
  // also have honest sizes/checksums when the teacher later extracts its source.
  // Stream their validation without retaining a decompressed copy.
  for (const entry of directory) if (!verified.has(entry)) readEntry(bytes, entry, false);
  return {
    manifest, html, files,
    archive: file.slice(0, file.size, 'application/zip'),
    fileName: file.name.split(/[\\/]/).pop()?.slice(0, 240) || 'presentation.zip',
    expandedBytes: directory.reduce((sum, entry) => sum + entry.size, 0),
  };
}
