/** Both editor callbacks use zero-based, optionally fractional source lines. */
export interface ScrollSyncConfig {
  editorScroller: HTMLElement;
  previewScroller: HTMLElement;
  sourceLineAtTop: () => number;
  scrollEditorToLine: (line: number) => void;
  isEnabled: () => boolean;
}

interface Anchor { line: number; top: number }
type Pane = 'editor' | 'preview';

function interpolate(anchors: Anchor[], value: number, from: keyof Anchor, to: keyof Anchor): number {
  if (!anchors.length || !Number.isFinite(value)) return 0;
  if (value <= anchors[0][from]) return anchors[0][to];
  const last = anchors[anchors.length - 1];
  if (value >= last[from]) return last[to];
  let low = 0;
  let high = anchors.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (anchors[mid][from] <= value) low = mid;
    else high = mid;
  }
  const a = anchors[low];
  const b = anchors[high];
  const span = b[from] - a[from];
  const fraction = span > 0 ? (value - a[from]) / span : 0;
  return a[to] + fraction * (b[to] - a[to]);
}

export function connectScrollSync(config: ScrollSyncConfig): { refresh(): void; destroy(): void } {
  const { editorScroller, previewScroller } = config;
  const controller = new AbortController();
  const { signal } = controller;
  let anchors: Anchor[] = [];
  let dirty = true;
  let destroyed = false;
  let syncFrame = 0;
  let measureFrame = 0;
  let releaseFrame = 0;
  let releaseSecondFrame = 0;
  let pending: Pane = 'editor';
  let blocked: Pane | undefined;

  const measure = () => {
    if (destroyed) return;
    dirty = false;
    const box = previewScroller.getBoundingClientRect();
    const nodes = [...previewScroller.querySelectorAll<HTMLElement>('[data-source-line]')]
      .filter((element) => !element.parentElement?.closest('[data-source-line]'));
    const next: Anchor[] = [];
    for (const node of nodes) {
      const line = Number(node.dataset.sourceLine);
      const top = node.getBoundingClientRect().top - box.top - previewScroller.clientTop + previewScroller.scrollTop;
      if (!Number.isFinite(line) || line < 0 || !Number.isFinite(top)) continue;
      const previous = next.at(-1);
      if (previous && (line <= previous.line || top <= previous.top)) continue;
      next.push({ line, top });
    }
    if (next.length) {
      if (next[0].line === 0) next[0].top = 0;
      else next.unshift({ line: 0, top: 0 });
      const lastNode = nodes.at(-1);
      const last = next.at(-1)!;
      const endLine = Number(lastNode?.dataset.sourceEndLine);
      if (lastNode && Number.isFinite(endLine) && endLine > last.line) {
        const bottom = lastNode.getBoundingClientRect().bottom - box.top - previewScroller.clientTop + previewScroller.scrollTop;
        if (bottom > last.top) next.push({ line: endLine, top: bottom });
      }
    }
    anchors = next;
  };

  const refresh = () => {
    if (destroyed) return;
    dirty = true;
    if (!measureFrame) {
      measureFrame = requestAnimationFrame(() => {
        measureFrame = 0;
        measure();
      });
    }
  };

  const blockFeedback = (pane: Pane) => {
    blocked = pane;
    cancelAnimationFrame(releaseFrame);
    cancelAnimationFrame(releaseSecondFrame);
    // Programmatic scroll events may arrive on the following animation frame.
    releaseFrame = requestAnimationFrame(() => {
      releaseFrame = 0;
      releaseSecondFrame = requestAnimationFrame(() => {
        releaseSecondFrame = 0;
        blocked = undefined;
      });
    });
  };

  const schedule = (pane: Pane) => {
    if (destroyed || !config.isEnabled() || blocked === pane) return;
    pending = pane;
    if (syncFrame) return;
    syncFrame = requestAnimationFrame(() => {
      syncFrame = 0;
      if (destroyed || !config.isEnabled()) return;
      if (dirty) measure();
      if (!anchors.length) return;
      if (pending === 'editor') {
        const top = interpolate(anchors, config.sourceLineAtTop(), 'line', 'top');
        const clamped = Math.max(0, Math.min(top, previewScroller.scrollHeight - previewScroller.clientHeight));
        if (Math.abs(previewScroller.scrollTop - clamped) < 1) return;
        blockFeedback('preview');
        previewScroller.scrollTop = clamped;
      } else {
        const line = interpolate(anchors, previewScroller.scrollTop, 'top', 'line');
        blockFeedback('editor');
        config.scrollEditorToLine(Math.max(0, line));
      }
    });
  };

  editorScroller.addEventListener('scroll', () => schedule('editor'), { passive: true, signal });
  previewScroller.addEventListener('scroll', () => schedule('preview'), { passive: true, signal });
  // An intentional interaction in the other pane immediately takes control.
  for (const [element, pane] of [[editorScroller, 'editor'], [previewScroller, 'preview']] as const) {
    for (const type of ['wheel', 'touchstart', 'pointerdown', 'keydown']) {
      element.addEventListener(type, () => {
        if (blocked === pane) blocked = undefined;
      }, { passive: true, signal });
    }
  }
  previewScroller.addEventListener('load', refresh, { capture: true, signal });
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(refresh) : undefined;
  observer?.observe(previewScroller);
  observer?.observe(editorScroller);
  window.addEventListener('resize', refresh, { passive: true, signal });
  document.fonts?.ready.then(() => { if (!destroyed) refresh(); });
  refresh();

  return {
    refresh,
    destroy() {
      destroyed = true;
      controller.abort();
      observer?.disconnect();
      cancelAnimationFrame(syncFrame);
      cancelAnimationFrame(measureFrame);
      cancelAnimationFrame(releaseFrame);
      cancelAnimationFrame(releaseSecondFrame);
      anchors = [];
    },
  };
}
