import type { PresentationPackage } from '../lib/presentation-package';
import type { StoredPresentationInfo } from '../lib/presentation-store';
import { createPresentationPlayer, exportPresentationHtml, type PresentationPlayer } from '../lib/presentation-runtime';

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

export class PresentationLibrary extends HTMLElement {
  private abort = new AbortController();
  private initialized = false;
  private player?: PresentationPlayer;
  private active?: PresentationPackage;
  private records: StoredPresentationInfo[] = [];
  private temporary = new Map<string, Pick<PresentationPackage, 'archive' | 'fileName' | 'manifest'>>();
  private operation = 0;
  private busy = false;
  private returnFocus?: HTMLElement;

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
    click('[data-pres-close]', () => this.q<HTMLDialogElement>('[data-pres-dialog]').close());
    click('[data-pres-back]', () => this.openLibrary());
    click('[data-pres-example]', () => this.openExample());
    click('[data-pres-start-button]', () => this.start());
    // Fullscreen requests must remain directly inside the user gesture.
    this.q('[data-pres-present]').addEventListener('click', () => this.present(), { signal });
    click('[data-pres-stop]', () => this.player?.stop());
    click('[data-pres-restart]', () => this.player?.restart());
    click('[data-pres-zip]', () => this.downloadArchive());
    click('[data-pres-html]', () => this.downloadHtml());
    click('[data-pres-copy]', () => this.copySource());
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
        if (!handled) this.notice('This is a Markdown lesson ZIP. Close this panel and use Open file in the workspace to edit it.');
      }).catch((error) => this.notice(error));
    }, { signal });
    const dialog = this.q<HTMLDialogElement>('[data-pres-dialog]');
    dialog.addEventListener('close', () => {
      this.operation += 1;
      this.busy = false;
      this.exitFullscreen();
      this.player?.destroy();
      this.player = undefined;
      this.active = undefined;
      this.returnFocus?.focus();
      this.dispatchEvent(new CustomEvent('presentation-close', { bubbles: true }));
    }, { signal });
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
    this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    this.dispatchEvent(new CustomEvent('presentation-open', { bubbles: true }));
    dialog.showModal();
  }

  private notice(value?: unknown): void {
    const area = this.q('[data-pres-notice]');
    area.textContent = value === undefined ? '' : value instanceof Error ? value.message : String(value);
    area.hidden = value === undefined;
  }

  async openLibrary(): Promise<void> {
    this.operation += 1;
    this.busy = false;
    this.exitFullscreen();
    this.player?.destroy();
    this.player = undefined;
    this.active = undefined;
    this.openDialog();
    this.q('[data-pres-title]').textContent = 'Slidev presentations';
    this.q('[data-pres-subtitle]').textContent = 'Interactive lessons. Ready for the classroom.';
    this.q('[data-pres-library]').hidden = false;
    this.q('[data-pres-deck]').hidden = true;
    this.q('[data-pres-back]').hidden = true;
    this.q('[data-pres-storage]').textContent = 'No uploads. Playback has no external connections.';
    this.notice();
    await this.refreshLibrary();
  }

  private async refreshLibrary(): Promise<void> {
    try {
      const { listPresentations } = await import('../lib/presentation-store');
      this.records = await listPresentations();
    } catch (error) {
      this.notice(error);
    }
    this.renderLibrary();
  }

  private renderLibrary(): void {
    const list = this.q('[data-pres-list]');
    const entries = [
      ...this.records.map((record) => ({ id: record.id, title: record.title, detail: `${bytesLabel(record.archiveSize)} · Imported ${new Date(record.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` })),
      ...[...this.temporary].map(([id, pkg]) => ({ id, title: pkg.manifest.title, detail: `${bytesLabel(pkg.archive.size)} · Not saved — keep your ZIP` })),
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
    if (!entries.length) {
      const empty = document.createElement('p'); empty.className = 'presentation-empty';
      empty.textContent = 'Your imported presentations will appear here.'; list.append(empty);
    }
  }

  private async removeSaved(id: string): Promise<void> {
    if (this.temporary.has(id)) this.temporary.delete(id);
    else { const { deletePresentation } = await import('../lib/presentation-store'); await deletePresentation(id); }
    await this.refreshLibrary();
    this.notice('Removed from this browser. Your downloaded ZIP is unchanged.');
  }

  private async openSaved(id: string): Promise<void> {
    if (this.busy) { this.notice('A presentation is opening. Please wait a moment.'); return; }
    const operation = ++this.operation;
    const temporary = this.temporary.get(id);
    if (temporary) {
      const { inspectPresentationArchive } = await import('../lib/presentation-package');
      const pkg = await inspectPresentationArchive(new File([temporary.archive], temporary.fileName, { type: 'application/zip' }));
      if (operation === this.operation && pkg) this.showPackage(pkg, false);
      return;
    }
    const { getPresentation } = await import('../lib/presentation-store');
    const saved = await getPresentation(id);
    if (operation !== this.operation) return;
    if (!saved) { await this.refreshLibrary(); throw new Error('This presentation was removed in another tab. Open its ZIP to restore it.'); }
    const { inspectPresentationArchive } = await import('../lib/presentation-package');
    const pkg = await inspectPresentationArchive(new File([saved.archive], saved.fileName, { type: 'application/zip' }));
    if (operation !== this.operation) return;
    if (!pkg) throw new Error('This saved package could not be recognized. Its stored data has been preserved.');
    this.showPackage(pkg, true);
  }

  /** Return false for ordinary Markdown lesson ZIPs so the existing importer handles them. */
  async tryOpenFile(file: File): Promise<boolean> {
    if (this.busy) throw new Error('A presentation is already opening. Please wait a moment.');
    this.busy = true;
    const operation = ++this.operation;
    try {
      const { inspectPresentationArchive } = await import('../lib/presentation-package');
      const pkg = await inspectPresentationArchive(file);
      if (!pkg) return false;
      if (operation !== this.operation) return true;
      this.showPackage(pkg, false);
      this.q('[data-pres-storage]').textContent = 'Saving this package in your browser…';
      try {
        const { savePresentation } = await import('../lib/presentation-store');
        const record = await savePresentation(pkg);
        this.records = [record, ...this.records.filter((entry) => entry.id !== record.id)];
        if (operation === this.operation) this.q('[data-pres-storage]').textContent = 'Saved in this browser. Keep a downloaded ZIP as your backup.';
      } catch (error) {
        // Keep compressed bytes only and bound failed-save memory independently
        // of the active player. Every import still has its original local ZIP.
        let evicted = false;
        while ([...this.temporary.values()].reduce((sum, item) => sum + item.archive.size, pkg.archive.size) > 120 * 1024 * 1024 || this.temporary.size >= 5) {
          this.temporary.delete(this.temporary.keys().next().value!);
          evicted = true;
        }
        this.temporary.set(`temporary-${crypto.randomUUID()}`, { archive: pkg.archive, fileName: pkg.fileName, manifest: pkg.manifest });
        if (operation === this.operation) {
          this.q('[data-pres-storage]').textContent = 'Not saved in this browser. Download ZIP to keep a copy.';
          this.notice(`${error instanceof Error ? error.message : String(error)}${evicted ? ' Older unsaved packages can be reopened from their original ZIPs.' : ''}`);
        }
      }
      return true;
    } finally { if (operation === this.operation) this.busy = false; }
  }

  private showPackage(pkg: PresentationPackage, saved: boolean): void {
    this.exitFullscreen();
    this.player?.destroy();
    this.active = pkg;
    this.openDialog();
    this.notice();
    this.q('[data-pres-title]').textContent = pkg.manifest.title;
    this.q('[data-pres-subtitle]').textContent = `Slidev · ${pkg.files.length} files · ${bytesLabel(pkg.archive.size)}`;
    this.q('[data-pres-start-title]').textContent = pkg.manifest.title;
    this.q('[data-pres-start-detail]').textContent = pkg.manifest.source ? 'Editable source included in the ZIP' : 'Built presentation · source not included';
    this.q('[data-pres-storage]').textContent = saved ? 'Saved in this browser. Keep a downloaded ZIP as your backup.' : 'Local package. Your original ZIP is unchanged.';
    this.q('[data-pres-library]').hidden = true;
    this.q('[data-pres-deck]').hidden = false;
    this.q('[data-pres-back]').hidden = false;
    const select = this.q<HTMLSelectElement>('[data-pres-file]');
    const files = [...pkg.files].sort((a, b) => {
      if (a.path === pkg.manifest.source) return -1;
      if (b.path === pkg.manifest.source) return 1;
      return a.path.localeCompare(b.path);
    });
    select.replaceChildren(...files.map((file) => new Option(`${file.path} (${bytesLabel(file.size)})`, file.path)));
    this.showSource();
    this.setView('preview');
    this.player = createPresentationPlayer(this.q('[data-pres-host]'), pkg.html, {
      title: pkg.manifest.title,
      sandboxUrl: this.dataset.sandboxUrl!,
      onState: (state) => {
        this.q('[data-pres-start]').hidden = state === 'loading' || state === 'ready';
        this.q('[data-pres-player-status]').textContent = ({ stopped: 'Ready to start', loading: 'Opening presentation…', ready: 'Playing locally', error: 'Playback needs attention' })[state];
        this.q('[data-pres-stop]').hidden = state !== 'loading' && state !== 'ready';
        this.q('[data-pres-restart]').hidden = state === 'stopped';
      },
      onError: (message) => this.notice(message),
      // Escape belongs to Slidev's overview/menu while embedded. Only the
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
    const file = this.active?.files.find((entry) => entry.path === path);
    const field = this.q<HTMLTextAreaElement>('[data-pres-source-text]');
    const readable = typeof file?.content === 'string';
    field.value = readable ? file.content! : 'This binary or large file is preserved in the ZIP. Download the package to open it with the appropriate application.';
    field.scrollTop = 0;
    this.q<HTMLButtonElement>('[data-pres-copy]').disabled = !readable;
    this.q('[data-pres-file-info]').textContent = file ? `${file.path} · ${bytesLabel(file.size)}${readable ? ' · Read-only source' : ''}` : '';
  }

  private async copySource(): Promise<void> {
    const field = this.q<HTMLTextAreaElement>('[data-pres-source-text]');
    try { await navigator.clipboard.writeText(field.value); this.notice('Source copied.'); }
    catch { field.focus(); field.select(); this.notice('Source selected. Use your browser’s Copy command.'); }
  }

  private start(): void {
    this.setView('preview');
    this.notice();
    this.player?.start();
  }

  private isFullscreen(): boolean {
    const stage = this.q('[data-pres-stage]');
    return document.fullscreenElement === stage || stage.classList.contains('presentation-fallback-fullscreen');
  }

  private present(): void {
    try {
      this.setView('preview');
      if (!this.player?.isRunning()) this.start();
      if (!this.player?.isRunning()) return;
      const stage = this.q('[data-pres-stage]');
      const fallback = () => { stage.classList.add('presentation-fallback-fullscreen'); this.q('[data-pres-exit-fullscreen]').hidden = false; this.player?.focus(); };
      if (stage.requestFullscreen) void stage.requestFullscreen().then(() => this.player?.focus()).catch(fallback);
      else fallback();
    } catch (error) { this.notice(error); }
  }

  private exitFullscreen(): void {
    const stage = this.q('[data-pres-stage]');
    if (document.fullscreenElement === stage) void document.exitFullscreen().catch(() => {});
    stage.classList.remove('presentation-fallback-fullscreen');
    this.q('[data-pres-exit-fullscreen]').hidden = true;
  }

  private downloadArchive(): void {
    if (!this.active) return;
    download(this.active.archive, this.active.fileName || `${fileName(this.active.manifest.title)}.zip`);
  }

  private downloadHtml(): void {
    if (!this.active) return;
    const html = exportPresentationHtml(this.active.html, this.active.manifest.title);
    download(new Blob([html], { type: 'text/html;charset=utf-8' }), `${fileName(this.active.manifest.title)}.html`);
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
