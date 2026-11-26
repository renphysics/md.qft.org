import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { build } from 'esbuild';
import ts from 'typescript';
import { exportPresentationHtml, preparePresentationDocument, presentationRunnerDocument, presentationRuntimeSource } from '../src/lib/presentation-runtime';

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
        const value = { attrs: {} as Record<string, string>, style: {}, contentWindow: {}, focusCount: 0, setAttribute(name: string, data: string) { this.attrs[name] = data; }, focus() { this.focusCount++; } };
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

function playerFixture() {
  const frames: any[] = [];
  const states: string[] = [];
  const errors: string[] = [];
  const origins: string[] = [];
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
    preparePresentationDocument(html: string, token: string, nonce: string) { return `prepared|${token}|${nonce}|${html}`; },
    document,
    window: {
      addEventListener(_: string, callback: typeof receive) { receive = callback; },
      setTimeout(callback: () => void) { timers.set(++clock, callback); return clock; },
      clearTimeout(id: number) { timers.delete(id); },
    },
  });
  const player = createPlayer(host, '<div>Compiled Slidev</div>', {
    title: 'Lesson', sandboxUrl: '/presentation-sandbox.html',
    onState(value: string) { states.push(value); }, onError(value: string, origin: string) { errors.push(value); origins.push(origin); }, onEscape() { escapes++; },
  });
  return { player, frames, states, errors, origins, timers, host, document, escapeCount: () => escapes, send: (source: unknown, data: unknown) => receive({ source, data }) };
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

test('a production-minified export starts and completes its isolated handshake without the original bundle', async () => {
  const compiled = await build({
    entryPoints: [fileURLToPath(new URL('../src/lib/presentation-runtime.ts', import.meta.url))],
    bundle: true,
    write: false,
    minify: true,
    platform: 'browser',
    format: 'iife',
    globalName: 'BundledPresentation',
    target: 'es2022',
  });
  // Generate the actual downloadable file from renamed production functions,
  // then open its script in a fresh realm with none of the bundle's bindings.
  const exported = vm.runInNewContext(`${compiled.outputFiles[0].text}\nBundledPresentation.exportPresentationHtml('<p>Portable lesson</p>', 'Portable lesson');`, { crypto }) as string;
  const outerScript = exported.match(/<script nonce="[a-f0-9]{36}">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(outerScript);
  const nodes = new Map<string, any>();
  const frames: any[] = [];
  const listeners = new Map<string, (...args: any[]) => void>();
  const timers = new Map<number, () => void>();
  let timerId = 0;
  const getElementById = (id: string) => {
    if (!nodes.has(id)) nodes.set(id, {
      listeners: new Map<string, (...args: any[]) => void>(),
      children: [] as any[],
      addEventListener(name: string, listener: (...args: any[]) => void) { this.listeners.set(name, listener); },
      replaceChildren(...children: any[]) { this.children = children; },
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
          focus() {}, remove() { this.removed = true; },
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

  // The runner and inner bootstrap are serialized again inside the exported
  // factory. Execute each in its own realm and relay a real ready handshake.
  const shellScript = outer.srcdoc.match(/<script nonce="[a-f0-9]{36}">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(shellScript);
  const shell = runner('null', false, shellScript);
  shell.send(shell.parent, outer.sent[0]);
  assert.equal(shell.packages.length, 1);
  const prepared = await shell.packages[0].text();
  const bootstrap = prepared.match(/<script nonce="[a-f0-9]{36}">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(bootstrap);
  const childListeners = new Map<string, (...args: any[]) => void>();
  vm.runInNewContext(bootstrap, {
    parent: { postMessage(message: unknown) { shell.send(shell.frames[0].contentWindow, message); } },
    window: {
      localStorage: { length: 0 }, sessionStorage: { length: 0 },
      addEventListener(name: string, listener: (...args: any[]) => void) { childListeners.set(name, listener); },
    },
    document: { addEventListener() {} },
    requestAnimationFrame(callback: () => void) { callback(); },
  });
  childListeners.get('load')!();
  assert.equal(shell.messages.length, 1);
  listeners.get('message')!({ source: outer.contentWindow, data: shell.messages[0] });
  assert.equal(getElementById('status').textContent, 'Live · use the slide controls or arrow keys');
  assert.equal(timers.size, 0);
  getElementById('stop').listeners.get('click')();
  assert.equal(outer.removed, true);
  assert.equal(getElementById('status').textContent, 'Ready to present · works offline');
});
