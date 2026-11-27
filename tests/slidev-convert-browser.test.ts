import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { strToU8 } from 'fflate';
import {
  SLIDEV_START_TIME_LIMIT, SlidevConverterUnavailableError, convertSlidevBuild,
} from '../src/lib/slidev-convert-browser.ts';
import type { DeckDetection, DeckFiles } from '../src/lib/deck-types.ts';

/** A stand-in for the converter's Worker: records what the page sends, replies only when a test says so. */
class FakeWorker {
  static last: FakeWorker | undefined;
  readonly listeners = new Map<string, ((event: unknown) => void)[]>();
  readonly posted: unknown[] = [];
  terminated = false;
  constructor() { FakeWorker.last = this; }
  addEventListener(type: string, listener: (event: unknown) => void) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  postMessage(message: unknown) { this.posted.push(message); }
  terminate() { this.terminated = true; }
  reply(data: unknown) { for (const listener of this.listeners.get('message') ?? []) listener({ data }); }
  fail() { for (const listener of this.listeners.get('error') ?? []) listener({ preventDefault() {} }); }
}

const files: DeckFiles = new Map([['index.html', strToU8('<div id="app"></div>')], ['assets/index-a.js', strToU8('1')]]);
const detection = { kind: 'slidev-build', entry: 'index.html', issues: [], flags: {} } as unknown as DeckDetection;

describe('the converter Worker as the page sees it', () => {
  const original = (globalThis as { Worker?: unknown }).Worker;
  beforeEach(() => { (globalThis as { Worker?: unknown }).Worker = FakeWorker; FakeWorker.last = undefined; });
  afterEach(() => { (globalThis as { Worker?: unknown }).Worker = original; mock.timers.reset(); });

  it('turns a failed download of esbuild.wasm into a plain message with what to do, the reason kept as detail', async () => {
    const converting = convertSlidevBuild(files, detection);
    FakeWorker.last!.reply({ type: 'failed', stage: 'start', message: 'Failed to download "http://127.0.0.1/_astro/esbuild-X.wasm"' });
    const error = await converting.then(() => undefined, (reason: unknown) => reason);
    assert.ok(error instanceof SlidevConverterUnavailableError);
    assert.equal(error.message, 'The Slidev converter could not be downloaded. Check the internet connection, reload the page, and open the ZIP again.');
    assert.match(error.detail, /Failed to download/);
    assert.equal(FakeWorker.last!.terminated, true);
  });

  it('says the same when the Worker script itself cannot load', async () => {
    const converting = convertSlidevBuild(files, detection);
    FakeWorker.last!.fail();
    await assert.rejects(converting, (error: unknown) => error instanceof SlidevConverterUnavailableError && /could not be downloaded/.test(error.message));
  });

  it('stops after 90 seconds of "Preparing the converter…", with the same kind of message', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const progress: string[] = [];
    const converting = convertSlidevBuild(files, detection, { onProgress: (text) => progress.push(text) });
    assert.equal(SLIDEV_START_TIME_LIMIT, 90_000);
    mock.timers.tick(89_999);
    assert.equal(FakeWorker.last!.terminated, false);
    mock.timers.tick(1);
    await assert.rejects(converting, (error: unknown) => error instanceof SlidevConverterUnavailableError
      && error.message === 'The Slidev converter was not ready after 90 seconds. Check the internet connection, reload the page, and open the ZIP again.');
    assert.equal(FakeWorker.last!.terminated, true);
    assert.deepEqual(progress, ['Preparing the converter…']);
  });

  it('does not time the conversion once the converter is ready', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const converting = convertSlidevBuild(files, detection);
    const worker = FakeWorker.last!;
    worker.reply({ type: 'ready' });
    mock.timers.tick(SLIDEV_START_TIME_LIMIT * 3);
    assert.equal(worker.terminated, false);
    worker.reply({ type: 'done', html: '<p>ok</p>', issues: [] });
    assert.deepEqual(await converting, { html: '<p>ok</p>', issues: [] });
    assert.equal(worker.terminated, true);
  });

  it('keeps other failures as they are, with a next step when the Worker gave no reason', async () => {
    const converting = convertSlidevBuild(files, detection);
    FakeWorker.last!.reply({ type: 'ready' });
    FakeWorker.last!.reply({ type: 'failed', message: '' });
    await assert.rejects(converting, (error: unknown) => error instanceof Error && !(error instanceof SlidevConverterUnavailableError)
      && /stopped unexpectedly\. Open the ZIP again/.test(error.message));
  });
});
