import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { describe, it } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { DraftConflictError, isDraftConflict, type Draft, type DraftOptions } from '../src/lib/draft-store.ts';
import type { DraftImage } from '../src/lib/image-assets.ts';
import { scopedStorageKey } from '../src/lib/storage-scope.ts';
import { siteConfig } from '../src/config/site.ts';
import { DEFAULT_DOCUMENT_SETTINGS, type DocumentSettings } from '../src/lib/document-presentation.ts';
import { appendDocumentSection, suggestDocumentTitle, applyCleanup } from '../src/lib/document-tools.ts';
import { renderMarkdown } from '../src/lib/render-markdown.ts';
import { EXAMPLES } from '../src/lib/examples.ts';

// Exercise the actual controller methods, with isolated browser surfaces and
// delayed storage dependencies. Remove imports through the TypeScript AST so
// this test need not load CodeMirror's DOM implementation or Vite's raw assets.
const parsed = ts.createSourceFile(
  'markdown-workspace.ts',
  readFileSync(new URL('../src/scripts/markdown-workspace.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS,
);
const isolated = ts.factory.updateSourceFile(parsed, parsed.statements.filter((statement) => !ts.isImportDeclaration(statement)));
const controller = ts.transpileModule(ts.createPrinter().printFile(isolated), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;

interface Workspace {
  id: string;
  current: Draft;
  drafts: Map<string, Draft>;
  dirty: boolean;
  storageAvailable: boolean;
  volatileDrafts: Set<string>;
  ephemeralDrafts: Set<string>;
  deletingId?: string;
  actionQueue: Promise<void>;
  newDocument(title: string, source: string, options?: DraftOptions): Promise<void>;
  flush(): Promise<void>;
  refreshFromStorage(): Promise<void>;
  bindEvents(): void;
  setSaveState(): void;
  notify(message: string): void;
  updateTitle(): void;
  renderDocuments(): void;
  closeSidebar(): void;
  activate(draft: Draft): void;
  q(selector: string): unknown;
  querySelector(selector: string): unknown;
  querySelectorAll(selector: string): unknown[];
  pasteDocument(source: string, title: string, mode: string, target?: string): Promise<void>;
  applyFormatting(): Promise<void>;
  replaceSource(source: string): void;
  syncWelcome(): void;
  selectedCleanup(): string[];
  persistDocumentSettings(): void;
  cleanupSnapshot?: { id: string; title: string; source: string };
  print(): Promise<void>;
  exportStyledHtml(): Promise<void>;
  closeExport(): void;
  openPdf(): void;
  updatePdfPreview(): void;
  pdfSnapshot?: DraftOptions & { id: string; title: string; source: string; allowRemoteImages: boolean };
  documentSettings: DocumentSettings;
}

interface Storage {
  createDraft(title: string, source: string, options?: DraftOptions): Promise<Draft>;
  saveDraft(draft: Draft, expectedRevision?: number): Promise<Draft>;
  loadDrafts(): Promise<Draft[]>;
  deleteDraft(id: string): Promise<void>;
}

function draft(id: string, source = '', revision = 1, title = id): Draft {
  return { id, source, title, revision, createdAt: 1, updatedAt: revision };
}

function attachment(id: string): DraftImage {
  return { id, name: `${id}.png`, type: 'image/png', blob: new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' }) };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function workspace(storage: Partial<Storage> = {}, browserDependencies: Record<string, unknown> = {}) {
  let WorkspaceClass!: new () => Workspace;
  const controls = new Map<string, (event: Event) => void>();
  const notifications: string[] = [];
  const noop = () => {};
  const headerExports = { dataset: { workspace: 'main-content' }, querySelectorAll: () => [] };
  const context = {
    exports: {}, AbortController, clearTimeout,
    HTMLElement: class { id = 'main-content'; dataset = {}; querySelectorAll() { return []; } addEventListener() {} },
    Compartment: class {}, HighlightStyle: { define: () => ({}) }, tags: {},
    matchMedia: () => ({ matches: false, addEventListener: noop }),
    document: { addEventListener: noop, getElementById: (id: string) => id === 'workspace-exports' ? headerExports : null }, window: { addEventListener: noop },
    createDraftId: () => 'memory-draft', isDraftConflict, scopedStorageKey, siteConfig,
    DEFAULT_DOCUMENT_SETTINGS, appendDocumentSection, suggestDocumentTitle, applyCleanup,
    renderMarkdown, EXAMPLES,
    MAX_SOURCE_LENGTH: 400_000,
    createDraft: async (title: string, source: string, options: DraftOptions = {}) => ({ ...draft('new', source, 1, title), ...options }),
    saveDraft: async (value: Draft) => ({ ...value, revision: value.revision + 1 }),
    loadDrafts: async () => [], deleteDraft: async () => {},
    ...storage,
    ...browserDependencies,
    customElements: {
      get: () => undefined,
      define: (_name: string, constructor: new () => Workspace) => { WorkspaceClass = constructor; },
    },
  };
  vm.runInNewContext(controller, context, { filename: 'markdown-workspace.test-controller.js' });
  const app = new WorkspaceClass();
  app.current = draft('old', 'initial');
  app.drafts.set(app.current.id, app.current);
  app.setSaveState = noop;
  app.notify = (message) => { notifications.push(message); };
  app.updateTitle = noop;
  app.renderDocuments = noop;
  app.closeSidebar = noop;
  app.activate = (value) => { app.current = { ...value }; app.dirty = false; };
  app.syncWelcome = noop;
  app.persistDocumentSettings = noop;
  app.closeExport = noop;
  app.replaceSource = (source) => { edit(app, source); };
  app.q = (selector) => ({
    close: noop,
    addEventListener: (event: string, listener: (event: Event) => void) => { controls.set(`${selector}:${event}`, listener); },
  });
  return { app, controls, notifications };
}

function edit(app: Workspace, source: string, title = app.current.title) {
  app.current = { ...app.current, source, title };
  app.drafts.set(app.current.id, app.current);
  app.dirty = true;
}

function confirmDelete(app: Workspace, controls: Map<string, (event: Event) => void>, id: string) {
  app.bindEvents();
  app.deletingId = id;
  controls.get('[data-delete-form]:submit')!({ preventDefault() {} } as Event);
  return app.actionQueue;
}

describe('workspace draft coordination', () => {
  it('connects external header exports while keeping the PDF dialog inside its workspace', async () => {
    const downloads: { source: string; title: string }[] = [];
    const headerClicks = new Map<string, () => void>();
    const headerAttributes = new Map<string, string>();
    let focused = '';
    let previewUpdates = 0;
    const page = {
      activeElement: '',
      addEventListener() {},
      getElementById: (id: string): unknown => id === 'workspace-exports' ? header : null,
      querySelector: () => { throw new Error('Editor controls must not be queried from the document'); },
    };
    const headerButtons = new Map(['[data-export-toggle]', '[data-export-md]', '[data-export-html]', '[data-print]', '[data-pdf]'].map((selector) => [selector, {
      addEventListener: (type: string, handler: () => void) => { if (type === 'click') headerClicks.set(selector, handler); },
      setAttribute: (name: string, value: string) => headerAttributes.set(`${selector}:${name}`, value),
      focus: () => { focused = selector; page.activeElement = selector; },
    }]));
    const menu = {
      hidden: true,
      contains: (element: unknown) => ['[data-export-md]', '[data-export-html]', '[data-print]'].includes(String(element)),
      querySelector: () => headerButtons.get('[data-export-md]'),
    };
    const header = {
      dataset: { workspace: 'main-content' },
      querySelector: (selector: string) => selector === '[data-export-menu]' ? menu : headerButtons.get(selector),
      querySelectorAll: (selector: string) => selector.split(',').map((part) => headerButtons.get(part.trim())).filter(Boolean),
    };
    const { app } = workspace({}, {
      document: page,
      downloadMarkdown: (source: string, title: string) => downloads.push({ source, title }),
    });
    const localControls = new Map<string, { value: string; checked: boolean; open: boolean; addEventListener(): void; showModal(): void }>();
    app.querySelector = (selector) => {
      assert.ok(!selector.startsWith('[data-export-'), 'Header exports are outside the editor element');
      if (!localControls.has(selector)) localControls.set(selector, {
        value: '', checked: false, open: false, addEventListener() {}, showModal() { this.open = true; },
      });
      return localControls.get(selector);
    };
    app.q = Object.getPrototypeOf(app).q.bind(app);
    app.closeExport = Object.getPrototypeOf(app).closeExport.bind(app);
    app.updatePdfPreview = () => { previewUpdates++; };
    app.current = draft('notes', '# Notes\n\n$E=mc^2$', 1, 'Research notes');
    app.bindEvents();

    headerClicks.get('[data-export-toggle]')!();
    assert.equal(menu.hidden, false);
    assert.equal(headerAttributes.get('[data-export-toggle]:aria-expanded'), 'true');
    assert.equal(focused, '[data-export-md]');
    app.closeExport();
    assert.equal(menu.hidden, true);
    assert.equal(headerAttributes.get('[data-export-toggle]:aria-expanded'), 'false');
    assert.equal(focused, '[data-export-toggle]');

    headerClicks.get('[data-export-toggle]')!();
    headerClicks.get('[data-export-md]')!();
    await app.actionQueue;
    assert.deepEqual(downloads, [{ source: app.current.source, title: app.current.title }]);
    assert.equal(menu.hidden, true);

    headerClicks.get('[data-pdf]')!();
    assert.equal(localControls.get('[data-pdf-dialog]')?.open, true);
    assert.equal(app.pdfSnapshot?.source, app.current.source);
    assert.equal(app.pdfSnapshot?.title, 'Research notes');
    assert.equal(previewUpdates, 1);

    header.dataset.workspace = 'another-workspace';
    assert.throws(() => app.closeExport(), /Missing workspace export controls/);
  });

  it('keeps the public page title for blank drafts and document titles for named drafts', () => {
    const initialTitle = `${siteConfig.name} — ${siteConfig.title}`;
    const page = { title: initialTitle, addEventListener() {} };
    const { app } = workspace({}, { document: page });
    const titleControl = { textContent: '' };
    app.q = () => titleControl;
    const updateTitle = Object.getPrototypeOf(app).updateTitle.bind(app);

    app.current = draft('blank', '', 1, 'Untitled document');
    updateTitle();
    assert.equal(page.title, initialTitle);
    assert.equal(titleControl.textContent, 'Untitled document');

    app.current = draft('notes', '# Private notes', 1, 'Research notes');
    updateTitle();
    assert.equal(page.title, `Research notes · ${siteConfig.name}`);

    app.current = draft('another-blank', '  \n', 1, 'Untitled document');
    updateTitle();
    assert.equal(page.title, initialTitle);
  });

  it('ignores queued PDF and HTML actions after the setup panel has closed', async () => {
    let exports = 0;
    const { app } = workspace({}, { printDocument: async () => { exports++; }, exportPortableHtml: async () => { exports++; } });
    app.pdfSnapshot = { ...app.current, allowRemoteImages: false };
    app.q = () => ({ open: false });
    await app.print();
    await app.exportStyledHtml();
    assert.equal(exports, 0);
  });

  it('requires a new presentation review when a queued PDF snapshot is stale', async () => {
    let printed = 0;
    let reopened = 0;
    const { app } = workspace({}, { printDocument: async () => { printed++; } });
    app.pdfSnapshot = { ...app.current, source: 'old preview', allowRemoteImages: false };
    app.q = () => ({ open: true, close() {} });
    app.openPdf = () => { reopened++; };
    await app.print();
    assert.equal(printed, 0);
    assert.equal(reopened, 1);
  });

  it('opens only one print flow when Save PDF is activated twice', async () => {
    let printed = 0;
    const { app } = workspace({}, { printDocument: async () => { printed++; } });
    app.pdfSnapshot = { ...app.current, allowRemoteImages: false };
    const dialog = { open: true, close() { this.open = false; } };
    app.q = () => dialog;
    await Promise.all([app.print(), app.print()]);
    assert.equal(printed, 1);
  });

  it('does not append pasted text to a different document after the target changes', async () => {
    const { app } = workspace();
    await assert.rejects(app.pasteDocument('New content', '', 'append', 'different-draft'), /active document changed/);
    assert.equal(app.current.source, 'initial');
  });

  it('appends without replacing existing text and preserves equations literally', async () => {
    const { app } = workspace();
    const source = String.raw`## A result

\[E=mc^2\]`;
    await app.pasteDocument(source, '', 'append', 'old');
    assert.ok(app.current.source.startsWith('initial'));
    assert.ok(app.current.source.endsWith(source));
    assert.equal(app.current.id, 'old');
  });

  it('keeps the original draft when creating a formatted copy', async () => {
    const { app } = workspace();
    const original = '```markdown\n## A note\n\n$E=mc^2$\n```';
    edit(app, original, 'A note');
    app.cleanupSnapshot = { id: 'old', title: 'A note', source: original };
    app.selectedCleanup = () => ['unwrap-fence', 'heading-levels'];
    await app.applyFormatting();
    assert.equal(app.drafts.get('old')?.source, original);
    assert.equal(app.current.id, 'new');
    assert.equal(app.current.source, '# A note\n\n$E=mc^2$\n');
  });

  it('retains pictures and slide settings in a formatted copy and its untouched original', async () => {
    const { app } = workspace();
    const image = attachment('plot');
    const original = '```markdown\n## A note\n\n![Plot](qft-image:plot)\n```';
    app.current = { ...app.current, images: [image], mode: 'slides', slideTheme: 'midnight', slideRatio: '4:3' };
    edit(app, original, 'Illustrated slides');
    app.cleanupSnapshot = { id: 'old', title: 'Illustrated slides', source: original };
    app.selectedCleanup = () => ['unwrap-fence', 'heading-levels'];
    await app.applyFormatting();
    assert.equal(app.current.id, 'new');
    assert.equal(app.current.source, '# A note\n\n![Plot](qft-image:plot)\n');
    assert.equal(app.current.images?.[0].id, image.id);
    assert.equal(app.current.images?.[0].blob, image.blob);
    assert.equal(app.current.mode, 'slides');
    assert.equal(app.current.slideTheme, 'midnight');
    assert.equal(app.current.slideRatio, '4:3');
    assert.equal(app.drafts.get('old')?.source, original);
    assert.equal(app.drafts.get('old')?.images?.[0].blob, image.blob);
  });

  it('duplicates pictures and slide preferences through the actual Duplicate action', async () => {
    const { app } = workspace();
    const image = attachment('figure');
    app.current = { ...app.current, source: '![Figure](qft-image:figure)', images: [image], mode: 'slides', slideTheme: 'serif', slideRatio: '4:3' };
    app.drafts.set(app.current.id, app.current);
    let duplicate!: () => void;
    app.querySelectorAll = (selector) => selector === '[data-duplicate]' ? [{
      addEventListener: (event: string, handler: () => void) => { if (event === 'click') duplicate = handler; },
    }] : [];
    app.bindEvents();
    duplicate();
    await app.actionQueue;
    assert.equal(app.current.id, 'new');
    assert.equal(app.current.source, '![Figure](qft-image:figure)');
    assert.equal(app.current.images?.[0].blob, image.blob);
    assert.equal(app.current.mode, 'slides');
    assert.equal(app.current.slideTheme, 'serif');
    assert.equal(app.current.slideRatio, '4:3');
    assert.equal(app.drafts.get('old')?.images?.[0].blob, image.blob);
  });

  it('opens the built-in slide example in Slides mode from the workspace example picker', async () => {
    const { app, controls } = workspace();
    app.bindEvents();
    const example = EXAMPLES.find((item) => item.id === 'quantum-slides')!;
    controls.get('[data-examples-list]:click')!({
      target: { closest: () => ({ dataset: { exampleId: example.id } }) },
    } as unknown as Event);
    await app.actionQueue;
    assert.equal(app.current.source, example.source);
    assert.equal(app.current.mode, 'slides');
    assert.equal(app.current.slideTheme, example.slideTheme);
    assert.equal(app.current.slideRatio, example.slideRatio);
  });

  it('requires a fresh cleanup review if a document changed after the preview opened', async () => {
    let created = 0;
    const { app } = workspace({ createDraft: async () => { created++; return draft('unexpected'); } });
    app.cleanupSnapshot = { id: 'old', title: 'old', source: 'older contents' };
    await app.applyFormatting();
    assert.equal(created, 0);
    assert.equal(app.current.source, 'initial');
  });

  it('finishes edits and an autosave started during creation before switching documents', async () => {
    const creation = deferred<Draft>();
    const saving = deferred<Draft>();
    const writes: Draft[] = [];
    const { app } = workspace({
      createDraft: () => creation.promise,
      saveDraft: (value) => { writes.push({ ...value }); return saving.promise; },
    });
    const switching = app.newDocument('New document', '');
    await nextTurn();
    edit(app, 'typed while the new document was being created');
    const autosave = app.flush();
    await nextTurn();
    creation.resolve(draft('new'));
    await nextTurn();
    assert.equal(app.current.id, 'old', 'the active document must not change during its save');
    saving.resolve({ ...writes[0], revision: 2 });
    await Promise.all([autosave, switching]);
    assert.equal(writes[0].source, 'typed while the new document was being created');
    assert.equal(app.drafts.get('old')?.source, writes[0].source);
    assert.equal(app.current.id, 'new');
  });

  it('commits each kind of metadata-only edit made while an earlier autosave is pending', async () => {
    const imageA = attachment('figure-a');
    const imageB = attachment('figure-b');
    const changes: DraftOptions[] = [
      { mode: 'slides' },
      { slideTheme: 'midnight' },
      { slideRatio: '4:3' },
      { images: [imageA, imageB] },
    ];
    for (const change of changes) {
      const saving = deferred<Draft>();
      const writes: Draft[] = [];
      const { app } = workspace({ saveDraft: (value) => {
        writes.push({ ...value });
        return writes.length === 1 ? saving.promise : Promise.resolve({ ...value, revision: value.revision + 1 });
      } });
      app.current = { ...app.current, images: [imageA], mode: 'document', slideTheme: 'paper', slideRatio: '16:9' };
      edit(app, '![Figure](qft-image:figure-a)');
      const pending = app.flush();
      await nextTurn();
      app.current = { ...app.current, ...change };
      app.dirty = true;
      const expected = app.current;
      saving.resolve({ ...writes[0], revision: 2 });
      await pending;
      assert.equal(writes.length, 2, `The ${Object.keys(change)[0]} edit needs a second committed revision`);
      assert.equal(app.current.revision, 3);
      assert.equal(app.current.mode, expected.mode);
      assert.equal(app.current.slideTheme, expected.slideTheme);
      assert.equal(app.current.slideRatio, expected.slideRatio);
      assert.equal(app.current.images?.length, expected.images?.length);
      assert.equal(writes[1].images?.length, expected.images?.length);
      assert.equal(app.dirty, false);
    }
  });

  it('does not regress a newly committed draft when a cross-tab read returns an older snapshot', async () => {
    const reading = deferred<Draft[]>();
    const { app } = workspace({ loadDrafts: () => reading.promise });
    const refreshing = app.refreshFromStorage();
    app.current = draft('old', 'just committed', 2);
    app.drafts.set('old', app.current);
    reading.resolve([draft('old', 'old stored snapshot')]);
    await refreshing;
    assert.equal(app.current.source, 'just committed');
    assert.equal(app.drafts.get('old')?.source, 'just committed');
  });

  it('preserves edits made during recovery and retains the other tab’s original document', async () => {
    const creation = deferred<Draft>();
    const competitor = draft('old', 'other tab version', 2);
    let attempts = 0;
    const { app } = workspace({
      createDraft: () => creation.promise,
      saveDraft: async (value) => {
        if (++attempts === 1) throw new DraftConflictError('old', competitor);
        return { ...value, revision: value.revision + 1 };
      },
    });
    edit(app, 'first edit');
    const saving = app.flush();
    await nextTurn();
    edit(app, 'newer edit during recovery', 'New title during recovery');
    creation.resolve(draft('recovered', 'first edit', 1, 'old (recovered)'));
    await saving;
    assert.equal(app.current.id, 'recovered');
    assert.equal(app.current.source, 'newer edit during recovery');
    assert.equal(app.current.title, 'New title during recovery');
    assert.equal(app.current.revision, 2);
    assert.equal(app.drafts.get('old')?.source, 'other tab version');
    assert.equal(app.dirty, false);
  });

  it('keeps both tabs’ picture sets and saves slide changes made during conflict recovery', async () => {
    const imageA = attachment('local-a');
    const imageB = attachment('local-b');
    const otherImage = attachment('other-tab');
    const creation = deferred<Draft>();
    const competitor: Draft = { ...draft('old', 'Other tab text', 2), images: [otherImage], mode: 'document' };
    let recoveryOptions: DraftOptions | undefined;
    let attempts = 0;
    const { app } = workspace({
      createDraft: (_title, _source, options) => { recoveryOptions = options; return creation.promise; },
      saveDraft: async (value) => {
        if (++attempts === 1) throw new DraftConflictError('old', competitor);
        return { ...value, revision: value.revision + 1 };
      },
    });
    app.current = { ...app.current, images: [imageA], mode: 'document', slideTheme: 'paper', slideRatio: '16:9' };
    edit(app, 'My local text');
    const saving = app.flush();
    await nextTurn();
    assert.equal(recoveryOptions?.images?.[0].id, imageA.id);
    app.current = { ...app.current, images: [imageA, imageB], mode: 'slides', slideTheme: 'midnight', slideRatio: '4:3' };
    app.dirty = true;
    creation.resolve({ ...draft('recovered', 'My local text', 1, 'old (recovered)'), ...recoveryOptions });
    await saving;
    assert.equal(app.current.id, 'recovered');
    assert.equal(app.current.revision, 2);
    assert.deepEqual(app.current.images?.map((image) => image.id), [imageA.id, imageB.id]);
    assert.equal(app.current.mode, 'slides');
    assert.equal(app.current.slideTheme, 'midnight');
    assert.equal(app.current.slideRatio, '4:3');
    assert.equal(app.drafts.get('old')?.images?.[0].id, otherImage.id);
    assert.equal(app.drafts.get('old')?.source, competitor.source);
    assert.equal(app.dirty, false);
  });

  it('keeps images and slide preferences in memory if storing a conflict copy fails', async () => {
    const image = attachment('unsaved-figure');
    const competitor = draft('old', 'Other tab', 2);
    const { app } = workspace({
      saveDraft: async () => { throw new DraftConflictError('old', competitor); },
      createDraft: async () => { throw new Error('Storage unavailable'); },
    });
    app.current = { ...app.current, images: [image], mode: 'slides', slideTheme: 'serif', slideRatio: '4:3' };
    edit(app, '![Unsaved figure](qft-image:unsaved-figure)');
    await app.flush();
    assert.equal(app.current.id, 'memory-draft');
    assert.equal(app.current.images?.[0].blob, image.blob);
    assert.equal(app.current.mode, 'slides');
    assert.equal(app.current.slideTheme, 'serif');
    assert.equal(app.current.slideRatio, '4:3');
    assert.equal(app.storageAvailable, false);
    assert.ok(app.volatileDrafts.has(app.current.id));
    assert.ok(app.ephemeralDrafts.has(app.current.id));
    assert.equal(app.drafts.get('old')?.source, 'Other tab');
  });

  it('keeps a persisted draft visible when storage is unavailable instead of claiming deletion', async () => {
    let deletes = 0;
    const { app, controls, notifications } = workspace({ deleteDraft: async () => { deletes++; } });
    app.storageAvailable = false;
    app.volatileDrafts.add('old'); // Its latest edits are unsaved, but the record exists on disk.
    await confirmDelete(app, controls, 'old');
    assert.equal(deletes, 0);
    assert.ok(app.drafts.has('old'));
    assert.ok(notifications.some((message) => message.includes('was not deleted')));
    assert.ok(!notifications.includes('Document deleted.'));
  });

  it('allows a never-persisted memory draft to be deleted while storage is unavailable', async () => {
    const { app, controls, notifications } = workspace();
    app.storageAvailable = false;
    app.volatileDrafts.add('old');
    app.ephemeralDrafts.add('old');
    app.drafts.set('keep', draft('keep', 'another document'));
    await confirmDelete(app, controls, 'old');
    assert.ok(!app.drafts.has('old'));
    assert.ok(!app.ephemeralDrafts.has('old'));
    assert.equal(app.current.id, 'keep');
    assert.ok(notifications.includes('Document deleted.'));
  });

  it('recovers edits made while an active document deletion was pending', async () => {
    const deletion = deferred<void>();
    const { app, controls } = workspace({
      deleteDraft: () => deletion.promise,
      saveDraft: async () => { throw new DraftConflictError('old', undefined); },
    });
    const deleting = confirmDelete(app, controls, 'old');
    await nextTurn();
    edit(app, 'typed while deletion was pending');
    deletion.resolve();
    await deleting;
    assert.ok(!app.drafts.has('old'));
    assert.equal(app.current.id, 'new');
    assert.equal(app.current.source, 'typed while deletion was pending');
    assert.equal(app.drafts.get('new')?.source, app.current.source);
    assert.equal(app.dirty, false);
  });
});
