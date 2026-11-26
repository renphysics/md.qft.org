import type { BuildDeps, DeckProject, PlayableDeck, StoredDeckSource } from '../lib/deck-project';
import type { StoredPresentation, StoredPresentationInfo } from '../lib/presentation-store';
import type { DeckIssue } from '../lib/deck-types';
import { formatDeckReport, type DeckReportRuntimeMessage } from '../lib/deck-report';
import { PresentationProblemLog, cleanReportedText } from '../lib/presentation-messages';
import {
  createPresentationPlayer, exportPresentationHtml, preparePresentationDocument,
  type PresentationMessageOrigin, type PresentationPlayer,
} from '../lib/presentation-runtime';

function bytesLabel(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function fileName(title: string): string {
  return title.normalize('NFKC').replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 90) || 'presentation';
}

/** What plays a deck, as people know it. */
function engineLabel(engine: string): string {
  return engine === 'reveal' ? 'Reveal.js' : engine === 'html' ? 'HTML' : 'Slidev';
}

/** The same test as deck-project's isPlayable, without loading that module. */
function canPlay(playable: PlayableDeck): boolean {
  return !!playable.html && !playable.issues.some((issue) => issue.severity === 'error');
}

function randomHex(bytes: number): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function severityLabel(severity: DeckIssue['severity']): string {
  return severity === 'error' ? 'Needs a fix' : severity === 'warning' ? 'Check' : 'Note';
}

/** The deck on show and what the player plays for it. */
interface ActiveDeck {
  project: DeckProject;
  playable: PlayableDeck;
}

/** Every saved record and kept-in-memory deck opens through openStoredDeck. */
type LibraryRecord = StoredDeckSource & { editsUnreadable?: boolean };

export class PresentationLibrary extends HTMLElement {
  /** What the library can truthfully promise about local playback. */
  static readonly privacyNote = 'Not uploaded. Presentations cannot read your documents, and ordinary network requests are blocked.';
  /** Run-time messages kept for one playback, as the player sends at most 20 warnings. */
  static readonly runtimeLimit = 20;
  private abort = new AbortController();
  private initialized = false;
  private player?: PresentationPlayer;
  private active?: ActiveDeck;
  private records: StoredPresentationInfo[] = [];
  /** Decks that could not be saved: compressed bytes only, bounded below. */
  private temporary = new Map<string, LibraryRecord>();
  private operation = 0;
  private busy = false;
  /** True while the dialog is closed and its playback has been cleaned up. */
  private closed = true;
  private returnFocus?: HTMLElement;
  private problems = new PresentationProblemLog();
  /** Warnings and errors from the current playback, for the check notes and the report. */
  private runtime: DeckReportRuntimeMessage[] = [];
  private slides?: number;

  private q<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.querySelector<T>(selector);
    if (!element) throw new Error(`Missing presentation control: ${selector}`);
    return element;
  }

  connectedCallback(): void {
    if (this.initialized) return;
    this.initialized = true;
    const signal = this.abort.signal;
    const click = (selector: string, action: () => void | Promise<void>) => {
      this.q(selector).addEventListener('click', () => { void Promise.resolve().then(action).catch((error) => this.notice(error)); }, { signal });
    };
    click('[data-pres-open]', () => this.q<HTMLInputElement>('[data-pres-input]').click());
    click('[data-pres-close]', () => this.closeDialog());
    click('[data-pres-back]', () => this.openLibrary());
    click('[data-pres-example]', () => this.openExample());
    click('[data-pres-start-button]', () => this.start());
    // Fullscreen requests must remain directly inside the user gesture.
    this.q('[data-pres-present]').addEventListener('click', () => this.present(), { signal });
    click('[data-pres-stop]', () => this.player?.stop());
    click('[data-pres-restart]', () => { this.clearProblems(); this.clearRuntime(); this.player?.restart(); });
    click('[data-pres-zip]', () => this.downloadArchive());
    click('[data-pres-html]', () => this.downloadHtml());
    click('[data-pres-copy]', () => this.copySource());
    click('[data-pres-report]', () => this.copyReport());
    click('[data-pres-exit-fullscreen]', () => this.exitFullscreen());
    for (const button of this.querySelectorAll<HTMLButtonElement>('[data-pres-view]')) {
      button.addEventListener('click', () => this.setView(button.dataset.presView === 'source' ? 'source' : 'preview'), { signal });
    }
    this.q<HTMLSelectElement>('[data-pres-file]').addEventListener('change', () => this.showSource(), { signal });
    this.q<HTMLInputElement>('[data-pres-input]').addEventListener('change', (event) => {
      const input = event.target as HTMLInputElement;
      const file = input.files?.[0];
      input.value = '';
      if (file) void this.tryOpenFile(file).then((handled) => {
        if (!handled) this.notice('This file is not a presentation. If it holds a Markdown document or lesson, close this panel and use Open file in the workspace.');
      }).catch((error) => this.notice(error));
    }, { signal });
    const dialog = this.q<HTMLDialogElement>('[data-pres-dialog]');
    // The close event arrives a task after the dialog closes. A file opened
    // in between has already reopened it, so a late event changes nothing.
    dialog.addEventListener('close', () => { if (!dialog.open) this.afterClose(); }, { signal });
    dialog.addEventListener('cancel', (event) => {
      if (this.isFullscreen()) { event.preventDefault(); this.exitFullscreen(); }
    }, { signal });
    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.isFullscreen()) { event.preventDefault(); this.exitFullscreen(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && this.active) {
        event.preventDefault();
        event.stopPropagation();
        this.downloadArchive();
      }
    }, { signal });
    document.addEventListener('fullscreenchange', () => {
      this.q('[data-pres-exit-fullscreen]').hidden = !this.isFullscreen();
    }, { signal });
    const query = new URL(location.href);
    if (query.searchParams.get('presentation') === 'slidev-example') {
      query.searchParams.delete('presentation');
      history.replaceState(null, '', `${query.pathname}${query.search}${query.hash}`);
      void this.openExample().catch((error) => this.notice(error));
    }
  }

  disconnectedCallback(): void {
    this.operation += 1;
    this.abort.abort();
    this.player?.destroy();
  }

  private openDialog(): void {
    const dialog = this.q<HTMLDialogElement>('[data-pres-dialog]');
    if (dialog.open) return;
    this.closed = false;
    this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    this.dispatchEvent(new CustomEvent('presentation-open', { bubbles: true }));
    dialog.showModal();
  }

  /** Close now and stop everything at once, rather than when the close event arrives. */
  private closeDialog(): void {
    this.q<HTMLDialogElement>('[data-pres-dialog]').close();
    this.afterClose();
  }

  /** Runs once per closing: for the Close button, Escape, or any other way the dialog closes. */
  private afterClose(): void {
    if (this.closed) return;
    this.closed = true;
    this.operation += 1;
    this.busy = false;
    this.exitFullscreen();
    this.player?.destroy();
    this.player = undefined;
    this.active = undefined;
    this.runtime = [];
    this.returnFocus?.focus();
    this.dispatchEvent(new CustomEvent('presentation-close', { bubbles: true }));
  }

  /** Application messages only. Text supplied by a presentation goes to reportProblem. */
  private notice(value?: unknown): void {
    const area = this.q('[data-pres-notice]');
    area.textContent = value === undefined ? '' : value instanceof Error ? value.message : String(value);
    area.hidden = value === undefined;
  }

  private storage(text: string): void {
    this.q('[data-pres-storage]').textContent = text;
  }

  /**
   * Playback problems appear on the stage, so they stay visible in fullscreen.
   * Presentation text is labelled as such and rendered as text, never markup.
   */
  private reportProblem(origin: PresentationMessageOrigin, message: string): void {
    this.problems.add(origin, message);
    this.renderProblems();
  }

  private clearProblems(): void {
    this.problems.clear();
    this.renderProblems();
  }

  private renderProblems(): void {
    const area = this.q('[data-pres-problem]');
    const lines = this.problems.problems.map((problem) => {
      const line = document.createElement('p');
      if (problem.origin === 'presentation') {
        const label = document.createElement('strong');
        label.textContent = 'The presentation reported: ';
        const quote = document.createElement('q');
        quote.textContent = problem.text;
        line.append(label, quote);
      } else line.textContent = problem.text;
      return line;
    });
    if (this.problems.hidden) {
      const more = document.createElement('p');
      more.textContent = `${this.problems.hidden} more message${this.problems.hidden === 1 ? ' was' : 's were'} not shown.`;
      lines.push(more);
    }
    area.replaceChildren(...lines);
    area.hidden = !lines.length;
  }

  /** A warning or error from the running deck, kept for the check notes and the report. */
  private addRuntime(origin: PresentationMessageOrigin, message: string): void {
    const text = cleanReportedText(message);
    if (!text || this.runtime.length >= PresentationLibrary.runtimeLimit
      || this.runtime.some((item) => item.origin === origin && item.text === text)) return;
    this.runtime.push({ origin, text });
    this.renderNotes();
  }

  private clearRuntime(): void {
    this.runtime = [];
    this.slides = undefined;
    this.renderSlides();
    this.renderNotes();
  }

  private renderSlides(): void {
    const area = this.q('[data-pres-slides]');
    area.textContent = this.slides === undefined ? '' : `${this.slides} ${this.slides === 1 ? 'slide' : 'slides'}`;
    area.hidden = this.slides === undefined;
  }

  /**
   * Notes from the check (written by this site, with cleaned paths) and what
   * the deck reported while playing (its own words, labelled and shown as
   * text). The count is announced politely as notes arrive.
   */
  private renderNotes(): void {
    const area = this.q<HTMLDetailsElement>('[data-pres-notes]');
    const issues = this.active?.playable.issues ?? [];
    const items = issues.map((issue) => {
      const item = document.createElement('li');
      item.dataset.severity = issue.severity;
      const label = document.createElement('strong');
      label.textContent = `${severityLabel(issue.severity)}: `;
      const message = document.createElement('span');
      message.textContent = issue.message;
      item.append(label, message);
      if (issue.where) {
        const where = document.createElement('small');
        where.textContent = issue.where;
        item.append(where);
      }
      return item;
    });
    this.q('[data-pres-notes-list]').replaceChildren(...items);
    const runtime = this.runtime.map((entry) => {
      const item = document.createElement('li');
      if (entry.origin === 'presentation') {
        const label = document.createElement('strong');
        label.textContent = 'The presentation reported: ';
        const quote = document.createElement('q');
        quote.textContent = entry.text;
        item.append(label, quote);
      } else item.textContent = entry.text;
      return item;
    });
    this.q('[data-pres-runtime-list]').replaceChildren(...runtime);
    this.q('[data-pres-runtime]').hidden = !runtime.length;
    const total = issues.length + runtime.length;
    this.q('[data-pres-notes-count]').textContent = total === 1 ? '1 note' : `${total} notes`;
    area.hidden = !total;
    if (issues.some((issue) => issue.severity === 'error')) area.open = true;
  }

  async openLibrary(): Promise<void> {
    this.operation += 1;
    this.busy = false;
    this.exitFullscreen();
    this.player?.destroy();
    this.player = undefined;
    this.active = undefined;
    this.runtime = [];
    this.openDialog();
    this.q('[data-pres-title]').textContent = 'Presentations';
    this.q('[data-pres-subtitle]').textContent = 'Interactive slides, played in this browser.';
    this.q('[data-pres-library]').hidden = false;
    this.q('[data-pres-deck]').hidden = true;
    this.q('[data-pres-back]').hidden = true;
    this.storage(PresentationLibrary.privacyNote);
    this.notice();
    // The list shown until now may be out of date; say so until it is read again.
    this.q('[data-pres-list]').setAttribute('aria-busy', 'true');
    await this.refreshLibrary();
  }

  private async refreshLibrary(): Promise<void> {
    try {
      const { listPresentationsDetailed } = await import('../lib/presentation-store');
      const listing = await listPresentationsDetailed();
      this.records = listing.presentations;
      if (listing.skipped) {
        this.notice(`${listing.skipped} saved ${listing.skipped === 1 ? 'presentation' : 'presentations'} could not be read. ${listing.skipped === 1 ? 'It is' : 'They are'} kept in this browser unchanged.`);
      }
    } catch (error) {
      this.notice(error);
    }
    this.renderLibrary();
  }

  private renderLibrary(): void {
    const list = this.q('[data-pres-list]');
    const imported = (time: number) => new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const entries = [
      ...this.records.map((record) => ({
        id: record.id, title: record.title,
        detail: `${engineLabel(record.engine)} · ${bytesLabel(record.archiveSize)} · Imported ${imported(record.createdAt)}${record.edited ? ' · Edited' : ''}`,
      })),
      ...[...this.temporary].map(([id, deck]) => ({ id, title: deck.title, detail: `${engineLabel(deck.engine)} · ${bytesLabel(deck.archive.size)} · Not saved — keep your file` })),
    ];
    this.q('[data-pres-count]').textContent = String(entries.length);
    const rows = entries.map((entry) => {
      const row = document.createElement('div');
      row.className = 'presentation-saved-row';
      row.setAttribute('role', 'listitem');
      const open = document.createElement('button');
      open.className = 'presentation-saved-open';
      open.setAttribute('aria-label', `Open ${entry.title}`);
      const symbol = document.createElement('span'); symbol.textContent = '▶'; symbol.setAttribute('aria-hidden', 'true');
      const text = document.createElement('span');
      const title = document.createElement('strong'); title.textContent = entry.title;
      const detail = document.createElement('small'); detail.textContent = entry.detail;
      text.append(title, detail); open.append(symbol, text);
      open.addEventListener('click', () => { void this.openSaved(entry.id).catch((error) => this.notice(error)); });
      const remove = document.createElement('button');
      remove.textContent = 'Remove'; remove.setAttribute('aria-label', `Remove ${entry.title}`);
      remove.addEventListener('click', () => {
        if (remove.dataset.presConfirmDelete !== entry.id) {
          remove.dataset.presConfirmDelete = entry.id; remove.textContent = 'Confirm removal';
          remove.setAttribute('aria-label', `Confirm removal of ${entry.title} from this browser`);
          return;
        }
        remove.disabled = true;
        void this.removeSaved(entry.id).catch((error) => { remove.disabled = false; this.notice(error); });
      });
      row.append(open, remove);
      return row;
    });
    list.replaceChildren(...rows);
    list.removeAttribute('aria-busy');
    if (!entries.length) {
      const empty = document.createElement('p'); empty.className = 'presentation-empty';
      empty.textContent = 'Your imported presentations will appear here.'; list.append(empty);
    }
  }

  private async removeSaved(id: string): Promise<void> {
    if (this.temporary.has(id)) this.temporary.delete(id);
    else { const { deletePresentation } = await import('../lib/presentation-store'); await deletePresentation(id); }
    await this.refreshLibrary();
    this.notice('Removed from this browser. Your original file is unchanged.');
  }

  /** Build-time services for deck-project: the bundled libraries, the player's own checks, progress. */
  private buildDeps(operation: number): BuildDeps {
    return {
      vendor: async () => (await import('../lib/deck-vendor-browser')).browserVendorProvider(),
      // The real preparation, discarded: a document the player would refuse is reported before saving.
      prepare: (html, profile) => { preparePresentationDocument(html, randomHex(18), randomHex(18), { profile }); },
      onProgress: (message) => { if (operation === this.operation) this.notice(message); },
    };
  }

  private async openSaved(id: string): Promise<void> {
    if (this.busy) { this.notice('A presentation is opening. Please wait a moment.'); return; }
    this.busy = true;
    const operation = ++this.operation;
    try {
      let record: LibraryRecord | undefined = this.temporary.get(id);
      const saved = !record;
      if (!record) {
        const { getPresentation } = await import('../lib/presentation-store');
        const stored: StoredPresentation | undefined = await getPresentation(id);
        if (operation !== this.operation) return;
        if (!stored) { await this.refreshLibrary(); throw new Error('This presentation was removed in another tab. Open its file to restore it.'); }
        record = stored;
      }
      await this.openRecord(record, operation, saved);
    } finally { if (operation === this.operation) this.busy = false; }
  }

  private async openRecord(record: LibraryRecord, operation: number, saved: boolean): Promise<void> {
    this.openDialog();
    this.notice('Opening the presentation…');
    const deckProject = await import('../lib/deck-project');
    const project = await deckProject.openStoredDeck(record);
    if (operation !== this.operation) return;
    const playable = await deckProject.buildPlayable(project, this.buildDeps(operation));
    if (operation !== this.operation) return;
    this.showDeck(project, playable, saved ? 'saved' : 'unsaved');
    if (record.editsUnreadable) this.notice('Your edits to this presentation could not be read, so the original is shown. The stored edits are kept unchanged.');
  }

  /**
   * Open a chosen .html, .htm or .zip file. Every deck is built and checked by
   * the player's own preparation before it is saved, so a deck that cannot
   * play is reported with its notes and not stored. Returns false for files
   * that are not presentations (a Markdown document or lesson ZIP), so the
   * workspace's importer handles them as before.
   */
  async tryOpenFile(file: File): Promise<boolean> {
    if (this.busy) throw new Error('A presentation is already opening. Please wait a moment.');
    this.busy = true;
    const operation = ++this.operation;
    try {
      const deckProject = await import('../lib/deck-project');
      const project = await deckProject.openDeck(file);
      if (!project) return false;
      if (operation !== this.operation) return true;
      this.openDialog();
      this.notice('Checking the presentation…');
      const playable = await deckProject.buildPlayable(project, this.buildDeps(operation));
      if (operation !== this.operation) return true;
      this.showDeck(project, playable, 'new');
      if (!deckProject.isPlayable(playable)) {
        this.storage('Not saved. This file cannot be played here yet; see the notes from the check.');
        return true;
      }
      const input = deckProject.deckSaveInput(project);
      if (!input) return true;
      this.storage('Saving this presentation in your browser…');
      let edited: string | undefined;
      try {
        const { saveDeck } = await import('../lib/presentation-store');
        const { info, existing } = await saveDeck(input);
        this.records = [info, ...this.records.filter((entry) => entry.id !== info.id)];
        if (operation !== this.operation) return true;
        project.id = info.id;
        if (existing && info.edited) {
          edited = info.id;
        } else if (existing) {
          this.storage('Already in your library. Keep the original file as your backup.');
          this.notice('This presentation is already in your library, so it was not added again.');
        } else {
          this.storage('Saved in this browser. Keep the original file as your backup.');
        }
      } catch (error) {
        // Keep compressed bytes only and bound failed-save memory independently
        // of the active player. Every import still has its original local file.
        let evicted = false;
        while ([...this.temporary.values()].reduce((sum, item) => sum + item.archive.size, input.archive.size) > 120 * 1024 * 1024 || this.temporary.size >= 5) {
          this.temporary.delete(this.temporary.keys().next().value!);
          evicted = true;
        }
        this.temporary.set(`temporary-${crypto.randomUUID()}`, {
          title: input.title, kind: input.kind, engine: input.engine, archive: input.archive, fileName: input.fileName,
          ...(input.entry ? { entry: input.entry } : {}), ...(input.source ? { source: input.source } : {}),
          ...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}),
        });
        if (operation === this.operation) {
          this.storage('Not saved in this browser. Download ZIP to keep a copy.');
          this.notice(`${error instanceof Error ? error.message : String(error)}${evicted ? ' Older unsaved presentations can be reopened from their original files.' : ''}`);
        }
      }
      if (edited) {
        // The library copy carries edits; show it rather than the unedited file.
        await this.openRecordById(edited, operation);
        if (operation === this.operation) this.notice('This presentation is already in your library, with your edits, so it opened from there.');
      }
      return true;
    } finally { if (operation === this.operation) this.busy = false; }
  }

  private async openRecordById(id: string, operation: number): Promise<void> {
    const { getPresentation } = await import('../lib/presentation-store');
    const stored = await getPresentation(id);
    if (stored && operation === this.operation) await this.openRecord(stored, operation, true);
  }

  private showDeck(project: DeckProject, playable: PlayableDeck, state: 'new' | 'saved' | 'unsaved'): void {
    this.exitFullscreen();
    this.player?.destroy();
    this.player = undefined;
    this.active = { project, playable };
    this.openDialog();
    this.notice();
    this.clearProblems();
    this.runtime = [];
    this.slides = undefined;
    this.renderSlides();
    const ready = canPlay(playable);
    const engine = engineLabel(project.engine);
    const count = project.sources.length;
    this.q('[data-pres-title]').textContent = project.title;
    this.q('[data-pres-subtitle]').textContent = `${engine} · ${count} ${count === 1 ? 'file' : 'files'} · ${bytesLabel(project.original.size)}`;
    this.q('[data-pres-engine]').textContent = engine;
    this.q('[data-pres-start-title]').textContent = project.title;
    this.q('[data-pres-start-message]').textContent = ready
      ? 'Slides and demonstrations run locally when you press Start.'
      : 'This presentation cannot be played here yet.';
    this.q('[data-pres-stage]').style.setProperty('--presentation-aspect', project.aspectRatio === '4:3' ? '4 / 3' : '16 / 9');
    this.q('[data-pres-start-detail]').textContent = !ready ? 'The notes from the check below say what to change.'
      : project.kind === 'qft-presentation' ? (project.source ? 'Editable source included in the ZIP' : 'Built presentation · source not included')
        : 'Prepared to play offline in this browser';
    this.storage(state === 'saved' ? 'Saved in this browser. Keep the original file as your backup.'
      : state === 'unsaved' ? 'Not saved in this browser. Download ZIP to keep a copy.'
        : 'Local presentation. Your original file is unchanged.');
    this.q('[data-pres-library]').hidden = true;
    this.q('[data-pres-deck]').hidden = false;
    this.q('[data-pres-back]').hidden = false;
    this.q<HTMLButtonElement>('[data-pres-start-button]').hidden = !ready;
    this.q<HTMLButtonElement>('[data-pres-present]').disabled = !ready;
    this.q<HTMLButtonElement>('[data-pres-html]').disabled = !ready;
    this.q('[data-pres-keyboard-hint]').hidden = !ready;
    this.q('[data-pres-source-note]').textContent = project.kind === 'qft-presentation'
      ? 'Source is preserved exactly as imported. Revise it with your editor or AI assistant, rebuild the presentation, then open the new ZIP. The compiled slides do not change when source files are edited elsewhere.'
      : project.kind === 'reveal' || project.kind === 'html'
        ? 'These are the files as imported. Revise them with your AI assistant, then open the new file here. Your original file is unchanged.'
        : 'Source is shown exactly as imported. Build the presentation, then open the new ZIP here.';
    const select = this.q<HTMLSelectElement>('[data-pres-file]');
    const first = project.source ?? project.entry;
    const files = [...project.sources].sort((a, b) => {
      if (a.path === first) return -1;
      if (b.path === first) return 1;
      return a.path.localeCompare(b.path);
    });
    select.replaceChildren(...files.map((file) => new Option(`${file.path} (${bytesLabel(file.size)})`, file.path)));
    this.showSource();
    this.setView('preview');
    // Each deck starts with its notes folded (errors unfold them) and no old report.
    this.q<HTMLDetailsElement>('[data-pres-notes]').open = false;
    this.q('[data-pres-report-text]').hidden = true;
    this.renderNotes();
    if (!ready) {
      for (const issue of playable.issues) if (issue.severity === 'error') this.reportProblem('player', issue.message);
      this.q('[data-pres-start]').hidden = false;
      this.q('[data-pres-stop]').hidden = true;
      this.q('[data-pres-restart]').hidden = true;
      this.q('[data-pres-player-status]').textContent = 'Cannot be played here yet';
      return;
    }
    this.player = createPresentationPlayer(this.q('[data-pres-host]'), playable.html, {
      title: project.title,
      sandboxUrl: this.dataset.sandboxUrl!,
      profile: playable.profile,
      onState: (state) => {
        this.q('[data-pres-start]').hidden = state === 'loading' || state === 'ready';
        this.q('[data-pres-player-status]').textContent = ({ stopped: 'Ready to start', loading: 'Opening presentation…', ready: 'Playing locally', error: 'Playback needs attention' })[state];
        this.q('[data-pres-stop]').hidden = state !== 'loading' && state !== 'ready';
        this.q('[data-pres-restart]').hidden = state === 'stopped';
      },
      onError: (message, origin) => { this.reportProblem(origin, message); this.addRuntime(origin, message); },
      onWarning: (message) => this.addRuntime('presentation', message),
      onSlides: (slides) => { this.slides = slides; this.renderSlides(); },
      // The deck's own fullscreen key (F in Reveal.js) works as Present does.
      onFullscreenRequest: (request) => { if (request === 'enter') this.enterFullscreen(); else this.exitFullscreen(); },
      // Escape belongs to the deck's overview/menu while embedded. Only the
      // outer fullscreen state needs handling here; keep the lesson open.
      onEscape: () => { if (this.isFullscreen()) this.exitFullscreen(); },
    });
    this.q('[data-pres-start]').hidden = false;
    this.q('[data-pres-stop]').hidden = true;
    this.q('[data-pres-restart]').hidden = true;
    this.q('[data-pres-player-status]').textContent = 'Ready to start';
  }

  private setView(view: 'preview' | 'source'): void {
    this.q('[data-pres-preview]').hidden = view !== 'preview';
    this.q('[data-pres-source]').hidden = view !== 'source';
    for (const button of this.querySelectorAll('[data-pres-view]')) {
      button.setAttribute('aria-pressed', String((button as HTMLElement).dataset.presView === view));
    }
  }

  private showSource(): void {
    const path = this.q<HTMLSelectElement>('[data-pres-file]').value;
    const file = this.active?.project.sources.find((entry) => entry.path === path);
    const field = this.q<HTMLTextAreaElement>('[data-pres-source-text]');
    const readable = typeof file?.text === 'string';
    field.value = readable ? file.text! : 'This binary or large file is preserved in the ZIP. Download the ZIP to open it with the appropriate application.';
    field.scrollTop = 0;
    this.q<HTMLButtonElement>('[data-pres-copy]').disabled = !readable;
    this.q('[data-pres-file-info]').textContent = file ? `${file.path} · ${bytesLabel(file.size)}${readable ? ' · Read-only source' : ''}` : '';
  }

  private async copySource(): Promise<void> {
    const field = this.q<HTMLTextAreaElement>('[data-pres-source-text]');
    try { await navigator.clipboard.writeText(field.value); this.notice('Source copied.'); }
    catch { field.focus(); field.select(); this.notice('Source selected. Use your browser’s Copy command.'); }
  }

  /** A compact plain-text report of the check and of this playback, for the AI that made the deck. */
  private async copyReport(): Promise<void> {
    const active = this.active;
    if (!active) return;
    const { project, playable } = active;
    const report = formatDeckReport({
      kind: project.kind, engine: project.engine,
      ...(project.detection.engineVersion ? { engineVersion: project.detection.engineVersion } : {}),
      ...(project.entry ? { entry: project.entry } : {}),
      ...(this.slides !== undefined ? { slides: this.slides } : {}),
      issues: playable.issues, runtime: this.runtime,
    });
    const field = this.q<HTMLTextAreaElement>('[data-pres-report-text]');
    field.value = report;
    try {
      await navigator.clipboard.writeText(report);
      field.hidden = true;
      this.notice('Report copied. Paste it into the AI assistant that made the presentation.');
    } catch {
      field.hidden = false;
      field.focus();
      field.select();
      this.notice('Report selected. Use your browser’s Copy command.');
    }
  }

  private start(): void {
    this.setView('preview');
    this.notice();
    this.clearProblems();
    this.clearRuntime();
    this.player?.start();
  }

  private isFullscreen(): boolean {
    const stage = this.q('[data-pres-stage]');
    return document.fullscreenElement === stage || stage.classList.contains('presentation-fallback-fullscreen');
  }

  /** Show the stage in fullscreen and hand the keyboard to the deck. Call within a user action. */
  private enterFullscreen(): void {
    try {
      if (!this.player?.isRunning()) return;
      if (this.isFullscreen()) { this.player.focus(); return; }
      const stage = this.q('[data-pres-stage]');
      const fallback = () => { stage.classList.add('presentation-fallback-fullscreen'); this.q('[data-pres-exit-fullscreen]').hidden = false; this.player?.focus(); };
      if (stage.requestFullscreen) void stage.requestFullscreen().then(() => this.player?.focus()).catch(fallback);
      else fallback();
    } catch (error) { this.notice(error); }
  }

  private present(): void {
    try {
      this.setView('preview');
      if (!this.player) { this.notice('This presentation cannot be played here yet. The notes from the check say what to change.'); return; }
      if (!this.player.isRunning()) this.start();
      this.enterFullscreen();
    } catch (error) { this.notice(error); }
  }

  private exitFullscreen(): void {
    const stage = this.q('[data-pres-stage]');
    if (document.fullscreenElement === stage) void document.exitFullscreen().catch(() => {});
    stage.classList.remove('presentation-fallback-fullscreen');
    this.q('[data-pres-exit-fullscreen]').hidden = true;
  }

  private downloadArchive(): void {
    const project = this.active?.project;
    if (!project) return;
    download(project.original, project.fileName || `${fileName(project.title)}.zip`);
  }

  private downloadHtml(): void {
    const active = this.active;
    if (!active) return;
    if (!canPlay(active.playable)) { this.notice('This presentation cannot be played here yet, so there is no standalone copy to download.'); return; }
    const html = exportPresentationHtml(active.playable.html, active.project.title, { profile: active.playable.profile });
    download(new Blob([html], { type: 'text/html;charset=utf-8' }), `${fileName(active.project.title)}.html`);
    this.notice('Standalone player downloaded. Open it offline and choose Start to run the slides.');
  }

  async openExample(): Promise<void> {
    if (this.busy) return;
    this.openDialog();
    this.notice('Opening the interactive Slidev example…');
    const operation = ++this.operation;
    const response = await fetch(this.dataset.exampleUrl!, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error('The example could not be downloaded. Try again when the website is available.');
    const archive = await response.blob();
    if (operation !== this.operation) return;
    await this.tryOpenFile(new File([archive], 'quantum-interference-slidev.zip', { type: 'application/zip' }));
  }
}

if (!customElements.get('qft-presentation-library')) customElements.define('qft-presentation-library', PresentationLibrary);
