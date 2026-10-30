import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { describe, it } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { DraftConflictError, isDraftConflict, type Draft } from '../src/lib/draft-store.ts';
import { scopedStorageKey } from '../src/lib/storage-scope.ts';
import { siteConfig } from '../src/config/site.ts';
import { DEFAULT_DOCUMENT_SETTINGS, type DocumentSettings } from '../src/lib/document-presentation.ts';
import { appendDocumentSection, suggestDocumentTitle, applyCleanup } from '../src/lib/document-tools.ts';
import { renderMarkdown } from '../src/lib/render-markdown.ts';

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
  current: Draft;
  drafts: Map<string, Draft>;
  dirty: boolean;
  storageAvailable: boolean;
  volatileDrafts: Set<string>;
  ephemeralDrafts: Set<string>;
  deletingId?: string;
  actionQueue: Promise<void>;
  newDocument(title: string, source: string): Promise<void>;
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
  pdfSnapshot?: { id: string; title: string; source: string; allowRemoteImages: boolean };
  documentSettings: DocumentSettings;
}

interface Storage {
  createDraft(title: string, source: string): Promise<Draft>;
  saveDraft(draft: Draft, expectedRevision?: number): Promise<Draft>;
  loadDrafts(): Promise<Draft[]>;
  deleteDraft(id: string): Promise<void>;
}

function draft(id: string, source = '', revision = 1, title = id): Draft {
  return { id, source, title, revision, createdAt: 1, updatedAt: revision };
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
  const context = {
    exports: {}, AbortController, clearTimeout,
    HTMLElement: class { dataset = {}; querySelectorAll() { return []; } addEventListener() {} },
    Compartment: class {}, HighlightStyle: { define: () => ({}) }, tags: {},
    matchMedia: () => ({ matches: false, addEventListener: noop }),
    document: { addEventListener: noop }, window: { addEventListener: noop },
    createDraftId: () => 'memory-draft', isDraftConflict, scopedStorageKey, siteConfig,
    DEFAULT_DOCUMENT_SETTINGS, appendDocumentSection, suggestDocumentTitle, applyCleanup,
    renderMarkdown,
    MAX_SOURCE_LENGTH: 400_000,
    createDraft: async (title: string, source: string) => draft('new', source, 1, title),
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
