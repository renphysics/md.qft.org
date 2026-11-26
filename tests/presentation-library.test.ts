import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { PresentationProblemLog } from '../src/lib/presentation-messages';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function library(dependencies: { inspect?: (file: File) => Promise<unknown>; save?: (pkg: any) => Promise<unknown> } = {}) {
  const file = new URL('../src/scripts/presentation-library.ts', import.meta.url);
  const parsed = ts.createSourceFile('presentation-library.ts', readFileSync(file, 'utf8'), ts.ScriptTarget.ES2022, true);
  const retained = parsed.statements.filter((node) => ts.isClassDeclaration(node) || ts.isFunctionDeclaration(node));
  const source = ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, retained));
  const javascript = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: Record<string, any> = {};
  const calls = { inspect: 0, save: 0, started: 0, focus: 0, fullscreen: 0, closed: 0, destroyed: 0, players: [] as any[], shown: [] as any[], notices: [] as unknown[] };
  const controls = new Map<string, any>();
  const control = (selector: string) => {
    if (!controls.has(selector)) controls.set(selector, {
      textContent: '', hidden: false, listeners: new Map<string, (event?: unknown) => void>(),
      classList: { add() {}, remove() {}, contains: () => false },
      style: { setProperty() {} },
      addEventListener(name: string, listener: (event?: unknown) => void) { this.listeners.set(name, listener); },
      children: [] as any[], replaceChildren(...children: any[]) { this.children = children; }, close() { calls.closed++; },
      requestFullscreen() { calls.fullscreen++; return Promise.resolve(); },
    });
    return controls.get(selector);
  };
  vm.runInNewContext(javascript, {
    exports, AbortController, File, Blob, crypto, PresentationProblemLog,
    HTMLElement: class { dataset = { sandboxUrl: '/presentation-sandbox.html' }; querySelectorAll() { return []; } },
    document: {
      addEventListener() {},
      createElement(tag: string) { return { tag, textContent: '', children: [] as any[], append(...children: any[]) { this.children.push(...children); } }; },
    },
    location: { href: 'https://md.qft.org/' }, URL,
    Option: class { constructor(public text: string, public value: string) {} },
    createPresentationPlayer(_host: unknown, _html: string, options: unknown) {
      calls.players.push(options);
      return { destroy() { calls.destroyed++; } };
    },
    require(name: string) {
      if (name === '../lib/presentation-package') return { inspectPresentationArchive(file: File) { calls.inspect++; return dependencies.inspect?.(file) ?? Promise.resolve(null); } };
      if (name === '../lib/presentation-store') return { savePresentation(pkg: any) { calls.save++; return dependencies.save?.(pkg) ?? Promise.resolve({ id: 'saved', title: pkg.manifest.title }); } };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  const instance = new exports.PresentationLibrary();
  instance.q = control;
  instance.notice = (message: unknown) => calls.notices.push(message);
  instance.showPackage = (pkg: any, saved: boolean) => { instance.active = pkg; calls.shown.push({ pkg, saved }); };
  instance.setView = () => {};
  return { instance, calls, controls, control };
}

const fixturePackage = () => ({
  manifest: { format: 'qft-presentation', version: 1, engine: 'slidev', title: 'Quantum lesson', entry: 'presentation.html', source: 'source/slides.md' },
  html: '<p>Compiled lesson</p>',
  files: [{ path: 'source/slides.md', content: '# Quantum lesson', size: 16 }],
  archive: new Blob(['original package bytes']), fileName: 'lesson.zip',
});

test('ordinary Markdown ZIPs are handed back to the existing importer without opening a player', async () => {
  const f = library();
  assert.equal(await f.instance.tryOpenFile(new File(['ZIP'], 'notes.zip')), false);
  assert.equal(f.calls.shown.length, 0);
  assert.equal(f.calls.save, 0);
  assert.equal(f.instance.busy, false);
});

test('an imported presentation remains available when persistent storage is unavailable', async () => {
  const pkg = fixturePackage();
  const f = library({ inspect: async () => pkg, save: async () => { throw new Error('Browser storage is full'); } });
  assert.equal(await f.instance.tryOpenFile(new File(['ZIP'], 'lesson.zip')), true);
  assert.equal(f.instance.active, pkg);
  assert.equal(f.calls.shown.length, 1);
  assert.equal(f.instance.temporary.size, 1);
  const saved = [...f.instance.temporary.values()][0] as any;
  assert.equal(saved.archive, pkg.archive, 'original bytes remain downloadable');
  assert.equal(saved.fileName, 'lesson.zip');
  assert.match(f.control('[data-pres-storage]').textContent, /Not saved/);
  assert.match(String(f.calls.notices.at(-1)), /storage is full/);
  assert.equal(f.instance.busy, false);
});

test('concurrent imports cannot overwrite the package being opened', async () => {
  const pending = deferred<unknown>();
  const f = library({ inspect: () => pending.promise });
  const first = f.instance.tryOpenFile(new File(['one'], 'one.zip'));
  await assert.rejects(f.instance.tryOpenFile(new File(['two'], 'two.zip')), /already opening/);
  pending.resolve(fixturePackage());
  assert.equal(await first, true);
  assert.equal(f.calls.inspect, 1);
  assert.equal(f.calls.shown.length, 1);
  assert.equal(f.instance.busy, false);
});

test('a saved-row click cannot cancel an active import and leave the library locked', async () => {
  const pending = deferred<unknown>();
  const f = library({ inspect: () => pending.promise });
  const first = f.instance.tryOpenFile(new File(['one'], 'one.zip'));
  const operation = f.instance.operation;
  await f.instance.openSaved('some-existing-deck');
  assert.equal(f.instance.operation, operation);
  assert.match(String(f.calls.notices.at(-1)), /opening/);
  pending.resolve(fixturePackage());
  await first;
  assert.equal(f.instance.busy, false);
});

test('closing the library before an import finishes does not reopen or save it', async () => {
  const pending = deferred<unknown>();
  const f = library({ inspect: () => pending.promise });
  const first = f.instance.tryOpenFile(new File(['one'], 'one.zip'));
  // Closing/disconnecting increments the same generation used by async imports.
  f.instance.disconnectedCallback();
  pending.resolve(fixturePackage());
  assert.equal(await first, true);
  assert.equal(f.calls.shown.length, 0);
  assert.equal(f.calls.save, 0);
});

test('fullscreen preserves the active slide and current interactive demo state', async () => {
  const f = library();
  f.instance.player = { isRunning: () => true, focus: () => f.calls.focus++ };
  f.instance.start = () => f.calls.started++;
  f.instance.present();
  await Promise.resolve();
  assert.equal(f.calls.started, 0, 'presenting an already running deck must not restart it');
  assert.equal(f.calls.fullscreen, 1);
  assert.equal(f.calls.focus, 1);
});

test('presenting a stopped deck starts it once before requesting fullscreen', async () => {
  const f = library();
  let running = false;
  f.instance.player = { isRunning: () => running, focus: () => f.calls.focus++ };
  f.instance.start = () => { f.calls.started++; running = true; };
  f.instance.present();
  await Promise.resolve();
  assert.equal(f.calls.started, 1);
  assert.equal(f.calls.fullscreen, 1);
});

test('Escape from Slidev preserves the open lesson and only exits outer fullscreen', () => {
  const f = library();
  const pkg = fixturePackage();
  f.instance.openDialog = () => {};
  Object.getPrototypeOf(f.instance).showPackage.call(f.instance, pkg, true);
  assert.equal(f.calls.players.length, 1);
  const player = f.instance.player;
  const onEscape = f.calls.players[0].onEscape;
  let fullscreen = false;
  let exits = 0;
  f.instance.isFullscreen = () => fullscreen;
  f.instance.exitFullscreen = () => { exits++; fullscreen = false; };

  onEscape();
  assert.equal(exits, 0);
  assert.equal(f.calls.closed, 0, 'Slidev can dismiss its own menu without closing the library');
  assert.equal(f.calls.destroyed, 0);
  assert.equal(f.instance.active, pkg);
  assert.equal(f.instance.player, player);

  fullscreen = true;
  onEscape();
  assert.equal(exits, 1);
  assert.equal(f.calls.closed, 0);
  assert.equal(f.calls.destroyed, 0);
  assert.equal(f.instance.active, pkg);
  assert.equal(f.instance.player, player, 'exiting fullscreen retains slide and demonstration state');
});

test('Escape in the outer dialog keeps native closing behavior outside fullscreen', async () => {
  const f = library();
  f.instance.connectedCallback();
  let fullscreen = false;
  let exits = 0;
  let prevented = 0;
  f.instance.isFullscreen = () => fullscreen;
  f.instance.exitFullscreen = () => { exits++; fullscreen = false; };
  const cancel = f.control('[data-pres-dialog]').listeners.get('cancel');
  assert.equal(typeof cancel, 'function');
  cancel({ preventDefault() { prevented++; } });
  assert.equal(prevented, 0, 'the browser may close the dialog when Escape originates in its outer UI');

  fullscreen = true;
  cancel({ preventDefault() { prevented++; } });
  assert.equal(prevented, 1);
  assert.equal(exits, 1, 'fullscreen consumes the first outer Escape');

  f.control('[data-pres-close]').listeners.get('click')();
  await Promise.resolve();
  assert.equal(f.calls.closed, 1, 'the explicit Close button remains available');
});

test('text reported by a presentation is labelled, bounded, and kept out of the application notice', () => {
  const f = library();
  f.instance.openDialog = () => {};
  Object.getPrototypeOf(f.instance).showPackage.call(f.instance, fixturePackage(), true);
  const { onError } = f.calls.players[0];
  const notices = f.calls.notices.length;
  onError('Your session expired. Sign in again at https://example.invalid', 'presentation');
  const area = f.control('[data-pres-problem]');
  assert.equal(area.hidden, false);
  const [line] = area.children;
  assert.equal(line.children[0].textContent, 'The presentation reported: ');
  assert.equal(line.children[0].tag, 'strong');
  assert.equal(line.children[1].tag, 'q');
  assert.equal(line.children[1].textContent, 'Your session expired. Sign in again at https://example.invalid');
  assert.equal(f.calls.notices.length, notices, 'the application notice never repeats presentation text');

  onError('The presentation has not finished loading.', 'player');
  assert.equal(area.children[1].textContent, 'The presentation has not finished loading.', 'application text is not labelled');
  for (let index = 0; index < 5; index++) onError(`Another failure ${index}`, 'presentation');
  assert.equal(area.children.length, 4, 'three problems and one summary line');
  assert.equal(area.children[3].textContent, '4 more messages were not shown.');
});
