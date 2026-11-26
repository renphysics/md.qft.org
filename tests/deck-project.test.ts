import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { strToU8, zipSync } from 'fflate';
import {
  buildPlayable, deckSaveInput, filesWithEdits, isPlayable, openDeck, openStoredDeck,
  type BuildDeps, type DeckProject,
} from '../src/lib/deck-project.ts';
import { deckFromHtmlFile } from '../src/lib/deck-archive.ts';
import { PresentationPackageError } from '../src/lib/presentation-package.ts';
import { htmlFixture, zipFixture } from './helpers/deck-fixtures.ts';
import { nodeVendorProvider } from './helpers/deck-vendor-node.ts';

const deps = (extra: Partial<BuildDeps> = {}): BuildDeps => ({ vendor: () => nodeVendorProvider(), ...extra });

function zipFile(files: Record<string, string | Uint8Array>, name = 'deck.zip'): File {
  const entries = Object.fromEntries(Object.entries(files).map(([path, data]) => [path, typeof data === 'string' ? strToU8(data) : data]));
  return new File([new Uint8Array(zipSync(entries)).buffer], name, { type: 'application/zip' });
}

function portablePackage(title = 'Quantum lesson', wrap = ''): File {
  return zipFile({
    [`${wrap}qft-presentation.json`]: JSON.stringify({ format: 'qft-presentation', version: 1, engine: 'slidev', title, entry: 'presentation.html', source: 'source/slides.md', aspectRatio: '4:3' }),
    [`${wrap}presentation.html`]: '<!doctype html><html><body><h1>Compiled lesson</h1></body></html>',
    [`${wrap}source/slides.md`]: '# Quantum lesson',
  }, 'lesson.zip');
}

async function opened(file: File): Promise<DeckProject> {
  const project = await openDeck(file);
  assert.ok(project, `${file.name} opens as a deck`);
  return project;
}

describe('opening decks', () => {
  it('opens a single Reveal.js page as a one-file deck stored as a ZIP', async () => {
    const project = await opened(htmlFixture('cdn-reveal5-single', 'index.html', 'Damped oscillator.html'));
    assert.equal(project.kind, 'reveal');
    assert.equal(project.engine, 'reveal');
    assert.equal(project.entry, 'index.html');
    assert.equal(project.title, 'Damped oscillator');
    assert.equal(project.fileName, 'Damped oscillator.zip');
    assert.equal(project.original.type, 'application/zip');
    assert.deepEqual([...project.files.keys()], ['index.html']);
    assert.deepEqual(project.sources.map((file) => file.path), ['index.html']);
    assert.match(project.sources[0].text!, /Reveal\.initialize/);
    assert.equal(project.detection.engineVersion, '5.2.1');
  });

  it('opens .htm files and keeps the file name as the title when the page has none', async () => {
    const page = new File(['<!doctype html><html><body><main><p>Hello</p></main></body></html>'], 'Notes for class.htm', { type: 'text/html' });
    const project = await opened(page);
    assert.equal(project.kind, 'html');
    assert.equal(project.engine, 'html');
    assert.equal(project.title, 'Notes for class');
  });

  it('opens Reveal.js and plain HTML ZIPs, with one wrapping folder removed', async () => {
    const local = await opened(zipFixture('local-project', { wrap: 'optics-workshop' }));
    assert.equal(local.kind, 'reveal');
    assert.equal(local.entry, 'index.html');
    assert.ok(local.files.has('slides.md'));
    const plain = await opened(zipFixture('plain-html'));
    assert.equal(plain.kind, 'html');
    assert.equal(plain.title, 'Projectile explorer');
  });

  it('keeps portable packages on the existing strict inspector', async () => {
    const project = await opened(portablePackage('Quantum lesson', 'lesson/'));
    assert.equal(project.kind, 'qft-presentation');
    assert.equal(project.engine, 'slidev');
    assert.equal(project.title, 'Quantum lesson');
    assert.equal(project.source, 'source/slides.md');
    assert.equal(project.aspectRatio, '4:3');
    assert.equal(project.files.size, 0);
    assert.ok(project.package);
    assert.deepEqual(project.sources.find((file) => file.path === 'source/slides.md'), { path: 'source/slides.md', size: 16, text: '# Quantum lesson' });
  });

  it('reports portable package problems as before', async () => {
    const broken = zipFile({ 'qft-presentation.json': '{"format":"other"}', 'presentation.html': '<html><body></body></html>' });
    await assert.rejects(openDeck(broken), /package version is not supported/);
  });

  it('returns null for Markdown documents and lessons so the Markdown importer continues', async () => {
    assert.equal(await openDeck(zipFixture('not-a-deck')), null);
    assert.equal(await openDeck(zipFile({ 'qft.json': '{}', 'slides.md': '# Lesson', 'demos/explore.html': '<html><body></body></html>' })), null);
    assert.equal(await openDeck(zipFile({ 'notes.md': '# One document', 'figure.svg': '<svg/>' })), null);
    assert.equal(await openDeck(new File(['# Notes'], 'notes.md')), null);
  });

  it('returns null for a ZIP whose pages are not a presentation', async () => {
    assert.equal(await openDeck(zipFile({ 'a/page.html': '<p>A</p>', 'b/page.html': '<p>B</p>' })), null);
  });

  it('opens Slidev source as a deck that explains how to build it', async () => {
    const project = await opened(zipFixture('slidev-source'));
    assert.equal(project.kind, 'slidev-source');
    assert.equal(project.engine, 'slidev');
    const result = await buildPlayable(project, deps());
    assert.equal(result.html, '');
    assert.equal(isPlayable(result), false);
    const error = result.issues.find((issue) => issue.severity === 'error')!;
    assert.equal(error.code, 'slidev-source');
    assert.match(error.message, /npx slidev build/);
    assert.match(error.message, /dist folder/);
  });

  it('rejects unreadable ZIPs with the archive reader message', async () => {
    await assert.rejects(openDeck(new File(['not a zip'], 'deck.zip')), PresentationPackageError);
  });
});

describe('building playable decks', () => {
  it('links a CDN Reveal.js deck for the tolerant player with no errors', async () => {
    const project = await opened(htmlFixture('cdn-reveal5-single'));
    const progress: string[] = [];
    const result = await buildPlayable(project, deps({ onProgress: (message) => progress.push(message) }));
    assert.equal(result.profile, 'tolerant');
    assert.equal(isPlayable(result), true);
    assert.match(result.html, /^<!doctype html>/i);
    assert.doesNotMatch(result.html, /<(?:script|link)\b[^>]*\s(?:src|href)="https?:/i, 'no reference to the network remains');
    assert.deepEqual(result.issues.map((issue) => issue.code), ['bundled-library']);
    assert.ok(progress.length >= 1);
  });

  it('drops detection notes the linker supersedes and keeps the rest, errors first', async () => {
    const reveal4 = await buildPlayable(await opened(htmlFixture('cdn-reveal4-cdnjs')), deps());
    const codes = reveal4.issues.map((issue) => issue.code);
    assert.ok(!codes.includes('inline-event-handler'), 'the linker converts onclick, so the blocking note goes');
    assert.equal(codes.filter((code) => code === 'external-font').length, 1, 'one note per font host');
    const unpinned = new File([`<!doctype html><html><head><link rel="stylesheet" href="https://unpkg.com/reveal.js/dist/reveal.css"></head><body><div class="reveal"><div class="slides"><section><h1>A</h1></section></div></div><script src="https://unpkg.com/reveal.js/dist/reveal.js"></script><script>Reveal.initialize();</script></body></html>`], 'unpinned.html');
    const kept = await buildPlayable(await opened(unpinned), deps());
    assert.ok(kept.issues.some((issue) => issue.code === 'reveal-unpinned-cdn'), 'detection notes the linker does not repeat are kept');
    const local = await buildPlayable(await opened(zipFixture('local-project')), deps());
    assert.ok(!local.issues.some((issue) => issue.code === 'library-file-supplied'));
    assert.ok(local.issues.some((issue) => issue.code === 'bundled-library'));
    const modules = await buildPlayable(await opened(zipFixture('esm-project')), deps());
    assert.equal(modules.issues[0].severity, 'error');
    assert.equal(modules.issues[0].code, 'es-modules-unsupported');
    assert.equal(modules.html, '');
    assert.equal(isPlayable(modules), false);
  });

  it('plays a portable package with its own HTML under the strict profile', async () => {
    const result = await buildPlayable(await opened(portablePackage()), deps());
    assert.equal(result.profile, 'strict');
    assert.match(result.html, /Compiled lesson/);
    assert.deepEqual(result.issues, []);
  });

  it('reports a deck the player would refuse instead of playing it', async () => {
    const project = await opened(htmlFixture('plain-html', 'index.html', 'page.html'));
    const result = await buildPlayable(project, deps({ prepare: () => { throw new Error('This presentation still loads a separate script file, which the player cannot open.'); } }));
    assert.equal(result.html, '');
    assert.equal(result.issues[0].code, 'player-refused');
    assert.match(result.issues[0].message, /separate script/);
    let prepared = '';
    const accepted = await buildPlayable(project, deps({ prepare: (html, profile) => { prepared = `${profile}:${html.length}`; } }));
    assert.equal(isPlayable(accepted), true);
    assert.equal(prepared, `tolerant:${accepted.html.length}`);
  });

  it('explains a Slidev build through the one placeholder WP7 replaces', async () => {
    const build = zipFile({
      'dist/index.html': '<!doctype html><html><head><meta property="slidev:version" content="53.1.0"></head><body><div id="app"></div><script type="module" src="./assets/index.js"></script></body></html>',
      'dist/assets/index.js': 'console.log(1)',
    });
    const project = await opened(build);
    assert.equal(project.kind, 'slidev-build');
    const result = await buildPlayable(project, deps());
    assert.equal(result.html, '');
    assert.ok(result.issues.some((issue) => issue.code === 'slidev-build-not-yet' && issue.severity === 'error'));
  });

  it('applies text edits over the original files when linking', async () => {
    const project = await opened(zipFixture('plain-html'));
    assert.equal(filesWithEdits(project), project.files, 'no copy without edits');
    project.edits.set('app.js', "document.title = 'Edited in the browser';");
    const files = filesWithEdits(project);
    assert.notEqual(files, project.files);
    assert.equal(new TextDecoder().decode(files.get('app.js')), "document.title = 'Edited in the browser';");
    assert.notEqual(new TextDecoder().decode(project.files.get('app.js')), "document.title = 'Edited in the browser';", 'originals are untouched');
    const result = await buildPlayable(project, deps());
    assert.match(result.html, /Edited in the browser/);
  });
});

describe('saving and reopening decks', () => {
  it('describes a deck for storage and reopens it from the stored archive', async () => {
    const project = await opened(htmlFixture('cdn-reveal6-unpkg', 'index.html', 'entropy.html'));
    const input = deckSaveInput(project)!;
    assert.equal(input.kind, 'reveal');
    assert.equal(input.engine, 'reveal');
    assert.equal(input.fileName, 'entropy.zip');
    assert.equal(input.entry, 'index.html');
    assert.equal(input.archive, project.original);
    const again = await openStoredDeck({ id: 'saved-1', title: 'My title', kind: 'reveal', engine: 'reveal', archive: input.archive, fileName: input.fileName, entry: 'index.html', edits: { 'index.html': '<p>edited</p>' } });
    assert.equal(again.id, 'saved-1');
    assert.equal(again.title, 'My title');
    assert.equal(again.kind, 'reveal');
    assert.equal(again.edits.get('index.html'), '<p>edited</p>');
    assert.deepEqual([...again.files.keys()], ['index.html']);
  });

  it('reopens a saved portable package through the strict inspector', async () => {
    const original = await opened(portablePackage());
    const again = await openStoredDeck({ id: 'v1', title: 'Saved title', kind: 'qft-presentation', engine: 'slidev', archive: original.original, fileName: 'lesson.zip' });
    assert.equal(again.kind, 'qft-presentation');
    assert.equal(again.title, 'Saved title');
    assert.equal(again.id, 'v1');
    await assert.rejects(openStoredDeck({ title: 'Lost', kind: 'qft-presentation', engine: 'slidev', archive: new Blob([zipSync({ 'a.md': strToU8('# x') })]), fileName: 'x.zip' }), /could not be recognized/);
  });

  it('does not describe unplayable kinds for storage', async () => {
    assert.equal(deckSaveInput(await opened(zipFixture('slidev-source'))), undefined);
  });

  it('opens the shipped Slidev example as a portable package', async () => {
    const bytes = readFileSync(new URL('../public/slidev/interactive-physics.zip', import.meta.url));
    const project = await opened(new File([bytes], 'interactive-physics.zip'));
    assert.equal(project.kind, 'qft-presentation');
    const result = await buildPlayable(project, deps());
    assert.equal(isPlayable(result), true);
    assert.equal(result.profile, 'strict');
  });

  it('gives the same stored bytes for the same HTML file opened twice', async () => {
    const first = await deckFromHtmlFile(htmlFixture('plain-html'));
    const second = await opened(htmlFixture('plain-html'));
    assert.deepEqual(new Uint8Array(await second.original.arrayBuffer()), new Uint8Array(await first.archive.arrayBuffer()));
  });
});
