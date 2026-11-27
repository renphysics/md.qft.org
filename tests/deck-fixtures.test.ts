import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readDeckArchive } from '../src/lib/deck-archive.ts';
import { FIXTURE_DECKS, loadFixtureDeck, zipFixture, type FixtureDeckName } from './helpers/deck-fixtures.ts';

const text = (name: FixtureDeckName, path: string) => new TextDecoder().decode(loadFixtureDeck(name).get(path));

describe('test decks for import, detection and linking', () => {
  it('every fixture loads from its folder and from a ZIP', async () => {
    for (const name of FIXTURE_DECKS) {
      const files = loadFixtureDeck(name);
      assert.ok(files.size > 0, name);
      for (const [path, bytes] of files) {
        assert.match(path, /^[\w.-]+(?:\/[\w.-]+)*$/, `${name}: ${path}`);
        assert.ok(bytes.length > 0 && bytes.length < 16 * 1024, `${name}: ${path} stays small`);
      }
      const deck = await readDeckArchive(zipFixture(name, { wrap: name }));
      assert.deepEqual(deck.files, new Map([...files].sort(([a], [b]) => a.localeCompare(b))), name);
      assert.deepEqual(deck.issues, [], name);
    }
  });

  it('contains no third-party library files', () => {
    for (const name of FIXTURE_DECKS) {
      for (const path of loadFixtureDeck(name).keys()) {
        assert.doesNotMatch(path, /(?:^|\/)(?:dist|plugin|node_modules)\/|reveal(?:\.min)?\.m?js$|katex/i, `${name}: ${path}`);
      }
    }
  });

  it('covers the CDN patterns AI tools write', () => {
    const five = text('cdn-reveal5-single', 'index.html');
    for (const path of ['dist/reset.css', 'dist/reveal.css', 'dist/theme/white.css', 'dist/reveal.js',
      'plugin/notes/notes.js', 'plugin/math/math.js', 'plugin/highlight/highlight.js', 'plugin/highlight/monokai.css']) {
      assert.ok(five.includes(`https://cdn.jsdelivr.net/npm/reveal.js@5.2.1/${path}`), path);
    }
    assert.match(five, /RevealMath\.KaTeX/);
    assert.match(five, /hash:\s*true/);
    assert.ok((five.match(/<section[\s>]/g) ?? []).length >= 7, 'at least five slides plus a vertical stack');
    assert.match(five, /<section>\s*<section/);
    assert.match(five, /class="fragment"/);
    assert.match(five, /<aside class="notes">/);
    assert.ok((five.match(/\$\$|\\\(/g) ?? []).length >= 3, 'two or more formulas');
    assert.match(five, /<canvas[^>]+id="plot"/);
    assert.match(five, /type="range"/);
    assert.match(five, /addEventListener\('input'/);
    assert.match(five, /<output id="zeta-value">/);

    const four = text('cdn-reveal4-cdnjs', 'index.html');
    assert.match(four, /cdnjs\.cloudflare\.com\/ajax\/libs\/reveal\.js\/4\.6\.1\/reveal\.min\.js/);
    assert.match(four, /4\.6\.1\/theme\/league\.min\.css/);
    assert.match(four, /<section data-markdown>\s*<textarea data-template>/);
    assert.match(four, /onclick="document\.getElementById\('answer'\)\.textContent/);

    const six = text('cdn-reveal6-unpkg', 'index.html');
    for (const path of ['dist/reveal.js', 'dist/plugin/notes.js', 'dist/plugin/math.js', 'dist/plugin/highlight.js']) {
      assert.ok(six.includes(`https://unpkg.com/reveal.js@6.0.2/${path}`), path);
    }
  });

  it('covers local projects with missing Reveal files, modules, plain pages and non-decks', () => {
    const project = loadFixtureDeck('local-project');
    for (const path of ['index.html', 'css/custom.css', 'css/theme-extra.css', 'js/demo.js', 'assets/pic.png', 'slides.md']) {
      assert.ok(project.has(path), path);
    }
    const index = text('local-project', 'index.html');
    for (const reference of ['dist/reveal.js', 'dist/reveal.css', 'dist/theme/black.css', 'plugin/markdown/markdown.js']) {
      assert.ok(index.includes(`"${reference}"`), reference);
      assert.equal(project.has(reference), false, `${reference} is left for the linker to supply`);
    }
    assert.match(index, /data-markdown="slides\.md"/);
    assert.match(index, /data-background-image="assets\/pic\.png"/);
    assert.match(index, /<img data-src="assets\/pic\.png"/);
    const css = text('local-project', 'css/custom.css');
    assert.match(css, /@import url\("theme-extra\.css"\)/);
    assert.match(css, /url\("\.\.\/assets\/pic\.png"\)/);
    assert.deepEqual([...project.get('assets/pic.png')!.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);

    assert.match(text('esm-project', 'index.html'), /<script type="module">[\s\S]*from '\.\/dist\/reveal\.mjs'[\s\S]*from '\.\/js\/demo\.mjs'/);
    assert.doesNotMatch(text('plain-html', 'index.html'), /reveal/i);
    assert.match(JSON.parse(text('slidev-source', 'package.json')).dependencies['@slidev/cli'], /\d/);
    assert.match(text('slidev-source', 'slides.md'), /^---\n[\s\S]*?\n---\n/);
    assert.ok(loadFixtureDeck('slidev-source').has('components/Counter.vue'));
    assert.deepEqual([...loadFixtureDeck('not-a-deck').keys()], ['diagram.png', 'notes.md']);
  });
});
