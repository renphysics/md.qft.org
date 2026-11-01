import { validateImageAssets, type DraftImage } from './image-assets';

/** Editable source that travels with a lesson. No project file executes in the workspace. */
export interface ProjectTextFile { path: string; content: string }
export interface LessonProject {
  version: 2;
  id: string;
  document: string;
  files: ProjectTextFile[];
  imagePaths: { imageId: string; path: string }[];
}

export const MAX_PROJECT_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_PROJECT_TEXT_BYTES = 6 * 1024 * 1024;
export const MAX_PROJECT_ENTRIES = 150;
const identifier = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export function safeProjectPath(path: string): boolean {
  return typeof path === 'string' && path.length > 0 && path.length <= 240
    && !/[\\:\u0000-\u001f\u007f]/.test(path) && !path.startsWith('/')
    && path.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

export function isProjectTextPath(path: string): boolean {
  return /\.(?:md|markdown|txt|json|html?|css|js)$/i.test(path)
    || /(?:^|\/)(?:README|LICENSE|LICENCE|NOTICE)$/i.test(path);
}

/** Resolve a document-relative reference, rejecting network URLs and project traversal. */
export function projectFilePath(reference: string, documentPath: string): string | undefined {
  if (!safeProjectPath(documentPath) || typeof reference !== 'string'
    || /^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(reference)) return undefined;
  let path: string;
  try { path = decodeURIComponent(reference.split(/[?#]/)[0]); } catch { return undefined; }
  if (!path || /[\\:\u0000-\u001f\u007f]/.test(path) || path.startsWith('/')) return undefined;
  const parts = documentPath.split('/').slice(0, -1);
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (!parts.length) return undefined; parts.pop(); }
    else parts.push(part);
  }
  const resolved = parts.join('/');
  return safeProjectPath(resolved) ? resolved : undefined;
}

export function relativeProjectPath(path: string, documentPath: string): string {
  if (!safeProjectPath(path) || !safeProjectPath(documentPath)) throw new Error('The lesson contains an invalid file path.');
  const from = documentPath.split('/').slice(0, -1);
  const to = path.split('/');
  while (from.length && to.length && from[0] === to[0]) { from.shift(); to.shift(); }
  return [...from.map(() => '..'), ...to].join('/');
}

export function cloneLessonProject(value: LessonProject): LessonProject {
  return { version: 2, id: value.id, document: value.document,
    files: value.files.map((file) => ({ ...file })), imagePaths: value.imagePaths.map((image) => ({ ...image })) };
}

/** Validate before storing imported or edited project metadata and return an independent value. */
export function validateLessonProject(value: unknown): LessonProject {
  if (!value || typeof value !== 'object') throw new Error('The lesson project metadata is invalid.');
  const project = value as Partial<LessonProject>;
  if (project.version !== 2 || typeof project.id !== 'string' || !identifier.test(project.id)
    || typeof project.document !== 'string' || !safeProjectPath(project.document) || !/\.(?:md|markdown)$/i.test(project.document)
    || !Array.isArray(project.files) || !Array.isArray(project.imagePaths)
    || project.files.length + project.imagePaths.length + 2 > MAX_PROJECT_ENTRIES) {
    throw new Error('The lesson project metadata is invalid.');
  }
  const paths = new Set(['qft.json', project.document]);
  let total = 0;
  for (const file of project.files) {
    if (!file || typeof file.path !== 'string' || !safeProjectPath(file.path) || !isProjectTextPath(file.path)
      || paths.has(file.path) || typeof file.content !== 'string') throw new Error('The lesson contains an invalid or duplicate source file.');
    const bytes = new TextEncoder().encode(file.content).byteLength;
    total += bytes;
    if (bytes > MAX_PROJECT_FILE_BYTES || total > MAX_PROJECT_TEXT_BYTES) throw new Error('Lesson source files must be at most 2 MB each and 6 MB in total.');
    paths.add(file.path);
  }
  const ids = new Set<string>();
  for (const image of project.imagePaths) {
    if (!image || typeof image.imageId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(image.imageId)
      || typeof image.path !== 'string' || !safeProjectPath(image.path) || !/\.(?:png|jpe?g|webp|gif)$/i.test(image.path)
      || paths.has(image.path) || ids.has(image.imageId)) throw new Error('The lesson contains an invalid or duplicate image path.');
    ids.add(image.imageId);
    paths.add(image.path);
  }
  // A file cannot also be a directory containing another file.
  for (const path of paths) {
    const parts = path.split('/');
    parts.pop();
    while (parts.length) {
      if (paths.has(parts.join('/'))) throw new Error('The lesson contains conflicting file paths.');
      parts.pop();
    }
  }
  return cloneLessonProject(project as LessonProject);
}

export function createLessonProject(document = 'slides.md', id?: string): LessonProject {
  if (!id) {
    const crypto = globalThis.crypto;
    if (typeof crypto?.randomUUID === 'function') id = crypto.randomUUID();
    else if (typeof crypto?.getRandomValues === 'function') {
      id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
    } else throw new Error('This browser cannot create a lesson identifier. Open the site in a current browser.');
  }
  return validateLessonProject({ version: 2, id, document, files: [], imagePaths: [] });
}

/** Give newly inserted images permanent project paths before saving or exporting. */
export function prepareProjectImages(value: LessonProject, images: readonly DraftImage[]): LessonProject {
  const project = validateLessonProject(value);
  const checked = validateImageAssets([...images]);
  const assigned = new Map(project.imagePaths.map((image) => [image.imageId, image.path]));
  const paths = new Set(['qft.json', project.document, ...project.files.map((file) => file.path), ...assigned.values()]);
  const available = (path: string) => ![...paths].some((other) => other === path || other.startsWith(`${path}/`) || path.startsWith(`${other}/`));
  for (let index = 0; index < checked.length; index += 1) {
    const image = checked[index];
    if (assigned.has(image.id)) continue;
    const extension = image.type === 'image/jpeg' ? 'jpg' : image.type.split('/')[1];
    const name = image.name.replace(/\.[^.]+$/, '').normalize('NFKC')
      .replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'document';
    let serial = index + 1;
    let path: string;
    do { path = `images/${String(serial++).padStart(2, '0')}-${name}.${extension}`; } while (!available(path));
    assigned.set(image.id, path);
    paths.add(path);
    project.imagePaths.push({ imageId: image.id, path });
  }
  return validateLessonProject(project);
}
