import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { strToU8, zipSync } from 'fflate';
import {
  inspectPresentationArchive, PRESENTATION_LIMITS, safePresentationPath,
} from '../src/lib/presentation-package.ts';

const manifest = {
  format: 'qft-presentation', version: 1, engine: 'slidev', title: 'Quantum phase',
  entry: 'presentation.html', source: 'source/slides.md', aspectRatio: '16:9',
};
const html = '<!doctype html><html><head><style>body{margin:0}</style></head><body><div id="app"></div><script>window.example=1;</script></body></html>';
const source = '# 量子相位\n\n$$ e^{i\\phi} $$\n\n<Interference />\n';

function makeZip(extra: Record<string, string | Uint8Array> = {}, prefix = '', level: 0 | 6 = 0): File {
  const files = {
    'qft-presentation.json': JSON.stringify(manifest),
    'presentation.html': html,
    'source/slides.md': source,
    'source/components/Interference.vue': '<template><input type="range" /></template>',
    ...extra,
  };
  const entries = Object.fromEntries(Object.entries(files).map(([path, content]) =>
    [prefix + path, typeof content === 'string' ? strToU8(content) : content]));
  return new File([new Uint8Array(zipSync(entries, { level })).buffer], 'quantum.zip', { type: 'application/zip' });
}

function rawZip(files: Record<string, string>): File {
  return new File([new Uint8Array(zipSync(Object.fromEntries(Object.entries(files).map(([name, data]) =>
    [name, strToU8(data)])), { level: 0 })).buffer], 'source.zip');
}

async function mutate(file: File, edit: (bytes: Uint8Array, view: DataView, central: number) => void): Promise<File> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const central = view.getUint32(bytes.length - 22 + 16, true);
  edit(bytes, view, central);
  return new File([bytes.buffer], file.name);
}

describe('portable presentation ZIP import', () => {
  it('opens the shipped real Slidev starter with its editable source and dependency notices', async () => {
    const bytes = await readFile(new URL('../public/slidev/interactive-physics.zip', import.meta.url));
    const pkg = await inspectPresentationArchive(new File([new Uint8Array(bytes).buffer], 'interactive-physics.zip'));
    assert.ok(pkg);
    assert.equal(pkg.manifest.engine, 'slidev');
    assert.ok(pkg.manifest.source);
    assert.ok(pkg.files.find((file) => file.path === pkg.manifest.source)?.content);
    assert.ok(pkg.files.some((file) => file.path.startsWith('source/components/') && file.path.endsWith('.vue') && file.content));
    for (const path of ['source/package-lock.json', 'source/LICENSE', 'THIRD_PARTY_NOTICES.txt']) {
      assert.ok(pkg.files.some((file) => file.path === path && file.size > 0), path);
    }
    assert.match(pkg.html, /<script(?:\s|>)/i);
    assert.deepEqual(new Uint8Array(await pkg.archive.arrayBuffer()), new Uint8Array(bytes));
  });

  it('preserves the original ZIP, exact UTF-8 source, metadata and compiled HTML without running code', async () => {
    const file = makeZip();
    const result = await inspectPresentationArchive(file);
    assert.ok(result);
    assert.deepEqual(result.manifest, manifest);
    assert.equal(result.html, html);
    assert.equal(result.files.find((entry) => entry.path === 'source/slides.md')?.content, source);
    assert.equal(result.fileName, file.name);
    assert.deepEqual(new Uint8Array(await result.archive.arrayBuffer()), new Uint8Array(await file.arrayBuffer()));
    assert.equal((globalThis as { example?: number }).example, undefined);
  });

  it('reads deflated packages and a single enclosing folder', async () => {
    const result = await inspectPresentationArchive(makeZip({}, 'my-lecture/', 6));
    assert.ok(result);
    assert.equal(result.html, html);
    assert.ok(result.files.every((entry) => !entry.path.startsWith('my-lecture/')));
  });

  it('leaves QFT lessons and ordinary Markdown ZIPs to the existing importer', async () => {
    assert.equal(await inspectPresentationArchive(rawZip({ 'notes.md': '# Notes', 'picture.png': 'png' })), null);
    assert.equal(await inspectPresentationArchive(rawZip({
      'notes.md': '# Notes', 'images/figure#1%.png': 'png', 'images/A.png': 'a', 'images/a.png': 'b',
    })), null);
    assert.equal(await inspectPresentationArchive(rawZip({
      'qft.json': '{}', 'slides.md': '# My slides', 'package.json': '{"dependencies":{"@slidev/cli":"53"}}',
    })), null);
  });

  it('leaves Slidev source and ordinary website builds to the deck reader', async () => {
    assert.equal(await inspectPresentationArchive(rawZip({
      'slides.md': '# A lecture', 'package.json': '{"devDependencies":{"@slidev/cli":"53"}}',
    })), null);
    assert.equal(await inspectPresentationArchive(rawZip({
      'dist/index.html': html, 'dist/assets/app.js': 'app()',
    })), null);
  });

  it('rejects traversal, absolute, URL-like and platform-dependent paths', async () => {
    for (const path of ['../secret', '/secret', 'source/../secret', 'source\\secret', 'C:/secret', 'a//b', 'a/%2e%2e/b', 'a?b']) {
      assert.equal(safePresentationPath(path), false, path);
      await assert.rejects(inspectPresentationArchive(makeZip({ [path]: 'unexpected' })), /archive path is invalid/);
    }
  });

  it('rejects duplicate names, case aliases, and file/directory collisions', async () => {
    await assert.rejects(inspectPresentationArchive(makeZip({ 'Presentation.html': html })), /duplicate or ambiguous/);
    await assert.rejects(inspectPresentationArchive(makeZip({ source: 'not a folder' })), /file and as a folder/);
    const duplicate = await mutate(makeZip({ 'a.txt': 'a', 'b.txt': 'b' }), (bytes) => {
      for (let at = 0; at < bytes.length - 4; at += 1) {
        if (bytes[at] === 98 && bytes[at + 1] === 46 && bytes[at + 2] === 116 && bytes[at + 3] === 120 && bytes[at + 4] === 116) bytes[at] = 97;
      }
    });
    await assert.rejects(inspectPresentationArchive(duplicate), /duplicate or ambiguous/);
  });

  it('checks sizes before decompression and rejects dishonest inflated sizes', async () => {
    const tooLarge = await mutate(makeZip(), (_bytes, view, central) => {
      view.setUint32(central + 24, PRESENTATION_LIMITS.fileBytes + 1, true);
    });
    await assert.rejects(inspectPresentationArchive(tooLarge), /larger than 40 MB\. Make that file smaller/);
    // A deflate stream with a plausible small header must not be silently truncated.
    const lied = await mutate(makeZip({}, '', 6), (_bytes, view, central) => {
      const local = view.getUint32(central + 42, true);
      view.setUint32(central + 24, 1, true);
      view.setUint32(local + 22, 1, true);
    });
    await assert.rejects(inspectPresentationArchive(lied), /damaged file/);
  });

  it('detects damaged payload checksums and local-directory disagreement', async () => {
    const damaged = await mutate(makeZip(), (bytes, view, central) => {
      const local = view.getUint32(central + 42, true);
      const data = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      bytes[data + 1] ^= 1;
    });
    await assert.rejects(inspectPresentationArchive(damaged), /damaged file/);
    const conflicting = await mutate(makeZip(), (bytes) => { bytes[30] ^= 1; });
    await assert.rejects(inspectPresentationArchive(conflicting), /does not match its directory/);
  });

  it('rejects encryption, symlinks, malformed JSON and unsupported versions', async () => {
    await assert.rejects(inspectPresentationArchive(await mutate(makeZip(), (_bytes, view, central) => {
      view.setUint16(central + 8, 1, true);
    })), /Encrypted/);
    await assert.rejects(inspectPresentationArchive(await mutate(makeZip(), (_bytes, view, central) => {
      view.setUint32(central + 38, 0xa1ff0000, true);
    })), /Symbolic links/);
    await assert.rejects(inspectPresentationArchive(makeZip({ 'qft-presentation.json': '{' })), /not valid JSON/);
    await assert.rejects(inspectPresentationArchive(makeZip({
      'qft-presentation.json': JSON.stringify({ ...manifest, version: 99 }),
    })), /version is not supported/);
  });

  it('requires the declared entry and source and accepts no ambiguous package roots', async () => {
    await assert.rejects(inspectPresentationArchive(makeZip({
      'qft-presentation.json': JSON.stringify({ ...manifest, entry: 'missing.html' }),
    })), /playable HTML file is missing/);
    await assert.rejects(inspectPresentationArchive(makeZip({
      'qft-presentation.json': JSON.stringify({ ...manifest, source: 'missing.md' }),
    })), /declared source file is missing/);
    await assert.rejects(inspectPresentationArchive(makeZip({
      'second/qft-presentation.json': JSON.stringify(manifest),
    })), /one presentation package/);
  });

  it('does not decode large or binary files into the source viewer', async () => {
    const result = await inspectPresentationArchive(makeZip({
      'source/assets/image.png': new Uint8Array([0xff, 0xfe, 0x00]),
      'source/large.txt': new Uint8Array(PRESENTATION_LIMITS.sourcePreviewBytes + 1),
    }));
    assert.ok(result);
    assert.equal(result.files.find((entry) => entry.path === 'source/assets/image.png')?.content, undefined);
    assert.equal(result.files.find((entry) => entry.path === 'source/large.txt')?.content, undefined);
  });

  it('validates binary source files rather than preserving a hidden corrupt or oversized payload', async () => {
    const file = await mutate(makeZip({ 'source/plot.png': 'pretend image data' }), (bytes, view, central) => {
      let at = central;
      while (view.getUint32(at, true) === 0x02014b50) {
        const nameSize = view.getUint16(at + 28, true);
        const extraSize = view.getUint16(at + 30, true);
        const commentSize = view.getUint16(at + 32, true);
        const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameSize));
        if (name === 'source/plot.png') {
          const local = view.getUint32(at + 42, true);
          const data = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
          bytes[data] ^= 1;
          break;
        }
        at += 46 + nameSize + extraSize + commentSize;
      }
    });
    await assert.rejects(inspectPresentationArchive(file), /damaged file: source\/plot\.png/);
  });

  it('rejects oversized files before reading their bytes', async () => {
    let read = false;
    const file = { size: PRESENTATION_LIMITS.archiveBytes + 1, arrayBuffer: () => { read = true; } } as unknown as File;
    await assert.rejects(inspectPresentationArchive(file), /smaller than 60 MB/);
    assert.equal(read, false);
  });
});
