import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { strToU8, zipSync, type Zippable } from 'fflate';
import { readDeckArchive, zipDeckFiles } from '../src/lib/deck-archive.ts';
import { detectDeck } from '../src/lib/deck-detect.ts';
import { linkDeck } from '../src/lib/deck-linker.ts';
import { deckArchive, nextDeckEdits, openDeck, openStoredDeck } from '../src/lib/deck-project.ts';
import { importWorkspaceBundle } from '../src/lib/document-bundle.ts';
import { inspectDirectory, zipEntryNames } from '../src/lib/presentation-package.ts';
import { nodeVendorProvider } from './helpers/deck-vendor-node.ts';

/** A tiny PNG signature: enough for the linker to treat the file as a picture. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

/**
 * A ZIP as Info-ZIP's `zip` writes it on Linux and macOS: raw UTF-8 names
 * with the UTF-8 flag (bit 11) clear, in both the local and central records.
 */
function infoZip(files: Zippable, name = 'deck.zip'): File {
  const bytes = zipSync(files, { level: 0 });
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = bytes.length - 22;
  let position = view.getUint32(eocd + 16, true);
  for (let index = 0; index < view.getUint16(eocd + 10, true); index += 1) {
    const local = view.getUint32(position + 42, true);
    view.setUint16(position + 8, view.getUint16(position + 8, true) & ~0x800, true);
    view.setUint16(local + 6, view.getUint16(local + 6, true) & ~0x800, true);
    position += 46 + view.getUint16(position + 28, true) + view.getUint16(position + 30, true) + view.getUint16(position + 32, true);
  }
  return new File([bytes.buffer as ArrayBuffer], name, { type: 'application/zip' });
}

/** The Info-ZIP Unicode Path extra field (0x7075) for a plain name. */
function unicodePath(plain: string, unicode: string, crcOf = plain): Uint8Array {
  let crc = 0xffffffff;
  for (const byte of strToU8(crcOf)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  crc = (crc ^ 0xffffffff) >>> 0;
  return new Uint8Array([1, crc & 255, (crc >>> 8) & 255, (crc >>> 16) & 255, crc >>> 24, ...strToU8(unicode)]);
}

const page = (body: string) => `<!DOCTYPE html><html><head><title>Names</title></head><body>${body}</body></html>`;

async function link(file: File) {
  const deck = await readDeckArchive(file);
  return { deck, result: await linkDeck(deck.files, detectDeck(deck.files), nodeVendorProvider()) };
}

describe('ZIP file names', () => {
  it('reads UTF-8 names without the UTF-8 flag as UTF-8 (Info-ZIP), so pictures are found', async () => {
    const file = infoZip({
      'index.html': strToU8(page('<img src="Schrödinger.png" alt=""><img src="图片/波函数.png" alt="">')),
      'Schrödinger.png': PNG,
      '图片/波函数.png': PNG,
    });
    const flags = new DataView(new Uint8Array(await file.arrayBuffer()).buffer).getUint16(8, true);
    assert.equal(flags & 0x800, 0, 'the test archive really has the flag clear');
    const { deck, result } = await link(file);
    assert.deepEqual([...deck.files.keys()].sort(), ['index.html', 'Schrödinger.png', '图片/波函数.png'].sort());
    assert.deepEqual(result.issues.filter((issue) => issue.code === 'missing-file'), []);
    assert.equal(result.stats.embeddedAssets >= 1, true);
    assert.doesNotMatch(result.html, /Schrödinger\.png|波函数/, 'both pictures were embedded');
  });

  it('honours an Info-ZIP Unicode Path field whose checksum matches, and ignores one that does not', async () => {
    const good = infoZip({
      'index.html': strToU8(page('<img src="Schrödinger.png" alt="">')),
      'Schr_dinger.png': [PNG, { extra: { 0x7075: unicodePath('Schr_dinger.png', 'Schrödinger.png') } }],
    });
    assert.deepEqual([...(await readDeckArchive(good)).files.keys()].sort(), ['Schrödinger.png', 'index.html']);
    const stale = infoZip({
      'index.html': strToU8(page('')),
      'Schr_dinger.png': [PNG, { extra: { 0x7075: unicodePath('Schr_dinger.png', 'Other.png', 'renamed.png') } }],
    });
    assert.deepEqual([...(await readDeckArchive(stale)).files.keys()].sort(), ['Schr_dinger.png', 'index.html']);
  });

  it('keeps one character per byte for names that are not UTF-8', async () => {
    const bytes = zipSync({ 'index.html': strToU8(page('')), 'Xa.png': PNG }, { level: 0 });
    // Patch the name "Xa.png" to the Windows-1252 byte for ö (0xf6), which is not UTF-8 on its own.
    for (let at = 0; at < bytes.length - 6; at += 1) {
      if (String.fromCharCode(...bytes.subarray(at, at + 6)) === 'Xa.png') bytes[at] = 0xf6;
    }
    const names = inspectDirectory(bytes, false).map((entry) => entry.name);
    assert.ok(names.includes('öa.png'));
  });

  it('finds files whose names are decomposed (macOS) when the page spells them composed, and the other way round', async () => {
    const decomposed = 'Schrödinger.png';
    const composed = 'Schrödinger.png';
    for (const [stored, written] of [[decomposed, composed], [composed, decomposed]]) {
      const { deck, result } = await link(infoZip({ 'index.html': strToU8(page(`<img src="${written}" alt="">`)), [stored]: PNG }));
      assert.deepEqual([...deck.files.keys()].sort(), ['index.html', composed].sort(), 'paths are NFC');
      assert.deepEqual(result.issues.filter((issue) => issue.code === 'missing-file'), [], `${JSON.stringify(stored)} referenced as ${JSON.stringify(written)}`);
    }
  });

  it('maps names for fflate-based readers, and the Markdown importer reads Info-ZIP names as UTF-8', async () => {
    const file = infoZip({ 'Schrödinger.md': strToU8('# Wave\n\nText.') }, 'lesson.zip');
    const names = zipEntryNames(new Uint8Array(await file.arrayBuffer()));
    assert.equal(names.get('SchrÃ¶dinger.md'), 'Schrödinger.md');
    const bundle = await importWorkspaceBundle(file);
    assert.equal(bundle.title, 'Schrödinger');
  });

  it('keeps edits saved under the earlier one-character-per-byte spelling of a name', async () => {
    const file = infoZip({ 'index.html': strToU8(page('<section data-markdown="Schrödinger.md"></section>')), 'Schrödinger.md': strToU8('# Old') });
    const project = await openDeck(file);
    assert.ok(project);
    const again = await openStoredDeck({
      id: 'saved', title: 'Names', kind: 'reveal', engine: project.engine, archive: project.original, fileName: project.fileName,
      entry: 'index.html', edits: { 'SchrÃ¶dinger.md': '# Edited' },
    });
    assert.equal(again.edits.get('Schrödinger.md'), '# Edited');
  });
});

describe('a file named __proto__', () => {
  it('is zipped under its own name', async () => {
    const files = new Map([['index.html', strToU8(page(''))], ['__proto__', strToU8('PROTO-DATA')], ['constructor', strToU8('C')]]);
    const zip = zipDeckFiles(files);
    const back = await readDeckArchive(new File([zip.buffer as ArrayBuffer], 'deck.zip'));
    assert.deepEqual([...back.files.keys()].sort(), ['__proto__', 'constructor', 'index.html']);
    assert.equal(new TextDecoder().decode(back.files.get('__proto__')), 'PROTO-DATA');
    assert.deepEqual(zipDeckFiles(files), zip, 'still deterministic');
  });

  it('survives an edit and the ZIP download of the edited presentation', async () => {
    const file = new File([zipSync({ 'index.html': strToU8(page('<p>before</p>')), 'notes/a.txt': strToU8('a') }, { level: 0 }).buffer as ArrayBuffer], 'deck.zip');
    // fflate's own zipSync has the same plain-object problem, so add the entry with ours.
    const withProto = zipDeckFiles(new Map([...(await readDeckArchive(file)).files, ['__proto__', strToU8('PROTO-DATA')]]));
    const project = await openDeck(new File([withProto.buffer as ArrayBuffer], 'deck.zip'));
    assert.ok(project);
    const { edits, problem } = nextDeckEdits(project, new Map([['index.html', page('<p>after</p>')]]));
    assert.equal(problem, undefined);
    project.edits = edits;
    const edited = await readDeckArchive(new File([await deckArchive(project).arrayBuffer()], 'edited.zip'));
    assert.deepEqual([...edited.files.keys()].sort(), ['__proto__', 'index.html', 'notes/a.txt']);
    assert.equal(new TextDecoder().decode(edited.files.get('__proto__')), 'PROTO-DATA');
    assert.match(new TextDecoder().decode(edited.files.get('index.html')), /after/);
  });
});
