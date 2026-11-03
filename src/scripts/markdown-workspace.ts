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
  DRAFT_CHANNEL_NAME, type Draft, type DraftOptions, type DraftChangeMessage,
} from '../lib/draft-store';
import { renderMarkdown, MAX_SOURCE_LENGTH, type MarkdownResult, type RenderOptions } from '../lib/render-markdown';
import { createImageObjectUrls, prepareImageFiles, imageMarkdown } from '../lib/image-assets';
import { renderSlides, normalizeSlideSettings, type SlideResult, type SlideSettings } from '../lib/slides';
import { interactiveFence, findInteractiveFences, replaceInteractiveFence } from '../lib/interactive-demos';
import { DEMO_PRESETS } from '../lib/demo-presets';
import { demoSettingFields, normalizeDemoSettings, type DemoSettings } from '../lib/demo-settings';
import { createLessonProject, cloneLessonProject, validateLessonProject, projectFilePath, prepareProjectImages } from '../lib/lesson-project';
import { generateLessonPrompt, createStarterLesson, type LessonAIInput } from '../lib/ai-lesson';
import { checkLesson, formatLessonReport } from '../lib/lesson-check';
import type { LessonFileChange } from '../lib/lesson-revision';
import type { WorkspaceBundle } from '../lib/document-bundle';
import { createInteractiveDemos, type InteractiveDemoController } from './interactive-demo-runtime';
import type { SlidePreview, SlidePreviewState } from './slide-preview';
import { downloadMarkdown, exportPortableHtml, printDocument, makeInteractivePrintCopy } from '../lib/export-document';
import {
  DEFAULT_DOCUMENT_SETTINGS, normalizeDocumentSettings, prepareDocumentHtml,
  documentPresentationCss, documentPageMetrics, inspectPrintLayout, type DocumentSettings,
} from '../lib/document-presentation';
import {
  getDocumentSections, moveDocumentSection,
  suggestDocumentTitle, appendDocumentSection,
} from '../lib/document-tools';
import { cleanupOptions, reviewCleanup, cleanupDiff, type CleanupTarget, type CleanupReview } from '../lib/cleanup-review';
import { connectScrollSync } from '../lib/scroll-sync';
import { EXAMPLES } from '../lib/examples';
import { siteConfig } from '../config/site';
import { scopedStorageKey } from '../lib/storage-scope';
import { withBase } from '../lib/site-path';

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
function draftOptions(draft: DraftOptions): DraftOptions {
  return { images: draft.images, mode: draft.mode, slideTheme: draft.slideTheme, slideRatio: draft.slideRatio, project: draft.project };
}
function copiedDraftOptions(draft: DraftOptions): DraftOptions {
  const options = draftOptions(draft);
  if (options.project) options.project = { ...cloneLessonProject(options.project), id:createDraftId() };
  return options;
}
function sameDraftContent(a: Draft, b: Draft): boolean {
  return a.source === b.source && a.title === b.title && a.mode === b.mode
    && a.slideTheme === b.slideTheme && a.slideRatio === b.slideRatio
    && JSON.stringify(a.project) === JSON.stringify(b.project)
    && (a.images?.length ?? 0) === (b.images?.length ?? 0)
    && (a.images ?? []).every((image, index) => image.id === b.images?.[index]?.id);
}
function memoryDraft(title: string, source: string, options: DraftOptions = {}): Draft {
  return { id: createDraftId(), title, source, ...draftOptions(options), createdAt: Date.now(), updatedAt: Date.now(), revision: 1 };
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
  private imageUrls?: ReturnType<typeof createImageObjectUrls>;
  private imageTarget?: string;
  private demoTarget?: string;
  private demoEdit?: { id:string; entry:ReturnType<typeof findInteractiveFences>[number]; path?:string; originalFile?:string };
  private lessonFiles?: { id:string; source:string; project:string; selected:string; edits:Map<string,string> };
  private lessonImport?: { bundle:WorkspaceBundle; target:Draft; changes:LessonFileChange[] };
  private documentDemos?: InteractiveDemoController;
  private slidePreview?: SlidePreview;
  private slideLoading?: Promise<void>;
  private slidesRendered?: SlideResult;
  private slideGeneration = 0;
  private slideOverflow = false;
  private initialized = false;
  private documentSearch = '';
  private documentSettings: DocumentSettings = { ...DEFAULT_DOCUMENT_SETTINGS };
  private dismissedWelcome = new Set<string>();
  private cleanupSnapshot?: { id: string; title: string; source: string };
  private cleanupTarget: CleanupTarget = 'markdown';
  private cleanupReview?: CleanupReview;
  private cleanupBusy = false;
  private cleanupGeneration = 0;
  private organizeHistory: { id: string; before: string; after: string }[] = [];
  private pdfSnapshot?: DraftOptions & { id: string; title: string; source: string; allowRemoteImages: boolean };
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
    this.slideGeneration += 1;
    this.slidePreview?.destroy();
    this.documentDemos?.destroy();
    this.imageUrls?.revoke();
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
    if (requestedExample) initial = await this.makeDraft(requestedExample.title, requestedExample.source, requestedExample);
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
      isEnabled: () => this.preferences.sync && this.current?.mode !== 'slides' && this.dataset.view === 'split' && !this.mobile.matches,
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
        keymap.of([{ key: 'Mod-s', run: () => { this.runAction(() => this.downloadSource()); return true; } }]),
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
        this.current = { ...committed, ...draftOptions(latest), title: latest.title, source: latest.source };
        this.dirty = !sameDraftContent(latest, snapshot);
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
            const recovery = await createDraft(`${latest.title.replace(/ \(recovered\)$/, '').slice(0, 188)} (recovered)`, latest.source, copiedDraftOptions(latest));
            const newest = this.current;
            const title = newest.title === latest.title ? recovery.title : newest.title;
            this.current = { ...recovery, ...draftOptions(newest), project:recovery.project ? { ...(newest.project ?? recovery.project),id:recovery.project.id } : undefined, title, source: newest.source };
            this.dirty = !sameDraftContent(newest, latest);
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
            const recovery = memoryDraft(`${this.current.title} (recovered)`, this.current.source, this.current);
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

  private async makeDraft(title: string, source: string, options: DraftOptions = {}): Promise<Draft> {
    let draft: Draft;
    if (this.storageAvailable) {
      try { draft = await createDraft(title, source, options); }
      catch (error) {
        this.storageFailure(error);
        draft = memoryDraft(title, source, options);
        this.volatileDrafts.add(draft.id);
        this.ephemeralDrafts.add(draft.id);
      }
    } else {
      draft = memoryDraft(title, source, options);
      this.volatileDrafts.add(draft.id);
      this.ephemeralDrafts.add(draft.id);
    }
    this.drafts.set(draft.id, draft);
    return draft;
  }

  private activate(draft: Draft): void {
    clearTimeout(this.previewTimer);
    for (const dialog of this.querySelectorAll<HTMLDialogElement>('[data-pdf-dialog], [data-slide-pdf-dialog], [data-cleanup-dialog], [data-organize-dialog], [data-demo-dialog], [data-ai-dialog], [data-demo-edit-dialog], [data-lesson-files-dialog], [data-lesson-check-dialog], [data-lesson-update-dialog]')) {
      if (dialog.open) dialog.close();
    }
    this.current = { ...draft };
    this.documentDemos?.destroy();
    this.documentDemos = undefined;
    this.slidePreview?.exitPresentation();
    this.slidePreview?.resetDemos();
    this.slidePreview?.goTo(0);
    this.refreshImages();
    this.syncContentMode();
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

  private async newDocument(title = 'Untitled document', source = '', options: DraftOptions = {}): Promise<void> {
    await this.flush();
    const draft = await this.makeDraft(title, source, options);
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
    const lessonEditorOpen = this.q<HTMLDialogElement>('[data-demo-edit-dialog]').open || this.q<HTMLDialogElement>('[data-lesson-files-dialog]').open;
    if (active && (this.dirty || this.saveTask || lessonEditorOpen || active.id !== activeAtStart?.id || active.revision !== activeAtStart?.revision)) {
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
    const options = { ...this.renderOptions(), editableDemos:true };
    const isSlides = this.current.mode === 'slides';
    this.slidesRendered = isSlides ? renderSlides(this.current.source, options) : undefined;
    this.rendered = this.slidesRendered ?? renderMarkdown(this.current.source, options);
    preview.innerHTML = isSlides ? '' : this.rendered.html;
    if (!this.documentDemos) {
      this.documentDemos = createInteractiveDemos(preview, {
        sandboxUrl: withBase('demo-sandbox.html'),
        isActive: () => this.current?.mode !== 'slides' && this.dataset.view !== 'editor',
        onLayout: () => this.scrollSync?.refresh(),
      });
    }
    this.documentDemos.sync();
    this.slidePreview?.syncDemos();
    if (isSlides) void this.updateSlides();
    if (!isSlides && !this.current.source.trim()) {
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

  private renderOptions(allowRemoteImages = this.remoteImages): RenderOptions {
    return {
      allowRemoteImages,
      project: this.current?.project,
      ...(this.imageUrls?.sources.size ? { imageSources: this.imageUrls.sources } : {}),
    };
  }

  private refreshImages(): void {
    const previous = this.imageUrls;
    this.imageUrls = this.current?.images?.length ? createImageObjectUrls(this.current.images) : undefined;
    previous?.revoke();
  }

  private markDraftChanged(): void {
    if (!this.current) return;
    this.drafts.set(this.current.id, this.current);
    this.dirty = true;
    if (!this.storageAvailable) this.volatileDrafts.add(this.current.id);
    this.setSaveState(this.storageAvailable ? 'saving' : 'error', this.storageAvailable ? 'Saving in this browser…' : 'Not saved · download a copy');
    this.scheduleSave();
  }

  private async insertImages(files: File[], target = this.current?.id): Promise<void> {
    if (!this.current || this.current.id !== target || !this.editor) throw new Error('Choose the document where you want to insert these images, then try again.');
    const prepared = await prepareImageFiles(files, this.current.images ?? []);
    if (!prepared.length) return;
    if (!this.current || this.current.id !== target || !this.editor) throw new Error('The active document changed before the images were ready. Please insert them again.');
    const selection = this.editor.state.selection.main;
    const prefix = selection.from > 0 && !this.current.source.slice(0, selection.from).endsWith('\n\n') ? '\n\n' : '';
    const suffix = selection.to < this.current.source.length && !this.current.source.slice(selection.to).startsWith('\n\n') ? '\n\n' : '\n';
    const markdown = `${prefix}${prepared.map((image) => imageMarkdown(image)).join('\n\n')}${suffix}`;
    if (this.current.source.length - (selection.to - selection.from) + markdown.length > MAX_SOURCE_LENGTH) {
      throw new Error('These image references would exceed the 400,000-character preview limit.');
    }
    const images = [...(this.current.images ?? []), ...prepared];
    this.current = { ...this.current, images,project:this.current.project ? prepareProjectImages(this.current.project,images) : undefined };
    this.refreshImages();
    this.editor.dispatch({
      changes: { from: selection.from, to: selection.to, insert: markdown },
      selection: { anchor: selection.from + markdown.length },
      annotations: isolateHistory.of('full'),
    });
    this.markDraftChanged();
    this.syncContentMode();
    this.render();
    this.editor.focus();
    this.notify(`${prepared.length === 1 ? 'Image inserted' : `${prepared.length} images inserted`}. Download Markdown + images to keep a portable copy.`);
  }

  private slideSettings(): SlideSettings {
    return normalizeSlideSettings({ theme: this.current?.slideTheme, ratio: this.current?.slideRatio });
  }

  private openDemos(): void {
    this.demoTarget = this.current?.id;
    this.q<HTMLDialogElement>('[data-demo-dialog]').showModal();
  }

  private async insertDemo(value: { preset?: string; title?: string; html?: string }, newSlide: boolean, target = this.demoTarget): Promise<void> {
    if (!this.current || !this.editor || this.current.id !== target) {
      throw new Error('The active document changed. Open Interactive demo in the document where you want to insert it.');
    }
    const preset = value.preset ? DEMO_PRESETS.find((item) => item.id === value.preset) : undefined;
    if (value.preset && !preset) throw new Error('Choose one of the available demonstrations.');
    const title = preset?.title ?? (value.title?.trim() || 'Interactive demonstration');
    if (!preset && !value.html?.trim()) throw new Error('Paste some HTML and JavaScript for your demonstration.');
    let project = this.current.project;
    let fence = interactiveFence(value);
    if (project && !preset && value.html) {
      const folder = project.document.split('/').slice(0,-1).join('/');
      let index = 1;
      let path:string;
      do { path = `${folder ? `${folder}/` : ''}demos/demo-${index++}.html`; }
      while (project.files.some((file) => file.path === path) || project.imagePaths.some((image) => image.path === path));
      project = validateLessonProject({ ...project,files:[...project.files,{path,content:value.html}] });
      fence = interactiveFence({ title,src:`demos/demo-${index-1}.html` });
    }
    const selection = this.editor.state.selection.main;
    const from = newSlide ? this.current.source.length : selection.from;
    const to = newSlide ? from : selection.to;
    const prefix = newSlide
      ? `${this.current.source.trim() ? '\n\n---\n\n' : ''}## ${title.replace(/[\r\n]+/g, ' ')}\n\n`
      : (from > 0 && !this.current.source.slice(0, from).endsWith('\n\n') ? '\n\n' : '');
    const insertion = `${prefix}${fence}\n\n`;
    if (this.current.source.length - (to - from) + insertion.length > MAX_SOURCE_LENGTH) {
      throw new Error('This demo would exceed the 400,000-character document limit. Use a smaller demo or start a new document.');
    }
    if (!this.current.source.trim() && this.current.title === 'Untitled document') {
      this.current = { ...this.current, title };
      this.updateTitle();
    }
    this.current = { ...this.current,project,...(newSlide ? { mode:'slides' as const } : {}) };
    this.editor.dispatch({
      changes: { from, to, insert: insertion },
      selection: { anchor: from + insertion.length },
      scrollIntoView: true,
      annotations: isolateHistory.of('full'),
    });
    this.markDraftChanged();
    this.q<HTMLDialogElement>('[data-demo-dialog]').close();
    this.syncContentMode();
    if (this.dataset.view === 'editor') this.setView(this.mobile.matches ? 'preview' : 'split');
    this.render();
    if (newSlide) {
      await this.updateSlides();
      if (this.current?.id === target) this.slidePreview?.goTo((this.slidesRendered?.slides.length ?? 1) - 1);
    }
    this.notify('Demo inserted. Choose Run demo in the preview, or Present to explore it fullscreen.');
  }

  private syncContentMode(): void {
    const slides = this.current?.mode === 'slides';
    this.dataset.contentMode = slides ? 'slides' : 'document';
    for (const button of this.querySelectorAll<HTMLButtonElement>('[data-content-mode]')) {
      button.setAttribute('aria-pressed', String(button.dataset.contentMode === this.dataset.contentMode));
    }
    this.q('[data-preview-scroll]').hidden = slides;
    this.q('[data-slide-stage]').hidden = !slides;
    this.q('[data-slide-navigation]').hidden = !slides;
    this.q('[data-slide-theme-control]').hidden = !slides;
    this.q('[data-slide-present]').hidden = !slides;
    this.q('[data-outline-toggle]').hidden = slides;
    this.q('[data-reading-time]').hidden = slides;
    this.q('[data-document-typeset]').hidden = slides;
    this.q('[data-slide-settings]').hidden = !slides;
    this.q('[data-lesson-check]').hidden = !slides && !this.current?.project;
    this.q('[data-lesson-files]').hidden = !this.current?.project;
    this.q<HTMLInputElement>('[data-sync]').disabled = slides;
    this.closeOutline();
    const settings = this.slideSettings();
    this.q<HTMLSelectElement>('select[data-slide-theme]').value = settings.theme;
    this.q<HTMLSelectElement>('select[data-slide-ratio]').value = settings.ratio;
    this.q('[data-slide-stage]').style.setProperty('--slide-aspect', settings.ratio === '4:3' ? String(4 / 3) : String(16 / 9));
    const hasImages = !!this.current?.images?.length;
    const project = !!this.current?.project;
    this.exportControl('[data-markdown-download-label]').textContent = project ? 'Project ZIP' : hasImages ? 'Markdown + images' : slides ? 'Markdown slide deck' : 'Markdown';
    this.exportControl('[data-markdown-download-help]').textContent = project ? 'Slides, images, demos & editable source' : hasImages ? 'Editable Markdown and pictures in one ZIP' : 'Keep an editable copy';
    this.exportControl('[data-markdown-download-extension]').textContent = project || hasImages ? '.zip' : '.md';
    this.exportControl('[data-export-bundle]').hidden = project || !slides;
    this.exportControl('[data-html-download-help]').textContent = slides ? 'Interactive slides · opens offline' : 'Math fonts included · opens offline';
    this.exportControl('[data-pdf-download-help]').textContent = slides ? 'One slide per page' : 'A clean, typeset document';
  }

  private setContentMode(mode: 'document' | 'slides'): void {
    if (!this.current || (this.current.mode ?? 'document') === mode) return;
    if (mode === 'document') this.slidePreview?.exitPresentation();
    this.current = { ...this.current, mode };
    this.markDraftChanged();
    this.syncContentMode();
    this.render();
  }

  private changeSlideSettings(): void {
    if (!this.current) return;
    const settings = normalizeSlideSettings({ theme: this.q<HTMLSelectElement>('select[data-slide-theme]').value, ratio: this.q<HTMLSelectElement>('select[data-slide-ratio]').value });
    this.current = { ...this.current, slideTheme: settings.theme, slideRatio: settings.ratio };
    this.markDraftChanged();
    this.q('[data-slide-stage]').style.setProperty('--slide-aspect', settings.ratio === '4:3' ? String(4 / 3) : String(16 / 9));
    if (this.slidesRendered) void this.updateSlides();
  }

  private async updateSlides(): Promise<void> {
    if (!this.slidesRendered || this.current?.mode !== 'slides') return;
    if (!this.slidePreview && !this.slideLoading) {
      const generation = this.slideGeneration;
      this.slideLoading = (async () => {
        const { createSlidePreview } = await import('./slide-preview');
        if (generation !== this.slideGeneration) return;
        const preview = await createSlidePreview(this.q('[data-slide-host]'), (state: SlidePreviewState) => this.updateSlideControls(state));
        if (generation !== this.slideGeneration) { preview.destroy(); return; }
        this.slidePreview = preview;
      })();
    }
    try {
      if (this.slideLoading) await this.slideLoading;
      if (this.current?.mode === 'slides' && this.slidesRendered) this.slidePreview?.update(this.slidesRendered, this.slideSettings());
    } catch (error) {
      this.q('[data-slide-host]').textContent = 'Slides could not be loaded. Switch to Document and back to try again.';
      this.notify(messageOf(error), 10_000);
    } finally { this.slideLoading = undefined; }
  }

  private updateSlideControls(state: SlidePreviewState): void {
    this.q('[data-slide-position]').textContent = `${state.index + 1} / ${state.total}`;
    this.q<HTMLButtonElement>('[data-slide-previous]').disabled = state.index === 0;
    this.q<HTMLButtonElement>('[data-slide-next]').disabled = state.index >= state.total - 1;
    this.slideOverflow = state.overflow;
    this.q('[data-slide-overflow]').hidden = !state.overflow;
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
    requestAnimationFrame(() => { this.editor?.requestMeasure(); this.scrollSync?.refresh(); this.slidePreview?.layout(); this.documentDemos?.sync(); });
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

  private async downloadSource(): Promise<void> {
    if (!this.current) return;
    this.closeExport();
    if (this.current.project) {
      const project = prepareProjectImages(this.current.project,this.current.images ?? []);
      if (JSON.stringify(project) !== JSON.stringify(this.current.project)) { this.current = { ...this.current,project }; this.markDraftChanged(); }
    }
    const snapshot = { ...this.current };
    if (snapshot.images?.length || snapshot.project) {
      const { downloadDocumentBundle } = await import('../lib/document-bundle');
      await downloadDocumentBundle(snapshot.source, snapshot.title, snapshot.images ?? [], draftOptions(snapshot));
      this.notify(snapshot.project ? 'Project ZIP downloaded. Give it to your AI assistant or open it here to continue editing.' : 'Markdown and images downloaded together. Open the ZIP here to continue editing.');
    } else {
      downloadMarkdown(snapshot.source, snapshot.title);
      this.notify('Markdown download started.');
    }
  }

  private async downloadBundle(): Promise<void> {
    if (!this.current) return;
    this.closeExport();
    const project = prepareProjectImages(this.current.project ?? createLessonProject(),this.current.images ?? []);
    if (JSON.stringify(project) !== JSON.stringify(this.current.project)) {
      this.current = { ...this.current, project };
      this.markDraftChanged();
      this.syncContentMode();
    }
    const snapshot = { ...this.current };
    const { downloadDocumentBundle } = await import('../lib/document-bundle');
    await downloadDocumentBundle(snapshot.source, snapshot.title, snapshot.images ?? [], draftOptions(snapshot));
    this.notify('Project ZIP downloaded. Reopen a revised copy to review and update this lesson.');
  }

  private syncWelcome(): void {
    const show = !!this.current && this.current.mode !== 'slides' && !this.current.source.trim() && !this.dismissedWelcome.has(this.current.id);
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
    this.cleanupGeneration += 1;
    this.cleanupBusy = false;
    this.cleanupSnapshot = { id: this.current.id, title: this.current.title, source: this.current.source };
    this.q<HTMLSelectElement>('[data-cleanup-target]').value = this.cleanupTarget;
    this.renderCleanupOptions();
    this.updateCleanupPreview();
    this.q<HTMLDialogElement>('[data-cleanup-dialog]').showModal();
  }

  private renderCleanupOptions(previous = new Map<string, boolean>()): void {
    if (!this.cleanupSnapshot) return;
    const suggestions = cleanupOptions(this.cleanupSnapshot.source, this.cleanupTarget);
    const options = suggestions.map((suggestion) => {
      const label = document.createElement('label');
      label.className = 'cleanup-option';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = previous.get(suggestion.id) ?? true;
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
  }

  private selectedCleanup(): string[] {
    return [...this.querySelectorAll<HTMLInputElement>('[data-cleanup-id]:checked')].map((input) => input.dataset.cleanupId!);
  }

  private updateCleanupPreview(): void {
    if (!this.cleanupSnapshot) return;
    const review = reviewCleanup(this.cleanupSnapshot.source, this.cleanupTarget, this.selectedCleanup());
    this.cleanupReview = review;
    const diff = cleanupDiff(this.cleanupSnapshot.source, review.source);
    for (const [selector, lines] of [['[data-cleanup-before]', diff.before], ['[data-cleanup-after]', diff.after]] as const) {
      this.q(selector).replaceChildren(...lines.map((line, index) => {
        const span = document.createElement('span');
        span.className = `cleanup-source-line${line.changed ? ' is-changed' : ''}`;
        span.textContent = line.text + (index < lines.length - 1 ? '\n' : '');
        return span;
      }));
    }
    this.q('[data-cleanup-preview-note]').hidden = !diff.truncated;
    this.q<HTMLDetailsElement>('[data-cleanup-full-source]').hidden = !diff.truncated;
    this.q<HTMLTextAreaElement>('[data-cleanup-full-before]').value = diff.truncated ? this.cleanupSnapshot.source : '';
    this.q<HTMLTextAreaElement>('[data-cleanup-full-after]').value = diff.truncated ? review.source : '';
    this.q('[data-cleanup-status]').textContent = review.status;
    this.q('[data-cleanup-help]').textContent = this.cleanupTarget === 'hackmd'
      ? 'Prepare Markdown for HackMD. Review any compatibility notes, then copy the result into its editor.'
      : 'Choose the formatting changes you want. Code and mathematical content are preserved.';
    this.q('[data-cleanup-copy-label]').textContent = review.limited ? 'Copy original Markdown' : this.cleanupTarget === 'hackmd' ? 'Copy for HackMD' : 'Copy Markdown';
    this.q('[data-cleanup-changes]').hidden = !review.changes.length;
    this.q('[data-cleanup-changes-label]').textContent = `${review.changes.length} ${review.changes.length === 1 ? 'change' : 'changes'} in this copy`;
    const items = (entries: { line?: number; message: string }[], limit: number) => {
      const nodes = entries.slice(0, limit).map((entry) => {
        const item = document.createElement('li');
        item.textContent = `${entry.line ? `Line ${entry.line}: ` : ''}${entry.message}`;
        return item;
      });
      if (entries.length > limit) {
        const more = document.createElement('li');
        more.textContent = `${entries.length - limit} more items. Review the remaining source before sharing.`;
        nodes.push(more);
      }
      return nodes;
    };
    this.q('[data-cleanup-change-list]').replaceChildren(...items(review.changes, 40));
    this.q('[data-cleanup-issues]').hidden = !review.issues.length;
    this.q('[data-cleanup-issue-list]').replaceChildren(...items(review.issues, 12));
    this.q('[data-cleanup-copy-fallback]').hidden = true;
    this.q('[data-cleanup-copy-status]').textContent = '';
    this.updateCleanupButtons();
    this.cleanupIsCurrent();
  }

  private updateCleanupButtons(): void {
    const stale = !this.cleanupSnapshot || this.current?.id !== this.cleanupSnapshot.id || this.current.source !== this.cleanupSnapshot.source;
    this.q<HTMLButtonElement>('[data-cleanup-apply]').disabled = this.cleanupBusy || stale || !this.cleanupReview?.changed;
    this.q<HTMLButtonElement>('[data-cleanup-copy]').disabled = this.cleanupBusy || stale || !this.cleanupReview?.source.trim();
    this.q<HTMLSelectElement>('[data-cleanup-target]').disabled = this.cleanupBusy || stale;
    for (const input of this.querySelectorAll<HTMLInputElement>('[data-cleanup-id]')) input.disabled = this.cleanupBusy || stale;
  }

  private cleanupIsCurrent(): boolean {
    const snapshot = this.cleanupSnapshot;
    if (!snapshot) return false;
    if (this.current?.id === snapshot.id && this.current.source === snapshot.source) return true;
    this.q('[data-cleanup-status]').textContent = 'This document changed while the panel was open. Close and reopen Clean up to review the latest text.';
    this.q<HTMLButtonElement>('[data-cleanup-apply]').disabled = true;
    this.q<HTMLButtonElement>('[data-cleanup-copy]').disabled = true;
    return false;
  }

  private async copyCleanupMarkdown(): Promise<void> {
    if (this.cleanupBusy || !this.cleanupIsCurrent()) return;
    const generation = this.cleanupGeneration;
    const snapshot = this.cleanupSnapshot;
    const currentReview = () => generation === this.cleanupGeneration && snapshot === this.cleanupSnapshot;
    const review = reviewCleanup(this.cleanupSnapshot!.source, this.cleanupTarget, this.selectedCleanup());
    if (!review.source.trim()) return;
    this.cleanupBusy = true;
    this.updateCleanupButtons();
    try {
      await navigator.clipboard.writeText(review.source);
      if (!currentReview()) return;
      this.q('[data-cleanup-copy-fallback]').hidden = true;
      this.q('[data-cleanup-copy-status]').textContent = this.cleanupTarget === 'hackmd' && !review.limited
        ? `Copied. Paste into HackMD${review.issues.length ? ' and review the compatibility notes above' : ''}.`
        : 'Markdown copied to the clipboard.';
    } catch {
      if (!currentReview()) return;
      this.q('[data-cleanup-copy-fallback]').hidden = false;
      const fallback = this.q<HTMLTextAreaElement>('[data-cleanup-copy-text]');
      fallback.value = review.source;
      fallback.focus();
      fallback.select();
      this.q('[data-cleanup-copy-status]').textContent = 'Clipboard access was unavailable. The complete result is selected; press Ctrl/⌘ C to copy it.';
    } finally {
      if (currentReview()) {
        this.cleanupBusy = false;
        this.updateCleanupButtons();
        this.cleanupIsCurrent();
      }
    }
  }

  private async applyFormatting(): Promise<void> {
    const snapshot = this.cleanupSnapshot;
    if (!snapshot || !this.current) return;
    if (!this.cleanupIsCurrent()) return;
    const source = reviewCleanup(snapshot.source, this.cleanupTarget, this.selectedCleanup()).source;
    if (source === snapshot.source) return;
    const settings = { ...this.documentSettings };
    const metadata = copiedDraftOptions(this.current);
    await this.newDocument(`${snapshot.title.slice(0, 88)} (formatted)`, snapshot.source, metadata);
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
    this.pdfSnapshot = { ...draftOptions(this.current), id: this.current.id, title: this.current.title, source: this.current.source, allowRemoteImages: this.remoteImages };
    if (this.current.mode === 'slides') {
      const result = renderSlides(this.current.source, this.renderOptions());
      this.q('[data-slide-pdf-count]').textContent = `${result.slides.length} ${result.slides.length === 1 ? 'slide' : 'slides'}`;
      this.q('[data-slide-pdf-ratio]').textContent = `${this.slideSettings().ratio} · ${this.slideSettings().theme === 'serif' ? 'Academic' : this.slideSettings().theme === 'midnight' ? 'Midnight' : 'Paper'}`;
      const warning = this.q('[data-slide-pdf-warning]');
      warning.hidden = !this.slideOverflow && !result.errors.length;
      warning.textContent = result.errors.length ? 'Resolve the rendering issues shown in the editor before exporting.' : 'The current slide is too full. Shorten it or add a slide break before exporting.';
      this.q<HTMLDialogElement>('[data-slide-pdf-dialog]').showModal();
      return;
    }
    this.pdfRendered = renderMarkdown(this.current.source, this.renderOptions());
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
    const result = this.pdfRendered ?? renderMarkdown(snapshot.source, this.renderOptions(snapshot.allowRemoteImages));
    const article = this.q('[data-pdf-preview]');
    this.q<HTMLStyleElement>('[data-pdf-preview-style]').textContent = documentPresentationCss(this.documentSettings, '[data-pdf-preview]');
    article.innerHTML = prepareDocumentHtml(result.html, snapshot.title, this.documentSettings);
    makeInteractivePrintCopy(article, this.documentDemos?.snapshots());
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
    for (const label of article.querySelectorAll<HTMLLabelElement>('label[for]')) {
      const id = ids.get(label.htmlFor);
      if (id) label.htmlFor = id;
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
    await exportPortableHtml(snapshot.source, snapshot.title, this.renderOptions(snapshot.allowRemoteImages), settings);
    this.notify('Your styled HTML download is ready.');
  }

  private async exportHtml(): Promise<void> {
    if (!this.current) return;
    this.closeExport();
    const snapshot = { ...this.current };
    const options = this.renderOptions();
    this.notify(snapshot.mode === 'slides' ? 'Preparing an offline presentation with its images and math fonts…' : 'Preparing a portable document with embedded math fonts…', 30_000);
    if (snapshot.mode === 'slides') {
      const { exportSlidesHtml } = await import('../lib/export-slides');
      await exportSlidesHtml(snapshot.source, snapshot.title, options, normalizeSlideSettings({ theme: snapshot.slideTheme, ratio: snapshot.slideRatio }));
    } else await exportPortableHtml(snapshot.source, snapshot.title, options, this.documentSettings);
    this.notify('Your standalone HTML download is ready.');
  }

  private async print(): Promise<void> {
    this.closeExport();
    const snapshot = this.pdfSnapshot;
    const slidesDialog = this.q<HTMLDialogElement>('[data-slide-pdf-dialog]');
    if (snapshot?.mode === 'slides' && slidesDialog.open) {
      if (this.current?.id !== snapshot.id || this.current.source !== snapshot.source || this.current.title !== snapshot.title
        || this.current.mode !== 'slides' || this.current.slideTheme !== snapshot.slideTheme || this.current.slideRatio !== snapshot.slideRatio) {
        slidesDialog.close();
        this.openPdf();
        this.notify('The slides changed. Review their updated settings before printing.');
        return;
      }
      const result = renderSlides(snapshot.source, this.renderOptions(snapshot.allowRemoteImages));
      const settings = this.slideSettings();
      const { printSlides } = await import('../lib/export-slides');
      slidesDialog.close();
      await printSlides(result.slides, snapshot.title, settings, this.slidePreview?.demoSnapshots());
      return;
    }
    const dialog = this.q<HTMLDialogElement>('[data-pdf-dialog]');
    if (!snapshot || !dialog.open) return;
    if (this.current?.id !== snapshot.id || this.current.source !== snapshot.source || this.current.title !== snapshot.title) {
      dialog.close();
      this.openPdf();
      this.notify('The document changed. Review its updated presentation before printing.');
      return;
    }
    const settings = { ...this.documentSettings };
    const result = renderMarkdown(snapshot.source, this.renderOptions(snapshot.allowRemoteImages));
    if (!result.html) throw new Error(result.errors[0]?.message ?? 'This document could not be rendered.');
    dialog.close();
    await printDocument(result.html, snapshot.title, settings, this.documentDemos?.snapshots());
  }

  private async openFile(file: File): Promise<void> {
    if (/\.zip$/i.test(file.name)) {
      const { importWorkspaceBundle } = await import('../lib/document-bundle');
      const imported = await importWorkspaceBundle(file);
      await this.flush();
      const matching = [...this.drafts.values()].filter((draft) => draft.project?.id === imported.project?.id && imported.project);
      const target = matching.find((draft) => draft.id === this.current?.id) ?? matching.sort((a,b) => b.updatedAt-a.updatedAt)[0];
      if (target) { await this.reviewLessonImport(imported, target); return; }
      await this.newDocument(imported.title, imported.source, imported);
      this.notify(imported.project ? 'Lesson opened. Check lesson helps you spot missing images, equations, or demo dependencies.' : 'Opened the Markdown and its images as a new document.');
      return;
    }
    if (!/\.(md|markdown|txt)$/i.test(file.name)) throw new Error('Choose a Markdown (.md), plain text (.txt), or Markdown + images (.zip) file.');
    if (file.size > MAX_SOURCE_LENGTH * 4) throw new Error('This file is too large. The preview supports up to 400,000 characters.');
    const source = await file.text();
    if (source.length > MAX_SOURCE_LENGTH) throw new Error('This file is too large. The preview supports up to 400,000 characters.');
    await this.newDocument(file.name.replace(/\.(md|markdown|txt)$/i, '').slice(0, 100) || 'Imported document', source);
    this.notify('Opened as a new document. Your original file is unchanged.');
  }

  private aiInput(): LessonAIInput {
    return {
      topic:this.q<HTMLTextAreaElement>('[data-ai-topic]').value.trim(),
      audience:this.q<HTMLInputElement>('[data-ai-audience]').value.trim(),
      language:this.q<HTMLInputElement>('[data-ai-language]').value.trim(),
      duration:Number(this.q<HTMLInputElement>('[data-ai-duration]').value),
      mathLevel:this.q<HTMLSelectElement>('[data-ai-math]').value,
      demos:this.q<HTMLInputElement>('[data-ai-demos]').value.trim(),
    };
  }

  private async copyLessonText(text: string, fallback: HTMLTextAreaElement): Promise<boolean> {
    try { await navigator.clipboard.writeText(text); return true; }
    catch { fallback.focus(); fallback.select(); return false; }
  }

  private async copyAIInstructions(): Promise<void> {
    const prompt = generateLessonPrompt(this.aiInput());
    const field = this.q<HTMLTextAreaElement>('[data-ai-prompt]');
    const details = this.q<HTMLDetailsElement>('[data-ai-prompt-details]');
    field.value = prompt;
    details.hidden = false;
    // Selection is a usable fallback in browsers that deny clipboard access.
    details.open = true;
    const copied = await this.copyLessonText(prompt, field);
    details.open = !copied;
    this.q('[data-ai-status]').textContent = copied
      ? 'Copied. Paste into your AI assistant, attach your source material, and ask for the lesson ZIP.'
      : 'Select and copy the instructions below, then paste them into your AI assistant.';
  }

  private async starterLesson(download: boolean): Promise<void> {
    const input = this.aiInput();
    if (!input.topic) input.topic = 'My next lesson';
    const starter = createStarterLesson(input);
    if (download) {
      const { downloadDocumentBundle } = await import('../lib/document-bundle');
      await downloadDocumentBundle(starter.source, starter.title, [], starter);
      this.q('[data-ai-status]').textContent = 'Starter ZIP downloaded. Attach it to your AI assistant with the instructions above.';
    } else {
      this.q<HTMLDialogElement>('[data-ai-dialog]').close();
      await this.newDocument(starter.title, starter.source, starter);
      this.notify('Starter lesson opened. Edit the slides, try the demo, or download Project ZIP to continue with AI.');
    }
  }

  private openLessonCheck(): void {
    if (!this.current) return;
    const report = checkLesson(this.current.source, this.renderOptions());
    const errors = report.issues.filter((issue) => issue.severity === 'error').length;
    const warnings = report.issues.filter((issue) => issue.severity === 'warning').length;
    this.q('[data-lesson-check-summary]').textContent = `${this.current.title} · ${report.slides} ${report.slides === 1 ? 'slide' : 'slides'} · ${report.demos} ${report.demos === 1 ? 'demo' : 'demos'}`;
    const result = this.q('[data-lesson-check-result]');
    result.dataset.ready = String(!errors && !warnings);
    result.textContent = errors ? `${errors} ${errors === 1 ? 'issue needs' : 'issues need'} a fix${warnings ? `, plus ${warnings} ${warnings === 1 ? 'item' : 'items'} to review` : ''}.`
      : warnings ? `${warnings} ${warnings === 1 ? 'item' : 'items'} to review before presenting.` : 'The format check passed. Your lesson is ready for a rehearsal.';
    const rows = report.issues.map((issue) => {
      const row = document.createElement('li');
      row.dataset.severity = issue.severity;
      const label = document.createElement('strong');
      label.textContent = `${issue.severity === 'error' ? 'Fix' : issue.severity === 'warning' ? 'Review' : 'Note'}${issue.line ? ` · Line ${issue.line}` : ''}`;
      row.append(label, document.createTextNode(issue.message));
      return row;
    });
    this.q('[data-lesson-check-list]').replaceChildren(...rows);
    this.q<HTMLTextAreaElement>('[data-lesson-report]').value = formatLessonReport(report);
    this.q<HTMLDetailsElement>('[data-lesson-report-details]').hidden = true;
    this.q<HTMLDialogElement>('[data-lesson-check-dialog]').showModal();
  }

  private async reviewLessonImport(bundle: WorkspaceBundle, target: Draft): Promise<void> {
    const { compareLessonRevision } = await import('../lib/lesson-revision');
    const changes = await compareLessonRevision(target, bundle);
    this.lessonImport = { bundle, target, changes };
    this.q('[data-lesson-update-description]').textContent = `This ZIP is a revision of “${target.title}” in your workspace.`;
    const summary = this.q('[data-lesson-update-summary]');
    const title = document.createElement('p');
    title.textContent = changes.length ? `${changes.length} ${changes.length === 1 ? 'file or setting has' : 'files or settings have'} changed.` : 'The lesson files and settings are unchanged.';
    const list = document.createElement('ul');
    for (const change of changes.slice(0,8)) {
      const row = document.createElement('li');
      row.textContent = `${change.path} · ${change.status}`;
      list.append(row);
    }
    if (changes.length > 8) { const more = document.createElement('li'); more.textContent = `And ${changes.length-8} more. Open Review changes to see every file.`; list.append(more); }
    summary.replaceChildren(title, list);
    const select = this.q<HTMLSelectElement>('[data-lesson-change-file]');
    select.replaceChildren(...changes.map((change,index) => new Option(`${change.path} · ${change.status}`,String(index))));
    select.closest('details')!.hidden = !changes.length;
    select.closest('details')!.open = false;
    this.showLessonChange();
    this.q('[data-lesson-update-status]').textContent = '';
    this.q<HTMLButtonElement>('[data-lesson-update-apply]').disabled = !changes.length;
    this.q<HTMLDialogElement>('[data-ai-dialog]').close();
    this.q<HTMLDialogElement>('[data-lesson-update-dialog]').showModal();
  }

  private showLessonChange(): void {
    const index = Number(this.q<HTMLSelectElement>('[data-lesson-change-file]').value);
    const change = this.lessonImport?.changes[index];
    this.q<HTMLTextAreaElement>('[data-lesson-before]').value = change?.before ?? '';
    this.q<HTMLTextAreaElement>('[data-lesson-after]').value = change?.after ?? '';
  }

  private async applyLessonImport(asCopy: boolean): Promise<void> {
    const pending = this.lessonImport;
    if (!pending) return;
    if (asCopy) {
      const options = draftOptions(pending.bundle);
      if (options.project) options.project = { ...cloneLessonProject(options.project), id:createDraftId() };
      await this.newDocument(`${pending.bundle.title.slice(0,193)} (copy)`, pending.bundle.source, options);
      this.lessonImport = undefined;
      this.notify('Opened a separate lesson copy. It has its own project identity for future updates.');
      return;
    }
    await this.flush();
    if (!this.storageAvailable) throw new Error('Browser storage is unavailable. Open the ZIP as a new copy to keep both versions.');
    const target = this.drafts.get(pending.target.id);
    if (!target) throw new Error('That lesson was removed from the workspace. Open this ZIP as a new copy.');
    if (!sameDraftContent(target,pending.target) || target.revision !== pending.target.revision) {
      await this.reviewLessonImport(pending.bundle,target);
      throw new Error('The lesson changed while this review was open. Review the updated comparison before applying it.');
    }
    // A recovery copy must be committed before an existing lesson is replaced.
    // Use createDraft directly: unlike makeDraft, it cannot fall back to memory.
    const activeBeforeUpdate = this.current;
    const recoveryOptions = draftOptions(target);
    if (recoveryOptions.project) recoveryOptions.project = { ...cloneLessonProject(recoveryOptions.project), id:createDraftId() };
    const recovery = await createDraft(`${target.title.slice(0,184)} (before update)`,target.source,recoveryOptions);
    this.drafts.set(recovery.id,recovery);
    const savedSettings = readLocal(presentationKey(target.id));
    if (savedSettings) writeLocal(presentationKey(recovery.id),savedSettings);
    const latest = this.drafts.get(target.id);
    if (!latest || !sameDraftContent(latest,target) || latest.revision !== target.revision) {
      this.renderDocuments();
      if (latest) await this.reviewLessonImport(pending.bundle,latest);
      throw new Error('The lesson changed while its recovery copy was being saved. Review the latest version before updating.');
    }
    try {
      const saved = await saveDraft({ ...target,...draftOptions(pending.bundle),title:pending.bundle.title,source:pending.bundle.source },target.revision);
      this.drafts.set(saved.id,saved);
      const editedDuringUpdate = activeBeforeUpdate && (this.current?.id !== activeBeforeUpdate.id || !sameDraftContent(this.current,activeBeforeUpdate));
      if (editedDuringUpdate) {
        // Closing this dialog never disables the editor. Save late typing;
        // conflict recovery keeps it separately from the newly imported lesson.
        await this.flush();
        this.q<HTMLDialogElement>('[data-lesson-update-dialog]').close();
        this.renderDocuments();
      } else this.activate(saved);
      this.lessonImport = undefined;
      this.notify(editedDuringUpdate ? 'Lesson updated. Your newer edits are kept in the current document; the previous version is also saved as “before update”.' : 'Lesson updated. The previous version is saved in your workspace as “before update”.',9000);
    } catch (error) {
      this.renderDocuments();
      if (isDraftConflict(error)) throw new Error('Another tab changed this lesson. Your versions are preserved. Close this review and reopen the ZIP to compare again.');
      throw error;
    }
  }

  private openLessonFiles(): void {
    if (!this.current?.project) return;
    const project = this.current.project;
    const edits = new Map([[project.document,this.current.source],...project.files.map((file) => [file.path,file.content] as [string,string])]);
    this.lessonFiles = { id:this.current.id,source:this.current.source,project:JSON.stringify(project),selected:project.document,edits };
    this.q<HTMLSelectElement>('[data-lesson-file]').replaceChildren(...[...edits.keys()].map((path) => new Option(path,path)));
    this.q<HTMLTextAreaElement>('[data-lesson-file-source]').value = this.current.source;
    this.q('[data-lesson-file-note]').textContent = `${edits.size} editable ${edits.size === 1 ? 'file' : 'files'} · ${this.current.images?.length ?? 0} images. Images stay in the project; use Insert image to add more.`;
    this.q('[data-lesson-files-status]').textContent = '';
    this.q<HTMLDialogElement>('[data-lesson-files-dialog]').showModal();
  }

  private chooseLessonFile(): void {
    if (!this.lessonFiles) return;
    const field = this.q<HTMLTextAreaElement>('[data-lesson-file-source]');
    this.lessonFiles.edits.set(this.lessonFiles.selected,field.value);
    this.lessonFiles.selected = this.q<HTMLSelectElement>('[data-lesson-file]').value;
    field.value = this.lessonFiles.edits.get(this.lessonFiles.selected) ?? '';
  }

  private saveLessonFiles(): void {
    const edit = this.lessonFiles;
    if (!edit || !this.current?.project || edit.id !== this.current.id) throw new Error('Open Lesson files again in the lesson you want to edit.');
    if (this.current.source !== edit.source || JSON.stringify(this.current.project) !== edit.project) throw new Error('The lesson changed while these files were open. Copy your edits, then reopen Lesson files.');
    edit.edits.set(edit.selected,this.q<HTMLTextAreaElement>('[data-lesson-file-source]').value);
    const source = edit.edits.get(this.current.project.document) ?? this.current.source;
    if (source.length > MAX_SOURCE_LENGTH) throw new Error('The slide source can contain up to 400,000 characters.');
    const project = validateLessonProject({ ...this.current.project,files:this.current.project.files.map((file) => ({ ...file,content:edit.edits.get(file.path) ?? file.content })) });
    this.current = { ...this.current,project };
    this.replaceSource(source);
    this.markDraftChanged();
    this.render();
    this.q<HTMLDialogElement>('[data-lesson-files-dialog]').close();
    this.lessonFiles = undefined;
    this.notify('Lesson files saved. Download Project ZIP to keep these changes or send them to AI.');
  }

  private openDemoEditor(key: string): void {
    if (!this.current) return;
    const entry = findInteractiveFences(this.current.source).find((fence) => fence.sourceKey === key);
    if (!entry) throw new Error('This demo changed. Refresh the preview and choose Edit demo again.');
    const preset = DEMO_PRESETS.find((item) => item.id === entry.preset);
    const path = !preset && entry.src && this.current.project ? projectFilePath(entry.src,this.current.project.document) : undefined;
    const file = path ? this.current.project?.files.find((item) => item.path === path) : undefined;
    const missing = !preset && entry.src && !file;
    this.demoEdit = { id:this.current.id,entry,path:file ? path : undefined,originalFile:file?.content };
    this.q<HTMLInputElement>('[data-demo-edit-name]').value = entry.title || preset?.title || 'Interactive demonstration';
    this.q('[data-demo-edit-description]').textContent = preset
      ? 'Set the values your students see first. Run, Restart, and Reset use these saved values; classroom slider changes stay temporary.'
      : `${path ? `Editing ${path}. ` : ''}Revise the self-contained demo below. Save it, then choose Run demo in the preview to try it.`;
    const fields = this.q('[data-demo-setting-fields]');
    fields.replaceChildren();
    if (preset) {
      let values:DemoSettings;
      try { values = normalizeDemoSettings(preset.id,entry.settings); }
      catch { values = normalizeDemoSettings(preset.id); }
      for (const setting of demoSettingFields(preset.id)) {
        const label = document.createElement('label');
        label.append(document.createTextNode(setting.label));
        let control:HTMLInputElement | HTMLSelectElement;
        if (setting.type === 'select') {
          control = document.createElement('select');
          control.append(...(setting.options ?? []).map((option) => new Option(option.label,option.value)));
        } else {
          control = document.createElement('input'); control.type = 'number';
          if (setting.min !== undefined) control.min = String(setting.min);
          if (setting.max !== undefined) control.max = String(setting.max);
          control.step = setting.step === undefined ? 'any' : String(setting.step);
          control.required = true;
        }
        control.dataset.demoSetting = setting.key;
        control.value = String(values[setting.key]);
        label.append(control);
        if (setting.min !== undefined && setting.max !== undefined) { const hint = document.createElement('small'); hint.textContent = `${setting.min} to ${setting.max}`; label.append(hint); }
        fields.append(label);
      }
    }
    this.q('[data-demo-edit-code]').hidden = !!preset;
    this.q<HTMLTextAreaElement>('[data-demo-edit-source]').value = file?.content ?? entry.body;
    this.q('[data-demo-edit-status]').textContent = missing ? 'The referenced HTML file is missing. Paste its code here to replace this reference with an inline demo, or cancel and restore the file in your ZIP.' : entry.error ?? '';
    this.q<HTMLDialogElement>('[data-demo-edit-dialog]').showModal();
  }

  private saveDemoEditor(): void {
    const edit = this.demoEdit;
    if (!edit || !this.current || edit.id !== this.current.id) throw new Error('Open Edit demo again in the lesson you want to edit.');
    const title = this.q<HTMLInputElement>('[data-demo-edit-name]').value.trim();
    const preset = DEMO_PRESETS.find((item) => item.id === edit.entry.preset);
    let fence:string;
    let project = this.current.project;
    if (preset) {
      const settings:DemoSettings = {};
      for (const input of this.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-demo-setting]')) settings[input.dataset.demoSetting!] = input instanceof HTMLInputElement ? Number(input.value) : input.value;
      fence = interactiveFence({ preset:preset.id,title,settings:normalizeDemoSettings(preset.id,settings) });
    } else {
      const html = this.q<HTMLTextAreaElement>('[data-demo-edit-source]').value;
      if (!html.trim()) throw new Error('Add the HTML and JavaScript for your demonstration.');
      if (html.length > 100_000) throw new Error('A demo can contain up to 100,000 characters.');
      if (edit.path) {
        if (!project || project.files.find((file) => file.path === edit.path)?.content !== edit.originalFile) throw new Error('The demo file changed. Copy your edits, then reopen Edit demo.');
        project = validateLessonProject({ ...project,files:project.files.map((file) => file.path === edit.path ? { ...file,content:html } : file) });
        fence = interactiveFence({ src:edit.entry.src,title });
      } else fence = interactiveFence({ title,html });
    }
    const source = replaceInteractiveFence(this.current.source,edit.entry,fence);
    if (source.length > MAX_SOURCE_LENGTH) throw new Error('This change would exceed the document size limit.');
    this.current = { ...this.current,project };
    this.replaceSource(source);
    this.markDraftChanged();
    this.render();
    this.q<HTMLDialogElement>('[data-demo-edit-dialog]').close();
    this.demoEdit = undefined;
    this.notify(preset ? 'Starting values saved. Run the demo to try them.' : 'Demo saved. Choose Run demo in the preview to try the revised code.');
  }

  private lessonAction(statusSelector: string, action: () => Promise<void> | void): void {
    this.runAction(async () => {
      const status = this.q(statusSelector);
      status.dataset.error = 'false';
      try { await action(); }
      catch (error) {
        status.dataset.error = 'true'; status.textContent = messageOf(error);
        if (!status.closest('dialog')?.open) this.notify(messageOf(error),12_000);
      }
    });
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
    click('[data-create-ai]', () => { this.closeSidebar(); this.q<HTMLDialogElement>('[data-ai-dialog]').showModal(); });
    click('[data-ai-close]', () => this.q<HTMLDialogElement>('[data-ai-dialog]').close());
    this.q<HTMLFormElement>('[data-ai-form]').addEventListener('submit', (event) => { event.preventDefault(); this.lessonAction('[data-ai-status]', () => this.copyAIInstructions()); }, { signal });
    click('[data-ai-starter]', () => this.lessonAction('[data-ai-status]', () => this.starterLesson(true)));
    click('[data-ai-example]', () => this.lessonAction('[data-ai-status]', () => this.starterLesson(false)));
    click('[data-ai-open]', () => { this.q<HTMLDialogElement>('[data-ai-dialog]').close(); this.q<HTMLInputElement>('[data-file-input]').click(); });
    click('[data-lesson-check]', () => this.openLessonCheck());
    click('[data-lesson-check-close]', () => this.q<HTMLDialogElement>('[data-lesson-check-dialog]').close());
    click('[data-lesson-check-copy]', () => this.runAction(async () => {
      const field = this.q<HTMLTextAreaElement>('[data-lesson-report]');
      const details = this.q<HTMLDetailsElement>('[data-lesson-report-details]');
      details.hidden = false; details.open = true;
      if (await this.copyLessonText(field.value,field)) { details.open = false; this.notify('Compatibility report copied. Give it to your AI assistant with the Project ZIP.'); }
    }));
    click('[data-lesson-update-close]', () => { this.lessonImport = undefined; this.q<HTMLDialogElement>('[data-lesson-update-dialog]').close(); });
    click('[data-lesson-update-copy]', () => this.lessonAction('[data-lesson-update-status]', () => this.applyLessonImport(true)));
    click('[data-lesson-update-apply]', () => this.lessonAction('[data-lesson-update-status]', () => this.applyLessonImport(false)));
    this.q<HTMLSelectElement>('[data-lesson-change-file]').addEventListener('change', () => this.showLessonChange(), { signal });
    click('[data-lesson-files]', () => this.openLessonFiles());
    click('[data-lesson-files-close]', () => { this.lessonFiles = undefined; this.q<HTMLDialogElement>('[data-lesson-files-dialog]').close(); });
    this.q<HTMLSelectElement>('[data-lesson-file]').addEventListener('change', () => this.chooseLessonFile(), { signal });
    this.q<HTMLFormElement>('[data-lesson-files-form]').addEventListener('submit', (event) => { event.preventDefault(); this.lessonAction('[data-lesson-files-status]', () => this.saveLessonFiles()); }, { signal });
    click('[data-lesson-files-download]', () => this.lessonAction('[data-lesson-files-status]', async () => { this.saveLessonFiles(); await this.downloadBundle(); }));
    click('[data-demo-edit-close]', () => { this.demoEdit = undefined; this.q<HTMLDialogElement>('[data-demo-edit-dialog]').close(); });
    this.q<HTMLFormElement>('[data-demo-edit-form]').addEventListener('submit', (event) => { event.preventDefault(); this.lessonAction('[data-demo-edit-status]', () => this.saveDemoEditor()); }, { signal });
    this.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-demo-edit]');
      if (!button) return;
      const key = button.closest<HTMLElement>('[data-demo-source-key]')?.dataset.demoSourceKey;
      if (key) this.runAction(async () => this.openDemoEditor(key));
    }, { signal });
    click('[data-paste], [data-welcome-paste]', () => this.openPaste());
    click('[data-insert-demo]', () => this.openDemos());
    click('[data-demo-close]', () => this.q<HTMLDialogElement>('[data-demo-dialog]').close());
    click('[data-demo-preset]', (event) => {
      const preset = (event.currentTarget as HTMLElement).dataset.demoPreset;
      const newSlide = this.q<HTMLInputElement>('[data-demo-new-slide]').checked;
      const target = this.demoTarget;
      this.runAction(() => this.insertDemo({ preset }, newSlide, target));
    });
    click('[data-demo-lesson]', () => {
      const example = EXAMPLES.find((item) => item.id === 'interactive-physics');
      if (!example) return;
      this.q<HTMLDialogElement>('[data-demo-dialog]').close();
      this.runAction(async () => {
        await this.newDocument(example.title, example.source, example);
        if (this.mobile.matches) this.setView('preview');
      });
    });
    this.q<HTMLFormElement>('[data-demo-form]').addEventListener('submit', (event) => {
      event.preventDefault();
      const title = this.q<HTMLInputElement>('[data-demo-title]').value.trim();
      const html = this.q<HTMLTextAreaElement>('[data-demo-html]').value;
      const newSlide = this.q<HTMLInputElement>('[data-demo-new-slide]').checked;
      const target = this.demoTarget;
      this.runAction(() => this.insertDemo({ title, html }, newSlide, target));
    }, { signal });
    click('[data-demo-open-file]', () => this.q<HTMLInputElement>('[data-demo-file-input]').click());
    this.q<HTMLInputElement>('[data-demo-file-input]').addEventListener('change', (event) => {
      const input = event.target as HTMLInputElement;
      const file = input.files?.[0];
      input.value = '';
      if (!file) return;
      const target = this.demoTarget;
      this.runAction(async () => {
        if (!/\.html?$/i.test(file.name)) throw new Error('Choose an HTML (.html or .htm) file.');
        if (file.size > 100_000) throw new Error('Choose a self-contained HTML demo smaller than 100 KB.');
        const html = await file.text();
        if (target !== this.current?.id || !this.q<HTMLDialogElement>('[data-demo-dialog]').open) return;
        this.q<HTMLTextAreaElement>('[data-demo-html]').value = html;
        this.q<HTMLInputElement>('[data-demo-title]').value = file.name.replace(/\.html?$/i, '').replace(/[-_]+/g, ' ').slice(0, 100);
        this.q<HTMLDetailsElement>('[data-demo-custom]').open = true;
      });
    }, { signal });
    click('[data-insert-image]', () => {
      this.imageTarget = this.current?.id;
      this.q<HTMLInputElement>('[data-image-input]').click();
    });
    this.q<HTMLInputElement>('[data-image-input]').addEventListener('change', (event) => {
      const input = event.target as HTMLInputElement;
      const files = [...(input.files ?? [])];
      const target = this.imageTarget;
      input.value = '';
      if (files.length) this.runAction(() => this.insertImages(files, target));
    }, { signal });
    this.q('[data-editor]').addEventListener('paste', (event: ClipboardEvent) => {
      const files = [...(event.clipboardData?.items ?? [])]
        .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
        .map((item) => item.getAsFile()).filter((file): file is File => file !== null);
      if (!files.length) return;
      event.preventDefault();
      event.stopPropagation();
      const target = this.current?.id;
      this.runAction(() => this.insertImages(files, target));
    }, { capture: true, signal });
    click('[data-content-mode]', (event) => {
      this.setContentMode((event.currentTarget as HTMLElement).dataset.contentMode === 'slides' ? 'slides' : 'document');
      this.syncWelcome();
    });
    click('[data-slide-previous]', () => this.slidePreview?.previous());
    click('[data-slide-next]', () => this.slidePreview?.next());
    click('[data-slide-present]', () => {
      if (this.slidePreview) this.slidePreview.present();
      else this.notify('The presentation is still loading. Please try again in a moment.');
    });
    this.q<HTMLSelectElement>('select[data-slide-theme]').addEventListener('change', () => this.changeSlideSettings(), { signal });
    this.q<HTMLSelectElement>('select[data-slide-ratio]').addEventListener('change', () => this.changeSlideSettings(), { signal });
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
    this.q<HTMLDialogElement>('[data-cleanup-dialog]').addEventListener('close', () => {
      if (this.q<HTMLDialogElement>('[data-cleanup-dialog]').open) return;
      this.cleanupGeneration += 1;
      this.cleanupBusy = false;
    }, { signal });
    this.q<HTMLSelectElement>('[data-cleanup-target]').addEventListener('change', (event) => {
      const previous = new Map([...this.querySelectorAll<HTMLInputElement>('[data-cleanup-id]')].map((input) => [input.dataset.cleanupId!, input.checked]));
      this.cleanupTarget = (event.target as HTMLSelectElement).value === 'hackmd' ? 'hackmd' : 'markdown';
      this.renderCleanupOptions(previous);
      this.updateCleanupPreview();
    }, { signal });
    this.q('[data-cleanup-options]').addEventListener('change', () => this.updateCleanupPreview(), { signal });
    click('[data-cleanup-copy]', () => { void this.copyCleanupMarkdown(); });
    click('[data-cleanup-apply]', () => {
      if (this.cleanupBusy) return;
      const generation = this.cleanupGeneration;
      this.cleanupBusy = true;
      this.updateCleanupButtons();
      this.runAction(async () => {
        try { if (generation === this.cleanupGeneration) await this.applyFormatting(); }
        finally { if (generation === this.cleanupGeneration) { this.cleanupBusy = false; this.updateCleanupButtons(); } }
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
    click('[data-slide-pdf-close]', () => this.q<HTMLDialogElement>('[data-slide-pdf-dialog]').close());
    click('[data-slide-print]', () => this.runAction(() => this.print()));
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
        await this.newDocument(`${this.current.title.slice(0, 193)} (copy)`, this.current.source, copiedDraftOptions(this.current));
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
        this.runAction(() => this.newDocument(example.title, example.source, example));
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
    click('[data-export-md]', () => this.runAction(() => this.downloadSource()), headerExports);
    click('[data-export-bundle]', () => this.runAction(() => this.downloadBundle()), headerExports);
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
      if ((event.target as Element).closest('.qft-slide-presentation')) {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') {
          event.preventDefault();
          this.slidePreview?.exitPresentation();
          this.openPdf();
        } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
          event.preventDefault();
          this.runAction(() => this.downloadSource());
        }
        return;
      }
      if (event.key === 'Escape') { this.closeExport(); this.closeOutline(); this.closeSidebar(); }
      if (this.querySelector('dialog[open]')) {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p' && (this.q<HTMLDialogElement>('[data-pdf-dialog]').open || this.q<HTMLDialogElement>('[data-slide-pdf-dialog]').open)) {
          event.preventDefault();
          this.runAction(() => this.print());
        }
        return;
      }
      if (event.ctrlKey || event.metaKey) {
        if (event.key.toLowerCase() === 's') { event.preventDefault(); this.runAction(() => this.downloadSource()); }
        if (event.key.toLowerCase() === 'o') { event.preventDefault(); this.q<HTMLInputElement>('[data-file-input]').click(); }
        if (event.key.toLowerCase() === 'p') { event.preventDefault(); this.openPdf(); }
        if (event.key.toLowerCase() === 'f') {
          event.preventDefault();
          if (this.dataset.view === 'preview') this.setView(this.mobile.matches ? 'editor' : 'split');
          if (this.editor) openSearchPanel(this.editor);
        }
      } else if (event.key.toLowerCase() === 'n' && !(event.target as Element).closest('input, textarea, select, [contenteditable="true"], .qft-slide-deck')) {
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
      const files = [...event.dataTransfer.files];
      const target = this.current?.id;
      if (files.every((file) => file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(file.name))) {
        this.runAction(() => this.insertImages(files, target));
      } else if (files.length === 1) this.runAction(() => this.openFile(files[0]));
      else this.notify('Drop one Markdown or ZIP file, or drop a group of pictures to insert them.');
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
