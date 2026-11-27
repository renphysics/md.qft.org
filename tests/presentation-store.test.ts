import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { beforeEach, describe, it } from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { strToU8, zipSync } from 'fflate';
import { inspectPresentationArchive } from '../src/lib/presentation-package.ts';
import {
  listPresentations, listPresentationsDetailed, getPresentation, savePresentation, deletePresentation,
  saveDeck, updateDeckEdits, hashArchive, isEditableDeckKind, PresentationStorageError, DECK_EDIT_LIMITS,
  findSavedDeck, STORAGE_OUTDATED_TEXT, EDITS_CHANGED_ELSEWHERE_TEXT,
} from '../src/lib/presentation-store.ts';
import { deckFromHtmlFile } from '../src/lib/deck-archive.ts';
import { htmlFixture, zipFixture } from './helpers/deck-fixtures.ts';

async function presentation(title = 'Quantum phase') {
  const manifest = {
    format: 'qft-presentation', version: 1, engine: 'slidev', title,
    entry: 'presentation.html', source: 'source/slides.md', aspectRatio: '16:9',
  };
  const zip = zipSync({
    'qft-presentation.json': strToU8(JSON.stringify(manifest)),
    'presentation.html': strToU8('<html><body><button>Play</button></body></html>'),
    'source/slides.md': strToU8('# Source\n\n$$e^{i\\phi}$$'),
  });
  return (await inspectPresentationArchive(new File([new Uint8Array(zip).buffer], 'lecture.zip')))!;
}

describe('local imported presentation storage', { concurrency: false }, () => {
  beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });

  it('commits original bytes and metadata together and lists only light metadata', async () => {
    const pkg = await presentation();
    const info = await savePresentation(pkg);
    assert.equal(info.title, 'Quantum phase');
    assert.equal(info.source, 'source/slides.md');
    assert.equal(info.aspectRatio, '16:9');
    assert.deepEqual(await listPresentations(), [info]);
    assert.equal('archive' in (await listPresentations())[0], false);
    const saved = await getPresentation(info.id);
    assert.ok(saved);
    assert.equal(saved.archive.type, 'application/zip');
    assert.deepEqual(new Uint8Array(await saved.archive.arrayBuffer()), new Uint8Array(await pkg.archive.arrayBuffer()));
    const reopened = await inspectPresentationArchive(new File([saved.archive], saved.fileName));
    assert.equal(reopened?.html, pkg.html);
    assert.equal(reopened?.files.find((file) => file.path === 'source/slides.md')?.content, '# Source\n\n$$e^{i\\phi}$$');
  });

  it('keeps imports independent, sorts by recency and deletes metadata with archive', async (context) => {
    let clock = Date.parse('2026-01-01T00:00:00Z');
    context.mock.method(Date, 'now', () => clock += 10);
    const first = await savePresentation(await presentation('First'));
    const second = await savePresentation(await presentation('Second'));
    assert.notEqual(first.id, second.id);
    assert.deepEqual((await listPresentations()).map((item) => item.id), [second.id, first.id]);
    await deletePresentation(first.id);
    assert.equal(await getPresentation(first.id), undefined);
    assert.deepEqual(await listPresentations(), [second]);
    assert.equal(await getPresentation('absent'), undefined);
  });

  it('does not store presentation code in the Markdown draft database', async () => {
    await savePresentation(await presentation());
    const databases = await indexedDB.databases();
    assert.deepEqual(databases.map((db) => db.name), ['qft-presentations']);
  });

  it('reports unavailable storage without pretending an import was saved', async () => {
    const factory = globalThis.indexedDB;
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, writable: true, value: undefined });
    try {
      await assert.rejects(savePresentation(await presentation()), (error: unknown) => {
        assert.ok(error instanceof PresentationStorageError);
        assert.match(error.message, /unavailable.*original ZIP/);
        return true;
      });
    } finally { globalThis.indexedDB = factory; }
  });

  it('keeps quota failures actionable and rejects missing original bytes', async () => {
    globalThis.indexedDB = {
      open() { throw new DOMException('full', 'QuotaExceededError'); },
    } as unknown as IDBFactory;
    await assert.rejects(savePresentation(await presentation()), /storage is full.*original ZIP/);
    const pkg = await presentation();
    pkg.archive = new Blob();
    await assert.rejects(savePresentation(pkg), /original presentation ZIP is missing/);
  });
});

const DATABASE = 'qft-presentations';

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error);
  });
}

/** Build the database exactly as version 1 of the store left it. */
async function seedVersion1(records: { info: unknown; archive?: unknown }[]): Promise<void> {
  const open = indexedDB.open(DATABASE, 1);
  open.onupgradeneeded = () => {
    open.result.createObjectStore('presentations', { keyPath: 'id' });
    open.result.createObjectStore('archives', { keyPath: 'id' });
  };
  const db = await request(open);
  const tx = db.transaction(['presentations', 'archives'], 'readwrite');
  for (const record of records) {
    tx.objectStore('presentations').put(record.info);
    if (record.archive) tx.objectStore('archives').put(record.archive);
  }
  await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
  db.close();
}

async function raw(store: 'presentations' | 'archives', id: string): Promise<any> {
  const db = await request(indexedDB.open(DATABASE));
  try { return await request(db.transaction(store).objectStore(store).get(id)); }
  finally { db.close(); }
}

async function rawPut(store: 'presentations' | 'archives', value: unknown): Promise<void> {
  const db = await request(indexedDB.open(DATABASE));
  try {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
  } finally { db.close(); }
}

async function revealDeck() {
  const file = zipFixture('local-project');
  return {
    title: 'Optics workshop', engine: 'reveal' as const, kind: 'reveal' as const,
    fileName: file.name, archive: file.slice(0, file.size, 'application/zip'), entry: 'index.html',
  };
}

describe('presentation storage version 2', { concurrency: false }, () => {
  beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });

  it('keeps version 1 records, reads them as portable Slidev packages and skips damaged ones', async () => {
    const pkg = await presentation('Old lecture');
    const info = {
      id: 'old', title: 'Old lecture', engine: 'slidev', fileName: 'lecture.zip',
      archiveSize: pkg.archive.size, createdAt: 1, updatedAt: 2, source: 'source/slides.md', aspectRatio: '16:9',
    };
    await seedVersion1([
      { info, archive: { id: 'old', archive: pkg.archive } },
      { info: { id: 'broken', title: '', engine: 'slidev' } },
      { info: { ...info, id: 'future', engine: 'quantum' } },
    ]);
    const listing = await listPresentationsDetailed();
    assert.equal(listing.skipped, 2);
    assert.deepEqual(listing.presentations, [{ ...info, kind: 'qft-presentation' }]);
    assert.deepEqual(await listPresentations(), listing.presentations);
    const db = await request(indexedDB.open(DATABASE));
    assert.equal(db.version, 2);
    assert.ok(db.transaction('presentations').objectStore('presentations').indexNames.contains('hash'));
    db.close();
    assert.deepEqual(await raw('presentations', 'old'), info, 'the upgrade does not rewrite records');
    assert.ok(await raw('presentations', 'broken'), 'damaged records stay in storage');
    const saved = await getPresentation('old');
    assert.equal(saved?.kind, 'qft-presentation');
    assert.deepEqual(new Uint8Array(await saved!.archive.arrayBuffer()), new Uint8Array(await pkg.archive.arrayBuffer()));
    assert.equal(saved?.edits, undefined);
  });

  it('recognises a version 1 copy of the same archive and records its hash', async () => {
    const pkg = await presentation('Old lecture');
    await seedVersion1([{
      info: { id: 'old', title: 'Old lecture', engine: 'slidev', fileName: 'lecture.zip', archiveSize: pkg.archive.size, createdAt: 1, updatedAt: 2 },
      archive: { id: 'old', archive: pkg.archive },
    }]);
    const again = await saveDeck({ title: 'Old lecture', engine: 'slidev', kind: 'qft-presentation', fileName: 'lecture.zip', archive: pkg.archive });
    assert.equal(again.existing, true);
    assert.equal(again.info.id, 'old');
    assert.equal((await raw('presentations', 'old')).hash, await hashArchive(pkg.archive));
    assert.equal((await listPresentations()).length, 1);
    assert.equal((await savePresentation(pkg)).id, 'old');
  });

  it('stores decks of every engine with a SHA-256 content hash', async () => {
    const input = await revealDeck();
    const { info, existing } = await saveDeck(input);
    assert.equal(existing, false);
    assert.equal(info.engine, 'reveal');
    assert.equal(info.kind, 'reveal');
    assert.equal(info.entry, 'index.html');
    assert.equal(info.hash, createHash('sha256').update(new Uint8Array(await input.archive.arrayBuffer())).digest('hex'));
    assert.equal(info.edited, undefined);
    const page = await deckFromHtmlFile(htmlFixture('plain-html'));
    const html = await saveDeck({ title: 'Projectile explorer', engine: 'html', kind: 'html', fileName: page.fileName, archive: page.archive });
    assert.equal(html.info.engine, 'html');
    assert.deepEqual((await listPresentations()).map((item) => item.kind).sort(), ['html', 'reveal']);
  });

  it('returns the existing record for an identical archive and says so', async () => {
    const first = await saveDeck(await revealDeck());
    const second = await saveDeck({ ...(await revealDeck()), title: 'A new title' });
    assert.equal(second.existing, true);
    assert.deepEqual(second.info, first.info);
    const page = () => deckFromHtmlFile(htmlFixture('cdn-reveal5-single'));
    const one = await saveDeck({ title: 'Oscillator', engine: 'reveal', kind: 'reveal', fileName: 'a.zip', archive: (await page()).archive });
    const two = await saveDeck({ title: 'Oscillator', engine: 'reveal', kind: 'reveal', fileName: 'a.zip', archive: (await page()).archive });
    assert.equal(two.existing, true);
    assert.equal(two.info.id, one.info.id, 'the same HTML file imported twice is one deck');
    assert.equal((await listPresentations()).length, 2);
    const pkg = await presentation();
    assert.equal((await savePresentation(pkg)).id, (await savePresentation(pkg)).id);
  });

  it('refuses kinds that cannot play and engines that do not match their kind', async () => {
    const input = await revealDeck();
    for (const kind of ['slidev-source', 'markdown-bundle', 'unknown', 'other']) {
      await assert.rejects(saveDeck({ ...input, kind: kind as 'reveal' }), /cannot be saved/);
    }
    await assert.rejects(saveDeck({ ...input, engine: 'slidev' }), /invalid details/);
    await assert.rejects(saveDeck({ ...input, title: '' }), /invalid details/);
    await assert.rejects(saveDeck({ ...input, entry: '../index.html' }), /invalid details/);
    assert.deepEqual(await listPresentations(), []);
  });

  it('keeps a text-edit overlay beside the untouched original archive', async (context) => {
    let clock = Date.parse('2026-02-01T00:00:00Z');
    context.mock.method(Date, 'now', () => clock += 10);
    const input = await revealDeck();
    const { info } = await saveDeck(input);
    const edited = await updateDeckEdits(info.id, new Map([['slides.md', '## Edited\n'], ['css/custom.css', 'body { color: red }']]));
    assert.equal(edited.edited, true);
    assert.ok(edited.updatedAt > info.updatedAt);
    const saved = await getPresentation(info.id);
    assert.deepEqual(saved?.edits, { 'slides.md': '## Edited\n', 'css/custom.css': 'body { color: red }' });
    assert.deepEqual(new Uint8Array(await saved!.archive.arrayBuffer()), new Uint8Array(await input.archive.arrayBuffer()));
    assert.equal(saved?.hash, info.hash);
    assert.equal((await listPresentations())[0].edited, true);
    const reverted = await updateDeckEdits(info.id, {});
    assert.equal(reverted.edited, undefined);
    assert.equal((await getPresentation(info.id))?.edits, undefined);
    assert.equal('edits' in (await raw('archives', info.id)), false);
    const withEdits = await saveDeck({ ...(await revealDeck()), archive: zipFixture('plain-html'), kind: 'html', engine: 'html', edits: { 'app.js': 'run()' } });
    assert.equal(withEdits.info.edited, true);
    assert.deepEqual((await getPresentation(withEdits.info.id))?.edits, { 'app.js': 'run()' });
  });

  it('limits the overlay to 2 MB per file and 8 MB in total, counted in bytes', async () => {
    const { info } = await saveDeck(await revealDeck());
    assert.equal(DECK_EDIT_LIMITS.fileBytes, 2 * 1024 * 1024);
    assert.equal(DECK_EDIT_LIMITS.totalBytes, 8 * 1024 * 1024);
    await updateDeckEdits(info.id, { 'a.txt': 'x'.repeat(DECK_EDIT_LIMITS.fileBytes) });
    await assert.rejects(updateDeckEdits(info.id, { 'a.txt': 'é'.repeat(DECK_EDIT_LIMITS.fileBytes / 2 + 1) }), /larger than 2 MB/);
    const nearly = 'x'.repeat(DECK_EDIT_LIMITS.fileBytes - 16);
    await assert.rejects(updateDeckEdits(info.id, { a: nearly, b: nearly, c: nearly, d: nearly, e: nearly }), /larger than 8 MB/);
    for (const path of ['../a.txt', '/a.txt', 'a//b', 'a?b']) {
      await assert.rejects(updateDeckEdits(info.id, { [path]: 'x' }), /could not be saved/, path);
    }
    await assert.rejects(updateDeckEdits(info.id, { 'a.txt': 42 as unknown as string }), /could not be saved/);
    assert.equal((await getPresentation(info.id))?.edits?.['a.txt'].length, DECK_EDIT_LIMITS.fileBytes, 'failed updates change nothing');
  });

  it('keeps portable packages and converted builds read-only', async () => {
    assert.equal(isEditableDeckKind('reveal'), true);
    assert.equal(isEditableDeckKind('html'), true);
    assert.equal(isEditableDeckKind('qft-presentation'), false);
    assert.equal(isEditableDeckKind('slidev-build'), false);
    const info = await savePresentation(await presentation());
    await assert.rejects(updateDeckEdits(info.id, { 'source/slides.md': '# Changed' }), /cannot be edited/);
    assert.equal((await updateDeckEdits(info.id, {})).edited, undefined, 'clearing is always allowed');
    const archive = zipFixture('plain-html');
    await assert.rejects(saveDeck({ title: 'Build', engine: 'slidev', kind: 'slidev-build', fileName: 'b.zip', archive, edits: { 'index.html': 'x' } }), /cannot be edited/);
    await assert.rejects(updateDeckEdits('absent', { 'index.html': 'x' }), /removed in another tab/);
  });

  it('refuses edits based on an older copy, so two tabs cannot silently replace each other’s edits', async (context) => {
    // One clock value for every call: the stored time still moves forward on each write.
    context.mock.method(Date, 'now', () => Date.parse('2026-03-01T00:00:00Z'));
    const { info } = await saveDeck(await revealDeck());
    const tabOne = await updateDeckEdits(info.id, { 'index.html': '<!-- TAB-ONE -->' }, { basedOn: info.updatedAt });
    assert.ok(tabOne.updatedAt > info.updatedAt);
    await assert.rejects(updateDeckEdits(info.id, { 'index.html': '<!-- TAB-TWO -->' }, { basedOn: info.updatedAt }), (error: unknown) => {
      assert.ok(error instanceof PresentationStorageError);
      assert.equal(error.message, EDITS_CHANGED_ELSEWHERE_TEXT);
      assert.match(error.message, /changed in another tab or window.*text in this tab is kept.*Reopen the presentation/);
      return true;
    });
    assert.deepEqual((await getPresentation(info.id))?.edits, { 'index.html': '<!-- TAB-ONE -->' }, 'the first tab’s edits stay');
    // Clearing the overlay is checked the same way.
    await assert.rejects(updateDeckEdits(info.id, {}, { basedOn: info.updatedAt }), /changed in another tab/);
    const again = await updateDeckEdits(info.id, { 'index.html': '<!-- TAB-ONE, later -->' }, { basedOn: tabOne.updatedAt });
    assert.ok(again.updatedAt > tabOne.updatedAt);
  });

  it('finds the saved copy of an archive by its bytes', async () => {
    const input = await revealDeck();
    assert.equal(await findSavedDeck(input.archive), undefined);
    const { info } = await saveDeck(input);
    await updateDeckEdits(info.id, { 'index.html': 'fixed' });
    const found = await findSavedDeck(new Blob([await input.archive.arrayBuffer()]));
    assert.equal(found?.id, info.id);
    assert.equal(found?.edited, true);
    assert.equal(await findSavedDeck(zipFixture('plain-html')), undefined);
  });

  it('tells a tab to reload when a newer version of the site has upgraded the database', async () => {
    await saveDeck(await revealDeck());
    // A newer version opens the database in another tab: this tab's connection closes.
    const newer = indexedDB.open(DATABASE, 99);
    const db = await request(newer);
    db.close();
    await assert.rejects(listPresentations(), (error: unknown) => {
      assert.ok(error instanceof PresentationStorageError);
      assert.equal(error.message, STORAGE_OUTDATED_TEXT);
      return true;
    });
    // A tab that opens the store only after the upgrade gets the same advice (VersionError).
    globalThis.indexedDB = new IDBFactory();
    await request(indexedDB.open(DATABASE, 99)).then((value) => value.close());
    await assert.rejects(listPresentations(), new RegExp(STORAGE_OUTDATED_TEXT.replace(/\./g, '\\.')));
  });

  it('tells a tab to reload at its next save once another tab has asked to upgrade, before the upgrade is done', async () => {
    // Keep the connection the store opens, to fire its versionchange handler as the browser would.
    const factory = new IDBFactory();
    let connection: IDBDatabase | undefined;
    globalThis.indexedDB = new Proxy(factory, {
      get(target, key) {
        if (key === 'open') {
          return (...args: Parameters<IDBFactory['open']>) => {
            const opening = target.open(...args);
            opening.addEventListener('success', () => { connection = opening.result; });
            return opening;
          };
        }
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await saveDeck(await revealDeck());
    assert.ok(connection?.onversionchange, 'the store listens for a newer version');
    connection.onversionchange.call(connection, new Event('versionchange') as IDBVersionChangeEvent);
    // The database itself is still at this version, so only the flag can refuse the save.
    const page = await deckFromHtmlFile(htmlFixture('plain-html'));
    await assert.rejects(saveDeck({ title: 'Projectile explorer', engine: 'html', kind: 'html', fileName: page.fileName, archive: page.archive }), (error: unknown) => {
      assert.ok(error instanceof PresentationStorageError);
      assert.equal(error.message, STORAGE_OUTDATED_TEXT);
      return true;
    });
  });

  it('opens the original when a stored overlay is unreadable', async () => {
    const { info } = await saveDeck(await revealDeck());
    const record = await raw('archives', info.id);
    await rawPut('archives', { ...record, edits: { 'index.html': 7 } });
    const saved = await getPresentation(info.id);
    assert.equal(saved?.edits, undefined);
    assert.equal(saved?.editsUnreadable, true);
    assert.deepEqual((await raw('archives', info.id)).edits, { 'index.html': 7 }, 'the unreadable overlay is preserved');
  });
});
