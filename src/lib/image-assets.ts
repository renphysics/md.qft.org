/** Local images travel with their draft; Markdown stores only a stable, short reference. */
export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';

export interface DraftImage {
  id: string;
  name: string;
  type: ImageMime;
  blob: Blob;
}

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_DOCUMENT_IMAGE_BYTES = 24 * 1024 * 1024;
export const MAX_DOCUMENT_IMAGES = 50;
const IMAGE_PREFIX = 'qft-image:';
const IMAGE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
const IMAGE_MIME = /^image\/(?:png|jpeg|webp|gif)$/;

export class ImageAssetError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ImageAssetError';
  }
}

export function imageReference(id: string): string {
  if (!IMAGE_ID.test(id)) throw new ImageAssetError('This image has an invalid identifier.');
  return `${IMAGE_PREFIX}${id}`;
}

export function imageIdFromReference(source: string): string | undefined {
  if (!source.startsWith(IMAGE_PREFIX)) return undefined;
  const id = source.slice(IMAGE_PREFIX.length);
  return IMAGE_ID.test(id) ? id : undefined;
}

function newImageId(): string {
  const provider = globalThis.crypto;
  if (typeof provider?.randomUUID === 'function') return provider.randomUUID();
  if (typeof provider?.getRandomValues !== 'function') {
    throw new ImageAssetError('This browser cannot create an image identifier. Open the site in a current browser.');
  }
  const bytes = provider.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function safeName(value: string): string {
  return value.split(/[\\/]/).pop()!.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200) || 'Image';
}

function detectedMime(bytes: Uint8Array): ImageMime | undefined {
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  const prefix = String.fromCharCode(...bytes.subarray(0, 12));
  if (prefix.startsWith('GIF87a') || prefix.startsWith('GIF89a')) return 'image/gif';
  if (bytes.length >= 12 && prefix.startsWith('RIFF') && prefix.slice(8, 12) === 'WEBP') return 'image/webp';
  return undefined;
}

/** Validate stored metadata without reading all image bytes on every autosave. */
export function validateImageAssets(value: unknown): DraftImage[] {
  if (!Array.isArray(value)) throw new ImageAssetError('The document images could not be read.');
  if (value.length > MAX_DOCUMENT_IMAGES) throw new ImageAssetError(`A document can contain up to ${MAX_DOCUMENT_IMAGES} local images.`);
  const ids = new Set<string>();
  let total = 0;
  return value.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object') throw new ImageAssetError('A document image could not be read.');
    const image = entry as Partial<DraftImage>;
    if (typeof image.id !== 'string' || !IMAGE_ID.test(image.id) || ids.has(image.id)
      || typeof image.name !== 'string' || image.name.length > 200
      || typeof image.type !== 'string' || !IMAGE_MIME.test(image.type)
      || !(image.blob instanceof Blob) || image.blob.type !== image.type) {
      throw new ImageAssetError('A document image has invalid stored data.');
    }
    if (image.blob.size === 0 || image.blob.size > MAX_IMAGE_BYTES) {
      throw new ImageAssetError('Each image must be nonempty and no larger than 8 MB.');
    }
    total += image.blob.size;
    if (total > MAX_DOCUMENT_IMAGE_BYTES) throw new ImageAssetError('A document can contain up to 24 MB of local images.');
    ids.add(image.id);
    return { id: image.id, name: image.name, type: image.type as ImageMime, blob: image.blob };
  });
}

/** Returns new attachments only. The entire batch is validated before the caller inserts it. */
export async function prepareImageFiles(files: Iterable<File>, existing: readonly DraftImage[] = []): Promise<DraftImage[]> {
  const current = validateImageAssets([...existing]);
  const selected = [...files];
  if (current.length + selected.length > MAX_DOCUMENT_IMAGES) {
    throw new ImageAssetError(`A document can contain up to ${MAX_DOCUMENT_IMAGES} local images.`);
  }
  let total = current.reduce((sum, image) => sum + image.blob.size, 0);
  const prepared: DraftImage[] = [];
  for (const file of selected) {
    if (!(file instanceof Blob)) throw new ImageAssetError('Choose a PNG, JPEG, WebP, or GIF image.');
    const name = safeName(file.name ?? 'Image');
    if (!file.size) throw new ImageAssetError(`“${name}” is empty. Choose a PNG, JPEG, WebP, or GIF image.`);
    if (file.size > MAX_IMAGE_BYTES) throw new ImageAssetError(`“${name}” is larger than 8 MB. Choose a smaller image.`);
    total += file.size;
    if (total > MAX_DOCUMENT_IMAGE_BYTES) throw new ImageAssetError('A document can contain up to 24 MB of local images.');
    let header: Uint8Array;
    try { header = new Uint8Array(await file.slice(0, 16).arrayBuffer()); }
    catch (error) { throw new ImageAssetError(`“${name}” could not be read. Please choose the image again.`, { cause: error }); }
    const type = detectedMime(header);
    if (!type) throw new ImageAssetError(`“${name}” is not a supported image. Choose a PNG, JPEG, WebP, or GIF file.`);
    // Canonicalize the MIME from bytes. Filenames and clipboard MIME labels may be wrong.
    prepared.push({ id: newImageId(), name, type, blob: new Blob([file], { type }) });
  }
  return prepared;
}

export function imageMarkdown(image: DraftImage, alt?: string): string {
  const description = (alt ?? image.name.replace(/\.[A-Za-z0-9]{1,8}$/, ''))
    .replace(/[\r\n]+/g, ' ').replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
  return `![${description}](${imageReference(image.id)})`;
}

/** Revoke the returned URLs after a draft is replaced or its preview is disposed. */
export function createImageObjectUrls(images: readonly DraftImage[] = []): {
  sources: Map<string, string>;
  revoke: () => void;
} {
  const sources = new Map<string, string>();
  try {
    for (const image of images) sources.set(imageReference(image.id), URL.createObjectURL(image.blob));
  } catch (error) {
    for (const url of sources.values()) URL.revokeObjectURL(url);
    throw error;
  }
  let revoked = false;
  return {
    sources,
    revoke() {
      if (revoked) return;
      revoked = true;
      for (const url of sources.values()) URL.revokeObjectURL(url);
    },
  };
}

/** Portable exports use embedded bytes, never browser-session blob URLs. */
export async function imageToDataUrl(image: DraftImage): Promise<string> {
  const bytes = new Uint8Array(await image.blob.arrayBuffer());
  let binary = '';
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return `data:${image.type};base64,${btoa(binary)}`;
}
