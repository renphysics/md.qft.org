import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../public/demo-sandbox.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, 'The isolated runner contains its bootstrap.');

function runner(origin: string, topLevel = false) {
  const parent = {};
  const writes: string[] = [];
  let listener: ((event: { source: unknown; data: unknown }) => void) | undefined;
  const window = { origin, parent, addEventListener: (_: string, handler: typeof listener) => { listener = handler; } };
  if (topLevel) window.parent = window;
  vm.runInNewContext(script!, { window, document: { open() {}, write(value: string) { writes.push(value); }, close() {} } });
  return { parent, writes, send(source: unknown, data: unknown) { listener?.({ source, data }); }, listening: () => Boolean(listener) };
}

test('the demo runner refuses supplied code outside an opaque sandbox', () => {
  for (const [origin, topLevel] of [['https://md.qft.org', false], ['https://md.qft.org', true], ['null', true]] as const) {
    const frame = runner(origin, topLevel);
    assert.equal(frame.listening(), false);
    frame.send(frame.parent, { type: 'qft-demo-load', token: 'a'.repeat(36), html: '<script>custom()</script>' });
    assert.deepEqual(frame.writes, []);
  }
});

test('the sandbox accepts a bounded initialization once and only from its parent', () => {
  const frame = runner('null');
  assert.equal(frame.listening(), true);
  const message = { type: 'qft-demo-load', token: 'a'.repeat(36), html: '<!doctype html><p>Demo</p>' };
  frame.send({}, message);
  frame.send(frame.parent, { ...message, token: 'short' });
  frame.send(frame.parent, { ...message, token: 'G'.repeat(36) });
  frame.send(frame.parent, { ...message, html: 'x'.repeat(160001) });
  frame.send(frame.parent, { ...message, type: 'other' });
  assert.deepEqual(frame.writes, []);
  frame.send(frame.parent, message);
  frame.send(frame.parent, { ...message, html: '<p>Unexpected replacement</p>' });
  assert.deepEqual(frame.writes, [message.html]);
});
