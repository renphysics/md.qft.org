import type { DraftOptions } from './draft-store';
import { rewriteImageReferences } from './document-bundle';
import { imageReference } from './image-assets';
import { projectFilePath } from './lesson-project';

export interface RevisionDocument extends DraftOptions { title:string; source:string }
export interface LessonFileChange {
  path:string;
  status:'added'|'changed'|'removed';
  before:string;
  after:string;
}

/** Compare portable paths, not browser-specific attachment identifiers. */
export function portableLessonSource(value: RevisionDocument): string {
  const paths = new Map((value.project?.imagePaths ?? []).map((entry) => [imageReference(entry.imageId), entry.path]));
  const available = new Set(paths.values());
  return rewriteImageReferences(value.source, (reference) => {
    const existing = paths.get(reference);
    if (existing) return existing;
    const resolved = value.project ? projectFilePath(reference,value.project.document) : undefined;
    return resolved && available.has(resolved) ? resolved : undefined;
  });
}

function settings(value: RevisionDocument): string {
  return JSON.stringify({
    title:value.title, document:value.project?.document ?? 'slides.md',
    mode:value.mode ?? 'document', slideTheme:value.slideTheme ?? 'paper', slideRatio:value.slideRatio ?? '16:9',
  }, null, 2);
}

/** The review contains actual before/after file contents; no code is executed. */
export async function compareLessonRevision(before: RevisionDocument, after: RevisionDocument): Promise<LessonFileChange[]> {
  const changes:LessonFileChange[] = [];
  const oldFiles = new Map((before.project?.files ?? []).map((file) => [file.path,file.content]));
  const newFiles = new Map((after.project?.files ?? []).map((file) => [file.path,file.content]));
  oldFiles.set(before.project?.document ?? 'slides.md', portableLessonSource(before));
  newFiles.set(after.project?.document ?? 'slides.md', portableLessonSource(after));
  for (const path of new Set([...oldFiles.keys(),...newFiles.keys()])) {
    const old = oldFiles.get(path);
    const next = newFiles.get(path);
    if (old === next) continue;
    changes.push({path,status:old === undefined ? 'added' : next === undefined ? 'removed' : 'changed',before:old ?? '',after:next ?? ''});
  }
  const oldImages = new Map((before.project?.imagePaths ?? []).map((entry) => [entry.path,before.images?.find((image) => image.id === entry.imageId)]));
  const newImages = new Map((after.project?.imagePaths ?? []).map((entry) => [entry.path,after.images?.find((image) => image.id === entry.imageId)]));
  for (const path of new Set([...oldImages.keys(),...newImages.keys()])) {
    const old = oldImages.get(path);
    const next = newImages.get(path);
    let equal = old?.blob === next?.blob;
    if (!equal && old && next && old.blob.size === next.blob.size && old.type === next.type) {
      const a = new Uint8Array(await old.blob.arrayBuffer());
      const b = new Uint8Array(await next.blob.arrayBuffer());
      equal = a.every((byte,index) => byte === b[index]);
    }
    if (equal) continue;
    const describe = (image:typeof old) => image ? `${image.name}\n${image.type}\n${image.blob.size.toLocaleString('en-US')} bytes\n\nImage contents ${old && next ? 'changed' : image === old ? 'removed' : 'added'}.` : '';
    changes.push({path,status:!old ? 'added' : !next ? 'removed' : 'changed',before:describe(old),after:describe(next)});
  }
  if (settings(before) !== settings(after)) changes.unshift({path:'Lesson settings',status:'changed',before:settings(before),after:settings(after)});
  return changes;
}
