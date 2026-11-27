import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sourceNote } from '../src/scripts/deck-sources.ts';

test('the read-only note of a Slidev build asks for a new project ZIP with dist/ inside, as the Slidev prompt does', () => {
  const note = sourceNote({ kind: 'slidev-build' } as Parameters<typeof sourceNote>[0]);
  assert.equal(note, 'This is a built Slidev presentation, so it is read-only here. To change it, edit the Slidev project, run "npx slidev build" again, then open a new ZIP of the project (with dist/ inside).');
  assert.doesNotMatch(note, /dist folder/);
  assert.match(sourceNote({ kind: 'reveal' } as Parameters<typeof sourceNote>[0]), /Apply changes/);
});
