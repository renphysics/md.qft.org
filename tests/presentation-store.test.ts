import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { strToU8, zipSync } from 'fflate';
import { inspectPresentationArchive } from '../src/lib/presentation-package.ts';
import {
  listPresentations, getPresentation, savePresentation, deletePresentation, PresentationStorageError,
} from '../src/lib/presentation-store.ts';

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
