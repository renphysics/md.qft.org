import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { strToU8, unzipSync, zipSync } from 'fflate';
import {
  buildPlayable, deckArchive, deckEditsProblem, deckFileList, deckFileText, deckOriginalText, deckSaveInput,
  deckSourceNote, filesWithEdits, isEditableDeck, isLibraryFile, isPlayable, nextDeckEdits, openDeck, openStoredDeck,
  originalArchiveName, type BuildDeps, type DeckProject,
} from '../src/lib/deck-project.ts';
import { deckFromHtmlFile } from '../src/lib/deck-archive.ts';
import { PresentationPackageError } from '../src/lib/presentation-package.ts';
import { DECK_EDIT_LIMITS } from '../src/lib/presentation-store.ts';
import { htmlFixture, loadFixtureDeck, zipFixture } from './helpers/deck-fixtures.ts';
import { nodeVendorProvider } from './helpers/deck-vendor-node.ts';
import { nodeSlidevConverter, slidevFixtureFile } from './helpers/slidev-node.ts';

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

  it('explains a ZIP with several pages and no clear start page, and does not save it', async () => {
    const project = await opened(zipFile({ 'a/page.html': '<p>A</p>', 'b/page.html': '<p>B</p>' }));
    assert.equal(project.kind, 'unknown');
    assert.equal(deckSaveInput(project), undefined);
    const result = await buildPlayable(project, deps());
    assert.equal(isPlayable(result), false);
    assert.deepEqual(result.issues.map((issue) => [issue.severity, issue.code]), [['error', 'several-pages']]);
    assert.match(result.issues[0].message, /\(a\/page\.html, b\/page\.html\)/);
    assert.match(result.issues[0].message, /Rename that page to index\.html/);
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

  it('plays an ordinary Slidev build by converting it, under the tolerant profile', async () => {
    const project = await opened(slidevFixtureFile('quantum-interference-dist.zip'));
    assert.equal(project.kind, 'slidev-build');
    assert.equal(project.engine, 'slidev');
    assert.equal(project.entry, 'index.html');
    assert.equal(project.folder, 'dist');
    assert.equal(project.detection.engineVersion, '53.1.0');
    assert.equal(isEditableDeck(project), false);
    assert.match(deckSourceNote(project), /read-only here[\s\S]*npx slidev build/);
    const progress: string[] = [];
    let prepared = '';
    const result = await buildPlayable(project, deps({
      convertSlidev: nodeSlidevConverter(),
      onProgress: (message) => progress.push(message),
      prepare: (html, profile) => { prepared = `${profile}:${html.length}`; },
    }));
    assert.equal(isPlayable(result), true);
    assert.equal(result.profile, 'tolerant');
    assert.equal(prepared, `tolerant:${result.html.length}`);
    assert.deepEqual(progress, ['Preparing the Slidev presentation to play offline…', 'Bundling the presentation…', 'Checking the presentation…']);
    // The converter's notes replace detection's note about the same Google Fonts link.
    assert.deepEqual(result.issues.map((issue) => `${issue.severity} ${issue.code}`), ['info external-font', 'info external-icon']);
    assert.deepEqual(deckSaveInput(project)?.kind, 'slidev-build');
  });

  it('explains a Slidev build that cannot be converted here, failed, or was stopped', async () => {
    const project = await opened(slidevFixtureFile());
    const unavailable = await buildPlayable(project, deps());
    assert.equal(unavailable.html, '');
    assert.deepEqual(unavailable.issues.filter((issue) => issue.severity === 'error').map((issue) => issue.code), ['slidev-convert-unavailable']);

    const failing = await buildPlayable(project, deps({ convertSlidev: async () => { throw new Error('The Slidev converter could not start.'); } }));
    assert.equal(failing.html, '');
    assert.equal(failing.issues[0].code, 'slidev-convert-failed');
    assert.match(failing.issues[0].message, /could not be converted: The Slidev converter could not start\./);

    const controller = new AbortController();
    const stopped = await buildPlayable(project, deps({
      signal: controller.signal,
      convertSlidev: async (_files, _detection, options) => {
        controller.abort();
        options.signal?.throwIfAborted();
        return { html: '<p>never</p>', issues: [] };
      },
    }));
    assert.equal(stopped.html, '');
    assert.deepEqual(stopped.issues.map((issue) => issue.code), ['cancelled']);
  });

  it('refuses a Slidev build with Monaco once, as an error from the converter', async () => {
    const build = zipFile({
      'index.html': '<!doctype html><html><head><meta property="slidev:version" content="53.1.0"><script type="module" src="/assets/index-a.js"></script></head><body><div id="app"></div></body></html>',
      'assets/index-a.js': 'import("./monaco/editor-a.js")',
      'assets/monaco/editor-a.js': 'export default 1',
    });
    const project = await opened(build);
    assert.ok(project.issues.some((issue) => issue.code === 'slidev-monaco' && issue.severity === 'warning'), 'detection notes Monaco first');
    const result = await buildPlayable(project, deps({ convertSlidev: nodeSlidevConverter() }));
    assert.equal(result.html, '');
    assert.deepEqual(result.issues.map((issue) => issue.code), ['slidev-monaco-unsupported']);
    assert.match(result.issues[0].message, /Monaco code editor/);
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

describe('editing decks', () => {
  const text = (bytes: Uint8Array | undefined) => new TextDecoder().decode(bytes);
  const localProject = () => opened(zipFixture('local-project', {
    wrap: 'optics-workshop',
    extra: {
      'optics-workshop/dist/reveal.js': strToU8('/* a copy of Reveal.js */'),
      'optics-workshop/plugin/markdown/markdown.js': strToU8('/* a copy of the Markdown plugin */'),
      'optics-workshop/js/vendor/chart.min.js': strToU8('/* minified */'),
      '__MACOSX/optics-workshop/._index.html': strToU8('clutter'),
    },
  }));

  it('lists the entry page first, then the deck’s own text files, its other files, and library copies', async () => {
    const project = await localProject();
    assert.equal(isEditableDeck(project), true);
    const list = deckFileList(project);
    assert.deepEqual(list.map((file) => [file.path, file.group, file.editable]), [
      ['index.html', 'entry', true],
      ['css/custom.css', 'deck', true],
      ['css/theme-extra.css', 'deck', true],
      ['js/demo.js', 'deck', true],
      ['slides.md', 'deck', true],
      ['assets/pic.png', 'deck', false],
      ['dist/reveal.js', 'library', false],
      ['js/vendor/chart.min.js', 'library', false],
      ['plugin/markdown/markdown.js', 'library', false],
    ]);
    const picture = list.find((file) => file.path === 'assets/pic.png')!;
    assert.equal(picture.text, false);
    assert.equal(picture.size, loadFixtureDeck('local-project').get('assets/pic.png')!.length);
    assert.match(picture.note!, /cannot be edited here/);
    const library = list.find((file) => file.path === 'dist/reveal.js')!;
    assert.equal(library.text, true, 'library copies can still be read');
    assert.match(library.note!, /library/);
    assert.equal(list.find((file) => file.path === 'slides.md')!.note, undefined);
    assert.equal(isLibraryFile('node_modules/reveal.js/dist/reveal.js'), true);
    assert.equal(isLibraryFile('css/custom.css'), false);
  });

  it('keeps packages and Slidev decks read-only, with an explanation of how to change them', async () => {
    const pkg = await opened(portablePackage());
    assert.equal(isEditableDeck(pkg), false);
    const list = deckFileList(pkg);
    assert.equal(list[0].path, 'source/slides.md', 'the package’s main source comes first');
    assert.ok(list.every((file) => !file.editable && file.note === undefined));
    assert.equal(deckFileText(pkg, 'source/slides.md'), '# Quantum lesson');
    assert.match(deckSourceNote(pkg), /read-only here.*rebuild the package/);
    assert.equal(nextDeckEdits(pkg, new Map([['source/slides.md', '# Changed']])).problem, 'This presentation cannot be edited in the browser.');
    const source = await opened(zipFixture('slidev-source'));
    assert.equal(isEditableDeck(source), false);
    assert.match(deckSourceNote(source), /npx slidev build/);
    assert.match(deckSourceNote(await localProject()), /Apply changes/);
  });

  it('computes the next overlay without changing the project, and drops edits that match the original', async () => {
    const project = await localProject();
    const original = deckOriginalText(project, 'slides.md')!;
    assert.match(original, /## Next: the picture slide/);
    const edited = original.replace('Next: the picture slide', 'Next: an edited picture slide');
    const first = nextDeckEdits(project, new Map([['slides.md', edited]]));
    assert.equal(first.problem, undefined);
    assert.deepEqual([...first.edits], [['slides.md', edited]]);
    assert.equal(project.edits.size, 0, 'the project is unchanged until the caller applies the result');
    project.edits = first.edits;
    assert.equal(deckFileText(project, 'slides.md'), edited);
    assert.equal(deckOriginalText(project, 'slides.md'), original);
    const back = nextDeckEdits(project, new Map([['slides.md', original], ['css/custom.css', 'h2 { color: teal }']]));
    assert.deepEqual([...back.edits], [['css/custom.css', 'h2 { color: teal }']]);
  });

  it('refuses edits to files that cannot be edited and edits over the 2 MB and 8 MB limits', async () => {
    const project = await localProject();
    for (const path of ['assets/pic.png', 'dist/reveal.js', 'new-file.js']) {
      const result = nextDeckEdits(project, new Map([[path, 'changed']]));
      assert.match(result.problem!, /cannot be edited here/, path);
    }
    const large = nextDeckEdits(project, new Map([['slides.md', 'é'.repeat(DECK_EDIT_LIMITS.fileBytes / 2 + 1)]]));
    assert.match(large.problem!, /“slides\.md” is larger than 2 MB/);
    assert.equal(nextDeckEdits(project, new Map([['slides.md', 'x'.repeat(DECK_EDIT_LIMITS.fileBytes)]])).problem, undefined, 'exactly 2 MB is allowed');
    const nearly = 'x'.repeat(DECK_EDIT_LIMITS.fileBytes - 16);
    const total = new Map(['index.html', 'css/custom.css', 'css/theme-extra.css', 'js/demo.js', 'slides.md'].map((path) => [path, nearly]));
    assert.match(nextDeckEdits(project, total).problem!, /larger than 8 MB together/);
    assert.match(deckEditsProblem(new Map([['a.md', '😀'.repeat(DECK_EDIT_LIMITS.fileBytes / 4 + 1)]]))!, /larger than 2 MB/, 'astral characters count four bytes');
    assert.equal(deckEditsProblem(new Map()), undefined);
  });

  it('downloads the original unchanged, or the current files under their original names when edited', async () => {
    const project = await localProject();
    assert.equal(deckArchive(project), project.original, 'unedited decks download the upload itself');
    assert.equal(project.folder, 'optics-workshop');
    project.edits = new Map([['slides.md', '## Edited in the browser\n']]);
    const archive = deckArchive(project);
    assert.equal(archive.type, 'application/zip');
    const entries = unzipSync(new Uint8Array(await archive.arrayBuffer()));
    assert.ok(Object.keys(entries).every((name) => name.startsWith('optics-workshop/')), 'the wrapping folder is kept');
    assert.equal(text(entries['optics-workshop/slides.md']), '## Edited in the browser\n');
    assert.deepEqual(entries['optics-workshop/assets/pic.png'], loadFixtureDeck('local-project').get('assets/pic.png'));
    assert.equal(text(entries['optics-workshop/index.html']), text(loadFixtureDeck('local-project').get('index.html')));
    assert.equal(Object.keys(entries).some((name) => name.includes('__MACOSX')), false, 'operating-system clutter is left out');
    assert.equal(originalArchiveName(project), 'local-project-original.zip');
    // The download opens again as the same deck, now with the edit in its files.
    const again = await opened(new File([archive], 'optics-workshop.zip'));
    assert.equal(again.kind, 'reveal');
    assert.equal(text(again.files.get('slides.md')), '## Edited in the browser\n');
    assert.deepEqual([...again.files.keys()], [...project.files.keys()]);
    const single = await opened(htmlFixture('plain-html', 'index.html', 'page.html'));
    single.edits = new Map([['index.html', '<!doctype html><title>Edited</title><p>Edited</p>']]);
    assert.deepEqual(Object.keys(unzipSync(new Uint8Array(await deckArchive(single).arrayBuffer()))), ['index.html']);
  });

  it('restores a saved overlay on reopening, but never lets it add or replace binary files', async () => {
    const project = await localProject();
    const again = await openStoredDeck({
      id: 'saved-2', title: 'Optics workshop', kind: 'reveal', engine: 'reveal', archive: project.original, fileName: project.fileName,
      entry: 'index.html', edits: { 'slides.md': '## Restored edit\n', 'new-file.js': 'alert(1)', 'assets/pic.png': 'not a picture' },
    });
    assert.deepEqual([...again.edits], [['slides.md', '## Restored edit\n']]);
    assert.equal(again.folder, 'optics-workshop');
    const files = filesWithEdits({ ...again, edits: new Map([...again.edits, ['new-file.js', 'alert(1)']]) });
    assert.equal(files.has('new-file.js'), false, 'filesWithEdits never adds a file');
    const packageRecord = await openStoredDeck({ title: 'Lesson', kind: 'qft-presentation', engine: 'slidev', archive: (await opened(portablePackage())).original, fileName: 'lesson.zip', edits: { 'source/slides.md': '# Changed' } });
    assert.equal(packageRecord.edits.size, 0, 'read-only kinds carry no edits');
  });

  it('plays an edited external Markdown slide after rebuilding', async () => {
    const project = await localProject();
    const original = deckOriginalText(project, 'slides.md')!;
    project.edits = nextDeckEdits(project, new Map([['slides.md', original.replace('Next: the picture slide', 'Next: an edited picture slide')]])).edits;
    const result = await buildPlayable(project, deps());
    assert.equal(isPlayable(result), true);
    assert.match(result.html, /Next: an edited picture slide/);
    assert.doesNotMatch(result.html, /Next: the picture slide/);
    assert.deepEqual(deckSaveInput(project)!.edits, project.edits);
  });
});
