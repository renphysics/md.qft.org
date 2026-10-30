import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveSiteUrl } from '../scripts/site-url.mjs';

describe('deployment URLs', () => {
  it('keeps custom domains at the root', () => {
    assert.deepEqual(resolveSiteUrl('https://md.qft.org/'), { site: 'https://md.qft.org', base: '/' });
    assert.deepEqual(resolveSiteUrl('https://notes.example.org'), { site: 'https://notes.example.org', base: '/' });
  });

  it('uses the repository path returned by GitHub Pages', () => {
    assert.deepEqual(resolveSiteUrl('https://someone.github.io/math-notes'), {
      site: 'https://someone.github.io', base: '/math-notes/',
    });
    assert.deepEqual(resolveSiteUrl('https://someone.github.io/math-notes/'), {
      site: 'https://someone.github.io', base: '/math-notes/',
    });
  });

  it('rejects values that are not deployment locations', () => {
    for (const value of ['file:///tmp/site', 'javascript:alert(1)', 'https://user:password@example.org', 'https://example.org/?q=1', 'https://example.org/#section']) {
      assert.throws(() => resolveSiteUrl(value), /SITE_URL/);
    }
  });
});
