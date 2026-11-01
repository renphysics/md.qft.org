import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { strFromU8, unzipSync } from 'fflate';
import { createStarterLesson, generateLessonPrompt, type LessonAIInput } from '../src/lib/ai-lesson.ts';
import { createDocumentBundle, importWorkspaceBundle } from '../src/lib/document-bundle.ts';
import { checkLesson } from '../src/lib/lesson-check.ts';

const input: LessonAIInput = {
  topic: 'Quantum wave packets', audience: 'Second-year undergraduates', language: 'English',
  duration: 50, mathLevel: 'Calculus, with symbols explained', demos: 'A wave packet with width and time controls',
};

test('the AI brief is complete and grounded in the supported portable format', () => {
  const prompt = generateLessonPrompt(input);
  for (const text of [input.topic, input.audience, input.language, '50 minutes', input.mathLevel, input.demos]) assert.ok(prompt.includes(text));
  assert.match(prompt, /"version": 2/);
  assert.match(prompt, /projectId.*unchanged/);
  assert.match(prompt, /interactive src="demos\/explore.html"/);
  assert.match(prompt, /No external scripts/);
  assert.match(prompt, /If a needed source is unavailable, ask for it/);
  assert.match(prompt, /\$\.\.\.\$ or \\\(\.\.\.\\\)/);
  assert.match(prompt, /lesson-format-v2\.md/);
});

test('starter projects have stable source paths, fresh identity, working demo source, and license notices', async () => {
  const starter = createStarterLesson(input);
  assert.equal(starter.mode, 'slides');
  assert.equal(starter.project.document, 'slides.md');
  assert.notEqual(starter.project.id, createStarterLesson(input).project.id);
  assert.match(starter.source, /Lesson starter/);
  assert.match(starter.source, /interactive src="demos\/explore.html"/);
  const html = starter.project.files.find((file) => file.path === 'demos/explore.html')!.content;
  assert.match(html, /Math.sin/);
  assert.match(html, /addEventListener\('input', draw\)/);
  assert.match(html, /Copyright \(c\) 2026 Jie Ren/);
  assert.doesNotMatch(html, /<script[^>]*\bsrc=|\bonclick=/i);
  assert.equal(starter.project.files.find((file) => file.path === 'LICENSE')!.content, await readFile(new URL('../LICENSE', import.meta.url), 'utf8'));
  const report = checkLesson(starter.source, { project: starter.project });
  assert.equal(report.slides, 7);
  assert.equal(report.demos, 1);
  assert.deepEqual(report.issues, []);
});

test('a downloaded starter ZIP reopens as the same editable project', async () => {
  const starter = createStarterLesson(input);
  const bytes = await createDocumentBundle(starter.source, starter.title, [], starter);
  const entries = unzipSync(bytes);
  const manifest = JSON.parse(strFromU8(entries['qft.json']));
  assert.equal(manifest.version, 2);
  assert.equal(manifest.projectId, starter.project.id);
  assert.equal(manifest.document, 'slides.md');
  assert.ok(entries['demos/explore.html']);
  const imported = await importWorkspaceBundle(new File([new Uint8Array(bytes).buffer], 'starter.zip', { type: 'application/zip' }));
  assert.equal(imported.project?.id, starter.project.id);
  assert.equal(imported.source, starter.source);
  assert.deepEqual(imported.project?.files, starter.project.files);
  assert.deepEqual(checkLesson(imported.source, { project: imported.project }).issues, []);
});

test('brief input cannot inject new slides or executable HTML into the starter', () => {
  const starter = createStarterLesson({ ...input, topic: 'A title\n\n---\n<script>alert(1)</script> $x$', duration: Number.NaN });
  assert.ok(!starter.title.includes('\n'));
  assert.ok(!starter.source.includes('<script>'));
  assert.match(starter.source, /45 minutes/);
  assert.equal(checkLesson(starter.source, { project: starter.project }).slides, 7);
});

test('a detailed chapter brief stays complete in AI instructions while the project title stays within its limit', () => {
  const topic = 'Discuss the chapter with these details. '.repeat(40) + 'End with a measurement example.';
  assert.ok(generateLessonPrompt({ ...input, topic }).includes(topic));
  const starter = createStarterLesson({ ...input, topic });
  assert.ok(starter.title.length <= 200);
  assert.ok(starter.project.files.find((file) => file.path === 'README.md')!.content.includes(topic));
});

test('the public schema accepts safe paths and excludes traversal and unsupported identity characters', async () => {
  const schema = JSON.parse(await readFile(new URL('../public/lesson.schema.json', import.meta.url), 'utf8'));
  const path = new RegExp(schema.$defs.path.pattern);
  for (const value of ['slides.md', 'lessons/lecture.md', 'images/量子.png']) assert.ok(path.test(value), value);
  for (const value of ['../slides.md', 'a/../slides.md', 'a/./slides.md', '/slides.md', 'a\\b.md', 'a//b.md', 'a\n.md', 'a\u007f.md', 'C:slides.md', 'a/']) assert.ok(!path.test(value), value);
  const identity = new RegExp(schema.properties.projectId.pattern);
  assert.ok(identity.test(createStarterLesson(input).project.id));
  for (const value of ['', '-bad', 'a/b', 'a b', 'a'.repeat(129)]) assert.ok(!identity.test(value), value);
});
