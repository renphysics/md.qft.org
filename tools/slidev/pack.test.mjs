import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { unzipSync, strFromU8 } from 'fflate';
import { parse as parseHtml } from 'parse5';
import { init, parse as parseImports } from 'es-module-lexer';
import { packageSlidev } from './pack.mjs';

async function fixture(t) {
  const directory = await mkdtemp(resolve(tmpdir(), 'qft-slidev-package-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const dist = resolve(directory, 'dist');
  const source = resolve(directory, 'source');
  await mkdir(resolve(dist, 'assets'), { recursive: true });
  await mkdir(source);
  await writeFile(resolve(source, 'slides.md'), '# Source kept verbatim\n');
  await writeFile(resolve(source, 'package.json'), '{"name":"fixture"}\n');
  const html = '<!doctype html><html><head><link rel="stylesheet" href="/assets/style.css"><script type="module" src="/assets/main.js"></script></head><body><div id="app"></div></body></html>';
  await writeFile(resolve(dist, 'index.html'), html);
  await writeFile(resolve(dist, 'assets/style.css'), 'body{color:red;background-image:url("./pixel.png")}');
  await writeFile(resolve(dist, 'assets/pixel.png'), new Uint8Array([137, 80, 78, 71]));
  await writeFile(resolve(dist, 'assets/main.js'), 'import {title} from "./title.js"; globalThis.title=title; import("./lazy.js").then(m=>globalThis.answer=m.answer);');
  await writeFile(resolve(dist, 'assets/title.js'), 'export const title="An actual bundled module";');
  await writeFile(resolve(dist, 'assets/lazy.js'), 'export const answer=42;');
  return { directory, dist, source, out: resolve(directory, 'lesson.zip'), title: 'A lesson' };
}
function descendants(node) { return [node, ...(node.childNodes ?? []).flatMap(descendants)]; }

test('bundles module and lazy-import graphs, embeds CSS assets, and preserves source', async t => {
  await init;
  const input = await fixture(t);
  const result = await packageSlidev(input);
  assert.equal(result.out, input.out);
  const files = unzipSync(new Uint8Array(await readFile(input.out)));
  const html = strFromU8(files['presentation.html']);
  const manifest = JSON.parse(strFromU8(files['qft-presentation.json']));
  assert.equal(manifest.engine, 'slidev');
  assert.equal(manifest.source, 'source/slides.md');
  assert.equal(strFromU8(files['source/slides.md']), '# Source kept verbatim\n');
  assert.match(html, /data:image\/png;base64,iVBORw==/);
  const nodes = descendants(parseHtml(html));
  assert.ok(!nodes.some(node => node.tagName === 'link'));
  const scripts = nodes.filter(node => node.tagName === 'script');
  assert.equal(scripts.length, 2);
  for (const script of scripts) {
    assert.ok(!script.attrs.some(attr => attr.name === 'src'));
    assert.equal(parseImports(script.childNodes.map(child => child.value ?? '').join(''))[0].length, 0);
  }
  assert.match(html, /An actual bundled module/);
});

test('bundled dynamic imports retain module identity for Vue async slide components', async t => {
  const input = await fixture(t);
  await writeFile(resolve(input.dist, 'assets/main.js'), `
    globalThis.ready = Promise.all([import('./lazy.js'), import(\`./lazy.js\`)]).then(([first, second]) => {
      globalThis.first = first;
      globalThis.second = second;
      globalThis.component = first && (first.__esModule || first[Symbol.toStringTag] === 'Module') ? first.default : first;
    });
  `);
  await writeFile(resolve(input.dist, 'assets/lazy.js'), 'export default {name:"ActualSlide",render:()=>"Slide content"};');
  await packageSlidev(input);
  const files = unzipSync(new Uint8Array(await readFile(input.out)));
  const scripts = descendants(parseHtml(strFromU8(files['presentation.html']))).filter(node => node.tagName === 'script');
  const code = scripts.at(-1).childNodes.map(child => child.value ?? '').join('');
  const context = {};
  runInNewContext(code, context);
  await context.ready;
  assert.equal(Object.prototype.toString.call(context.first), '[object Module]');
  assert.equal(context.first, context.second, 'Repeated imports must preserve the module namespace identity');
  assert.equal(context.component.name, 'ActualSlide');
  assert.equal(context.component.render(), 'Slide content');
});

test('remote stylesheet and missing assets give actionable failures', async t => {
  const input = await fixture(t);
  await writeFile(resolve(input.dist, 'assets/style.css'), 'body{background:url("https://example.com/image.png")}');
  await assert.rejects(packageSlidev(input), /External asset cannot be packaged/);
  await writeFile(resolve(input.dist, 'assets/style.css'), 'body{background:url("./missing.png")}');
  await assert.rejects(packageSlidev(input), /Missing built asset/);
});

test('a computed dynamic import is rejected instead of leaving a broken portable deck', async t => {
  const input = await fixture(t);
  await writeFile(resolve(input.dist, 'assets/main.js'), 'globalThis.load = path => import(path);');
  await assert.rejects(packageSlidev(input), /still contains imports/);
});

test('assets cannot escape the build directory and source symlinks are rejected', async t => {
  const input = await fixture(t);
  await writeFile(resolve(input.directory, 'outside.png'), 'outside');
  await writeFile(resolve(input.dist, 'assets/style.css'), 'body{background:url("../../outside.png")}');
  await assert.rejects(packageSlidev(input), /escapes the build directory/);
  await writeFile(resolve(input.dist, 'assets/style.css'), 'body{color:red}');
  await symlink(resolve(input.directory, 'outside.png'), resolve(input.source, 'linked.png'));
  await assert.rejects(packageSlidev(input), /Source symlinks are not supported/);
});

test('built JavaScript cannot import files outside its distribution directory', async t => {
  const input = await fixture(t);
  await writeFile(resolve(input.directory, 'outside.js'), 'export const secret="private";');
  await writeFile(resolve(input.dist, 'assets/main.js'), 'import {secret} from "../../outside.js";globalThis.value=secret;');
  await assert.rejects(packageSlidev(input), /escapes the build directory/);
});

test('source limits and Unicode filename collisions match the browser importer', async t => {
  const input = await fixture(t);
  const bigFile = resolve(input.source, 'too-large.png');
  await writeFile(bigFile, '');
  await truncate(bigFile, 40 * 1024 * 1024 + 1);
  await assert.rejects(packageSlidev(input), /File exceeds 40 MiB/);
  await rm(bigFile);
  await writeFile(resolve(input.source, 'R\u00e9sum\u00e9.vue'), '<template>A</template>');
  await writeFile(resolve(input.source, 'Re\u0301sume\u0301.vue'), '<template>B</template>');
  await assert.rejects(packageSlidev(input), /Ambiguous source filename/);
});

test('invalid title and non-Markdown source entries cannot produce unusable packages', async t => {
  const input = await fixture(t);
  await assert.rejects(packageSlidev({ ...input, title: '  ' }), /title of 1–200 characters/);
  await assert.rejects(packageSlidev({ ...input, title: 'A\u0000lesson' }), /without control characters/);
  await assert.rejects(packageSlidev({ ...input, sourceEntry: 'component.vue' }), /Markdown/);
});

test('notices are preserved in the ZIP and compiled HTML as escaped inert text', async t => {
  const input = await fixture(t);
  const license = 'A project license\n</template><script>globalThis.injected=true</script><!-- --> & text';
  await writeFile(resolve(input.source, 'LICENSE'), license);
  await packageSlidev(input);
  const files = unzipSync(new Uint8Array(await readFile(input.out)));
  const notices = strFromU8(files['THIRD_PARTY_NOTICES.txt']);
  assert.match(notices, /MIT License/);
  assert.ok(notices.includes(license));
  const html = strFromU8(files['presentation.html']);
  const nodes = descendants(parseHtml(html));
  const template = nodes.find(node => node.tagName === 'template' && node.attrs.some(attr => attr.name === 'data-qft-presentation-notices'));
  assert.ok(template);
  assert.equal(template.content.childNodes.length, 1);
  assert.equal(template.content.childNodes[0].nodeName, '#text');
  assert.equal(template.content.childNodes[0].value, notices);
  assert.equal(nodes.filter(node => node.tagName === 'script').length, 2, 'License text must not create an executable script');
  assert.match(html, /&lt;\/template&gt;&lt;script&gt;/);
});

test('dependencies, generated folders and existing archives are excluded from editable source', async t => {
  const input = await fixture(t);
  for (const name of ['node_modules', '.build', 'dist']) {
    await mkdir(resolve(input.source, name));
    await writeFile(resolve(input.source, name, 'generated.js'), 'unwanted');
  }
  await writeFile(resolve(input.source, '.env'), 'PRIVATE=not-distributed');
  await writeFile(resolve(input.source, 'old.zip'), 'old-package');
  await packageSlidev(input);
  const files = unzipSync(new Uint8Array(await readFile(input.out)));
  assert.deepEqual(Object.keys(files).filter(name => name.startsWith('source/')).sort(), ['source/package.json', 'source/slides.md']);
});

test('identical inputs produce an identical ZIP', async t => {
  const input = await fixture(t);
  await packageSlidev(input);
  const first = await readFile(input.out);
  await packageSlidev(input);
  assert.deepEqual(await readFile(input.out), first);
});
