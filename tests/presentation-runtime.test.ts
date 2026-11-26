import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { build } from 'esbuild';
import ts from 'typescript';
import { exportPresentationHtml, isPresentationPosition, preparePresentationDocument, presentationRunnerDocument, presentationRuntimeSource } from '../src/lib/presentation-runtime';

const runnerHtml = readFileSync(new URL('../public/presentation-sandbox.html', import.meta.url), 'utf8');
const runnerScript = runnerHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(runnerScript);

function runner(origin: string, topLevel = false, script = runnerScript!) {
  const messages: any[] = [];
  const parent = { postMessage(value: unknown) { messages.push(value); } };
  const packages: Blob[] = [];
  const frames: any[] = [];
  const revoked: string[] = [];
  let receive: ((event: { source: unknown; data: unknown }) => void) | undefined;
  let dispose: (() => void) | undefined;
  let violation: ((event: any) => void) | undefined;
  const window = { origin, parent: parent as object, addEventListener(name: string, listener: any) { if (name === 'message') receive = listener; if (name === 'pagehide') dispose = listener; } };
  if (topLevel) window.parent = window;
  vm.runInNewContext(script, {
    window, parent, Blob,
    URL: { createObjectURL(value: Blob) { packages.push(value); return `blob:null/package-${packages.length}`; }, revokeObjectURL(value: string) { revoked.push(value); } },
    document: {
      createElement(tag: string) {
        assert.equal(tag, 'iframe');
        const value = {
          attrs: {} as Record<string, string>, style: {}, contentWindow: {}, focusCount: 0, calls: [] as string[],
          setAttribute(name: string, data: string) { this.attrs[name] = data; },
          blur() { this.calls.push('blur'); }, focus() { this.focusCount++; this.calls.push('focus'); },
        };
        frames.push(value); return value;
      },
      body: { replaceChildren() {} },
      addEventListener(name: string, listener: any) { if (name === 'securitypolicyviolation') violation = listener; },
    },
  });
  return { parent, packages, frames, messages, revoked, listening: Boolean(receive), send(source: unknown, data: unknown) { receive?.({ source, data }); }, dispose: () => dispose?.(), violate: () => violation?.({ effectiveDirective: 'frame-src' }) };
}

function compiledFunction(name: string, dependencies: Record<string, unknown>): any {
  const path = new URL('../src/lib/presentation-runtime.ts', import.meta.url);
  const source = ts.createSourceFile('presentation-runtime.ts', readFileSync(path, 'utf8'), ts.ScriptTarget.ES2022, true);
  const factory = source.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'presentationRuntimeFactory');
  assert.ok(factory?.body);
  const nodes = factory.body.statements.filter((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.equal(nodes.length, 1);
  const printed = ts.createPrinter().printFile(ts.factory.updateSourceFile(source, nodes));
  const javascript = ts.transpileModule(`${printed}\nexports.result=${name};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: Record<string, unknown> = {};
  vm.runInNewContext(javascript, { exports, ...dependencies });
  return exports.result;
}

test('the presentation runner never accepts code outside an opaque iframe', () => {
  for (const [origin, topLevel] of [['https://md.qft.org', false], ['https://md.qft.org', true], ['null', true]] as const) {
    const frame = runner(origin, topLevel);
    assert.equal(frame.listening, false);
    frame.send(frame.parent, { type: 'qft-presentation-load', token: 'a'.repeat(36), html: '<script>execute()</script>' });
    assert.equal(frame.packages.length, 0);
  }
});

test('only one bounded initialization from the owning parent is accepted', async () => {
  const frame = runner('null');
  const message = { type: 'qft-presentation-load', token: 'a'.repeat(36), html: '<!doctype html><p>Slidev</p>' };
  frame.send({}, message);
  frame.send(frame.parent, { ...message, type: 'qft-demo-load' });
  frame.send(frame.parent, { ...message, token: 'x'.repeat(36) });
  frame.send(frame.parent, { ...message, html: 'x'.repeat(26 * 1024 * 1024 + 1) });
  assert.equal(frame.packages.length, 0);
  frame.send(frame.parent, message);
  frame.send(frame.parent, { ...message, html: 'replacement' });
  assert.equal(frame.packages.length, 1);
  assert.equal(await frame.packages[0].text(), message.html);
  assert.equal(frame.frames[0].attrs.sandbox, 'allow-scripts');
  assert.equal(frame.frames[0].src, 'blob:null/package-1');
  frame.dispose();
  assert.deepEqual(frame.revoked, ['blob:null/package-1']);
});

test('the trusted runner relays only bounded application messages from its actual child', () => {
  const frame = runner('null');
  const token = 'a'.repeat(36);
  frame.send(frame.parent, { type: 'qft-presentation-load', token, html: '<p>Lesson</p>' });
  const child = frame.frames[0];
  // Focusing before the runner owns focus is refused by Chromium's policy and
  // logged as an error; the host requests focus once the deck is ready.
  assert.equal(child.focusCount, 0);
  frame.send({}, { qftPresentation: 1, token, kind: 'ready' });
  frame.send(child.contentWindow, { qftPresentation: 1, token: 'b'.repeat(36), kind: 'ready' });
  frame.send(child.contentWindow, { qftPresentation: 1, token, kind: 'request-editor-storage' });
  assert.equal(frame.messages.length, 0);
  frame.send(child.contentWindow, { qftPresentation: 1, token, kind: 'ready' });
  assert.equal(frame.messages[0].kind, 'ready');
  frame.send(child.contentWindow, { qftPresentation: 1, token, kind: 'error', detail: 'x'.repeat(1000) });
  assert.equal(frame.messages[1].detail.length, 350);
  const before = child.focusCount;
  frame.send(child.contentWindow, { type: 'qft-presentation-focus', token });
  assert.equal(child.focusCount, before);
  frame.send(frame.parent, { type: 'qft-presentation-focus', token });
  assert.equal(child.focusCount, before + 1);
  // Blur first, so that focusing a frame that is already active still moves the keyboard into it.
  assert.deepEqual(child.calls, ['blur', 'focus']);
  frame.send(frame.parent, { type: 'qft-presentation-focus', token: 'b'.repeat(36) });
  assert.deepEqual(child.calls, ['blur', 'focus'], 'only the current token can ask');
  frame.violate();
  assert.match(frame.messages.at(-1).detail, /unsupported navigation/);
});

test('the trusted shell limits application-frame navigation to local blobs', () => {
  const policies = [...runnerHtml.matchAll(/http-equiv="Content-Security-Policy" content="([^"]*)"/g)].map((match) => match[1]);
  assert.ok(policies.some((value) => value.includes('frame-src blob:;')));
  assert.ok(policies.every((value) => !value.includes("frame-src 'self'") && !value.includes('frame-src https:')));
  assert.match(runnerHtml, /connect-src 'none'/);
  assert.equal(runnerHtml, `<!-- Generated from presentationRunnerDocument in src/lib/presentation-runtime.ts. -->\n${presentationRunnerDocument()}\n`);
  const portable = presentationRunnerDocument('a'.repeat(36));
  assert.match(portable, /script-src 'nonce-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'/);
  assert.match(portable, /frame-src blob:/);
});

test('the runner relays warnings, positions, slide counts and fullscreen requests only in their checked forms', () => {
  const frame = runner('null');
  const token = 'a'.repeat(36);
  frame.send(frame.parent, { type: 'qft-presentation-load', token, html: '<p>Deck</p>' });
  const child = frame.frames[0].contentWindow;
  const deck = (kind: string, detail?: unknown) => frame.send(child, { qftPresentation: 1, token, kind, detail });
  deck('warning', 'w'.repeat(1000));
  deck('warning', 42);
  for (const position of ['3/1/2', '3/1', '3', '-1/0', '1/2/3/4', '12345/0', '1/0\n', ' 1/0', 3]) deck('position', position);
  for (const count of ['12', 12, '1e3', '123456', '']) deck('slides', count);
  for (const request of ['enter', 'exit', undefined, 'toggle', 1]) deck('fullscreen', request);
  deck('navigate', 'https://example.com/');
  deck('storage', 'drafts');
  frame.send(child, { qftPresentation: 1, token: 'b'.repeat(36), kind: 'position', detail: '1/0' });
  frame.send({}, { qftPresentation: 1, token, kind: 'fullscreen', detail: 'enter' });
  assert.deepEqual(frame.messages.map((message) => [message.kind, message.kind === 'warning' ? message.detail.length : message.detail]), [
    ['warning', 350], ['position', '3/1/2'], ['position', '3/1'], ['slides', '12'], ['fullscreen', 'enter'], ['fullscreen', 'exit'],
  ]);
  assert.ok(frame.messages.every((message) => message.qftPresentation === 1 && message.token === token));
});

test('a restore position reaches the deck only as a fragment of digits on its blob: address', () => {
  const cases: [unknown, string][] = [
    ['#/2/1/0', 'blob:null/package-1#/2/1/0'], ['#/2/1', 'blob:null/package-1#/2/1'], [undefined, 'blob:null/package-1'],
    ['#/2/1?print-pdf', 'blob:null/package-1'], ['javascript:alert(1)', 'blob:null/package-1'], ['#x', 'blob:null/package-1'],
    ['/2/1', 'blob:null/package-1'], ['#/2/1/0/9', 'blob:null/package-1'], [7, 'blob:null/package-1'],
  ];
  for (const [fragment, address] of cases) {
    const frame = runner('null');
    frame.send(frame.parent, { type: 'qft-presentation-load', token: 'a'.repeat(36), html: '<p>Deck</p>', fragment });
    assert.equal(frame.frames.length, 1, `${String(fragment)} still loads the deck`);
    assert.equal(frame.frames[0].src, address);
  }
});

function playerFixture(settings: { profile?: string; activation?: { isActive: boolean } } = {}) {
  const frames: any[] = [];
  const states: string[] = [];
  const errors: string[] = [];
  const origins: string[] = [];
  const warnings: string[] = [];
  const positions: string[] = [];
  const slides: number[] = [];
  const fullscreen: string[] = [];
  const prepared: { html: string; profile: unknown }[] = [];
  const timers = new Map<number, () => void>();
  let clock = 0;
  let receive: (event: any) => void = () => {};
  let escapes = 0;
  const host = { children: [] as any[], replaceChildren(...children: any[]) { this.children = children; } };
  const document = {
    activeElement: undefined as unknown,
    createElement(tag: string) {
        assert.equal(tag, 'iframe');
        const value = {
          attrs: {} as Record<string, string>, style: {}, focused: false, removed: false, load: () => {}, sent: [] as any[],
          contentWindow: {} as any,
          setAttribute(name: string, value: string) { this.attrs[name] = value; },
          addEventListener(name: string, callback: () => void) { if (name === 'load') this.load = callback; },
          remove() { this.removed = true; },
          focus() { this.focused = true; document.activeElement = this; this.calls.push('focus'); },
          blur() { this.focused = false; if (document.activeElement === this) document.activeElement = undefined; this.calls.push('blur'); },
          calls: [] as string[],
        };
        value.contentWindow.postMessage = (message: any) => { value.sent.push(message); value.calls.push(`message:${message.type}`); };
        frames.push(value);
        return value;
    },
  };
  const createPlayer = compiledFunction('createPresentationPlayer', {
    crypto, AbortController,
    preparePresentationDocument(html: string, token: string, nonce: string, options: { profile?: unknown }) {
      prepared.push({ html, profile: options?.profile });
      return `prepared|${token}|${nonce}|${html}`;
    },
    isPresentationPosition: compiledFunction('isPresentationPosition', {}),
    document,
    ...(settings.activation ? { navigator: { userActivation: settings.activation } } : {}),
    window: {
      addEventListener(_: string, callback: typeof receive) { receive = callback; },
      setTimeout(callback: () => void) { timers.set(++clock, callback); return clock; },
      clearTimeout(id: number) { timers.delete(id); },
    },
  });
  const player = createPlayer(host, '<div>Compiled Slidev</div>', {
    title: 'Lesson', sandboxUrl: '/presentation-sandbox.html', ...(settings.profile ? { profile: settings.profile } : {}),
    onState(value: string) { states.push(value); }, onError(value: string, origin: string) { errors.push(value); origins.push(origin); }, onEscape() { escapes++; },
    onWarning(value: string) { warnings.push(value); }, onPosition(value: string) { positions.push(value); },
    onSlides(value: number) { slides.push(value); }, onFullscreenRequest(value: string) { fullscreen.push(value); },
  });
  /** Start, load the runner, and return the frame with a sender of deck messages. */
  const play = (options?: unknown) => {
    player.start(options);
    const frame = frames.at(-1);
    frame.load();
    const token = frame.sent.at(-1).token;
    return { frame, token, deck: (kind: string, detail?: unknown) => receive({ source: frame.contentWindow, data: { qftPresentation: 1, token, kind, detail } }) };
  };
  return {
    player, frames, states, errors, origins, warnings, positions, slides, fullscreen, prepared, timers, host, document, play,
    escapeCount: () => escapes, send: (source: unknown, data: unknown) => receive({ source, data }),
  };
}

test('the player remains inert until Start and never grants an origin or privileged browser APIs', () => {
  const f = playerFixture();
  assert.equal(f.frames.length, 0);
  assert.equal(f.player.isRunning(), false);
  f.player.start();
  assert.equal(f.frames.length, 1);
  const frame = f.frames[0];
  assert.equal(frame.attrs.sandbox, 'allow-scripts');
  assert.equal(frame.attrs.referrerpolicy, 'no-referrer');
  assert.match(frame.attrs.allow, /camera 'none'/);
  assert.match(frame.attrs.allow, /microphone 'none'/);
  assert.match(frame.attrs.allow, /fullscreen 'none'/);
  assert.equal(frame.src, '/presentation-sandbox.html');
  assert.equal(frame.sent.length, 0);
  frame.load();
  assert.equal(frame.sent.length, 1);
  assert.equal(frame.sent[0].type, 'qft-presentation-load');
  assert.match(frame.sent[0].token, /^[a-f0-9]{36}$/);
  assert.equal(f.player.isRunning(), true);
});

test('ready/error/escape messages require both the current frame and its token', () => {
  const f = playerFixture();
  f.player.start();
  const frame = f.frames[0]; frame.load();
  const message = { qftPresentation: 1, token: frame.sent[0].token, kind: 'ready' };
  f.send({}, message);
  f.send(frame.contentWindow, { ...message, token: 'b'.repeat(36) });
  f.send(frame.contentWindow, { ...message, qftPresentation: 2 });
  assert.equal(f.states.at(-1), 'loading');
  f.send(frame.contentWindow, message);
  assert.equal(f.states.at(-1), 'ready');
  assert.equal(f.timers.size, 0);
  f.send({}, { ...message, kind: 'escape' });
  f.send(frame.contentWindow, { ...message, kind: 'escape' });
  assert.equal(f.escapeCount(), 1);
  for (let i = 0; i < 5; i++) f.send(frame.contentWindow, { ...message, kind: 'error', detail: 'x'.repeat(500) });
  assert.equal(f.errors.length, 1, 'the failing frame is destroyed, so late messages are ignored');
  assert.deepEqual(f.origins, ['presentation'], 'text from the frame is attributed to the presentation');
  assert.equal(f.errors[0].length, 350);
  assert.equal(f.states.at(-1), 'error');
  assert.equal(frame.removed, true);
  assert.equal(f.player.isRunning(), false);
});

test('restart destroys the old context and stale callbacks cannot affect the new presentation', () => {
  const f = playerFixture();
  f.player.start();
  const first = f.frames[0]; first.load();
  const token = first.sent[0].token;
  f.player.restart();
  const second = f.frames[1];
  assert.equal(first.removed, true);
  first.load();
  assert.equal(first.sent.length, 1);
  f.send(first.contentWindow, { qftPresentation: 1, token, kind: 'error', detail: 'stale' });
  assert.equal(f.errors.length, 0);
  second.load();
  assert.notEqual(second.sent[0].token, token);
  f.player.stop();
  assert.equal(second.removed, true);
  assert.equal(f.player.isRunning(), false);
  assert.equal(f.timers.size, 0);
  f.player.destroy();
  f.player.start();
  assert.equal(f.frames.length, 2);
});

test('a presentation which never becomes ready has actionable timeout feedback', () => {
  const f = playerFixture();
  f.player.start();
  const timeout = [...f.timers.values()][0];
  timeout();
  assert.equal(f.states.at(-1), 'error');
  assert.match(f.errors[0], /not finished loading/);
  assert.deepEqual(f.origins, ['player']);
});

test('ready hands keyboard focus to the deck without a click, and focus() repeats the hand-off', () => {
  const f = playerFixture();
  f.player.start();
  const frame = f.frames[0];
  assert.equal(f.document.activeElement, frame, 'Start focuses the new frame');
  frame.load();
  const token = frame.sent[0].token;
  frame.calls.length = 0;
  f.send(frame.contentWindow, { qftPresentation: 1, token, kind: 'ready' });
  assert.deepEqual(frame.calls, ['blur', 'focus', 'message:qft-presentation-focus'], 'blur, then focus, then ask the runner to focus the deck');
  assert.equal(frame.sent.at(-1).token, token);
  frame.calls.length = 0;
  f.player.focus();
  assert.deepEqual(frame.calls, ['blur', 'focus', 'message:qft-presentation-focus'], 'Present and Fullscreen reuse the same hand-off');
});

test('ready does not take focus back from a control the user moved to while loading', () => {
  const f = playerFixture();
  f.player.start();
  const frame = f.frames[0];
  frame.load();
  f.document.activeElement = { other: true };
  frame.calls.length = 0;
  f.send(frame.contentWindow, { qftPresentation: 1, token: frame.sent[0].token, kind: 'ready' });
  assert.equal(f.states.at(-1), 'ready');
  assert.deepEqual(frame.calls, []);
});

test('the strict profile is the default: no warnings or fullscreen requests reach the host', () => {
  const f = playerFixture({ activation: { isActive: true } });
  const { frame, deck } = f.play();
  assert.equal(f.prepared[0].profile, 'strict');
  assert.match(frame.title, /Slidev presentation$/);
  deck('ready');
  deck('warning', 'Ignored');
  deck('fullscreen', 'enter');
  deck('position', '2/0');
  assert.deepEqual(f.warnings, []);
  assert.deepEqual(f.fullscreen, []);
  assert.deepEqual(f.positions, ['2/0'], 'positions are reported in both profiles');
  assert.equal(f.states.at(-1), 'ready');
});

test('the tolerant profile passes on bounded warnings and keeps the deck playing', () => {
  const f = playerFixture({ profile: 'tolerant' });
  const { frame, deck } = f.play();
  assert.equal(f.prepared[0].profile, 'tolerant');
  assert.match(frame.title, /^Lesson — presentation$/);
  deck('warning', 'While loading');
  deck('ready');
  deck('warning', 'x'.repeat(500));
  deck('warning', 17);
  deck('warning', { text: 'object' });
  for (let index = 0; index < 30; index++) deck('warning', `Problem ${index}`);
  assert.equal(f.warnings.length, 20);
  assert.equal(f.warnings[0], 'While loading');
  assert.equal(f.warnings[1].length, 350);
  assert.equal(f.warnings[2], 'Problem 0');
  assert.equal(f.states.at(-1), 'ready');
  assert.equal(frame.removed, false);
  assert.deepEqual(f.errors, []);
  // Each playback has its own budget; an 'error' (the runner reports a
  // navigation away from the deck) still stops it.
  const next = f.play();
  next.deck('warning', 'After restart');
  assert.equal(f.warnings.at(-1), 'After restart');
  next.deck('error', 'The presentation attempted an unsupported navigation or resource (frame-src).');
  assert.equal(f.states.at(-1), 'error');
  assert.deepEqual(f.origins, ['presentation']);
  assert.equal(next.frame.removed, true);
});

test('positions and slide counts are validated, reported once per change, and remembered for the next start', () => {
  const f = playerFixture({ profile: 'tolerant' });
  const first = f.play();
  for (const position of ['0/0', '0/0', '1/0/2', '1/0/2/3', 'x', 5, '1//2', '1/0/']) first.deck('position', position);
  for (const count of ['9', '9', 'nine', '123456', 9]) first.deck('slides', count);
  assert.deepEqual(f.positions, ['0/0', '1/0/2']);
  assert.deepEqual(f.slides, [9]);
  assert.equal(f.player.currentPosition(), '1/0/2');
  f.player.stop();
  assert.equal(f.player.currentPosition(), '1/0/2', 'stopping keeps the position');
  const resumed = f.play({ position: f.player.currentPosition() });
  assert.equal(resumed.frame.sent[0].fragment, '#/1/0/2');
  resumed.deck('position', '1/0/2');
  resumed.deck('slides', '9');
  assert.deepEqual(f.positions, ['0/0', '1/0/2', '1/0/2'], 'a new playback reports its first position');
  assert.deepEqual(f.slides, [9, 9]);
  for (const position of ['1/0/2/3', '../1', '#/1/0', '1/0?x', 3, undefined]) {
    const run = f.play({ position });
    assert.equal('fragment' in run.frame.sent[0], false, `${String(position)} is not passed on`);
    assert.equal(f.player.currentPosition(), undefined);
  }
  f.play({ position: '4/0' });
  f.player.restart();
  f.frames.at(-1).load();
  assert.equal('fragment' in f.frames.at(-1).sent[0], false, 'Restart begins at the first slide');
});

test('fullscreen requests reach the host only from a tolerant deck, in checked form, after a user action', () => {
  const activation = { isActive: true };
  const f = playerFixture({ profile: 'tolerant', activation });
  const { deck } = f.play();
  deck('fullscreen', 'enter');
  deck('ready');
  deck('fullscreen', 'exit');
  deck('fullscreen', 'toggle');
  deck('fullscreen');
  activation.isActive = false;
  deck('fullscreen', 'enter');
  assert.deepEqual(f.fullscreen, ['enter', 'exit']);
  const other = playerFixture({ profile: 'tolerant' });
  other.play().deck('fullscreen', 'enter');
  assert.deepEqual(other.fullscreen, ['enter'], 'without the User Activation API the request is passed on');
});

test('update replaces the document and restarts a running deck at its last position', () => {
  const f = playerFixture({ profile: 'tolerant' });
  f.player.update('<p>Edited while stopped</p>');
  assert.equal(f.frames.length, 0, 'a stopped player stays stopped');
  const first = f.play();
  assert.equal(f.prepared.at(-1)!.html, '<p>Edited while stopped</p>');
  first.deck('ready');
  first.deck('position', '3/1');
  f.player.update('<p>Second edit</p>');
  assert.equal(first.frame.removed, true);
  const second = f.frames.at(-1);
  second.load();
  assert.equal(second.sent[0].fragment, '#/3/1');
  assert.notEqual(second.sent[0].token, first.token);
  assert.equal(f.prepared.at(-1)!.html, '<p>Second edit</p>');
  first.deck('position', '0/0');
  assert.deepEqual(f.positions, ['3/1'], 'the replaced frame is no longer heard');
  f.player.update('<p>Third edit</p>', { position: '0/0/1' });
  const third = f.frames.at(-1);
  third.load();
  assert.equal(third.sent[0].fragment, '#/0/0/1');
  f.send(third.contentWindow, { qftPresentation: 1, token: third.sent[0].token, kind: 'error', detail: 'Broken' });
  assert.equal(f.states.at(-1), 'error');
  f.player.update('<p>Fixed</p>');
  assert.equal(f.states.at(-1), 'loading', 'an edit replays a deck that an error stopped');
  assert.equal(f.prepared.at(-1)!.html, '<p>Fixed</p>');
  const frames = f.frames.length;
  f.player.destroy();
  f.player.update('<p>Late</p>');
  assert.equal(f.frames.length, frames);
});

/**
 * Runs the deck bootstrap in a fresh realm with stand-ins for the browser
 * classes it adapts. Each stand-in behaves as Chromium does inside the
 * sandboxed blob: document: path History writes throw a SecurityError and
 * fullscreen is refused by the permissions policy.
 */
function deckBootstrap(tolerant: boolean, settings: { hash?: string; reveal?: unknown } = {}) {
  const sent: any[] = [];
  const listeners = { window: new Map<string, ((event: any) => void)[]>(), document: new Map<string, ((event: any) => void)[]>() };
  const on = (map: Map<string, ((event: any) => void)[]>) => (name: string, listener: (event: any) => void) => { map.set(name, [...(map.get(name) ?? []), listener]); };
  class FakeDOMException extends Error { constructor(message: string, name: string) { super(message); this.name = name; } }
  class FakeErrorEvent { constructor(readonly message: string, readonly error?: unknown) {} }
  const historyCalls: unknown[][] = [];
  const refuse = (url: unknown) => { if (typeof url === 'string' && !url.startsWith('#')) throw new FakeDOMException('The operation is insecure.', 'SecurityError'); };
  class History {
    pushState(_state: unknown, _title: string, url?: string) { historyCalls.push(['push', url]); refuse(url); }
    replaceState(state: unknown, _title: string, url?: string) {
      historyCalls.push(['replace', url]);
      if (state === 'uncloneable') throw new FakeDOMException('The object could not be cloned.', 'DataCloneError');
      refuse(url);
    }
  }
  class Element {
    requestFullscreen() { return Promise.reject(new Error('Disallowed by permissions policy')); }
    webkitRequestFullscreen() { return undefined; }
  }
  class Document {
    exitFullscreen() { return Promise.reject(new Error('Document not active')); }
    get fullscreenEnabled() { return false; }
    // An opaque document refuses cookies in both directions.
    get cookie(): string { throw new FakeDOMException('The document is sandboxed and lacks the allow-same-origin flag.', 'SecurityError'); }
    set cookie(_value: string) { throw new FakeDOMException('The document is sandboxed and lacks the allow-same-origin flag.', 'SecurityError'); }
  }
  class Navigator { get wakeLock() { return { request: () => Promise.reject(new Error('Disallowed by permissions policy')) }; } }
  /** Just enough of an element for the message box. */
  class FakeNode {
    children: FakeNode[] = [];
    parent: FakeNode | undefined;
    listeners = new Map<string, ((event: any) => void)[]>();
    attrs: Record<string, string> = {};
    style = { cssText: '' };
    textContent = '';
    className = '';
    id = '';
    type = '';
    shadow: { mode: string; root: FakeNode } | undefined;
    constructor(readonly localName: string) {}
    append(...nodes: FakeNode[]) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter((node) => node !== this); this.parent = undefined; }
    setAttribute(name: string, value: string) { this.attrs[name] = value; }
    addEventListener(name: string, listener: (event: any) => void) { this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]); }
    attachShadow(init: { mode: string }) { const root = new FakeNode('#shadow-root'); this.shadow = { mode: init.mode, root }; return root; }
    focus() { document.activeElement = this; }
    find(name: string): FakeNode | undefined {
      for (const node of [...this.children, ...(this.shadow ? [this.shadow.root] : [])]) {
        if (node.localName === name) return node;
        const found = node.find(name);
        if (found) return found;
      }
      return undefined;
    }
  }
  const documentElement = new FakeNode('html');
  const body = new FakeNode('body');
  documentElement.append(body);
  const document: any = Object.assign(new Document(), {
    addEventListener: on(listeners.document), documentElement, body, activeElement: body,
    createElement: (name: string) => new FakeNode(name),
  });
  const timers: (() => void)[] = [];
  const window: any = {
    localStorage: { length: 0 }, sessionStorage: { length: 0 }, addEventListener: on(listeners.window),
    crypto: { getRandomValues: (array: any) => crypto.getRandomValues(array) },
  };
  if (settings.reveal) window.Reveal = settings.reveal;
  const navigator = new Navigator();
  compiledFunction('presentationBootstrap', {
    window, document, navigator, History, Element, Document, Navigator, URL, Date,
    DOMException: FakeDOMException, ErrorEvent: FakeErrorEvent, location: { hash: settings.hash ?? '' },
    parent: { postMessage(message: unknown) { sent.push(message); } },
    requestAnimationFrame(callback: () => void) { callback(); },
    setTimeout(callback: () => void) { timers.push(callback); return timers.length; },
  })('a'.repeat(36), tolerant);
  return {
    History, Element, document, navigator, historyCalls, ErrorEvent: FakeErrorEvent, window, documentElement, body,
    /** Run the timers that are due, as the next task would. */
    tick() { for (const callback of timers.splice(0)) callback(); },
    /** A key event as the window's capture listeners see it; returns what they did to it. */
    key(type: string, key: string) {
      const effect = { stopped: false, prevented: false };
      const event = { type, key, stopImmediatePropagation() { effect.stopped = true; }, preventDefault() { effect.prevented = true; } };
      for (const listener of listeners.window.get(type) ?? []) { listener(event); if (effect.stopped) break; }
      return effect;
    },
    fire(target: 'window' | 'document', name: string, event: Record<string, unknown> = {}) {
      if (!('type' in event)) Object.defineProperty(event, 'type', { value: name });
      for (const listener of listeners[target].get(name) ?? []) listener(event);
    },
    /** [kind, detail] of every message, after checking the envelope. */
    messages: () => sent.map((message) => {
      assert.equal(message.qftPresentation, 1);
      assert.equal(message.token, 'a'.repeat(36));
      return message.detail === undefined ? [message.kind] : [message.kind, message.detail];
    }),
  };
}

/** A .reveal element with one current slide whose fragments the test controls. */
function revealDom(slideCount: number) {
  const fragments = { total: 0, visible: 0, current: undefined as string | undefined };
  const slide = {
    querySelector(selector: string) {
      if (selector === '.fragment') return fragments.total ? {} : null;
      assert.equal(selector, '.current-fragment');
      if (!fragments.visible) return null;
      return { hasAttribute: () => fragments.current !== undefined, getAttribute: () => fragments.current };
    },
    querySelectorAll(selector: string) { assert.equal(selector, '.fragment.visible'); return { length: fragments.visible }; },
  };
  const root: any = {
    closest: (selector: string) => (selector === '.reveal' ? root : null),
    querySelectorAll(selector: string) {
      // A vertical stack and its present child, in document order.
      if (selector === '.slides section.present') return [{}, slide];
      assert.equal(selector, '.slides section:not(.stack):not([data-visibility="uncounted"])');
      return { length: slideCount };
    },
  };
  return { root, fragments };
}

test('the tolerant bootstrap guards History, hides the wake lock and asks the host for fullscreen', async () => {
  const deck = deckBootstrap(true);
  const history = new deck.History();
  // Reveal.js writes pathname + search on the first slide, Slidev's router a path.
  assert.doesNotThrow(() => history.replaceState({}, '', 'null/1b2c'));
  assert.doesNotThrow(() => history.pushState({}, '', '/2#/2'));
  history.replaceState({}, '', '#/3');
  assert.throws(() => history.replaceState('uncloneable', '', '#/1'), { name: 'DataCloneError' }, 'other errors are not hidden');
  assert.deepEqual(deck.historyCalls, [['replace', 'null/1b2c'], ['replace', '#'], ['push', '/2#/2'], ['push', '#/2'], ['replace', '#/3'], ['replace', '#/1']]);
  assert.equal('wakeLock' in deck.navigator, false, 'Slidev does not ask for a wake lock it cannot get');
  const element = new deck.Element() as any;
  await element.requestFullscreen();
  await element.webkitRequestFullscreen();
  await (deck.document as any).exitFullscreen();
  assert.equal((deck.document as any).fullscreenEnabled, true);
  assert.deepEqual(deck.messages(), [['fullscreen', 'enter'], ['fullscreen', 'enter'], ['fullscreen', 'exit']]);
});

test('in the tolerant profile errors, rejections, missing files and blocked requests are warnings, and the deck still becomes ready', () => {
  const deck = deckBootstrap(true);
  const marked = "Uncaught TypeError: Cannot set properties of null (setting 'marked')";
  deck.fire('window', 'error', new deck.ErrorEvent(marked) as any);
  deck.fire('window', 'error', new deck.ErrorEvent(marked) as any);
  // Firefox throws when a deck assigns location.hash in a blob: document.
  const firefox = "TypeError: Location.hash setter: Access to 'blob:null/1b2c#x' from script denied.";
  deck.fire('window', 'error', new deck.ErrorEvent(firefox) as any);
  deck.fire('window', 'error', new deck.ErrorEvent('') as any);
  deck.fire('window', 'error', { target: { localName: 'img' } });
  deck.fire('window', 'error', { target: { localName: 'video' } });
  deck.fire('window', 'error', { target: { localName: 'link' } });
  deck.fire('window', 'unhandledrejection', { reason: new Error('Wake lock refused') });
  deck.fire('window', 'unhandledrejection', { reason: { toString() { throw new Error('No text'); } } });
  deck.fire('window', 'unhandledrejection', { reason: 'x'.repeat(400) });
  deck.fire('document', 'securitypolicyviolation', { effectiveDirective: 'img-src', blockedURI: 'https://cover.sli.dev/' });
  deck.fire('document', 'securitypolicyviolation', { effectiveDirective: 'script-src-attr', blockedURI: 'inline' });
  deck.fire('document', 'securitypolicyviolation', { effectiveDirective: 'base-uri', blockedURI: '' });
  deck.fire('window', 'load');
  const messages = deck.messages();
  assert.deepEqual(messages.at(-1), ['ready']);
  assert.ok(messages.slice(0, -1).every(([kind]) => kind === 'warning'));
  assert.deepEqual(messages.slice(0, -1).map(([, detail]) => detail), [
    marked, firefox, 'The presentation encountered an error.',
    'A picture in the presentation could not be shown.', 'A video or sound in the presentation could not be played.',
    'A file that the presentation uses could not be loaded.', 'Wake lock refused', 'An asynchronous presentation operation failed.',
    'x'.repeat(350), 'The player blocked a picture (img-src, cover.sli.dev).', 'The player blocked a script (script-src-attr).',
    'The player blocked a resource (base-uri).',
  ]);
  const many = deckBootstrap(true);
  for (let index = 0; index < 25; index++) many.fire('window', 'error', new many.ErrorEvent(`Problem ${index}`) as any);
  many.fire('window', 'load');
  assert.equal(many.messages().filter(([kind]) => kind === 'warning').length, 20, 'at most 20 distinct warnings per playback');
  assert.deepEqual(many.messages().at(-1), ['ready']);
});

test('the strict bootstrap stops at the first problem and adapts nothing', () => {
  const deck = deckBootstrap(false);
  assert.throws(() => new deck.History().replaceState({}, '', 'null/1b2c'), { name: 'SecurityError' });
  assert.equal('wakeLock' in deck.navigator, true);
  assert.equal((deck.document as any).fullscreenEnabled, false);
  deck.fire('window', 'error', { target: { localName: 'img' } });
  deck.fire('document', 'securitypolicyviolation', { effectiveDirective: 'img-src', blockedURI: 'https://cover.sli.dev/' });
  deck.fire('window', 'load');
  assert.deepEqual(deck.messages(), [
    ['error', 'A presentation resource could not be loaded. Rebuild the package with all assets included.'],
    ['error', 'This presentation requested an unsupported resource (img-src). Rebuild it with the portable Slidev packaging tool.'],
  ], 'no ready after an error');
});

test('the tolerant bootstrap keeps cookies in memory and offers crypto.randomUUID; the strict one adapts neither', () => {
  const deck = deckBootstrap(true);
  const document = deck.document;
  assert.equal(document.cookie, '');
  document.cookie = 'visits=1; path=/; SameSite=Lax';
  document.cookie = 'theme=dark; expires=Fri, 31 Dec 2100 23:59:59 GMT';
  document.cookie = 'visits=2';
  assert.equal(document.cookie, 'visits=2; theme=dark');
  document.cookie = 'theme=; max-age=0';
  assert.equal(document.cookie, 'visits=2');
  document.cookie = 'visits=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  assert.equal(document.cookie, '');
  document.cookie = 'kept=1; max-age=60; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  assert.equal(document.cookie, 'kept=1', 'max-age wins over expires');
  document.cookie = `huge=${'x'.repeat(5000)}`;
  for (let index = 0; index < 60; index++) document.cookie = `c${index}=1`;
  assert.equal(document.cookie.split('; ').length, 50, 'at most 50 cookies, none too large');
  const uuid = deck.window.crypto.randomUUID();
  assert.match(uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(deck.window.crypto.randomUUID(), uuid);
  assert.deepEqual(deck.messages(), []);

  const strict = deckBootstrap(false);
  assert.throws(() => strict.document.cookie, { name: 'SecurityError' });
  assert.equal(strict.window.crypto.randomUUID, undefined);
});

test('alert() shows its text in a message box in the deck that returns at once, queues, and keeps keys from the deck', () => {
  const deck = deckBootstrap(true);
  const before = deck.key('keydown', 'ArrowRight');
  assert.deepEqual(before, { stopped: false, prevented: false }, 'without a message, keys reach the deck');
  assert.equal(deck.window.alert('First <b>answer</b>\nline two'), undefined);
  deck.window.alert({ toString() { throw new Error('No text'); } });
  deck.window.alert('y'.repeat(3000));
  const host = deck.documentElement.find('qft-message');
  assert.ok(host, 'the box hangs from the root element');
  assert.equal(host.parent, deck.documentElement);
  assert.equal(host.shadow?.mode, 'closed');
  assert.match(host.style.cssText, /position:fixed!important/);
  const text = host.find('p')!;
  const button = host.find('button')!;
  assert.equal(text.textContent, 'First <b>answer</b>\nline two', 'set as text');
  assert.equal(button.textContent, 'OK');
  assert.equal(deck.document.activeElement, button, 'OK takes focus');
  assert.equal(host.find('div')?.children[0]?.attrs.role, 'alertdialog');
  // Keys while it shows: none reaches the deck; Enter, Space and Escape close it.
  assert.deepEqual(deck.key('keydown', 'ArrowRight'), { stopped: true, prevented: false });
  assert.deepEqual(deck.key('keyup', 'ArrowRight'), { stopped: true, prevented: false });
  assert.deepEqual(deck.key('keydown', 'Tab'), { stopped: true, prevented: true });
  assert.deepEqual(deck.key('keydown', 'Enter'), { stopped: true, prevented: true });
  assert.equal(text.textContent, '', 'the next message: an object that cannot become text');
  assert.deepEqual(deck.key('keydown', ' '), { stopped: true, prevented: true });
  assert.equal(text.textContent, 'y'.repeat(2000), 'at most 2000 characters');
  assert.deepEqual(deck.key('keydown', 'Escape'), { stopped: true, prevented: true }, 'Escape does not reach the host relay');
  assert.equal(deck.documentElement.find('qft-message'), undefined, 'closed after the last message');
  assert.equal(deck.document.activeElement, deck.body, 'focus goes back');
  assert.deepEqual(deck.key('keydown', 'Escape'), { stopped: false, prevented: false });
  // The OK button closes it too.
  deck.window.alert('Again');
  const again = deck.documentElement.find('qft-message')!;
  for (const listener of again.find('button')!.listeners.get('click') ?? []) listener({});
  assert.equal(deck.documentElement.find('qft-message'), undefined);
  assert.deepEqual(deck.messages(), [], 'alert itself sends no warning');
});

test('confirm() and prompt() answer as the sandbox does and warn once per playback', () => {
  const deck = deckBootstrap(true);
  assert.equal(deck.window.confirm('Sure?'), false);
  assert.equal(deck.window.prompt('Your name?'), null);
  assert.equal(deck.window.confirm('Again?'), false);
  assert.deepEqual(deck.messages(), [['warning', 'This presentation asked a question in a pop-up window, which the player cannot show.']]);
  const strict = deckBootstrap(false);
  assert.equal(strict.window.confirm, undefined, 'the strict profile adapts nothing');
});

test('window.open() warns once and returns null; the TypeError that follows in the same task is not a second warning', () => {
  const deck = deckBootstrap(true);
  const newWindow = 'This presentation tried to open a new window, for example the speaker view (S key), which the player cannot do.';
  assert.equal(deck.window.open('about:blank', 'reveal.js - Notes'), null);
  // The notes plugin then sets a property on the null it got.
  const marked = "Uncaught TypeError: Cannot set properties of null (setting 'marked')";
  deck.fire('window', 'error', new deck.ErrorEvent(marked, new TypeError("Cannot set properties of null (setting 'marked')")) as any);
  deck.fire('window', 'error', new deck.ErrorEvent('Uncaught Error: Something else', new Error('Something else')) as any);
  deck.tick();
  deck.fire('window', 'error', new deck.ErrorEvent(marked, new TypeError("Cannot set properties of null (setting 'marked')")) as any);
  assert.equal(deck.window.open(), null);
  assert.deepEqual(deck.messages(), [['warning', newWindow], ['warning', 'Uncaught Error: Something else'], ['warning', marked]],
    'only errors outside that task are reported, and the new-window warning only once');
});

test('a <track> that fires an error is not reported as a video that could not be played', () => {
  const deck = deckBootstrap(true);
  deck.fire('window', 'error', { target: { localName: 'track' } });
  deck.fire('window', 'error', { target: null });
  deck.fire('window', 'error', { target: { localName: 'video' } });
  assert.deepEqual(deck.messages(), [
    ['warning', 'A file that the presentation uses could not be loaded.'],
    ['warning', 'A video or sound in the presentation could not be played.'],
  ]);
});

test('Reveal.js events report the position as h/v/f and the slide count, without needing window.Reveal', () => {
  const deck = deckBootstrap(true);
  const { root, fragments } = revealDom(7);
  deck.fire('document', 'ready', { target: root, indexh: 0, indexv: 0 });
  deck.fire('document', 'slidechanged', { target: root, indexh: 2, indexv: 1 });
  fragments.total = 2; fragments.visible = 1;
  deck.fire('document', 'fragmentshown', { target: root });
  fragments.visible = 2; fragments.current = '5';
  deck.fire('document', 'fragmentshown', { target: root });
  fragments.visible = 0; fragments.current = undefined;
  deck.fire('document', 'fragmenthidden', { target: root });
  deck.fire('document', 'slidechanged', { target: root, indexh: 2, indexv: 1 });
  deck.fire('document', 'ready', { target: { closest: () => null }, indexh: 9, indexv: 9 });
  deck.fire('document', 'ready', { target: null });
  deck.fire('document', 'slidechanged', { target: root, indexh: 10_000, indexv: 0 });
  deck.fire('document', 'slidechanged', { target: root, indexh: 1.5, indexv: 0 });
  assert.deepEqual(deck.messages(), [
    ['position', '0/0'], ['slides', '7'], ['position', '2/1'], ['position', '2/1/0'], ['position', '2/1/5'], ['position', '2/1'],
  ]);
});

test('a restore position is corrected once, when Reveal.js is ready, if the deck did not reach it itself', () => {
  const calls: number[][] = [];
  const { root, fragments } = revealDom(5);
  const reveal = {
    getRevealElement: () => root,
    slide(h: number, v: number, f: number) {
      calls.push([h, v, f]);
      fragments.visible = f + 1;
      deck.fire('document', 'fragmentshown', { target: root });
    },
  };
  // Reveal.js 3 shows slide 3 but not its fragment.
  const deck = deckBootstrap(true, { hash: '#/3/0/1', reveal });
  fragments.total = 2;
  deck.fire('document', 'ready', { target: root, indexh: 3, indexv: 0 });
  deck.fire('document', 'ready', { target: root, indexh: 3, indexv: 0 });
  assert.deepEqual(calls, [[3, 0, 1]]);
  assert.deepEqual(deck.messages(), [['position', '3/0/1'], ['slides', '5']]);

  const reached = deckBootstrap(true, { hash: '#/2/0', reveal });
  fragments.total = 0;
  reached.fire('document', 'ready', { target: root, indexh: 2, indexv: 0 });
  const other = deckBootstrap(true, { hash: '#/2/0', reveal: { ...reveal, getRevealElement: () => ({}) } });
  other.fire('document', 'ready', { target: root, indexh: 0, indexv: 0 });
  const none = deckBootstrap(true, { hash: '#/2/0/x', reveal });
  none.fire('document', 'ready', { target: root, indexh: 0, indexv: 0 });
  assert.deepEqual(calls, [[3, 0, 1]], 'nothing to correct, another deck, or no valid position');
  assert.deepEqual(other.messages(), [['position', '0/0'], ['slides', '5']]);
});

/** preparePresentationDocument with an inert template and parser stand-in. */
function prepareWith(profile: unknown, parsed?: { html?: Record<string, string>; body?: Record<string, string>; bodyName?: string }, found: string[] = []) {
  let parses = 0;
  const attributes = (values: Record<string, string> = {}) => Object.entries(values).map(([name, value]) => ({ name, value }));
  const prepare = compiledFunction('preparePresentationDocument', {
    presentationBootstrap: function presentationBootstrap() {},
    document: {
      createElement() {
        return { innerHTML: '', content: {
          querySelector: (selector: string) => selector === 'title' ? { textContent: '  Waves\n & <phases> ' } : found.includes(selector) ? {} : null,
          querySelectorAll: () => [],
        } };
      },
    },
    DOMParser: class {
      parseFromString(_: string, type: string) {
        assert.equal(type, 'text/html');
        parses += 1;
        return { documentElement: { attributes: attributes(parsed?.html) }, body: { localName: parsed?.bodyName ?? 'body', attributes: attributes(parsed?.body) } };
      }
    },
  });
  const source = parsed ? '<html><body><div class="reveal"></div></body></html>' : '<div class="reveal"></div>';
  return { html: () => prepare(source, 'a'.repeat(36), 'b'.repeat(36), profile === undefined ? undefined : { profile }), parses: () => parses };
}

test('the tolerant profile keeps the title and adds no styles; root attributes come from a real parse', () => {
  const strict = prepareWith(undefined).html();
  assert.match(strict, /\*,\*::before,\*::after\{box-sizing:border-box\}/);
  assert.match(strict, /overflow:hidden/);
  assert.doesNotMatch(strict, /<title>/);
  assert.match(strict, /\("a{36}",false\)/);
  for (const profile of ['Tolerant', 'loose', 1]) assert.match(prepareWith(profile).html(), /box-sizing:border-box/, `${String(profile)} is strict`);
  const tolerant = prepareWith('tolerant').html();
  assert.doesNotMatch(tolerant, /<style>/);
  assert.match(tolerant, /<title>Waves &amp; &lt;phases&gt;<\/title>/);
  assert.match(tolerant, /\("a{36}",true\)/);
  assert.match(tolerant, /<html lang="en">/, 'no root tags: nothing to parse');

  const parsed = prepareWith('tolerant', {
    html: { lang: 'de', manifest: 'offline.appcache', 'data-theme': 'dark' },
    body: { id: 'app', class: 'deck [&>p]:mt-2', style: 'color:red"', onload: 'start()', background: 'paper.png', 'data-x': '1', 'aria-label': 'Deck', role: 'application', 'data-bad"name': 'x' },
  });
  const document = parsed.html();
  assert.equal(parsed.parses(), 1);
  assert.match(document, /<html lang="de" data-theme="dark">/);
  assert.match(document, /<body id="app" class="deck \[&amp;&gt;p\]:mt-2" style="color:red&quot;" data-x="1" aria-label="Deck" role="application">/);
  assert.match(prepareWith('strict', { body: { id: 'app' }, bodyName: 'frameset' }).html(), /<body>/, 'a frameset has no body attributes');
});

test('a linked deck that still needs a separate file gets a message without the Slidev packaging tool', () => {
  const cases: [string, RegExp, RegExp][] = [
    ['script[src],script[href],script[xlink\\:href]', /separate JavaScript files.*Slidev packaging tool/, /still loads a separate script file/],
    ['link[rel~="stylesheet"]', /separate stylesheets/, /still loads a separate stylesheet/],
    ['iframe,frame,frameset,object,embed,portal', /offline Slidev package/, /embeds another web page or a plug-in/],
    ['script[type="importmap"]', /Rebuild it with the portable Slidev packaging tool/, /cannot resolve/],
  ];
  for (const [selector, strict, tolerant] of cases) {
    assert.throws(() => prepareWith('strict', undefined, [selector]).html(), strict);
    assert.throws(() => prepareWith('tolerant', undefined, [selector]).html(), (error: Error) => tolerant.test(error.message) && !/Slidev/.test(error.message));
  }
});

test('isPresentationPosition accepts h/v and h/v/f with at most four digits each', () => {
  for (const value of ['0/0', '12/3', '1/0/0', '9999/9999/9999']) assert.equal(isPresentationPosition(value), true, value);
  for (const value of ['0', '0/0/0/0', '10000/0', '-1/0', '1/0/', '#/1/0', ' 1/0', '1/0\n', 1, null, undefined, ['1/0']]) {
    assert.equal(isPresentationPosition(value), false, String(value));
  }
});

test('oversized or invalid documents are rejected before a DOM or frame is created', () => {
  assert.throws(() => preparePresentationDocument('', 'a'.repeat(36), 'b'.repeat(36)), /smaller than/);
  assert.throws(() => preparePresentationDocument('x'.repeat(24 * 1024 * 1024 + 1), 'a'.repeat(36), 'b'.repeat(36)), /smaller than/);
  assert.throws(() => preparePresentationDocument('<p>Lesson</p>', 'short', 'b'.repeat(36)), /initialized/);
  assert.throws(() => preparePresentationDocument('<p>Lesson</p>', 'a'.repeat(36), 'bad nonce'), /initialized/);
});

test('HTML serialization expansion is rejected immediately instead of timing out in the runner', () => {
  // Six MiB of literal ampersands is below the raw input budget, but a DOM
  // serializer emits five characters per entity and exceeds the message limit.
  const textLength = 6 * 1024 * 1024;
  const raw = `<p>${'&'.repeat(textLength)}</p>`;
  const serialized = `<p>${'&amp;'.repeat(textLength)}</p>`;
  const prepare = compiledFunction('preparePresentationDocument', {
    presentationBootstrap() {},
    document: {
      createElement() {
        return {
          content: { querySelector: () => null, querySelectorAll: () => [] },
          set innerHTML(value: string) { assert.equal(value, raw); },
          get innerHTML() { return serialized; },
        };
      },
    },
  });
  assert.ok(raw.length < 24 * 1024 * 1024);
  assert.throws(() => prepare(raw, 'a'.repeat(36), 'b'.repeat(36)), /too large after preparing.*rebuild the portable ZIP/);
});

test('portable exports keep hostile source inert in the parent and serialize valid JavaScript', () => {
  const html = exportPresentationHtml('<div>Lesson</div><script>parent.__injected=true;</script></script><script>parent.__escape=true;</script>', 'Lesson </title><script>__titleAttack=true</script>');
  assert.equal((html.match(/<script nonce="[a-f0-9]{36}">/g) ?? []).length, 1);
  assert.doesNotMatch(html, /<script>parent\.__/);
  assert.match(html, /Lesson &lt;\/title&gt;&lt;script&gt;/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /worker-src 'none'/);
  assert.match(html, /frame-src 'self' blob:/);
  assert.match(html, /script-src 'unsafe-inline'; script-src-attr 'none'/);
  const script = html.match(/<script nonce="([a-f0-9]{36})">([\s\S]*?)<\/script>/);
  assert.ok(script);
  assert.match(html, new RegExp(`script-src 'nonce-${script[1]}'`));
  assert.match(script[2], /\\u003cscript\\u003eparent/);
  assert.match(script[2], /profile:"strict"/);
  assert.match(exportPresentationHtml('<p>Deck</p>', 'Deck', { profile: 'tolerant' }), /profile:"tolerant"/);
  assert.match(exportPresentationHtml('<p>Deck</p>', 'Deck', { profile: 'Tolerant' as never }), /profile:"strict"/);
  new vm.Script(script[2]);
  new vm.Script(presentationRuntimeSource());
  const nodes = new Map<string, any>();
  let frameCount = 0;
  const getElementById = (id: string) => {
    if (!nodes.has(id)) nodes.set(id, { addEventListener() {}, replaceChildren() {} });
    return nodes.get(id);
  };
  const context = { crypto, AbortController, document: { getElementById, createElement() { frameCount++; return {}; } }, window: { addEventListener() {} } };
  vm.runInNewContext(script[2], context);
  assert.equal(frameCount, 0, 'opening an export never starts imported code automatically');
  assert.equal((context as any).__injected, undefined);
  assert.equal((context as any).__escape, undefined);
  assert.equal((context as any).__titleAttack, undefined);
});

let minifiedRuntime: Promise<string> | undefined;
/** The runtime as the production build ships it: bundled, minified, renamed. */
function minifiedBundle(): Promise<string> {
  minifiedRuntime ??= build({
    entryPoints: [fileURLToPath(new URL('../src/lib/presentation-runtime.ts', import.meta.url))],
    bundle: true,
    write: false,
    minify: true,
    platform: 'browser',
    format: 'iife',
    globalName: 'BundledPresentation',
    target: 'es2022',
  }).then((compiled) => compiled.outputFiles[0].text);
  return minifiedRuntime;
}

/**
 * Generate the actual downloadable file from renamed production functions,
 * then open its script in a fresh realm with none of the bundle's bindings,
 * start it, and run the runner and deck bootstrap it serializes, each in its
 * own realm, up to a real ready handshake.
 */
async function exportedHandshake(profile?: string) {
  const options = profile === undefined ? '' : `, ${JSON.stringify({ profile })}`;
  const exported = vm.runInNewContext(`${await minifiedBundle()}\nBundledPresentation.exportPresentationHtml('<p>Portable lesson</p>', 'Portable lesson'${options});`, { crypto }) as string;
  const outerScript = exported.match(/<script nonce="[a-f0-9]{36}">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(outerScript);
  const nodes = new Map<string, any>();
  const frames: any[] = [];
  const listeners = new Map<string, (...args: any[]) => void>();
  const timers = new Map<number, () => void>();
  const fullscreenCalls: string[] = [];
  let timerId = 0;
  const getElementById = (id: string) => {
    if (!nodes.has(id)) nodes.set(id, {
      listeners: new Map<string, (...args: any[]) => void>(),
      children: [] as any[],
      addEventListener(name: string, listener: (...args: any[]) => void) { this.listeners.set(name, listener); },
      replaceChildren(...children: any[]) { this.children = children; },
      requestFullscreen() { fullscreenCalls.push(id); return Promise.resolve(); },
    });
    return nodes.get(id);
  };
  vm.runInNewContext(outerScript, {
    crypto, AbortController,
    document: {
      getElementById,
      createElement(tag: string) {
        // The fixture has no resource or root attributes; its inert template
        // preserves that known fragment while exercising the real preparer.
        if (tag === 'template') return { innerHTML: '', content: { querySelector: () => null, querySelectorAll: () => [] } };
        assert.equal(tag, 'iframe');
        const frame = {
          attrs: {} as Record<string, string>, style: {}, contentWindow: {} as any,
          sent: [] as any[], load: () => {}, removed: false,
          setAttribute(name: string, value: string) { this.attrs[name] = value; },
          addEventListener(name: string, listener: () => void) { if (name === 'load') this.load = listener; },
          focus() {}, blur() {}, remove() { this.removed = true; },
        };
        frame.contentWindow.postMessage = (message: any) => frame.sent.push(message);
        frames.push(frame);
        return frame;
      },
    },
    window: {
      addEventListener(name: string, listener: (...args: any[]) => void) { listeners.set(name, listener); },
      setTimeout(listener: () => void) { timers.set(++timerId, listener); return timerId; },
      clearTimeout(id: number) { timers.delete(id); },
    },
  });
  assert.equal(frames.length, 0);
  getElementById('start').listeners.get('click')();
  assert.equal(getElementById('status').textContent, 'Opening presentation…');
  assert.equal(frames.length, 1);
  const outer = frames[0];
  assert.equal(outer.attrs.sandbox, 'allow-scripts');
  outer.load();
  assert.equal(outer.sent.length, 1);
  assert.match(outer.sent[0].html, /<p>Portable lesson<\/p>/);
  assert.match(outer.srcdoc, /frame-src blob:/);

  const shellScript = outer.srcdoc.match(/<script nonce="[a-f0-9]{36}">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(shellScript);
  const shell = runner('null', false, shellScript);
  shell.send(shell.parent, outer.sent[0]);
  assert.equal(shell.packages.length, 1);
  const prepared = await shell.packages[0].text();
  const bootstrap = prepared.match(/<script nonce="[a-f0-9]{36}">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(bootstrap);
  const childListeners = new Map<string, (...args: any[]) => void>();
  class Element { requestFullscreen() { return Promise.reject(new Error('Disallowed by permissions policy')); } }
  class Document { exitFullscreen() { return Promise.reject(new Error('Document not active')); } get fullscreenEnabled() { return false; } }
  vm.runInNewContext(bootstrap, {
    parent: { postMessage(message: unknown) { shell.send(shell.frames[0].contentWindow, message); } },
    window: {
      localStorage: { length: 0 }, sessionStorage: { length: 0 },
      addEventListener(name: string, listener: (...args: any[]) => void) { childListeners.set(name, listener); },
    },
    document: { addEventListener() {} },
    History: class { pushState() {} replaceState() {} }, Navigator: class {}, Element, Document,
    location: { hash: '' },
    requestAnimationFrame(callback: () => void) { callback(); },
  });
  childListeners.get('load')!();
  assert.equal(shell.messages.length, 1);
  const relay = () => { for (const data of shell.messages.splice(0)) listeners.get('message')!({ source: outer.contentWindow, data }); };
  relay();
  assert.equal(getElementById('status').textContent, 'Live · use the slide controls or arrow keys');
  assert.equal(timers.size, 0);
  return { prepared, outer, shell, relay, getElementById, fullscreenCalls, deckElement: new Element() };
}

test('a production-minified export starts and completes its isolated handshake without the original bundle', async () => {
  const { prepared, outer, getElementById } = await exportedHandshake();
  assert.match(prepared, /\*,\*::before,\*::after\{box-sizing:border-box\}/, 'the default export keeps the strict profile');
  assert.match(prepared, /\("[a-f0-9]{36}",false\);\}\)\(\);<\/script>/);
  getElementById('stop').listeners.get('click')();
  assert.equal(outer.removed, true);
  assert.equal(getElementById('status').textContent, 'Ready to present · works offline');
});

test('a tolerant export plays with the tolerant profile, and F in the deck asks the export for fullscreen', async () => {
  const { prepared, relay, fullscreenCalls, deckElement } = await exportedHandshake('tolerant');
  assert.doesNotMatch(prepared, /\*,\*::before,\*::after\{box-sizing:border-box\}/);
  assert.match(prepared, /\("[a-f0-9]{36}",true\);\}\)\(\);<\/script>/, 'the deck bootstrap runs tolerant');
  await deckElement.requestFullscreen();
  relay();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(fullscreenCalls, ['stage']);
});

test('a <noscript> fallback is removed before the checks, in both profiles, since scripts always run in the player', () => {
  for (const profile of ['strict', 'tolerant']) {
    let removed = 0;
    const picture = { localName: 'img', attributes: [], hasAttribute: (name: string) => name === 'src', getAttribute: () => 'p.png', removeAttribute() {} };
    const prepare = compiledFunction('preparePresentationDocument', {
      presentationBootstrap() {},
      document: {
        createElement() {
          return {
            innerHTML: '',
            content: {
              // A web-font stylesheet and a picture, parsed as elements because template contents are parsed with scripting off.
              querySelector: (selector: string) => (selector === 'link[rel~="stylesheet"]' && !removed ? {} : null),
              querySelectorAll: (selector: string) => {
                if (selector === 'noscript') return [{ remove() { removed += 1; } }];
                if (selector === '*') return removed ? [] : [picture];
                return [];
              },
            },
          };
        },
      },
    });
    assert.doesNotThrow(() => prepare('<div class="reveal"></div><noscript><link rel="stylesheet" href="f.css"><img src="p.png"></noscript>', 'a'.repeat(36), 'b'.repeat(36), { profile }), profile);
    assert.equal(removed, 1);
  }
});

test('the sandbox, permissions and Content Security Policies keep their exact values', () => {
  // Changing any of these is a decision about the security model: update
  // docs/ARCHITECTURE.md with it, then this test.
  const sandbox = 'allow-scripts';
  const allow = "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; payment 'none'; usb 'none'; serial 'none'; fullscreen 'none'";
  const runnerPolicy = (script: string) => `default-src 'none'; script-src ${script}; script-src-attr 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src blob:; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
  const deckPolicy = (nonce: string) => `default-src 'none'; script-src 'nonce-${nonce}'; script-src-attr 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
  const exportPolicy = (nonce: string) => `default-src 'none'; script-src 'nonce-${nonce}'; script-src-attr 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; frame-src 'self' blob:; connect-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
  const inlineOnly = "script-src 'unsafe-inline'; script-src-attr 'none'";
  const policies = (html: string) => [...html.matchAll(/http-equiv="Content-Security-Policy" content="([^"]*)"/g)].map((match) => match[1]);

  const frame = runner('null');
  frame.send(frame.parent, { type: 'qft-presentation-load', token: 'a'.repeat(36), html: '<p>Deck</p>' });
  assert.equal(frame.frames[0].attrs.sandbox, sandbox);
  assert.equal(frame.frames[0].attrs.allow, allow);
  const f = playerFixture();
  f.player.start();
  assert.equal(f.frames[0].attrs.sandbox, sandbox);
  assert.equal(f.frames[0].attrs.allow, allow);

  assert.deepEqual(policies(runnerHtml), [runnerPolicy("'unsafe-inline'"), inlineOnly]);
  assert.deepEqual(policies(presentationRunnerDocument('c'.repeat(36))), [runnerPolicy(`'nonce-${'c'.repeat(36)}'`), inlineOnly]);
  for (const profile of ['strict', 'tolerant']) assert.deepEqual(policies(prepareWith(profile).html()), [deckPolicy('b'.repeat(36)), inlineOnly], profile);
  const exported = exportPresentationHtml('<p>Deck</p>', 'Deck');
  const nonce = exported.match(/<script nonce="([a-f0-9]{36})">/)?.[1];
  assert.ok(nonce);
  // The export's own two policies come first; the runtime source it carries follows.
  assert.deepEqual(policies(exported).slice(0, 2), [exportPolicy(nonce), inlineOnly]);
});
