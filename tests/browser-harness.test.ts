import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';
import { SuiteContext } from './browser/harness.mjs';

/*
 * The browser suites must keep "failed resource requests" empty. The Check
 * workflow's first run on GitHub failed the `slides` suite with one aborted
 * request for a font that the HTML export had already embedded: the suite had
 * closed the page while the browser's own record of that request was still
 * open. These tests pin how the harness tells such a request from a failure.
 */

/** As in the browser, closing takes a moment: nothing is closed yet when close() returns its promise. */
const later = () => new Promise<void>((resolve) => setTimeout(resolve, 5));

class FakeContext extends EventEmitter {
  closed = false;
  async close() { await later(); this.closed = true; }
  async route() {}
  async newPage() { return new FakePage(this); }
}

class FakePage extends EventEmitter {
  closed = false;
  constructor(private owner: FakeContext) { super(); }
  context() { return this.owner; }
  url() { return 'http://127.0.0.1:4321/'; }
  isClosed() { return this.closed; }
  async close() { await later(); this.closed = true; }
}

const request = (url: string, errorText: string) => ({
  url: () => url, failure: () => ({ errorText }), resourceType: () => 'fetch', method: () => 'GET',
});

async function suite() {
  const browser = { newContext: async () => new FakeContext() };
  const t = new SuiteContext({ browser, baseUrl: 'http://127.0.0.1:4321/', artifacts: '.', name: 'harness' });
  const { context, page } = await t.newPage();
  return { t, context: context as unknown as FakeContext, page: page as unknown as FakePage };
}

const font = 'http://127.0.0.1:4321/_astro/KaTeX_AMS-Regular.woff2';

describe('failed resource requests in the browser suites', () => {
  it('counts a request that fails while its page is in use, and says in which step', async () => {
    const { t, page } = await suite();
    await t.step('Export', async () => { page.emit('requestfailed', request(font, 'net::ERR_ABORTED')); });
    page.emit('requestfailed', request('http://127.0.0.1:4321/missing.js', 'net::ERR_FAILED'));
    assert.deepEqual(t.failedRequests, [
      { url: font, error: 'net::ERR_ABORTED', step: 'Export', resource: 'fetch', method: 'GET', page: 'http://127.0.0.1:4321/' },
      { url: 'http://127.0.0.1:4321/missing.js', error: 'net::ERR_FAILED', step: 'Export', resource: 'fetch', method: 'GET', page: 'http://127.0.0.1:4321/' },
    ]);
    assert.deepEqual(t.closedWhileLoading, []);
  });

  it('lists a request that the browser cancels once the suite has closed its context, and does not count it', async () => {
    const { t, context, page } = await suite();
    await t.step('Export', async () => {
      const closing = context.close();
      // The browser reports the cancelled request while the context closes, or just after.
      page.emit('requestfailed', request(font, 'net::ERR_ABORTED'));
      await closing;
      page.emit('requestfailed', request(font, 'net::ERR_ABORTED'));
    });
    assert.equal(context.closed, true, 'the context really closes');
    assert.deepEqual(t.failedRequests, []);
    assert.deepEqual(t.closedWhileLoading.map((entry: { url: string; step: string }) => [entry.url, entry.step]), [[font, 'Export'], [font, 'Export']]);
    assert.deepEqual(t.records().closedWhileLoading, t.closedWhileLoading, 'the results file names them');
  });

  it('does the same when only the page is closed, also by the browser itself', async () => {
    const { t, page } = await suite();
    const closing = page.close();
    assert.equal(page.isClosed(), false, 'the page is still closing');
    page.emit('requestfailed', request(font, 'net::ERR_ABORTED'));
    assert.deepEqual([t.failedRequests.length, t.closedWhileLoading.length], [0, 1]);
    await closing;
    assert.equal(page.isClosed(), true, 'the page really closes');
    const other = await suite();
    other.page.closed = true;
    other.page.emit('requestfailed', request(font, 'net::ERR_ABORTED'));
    assert.deepEqual([other.t.failedRequests.length, other.t.closedWhileLoading.length], [0, 1]);
  });

  it('still counts every other failure after closing, and a request blocked by the Content Security Policy', async () => {
    const { t, context, page } = await suite();
    await context.close();
    page.emit('requestfailed', request(font, 'net::ERR_CONNECTION_REFUSED'));
    page.emit('requestfailed', request('https://example.org/x.js', 'csp'));
    assert.deepEqual(t.failedRequests.map((entry: { error: string }) => entry.error), ['net::ERR_CONNECTION_REFUSED', 'csp']);
    assert.deepEqual(t.closedWhileLoading, []);
    // A blocked request that a suite provokes on purpose stays allowed.
    t.allowBlockedRequest(/example\.org/);
    page.emit('requestfailed', request('https://example.org/y.js', 'csp'));
    assert.equal(t.failedRequests.length, 2);
  });

  it('closes every context of a suite through the same path', async () => {
    const { t, context, page } = await suite();
    const closing = t.close();
    page.emit('requestfailed', request(font, 'net::ERR_ABORTED'));
    await closing;
    assert.equal(context.closed, true);
    assert.deepEqual([t.failedRequests.length, t.closedWhileLoading.length], [0, 1]);
  });
});
