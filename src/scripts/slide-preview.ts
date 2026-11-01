import type { RevealApi } from 'reveal.js';
import { createInteractiveDemos, type InteractiveDemoController } from './interactive-demo-runtime';
import { withBase } from '../lib/site-path';
import {
  DEFAULT_SLIDE_SETTINGS, normalizeSlideSettings, slideDimensions,
  renderSlides, type SlideSettings, type SlidesResult,
} from '../lib/slides';

export interface SlidePreviewState {
  /** Zero-based slide index. */
  index: number;
  total: number;
  overflow: boolean;
  presenting: boolean;
}

/** Loaded only after the workspace enters Slides mode. */
export async function createSlidePreview(
  host: HTMLElement,
  onChange: (state: SlidePreviewState) => void,
): Promise<SlidePreview> {
  const [{ default: Reveal }] = await Promise.all([
    import('reveal.js'),
    import('reveal.js/reveal.css'),
    import('../styles/slides.css'),
  ]);
  const wrapper = document.createElement('div');
  wrapper.className = 'qft-slide-deck';
  wrapper.dataset.slideTheme = DEFAULT_SLIDE_SETTINGS.theme;
  wrapper.dataset.slideRatio = DEFAULT_SLIDE_SETTINGS.ratio;
  const canvas = document.createElement('div');
  canvas.className = 'reveal';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'region');
  canvas.setAttribute('aria-label', 'Slide preview. Focus here to use the arrow keys.');
  const slides = document.createElement('div');
  slides.className = 'slides';
  slides.innerHTML = renderSlides('').html;
  canvas.append(slides);
  wrapper.append(canvas);
  host.replaceChildren(wrapper);
  const deck = new Reveal(canvas, {
    ...slideDimensions(),
    embedded: true,
    controls: false,
    progress: false,
    slideNumber: false,
    hash: false,
    history: false,
    // Reveal's built-in "focused" condition tracks pointer clicks only.
    // DOM focus also covers keyboard-only users and entering Present directly.
    keyboardCondition: (event) => {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.closest('input,textarea,select,iframe,[contenteditable="true"],.qft-demo')) return false;
      const inDeck = canvas.contains(active) || !!canvas.closest('.qft-slide-presentation')?.contains(active);
      if (!inDeck) return false;
      if (active instanceof HTMLElement && active.closest('button,select')
        && !/^(?:Arrow(?:Left|Right|Up|Down)|PageUp|PageDown|Home|End)$/.test(event.key)) return false;
      return true;
    },
    keyboard: { 27: () => {}, 70: () => {}, 66: () => {}, 190: () => {} },
    overview: false,
    help: false,
    pause: false,
    jumpToSlide: false,
    center: false,
    margin: 0,
    minScale: 0.05,
    maxScale: 2,
    transition: 'none',
    backgroundTransition: 'none',
    autoAnimate: false,
    autoSlide: 0,
    touch: true,
    mouseWheel: false,
    hideInactiveCursor: false,
    view: null,
    scrollActivationWidth: 0,
    focusBodyOnPageVisibilityChange: false,
  });
  try { await deck.initialize(); }
  catch (error) { deck.destroy(); wrapper.remove(); throw error; }
  return new SlidePreview(host, wrapper, canvas, slides, deck, onChange);
}

export class SlidePreview {
  private result = renderSlides('');
  private settings: SlideSettings = { ...DEFAULT_SLIDE_SETTINGS };
  private readonly abort = new AbortController();
  private readonly resize?: ResizeObserver;
  private resizeFrame = 0;
  private overlay?: HTMLDivElement;
  private returnFocus?: HTMLElement;
  private inertStates = new Map<HTMLElement, boolean>();
  private disposed = false;
  private html = this.result.html;
  private fullscreenRequested = false;
  private demos!: InteractiveDemoController;

  constructor(
    private readonly host: HTMLElement,
    private readonly wrapper: HTMLDivElement,
    private readonly canvas: HTMLDivElement,
    private readonly slides: HTMLDivElement,
    private readonly deck: RevealApi,
    private readonly onChange: (state: SlidePreviewState) => void,
  ) {
    this.resetDemos();
    this.deck.on('slidechanged', () => { this.demos.sync(); this.scheduleLayout(); });
    this.canvas.addEventListener('pointerdown', (event) => {
      if (!(event.target instanceof Element) || !event.target.closest('a,button,input,select,textarea')) this.canvas.focus({ preventScroll: true });
    }, { signal: this.abort.signal });
    // A footnote or heading can point to another slide. Reveal cannot infer
    // our renderer's stable IDs from its numeric hash navigation.
    this.canvas.addEventListener('click', (event) => {
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href^="#"]') : null;
      if (!anchor) return;
      let id = anchor.getAttribute('href')!.slice(1);
      try { id = decodeURIComponent(id); } catch { /* Retain a malformed literal fragment. */ }
      const target = this.slides.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`);
      const section = target?.closest<HTMLElement>('.qft-slide');
      if (!section) return;
      event.preventDefault();
      this.goTo(Number(section.dataset.slideIndex));
      target!.tabIndex = -1;
      target!.focus({ preventScroll: true });
    }, { signal: this.abort.signal });
    document.addEventListener('keydown', (event) => {
      if (!this.overlay) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.exitPresentation();
      } else if (event.key === 'Tab') this.keepFocusInside(event);
    }, { capture: true, signal: this.abort.signal });
    document.addEventListener('fullscreenchange', () => {
      if (this.overlay && this.fullscreenRequested && !document.fullscreenElement) this.exitPresentation();
    }, { signal: this.abort.signal });
    if (typeof ResizeObserver !== 'undefined') {
      this.resize = new ResizeObserver(() => this.scheduleLayout());
      this.resize.observe(this.host);
      this.resize.observe(this.wrapper);
    }
    document.fonts?.ready.then(() => this.scheduleLayout());
    this.scheduleLayout();
  }

  get index(): number { return this.deck.getIndices().h ?? 0; }

  syncDemos(): void { this.demos?.sync(); }
  demoSnapshots(): Map<string, string> { return this.demos.snapshots(); }
  resetDemos(): void {
    this.demos?.destroy();
    this.demos = createInteractiveDemos(this.slides, {
      sandboxUrl: withBase('demo-sandbox.html'),
      isActive: (card) => card.closest('.qft-slide') === this.deck.getCurrentSlide()
        && (Boolean(this.overlay) || this.host.getClientRects().length > 0),
      onLayout: () => this.scheduleLayout(),
      onEscape: () => this.exitPresentation(),
    });
  }

  update(result: SlidesResult, value: SlideSettings = this.settings): void {
    if (this.disposed) return;
    const selected = this.index;
    const settings = normalizeSlideSettings(value);
    this.result = result;
    this.wrapper.dataset.slideTheme = settings.theme;
    this.wrapper.dataset.slideRatio = settings.ratio;
    if (this.settings.ratio !== settings.ratio) this.deck.configure(slideDimensions(settings));
    this.settings = settings;
    const html = result.html || renderSlides('').html;
    if (this.html !== html) {
      this.html = html;
      this.slides.innerHTML = html;
      this.deck.sync();
      this.deck.slide(Math.max(0, Math.min(selected, result.slides.length - 1)));
      for (const image of this.slides.querySelectorAll('img')) {
        if (!image.complete) {
          image.addEventListener('load', () => this.scheduleLayout(), { once: true, signal: this.abort.signal });
          image.addEventListener('error', () => this.scheduleLayout(), { once: true, signal: this.abort.signal });
        }
      }
    }
    this.demos.sync();
    this.scheduleLayout();
  }

  previous(): void { if (!this.disposed) this.goTo(this.index - 1); }
  next(): void { if (!this.disposed) this.goTo(this.index + 1); }
  goTo(index: number): void {
    if (this.disposed || !Number.isFinite(index)) return;
    this.deck.slide(Math.max(0, Math.min(Math.floor(index), Math.max(0, this.result.slides.length - 1))));
    this.scheduleLayout();
  }

  layout(): void {
    if (this.disposed || !this.wrapper.isConnected) return;
    this.deck.layout();
    this.demos.sync();
    const content = this.deck.getCurrentSlide()?.querySelector<HTMLElement>('.qft-slide-content');
    const overflow = !!content && content.clientHeight > 0
      && (content.scrollHeight > content.clientHeight + 2 || content.scrollWidth > content.clientWidth + 2);
    const total = Math.max(1, this.result.slides.length);
    if (this.overlay) {
      const counter = this.overlay.querySelector<HTMLElement>('[data-presentation-counter]')!;
      const label = `${this.index + 1} / ${total}`;
      if (counter.textContent !== label) counter.textContent = label;
      this.overlay.querySelector<HTMLButtonElement>('[data-presentation-prev]')!.disabled = this.index <= 0;
      this.overlay.querySelector<HTMLButtonElement>('[data-presentation-next]')!.disabled = this.index >= total - 1;
      this.overlay.querySelector<HTMLElement>('[data-presentation-overflow]')!.hidden = !overflow;
    }
    this.onChange({ index: this.index, total, overflow, presenting: !!this.overlay });
  }

  private scheduleLayout(): void {
    if (this.disposed || this.resizeFrame) return;
    this.resizeFrame = requestAnimationFrame(() => { this.resizeFrame = 0; this.layout(); });
  }

  present(): void {
    if (this.disposed || this.overlay) return;
    this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const overlay = document.createElement('div');
    overlay.className = 'qft-slide-presentation';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Presentation');
    const bar = document.createElement('div');
    bar.className = 'qft-slide-presentation-bar';
    bar.innerHTML = '<div class="qft-slide-presentation-navigation"><button type="button" data-presentation-prev aria-label="Previous slide">←</button><span data-presentation-counter aria-live="polite"></span><button type="button" data-presentation-next aria-label="Next slide">→</button><span class="qft-slide-presentation-hint">Arrow keys to navigate</span><span data-presentation-overflow hidden>Content extends beyond this slide</span></div>';
    bar.querySelector('[data-presentation-prev]')!.addEventListener('click', () => this.previous(), { signal: this.abort.signal });
    bar.querySelector('[data-presentation-next]')!.addEventListener('click', () => this.next(), { signal: this.abort.signal });
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Exit presentation';
    close.addEventListener('click', () => this.exitPresentation(), { signal: this.abort.signal });
    bar.append(close);
    overlay.append(bar);
    this.overlay = overlay;
    for (const sibling of document.body.children) {
      if (!(sibling instanceof HTMLElement)) continue;
      this.inertStates.set(sibling, sibling.inert);
      sibling.inert = true;
    }
    document.body.append(overlay);
    // A state-preserving move keeps demo controls and canvases alive. Older
    // browsers reset the demo instead of leaving a reloaded, uninitialized frame.
    if (typeof overlay.moveBefore === 'function') overlay.moveBefore(this.wrapper, bar);
    else { overlay.insertBefore(this.wrapper, bar); this.resetDemos(); }
    this.canvas.setAttribute('aria-label', 'Presentation. Use the arrow keys to navigate. Press Escape to exit.');
    this.canvas.focus({ preventScroll: true });
    this.scheduleLayout();
    // The fixed overlay remains usable when browser fullscreen is unavailable.
    if (typeof overlay.requestFullscreen === 'function') {
      this.fullscreenRequested = true;
      void overlay.requestFullscreen().catch(() => { this.fullscreenRequested = false; });
    }
  }

  exitPresentation(): void {
    const overlay = this.overlay;
    if (!overlay) return;
    this.overlay = undefined;
    this.fullscreenRequested = false;
    if (document.fullscreenElement === overlay) void document.exitFullscreen().catch(() => {});
    if (typeof this.host.moveBefore === 'function') this.host.moveBefore(this.wrapper, null);
    else { this.host.append(this.wrapper); this.resetDemos(); }
    overlay.remove();
    for (const [element, inert] of this.inertStates) element.inert = inert;
    this.inertStates.clear();
    this.canvas.setAttribute('aria-label', 'Slide preview. Focus here to use the arrow keys.');
    if (this.returnFocus?.isConnected) this.returnFocus.focus({ preventScroll: true });
    this.returnFocus = undefined;
    this.scheduleLayout();
  }

  private keepFocusInside(event: KeyboardEvent): void {
    if (!this.overlay) return;
    const focusable = [...this.overlay.querySelectorAll<HTMLElement>('button,a[href],input,select,textarea,iframe,[tabindex]')]
      .filter((element) => element.tabIndex >= 0 && element.getClientRects().length && !element.closest('[hidden],[aria-hidden="true"]'));
    if (!focusable.length) { event.preventDefault(); return; }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  destroy(): void {
    if (this.disposed) return;
    this.exitPresentation();
    this.disposed = true;
    this.abort.abort();
    this.demos.destroy();
    this.resize?.disconnect();
    cancelAnimationFrame(this.resizeFrame);
    this.deck.destroy();
    this.wrapper.remove();
  }
}
