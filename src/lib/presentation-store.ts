import { scopedStorageKey } from './storage-scope';
import { PRESENTATION_LIMITS, safePresentationPath, type PresentationPackage } from './presentation-package';
import { isDeckEngine, isDeckKind, type DeckEngine, type DeckKind } from './deck-types';

export interface StoredPresentationInfo {
  id: string;
  title: string;
  engine: DeckEngine;
  kind: StoredDeckKind;
  fileName: string;
  archiveSize: number;
  createdAt: number;
  updatedAt: number;
  /** SHA-256 of the original archive, lowercase hex. Records saved by version 1 have none until compared. */
  hash?: string;
  /** True while the record carries a text-edit overlay. */
  edited?: boolean;
  /** The HTML page that plays the deck, relative to the archive root. */
  entry?: string;
  source?: string;
  aspectRatio?: '16:9' | '4:3';
}

/** Path to replacement text, kept beside the original archive, which is never rewritten. */
export type DeckEdits = Record<string, string>;

export interface StoredPresentation extends StoredPresentationInfo {
  archive: Blob;
  edits?: DeckEdits;
  /** Set when an overlay exists but could not be read. It stays in storage untouched. */
  editsUnreadable?: boolean;
}

export interface PresentationListing {
  presentations: StoredPresentationInfo[];
  /** Records that could not be validated. They are left in storage untouched. */
  skipped: number;
}

export interface SaveDeckInput {
  title: string;
  engine: DeckEngine;
  kind: StoredDeckKind;
  fileName: string;
  archive: Blob;
  entry?: string;
  source?: string;
  aspectRatio?: '16:9' | '4:3';
  edits?: DeckEdits | Map<string, string>;
}

export interface SaveDeckResult {
  info: StoredPresentationInfo;
  /** True when an identical archive was already saved; that record is returned unchanged. */
  existing: boolean;
}

/** The kinds that can be stored and played. The rest are explained, not saved. */
export type StoredDeckKind = Extract<DeckKind, 'qft-presentation' | 'reveal' | 'html' | 'slidev-build'>;

const KIND_ENGINES: Readonly<Record<StoredDeckKind, DeckEngine>> = Object.freeze({
  'qft-presentation': 'slidev',
  'slidev-build': 'slidev',
  reveal: 'reveal',
  html: 'html',
});

/** Kinds whose stored source is what plays, so editing it changes the deck. */
const EDITABLE_KINDS: readonly StoredDeckKind[] = Object.freeze(['reveal', 'html']);

export const DECK_EDIT_LIMITS = Object.freeze({
  fileBytes: 2 * 1024 * 1024,
  totalBytes: 8 * 1024 * 1024,
  files: PRESENTATION_LIMITS.files,
});

export function isStoredDeckKind(value: unknown): value is StoredDeckKind {
  return isDeckKind(value) && Object.hasOwn(KIND_ENGINES, value);
}

export function isEditableDeckKind(value: unknown): boolean {
  return typeof value === 'string' && (EDITABLE_KINDS as readonly string[]).includes(value);
}

/**
 * Version 2 adds decks of every engine, a content hash and a text-edit
 * overlay. Version 1 records are kept as they are and read as portable Slidev
 * packages; opening version 2 also closes version 1 tabs, whose stricter
 * listing could not read the new records.
 */
const DATABASE_VERSION = 2;
const DATABASE_NAME = scopedStorageKey('qft-presentations');
const METADATA_STORE = 'presentations';
const ARCHIVE_STORE = 'archives';
const HASH_INDEX = 'hash';
let connection: Promise<IDBDatabase> | undefined;
let connectionFactory: IDBFactory | undefined;

export class PresentationStorageError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PresentationStorageError';
  }
}

function storageError(error: unknown): PresentationStorageError {
  if (error instanceof PresentationStorageError) return error;
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
  return new PresentationStorageError(name === 'QuotaExceededError'
    ? 'Browser storage is full. Keep the original ZIP, then remove presentations you no longer need.'
    : 'This presentation could not be saved or reopened in this browser. Keep the original ZIP so you can open it again.',
  { cause: error });
}

function openDatabase(): Promise<IDBDatabase> {
  let factory: IDBFactory;
  try { factory = globalThis.indexedDB; } catch (error) { return Promise.reject(storageError(error)); }
  if (!factory) return Promise.reject(new PresentationStorageError('Local presentation storage is unavailable. Keep the original ZIP to reopen your presentation.'));
  if (connectionFactory !== factory) {
    connection?.then((db) => db.close(), () => {});
    connection = undefined;
    connectionFactory = factory;
  }
  if (connection) return connection;
  let pending: Promise<IDBDatabase>;
  pending = new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try { request = factory.open(DATABASE_NAME, DATABASE_VERSION); }
    catch (error) { reject(storageError(error)); return; }
    let finished = false;
    request.onupgradeneeded = () => {
      // Structural changes only: existing records are never rewritten here.
      const db = request.result;
      const metadata = db.objectStoreNames.contains(METADATA_STORE)
        ? request.transaction!.objectStore(METADATA_STORE)
        : db.createObjectStore(METADATA_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(ARCHIVE_STORE)) db.createObjectStore(ARCHIVE_STORE, { keyPath: 'id' });
      if (!metadata.indexNames.contains(HASH_INDEX)) metadata.createIndex(HASH_INDEX, 'hash', { unique: false });
    };
    request.onerror = () => { finished = true; reject(storageError(request.error)); };
    request.onblocked = () => {
      finished = true;
      reject(new PresentationStorageError('Close other tabs using this presentation library, then try again.'));
    };
    request.onsuccess = () => {
      const db = request.result;
      if (finished) { db.close(); return; }
      finished = true;
      db.onversionchange = () => {
        db.close();
        if (connection === pending) connection = undefined;
      };
      resolve(db);
    };
  });
  connection = pending;
  pending.catch(() => { if (connection === pending) connection = undefined; });
  return pending;
}

const damaged = () => new PresentationStorageError('A saved presentation record is damaged. Its data has been preserved.');

function isHash(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function validateInfo(value: unknown): StoredPresentationInfo {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw damaged();
  const info = value as Partial<StoredPresentationInfo> & Record<string, unknown>;
  // Version 1 stored only portable Slidev packages and had no kind.
  const kind = info.kind === undefined && info.engine === 'slidev' ? 'qft-presentation' : info.kind;
  if (typeof info.id !== 'string' || !info.id || typeof info.title !== 'string'
    || !info.title || info.title.length > 200
    || !isDeckEngine(info.engine) || !isStoredDeckKind(kind) || KIND_ENGINES[kind] !== info.engine
    || typeof info.fileName !== 'string' || !info.fileName || info.fileName.length > 240
    || !Number.isSafeInteger(info.archiveSize) || info.archiveSize! <= 0 || info.archiveSize! > PRESENTATION_LIMITS.archiveBytes
    || !Number.isFinite(info.createdAt) || !Number.isFinite(info.updatedAt)
    || (info.hash !== undefined && !isHash(info.hash))
    || (info.edited !== undefined && typeof info.edited !== 'boolean')
    || (info.entry !== undefined && (typeof info.entry !== 'string' || !safePresentationPath(info.entry)))
    || (info.source !== undefined && typeof info.source !== 'string')
    || (info.aspectRatio !== undefined && !['16:9', '4:3'].includes(info.aspectRatio))) {
    throw damaged();
  }
  return {
    id: info.id, title: info.title, engine: info.engine, kind,
    fileName: info.fileName, archiveSize: info.archiveSize!,
    createdAt: info.createdAt!, updatedAt: info.updatedAt!,
    ...(info.hash !== undefined ? { hash: info.hash } : {}),
    ...(info.edited ? { edited: true } : {}),
    ...(info.entry !== undefined ? { entry: info.entry } : {}),
    ...(info.source !== undefined ? { source: info.source } : {}),
    ...(info.aspectRatio !== undefined ? { aspectRatio: info.aspectRatio } : {}),
  };
}

const utf8 = new TextEncoder();

/** Validate an overlay against the per-file and total limits; returns a plain copy. */
function validateEdits(value: unknown): DeckEdits {
  const entries = value instanceof Map ? [...value.entries()]
    : value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value) : undefined;
  if (!entries) throw new PresentationStorageError('The edited files could not be saved.');
  if (entries.length > DECK_EDIT_LIMITS.files) throw new PresentationStorageError('Too many edited files to save.');
  const result: DeckEdits = Object.create(null);
  let total = 0;
  for (const [path, text] of entries) {
    if (typeof path !== 'string' || !safePresentationPath(path) || typeof text !== 'string') {
      throw new PresentationStorageError('The edited files could not be saved.');
    }
    const size = utf8.encode(text).length;
    if (size > DECK_EDIT_LIMITS.fileBytes) {
      throw new PresentationStorageError(`The edited file "${path}" is larger than 2 MB. Shorten it, or edit it outside the browser.`);
    }
    total += size;
    if (total > DECK_EDIT_LIMITS.totalBytes) {
      throw new PresentationStorageError('The edited files together are larger than 8 MB. Revert some edits, or edit the files outside the browser.');
    }
    result[path] = text;
  }
  return { ...result };
}

async function transaction<T>(
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction, result: (value: T) => void, fail: (error: unknown) => void) => void,
): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction;
    try { tx = db.transaction([METADATA_STORE, ARCHIVE_STORE], mode); }
    catch (error) { reject(storageError(error)); return; }
    let result: T;
    let failure: unknown;
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(storageError(failure ?? tx.error));
    const fail = (error: unknown) => {
      failure = error;
      try { tx.abort(); } catch { reject(storageError(error)); }
    };
    try { work(tx, (value) => { result = value; }, fail); }
    catch (error) { fail(error); }
  });
}

function createId(): string {
  const provider = globalThis.crypto;
  if (typeof provider?.randomUUID === 'function') return provider.randomUUID();
  if (typeof provider?.getRandomValues !== 'function') throw new PresentationStorageError('Open the site in a current browser to save presentations.');
  const bytes = provider.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

/** SHA-256 of a blob as lowercase hex, computed locally with Web Crypto. */
export async function hashArchive(archive: Blob): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (typeof subtle?.digest !== 'function') {
    throw new PresentationStorageError('Open the site in a current browser to save presentations.');
  }
  const digest = new Uint8Array(await subtle.digest('SHA-256', await archive.arrayBuffer()));
  return Array.from(digest, (value) => value.toString(16).padStart(2, '0')).join('');
}

/**
 * Listing never reads or decompresses large presentation archives. A record
 * that cannot be validated is counted and left in storage, so one damaged
 * entry does not hide the others.
 */
export async function listPresentationsDetailed(): Promise<PresentationListing> {
  return transaction('readonly', (tx, result) => {
    const request = tx.objectStore(METADATA_STORE).getAll();
    request.onsuccess = () => {
      const presentations: StoredPresentationInfo[] = [];
      let skipped = 0;
      for (const record of request.result) {
        try { presentations.push(validateInfo(record)); }
        catch { skipped += 1; }
      }
      presentations.sort((left, right) => right.updatedAt - left.updatedAt);
      result({ presentations, skipped });
    };
  });
}

export async function listPresentations(): Promise<StoredPresentationInfo[]> {
  return (await listPresentationsDetailed()).presentations;
}

function readArchiveRecord(value: unknown, info: StoredPresentationInfo): { archive: Blob; edits?: DeckEdits; editsUnreadable?: boolean } {
  const record = value && typeof value === 'object' ? value as { archive?: unknown; edits?: unknown } : undefined;
  const archive = record?.archive;
  if (!(archive instanceof Blob) || archive.size !== info.archiveSize) {
    throw new PresentationStorageError('The saved presentation ZIP is missing or damaged. Open your original ZIP again.');
  }
  if (record!.edits === undefined) return { archive };
  try { return { archive, edits: validateEdits(record!.edits) }; }
  catch { return { archive, editsUnreadable: true }; }
}

/** Compare against version 1 records, which have no stored hash, and record theirs. */
async function findUnhashedCopy(archive: Blob, hash: string): Promise<StoredPresentationInfo | undefined> {
  const { presentations } = await listPresentationsDetailed();
  for (const candidate of presentations) {
    if (candidate.hash !== undefined || candidate.archiveSize !== archive.size) continue;
    let saved: StoredPresentation | undefined;
    try { saved = await getPresentation(candidate.id); } catch { continue; }
    if (!saved) continue;
    const savedHash = await hashArchive(saved.archive);
    try { await recordHash(candidate.id, savedHash); } catch { /* Comparison still holds without the cached hash. */ }
    if (savedHash === hash) return { ...candidate, hash: savedHash };
  }
  return undefined;
}

async function recordHash(id: string, hash: string): Promise<void> {
  await transaction<void>('readwrite', (tx, result) => {
    const store = tx.objectStore(METADATA_STORE);
    const request = store.get(id);
    request.onsuccess = () => {
      const value = request.result;
      if (value && typeof value === 'object' && value.hash === undefined) store.put({ ...value, hash });
      result(undefined);
    };
  });
}

/**
 * Save a deck's original archive with its metadata, committed together. When
 * an archive with the same SHA-256 is already saved, that record is returned
 * unchanged and nothing is written.
 */
export async function saveDeck(input: SaveDeckInput): Promise<SaveDeckResult> {
  if (!(input.archive instanceof Blob) || !input.archive.size || input.archive.size > PRESENTATION_LIMITS.archiveBytes) {
    throw new PresentationStorageError('The original presentation ZIP is missing or too large to save.');
  }
  if (!isStoredDeckKind(input.kind)) throw new PresentationStorageError('This kind of presentation cannot be saved.');
  const edits = input.edits === undefined ? undefined : validateEdits(input.edits);
  const hasEdits = !!edits && Object.keys(edits).length > 0;
  if (hasEdits && !isEditableDeckKind(input.kind)) {
    throw new PresentationStorageError('This kind of presentation cannot be edited in the browser.');
  }
  const hash = await hashArchive(input.archive);
  const now = Date.now();
  let info: StoredPresentationInfo;
  try {
    info = validateInfo({
      id: createId(), title: input.title, engine: input.engine, kind: input.kind,
      fileName: input.fileName, archiveSize: input.archive.size, createdAt: now, updatedAt: now, hash,
      ...(hasEdits ? { edited: true } : {}),
      ...(input.entry !== undefined ? { entry: input.entry } : {}),
      ...(input.source !== undefined ? { source: input.source } : {}),
      ...(input.aspectRatio !== undefined ? { aspectRatio: input.aspectRatio } : {}),
    });
  } catch {
    throw new PresentationStorageError('This presentation has invalid details and could not be saved.');
  }
  // A version 1 copy has no stored hash yet; compare those of the same size first.
  let older: StoredPresentationInfo | undefined;
  try { older = await findUnhashedCopy(input.archive, hash); } catch { older = undefined; }
  if (older) return { info: older, existing: true };
  return transaction<SaveDeckResult>('readwrite', (tx, result, fail) => {
    const metadata = tx.objectStore(METADATA_STORE);
    // Checking inside the write transaction keeps two tabs from both adding.
    const lookup = metadata.index(HASH_INDEX).getAll(hash);
    lookup.onsuccess = () => {
      for (const record of lookup.result) {
        try { result({ info: validateInfo(record), existing: true }); return; }
        catch { /* A damaged twin does not block a fresh copy. */ }
      }
      try {
        tx.objectStore(ARCHIVE_STORE).add({ id: info.id, archive: input.archive, ...(hasEdits ? { edits } : {}) });
        metadata.add(info);
        result({ info, existing: false });
      } catch (error) { fail(error); }
    };
  });
}

/** A successful save means both original bytes and metadata have committed. */
export async function savePresentation(pkg: PresentationPackage): Promise<StoredPresentationInfo> {
  if (!(pkg.archive instanceof Blob) || !pkg.archive.size || pkg.archive.size > PRESENTATION_LIMITS.archiveBytes) {
    throw new PresentationStorageError('The original presentation ZIP is missing or too large to save.');
  }
  const { info } = await saveDeck({
    title: pkg.manifest.title, engine: 'slidev', kind: 'qft-presentation',
    fileName: pkg.fileName, archive: pkg.archive, entry: pkg.manifest.entry,
    ...(pkg.manifest.source ? { source: pkg.manifest.source } : {}),
    ...(pkg.manifest.aspectRatio ? { aspectRatio: pkg.manifest.aspectRatio } : {}),
  });
  return info;
}

/**
 * Replace a deck's text-edit overlay. An empty overlay reverts to the
 * original archive, which is never modified.
 */
export async function updateDeckEdits(id: string, edits: DeckEdits | Map<string, string>): Promise<StoredPresentationInfo> {
  const overlay = validateEdits(edits);
  const hasEdits = Object.keys(overlay).length > 0;
  return transaction('readwrite', (tx, result, fail) => {
    const metadata = tx.objectStore(METADATA_STORE);
    const archives = tx.objectStore(ARCHIVE_STORE);
    const infoRequest = metadata.get(id);
    const bytesRequest = archives.get(id);
    let pending = 2;
    const complete = () => {
      if (--pending) return;
      try {
        if (infoRequest.result === undefined) {
          throw new PresentationStorageError('This presentation was removed in another tab. Open its ZIP to restore it.');
        }
        const info = validateInfo(infoRequest.result);
        readArchiveRecord(bytesRequest.result, info);
        if (hasEdits && !isEditableDeckKind(info.kind)) {
          throw new PresentationStorageError('This kind of presentation cannot be edited in the browser.');
        }
        const record: Record<string, unknown> = { ...bytesRequest.result };
        delete record.edits;
        archives.put(hasEdits ? { ...record, edits: overlay } : record);
        const updated: Record<string, unknown> = { ...infoRequest.result, updatedAt: Math.max(Date.now(), info.updatedAt) };
        delete updated.edited;
        if (hasEdits) updated.edited = true;
        metadata.put(updated);
        result(validateInfo(updated));
      } catch (error) { fail(error); }
    };
    infoRequest.onsuccess = complete;
    bytesRequest.onsuccess = complete;
  });
}

export async function getPresentation(id: string): Promise<StoredPresentation | undefined> {
  return transaction('readonly', (tx, result, fail) => {
    const metadata = tx.objectStore(METADATA_STORE).get(id);
    const bytes = tx.objectStore(ARCHIVE_STORE).get(id);
    let infoDone = false;
    let bytesDone = false;
    const complete = () => {
      if (!infoDone || !bytesDone) return;
      try {
        if (metadata.result === undefined && bytes.result === undefined) { result(undefined); return; }
        const info = validateInfo(metadata.result);
        result({ ...info, ...readArchiveRecord(bytes.result, info) });
      } catch (error) { fail(error); }
    };
    metadata.onsuccess = () => { infoDone = true; complete(); };
    bytes.onsuccess = () => { bytesDone = true; complete(); };
  });
}

export async function deletePresentation(id: string): Promise<void> {
  return transaction('readwrite', (tx, result) => {
    tx.objectStore(METADATA_STORE).delete(id);
    tx.objectStore(ARCHIVE_STORE).delete(id);
    result(undefined);
  });
}
