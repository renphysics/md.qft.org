import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { scopedStorageKey } from '../src/lib/storage-scope.ts';

describe('storage namespaces for project sites', () => {
  it('preserves every existing key for root deployments and plain Node tests', () => {
    for (const key of ['qft-markdown', 'qft-markdown-drafts', 'qft-markdown:theme', 'qft-markdown:preferences', 'qft-markdown:active']) {
      assert.equal(scopedStorageKey(key), key);
      for (const base of ['', '/', '///']) assert.equal(scopedStorageKey(key, base), key);
    }
  });

  it('uses one namespace for equivalent base-path spellings', () => {
    const key = 'qft-markdown';
    for (const base of ['notes', '/notes', '/notes/', '//notes//']) {
      assert.equal(scopedStorageKey(key, base), 'qft-markdown:/notes/');
    }
  });

  it('separates root, sibling, nested, and case-distinct project sites', () => {
    const bases = ['/', '/notes/', '/other-notes/', '/notes/example/', '/Notes/'];
    for (const key of ['qft-markdown', 'qft-markdown-drafts', 'qft-markdown:theme', 'qft-markdown:preferences', 'qft-markdown:active']) {
      assert.equal(new Set(bases.map((base) => scopedStorageKey(key, base))).size, bases.length);
    }
  });
});
