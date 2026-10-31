import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createDocumentBundle, importWorkspaceBundle, rewriteImageReferences } from '../src/lib/document-bundle.ts';
import { imageReference, type DraftImage } from '../src/lib/image-assets.ts';

const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=', 'base64'));
const image: DraftImage = { id: 'figure-123', name: 'Quantum figure.png', type: 'image/png', blob: new Blob([PNG], { type: 'image/png' }) };
const archive = (files: Record<string, Uint8Array>) => new File([new Uint8Array(zipSync(files, { level: 0 })).buffer], 'document.zip');

describe('portable Markdown and image bundles', () => {
  it('round-trips image bytes and slide metadata while providing ordinary relative Markdown paths', async () => {
    const source = '# Results\n\n![Energy levels](qft-image:figure-123)\n\n---\n\n$$E=mc^2$$';
    const bytes = await createDocumentBundle(source, 'Research talk', [image], { mode: 'slides', slideTheme: 'midnight', slideRatio: '4:3' });
    const files = unzipSync(bytes);
    assert.equal(strFromU8(files['Research-talk.md']), source.replace('qft-image:figure-123', 'images/01-Quantum-figure.png'));
    assert.deepEqual(files['images/01-Quantum-figure.png'], PNG);
    const restored = await importWorkspaceBundle(new File([new Uint8Array(bytes).buffer], 'Research-talk.zip'));
    assert.equal(restored.title, 'Research talk');
    assert.equal(restored.mode, 'slides');
    assert.equal(restored.slideTheme, 'midnight');
    assert.equal(restored.slideRatio, '4:3');
    assert.equal(restored.images.length, 1);
    assert.equal(restored.images[0].name, 'Quantum figure.png');
    assert.notEqual(restored.images[0].id, image.id);
    assert.equal(restored.source, source.replace(imageReference(image.id), imageReference(restored.images[0].id)));
    assert.deepEqual(new Uint8Array(await restored.images[0].blob.arrayBuffer()), PNG);
  });

  it('relocates real image syntax without rewriting literal code or ordinary links', () => {
    const source = [
      '![A [nested] caption](qft-image:figure-123 "Title")',
      '![Angle](<qft-image:figure-123>)',
      '![Reference][figure]',
      '[figure]: qft-image:figure-123 "Title"',
      '[Link](qft-image:figure-123)',
      '`![Code](qft-image:figure-123)`',
      '```markdown', '![Fenced](qft-image:figure-123)', '```',
      '    ![Indented](qft-image:figure-123)',
      '\\![Escaped](qft-image:figure-123)',
    ].join('\n');
    const rewritten = rewriteImageReferences(source, (reference) => reference === 'qft-image:figure-123' ? 'images/figure.png' : undefined);
    assert.equal(rewritten, source
      .replace('![A [nested] caption](qft-image:figure-123', '![A [nested] caption](images/figure.png')
      .replace('![Angle](<qft-image:figure-123>', '![Angle](<images/figure.png>')
      .replace('[figure]: qft-image:figure-123', '[figure]: images/figure.png'));
  });

  it('opens a generic bundle with one nested Markdown file and relative images', async () => {
    const restored = await importWorkspaceBundle(archive({
      'notes/talk.md': strToU8('# Talk\n\n![Plot](../images/plot.png)\n\n![Remote](https://example.org/plot.png)'),
      'images/plot.png': PNG,
    }));
    assert.equal(restored.title, 'talk');
    assert.equal(restored.images.length, 1);
    assert.equal(restored.source, `# Talk\n\n![Plot](${imageReference(restored.images[0].id)})\n\n![Remote](https://example.org/plot.png)`);
  });

  it('retains local image references embedded in code examples unchanged', async () => {
    const source = '![Actual](qft-image:figure-123)\n\n```markdown\n![Example](qft-image:figure-123)\n```';
    const bytes = await createDocumentBundle(source, 'Code example', [image]);
    const restored = await importWorkspaceBundle(new File([new Uint8Array(bytes).buffer], 'example.zip'));
    assert.equal(restored.source, source.replace('![Actual](qft-image:figure-123)', `![Actual](${imageReference(restored.images[0].id)})`));
  });

  it('does not export pictures removed from the source but retained locally for undo', async () => {
    const removed: DraftImage = { ...image, id: 'removed-picture', name: 'Removed.png' };
    const source = '![Visible](qft-image:figure-123)\n\n`![Old example](qft-image:removed-picture)`';
    const files = unzipSync(await createDocumentBundle(source, 'Current document', [image, removed]));
    assert.deepEqual(Object.keys(files).filter((name) => name.startsWith('images/')), ['images/01-Quantum-figure.png']);
    const manifest = JSON.parse(strFromU8(files['qft.json']));
    assert.equal(manifest.images.length, 1);
    assert.equal(manifest.images[0].reference, 'qft-image:figure-123');
    const empty = unzipSync(await createDocumentBundle('# All pictures removed', 'Current document', [image, removed]));
    assert.equal(Object.keys(empty).some((name) => name.startsWith('images/')), false);
  });

  it('relocates actual list images indented by four spaces', async () => {
    const source = '- Results\n\n    ![Nested figure](qft-image:figure-123)';
    const files = unzipSync(await createDocumentBundle(source, 'List', [image]));
    assert.equal(strFromU8(files['List.md']), source.replace('qft-image:figure-123', 'images/01-Quantum-figure.png'));
    assert.ok(files['images/01-Quantum-figure.png']);
  });

  it('preserves fenced code inside blockquotes and excludes its example-only images', async () => {
    const source = '> ```markdown\n> ![Code example](qft-image:figure-123)\n> ```';
    const files = unzipSync(await createDocumentBundle(source, 'Quoted code', [image]));
    assert.equal(strFromU8(files['Quoted-code.md']), source);
    assert.equal(Object.keys(files).some((name) => name.startsWith('images/')), false);
  });

  it('rejects traversal, ambiguous documents, unsupported images, and missing assets', async () => {
    await assert.rejects(importWorkspaceBundle(archive({ '../escape.md': strToU8('# Unsafe') })), /archive path/);
    await assert.rejects(importWorkspaceBundle(archive({ 'one.md': strToU8('# One'), 'two.md': strToU8('# Two') })), /one Markdown/);
    await assert.rejects(importWorkspaceBundle(archive({ 'talk.md': strToU8('![x](x.png)'), 'x.png': strToU8('<svg onload="alert(1)"></svg>') })), /not a supported image/);
    await assert.rejects(importWorkspaceBundle(archive({
      'talk.md': strToU8('# Talk'),
      'qft.json': strToU8(JSON.stringify({ format: 'qft-markdown', version: 1, document: 'talk.md', title: 'Talk', images: [{ path: 'missing.png', reference: 'qft-image:missing' }] })),
    })), /image is missing/);
  });

  it('checks expanded size before decompressing entries and rejects invalid slide metadata', async () => {
    const compressed = zipSync({ 'talk.md': new Uint8Array(2 * 1024 * 1024 + 1) }, { level: 9 });
    await assert.rejects(importWorkspaceBundle(new File([new Uint8Array(compressed).buffer], 'large.zip')), /expanded archive is too large/);
    await assert.rejects(importWorkspaceBundle(archive({
      'talk.md': strToU8('# Talk'),
      'qft.json': strToU8(JSON.stringify({ format: 'qft-markdown', version: 1, document: 'talk.md', title: 'Talk', mode: 'script', images: [] })),
    })), /Invalid document mode/);
  });
});
