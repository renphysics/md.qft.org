import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { build } from 'esbuild';
import ts from 'typescript';
import { describePresentationLimit, exportPresentationHtml, isPresentationPosition, preparePresentationDocument, presentationRunnerDocument, presentationRuntimeSource } from '../src/lib/presentation-runtime';
import { linkParts } from '../src/lib/presentation-messages';

const runnerHtml = readFileSync(new URL('../public/presentation-sandbox.html', import.meta.url), 'utf8');
const runnerScript = runnerHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(runnerScript);

function runner(origin: string, topLevel = false, script = runnerScript!, navigator?: object) {
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
    window, parent, Blob, ...(navigator ? { navigator } : {}),
    URL: class extends URL {
      static override createObjectURL(value: Blob) { packages.push(value); return `blob:null/package-${packages.length}`; }
      static override revokeObjectURL(value: string) { revoked.push(value); }
    },
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
  return { parent, packages, frames, messages, revoked, listening: Boolean(receive), send(source: unknown, data: unknown) { receive?.({ source, data }); }, dispose: () => dispose?.(), violate: (event: object = { effectiveDirective: 'frame-src' }) => violation?.(event) };
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
  // The deck sends 'left' itself: never relayed, only the shell says it.
  frame.send(child.contentWindow, { qftPresentation: 1, token, kind: 'left', detail: 'example.org' });
  assert.notEqual(frame.messages.at(-1).kind, 'left');
  // The deck's frame went to a website: once, with the host the browser gives (an origin).
  const count = frame.messages.length;
  frame.violate({ effectiveDirective: 'frame-src', blockedURI: 'https://phet.colorado.edu' });
  frame.violate({ effectiveDirective: 'frame-src', blockedURI: 'https://second.example' });
  assert.deepEqual(frame.messages.slice(count).map((message) => [message.kind, message.detail]), [['left', 'phet.colorado.edu']]);
  assert.doesNotMatch(runnerHtml, /unsupported navigation/);
});

test('the shell says that the deck left with a plain host name only, and not before a load', () => {
  const before = runner('null');
  before.violate({ effectiveDirective: 'frame-src', blockedURI: 'https://example.org' });
  assert.deepEqual(before.messages, [], 'nothing before the deck is loaded');
  const cases: [unknown, string][] = [
    ['https://phet.colorado.edu', 'phet.colorado.edu'], ['http://localhost:8080', 'localhost:8080'], ['https://xn--bcher-kva.example', 'xn--bcher-kva.example'],
    ['https://intranet', ''], ['ftp://files.example.org', ''], ['data', ''], ['', ''], [undefined, ''], ['https://[::1]', ''],
  ];
  for (const [blockedURI, host] of cases) {
    const frame = runner('null');
    frame.send(frame.parent, { type: 'qft-presentation-load', token: 'a'.repeat(36), html: '<p>Deck</p>' });
    frame.violate({ effectiveDirective: 'frame-src', blockedURI });
    assert.deepEqual(frame.messages.map((message) => [message.kind, message.detail]), [['left', host]], String(blockedURI));
  }
});

test('the shell says whether the person had just acted in the presentation when it left, by its own activation (X1.2)', () => {
  const cases: [object | undefined, boolean][] = [
    [{ userActivation: { isActive: true } }, true], [{ userActivation: { isActive: false } }, false],
    [{ userActivation: { isActive: 'yes' } }, false], [{ userActivation: { isActive: 1 } }, false], [{}, false], [undefined, false],
    [{ get userActivation() { throw new Error('no'); } }, false],
  ];
  for (const [index, [navigator, active]] of cases.entries()) {
    const frame = runner('null', false, runnerScript!, navigator);
    frame.send(frame.parent, { type: 'qft-presentation-load', token: 'a'.repeat(36), html: '<p>Deck</p>' });
    frame.violate({ effectiveDirective: 'frame-src', blockedURI: 'https://example.org' });
    assert.deepEqual(JSON.parse(JSON.stringify(frame.messages)), [{ qftPresentation: 1, token: 'a'.repeat(36), kind: 'left', detail: 'example.org', active }], `case ${index}`);
  }
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

const hostName = compiledFunction('presentationHostName', {});

function playerFixture(settings: { profile?: string; activation?: { isActive: boolean }; startCheck?: string; onLeft?: boolean } = {}) {
  const lefts: unknown[] = [];
  const frames: any[] = [];
  const states: string[] = [];
  const errors: string[] = [];
  const origins: string[] = [];
  const warnings: string[] = [];
  const positions: string[] = [];
  const slides: number[] = [];
  const fullscreen: string[] = [];
  const stalls: [string, string | undefined][] = [];
  const links: string[] = [];
  const limits: any[] = [];
  const prepared: { html: string; profile: unknown; startCheck?: unknown }[] = [];
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
    crypto, AbortController, URL,
    preparePresentationDocument(html: string, token: string, nonce: string, options: { profile?: unknown; startCheck?: unknown }) {
      prepared.push({ html, profile: options?.profile, ...(options && 'startCheck' in options ? { startCheck: options.startCheck } : {}) });
      return `prepared|${token}|${nonce}|${html}`;
    },
    isPresentationPosition: compiledFunction('isPresentationPosition', {}),
    presentationLimit: compiledFunction('presentationLimit', { presentationHostName: hostName }),
    presentationHostName: hostName,
    presentationLeftText: compiledFunction('presentationLeftText', {}),
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
    ...(settings.startCheck ? { startCheck: settings.startCheck } : {}),
    onLimit(value: unknown) { limits.push(JSON.parse(JSON.stringify(value))); },
    onState(value: string) { states.push(value); }, onError(value: string, origin: string) { errors.push(value); origins.push(origin); }, onEscape() { escapes++; },
    onWarning(value: string) { warnings.push(value); }, onPosition(value: string) { positions.push(value); },
    onSlides(value: number) { slides.push(value); }, onFullscreenRequest(value: string) { fullscreen.push(value); },
    onStalled(detail: string, first: string | undefined) { stalls.push([detail, first]); },
    onLink(url: URL) { links.push(url.href); },
    ...(settings.onLeft ? { onLeft(value: unknown) { lefts.push(JSON.parse(JSON.stringify(value))); } } : {}),
  });
  /** Start, load the runner, and return the frame with a sender of deck messages. */
  const play = (options?: unknown) => {
    player.start(options);
    const frame = frames.at(-1);
    frame.load();
    const token = frame.sent.at(-1).token;
    return { frame, token, deck: (kind: string, detail?: unknown, extra?: object) => receive({ source: frame.contentWindow, data: { qftPresentation: 1, token, kind, detail, ...extra } }) };
  };
  return {
    player, frames, states, errors, origins, warnings, positions, slides, fullscreen, stalls, links, limits, prepared, timers, host, document, play, lefts,
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
function deckBootstrap(tolerant: boolean, settings: { hash?: string; reveal?: unknown; revealRoot?: boolean; revealCheck?: boolean } = {}) {
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
  /** An event whose preventDefault() lives on the prototype, as in browsers. */
  class FakeEvent {
    defaultPrevented = false;
    // new Event('ready') names the type; an object gives the fields (fire() adds a missing type).
    constructor(init: Record<string, unknown> | string = {}) { Object.assign(this, typeof init === 'string' ? { type: init } : init); }
    preventDefault() { this.defaultPrevented = true; }
    get returnValue() { return !this.defaultPrevented; }
    set returnValue(value: boolean) { if (!value) this.defaultPrevented = true; }
  }
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
    hasAttribute(name: string) { return name in this.attrs; }
    removeAttribute(name: string) { delete this.attrs[name]; }
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
    querySelector: (selector: string) => (selector === '.reveal .slides' && settings.revealRoot ? {} : null),
  });
  const timers: [() => void, number][] = [];
  const window: any = {
    localStorage: { length: 0 }, sessionStorage: { length: 0 }, addEventListener: on(listeners.window),
    crypto: { getRandomValues: (array: any) => crypto.getRandomValues(array) },
  };
  if (settings.reveal) window.Reveal = settings.reveal;
  const navigator = new Navigator();
  compiledFunction('presentationBootstrap', {
    window, document, navigator, History, Element, Document, Navigator, URL, Date, Event: FakeEvent,
    DOMException: FakeDOMException, ErrorEvent: FakeErrorEvent, location: { hash: settings.hash ?? '' },
    parent: { postMessage(message: unknown) { sent.push(message); } },
    requestAnimationFrame(callback: () => void) { callback(); },
    setTimeout(callback: () => void, delay = 0) { timers.push([callback, delay]); return timers.length; },
  })('a'.repeat(36), tolerant, settings.revealCheck, hostName);
  return {
    History, Element, document, navigator, historyCalls, ErrorEvent: FakeErrorEvent, Event: FakeEvent, window, documentElement, body,
    /** Run the timers that are due, as the next task would (all of them, whatever their delay). */
    tick() { for (const [callback] of timers.splice(0)) callback(); },
    /** Run only the timers set with a delay of zero, as the end of the current event does. */
    settle() {
      const due = timers.filter(([, delay]) => !delay);
      for (const entry of due) timers.splice(timers.indexOf(entry), 1);
      for (const [callback] of due) callback();
    },
    /** A key event as the window's capture listeners see it; returns what they did to it. */
    key(type: string, key: string) {
      const effect = { stopped: false, prevented: false };
      const event = { type, key, stopImmediatePropagation() { effect.stopped = true; }, preventDefault() { effect.prevented = true; } };
      for (const listener of listeners.window.get(type) ?? []) { listener(event); if (effect.stopped) break; }
      return effect;
    },
    fire(target: 'window' | 'document', name: string, event: object = {}) {
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
  deck.fire('document', 'securitypolicyviolation', { effectiveDirective: 'font-src', blockedURI: 'https://fonts.gstatic.com:8443/s/inter.woff2' });
  deck.fire('document', 'securitypolicyviolation', { effectiveDirective: 'connect-src', blockedURI: 'https://api.example.org/scores' });
  deck.fire('document', 'securitypolicyviolation', { effectiveDirective: 'frame-src', blockedURI: 'https://www.youtube.com/embed/x' });
  // A host the player cannot vouch for as plain letters is left out.
  deck.fire('document', 'securitypolicyviolation', { effectiveDirective: 'media-src', blockedURI: 'https://[::1]:8080/clip.mp4' });
  deck.fire('window', 'load');
  deck.tick();
  // The deck's own texts are warnings; everything the player writes itself is a limit: a code and a host name.
  assert.deepEqual(deck.messages(), [
    ['warning', marked], ['warning', firefox], ['limit', 'failed-step'], ['warning', 'Wake lock refused'], ['warning', 'x'.repeat(350)],
    ['limit', 'blocked-picture cover.sli.dev'], ['limit', 'blocked-script'], ['limit', 'blocked-other'],
    ['limit', 'blocked-font fonts.gstatic.com:8443'], ['limit', 'blocked-request api.example.org'], ['limit', 'blocked-page www.youtube.com'],
    ['limit', 'blocked-media'], ['ready'],
    ['limit', 'missing-picture'], ['limit', 'missing-media'], ['limit', 'missing-file'],
  ]);
  const many = deckBootstrap(true);
  for (let index = 0; index < 25; index++) many.fire('window', 'error', new many.ErrorEvent(`Problem ${index}`) as any);
  many.fire('window', 'load');
  assert.equal(many.messages().filter(([kind]) => kind === 'warning').length, 20, 'at most 20 distinct warnings per playback');
  assert.deepEqual(many.messages().at(-1), ['ready']);
  const hosts = deckBootstrap(true);
  for (let index = 0; index < 25; index++) hosts.fire('document', 'securitypolicyviolation', { effectiveDirective: 'img-src', blockedURI: `https://h${index}.example/` });
  hosts.fire('document', 'securitypolicyviolation', { effectiveDirective: 'img-src', blockedURI: 'https://h0.example/again.png' });
  assert.equal(hosts.messages().length, 20, 'at most 20 limits per playback, each code and host once');
});

test('one blocked picture gives one note, whichever of its two events comes first', () => {
  const deck = deckBootstrap(true);
  const blockedFirst = { localName: 'img', getAttribute: () => 'https://images.example/a.png' };
  deck.fire('document', 'securitypolicyviolation', { target: blockedFirst, effectiveDirective: 'img-src', blockedURI: 'https://images.example/a.png' });
  deck.fire('window', 'error', { target: blockedFirst });
  // The error first, then the policy report, before the moment has passed.
  const errorFirst = { localName: 'img', currentSrc: 'https://images.example/b.png' };
  deck.fire('window', 'error', { target: errorFirst });
  deck.fire('document', 'securitypolicyviolation', { target: errorFirst, effectiveDirective: 'img-src', blockedURI: 'https://images.example/b.png' });
  // A picture made with new Image() and never added: the report goes to the document, with its address.
  const detached = { localName: 'img', src: 'https://images.example/c.png' };
  deck.fire('document', 'securitypolicyviolation', { target: deck.document, effectiveDirective: 'img-src', blockedURI: 'https://images.example/c.png' });
  deck.fire('window', 'error', { target: detached });
  deck.tick();
  assert.deepEqual(deck.messages(), [['limit', 'blocked-picture images.example']]);
  // A picture that is simply missing is still reported, once.
  deck.fire('window', 'error', { target: { localName: 'img', currentSrc: 'blob:null/1' } });
  deck.fire('window', 'error', { target: { localName: 'img' } });
  deck.tick();
  assert.deepEqual(deck.messages().slice(1), [['limit', 'missing-picture']]);
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
  assert.doesNotMatch(document.cookie, /huge=/, 'a cookie over 4096 characters is not stored');
  document.cookie = 'visits=3';
  document.cookie = `kept=${'y'.repeat(4091)}`;
  assert.match(document.cookie, /kept=y{4091}(?:;|$)/, 'one of 4096 characters is, in place of an existing one');
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

test('the message box keeps OK in view and makes the rest of the document inert while it shows; at most 50 messages queue', () => {
  const deck = deckBootstrap(true);
  const slides = deck.document.createElement('div');
  const aside = deck.document.createElement('aside');
  aside.setAttribute('inert', '');
  deck.body.append(slides, aside);
  for (let index = 0; index < 60; index++) deck.window.alert(`Message ${index}`);
  const host = deck.documentElement.find('qft-message')!;
  const style = host.find('style')!.textContent;
  assert.match(style, /\.box\{[^}]*display:flex;flex-direction:column/, 'a column');
  assert.match(style, /\.text\{[^}]*overflow:auto/, 'in which the text scrolls');
  assert.match(style, /\.actions\{flex:none/, 'and OK keeps its place');
  assert.match(style, /@media \(max-height:320px\)/, 'with less space around it in a small frame');
  assert.deepEqual([slides.hasAttribute('inert'), aside.hasAttribute('inert')], [true, true]);
  let shown = 1;
  const text = host.find('p')!;
  while (deck.documentElement.find('qft-message')) {
    assert.equal(text.textContent, `Message ${shown - 1}`);
    deck.key('keydown', 'Enter');
    if (deck.documentElement.find('qft-message')) shown += 1;
  }
  assert.equal(shown, 51, 'the one on show, and a queue of 50');
  assert.deepEqual([slides.hasAttribute('inert'), aside.hasAttribute('inert')], [false, true], 'exactly what was there before is restored');
});

test('confirm() and prompt() answer as the sandbox does and warn once per playback', () => {
  const deck = deckBootstrap(true);
  assert.equal(deck.window.confirm('Sure?'), false);
  assert.equal(deck.window.prompt('Your name?'), null);
  assert.equal(deck.window.confirm('Again?'), false);
  assert.deepEqual(deck.messages(), [['limit', 'question']]);
  const strict = deckBootstrap(false);
  assert.equal(strict.window.confirm, undefined, 'the strict profile adapts nothing');
});

test('window.open() and print() are limits once each and return nothing; the TypeError that follows in the same task is not a second warning', () => {
  const deck = deckBootstrap(true);
  // Reveal.js's notes plugin (S key) names its window.
  assert.equal(deck.window.open('about:blank', 'reveal.js - Notes'), null);
  // The notes plugin then sets a property on the null it got.
  const marked = "Uncaught TypeError: Cannot set properties of null (setting 'marked')";
  deck.fire('window', 'error', new deck.ErrorEvent(marked, new TypeError("Cannot set properties of null (setting 'marked')")) as any);
  deck.fire('window', 'error', new deck.ErrorEvent('Uncaught Error: Something else', new Error('Something else')) as any);
  deck.tick();
  deck.fire('window', 'error', new deck.ErrorEvent(marked, new TypeError("Cannot set properties of null (setting 'marked')")) as any);
  assert.equal(deck.window.open(), null);
  assert.equal(deck.window.open('https://example.org/', '_blank'), null);
  assert.equal(deck.window.print(), undefined);
  deck.window.print();
  assert.deepEqual(deck.messages(), [['limit', 'speaker-view'], ['warning', 'Uncaught Error: Something else'], ['warning', marked], ['limit', 'new-window'], ['limit', 'print']],
    'only errors outside that task are reported, and each limit only once');
  assert.equal(deckBootstrap(false).window.print, undefined, 'the strict profile adapts nothing');
});

test('a <track> that fires an error is not reported as a video that could not be played', () => {
  const deck = deckBootstrap(true);
  deck.fire('window', 'error', { target: { localName: 'track' } });
  deck.tick();
  assert.deepEqual(deck.messages(), [], 'a track error alone gives no message');
  deck.fire('window', 'error', { target: { localName: 'video' } });
  deck.fire('window', 'error', { target: { localName: 'source' } });
  deck.tick();
  assert.deepEqual(deck.messages(), [['limit', 'missing-media']], 'a video error gives exactly one');
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
function prepareWith(profile: unknown, parsed?: { html?: Record<string, string>; body?: Record<string, string>; bodyName?: string }, found: string[] = [], startCheck?: unknown) {
  let parses = 0;
  const attributes = (values: Record<string, string> = {}) => Object.entries(values).map(([name, value]) => ({ name, value }));
  const prepare = compiledFunction('preparePresentationDocument', {
    presentationHostName: hostName,
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
  const options = profile === undefined && startCheck === undefined ? undefined : { profile, ...(startCheck === undefined ? {} : { startCheck }) };
  return { html: () => prepare(source, 'a'.repeat(36), 'b'.repeat(36), options), parses: () => parses };
}

test('the tolerant profile keeps the title and adds no styles; root attributes come from a real parse', () => {
  const strict = prepareWith(undefined).html();
  assert.match(strict, /\*,\*::before,\*::after\{box-sizing:border-box\}/);
  assert.match(strict, /overflow:hidden/);
  assert.doesNotMatch(strict, /<title>/);
  assert.match(strict, /\("a{36}",false,false,/);
  for (const profile of ['Tolerant', 'loose', 1]) assert.match(prepareWith(profile).html(), /box-sizing:border-box/, `${String(profile)} is strict`);
  const tolerant = prepareWith('tolerant').html();
  assert.doesNotMatch(tolerant, /<style>/);
  assert.match(tolerant, /<title>Waves &amp; &lt;phases&gt;<\/title>/);
  assert.match(tolerant, /\("a{36}",true,false,/, 'no start-up check unless the host asks for it');
  assert.match(prepareWith('tolerant', undefined, [], 'reveal').html(), /\("a{36}",true,true,/, 'the Reveal.js start-up check');
  assert.match(prepareWith('strict', undefined, [], 'reveal').html(), /\("a{36}",false,false,/, 'never in the strict profile');
  assert.match(prepareWith('tolerant', undefined, [], 'slidev').html(), /\("a{36}",true,false,/);
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
    presentationHostName: hostName,
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
    // The tolerant start-up check, two seconds after load: nothing to check here.
    setTimeout() { return 0; },
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
  assert.match(prepared, /\("[a-f0-9]{36}",false,false,/);
  getElementById('stop').listeners.get('click')();
  assert.equal(outer.removed, true);
  assert.equal(getElementById('status').textContent, 'Ready to present · works offline');
});

test('a tolerant export plays with the tolerant profile, and F in the deck asks the export for fullscreen', async () => {
  const { prepared, relay, fullscreenCalls, deckElement } = await exportedHandshake('tolerant');
  assert.doesNotMatch(prepared, /\*,\*::before,\*::after\{box-sizing:border-box\}/);
  assert.match(prepared, /\("[a-f0-9]{36}",true,false,/, 'the deck bootstrap runs tolerant, without the start-up check');
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
    presentationHostName: hostName,
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
  // docs/ARCHITECTURE.md with it, then this test. This pin covers the
  // presentation player; the interactive demo frame, public/demo-sandbox.html
  // and the slide and document exports are pinned the same way in
  // tests/interactive-demos.test.ts, tests/demo-sandbox.test.ts and
  // tests/interactive-exports.test.ts.
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

test('the runner relays stalled and link messages only in their checked forms', () => {
  const frame = runner('null');
  const token = 'a'.repeat(36);
  frame.send(frame.parent, { type: 'qft-presentation-load', token, html: '<p>Deck</p>' });
  const child = frame.frames[0].contentWindow;
  const deck = (kind: string, detail?: unknown) => frame.send(child, { qftPresentation: 1, token, kind, detail });
  for (const detail of ['rescued', 'blank', 'recovered', 'Blank', '', undefined, 1, 'rescued\n']) deck('stalled', detail);
  for (const detail of ['question', 'speaker-view', 'blocked-picture images.example.org', 'blocked-font fonts.gstatic.com:443', 'missing-file',
    'blocked-picture', 'Question', 'question images.example.org x', 'blocked-picture Images.example.org', 'blocked-picture <b>x</b>', 'blocked-picture a b',
    'unknown', 'blocked-everything', 'question\n', `blocked-picture ${'a'.repeat(300)}`, 'link-too-long', 'failed-step', 7]) deck('limit', detail);
  const long = `https://example.org/${'a'.repeat(1990)}`;
  for (const detail of ['https://en.wikipedia.org/wiki/Wave', 'HTTP://phet.colorado.edu/', 'javascript:alert(1)', 'https://a b.org/',
    'https:// x', 'https://', 'ftp://example.org/', ' https://example.org/', 'https://example.org/\n', long, 42]) deck('link', detail);
  assert.deepEqual(frame.messages.map((message) => [message.kind, message.detail]), [
    ['stalled', 'rescued'], ['stalled', 'blank'], ['stalled', 'recovered'],
    ['limit', 'question'], ['limit', 'speaker-view'], ['limit', 'blocked-picture images.example.org'], ['limit', 'blocked-font fonts.gstatic.com:443'],
    ['limit', 'missing-file'], ['limit', 'blocked-picture'], ['limit', 'link-too-long'], ['limit', 'failed-step'],
    ['link', 'https://en.wikipedia.org/wiki/Wave'], ['link', 'HTTP://phet.colorado.edu/'],
  ]);
});

test('a Reveal.js deck that stopped before Reveal.initialize is started with the plugins the page defines, and the host is told', () => {
  const initialized: unknown[] = [];
  const markdown = { id: 'markdown' };
  const katex = { id: 'katex' };
  let deck: ReturnType<typeof deckBootstrap>;
  const reveal = {
    isReady: () => false,
    initialize(options: unknown) { initialized.push(options); deck.fire('document', 'ready', { target: { closest: () => ({ querySelectorAll: () => ({ length: 3 }) }) }, indexh: 0, indexv: 0 }); return Promise.resolve(); },
  };
  deck = deckBootstrap(true, { reveal, revealRoot: true, revealCheck: true });
  deck.window.RevealMarkdown = markdown;
  deck.window.RevealMath = { KaTeX: katex };
  Object.defineProperty(deck.window, 'RevealZoom', { get() { throw new Error('temporal dead zone'); } });
  deck.fire('window', 'error', new deck.ErrorEvent('Uncaught SecurityError: cookie') as any);
  deck.fire('window', 'load');
  deck.tick();
  assert.equal(initialized.length, 1);
  const { plugins } = initialized[0] as { plugins: unknown[] };
  assert.deepEqual([...plugins], [markdown, katex]);
  assert.ok(plugins[0] === markdown && plugins[1] === katex, 'the plugins the page defines; RevealMath as its KaTeX part');
  assert.deepEqual(deck.messages().filter(([kind]) => kind !== 'position' && kind !== 'slides'),
    [['warning', 'Uncaught SecurityError: cookie'], ['ready'], ['stalled', 'rescued']]);
  deck.tick();
  assert.equal(deck.messages().filter(([kind]) => kind === 'stalled').length, 1, 'once per playback');
});

test('a deck that starts Reveal.js late, after the rescue, keeps its own settings and plugins, and the notice is withdrawn', async () => {
  const configured: unknown[] = [];
  const registered: unknown[] = [];
  let deck: ReturnType<typeof deckBootstrap>;
  const ready = () => deck.fire('document', 'ready', { target: { closest: () => ({ querySelectorAll: () => ({ length: 3 }) }) }, indexh: 0, indexv: 0 });
  // As Reveal.js 4 to 6: the first initialize() replaces itself with one that refuses a second start.
  const reveal: any = {
    isReady: () => false,
    initialize() {
      reveal.initialize = () => { throw 'Reveal.js has already been initialized.'; };
      reveal.isReady = () => true;
      ready();
      return Promise.resolve();
    },
    configure(options: unknown) { configured.push(options); },
    hasPlugin: (id: string) => id === 'notes',
    registerPlugin(plugin: unknown) { registered.push(plugin); },
  };
  deck = deckBootstrap(true, { reveal, revealRoot: true, revealCheck: true });
  deck.fire('window', 'error', new deck.ErrorEvent("Uncaught TypeError: Cannot read properties of undefined (reading 'track')") as any);
  deck.fire('window', 'load');
  deck.tick();
  assert.deepEqual(deck.messages().at(-1), ['stalled', 'rescued']);
  // Seconds later, the deck's own start.
  const notes = { id: 'notes' };
  const menu = { id: 'menu' };
  const result = deck.window.Reveal.initialize({ slideNumber: 'c/t', controls: false, hash: true, plugins: [notes, menu], dependencies: [{ src: 'x.js' }] });
  assert.ok(result instanceof Promise || typeof result?.then === 'function', 'a promise, as Reveal.js returns');
  assert.equal(await result, reveal);
  // The settings object comes from the deck's realm: compare its content.
  assert.equal(JSON.stringify(configured), JSON.stringify([{ slideNumber: 'c/t', controls: false, hash: true }]), 'its settings, without plugins and dependencies');
  assert.deepEqual(registered, [menu], 'plugins not yet registered');
  assert.deepEqual(deck.messages().at(-1), ['stalled', 'recovered']);
  deck.window.Reveal.initialize({});
  assert.equal(deck.messages().filter(([, detail]) => detail === 'recovered').length, 1, 'once');
  assert.equal(deck.messages().some(([kind, detail]) => kind === 'warning' && /already been initialized/.test(String(detail))), false);

  // A plugin that throws while registering, and settings that Reveal.js refuses, do not reach the deck.
  const fragile: any = { ...reveal, isReady: () => false, initialize() { fragile.isReady = () => true; ready2(); return undefined; }, configure() { throw new Error('bad'); }, registerPlugin() { throw new Error('bad plugin'); } };
  const second = deckBootstrap(true, { reveal: fragile, revealRoot: true, revealCheck: true });
  const ready2 = () => second.fire('document', 'ready', { target: { closest: () => ({ querySelectorAll: () => ({ length: 3 }) }) }, indexh: 0, indexv: 0 });
  second.fire('window', 'error', new second.ErrorEvent('Boom') as any);
  second.fire('window', 'load');
  second.tick();
  assert.doesNotThrow(() => second.window.Reveal.initialize({ plugins: [{ id: 'x' }], width: 10 }));
  assert.deepEqual(second.messages().filter(([kind]) => kind === 'stalled'), [['stalled', 'rescued'], ['stalled', 'recovered']]);
});

test('a deck that cannot be rescued is reported blank, after its first error as the last warning', () => {
  // An ES-module deck: no window.Reveal. The first error is the rejection, not the later warnings.
  const module = deckBootstrap(true, { revealRoot: true, revealCheck: true });
  module.fire('window', 'unhandledrejection', { reason: new Error('Failed to resolve module specifier') });
  module.fire('window', 'error', new module.ErrorEvent('Second problem') as any);
  module.fire('window', 'load');
  module.tick();
  assert.deepEqual(module.messages(), [
    ['warning', 'Failed to resolve module specifier'], ['warning', 'Second problem'], ['ready'],
    ['warning', 'Failed to resolve module specifier'], ['stalled', 'blank'],
  ]);

  // initialize throws (it already ran), or does not reach ready within three seconds.
  const again = deckBootstrap(true, { revealRoot: true, revealCheck: true, reveal: { isReady: () => false, initialize() { throw 'Reveal.js has already been initialized.'; } } });
  again.fire('window', 'error', new again.ErrorEvent('Boom') as any);
  again.fire('window', 'load');
  again.tick();
  assert.deepEqual(again.messages().at(-1), ['stalled', 'blank']);
  const silent = deckBootstrap(true, { revealRoot: true, revealCheck: true, reveal: { isReady: () => false, initialize() { return undefined; } } });
  silent.fire('window', 'error', new silent.ErrorEvent('Boom') as any);
  silent.fire('window', 'load');
  silent.tick();
  assert.equal(silent.messages().some(([kind]) => kind === 'stalled'), false, 'it waits for Reveal.js first');
  silent.tick();
  assert.deepEqual(silent.messages().at(-1), ['stalled', 'blank']);
});

test('no stall is reported without an error, without a .reveal .slides element, after Reveal.js was ready, without the start-up check, or in the strict profile', () => {
  const quiet = deckBootstrap(true, { revealRoot: true, revealCheck: true, reveal: { isReady: () => false, initialize() { throw new Error('unexpected'); } } });
  quiet.fire('window', 'load');
  quiet.tick();
  const page = deckBootstrap(true, { revealCheck: true });
  page.fire('window', 'error', new page.ErrorEvent('Boom') as any);
  page.fire('window', 'load');
  page.tick();
  const started = deckBootstrap(true, { revealRoot: true, revealCheck: true });
  started.fire('document', 'ready', { target: revealDom(2).root, indexh: 0, indexv: 0 });
  started.fire('window', 'error', new started.ErrorEvent('Later problem') as any);
  started.fire('window', 'load');
  started.tick();
  // The TypeError after window.open() is not a start-up error either.
  const opened = deckBootstrap(true, { revealRoot: true, revealCheck: true });
  opened.window.open();
  opened.fire('window', 'error', new opened.ErrorEvent('Uncaught TypeError', new TypeError('x')) as any);
  opened.fire('window', 'load');
  opened.tick();
  // Reveal.js is running although its ready event was not seen (an ES-module deck that replaced .reveal, or one that started before the bootstrap listened).
  const initialized: unknown[] = [];
  const running = deckBootstrap(true, { revealRoot: true, revealCheck: true, reveal: { isReady: () => true, initialize(options: unknown) { initialized.push(options); } } });
  running.fire('window', 'error', new running.ErrorEvent('Later problem') as any);
  running.fire('window', 'load');
  running.tick();
  running.tick();
  assert.deepEqual(initialized, [], 'a running Reveal.js is never started a second time');
  assert.equal(running.messages().some(([kind, detail]) => kind === 'stalled' && detail === 'rescued'), false);
  // Without the host's start-up check (a plain page or a Slidev build with Reveal.js-like markup): no rescue, no stall.
  const homemade: unknown[] = [];
  const plain = deckBootstrap(true, { revealRoot: true, reveal: { isReady: () => false, initialize(options: unknown) { homemade.push(options); } } });
  plain.fire('window', 'error', new plain.ErrorEvent('Uncaught ReferenceError: gtag is not defined') as any);
  plain.fire('window', 'load');
  plain.tick();
  plain.tick();
  assert.deepEqual(homemade, []);
  assert.deepEqual(plain.messages(), [['warning', 'Uncaught ReferenceError: gtag is not defined'], ['ready']], 'only the ordinary run-time note');
  for (const deck of [quiet, page, started, opened]) assert.equal(deck.messages().some(([kind]) => kind === 'stalled'), false);
  const strict = deckBootstrap(false, { revealRoot: true, revealCheck: true });
  strict.fire('window', 'load');
  strict.tick();
  assert.deepEqual(strict.messages(), [['ready']]);
});

test('link clicks never navigate the deck; a trusted click on a link to a website is passed to the host, at most 30 times', () => {
  type Click = { type?: string; button?: number; trusted?: boolean; viaPath?: boolean; deckCancels?: boolean; settle?: boolean };
  const click = (deck: ReturnType<typeof deckBootstrap>, attributes: Record<string, string> | null, options: Click = {}, ancestors: Record<string, string> = {}) => {
    const element = attributes && {
      getAttribute: (name: string) => attributes[name] ?? null,
      // Only what the preview check asks: data-preview-link on the link or an ancestor.
      closest: (selector: string) => {
        const all = { ...ancestors, ...attributes };
        if (selector === '[data-preview-link]:not([data-preview-link="false"])') return 'data-preview-link' in all && all['data-preview-link'] !== 'false' ? {} : null;
        if (selector === '[data-preview-link="false"]') return all['data-preview-link'] === 'false' ? {} : null;
        return null;
      },
    };
    const target = { closest: (selector: string) => { assert.equal(selector, 'a,area'); return element; } };
    const type = options.type ?? 'click';
    const event = new deck.Event({
      ...(options.viaPath ? { composedPath: () => [target], target: null } : { target }),
      isTrusted: options.trusted ?? true, button: options.button ?? (type === 'auxclick' ? 1 : 0),
    });
    deck.fire('window', type, event);
    // The deck's own handler runs after the bootstrap's capture listener.
    if (options.deckCancels) event.preventDefault();
    if (options.settle !== false) deck.settle();
    return event.defaultPrevented;
  };
  const deck = deckBootstrap(true);
  assert.equal(click(deck, { href: 'https://en.wikipedia.org/wiki/Wave' }), true);
  assert.equal(click(deck, { 'xlink:href': 'http://phet.colorado.edu/sims' }, { viaPath: true }), true);
  assert.equal(click(deck, { href: 'https://example.org/middle' }, { type: 'auxclick' }), true, 'a middle click is offered like a click');
  assert.equal(click(deck, { href: 'https://example.org/right' }, { type: 'auxclick', button: 2 }), true, 'another button is only cancelled');
  assert.equal(click(deck, { href: 'https://example.org/scripted' }, { trusted: false }), true, 'a scripted a.click() is cancelled but not offered');
  assert.equal(click(deck, { href: 'https://example.org/prevent' }, { deckCancels: true }), true, 'the deck handles this link itself');
  assert.equal(click(deck, { href: 'https://example.org/preview', 'data-preview-link': '' }, { deckCancels: true }), true);
  assert.equal(click(deck, { href: 'https://example.org/preview-section' }, { deckCancels: true }, { 'data-preview-link': 'true' }), true, 'Reveal.js previews cannot load: offered');
  assert.equal(click(deck, { href: 'https://example.org/no-preview', 'data-preview-link': 'false' }, { deckCancels: true }), true);
  assert.equal(click(deck, { href: 'page2.html' }), true);
  assert.equal(click(deck, { href: 'javascript:alert(1)' }), true);
  assert.equal(click(deck, { href: `https://example.org/${'a'.repeat(2000)}` }), true);
  assert.equal(click(deck, { href: `https://example.org/${'b'.repeat(2000)}` }, { type: 'auxclick' }), true);
  assert.equal(click(deck, {}), true, 'a link without an address');
  assert.equal(click(deck, { href: '#/2' }), false, 'links inside the deck keep working');
  assert.equal(click(deck, null), false);
  assert.deepEqual(deck.messages(), [
    ['link', 'https://en.wikipedia.org/wiki/Wave'], ['link', 'http://phet.colorado.edu/sims'], ['link', 'https://example.org/middle'],
    ['link', 'https://example.org/preview'], ['link', 'https://example.org/preview-section'], ['limit', 'link-too-long'],
  ]);
  // The decision waits until the event has finished: a cancellation by the deck after the capture phase still counts.
  const later = deckBootstrap(true);
  const event = new later.Event({ target: { closest: () => ({ getAttribute: (name: string) => (name === 'href' ? 'https://example.org/late' : null), closest: () => null }) }, isTrusted: true, button: 0 });
  later.fire('window', 'click', event);
  assert.deepEqual(later.messages(), [], 'nothing is sent during the event');
  event.preventDefault();
  later.settle();
  assert.deepEqual(later.messages(), []);
  // Previews also through the previewLinks setting, for links in the slides.
  const previews = deckBootstrap(true, { reveal: { getConfig: () => ({ previewLinks: true }) } });
  const inSlides = { getAttribute: (name: string) => (name === 'href' ? 'https://example.org/setting' : null), closest: (selector: string) => (selector === '.reveal .slides' ? {} : null) };
  const previewEvent = new previews.Event({ target: { closest: () => inSlides }, isTrusted: true, button: 0 });
  previews.fire('window', 'click', previewEvent);
  previewEvent.preventDefault();
  previews.settle();
  assert.deepEqual(previews.messages(), [['link', 'https://example.org/setting']]);
  for (let index = 0; index < 40; index++) click(deck, { href: `https://example.org/${index}` });
  assert.equal(deck.messages().filter(([kind]) => kind === 'link').length, 30);
  const strict = deckBootstrap(false);
  assert.equal(click(strict, { href: 'https://example.org/' }), true);
  assert.deepEqual(strict.messages(), []);
});

test('the player passes on one stall per playback with the deck\'s last warning, and checked links after a user action', () => {
  const activation = { isActive: true };
  const f = playerFixture({ profile: 'tolerant', activation });
  const { deck } = f.play();
  deck('ready');
  deck('warning', 'Uncaught ReferenceError: mermaid is not defined');
  deck('stalled', 'sideways');
  deck('stalled', 'blank');
  deck('stalled', 'rescued');
  assert.deepEqual(f.stalls, [['blank', 'Uncaught ReferenceError: mermaid is not defined']]);
  for (const link of ['https://user:secret@example.org/a?b#c', 'https://xn--bcher-kva.example/', 'https://bücher.example/x', 'javascript:alert(1)', 'https://', 'ftp://example.org/', 7]) deck('link', link);
  activation.isActive = false;
  deck('link', 'https://example.org/without-a-click');
  assert.deepEqual(f.links, ['https://example.org/a?b#c', 'https://xn--bcher-kva.example/', 'https://xn--bcher-kva.example/x']);
  activation.isActive = true;
  for (let index = 0; index < 40; index++) deck('link', `https://example.org/${index}`);
  assert.equal(f.links.length, 30, 'at most 30 per playback');
  const next = f.play();
  next.deck('stalled', 'rescued');
  next.deck('link', 'https://example.org/again');
  assert.deepEqual(f.stalls.at(-1), ['rescued', undefined]);
  assert.equal(f.links.at(-1), 'https://example.org/again');
  const strict = playerFixture({ activation: { isActive: true } });
  const run = strict.play();
  run.deck('stalled', 'blank');
  run.deck('link', 'https://example.org/');
  assert.deepEqual([strict.stalls, strict.links], [[], []]);
});

test('the player turns limit codes into its own sentences, once per code and host, at most 20 per playback', () => {
  const f = playerFixture({ profile: 'tolerant' });
  const { deck } = f.play();
  deck('ready');
  for (const detail of ['question', 'question', 'speaker-view', 'blocked-picture images.example.org', 'blocked-picture images.example.org',
    'blocked-picture cdn.example.org', 'blocked-picture', 'question images.example.org', 'unknown', 'blocked-picture <b>', 'toString', 'constructor', 7, undefined]) deck('limit', detail);
  assert.deepEqual(f.limits.map((limit) => [limit.code, limit.host, limit.counted]), [
    ['question', undefined, true], ['speaker-view', undefined, false], ['blocked-picture', 'images.example.org', true],
    ['blocked-picture', 'cdn.example.org', true], ['blocked-picture', undefined, true],
  ]);
  assert.equal(f.limits[2].text, 'A picture from images.example.org needs the internet, so it is not shown. Ask your AI assistant to put the picture inside the presentation.');
  assert.deepEqual(f.warnings, [], 'limits are not the presentation\'s words');
  for (let index = 0; index < 30; index++) deck('limit', `blocked-script h${index}.example`);
  assert.equal(f.limits.length, 20);
  // A new playback starts counting again.
  const next = f.play();
  next.deck('limit', 'question');
  assert.equal(f.limits.length, 21);
  const strict = playerFixture();
  strict.play().deck('limit', 'question');
  assert.deepEqual(strict.limits, [], 'the strict profile has no limits');
});

test('every limit has a plain sentence of the player\'s own; problems say what to do next', () => {
  const codes = ['question', 'new-window', 'speaker-view', 'print', 'form', 'missing-picture', 'missing-media', 'missing-file', 'failed-step', 'link-too-long'];
  const remote = ['blocked-picture', 'blocked-font', 'blocked-style', 'blocked-script', 'blocked-media', 'blocked-request', 'blocked-page', 'blocked-other'];
  const texts = [...codes.map((code) => describePresentationLimit(code)), ...remote.flatMap((code) => [describePresentationLimit(code), describePresentationLimit(`${code} cdn.example.org:8080`)])];
  for (const limit of texts) {
    assert.ok(limit && limit.text.length < 350, JSON.stringify(limit));
    assert.doesNotMatch(limit.text, /deck|img-src|asynchronous|The presentation reported/i, limit.text);
    // The teacher cannot add files here: the next step goes through the AI assistant
    // (printing names a step the teacher takes outside the player, for a ZIP too).
    if (limit.code !== 'print') assert.doesNotMatch(limit.text, /ZIP/, limit.text);
    if (limit.code !== 'speaker-view' && limit.code !== 'print') {
      assert.equal(limit.counted, true);
      assert.match(limit.text, /\. (?:If [^.]+, a|A)sk your AI assistant (?:to|for) [^.]+\.$/, `${limit.code} says what happened, then what to ask for: ${limit.text}`);
    }
  }
  assert.deepEqual(describePresentationLimit('speaker-view'), { code: 'speaker-view', text: 'The speaker view (S key) is not available in the player.', counted: false });
  // Printing is a limit of the player, not a fault of the presentation: listed, not counted, with a step the teacher can take.
  assert.deepEqual(describePresentationLimit('print'), { code: 'print', counted: false,
    text: "The presentation tried to print, which the player cannot do. To print the slides, open the presentation's HTML file in your web browser (unzip a ZIP first) and print from there." });
  assert.deepEqual(describePresentationLimit('form'), { code: 'form', counted: true,
    text: `The presentation tried to send a form, and the player sends nothing anywhere. If the quiz still shows its result, nothing is lost. Ask your AI assistant to give the button type="button", or to cancel the form's submission in its script.` });
  assert.equal(describePresentationLimit('blocked-picture cdn.example.org')!.text, 'A picture from cdn.example.org needs the internet, so it is not shown. Ask your AI assistant to put the picture inside the presentation.');
  assert.equal(describePresentationLimit('blocked-request cdn.example.org')!.text, 'The presentation tried to load data from cdn.example.org. The player works offline, so the request was stopped. Ask your AI assistant to put the data inside the presentation.');
  assert.equal(describePresentationLimit('blocked-page cdn.example.org')!.text, 'A page from cdn.example.org is embedded in a slide. The player works offline, so it is not shown. Ask your AI assistant to show a picture or a link instead.');
  assert.equal(describePresentationLimit('missing-picture')!.text, 'A picture could not be shown: its file is missing or damaged. Ask your AI assistant to check that file and include it in the presentation.');
  assert.match(describePresentationLimit('blocked-request cdn.example.org:8080')!.text, /^The presentation tried to load data from cdn\.example\.org:8080\./);
  for (const bad of ['question host.example', 'speaker-view x', 'blocked-picture HOST', 'blocked-picture a_b', 'hasOwnProperty', '__proto__', '', 'blocked-picture  x']) {
    assert.equal(describePresentationLimit(bad), undefined, bad);
  }
});

test('a late start is withdrawn only once, and only after the player rescued the deck in the same playback', () => {
  const f = playerFixture({ profile: 'tolerant' });
  const first = f.play();
  first.deck('ready');
  first.deck('stalled', 'recovered');
  assert.deepEqual(f.stalls, [], 'not before a rescue');
  first.deck('stalled', 'rescued');
  first.deck('stalled', 'recovered');
  first.deck('stalled', 'recovered');
  assert.deepEqual(f.stalls, [['rescued', undefined], ['recovered', undefined]]);
  const second = f.play();
  second.deck('stalled', 'recovered');
  second.deck('stalled', 'blank');
  second.deck('stalled', 'recovered');
  assert.deepEqual(f.stalls.slice(2), [['blank', undefined]], 'a new playback, and never after blank');
});

test('the start-up check reaches the deck only when the host asks for it, in the tolerant profile', () => {
  const reveal = playerFixture({ profile: 'tolerant', startCheck: 'reveal' });
  reveal.player.start();
  const plain = playerFixture({ profile: 'tolerant' });
  plain.player.start();
  const strict = playerFixture({ startCheck: 'reveal' });
  strict.player.start();
  assert.deepEqual([reveal.prepared[0], plain.prepared[0], strict.prepared[0]].map((entry) => [entry.profile, entry.startCheck]), [
    ['tolerant', 'reveal'], ['tolerant', undefined], ['strict', undefined],
  ]);
});

test('the tolerant profile keeps the address of a link to a website; every other link loses its address', () => {
  const run = (profile: string) => {
    const links = [
      { localName: 'a', name: 'href', value: 'https://en.wikipedia.org/wiki/Wave' },
      { localName: 'area', name: 'href', value: ' HTTP://phet.colorado.edu/ ' },
      { localName: 'a', name: 'xlink:href', value: 'https://example.org/svg' },
      { localName: 'a', name: 'href', value: 'page2.html' },
      { localName: 'a', name: 'href', value: 'javascript:alert(1)' },
      { localName: 'a', name: 'href', value: 'https://exa mple.org/' },
      { localName: 'a', name: 'href', value: '#/2' },
    ].map((link) => ({
      ...link, removed: false, attributes: [],
      hasAttribute(name: string) { return !this.removed && name === this.name; },
      getAttribute() { return this.value; },
      removeAttribute(name: string) { assert.equal(name, this.name); this.removed = true; },
    }));
    const prepare = compiledFunction('preparePresentationDocument', {
    presentationHostName: hostName,
      presentationBootstrap() {}, URL,
      document: { createElement() { return { innerHTML: '', content: { querySelector: () => null, querySelectorAll: (selector: string) => (selector === '*' ? links : []) } }; } },
    });
    prepare('<a href="x">x</a>', 'a'.repeat(36), 'b'.repeat(36), { profile });
    return links.map((link) => !link.removed);
  };
  assert.deepEqual(run('tolerant'), [true, true, true, false, false, false, true]);
  assert.deepEqual(run('strict'), [false, false, false, false, false, false, true]);
});

test('a standalone export shows the stall and link strips from text, and only its button opens a link', async () => {
  const exported = exportPresentationHtml('<p>Deck</p>', 'Deck', { profile: 'tolerant' });
  for (const id of ['rescued', 'link', 'link-open', 'link-dismiss', 'rescued-dismiss', 'stalled']) assert.match(exported, new RegExp(`id="${id}"`));
  assert.match(exported, /The presentation's start-up script stopped with an error, so the slides are shown with basic settings\./);
  // The address opens only from the export's own button, without an opener.
  assert.equal(exported.match(/window\.open\(/g)?.length, 1);
  // Then the keyboard goes back to the slides, as after Dismiss.
  assert.match(exported, /addEventListener\('click',\(\)=>\{const url=linkUrl;hideLink\(\);if\(url\)window\.open\(url\.href,'_blank','noopener,noreferrer'\);player\.focus\(\);\}\)/);
  assert.match(exported, /strong\.textContent=parts\.host;linkText\.replaceChildren\('The presentation links to ',strong,parts\.rest,parts\.shortened\?'':'\.'\)/, 'the host name is set as text; no full stop after a shortened address');
  // The library's own display of the address (decoded when safe), embedded whole.
  const embedded = /const linkParts=(\(\(\)=>\{const __name=\(value\)=>value;return \(function[\s\S]*?\);\}\)\(\));const leftText=/.exec(exported);
  assert.ok(embedded, 'linkParts is embedded');
  const parts = vm.runInNewContext(embedded[1], { URL, decodeURI, Array }) as typeof linkParts;
  for (const href of ['https://en.wikipedia.org/wiki/Newton%27s_laws', 'https://example.org/a%20b', `https://example.org/${'x'.repeat(90)}`]) {
    assert.equal(JSON.stringify(parts(new URL(href))), JSON.stringify(linkParts(new URL(href))), href);
  }
  // One notice at a time over the slides: the link's takes the basic-settings notice's place.
  assert.match(exported, /const showNotices=\(\)=>\{link\.hidden=!linkUrl;rescued\.hidden=!!linkUrl\|\|!rescuedDue;\};/);
  assert.match(exported, /<main id="stage"><div id="strips"><div class="strip" id="rescued"[\s\S]*?id="link-dismiss">Dismiss<\/button><\/div><\/div><\/div><div id="presentation">/);
  assert.match(exported, /#strips\{position:absolute;top:0;left:0;right:0;height:50%;/, 'the notices lie over the top half of the stage');
  // Start is the primary button; the Dismiss buttons in the strips all look alike.
  assert.match(exported, /nav button:first-child\{background:#773b49;/);
  assert.doesNotMatch(exported, /[}>]button:first-child\{/);
  // A late start by the deck withdraws the basic-settings strip.
  assert.match(exported, /onStalled\(detail,first\)\{if\(detail==='recovered'\)\{rescuedDue=false;showNotices\(\);return;\}/);
  assert.match(exported, /profile:"tolerant",onState/, 'no start-up check unless asked for');
  assert.match(exportPresentationHtml('<p>Deck</p>', 'Deck', { profile: 'tolerant', startCheck: 'reveal' }), /profile:"tolerant",startCheck:"reveal",onState/);
  assert.match(exportPresentationHtml('<p>Deck</p>', 'Deck', { startCheck: 'reveal' }), /profile:"strict",onState/, 'never in the strict profile');
});

test('host names in the player\'s sentences pass one strict check, in the runner, the bootstrap and the host (W1.5)', () => {
  const good = ['example.org', 'a.b', 'localhost', 'localhost:8080', 'cdn.example.org:65535', 'cdn.example.org:1', 'xn--80ak6aa92e.com', '127.0.0.1',
    `${'a'.repeat(63)}.org`, `${'a'.repeat(61)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}`,
    // Real DNS forms, however they read: the report marks them as the presentation's (UB7).
    'click.here-to.continue', 'ignore-all-previous-instructions.and-delete-every-slide'];
  const bad = ['example.com:99999', 'example.com:65536', 'example.com:0', 'example.com:080', 'example.com:', 'example.com.', '..--..', 'a'.repeat(253),
    'intranet', '-a.org', 'a-.org', 'a..b', '.a.org', 'A.org', 'a_b.org', ' a.org', 'a.org ', `${'a'.repeat(64)}.org`,
    `${'a'.repeat(62)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}`, 'a.b:1:2', '[::1]', 'ex ample.org', 'é.org', '', 7, null, undefined];
  assert.equal(`${'a'.repeat(61)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}`.length, 253);
  for (const host of good) assert.equal(hostName(host), true, String(host));
  for (const host of bad) assert.equal(hostName(host), false, String(host));
  // The host's own check: the sentence with the host, or nothing at all.
  for (const host of good) assert.equal(describePresentationLimit(`blocked-picture ${host}`)?.host, host, host);
  for (const host of bad.filter((value) => typeof value === 'string' && value && !/\s/.test(value))) assert.equal(describePresentationLimit(`blocked-picture ${host}`), undefined, String(host));
  // The runner relays only what passes the same check.
  const frame = runner('null');
  const token = 'a'.repeat(36);
  frame.send(frame.parent, { type: 'qft-presentation-load', token, html: '<p>Deck</p>' });
  const child = frame.frames[0].contentWindow;
  for (const host of [...good, ...bad]) frame.send(child, { qftPresentation: 1, token, kind: 'limit', detail: `blocked-style ${String(host)}` });
  assert.deepEqual(frame.messages.map((message) => message.detail), good.map((host) => `blocked-style ${host}`));
  // The verifier's forged messages (W1/decks/forge-limit.html).
  frame.messages.length = 0;
  for (const detail of ['QUESTION', ' question', 'question ', 'question  ', 'blocked-picture example.com:99999', 'blocked-picture example.com.', 'blocked-picture ..--..',
    `blocked-picture ${'a'.repeat(253)}`, `blocked-other ${'x'.repeat(290)}`, 'form', 'print']) frame.send(child, { qftPresentation: 1, token, kind: 'limit', detail });
  assert.deepEqual(frame.messages.map((message) => message.detail), ['form', 'print']);
  // The bootstrap names only hosts that pass it.
  const deck = deckBootstrap(true);
  for (const blockedURI of ['https://example.com./a.png', 'https://intranet/a.png', 'https://images.example.org:8443/a.png', 'http://localhost:3000/a.png'])
    deck.fire('document', 'securitypolicyviolation', { effectiveDirective: 'img-src', blockedURI });
  assert.deepEqual(deck.messages(), [['limit', 'blocked-picture'], ['limit', 'blocked-picture images.example.org:8443'], ['limit', 'blocked-picture localhost:3000']]);
  // Linear in its input: a long hostile value is answered at once.
  const started = performance.now();
  for (let index = 0; index < 2000; index++) { hostName(`${'a-'.repeat(120)}a.${'b'.repeat(10)}:65535`); hostName('a.'.repeat(129)); hostName('-'.repeat(259)); }
  assert.ok(performance.now() - started < 1000);
});

test('a deck that replaces itself with another page ends its playback; the host is told once, with the runner\'s activation (W1.1, X1.2)', () => {
  // This page's own activation (the click on Start) does not count.
  const f = playerFixture({ profile: 'tolerant', onLeft: true, activation: { isActive: false } });
  const { deck } = f.play();
  deck('ready');
  deck('left', 'Bad Host', { active: true });
  deck('left', 'example.com.', { active: true });
  deck('left', 7, { active: true });
  assert.deepEqual(f.lefts, [], 'a detail that fails the host check is dropped');
  deck('left', 'phet.colorado.edu', { active: true });
  deck('left', '', { active: true });
  deck('limit', 'question');
  deck('ready');
  deck('position', '1/0');
  assert.deepEqual(f.lefts, [{ host: 'phet.colorado.edu', active: true }]);
  assert.deepEqual([f.limits, f.positions, f.errors], [[], [], []], 'nothing more of that playback counts');
  assert.equal(f.player.isRunning(), true, 'the host decides what follows');
  // A new playback accepts messages again; without a host and without activation.
  const next = f.play();
  next.deck('limit', 'question');
  next.deck('left', '');
  assert.equal(f.limits.length, 1);
  assert.deepEqual(f.lefts.at(-1), { active: false });
  // Not active unless the runner says true: false, missing or not a boolean, also while this page has the Start click's activation.
  for (const extra of [{ active: false }, {}, { active: 'true' }, { active: 1 }, { active: { valueOf: () => true } }]) {
    const idle = playerFixture({ profile: 'tolerant', onLeft: true, activation: { isActive: true } });
    idle.play().deck('left', '', extra);
    assert.deepEqual(idle.lefts, [{ active: false }], JSON.stringify(extra));
  }
  // Without onLeft, and always in the strict profile: the player stops, in its own words.
  for (const plain of [playerFixture({ profile: 'tolerant' }), playerFixture({ onLeft: true })]) {
    plain.play().deck('left', 'phet.colorado.edu');
    assert.deepEqual(plain.errors, ['The presentation tried to replace its slides with a page from phet.colorado.edu, so the player stopped it. Choose Start to play it again. Ask your AI assistant to use an ordinary link for that page.']);
    assert.deepEqual(plain.origins, ['player']);
    assert.equal(plain.states.at(-1), 'error');
    assert.deepEqual(plain.lefts, []);
  }
  const nohost = playerFixture({ profile: 'tolerant' });
  nohost.play().deck('left', '');
  assert.match(nohost.errors[0], /^The presentation tried to replace its slides with a page, so the player stopped it\./);
});

test('window.open() of a website right after the person acted is offered as a link; otherwise it stays a new-window limit (W1.1)', () => {
  const deck = deckBootstrap(true);
  // This fake browser has no navigator.userActivation: a trusted input within the last second counts.
  deck.window.open('https://phet.colorado.edu/sim');
  deck.fire('window', 'pointerdown', { isTrusted: false });
  deck.window.open('https://phet.colorado.edu/sim');
  assert.deepEqual(deck.messages(), [['limit', 'new-window']], 'no person, no link');
  deck.fire('window', 'pointerdown', { isTrusted: true });
  assert.equal(deck.window.open('https://phet.colorado.edu/sims/html/forces?x=1#a', '_blank'), null);
  deck.window.open({ toString: () => 'https://example.org/object' });
  deck.window.open('sim.html');
  deck.window.open('//example.org/protocol-relative');
  deck.window.open(`https://example.org/${'a'.repeat(2000)}`);
  deck.window.open('', 'reveal.js - Notes');
  assert.deepEqual(deck.messages().slice(1), [
    ['link', 'https://phet.colorado.edu/sims/html/forces?x=1#a'], ['link', 'https://example.org/object'], ['limit', 'link-too-long'], ['limit', 'speaker-view'],
  ]);
});

test('top.location.href = address is offered as a link right after the person acted, otherwise a blocked-page note, never the raw error (X1.1)', () => {
  const refused = (address: string) => {
    const error = new Error(`Failed to set a named property 'href' on 'Location': The current window does not have permission to navigate the target frame to '${address}'.`);
    error.name = 'SecurityError';
    return error;
  };
  const deck = deckBootstrap(true);
  const fire = (address: string) => deck.fire('window', 'error', new deck.ErrorEvent(`Uncaught SecurityError: ${refused(address).message}`, refused(address)) as any);
  fire('https://example.org/sim');
  deck.fire('window', 'pointerdown', { isTrusted: true });
  fire('https://phet.colorado.edu/sims/html/forces');
  fire('https://intranet/page');
  assert.deepEqual(deck.messages(), [['limit', 'blocked-page example.org'], ['link', 'https://phet.colorado.edu/sims/html/forces'], ['link', 'https://intranet/page']]);
  // Another SecurityError, or one without a website address, stays the presentation's own.
  const other = deckBootstrap(true);
  const plain = new Error('The operation is insecure.');
  plain.name = 'SecurityError';
  other.fire('window', 'error', new other.ErrorEvent('Uncaught SecurityError: The operation is insecure.', plain) as any);
  const local = refused('blob:null/abc');
  other.fire('window', 'error', new other.ErrorEvent('Uncaught SecurityError: x', local) as any);
  assert.deepEqual(other.messages(), [['warning', 'Uncaught SecurityError: The operation is insecure.'], ['warning', 'Uncaught SecurityError: x']]);
});

test('an error that carries only the browser\'s "Uncaught" has no text of its own (W1.8)', () => {
  const deck = deckBootstrap(true);
  for (const message of ['Uncaught ', 'Uncaught', 'Uncaught undefined', 'Uncaught null', "Uncaught ''", '']) deck.fire('window', 'error', new deck.ErrorEvent(message) as any);
  deck.fire('window', 'error', new deck.ErrorEvent('Uncaught Error: boom') as any);
  deck.fire('window', 'error', new deck.ErrorEvent('Uncaught nullable is not defined') as any);
  assert.deepEqual(deck.messages(), [['limit', 'failed-step'], ['warning', 'Uncaught Error: boom'], ['warning', 'Uncaught nullable is not defined']]);
  // The check is linear in the message, whatever the deck throws.
  const started = performance.now();
  deck.fire('window', 'error', new deck.ErrorEvent(`Uncaught${' '.repeat(2_000_000)}x`) as any);
  deck.fire('window', 'error', new deck.ErrorEvent(`${' \t'.repeat(1_000_000)}Uncaught`) as any);
  assert.ok(performance.now() - started < 1000);
});

test('the standalone export stops by itself when the deck replaces itself with another page, in its own words', () => {
  const exported = exportPresentationHtml('<p>Deck</p>', 'Deck', { profile: 'tolerant' });
  assert.match(exported, /onLeft\(left\)\{player\.stop\(\);problem\.textContent=leftText\(left\.host\);problem\.hidden=false;\}/);
  const embedded = /const leftText=(\(host\)=>[^;]*);/.exec(exported);
  assert.ok(embedded);
  const leftText = vm.runInNewContext(embedded[1]) as (host?: string) => string;
  assert.equal(leftText('phet.colorado.edu'), 'The presentation tried to replace its slides with a page from phet.colorado.edu, so the player stopped it. Choose Start presentation to play it again. Ask your AI assistant to use an ordinary link for that page.');
  assert.match(leftText(undefined), /^The presentation tried to replace its slides with a page, so the player stopped it\./);
});

test('a blocked picture whose current address differs from the blocked one still gives one note (W6.4)', () => {
  const deck = deckBootstrap(true);
  // A srcset candidate or a redirect: the element is remembered, not only the address.
  const picture = { localName: 'img', currentSrc: 'https://images.example/large.png', src: 'https://images.example/small.png' };
  deck.fire('document', 'securitypolicyviolation', { target: picture, effectiveDirective: 'img-src', blockedURI: 'https://cdn.images.example/large.png' });
  deck.fire('window', 'error', { target: picture });
  deck.tick();
  assert.deepEqual(deck.messages(), [['limit', 'blocked-picture cdn.images.example']]);
});

test('a Reveal.js deck that stopped on a rejection without a reason is rescued too (W6.3)', () => {
  let deck: ReturnType<typeof deckBootstrap>;
  const reveal = {
    isReady: () => false,
    initialize() { deck.fire('document', 'ready', { target: { closest: () => ({ querySelectorAll: () => ({ length: 3 }) }) }, indexh: 0, indexv: 0 }); return Promise.resolve(); },
  };
  deck = deckBootstrap(true, { reveal, revealRoot: true, revealCheck: true });
  deck.fire('window', 'unhandledrejection', { reason: undefined });
  deck.fire('window', 'load');
  deck.tick();
  assert.deepEqual(deck.messages().filter(([kind]) => kind !== 'position' && kind !== 'slides'), [['limit', 'failed-step'], ['ready'], ['stalled', 'rescued']]);
});

test('a late start while the rescue is still not ready leaves the decision to the check: blank stays blank (W1.3)', () => {
  // The rescue's own start never becomes ready (a plugin whose init rejects); the deck calls initialize at 3.5 s.
  const reveal: any = { isReady: () => false, initialize() { return Promise.resolve(); }, configure() { throw new Error('not ready'); } };
  const deck = deckBootstrap(true, { reveal, revealRoot: true, revealCheck: true });
  deck.fire('window', 'error', new deck.ErrorEvent('Uncaught ReferenceError: analytics is not defined') as any);
  deck.fire('window', 'load');
  deck.tick();
  assert.equal(deck.messages().some(([kind]) => kind === 'stalled'), false);
  deck.window.Reveal.initialize({ hash: true });
  deck.tick();
  assert.deepEqual(deck.messages().filter(([kind]) => kind === 'stalled'), [['stalled', 'blank']]);
  // When Reveal.js then becomes ready after the deck's late start, no notice at all: its own settings apply.
  const slow: any = { isReady: () => false, initialize() { return Promise.resolve(); }, configure() {} };
  const quiet = deckBootstrap(true, { reveal: slow, revealRoot: true, revealCheck: true });
  const ready = () => quiet.fire('document', 'ready', { target: { closest: () => ({ querySelectorAll: () => ({ length: 3 }) }) }, indexh: 0, indexv: 0 });
  quiet.fire('window', 'error', new quiet.ErrorEvent('Boom') as any);
  quiet.fire('window', 'load');
  quiet.tick();
  quiet.window.Reveal.initialize({ hash: true });
  slow.isReady = () => true;
  ready();
  quiet.tick();
  assert.equal(quiet.messages().some(([kind]) => kind === 'stalled'), false);
});

test('after the rescue, ready handlers that the deck registers run once after its late start, and new Reveal() on the same element is that start (W1.4)', async () => {
  const configured: unknown[] = [];
  const calls: string[] = [];
  let deck: ReturnType<typeof deckBootstrap>;
  const root = { id: 'root' };
  const native: Record<string, unknown[]> = {};
  const fire = () => deck.fire('document', 'ready', { target: { closest: () => ({ querySelectorAll: () => ({ length: 3 }) }) }, indexh: 0, indexv: 0 });
  // As Reveal.js 4 to 6: the global is the constructor, and initialize() copies the instance onto it.
  const Reveal: any = function (this: any, element: unknown, options: unknown) { calls.push(`constructed ${element === root ? 'root' : 'other'} ${JSON.stringify(options)}`); };
  Object.assign(Reveal, {
    isReady: () => false,
    initialize() {
      Object.assign(Reveal, {
        isReady: () => true,
        initialize: () => { throw 'Reveal.js has already been initialized.'; },
        on(type: string, handler: unknown) { (native[type] ??= []).push(handler); },
        addEventListener(type: string, handler: unknown) { (native[type] ??= []).push(handler); },
        off(type: string, handler: unknown) { native[type] = (native[type] ?? []).filter((entry) => entry !== handler); },
        removeEventListener(type: string, handler: unknown) { native[type] = (native[type] ?? []).filter((entry) => entry !== handler); },
        configure(options: unknown) { configured.push(options); },
        getIndices: () => ({ h: 2, v: 1 }),
        getCurrentSlide: () => ({ id: 'slide' }),
        getRevealElement: () => root,
      });
      fire();
      return Promise.resolve();
    },
  });
  deck = deckBootstrap(true, { reveal: Reveal, revealRoot: true, revealCheck: true });
  deck.fire('window', 'error', new deck.ErrorEvent('Uncaught TypeError: x') as any);
  deck.fire('window', 'load');
  deck.tick();
  assert.deepEqual(deck.messages().at(-1), ['stalled', 'rescued']);
  const api = deck.window.Reveal;
  const events: any[] = [];
  api.on('ready', (event: any) => events.push(['before', event.type, event.indexh, event.indexv, event.currentSlide.id]));
  const removed = () => events.push(['removed']);
  api.addEventListener('ready', removed);
  api.removeEventListener('ready', removed);
  api.addEventListener('ready', { handleEvent: () => events.push(['object']) });
  api.on('ready', () => { throw new Error('handler boom'); });
  api.on('slidechanged', () => events.push(['slidechanged']));
  api.initialize({ slideNumber: 'c/t' });
  api.on('ready', () => events.push(['after']));
  assert.deepEqual([...events], [], 'after the task that called initialize');
  deck.settle();
  assert.deepEqual([...events], [['before', 'ready', 2, 1, 'slide'], ['object'], ['after']]);
  assert.ok(deck.messages().some(([kind, detail]) => kind === 'warning' && detail === 'handler boom'), 'a failing handler is the deck\'s own warning');
  assert.deepEqual(native.ready?.length, 4, 'the handlers are still registered with Reveal.js too');
  api.on('ready', () => events.push(['too late']));
  api.initialize({});
  deck.settle();
  assert.deepEqual(events.length, 3, 'once, and nothing registered after the late start');

  // new Reveal(element, options) on the rescued element is the late start; another element gets its own deck.
  configured.length = 0;
  const instance = new deck.window.Reveal(root, { controls: false, hash: true });
  assert.equal(calls.length, 0, 'not constructed again');
  assert.equal(await instance.initialize({ width: 1200 }), Reveal);
  assert.equal(JSON.stringify(configured), JSON.stringify([{ controls: false, hash: true, width: 1200 }]));
  assert.equal(instance.getIndices().h, 2, 'the running slides');
  new deck.window.Reveal({ id: 'other' }, { hash: false });
  assert.deepEqual(calls, ['constructed other {"hash":false}']);
});

test('a link that the deck cancels with event.returnValue = false is not offered; the wrapper keeps the name preventDefault (W1.6)', () => {
  const deck = deckBootstrap(true);
  assert.equal(deck.Event.prototype.preventDefault.name, 'preventDefault');
  const link = (href: string) => ({ target: { closest: () => ({ getAttribute: (name: string) => (name === 'href' ? href : null), closest: () => null }) }, isTrusted: true, button: 0 });
  const cancelled = new deck.Event(link('https://returnvalue.example/x'));
  deck.fire('window', 'click', cancelled);
  (cancelled as any).returnValue = false;
  assert.equal(cancelled.defaultPrevented, true);
  const kept = new deck.Event(link('https://plain.example/p'));
  deck.fire('window', 'click', kept);
  (kept as any).returnValue = true;
  deck.settle();
  assert.deepEqual(deck.messages(), [['link', 'https://plain.example/p']]);
});

test('a Reveal.js link preview of a link just offered adds no "embedded page" note (W1.7)', () => {
  const deck = deckBootstrap(true);
  const preview = { getAttribute: (name: string) => (name === 'href' ? 'https://plain.example/p' : name === 'data-preview-link' ? '' : null),
    closest: (selector: string) => (selector === '[data-preview-link]:not([data-preview-link="false"])' ? {} : null) };
  const event = new deck.Event({ target: { closest: () => preview }, isTrusted: true, button: 0 });
  deck.fire('window', 'click', event);
  event.preventDefault();
  deck.settle();
  // Reveal.js opens its overlay with an iframe, which the policy blocks: the browser reports the full address or its origin.
  deck.fire('document', 'securitypolicyviolation', { effectiveDirective: 'frame-src', blockedURI: 'https://plain.example/p' });
  deck.fire('document', 'securitypolicyviolation', { effectiveDirective: 'frame-src', blockedURI: 'https://plain.example' });
  deck.fire('document', 'securitypolicyviolation', { effectiveDirective: 'frame-src', blockedURI: 'https://video.example/embed' });
  deck.fire('document', 'securitypolicyviolation', { effectiveDirective: 'img-src', blockedURI: 'https://plain.example/p' });
  assert.deepEqual(deck.messages(), [['link', 'https://plain.example/p'], ['limit', 'blocked-page video.example'], ['limit', 'blocked-picture plain.example']]);
});
