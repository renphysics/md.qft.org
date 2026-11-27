import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import vm from 'node:vm';
import { parse, type DefaultTreeAdapterTypes } from 'parse5';
import { linkDeck } from '../src/lib/deck-linker.ts';
import { scriptEventSource } from '../src/lib/deck-linker-runtime.ts';
import type { DeckDetection, DeckFiles } from '../src/lib/deck-types.ts';
import { nodeVendorProvider } from './helpers/deck-vendor-node.ts';

/* onload and onerror of scripts the linker replaces or leaves out (review W3.1). */

type Element = DefaultTreeAdapterTypes.Element;
type ChildNode = DefaultTreeAdapterTypes.ChildNode;

const encoder = new TextEncoder();
const deck = (files: Record<string, string>): DeckFiles => new Map(Object.entries(files).map(([path, value]) => [path, encoder.encode(value)]));
const detection = (kind: 'reveal' | 'html'): DeckDetection => ({ kind, engine: kind === 'reveal' ? 'reveal' : 'html', entry: 'index.html', issues: [], flags: {} } as DeckDetection);
const link = (html: string, extra: Record<string, string> = {}, kind: 'reveal' | 'html' = 'html') =>
  linkDeck(deck({ 'index.html': html, ...extra }), detection(kind), nodeVendorProvider());
const page = (head: string, body = '<p>x</p>') => `<!doctype html><html><head><meta charset="utf-8">${head}</head><body>${body}</body></html>`;

interface Item { tag: string; marker?: string; from?: string; on?: string; onload?: string; code: string }

function items(html: string): Item[] {
  const result: Item[] = [];
  const stack: ChildNode[] = [...parse(html).childNodes].reverse();
  while (stack.length) {
    const node = stack.pop()!;
    if (!('tagName' in node)) continue;
    const element = node as Element;
    const attr = (name: string) => element.attrs.find((item) => item.name === name)?.value;
    if (element.tagName === 'script' || element.tagName === 'style') {
      result.push({
        tag: element.tagName, marker: attr('data-qft-linker'), from: attr('data-qft-from'), on: attr('data-qft-on'), onload: attr('onload'),
        code: element.childNodes.map((child) => ('value' in child ? child.value : '')).join(''),
      });
    }
    stack.push(...[...element.childNodes].reverse());
  }
  return result;
}

const events = (list: Item[]) => list.filter((item) => item.marker === 'script-event');

describe('onload of a replaced script', () => {
  it('runs the code of a local script right after its inlined copy', async () => {
    const result = await link(page('', '<script src="app.js" onload="window.started = 1"></script><script>window.after = 1</script>'), { 'app.js': 'window.app = 1;' });
    const list = items(result.html).filter((item) => item.tag === 'script');
    const index = list.findIndex((item) => item.from === 'app.js');
    assert.ok(index >= 0);
    assert.equal(list[index + 1].marker, 'script-event');
    assert.match(list[index + 1].code, /window\.started = 1/);
    assert.match(list[index + 1].code, /new Event\("load"\)/);
    assert.match(list[index + 1].code, new RegExp(`data-qft-on=\\\\"${list[index].on}\\\\"`));
    assert.equal(list[index + 2].code, 'window.after = 1');
    assert.equal(list[index].onload, undefined);
    assert.equal(events(list).length, 1);
  });

  it('keeps the deferred order for a defer script', async () => {
    const result = await link(page(
      '<script defer src="a.js"></script><script defer src="b.js" onload="go()"></script><script defer src="c.js"></script>',
      '<p>x</p><script>window.inline = 1</script>'), { 'a.js': 'window.a=1', 'b.js': 'window.b=1', 'c.js': 'window.c=1' });
    const order = items(result.html).filter((item) => item.tag === 'script').map((item) => item.from ?? item.marker ?? item.code);
    assert.deepEqual(order, ['window.inline = 1', 'a.js', 'b.js', 'script-event', 'c.js']);
  });

  it('uses the last element when the bundled copy has several (KaTeX auto-render from a CDN)', async () => {
    const result = await link(page(
      '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">'
      + '<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>'
      + '<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js" onload="renderMathInElement(document.body);"></script>',
      '<p>\\(x\\)</p>'));
    const list = items(result.html).filter((item) => item.tag === 'script');
    const event = list.findIndex((item) => item.marker === 'script-event');
    assert.ok(event > 0);
    assert.match(list[event - 1].from ?? '', /auto-render/);
    assert.ok(list[event - 1].on);
    assert.match(list[event].code, /renderMathInElement\(document\.body\);/);
    assert.equal(event, list.length - 1);
  });

  it('runs onload of reveal.js from a CDN after the bundled Reveal.js', async () => {
    const result = await link(page('', '<div class="reveal"><div class="slides"><section>A</section></div></div>'
      + '<script src="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/reveal.js" onload="Reveal.initialize({hash:true})"></script>'), {}, 'reveal');
    const list = items(result.html).filter((item) => item.tag === 'script');
    const event = list.findIndex((item) => item.marker === 'script-event');
    assert.ok(event > 0);
    assert.match(list[event - 1].from ?? '', /reveal\.js/);
    assert.match(list[event].code, /Reveal\.initialize\(\{hash:true\}\)/);
  });

  it('runs onerror, not onload, for a script that is left out', async () => {
    for (const src of ['https://example.org/widget.js', 'missing.js']) {
      const result = await link(page('', `<script src="${src}" onload="window.loaded = 1" onerror="window.failed = 1"></script><p>after</p>`));
      const list = events(items(result.html));
      assert.equal(list.length, 1, src);
      assert.match(list[0].code, /window\.failed = 1/);
      assert.match(list[0].code, /new Event\("error"\)/);
      assert.doesNotMatch(list[0].code, /window\.loaded/);
    }
  });

  it('runs onload once for a library that is already in the page', async () => {
    const src = 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js';
    const result = await link(page(`<script src="${src}"></script><script src="${src}" onload="window.again = 1"></script>`));
    const list = events(items(result.html));
    assert.equal(list.length, 1);
    assert.match(list[0].code, /new Event\("load"\)/);
  });

  it('runs other onload code of a stylesheet once its style is in place', async () => {
    const result = await link(page('<link rel="stylesheet" href="a.css" onload="document.documentElement.className = \'ready\'">'), { 'a.css': 'p{color:red}' });
    const list = items(result.html);
    const style = list.findIndex((item) => item.tag === 'style' && item.from === 'a.css');
    assert.ok(style >= 0);
    assert.equal(list[style + 1].marker, 'script-event');
    assert.match(list[style + 1].code, /className = 'ready'/);
  });

  it('leaves inline scripts and scripts without the attributes alone, and links a linked deck to the same page', async () => {
    const first = await link(page('', '<script src="app.js" onload="go()"></script>'), { 'app.js': 'window.app = 1' });
    const again = await link(first.html);
    assert.equal(again.html, first.html);
    const plain = await link(page('', '<script src="app.js"></script><script onload="never()">window.x = 1</script>'), { 'app.js': 'window.app = 1' });
    assert.equal(events(items(plain.html)).length, 0);
  });
});

describe('the script that runs the code', () => {
  it('calls the code once with this set to the target and an event of the type', () => {
    // A script element has a legacy event property (an empty string) that must not hide the Event (review X3.6).
    const target = { id: 'replacement', event: '' };
    const self = { id: 'self', event: '' };
    class FakeEvent { constructor(readonly type: string) {} }
    const seen: unknown[] = [];
    const context = vm.createContext({
      Event: FakeEvent, seen,
      document: { currentScript: self, querySelector: (selector: string) => (selector === '[data-qft-on="3"]' ? target : null) },
    });
    vm.runInContext(scriptEventSource('load', 'seen.push([this.id, event.type, typeof querySelector]); return false;', '[data-qft-on="3"]'), context);
    vm.runInContext(scriptEventSource('error', 'seen.push([this.id, event.type])'), context);
    vm.runInContext(scriptEventSource('load', 'seen.push([this.id])', '[data-qft-on="9"]'), context);
    assert.deepEqual(JSON.parse(JSON.stringify(seen)), [['replacement', 'load', 'function'], ['self', 'error'], ['self']]);
  });
});
