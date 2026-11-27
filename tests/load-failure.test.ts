import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LOAD_FAILURE_TEXT, errorMessage, isLoadFailure, watchLoadFailures } from '../src/lib/load-failure.ts';

describe('a part of the site that could not be loaded', () => {
  it('recognises the failed-import texts of Chrome, Firefox, Safari and Vite', () => {
    for (const message of [
      'Failed to fetch dynamically imported module: http://127.0.0.1:5041/_astro/presentation-store.CLISFpdZ.js',
      'error loading dynamically imported module: https://md.qft.org/_astro/deck-project.Bg-4qDB0.js',
      'Importing a module script failed.',
      'Unable to preload CSS for /_astro/deck-editor.Ab12.css',
    ]) {
      assert.equal(isLoadFailure(new TypeError(message)), true, message);
      assert.equal(errorMessage(new TypeError(message), 'fallback'), LOAD_FAILURE_TEXT);
    }
    assert.equal(isLoadFailure(Object.assign(new Error('Loading chunk 7 failed.'), { name: 'ChunkLoadError' })), true);
  });

  it('leaves every other error with its own message', () => {
    assert.equal(isLoadFailure(new Error('This presentation was removed in another tab.')), false);
    assert.equal(isLoadFailure(undefined), false);
    assert.equal(isLoadFailure('Failed to fetch dynamically imported module'), false, 'only error objects');
    assert.equal(errorMessage(new Error('Disk full.'), 'fallback'), 'Disk full.');
    assert.equal(errorMessage(42, 'fallback'), 'fallback');
  });

  it('says what happened and what to do, without technical words', () => {
    assert.match(LOAD_FAILURE_TEXT, /site was updated while this page was open/);
    assert.match(LOAD_FAILURE_TEXT, /Reload the page to continue\./);
    assert.match(LOAD_FAILURE_TEXT, /saved presentations and documents are kept/);
    assert.doesNotMatch(LOAD_FAILURE_TEXT, /module|chunk|fetch/i);
  });

  it('listens once per page for the preload failures that Vite announces', () => {
    const listeners: Array<() => void> = [];
    const shown: string[] = [];
    const global = globalThis as { window?: unknown };
    global.window = { addEventListener: (type: string, listener: () => void) => { if (type === 'vite:preloadError') listeners.push(listener); } };
    try {
      watchLoadFailures((text) => shown.push(text));
      watchLoadFailures((text) => shown.push(`second ${text}`));
      assert.equal(listeners.length, 1);
      listeners[0]!();
      assert.deepEqual(shown, [LOAD_FAILURE_TEXT]);
    } finally { delete global.window; }
  });
});
