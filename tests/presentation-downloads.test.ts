import assert from 'node:assert/strict';
import { test } from 'node:test';
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
