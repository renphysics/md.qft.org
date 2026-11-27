import { isTextPath } from '../lib/deck-archive';
import {
  deckFileList, deckFileText, deckOriginalText, deckSourceNote, isEditableDeck, nextDeckEdits,
  type DeckFileInfo, type DeckProject,
} from '../lib/deck-project';
import { LOAD_FAILURE_TEXT, errorMessage, isLoadFailure } from '../lib/load-failure';
import { visiblePath } from '../lib/presentation-messages';
import type { DeckEditor } from './deck-editor';

/**
 * The Source files view of the presentation library: the deck's file list,
 * a code editor, and for decks whose source is what plays ('reveal' and
 * 'html'), Apply changes, Discard changes to this file and Restore original.
 * Rebuilding, replaying and saving belong to the library (DeckSourceHost);
 * this view only edits text. Loaded on demand with its editor.
 */

/** What became of a rebuild with new edits. */
export interface DeckApplyOutcome {
  /** True when the overlay is now the deck's edits and the player has the new build. */
  applied: boolean;
  /**
   * When the new build appears: now; when the Presentation view is shown
   * again, on the same slide; or at the next Start. Absent when it cannot play.
   */
  replay?: 'now' | 'on-return' | 'on-start';
  /** One sentence about where the edits are kept, written by the site. */
  storage?: string;
  /**
   * Why the applied edits could not be saved in this browser (for example,
   * another tab saved newer edits), written by the site. Shown as a problem;
   * the edits still play.
   */
  storageProblem?: string;
  /** Why nothing changed: the build's errors, as cleaned plain text. */
  problems?: string[];
}

export interface DeckConfirmRequest {
  title: string;
  message: string;
  confirm: string;
  cancel: string;
}

export interface DeckSourceHost {
  /**
   * Rebuild with this overlay. Unless force is set, a build with an error
   * changes nothing, so the last version that worked stays on screen.
   */
  applyEdits(edits: Map<string, string>, options?: { force?: boolean }): Promise<DeckApplyOutcome>;
  confirm(request: DeckConfirmRequest): Promise<boolean>;
}

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** The read-only or editing note of Source files; deck-project owns the wording for every kind. */
export function sourceNote(project: DeckProject): string {
  return deckSourceNote(project);
}

/** A caught error as one line for the problem area; a part of the site that could not load gets the fixed sentence. */
const problemText = (error: unknown) => errorMessage(error, 'Something went wrong. Download the ZIP to keep your changes, then reload the page.');

const files = (count: number) => `${count} ${count === 1 ? 'file' : 'files'}`;
const shortcut = () => /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘S' : 'Ctrl+S';

export class DeckSourceView {
  private project?: DeckProject;
  private list: DeckFileInfo[] = [];
  private buttons = new Map<string, HTMLButtonElement>();
  private selected?: string;
  private editor?: DeckEditor;
  private loading?: Promise<DeckEditor>;
  /** Files changed in the editor since they were opened or last applied; checked against what plays. */
  private touched = new Set<string>();
  private busy = false;
  private refreshTimer = 0;

  constructor(private readonly root: HTMLElement, private readonly host: DeckSourceHost, signal: AbortSignal) {
    const on = (selector: string, action: () => unknown) => {
      this.q(selector).addEventListener('click', () => { void Promise.resolve().then(action).catch((error) => this.problems([problemText(error)])); }, { signal });
    };
    on('[data-pres-apply]', () => this.apply());
    on('[data-pres-discard]', () => this.discard());
    on('[data-pres-restore]', () => this.restore());
    on('[data-pres-copy]', () => this.copy());
    signal.addEventListener('abort', () => this.destroy(), { once: true });
  }

  private q<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing source control: ${selector}`);
    return element;
  }

  /** Show a deck's files. A different deck starts afresh, with no unapplied changes. */
  async show(project: DeckProject): Promise<void> {
    if (project !== this.project) this.load(project);
    const editor = await this.ensureEditor();
    if (project !== this.project) return;
    this.renderFile();
    if (this.selected) this.open(this.selected, editor);
  }

  /** Forget the deck on show, for example when the library closes. */
  clear(): void {
    window.clearTimeout(this.refreshTimer);
    // A rebuild still running for the old deck no longer holds the controls.
    this.busy = false;
    this.root.removeAttribute('aria-busy');
    this.project = undefined;
    this.list = [];
    this.buttons.clear();
    this.selected = undefined;
    this.touched.clear();
    this.editor?.clear();
    this.q('[data-pres-files]').replaceChildren();
  }

  destroy(): void {
    this.clear();
    this.editor?.destroy();
    this.editor = undefined;
  }

  /** Files whose text in the editor differs from what plays now. */
  pendingPaths(): string[] {
    const project = this.project;
    if (!project || !this.editor || !isEditableDeck(project)) return [];
    return [...this.touched].filter((path) => {
      const text = this.editor!.text(path);
      return text !== undefined && text !== deckFileText(project, path);
    });
  }

  hasPendingChanges(): boolean {
    return this.pendingPaths().length > 0;
  }

  private load(project: DeckProject): void {
    this.clear();
    this.project = project;
    this.list = deckFileList(project);
    this.selected = this.list.find((file) => file.text)?.path ?? this.list[0]?.path;
    const editable = isEditableDeck(project);
    this.q('[data-pres-source-note]').textContent = sourceNote(project);
    this.q('[data-pres-apply]').hidden = !editable;
    this.q('[data-pres-discard]').hidden = !editable;
    this.q('[data-pres-restore]').hidden = !editable;
    this.q('[data-pres-apply]').title = `Apply changes (${shortcut()})`;
    this.status('');
    this.problems([]);
    this.renderList();
    this.renderFile();
  }

  private async ensureEditor(): Promise<DeckEditor> {
    if (this.editor) return this.editor;
    if (!this.loading) {
      this.message('Opening the editor…');
      this.loading = import('./deck-editor').then(({ createDeckEditor }) => {
        this.editor = createDeckEditor({
          parent: this.q('[data-pres-code]'),
          onChange: (path) => { this.touched.add(path); this.scheduleRefresh(); },
          onSave: () => { void this.apply().catch((error) => this.problems([problemText(error)])); },
        });
        return this.editor;
      });
      this.loading.catch((error) => { this.loading = undefined; this.message(isLoadFailure(error) ? LOAD_FAILURE_TEXT : 'The editor could not be opened. Reload the page and try again.'); });
    }
    return this.loading;
  }

  private renderList(): void {
    const project = this.project;
    const nav = this.q('[data-pres-files]');
    this.buttons.clear();
    if (!project) { nav.replaceChildren(); return; }
    const own = this.list.filter((file) => file.group !== 'library');
    const library = this.list.filter((file) => file.group === 'library');
    const summary = document.createElement('p');
    summary.className = 'presentation-files-summary';
    summary.dataset.presEditSummary = '';
    const ownList = document.createElement('ul');
    ownList.append(...own.map((file) => this.fileItem(file)));
    const parts: HTMLElement[] = [summary, ownList];
    if (library.length) {
      const details = document.createElement('details');
      details.className = 'presentation-library-files';
      const heading = document.createElement('summary');
      heading.textContent = `Library files (${library.length})`;
      const libraryList = document.createElement('ul');
      libraryList.append(...library.map((file) => this.fileItem(file)));
      details.append(heading, libraryList);
      // A selected library file stays visible.
      details.open = library.some((file) => file.path === this.selected);
      parts.push(details);
    }
    if (!this.list.length) {
      const empty = document.createElement('p');
      empty.className = 'presentation-files-empty';
      empty.textContent = 'This presentation has no files to show.';
      parts.push(empty);
    }
    nav.replaceChildren(...parts);
    this.refreshStates();
  }

  private fileItem(file: DeckFileInfo): HTMLLIElement {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'presentation-file';
    button.dataset.presFilePath = file.path;
    const name = document.createElement('span');
    name.className = 'presentation-file-name';
    name.textContent = visiblePath(file.path);
    const meta = document.createElement('span');
    meta.className = 'presentation-file-meta';
    const role = file.group === 'entry' ? (this.project?.kind === 'qft-presentation' ? 'Main source' : 'Start page') : '';
    const access = !this.project || !isEditableDeck(this.project) ? '' : file.editable ? '' : file.group === 'library' ? 'read-only' : file.text ? 'too large to edit' : 'kept as is';
    meta.textContent = [role, sizeLabel(file.size), access].filter(Boolean).join(' · ');
    const badge = document.createElement('span');
    badge.className = 'presentation-file-badge';
    badge.hidden = true;
    button.append(name, meta, badge);
    button.addEventListener('click', () => { void this.select(file.path); });
    this.buttons.set(file.path, button);
    item.append(button);
    return item;
  }

  /** Per-file and deck-wide edit states: Edited (applied), Not applied (in the editor only). */
  private refreshStates(): void {
    const project = this.project;
    if (!project) return;
    const pending = new Set(this.pendingPaths());
    for (const [path, button] of this.buttons) {
      const badge = button.querySelector<HTMLElement>('.presentation-file-badge')!;
      const state = pending.has(path) ? 'pending' : project.edits.has(path) ? 'edited' : '';
      badge.dataset.state = state;
      badge.textContent = state === 'pending' ? 'Not applied' : state === 'edited' ? 'Edited' : '';
      badge.hidden = !state;
      button.setAttribute('aria-current', String(path === this.selected));
    }
    const summary = this.root.querySelector<HTMLElement>('[data-pres-edit-summary]');
    if (summary) {
      const editable = isEditableDeck(project);
      const parts = [files(this.list.length)];
      if (project.edits.size) parts.push(`${files(project.edits.size)} edited`);
      if (pending.size) parts.push(`${pending.size} not applied`);
      if (!editable) parts.push('read-only');
      summary.textContent = parts.join(' · ');
    }
    const file = this.list.find((entry) => entry.path === this.selected);
    const discard = this.q<HTMLButtonElement>('[data-pres-discard]');
    discard.disabled = this.busy || !file?.editable || (!pending.has(file.path) && !project.edits.has(file.path));
    // Apply waits until a file differs from what plays, as Discard and Restore do.
    this.q<HTMLButtonElement>('[data-pres-apply]').disabled = this.busy || !pending.size;
    this.q<HTMLButtonElement>('[data-pres-restore]').disabled = this.busy || (!project.edits.size && !pending.size);
    this.renderInfo(file, pending.has(file?.path ?? ''));
  }

  private scheduleRefresh(): void {
    window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => this.refreshStates(), 120);
  }

  private renderInfo(file: DeckFileInfo | undefined, pending: boolean): void {
    this.q('[data-pres-file-name]').textContent = file ? visiblePath(file.path) : 'Files';
    const project = this.project;
    const parts: string[] = [];
    if (file && project) {
      parts.push(sizeLabel(file.size));
      if (file.editable) parts.push(pending ? 'Changes not applied yet' : project.edits.has(file.path) ? 'Edited' : 'Editable');
      else parts.push('Read-only');
    }
    this.q('[data-pres-file-info]').textContent = parts.join(' · ');
  }

  private async select(path: string): Promise<void> {
    if (!this.project) return;
    this.selected = path;
    this.refreshStates();
    this.renderFile();
    const editor = await this.ensureEditor();
    if (this.selected !== path) return;
    this.renderFile();
    this.open(path, editor);
  }

  /** Show the selected file: its text in the editor, or why it is not shown. */
  private renderFile(): void {
    const file = this.list.find((entry) => entry.path === this.selected);
    const project = this.project;
    this.q<HTMLButtonElement>('[data-pres-copy]').disabled = !file?.text;
    if (!file || !project) { this.message(project ? 'This presentation has no files to show.' : ''); return; }
    if (!file.text) {
      this.message(file.note ?? (isTextPath(file.path)
        ? 'This file is larger than 2 MB, so it is not shown here. Download the ZIP to open it in another application.'
        : 'This binary file is kept in the ZIP exactly as imported. Download the ZIP to open it in another application.'));
      return;
    }
    if (!this.editor) this.message('Opening the editor…');
  }

  private open(path: string, editor: DeckEditor): void {
    const project = this.project;
    const file = this.list.find((entry) => entry.path === path);
    if (!project || !file?.text) return;
    const text = editor.text(path) ?? deckFileText(project, path);
    if (text === undefined) { this.message('This file could not be read. Download the ZIP to open it in another application.'); return; }
    editor.open({ path, text, editable: file.editable });
    this.q('[data-pres-code]').hidden = false;
    this.q('[data-pres-file-message]').hidden = true;
    this.refreshStates();
  }

  /** In place of the editor: why a file is not shown, or that the editor is loading. */
  private message(text: string): void {
    const area = this.q('[data-pres-file-message]');
    area.textContent = text;
    area.hidden = !text;
    this.q('[data-pres-code]').hidden = !!text;
  }

  private status(text: string): void {
    this.q('[data-pres-edit-status]').textContent = text;
  }

  /** Why a change was not applied: the site's words, or the build's cleaned messages, as text. */
  private problems(lines: string[]): void {
    const area = this.q('[data-pres-edit-problem]');
    area.replaceChildren(...lines.slice(0, 5).map((line) => {
      const paragraph = document.createElement('p');
      paragraph.textContent = line;
      return paragraph;
    }));
    area.hidden = !lines.length;
  }

  private setBusy(busy: boolean): void {
    this.busy = busy;
    this.root.toggleAttribute('aria-busy', busy);
    this.refreshStates();
  }

  /**
   * Rebuild with the changed files and replay (a Reveal.js deck on the same slide). A build
   * error changes nothing: the problem is shown, the changes stay in the
   * editor, and the presentation keeps the last version that worked.
   */
  private async apply(paths = this.pendingPaths(), done = 'Changes applied.', see = 'them'): Promise<boolean> {
    const project = this.project;
    const editor = this.editor;
    if (!project || !editor || this.busy || !isEditableDeck(project)) return false;
    if (!paths.length) { this.status('There are no changes to apply.'); return false; }
    const changes = new Map(paths.map((path) => [path, editor.text(path) ?? deckFileText(project, path) ?? '']));
    const next = nextDeckEdits(project, changes);
    if (next.problem) {
      this.problems([next.problem]);
      this.status('Nothing was applied.');
      return false;
    }
    this.problems([]);
    this.status('Applying your changes…');
    this.setBusy(true);
    try {
      const outcome = await this.host.applyEdits(next.edits);
      if (project !== this.project) return false;
      if (!outcome.applied) {
        this.problems(outcome.problems?.length ? outcome.problems : ['The presentation could not be prepared with these changes. Undo the last change, then choose Apply changes again.']);
        this.status('Nothing was applied. The presentation still shows the last version that worked.');
        return false;
      }
      for (const path of paths) if (editor.text(path) === deckFileText(project, path)) this.touched.delete(path);
      // Only Reveal.js decks report their slide, so only they come back to it;
      // any other page starts again from the beginning.
      const reveal = project.engine === 'reveal';
      const replay = outcome.replay === 'now' ? (reveal ? `The presentation shows ${see} on the same slide.` : `The presentation starts again from the beginning to show ${see}.`)
        : outcome.replay === 'on-return' ? (reveal ? `Choose Presentation to see ${see} on the same slide.` : `Choose Presentation to see ${see}. The presentation starts again from the beginning.`)
          : outcome.replay === 'on-start' ? `Start the presentation to see ${see}.` : '';
      this.status([done, replay, outcome.storage ?? ''].filter(Boolean).join(' '));
      if (outcome.storageProblem) this.problems([outcome.storageProblem]);
      return true;
    } finally {
      if (project === this.project) this.setBusy(false);
    }
  }

  /**
   * Discard changes to the selected file. Changes not applied yet go back to
   * the text that plays now; what is applied and saved stays, and Undo in the
   * editor brings the typing back. A file with no unapplied changes but with
   * applied edits goes back to its imported text, after confirmation, as
   * Restore original does for the whole presentation.
   */
  private async discard(): Promise<void> {
    const project = this.project;
    const editor = this.editor;
    const path = this.selected;
    const file = this.list.find((entry) => entry.path === path);
    if (!project || !editor || !path || !file?.editable || this.busy) return;
    const name = visiblePath(path);
    if (this.pendingPaths().includes(path)) {
      const applied = deckFileText(project, path);
      if (applied === undefined) return;
      editor.replace(path, applied);
      this.touched.delete(path);
      this.problems([]);
      this.status(`Unapplied changes to ${name} discarded. Undo (${/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘Z' : 'Ctrl+Z'}) in the editor brings them back.`);
      this.refreshStates();
      this.focusWork();
      return;
    }
    if (!project.edits.has(path)) return;
    const original = deckOriginalText(project, path);
    if (original === undefined) return;
    const confirmed = await this.host.confirm({
      title: 'Restore this file as imported?',
      message: `Your applied changes to ${name} will be removed from this browser, and the file goes back to its imported text. Your other files and your original file are unchanged.`,
      confirm: 'Restore this file',
      cancel: 'Keep my changes',
    });
    if (!confirmed || project !== this.project || this.selected !== path) { this.focusWork(); return; }
    editor.replace(path, original);
    this.touched.add(path);
    await this.apply([path], `${name} is back to its imported text.`, 'the imported text');
    this.focusWork();
  }

  /** After Discard or Restore original: the keyboard goes to the editor, or to the selected file when no editor shows. */
  private focusWork(): void {
    if (!this.q('[data-pres-code]').hidden && this.editor) { this.editor.focus(); return; }
    const selected = this.selected ? this.buttons.get(this.selected) : undefined;
    (selected ?? this.buttons.values().next().value)?.focus();
  }

  /** Every file goes back to its imported text, after confirmation; the original upload was never changed. */
  private async restore(): Promise<void> {
    const project = this.project;
    const editor = this.editor;
    if (!project || !editor || this.busy || !isEditableDeck(project)) return;
    const edited = new Set([...project.edits.keys(), ...this.pendingPaths()]);
    if (!edited.size) { this.status('This presentation is already as imported.'); return; }
    const confirmed = await this.host.confirm({
      title: 'Restore the original presentation?',
      message: `Your changes to ${files(edited.size)} will be removed from this browser, and the presentation will play as it was imported. Your original file is unchanged.`,
      confirm: 'Restore original',
      cancel: 'Keep my changes',
    });
    if (!confirmed || project !== this.project) return;
    if (project.edits.size) {
      this.status('Restoring the original…');
      this.setBusy(true);
      try {
        // The original is what was imported, so it is restored even if it cannot play here.
        const outcome = await this.host.applyEdits(new Map(), { force: true });
        if (project !== this.project) return;
        if (!outcome.applied) { this.problems(outcome.problems ?? []); this.status('The original could not be restored. Close the presentation and open your original file again.'); return; }
        this.status(['The original presentation is restored.', outcome.storage ?? ''].filter(Boolean).join(' '));
        this.problems(outcome.storageProblem ? [outcome.storageProblem] : []);
      } finally {
        if (project === this.project) this.setBusy(false);
      }
    } else {
      this.status('Your changes were discarded. The presentation is as imported.');
      this.problems([]);
    }
    this.touched.clear();
    editor.clear();
    if (this.selected) this.open(this.selected, editor);
    this.refreshStates();
    this.focusWork();
  }

  private async copy(): Promise<void> {
    const project = this.project;
    const path = this.selected;
    if (!project || !path) return;
    const text = this.editor?.text(path) ?? deckFileText(project, path);
    if (text === undefined) return;
    try {
      await navigator.clipboard.writeText(text);
      this.status(`Copied ${visiblePath(path)}.`);
    } catch {
      this.status('Copying is not available here. Select the text in the editor, then use your browser’s Copy command.');
    }
  }
}
