import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { linkDeck } from '../src/lib/deck-linker.ts';
import { rewriteScriptedNavigation } from '../src/lib/deck-linker-modules.ts';
import type { DeckDetection, DeckFiles } from '../src/lib/deck-types.ts';
import { nodeVendorProvider } from './helpers/deck-vendor-node.ts';

/* A button that goes to a website by changing the page address (review W1.1, linker side). */

const encoder = new TextEncoder();
const deck = (files: Record<string, string>): DeckFiles => new Map(Object.entries(files).map(([path, value]) => [path, encoder.encode(value)]));
const detection: DeckDetection = { kind: 'html', engine: 'html', entry: 'index.html', issues: [], flags: {} } as DeckDetection;
const link = (html: string, extra: Record<string, string> = {}) => linkDeck(deck({ 'index.html': html, ...extra }), detection, nodeVendorProvider());
const page = (body: string) => `<!doctype html><html><head><meta charset="utf-8"><title>T</title></head><body>${body}</body></html>`;
const note = (host: string) => `A button in the presentation goes to a website${host ? ` (${host})` : ''} by changing the page address. The player offers the address as a link instead.`;

describe('rewriting a literal change of the page address', () => {
  it('turns each literal form into window.open', () => {
    const cases: [string, string][] = [
      ['location.href = "https://example.org/sim";', 'window.open("https://example.org/sim", "_blank");'],
      ["location = 'https://example.org/a'", `window.open('https://example.org/a', "_blank")`],
      ['location.assign("http://example.org/b")', 'window.open("http://example.org/b", "_blank")'],
      ['location.replace(`//example.org/c`);', 'window.open(`//example.org/c`, "_blank");'],
      ['window.location.href="https://a.example/"', 'window.open("https://a.example/", "_blank")'],
      ['self.location = "https://a.example/"', 'window.open("https://a.example/", "_blank")'],
      ['top.location.href = "https://a.example/"', 'window.open("https://a.example/", "_blank")'],
      ['parent.location.assign("https://a.example/")', 'window.open("https://a.example/", "_blank")'],
      ['document.location = "HTTPS://A.example/"', 'window.open("HTTPS://A.example/", "_blank")'],
      ['if (ok) location.href = "https://a.example/"; else go();', 'if (ok) window.open("https://a.example/", "_blank"); else go();'],
      ['button.onclick = () => location = "https://a.example/"', 'button.onclick = () => window.open("https://a.example/", "_blank")'],
      ['start()\nlocation = "https://a.example/"\nnext()', 'start()\nwindow.open("https://a.example/", "_blank")\nnext()'],
    ];
    for (const [code, expected] of cases) assert.equal(rewriteScriptedNavigation(code)?.code, expected, code);
    assert.deepEqual(rewriteScriptedNavigation('location.href="https://a.example/x"; location.assign("//b.example/y")')?.addresses, ['https://a.example/x', '//b.example/y']);
  });

  it('leaves look-alikes and anything that is not a complete web-address literal alone', () => {
    for (const code of [
      'if (location.href == "https://example.org/") {}',
      'if (location.href === "https://example.org/") {}',
      'mylocation.href = "https://example.org/";',
      'frame.location.href = "https://example.org/";',
      'frame.window.location = "https://example.org/";',
      'location.hash = "https://example.org/";',
      'location.href = "slides/next.html";',
      'location.href = "#/2";',
      'location.href = "https://example.org/" + page;',
      'location.href = `https://example.org/${page}`;',
      'location.assign("https://example.org/", 1)',
      'location.assign(address)',
      'var location = "https://example.org/";',
      'function go(location = "https://example.org/") {}',
      '// location.href = "https://example.org/";',
      'const text = "location.href = \'https://example.org/\'";',
      'location.href = "javascript:alert(1)"',
      'location.href += "https://example.org/"',
      'window?.location.assign("https://example.org/")',
      'location.href = "https://example.org/',
    ]) assert.equal(rewriteScriptedNavigation(code), undefined, code);
  });
});

describe('the linker', () => {
  it('rewrites inline scripts and onclick attributes, and notes the first host once', async () => {
    const result = await link(page(`<button onclick="location.href='https://example.org/sim'">Open</button>
<button onclick="window.location.assign('https://other.example/')">Other</button>
<script>document.querySelector('#go')?.addEventListener('click', () => { location = "https://third.example/"; });</script>`));
    assert.doesNotMatch(result.html, /location/);
    assert.equal(result.html.split('window.open(').length - 1, 3);
    assert.match(result.html, /window\.open\('https:\/\/example\.org\/sim', "_blank"\)/);
    const notes = result.issues.filter((issue) => issue.code === 'scripted-navigation');
    assert.deepEqual(notes.map((issue) => [issue.severity, issue.message]), [['info', note('example.org')]]);
  });

  it('rewrites a local script file and a javascript: link, but not a library file', async () => {
    const result = await link(page('<a href="javascript:location.href=\'https://example.org/\'">go</a><script src="app.js"></script><script src="js/reveal.js"></script>'), {
      'app.js': 'function go() { location.href = "https://app.example/"; }',
      'js/reveal.js': 'window.Reveal = { home() { location.href = "https://revealjs.com/"; } };',
    });
    assert.match(result.html, /window\.open\("https:\/\/app\.example\/", "_blank"\)/);
    assert.match(result.html, /window\.open\('https:\/\/example\.org\/', "_blank"\)/);
    assert.match(result.html, /location\.href = "https:\/\/revealjs\.com\/"/, 'the library is left as it is');
    assert.ok(result.issues.some((issue) => issue.code === 'scripted-navigation'));
  });

  it('rewrites an inline module, and says nothing when there is nothing to rewrite', async () => {
    const module = await link(page('<script type="module">document.body.onclick = () => { location.replace("https://m.example/") };</script>'));
    assert.match(module.html, /window\.open\("https:\/\/m\.example\/", "_blank"\)/);
    const plain = await link(page('<script>location.href = "next.html"; if (location.href == "https://x.example/") {}</script>'));
    assert.ok(!plain.issues.some((issue) => issue.code === 'scripted-navigation'));
    assert.match(plain.html, /location\.href = "next\.html"/);
  });

  it('links a linked page to the same page', async () => {
    const first = await link(page('<button onclick="location.href=\'https://example.org/sim\'">Open</button>'));
    const again = await link(first.html);
    assert.equal(again.html, first.html);
  });
});
