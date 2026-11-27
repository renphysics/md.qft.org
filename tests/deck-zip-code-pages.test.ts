import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { strToU8, zipSync, type Zippable } from 'fflate';
import { readDeckArchive } from '../src/lib/deck-archive.ts';
import { buildPlayable, deckArchive, isPlayable, nextDeckEdits, openDeck, openStoredDeck } from '../src/lib/deck-project.ts';
import { nodeVendorProvider } from './helpers/deck-vendor-node.ts';

/** A tiny PNG signature: enough for the linker to treat the file as a picture. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

const hex = (text: string) => Uint8Array.from(text.match(/../g)!, (pair) => parseInt(pair, 16));
const ascii = (text: string) => strToU8(text);
const concat = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap((part) => [...part]));

/**
 * A ZIP as Windows tools without UTF-8 support write it: each name is the
 * given bytes, in the system's code page, with the UTF-8 flag clear in both
 * records. Built with same-length stand-in names, then patched byte by byte.
 */
function codePageZip(files: [Uint8Array, Uint8Array][], name = 'deck.zip'): File {
  const input: Zippable = {};
  files.forEach(([raw, data], index) => { input[`f${index}`.padEnd(raw.length, '_')] = data; });
  const bytes = zipSync(input, { level: 0 });
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = bytes.length - 22;
  let position = view.getUint32(eocd + 16, true);
  for (let index = 0; index < view.getUint16(eocd + 10, true); index += 1) {
    const local = view.getUint32(position + 42, true);
    const nameSize = view.getUint16(position + 28, true);
    const standIn = new TextDecoder().decode(bytes.subarray(position + 46, position + 46 + nameSize));
    const raw = files[Number(/^f(\d+)/.exec(standIn)![1])][0];
    assert.equal(raw.length, nameSize);
    bytes.set(raw, position + 46);
    bytes.set(raw, local + 30);
    view.setUint16(position + 8, view.getUint16(position + 8, true) & ~0x800, true);
    view.setUint16(local + 6, view.getUint16(local + 6, true) & ~0x800, true);
    position += 46 + nameSize + view.getUint16(position + 30, true) + view.getUint16(position + 32, true);
  }
  return new File([bytes.buffer as ArrayBuffer], name, { type: 'application/zip' });
}

const page = (body: string) => strToU8(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Names</title></head><body><section>${body}</section><section>two</section></body></html>`);

async function play(file: File) {
  const project = await openDeck(file);
  assert.ok(project);
  const result = await buildPlayable(project, { vendor: () => nodeVendorProvider() });
  return { project, result };
}

const codes = (issues: { code: string; severity: string }[]) => issues.map((issue) => `${issue.severity} ${issue.code}`);

describe('ZIP file names in old code pages', () => {
  it('reads cp437 names (older Windows in English) when the slides use them, and says so', async () => {
    const file = codePageZip([
      [ascii('index.html'), page('<img src="img/Schrödinger.png" alt=""><img src="img/%C3%9Cbung.png" alt="">')],
      [concat(ascii('img/Schr'), hex('94'), ascii('dinger.png')), PNG],
      [concat(ascii('img/'), hex('9a'), ascii('bung.png')), PNG],
    ]);
    const { project, result } = await play(file);
    assert.deepEqual([...project.files.keys()].sort(), ['img/Schrödinger.png', 'img/Übung.png', 'index.html']);
    assert.ok(isPlayable(result));
    assert.deepEqual(result.issues.filter((issue) => issue.code === 'missing-file'), []);
    const note = result.issues.find((issue) => issue.code === 'zip-names-code-page');
    assert.equal(note?.severity, 'info');
    assert.match(note!.message, /not stored as UTF-8\. They were read as code page 437 .*which matches the names the slides use\./);
  });

  it('reads GBK names, also one whose second byte is 0x5C ("\\"), which is not a folder', async () => {
    // 量子 is c1bf d7d3; 乗 is 81 5c, whose second byte is a backslash on its own.
    const file = codePageZip([
      [ascii('index.html'), page('<img src="img/量子.png" alt=""><img src="img/乗数.png" alt="">')],
      [concat(ascii('img/'), hex('c1bfd7d3'), ascii('.png')), PNG],
      [concat(ascii('img/'), hex('815ccafd'), ascii('.png')), PNG],
    ]);
    const { project, result } = await play(file);
    assert.deepEqual([...project.files.keys()].sort(), ['img/乗数.png', 'img/量子.png', 'index.html']);
    assert.deepEqual(codes(result.issues).filter((code) => /missing|skipped/.test(code)), []);
    assert.match(result.issues.find((issue) => issue.code === 'zip-names-code-page')!.message, /read as GBK \(Chinese\)/);
    assert.doesNotMatch(result.html, /量子|乗数/, 'both pictures were embedded');
  });

  it('reads Shift_JIS names, whose second byte can also be 0x5C', async () => {
    // 表示 is 955c 8ea6; ソース is 835c 815b 8358.
    const file = codePageZip([
      [ascii('index.html'), page('<img src="表示.png" alt=""><img src="ソース.png" alt="">')],
      [concat(hex('955c8ea6'), ascii('.png')), PNG],
      [concat(hex('835c815b8358'), ascii('.png')), PNG],
    ]);
    const { project, result } = await play(file);
    assert.deepEqual([...project.files.keys()].sort(), ['index.html', 'ソース.png', '表示.png']);
    assert.match(result.issues.find((issue) => issue.code === 'zip-names-code-page')!.message, /read as Shift_JIS \(Japanese\)/);
    assert.deepEqual(result.issues.filter((issue) => issue.code === 'missing-file'), []);
  });

  it('finds Cyrillic names written in Markdown and CSS too', async () => {
    const file = codePageZip([
      [ascii('index.html'), page('<div data-markdown="slides.md"></div>')],
      [ascii('slides.md'), strToU8('# Hi\n\n![](Привет.png)\n')],
      [ascii('style.css'), strToU8('body { background: url("Фон.png"); }')],
      [concat(hex('cff0e8e2e5f2'), ascii('.png')), PNG],
      [concat(hex('d4eeed'), ascii('.png')), PNG],
    ]);
    const deck = await readDeckArchive(file);
    assert.deepEqual([...deck.files.keys()].sort(), ['index.html', 'slides.md', 'style.css', 'Привет.png', 'Фон.png'].sort());
    assert.match(deck.issues.find((issue) => issue.code === 'zip-names-code-page')!.message, /Windows-1251 \(Cyrillic\)/);
  });

  it('keeps the names and says how to fix them when the slides match no code page', async () => {
    const names: [Uint8Array, Uint8Array][] = [
      [ascii('index.html'), page('<p>No pictures here.</p>')],
      [concat(ascii('img/Schr'), hex('94'), ascii('dinger.png')), PNG],
    ];
    const quiet = await play(codePageZip(names));
    const note = quiet.result.issues.find((issue) => issue.code === 'zip-names-not-utf8');
    assert.equal(note?.severity, 'info');
    assert.match(note!.message, /not stored as UTF-8.*Rename those files using plain letters, digits and dashes.*tool that stores UTF-8 names\./);
    assert.ok([...quiet.project.files.keys()].includes('img/Schr\u0094dinger.png'), 'the name is kept as it was read before');
    // When a file the slides use is reported missing, the note is the likely reason: a warning.
    names[0][1] = page('<img src="img/Schrodinger.png" alt="">');
    const missing = await play(codePageZip(names));
    assert.ok(missing.result.issues.some((issue) => issue.code === 'missing-file'));
    assert.equal(missing.result.issues.find((issue) => issue.code === 'zip-names-not-utf8')?.severity, 'warning');
  });

  it('leaves a name that would collide with another file as it was', async () => {
    const file = codePageZip([
      [ascii('index.html'), page('<img src="Übung.png" alt="">')],
      [strToU8('Übung.png'), PNG],
      [concat(hex('9a'), ascii('bung.png')), PNG],
    ]);
    const deck = await readDeckArchive(file);
    assert.deepEqual([...deck.files.keys()].sort(), ['index.html', 'Übung.png', '\u009abung.png'].sort());
  });

  it('writes the repaired names in the edited ZIP, keeps the upload as Original, and maps edits saved under the old names', async () => {
    const upload = codePageZip([
      [ascii('deck/index.html'), page('<div data-markdown="Übung.md"></div>')],
      [concat(ascii('deck/'), hex('9a'), ascii('bung.md')), strToU8('# Old')],
    ]);
    const project = await openDeck(upload);
    assert.ok(project);
    assert.equal(project.folder, 'deck');
    const { edits } = nextDeckEdits(project, new Map([['Übung.md', '# New']]));
    project.edits = edits;
    const edited = await readDeckArchive(new File([await deckArchive(project).arrayBuffer()], 'edited.zip'));
    assert.deepEqual([...edited.files.keys()].sort(), ['index.html', 'Übung.md']);
    assert.equal(edited.folder, 'deck');
    assert.deepEqual(edited.issues.filter((issue) => /zip-names/.test(issue.code)), [], 'the edited ZIP stores UTF-8 names');
    assert.equal(new TextDecoder().decode(edited.files.get('Übung.md')), '# New');
    assert.deepEqual(new Uint8Array(await project.original.arrayBuffer()), new Uint8Array(await upload.arrayBuffer()));
    // Before this change, the same file was read as "\u009abung.md", and an edit saved under that name must still apply.
    const again = await openStoredDeck({
      id: 'saved', title: 'Names', kind: 'reveal', engine: project.engine, archive: project.original, fileName: project.fileName,
      entry: 'index.html', edits: { '\u009abung.md': '# Saved earlier' },
    });
    assert.equal(again.edits.get('Übung.md'), '# Saved earlier');
  });
});
