import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import MarkdownIt, { type Token } from 'markdown-it';
import { katex as mathPlugin } from '@mdit/plugin-katex';
import { footnote } from '@mdit/plugin-footnote';
import type { DraftOptions } from './draft-store';
import {
  prepareImageFiles, imageReference, imageIdFromReference,
  validateImageAssets, type DraftImage,
} from './image-assets';

const MAX_ARCHIVE_BYTES = 30 * 1024 * 1024;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_SOURCE_LENGTH = 400_000;
const MANIFEST_NAME = 'qft.json';
const imageParser = new MarkdownIt({ html: false, linkify: false, typographer: false })
  .use(mathPlugin, { delimiters: 'all', mathFence: false, allowInlineWithSpace: false })
  .use(footnote);

export interface WorkspaceBundle extends DraftOptions {
  title: string;
  source: string;
  images: DraftImage[];
}

interface BundleManifest {
  format: 'qft-markdown';
  version: 1;
  document: string;
  title: string;
  mode?: DraftOptions['mode'];
  slideTheme?: DraftOptions['slideTheme'];
  slideRatio?: DraftOptions['slideRatio'];
  images: { path: string; reference: string; name?: string }[];
}

function baseName(title: string): string {
  return title.normalize('NFKC').replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'document';
}

function isEscaped(source: string, at: number): boolean {
  let slashes = 0;
  while (at > 0 && source[--at] === '\\') slashes += 1;
  return slashes % 2 === 1;
}

/** Preserve code examples and prose while relocating Markdown image destinations. */
export function rewriteImageReferences(source: string, transform: (reference: string) => string | undefined): string {
  const edits: { start: number; end: number; replacement: string }[] = [];
  const protectedRanges: { start: number; end: number }[] = [];
  const lineOffsets = [0];
  for (const match of source.matchAll(/\r\n?|\n/g)) lineOffsets.push(match.index + match[0].length);
  const parsedImages = new Set<string>();
  const visit = (tokens: Token[]) => {
    for (const token of tokens) {
      if (token.map && ['fence', 'code_block', 'math_block'].includes(token.type)) {
        protectedRanges.push({ start: lineOffsets[token.map[0]], end: lineOffsets[token.map[1]] ?? source.length });
      }
      if (token.type === 'image') parsedImages.add(String(token.attrGet('src') ?? ''));
      if (token.children) visit(token.children);
    }
  };
  visit(imageParser.parse(source, {}));
  // Block maps account for list and blockquote nesting. Four leading spaces
  // can be real list content, while quoted code fences still need protection.
  protectedRanges.sort((a, b) => a.start - b.start || a.end - b.end);
  for (let index = protectedRanges.length - 1; index > 0; index -= 1) {
    const current = protectedRanges[index];
    const previous = protectedRanges[index - 1];
    if (previous.end >= current.start) {
      previous.end = Math.max(previous.end, current.end);
      protectedRanges.splice(index, 1);
    }
  }
  const protectedAt = (index: number) => {
    let lower = 0;
    let upper = protectedRanges.length;
    while (lower < upper) {
      const middle = (lower + upper) >>> 1;
      if (protectedRanges[middle].end <= index) lower = middle + 1;
      else upper = middle;
    }
    const range = protectedRanges[lower];
    return range && range.start <= index ? range : undefined;
  };
  const labels = new Set<string>();
  const normalizeLabel = (label: string) => label.trim().replace(/\s+/g, ' ').toLowerCase();
  const record = (start: number, end: number) => {
    const raw = source.slice(start, end);
    const decoded = imageParser.utils.unescapeAll(raw);
    if (!parsedImages.has(imageParser.normalizeLink(decoded))) return;
    const replacement = transform(decoded);
    if (replacement !== undefined && replacement !== raw) edits.push({ start, end, replacement });
  };
  for (let index = 0; index < source.length; index += 1) {
    const protectedRange = protectedAt(index);
    if (protectedRange) { index = protectedRange.end - 1; continue; }
    if (source[index] === '`' && !isEscaped(source, index)) {
      let end = index;
      while (source[end] === '`') end += 1;
      const closing = source.indexOf(source.slice(index, end), end);
      if (closing !== -1) index = closing + end - index - 1;
      continue;
    }
    if (source[index] !== '!' || source[index + 1] !== '[' || isEscaped(source, index)) continue;
    let end = index + 2;
    let brackets = 1;
    for (; end < source.length && brackets; end += 1) {
      if (source[end] === '\\') { end += 1; continue; }
      if (source[end] === '[') brackets += 1;
      if (source[end] === ']') brackets -= 1;
    }
    if (brackets) continue;
    const alt = source.slice(index + 2, end - 1);
    if (source[end] !== '(') {
      if (source[end] === '[') {
        const close = source.indexOf(']', end + 1);
        if (close !== -1) labels.add(normalizeLabel(source.slice(end + 1, close) || alt));
      } else labels.add(normalizeLabel(alt));
      index = end - 1;
      continue;
    }
    let start = end + 1;
    while (/\s/.test(source[start] ?? '') && start < source.length) start += 1;
    if (source[start] === '<') {
      start += 1;
      end = start;
      while (end < source.length && (source[end] !== '>' || isEscaped(source, end))) end += 1;
      if (end < source.length) record(start, end);
    } else {
      end = start;
      let depth = 0;
      for (; end < source.length; end += 1) {
        const char = source[end];
        if (char === '\\') { end += 1; continue; }
        if (/\s/.test(char)) break;
        if (char === '(') depth += 1;
        if (char === ')') {
          if (!depth) break;
          depth -= 1;
        }
      }
      if (end > start) record(start, end);
    }
    index = end;
  }
  const definitions = /^ {0,3}\[([^\]\n]+)\]:[ \t]*(?:<([^>\n]+)>|([^\s]+))/gm;
  for (const match of source.matchAll(definitions)) {
    if (!labels.has(normalizeLabel(match[1])) || protectedAt(match.index)) continue;
    const value = match[2] ?? match[3];
    const start = match.index + match[0].lastIndexOf(value);
    record(start, start + value.length);
  }
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    source = source.slice(0, edit.start) + edit.replacement + source.slice(edit.end);
  }
  return source;
}

/** Ordinary Markdown and raster assets remain usable without this application. */
export async function createDocumentBundle(
  source: string, title: string, value: readonly DraftImage[], metadata: DraftOptions = {},
): Promise<Uint8Array> {
  if (source.length > MAX_SOURCE_LENGTH) throw new Error('This document is too large to bundle.');
  const usedReferences = new Set<string>();
  rewriteImageReferences(source, (reference) => { usedReferences.add(reference); return undefined; });
  // Drafts retain removed pictures for undo. Export only pictures that the
  // current Markdown actually uses, never those hidden editing-history assets.
  const images = validateImageAssets(value).filter((image) => usedReferences.has(imageReference(image.id)));
  const files: Record<string, Uint8Array> = Object.create(null);
  const references = new Map<string, string>();
  const manifestImages: BundleManifest['images'] = [];
  for (let index = 0; index < images.length; index += 1) {
    const image = images[index];
    const extension = image.type === 'image/jpeg' ? 'jpg' : image.type.split('/')[1];
    const path = `images/${String(index + 1).padStart(2, '0')}-${baseName(image.name.replace(/\.[^.]+$/, ''))}.${extension}`;
    references.set(imageReference(image.id), path);
    manifestImages.push({ path, reference: imageReference(image.id), name: image.name });
    files[path] = new Uint8Array(await image.blob.arrayBuffer());
  }
  const documentPath = `${baseName(title)}.md`;
  files[documentPath] = strToU8(rewriteImageReferences(source, (reference) => references.get(reference)));
  const manifest: BundleManifest = {
    format: 'qft-markdown', version: 1, document: documentPath, title: title.slice(0, 200),
    mode: metadata.mode, slideTheme: metadata.slideTheme, slideRatio: metadata.slideRatio,
    images: manifestImages,
  };
  files[MANIFEST_NAME] = strToU8(JSON.stringify(manifest, null, 2));
  // Raster images are already compressed; stored ZIP entries avoid blocking the
  // editor with expensive, ineffective recompression of photographs.
  return zipSync(files, { level: 0 });
}

export async function downloadDocumentBundle(
  source: string, title: string, images: readonly DraftImage[], metadata: DraftOptions = {},
): Promise<void> {
  const bytes = await createDocumentBundle(source, title, images, metadata);
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], { type: 'application/zip' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${baseName(title)}.zip`;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function safeArchivePath(path: string): boolean {
  return !!path && !/[\\:\u0000-\u001f]/.test(path) && !path.startsWith('/')
    && path.split('/').every((part, index, all) => part !== '..' && part !== '.' && (part !== '' || index === all.length - 1));
}

function relativeAsset(reference: string, documentPath: string): string | undefined {
  if (/^[a-z][a-z0-9+.-]*:|^\/|^#/i.test(reference)) return undefined;
  let path: string;
  try { path = decodeURIComponent(reference.split(/[?#]/)[0]); } catch { return undefined; }
  if (/[\\\u0000-\u001f]/.test(path)) return undefined;
  const parts = documentPath.split('/').slice(0, -1);
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (!parts.length) return undefined; parts.pop(); }
    else parts.push(part);
  }
  return parts.join('/');
}

function readManifest(value: Uint8Array | undefined): BundleManifest | undefined {
  if (!value) return undefined;
  let parsed: unknown;
  try { parsed = JSON.parse(strFromU8(value)); } catch { throw new Error('The document bundle metadata is invalid.'); }
  if (!parsed || typeof parsed !== 'object') throw new Error('The document bundle metadata is invalid.');
  const manifest = parsed as Partial<BundleManifest>;
  if (manifest.format !== 'qft-markdown' || manifest.version !== 1
    || typeof manifest.document !== 'string' || !safeArchivePath(manifest.document)
    || typeof manifest.title !== 'string' || manifest.title.length > 200
    || !Array.isArray(manifest.images) || manifest.images.length > 50) {
    throw new Error('This document bundle format is not supported.');
  }
  if (manifest.mode !== undefined && !['document', 'slides'].includes(manifest.mode)) throw new Error('Invalid document mode in the bundle.');
  if (manifest.slideTheme !== undefined && !['paper', 'midnight', 'serif'].includes(manifest.slideTheme)) throw new Error('Invalid slide theme in the bundle.');
  if (manifest.slideRatio !== undefined && !['16:9', '4:3'].includes(manifest.slideRatio)) throw new Error('Invalid slide size in the bundle.');
  const paths = new Set<string>();
  const references = new Set<string>();
  for (const image of manifest.images) {
    if (!image || typeof image.path !== 'string' || !safeArchivePath(image.path)
      || typeof image.reference !== 'string' || !imageIdFromReference(image.reference)
      || (image.name !== undefined && (typeof image.name !== 'string' || image.name.length > 200 || /[\\/\u0000-\u001f]/.test(image.name)))
      || paths.has(image.path) || references.has(image.reference)) throw new Error('Invalid image mapping in the document bundle.');
    paths.add(image.path);
    references.add(image.reference);
  }
  return manifest as BundleManifest;
}

/** Read our bundles and ordinary ZIPs containing one Markdown file plus images. */
export async function importWorkspaceBundle(file: File): Promise<WorkspaceBundle> {
  if (!file.size || file.size > MAX_ARCHIVE_BYTES) throw new Error('Choose a Markdown ZIP bundle smaller than 30 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let totalBytes = 0;
  let entries = 0;
  const seen = new Set<string>();
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (entry) => {
      entries += 1;
      if (entries > 150 || !safeArchivePath(entry.name) || seen.has(entry.name)) throw new Error('Invalid or duplicate archive path.');
      seen.add(entry.name);
      if (entry.name.endsWith('/') || entry.name.startsWith('__MACOSX/')) return false;
      const supported = /\.(?:md|markdown|txt|png|jpe?g|webp|gif)$/i.test(entry.name) || entry.name === MANIFEST_NAME;
      if (!supported) return false;
      const limit = entry.name === MANIFEST_NAME ? 32 * 1024 : /\.(?:md|markdown|txt)$/i.test(entry.name) ? MAX_TEXT_BYTES : 8 * 1024 * 1024;
      totalBytes += entry.originalSize;
      if (entry.originalSize > limit || totalBytes > MAX_ARCHIVE_BYTES) throw new Error('The expanded archive is too large.');
      return true;
    } });
  } catch (error) {
    throw new Error(`This ZIP bundle could not be opened. ${error instanceof Error ? error.message : 'Choose a valid Markdown ZIP bundle.'}`);
  }
  const manifest = readManifest(files[MANIFEST_NAME]);
  const candidates = Object.keys(files).filter((name) => /\.(?:md|markdown)$/i.test(name));
  if (!manifest && candidates.length !== 1) throw new Error('A ZIP bundle must contain one Markdown document, or a QFT document manifest.');
  const documentPath = manifest?.document ?? candidates[0];
  if (!files[documentPath] || !/\.(?:md|markdown)$/i.test(documentPath)) throw new Error('The Markdown document is missing from this bundle.');
  let source: string;
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(files[documentPath]); }
  catch { throw new Error('The Markdown document must use UTF-8 text.'); }
  if (source.length > MAX_SOURCE_LENGTH) throw new Error('The Markdown document is too large to preview.');
  const imagePaths = Object.keys(files).filter((name) => /\.(?:png|jpe?g|webp|gif)$/i.test(name));
  const images = await prepareImageFiles(imagePaths.map((name) => new File([new Uint8Array(files[name]).buffer], name.split('/').pop()!)));
  const imageMap = new Map(imagePaths.map((path, index) => [path, imageReference(images[index].id)]));
  const oldReferences = new Map<string, string>();
  for (const mapping of manifest?.images ?? []) {
    const reference = imageMap.get(mapping.path);
    if (!reference) throw new Error(`An image is missing from the bundle: ${mapping.path}`);
    if (mapping.name) images[imagePaths.indexOf(mapping.path)].name = mapping.name;
    oldReferences.set(mapping.reference, reference);
  }
  source = rewriteImageReferences(source, (reference) => oldReferences.get(reference)
    ?? imageMap.get(relativeAsset(reference, documentPath) ?? ''));
  return {
    title: manifest?.title || documentPath.split('/').pop()!.replace(/\.[^.]+$/, '').slice(0, 200),
    source, images, mode: manifest?.mode, slideTheme: manifest?.slideTheme, slideRatio: manifest?.slideRatio,
  };
}
