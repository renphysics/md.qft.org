import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { readDeckArchive } from '../src/lib/deck-archive.ts';
import { detectDeck } from '../src/lib/deck-detect.ts';
import { linkDeck, type LinkResult } from '../src/lib/deck-linker.ts';
import { buildPlayable, isPlayable, openDeck, type BuildDeps } from '../src/lib/deck-project.ts';
import { importWorkspaceBundle } from '../src/lib/document-bundle.ts';
import { PresentationPackageError } from '../src/lib/presentation-package.ts';
import type { DeckFiles } from '../src/lib/deck-types.ts';
import { nodeVendorProvider } from './helpers/deck-vendor-node.ts';

/*
 * What the linker keeps and what it tells (review findings F2a.1–F2a.11 and
 * F3.7): small decks modelled on the reviewer's differential tests.
 */

const encoder = new TextEncoder();
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
const deps = (): BuildDeps => ({ vendor: () => nodeVendorProvider() });
const page = (body: string, head = '') => `<!doctype html><html><head><meta charset="utf-8"><title>T</title>${head}</head><body>${body}</body></html>`;

function deck(files: Record<string, string | Uint8Array>): DeckFiles {
  return new Map(Object.entries(files).map(([path, value]) => [path, typeof value === 'string' ? encoder.encode(value) : value]));
}

async function link(files: Record<string, string | Uint8Array>): Promise<LinkResult> {
  const map = deck(files);
  return linkDeck(map, detectDeck(map), nodeVendorProvider());
}

function zipFile(files: Record<string, string | Uint8Array>, name = 'deck.zip'): File {
  const entries = Object.fromEntries(Object.entries(files).map(([path, data]) => [path, typeof data === 'string' ? strToU8(data) : data]));
  return new File([new Uint8Array(zipSync(entries)).buffer], name, { type: 'application/zip' });
}

const codes = (result: { issues: { code: string }[] }) => result.issues.map((issue) => issue.code);
const issue = (result: { issues: { code: string; message: string; severity: string }[] }, code: string) => result.issues.find((item) => item.code === code);

describe('noscript (F2a.1)', () => {
  it('drops noscript content, in the page and in templates, so the player never sees it', async () => {
    const result = await link({
      'index.html': page('<h1>Slides</h1><noscript><p>Enable JavaScript</p><img src="img/p.png"></noscript><template><noscript><img src="img/p.png"></noscript></template><script>1</script>',
        '<noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto"></noscript>'),
      'img/p.png': PNG,
    });
    assert.doesNotMatch(result.html, /noscript|Enable JavaScript|fonts\.googleapis/i);
    assert.ok(!result.issues.some((item) => item.severity === 'error'));
  });
});

describe('files that scripts load while playing (F2a.2)', () => {
  it('names deck files that only scripts use, and relative fetch, import() and XMLHttpRequest addresses', async () => {
    const result = await link({
      'index.html': page('<h1 id="h">Loading</h1><img src="img/shown.png"><script>fetch("data/quiz.json").then((r) => r.json());var i = new Image(); i.src = "img/p.png"; var s = "img/shown.png";</script>'),
      'data/quiz.json': '{"title":"Quiz"}',
      'img/p.png': PNG,
      'img/shown.png': PNG,
    });
    const note = issue(result, 'runtime-files');
    assert.ok(note, codes(result).join());
    assert.equal(note.severity, 'warning');
    assert.match(note.message, /load data\/quiz\.json, img\/p\.png while it plays/);
    assert.match(note.message, /cannot supply files at that point/);
    assert.match(note.message, /put that data inside index\.html/);
    // Embedded already, so the reference in the script is not news.
    assert.doesNotMatch(note.message, /shown\.png/);

    const requests = await link({
      'index.html': page('<script>var x = new XMLHttpRequest(); x.open("GET", "lessons/one.json"); import("./extra.js"); fetch("https://example.org/a.json");</script>'),
    });
    assert.match(issue(requests, 'runtime-files')?.message ?? '', /load lessons\/one\.json, extra\.js while/);
  });

  it('stays quiet for files the document already contains and for the bundled libraries', async () => {
    const result = await link({
      'index.html': page('<div class="reveal"><div class="slides"><section>One</section></div></div><script src="js/app.js"></script><script>var label = "Click here."; Reveal.initialize({ parallaxBackgroundImage: "img/bg.png" });</script>',
        '<script src="https://cdn.jsdelivr.net/npm/reveal.js@6.0.2/dist/reveal.js"></script>'),
      'js/app.js': 'var me = "js/app.js";',
      'img/bg.png': PNG,
    });
    assert.ok(!codes(result).includes('runtime-files'), codes(result).join());
  });
});

describe('links (F2a.3)', () => {
  it('reports links to other files of the presentation once and keeps links to websites', async () => {
    const result = await link({
      'index.html': page('<a id="l1" href="https://phet.colorado.edu/sim" target="_blank">PhET</a><a href="page2.html">Two</a><a href="worksheet.pdf" download>Sheet</a><a href="gone.html">Gone</a><a href="page2.html#x">Again</a><a href="#top">Top</a>'),
      'page2.html': '<p>2</p>',
      'worksheet.pdf': '%PDF-1.4',
    });
    const notes = result.issues.filter((item) => item.code === 'file-links');
    assert.equal(notes.length, 1);
    assert.equal(notes[0].severity, 'warning');
    assert.match(notes[0].message, /do not open in the player: page2\.html, worksheet\.pdf, gone\.html\./);
    assert.match(result.html, /<a id="l1" href="https:\/\/phet\.colorado\.edu\/sim" target="_blank">/);
    assert.ok(!result.issues.some((item) => /phet/i.test(item.message)));
  });
});

describe('ZIPs that are not one presentation (F2a.4, F3.7)', () => {
  it('names the pages of a ZIP with no clear start page', async () => {
    const project = await openDeck(zipFile({ 'lesson1.html': '<h1>One</h1>', 'lesson2.html': '<h1>Two</h1>' }));
    assert.ok(project);
    const result = await buildPlayable(project, deps());
    assert.equal(isPlayable(result), false);
    assert.deepEqual(codes(result), ['several-pages']);
    assert.match(result.issues[0].message, /several HTML pages \(lesson1\.html, lesson2\.html\)/);
  });

  it('says that a ZIP is empty or only holds another ZIP', async () => {
    await assert.rejects(openDeck(zipFile({})), (error: Error) => error instanceof PresentationPackageError && /^This ZIP is empty\./.test(error.message));
    await assert.rejects(openDeck(zipFile({ 'empty/': new Uint8Array(), '__MACOSX/._x': 'x' })), /This ZIP is empty\./);
    await assert.rejects(openDeck(zipFile({ 'folder/inner.zip': zipSync({ 'index.html': strToU8('<h1>x</h1>') }) })),
      /This ZIP only holds another ZIP, “inner\.zip”\. Unzip it first/);
  });

  it('tells the Markdown importer\'s users that a presentation needs a page such as index.html', async () => {
    const file = zipFile({ 'readme.txt': 'hello' });
    assert.equal(await openDeck(file), null);
    await assert.rejects(importWorkspaceBundle(file), /a presentation ZIP needs a page such as index\.html/);
  });

  it('adds a note to a page with no sign of slides, and none to slide pages', () => {
    const plain = detectDeck(deck({ 'index.html': page('<h1>Recipe</h1><p>Flour and water.</p>') }));
    assert.equal(plain.kind, 'html');
    assert.deepEqual(plain.issues.map((item) => [item.severity, item.code]), [['info', 'no-slides-found']]);
    assert.match(plain.issues[0].message, /No slides were recognized in this page, so it plays as one ordinary page\./);
    for (const body of ['<div class="slide">1</div><div class="slide">2</div>', '<section>1</section><section>2</section>',
      '<h1>x</h1><script>addEventListener("keydown", next)</script>']) {
      assert.ok(!codes(detectDeck(deck({ 'index.html': page(body) }))).includes('no-slides-found'), body);
    }
  });
});

describe('stylesheets loaded without blocking (F2a.5)', () => {
  it('inlines rel=preload as=style with an onload that makes it a stylesheet, and honours the media swap', async () => {
    const result = await link({
      'index.html': page('<h1 id="c1">x</h1>', `<link rel="preload" href="style.css" as="style" onload="this.onload=null;this.rel='stylesheet'">
<link rel="stylesheet" href="print.css" media="print" onload="this.media='all'"><link rel="preload" href="font.woff2" as="font">`),
      'style.css': '#c1{color:rgb(200, 10, 10)}',
      'print.css': 'h1{font-weight:300}',
      'font.woff2': 'x',
    });
    assert.match(result.html, /<style data-qft-from="style\.css">#c1\{color:rgb\(200, 10, 10\)\}<\/style>/);
    assert.match(result.html, /<style data-qft-from="print\.css">h1\{font-weight:300\}<\/style>/);
    assert.doesNotMatch(result.html, /onload|font\.woff2|<link/);
  });
});

describe('image-set() (F2a.6)', () => {
  it('rewrites quoted addresses in image-set() and -webkit-image-set() like url() values', async () => {
    const result = await link({
      'index.html': page('<div id="c1"></div><div style="background-image:-webkit-image-set(\'img/p.png\' 1x)"></div>',
        '<style>#c1{background-image:image-set("img/p.png" 1x, url(img/p.png) 2x, "missing.png" type("image/png") 3x)}</style>'),
      'img/p.png': PNG,
    });
    assert.match(result.html, /image-set\(url\("data:image\/png;base64,[^"]+"\) 1x, url\("data:image\/png;base64,[^"]+"\) 2x, none type\("image\/png"\) 3x\)/);
    assert.match(result.html, /-webkit-image-set\(url\(&quot;data:image\/png;base64,[^&]+&quot;\) 1x\)/);
    assert.doesNotMatch(result.html, /"img\/p\.png"|'img\/p\.png'/);
    assert.ok(codes(result).includes('missing-file'));
  });
});

describe('caption tracks (F2a.7)', () => {
  it('removes a track that cannot be kept, with the note', async () => {
    const result = await link({ 'index.html': page('<video src="v.mp4" controls><track kind="captions" src="c.vtt" default></video>'), 'v.mp4': new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]), 'c.vtt': 'WEBVTT' });
    assert.doesNotMatch(result.html, /<track/);
    assert.ok(codes(result).includes('captions-left-out'));
  });
});

describe('SVG sprites (F2a.8)', () => {
  it('resolves a sprite\'s own references against the sprite file, and survives a symbol that uses itself', async () => {
    const result = await link({
      'index.html': page('<svg><use href="icons/s.svg#i"/></svg><svg><use href="icons/s.svg#loop"/></svg>'),
      'icons/s.svg': '<svg xmlns="http://www.w3.org/2000/svg"><symbol id="i"><image href="p.png"/></symbol><symbol id="loop"><use href="s.svg#loop"/></symbol></svg>',
      'icons/p.png': PNG,
    });
    assert.ok(!codes(result).includes('missing-file'), result.issues.map((item) => item.message).join('\n'));
    assert.match(result.html, /<image href="data:image\/png;base64,/);
  });
});

describe('names that cannot be used (F2a.9)', () => {
  it('says which character made a name unusable, and explains references to that file', async () => {
    const file = zipFile({
      'deck/index.html': page('<img src="img/a%2520b.png"><img src="img/hash%231.png"><img src="img/p.png">'),
      'deck/img/a%20b.png': PNG,
      'deck/img/hash#1.png': PNG,
      'deck/img/p.png': PNG,
    });
    const archive = await readDeckArchive(file);
    const skipped = archive.issues.filter((item) => item.code === 'archive-path-skipped');
    assert.deepEqual(skipped.map((item) => item.message), [
      'Skipped deck/img/a%20b.png because its name contains “%”, which cannot be used in a presentation. Rename it, change the references to the new name, and make the ZIP again.',
      'Skipped deck/img/hash#1.png because its name contains “#”, which cannot be used in a presentation. Rename it, change the references to the new name, and make the ZIP again.',
    ]);
    const project = await openDeck(file);
    assert.ok(project);
    const result = await buildPlayable(project, deps());
    assert.ok(!codes(result).includes('missing-file'), codes(result).join());
    const references = result.issues.filter((item) => item.code === 'skipped-file-reference');
    assert.deepEqual(references.map((item) => item.where), ['img/a%20b.png', 'img/hash#1.png']);
    assert.match(references[0].message, /refers to img\/a%20b\.png, which was left out of it because its name contains “%”\. Rename the file/);
  });
});

describe('an empty start page (F2a.11)', () => {
  it('is an error that says to export the presentation again', async () => {
    for (const text of ['', '  \n', '<!doctype html><html><head><title>x</title></head><body>\n</body></html>', '<noscript>Turn on JavaScript</noscript>']) {
      const result = await link({ 'index.html': text });
      assert.equal(result.html, '', JSON.stringify(text));
      assert.deepEqual(result.issues.map((item) => [item.severity, item.code, item.message]), [['error', 'page-empty', 'index.html is empty. Export the presentation again.']]);
    }
    const project = await openDeck(zipFile({ 'index.html': new Uint8Array() }));
    assert.ok(project);
    assert.equal(isPlayable(await buildPlayable(project, deps())), false);
    // A page with only a script or a picture is not empty.
    assert.ok(!codes(await link({ 'index.html': '<script>document.body.textContent = "Built by script"</script>' })).includes('page-empty'));
    assert.ok(!codes(await link({ 'index.html': '<img src="p.png">', 'p.png': PNG })).includes('page-empty'));
  });
});
