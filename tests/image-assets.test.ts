import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createImageObjectUrls, imageIdFromReference, imageMarkdown, imageReference,
  imageToDataUrl, MAX_IMAGE_BYTES, prepareImageFiles, validateImageAssets,
  type DraftImage,
} from '../src/lib/image-assets.ts';

const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=', 'base64'));
const png = (name = 'Figure.png', type = 'image/png') => new File([PNG], name, { type });
const stored = (id: string, bytes = PNG): DraftImage => ({ id, name: `${id}.png`, type: 'image/png', blob: new Blob([bytes], { type: 'image/png' }) });

describe('browser-local image attachments', () => {
  it('identifies actual image bytes rather than trusting extension or MIME', async () => {
    const [image] = await prepareImageFiles([png('figure.dat', 'application/octet-stream')]);
    assert.equal(image.type, 'image/png');
    assert.equal(image.blob.type, 'image/png');
    assert.deepEqual(new Uint8Array(await image.blob.arrayBuffer()), PNG);
    assert.match(image.id, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
    await assert.rejects(prepareImageFiles([new File(['<svg onload="alert(1)"></svg>'], 'picture.png', { type: 'image/png' })]), /not a supported image/);
    await assert.rejects(prepareImageFiles([new File(['%PDF-1.7'], 'picture.jpg', { type: 'image/jpeg' })]), /not a supported image/);
  });

  it('accepts the supported JPEG, GIF, and WebP signatures', async () => {
    const images = await prepareImageFiles([
      new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16])], 'photo.jpg'),
      new File(['GIF89a', new Uint8Array([1, 0, 1, 0])], 'motion.gif'),
      new File(['RIFF', new Uint8Array([4, 0, 0, 0]), 'WEBP'], 'diagram.webp'),
    ]);
    assert.deepEqual(images.map((image) => image.type), ['image/jpeg', 'image/gif', 'image/webp']);
    assert.equal(new Set(images.map((image) => image.id)).size, 3);
  });

  it('validates a whole selection before returning images and never mutates current attachments', async () => {
    const existing = [stored('existing')];
    await assert.rejects(prepareImageFiles([png(), new File([''], 'empty.png')], existing), /empty/);
    assert.equal(existing.length, 1);
    const added = await prepareImageFiles([png()], existing);
    assert.equal(added.length, 1);
    assert.notEqual(added[0].id, existing[0].id);
  });

  it('enforces individual, total-byte, and image-count limits', async () => {
    await assert.rejects(prepareImageFiles([new File([new Uint8Array(MAX_IMAGE_BYTES + 1)], 'too-large.png')]), /larger than 8 MB/);
    const large = new Uint8Array(MAX_IMAGE_BYTES);
    large.set(PNG.subarray(0, 8));
    const existing = [stored('a', large), stored('b', large), stored('c', large)];
    await assert.rejects(prepareImageFiles([png()], existing), /24 MB/);
    const many = Array.from({ length: 50 }, (_, index) => stored(`image-${index}`));
    await assert.rejects(prepareImageFiles([png()], many), /50 local images/);
  });

  it('rejects malformed stored records, duplicate identifiers, and MIME changes', () => {
    assert.throws(() => validateImageAssets([stored('valid'), stored('valid')]), /invalid stored data/);
    assert.throws(() => validateImageAssets([{ ...stored('valid'), id: 'bad)\n<script>' }]), /invalid stored data/);
    assert.throws(() => validateImageAssets([{ ...stored('valid'), type: 'image/svg+xml' }]), /invalid stored data/);
    assert.throws(() => validateImageAssets([{ ...stored('valid'), type: 'image/jpeg' }]), /invalid stored data/);
  });

  it('emits safe, short Markdown references with escaped descriptions', () => {
    const image = stored('image-123');
    assert.equal(imageReference(image.id), 'qft-image:image-123');
    assert.equal(imageIdFromReference('qft-image:image-123'), 'image-123');
    assert.equal(imageIdFromReference('https://example.org/image.png'), undefined);
    assert.equal(imageIdFromReference('qft-image:../../bad'), undefined);
    assert.equal(imageIdFromReference('qft-image:x?query'), undefined);
    assert.equal(imageMarkdown(image, 'A [plot]\nwith \\ labels'), '![A \\[plot\\] with \\\\ labels](qft-image:image-123)');
    assert.equal(imageMarkdown(image), '![image-123](qft-image:image-123)');
  });

  it('keeps a portable data URL byte-for-byte identical to the stored image', async () => {
    const data = await imageToDataUrl(stored('figure'));
    assert.equal(data, `data:image/png;base64,${Buffer.from(PNG).toString('base64')}`);
  });

  it('creates preview mappings and revokes each object URL exactly once', (context) => {
    let next = 0;
    const create = context.mock.method(URL, 'createObjectURL', () => `blob:test-${++next}`);
    const revoke = context.mock.method(URL, 'revokeObjectURL', () => {});
    const handles = createImageObjectUrls([stored('one'), stored('two')]);
    assert.deepEqual([...handles.sources], [['qft-image:one', 'blob:test-1'], ['qft-image:two', 'blob:test-2']]);
    assert.equal(create.mock.callCount(), 2);
    handles.revoke();
    handles.revoke();
    assert.equal(revoke.mock.callCount(), 2);
  });
});
