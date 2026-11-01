import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import vm from 'node:vm';
import { interactiveFence, MAX_INTERACTIVE_CODE_LENGTH, renderInteractiveFence } from '../src/lib/interactive-demos';
import { renderMarkdown, renderMarkdownSlides } from '../src/lib/render-markdown';
import { interactiveRuntimeSource } from '../src/scripts/interactive-demo-runtime';

function payloadFrom(html: string): { html: string; title: string; preset?: string } {
  const encoded = html.match(/<template data-demo-source>([\s\S]*?)<\/template>/)?.[1];
  assert.ok(encoded);
  return JSON.parse(encoded.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&'));
}

describe('explicit interactive Markdown fences', () => {
  it('keeps custom HTML inert and lossless, including attempted template and script breakout text', () => {
    const source = '<style>body{color:red}</style><button id="x">Run</button>\n<script>const text="</template><img src=x onerror=alert(1)>";</script>';
    const result = renderMarkdown(interactiveFence({ title: 'A "quoted" `<demo>`', html: source }));
    assert.deepEqual(result.errors, []);
    assert.equal((result.html.match(/<template\b/g) ?? []).length, 1);
    assert.doesNotMatch(result.html, /<script\b|<iframe\b|<img src=x/i);
    const data = payloadFrom(result.html);
    assert.equal(data.title, 'A "quoted" `<demo>`');
    assert.equal(data.html, `${source}\n`);
    assert.match(result.html, /data-demo-run/);
  });

  it('does not execute or upgrade ordinary HTML and JavaScript fences', () => {
    const result = renderMarkdown('```javascript\nalert("hello")\n```\n\n```html\n<script>alert(1)</script>\n```\n\n<script>alert(2)</script>');
    assert.doesNotMatch(result.html, /class="qft-demo"|<iframe\b|<script\b/);
    assert.match(result.html, /language-javascript/);
    assert.match(result.html, /&lt;script&gt;/);
  });

  it('generates fences that retain inner backticks and preserve a following slide boundary', () => {
    const source = '<pre>```javascript\nconst answer = 42;\n```</pre><script>const s=`hello`;</script>';
    const markdown = `${interactiveFence({ html: source })}\n---\n\n## The next slide`;
    const result = renderMarkdownSlides(markdown);
    assert.equal(result.slides.length, 2);
    assert.equal(payloadFrom(result.slides[0].html).html, `${source}\n`);
    assert.match(result.slides[1].html, /The next slide/);
  });

  it('renders all four presets with a static poster and a portable self-contained payload', () => {
    for (const id of ['wave-packet', 'bloch-sphere', 'effective-potential', 'interference']) {
      const result = renderMarkdownSlides(interactiveFence({ preset: id }));
      assert.deepEqual(result.errors, []);
      assert.match(result.html, /data-demo-poster><svg/);
      assert.doesNotMatch(result.html, /<script\b|<iframe\b/);
      assert.equal(payloadFrom(result.html).preset, id);
      assert.ok(payloadFrom(result.html).html.includes('<canvas'));
    }
  });

  it('does not mistake separators or mathematics inside a demo for outer slide content', () => {
    const result = renderMarkdownSlides('```interactive\n<div>\n---\n$$not an equation$$\n</div>\n```\n\n---\n\n## Real slide\n\n$E=mc^2$');
    assert.equal(result.slides.length, 2);
    assert.equal(result.mathCount, 1);
    assert.deepEqual(result.errors, []);
  });

  it('reports malformed and ambiguous instructions without emitting runnable cards', () => {
    for (const [info, code] of [
      ['interactive unknown', ''],
      ['interactive wave-packet', '<p>unexpected custom source</p>'],
      ['interactive title="unterminated', '<p>text</p>'],
      ['interactive title="Title" src="https://example.org"', '<p>text</p>'],
      ['interactive', ''],
    ]) {
      const result = renderInteractiveFence(info, code, 4);
      assert.ok(result.error);
      assert.doesNotMatch(result.html, /data-demo-source|data-demo-run|<iframe/);
    }
  });

  it('keeps source available while bounding custom code and rendered demo count', () => {
    assert.throws(() => interactiveFence({ html: 'x'.repeat(MAX_INTERACTIVE_CODE_LENGTH + 1) }), /100,000/);
    const tooLong = renderMarkdown('```interactive\n' + 'x'.repeat(MAX_INTERACTIVE_CODE_LENGTH + 1) + '\n```');
    assert.equal(tooLong.errors.length, 1);
    assert.match(tooLong.errors[0].message, /100,000/);
    const many = renderMarkdown(Array.from({ length: 22 }, () => interactiveFence({ preset: 'wave-packet' })).join('\n'));
    assert.equal((many.html.match(/class="qft-demo"/g) ?? []).length, 20);
    assert.equal(many.errors.length, 1);
    assert.match(many.errors[0].message, /20 interactive demos/);
  });

  it('uses stable snapshot identities while distinguishing repeated blocks', () => {
    const source = `${interactiveFence({ preset: 'interference' })}\n${interactiveFence({ preset: 'interference' })}`;
    const first = renderMarkdown(source);
    const second = renderMarkdownSlides(source);
    const ids = [...first.html.matchAll(/data-demo-id="([^"]+)"/g)].map((match) => match[1]);
    const otherIds = [...second.html.matchAll(/data-demo-id="([^"]+)"/g)].map((match) => match[1]);
    assert.equal(new Set(ids).size, 2);
    assert.deepEqual(otherIds, ids);
    assert.equal(renderMarkdown(source).html, first.html);
  });
});

it('the standalone controller source initializes and disposes without importing editor module state', () => {
  const root = { addEventListener() {}, querySelectorAll() { return []; }, contains() { return true; } };
  const controller = vm.runInNewContext(`(${interactiveRuntimeSource()})(root)`, {
    root,
    window: { addEventListener() {} },
    document: { addEventListener() {} },
    AbortController,
  });
  assert.equal(typeof controller.sync, 'function');
  assert.equal(typeof controller.snapshots, 'function');
  assert.equal(controller.snapshots().size, 0);
  controller.sync();
  controller.destroy();
  controller.destroy();
});

function standaloneHarness() {
  class Element {
    hidden = false;
    disabled = false;
    dataset: Record<string, string> = {};
    attributes = new Map<string, string>();
    textContent = '';
    innerHTML = '';
    srcdoc = '';
    contentWindow = { postMessage() {} };
    parent?: Element;
    children: Element[] = [];
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    hasAttribute(name: string) { return this.attributes.has(name); }
    addEventListener() {}
    focus() {}
    remove() {}
    replaceChildren(...nodes: Element[]) { this.children = nodes; }
    querySelector(_selector: string): any { return null; }
    closest(selector: string): Element | undefined { return selector.startsWith('.qft-demo') ? this.parent : this; }
  }
  const card = new Element();
  card.dataset.demoId = 'example';
  const run = new Element();
  run.parent = card;
  run.setAttribute('data-demo-run', '');
  const stop = new Element();
  const restart = new Element();
  stop.parent = card;
  restart.parent = card;
  stop.setAttribute('data-demo-stop', '');
  restart.setAttribute('data-demo-restart', '');
  const status = new Element();
  const poster = new Element();
  const slot = new Element();
  const payload = { content: { textContent: JSON.stringify({ version: 1, title: 'Example', description: 'A simple example.', html: '<p>Example</p>' }) } };
  card.querySelector = (selector) => ({
    '[data-demo-run]': run, '[data-demo-stop]': stop, '[data-demo-restart]': restart,
    '[data-demo-status]': status, '[data-demo-poster]': poster, '[data-demo-frame]': slot,
    'template[data-demo-source]': payload,
  })[selector];
  let click: (event: unknown) => void = () => {};
  let message: (event: unknown) => void = () => {};
  let active = true;
  const root = {
    contains: (node: unknown) => node === card,
    querySelectorAll: () => [card],
    addEventListener: (type: string, handler: (event: unknown) => void) => { if (type === 'click') click = handler; },
  };
  const doc = {
    hidden: false,
    addEventListener() {},
    createElement(tag: string) {
      if (tag === 'template') return { innerHTML: '', content: { querySelectorAll() { return []; } } };
      return new Element();
    },
  };
  const parentNonce = 'YWJjZGVmZ2hpamtsbW5vcA==';
  const controller = vm.runInNewContext(`(${interactiveRuntimeSource()})(root,options)`, {
    root, document: doc, Element, AbortController, crypto, performance,
    options: { isActive: () => active, scriptNonce: parentNonce },
    window: {
      addEventListener(type: string, handler: (event: unknown) => void) { if (type === 'message') message = handler; },
      setTimeout() { return 1; }, clearTimeout() {},
    },
  });
  return {
    controller, slot, status, card, parentNonce,
    click(action: 'run' | 'stop' | 'restart' = 'run') { click({ target: { run, stop, restart }[action], preventDefault() {}, stopPropagation() {} }); },
    setActive(value: boolean) { active = value; controller.sync(); },
    send(kind: string, detail?: unknown, trusted = true) {
      const frame = slot.children[0];
      const token = frame.srcdoc.match(/"([a-f0-9]{36})"/)?.[1];
      assert.ok(token);
      message({ source: trusted ? frame.contentWindow : {}, data: { qftDemo: 1, token, kind, detail } });
    },
  };
}

it('a standalone Run creates an opaque frame with intersecting nonce and inline-only script policies', () => {
  const { controller, slot, parentNonce, click } = standaloneHarness();
  assert.equal(slot.children.length, 0, 'parsing does not run a demo');
  click();
  const frame = slot.children[0];
  assert.equal(frame.attributes.get('sandbox'), 'allow-scripts');
  const policies = [...frame.srcdoc.matchAll(/http-equiv="Content-Security-Policy" content="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(policies.length, 2);
  assert.match(policies[0], new RegExp(`script-src 'nonce-${parentNonce.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
  assert.match(policies[0], /connect-src 'none'/);
  assert.equal(policies[1], "script-src 'unsafe-inline'; script-src-attr 'none'");
  assert.doesNotMatch(policies[1], /nonce-|https?:|\bself\b|strict-dynamic/);
  assert.ok(frame.srcdoc.includes(`<script nonce="${parentNonce}">`));
  controller.destroy();
});

it('demo errors remain visible through ready and pause/resume events until an explicit restart', () => {
  const app = standaloneHarness();
  app.click();
  app.send('error', 'An unrelated window must not change this card', false);
  assert.equal(app.status.textContent, 'Starting demonstration…');
  app.send('error', 'ReferenceError: missingPlot is not defined');
  assert.equal(app.card.dataset.demoState, 'error');
  app.send('ready');
  assert.match(app.status.textContent, /ReferenceError: missingPlot/);
  app.setActive(false);
  app.setActive(true);
  assert.match(app.status.textContent, /ReferenceError: missingPlot/);
  assert.equal(app.card.dataset.demoState, 'error');
  app.click('restart');
  assert.equal(app.status.textContent, 'Starting demonstration…');
  app.send('ready');
  assert.equal(app.card.dataset.demoState, 'running');
  assert.equal(app.status.textContent, 'Live · your controls are active');
  app.controller.destroy();
});
