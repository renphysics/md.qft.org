import { scopedStorageKey } from './storage-scope';
import { PRESENTATION_LIMITS, type PresentationPackage } from './presentation-package';

export interface StoredPresentationInfo {
  id: string;
  title: string;
  engine: 'slidev';
  fileName: string;
  archiveSize: number;
  createdAt: number;
  updatedAt: number;
  source?: string;
  aspectRatio?: '16:9' | '4:3';
}

export interface StoredPresentation extends StoredPresentationInfo {
  archive: Blob;
}

const DATABASE_NAME = scopedStorageKey('qft-presentations');
const METADATA_STORE = 'presentations';
const ARCHIVE_STORE = 'archives';
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
    try { request = factory.open(DATABASE_NAME, 1); }
    catch (error) { reject(storageError(error)); return; }
    let finished = false;
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(METADATA_STORE)) db.createObjectStore(METADATA_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(ARCHIVE_STORE)) db.createObjectStore(ARCHIVE_STORE, { keyPath: 'id' });
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

function validateInfo(value: unknown): StoredPresentationInfo {
  if (!value || typeof value !== 'object') throw new PresentationStorageError('A saved presentation record is damaged. Its data has been preserved.');
  const info = value as StoredPresentationInfo;
  if (typeof info.id !== 'string' || !info.id || typeof info.title !== 'string'
    || !info.title || info.title.length > 200 || info.engine !== 'slidev'
    || typeof info.fileName !== 'string' || !info.fileName || info.fileName.length > 240
    || !Number.isSafeInteger(info.archiveSize) || info.archiveSize <= 0 || info.archiveSize > PRESENTATION_LIMITS.archiveBytes
    || !Number.isFinite(info.createdAt) || !Number.isFinite(info.updatedAt)
    || (info.source !== undefined && typeof info.source !== 'string')
    || (info.aspectRatio !== undefined && !['16:9', '4:3'].includes(info.aspectRatio))) {
    throw new PresentationStorageError('A saved presentation record is damaged. Its data has been preserved.');
  }
  return { ...info };
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

/** Listing never reads or decompresses large presentation archives. */
export async function listPresentations(): Promise<StoredPresentationInfo[]> {
  return transaction('readonly', (tx, result, fail) => {
    const request = tx.objectStore(METADATA_STORE).getAll();
    request.onsuccess = () => {
      try {
        result(request.result.map(validateInfo).sort((left, right) => right.updatedAt - left.updatedAt));
      } catch (error) { fail(error); }
    };
  });
}

/** A successful save means both original bytes and metadata have committed. */
export async function savePresentation(pkg: PresentationPackage): Promise<StoredPresentationInfo> {
  if (!(pkg.archive instanceof Blob) || !pkg.archive.size || pkg.archive.size > PRESENTATION_LIMITS.archiveBytes) {
    throw new PresentationStorageError('The original presentation ZIP is missing or too large to save.');
  }
  const now = Date.now();
  const info = validateInfo({
    id: createId(), title: pkg.manifest.title, engine: 'slidev',
    fileName: pkg.fileName, archiveSize: pkg.archive.size, createdAt: now, updatedAt: now,
    ...(pkg.manifest.source ? { source: pkg.manifest.source } : {}),
    ...(pkg.manifest.aspectRatio ? { aspectRatio: pkg.manifest.aspectRatio } : {}),
  });
  return transaction('readwrite', (tx, result) => {
    tx.objectStore(ARCHIVE_STORE).add({ id: info.id, archive: pkg.archive });
    tx.objectStore(METADATA_STORE).add(info);
    result(info);
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
        const archive = bytes.result?.archive;
        if (!(archive instanceof Blob) || archive.size !== info.archiveSize) {
          throw new PresentationStorageError('The saved presentation ZIP is missing or damaged. Open your original ZIP again.');
        }
        result({ ...info, archive });
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
