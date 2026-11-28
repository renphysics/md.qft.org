import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { unzipSync } from 'fflate';
import { parse } from 'parse5';

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

/** A text as a regular expression that matches exactly that text. */
const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Every selector of the style sheets that the compiled presentation carries:
 * the text before each "{". One pass over the text, because the sheets hold
 * megabytes of embedded fonts.
 */
function compiledSelectors(): string[] {
  const sheets: string[] = [];
  const walk = (node: any): void => {
    if (node.tagName === 'style') sheets.push((node.childNodes ?? []).map((child: any) => child.value ?? '').join(''));
    for (const child of node.childNodes ?? []) walk(child);
    if (node.content) walk(node.content);
  };
  walk(parse(Buffer.from(starter['presentation.html']).toString('utf8')));
  const selectors: string[] = [];
  for (const css of sheets) {
    let start = 0;
    for (let index = 0; index < css.length; index += 1) {
      const code = css.charCodeAt(index);
      if (code === 123) { selectors.push(css.slice(start, index)); start = index + 1; }
      else if (code === 125) start = index + 1;
    }
  }
  return selectors;
}

/**
 * Slidev applies a <style> block written in slides.md to the one slide it is
 * written in (it compiles the block as a scoped style). The starter once kept
 * its whole design in such a block on the last slide, so the other slides
 * played with the plain theme and a label ran into the text beside it
 * ("In phaseAt φ = 0"). Styles that several slides share belong in style.css,
 * which Slidev loads for the whole presentation.
 */
test('the Starter ZIP styles every class of its slides for the whole presentation, not for one slide', () => {
  const slides = Buffer.from(starter['source/slides.md']).toString('utf8');
  // Plain class attributes only: a Vue binding (:class="...") holds an expression, not a list of names.
  const classes = [...new Set([...slides.matchAll(/(?<![:\w-])class="([^"]+)"/g)].flatMap((match) => match[1].split(/\s+/)).filter(Boolean))];
  for (const expected of ['eyebrow', 'lead', 'concept-grid', 'question-list', 'lesson-note']) assert.ok(classes.includes(expected), `the slides use .${expected}`);
  const compiled = compiledSelectors();
  assert.ok(compiled.length > 100, 'the compiled style sheets were read');
  for (const name of classes) {
    // A style sheet writes a class such as md:flex or w-1/2 with a backslash before the punctuation mark.
    // (A name that begins with a digit is written in yet another way; the slides have none.)
    const written = name.replace(/[^\w\u0080-\uffff-]/g, (character) => `\\${character}`);
    const uses = new RegExp(`\\.${literal(written)}(?![\\w-])`);
    const selectors = compiled.filter((selector) => uses.test(selector));
    assert.ok(selectors.length, `.${name} has a rule in the compiled presentation`);
    assert.ok(selectors.some((selector) => !selector.includes('[data-v-')),
      `.${name} is styled only inside one slide (a scoped rule): move its rules from the <style> block in slides.md to style.css`);
  }
});

test('the Starter ZIP keeps its styles in style.css: its slides.md has no <style> block', () => {
  // The test above cannot see a single rule that moves back into one slide while its class keeps
  // other rules in style.css. The starter therefore keeps every rule in style.css.
  const slides = Buffer.from(starter['source/slides.md']).toString('utf8');
  assert.doesNotMatch(slides, /<style\b/i,
    'Slidev applies a <style> block in slides.md to the one slide it is written in: put the rule in style.css (see tools/slidev/README.md)');
  assert.ok(Buffer.from(starter['source/style.css'] ?? []).toString('utf8').includes('.slidev-layout'), 'source/style.css holds the design');
});

test('the Starter ZIP keeps a label apart from the text beside it even where no style sheet applies', () => {
  const slides = Buffer.from(starter['source/slides.md']).toString('utf8');
  const inline = '(?:strong|b|em|i|span|a|code|small|mark)';
  const touching = slides.match(new RegExp(`[^\\s>]</${inline}><${inline}[\\s>][^<]*`, 'g')) ?? [];
  assert.deepEqual(touching, [], 'two inline elements with text touch: without their styles a reader sees one run-together word');
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
