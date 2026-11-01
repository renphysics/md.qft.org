import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { renderMarkdown } from '../src/lib/render-markdown';
import { renderSlides, normalizeSlideSettings, slideDimensions, DEFAULT_SLIDE_SETTINGS } from '../src/lib/slides';
import { escapeHtml } from '../src/lib/render-markdown';
import { interactiveFence } from '../src/lib/interactive-demos';
import { interactiveRuntimeSource } from '../src/scripts/interactive-demo-runtime';
import { normalizeDocumentSettings, DEFAULT_DOCUMENT_SETTINGS, documentPresentationCss, documentPageMetrics, prepareDocumentHtml } from '../src/lib/document-presentation';

// Exercise the real export functions without Vite's raw-import loader or a
// browser download destination. Rendering and serialized scripts stay real.
function functionsFrom(file: string, names: string[], dependencies: Record<string, unknown> = {}) {
  const parsed = ts.createSourceFile(file, readFileSync(new URL(`../src/lib/${file}`, import.meta.url), 'utf8'), ts.ScriptTarget.ES2022, true);
  const retained = parsed.statements.filter((node) => ts.isFunctionDeclaration(node) && !!node.name && names.includes(node.name.text));
  const source = ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, retained));
  const javascript = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: Record<string, any> = {};
  vm.runInNewContext(javascript, { exports, ...dependencies });
  return exports;
}

const printHelpers = functionsFrom('export-document.ts', ['makeInteractivePrintCopy', 'namespacePrintIds']);
const defaults = {
  renderMarkdown, renderSlides, escapeHtml, normalizeSlideSettings, slideDimensions, DEFAULT_SLIDE_SETTINGS,
  normalizeDocumentSettings, DEFAULT_DOCUMENT_SETTINGS, documentPresentationCss, documentPageMetrics, prepareDocumentHtml,
  exportScriptNonce: () => 'test-export-nonce',
  interactiveRuntimeSource,
  makeInteractivePrintCopy: printHelpers.makeInteractivePrintCopy,
  namespacePrintIds: printHelpers.namespacePrintIds,
  standaloneMathCss: async () => '', embedImages: async (html: string) => html,
  revealRuntime: '/* bundled presentation player */', revealCss: '', revealLicense: 'MIT',
  katexLicense: 'MIT', documentCss: '', slideCss: '', interactiveCss: '', applicationLicense: 'MIT',
  siteConfig: { name: 'QFT Markdown' },
};

async function exported(kind: 'slides' | 'document', source: string): Promise<string> {
  let html = '';
  const dependencies = { ...defaults, download: (content: string) => { html = content; } };
  const module = kind === 'slides'
    ? functionsFrom('export-slides.ts', ['staticSlideCss', 'exportSlidesHtml'], dependencies)
    : functionsFrom('export-document.ts', ['exportPortableHtml'], dependencies);
  await (kind === 'slides' ? module.exportSlidesHtml : module.exportPortableHtml)(source, 'A <safe> title');
  return html;
}

function mainScript(html: string): string {
  const scripts = [...html.matchAll(/<script nonce="([^"]+)">([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1, 'the parent contains only its authorized player script');
  assert.equal(scripts[0][1], 'test-export-nonce');
  return scripts[0][2];
}

async function executeParent(script: string): Promise<Record<string, unknown>> {
  const noop = () => {};
  const root = { addEventListener: noop, querySelectorAll: () => [], contains: () => false };
  const controls = new Map<string, object>();
  const getControl = (id: string) => {
    if (!controls.has(id)) controls.set(id, { open: false, addEventListener: noop, setAttribute: noop, removeAttribute: noop });
    return controls.get(id);
  };
  let frames = 0;
  const context = {
    AbortController, Map, Element: class {}, setTimeout, clearTimeout,
    document: {
      querySelector: () => root, getElementById: getControl, addEventListener: noop,
      body: { dataset: {} }, activeElement: null,
      createElement: (tag: string) => { if (tag === 'iframe') frames++; return {}; },
    },
    window: { addEventListener: noop },
    Reveal: class {
      initialize() { return Promise.resolve(); }
      on() {}
      layout() {}
      getCurrentSlide() { return undefined; }
    },
  };
  vm.runInNewContext(script, context, { timeout: 1000 });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(frames, 0, 'opening an exported file must not run a demonstration');
  return context;
}

describe('portable interactive HTML exports', () => {
  for (const kind of ['slides', 'document'] as const) {
    it(`${kind} export keeps hostile custom source inert in the parent and its player syntactically valid`, async () => {
      const source = interactiveFence({
        title: 'A "quoted" </script> title',
        html: '<button>Demo</button><script>parent.__demoExecuted=true; const text="</template><script>parent.__escaped=true;</script>";</script>',
      });
      const html = await exported(kind, source);
      assert.match(html, /<title>A &lt;safe&gt; title<\/title>/);
      assert.match(html, /script-src 'nonce-test-export-nonce'; script-src-attr 'none'/);
      assert.match(html, /connect-src 'none'/);
      assert.match(html, /frame-src 'self' blob:/);
      assert.doesNotMatch(html, /<script>parent\.__/);
      assert.match(html, /&lt;script&gt;parent\.__demoExecuted/);
      const context = await executeParent(mainScript(html));
      assert.equal((context as Record<string, unknown>).__demoExecuted, undefined);
      assert.equal((context as Record<string, unknown>).__escaped, undefined);
    });
  }

  it('keeps ordinary document exports script-free and ordinary JavaScript fences literal', async () => {
    const html = await exported('document', '# Code\n\n```javascript\nparent.__bad = true;\n```');
    assert.doesNotMatch(html, /<script\b/);
    assert.match(html, /script-src 'none'/);
    assert.match(html, /language-javascript/);
  });

  it('includes all four preset sources in a standalone slide export without external script URLs', async () => {
    const source = ['wave-packet', 'bloch-sphere', 'effective-potential', 'interference']
      .map((preset) => interactiveFence({ preset })).join('\n---\n\n');
    const html = await exported('slides', source);
    assert.equal((html.match(/<template data-demo-source>/g) ?? []).length, 4);
    assert.doesNotMatch(html, /<script[^>]+src=/i);
    for (const preset of ['wave-packet', 'bloch-sphere', 'effective-potential', 'interference']) assert.match(html, new RegExp(`data-demo-preset="${preset}"`));
    await executeParent(mainScript(html));
  });

  it('prints only slide sections and reports their true numbers when Reveal adds background duplicates', async () => {
    const html = await exported('slides', '# First\n\n---\n\n# Second');
    const context = await executeParent(mainScript(html));
    let backgroundsRemoved = false;
    let printCopyRemoved = false;
    const content = (overflows: boolean) => ({
      clientHeight: 720, scrollHeight: overflows ? 850 : 720,
      clientWidth: 1280, scrollWidth: 1280, querySelectorAll: () => [],
    });
    const sections = [false, true].map((overflows) => ({ querySelector: () => content(overflows) }));
    // Reveal copies qft-slide onto its generated background elements. They
    // precede the actual slide sections in the cloned presentation DOM.
    const backgrounds = [0, 1].map(() => ({ querySelector: () => null }));
    const printCopy = {
      className: '', offsetHeight: 1440,
      remove() { printCopyRemoved = true; },
      querySelectorAll(selector: string) {
        if (selector.includes('.reveal > .backgrounds')) return [{ remove() { backgroundsRemoved = true; } }];
        if (selector === '.slides > section.qft-slide') return sections;
        if (selector === '.qft-slide') return backgroundsRemoved ? sections : [...backgrounds, ...sections];
        return [];
      },
    };
    const document = context.document as Record<string, any>;
    document.querySelector = () => ({ cloneNode: () => printCopy });
    document.fonts = { ready: Promise.resolve() };
    document.body.append = () => {};
    await assert.rejects((context.checkPrintLayout as () => Promise<void>)(), /Slide 2 contains too much content/);
    assert.equal(backgroundsRemoved, true, 'generated backgrounds are absent from the static copy');
    assert.equal(printCopyRemoved, true, 'overflow cleans up the detached print copy');
  });
});

describe('static interactive print copies', () => {
  function fixture(snapshot?: string) {
    const created: Array<Record<string, any>> = [];
    const removed: string[] = [];
    const label = { textContent: 'Ready to explore' };
    const explanation = { textContent: 'Run this demo to interact with it.' };
    const poster = {
      hidden: true, children: [] as unknown[], removeAttribute() {},
      querySelector: (selector: string) => selector === 'strong' ? label : explanation,
      replaceChildren(...children: unknown[]) { this.children = children; },
    };
    const caption = { children: [] as unknown[], append(child: unknown) { this.children.push(child); } };
    const card = {
      dataset: { demoId: 'demo-fixture', demoState: 'running' }, removeAttribute() {},
      querySelectorAll: () => ['iframe', 'frame slot', 'controls', 'source template'].map((name) => ({ remove: () => removed.push(name) })),
      querySelector: (selector: string) => selector === '[data-demo-poster]' ? poster : selector === '.qft-demo-heading' ? { textContent: 'Counter' }
        : selector === '.qft-demo-caption' ? caption : null,
    };
    const helpers = functionsFrom('export-document.ts', ['makeInteractivePrintCopy'], {
      document: { createElement: (tag: string) => { const element = { tag, dataset: {} }; created.push(element); return element; } },
    });
    helpers.makeInteractivePrintCopy({ querySelectorAll: () => [card] }, new Map(snapshot ? [['demo-fixture', snapshot]] : []));
    return { created, removed, poster, card, label, explanation, caption };
  }

  it('removes executable surfaces and keeps a usable placeholder when a custom demo has not run', () => {
    const result = fixture();
    assert.deepEqual(result.removed, ['iframe', 'frame slot', 'controls', 'source template']);
    assert.equal(result.card.dataset.demoState, 'static');
    assert.equal(result.poster.hidden, false);
    assert.equal(result.created.some((element) => element.tag === 'iframe'), false);
    assert.equal(result.label.textContent, 'Interactive demonstration');
    assert.match(result.explanation.textContent, /HTML version/);
  });

  it('accepts a bounded PNG snapshot and rejects non-PNG or script-bearing image sources', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    const accepted = fixture(png);
    assert.equal(accepted.created.find((element) => element.tag === 'img')?.src, png);
    for (const bad of ['javascript:alert(1)', 'https://example.org/tracker.png', 'data:image/svg+xml,<svg onload="alert(1)"/>', `${png}" onerror="alert(1)`]) {
      assert.equal(fixture(bad).created.some((element) => element.tag === 'img'), false);
    }
  });
});
