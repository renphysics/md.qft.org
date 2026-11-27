import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detectDeck } from '../src/lib/deck-detect.ts';
import { linkDeck, type LinkResult } from '../src/lib/deck-linker.ts';
import type { DeckFiles } from '../src/lib/deck-types.ts';
import { nodeVendorProvider } from './helpers/deck-vendor-node.ts';

/*
 * The linker after the second review round (findings VF1, VF2a, VF2b, VF5,
 * VF6, VUX and VM of the independent verification).
 */

const encoder = new TextEncoder();
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
const page = (body: string, head = '') => `<!doctype html><html><head><meta charset="utf-8"><title>T</title>${head}</head><body>${body}</body></html>`;
const REVEAL_SCRIPT = '<script src="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/reveal.js"></script>';
const REVEAL_STYLE = '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/reveal.css">';
const reveal = (slides: string, { init = 'Reveal.initialize();', head = REVEAL_STYLE, outside = '' } = {}) =>
  page(`<div class="reveal">${outside}<div class="slides">${slides}</div></div>${REVEAL_SCRIPT}<script>${init}</script>`, head);

function deck(files: Record<string, string | Uint8Array>): DeckFiles {
  return new Map(Object.entries(files).map(([path, value]) => [path, typeof value === 'string' ? encoder.encode(value) : value]));
}

async function link(files: Record<string, string | Uint8Array>): Promise<LinkResult> {
  const map = deck(files);
  return linkDeck(map, detectDeck(map), nodeVendorProvider());
}

const codes = (result: { issues: { code: string }[] }) => result.issues.map((item) => item.code);
const issue = (result: { issues: { code: string; message: string; severity: string }[] }, code: string) => result.issues.find((item) => item.code === code);

describe('removals (VF1.1, VF1.3)', () => {
  it('uses only the first <base href>, as HTML does', async () => {
    const result = await link({
      'index.html': page('<img src="pic.png" alt="">', '<base href="a/"><base href="b/"><base href="c/">'),
      'a/pic.png': PNG,
      'a/b/pic.png': encoder.encode('wrong'),
    });
    assert.ok(!codes(result).includes('missing-file'), JSON.stringify(result.issues));
    assert.match(result.html, /src="data:image\/png;base64,iVBOR/);
    assert.doesNotMatch(result.html, /<base/);
  });

  it('keeps the page in order when it removes and replaces many siblings', async () => {
    const result = await link({
      'index.html': page('<p>1</p><noscript>n</noscript><p>2</p><script src="a.js"></script><p>3</p><iframe src="https://x.example/"></iframe><p>4</p><meta http-equiv="refresh" content="0"><p>5</p>'),
      'a.js': 'window.a = 1;',
    });
    const body = result.html.slice(result.html.indexOf('<body>'));
    const order = [...body.matchAll(/<p>(\d)<\/p>|window\.a = 1|data-qft-placeholder/g)].map((match) => match[1] ?? match[0]);
    assert.deepEqual(order, ['1', '2', 'window.a = 1', '3', 'data-qft-placeholder', '4', '5']);
    assert.doesNotMatch(result.html, /noscript|http-equiv/);
  });
});

describe('class names that Reveal.js uses (VF2a.1)', () => {
  it('sees them on a slide itself and under .reveal outside the slides', async () => {
    const onSlide = await link({ 'index.html': reveal('<section><h2>A</h2></section><section class="progress"><h2>C</h2></section>') });
    assert.match(issue(onSlide, 'reveal-class-name')?.message ?? '', /“progress”/);
    const outside = await link({ 'index.html': reveal('<section><h2>A</h2></section>', { outside: '<div class="progress">my own progress bar text</div>' }) });
    assert.match(issue(outside, 'reveal-class-name')?.message ?? '', /“progress”/);
    const deeper = await link({ 'index.html': reveal('<section>A</section>', { outside: '<div class="tools"><div class="controls"><button>Go</button></div></div>' }) });
    assert.match(issue(deeper, 'reveal-class-name')?.message ?? '', /“controls”/);
  });

  it('leaves the .slides element and Reveal.js parts written in the markup of old templates alone', async () => {
    const result = await link({
      'index.html': reveal('<section><h2>A</h2></section>', {
        outside: '<aside class="controls"><a class="left" href="#">&#x25C4;</a><a class="right" href="#">&#x25BA;</a></aside><div class="progress"><span></span></div>',
      }),
    });
    assert.ok(!codes(result).includes('reveal-class-name'), JSON.stringify(result.issues));
    const outsideReveal = await link({ 'index.html': page('<div class="controls">x</div><div class="reveal"><div class="slides"><section>A</section></div></div><script src="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/reveal.js"></script><script>Reveal.initialize();</script>', REVEAL_STYLE) });
    assert.ok(!codes(outsideReveal).includes('reveal-class-name'));
  });
});
