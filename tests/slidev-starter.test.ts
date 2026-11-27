import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { unzipSync } from 'fflate';

/**
 * The "Starter ZIP" that the site hands out (public/slidev/interactive-physics.zip)
 * is made from tools/slidev by its own packager. When tools/slidev changes,
 * regenerate it: npm ci --prefix tools/slidev, then in tools/slidev
 * npm run build and node pack.mjs --dist .build --source . --out ../../public/slidev/interactive-physics.zip --title 'Quantum interference — Slidev'.
 */
const starter = unzipSync(new Uint8Array(readFileSync(new URL('../public/slidev/interactive-physics.zip', import.meta.url))));
const tool = (name: string) => readFileSync(new URL(`../tools/slidev/${name}`, import.meta.url));

test('the Starter ZIP carries the current tools/slidev source', () => {
  const sources = Object.keys(starter).filter((name) => name.startsWith('source/') && !name.endsWith('/'));
  for (const required of ['source/README.md', 'source/package.json', 'source/package-lock.json', 'source/pack.mjs', 'source/slides.md']) {
    assert.ok(sources.includes(required), `${required} is in the ZIP`);
  }
  for (const name of sources) {
    assert.ok(Buffer.from(starter[name]).equals(tool(name.slice('source/'.length))),
      `${name} differs from tools/slidev/${name.slice('source/'.length)}: regenerate the Starter ZIP (see this test's header)`);
  }
});

/**
 * The files of tools/slidev as git sees them: tracked files that still exist
 * and new files that are not ignored. Without git (an exported tree), every
 * file outside the folders that .gitignore names.
 */
function toolFiles(): string[] {
  const root = fileURLToPath(new URL('../', import.meta.url));
  try {
    const listed = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', 'tools/slidev'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return listed.split('\0').filter((path) => path && existsSync(`${root}${path}`)).map((path) => path.slice('tools/slidev/'.length));
  } catch {
    const walk = (folder: string): string[] => readdirSync(`${root}tools/slidev/${folder}`, { withFileTypes: true }).flatMap((entry) => {
      const path = `${folder}${entry.name}`;
      if (entry.isDirectory()) return ['node_modules', '.build', '.slidev'].includes(entry.name) ? [] : walk(`${path}/`);
      return /\.zip$/i.test(entry.name) ? [] : [path];
    });
    return walk('');
  }
}

test('the Starter ZIP has every file of tools/slidev, so a new file means regenerating it', () => {
  const sources = new Set(Object.keys(starter).filter((name) => name.startsWith('source/')).map((name) => name.slice('source/'.length)));
  const files = toolFiles();
  assert.ok(files.includes('slides.md') && files.includes('components/QuantumInterference.vue'), 'the listing works');
  // pack.mjs leaves out files that are not part of a Slidev project, such as .gitignore.
  for (const path of files.filter((name) => name !== '.gitignore')) {
    assert.ok(sources.has(path), `tools/slidev/${path} is not in the Starter ZIP: regenerate it (see this test's header)`);
  }
});

test('the Starter ZIP asks for the Node.js that its Slidev needs', () => {
  const manifest = JSON.parse(Buffer.from(starter['source/package.json']).toString('utf8'));
  assert.equal(manifest.engines.node, '>=22.22.0');
  assert.match(Buffer.from(starter['source/README.md']).toString('utf8'), /Node\.js 22\.22 or newer/);
});

test('the Slidev build fixture names what it contains and carries the license texts', () => {
  const notice = readFileSync(new URL('./fixtures/slidev-default-build.NOTICE.txt', import.meta.url), 'utf8');
  assert.equal(notice.match(/Permission is hereby granted, free of charge/g)?.length, 1, 'the MIT text once');
  for (const name of ['@slidev/client 53.1.0', 'vue 3.5.46', 'vue-router 5.5.1', 'katex 0.19.1', 'yaml 2.9.1', 'fuse.js 7.5.0', 'tslib 2.4.0']) {
    assert.ok(notice.includes(name), name);
  }
  assert.match(notice, /Apache License\s+Version 2\.0, January 2004/);
  assert.match(notice, /ISC License/);
  assert.match(notice, /KaTeX fonts are part of the katex package and are distributed under its\s+MIT License/);
  assert.doesNotMatch(notice, /Open Font License|OFL/, 'KaTeX ships its fonts under MIT');
});
