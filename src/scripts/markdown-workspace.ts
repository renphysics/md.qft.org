import { basicSetup } from 'codemirror';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap, type ViewUpdate } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { openSearchPanel } from '@codemirror/search';
import { isolateHistory, undo } from '@codemirror/commands';
import { tags } from '@lezer/highlight';
import {
  createDraft, createDraftId, deleteDraft, loadDrafts, saveDraft, isDraftConflict,
  DRAFT_CHANNEL_NAME, type Draft, type DraftChangeMessage,
} from '../lib/draft-store';
import { renderMarkdown, MAX_SOURCE_LENGTH, type MarkdownResult } from '../lib/render-markdown';
import { downloadMarkdown, exportPortableHtml, printDocument } from '../lib/export-document';
import {
  DEFAULT_DOCUMENT_SETTINGS, normalizeDocumentSettings, prepareDocumentHtml,
  documentPresentationCss, documentPageMetrics, inspectPrintLayout, type DocumentSettings,
} from '../lib/document-presentation';
import {
  getCleanupSuggestions, applyCleanup, getDocumentSections, moveDocumentSection,
  suggestDocumentTitle, appendDocumentSection,
} from '../lib/document-tools';
import { connectScrollSync } from '../lib/scroll-sync';
import { EXAMPLES } from '../lib/examples';
import { siteConfig } from '../config/site';
import { scopedStorageKey } from '../lib/storage-scope';

type ViewMode = 'editor' | 'split' | 'preview';
interface Preferences { fontSize: number; wrap: boolean; sync: boolean; view: ViewMode; share: number }
const PREFERENCES_KEY = scopedStorageKey('qft-markdown:preferences');
const ACTIVE_KEY = scopedStorageKey('qft-markdown:active');
const presentationKey = (id: string) => scopedStorageKey(`qft-markdown:presentation:${id}`);
const defaults: Preferences = { fontSize: 14, wrap: true, sync: true, view: 'split', share: 50 };

function readLocal(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeLocal(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* Draft storage has its own visible error state. */ }
}
function readPreferences(): Preferences {
  try {
    const value = JSON.parse(readLocal(PREFERENCES_KEY) ?? '{}');
    return {
      fontSize: [12, 13, 14, 15, 16, 18].includes(value.fontSize) ? value.fontSize : 14,
      wrap: typeof value.wrap === 'boolean' ? value.wrap : true,
      sync: typeof value.sync === 'boolean' ? value.sync : true,
      view: ['editor', 'split', 'preview'].includes(value.view) ? value.view : 'split',
      share: typeof value.share === 'number' && value.share >= 25 && value.share <= 75 ? value.share : 50,
    };
  } catch { return { ...defaults }; }
}
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Download your Markdown to keep a copy.';
}
function memoryDraft(title: string, source: string): Draft {
  return { id: createDraftId(), title, source, createdAt: Date.now(), updatedAt: Date.now(), revision: 1 };
}
function icon(kind: 'file' | 'delete'): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('width', kind === 'file' ? '17' : '13');
  svg.setAttribute('height', kind === 'file' ? '17' : '13');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', kind === 'file'
    ? 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5'
    : 'M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6');
  svg.append(path);
  return svg;
}

const highlight = HighlightStyle.define([
  { tag: tags.heading, color: 'var(--accent)', fontWeight: '600' },
  { tag: tags.strong, fontWeight: '600', color: 'var(--text)' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.link, color: 'var(--accent)', textDecoration: 'underline' },
  { tag: tags.url, color: 'var(--green)' },
  { tag: tags.monospace, color: 'var(--accent)' },
  { tag: tags.processingInstruction, color: 'var(--muted)' },
  { tag: tags.quote, color: 'var(--muted)', fontStyle: 'italic' },
  { tag: tags.meta, color: 'var(--faint)' },
]);

class MarkdownWorkspace extends HTMLElement {
  private readonly workspacePageTitle = document.title;
  private abort = new AbortController();
  private editor?: EditorView;
  private wrapping = new Compartment();
  private scrollSync?: ReturnType<typeof connectScrollSync>;
  private preferences = readPreferences();
  private drafts = new Map<string, Draft>();
  private current?: Draft;
  private dirty = false;
  private storageAvailable = true;
  private volatileDrafts = new Set<string>();
  private ephemeralDrafts = new Set<string>();
  private saveTask?: Promise<void>;
  private actionQueue = Promise.resolve();
  private previewTimer = 0;
  private saveTimer = 0;
  private toastTimer = 0;
  private channel?: BroadcastChannel;
  private deletingId?: string;
  private rendered?: MarkdownResult;
  private remoteImages = false;
  private initialized = false;
  private documentSearch = '';
  private documentSettings: DocumentSettings = { ...DEFAULT_DOCUMENT_SETTINGS };
  private dismissedWelcome = new Set<string>();
  private cleanupSnapshot?: { id: string; title: string; source: string };
  private organizeHistory: { id: string; before: string; after: string }[] = [];
  private pdfSnapshot?: { id: string; title: string; source: string; allowRemoteImages: boolean };
  private pdfRendered?: MarkdownResult;
  private pdfPreviewToken = 0;
  private pasteTarget?: string;
  private mobile = matchMedia('(max-width: 640px)');
  private narrow = matchMedia('(max-width: 950px)');

  private q<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.querySelector<T>(selector);
    if (!element) throw new Error(`Missing workspace control: ${selector}`);
    return element;
  }

  // The export controls live in the site header, outside this custom element.
  // Associate that one control group explicitly; keep all editor queries local.
  private headerExports(): HTMLElement {
    const controls = document.getElementById('workspace-exports');
    if (!controls || controls.dataset.workspace !== this.id) throw new Error('Missing workspace export controls');
    return controls;
  }

  private exportControl<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.headerExports().querySelector<T>(selector);
    if (!element) throw new Error(`Missing export control: ${selector}`);
    return element;
  }

  connectedCallback(): void {
    if (this.initialized) return;
    this.initialized = true;
    void this.initialize().catch((error) => {
      this.setSaveState('error', 'Unable to open workspace');
      this.notify(messageOf(error), 15_000);
    });
  }

  disconnectedCallback(): void {
    this.abort.abort();
    clearTimeout(this.previewTimer);
    clearTimeout(this.saveTimer);
    clearTimeout(this.toastTimer);
    this.channel?.close();
    this.scrollSync?.destroy();
    this.editor?.destroy();
  }

  private async initialize(): Promise<void> {
    let drafts: Draft[] = [];
    try { drafts = await loadDrafts(); }
    catch (error) { this.storageFailure(error); }
    for (const draft of drafts) this.drafts.set(draft.id, draft);
    const query = new URL(location.href);
    const requestedExample = EXAMPLES.find((example) => example.id === query.searchParams.get('example'));
    if (query.searchParams.has('example')) {
      query.searchParams.delete('example');
      history.replaceState(null, '', `${query.pathname}${query.search}${query.hash}`);
    }
    let initial = this.drafts.get(readLocal(ACTIVE_KEY) ?? '') ?? drafts[0];
    if (requestedExample) initial = await this.makeDraft(requestedExample.title, requestedExample.source);
    else if (!initial) initial = await this.makeDraft('Untitled document', '');
    this.current = initial;
    this.q('[data-editor]').replaceChildren();
    this.editor = new EditorView({ state: this.editorState(initial.source), parent: this.q('[data-editor]') });
    this.configureControls();
    this.bindEvents();
    this.activate(initial);
    this.scrollSync = connectScrollSync({
      editorScroller: this.editor.scrollDOM,
      previewScroller: this.q('[data-preview-scroll]'),
      sourceLineAtTop: () => {
        const editor = this.editor!;
        const top = Math.max(0, editor.scrollDOM.getBoundingClientRect().top - editor.documentTop);
        const block = editor.lineBlockAtHeight(top);
        const line = editor.state.doc.lineAt(block.from).number - 1;
        return line + Math.max(0, Math.min(.99, (top - block.top) / Math.max(1, block.height)));
      },
      scrollEditorToLine: (line) => {
        const editor = this.editor!;
        const position = editor.state.doc.line(Math.min(editor.state.doc.lines, Math.max(1, Math.floor(line) + 1))).from;
        const block = editor.lineBlockAt(position);
        const padding = editor.documentTop - editor.scrollDOM.getBoundingClientRect().top + editor.scrollDOM.scrollTop;
        editor.scrollDOM.scrollTop = block.top + padding + (line % 1) * block.height;
      },
      isEnabled: () => this.preferences.sync && this.dataset.view === 'split' && !this.mobile.matches,
    });
    try {
      this.channel = new BroadcastChannel(DRAFT_CHANNEL_NAME);
      this.channel.addEventListener('message', (event: MessageEvent<DraftChangeMessage>) => {
        if (!event.data || !['create', 'save', 'delete'].includes(event.data.action)) return;
        this.runAction(() => this.refreshFromStorage());
      }, { signal: this.abort.signal });
    } catch { /* Atomic saves still detect conflicts without BroadcastChannel. */ }
  }

  private editorState(source: string): EditorState {
    return EditorState.create({
      doc: source,
      extensions: [
        basicSetup,
        markdown(),
        syntaxHighlighting(highlight),
        this.wrapping.of(this.preferences.wrap ? EditorView.lineWrapping : []),
        EditorView.contentAttributes.of({ 'aria-label': 'Markdown source editor', spellcheck: 'false', autocapitalize: 'off' }),
        EditorView.theme({ '&': { color: 'var(--text)', fontSize: 'var(--editor-font-size,14px)' } }),
        keymap.of([{ key: 'Mod-s', run: () => { this.downloadSource(); return true; } }]),
        EditorView.updateListener.of((update) => this.editorChanged(update)),
      ],
    });
  }

  private editorChanged(update: ViewUpdate): void {
    if (update.docChanged && this.current) {
      this.current = { ...this.current, source: update.state.doc.toString() };
      if (this.current.title === 'Untitled document' && this.current.source.trim()
        && (update.transactions.some((transaction) => transaction.isUserEvent('input.paste'))
          || (/^#\s/m.test(this.current.source) && this.current.source.includes('\n')))) {
        this.current.title = suggestDocumentTitle(this.current.source);
        this.updateTitle();
      }
      this.drafts.set(this.current.id, this.current);
      this.dirty = true;
      if (!this.storageAvailable) this.volatileDrafts.add(this.current.id);
      this.setSaveState(this.storageAvailable ? 'saving' : 'error', this.storageAvailable ? 'Saving in this browser…' : 'Not saved · download a copy');
      clearTimeout(this.previewTimer);
      this.previewTimer = window.setTimeout(() => this.render(), 180);
      this.scheduleSave();
      this.syncWelcome();
    }
    if (update.selectionSet || update.docChanged) this.updateCursor();
  }

  private scheduleSave(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => { void this.flush(); }, 500);
  }

  private async flush(): Promise<void> {
    clearTimeout(this.saveTimer);
    if (this.saveTask) return this.saveTask;
    if (!this.current || !this.dirty || !this.storageAvailable) return;
    this.saveTask = this.commitChanges();
    try { await this.saveTask; } finally { this.saveTask = undefined; }
  }

  private async commitChanges(): Promise<void> {
    while (this.current && this.dirty && this.storageAvailable) {
      const snapshot = { ...this.current };
      try {
        const committed = await saveDraft(snapshot, snapshot.revision);
        const latest = this.current;
        this.current = { ...committed, title: latest.title, source: latest.source };
        this.dirty = latest.source !== snapshot.source || latest.title !== snapshot.title;
        this.drafts.set(committed.id, this.current);
        this.volatileDrafts.delete(committed.id);
        this.setSaveState(this.dirty ? 'saving' : 'saved', this.dirty ? 'Saving in this browser…' : 'Saved in this browser');
        this.renderDocuments();
      } catch (error) {
        if (isDraftConflict(error)) {
          const latest = { ...this.current };
          if (error.current) this.drafts.set(error.current.id, error.current);
          else this.drafts.delete(latest.id);
          try {
            const recovery = await createDraft(`${latest.title.replace(/ \(recovered\)$/, '').slice(0, 188)} (recovered)`, latest.source);
            const newest = this.current;
            const title = newest.title === latest.title ? recovery.title : newest.title;
            this.current = { ...recovery, title, source: newest.source };
            this.dirty = newest.source !== latest.source || newest.title !== latest.title;
            // Typing while the recovery was being created may have updated the
            // old map entry. Keep the other tab's committed version there.
            if (error.current) this.drafts.set(error.current.id, error.current);
            else this.drafts.delete(latest.id);
            this.drafts.set(recovery.id, this.current);
            this.persistDocumentSettings();
            writeLocal(ACTIVE_KEY, recovery.id);
            this.updateTitle();
            this.renderDocuments();
            this.setSaveState(this.dirty ? 'saving' : 'saved', this.dirty ? 'Saving in this browser…' : 'Recovered copy saved');
            this.notify('This draft changed in another tab. Your edits are safe in a recovered copy.', 12_000);
          } catch (recoveryError) {
            const recovery = memoryDraft(`${this.current.title} (recovered)`, this.current.source);
            if (error.current) this.drafts.set(error.current.id, error.current);
            else this.drafts.delete(latest.id);
            this.current = recovery;
            this.drafts.set(recovery.id, recovery);
            this.persistDocumentSettings();
            this.volatileDrafts.add(recovery.id);
            this.ephemeralDrafts.add(recovery.id);
            this.storageFailure(recoveryError);
            this.updateTitle();
            this.renderDocuments();
          }
        } else this.storageFailure(error);
      }
    }
  }

  private storageFailure(error: unknown): void {
    this.storageAvailable = false;
    if (this.current) this.volatileDrafts.add(this.current.id);
    this.setSaveState('error', 'Not saved · download a copy');
    this.notify(messageOf(error), 15_000);
  }

  private async makeDraft(title: string, source: string): Promise<Draft> {
    let draft: Draft;
    if (this.storageAvailable) {
      try { draft = await createDraft(title, source); }
      catch (error) {
        this.storageFailure(error);
        draft = memoryDraft(title, source);
        this.volatileDrafts.add(draft.id);
        this.ephemeralDrafts.add(draft.id);
      }
    } else {
      draft = memoryDraft(title, source);
      this.volatileDrafts.add(draft.id);
      this.ephemeralDrafts.add(draft.id);
    }
    this.drafts.set(draft.id, draft);
    return draft;
  }

  private activate(draft: Draft): void {
    clearTimeout(this.previewTimer);
    for (const dialog of this.querySelectorAll<HTMLDialogElement>('[data-pdf-dialog], [data-cleanup-dialog], [data-organize-dialog]')) {
      if (dialog.open) dialog.close();
    }
    this.current = { ...draft };
    this.dirty = false;
    this.remoteImages = false;
    try { this.documentSettings = normalizeDocumentSettings(JSON.parse(readLocal(presentationKey(draft.id)) ?? '{}')); }
    catch { this.documentSettings = { ...DEFAULT_DOCUMENT_SETTINGS }; }
    this.organizeHistory = [];
    this.q<HTMLInputElement>('[data-remote-images]').checked = false;
    this.editor?.setState(this.editorState(draft.source));
    this.q('[data-preview-scroll]').scrollTop = 0;
    this.setSaveState(this.volatileDrafts.has(draft.id) ? 'error' : 'saved', this.volatileDrafts.has(draft.id) ? 'Not saved · download a copy' : 'Saved in this browser');
    writeLocal(ACTIVE_KEY, draft.id);
    this.updateTitle();
    this.renderDocuments();
    this.render();
    this.updateCursor();
    this.closeSidebar();
    this.syncWelcome();
  }

  private async switchDocument(id: string): Promise<void> {
    if (id === this.current?.id) { this.closeSidebar(); return; }
    await this.flush();
    const draft = this.drafts.get(id);
    if (draft) this.activate(draft);
  }

  private async newDocument(title = 'Untitled document', source = ''): Promise<void> {
    await this.flush();
    const draft = await this.makeDraft(title, source);
    // The old editor remains usable while IndexedDB creates this document.
    // Drain any edits made during that wait before changing the active draft.
    await this.flush();
    this.activate(draft);
    if (this.dataset.view === 'preview') this.setView(this.mobile.matches ? 'editor' : 'split');
    this.editor?.focus();
  }

  private async refreshFromStorage(): Promise<void> {
    if (!this.storageAvailable) return;
    const activeAtStart = this.current;
    let records: Draft[];
    try { records = await loadDrafts(); } catch { return; }
    const active = this.current;
    const fresh = records.find((draft) => draft.id === active?.id);
    this.drafts = new Map(records.map((draft) => [draft.id, draft]));
    if (active && (this.dirty || this.saveTask || active.id !== activeAtStart?.id || active.revision !== activeAtStart?.revision)) {
      // A save (or conflict recovery) can finish after the read's snapshot.
      // Keep its newer local result until a subsequent refresh sees it.
      this.drafts.set(active.id, active);
    }
    else if (fresh && active && fresh.revision > active.revision) {
      this.activate(fresh);
      this.notify('Loaded the latest version from your other tab.');
    } else if (fresh && active) {
      this.drafts.set(active.id, active);
    } else if (!fresh && active) {
      if (records[0]) this.activate(records[0]);
      else await this.newDocument();
      this.notify('That document was deleted in another tab.');
    }
    this.renderDocuments();
  }

  private updateTitle(): void {
    const title = this.current?.title ?? 'Untitled document';
    this.q('[data-document-title]').textContent = title;
    const isBlankUntitled = title === 'Untitled document' && !this.current?.source.trim();
    document.title = isBlankUntitled ? this.workspacePageTitle : `${title} · ${siteConfig.name}`;
  }

  private updateCursor(): void {
    if (!this.editor) return;
    const position = this.editor.state.selection.main.head;
    const line = this.editor.state.doc.lineAt(position);
    this.q('[data-cursor]').textContent = `Ln ${line.number}, Col ${position - line.from + 1}`;
  }

  private renderDocuments(): void {
    const container = this.q('[data-documents]');
    const fragment = document.createDocumentFragment();
    const allDrafts = [...this.drafts.values()].sort((a, b) => b.updatedAt - a.updatedAt);
    const search = this.documentSearch.trim().toLocaleLowerCase();
    const drafts = search ? allDrafts.filter((draft) => `${draft.title}\n${draft.source}`.toLocaleLowerCase().includes(search)) : allDrafts;
    for (const draft of drafts) {
      const row = document.createElement('div');
      row.className = `document-item${draft.id === this.current?.id ? ' active' : ''}`;
      row.setAttribute('role', 'listitem');
      const open = document.createElement('button');
      open.className = 'document-open';
      open.dataset.documentId = draft.id;
      open.title = draft.title;
      if (draft.id === this.current?.id) open.setAttribute('aria-current', 'true');
      const file = document.createElement('span');
      file.className = 'document-file-icon';
      file.append(icon('file'));
      const text = document.createElement('span');
      text.className = 'document-text';
      const name = document.createElement('span');
      name.className = 'document-name';
      name.textContent = draft.title;
      const date = document.createElement('span');
      date.className = 'document-date';
      const today = new Date().toDateString() === new Date(draft.updatedAt).toDateString();
      date.textContent = this.volatileDrafts.has(draft.id) ? 'Not saved · download a copy'
        : today ? 'Edited today' : `Edited ${new Date(draft.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
      text.append(name, date);
      open.append(file, text);
      const remove = document.createElement('button');
      remove.className = 'document-delete';
      remove.dataset.deleteId = draft.id;
      remove.setAttribute('aria-label', `Delete ${draft.title}`);
      remove.title = 'Delete document';
      remove.append(icon('delete'));
      row.append(open, remove);
      fragment.append(row);
    }
    container.replaceChildren(fragment);
    if (!drafts.length) {
      const empty = document.createElement('p');
      empty.className = 'loading-documents';
      empty.textContent = search ? 'No matching documents.' : 'Your documents will appear here.';
      container.append(empty);
    }
    this.q('[data-doc-count]').textContent = search ? `${drafts.length}/${allDrafts.length}` : String(drafts.length);
  }

  private render(): void {
    if (!this.current) return;
    if (this.editor?.composing) {
      this.previewTimer = window.setTimeout(() => this.render(), 100);
      return;
    }
    clearTimeout(this.previewTimer);
    const preview = this.q('[data-preview]');
    const scroller = this.q('[data-preview-scroll]');
    const previousTop = scroller.scrollTop;
    this.rendered = renderMarkdown(this.current.source, { allowRemoteImages: this.remoteImages });
    preview.innerHTML = this.rendered.html;
    if (!this.current.source.trim()) {
      const empty = document.createElement('p');
      empty.className = 'preview-placeholder';
      empty.textContent = 'Good ideas begin with a few words.';
      preview.append(empty);
    }
    scroller.scrollTop = previousTop;
    this.q('[data-word-count]').textContent = `${this.rendered.words.toLocaleString()} ${this.rendered.words === 1 ? 'word' : 'words'}`;
    this.q('[data-char-count]').textContent = `${this.current.source.length.toLocaleString()} characters`;
    this.q('[data-math-count]').textContent = `${this.rendered.mathCount} ${this.rendered.mathCount === 1 ? 'equation' : 'equations'}`;
    this.q('[data-reading-time]').textContent = this.rendered.words ? `${Math.max(1, Math.ceil(this.rendered.words / 200))} min read` : 'Ready when you are';
    const state = this.q('[data-render-state]');
    state.replaceChildren(document.createElement('span'), document.createTextNode(this.rendered.errors.length ? ' Check source' : ' Live'));
    this.renderOutline();
    const diagnostics = this.q('[data-diagnostics]');
    diagnostics.hidden = !this.rendered.errors.length;
    this.q('[data-error-heading]').textContent = `${this.rendered.errors.length} ${this.rendered.errors.length === 1 ? 'issue' : 'issues'} to check`;
    const issues = this.rendered.errors.map((error) => {
      const button = document.createElement('button');
      button.textContent = `Line ${error.line}: ${error.message}`;
      button.dataset.errorLine = String(error.line);
      return button;
    });
    this.q('[data-error-list]').replaceChildren(...issues);
    this.scrollSync?.refresh();
  }

  private renderOutline(): void {
    const outline = this.q('[data-outline]');
    const items = this.rendered?.headings.map((heading) => {
      const button = document.createElement('button');
      button.textContent = heading.text || 'Untitled heading';
      button.style.paddingLeft = `${6 + (heading.level - 1) * 11}px`;
      button.dataset.headingId = heading.id;
      return button;
    }) ?? [];
    if (items.length) outline.replaceChildren(...items);
    else {
      const empty = document.createElement('p');
      empty.textContent = 'Add a heading to begin an outline.';
      outline.replaceChildren(empty);
    }
  }

  private setSaveState(state: string, label: string): void {
    this.q('[data-save-state]').dataset.state = state;
    this.q('[data-save-label]').textContent = label;
  }

  private notify(message: string, duration = 5500): void {
    const toast = this.q('[data-toast]');
    clearTimeout(this.toastTimer);
    toast.textContent = message;
    toast.hidden = false;
    const dialog = this.querySelector<HTMLDialogElement>('dialog[open]');
    if (dialog) {
      let notice = dialog.querySelector<HTMLElement>('[data-dialog-notice]');
      if (!notice) {
        notice = document.createElement('p');
        notice.dataset.dialogNotice = '';
        notice.className = 'dialog-inline-notice';
        notice.setAttribute('role', 'status');
        dialog.prepend(notice);
      }
      notice.textContent = message;
    }
    this.toastTimer = window.setTimeout(() => { toast.hidden = true; }, duration);
  }

  private runAction(action: () => void | Promise<void>): void {
    this.actionQueue = this.actionQueue.then(action).catch((error) => this.notify(messageOf(error), 12_000));
  }

  private setView(view: ViewMode, persist = true): void {
    if (persist) { this.preferences.view = view; this.savePreferences(); }
    this.dataset.view = this.mobile.matches && view === 'split' ? 'editor' : view;
    for (const button of this.querySelectorAll<HTMLButtonElement>('[data-view-mode]')) {
      button.setAttribute('aria-pressed', String(button.dataset.viewMode === this.dataset.view));
    }
    requestAnimationFrame(() => { this.editor?.requestMeasure(); this.scrollSync?.refresh(); });
  }

  private savePreferences(): void { writeLocal(PREFERENCES_KEY, JSON.stringify(this.preferences)); }

  private configureControls(): void {
    this.style.setProperty('--editor-font-size', `${this.preferences.fontSize}px`);
    this.q<HTMLSelectElement>('[data-font-size]').value = String(this.preferences.fontSize);
    this.q<HTMLInputElement>('[data-wrap]').checked = this.preferences.wrap;
    this.q<HTMLInputElement>('[data-sync]').checked = this.preferences.sync;
    this.setShare(this.preferences.share);
    this.setView(this.preferences.view, false);
    const options = EXAMPLES.map((example) => {
      const button = document.createElement('button');
      button.className = 'example-option';
      button.dataset.exampleId = example.id;
      const description = document.createElement('span');
      const title = document.createElement('strong');
      title.textContent = example.title;
      const detail = document.createElement('small');
      detail.textContent = example.description;
      description.append(title, detail);
      const arrow = document.createElement('span');
      arrow.textContent = '↗';
      arrow.setAttribute('aria-hidden', 'true');
      button.append(description, arrow);
      return button;
    });
    this.q('[data-examples-list]').replaceChildren(...options);
  }

  private closeSidebar(): void {
    delete this.dataset.sidebarOpen;
    this.q('[data-sidebar-scrim]').hidden = true;
  }

  private closeExport(): void {
    const menu = this.exportControl('[data-export-menu]');
    const toggle = this.exportControl<HTMLButtonElement>('[data-export-toggle]');
    const returnFocus = !menu.hidden && menu.contains(document.activeElement);
    menu.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    if (returnFocus) toggle.focus();
  }

  private closeOutline(): void {
    this.q('[data-outline-panel]').hidden = true;
    this.q('[data-outline-toggle]').setAttribute('aria-expanded', 'false');
  }

  private downloadSource(): void {
    if (!this.current) return;
    this.closeExport();
    downloadMarkdown(this.current.source, this.current.title);
    this.notify('Markdown download started.');
  }

  private syncWelcome(): void {
    const show = !!this.current && !this.current.source.trim() && !this.dismissedWelcome.has(this.current.id);
    this.q('[data-welcome]').hidden = !show;
    this.toggleAttribute('data-welcoming', show);
  }

  /** Keep transformations as one undoable edit instead of resetting editor history. */
  private replaceSource(source: string): void {
    if (!this.editor || !this.current || source === this.current.source) return;
    this.editor.dispatch({
      changes: { from: 0, to: this.editor.state.doc.length, insert: source },
      selection: { anchor: 0 },
      annotations: isolateHistory.of('full'),
    });
    this.render();
  }

  private openPaste(): void {
    this.pasteTarget = this.current?.id;
    this.q<HTMLTextAreaElement>('[data-paste-source]').value = '';
    this.q<HTMLInputElement>('[data-paste-title]').value = '';
    this.q<HTMLSelectElement>('[data-paste-mode]').value = 'new';
    this.q<HTMLDialogElement>('[data-paste-dialog]').showModal();
    this.q<HTMLTextAreaElement>('[data-paste-source]').focus();
  }

  private async pasteDocument(source: string, title: string, mode: string, target?: string): Promise<void> {
    if (!source.trim()) throw new Error('Paste some text to start your document.');
    if (source.length > MAX_SOURCE_LENGTH) throw new Error('The preview supports up to 400,000 characters. Please paste a smaller document.');
    if (mode === 'append') {
      if (!this.current || this.current.id !== target) throw new Error('The active document changed. Close this panel and choose the document to append to.');
      const next = appendDocumentSection(this.current.source, source, title || undefined);
      if (next.length > MAX_SOURCE_LENGTH) throw new Error('The combined document exceeds the 400,000-character preview limit. Open the pasted text as a new document.');
      this.replaceSource(next);
    } else {
      const name = title.trim().slice(0, 100) || suggestDocumentTitle(source);
      if (this.current && this.current.id === target && !this.current.source.trim() && this.current.title === 'Untitled document') {
        this.current = { ...this.current, title: name };
        this.updateTitle();
        this.replaceSource(source);
      } else await this.newDocument(name, source);
    }
    this.q<HTMLDialogElement>('[data-paste-dialog]').close();
    this.syncWelcome();
    this.editor?.focus();
    this.notify(mode === 'append' ? 'Text appended. Use Organize to arrange your sections.' : 'Your text is ready. Try Clean up or choose a PDF style.');
  }

  private openCleanup(): void {
    if (!this.current?.source.trim()) { this.openPaste(); return; }
    this.cleanupSnapshot = { id: this.current.id, title: this.current.title, source: this.current.source };
    const suggestions = getCleanupSuggestions(this.current.source);
    const options = suggestions.map((suggestion) => {
      const label = document.createElement('label');
      label.className = 'cleanup-option';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = true;
      checkbox.dataset.cleanupId = suggestion.id;
      const text = document.createElement('span');
      const heading = document.createElement('strong');
      heading.textContent = suggestion.label;
      const detail = document.createElement('small');
      detail.textContent = suggestion.description;
      text.append(heading, detail);
      label.append(checkbox, text);
      return label;
    });
    this.q('[data-cleanup-options]').replaceChildren(...options);
    this.q('[data-cleanup-before]').textContent = this.current.source;
    this.updateCleanupPreview();
    this.q<HTMLDialogElement>('[data-cleanup-dialog]').showModal();
  }

  private selectedCleanup(): string[] {
    return [...this.querySelectorAll<HTMLInputElement>('[data-cleanup-id]:checked')].map((input) => input.dataset.cleanupId!);
  }

  private updateCleanupPreview(): void {
    if (!this.cleanupSnapshot) return;
    const source = applyCleanup(this.cleanupSnapshot.source, this.selectedCleanup());
    const changed = source !== this.cleanupSnapshot.source;
    this.q('[data-cleanup-after]').textContent = source;
    this.q<HTMLButtonElement>('[data-cleanup-apply]').disabled = !changed;
    this.q('[data-cleanup-status]').textContent = changed
      ? 'Ready to create a formatted copy. Equations, code, and wording are preserved.'
      : 'No formatting changes selected. Your document is already ready to style and export.';
  }

  private async applyFormatting(): Promise<void> {
    const snapshot = this.cleanupSnapshot;
    if (!snapshot) return;
    if (this.current?.id !== snapshot.id || this.current.source !== snapshot.source) {
      this.q('[data-cleanup-status]').textContent = 'This document changed while the panel was open. Close and reopen Clean up to review the latest text.';
      return;
    }
    const source = applyCleanup(snapshot.source, this.selectedCleanup());
    if (source === snapshot.source) return;
    const settings = { ...this.documentSettings };
    await this.newDocument(`${snapshot.title.slice(0, 88)} (formatted)`, snapshot.source);
    this.documentSettings = settings;
    this.persistDocumentSettings();
    this.replaceSource(source);
    this.q<HTMLDialogElement>('[data-cleanup-dialog]').close();
    this.editor?.focus();
    this.notify('Formatted copy created. Your original is kept; Ctrl/⌘ Z also undoes these changes.');
  }

  private openOrganizer(): void {
    if (!this.current?.source.trim()) { this.openPaste(); return; }
    this.organizeHistory = [];
    this.renderSections();
    this.q<HTMLDialogElement>('[data-organize-dialog]').showModal();
  }

  private renderSections(): void {
    const sections = getDocumentSections(this.current?.source ?? '');
    const rows = sections.map((section, index) => {
      const row = document.createElement('div');
      row.className = 'section-item';
      row.dataset.sectionId = section.id;
      const title = document.createElement('span');
      title.className = 'section-title';
      const position = document.createElement('small');
      position.textContent = String(index + 1).padStart(2, '0');
      const text = document.createElement('strong');
      text.textContent = section.title || 'Untitled section';
      title.append(position, text);
      const actions = document.createElement('div');
      actions.className = 'section-actions';
      for (const direction of ['up', 'down'] as const) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'icon-button';
        button.textContent = direction === 'up' ? '↑' : '↓';
        button.dataset.moveSection = section.id;
        button.dataset.direction = direction;
        button.setAttribute('aria-label', `Move ${section.title || 'section'} ${direction}`);
        button.disabled = direction === 'up' ? index === 0 : index === sections.length - 1;
        actions.append(button);
      }
      row.append(title, actions);
      return row;
    });
    this.q('[data-section-list]').replaceChildren(...rows);
    if (sections.length < 2) {
      const message = document.createElement('p');
      message.className = 'organize-empty';
      message.textContent = 'Add two or more peer headings, such as ## Introduction and ## Examples, to arrange their sections here. The document title stays at the top.';
      this.q('[data-section-list]').append(message);
    }
    const undoButton = this.querySelector<HTMLButtonElement>('[data-organize-undo]');
    if (undoButton) undoButton.disabled = !this.organizeHistory.length;
  }

  private moveSection(id: string, direction: 'up' | 'down'): void {
    if (!this.current) return;
    const sections = getDocumentSections(this.current.source);
    const index = sections.findIndex((section) => section.id === id);
    if (index < 0) { this.renderSections(); return; }
    const before = this.current.source;
    const after = moveDocumentSection(before, id, direction);
    if (before === after) return;
    this.organizeHistory.push({ id: this.current.id, before, after });
    this.replaceSource(after);
    this.renderSections();
    const nextIndex = index + (direction === 'up' ? -1 : 1);
    const nextRow = this.querySelectorAll<HTMLElement>('.section-item')[nextIndex];
    nextRow?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }

  private undoSectionMove(): void {
    const last = this.organizeHistory.at(-1);
    if (!last || !this.current) return;
    if (last.id !== this.current.id || last.after !== this.current.source) {
      this.organizeHistory = [];
      this.renderSections();
      this.notify('The document changed. Use the editor’s Undo command to review previous edits.');
      return;
    }
    this.organizeHistory.pop();
    if (this.editor) undo(this.editor);
    this.render();
    this.renderSections();
  }

  private persistDocumentSettings(): void {
    if (this.current) writeLocal(presentationKey(this.current.id), JSON.stringify(this.documentSettings));
  }

  private openPdf(): void {
    this.closeExport();
    if (!this.current?.source.trim()) { this.openPaste(); return; }
    this.pdfSnapshot = { id: this.current.id, title: this.current.title, source: this.current.source, allowRemoteImages: this.remoteImages };
    this.pdfRendered = renderMarkdown(this.current.source, { allowRemoteImages: this.remoteImages });
    const settings = this.documentSettings;
    for (const [selector, value] of [
      ['[data-pdf-paper]', settings.paper], ['[data-pdf-orientation]', settings.orientation],
      ['[data-pdf-font-size]', String(settings.fontSize)], ['[data-pdf-margins]', settings.margins],
      ['[data-pdf-spacing]', settings.spacing], ['[data-pdf-author]', settings.author],
    ]) this.q<HTMLInputElement | HTMLSelectElement>(selector!).value = value!;
    this.q<HTMLInputElement>('[data-pdf-title]').checked = settings.showTitle;
    this.q<HTMLInputElement>('[data-pdf-toc]').checked = settings.toc;
    this.q<HTMLInputElement>('[data-pdf-breaks]').checked = settings.breakBeforeSections;
    this.q<HTMLDialogElement>('[data-pdf-dialog]').showModal();
    this.updatePdfPreview();
  }

  private readPdfControls(): void {
    this.documentSettings = normalizeDocumentSettings({
      ...this.documentSettings,
      paper: this.q<HTMLSelectElement>('[data-pdf-paper]').value,
      orientation: this.q<HTMLSelectElement>('[data-pdf-orientation]').value,
      fontSize: Number(this.q<HTMLSelectElement>('[data-pdf-font-size]').value),
      margins: this.q<HTMLSelectElement>('[data-pdf-margins]').value,
      spacing: this.q<HTMLSelectElement>('[data-pdf-spacing]').value,
      author: this.q<HTMLInputElement>('[data-pdf-author]').value,
      showTitle: this.q<HTMLInputElement>('[data-pdf-title]').checked,
      toc: this.q<HTMLInputElement>('[data-pdf-toc]').checked,
      breakBeforeSections: this.q<HTMLInputElement>('[data-pdf-breaks]').checked,
    });
    if (this.current?.id === this.pdfSnapshot?.id) this.persistDocumentSettings();
    this.updatePdfPreview();
  }

  private fitPdfPreview(): void {
    const article = this.q('[data-pdf-preview]');
    const stage = this.q('[data-pdf-preview-stage]');
    const sheet = this.querySelector<HTMLElement>('[data-pdf-preview-sheet]');
    const metrics = documentPageMetrics(this.documentSettings);
    const width = metrics.widthMm * 96 / 25.4;
    const scale = Math.min(1, Math.max(0.15, (stage.clientWidth - 32) / width));
    article.style.width = `${metrics.widthMm}mm`;
    article.style.minHeight = `${metrics.heightMm}mm`;
    article.style.padding = `${metrics.marginMm}mm`;
    article.style.boxSizing = 'border-box';
    article.style.transformOrigin = 'top left';
    article.style.transform = `scale(${scale})`;
    if (sheet) {
      sheet.style.width = `${width * scale}px`;
      sheet.style.height = `${article.offsetHeight * scale}px`;
    }
  }

  private updatePdfPreview(): void {
    const snapshot = this.pdfSnapshot;
    if (!snapshot) return;
    const token = ++this.pdfPreviewToken;
    for (const button of this.querySelectorAll<HTMLButtonElement>('[data-pdf-style]')) {
      button.setAttribute('aria-pressed', String(button.dataset.pdfStyle === this.documentSettings.style));
    }
    const result = this.pdfRendered ?? renderMarkdown(snapshot.source, { allowRemoteImages: snapshot.allowRemoteImages });
    const article = this.q('[data-pdf-preview]');
    this.q<HTMLStyleElement>('[data-pdf-preview-style]').textContent = documentPresentationCss(this.documentSettings, '[data-pdf-preview]');
    article.innerHTML = prepareDocumentHtml(result.html, snapshot.title, this.documentSettings);
    // The editor's live preview remains mounted. Keep preview anchors unique.
    const ids = new Map<string, string>();
    for (const element of article.querySelectorAll<HTMLElement>('[id]')) {
      const id = `qft-layout-${element.id}`;
      ids.set(element.id, id);
      element.id = id;
    }
    for (const anchor of article.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')) {
      let target = anchor.getAttribute('href')!.slice(1);
      try { target = decodeURIComponent(target); } catch { /* Keep the original fragment. */ }
      const id = ids.get(target);
      if (id) anchor.setAttribute('href', `#${id}`);
    }
    this.q<HTMLButtonElement>('[data-pdf-print]').disabled = !result.html;
    this.q<HTMLButtonElement>('[data-pdf-html]').disabled = !result.html;
    this.fitPdfPreview();
    const showIssues = () => {
      if (token !== this.pdfPreviewToken || !this.q<HTMLDialogElement>('[data-pdf-dialog]').open) return;
      this.fitPdfPreview();
      const issues = [...new Set([
        ...result.errors.map((error) => `Line ${error.line}: ${error.message}`),
        ...inspectPrintLayout(article, this.documentSettings),
      ])];
      const list = this.q('[data-pdf-issues]');
      list.hidden = !issues.length;
      list.replaceChildren(...issues.slice(0, 8).map((issue) => {
        const paragraph = document.createElement('p');
        paragraph.textContent = issue;
        return paragraph;
      }));
    };
    requestAnimationFrame(showIssues);
    void document.fonts.ready.then(showIssues);
    for (const image of article.querySelectorAll('img')) {
      image.addEventListener('load', showIssues, { once: true });
      image.addEventListener('error', showIssues, { once: true });
    }
  }

  private async exportStyledHtml(): Promise<void> {
    const snapshot = this.pdfSnapshot;
    const dialog = this.q<HTMLDialogElement>('[data-pdf-dialog]');
    if (!snapshot || !dialog.open) return;
    if (this.current?.id !== snapshot.id || this.current.source !== snapshot.source || this.current.title !== snapshot.title) {
      dialog.close();
      this.openPdf();
      this.notify('The document changed. Review its updated presentation before exporting.');
      return;
    }
    const settings = { ...this.documentSettings };
    dialog.close();
    this.notify('Preparing a portable document with embedded math fonts…', 30_000);
    await exportPortableHtml(snapshot.source, snapshot.title, { allowRemoteImages: snapshot.allowRemoteImages }, settings);
    this.notify('Your styled HTML download is ready.');
  }

  private async exportHtml(): Promise<void> {
    if (!this.current) return;
    this.closeExport();
    this.notify('Preparing a portable document with embedded math fonts…', 30_000);
    const source = this.current.source;
    const title = this.current.title;
    await exportPortableHtml(source, title, { allowRemoteImages: this.remoteImages }, this.documentSettings);
    this.notify('Your standalone HTML download is ready.');
  }

  private async print(): Promise<void> {
    this.closeExport();
    const snapshot = this.pdfSnapshot;
    const dialog = this.q<HTMLDialogElement>('[data-pdf-dialog]');
    if (!snapshot || !dialog.open) return;
    if (this.current?.id !== snapshot.id || this.current.source !== snapshot.source || this.current.title !== snapshot.title) {
      dialog.close();
      this.openPdf();
      this.notify('The document changed. Review its updated presentation before printing.');
      return;
    }
    const settings = { ...this.documentSettings };
    const result = renderMarkdown(snapshot.source, { allowRemoteImages: snapshot.allowRemoteImages });
    if (!result.html) throw new Error(result.errors[0]?.message ?? 'This document could not be rendered.');
    dialog.close();
    await printDocument(result.html, snapshot.title, settings);
  }

  private async openFile(file: File): Promise<void> {
    if (!/\.(md|markdown|txt)$/i.test(file.name)) throw new Error('Choose a Markdown (.md or .markdown) or plain text (.txt) file.');
    if (file.size > MAX_SOURCE_LENGTH * 4) throw new Error('This file is too large. The preview supports up to 400,000 characters.');
    const source = await file.text();
    if (source.length > MAX_SOURCE_LENGTH) throw new Error('This file is too large. The preview supports up to 400,000 characters.');
    await this.newDocument(file.name.replace(/\.(md|markdown|txt)$/i, '').slice(0, 100) || 'Imported document', source);
    this.notify('Opened as a new document. Your original file is unchanged.');
  }

  private setShare(value: number): void {
    const share = Math.max(25, Math.min(75, value));
    this.preferences.share = share;
    this.q('[data-panels]').style.setProperty('--editor-share', `${share}%`);
    this.q('[data-resizer]').setAttribute('aria-valuenow', String(Math.round(share)));
    this.scrollSync?.refresh();
  }

  private bindEvents(): void {
    const { signal } = this.abort;
    const click = (selector: string, handler: (event: MouseEvent) => void, root: ParentNode = this) => {
      root.querySelectorAll<HTMLElement>(selector).forEach((element) => element.addEventListener('click', handler, { signal }));
    };
    const headerExports = this.headerExports();
    click('[data-paste], [data-welcome-paste]', () => this.openPaste());
    click('[data-welcome-open]', () => this.q<HTMLInputElement>('[data-file-input]').click());
    click('[data-welcome-examples]', () => this.q<HTMLDialogElement>('[data-examples-dialog]').showModal());
    click('[data-welcome-dismiss]', () => {
      if (this.current) this.dismissedWelcome.add(this.current.id);
      this.syncWelcome();
      this.editor?.focus();
    });
    click('[data-paste-close]', () => this.q<HTMLDialogElement>('[data-paste-dialog]').close());
    this.q<HTMLTextAreaElement>('[data-paste-source]').addEventListener('input', (event) => {
      (event.target as HTMLTextAreaElement).setCustomValidity('');
    }, { signal });
    this.q<HTMLFormElement>('[data-paste-form]').addEventListener('submit', (event) => {
      event.preventDefault();
      const input = this.q<HTMLTextAreaElement>('[data-paste-source]');
      const source = input.value;
      const title = this.q<HTMLInputElement>('[data-paste-title]').value;
      const mode = this.q<HTMLSelectElement>('[data-paste-mode]').value;
      const target = this.pasteTarget;
      const button = this.q('[data-paste-form]').querySelector<HTMLButtonElement>('button[type="submit"]')!;
      button.disabled = true;
      this.runAction(async () => {
        try { await this.pasteDocument(source, title, mode, target); }
        catch (error) { input.setCustomValidity(messageOf(error)); input.reportValidity(); }
        finally { button.disabled = false; }
      });
    }, { signal });
    click('[data-cleanup]', () => this.openCleanup());
    click('[data-cleanup-close]', () => this.q<HTMLDialogElement>('[data-cleanup-dialog]').close());
    this.q('[data-cleanup-options]').addEventListener('change', () => this.updateCleanupPreview(), { signal });
    click('[data-cleanup-apply]', () => {
      this.q<HTMLButtonElement>('[data-cleanup-apply]').disabled = true;
      this.runAction(async () => {
        try { await this.applyFormatting(); }
        finally { this.q<HTMLButtonElement>('[data-cleanup-apply]').disabled = false; }
      });
    });
    click('[data-organize]', () => this.openOrganizer());
    click('[data-organize-close]', () => this.q<HTMLDialogElement>('[data-organize-dialog]').close());
    click('[data-organize-undo]', () => this.undoSectionMove());
    this.q('[data-section-list]').addEventListener('click', (event) => {
      const button = (event.target as Element).closest<HTMLElement>('[data-move-section]');
      if (button?.dataset.moveSection && ['up', 'down'].includes(button.dataset.direction ?? '')) {
        this.moveSection(button.dataset.moveSection, button.dataset.direction as 'up' | 'down');
      }
    }, { signal });
    this.q<HTMLInputElement>('[data-document-search]').addEventListener('input', (event) => {
      this.documentSearch = (event.target as HTMLInputElement).value;
      this.renderDocuments();
    }, { signal });
    click('[data-pdf], [data-print]', () => this.openPdf(), headerExports);
    click('[data-pdf-close]', () => this.q<HTMLDialogElement>('[data-pdf-dialog]').close());
    click('[data-pdf-style]', (event) => {
      this.documentSettings = normalizeDocumentSettings({ ...this.documentSettings, style: (event.currentTarget as HTMLElement).dataset.pdfStyle });
      this.readPdfControls();
    });
    this.q('[data-pdf-dialog]').addEventListener('change', (event) => {
      if ((event.target as Element).matches('select,input')) this.readPdfControls();
    }, { signal });
    this.q<HTMLInputElement>('[data-pdf-author]').addEventListener('input', () => this.readPdfControls(), { signal });
    click('[data-pdf-print]', () => this.runAction(() => this.print()));
    click('[data-pdf-html]', () => this.runAction(() => this.exportStyledHtml()));
    window.addEventListener('resize', () => {
      if (this.q<HTMLDialogElement>('[data-pdf-dialog]').open) this.fitPdfPreview();
    }, { signal });
    for (const dialog of this.querySelectorAll<HTMLDialogElement>('dialog')) {
      dialog.addEventListener('close', () => dialog.querySelector('[data-dialog-notice]')?.remove(), { signal });
    }
    click('[data-new]', () => this.runAction(() => this.newDocument()));
    click('[data-open]', () => this.q<HTMLInputElement>('[data-file-input]').click());
    this.q<HTMLInputElement>('[data-file-input]').addEventListener('change', (event) => {
      const input = event.target as HTMLInputElement;
      const file = input.files?.[0];
      input.value = '';
      if (file) this.runAction(() => this.openFile(file));
    }, { signal });
    this.q('[data-documents]').addEventListener('click', (event) => {
      const target = event.target as Element;
      const remove = target.closest<HTMLElement>('[data-delete-id]');
      if (remove?.dataset.deleteId) {
        this.deletingId = remove.dataset.deleteId;
        this.q('[data-delete-title]').textContent = this.drafts.get(this.deletingId)?.title ?? 'This document';
        this.q<HTMLDialogElement>('[data-delete-dialog]').showModal();
      } else {
        const id = target.closest<HTMLElement>('[data-document-id]')?.dataset.documentId;
        if (id) this.runAction(() => this.switchDocument(id));
      }
    }, { signal });
    click('[data-rename]', () => {
      this.q<HTMLInputElement>('[data-name-input]').value = this.current?.title ?? '';
      this.q<HTMLDialogElement>('[data-name-dialog]').showModal();
      this.q<HTMLInputElement>('[data-name-input]').select();
    });
    click('[data-name-close]', () => this.q<HTMLDialogElement>('[data-name-dialog]').close());
    this.q<HTMLFormElement>('[data-name-form]').addEventListener('submit', (event) => {
      event.preventDefault();
      if (!this.current) return;
      const title = this.q<HTMLInputElement>('[data-name-input]').value.trim() || 'Untitled document';
      this.current = { ...this.current, title };
      this.drafts.set(this.current.id, this.current);
      this.dirty = true;
      if (!this.storageAvailable) this.volatileDrafts.add(this.current.id);
      this.updateTitle();
      this.renderDocuments();
      this.q<HTMLDialogElement>('[data-name-dialog]').close();
      this.runAction(() => this.flush());
    }, { signal });
    click('[data-delete-close]', () => this.q<HTMLDialogElement>('[data-delete-dialog]').close());
    this.q<HTMLFormElement>('[data-delete-form]').addEventListener('submit', (event) => {
      event.preventDefault();
      const id = this.deletingId;
      this.q<HTMLDialogElement>('[data-delete-dialog]').close();
      if (!id) return;
      this.runAction(async () => {
        await this.flush();
        if (!this.ephemeralDrafts.has(id)) {
          if (!this.storageAvailable) {
            throw new Error('Local storage is unavailable, so this saved document was not deleted. Download any unsaved work before reloading and trying again.');
          }
          await deleteDraft(id);
        }
        // Edits made while deletion was pending must settle before a switch.
        // If this was the active draft, conflict recovery preserves those edits.
        await this.flush();
        this.drafts.delete(id);
        this.volatileDrafts.delete(id);
        this.ephemeralDrafts.delete(id);
        if (this.current?.id === id) {
          const next = [...this.drafts.values()].sort((a, b) => b.updatedAt - a.updatedAt)[0];
          if (next) this.activate(next);
          else await this.newDocument();
        }
        this.renderDocuments();
        this.notify('Document deleted.');
      });
    }, { signal });
    click('[data-duplicate]', () => this.runAction(async () => {
      if (this.current) {
        const settings = { ...this.documentSettings };
        await this.newDocument(`${this.current.title.slice(0, 193)} (copy)`, this.current.source);
        this.documentSettings = settings;
        this.persistDocumentSettings();
      }
    }));
    click('[data-show-examples]', () => this.q<HTMLDialogElement>('[data-examples-dialog]').showModal());
    click('[data-examples-close]', () => this.q<HTMLDialogElement>('[data-examples-dialog]').close());
    this.q('[data-examples-list]').addEventListener('click', (event) => {
      const id = (event.target as Element).closest<HTMLElement>('[data-example-id]')?.dataset.exampleId;
      const example = EXAMPLES.find((item) => item.id === id);
      if (example) {
        this.q<HTMLDialogElement>('[data-examples-dialog]').close();
        this.runAction(() => this.newDocument(example.title, example.source));
      }
    }, { signal });
    click('[data-settings]', () => this.q<HTMLDialogElement>('[data-settings-dialog]').showModal());
    click('[data-settings-close]', () => this.q<HTMLDialogElement>('[data-settings-dialog]').close());
    this.q<HTMLSelectElement>('[data-font-size]').addEventListener('change', (event) => {
      this.preferences.fontSize = Number((event.target as HTMLSelectElement).value);
      this.style.setProperty('--editor-font-size', `${this.preferences.fontSize}px`);
      this.savePreferences();
      this.editor?.requestMeasure();
    }, { signal });
    this.q<HTMLInputElement>('[data-wrap]').addEventListener('change', (event) => {
      this.preferences.wrap = (event.target as HTMLInputElement).checked;
      this.editor?.dispatch({ effects: this.wrapping.reconfigure(this.preferences.wrap ? EditorView.lineWrapping : []) });
      this.savePreferences();
    }, { signal });
    this.q<HTMLInputElement>('[data-remote-images]').addEventListener('change', (event) => {
      this.remoteImages = (event.target as HTMLInputElement).checked;
      this.render();
    }, { signal });
    this.q<HTMLInputElement>('[data-sync]').addEventListener('change', (event) => {
      this.preferences.sync = (event.target as HTMLInputElement).checked;
      this.savePreferences();
      this.scrollSync?.refresh();
    }, { signal });
    click('[data-view-mode]', (event) => this.setView((event.currentTarget as HTMLElement).dataset.viewMode as ViewMode));
    click('[data-toggle-sidebar]', () => {
      if (this.narrow.matches) {
        const open = this.dataset.sidebarOpen !== 'true';
        this.dataset.sidebarOpen = String(open);
        this.q('[data-sidebar-scrim]').hidden = !open;
      } else this.dataset.sidebarHidden = String(this.dataset.sidebarHidden !== 'true');
      this.scrollSync?.refresh();
    });
    click('[data-close-sidebar], [data-sidebar-scrim]', () => this.closeSidebar());
    click('[data-export-toggle]', () => {
      const menu = this.exportControl('[data-export-menu]');
      menu.hidden = !menu.hidden;
      this.exportControl('[data-export-toggle]').setAttribute('aria-expanded', String(!menu.hidden));
      if (!menu.hidden) menu.querySelector('button')?.focus();
    }, headerExports);
    click('[data-export-md]', () => this.downloadSource(), headerExports);
    click('[data-export-html]', () => this.runAction(() => this.exportHtml()), headerExports);
    click('[data-find]', () => {
      if (this.dataset.view === 'preview') this.setView(this.mobile.matches ? 'editor' : 'split');
      if (this.editor) openSearchPanel(this.editor);
    });
    click('[data-outline-toggle]', () => {
      const panel = this.q('[data-outline-panel]');
      panel.hidden = !panel.hidden;
      this.q('[data-outline-toggle]').setAttribute('aria-expanded', String(!panel.hidden));
    });
    click('[data-outline-close]', () => this.closeOutline());
    this.q('[data-outline]').addEventListener('click', (event) => {
      const id = (event.target as Element).closest<HTMLElement>('[data-heading-id]')?.dataset.headingId;
      if (id) this.q('[data-preview]').querySelector(`#${CSS.escape(id)}`)?.scrollIntoView({ block: 'start' });
      this.closeOutline();
    }, { signal });
    click('[data-diagnostics-toggle]', () => {
      const errors = this.q('[data-error-list]');
      errors.hidden = !errors.hidden;
      this.q('[data-diagnostics-toggle]').setAttribute('aria-expanded', String(!errors.hidden));
    });
    this.q('[data-error-list]').addEventListener('click', (event) => {
      const number = Number((event.target as Element).closest<HTMLElement>('[data-error-line]')?.dataset.errorLine);
      if (!number || !this.editor) return;
      if (this.dataset.view === 'preview') this.setView(this.mobile.matches ? 'editor' : 'split');
      const from = this.editor.state.doc.line(Math.min(this.editor.state.doc.lines, Math.max(1, number))).from;
      this.editor.dispatch({ selection: { anchor: from }, effects: EditorView.scrollIntoView(from, { y: 'center' }) });
      this.editor.focus();
    }, { signal });
    document.addEventListener('click', (event) => {
      if (!(event.target as Element).closest('.export-wrapper')) this.closeExport();
    }, { signal });
    document.addEventListener('keydown', (event) => {
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') { this.closeExport(); this.closeOutline(); this.closeSidebar(); }
      if (this.querySelector('dialog[open]')) {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p' && this.q<HTMLDialogElement>('[data-pdf-dialog]').open) {
          event.preventDefault();
          this.runAction(() => this.print());
        }
        return;
      }
      if (event.ctrlKey || event.metaKey) {
        if (event.key.toLowerCase() === 's') { event.preventDefault(); this.downloadSource(); }
        if (event.key.toLowerCase() === 'o') { event.preventDefault(); this.q<HTMLInputElement>('[data-file-input]').click(); }
        if (event.key.toLowerCase() === 'p') { event.preventDefault(); this.openPdf(); }
        if (event.key.toLowerCase() === 'f') {
          event.preventDefault();
          if (this.dataset.view === 'preview') this.setView(this.mobile.matches ? 'editor' : 'split');
          if (this.editor) openSearchPanel(this.editor);
        }
      } else if (event.key.toLowerCase() === 'n' && !(event.target as Element).closest('input, textarea, select, [contenteditable="true"]')) {
        event.preventDefault();
        this.runAction(() => this.newDocument());
      }
    }, { signal });
    this.mobile.addEventListener('change', () => this.setView(this.preferences.view, false), { signal });
    this.narrow.addEventListener('change', () => this.closeSidebar(), { signal });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void this.flush();
    }, { signal });
    window.addEventListener('pagehide', () => { void this.flush(); }, { signal });
    window.addEventListener('beforeunload', (event) => {
      if (this.dirty || this.saveTask || this.volatileDrafts.size) {
        event.preventDefault();
      }
    }, { signal });
    let dragDepth = 0;
    this.addEventListener('dragenter', (event) => {
      if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); dragDepth++; this.classList.add('is-dragging'); }
    }, { signal });
    this.addEventListener('dragover', (event) => {
      if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }
    }, { signal });
    this.addEventListener('dragleave', () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) this.classList.remove('is-dragging');
    }, { signal });
    this.addEventListener('drop', (event) => {
      if (!event.dataTransfer?.files.length) return;
      event.preventDefault();
      event.stopPropagation();
      dragDepth = 0;
      this.classList.remove('is-dragging');
      const file = event.dataTransfer.files[0];
      this.runAction(() => this.openFile(file));
    }, { capture: true, signal });
    const resizer = this.q('[data-resizer]');
    resizer.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      resizer.setPointerCapture(event.pointerId);
      event.preventDefault();
    }, { signal });
    resizer.addEventListener('pointermove', (event) => {
      if (!resizer.hasPointerCapture(event.pointerId)) return;
      const bounds = this.q('[data-panels]').getBoundingClientRect();
      this.setShare((event.clientX - bounds.left) / bounds.width * 100);
    }, { signal });
    resizer.addEventListener('pointerup', (event) => {
      if (resizer.hasPointerCapture(event.pointerId)) resizer.releasePointerCapture(event.pointerId);
      this.savePreferences();
    }, { signal });
    resizer.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      this.setShare(event.key === 'Home' ? 25 : event.key === 'End' ? 75 : this.preferences.share + (event.key === 'ArrowLeft' ? -2 : 2));
      this.savePreferences();
    }, { signal });
    resizer.addEventListener('dblclick', () => { this.setShare(50); this.savePreferences(); }, { signal });
  }
}

if (!customElements.get('qft-markdown-workspace')) customElements.define('qft-markdown-workspace', MarkdownWorkspace);
