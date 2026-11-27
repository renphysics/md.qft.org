import assert from 'node:assert/strict';
import { test } from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { openDeck, originalDownload } from '../src/lib/deck-project';
import { htmlFixture, zipFixture } from './helpers/deck-fixtures';

test('Original gives a presentation imported as one HTML file back as that file, under its name', async () => {
  const file = htmlFixture('plain-html', 'index.html', 'p1.html');
  const project = (await openDeck(file))!;
  assert.ok(project);
  project.edits = new Map([['index.html', '<p>Edited</p>']]);
  const original = await originalDownload(project);
  assert.equal(original.name, 'p1.html');
  assert.equal(original.blob.type, 'text/html');
  assert.deepEqual(new Uint8Array(await original.blob.arrayBuffer()), new Uint8Array(await file.arrayBuffer()));
});

test('Original gives an imported ZIP back as that ZIP', async () => {
  const file = zipFixture('plain-html');
  const project = (await openDeck(file))!;
  assert.ok(project);
  project.edits = new Map([['index.html', '<p>Edited</p>']]);
  const original = await originalDownload(project);
  assert.equal(original.blob, project.original);
  assert.match(original.name, /-original\.zip$/);
});

test('Original gives a teacher\'s own ZIP that holds only index.html back as that ZIP, not as an HTML file', async () => {
  // Made with fflate's defaults, as a ZIP tool would, not with the site's own writer.
  const bytes = zipSync({ 'index.html': strToU8('<!DOCTYPE html><html><head><title>One</title></head><body><section>One</section><section>Two</section></body></html>') });
  const file = new File([bytes.buffer as ArrayBuffer], 'lesson.zip', { type: 'application/zip' });
  const project = (await openDeck(file))!;
  assert.ok(project);
  assert.deepEqual([...project.files.keys()], ['index.html']);
  project.edits = new Map([['index.html', '<p>Edited</p>']]);
  const original = await originalDownload(project);
  assert.equal(original.blob, project.original);
  assert.equal(original.name, 'lesson-original.zip');
  assert.deepEqual(new Uint8Array(await original.blob.arrayBuffer()), bytes);
});
