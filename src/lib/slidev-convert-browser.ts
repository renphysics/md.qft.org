import { cleanReportedText } from './presentation-messages';
import { PRESENTATION_LIMITS } from './presentation-package';
import type { DeckDetection, DeckFiles, DeckIssue } from './deck-types';
import type { SlidevConvertStep } from './slidev-convert';
import type { SlidevWorkerReply } from '../workers/slidev-convert.worker';

/**
 * The app's side of the Slidev build conversion: it starts a same-origin
 * module Worker (src/workers/slidev-convert.worker.ts), which runs the
 * conversion with esbuild-wasm, and checks what comes back. The Worker and
 * esbuild.wasm are separate lazy assets: this module is loaded, and they are
 * requested, only when a Slidev build is opened.
 *
 * One Worker per conversion, terminated when it is done or cancelled, so the
 * memory that bundling takes is returned at once.
 * It needs Worker: Node tests give it a stand-in (tests/slidev-convert-browser.test.ts).
 */

/** What the person reads while a build is converted; written by this site, never by a deck. */
export const SLIDEV_PROGRESS_TEXT: Readonly<Record<SlidevConvertStep, string>> = Object.freeze({
  preparing: 'Preparing the converter…',
  bundling: 'Bundling the presentation…',
});

export interface SlidevBuildOptions {
  /** Aborting stops the Worker at once; the promise then rejects with the signal's reason. */
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
  /** How long the converter may take to get ready (download and compile esbuild.wasm); SLIDEV_START_TIME_LIMIT by default. */
  startTimeLimit?: number;
}

/** The "Preparing the converter…" step ends within this many milliseconds, or the conversion stops. */
export const SLIDEV_START_TIME_LIMIT = 90_000;

/**
 * The converter could not be downloaded, compiled or started: offline, a
 * filtered school network, or a new version of the site. `message` is fixed
 * plain text with what to do; the technical reason is kept in `detail` only.
 */
export class SlidevConverterUnavailableError extends Error {
  override readonly name = 'SlidevConverterUnavailableError';
  constructor(message: string, readonly detail: string) { super(message); }
}

const UNAVAILABLE = 'The Slidev converter could not be downloaded. Check the internet connection, reload the page, and open the ZIP again.';
const TOO_SLOW = (seconds: number) => `The Slidev converter was not ready after ${seconds} seconds. Check the internet connection, reload the page, and open the ZIP again.`;

export interface SlidevBuildResult {
  /** '' when the build cannot be played; the issues then hold at least one error. */
  html: string;
  issues: DeckIssue[];
}

/** The build's own files that the conversion reads: the page, scripts, styles, and the pictures, media and fonts it embeds (ASSET_EXTENSIONS in slidev-convert.ts). */
const NEEDED = /\.(?:html?|m?js|css|png|jpe?g|jfif|gif|webp|avif|apng|svg|ico|bmp|mp4|m4v|webm|ogv|ogg|oga|mp3|m4a|aac|wav|opus|flac|woff2?|ttf|otf|eot)$/i;
const SEVERITIES = new Set<DeckIssue['severity']>(['info', 'warning', 'error']);
const MAX_ISSUES = 200;

/** Issues come from deck paths and esbuild messages: keep only well-formed, cleaned, bounded ones. */
function checkedIssues(value: unknown): DeckIssue[] {
  if (!Array.isArray(value)) return [];
  const issues: DeckIssue[] = [];
  for (const item of value.slice(0, MAX_ISSUES) as Partial<DeckIssue>[]) {
    if (!item || typeof item.code !== 'string' || !/^[a-z0-9-]{1,60}$/.test(item.code) || !SEVERITIES.has(item.severity as DeckIssue['severity'])) continue;
    const message = cleanReportedText(item.message, 800);
    if (!message) continue;
    const where = cleanReportedText(item.where, 200);
    issues.push({ code: item.code, severity: item.severity as DeckIssue['severity'], message, ...(where ? { where } : {}) });
  }
  return issues;
}

function stopped(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The conversion was stopped.', 'AbortError');
}

/**
 * Convert a Slidev build (a 'slidev-build' detection of `files`) into one
 * document the player can play. Rejects only when the converter cannot run
 * or is cancelled; a build that cannot be converted resolves with html '' and
 * an error issue that says why.
 */
export function convertSlidevBuild(files: DeckFiles, detection: DeckDetection, options: SlidevBuildOptions = {}): Promise<SlidevBuildResult> {
  const { signal, onProgress } = options;
  if (signal?.aborted) return Promise.reject(stopped(signal));
  const entry = detection.entry ?? '';
  const root = entry.includes('/') ? entry.slice(0, entry.lastIndexOf('/') + 1) : '';
  // Copies go to the Worker, so the deck's own bytes stay usable here.
  const sent: [string, ArrayBuffer][] = [];
  for (const [path, bytes] of files) {
    if (!path.startsWith(root) || !NEEDED.test(path)) continue;
    sent.push([path, bytes.slice().buffer]);
  }
  return new Promise<SlidevBuildResult>((resolve, reject) => {
    const worker = new Worker(new URL('../workers/slidev-convert.worker.ts', import.meta.url), { type: 'module', name: 'Slidev converter' });
    let settled = false;
    const limit = options.startTimeLimit ?? SLIDEV_START_TIME_LIMIT;
    // Cleared by the Worker's 'ready': only downloading and starting esbuild is timed, not the conversion.
    let startTimer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
      finish(() => reject(new SlidevConverterUnavailableError(TOO_SLOW(Math.round(limit / 1000)), `not ready after ${limit} ms`)));
    }, limit);
    const started = () => { if (startTimer !== undefined) { clearTimeout(startTimer); startTimer = undefined; } };
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      started();
      worker.terminate();
      signal?.removeEventListener('abort', abort);
      settle();
    };
    const abort = () => finish(() => reject(stopped(signal!)));
    signal?.addEventListener('abort', abort, { once: true });
    worker.addEventListener('message', (event: MessageEvent<SlidevWorkerReply>) => {
      const data = event.data as Partial<SlidevWorkerReply> | null;
      if (!data || typeof data !== 'object' || settled) return;
      if (data.type === 'ready') {
        started();
      } else if (data.type === 'progress') {
        const step = (data as { step?: unknown }).step;
        if (step === 'preparing' || step === 'bundling') onProgress?.(SLIDEV_PROGRESS_TEXT[step]);
      } else if (data.type === 'done') {
        const html = (data as { html?: unknown }).html;
        const issues = checkedIssues((data as { issues?: unknown }).issues);
        const usable = typeof html === 'string' && html.length <= PRESENTATION_LIMITS.htmlBytes ? html : '';
        if (!usable && !issues.some((issue) => issue.severity === 'error')) {
          issues.unshift({ code: 'slidev-convert-failed', severity: 'error', message: 'The Slidev converter returned no presentation. Open the ZIP again.' });
        }
        finish(() => resolve({ html: issues.some((issue) => issue.severity === 'error') ? '' : usable, issues }));
      } else if (data.type === 'failed') {
        const message = cleanReportedText((data as { message?: unknown }).message, 300);
        if ((data as { stage?: unknown }).stage === 'start') {
          finish(() => reject(new SlidevConverterUnavailableError(UNAVAILABLE, message || 'esbuild did not start')));
        } else {
          finish(() => reject(new Error(message || 'The Slidev converter stopped unexpectedly. Open the ZIP again; if it happens again, reload the page.')));
        }
      }
    });
    worker.addEventListener('error', (event) => {
      event.preventDefault();
      // The Worker's own script did not load or run, for example after the site was updated.
      finish(() => reject(new SlidevConverterUnavailableError(UNAVAILABLE, 'the converter script could not be loaded')));
    });
    worker.addEventListener('messageerror', () => finish(() => reject(new Error('The Slidev converter sent a reply that could not be read. Reload the page and open the ZIP again.'))));
    onProgress?.(SLIDEV_PROGRESS_TEXT.preparing);
    worker.postMessage({ type: 'convert', files: sent, detection }, sent.map(([, buffer]) => buffer));
  });
}
