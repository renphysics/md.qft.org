import type { BuildDeps, DeckProject, PlayableDeck, StoredDeckSource } from '../lib/deck-project';
import type { StoredPresentation, StoredPresentationInfo } from '../lib/presentation-store';
import type { DeckIssue } from '../lib/deck-types';
import type { DeckApplyOutcome, DeckConfirmRequest, DeckSourceView } from './deck-sources';
import { formatDeckReport, isSiteSideCode, type DeckReportInput, type DeckReportRuntimeMessage } from '../lib/deck-report';
import { LOAD_FAILURE_TEXT, errorMessage, isLoadFailure, reloadButton, showLoadFailure } from '../lib/load-failure';
import {
  PresentationProblemLog, STALL_BLANK_NEXT, STALL_BLANK_TEXT, STALL_RESCUED_TEXT, cleanReportedText, linkParts, visiblePath,
} from '../lib/presentation-messages';
import {
  createPresentationPlayer, exportPresentationHtml, preparePresentationDocument,
  type PresentationLeft, type PresentationMessageOrigin, type PresentationPlayer, type PresentationPlayerState, type PresentationStall,
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
  return title.normalize('NFKC').replace(/[^\p{L}\p{N}_]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 90).replace(/-+$/, '') || 'presentation';
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

/**
 * An issue code for a problem on this site's side, not in the presentation:
 * the converter could not be loaded. Opening the file again later may work.
 * The report (deck-report.ts) owns the list.
 */
function siteSideCode(code: string): boolean {
  return isSiteSideCode(code);
}

function severityLabel(issue: DeckIssue): string {
  if (issue.severity === 'error' && siteSideCode(issue.code)) return 'Try again';
  return issue.severity === 'error' ? 'Needs a fix' : issue.severity === 'warning' ? 'Check' : 'Note';
}

/** True when the deck cannot play only because of a problem on this site's side. */
function siteSideFailure(playable: PlayableDeck): boolean {
  const errors = playable.issues.filter((issue) => issue.severity === 'error');
  return errors.length > 0 && errors.every((issue) => siteSideCode(issue.code));
}

/**
 * The converter's page script itself could not be fetched, or not in time.
 * deck-project treats an Error with a string `detail` as "converter
 * unavailable", as it does SlidevConverterUnavailableError. A script that
 * could not be fetched gets the site's fixed sentence (after a new release a
 * reload is what helps, not the connection).
 */
function converterUnavailable(message = LOAD_FAILURE_TEXT, detail = 'the converter script could not be loaded'): Error {
  const error = new Error(message) as Error & { detail: string };
  error.name = 'SlidevConverterUnavailableError';
  error.detail = detail;
  return error;
}

/** The converter's own sentence for a start that took too long (slidev-convert-browser.ts), for the whole limit. */
function converterTooSlow(limit: number): Error {
  return converterUnavailable(`The Slidev converter was not ready after ${Math.round(limit / 1000)} seconds. Check the internet connection, reload the page, and open the ZIP again.`, `not ready after ${limit} ms`);
}

/** The deck on show and what the player plays for it. */
interface ActiveDeck {
  project: DeckProject;
  /** The last build that worked, or the first one when the deck cannot play yet. */
  playable: PlayableDeck;
  /** The key of a deck kept in memory because it could not be saved. */
  temporaryKey?: string;
  /** True when applied edits could not be saved, so closing would lose them. */
  editsUnsaved?: boolean;
  /**
   * The `updatedAt` of the saved record this deck's edits are based on. A
   * save is refused when the stored record is newer (another tab saved since).
   */
  savedAt?: number;
}

/** What persistEdits says about where applied edits are kept. */
interface EditStorage {
  storage: string;
  /** Why they could not be saved, for the edit problem area. */
  problem?: string;
}

/** The two notices over the slides. */
type StageNotice = 'rescued' | 'link';

/**
 * The player's sentence when the presentation replaced its slides with a page
 * at another address: `what` says what the player did about it.
 */
function leftText(host: string | undefined, what: string): string {
  return `The presentation tried to replace its slides with a page${host ? ` from ${host}` : ''}, ${what} Ask your AI assistant to use an ordinary link for that page.`;
}

/** Every saved record and kept-in-memory deck opens through openStoredDeck. */
type LibraryRecord = StoredDeckSource & { editsUnreadable?: boolean; updatedAt?: number };

export class PresentationLibrary extends HTMLElement {
  /** What the library can truthfully promise about local playback. */
  static readonly privacyNote = 'Not uploaded. Presentations cannot read your documents, and ordinary network requests are blocked.';
  /**
   * Run-time messages kept for one playback, of each origin: 20 texts from the
   * presentation (the player sends at most 20 warnings) and, in their own room,
   * 20 of the player's sentences, which say what to do next.
   */
  static readonly runtimeLimit = 20;
  /** How long the basic-settings notice stays over the slides, while neither the pointer nor the keyboard is in it. */
  static readonly rescuedNoticeMs = 12_000;
  /** How long the link notice stays, likewise. */
  static readonly linkNoticeMs = 20_000;
  /**
   * SLIDEV_START_TIME_LIMIT of slidev-convert-browser.ts, copied because that
   * module is what is being downloaded: one limit covers downloading the
   * converter's page script and starting the converter.
   */
  static readonly slidevStartLimitMs = 90_000;
  /** How often one playback is started again after the presentation replaced itself with a page. */
  static readonly leftRestartLimit = 3;
  private abort = new AbortController();
  private initialized = false;
  private player?: PresentationPlayer;
  private active?: ActiveDeck;
  private records: StoredPresentationInfo[] = [];
  /** Decks that could not be saved: compressed bytes only, bounded below. */
  private temporary = new Map<string, LibraryRecord>();
  private operation = 0;
  /** Aborted when the operation it belongs to is superseded, so a slow conversion stops at once. */
  private operationAbort = new AbortController();
  private busy = false;
  /** True while the dialog is closed and its playback has been cleaned up. */
  private closed = true;
  private returnFocus?: HTMLElement;
  private problems = new PresentationProblemLog();
  /** Warnings and errors from the current playback, for the check notes and the report. */
  private runtime: DeckReportRuntimeMessage[] = [];
  private slides?: number;
  /** The Source files view, loaded with its editor the first time it is shown. */
  private sources?: DeckSourceView;
  private sourcesLoading?: Promise<DeckSourceView>;
  private playerState: PresentationPlayerState = 'stopped';
  /**
   * A new build waits while the Presentation view is hidden: a hidden frame
   * gets no animation frames, so a deck reloaded there could not finish
   * loading. It replays when the view is shown again.
   */
  private replayPending = false;
  /** Set when a Reveal.js deck stopped during start-up, for this playback. */
  private stall?: Exclude<PresentationStall, 'recovered'>;
  /** When the current playback started (Start, Restart or a replay), for opening the notes. */
  private playbackStarted = 0;
  /** The website the deck's last link points to, while its notice shows. */
  private linkUrl?: URL;
  /**
   * The basic-settings notice is due: shown unless the link notice takes its
   * place. It closes itself after rescuedNoticeMs, on Dismiss and at the
   * next start; the status line keeps saying it for the whole playback.
   */
  private rescuedNotice = false;
  /** The timers that close the notices; one waits while the pointer or the keyboard is in its notice. */
  private noticeTimers: Partial<Record<StageNotice, number>> = {};
  /** The notices the pointer is over. */
  private noticePointer = new Set<StageNotice>();
  /** Restarts after the presentation replaced itself with a page, since Start. */
  private leftRestarts = 0;

  /** Start a new operation: earlier ones see a changed number and their slow work is cancelled. */
  private nextOperation(): number {
    this.operationAbort.abort();
    this.operationAbort = new AbortController();
    return ++this.operation;
  }

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
    click('[data-pres-close]', () => this.leave(() => this.closeDialog()));
    click('[data-pres-back]', () => this.leave(() => this.openLibrary()));
    click('[data-pres-example]', () => this.openExample());
    click('[data-pres-start-button]', () => this.start());
    // Fullscreen requests must remain directly inside the user gesture.
    this.q('[data-pres-present]').addEventListener('click', () => this.present(), { signal });
    click('[data-pres-stop]', () => this.player?.stop());
    click('[data-pres-restart]', () => { this.clearProblems(); this.clearRuntime(); this.leftRestarts = 0; this.player?.restart(); });
    click('[data-pres-zip]', () => this.downloadArchive());
    click('[data-pres-zip-original]', () => this.downloadOriginal());
    click('[data-pres-html]', () => this.downloadHtml());
    click('[data-pres-report]', () => this.copyReport());
    click('[data-pres-exit-fullscreen]', () => this.exitFullscreen());
    // After Dismiss the arrow keys move the slides again.
    click('[data-pres-rescued-dismiss]', () => { if (!this.hideRescued()) this.player?.focus(); });
    click('[data-pres-link-dismiss]', () => { if (!this.hideLink()) this.player?.focus(); });
    // Opening the address needs this click on the page itself: the deck can
    // only ask, and the new tab gets neither an opener nor a referrer.
    this.q('[data-pres-link-open]').addEventListener('click', () => {
      const url = this.linkUrl;
      const moved = this.hideLink();
      if (url) window.open(url.href, '_blank', 'noopener,noreferrer');
      // As after Dismiss.
      if (!moved) this.player?.focus();
    }, { signal });
    // Opened notes make the stage shorter.
    this.q('[data-pres-notes]').addEventListener('toggle', () => this.startButtonInView(), { signal });
    for (const which of ['rescued', 'link'] as const) {
      const strip = this.q(`[data-pres-${which}]`);
      // A notice does not close while the pointer or the keyboard is in it,
      // so a teacher can read it; its time starts again once both have left.
      strip.addEventListener('pointerenter', () => { this.noticePointer.add(which); this.holdNotice(which); }, { signal });
      strip.addEventListener('pointerleave', () => { this.noticePointer.delete(which); this.releaseNotice(which); }, { signal });
      strip.addEventListener('focusin', () => this.holdNotice(which), { signal });
      strip.addEventListener('focusout', (event) => {
        const next = (event as FocusEvent).relatedTarget;
        if (!(next instanceof Node && strip.contains(next))) this.releaseNotice(which);
      }, { signal });
      // A click on its text, outside the buttons, leaves the keyboard with the slides.
      strip.addEventListener('click', (event) => {
        if (!(event.target instanceof Element && event.target.closest('button'))) this.player?.focus();
      }, { signal });
    }
    for (const button of this.querySelectorAll<HTMLButtonElement>('[data-pres-view]')) {
      button.addEventListener('click', () => this.setView(button.dataset.presView === 'source' ? 'source' : 'preview'), { signal });
    }
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
    dialog.addEventListener('close', () => {
      if (dialog.open || this.closed) return;
      // The last line of defence: a dialog that closed by itself (a close the
      // page could not refuse) while typing was not applied, or edits not
      // saved, opens again with everything as it was, and asks.
      if (this.mustConfirmLeaving()) { this.reopenAndAsk(); return; }
      this.afterClose();
    }, { signal });
    // Escape is handled on the keydown: Chromium does not let a page refuse a
    // second close request without a new click or key in between, so the
    // dialog's cancel event below cannot always keep it open. A prevented
    // Escape keydown starts no close request at all.
    dialog.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      if (this.isFullscreen()) { event.preventDefault(); this.exitFullscreen(); return; }
      // The code editor first gets the key for itself (to close its
      // suggestions); the listener below moves the keyboard out when it does not.
      if (this.inEditor()) return;
      if (this.mustConfirmLeaving()) {
        event.preventDefault();
        void Promise.resolve(this.leave(() => this.closeDialog())).catch((error) => this.notice(error));
      }
    }, { signal, capture: true });
    dialog.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || !this.inEditor()) return;
      event.preventDefault();
      this.focusOutOfEditor();
    }, { signal });
    // A fallback for a close request that did not come from a keydown here.
    dialog.addEventListener('cancel', (event) => {
      if (this.isFullscreen()) { event.preventDefault(); this.exitFullscreen(); return; }
      // Escape in the code editor only leaves the editor, as people press it
      // there out of habit: the keyboard moves to Apply changes, or to the file list.
      if (this.inEditor()) {
        event.preventDefault();
        this.focusOutOfEditor();
        return;
      }
      // Escape with changes not yet applied asks first, like Close does.
      if (this.mustConfirmLeaving()) {
        event.preventDefault();
        void Promise.resolve(this.leave(() => this.closeDialog())).catch((error) => this.notice(error));
      }
    }, { signal });
    dialog.addEventListener('keydown', (event) => {
      // The source editor handles its own keys; Ctrl+S there applies changes.
      if (event.defaultPrevented) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && this.active) {
        event.preventDefault();
        event.stopPropagation();
        void this.downloadArchive().catch((error) => this.notice(error));
      }
    }, { signal });
    window.addEventListener('beforeunload', (event) => {
      if (this.mustConfirmLeaving() || [...this.temporary.values()].some((record) => Object.keys(record.edits ?? {}).length)) event.preventDefault();
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

  /** True when the keyboard is in the code editor of Source files. */
  private inEditor(): boolean {
    return document.activeElement instanceof Element && !!document.activeElement.closest('[data-pres-code]');
  }

  /**
   * The dialog closed although leaving would lose changes: open it again as it
   * was (nothing was stopped or cleared), then ask as Close does. A question
   * already on screen is closed first, as Keep editing, so that the new one
   * lies above the dialog.
   */
  private reopenAndAsk(): void {
    const dialog = this.q<HTMLDialogElement>('[data-pres-dialog]');
    const confirm = this.q<HTMLDialogElement>('[data-pres-confirm]');
    const ask = () => { void Promise.resolve(this.leave(() => this.closeDialog())).catch((error) => this.notice(error)); };
    const asking = confirm.open;
    if (asking) confirm.close();
    dialog.showModal();
    // The earlier question answers "keep editing" when its close event
    // arrives; the new question is asked after that.
    if (asking) confirm.addEventListener('close', ask, { once: true });
    else ask();
  }

  /** Move the keyboard from the code editor to Apply changes when it can apply, else to the selected file. */
  private focusOutOfEditor(): void {
    const apply = this.querySelector<HTMLButtonElement>('[data-pres-apply]');
    const files = this.querySelector('[data-pres-files]');
    const target = apply && !apply.hidden && !apply.disabled ? apply
      : files?.querySelector<HTMLElement>('.presentation-file[aria-current="true"]') ?? files?.querySelector<HTMLElement>('.presentation-file');
    target?.focus();
  }

  disconnectedCallback(): void {
    this.nextOperation();
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
    this.nextOperation();
    this.busy = false;
    this.exitFullscreen();
    this.player?.destroy();
    this.player = undefined;
    this.active = undefined;
    this.runtime = [];
    this.sources?.clear();
    const confirm = this.q<HTMLDialogElement>('[data-pres-confirm]');
    if (confirm.open) confirm.close();
    this.restoreFocus();
    this.dispatchEvent(new CustomEvent('presentation-close', { bubbles: true }));
  }

  /**
   * Give the keyboard back to the control that opened the library. When that
   * control is gone or hidden (on a narrow screen, the sidebar that held it
   * has closed), the sidebar toggle takes it, or else the editor.
   */
  private restoreFocus(): void {
    const shown = (element: HTMLElement | null | undefined): element is HTMLElement => !!element && element.isConnected
      && (typeof element.checkVisibility === 'function' ? element.checkVisibility() : element.getClientRects().length > 0);
    const opener = this.returnFocus;
    this.returnFocus = undefined;
    if (shown(opener)) { opener.focus(); return; }
    const toggle = document.querySelector<HTMLElement>('[data-toggle-sidebar]');
    if (shown(toggle)) { toggle.focus(); return; }
    document.querySelector<HTMLElement>('.cm-editor .cm-content')?.focus();
  }

  /** Application messages only. Text supplied by a presentation goes to reportProblem. */
  private notice(value?: unknown): void {
    const area = this.q('[data-pres-notice]');
    // A part of the site that could not be fetched gets one fixed sentence, never the browser's text.
    const text = value === undefined ? '' : value instanceof Error || isLoadFailure(value) ? errorMessage(value, 'Something went wrong. Close the presentations and try again.') : String(value);
    // With its Reload button, so the next step is at hand.
    if (text === LOAD_FAILURE_TEXT) showLoadFailure(area);
    else area.textContent = text;
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
      // A part of the site that could not be loaded: the next step is one click away.
      if (problem.origin === 'player' && problem.text === LOAD_FAILURE_TEXT) line.append(' ', reloadButton());
      return line;
    });
    if (this.problems.hidden) {
      const more = document.createElement('p');
      more.textContent = `${this.problems.hidden} more message${this.problems.hidden === 1 ? ' was' : 's were'} not shown.`;
      lines.push(more);
    }
    area.replaceChildren(...lines);
    area.hidden = !lines.length;
    this.startButtonInView();
  }

  /** A problem box in the start panel can push Start presentation below the stage: scroll the panel to show it. */
  private startButtonInView(): void {
    const panel = this.q('[data-pres-start]');
    const below = this.q('[data-pres-start-button]').getBoundingClientRect().bottom - panel.getBoundingClientRect().bottom;
    if (!panel.hidden && below > 0) panel.scrollTop += below + 12;
  }

  /**
   * A warning or error from the running deck, kept for the check notes and the
   * report. `counted: false` marks the player's information (the speaker
   * view): listed, but neither counted as a problem nor put in the report.
   */
  private addRuntime(origin: PresentationMessageOrigin, message: string, counted = true, hostFromPresentation = false): void {
    const text = cleanReportedText(message);
    if (!text || this.runtime.filter((item) => item.origin === origin).length >= PresentationLibrary.runtimeLimit
      || this.runtime.some((item) => item.origin === origin && item.text === text)) return;
    // The report marks a sentence whose host name the presentation chose.
    this.runtime.push({ origin, text, ...(counted ? {} : { counted: false }), ...(hostFromPresentation ? { hostFromPresentation: true } : {}) });
    this.renderNotes();
  }

  /** Run-time problems of this playback: what the status line counts. */
  private runtimeProblems(): number {
    return this.runtime.filter((item) => item.counted !== false).length;
  }

  /**
   * After a new run-time entry: problems right after a start are most often
   * why the slides look wrong (an edit with a syntax error, a missing
   * library), so the first one opens the notes.
   */
  private runtimeAdded(problemsBefore: number): void {
    if (!problemsBefore && this.runtimeProblems() && Date.now() - this.playbackStarted < 5000) this.q<HTMLDetailsElement>('[data-pres-notes]').open = true;
    this.renderStatus();
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
      label.textContent = `${severityLabel(issue)}: `;
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
    this.nextOperation();
    this.busy = false;
    this.exitFullscreen();
    this.player?.destroy();
    this.player = undefined;
    this.active = undefined;
    this.runtime = [];
    this.sources?.clear();
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
      // The list could not be read: say why in its place, rather than
      // showing an empty library as if the presentations were gone.
      if (isLoadFailure(error)) { this.renderLoadFailure(); return; }
      this.notice(error);
    }
    this.renderLibrary();
  }

  /** In place of the saved list: a part of the site could not be loaded, with a Reload button. */
  private renderLoadFailure(): void {
    const list = this.q('[data-pres-list]');
    const box = document.createElement('div');
    box.className = 'presentation-load-failed';
    box.setAttribute('role', 'alert');
    const text = document.createElement('p');
    text.textContent = LOAD_FAILURE_TEXT;
    const reload = document.createElement('button');
    reload.type = 'button';
    reload.className = 'button-primary';
    reload.dataset.presReload = '';
    reload.textContent = 'Reload the page';
    reload.addEventListener('click', () => location.reload());
    box.append(text, reload);
    list.replaceChildren(box);
    list.removeAttribute('aria-busy');
    const count = this.q('[data-pres-count]');
    count.textContent = '';
    count.hidden = true;
  }

  private renderLibrary(): void {
    const list = this.q('[data-pres-list]');
    const imported = (time: number) => new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const all = [
      ...this.records.map((record) => ({
        id: record.id, title: record.title, file: record.fileName,
        detail: `${engineLabel(record.engine)} · ${bytesLabel(record.archiveSize)} · Imported ${imported(record.createdAt)}${record.edited ? ' · Edited' : ''}`,
      })),
      ...[...this.temporary].map(([id, deck]) => ({
        id, title: deck.title, file: deck.fileName,
        detail: `${engineLabel(deck.engine)} · ${bytesLabel(deck.archive.size)} · Not saved — keep your file${Object.keys(deck.edits ?? {}).length ? ' · Edited' : ''}`,
      })),
    ];
    // Rows with the same title also name their file, so they can be told apart.
    const titles = new Map<string, number>();
    for (const entry of all) titles.set(entry.title, (titles.get(entry.title) ?? 0) + 1);
    const entries = all.map((entry) => (titles.get(entry.title)! > 1 && entry.file
      ? { ...entry, detail: `${visiblePath(entry.file)} · ${entry.detail}` } : entry));
    const count = this.q('[data-pres-count]');
    count.textContent = String(entries.length);
    count.hidden = false;
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

  /**
   * Build-time services for deck-project: the bundled libraries, the Slidev
   * converter, the player's own checks, progress in the notice unless quiet,
   * and cancellation when the operation is superseded.
   */
  private buildDeps(operation: number, quiet = false): BuildDeps {
    return {
      vendor: async () => (await import('../lib/deck-vendor-browser')).browserVendorProvider(),
      // The converter, its Worker and esbuild.wasm load only when a Slidev build is opened.
      convertSlidev: async (files, detection, options) => {
        const limit = PresentationLibrary.slidevStartLimitMs;
        const began = Date.now();
        let timer = 0;
        let converter: typeof import('../lib/slidev-convert-browser');
        try {
          // A download that hangs (a slow or filtering network) ends with the same result as a converter that does not start.
          converter = await Promise.race([
            import('../lib/slidev-convert-browser'),
            new Promise<never>((_, reject) => {
              timer = window.setTimeout(() => reject(converterTooSlow(limit)), limit);
              options.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true });
            }),
          ]);
        } catch (error) { throw isLoadFailure(error) ? converterUnavailable() : error; }
        finally { window.clearTimeout(timer); }
        try {
          return await converter.convertSlidevBuild(files, detection, { ...options, startTimeLimit: Math.max(1, limit - (Date.now() - began)) });
        } catch (error) {
          // Its own "not ready after N seconds" counts the time left; say the whole limit.
          const failure = error as { name?: unknown; detail?: unknown } | null;
          if (failure?.name === 'SlidevConverterUnavailableError' && typeof failure.detail === 'string' && failure.detail.startsWith('not ready after')) throw converterTooSlow(limit);
          throw error;
        }
      },
      signal: operation === this.operation ? this.operationAbort.signal : AbortSignal.abort(),
      // The real preparation, discarded: a document the player would refuse is reported before saving.
      prepare: (html, profile) => { preparePresentationDocument(html, randomHex(18), randomHex(18), { profile }); },
      ...(quiet ? {} : {
        onProgress: (message: string) => {
          if (operation !== this.operation) return;
          this.notice(message);
          // While a file opens, the stage shows its progress too.
          if (!this.active) this.q('[data-pres-start-message]').textContent = message;
        },
      }),
    };
  }

  private async openSaved(id: string): Promise<void> {
    if (this.busy) { this.notice('A presentation is opening. Please wait a moment.'); return; }
    this.busy = true;
    const operation = this.nextOperation();
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
      await this.openRecord(record, operation, saved, saved ? undefined : id);
    } finally { if (operation === this.operation) this.busy = false; }
  }

  private async openRecord(record: LibraryRecord, operation: number, saved: boolean, temporaryKey?: string): Promise<void> {
    this.showOpening(record.title, 'Opening the presentation…');
    const opened = await this.whileOpening(operation, async () => {
      const deckProject = await import('../lib/deck-project');
      const project = await deckProject.openStoredDeck(record);
      if (operation !== this.operation) return undefined;
      return { project, playable: await deckProject.buildPlayable(project, this.buildDeps(operation)) };
    });
    if (!opened || operation !== this.operation) return;
    const { project, playable } = opened;
    this.showDeck(project, playable, saved ? 'saved' : 'unsaved', temporaryKey);
    if (saved && this.active?.project === project && record.updatedAt !== undefined) this.active.savedAt = record.updatedAt;
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
    // A file dropped on the open presentation would replace it: ask first, as Close does.
    if (this.mustConfirmLeaving() && !(await this.confirmLeaving())) return true;
    if (this.busy) throw new Error('A presentation is already opening. Please wait a moment.');
    this.busy = true;
    const operation = this.nextOperation();
    try {
      // Chosen from the open library: say at once that the file is being read.
      if (this.q<HTMLDialogElement>('[data-pres-dialog]').open) this.notice(`Opening ${visiblePath(file.name).slice(0, 120)}…`);
      const deckProject = await import('../lib/deck-project');
      const project = await deckProject.openDeck(file);
      if (!project) return false;
      if (operation !== this.operation) return true;
      // From here on the dialog shows this file, never the presentation shown before.
      this.showOpening(project.title, 'Checking the presentation…');
      const playable = await this.whileOpening(operation, () => deckProject.buildPlayable(project, this.buildDeps(operation)));
      if (!playable || operation !== this.operation) return true;
      const input = deckProject.deckSaveInput(project);
      if (!deckProject.isPlayable(playable)) {
        // A copy in the library may play thanks to edits made here: open it
        // rather than the file that cannot play.
        const saved = input ? await this.findSaved(input.archive) : undefined;
        if (operation !== this.operation) return true;
        if (saved) {
          await this.openRecordById(saved.id, operation);
          if (operation === this.operation) {
            this.notice(saved.edited ? 'This presentation is already in your library, with your edits, so it opened from there.'
              : 'This presentation is already in your library, so it opened from there.');
          }
          return true;
        }
        this.showDeck(project, playable, 'new');
        this.storage(siteSideFailure(playable) ? 'Not saved. Open the file again once the page has been reloaded.'
          : 'Not saved. This file cannot be played here yet; see the notes from the check.');
        return true;
      }
      this.showDeck(project, playable, 'new');
      if (!input) return true;
      this.storage('Saving this presentation in your browser…');
      let edited: string | undefined;
      try {
        const { saveDeck } = await import('../lib/presentation-store');
        const { info, existing } = await saveDeck(input);
        this.records = [info, ...this.records.filter((entry) => entry.id !== info.id)];
        if (operation !== this.operation) return true;
        project.id = info.id;
        if (this.active?.project === project) this.active.savedAt = info.updatedAt;
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
        const key = `temporary-${crypto.randomUUID()}`;
        this.temporary.set(key, {
          title: input.title, kind: input.kind, engine: input.engine, archive: input.archive, fileName: input.fileName,
          ...(input.entry ? { entry: input.entry } : {}), ...(input.source ? { source: input.source } : {}),
          ...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}),
        });
        if (operation === this.operation && this.active?.project === project) this.active.temporaryKey = key;
        if (operation === this.operation) {
          this.storage('Not saved in this browser. Download ZIP to keep a copy.');
          this.notice(`${errorMessage(error, 'This presentation could not be saved in this browser.')}${evicted ? ' Older unsaved presentations can be reopened from their original files.' : ''}`);
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

  /** The saved record with the same original bytes, if storage can be read. */
  private async findSaved(archive: Blob): Promise<StoredPresentationInfo | undefined> {
    try {
      const { findSavedDeck } = await import('../lib/presentation-store');
      return await findSavedDeck(archive);
    } catch { return undefined; }
  }

  private async openRecordById(id: string, operation: number): Promise<void> {
    const { getPresentation } = await import('../lib/presentation-store');
    const stored = await getPresentation(id);
    if (stored && operation === this.operation) await this.openRecord(stored, operation, true);
  }

  /**
   * A file starts opening: the dialog shows its name and progress, and
   * nothing of the presentation shown before (no Start, no old problem, no
   * old storage line) until the new result arrives.
   */
  private showOpening(title: string, progress: string): void {
    this.exitFullscreen();
    this.player?.destroy();
    this.player = undefined;
    this.replayPending = false;
    this.active = undefined;
    this.runtime = [];
    this.slides = undefined;
    this.sources?.clear();
    this.openDialog();
    this.notice(progress);
    this.clearProblems();
    this.clearPlaybackNotices();
    this.renderSlides();
    this.q('[data-pres-title]').textContent = title;
    this.q('[data-pres-subtitle]').textContent = 'Opening…';
    this.q('[data-pres-engine]').hidden = true;
    this.q('[data-pres-start-title]').textContent = title;
    this.q('[data-pres-start-message]').textContent = progress;
    this.q('[data-pres-start-detail]').textContent = '';
    this.q('[data-pres-start-button]').hidden = true;
    for (const selector of ['[data-pres-present]', '[data-pres-html]', '[data-pres-zip]', '[data-pres-view="source"]']) this.q<HTMLButtonElement>(selector).disabled = true;
    this.q('[data-pres-zip-original]').hidden = true;
    this.q('[data-pres-keyboard-hint]').hidden = true;
    this.q('[data-pres-start]').hidden = false;
    this.q('[data-pres-stop]').hidden = true;
    this.q('[data-pres-restart]').hidden = true;
    this.q('[data-pres-player-status]').textContent = 'Opening…';
    this.q('[data-pres-notes]').hidden = true;
    this.q('[data-pres-report-text]').hidden = true;
    this.storage('Opening the file…');
    this.q('[data-pres-library]').hidden = true;
    this.q('[data-pres-deck]').hidden = false;
    this.q('[data-pres-back]').hidden = false;
    this.setView('preview');
  }

  /**
   * Run the slow part of opening a file. When it fails, the stage says so in
   * place of the progress (and the error goes on to the notice), so nothing
   * of the presentation shown before comes back.
   */
  private async whileOpening<T>(operation: number, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (operation === this.operation && !this.active) {
        this.q('[data-pres-start-message]').textContent = 'This file could not be opened.';
        const detail = this.q('[data-pres-start-detail]');
        if (isLoadFailure(error)) showLoadFailure(detail);
        else detail.textContent = errorMessage(error, 'Close the presentations and open the file again.');
        this.q('[data-pres-player-status]').textContent = 'Could not be opened';
        this.storage('Not saved. Your original file is unchanged.');
      }
      throw error;
    }
  }

  private showDeck(project: DeckProject, playable: PlayableDeck, state: 'new' | 'saved' | 'unsaved', temporaryKey?: string): void {
    this.exitFullscreen();
    this.player?.destroy();
    this.player = undefined;
    this.replayPending = false;
    this.active = { project, playable, ...(temporaryKey ? { temporaryKey } : {}) };
    this.openDialog();
    this.notice();
    this.clearProblems();
    this.runtime = [];
    this.slides = undefined;
    this.renderSlides();
    this.sources?.clear();
    const engine = engineLabel(project.engine);
    this.q('[data-pres-title]').textContent = project.title;
    this.q('[data-pres-engine]').textContent = engine;
    this.q('[data-pres-engine]').hidden = false;
    this.q<HTMLButtonElement>('[data-pres-zip]').disabled = false;
    this.q<HTMLButtonElement>('[data-pres-view="source"]').disabled = false;
    this.q('[data-pres-start-title]').textContent = project.title;
    this.q('[data-pres-stage]').style.setProperty('--presentation-aspect', project.aspectRatio === '4:3' ? '4 / 3' : '16 / 9');
    this.storage(state === 'saved' ? (project.edits.size ? 'Saved in this browser with your edits. Your original file is unchanged.' : 'Saved in this browser. Keep the original file as your backup.')
      : state === 'unsaved' ? 'Not saved in this browser. Download ZIP to keep a copy.'
        : 'Local presentation. Your original file is unchanged.');
    this.q('[data-pres-library]').hidden = true;
    this.q('[data-pres-deck]').hidden = false;
    this.q('[data-pres-back]').hidden = false;
    this.renderEditState();
    this.setView('preview');
    // Each deck starts with its notes folded (errors unfold them) and no old report.
    this.q<HTMLDetailsElement>('[data-pres-notes]').open = false;
    this.q('[data-pres-report-text]').hidden = true;
    this.renderNotes();
    this.renderPlayback();
  }

  /** The deck's size and edited state in the heading, and the downloads that depend on it. */
  private renderEditState(): void {
    const project = this.active?.project;
    if (!project) return;
    const edited = project.edits.size > 0;
    const count = project.sources.length;
    this.q('[data-pres-subtitle]').textContent = `${engineLabel(project.engine)} · ${count} ${count === 1 ? 'file' : 'files'} · ${bytesLabel(project.original.size)}${edited ? ' · Edited' : ''}`;
    this.q('[data-pres-zip-original]').hidden = !edited;
    this.q('[data-pres-zip]').title = edited ? 'Download the presentation with your edits as a ZIP' : 'Download the original files as a ZIP';
  }

  /**
   * The stage, controls and player for the active deck's current build. A
   * player that already exists keeps playing; callers update its HTML.
   */
  private renderPlayback(): void {
    const active = this.active;
    if (!active) return;
    const { project, playable } = active;
    const ready = canPlay(playable);
    // A problem on this site's side (the converter could not load) is no fault of the presentation.
    const siteSide = !ready && siteSideFailure(playable);
    this.q('[data-pres-start-message]').textContent = ready
      ? 'Slides and demonstrations run locally when you press Start.'
      : siteSide ? 'This presentation could not be opened this time.' : 'This presentation cannot be played here yet.';
    this.q('[data-pres-start-detail]').textContent = siteSide ? 'The presentation itself may be fine: the message above says what to do.'
      : !ready ? 'The notes from the check below say what to change.'
      : project.kind === 'qft-presentation' ? (project.source ? 'Editable source included in the ZIP' : 'Built presentation · source not included')
        : 'Prepared to play offline in this browser';
    this.q<HTMLButtonElement>('[data-pres-start-button]').hidden = !ready;
    this.q<HTMLButtonElement>('[data-pres-present]').disabled = !ready;
    this.q<HTMLButtonElement>('[data-pres-html]').disabled = !ready;
    this.q('[data-pres-keyboard-hint]').hidden = !ready;
    // When the site could not load its converter there is nothing for an AI assistant to change.
    this.q('[data-pres-report]').hidden = siteSide;
    this.q('[data-pres-report-hint]').textContent = siteSide ? 'Nothing to send to your AI assistant: reload the page and open the ZIP again.'
      : 'Paste the report into the AI assistant that made the presentation.';
    if (!ready) {
      this.player?.destroy();
      this.player = undefined;
      this.replayPending = false;
      this.clearProblems();
      for (const issue of playable.issues) if (issue.severity === 'error') this.reportProblem('player', issue.message);
      this.q('[data-pres-start]').hidden = false;
      this.q('[data-pres-stop]').hidden = true;
      this.q('[data-pres-restart]').hidden = true;
      this.q('[data-pres-player-status]').textContent = siteSide ? 'Could not be opened this time' : 'Cannot be played here yet';
      return;
    }
    if (this.player) return;
    this.playerState = 'stopped';
    this.player = createPresentationPlayer(this.q('[data-pres-host]'), playable.html, {
      title: project.title,
      sandboxUrl: this.dataset.sandboxUrl!,
      profile: playable.profile,
      // The start-up rescue is only for presentations detected as Reveal.js.
      ...(project.engine === 'reveal' ? { startCheck: 'reveal' as const } : {}),
      onState: (state) => {
        this.playerState = state;
        // Each start (Start, Restart, a replay after edits) begins without
        // the last playback's start-up problem or link.
        if (state === 'loading' || state === 'stopped') this.clearPlaybackNotices();
        if (state === 'loading') this.playbackStarted = Date.now();
        this.q('[data-pres-start]').hidden = state === 'loading' || state === 'ready';
        this.q('[data-pres-stop]').hidden = state !== 'loading' && state !== 'ready';
        this.q('[data-pres-restart]').hidden = state === 'stopped';
        this.renderStatus();
      },
      onError: (message, origin) => { this.reportProblem(origin, message); this.addRuntime(origin, message); },
      onWarning: (message) => {
        const before = this.runtimeProblems();
        this.addRuntime('presentation', message);
        this.runtimeAdded(before);
      },
      // What the player could not do, in its own words (no "reported" label).
      // Information such as the speaker view is listed, not counted.
      onLimit: (limit) => {
        const before = this.runtimeProblems();
        this.addRuntime('player', limit.text, limit.counted, !!limit.host);
        this.runtimeAdded(before);
      },
      onStalled: (detail, firstError) => this.showStall(detail, firstError),
      onLeft: (left) => this.presentationLeft(left),
      onLink: (url) => this.showLink(url),
      onPosition: () => { this.hideLink(); this.startedLate(); },
      onSlides: (slides) => { this.slides = slides; this.renderSlides(); this.startedLate(); },
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

  /** The line under the stage: the player's state, and whether the deck reported problems. */
  private renderStatus(): void {
    const state = this.playerState;
    let text = ({ stopped: 'Ready to start', loading: 'Opening presentation…', ready: 'Playing locally', error: 'Playback needs attention' })[state];
    const problems = this.runtimeProblems();
    if (state === 'ready' && this.stall === 'blank') text = 'The slides did not start';
    else if (state === 'ready') {
      // The basic-settings notice closes itself; this line keeps saying it.
      if (this.stall === 'rescued') text = 'Playing with basic settings';
      if (problems) text += ` · ${problems === 1 ? '1 problem' : `${problems} problems`} reported`;
    }
    this.q('[data-pres-player-status]').textContent = text;
  }

  /**
   * A Reveal.js deck stopped during start-up. 'blank': a problem on the
   * stage, over the empty slides, with the deck's first error as its own
   * words; the frame stays, in case the deck starts late. 'rescued': a notice
   * over the top of the slides, which the player started with basic settings.
   */
  private showStall(detail: PresentationStall, firstError: string | undefined): void {
    if (detail === 'recovered') {
      // The deck started Reveal.js itself after all, with its own settings.
      if (this.stall !== 'rescued') return;
      this.stall = undefined;
      this.hideRescued();
      this.renderStatus();
      return;
    }
    this.stall = detail;
    if (detail === 'rescued') {
      this.q('[data-pres-rescued-text]').textContent = STALL_RESCUED_TEXT;
      this.rescuedNotice = true;
      this.armNotice('rescued');
      this.renderNoticeArea();
    } else {
      const lines: HTMLElement[] = [];
      const intro = document.createElement('p');
      intro.textContent = STALL_BLANK_TEXT;
      lines.push(intro);
      const text = cleanReportedText(firstError);
      if (text) {
        const line = document.createElement('p');
        const label = document.createElement('strong');
        label.textContent = 'The presentation reported: ';
        const quote = document.createElement('q');
        quote.textContent = text;
        line.append(label, quote);
        lines.push(line);
      }
      const next = document.createElement('p');
      next.textContent = STALL_BLANK_NEXT;
      lines.push(next);
      const area = this.q('[data-pres-stalled]');
      area.replaceChildren(...lines);
      area.hidden = false;
    }
    if (this.runtimeProblems()) this.q<HTMLDetailsElement>('[data-pres-notes]').open = true;
    this.renderStatus();
  }

  /** A deck reported as not started has sent a slide position or count after all. */
  private startedLate(): void {
    if (this.stall !== 'blank') return;
    this.stall = undefined;
    this.q('[data-pres-stalled]').hidden = true;
    this.renderStatus();
  }

  /**
   * The deck's link to a website, offered on the page: the host name in bold
   * as the URL parser gives it, the rest shortened (and decoded when that is
   * safe), as text only. A new link replaces it; a slide change, Stop,
   * Restart or 20 seconds remove it. While it shows, it takes the place of
   * the basic-settings notice: one notice at a time over the slides.
   */
  private showLink(url: URL): void {
    if (!this.player?.isRunning()) return;
    const { host, rest, shortened } = linkParts(url);
    const text = this.q('[data-pres-link-text]');
    const strong = document.createElement('strong');
    strong.textContent = host;
    // A shortened address ends in "…": no full stop after it.
    text.replaceChildren('The presentation links to ', strong, ...(rest ? [rest] : []), ...(shortened ? [] : ['.']));
    this.linkUrl = url;
    this.armNotice('link');
    this.renderNoticeArea();
  }

  /** Returns true when the keyboard was in the notice and went back to the slides. */
  private hideLink(): boolean {
    this.holdNotice('link');
    this.linkUrl = undefined;
    return this.renderNoticeArea();
  }

  /** Returns true when the keyboard was in the notice and went back to the slides. */
  private hideRescued(): boolean {
    this.holdNotice('rescued');
    this.rescuedNotice = false;
    return this.renderNoticeArea();
  }

  /** True while the notice is due to show. */
  private noticeDue(which: StageNotice): boolean {
    return which === 'link' ? this.linkUrl !== undefined : this.rescuedNotice;
  }

  /** True while the pointer or the keyboard is in the notice. */
  private noticeHeld(which: StageNotice): boolean {
    return this.noticePointer.has(which) || this.q(`[data-pres-${which}]`).contains(document.activeElement);
  }

  /** Start the notice's time again from the beginning, unless the pointer or the keyboard is in it. */
  private armNotice(which: StageNotice): void {
    this.holdNotice(which);
    if (this.noticeHeld(which)) return;
    this.noticeTimers[which] = window.setTimeout(() => { if (which === 'link') this.hideLink(); else this.hideRescued(); },
      which === 'link' ? PresentationLibrary.linkNoticeMs : PresentationLibrary.rescuedNoticeMs);
  }

  /** Stop the notice's timer. */
  private holdNotice(which: StageNotice): void {
    const timer = this.noticeTimers[which];
    if (timer !== undefined) window.clearTimeout(timer);
    delete this.noticeTimers[which];
  }

  /** The pointer or the keyboard left the notice: its time starts again once both have left. */
  private releaseNotice(which: StageNotice): void {
    if (this.noticeDue(which) && this.noticeTimers[which] === undefined) this.armNotice(which);
  }

  /**
   * The notice area over the top of the slides shows one notice: the link's,
   * else the basic-settings one. When a notice that holds the keyboard goes,
   * the keyboard goes back to the slides, as after Dismiss; returns true then.
   */
  private renderNoticeArea(): boolean {
    const strips = { link: this.q('[data-pres-link]'), rescued: this.q('[data-pres-rescued]') };
    const focused = () => Object.values(strips).some((strip) => !strip.hidden && strip.contains(document.activeElement));
    const hadFocus = focused();
    strips.link.hidden = this.linkUrl === undefined;
    strips.rescued.hidden = this.linkUrl !== undefined || !this.rescuedNotice;
    // A hidden notice is not under the pointer; one that is still due gets its time again.
    for (const which of ['link', 'rescued'] as const) if (strips[which].hidden && this.noticePointer.delete(which)) this.releaseNotice(which);
    if (!hadFocus || focused()) return false;
    this.player?.focus();
    return true;
  }

  /** What belongs to one playback on the stage: the start-up problem and the notices over the slides. */
  private clearPlaybackNotices(): void {
    this.stall = undefined;
    this.q('[data-pres-stalled]').hidden = true;
    this.hideRescued();
    this.hideLink();
  }

  private setView(view: 'preview' | 'source'): void {
    this.q('[data-pres-preview]').hidden = view !== 'preview';
    this.q('[data-pres-source]').hidden = view !== 'source';
    for (const button of this.querySelectorAll('[data-pres-view]')) {
      button.setAttribute('aria-pressed', String((button as HTMLElement).dataset.presView === view));
    }
    if (view === 'source') void this.openSources().catch((error) => this.notice(error));
    else if (this.replayPending) this.replay();
  }

  /** Restart the deck with its newest build, on the slide and fragment it shows. */
  private replay(): void {
    this.replayPending = false;
    const active = this.active;
    if (!this.player || !active || !canPlay(active.playable)) return;
    this.clearProblems();
    this.clearRuntime();
    this.player.update(active.playable.html, { position: this.player.currentPosition() });
  }

  /** Load the Source files view and its editor on first use, then show the active deck's files. */
  private async openSources(): Promise<void> {
    const active = this.active;
    if (!active) return;
    if (!this.sourcesLoading) {
      this.sourcesLoading = import('./deck-sources').then(({ DeckSourceView }) => {
        this.sources = new DeckSourceView(this.q('[data-pres-source]'), {
          applyEdits: (edits, options) => this.applyEdits(edits, options),
          confirm: (request) => this.confirmAction(request),
        }, this.abort.signal);
        return this.sources;
      });
      this.sourcesLoading.catch((error) => {
        this.sourcesLoading = undefined;
        // In place of "Opening the files…", which would otherwise stay.
        if (isLoadFailure(error)) {
          showLoadFailure(this.q('[data-pres-file-message]'));
          this.q('[data-pres-file-message]').hidden = false;
        } else this.q('[data-pres-file-message]').textContent = 'The files could not be opened. Reload the page and try again.';
      });
    }
    const view = await this.sourcesLoading;
    if (this.active === active) await view.show(active.project);
  }

  /**
   * Rebuild the active deck with a new edit overlay. A build with an error
   * changes nothing unless forced (restoring the original), so the last
   * version that worked keeps playing. Otherwise the player replays the new
   * build on the same slide and fragment, and the overlay is saved beside
   * the untouched original.
   */
  private async applyEdits(edits: Map<string, string>, options: { force?: boolean } = {}): Promise<DeckApplyOutcome> {
    const active = this.active;
    if (!active) return { applied: false, problems: ['Open the presentation again, then apply your changes.'] };
    const operation = this.operation;
    const deckProject = await import('../lib/deck-project');
    const playable = await deckProject.buildPlayable({ ...active.project, edits }, this.buildDeps(operation, true));
    if (active !== this.active || operation !== this.operation) return { applied: false };
    const ready = deckProject.isPlayable(playable);
    if (!ready && !options.force) {
      return { applied: false, problems: playable.issues.filter((issue) => issue.severity === 'error').map((issue) => issue.message) };
    }
    active.project.edits = edits;
    active.playable = playable;
    this.notice();
    let replay: DeckApplyOutcome['replay'];
    if (ready && this.player && this.playerState !== 'stopped') {
      if (this.q('[data-pres-preview]').hidden) { this.replayPending = true; replay = 'on-return'; }
      else { this.replay(); replay = 'now'; }
    } else if (ready && this.player) {
      // Not started: the next Start plays the new build.
      this.player.update(playable.html);
      replay = 'on-start';
    } else {
      this.renderPlayback();
      if (ready) replay = 'on-start';
    }
    this.renderEditState();
    this.renderNotes();
    const { storage, problem } = await this.persistEdits(active);
    return { applied: true, ...(replay ? { replay } : {}), storage, ...(problem ? { storageProblem: problem } : {}) };
  }

  /**
   * Keep the active deck's overlay where the deck is kept. Says where, and
   * why not when it could not be saved. A saved overlay is only replaced when
   * the stored record is still the one this deck's edits are based on, so
   * edits saved in another tab or window are never overwritten silently.
   */
  private async persistEdits(active: ActiveDeck): Promise<EditStorage> {
    const { project } = active;
    const edits = new Map(project.edits);
    const shown = (text: string) => { if (active === this.active) this.storage(text); };
    try {
      if (!project.id && active.temporaryKey) {
        const record = this.temporary.get(active.temporaryKey);
        if (record) {
          if (edits.size) record.edits = Object.fromEntries(edits);
          else delete record.edits;
        }
        return { storage: 'This presentation is not saved in this browser, so download the ZIP to keep your edits.' };
      }
      const store = await import('../lib/presentation-store');
      if (!project.id) {
        // A deck that could not play when it was opened is saved once it can.
        if (!canPlay(active.playable)) return { storage: '' };
        const { deckSaveInput } = await import('../lib/deck-project');
        const input = deckSaveInput(project);
        if (!input) return { storage: '' };
        const { info, existing } = await store.saveDeck(input);
        if (!existing) {
          project.id = info.id;
          active.savedAt = info.updatedAt;
          this.records = [info, ...this.records.filter((entry) => entry.id !== info.id)];
          active.editsUnsaved = false;
          shown('Saved in this browser with your edits. Your original file is unchanged.');
          return { storage: 'The presentation is now saved in this browser, with your edits.' };
        }
        // Saved meanwhile, elsewhere: its own edits are never replaced from here.
        if (info.edited) throw new store.PresentationStorageError(store.EDITS_CHANGED_ELSEWHERE_TEXT);
        project.id = info.id;
        active.savedAt = info.updatedAt;
      }
      const info = await store.updateDeckEdits(project.id!, edits, active.savedAt !== undefined ? { basedOn: active.savedAt } : {});
      active.savedAt = info.updatedAt;
      this.records = [info, ...this.records.filter((entry) => entry.id !== info.id)];
      active.editsUnsaved = false;
      shown(edits.size ? 'Saved in this browser with your edits. Your original file is unchanged.' : 'Saved in this browser. Keep the original file as your backup.');
      return { storage: edits.size ? 'Your edits are saved in this browser.' : 'The copy saved in this browser is the original again.' };
    } catch (error) {
      active.editsUnsaved = edits.size > 0;
      shown('Your edits are not saved in this browser. Download ZIP to keep them.');
      return {
        storage: 'Your edits play here until you close the presentation; download the ZIP to keep them.',
        problem: errorMessage(error, 'Your edits could not be saved in this browser.'),
      };
    }
  }

  /** True when leaving the deck now would lose changes: not applied yet, or applied but not saved. */
  private mustConfirmLeaving(): boolean {
    return !!this.active && (!!this.active.editsUnsaved || !!this.sources?.hasPendingChanges());
  }

  /** Run an action that leaves the deck, asking first when that would lose changes. */
  private leave(action: () => void | Promise<void>): void | Promise<void> {
    if (!this.mustConfirmLeaving()) return action();
    return this.confirmLeaving().then((confirmed) => { if (confirmed) return action(); });
  }

  /** Ask whether to leave the deck and lose its changes; resolves true for Discard changes. */
  private confirmLeaving(): Promise<boolean> {
    const pending = this.sources?.pendingPaths().length ?? 0;
    return this.confirmAction({
      title: 'Leave without your changes?',
      message: pending
        ? `Your changes to ${pending === 1 ? '1 file have' : `${pending} files have`} not been applied. If you leave now, they are discarded.`
        : 'Your edits could not be saved in this browser. If you leave now, they are lost. Download the ZIP first to keep them.',
      confirm: 'Discard changes',
      cancel: 'Keep editing',
    });
  }

  /** Ask in a small dialog over the library; resolves true when the person confirms. Escape keeps things as they are. */
  private confirmAction(request: DeckConfirmRequest): Promise<boolean> {
    const dialog = this.q<HTMLDialogElement>('[data-pres-confirm]');
    if (dialog.open) return Promise.resolve(false);
    this.q('[data-pres-confirm-title]').textContent = request.title;
    this.q('[data-pres-confirm-message]').textContent = request.message;
    this.q('[data-pres-confirm-accept]').textContent = request.confirm;
    this.q('[data-pres-confirm-cancel]').textContent = request.cancel;
    dialog.returnValue = '';
    return new Promise((resolve) => {
      dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true });
      dialog.showModal();
    });
  }

  /** A compact plain-text report of the check and of this playback, for the AI that made the deck. */
  private async copyReport(): Promise<void> {
    const active = this.active;
    if (!active) return;
    const { project, playable } = active;
    // A presentation opened as one HTML file is kept as index.html; the report names the file as it was opened.
    const { originalDownload } = await import('../lib/deck-project');
    const original = await originalDownload(project);
    if (active !== this.active) return;
    const singleFile = /\.html$/i.test(original.name) ? original.name : undefined;
    // `stalled` sets the report's result line ('does not start' or 'starts with basic settings').
    const input: DeckReportInput = {
      kind: project.kind, engine: project.engine, edited: project.edits.size > 0,
      ...(project.detection.engineVersion ? { engineVersion: project.detection.engineVersion } : {}),
      ...(project.entry ? { entry: project.entry } : {}),
      ...(singleFile ? { singleFile } : {}),
      ...(this.slides !== undefined ? { slides: this.slides } : {}),
      ...(this.stall ? { stalled: this.stall } : {}),
      issues: playable.issues, runtime: this.runtime,
    };
    const report = formatDeckReport(input);
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
    this.leftRestarts = 0;
    this.player?.start();
  }

  /**
   * The presentation replaced its slides with a page at another address, and
   * the player blocked that page. Right after the person's own action (a
   * button that goes to a website) it plays again on the same slide, a few
   * times per Start; otherwise it stops. Either way the player says so in its
   * own words, which count as a problem for the report.
   */
  private presentationLeft(left: PresentationLeft): void {
    const player = this.player;
    const active = this.active;
    if (!player || !active) return;
    if (left.active && this.leftRestarts < PresentationLibrary.leftRestartLimit) {
      this.leftRestarts += 1;
      const position = player.currentPosition();
      player.update(active.playable.html, position ? { position } : {});
      this.addRuntime('player', leftText(left.host, `which the player cannot do. ${position ? 'It was started again at the same slide.' : 'It was started again from the beginning.'}`), true, !!left.host);
    } else {
      player.stop();
      const text = leftText(left.host, 'so the player stopped it. Choose Start presentation to play it again.');
      this.reportProblem('player', text);
      this.addRuntime('player', text, true, !!left.host);
    }
    // Not a fresh start: the notes stay as the person left them.
    this.renderStatus();
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

  /** The deck as it plays now: the original upload, or with edits its current files under their original names. */
  private async downloadArchive(): Promise<void> {
    const project = this.active?.project;
    if (!project) return;
    const name = project.fileName || `${fileName(project.title)}.zip`;
    if (!project.edits.size) { download(project.original, name); return; }
    const { deckArchive } = await import('../lib/deck-project');
    download(deckArchive(project), name);
    if (this.sources?.hasPendingChanges()) this.notice('The ZIP has the changes you applied. Changes that are not applied yet are not in it.');
  }

  /** The upload exactly as it was imported, offered beside the edited ZIP. */
  private async downloadOriginal(): Promise<void> {
    const project = this.active?.project;
    if (!project) return;
    if (!project.edits.size) { download(project.original, project.fileName || `${fileName(project.title)}.zip`); return; }
    // A presentation imported as one HTML file comes back as that file.
    const { originalDownload } = await import('../lib/deck-project');
    const original = await originalDownload(project);
    download(original.blob, original.name);
  }

  private async downloadHtml(): Promise<void> {
    const active = this.active;
    if (!active) return;
    if (!canPlay(active.playable)) { this.notice('This presentation cannot be played here yet, so there is no standalone copy to download.'); return; }
    // The licence texts load only when a copy is downloaded.
    const { noticesForExport } = await import('../lib/presentation-notice-texts');
    if (this.active !== active) return;
    const notices = noticesForExport(active.playable.html, active.project.kind);
    const html = exportPresentationHtml(active.playable.html, active.project.title, {
      profile: active.playable.profile, notices, ...(active.project.engine === 'reveal' ? { startCheck: 'reveal' as const } : {}),
    });
    download(new Blob([html], { type: 'text/html;charset=utf-8' }), `${fileName(active.project.title)}.html`);
    this.notice('Standalone player downloaded. Open it offline and choose Start to run the slides.');
  }

  async openExample(): Promise<void> {
    if (this.busy) return;
    this.openDialog();
    this.notice('Opening the interactive Slidev example…');
    const operation = this.nextOperation();
    const response = await fetch(this.dataset.exampleUrl!, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error('The example could not be downloaded. Try again when the website is available.');
    const archive = await response.blob();
    if (operation !== this.operation) return;
    await this.tryOpenFile(new File([archive], 'quantum-interference-slidev.zip', { type: 'application/zip' }));
  }
}

if (!customElements.get('qft-presentation-library')) customElements.define('qft-presentation-library', PresentationLibrary);
