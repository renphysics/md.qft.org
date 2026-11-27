import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { strToU8, unzipSync, zipSync } from 'fflate';
import {
  decodeText, deckFromHtmlFile, isTextPath, mimeFromPath, readDeckArchive, zipDeckFiles,
} from '../src/lib/deck-archive.ts';
import { inspectDirectory, PRESENTATION_LIMITS } from '../src/lib/presentation-package.ts';
import { htmlFixture, loadFixtureDeck, zipFixture } from './helpers/deck-fixtures.ts';

function zipFile(files: Record<string, string | Uint8Array>, name = 'deck.zip', level: 0 | 6 = 0): File {
  const entries = Object.fromEntries(Object.entries(files).map(([path, data]) =>
    [path, typeof data === 'string' ? strToU8(data) : data]));
  return new File([new Uint8Array(zipSync(entries, { level })).buffer], name, { type: 'application/zip' });
}

async function mutate(file: File, edit: (bytes: Uint8Array, view: DataView, central: number) => void): Promise<File> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const central = view.getUint32(bytes.length - 22 + 16, true);
  edit(bytes, view, central);
  return new File([bytes.buffer], file.name);
}

describe('deck archive reading', () => {
  it('reads every file of a project ZIP with normalised paths and keeps the original bytes', async () => {
    const file = zipFixture('local-project');
    const deck = await readDeckArchive(file);
    assert.deepEqual([...deck.files.keys()], [...loadFixtureDeck('local-project').keys()].sort((a, b) => a.localeCompare(b)));
    for (const [path, bytes] of loadFixtureDeck('local-project')) assert.deepEqual(deck.files.get(path), bytes, path);
    assert.deepEqual(new Uint8Array(await deck.archive.arrayBuffer()), new Uint8Array(await file.arrayBuffer()));
    assert.equal(deck.archive.type, 'application/zip');
    assert.equal(deck.fileName, 'local-project.zip');
    assert.equal(deck.sourceName, 'local-project.zip');
    assert.equal(deck.expandedBytes, [...deck.files.values()].reduce((sum, bytes) => sum + bytes.length, 0));
    assert.deepEqual(deck.issues, []);
  });

  it('strips one wrapping folder and ignores operating-system clutter', async () => {
    const deck = await readDeckArchive(zipFixture('plain-html', {
      wrap: 'explorer',
      extra: {
        '__MACOSX/explorer/._index.html': strToU8('resource fork'),
        'explorer/.DS_Store': strToU8('finder'),
        'explorer/assets/Thumbs.db': strToU8('thumbs'),
      },
    }));
    assert.deepEqual([...deck.files.keys()], ['app.js', 'index.html', 'style.css']);
    assert.equal(deck.folder, 'explorer', 'the removed folder is kept for downloads');
    assert.deepEqual(deck.issues, []);
  });

  it('strips only one level, and nothing when files sit at the top', async () => {
    const nested = await readDeckArchive(zipFile({ 'outer/inner/index.html': '<p>1</p>', 'outer/inner/a.css': '' }));
    assert.deepEqual([...nested.files.keys()], ['inner/a.css', 'inner/index.html']);
    assert.equal(nested.folder, 'outer');
    const flat = await readDeckArchive(zipFile({ 'index.html': '<p>1</p>', 'css/a.css': '' }));
    assert.deepEqual([...flat.files.keys()], ['css/a.css', 'index.html']);
    assert.equal(flat.folder, '');
  });

  it('keeps each stored file independent of the archive buffer', async () => {
    const deck = await readDeckArchive(zipFile({ 'index.html': '<p>stored</p>', 'b.txt': 'x' }, 'deck.zip', 0));
    const bytes = deck.files.get('index.html')!;
    assert.equal(bytes.byteOffset, 0);
    assert.equal(bytes.buffer.byteLength, bytes.length);
  });

  it('normalises backslashes and dot segments, and skips names that cannot be used', async () => {
    const deck = await readDeckArchive(zipFile({
      'index.html': '<p>deck</p>',
      'css\\theme.css': 'body{}',
      './js/app.js': 'run()',
      'images/figure#1.png': 'png',
      'images/50%.png': 'png',
      'notes?.txt': 'x',
    }));
    assert.deepEqual([...deck.files.keys()], ['css/theme.css', 'index.html', 'js/app.js']);
    assert.deepEqual(deck.issues.map((issue) => [issue.code, issue.severity, issue.where]), [
      ['archive-path-skipped', 'warning', 'images/figure#1.png'],
      ['archive-path-skipped', 'warning', 'images/50%.png'],
      ['archive-path-skipped', 'warning', 'notes?.txt'],
    ]);
  });

  it('names at most ten skipped files and counts the rest', async () => {
    const files: Record<string, string> = { 'index.html': '<p>deck</p>' };
    for (let index = 0; index < 14; index += 1) files[`bad ${index}?.png`] = 'x';
    const deck = await readDeckArchive(zipFile(files));
    assert.equal(deck.issues.length, 11);
    assert.match(deck.issues.at(-1)!.message, /Skipped 4 more files/);
  });

  it('rejects the whole archive for paths that leave its folder', async () => {
    for (const path of ['../secret.txt', 'deck/../../secret.txt', '..\\secret.txt', '/etc/passwd', 'C:/secret.txt', 'c:secret.txt']) {
      await assert.rejects(readDeckArchive(zipFile({ 'index.html': '<p>x</p>', [path]: 'unexpected' })),
        /points outside the archive/, path);
    }
  });

  it('rejects duplicate, case-aliased and file/folder-clashing paths', async () => {
    await assert.rejects(readDeckArchive(zipFile({ 'index.html': 'a', 'Index.html': 'b' })), /duplicate or ambiguous/);
    await assert.rejects(readDeckArchive(zipFile({ 'index.html': 'a', 'css/a.css': 'a', 'css\\a.css': 'b' })), /duplicate or ambiguous/);
    await assert.rejects(readDeckArchive(zipFile({ 'index.html': 'a', css: 'file', 'css/a.css': 'b' })), /file and as a folder/);
  });

  it('keeps the hardened ZIP checks: encryption, symbolic links, ZIP64 and damaged data', async () => {
    const base = zipFile({ 'index.html': '<p>deck</p>', 'app.js': 'run()' });
    await assert.rejects(readDeckArchive(await mutate(base, (_bytes, view, central) => {
      view.setUint16(central + 8, 1, true);
    })), /Encrypted/);
    await assert.rejects(readDeckArchive(await mutate(base, (_bytes, view, central) => {
      view.setUint32(central + 38, 0xa1ff0000, true);
    })), /Symbolic links/);
    await assert.rejects(readDeckArchive(await mutate(base, (_bytes, view, central) => {
      view.setUint32(central + 24, 0xffffffff, true);
    })), /ZIP64|exceeds/);
    await assert.rejects(readDeckArchive(await mutate(base, (bytes, view) => {
      view.setUint16(bytes.length - 22 + 4, 1, true);
    })), /Multi-volume/);
    await assert.rejects(readDeckArchive(await mutate(base, (bytes, view, central) => {
      const local = view.getUint32(central + 42, true);
      bytes[local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)] ^= 1;
    })), /damaged file/);
    await assert.rejects(readDeckArchive(new File([strToU8('not a zip at all, sorry')], 'x.zip')),
      /^PresentationPackageError: This ZIP is damaged or incomplete, perhaps because the download did not finish\. Download it again or make the ZIP again, then open the new file\.$/);
  });

  it('says what to do about a ZIP with too many files, a cut-off download and a broken directory', async () => {
    const many = (count: number) => zipFile(Object.fromEntries([['index.html', '<p>deck</p>'], ...Array.from({ length: count - 1 }, (_, index) => [`notes/${index}.txt`, 'x'])]));
    assert.equal((await readDeckArchive(many(1000))).files.size, 1000, 'exactly 1,000 entries are accepted');
    await assert.rejects(readDeckArchive(many(1001)),
      /^PresentationPackageError: This ZIP has more than 1,000 files and folders\. Keep at most 1,000 \(leave out files the slides do not use\), then make the ZIP again\.$/);
    const whole = new Uint8Array(await zipFile({ 'index.html': '<p>deck</p>', 'app.js': 'run()' }).arrayBuffer());
    await assert.rejects(readDeckArchive(new File([whole.slice(0, Math.floor(whole.length / 2))], 'half.zip')), /damaged or incomplete, perhaps because the download did not finish/);
    const broken = await mutate(zipFile({ 'index.html': '<p>deck</p>' }), (bytes, view) => {
      view.setUint32(bytes.length - 22 + 16, view.getUint32(bytes.length - 22 + 16, true) + 1, true);
    });
    await assert.rejects(readDeckArchive(broken), /^PresentationPackageError: This ZIP could not be opened: .+\. Download it again or make the ZIP again, then open the new file\.$/);
  });

  it('validates the checksums of ignored and skipped files too', async () => {
    const file = await mutate(zipFile({ 'index.html': '<p>deck</p>', '.DS_Store': 'finder data' }), (bytes, view, central) => {
      let at = central;
      while (view.getUint32(at, true) === 0x02014b50) {
        const nameSize = view.getUint16(at + 28, true);
        const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameSize));
        if (name === '.DS_Store') {
          const local = view.getUint32(at + 42, true);
          bytes[local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)] ^= 1;
          return;
        }
        at += 46 + nameSize + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
      }
    });
    await assert.rejects(readDeckArchive(file), /damaged file: \.DS_Store/);
  });

  it('rejects empty and oversized archives before reading them', async () => {
    let read = false;
    const big = { name: 'big.zip', size: PRESENTATION_LIMITS.archiveBytes + 1, arrayBuffer: () => { read = true; } } as unknown as File;
    await assert.rejects(readDeckArchive(big), /smaller than 60 MB/);
    assert.equal(read, false);
    await assert.rejects(readDeckArchive(new File([], 'empty.zip')), /smaller than 60 MB/);
    await assert.rejects(readDeckArchive(zipFile({ '.DS_Store': 'x', '__MACOSX/a': 'b' })), /no usable files/);
  });

  it('never executes or evaluates anything while reading', async () => {
    const deck = await readDeckArchive(zipFile({
      'index.html': '<script>globalThis.deckArchiveRan = true</script>',
      'app.js': 'globalThis.deckArchiveRan = true',
    }));
    assert.equal(deck.files.size, 2);
    assert.equal((globalThis as { deckArchiveRan?: boolean }).deckArchiveRan, undefined);
  });
});

describe('single HTML files as decks', () => {
  it('becomes index.html inside a deterministic ZIP', async () => {
    const first = await deckFromHtmlFile(htmlFixture('cdn-reveal5-single', 'index.html', 'oscillator.html'));
    const second = await deckFromHtmlFile(htmlFixture('cdn-reveal5-single', 'index.html', 'oscillator.html'));
    assert.deepEqual([...first.files.keys()], ['index.html']);
    assert.deepEqual(first.files.get('index.html'), loadFixtureDeck('cdn-reveal5-single').get('index.html'));
    assert.equal(first.fileName, 'oscillator.zip');
    assert.equal(first.sourceName, 'oscillator.html');
    assert.equal(first.archive.type, 'application/zip');
    assert.deepEqual(new Uint8Array(await first.archive.arrayBuffer()), new Uint8Array(await second.archive.arrayBuffer()));
    const reread = await readDeckArchive(new File([first.archive], first.fileName));
    assert.deepEqual(reread.files, first.files);
  });

  it('rejects empty and oversized pages', async () => {
    await assert.rejects(deckFromHtmlFile(new File([], 'empty.html')), /This HTML file is empty\. Export the presentation again\./);
    const big = { name: 'big.html', size: PRESENTATION_LIMITS.htmlBytes + 1, arrayBuffer: () => { throw new Error('read'); } } as unknown as File;
    await assert.rejects(deckFromHtmlFile(big), /smaller than 24 MB/);
  });
});

describe('deck ZIP writing', () => {
  it('writes a ZIP the strict inspector accepts, sorted, with fixed timestamps', () => {
    const files = loadFixtureDeck('local-project');
    files.set('notes/量子.md', strToU8('# 量子'));
    const zip = zipDeckFiles(files);
    const entries = inspectDirectory(zip);
    assert.deepEqual(entries.map((entry) => entry.name), [...files.keys()].sort());
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    const png = entries.find((entry) => entry.name === 'assets/pic.png')!;
    assert.equal(png.method, 0, 'PNG data is stored, not deflated again');
    assert.equal(entries.find((entry) => entry.name === 'index.html')!.method, 8);
    const central = view.getUint32(zip.length - 22 + 16, true);
    assert.equal(view.getUint16(central + 14, true), (0 << 9) | (1 << 5) | 1, 'DOS date 1980-01-01');
    assert.equal(view.getUint16(central + 12, true), 0, 'DOS time 00:00');
    assert.deepEqual(unzipSync(zip)['notes/量子.md'], strToU8('# 量子'));
    assert.deepEqual(zipDeckFiles(files), zip);
  });

  it('refuses paths that could not be read back', () => {
    for (const path of ['../x', 'a//b', 'a?b', '/abs']) {
      assert.throws(() => zipDeckFiles(new Map([[path, new Uint8Array(1)]])), /cannot be stored/, path);
    }
  });
});

describe('deck file helpers', () => {
  it('decodes UTF-8, byte-order marks, declared charsets and legacy text', () => {
    assert.equal(decodeText(strToU8('Grüße, 量子')), 'Grüße, 量子');
    assert.equal(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x41])), 'A');
    assert.equal(decodeText(new Uint8Array([0xff, 0xfe, 0x41, 0x00])), 'A');
    assert.equal(decodeText(new Uint8Array([0xfe, 0xff, 0x00, 0x41])), 'A');
    const latin = new Uint8Array([...strToU8('<meta charset="iso-8859-2"><p>'), 0xb1, ...strToU8('</p>')]);
    assert.equal(decodeText(latin, 'index.html'), '<meta charset="iso-8859-2"><p>ą</p>');
    assert.equal(decodeText(new Uint8Array([0x93, 0x41, 0x94]), 'notes.txt'), '“A”');
    const unknownLabel = new Uint8Array([...strToU8('<meta charset="x-unknown">'), 0xe9]);
    assert.equal(decodeText(unknownLabel, 'page.htm'), '<meta charset="x-unknown">é');
  });

  it('maps file types and recognises text files', () => {
    assert.equal(mimeFromPath('index.HTML'), 'text/html');
    assert.equal(mimeFromPath('dist/reveal.mjs'), 'text/javascript');
    assert.equal(mimeFromPath('fonts/KaTeX_Main.woff2'), 'font/woff2');
    assert.equal(mimeFromPath('assets/pic.png'), 'image/png');
    assert.equal(mimeFromPath('icon.svg'), 'image/svg+xml');
    assert.equal(mimeFromPath('LICENSE'), 'application/octet-stream');
    assert.equal(isTextPath('slides.md'), true);
    assert.equal(isTextPath('js/demo.mjs'), true);
    assert.equal(isTextPath('assets/pic.png'), false);
  });
});
