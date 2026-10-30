import { scopedStorageKey } from './storage-scope';

/** Browser-local documents. A successful write means the IndexedDB transaction committed. */
export interface Draft {
  id: string;
  title: string;
  source: string;
  createdAt: number;
  updatedAt: number;
  revision: number;
}

export interface DraftChangeMessage {
  action: 'create' | 'save' | 'delete';
  id: string;
  revision?: number;
}

export const DRAFT_CHANNEL_NAME = scopedStorageKey('qft-markdown-drafts');
export const MAX_DRAFT_SOURCE_LENGTH = 5_000_000;
const DATABASE_NAME = scopedStorageKey('qft-markdown');
const STORE_NAME = 'drafts';
const DATABASE_VERSION = 1;

export class DraftStorageError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DraftStorageError';
  }
}

/** The caller still owns its unsaved source; `current` is the committed competing version. */
export class DraftConflictError extends Error {
  readonly draftId: string;
  readonly current: Draft | undefined;

  constructor(draftId: string, current: Draft | undefined) {
    super(current
      ? 'This document was changed in another tab. Save your work as a new document or load the newer version.'
      : 'This document was deleted in another tab. Save your work as a new document to keep it.');
    this.name = 'DraftConflictError';
    this.draftId = draftId;
    this.current = current ? { ...current } : undefined;
  }
}

export function isDraftConflict(error: unknown): error is DraftConflictError {
  return error instanceof DraftConflictError;
}

/** randomUUID needs a secure context; getRandomValues also works for HTTP previews. */
export function createDraftId(): string {
  const provider = globalThis.crypto;
  if (typeof provider?.randomUUID === 'function') return provider.randomUUID();
  if (typeof provider?.getRandomValues !== 'function') {
    throw new DraftStorageError('This browser cannot create a secure document identifier. Open the site in a current browser.');
  }
  const bytes = provider.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

let connection: Promise<IDBDatabase> | undefined;
let connectionFactory: IDBFactory | undefined;

function storageError(error: unknown): Error {
  if (error instanceof DraftConflictError || error instanceof DraftStorageError) return error;
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
  if (name === 'QuotaExceededError') {
    return new DraftStorageError('Browser storage is full. Download your Markdown before removing any drafts.', { cause: error });
  }
  return new DraftStorageError('Local draft storage could not be accessed. Download your Markdown to keep a copy.', { cause: error });
}

function openDatabase(): Promise<IDBDatabase> {
  let factory: IDBFactory;
  try { factory = globalThis.indexedDB; } catch (error) { return Promise.reject(storageError(error)); }
  if (!factory) {
    return Promise.reject(new DraftStorageError('Local draft storage is unavailable in this browser. Download your Markdown to keep a copy.'));
  }
  if (connectionFactory !== factory) {
    connection?.then((db) => db.close(), () => {});
    connection = undefined;
    connectionFactory = factory;
  }
  if (connection) return connection;

  let pending: Promise<IDBDatabase>;
  pending = new Promise((resolve, reject) => {
    let settled = false;
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(DATABASE_NAME, DATABASE_VERSION);
    } catch (error) {
      reject(storageError(error));
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt');
      }
    };
    request.onerror = () => {
      settled = true;
      reject(storageError(request.error));
    };
    request.onblocked = () => {
      settled = true;
      reject(new DraftStorageError('Another tab is blocking local draft storage. Close other editor tabs and try again.'));
    };
    request.onsuccess = () => {
      const db = request.result;
      if (settled) {
        db.close();
        return;
      }
      settled = true;
      db.onversionchange = () => {
        db.close();
        if (connection === pending) connection = undefined;
      };
      db.onclose = () => {
        if (connection === pending) connection = undefined;
      };
      resolve(db);
    };
  });
  connection = pending;
  pending.catch(() => {
    if (connection === pending) connection = undefined;
  });
  return pending;
}

function validateText(title: string, source: string): { title: string; source: string } {
  if (typeof title !== 'string' || typeof source !== 'string') {
    throw new DraftStorageError('The document title and Markdown source must be text.');
  }
  if (title.length > 200) throw new DraftStorageError('Document titles can contain up to 200 characters.');
  if (source.length > MAX_DRAFT_SOURCE_LENGTH) {
    throw new DraftStorageError('This document is too large for local drafts. Download your Markdown to keep a copy.');
  }
  return { title: title.trim() || 'Untitled document', source };
}

function readDraft(value: unknown): Draft | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object') throw new DraftStorageError('A saved document could not be read. Its stored data has been preserved.');
  const draft = value as Partial<Draft>;
  if (typeof draft.id !== 'string' || !draft.id || typeof draft.title !== 'string' || typeof draft.source !== 'string'
    || !Number.isFinite(draft.createdAt) || !Number.isFinite(draft.updatedAt)
    || !Number.isInteger(draft.revision) || (draft.revision ?? 0) < 1) {
    throw new DraftStorageError('A saved document could not be read. Its stored data has been preserved.');
  }
  return { ...(draft as Draft) };
}

async function transaction<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore, result: (value: T) => void, fail: (error: unknown) => void) => void,
): Promise<T> {
  const db = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction(STORE_NAME, mode);
    } catch (error) {
      reject(storageError(error));
      return;
    }
    let result: T;
    let failure: unknown;
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(storageError(failure ?? tx.error));
    const fail = (error: unknown) => {
      failure = error;
      try { tx.abort(); } catch { reject(storageError(error)); }
    };
    try {
      work(tx.objectStore(STORE_NAME), (value) => { result = value; }, fail);
    } catch (error) {
      fail(error);
    }
  });
}

function announce(message: DraftChangeMessage): void {
  // Cross-tab coordination is optional. Storage success never depends on it.
  if (typeof globalThis.BroadcastChannel !== 'function') return;
  try {
    const channel = new BroadcastChannel(DRAFT_CHANNEL_NAME);
    channel.postMessage(message);
    channel.close();
  } catch { /* Private browser contexts may disable this API. */ }
}

export async function loadDrafts(): Promise<Draft[]> {
  return transaction<Draft[]>('readonly', (store, result, fail) => {
    const request = store.getAll();
    request.onsuccess = () => {
      try {
        const drafts = request.result.map((value) => readDraft(value)!);
        drafts.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
        result(drafts);
      } catch (error) { fail(error); }
    };
  });
}

export async function getDraft(id: string): Promise<Draft | undefined> {
  return transaction<Draft | undefined>('readonly', (store, result, fail) => {
    const request = store.get(id);
    request.onsuccess = () => {
      try { result(readDraft(request.result)); } catch (error) { fail(error); }
    };
  });
}

export async function createDraft(title: string, source: string): Promise<Draft> {
  const text = validateText(title, source);
  const now = Date.now();
  const draft: Draft = { id: createDraftId(), ...text, createdAt: now, updatedAt: now, revision: 1 };
  const saved = await transaction<Draft>('readwrite', (store, result) => {
    store.add(draft);
    result(draft);
  });
  announce({ action: 'create', id: saved.id, revision: saved.revision });
  return { ...saved };
}

export async function saveDraft(draft: Draft, expectedRevision = draft.revision): Promise<Draft> {
  const text = validateText(draft.title, draft.source);
  const id = draft.id;
  if (!id || !Number.isInteger(expectedRevision) || expectedRevision < 1) {
    throw new DraftStorageError('The saved document revision is invalid. Save this text as a new document.');
  }
  const saved = await transaction<Draft>('readwrite', (store, result, fail) => {
    // The compare and put belong to one transaction, including across tabs.
    const request = store.get(id);
    request.onsuccess = () => {
      try {
        const current = readDraft(request.result);
        if (!current || current.revision !== expectedRevision) {
          fail(new DraftConflictError(id, current));
          return;
        }
        const next: Draft = {
          id,
          ...text,
          createdAt: current.createdAt,
          updatedAt: Math.max(Date.now(), current.updatedAt + 1),
          revision: current.revision + 1,
        };
        store.put(next);
        result(next);
      } catch (error) { fail(error); }
    };
  });
  announce({ action: 'save', id: saved.id, revision: saved.revision });
  return { ...saved };
}

export async function deleteDraft(id: string): Promise<void> {
  await transaction<void>('readwrite', (store, result) => {
    store.delete(id);
    result(undefined);
  });
  announce({ action: 'delete', id });
}

export async function duplicateDraft(draft: Draft): Promise<Draft> {
  const suffix = ' (copy)';
  const title = draft.title.slice(0, 200 - suffix.length) + suffix;
  return createDraft(title, draft.source);
}
