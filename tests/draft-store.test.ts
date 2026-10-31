import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { imageMarkdown, prepareImageFiles } from '../src/lib/image-assets.ts';
import {
  createDraft,
  createDraftId,
  deleteDraft,
  DraftConflictError,
  DraftStorageError,
  duplicateDraft,
  getDraft,
  loadDrafts,
  saveDraft,
} from '../src/lib/draft-store.ts';

describe('local document storage', { concurrency: false }, () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  it('creates UUID v4 identifiers when an HTTP preview lacks randomUUID', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')!;
    const provider = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { getRandomValues: provider.getRandomValues.bind(provider) },
    });
    try {
      const first = createDraftId();
      const second = createDraftId();
      assert.match(first, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
      assert.notEqual(first, second);
    } finally {
      Object.defineProperty(globalThis, 'crypto', descriptor);
    }
  });

  it('preserves source exactly and reads the committed document back', async () => {
    const source = '\ufeff# 研究笔记\r\n\r\n$\\psi$ and \\(x^2\\)\r\n\t trailing spaces  \n';
    const created = await createDraft('Quantum notes', source);
    assert.equal(created.revision, 1);
    assert.equal(created.source, source);
    assert.deepEqual(await getDraft(created.id), created);
    assert.deepEqual(await loadDrafts(), [created]);
  });

  it('continues reading drafts saved in the original root-domain database', async () => {
    const existing = { id: 'existing-note', title: 'Before the hosting update', source: '$E=mc^2$', createdAt: 1, updatedAt: 2, revision: 1 };
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('qft-markdown', 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore('drafts', { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt');
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction('drafts', 'readwrite');
        transaction.objectStore('drafts').put(existing);
        transaction.oncomplete = () => { database.close(); resolve(); };
        transaction.onerror = () => { database.close(); reject(transaction.error); };
      };
    });
    assert.deepEqual(await loadDrafts(), [existing]);
  });

  it('updates revisions and recency while preserving creation time', async (context) => {
    let clock = 1000;
    context.mock.method(Date, 'now', () => { clock += 10; return clock; });
    const first = await createDraft('First', 'one');
    const second = await createDraft('Second', 'two');
    const saved = await saveDraft({ ...first, source: 'one, revised' });
    assert.equal(saved.revision, 2);
    assert.equal(saved.createdAt, first.createdAt);
    assert.ok(saved.updatedAt > first.updatedAt);
    assert.equal((await loadDrafts())[0].id, saved.id);
    assert.equal((await getDraft(second.id))?.source, 'two');
  });

  it('allows only one competing save for a revision and retains the winning source', async () => {
    const initial = await createDraft('Shared local draft', 'original');
    const attempts = await Promise.allSettled([
      saveDraft({ ...initial, source: 'changes from tab A' }),
      saveDraft({ ...initial, source: 'changes from tab B' }),
    ]);
    const successes = attempts.filter((result) => result.status === 'fulfilled');
    const failures = attempts.filter((result) => result.status === 'rejected');
    assert.equal(successes.length, 1);
    assert.equal(failures.length, 1);
    assert.ok(failures[0].reason instanceof DraftConflictError);
    assert.ok(failures[0].reason.current);
    const winner = successes[0].value;
    assert.deepEqual(await getDraft(initial.id), winner);
    assert.equal(failures[0].reason.current.source, winner.source);
    assert.equal(winner.revision, 2);
  });

  it('does not recreate a draft deleted by another tab', async () => {
    const draft = await createDraft('Temporary', 'keep this unsaved change');
    await deleteDraft(draft.id);
    await assert.rejects(saveDraft(draft), (error: unknown) => {
      assert.ok(error instanceof DraftConflictError);
      assert.equal(error.current, undefined);
      return true;
    });
    assert.equal(await getDraft(draft.id), undefined);
    assert.deepEqual(await loadDrafts(), []);
  });

  it('duplicates source as an independent document without changing the original', async () => {
    const original = await createDraft('Research', '# A result\n\n$$ E=mc^2 $$');
    const copy = await duplicateDraft(original);
    assert.notEqual(copy.id, original.id);
    assert.equal(copy.title, 'Research (copy)');
    assert.equal(copy.source, original.source);
    await saveDraft({ ...copy, source: 'independent changes' });
    assert.equal((await getDraft(original.id))?.source, original.source);
    assert.equal((await loadDrafts()).length, 2);
  });

  it('reports unavailable storage without pretending that a draft was saved', async () => {
    const factory = globalThis.indexedDB;
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, writable: true, value: undefined });
    try {
      await assert.rejects(createDraft('Unsaved', 'valuable content'), DraftStorageError);
    } finally {
      globalThis.indexedDB = factory;
    }
    assert.deepEqual(await loadDrafts(), []);
  });

  it('stores image bytes and slide preferences in the same draft revision', async () => {
    const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
    const [image] = await prepareImageFiles([new File([bytes], 'Figure.png', { type: 'image/png' })]);
    const created = await createDraft('Research talk', imageMarkdown(image), {
      images: [image], mode: 'slides', slideTheme: 'midnight', slideRatio: '4:3',
    });
    const persisted = await getDraft(created.id);
    assert.equal(persisted?.mode, 'slides');
    assert.equal(persisted?.slideTheme, 'midnight');
    assert.equal(persisted?.slideRatio, '4:3');
    assert.equal(persisted?.images?.[0].id, image.id);
    assert.deepEqual(new Uint8Array(await persisted!.images![0].blob.arrayBuffer()), bytes);
    const saved = await saveDraft({ ...persisted!, source: `# Updated\n\n${persisted!.source}` });
    assert.equal(saved.revision, 2);
    assert.equal(saved.images?.[0].id, image.id);
    assert.equal(saved.mode, 'slides');
    assert.deepEqual(await getDraft(saved.id), saved);
  });

  it('duplicates image attachments and slide preferences independently of later deletion', async () => {
    const [image] = await prepareImageFiles([new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], 'Photo.jpg')]);
    const original = await createDraft('A talk', imageMarkdown(image), { images: [image], mode: 'slides', slideTheme: 'serif', slideRatio: '16:9' });
    const copy = await duplicateDraft(original);
    assert.notEqual(copy.images, original.images);
    assert.notEqual(copy.images![0], original.images![0]);
    assert.equal(copy.images![0].id, original.images![0].id);
    assert.equal(copy.mode, 'slides');
    assert.equal(copy.slideTheme, 'serif');
    await deleteDraft(original.id);
    const persisted = await getDraft(copy.id);
    assert.deepEqual(new Uint8Array(await persisted!.images![0].blob.arrayBuffer()), new Uint8Array([0xff, 0xd8, 0xff, 0xe0]));
    assert.equal(persisted?.source, original.source);
  });

  it('preserves the winning image snapshot when another tab saves a stale revision', async () => {
    const [imageA, imageB] = await prepareImageFiles([
      new File(['GIF89a', new Uint8Array([1, 0, 1, 0])], 'A.gif'),
      new File(['GIF89a', new Uint8Array([2, 0, 2, 0])], 'B.gif'),
    ]);
    const initial = await createDraft('Two tabs', imageMarkdown(imageA), { images: [imageA], mode: 'document' });
    const winner = await saveDraft({ ...initial, images: [imageB], source: imageMarkdown(imageB), mode: 'slides' });
    await assert.rejects(saveDraft({ ...initial, title: 'Stale edit' }), (error: unknown) => {
      assert.ok(error instanceof DraftConflictError);
      assert.equal(error.current?.images?.[0].id, imageB.id);
      assert.equal(error.current?.mode, 'slides');
      assert.equal(error.current?.source, imageMarkdown(imageB));
      return true;
    });
    assert.deepEqual(await getDraft(initial.id), winner);
  });

  it('upgrades an old text-only draft on save without changing its identity or creation time', async () => {
    const legacy = await createDraft('Existing notes', '# Existing notes');
    assert.equal('mode' in legacy, false);
    assert.equal('images' in legacy, false);
    const updated = await saveDraft({ ...legacy, mode: 'slides', slideTheme: 'paper', images: [] });
    assert.equal(updated.id, legacy.id);
    assert.equal(updated.createdAt, legacy.createdAt);
    assert.equal(updated.revision, 2);
    assert.equal(updated.mode, 'slides');
    assert.deepEqual(await getDraft(updated.id), updated);
  });

  it('does not commit a new revision when image metadata validation fails', async () => {
    const draft = await createDraft('Keep this document', 'Original source');
    await assert.rejects(saveDraft({ ...draft, source: 'Must not be committed', images: [{ id: 'x', name: 'x.svg', type: 'image/png', blob: new Blob(['<svg/>'], { type: 'image/svg+xml' }) }] }), DraftStorageError);
    assert.deepEqual(await getDraft(draft.id), draft);
  });
});
