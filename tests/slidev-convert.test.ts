import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import vm from 'node:vm';
import { strToU8, zipSync } from 'fflate';
import { readDeckArchive } from '../src/lib/deck-archive.ts';
import { detectDeck } from '../src/lib/deck-detect.ts';
import { buildPlayable, isPlayable, openDeck } from '../src/lib/deck-project.ts';
import { formatDeckReport } from '../src/lib/deck-report.ts';
import { scanModuleImports } from '../src/lib/deck-linker-modules.ts';
import {
  SLIDEV_CONVERT_LIMITS, convertSlidevFiles, type SlidevBundleRequest, type SlidevBundler, type SlidevConvertStep,
} from '../src/lib/slidev-convert.ts';
import type { DeckFiles, DeckIssue } from '../src/lib/deck-types.ts';
import {
  filesFromFolder, nodeSlidevBundler, nodeSlidevConverter, researchMonacoBuild, researchSlidevBuilds, slidevFixtureFile,
} from './helpers/slidev-node.ts';

const codes = (issues: DeckIssue[]) => issues.map((issue) => issue.code);
const severities = (issues: DeckIssue[], severity: DeckIssue['severity']) => issues.filter((issue) => issue.severity === severity);

function deck(files: Record<string, string | Uint8Array>): DeckFiles {
  return new Map(Object.entries(files).map(([path, data]) => [path, typeof data === 'string' ? strToU8(data) : data]));
}

/** index.html as Slidev writes it: the version meta, one module entry, a stylesheet. */
function page({ head = '', body = '', base = '/' } = {}): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Waves - Slidev</title>`
    + `<meta property="slidev:version" content="53.1.0">${head}`
    + `<script type="module" crossorigin src="${base}assets/index-abc.js"></script>`
    + `<link rel="stylesheet" crossorigin href="${base}assets/index-abc.css"></head><body><div id="app"></div>${body}</body></html>`;
}

const MAP_DEPS = 'const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/slide-1.js","assets/slide-1.css","assets/late.css"])))=>i.map(i=>d[i]);';
const ENTRY = `${MAP_DEPS}import{c as createRouter}from"./vue-abc.js";`
  + 'const F=(e,t)=>e();const routes=[{path:"/1",component:()=>F(()=>import(`./slide-1.js`),__vite__mapDeps([0,1,2]))}];'
  + 'export const router=createRouter({history:ue(`/`),routes:routes});';

function smallBuild(extra: Record<string, string | Uint8Array> = {}): DeckFiles {
  return deck({
    'index.html': page(),
    'assets/index-abc.js': ENTRY,
    'assets/vue-abc.js': 'export function c(options){return options}export function ue(base){return base}',
    'assets/slide-1.js': 'export default {name:"Slide 1",logo:`/assets/logo-abc.png`}',
    'assets/index-abc.css': 'body{margin:0}',
    'assets/slide-1.css': '.slide-1{color:red}',
    'assets/late.css': '.late{color:blue}',
    'assets/logo-abc.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]),
    ...extra,
  });
}

/** A bundler that records what it was given and returns a marker script. */
function recorder(): { bundler: SlidevBundler; requests: SlidevBundleRequest[] } {
  const requests: SlidevBundleRequest[] = [];
  return { requests, bundler: async (request) => { requests.push(request); return 'window.bundled=1'; } };
}

async function convert(files: DeckFiles, bundler: SlidevBundler = nodeSlidevBundler, options = {}) {
  const detection = detectDeck(files);
  assert.equal(detection.kind, 'slidev-build');
  return convertSlidevFiles(files, detection, bundler, options);
}

/** Pattern checks that name the pattern, not the megabytes of text they ran on. */
const has = (text: string, pattern: RegExp, message = `expected ${pattern}`) => assert.ok(pattern.test(text), message);
const lacks = (text: string, pattern: RegExp, message = `unexpected ${pattern}`) => assert.ok(!pattern.test(text), message);
const scripts = (html: string) => [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);

describe('converting the ordinary Slidev build fixture', () => {
  it('makes one self-contained document with every patch applied', async () => {
    const { files } = await readDeckArchive(slidevFixtureFile());
    const steps: SlidevConvertStep[] = [];
    const result = await convert(files, nodeSlidevBundler, { onProgress: (step: SlidevConvertStep) => steps.push(step) });
    assert.deepEqual(severities(result.issues, 'error'), []);
    assert.deepEqual(severities(result.issues, 'warning'), []);
    // Each remote link left out is named once: the Google Fonts stylesheet and the favicon.
    assert.deepEqual(codes(result.issues), ['external-font', 'external-icon']);
    assert.match(result.issues[0].message, /fonts\.googleapis\.com/);
    assert.match(result.issues[1].message, /cdn\.jsdelivr\.net/);
    assert.deepEqual(steps, ['bundling']);
    assert.deepEqual(result.stats, {
      root: '', base: '/', entryModule: 'assets/index-BwoNhELd.js', modules: 31, stylesheets: 12, embeddedAssets: 20,
      preloadPatched: 3, routerPatched: 1, dynamicImports: 15, htmlLength: result.html.length,
    });
    const { html } = result;
    assert.ok(html.length < 2 * 1024 * 1024, 'about 1.2 MB, far below the player limit');
    has(html, /^<!doctype html><html lang="en"><head><meta charset="utf-8">/);
    has(html, /<title>Quantum interference - Slidev<\/title>/);
    // The markup itself loads nothing: no script files, links or modules, and no remote address.
    const markup = html.replace(/<script>[\s\S]*?<\/script>|<style[^>]*>[\s\S]*?<\/style>/g, '');
    lacks(markup, /<script[^>]+src=|<link\b|type="module"|https?:/);
    lacks(html, /fonts\.googleapis/);
    lacks(html, /__vite__mapDeps=\(i/, 'the preload helper has nothing to load');
    has(html, /createHref:function\([\w$]+\)\{return"#"\+[\w$]+\}/, 'the router keeps its history in memory');
    has(html, /delete Navigator\.prototype\.wakeLock/);
    has(html, /data:image\/png;base64,/, 'the logo is embedded where the build addresses it');
    lacks(html, /\/assets\/logo-BYkHSa_O\.png/);
    assert.equal((html.match(/data:font\/woff2;base64,/g) ?? []).length, 20, 'one woff2 per KaTeX font: 19 embedded here, one inlined by Vite');
    lacks(html, /data:font\/(?:woff|ttf);|\.ttf\b/, 'woff and ttf copies are not embedded');
    assert.equal((html.match(/<style data-qft-from=/g) ?? []).length, 12);
    assert.ok(html.indexOf('data-qft-from="assets/index-BEw3wKFc.css"') < html.indexOf('data-qft-from="assets/md-BwoDRu5r.css"'), 'page styles first');
    const [prelude, bundle] = scripts(html);
    assert.match(prelude, /wakeLock/);
    assert.equal(scanModuleImports(bundle).imports.length, 0, 'no import is left in the bundle');
    has(bundle, /Symbol\.toStringTag\]!=="Module"/, 'import() results stay recognisable as modules');
    has(html, /<div id="app"><\/div>\s*<div id="mermaid-rendering-container"><\/div>/);
  });

  it('gives the same document every time', async () => {
    const { files } = await readDeckArchive(slidevFixtureFile());
    const first = await convert(files);
    const second = await convert(new Map(files));
    assert.equal(first.html, second.html);
  });

  it('can be stopped', async () => {
    const { files } = await readDeckArchive(slidevFixtureFile());
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(convert(files, nodeSlidevBundler, { signal: controller.signal }), { name: 'AbortError' });
  });
});

describe('Slidev builds from the research', () => {
  const builds = researchSlidevBuilds();
  it('converts every router and base-path variant and the Slidev 52 build without warnings', { skip: builds.length ? false : 'QFT_SLIDEV_BUILDS is not set' }, async () => {
    for (const { name, folder } of builds) {
      const result = await convert(filesFromFolder(folder));
      assert.deepEqual(severities(result.issues, 'error'), [], name);
      assert.deepEqual(severities(result.issues, 'warning'), [], name);
      assert.equal(result.stats.routerPatched, 1, name);
      assert.ok(result.stats.preloadPatched > 0 && result.stats.dynamicImports > 0, name);
      assert.ok(result.html.length > 1_000_000, name);
      const bundle = scripts(result.html).at(-1)!;
      assert.equal(scanModuleImports(bundle).imports.length, 0, name);
      const markup = result.html.replace(/<script>[\s\S]*?<\/script>|<style[^>]*>[\s\S]*?<\/style>/g, '');
      assert.doesNotMatch(markup, /<script[^>]+src=|<link\b|https?:/, name);
    }
  });

  const monaco = researchMonacoBuild();
  it('refuses the official template build with one error, naming Monaco', { skip: monaco ? false : 'QFT_SLIDEV_MONACO_BUILD is not set' }, async () => {
    const result = await convert(filesFromFolder(monaco!));
    assert.equal(result.html, '');
    // Monaco's own Web Workers and size are the same cause: no second or third error.
    assert.deepEqual(codes(result.issues), ['slidev-monaco-unsupported']);
    assert.match(result.issues[0].message, /Monaco code editor/);
  });
});

describe('each conversion step', () => {
  it('switches off preloading, keeps the router in memory, embeds asset strings and wraps import()', async () => {
    const { bundler, requests } = recorder();
    const result = await convert(smallBuild(), bundler);
    assert.deepEqual(result.issues, []);
    const [request] = requests;
    assert.equal(request.entry, 'assets/index-abc.js');
    const entry = request.modules.get('assets/index-abc.js')!;
    assert.match(entry, /^const __vite__mapDeps=\(\)=>\[\];/);
    assert.match(entry, /history:\(function\(base\)\{/);
    assert.match(entry, /\(import\(`\.\/slide-1\.js`\)\)\.then\(function\(m\)/);
    assert.match(request.modules.get('assets/slide-1.js')!, /logo:"data:image\/png;base64,iVBORwECAw=="/);
    assert.equal(request.resolve('./vue-abc.js', 'assets/index-abc.js'), 'assets/vue-abc.js');
    assert.equal(request.resolve('/assets/slide-1.js', 'assets/index-abc.js'), 'assets/slide-1.js');
    assert.equal(request.resolve('vue', 'assets/index-abc.js'), undefined, 'bare names are not part of a build');
    assert.equal(request.resolve('../../outside.js', 'assets/index-abc.js'), undefined);
    // Page styles, then the code-split ones in the order the preload list names them.
    assert.deepEqual([...result.html.matchAll(/data-qft-from="([^"]+)"/g)].map((match) => match[1]),
      ['assets/index-abc.css', 'assets/slide-1.css', 'assets/late.css']);
    assert.match(result.html, /<script>window\.bundled=1<\/script><\/body><\/html>$/);
  });

  it('keeps the in-memory history that vue-router expects', async () => {
    const { bundler, requests } = recorder();
    await convert(smallBuild(), bundler);
    const source = /history:\((function\(base\)\{[\s\S]*?return history\})\)\(`\/`\)/.exec(requests[0].modules.get('assets/index-abc.js')!)![1];
    const history = vm.runInNewContext(`(${source})("/")`);
    const heard: unknown[] = [];
    assert.equal(history.location, '');
    assert.equal(history.base, '');
    history.listen((to: string, from: string, info: { delta: number; direction: string }) => heard.push([to, from, info.delta, info.direction]));
    history.push('/1');
    history.push('/2', { position: 2 });
    assert.equal(history.location, '/2');
    assert.equal(history.state.position, 2);
    history.replace('/3');
    assert.equal(history.location, '/3');
    history.go(-1);
    assert.equal(history.location, '/1');
    history.go(1, false);
    assert.equal(history.location, '/3');
    assert.deepEqual(heard, [['/1', '/3', -1, 'back']]);
    assert.equal(history.createHref('/2'), '#/2');
    history.destroy();
    assert.equal(history.location, '');
  });

  it('bundles import() so that results are tagged as modules, as Vue and vue-router expect', async () => {
    const files = smallBuild({
      'assets/index-abc.js': `${MAP_DEPS}import(\`./slide-1.js\`).then((m)=>{globalThis.result=[m[Symbol.toStringTag],m.default.name]});const x={history:ue(\`/\`),routes:[]};function ue(b){return b}`,
    });
    const result = await convert(files);
    assert.deepEqual(severities(result.issues, 'warning'), []);
    const context: { result?: unknown[] } = {};
    vm.runInNewContext(scripts(result.html).at(-1)!, context);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual([...context.result!], ['Module', 'Slide 1']);
  });

  it('turns new URL(…, import.meta.url) into data: URIs and reports files that are missing', async () => {
    const { bundler, requests } = recorder();
    const result = await convert(smallBuild({
      'index.html': page({ base: './' }),
      'assets/slide-1.js': 'export const a=new URL(`../logo-abc.png`,import.meta.url).href,b=new URL("../gone.png",import.meta.url).href;',
      'logo-abc.png': new Uint8Array([1, 2, 3]),
    }), bundler);
    const slide = requests[0].modules.get('assets/slide-1.js')!;
    assert.match(slide, /a="data:image\/png;base64,AQID"/);
    assert.match(slide, /b=new URL\("\.\.\/gone\.png",import\.meta\.url\)\.href/);
    assert.deepEqual(codes(result.issues), ['missing-file']);
    assert.match(result.issues[0].message, /gone\.png/);
  });

  it('names a picture that the slides show but the build does not contain', async () => {
    // Slidev writes <img src="/red.png"> and ![](/red.png) of public/ pictures as base-addressed strings.
    const { bundler, requests } = recorder();
    const result = await convert(smallBuild({
      'assets/slide-1.js': 'export default [`/assets/logo-abc.png`,"/red.png",\'/red.png\',"/pictures/blue.svg","icon.png",".ico","https://example.org/x.png"]',
    }), bundler);
    assert.deepEqual(codes(result.issues), ['missing-file']);
    assert.equal(result.issues[0].severity, 'warning');
    assert.equal(result.issues[0].where, '/pictures/blue.svg');
    assert.match(result.issues[0].message, /not in the ZIP, so they will not show: \/pictures\/blue\.svg, \/red\.png\. Put them in the Slidev project's public folder/);
    assert.ok(result.html, 'the rest of the presentation still plays');
    assert.match(requests[0].modules.get('assets/slide-1.js')!, /^export default \["data:image\/png;base64,[^"]+","\/red\.png"/);
  });

  it('resolves a build made for a sub-path (--base /talk/)', async () => {
    const { bundler, requests } = recorder();
    const result = await convert(deck({
      'dist/index.html': page({ base: '/talk/' }),
      'dist/assets/index-abc.js': ENTRY.replace('import{c as createRouter}from"./vue-abc.js";', 'import{c as createRouter}from"/talk/assets/vue-abc.js";').replace('ue(`/`)', 'ue(`/talk/`)'),
      'dist/assets/vue-abc.js': 'export function c(o){return o}',
      'dist/assets/slide-1.js': 'export default "/talk/assets/logo-abc.png"',
      'dist/assets/index-abc.css': '.a{background:url(/talk/assets/logo-abc.png)}',
      'dist/assets/slide-1.css': '', 'dist/assets/late.css': '',
      'dist/assets/logo-abc.png': new Uint8Array([7]),
      'slides.md': '# Talk',
    }), bundler);
    assert.deepEqual(severities(result.issues, 'warning'), []);
    assert.equal(result.stats.root, 'dist/');
    assert.equal(result.stats.base, '/talk/');
    assert.equal(requests[0].entry, 'dist/assets/index-abc.js');
    assert.equal(requests[0].resolve('/talk/assets/vue-abc.js', 'dist/assets/index-abc.js'), 'dist/assets/vue-abc.js');
    assert.match(requests[0].modules.get('dist/assets/slide-1.js')!, /"data:image\/png;base64,Bw=="/);
    assert.match(result.html, /\.a\{background:url\("data:image\/png;base64,Bw=="\)\}/);
    assert.match(requests[0].modules.get('dist/assets/index-abc.js')!, /history:\(function\(base\)\{[\s\S]*\}\)\(`\/talk\/`\)/);
  });

  it('embeds only the woff2 copy of a font, and other url() assets, and drops remote ones with a note', async () => {
    const result = await convert(smallBuild({
      'assets/index-abc.css': '@import url(https://fonts.googleapis.com/css2?family=Lora);'
        + '@font-face{font-family:K;src:url(K.woff2) format("woff2"),url(K.woff) format("woff"),url(K.ttf) format("truetype")}'
        + '@font-face{font-family:T;src:url(T.ttf) format("truetype")}'
        // Vite inlines a small font itself; its data: URI holds semicolons.
        + '@font-face{font-family:V;src:url(data:font/woff2;base64,AAAA)format("woff2"),url(K.woff)format("woff")}'
        + '.a{background:url("./logo-abc.png")}.b{background:url(https://example.org/x.png)}.c{background:url(missing.png)}',
      'assets/K.woff2': new Uint8Array([1]), 'assets/K.woff': new Uint8Array([2]), 'assets/T.ttf': new Uint8Array([3]),
    }), recorder().bundler);
    const css = /<style data-qft-from="assets\/index-abc\.css">([\s\S]*?)<\/style>/.exec(result.html)![1];
    assert.match(css, /src:url\("data:font\/woff2;base64,AQ=="\) format\("woff2"\)\}/);
    assert.doesNotMatch(css, /K\.woff\b|K\.ttf|font\/woff;/);
    assert.match(css, /font-family:T;src:url\("data:font\/ttf;base64,Aw=="\)/, 'a font without a woff2 copy keeps what it has');
    assert.match(css, /font-family:V;src:url\(data:font\/woff2;base64,AAAA\)format\("woff2"\)\}/);
    assert.match(css, /\.a\{background:url\("data:image\/png;base64,/);
    assert.match(css, /\.b\{background:none\}\.c\{background:none\}/);
    assert.doesNotMatch(css, /@import|googleapis/);
    assert.deepEqual(codes(result.issues).sort(), ['external-css-asset', 'external-font', 'missing-file']);
    assert.match(result.issues.find((issue) => issue.code === 'external-css-asset')!.message, /example\.org/);
    assert.match(result.issues.find((issue) => issue.code === 'missing-file')!.message, /assets\/missing\.png/);
  });

  it('leaves out remote scripts and links with a note each, and keeps the page’s own markup', async () => {
    const result = await convert(smallBuild({
      'index.html': page({
        head: '<link rel="icon" href="https://cdn.jsdelivr.net/gh/slidevjs/slidev/assets/favicon.png"><link rel="preload" as="image" href="https://cover.sli.dev"><link rel="stylesheet" href="https://example.org/theme.css"><script>window.inline=1</script>',
        body: '<script async src="https://platform.twitter.com/widgets.js"></script><div id="extra" class="note"><img src="/assets/logo-abc.png" alt="Logo"></div>',
      }),
    }), recorder().bundler);
    assert.deepEqual(codes(result.issues), ['external-icon', 'external-image', 'external-stylesheet', 'external-script']);
    assert.match(result.issues[3].message, /platform\.twitter\.com/);
    assert.equal(severities(result.issues, 'error').length, 0);
    assert.match(result.html, /<div id="extra" class="note"><img src="data:image\/png;base64,[^"]+" alt="Logo"><\/div>/);
    assert.doesNotMatch(result.html, /twitter|cover\.sli\.dev|example\.org/);
    assert.deepEqual(scripts(result.html).slice(1), ['window.inline=1', 'window.bundled=1'], 'inline classic scripts run before the app');
  });

  it('reports each patch whose pattern is not found instead of failing silently', async () => {
    const result = await convert(smallBuild({
      // An unknown preload helper shape and no router call.
      'assets/index-abc.js': 'const __vite__mapDeps=(i)=>i.map(x=>L[x]);const routes=[()=>import("./slide-1.js")];',
    }), recorder().bundler);
    assert.deepEqual(codes(result.issues), ['slidev-preload-unpatched', 'slidev-router-unpatched']);
    assert.ok(result.issues.every((issue) => issue.severity === 'warning'));
    assert.match(result.issues[0].message, /assets\/index-abc\.js/);
    assert.ok(result.html, 'a warning does not stop playback');

    const older = await convert(smallBuild({ 'assets/index-abc.js': 'const r={history:ue(`/`),routes:[]};P(()=>import("./slide-1.js"),["assets/slide-1.js","assets/slide-1.css"]);' }), recorder().bundler);
    assert.deepEqual(codes(older.issues), ['slidev-preload-unpatched'], 'a preload list written inline, which an older Vite emits');
    assert.match(older.issues[0].message, /older Slidev/);

    // modulePreload: false (the site's own starter): no dependency lists, so nothing to switch off and no note.
    for (const call of ['P(()=>import(`./slide-1.js`),[])', 'import("./slide-1.js")', 'P(async()=>{await import(`./slide-1.js`)},[])']) {
      const current = await convert(smallBuild({ 'assets/index-abc.js': `const r={history:ue(\`/\`),routes:[]};${call};` }), recorder().bundler);
      assert.deepEqual(codes(current.issues), [], call);
    }

    const unstyled = await convert(deck({
      'index.html': page().replace(/<link rel="stylesheet"[^>]*>/, ''),
      'assets/index-abc.js': 'const r={history:ue(`/`),routes:[]};',
    }), recorder().bundler);
    assert.deepEqual(codes(unstyled.issues), ['slidev-no-styles']);
  });

  it('refuses a Monaco build with one error, not also for its Web Workers and size', async () => {
    const result = await convert(smallBuild({
      'assets/monaco/editor.main-abc.js': 'export default 1',
      'assets/editor.worker-AbCd1234.js': 'self.onmessage=()=>{}',
      'assets/slide-1.js': 'export default ()=>new Worker(new URL(`/assets/editor.worker-AbCd1234.js`,``+import.meta.url))',
      'assets/huge-abc.js': new Uint8Array(SLIDEV_CONVERT_LIMITS.scriptBytes + 1),
    }), recorder().bundler);
    assert.equal(result.html, '');
    assert.deepEqual(codes(result.issues), ['slidev-monaco-unsupported']);
    assert.match(result.issues[0].message, /Monaco code editor[\s\S]*monaco: false[\s\S]*then open a new ZIP of the project \(with dist\/ inside\)\.$/);
  });

  it('refuses builds that use Web Workers, with the files named', async () => {
    const result = await convert(smallBuild({
      'assets/slide-1.js': 'export default ()=>new Worker(new URL(`/assets/ts.worker-AbCd1234.js`,``+import.meta.url),{type:`module`})',
      'assets/ts.worker-AbCd1234.js': 'self.onmessage=()=>{}',
    }), recorder().bundler);
    assert.equal(result.html, '');
    assert.deepEqual(codes(result.issues), ['slidev-workers-unsupported']);
    assert.match(result.issues[0].message, /background workers \(assets\/ts\.worker-AbCd1234\.js, assets\/slide-1\.js\)/);
  });

  it('refuses builds whose scripts cannot fit, and results beyond the player’s limit', async () => {
    const huge = await convert(smallBuild({ 'assets/huge-abc.js': new Uint8Array(SLIDEV_CONVERT_LIMITS.scriptBytes + 1) }), recorder().bundler);
    assert.equal(huge.html, '');
    assert.deepEqual(codes(huge.issues), ['slidev-build-too-large']);
    assert.match(huge.issues[0].message, /The largest are assets\/huge-abc\.js \(24\.0 MB\)/);

    const limited = await convert(smallBuild(), recorder().bundler, { maxHtmlLength: 500 });
    assert.equal(limited.html, '');
    assert.deepEqual(codes(limited.issues), ['deck-too-large']);
    assert.equal(limited.stats.htmlLength > 500, true);
  });

  it('explains a build whose index.html has no app script, or whose scripts cannot be combined', async () => {
    const noEntry = await convert(deck({
      'index.html': page().replace(/<script[^>]*><\/script>/, '<script type="module" src="/assets/gone.js"></script>'),
      'assets/index-abc.js': '', 'assets/index-abc.css': '', 'assets/slidev/x.js': '',
    }), recorder().bundler);
    assert.equal(noEntry.html, '');
    assert.deepEqual(codes(noEntry.issues), ['script-left-out', 'slidev-entry-missing']);

    const broken = await convert(smallBuild({ 'assets/index-abc.js': `${ENTRY}import"./not-there.js";` }));
    assert.equal(broken.html, '');
    assert.deepEqual(codes(broken.issues), ['slidev-bundle-failed']);
    assert.match(broken.issues[0].message, /not-there\.js, which is not in the build/);
    // The advice is given once (VF4.4), in the words of the Slidev prompt (VF4.7).
    assert.equal(broken.issues[0].message.match(/build again|open a/gi)?.length, 2, broken.issues[0].message);
    assert.match(broken.issues[0].message, /which is not in the build\. Build again with "npx slidev build", then open a new ZIP of the project \(with dist\/ inside\)\.$/);

    const wrongKind = await convertSlidevFiles(smallBuild(), { kind: 'reveal', entry: 'index.html', issues: [], flags: {} }, recorder().bundler);
    assert.deepEqual(codes(wrongKind.issues), ['slidev-entry-missing']);
  });
});

describe('the Slidev release a build names', () => {
  const LIST_51 = 'This presentation was built with Slidev 51.8.2. The player is checked with Slidev 52 and 53. A Slidev 51 build can show Slidev\'s own list of slides at the top right of every slide. If you see it, ask your AI assistant to change "@slidev/cli" in package.json to "^52.0.0" or newer, then run npm install and npx slidev build and send the new ZIP.';
  const OLDER = 'This presentation was built with Slidev 0.50.0, which is older than the releases the player is checked with (Slidev 52 and 53). If the slides look wrong, ask your AI assistant to change "@slidev/cli" in package.json to "^52.0.0" or newer, then run npm install and npx slidev build and send the new ZIP.';

  /** The fixture build (53.1.0) with its slidev:version meta rewritten, or removed for undefined. */
  async function fixtureNaming(version?: string): Promise<DeckFiles> {
    const { files } = await readDeckArchive(slidevFixtureFile());
    const index = new TextDecoder().decode(files.get('index.html'));
    const meta = '<meta property="slidev:version" content="53.1.0">';
    assert.ok(index.includes(meta));
    const rewritten = new Map(files);
    rewritten.set('index.html', strToU8(index.replace(meta, version === undefined ? '' : `<meta property="slidev:version" content="${version}">`)));
    return rewritten;
  }
  const notes = (files: DeckFiles) => detectDeck(files).issues.filter((issue) => issue.code === 'slidev-old-version');

  it('notes a Slidev 51 build, with the go-to list that such a build can show', async () => {
    const [note, ...more] = notes(await fixtureNaming('51.8.2'));
    assert.deepEqual(more, []);
    assert.equal(note.severity, 'warning', 'it still plays');
    assert.equal(note.message, LIST_51);
    assert.equal(note.where, 'index.html');
  });

  it('notes an older build without the sentence about the list, which was not measured', async () => {
    const [note, ...more] = notes(await fixtureNaming('0.50.0'));
    assert.deepEqual(more, []);
    assert.equal(note.severity, 'warning');
    assert.equal(note.message, OLDER);
    assert.equal(notes(await fixtureNaming('51.0.0-beta.2')).length, 1, 'a pre-release of 51 is 51');
  });

  it('gives no note for Slidev 52 and newer, nor for a build that names no release', async () => {
    for (const version of ['52.20.1', '53.1.0', '52.0.0-beta.1', undefined]) assert.deepEqual(notes(await fixtureNaming(version)), [], String(version));
  });

  it('ignores a malformed or hostile release, which never reaches any output', async () => {
    for (const version of ['51<script>', `51.${'1'.repeat(5000)}.0`, '51.8.2‮', '51.8.2-x_y', '51.8', ' 51.8.2 x', '51.8.2-', '51.8.2-<b>']) {
      const files = await fixtureNaming(version);
      const detection = detectDeck(files);
      assert.deepEqual(notes(files), [], version.slice(0, 40));
      assert.equal(detection.engineVersion, undefined, version.slice(0, 40));
      const report = formatDeckReport({ kind: 'slidev-build', engine: 'slidev', entry: 'index.html', issues: detection.issues });
      for (const output of [JSON.stringify(detection), report]) assert.ok(!output.includes(version), version.slice(0, 40));
    }
  });

  it('carries the note into the playable deck and the report for AI, and the deck still plays', async () => {
    const files = await fixtureNaming('51.8.2');
    const project = await openDeck(new File([new Uint8Array(zipSync(Object.fromEntries(files))).buffer], 'old.zip', { type: 'application/zip' }));
    assert.ok(project);
    const playable = await buildPlayable(project, { vendor: () => { throw new Error('a Slidev build needs no vendor files'); }, convertSlidev: nodeSlidevConverter() });
    assert.ok(isPlayable(playable));
    assert.deepEqual(playable.issues.filter((issue) => issue.code === 'slidev-old-version').map((issue) => issue.message), [LIST_51]);
    const report = formatDeckReport({ kind: project.kind, engine: project.engine, engineVersion: project.detection.engineVersion, entry: project.entry, issues: playable.issues });
    assert.match(report, /^engine: slidev 51\.8\.2$/m);
    assert.match(report, /^result: plays, with notes$/m);
    assert.ok(report.includes(`- warning slidev-old-version (index.html): ${LIST_51}`));
    assert.match(report, /^Reply: fix the notes above in the Slidev project, run "npx slidev build" again/m);
  });
});
