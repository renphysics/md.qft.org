import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { IDBFactory } from 'fake-indexeddb';
import { createLessonProject, validateLessonProject, projectFilePath, relativeProjectPath, prepareProjectImages } from '../src/lib/lesson-project.ts';
import { createDocumentBundle, importWorkspaceBundle } from '../src/lib/document-bundle.ts';
import { createDraft, getDraft, saveDraft, DraftConflictError } from '../src/lib/draft-store.ts';
import { imageReference } from '../src/lib/image-assets.ts';

const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=', 'base64'));
const zip = (files: Record<string, Uint8Array>) => new File([new Uint8Array(zipSync(files, { level: 0 })).buffer], 'lesson.zip');
const manifest = (patch = {}) => strToU8(JSON.stringify({ format: 'qft-markdown', version: 2, projectId: 'my-lesson-42', document: 'lecture/slides.md', title: 'A lesson', mode: 'slides', images: [], ...patch }));

describe('portable lesson project sources', () => {
  it('keeps a stable identity and exact editable source paths through repeated ZIP round trips', async () => {
    const demo = '\ufeff<style>canvas { width: 100%; }</style>\r\n<canvas></canvas>\r\n<script>const x = 2;</script>\n';
    const original = zip({
      'qft.json': manifest(),
      'lecture/slides.md': strToU8('# Lesson\n\n![Diagram](../images/figure%20(one).png)\n\n```interactive src="../demos/explore.html"\n```\n'),
      'demos/explore.html': strToU8(demo),
      'demos/source.js': strToU8('export const a = 3;\n'),
      'demos/source.css': strToU8('canvas { color: blue; }\n'),
      'teacher/notes.md': strToU8('# Notes\n'),
      'README': strToU8('How to use this lesson\n'),
      'LICENSE': strToU8('Teacher content license\n'),
      'images/figure (one).png': png,
      'images/unused.png': png,
    });
    let imported = await importWorkspaceBundle(original);
    assert.equal(imported.project?.id, 'my-lesson-42');
    assert.equal(imported.project?.document, 'lecture/slides.md');
    assert.equal(imported.project?.files.find((file) => file.path === 'demos/explore.html')?.content, demo);
    assert.match(imported.source, /qft-image:/);
    for (let count = 0; count < 2; count++) {
      const bytes = await createDocumentBundle(imported.source, imported.title, imported.images, imported);
      const files = unzipSync(bytes);
      assert.deepEqual(Object.keys(files).sort(), ['qft.json', 'lecture/slides.md', 'demos/explore.html', 'demos/source.js', 'demos/source.css', 'teacher/notes.md', 'README', 'LICENSE', 'images/figure (one).png', 'images/unused.png'].sort());
      assert.deepEqual(files['demos/explore.html'], strToU8(demo));
      assert.match(strFromU8(files['lecture/slides.md']), /\.\.\/images\/figure%20%28one%29.png/);
      assert.match(strFromU8(files['lecture/slides.md']), /src="\.\.\/demos\/explore.html"/);
      assert.equal(JSON.parse(strFromU8(files['qft.json'])).projectId, 'my-lesson-42');
      imported = await importWorkspaceBundle(new File([new Uint8Array(bytes).buffer], 'round-trip.zip'));
    }
  });

  it('keeps edited demo source and chooses a fresh, noncolliding path for inserted images', async () => {
    const imported = await importWorkspaceBundle(zip({
      'qft.json': manifest({ document: 'slides.md' }), 'slides.md': strToU8('# Lesson'),
      'demos/a.html': strToU8('<button>Old</button>'), 'images/01-figure.png': png,
    }));
    imported.project!.files[0].content = '<button>Revised</button>';
    const added = { ...imported.images[0], id: 'inserted', name: 'figure.png' };
    const files = unzipSync(await createDocumentBundle(`![New](${imageReference(added.id)})`, imported.title, [...imported.images, added], imported));
    assert.equal(strFromU8(files['demos/a.html']), '<button>Revised</button>');
    assert.ok(files['images/01-figure.png']);
    assert.ok(files['images/02-figure.png']);
    assert.match(strFromU8(files['slides.md']), /images\/02-figure.png/);
  });

  it('assigns inserted images durable paths before export so an unchanged ZIP compares consistently', async () => {
    const image = { id: 'new-image', name: 'Plot.png', type: 'image/png' as const, blob: new Blob([png], { type: 'image/png' }) };
    const original = createLessonProject('lecture/slides.md', 'image-path-lesson');
    const project = prepareProjectImages(original, [image]);
    assert.deepEqual(original.imagePaths, []);
    assert.equal(project.imagePaths[0].path, 'images/01-Plot.png');
    assert.deepEqual(prepareProjectImages(project, [image]), project);
    const bytes = await createDocumentBundle(`![Plot](${imageReference(image.id)})`, 'Lesson', [image], { project });
    const imported = await importWorkspaceBundle(new File([new Uint8Array(bytes).buffer], 'lesson.zip'));
    assert.deepEqual(imported.project?.imagePaths.map((entry) => entry.path), project.imagePaths.map((entry) => entry.path));
    assert.equal(imported.project?.id, project.id);
  });

  it('opens an enclosing project folder and ignores operating-system bookkeeping', async () => {
    const imported = await importWorkspaceBundle(zip({
      'Course/qft.json': manifest({ document: 'slides.md' }), 'Course/slides.md': strToU8('# Lesson'),
      'Course/demos/a.html': strToU8('<p>Demo</p>'), 'Course/.DS_Store': new Uint8Array([0, 1, 2]),
      '__MACOSX/._Course': new Uint8Array([0, 1, 2]), 'Thumbs.db': new Uint8Array([0, 1, 2]),
    }));
    assert.equal(imported.project?.document, 'slides.md');
    assert.deepEqual(imported.project?.files, [{ path: 'demos/a.html', content: '<p>Demo</p>' }]);
  });

  it('upgrades v1 and generic archives while preserving their document names and extra sources', async () => {
    for (const version of [undefined, 1]) {
      const files: Record<string, Uint8Array> = { 'lesson.md': strToU8('# Lesson'), 'demos/a.html': strToU8('<p>Demo</p>') };
      if (version) files['qft.json'] = manifest({ version, document: 'lesson.md', projectId: undefined });
      const imported = await importWorkspaceBundle(zip(files));
      assert.equal(imported.project?.version, 2);
      assert.equal(imported.project?.document, 'lesson.md');
      assert.ok(imported.project?.id);
      assert.equal(imported.project?.files[0].path, 'demos/a.html');
    }
  });

  it('rejects unsafe, conflicting, unsupported, and malformed UTF8 project files without partial import', async () => {
    await assert.rejects(importWorkspaceBundle(zip({ 'qft.json': manifest({ projectId: '../id' }), 'lecture/slides.md': strToU8('# Lesson') })), /projectId/);
    await assert.rejects(importWorkspaceBundle(zip({ 'qft.json': manifest(), 'lecture/slides.md': strToU8('# Lesson'), 'source.py': strToU8('print(1)') })), /unsupported file/);
    await assert.rejects(importWorkspaceBundle(zip({ 'qft.json': manifest(), 'lecture/slides.md': strToU8('# Lesson'), 'demos/a.html': new Uint8Array([0xc3, 0x28]) })), /UTF-8/);
    await assert.rejects(importWorkspaceBundle(zip({ 'qft.json': manifest(), 'lecture/slides.md': strToU8('# Lesson'), 'source.js': strToU8('x'), 'source.js/file.txt': strToU8('x') })), /conflicting file paths/);
    await assert.rejects(importWorkspaceBundle(zip({ 'qft.json': manifest(), 'lecture/slides.md': strToU8('# Lesson'), 'a/../../bad.html': strToU8('<p>x</p>') })), /archive path/);
  });

  it('resolves local references without allowing network or project traversal', () => {
    assert.equal(projectFilePath('../demos/a%20b.html', 'lecture/slides.md'), 'demos/a b.html');
    assert.equal(projectFilePath('./fig.png', 'lecture/slides.md'), 'lecture/fig.png');
    for (const ref of ['https://example.org/x.html', '//example.org/x.html', '../../secret', '%2froot', '..%2f..%2fsecret', 'a%5cb.html', 'blob:x', '#same']) {
      assert.equal(projectFilePath(ref, 'lecture/slides.md'), undefined, ref);
    }
    assert.equal(relativeProjectPath('images/figure.png', 'lecture/slides.md'), '../images/figure.png');
  });

  it('validates and deep copies project files so caller edits cannot mutate accepted metadata', () => {
    const project = createLessonProject();
    project.files.push({ path: 'demos/a.html', content: '<p>One</p>' });
    const copied = validateLessonProject(project);
    project.files[0].content = 'changed';
    assert.equal(copied.files[0].content, '<p>One</p>');
    assert.throws(() => validateLessonProject({ ...project, files: [{ path: 'slides.md', content: '# Duplicate' }] }), /duplicate source/);
    assert.throws(() => validateLessonProject({ ...project, files: [{ path: 'demos/a.html', content: 'x'.repeat(2 * 1024 * 1024 + 1) }] }), /2 MB/);
  });
});

describe('stored lesson project revisions', () => {
  beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });

  it('preserves source files across saves and competing-tab conflicts without object aliasing', async () => {
    const project = createLessonProject('slides.md', 'stored-lesson');
    project.files.push({ path: 'demos/demo.html', content: '<p>Initial</p>' });
    const initial = await createDraft('Lesson', '# Lesson', { project, mode: 'slides' });
    project.files[0].content = 'Caller mutation';
    assert.equal((await getDraft(initial.id))?.project?.files[0].content, '<p>Initial</p>');
    const winningProject = validateLessonProject(initial.project!);
    winningProject.files[0].content = '<p>Revised</p>';
    await saveDraft({ ...initial, project: winningProject });
    await assert.rejects(saveDraft({ ...initial, source: 'stale' }), (error: unknown) => {
      assert.ok(error instanceof DraftConflictError);
      assert.equal(error.current?.project?.files[0].content, '<p>Revised</p>');
      error.current!.project!.files[0].content = 'Error object mutation';
      return true;
    });
    assert.equal((await getDraft(initial.id))?.project?.files[0].content, '<p>Revised</p>');
  });
});
