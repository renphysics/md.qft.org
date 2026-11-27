import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  BUNDLED_TEXT_FILES, BUNDLED_VERSIONS, createGlobVendorProvider, isBundledFile, mapLibraryPath, mapLibraryUrl,
  mapModuleSpecifier, vendorFileFromModulePath, type LibraryReference, type VendorLibrary,
} from '../src/lib/deck-vendor.ts';
import { NODE_MODULES, nodeVendorProvider } from './helpers/deck-vendor-node.ts';

type Expected = Partial<LibraryReference>;

function expectUrl(url: string, expected: Expected) {
  const actual = mapLibraryUrl(url);
  assert.ok(actual, `${url} should map to a bundled file`);
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(actual[key as keyof LibraryReference], value, `${url}: ${key}`);
  }
  for (const path of actual.files) assert.ok(isBundledFile({ library: actual.library, path }), `${url}: ${path} is bundled`);
}

const coreFiles = { role: 'reveal-core' as const, files: ['dist/reveal.js'], global: 'Reveal' };
const plugin = (name: string, global: string) => ({ role: 'reveal-plugin' as const, files: [`dist/plugin/${name}.js`], plugin: name as never, global });

describe('bundled library files', () => {
  it('match the versions installed in node_modules', () => {
    for (const library of Object.keys(BUNDLED_VERSIONS) as VendorLibrary[]) {
      const manifest = JSON.parse(readFileSync(join(NODE_MODULES, library, 'package.json'), 'utf8'));
      assert.equal(manifest.version, BUNDLED_VERSIONS[library], library);
    }
  });

  it('all exist, and the fs provider serves text and fonts but nothing else', async () => {
    const vendor = nodeVendorProvider();
    for (const library of Object.keys(BUNDLED_TEXT_FILES) as VendorLibrary[]) {
      for (const path of BUNDLED_TEXT_FILES[library]) {
        const text = await vendor.text({ library, path });
        assert.ok(text && text.length > 100, `${library}/${path}`);
        assert.equal(await vendor.bytes({ library, path }), undefined, 'text files are not served as bytes');
      }
    }
    const fonts = readdirSync(join(NODE_MODULES, 'katex/dist/fonts')).filter((name) => name.endsWith('.woff2'));
    assert.equal(fonts.length, 20);
    for (const name of fonts) {
      const bytes = await vendor.bytes({ library: 'katex', path: `dist/fonts/${name}` });
      assert.deepEqual([...bytes!.subarray(0, 4)], [0x77, 0x4f, 0x46, 0x32], `${name} is woff2`);
    }
    for (const path of ['dist/plugin/math.js', 'dist/reveal.mjs', 'package.json', 'dist/fonts/KaTeX_Main-Regular.ttf', '../reveal.js/dist/reveal.js']) {
      assert.equal(await vendor.text({ library: path.includes('reveal') && !path.startsWith('..') ? 'reveal.js' : 'katex', path }), undefined, path);
    }
  });
});

describe('Reveal.js CDN references', () => {
  it('maps the 3.x layout on jsDelivr, unpkg and cdnjs', () => {
    for (const base of ['https://cdn.jsdelivr.net/npm/reveal.js@3.9.2', 'https://unpkg.com/reveal.js@3.9.2', 'https://cdn.jsdelivr.net/npm/reveal.js@3']) {
      expectUrl(`${base}/js/reveal.js`, { ...coreFiles, module: false });
      expectUrl(`${base}/css/reveal.css`, { role: 'reveal-style', files: ['dist/reset.css', 'dist/reveal.css'] });
      expectUrl(`${base}/css/theme/black.css`, { role: 'reveal-theme', files: ['dist/theme/black.css'] });
      expectUrl(`${base}/lib/css/zenburn.css`, { role: 'highlight-theme', files: ['dist/plugin/highlight/zenburn.css'] });
      expectUrl(`${base}/lib/js/head.min.js`, { role: 'not-needed', files: [] });
      expectUrl(`${base}/plugin/markdown/marked.js`, { role: 'not-needed', files: [] });
      expectUrl(`${base}/plugin/markdown/markdown.js`, plugin('markdown', 'RevealMarkdown'));
      expectUrl(`${base}/plugin/highlight/highlight.js`, plugin('highlight', 'RevealHighlight'));
      expectUrl(`${base}/plugin/notes/notes.js`, plugin('notes', 'RevealNotes'));
      expectUrl(`${base}/plugin/zoom-js/zoom.js`, plugin('zoom', 'RevealZoom'));
      expectUrl(`${base}/plugin/search/search.js`, plugin('search', 'RevealSearch'));
      expectUrl(`${base}/plugin/math/math.js`, { role: 'reveal-math', files: [], plugin: 'math', global: 'RevealMath' });
      expectUrl(`${base}/plugin/print-pdf/print-pdf.js`, { role: 'not-needed', files: [] });
      expectUrl(`${base}/css/print/paper.css`, { role: 'not-needed', files: [] });
      expectUrl(`${base}/lib/font/source-sans-pro/source-sans-pro.css`, { role: 'not-needed', files: [] });
    }
    const cdnjs = 'https://cdnjs.cloudflare.com/ajax/libs/reveal.js/3.6.0';
    expectUrl(`${cdnjs}/js/reveal.min.js`, { ...coreFiles, requested: '3.6.0', host: 'cdnjs.cloudflare.com' });
    expectUrl(`${cdnjs}/css/reveal.min.css`, { role: 'reveal-style', files: ['dist/reset.css', 'dist/reveal.css'] });
    expectUrl(`${cdnjs}/css/theme/moon.min.css`, { role: 'reveal-theme', files: ['dist/theme/moon.css'] });
    expectUrl(`${cdnjs}/lib/js/head.min.js`, { role: 'not-needed', files: [] });
    expectUrl(`${cdnjs}/plugin/markdown/markdown.min.js`, plugin('markdown', 'RevealMarkdown'));
  });

  it('maps the 4.x and 5.x layout on each CDN, pinned, ranged, unversioned and latest', () => {
    for (const [base, requested] of [
      ['https://cdn.jsdelivr.net/npm/reveal.js@4.6.1', '4.6.1'], ['https://cdn.jsdelivr.net/npm/reveal.js@5.2.1', '5.2.1'],
      ['https://unpkg.com/reveal.js@^4', '^4'], ['https://unpkg.com/reveal.js@5', '5'],
      ['https://cdn.jsdelivr.net/npm/reveal.js', ''], ['https://cdn.jsdelivr.net/npm/reveal.js@latest', 'latest'],
      ['//cdn.jsdelivr.net/npm/reveal.js@5.1.0', '5.1.0'], ['http://unpkg.com/reveal.js@4.3.1', '4.3.1'],
      ['https://fastly.jsdelivr.net/npm/reveal.js@5.2.1', '5.2.1'], ['https://cdn.jsdelivr.net/gh/hakimel/reveal.js@4.1.0', '4.1.0'],
    ] as const) {
      expectUrl(`${base}/dist/reveal.js`, { ...coreFiles, module: false, requested });
      expectUrl(`${base}/dist/reveal.esm.js`, { ...coreFiles, module: true });
      expectUrl(`${base}/dist/reset.css`, { role: 'reveal-style', files: ['dist/reset.css'] });
      expectUrl(`${base}/dist/reveal.css`, { role: 'reveal-style', files: ['dist/reveal.css'] });
      expectUrl(`${base}/dist/theme/white.css`, { role: 'reveal-theme', files: ['dist/theme/white.css'] });
      expectUrl(`${base}/dist/theme/fonts/source-sans-pro/source-sans-pro.css`, { role: 'not-needed', files: [] });
      expectUrl(`${base}/plugin/notes/notes.js`, { ...plugin('notes', 'RevealNotes'), module: false });
      expectUrl(`${base}/plugin/notes/notes.esm.js`, { ...plugin('notes', 'RevealNotes'), module: true });
      expectUrl(`${base}/plugin/markdown/markdown.js`, plugin('markdown', 'RevealMarkdown'));
      expectUrl(`${base}/plugin/highlight/highlight.js`, plugin('highlight', 'RevealHighlight'));
      expectUrl(`${base}/plugin/highlight/monokai.css`, { role: 'highlight-theme', files: ['dist/plugin/highlight/monokai.css'] });
      expectUrl(`${base}/plugin/zoom/zoom.js`, plugin('zoom', 'RevealZoom'));
      expectUrl(`${base}/plugin/math/math.js`, { role: 'reveal-math', files: [] });
    }
    const cdnjs = 'https://cdnjs.cloudflare.com/ajax/libs/reveal.js/4.6.1';
    expectUrl(`${cdnjs}/reveal.min.js`, { ...coreFiles, requested: '4.6.1' });
    expectUrl(`${cdnjs}/reveal.esm.min.js`, { ...coreFiles, module: true });
    expectUrl(`${cdnjs}/reset.min.css`, { role: 'reveal-style', files: ['dist/reset.css'] });
    expectUrl(`${cdnjs}/reveal.min.css`, { role: 'reveal-style', files: ['dist/reveal.css'] });
    expectUrl(`${cdnjs}/theme/league.min.css`, { role: 'reveal-theme', files: ['dist/theme/league.css'] });
    expectUrl(`${cdnjs}/plugin/markdown/markdown.min.js`, plugin('markdown', 'RevealMarkdown'));
    expectUrl(`${cdnjs}/plugin/highlight/monokai.min.css`, { role: 'highlight-theme', files: ['dist/plugin/highlight/monokai.css'] });
    expectUrl('https://esm.sh/reveal.js@5.2.1', { ...coreFiles, module: true, requested: '5.2.1', host: 'esm.sh' });
    expectUrl('https://esm.sh/reveal.js@5.2.1/plugin/markdown/markdown.esm.js', { ...plugin('markdown', 'RevealMarkdown'), module: true });
    expectUrl('https://esm.sh/v135/reveal.js@5.0.0/es2022/reveal.mjs', { ...coreFiles, module: true, requested: '5.0.0' });
    // Pandoc before 3.7 writes a double slash.
    expectUrl('https://unpkg.com/reveal.js@^4//dist/reveal.js', { ...coreFiles, requested: '^4' });
    expectUrl('https://unpkg.com/reveal.js@^4//dist/theme/sky.css', { role: 'reveal-theme', files: ['dist/theme/sky.css'] });
    expectUrl('https://cdn.jsdelivr.net/npm/reveal.js@4.6.1/dist/theme/white_contrast_compact_verbatim_headers.css',
      { role: 'reveal-theme', files: ['dist/theme/white-contrast.css'] });
    expectUrl('https://cdn.jsdelivr.net/npm/reveal.js@5.2.1/dist/reveal.js?v=1#x', coreFiles);
  });

  it('maps the 6.x layout, its export names and module builds', () => {
    for (const base of ['https://cdn.jsdelivr.net/npm/reveal.js@6.0.2', 'https://unpkg.com/reveal.js@6.0.2', 'https://unpkg.com/reveal.js@^6']) {
      expectUrl(`${base}/dist/reveal.js`, { ...coreFiles, module: false });
      expectUrl(`${base}/dist/reveal.mjs`, { ...coreFiles, module: true });
      for (const [name, global] of [['notes', 'RevealNotes'], ['markdown', 'RevealMarkdown'], ['highlight', 'RevealHighlight'], ['search', 'RevealSearch'], ['zoom', 'RevealZoom']]) {
        expectUrl(`${base}/dist/plugin/${name}.js`, { ...plugin(name, global), module: false });
        expectUrl(`${base}/dist/plugin/${name}.mjs`, { ...plugin(name, global), module: true });
        expectUrl(`${base}/plugin/${name}`, plugin(name, global));
      }
      expectUrl(`${base}/dist/plugin/math.js`, { role: 'reveal-math', files: [] });
      expectUrl(`${base}/dist/plugin/highlight/zenburn.css`, { role: 'highlight-theme', files: ['dist/plugin/highlight/zenburn.css'] });
      expectUrl(`${base}/reveal.css`, { role: 'reveal-style', files: ['dist/reveal.css'] });
      expectUrl(`${base}/reset.css`, { role: 'reveal-style', files: ['dist/reset.css'] });
      expectUrl(`${base}/theme/dracula.css`, { role: 'reveal-theme', files: ['dist/theme/dracula.css'] });
      expectUrl(`${base}/plugin/highlight/monokai.css`, { role: 'highlight-theme', files: ['dist/plugin/highlight/monokai.css'] });
    }
    const cdnjs = 'https://cdnjs.cloudflare.com/ajax/libs/reveal.js/6.0.2';
    expectUrl(`${cdnjs}/reveal.min.js`, coreFiles);
    expectUrl(`${cdnjs}/plugin/markdown.min.js`, plugin('markdown', 'RevealMarkdown'));
    expectUrl(`${cdnjs}/plugin/notes.min.js`, plugin('notes', 'RevealNotes'));
    expectUrl(`${cdnjs}/theme/black-contrast.min.css`, { role: 'reveal-theme', files: ['dist/theme/black-contrast.css'] });
    expectUrl('https://esm.sh/reveal.js@6.0.2/plugin/markdown', { ...plugin('markdown', 'RevealMarkdown'), module: true });
    expectUrl('https://cdn.jsdelivr.net/npm/reveal.js@6.0.2/+esm', { ...coreFiles, module: true });
    expectUrl('https://cdn.jsdelivr.net/npm/reveal.js@6.0.2/dist/plugin/notes.js/+esm', { ...plugin('notes', 'RevealNotes'), module: true });
    expectUrl('https://cdn.skypack.dev/reveal.js@6.0.2', { ...coreFiles, module: true });
    expectUrl('https://ga.jspm.io/npm:reveal.js@5.2.1/dist/reveal.esm.js', { ...coreFiles, module: true, requested: '5.2.1' });
  });

  it('leaves unknown files, other packages and other hosts alone', () => {
    for (const url of [
      'https://fonts.googleapis.com/css?family=Lato', 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js',
      'https://cdn.jsdelivr.net/npm/reveal.js@5/plugin/menu/menu.js', 'https://unpkg.com/reveal.js@5/dist/theme/custom.css',
      'https://unpkg.com/reveal.js@4/plugin/notes/notes.html', 'https://example.com/reveal.js/dist/reveal.js',
      'https://cdn.jsdelivr.net/npm/reveal.js-menu@2.1.0/menu.js', 'https://cdn.jsdelivr.net/npm/chart.js',
      'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js', 'javascript:alert(1)',
      'data:text/javascript,1', 'not a url', 'ftp://unpkg.com/reveal.js@5/dist/reveal.js', 'https://cdn.jsdelivr.net/npm/reveal.js@5/README.md',
      'https://cdn.jsdelivr.net/npm/reveal.js@5/plugin/math/katex.js',
    ]) assert.equal(mapLibraryUrl(url), undefined, url);
  });
});

describe('KaTeX CDN references', () => {
  it('maps the scripts, stylesheet, extensions and fonts on each CDN', () => {
    for (const base of ['https://cdn.jsdelivr.net/npm/katex@0.16.11/dist', 'https://unpkg.com/katex@0.16.9/dist', 'https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9', 'https://cdn.jsdelivr.net/npm/katex/dist']) {
      expectUrl(`${base}/katex.min.js`, { library: 'katex', role: 'katex', files: ['dist/katex.min.js'], global: 'katex' });
      expectUrl(`${base}/katex.js`, { role: 'katex', files: ['dist/katex.min.js'] });
      expectUrl(`${base}/katex.min.css`, { library: 'katex', role: 'katex-style', files: ['dist/katex.min.css'] });
      expectUrl(`${base}/contrib/auto-render.min.js`, { role: 'katex-extension', files: ['dist/contrib/auto-render.min.js'], global: 'renderMathInElement' });
      expectUrl(`${base}/contrib/mhchem.min.js`, { role: 'katex-extension', files: ['dist/contrib/mhchem.min.js'] });
      expectUrl(`${base}/contrib/copy-tex.min.js`, { role: 'katex-extension', files: ['dist/contrib/copy-tex.min.js'] });
      expectUrl(`${base}/fonts/KaTeX_Main-Regular.woff`, { role: 'katex-font', files: ['dist/fonts/KaTeX_Main-Regular.woff2'] });
    }
    expectUrl('https://esm.sh/katex@0.16.9', { library: 'katex', role: 'katex', module: true, requested: '0.16.9' });
    expectUrl('https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.mjs', { role: 'katex-extension', module: true });
    assert.equal(mapLibraryUrl('https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/render-a11y-string.min.js'), undefined);
  });
});

describe('library files a deck refers to but does not contain', () => {
  it('maps standard and vendored layouts', () => {
    const cases: [string, Partial<LibraryReference>][] = [
      ['dist/reveal.js', { library: 'reveal.js', role: 'reveal-core', files: ['dist/reveal.js'] }],
      ['dist/reveal.mjs', { role: 'reveal-core', module: true }],
      ['./dist/reveal.esm.js', { role: 'reveal-core', module: true }],
      ['dist/theme/black.css', { role: 'reveal-theme', files: ['dist/theme/black.css'] }],
      ['plugin/markdown/markdown.js', { role: 'reveal-plugin', files: ['dist/plugin/markdown.js'], global: 'RevealMarkdown' }],
      ['dist/plugin/highlight/monokai.css', { role: 'highlight-theme' }],
      ['vendor/reveal/dist/theme/black.css', { role: 'reveal-theme', files: ['dist/theme/black.css'] }],
      ['reveal.js/dist/reveal.css', { role: 'reveal-style', files: ['dist/reveal.css'] }],
      ['node_modules/reveal.js/dist/plugin/notes.js', { role: 'reveal-plugin', plugin: 'notes' }],
      ['lib/reveal.min.js', { role: 'reveal-core' }],
      ['js/reveal.js', { role: 'reveal-core' }],
      ['css/reveal.css', { files: ['dist/reset.css', 'dist/reveal.css'] }],
      ['css/theme/night.css', { files: ['dist/theme/night.css'] }],
      ['lib/js/head.min.js', { role: 'not-needed', files: [] }],
      ['plugin/math/math.js', { role: 'reveal-math' }],
      ['vendor/katex/katex.min.js', { library: 'katex', role: 'katex', files: ['dist/katex.min.js'] }],
      ['vendor/katex/dist/katex.min.css', { library: 'katex', role: 'katex-style' }],
      ['lib/contrib/auto-render.min.js', { library: 'katex', global: 'renderMathInElement' }],
      ['vendor/katex/dist/fonts/KaTeX_Main-Regular.woff', { library: 'katex', role: 'katex-font', files: ['dist/fonts/KaTeX_Main-Regular.woff2'] }],
    ];
    for (const [path, expected] of cases) {
      const actual = mapLibraryPath(path);
      assert.ok(actual, path);
      for (const [key, value] of Object.entries(expected)) assert.deepEqual(actual[key as keyof LibraryReference], value, `${path}: ${key}`);
      assert.equal(actual.requested, undefined, `${path} has no CDN version`);
    }
  });

  it('does not claim generic file names', () => {
    for (const path of ['css/style.css', 'reset.css', 'css/reset.css', 'js/app.js', 'theme/custom.css', 'css/theme/custom.css',
      'fonts/Inter.woff2', 'index.js', 'plugin/menu/menu.js', 'main.js', 'KaTeX_Main-Regular.woff2', 'notes.js', 'dist/app.js']) {
      assert.equal(mapLibraryPath(path), undefined, path);
    }
  });

  it('maps bare module specifiers through the package export names', () => {
    assert.deepEqual(mapModuleSpecifier('reveal.js'), { library: 'reveal.js', role: 'reveal-core', files: ['dist/reveal.js'], global: 'Reveal', module: true });
    assert.equal(mapModuleSpecifier('reveal.js/plugin/markdown')?.global, 'RevealMarkdown');
    assert.equal(mapModuleSpecifier('reveal.js/plugin/notes/notes.esm.js')?.global, 'RevealNotes');
    assert.equal(mapModuleSpecifier('reveal.js/dist/reveal.css')?.role, 'reveal-style');
    assert.equal(mapModuleSpecifier('reveal.js/theme/black.css')?.role, 'reveal-theme');
    assert.equal(mapModuleSpecifier('katex')?.global, 'katex');
    assert.equal(mapModuleSpecifier('katex/contrib/auto-render')?.global, 'renderMathInElement');
    assert.equal(mapModuleSpecifier('katex/dist/katex.min.css')?.role, 'katex-style');
    assert.equal(mapModuleSpecifier('https://cdn.jsdelivr.net/npm/reveal.js@5.2.1/dist/reveal.esm.js')?.requested, '5.2.1');
    for (const specifier of ['./js/demo.mjs', 'vue', 'reveal.js-menu', '/dist/reveal.mjs', 'reveal.js/README.md']) {
      assert.equal(mapModuleSpecifier(specifier), undefined, specifier);
    }
  });
});

describe('the bundler-backed provider', () => {
  function sources(fail = new Set<string>()) {
    const calls: string[] = [];
    const text: Record<string, () => Promise<unknown>> = {};
    for (const library of Object.keys(BUNDLED_TEXT_FILES) as VendorLibrary[]) {
      for (const path of BUNDLED_TEXT_FILES[library]) {
        const key = `../../node_modules/${library}/${path}`;
        text[key] = async () => {
          calls.push(key);
          if (fail.has(path)) { fail.delete(path); throw new Error('chunk failed'); }
          return readFileSync(join(NODE_MODULES, library, path), 'utf8');
        };
      }
    }
    // Files that are not bundled are ignored even if a glob matched them.
    text['../../node_modules/reveal.js/dist/plugin/math.js'] = async () => { calls.push('math'); return 'math'; };
    const urls: Record<string, string> = {
      '../../node_modules/katex/dist/fonts/KaTeX_Main-Regular.woff2': '/_astro/KaTeX_Main-Regular.abc.woff2',
      '../../node_modules/katex/dist/fonts/KaTeX_Main-Regular.ttf': '/_astro/KaTeX_Main-Regular.abc.ttf',
    };
    const fetched: string[] = [];
    const provider = createGlobVendorProvider({
      text, urls,
      async fetchBytes(url) { fetched.push(url); return new Uint8Array([0x77, 0x4f, 0x46, 0x32]); },
    });
    return { provider, calls, fetched };
  }

  it('loads each file once, only on request, and ignores files outside the bundle', async () => {
    const { provider, calls, fetched } = sources();
    assert.deepEqual(calls, [], 'nothing loads up front');
    const first = await provider.text({ library: 'reveal.js', path: 'dist/plugin/notes.js' });
    const second = await provider.text({ library: 'reveal.js', path: 'dist/plugin/notes.js' });
    assert.ok(first?.includes('RevealNotes'));
    assert.equal(first, second);
    assert.deepEqual(calls, ['../../node_modules/reveal.js/dist/plugin/notes.js']);
    assert.equal(await provider.text({ library: 'reveal.js', path: 'dist/plugin/math.js' }), undefined);
    assert.equal(await provider.text({ library: 'katex', path: 'dist/fonts/KaTeX_Main-Regular.woff2' }), undefined);
    assert.deepEqual([...(await provider.bytes({ library: 'katex', path: 'dist/fonts/KaTeX_Main-Regular.woff2' }))!], [0x77, 0x4f, 0x46, 0x32]);
    await provider.bytes({ library: 'katex', path: 'dist/fonts/KaTeX_Main-Regular.woff2' });
    assert.equal(await provider.bytes({ library: 'katex', path: 'dist/fonts/KaTeX_Main-Regular.ttf' }), undefined);
    assert.deepEqual(fetched, ['/_astro/KaTeX_Main-Regular.abc.woff2']);
  });

  it('retries a file whose chunk failed to load', async () => {
    const { provider, calls } = sources(new Set(['dist/katex.min.js']));
    await assert.rejects(provider.text({ library: 'katex', path: 'dist/katex.min.js' }), /chunk failed/);
    assert.ok((await provider.text({ library: 'katex', path: 'dist/katex.min.js' }))?.includes('katex'));
    assert.equal(calls.length, 2);
  });

  it('reads library files from module paths', () => {
    assert.deepEqual(vendorFileFromModulePath('/node_modules/reveal.js/dist/reveal.js?raw'), { library: 'reveal.js', path: 'dist/reveal.js' });
    assert.deepEqual(vendorFileFromModulePath('C:\\site\\node_modules\\katex\\dist\\katex.min.css'), { library: 'katex', path: 'dist/katex.min.css' });
    assert.equal(vendorFileFromModulePath('../../node_modules/reveal.js/package.json'), undefined);
    assert.equal(vendorFileFromModulePath('../../src/lib/deck-vendor.ts'), undefined);
  });
});
