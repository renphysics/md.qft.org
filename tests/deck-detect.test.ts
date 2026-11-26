import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { strToU8 } from 'fflate';
import { deckFromHtmlFile, readDeckArchive } from '../src/lib/deck-archive.ts';
import { DECK_DETECT_LIMITS, detectDeck } from '../src/lib/deck-detect.ts';
import { isDeckEngine, isDeckKind, type DeckDetection, type DeckFiles } from '../src/lib/deck-types.ts';
import { FIXTURE_DECKS, htmlFixture, loadFixtureDeck, zipFixture } from './helpers/deck-fixtures.ts';

const deck = (entries: Record<string, string | Uint8Array>): DeckFiles => new Map(Object.entries(entries)
  .map(([path, data]) => [path, typeof data === 'string' ? strToU8(data) : data]));
const codes = (result: DeckDetection) => result.issues.map((issue) => issue.code);
const issue = (result: DeckDetection, code: string) => result.issues.find((item) => item.code === code);

/** A minimal Reveal.js page; `head` and `tail` go into head and after the slides. */
function revealPage({ head = '', slides = '<section>One</section><section>Two</section>', tail = '', title = 'Deck' } = {}): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>${head}</head><body>
<div class="reveal"><div class="slides">${slides}</div></div>${tail}
<script>Reveal.initialize({ hash: true });</script></body></html>`;
}
const cdnCore = (base: string) => `<link rel="stylesheet" href="${base}/dist/reveal.css"><script src="${base}/dist/reveal.js"></script>`;

function assertWellFormed(result: DeckDetection): void {
  assert.ok(isDeckKind(result.kind), result.kind);
  if (result.engine !== undefined) assert.ok(isDeckEngine(result.engine));
  assert.ok(Array.isArray(result.issues));
  assert.ok(result.issues.length <= DECK_DETECT_LIMITS.issues + 1);
  for (const item of result.issues) {
    assert.match(item.code, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(['info', 'warning', 'error'].includes(item.severity));
    assert.ok(item.message.length > 0 && item.message.length < 600, item.message);
    assert.doesNotMatch(item.message + (item.where ?? ''), /[\u0000-\u001f\u007f‪-‮⁦-⁩]/);
    if (item.where !== undefined) assert.ok(item.where.length <= 300);
  }
}

describe('deck detection on the fixture decks', () => {
  it('classifies every fixture with the right kind, entry, version and flags', () => {
    const expected: Record<string, Partial<DeckDetection>> = {
      'cdn-reveal5-single': { kind: 'reveal', entry: 'index.html', engine: 'reveal', engineVersion: '5.2.1', title: 'Damped oscillator',
        flags: { revealFromCdn: true, usesExternalMarkdown: false, usesEsModules: false, revealMajor: 5, mathPlugin: 'katex' } },
      'cdn-reveal4-cdnjs': { kind: 'reveal', entry: 'index.html', engine: 'reveal', engineVersion: '4.6.1', title: 'Units and dimensions',
        flags: { revealFromCdn: true, usesExternalMarkdown: false, usesEsModules: false, revealMajor: 4 } },
      'cdn-reveal6-unpkg': { kind: 'reveal', entry: 'index.html', engine: 'reveal', engineVersion: '6.0.2', title: 'Entropy in one picture',
        flags: { revealFromCdn: true, usesExternalMarkdown: false, usesEsModules: false, revealMajor: 6, mathPlugin: 'katex' } },
      'local-project': { kind: 'reveal', entry: 'index.html', engine: 'reveal', title: 'Optics workshop',
        flags: { revealFromCdn: false, usesExternalMarkdown: true, usesEsModules: false } },
      'esm-project': { kind: 'reveal', entry: 'index.html', engine: 'reveal', title: 'Modules deck',
        flags: { revealFromCdn: false, usesExternalMarkdown: false, usesEsModules: true, revealMajor: 6 } },
      'plain-html': { kind: 'html', entry: 'index.html', engine: 'html', title: 'Projectile explorer', flags: {} },
      'slidev-source': { kind: 'slidev-source', entry: 'slides.md', engine: 'slidev', title: 'Waves on a string', flags: {} },
      'not-a-deck': { kind: 'markdown-bundle', entry: 'notes.md', flags: {} },
    };
    for (const name of FIXTURE_DECKS) {
      const result = detectDeck(loadFixtureDeck(name));
      assertWellFormed(result);
      const { issues: _issues, ...rest } = result;
      assert.deepEqual(rest, expected[name], name);
    }
  });

  it('reports what each fixture needs, in words a person and an AI can act on', () => {
    assert.deepEqual(codes(detectDeck(loadFixtureDeck('cdn-reveal5-single'))), []);
    assert.deepEqual(codes(detectDeck(loadFixtureDeck('cdn-reveal6-unpkg'))), []);
    assert.deepEqual(codes(detectDeck(loadFixtureDeck('cdn-reveal4-cdnjs'))), ['inline-event-handler']);
    assert.match(issue(detectDeck(loadFixtureDeck('cdn-reveal4-cdnjs')), 'inline-event-handler')!.message, /onclick[\s\S]*addEventListener/);

    const local = detectDeck(loadFixtureDeck('local-project'));
    assert.deepEqual(codes(local), ['library-file-supplied']);
    const supplied = issue(local, 'library-file-supplied')!;
    assert.equal(supplied.severity, 'info');
    assert.match(supplied.message, /^5 Reveal\.js files are not in the ZIP \(dist\/reset\.css, dist\/reveal\.css, dist\/theme\/black\.css and 2 more\)/);

    const source = detectDeck(loadFixtureDeck('slidev-source'));
    assert.deepEqual(source.issues.map(({ code, severity, where }) => ({ code, severity, where })),
      [{ code: 'slidev-source', severity: 'error', where: 'slides.md' }]);
    assert.match(source.issues[0].message, /has to be built before it can play/);
  });

  it('gives the same answer for a ZIP with a wrapping folder and for a single HTML file', async () => {
    for (const name of FIXTURE_DECKS) {
      const fromZip = detectDeck((await readDeckArchive(zipFixture(name, { wrap: `${name}-main` }))).files);
      assert.deepEqual(fromZip, detectDeck(loadFixtureDeck(name)), name);
    }
    for (const name of ['cdn-reveal5-single', 'cdn-reveal4-cdnjs', 'cdn-reveal6-unpkg'] as const) {
      const single = detectDeck((await deckFromHtmlFile(htmlFixture(name))).files);
      assert.deepEqual(single, detectDeck(loadFixtureDeck(name)), name);
    }
  });

  it('does not change the files it is given', () => {
    const files = loadFixtureDeck('local-project');
    const before = new Map([...files].map(([path, bytes]) => [path, bytes.slice()]));
    detectDeck(files);
    assert.deepEqual(files, before);
  });
});

describe('deck detection: kinds', () => {
  it('recognises portable presentation packages and Markdown bundles by their manifests', () => {
    assert.deepEqual(detectDeck(deck({ 'qft-presentation.json': '{}', 'presentation.html': revealPage() })),
      { kind: 'qft-presentation', issues: [], flags: {} });
    assert.deepEqual(detectDeck(deck({ 'qft.json': '{}', 'lesson.md': '# Hi', 'demo/index.html': revealPage() })),
      { kind: 'markdown-bundle', issues: [], flags: {} });
    assert.equal(detectDeck(deck({ 'lesson.md': '# Hi', 'figure.png': new Uint8Array([1]) })).kind, 'markdown-bundle');
    // A Markdown file beside a deck does not make the deck a Markdown bundle.
    assert.equal(detectDeck(deck({ 'README.md': '# Read me', 'index.html': revealPage({ head: cdnCore('https://unpkg.com/reveal.js@6.0.2') }) })).kind, 'reveal');
  });

  it('needs Reveal.js markup plus a start call or a core reference', () => {
    const withCall = detectDeck(deck({ 'index.html': revealPage() }));
    assert.equal(withCall.kind, 'reveal');
    const withCore = detectDeck(deck({ 'index.html': revealPage().replace(/<script>Reveal[\s\S]*?<\/script>/, '<script src="dist/reveal.js"></script>') }));
    assert.equal(withCore.kind, 'reveal');
    const markupOnly = detectDeck(deck({ 'index.html': revealPage().replace(/<script>Reveal[\s\S]*?<\/script>/, '') }));
    assert.equal(markupOnly.kind, 'html');
    assert.deepEqual(codes(markupOnly), ['reveal-markup-without-script']);
    const callOnly = detectDeck(deck({ 'index.html': '<script>Reveal.initialize({})</script><section>One</section>' }));
    assert.equal(callOnly.kind, 'html');
    // Markup inside a template is still markup.
    assert.equal(detectDeck(deck({ 'index.html': '<template><div class="reveal"><div class="slides"><section>A</section></div></div></template><script>Reveal.initialize()</script>' })).kind, 'reveal');
  });

  it('recognises a core that is inlined into the page and reads its version', () => {
    const core = '/*!\n * reveal.js 5.2.1\n * https://revealjs.com\n * MIT licensed\n *\n * Copyright (C) 2011-2024 Hakim El Hattab, https://hakim.se\n */\n!function(){const e="5.2.1";window.Reveal={VERSION:e}}();';
    const result = detectDeck(deck({ 'talk.html': revealPage({ head: `<style>/*! reveal.css 4.0.0 */</style><script>${core}</script>` }).replace(/<script>Reveal\.initialize[\s\S]*?<\/script>/, '') }));
    assert.equal(result.kind, 'reveal');
    assert.equal(result.entry, 'talk.html');
    assert.equal(result.engineVersion, '5.2.1');
    assert.equal(result.flags.revealFromCdn, false);
  });

  it('treats any other page as a generic HTML deck when its entry is obvious', () => {
    assert.equal(detectDeck(deck({ 'demo.html': '<h1>Demo</h1><script src="demo.js"></script>', 'demo.js': '1' })).entry, 'demo.html');
    assert.equal(detectDeck(deck({ 'site/index.html': '<p>Hi</p>', 'site/about/index.html': '<p>About</p>' })).entry, 'site/index.html');
    const several = detectDeck(deck({ 'a.html': '<p>A</p>', 'b.html': '<p>B</p>' }));
    assert.equal(several.kind, 'unknown');
    assert.deepEqual(codes(several), ['several-pages']);
    const twins = detectDeck(deck({ 'one/index.html': '<p>A</p>', 'two/index.html': '<p>B</p>' }));
    assert.equal(twins.kind, 'unknown');
    // A README is never the entry.
    const readme = detectDeck(deck({ 'README.html': revealPage(), 'notes.txt': 'x' }));
    assert.equal(readme.kind, 'unknown');
  });

  it('reports nothing playable for empty, binary-only and unrelated folders', () => {
    for (const files of [deck({}), deck({ 'a.png': new Uint8Array([137, 80, 78, 71]) }), deck({ 'a.md': '#', 'b.md': '#' }), deck({ 'node_modules/x/index.html': revealPage() })]) {
      const result = detectDeck(files);
      assertWellFormed(result);
      assert.equal(result.kind, 'unknown');
    }
    assert.deepEqual(codes(detectDeck(deck({}))), ['no-deck-found']);
  });
});

describe('deck detection: choosing the Reveal.js entry', () => {
  const core = 'https://cdn.jsdelivr.net/npm/reveal.js@6.0.2';

  it('prefers the shallowest index.html and ignores Reveal.js helper and test pages', () => {
    const files = deck({
      'demo.html': revealPage({ head: cdnCore(core), title: 'reveal.js - The HTML Presentation Framework' }),
      'index.html': revealPage({ head: cdnCore(core), title: 'My talk' }),
      'deep/inside/index.html': revealPage({ head: cdnCore(core) }),
      'test/test-markdown.html': revealPage({ head: cdnCore(core) }),
      'plugin/notes/speaker-view.html': revealPage({ head: cdnCore(core) }),
      'README.html': revealPage({ head: cdnCore(core) }),
    });
    const result = detectDeck(files);
    assert.equal(result.entry, 'index.html');
    assert.equal(result.title, 'My talk');
    const several = issue(result, 'several-decks')!;
    assert.equal(several.severity, 'info');
    assert.equal(several.where, 'index.html');
    assert.match(several.message, /Playing index\.html; not playing/);
    assert.doesNotMatch(several.message, /speaker-view|README/);
  });

  it('chooses a named deck over a stock starter and a deck in a subfolder over nothing', () => {
    const starter = '<div class="reveal"><div class="slides"><section>Slide 1</section><section>Slide 2</section></div></div><script src="dist/reveal.js"></script><script>Reveal.initialize();</script>';
    const lecture = revealPage({ head: cdnCore(core), slides: '<section>A</section>'.repeat(30) });
    assert.equal(detectDeck(deck({ 'index.html': starter, 'slides.html': lecture })).entry, 'slides.html');
    assert.equal(detectDeck(deck({ 'lectures/week-1/lecture.html': lecture, 'notes.txt': 'x' })).entry, 'lectures/week-1/lecture.html');
    assert.equal(detectDeck(deck({ 'demo.html': lecture })).entry, 'demo.html');
  });

  it('never picks a page inside node_modules', () => {
    const result = detectDeck(deck({ 'node_modules/reveal.js/index.html': revealPage(), 'talk.html': revealPage() }));
    assert.equal(result.entry, 'talk.html');
    assert.equal(issue(result, 'several-decks'), undefined);
  });
});

describe('deck detection: Reveal.js versions and CDN references', () => {
  it('reads the version from CDN URLs on jsDelivr, unpkg, cdnjs and esm.sh', () => {
    const cases: [string, string | undefined, number | undefined][] = [
      ['https://cdn.jsdelivr.net/npm/reveal.js@5.1.0', '5.1.0', 5],
      ['https://unpkg.com/reveal.js@4.3.1', '4.3.1', 4],
      ['https://cdn.jsdelivr.net/npm/reveal.js@5', undefined, 5],
      ['https://unpkg.com/reveal.js@^4.0.0', undefined, 4],
    ];
    for (const [base, version, major] of cases) {
      const result = detectDeck(deck({ 'index.html': revealPage({ head: cdnCore(base) }) }));
      assert.equal(result.engineVersion, version, base);
      assert.equal(result.flags.revealMajor, major, base);
      assert.equal(result.flags.revealFromCdn, true, base);
    }
    const cdnjs = detectDeck(deck({ 'index.html': revealPage({ head: '<script src="https://cdnjs.cloudflare.com/ajax/libs/reveal.js/6.0.2/reveal.min.js"></script>' }) }));
    assert.equal(cdnjs.engineVersion, '6.0.2');
    const esm = detectDeck(deck({ 'index.html': revealPage({ tail: '<script type="module">import Reveal from "https://esm.sh/reveal.js@5.2.1"; new Reveal().initialize();</script>' }) }));
    assert.equal(esm.engineVersion, '5.2.1');
    assert.equal(esm.flags.usesEsModules, true);
  });

  it('warns about unpinned and range CDN versions once', () => {
    const unpinned = detectDeck(deck({ 'index.html': revealPage({ head: `${cdnCore('https://cdn.jsdelivr.net/npm/reveal.js')}<script src="https://cdn.jsdelivr.net/npm/reveal.js/plugin/notes/notes.js"></script>` }) }));
    assert.deepEqual(codes(unpinned), ['reveal-unpinned-cdn']);
    assert.equal(unpinned.issues[0].severity, 'warning');
    assert.equal(unpinned.issues[0].where, 'https://cdn.jsdelivr.net/npm/reveal.js/dist/reveal.css');
    assert.match(unpinned.issues[0].message, /cdn\.jsdelivr\.net without a version[\s\S]*reveal\.js@6\.0\.2/);
    assert.equal(unpinned.engineVersion, undefined);
    assert.equal(detectDeck(deck({ 'index.html': revealPage({ head: cdnCore('https://unpkg.com/reveal.js@latest') }) })).issues[0].code, 'reveal-unpinned-cdn');
    const range = detectDeck(deck({ 'index.html': revealPage({ head: cdnCore('https://unpkg.com/reveal.js@5') }) }));
    assert.deepEqual(range.issues.map(({ code, severity }) => [code, severity]), [['reveal-unpinned-cdn', 'info']]);
  });

  it('reads the single version literal of a local core file, or its package.json', () => {
    const page = revealPage({ head: '<link rel="stylesheet" href="vendor/reveal/dist/reveal.css"><script src="vendor/reveal/dist/reveal.js"></script>' });
    const umd = '/*! reveal.js */(function(){var e=`6.0.2`;var t="slide";globalThis.Reveal={VERSION:e,type:t}})();';
    const result = detectDeck(deck({ 'index.html': page, 'vendor/reveal/dist/reveal.js': umd, 'vendor/reveal/dist/reveal.css': '' }));
    assert.equal(result.engineVersion, '6.0.2');
    assert.equal(result.flags.revealMajor, 6);
    assert.equal(result.flags.revealFromCdn, false);
    assert.deepEqual(codes(result), []);

    const declared = 'var VERSION = "4.6.1"; var other = "1.2.3";';
    assert.equal(detectDeck(deck({ 'index.html': page, 'vendor/reveal/dist/reveal.js': declared })).engineVersion, '4.6.1');

    const ambiguous = 'var a = "1.2.3", b = "4.5.6";';
    const fromPackage = deck({ 'index.html': page, 'vendor/reveal/dist/reveal.js': ambiguous, 'vendor/reveal/package.json': '{"name":"reveal.js","version":"5.0.4"}' });
    assert.equal(detectDeck(fromPackage).engineVersion, '5.0.4');
    assert.equal(detectDeck(deck({ 'index.html': page, 'vendor/reveal/dist/reveal.js': ambiguous })).engineVersion, undefined);
  });

  it('infers the major version from the file layout when nothing names it', () => {
    const six = detectDeck(deck({ 'index.html': revealPage({ head: '<script src="dist/reveal.js"></script><script src="dist/plugin/notes.js"></script>' }) }));
    assert.equal(six.flags.revealMajor, 6);
    const three = detectDeck(deck({ 'index.html': revealPage({ head: '<link rel="stylesheet" href="css/reveal.css"><script src="js/reveal.js"></script>' }) }));
    assert.equal(three.flags.revealMajor, 3);
    assert.ok(codes(three).includes('reveal-old-version'));
    const unknown = detectDeck(deck({ 'index.html': revealPage({ head: '<script src="dist/reveal.js"></script><script src="plugin/notes/notes.js"></script>' }) }));
    assert.equal(unknown.flags.revealMajor, undefined);
  });

  it('flags Reveal.js 4 and 5 plugin paths used with Reveal.js 6 files', () => {
    const cdn = detectDeck(deck({ 'index.html': revealPage({ head: `${cdnCore('https://cdn.jsdelivr.net/npm/reveal.js@6.0.2')}<script src="https://cdn.jsdelivr.net/npm/reveal.js@6.0.2/plugin/notes/notes.js"></script>` }) }));
    const found = issue(cdn, 'reveal-4x-plugin-paths-on-6x-files')!;
    assert.equal(found.severity, 'warning');
    assert.match(found.message, /dist\/plugin\/notes\.js/);
    assert.equal(found.where, 'https://cdn.jsdelivr.net/npm/reveal.js@6.0.2/plugin/notes/notes.js');

    const local = detectDeck(deck({
      'index.html': revealPage({ head: '<script src="dist/reveal.js"></script><script src="plugin/markdown/markdown.js"></script>' }),
      'dist/reveal.js': 'Reveal.VERSION = "6.0.2"',
    }));
    assert.ok(codes(local).includes('reveal-4x-plugin-paths-on-6x-files'));
    assert.ok(codes(local).includes('library-file-supplied'));
    const five = detectDeck(deck({ 'index.html': revealPage({ head: `${cdnCore('https://unpkg.com/reveal.js@5.2.1')}<script src="https://unpkg.com/reveal.js@5.2.1/plugin/notes/notes.js"></script>` }) }));
    assert.deepEqual(codes(five), []);
  });

  it('names the math plugin and warns about MathJax', () => {
    const math = (plugins: string) => detectDeck(deck({ 'index.html': revealPage().replace('Reveal.initialize({ hash: true })', `Reveal.initialize({ plugins: [${plugins}] })`) }));
    assert.equal(math('RevealMath.KaTeX').flags.mathPlugin, 'katex');
    assert.equal(math('RevealMath.MathJax3').flags.mathPlugin, 'mathjax3');
    assert.equal(math('RevealMath.MathJax4').flags.mathPlugin, 'mathjax4');
    assert.equal(math('RevealMath').flags.mathPlugin, 'mathjax2');
    assert.equal(math('RevealNotes').flags.mathPlugin, undefined);
    assert.deepEqual(codes(math('RevealMath.KaTeX')), []);
    assert.deepEqual(codes(math('RevealMath.MathJax3')), ['reveal-mathjax']);
  });
});

describe('deck detection: references', () => {
  it('names the host of external libraries, stylesheets, fonts, images, frames and media', () => {
    const result = detectDeck(deck({
      'index.html': revealPage({
        head: `${cdnCore('https://unpkg.com/reveal.js@6.0.2')}
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.js"></script>
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">
<link rel="stylesheet" href="https://example.org/theme.css">
<style>.title { background: url("https://images.example.com/sky.jpg") }</style>`,
        slides: `<section><img src="https://upload.wikimedia.org/a.png" alt=""></section>
<section data-background-image="https://picsum.photos/800"><iframe src="https://www.youtube.com/embed/x"></iframe></section>
<section><video src="https://media.example.net/clip.mp4"></video><img src="data:image/png;base64,AAAA" alt=""></section>`,
      }),
    }));
    const byCode = (code: string) => result.issues.filter((item) => item.code === code);
    assert.deepEqual(byCode('external-library').map((item) => item.where), ['https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.js']);
    assert.match(byCode('external-library')[0].message, /chart\.js from cdn\.jsdelivr\.net/);
    assert.equal(byCode('external-font')[0].severity, 'info');
    assert.match(byCode('external-stylesheet')[0].message, /example\.org/);
    assert.deepEqual(byCode('external-image').map((item) => item.where), [
      'https://upload.wikimedia.org/a.png', 'https://picsum.photos/800', 'https://images.example.com/sky.jpg',
    ]);
    assert.match(byCode('external-image')[0].message, /upload\.wikimedia\.org/);
    assert.match(byCode('external-frame')[0].message, /www\.youtube\.com/);
    assert.match(byCode('external-media')[0].message, /media\.example\.net/);
    assert.equal(codes(result).includes('reveal-unpinned-cdn'), false);
  });

  it('finds missing local files, case mismatches and files only a stylesheet uses', () => {
    const result = detectDeck(deck({
      'index.html': revealPage({
        head: `${cdnCore('https://unpkg.com/reveal.js@6.0.2')}<link rel="stylesheet" href="css/deck.css"><script src="js/Demo.js"></script>`,
        slides: '<section><img src="img/missing.png" alt=""><img src="img/pic%20one.png" alt=""></section><section data-markdown="slides.md"></section>',
      }),
      'css/deck.css': '@import "fonts.css"; .a { background: url(../img/bg.png) }',
      'css/fonts.css': '@font-face { src: url(f/Main.woff2) format("woff2"), url(f/Main.ttf) format("truetype") } @font-face { src: url(f/Gone.woff2) }',
      'css/f/Main.woff2': new Uint8Array([1]),
      'js/demo.js': 'demo()',
      'img/pic one.png': new Uint8Array([1]),
    }));
    const missing = result.issues.filter((item) => item.code === 'missing-local-file').map((item) => item.where);
    assert.deepEqual(missing, ['img/missing.png', 'slides.md', 'img/bg.png', 'css/f/Gone.woff2']);
    assert.match(issue(result, 'missing-local-file')!.message, /index\.html uses img\/missing\.png, which is not in the ZIP/);
    const mismatch = issue(result, 'file-case-mismatch')!;
    assert.equal(mismatch.where, 'js/Demo.js');
    assert.match(mismatch.message, /spelled js\/demo\.js/);
    assert.equal(result.flags.usesExternalMarkdown, true);
  });

  it('does not report references that load nothing', () => {
    const result = detectDeck(deck({
      'index.html': revealPage({
        head: cdnCore('https://unpkg.com/reveal.js@6.0.2'),
        slides: '<section><a href="https://example.com">a link is fine</a><img src="data:image/png;base64,AA" alt=""><img src="blob:x" alt=""><img src="#x" alt=""></section>',
      }),
    }));
    assert.deepEqual(codes(result), []);
  });

  it('flags a script saved as a text error page and references that leave the archive', () => {
    const result = detectDeck(deck({
      'deck/index.html': revealPage({ head: '<script src="data:text/plain;charset=utf-8,404%3A%20Not%20Found"></script><script src="../../outside.js"></script>' }),
    }));
    assert.ok(codes(result).includes('embedded-error-page'));
    assert.equal(result.issues.find((item) => item.code === 'missing-local-file')!.where, '../../outside.js');
  });

  it('reports bare module imports that need a build step', () => {
    const result = detectDeck(deck({
      'index.html': revealPage({ tail: '<script type="module">import Reveal from "reveal.js"; import * as THREE from "three"; import { x } from "./js/x.mjs"; new Reveal().initialize();</script>' }),
      'js/x.mjs': 'export const x = 1',
    }));
    assert.deepEqual(result.issues.filter((item) => item.code === 'external-library').map((item) => item.where), ['three']);
    assert.equal(issue(result, 'missing-local-file'), undefined);
  });

  it('keeps the list of notes bounded', () => {
    const images = Array.from({ length: 120 }, (_, index) => `<img src="missing-${index}.png" alt="">`).join('');
    const result = detectDeck(deck({ 'index.html': revealPage({ slides: `<section>${images}</section>` }) }));
    assert.equal(result.issues.length, DECK_DETECT_LIMITS.issues + 1);
    assert.deepEqual(result.issues.at(-1), { code: 'more-notes', severity: 'info', message: '80 more notes are not shown.' });
  });

  it('cleans untrusted text before it reaches a message', () => {
    const host = 'evil‮example.com';
    const result = detectDeck(deck({ 'index.html': revealPage({ head: `<script src="https://${host}/lib.js"></script><img src="x\u0007y.png">` }) }));
    assertWellFormed(result);
    assert.ok(result.issues.length >= 2);
  });
});

describe('deck detection: Slidev', () => {
  const index = (base = '/', extra = '') => `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Waves</title>
<meta property="slidev:version" content="53.1.0">
<script type="module" crossorigin src="${base}assets/index-B6FP2x97.js"></script>
<link rel="stylesheet" crossorigin href="${base}assets/index-Cm0V5i8x.css">
<link rel="icon" href="https://cdn.jsdelivr.net/gh/slidevjs/slidev/assets/favicon.png">${extra}</head><body><div id="app"></div></body></html>`;
  const entry = (call: string) => `import{A as N,z as ke,B as le}from"./modules/vue-BiX3jwQT.js";async function Qs(e){let n=le({history:${call}(\`/\`),routes:[]});e.use(n)}`;
  const vue = 'function yt(e=``){let t=[],n=[[``,{}]],r=0;e=Ke(e);return{location:``}}'
    + 'function Et(e){return e=location.host?e||location.pathname+location.search:``,e.includes(`#`)||(e+=`#`),Tt(e)}'
    + 'function Tt(e){e=qe(e);function r(e,t=!0){t||n.pauseListeners(),history.go(e)}return r}'
    + 'export{x as A,yt as z,Et as B,Tt as C}';
  const build = (prefix: string, call: string, base = '/') => ({
    [`${prefix}index.html`]: index(base),
    [`${prefix}assets/index-B6FP2x97.js`]: entry(call),
    [`${prefix}assets/index-Cm0V5i8x.css`]: 'body{}',
    [`${prefix}assets/modules/vue-BiX3jwQT.js`]: vue,
  });

  it('recognises a build and reads its version, base and router hint', () => {
    const result = detectDeck(deck(build('', 'ke')));
    assert.deepEqual({ ...result, issues: codes(result) }, {
      kind: 'slidev-build', entry: 'index.html', engine: 'slidev', engineVersion: '53.1.0', title: 'Waves', issues: [],
      flags: { slidevHasMonaco: false, slidevHasWorkers: false, slidevBase: '/', slidevRouter: 'memory' },
    });
  });

  it('tells the router modes apart from the history function the build calls', () => {
    assert.equal(detectDeck(deck(build('', 'ke'))).flags.slidevRouter, 'memory');
    assert.equal(detectDeck(deck({ ...build('', 'ke'), 'assets/index-B6FP2x97.js': entry('le').replace('let n=le(', 'let n=N(') })).flags.slidevRouter, 'hash');
    const history = { ...build('', 'ke'), 'assets/index-B6FP2x97.js': 'import{C as To}from"./modules/vue-BiX3jwQT.js";const s=Co({history:To("/"),routes:ja()});' };
    assert.equal(detectDeck(deck(history)).flags.slidevRouter, 'history');
    // An older build with the history function in the same chunk and the configured mode as a literal.
    const old = { ...build('', 'ke'), 'assets/index-B6FP2x97.js': 'const c={routerMode:"history"};function X1(e){e=v(e);history.go(e)}const s=Co({history:X1("/"),routes:a});' };
    assert.equal(detectDeck(deck(old)).flags.slidevRouter, 'history');
    const unknown = { ...build('', 'ke'), 'assets/index-B6FP2x97.js': 'console.log(1)' };
    assert.equal(detectDeck(deck(unknown)).flags.slidevRouter, undefined);
  });

  it('resolves files of a build made for a server path and of a relative build', () => {
    const sub = detectDeck(deck(build('', 'ke', '/talks/waves/')));
    assert.equal(sub.flags.slidevBase, '/talks/waves/');
    assert.deepEqual(codes(sub), []);
    const relative = detectDeck(deck(build('dist/', 'ke', './')));
    assert.equal(relative.entry, 'dist/index.html');
    assert.equal(relative.flags.slidevBase, './');
    assert.deepEqual(codes(relative), []);
    const missing = { ...build('', 'ke') } as Record<string, string>;
    delete missing['assets/index-Cm0V5i8x.css'];
    assert.equal(detectDeck(deck(missing)).issues[0].where, 'assets/index-Cm0V5i8x.css');
  });

  it('prefers a build next to its source project and says so', () => {
    const result = detectDeck(deck({
      ...build('dist/', 'ke', './'),
      'slides.md': '---\ntheme: default\n---\n# Waves',
      'package.json': '{"devDependencies":{"@slidev/cli":"53.1.0"}}',
    }));
    assert.equal(result.kind, 'slidev-build');
    assert.equal(result.flags.hasSource, true);
    assert.deepEqual(codes(result), ['slidev-build-with-source']);
    assert.match(result.issues[0].message, /dist\//);
  });

  it('flags Monaco, workers, external scripts and a missing version', () => {
    const result = detectDeck(deck({
      ...build('', 'ke'),
      'index.html': index('/', '<script src="https://platform.twitter.com/widgets.js"></script>').replace(/<meta property="slidev:version"[^>]*>/, ''),
      'assets/slidev/env-1.js': '1',
      'assets/monaco/editor.main-abc.js': '1',
      'assets/editor.worker-Dk3k2.js': '1',
    }));
    assert.equal(result.kind, 'slidev-build');
    assert.equal(result.engineVersion, undefined);
    assert.equal(result.flags.slidevHasMonaco, true);
    assert.equal(result.flags.slidevHasWorkers, true);
    assert.deepEqual(codes(result), ['slidev-version-unknown', 'slidev-monaco', 'external-library']);
    assert.match(issue(result, 'external-library')!.message, /platform\.twitter\.com/);
    // Without the version meta and without Slidev's own assets, it is not a Slidev build.
    const plain = { ...build('', 'ke'), 'index.html': index().replace(/<meta property="slidev:version"[^>]*>/, '') };
    assert.equal(detectDeck(deck(plain)).kind, 'html');
  });

  it('recognises unbuilt source projects by package.json or by Slidev syntax', () => {
    const fromPackage = detectDeck(deck({ 'package.json': '{"scripts":{"dev":"slidev --open"}}', 'pages/intro.md': '# Intro' }));
    assert.equal(fromPackage.kind, 'slidev-source');
    assert.equal(fromPackage.issues[0].severity, 'error');
    const fromSyntax = detectDeck(deck({ 'talk.md': '---\ntheme: seriph\ntransition: slide-left\nmdc: true\n---\n# Hello\n\n<v-click>Shown later</v-click>\n' }));
    assert.equal(fromSyntax.kind, 'slidev-source');
    assert.equal(fromSyntax.entry, 'talk.md');
    assert.equal(fromSyntax.title, 'Hello');
    const marp = detectDeck(deck({ 'talk.md': '---\nmarp: true\ntheme: gaia\n---\n# Hello' }));
    assert.equal(marp.kind, 'markdown-bundle');
    const broken = detectDeck(deck({ 'package.json': '{not json', 'a.md': '# A' }));
    assert.equal(broken.kind, 'markdown-bundle');
  });
});

describe('deck detection: hostile input', () => {
  it('handles a very large page quickly and skips pages beyond the limit', () => {
    const big = revealPage({ slides: `<section>${"<p>x</p>".repeat(200_000)}</section>`, tail: `<script>/* ${"x".repeat(20_000_000)} */</script>` });
    const started = performance.now();
    const result = detectDeck(deck({ 'index.html': big }));
    assert.equal(result.kind, 'reveal');
    assert.ok(performance.now() - started < 15_000);
    const crowded = detectDeck(deck({ 'index.html': '<p>x</p>'.repeat(DECK_DETECT_LIMITS.htmlTags + 1) }));
    assert.equal(crowded.kind, 'unknown');
    assert.match(issue(crowded, 'page-too-large')!.message, /too many elements/);
    const huge = new Uint8Array(DECK_DETECT_LIMITS.htmlBytes + 1).fill(0x61);
    const skipped = detectDeck(new Map([['index.html', huge]]));
    assert.equal(skipped.kind, 'unknown');
    assert.ok(codes(skipped).includes('page-too-large'));
  });

  it('survives deeply nested markup without overflowing the stack', () => {
    for (const tag of ['div', 'section', 'b', 'table', 'svg']) {
      const nested = `<div class="reveal"><div class="slides">${`<${tag}>`.repeat(60_000)}</div></div><script>Reveal.initialize()</script>`;
      const result = detectDeck(deck({ 'index.html': nested }));
      assertWellFormed(result);
    }
    const sections = detectDeck(deck({ 'index.html': `<div class="reveal"><div class="slides">${'<section>'.repeat(60_000)}</div></div><script>Reveal.initialize()</script>` }));
    assert.equal(sections.kind, 'reveal');
  });

  it('reads invalid UTF-8 and binary bytes without throwing', () => {
    const invalid = new Uint8Array([...strToU8('<div class="reveal"><div class="slides"><section>'), 0xff, 0xfe, 0xc3, 0x28, ...strToU8('</section></div></div><script>Reveal.initialize()</script>')]);
    assert.equal(detectDeck(new Map([['index.html', invalid]])).kind, 'reveal');
    let seed = 7;
    const random = () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed & 0xff; };
    for (let round = 0; round < 20; round += 1) {
      const files: DeckFiles = new Map();
      for (const path of ['index.html', 'package.json', 'slides.md', 'assets/index-a.js', 'dist/reveal.js']) {
        files.set(path, Uint8Array.from({ length: 2000 }, random));
      }
      assertWellFormed(detectDeck(files));
    }
  });

  it('is not slowed by pathological text in scripts and attributes', () => {
    const started = performance.now();
    const script = `<script>${'import '.repeat(200_000)}${'"reveal'.repeat(100_000)}${'.initialize({'.repeat(50_000)}</script>`;
    const attributes = `<div ${'a=1 '.repeat(200_000)}></div>`;
    const css = `<style>${'url('.repeat(200_000)}${'@import '.repeat(100_000)}</style>`;
    assertWellFormed(detectDeck(deck({ 'index.html': `<div class="reveal"><div class="slides"></div></div>${script}${attributes}${css}` })));
    assertWellFormed(detectDeck(deck({ 'index.html': revealPage(), 'dist/reveal.js': '"1.2.3"'.repeat(500_000), 'package.json': '{'.repeat(100_000) })));
    assert.ok(performance.now() - started < 15_000);
  });
});

describe('deck detection on the research corpus', () => {
  const folder = '/tmp/claude-0/-home-user-md-qft-org/62b03238-2ec2-5a4f-bd5c-e84ccde76ebd/scratchpad/research/corpus/naive/';
  const zips = existsSync(folder) ? readdirSync(folder).filter((name) => name.endsWith('.zip')) : [];

  it('recognises every AI-made Reveal.js ZIP', { skip: zips.length ? false : 'the research corpus is not on this machine' }, async () => {
    for (const name of zips) {
      const archive = await readDeckArchive(new File([new Uint8Array(readFileSync(folder + name))], name));
      const result = detectDeck(archive.files);
      assertWellFormed(result);
      assert.equal(result.kind, 'reveal', name);
      assert.equal(result.entry, 'index.html', name);
      assert.match(result.engineVersion ?? '', /^[56]\.\d+\.\d+$/, name);
      assert.equal(result.issues.filter((item) => item.severity !== 'info').length, 0, `${name}: ${JSON.stringify(result.issues)}`);
    }
  });
});
