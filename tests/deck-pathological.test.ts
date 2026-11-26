import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { strToU8 } from 'fflate';
import { detectDeck } from '../src/lib/deck-detect.ts';
import { linkDeck, replaceIframes } from '../src/lib/deck-linker.ts';
import { convertSlidevFiles } from '../src/lib/slidev-convert.ts';
import type { DeckFiles } from '../src/lib/deck-types.ts';
import { nodeVendorProvider } from './helpers/deck-vendor-node.ts';

/**
 * Regular expressions run on untrusted deck text in the app page. Each row is
 * an input that made an earlier pattern take quadratic (or worse) time: tens
 * of seconds to minutes of frozen page. Linear code handles each in well
 * under a second; the bound is generous for slow, shared test machines.
 */
const BOUND_MS = 2500;
const KB = 1024;

function deck(files: Record<string, string | Uint8Array>): DeckFiles {
  return new Map(Object.entries(files).map(([path, data]) => [path, typeof data === 'string' ? strToU8(data) : data]));
}

const page = (body: string, head = '') => `<!DOCTYPE html><html><head><title>Slow</title>${head}</head><body>${body}</body></html>`;
const reveal = (slides: string) => page(`<div class="reveal"><div class="slides">${slides}</div></div><script src="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/reveal.js"></script><script>Reveal.initialize();</script>`);
const markdownDeck = (markdown: string) => deck({ 'index.html': reveal('<section data-markdown="slides.md"></section>'), 'slides.md': markdown });

/** A Slidev build like the one in slidev-convert.test.ts, with parts replaced. */
function slidevBuild({ entry = '', vue = '', css = 'body{margin:0}', extra = {} as Record<string, string> } = {}): DeckFiles {
  return deck({
    'index.html': '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Waves - Slidev</title>'
      + '<meta property="slidev:version" content="53.1.0"><script type="module" crossorigin src="/assets/index-abc.js"></script>'
      + '<link rel="stylesheet" crossorigin href="/assets/index-abc.css"></head><body><div id="app"></div></body></html>',
    'assets/index-abc.js': `${entry}import{c as createRouter,ue}from"./vue-abc.js";export const router=createRouter({history:ue(\`/\`),routes:[]});`,
    'assets/vue-abc.js': `${vue}export function c(options){return options}export function ue(base){return base}`,
    'assets/index-abc.css': css,
    ...extra,
  });
}

const link = async (files: DeckFiles) => linkDeck(files, detectDeck(files), nodeVendorProvider());
const convert = async (files: DeckFiles) => {
  const detection = detectDeck(files);
  assert.equal(detection.kind, 'slidev-build');
  return convertSlidevFiles(files, detection, async () => 'window.bundled=1');
};

const rows: { name: string; run: () => Promise<unknown> | unknown }[] = [
  // F1.1: a 1.9 KB ZIP froze the page for 37 s.
  { name: 'Markdown slides made of 120,000 unclosed <iframe> tags', run: async () => {
    const result = await link(markdownDeck('<iframe>'.repeat(120_000)));
    assert.ok(result.issues.some((issue) => issue.code === 'deck-too-large' && issue.severity === 'error'), 'refused as too large');
  } },
  { name: 'Markdown with an unclosed <iframe and no >', run: () => link(markdownDeck('<iframe '.repeat(128 * KB))) },
  { name: 'Markdown with 128,000 "![" and no closing bracket', run: () => link(markdownDeck('![a'.repeat(128 * KB))) },
  { name: 'Markdown with 128,000 "<a" and no >', run: () => link(markdownDeck('<a on'.repeat(64 * KB))) },
  { name: 'a CSS @import followed by 256 KB of spaces', run: () => link(deck({ 'index.html': page('', `<style>@import url(a.css)${' '.repeat(256 * KB)}x;</style>`), 'a.css': 'p{}' })) },
  { name: 'a @font-face src with 40,000 "format("', run: () => link(deck({ 'index.html': page('', `<style>@font-face{font-family:x;src:url(a.woff2) ${'format('.repeat(40_000)}}</style>`), 'a.woff2': 'wOF2' })) },
  { name: 'a javascript: link with 256 KB of spaces after void', run: () => link(deck({ 'index.html': page(`<a href="javascript:void${' '.repeat(256 * KB)}x">go</a>`) })) },
  { name: 'an SVG sprite ending in 64,000 "<?xml" and no >', run: () => link(deck({ 'index.html': page('<svg><use href="s.svg#a"></use></svg>'), 's.svg': `<svg><symbol id="a"></symbol></svg>${'<?xml'.repeat(64 * KB)}` })) },
  // F2a.6 and F2a.2: image-set() and the scan of script strings for files loaded while playing.
  { name: 'CSS with 64,000 unclosed image-set( and quotes', run: () => link(deck({ 'index.html': page('', `<style>a{b:${'image-set("x.png" 1x, '.repeat(64 * KB)}}</style>`), 'x.png': 'x' })) },
  { name: 'CSS with 64,000 nested image-set(', run: () => link(deck({ 'index.html': page('', `<style>a{b:${'image-set('.repeat(64 * KB)}}</style>`) })) },
  { name: 'a script with 100,000 fetch("x/" calls', run: () => link(deck({ 'index.html': page(`<script>${'fetch("x/a.json");'.repeat(100_000)}</script>`) })) },
  { name: 'a page with 50,000 links to different missing files', run: () => link(deck({ 'index.html': page(Array.from({ length: 50_000 }, (_, index) => `<a href="p${index}.html">x</a>`).join('')) })) },
  { name: 'a script with 100,000 strings naming different missing files', run: () => link(deck({ 'index.html': page(`<script>${Array.from({ length: 100_000 }, (_, index) => `fetch("d/${index}.json");`).join('')}</script>`) })) },
  // F2b.3, F5.2 and F5.3: plugin lists, class names and a "<" inside formulas.
  { name: 'a page with 100,000 formulas holding "<x" and one closing delimiter', run: () => link(deck({ 'index.html': page(`<p>${'\\(a<x '.repeat(100_000)}\\)</p>`) })) },
  { name: 'a page with 40,000 "$$" and tags in between', run: () => link(deck({ 'index.html': page(`<p>${'$$<b>x</b>'.repeat(40_000)}</p>`) })) },
  { name: 'Reveal.initialize with 50,000 unknown plugins and 2,000 scripts', run: () => link(deck({
    'index.html': reveal(`<section>A</section>${'<script>x();</script>'.repeat(2000)}<script>Reveal.initialize({ plugins: [${Array.from({ length: 50_000 }, (_, index) => `P${index}`).join(', ')}] });</script>`),
  })) },
  { name: '40,000 elements with class names inside one slide', run: () => link(deck({ 'index.html': reveal(`<section>${'<div class="a controls b">x</div>'.repeat(40_000)}</section>`) })) },
  // F1.2: 14 s in the site on a crafted entry chunk.
  { name: 'a Slidev entry chunk with 1.1 million "import{" in a comment', run: () => detectDeck(slidevBuild({ entry: `var q={history:zz(1)};/*${'import{'.repeat(1_100_000)}*/` })) },
  { name: 'a Slidev library chunk with 150,000 "export{"', run: () => detectDeck(slidevBuild({ vue: `/*${'export{'.repeat(150_000)}*/` })) },
  { name: 'an inline module script of import and white space', run: () => detectDeck(deck({ 'index.html': page(`<script type="module">${('import' + ' '.repeat(300)).repeat(600)}</script>`) })) },
  { name: '400 long worker-like file names in a Slidev build', run: () => detectDeck(slidevBuild({
    extra: Object.fromEntries(Array.from({ length: 400 }, (_, index) => [`assets/${index}${'worker-'.repeat(140)}.x`, ''])),
  })) },
  { name: 'a Slidev stylesheet with url( and 4,000 spaces', run: () => convert(slidevBuild({ css: `a{b:url(${' '.repeat(4000)}x}` })) },
  { name: 'a Slidev stylesheet with 100,000 "url("', run: () => convert(slidevBuild({ css: 'url('.repeat(100_000) })) },
  { name: 'a Slidev stylesheet with 40,000 "@import " and no semicolon', run: () => convert(slidevBuild({ css: '@import a'.repeat(40_000) })) },
  { name: 'a Slidev stylesheet with 40,000 "@font-face{" and no }', run: () => convert(slidevBuild({ css: '@font-face{src:url(a)'.repeat(20_000) })) },
];

describe('pathological inputs finish quickly', () => {
  for (const row of rows) {
    it(row.name, async () => {
      const start = performance.now();
      await row.run();
      const elapsed = performance.now() - start;
      assert.ok(elapsed < BOUND_MS, `${row.name}: ${Math.round(elapsed)} ms`);
    });
  }
});

describe('iframes in Markdown', () => {
  it('replaces each tag with its closing tag, and unclosed tags alone', () => {
    const replaced = replaceIframes('a<iframe src="x">inner</iframe>b<IFRAME>c<iframe x>d</iframe>e<iframe>f', () => '[P]', 1000);
    assert.equal(replaced, 'a[P]b[P]e[P]f');
    assert.equal(replaceIframes('<iframe>x<iframe>y', () => '[P]', 1000), '[P]x[P]y');
    assert.equal(replaceIframes('<iframes>no', () => '[P]', 1000), '<iframes>no');
    assert.equal(replaceIframes('<iframe', () => '[P]', 1000), '<iframe');
    assert.equal(replaceIframes('<iframe>'.repeat(10), () => '[P]'.repeat(50), 1000), undefined, 'too large');
  });
});
