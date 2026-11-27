import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';
import { SuiteContext } from './browser/harness.mjs';

/*
 * The browser suites must keep "failed resource requests" empty. On GitHub's
 * runner the Check workflow failed the `slides` suite twice: while the HTML
 * export fetched its font files, the browser reported some of the fetches as
 * aborted, although the exported file held every font. These tests pin what
 * the harness records about a failed request, and the one way a suite can set
 * such a report aside: with proof that the page received the file.
 */

class FakeContext extends EventEmitter {
  async close() {}
  async route() {}
  async newPage() { return new FakePage(this); }
}

class FakePage extends EventEmitter {
  constructor(private owner: FakeContext) { super(); }
  context() { return this.owner; }
  url() { return 'http://127.0.0.1:4321/'; }
  isClosed() { return false; }
  async close() {}
}

type Answer = { status: number; length?: number; body?: number | Error } | null;
const request = (url: string, errorText: string, resource = 'fetch', answer: Answer = null) => ({
  url: () => url, failure: () => ({ errorText }), resourceType: () => resource, method: () => 'GET',
  response: async () => answer && {
    status: () => answer.status,
    headers: () => answer.length === undefined ? {} : { 'content-length': String(answer.length) },
    body: async () => { if (answer.body instanceof Error) throw answer.body; return Buffer.alloc(answer.body ?? 0); },
  },
});

async function suite() {
  const browser = { newContext: async () => new FakeContext() };
  const t = new SuiteContext({ browser, baseUrl: 'http://127.0.0.1:4321/', artifacts: '.', name: 'harness' });
  const { page } = await t.newPage();
  return { t, page: page as unknown as FakePage };
}

const settled = () => new Promise<void>((resolve) => setTimeout(resolve, 10));
const font = 'http://127.0.0.1:4321/_astro/KaTeX_AMS-Regular.woff2';
const other = 'http://127.0.0.1:4321/_astro/KaTeX_Main-Regular.woff2';

describe('failed resource requests in the browser suites', () => {
  it('records a failed request with its step, page and kind, and what became of its response', async () => {
    const { t, page } = await suite();
    await t.step('Export', async () => { page.emit('requestfailed', request(font, 'net::ERR_ABORTED', 'fetch', { status: 200, length: 28076, body: 28076 })); });
    page.emit('requestfailed', request('http://127.0.0.1:4321/missing.js', 'net::ERR_FAILED', 'script'));
    page.emit('requestfailed', request(other, 'net::ERR_ABORTED', 'fetch', { status: 200, length: 26272, body: new Error('No resource with given identifier found\nat x') }));
    assert.equal(t.failedRequests.length, 3, 'recorded at once');
    await settled();
    assert.deepEqual(t.failedRequests, [
      { url: font, error: 'net::ERR_ABORTED', step: 'Export', resource: 'fetch', method: 'GET', page: 'http://127.0.0.1:4321/', status: 200, announced: 28076, received: 28076 },
      { url: 'http://127.0.0.1:4321/missing.js', error: 'net::ERR_FAILED', step: 'Export', resource: 'script', method: 'GET', page: 'http://127.0.0.1:4321/', status: null },
      { url: other, error: 'net::ERR_ABORTED', step: 'Export', resource: 'fetch', method: 'GET', page: 'http://127.0.0.1:4321/', status: 200, announced: 26272, received: 'No resource with given identifier found' },
    ]);
    assert.deepEqual(t.records().failedRequests, t.failedRequests);
  });

  it('sets aside a fetch reported as aborted only with the suite\'s proof that the file was delivered', async () => {
    const { t, page } = await suite();
    const list = t.failedRequests;
    page.emit('requestfailed', request(font, 'net::ERR_ABORTED'));
    page.emit('requestfailed', request(other, 'net::ERR_ABORTED'));
    const aside = t.setAsideDelivered((url: string) => url === font);
    assert.deepEqual(aside.map((entry: { url: string }) => entry.url), [font]);
    assert.deepEqual(t.failedRequests.map((entry: { url: string }) => entry.url), [other], 'the file without proof still counts');
    assert.equal(t.failedRequests, list, 'the same list, for a suite that holds on to it');
    assert.deepEqual(t.deliveredDespiteAbort.map((entry: { url: string }) => entry.url), [font]);
    assert.deepEqual(t.records().deliveredDespiteAbort, t.deliveredDespiteAbort, 'the results file names what was set aside');
  });

  it('never sets aside another kind of failure, or another kind of request, whatever the proof says', async () => {
    const { t, page } = await suite();
    page.emit('requestfailed', request(font, 'net::ERR_CONNECTION_REFUSED'));
    page.emit('requestfailed', request(font, 'net::ERR_ABORTED', 'font'));
    page.emit('requestfailed', request(font, 'csp'));
    assert.deepEqual(t.setAsideDelivered(() => true), []);
    assert.deepEqual(t.failedRequests.map((entry: { error: string; resource: string }) => [entry.error, entry.resource]),
      [['net::ERR_CONNECTION_REFUSED', 'fetch'], ['net::ERR_ABORTED', 'font'], ['csp', 'fetch']]);
    assert.deepEqual(t.deliveredDespiteAbort, []);
  });

  it('still ignores a request that a suite provokes on purpose and the Content Security Policy blocks', async () => {
    const { t, page } = await suite();
    t.allowBlockedRequest(/example\.org/);
    page.emit('requestfailed', request('https://example.org/y.js', 'csp'));
    page.emit('requestfailed', request('https://example.com/z.js', 'csp'));
    assert.deepEqual(t.failedRequests.map((entry: { url: string }) => entry.url), ['https://example.com/z.js']);
  });
});
