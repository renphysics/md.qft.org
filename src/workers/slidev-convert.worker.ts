/**
 * The Slidev build conversion, run off the page with esbuild-wasm.
 *
 * The site's pages forbid WebAssembly (script-src 'self', no 'unsafe-eval' or
 * 'wasm-unsafe-eval'). A Worker loaded from the site's own URL takes its
 * policy from its own response instead, so WebAssembly may compile here while
 * the page keeps its policy. Nothing from the deck runs here either: the
 * conversion only reads, rewrites and bundles text.
 *
 * Protocol (one conversion per Worker; the page terminates it afterwards, or
 * to cancel):
 *   page -> worker  { type: 'convert', files: [path, ArrayBuffer][], detection, maxHtmlLength? }
 *   worker -> page  { type: 'progress', step } … then { type: 'done', html, issues } or { type: 'failed', message }
 */
import * as esbuild from 'esbuild-wasm/esm/browser.js';
import wasmUrl from 'esbuild-wasm/esbuild.wasm?url';
import { convertSlidevFiles, createEsbuildBundler, type SlidevConvertStep } from '../lib/slidev-convert';
import type { DeckDetection, DeckFiles, DeckIssue } from '../lib/deck-types';

interface ConvertRequest {
  type: 'convert';
  files: [string, ArrayBuffer][];
  detection: DeckDetection;
  maxHtmlLength?: number;
}

export type SlidevWorkerReply =
  | { type: 'progress'; step: SlidevConvertStep }
  | { type: 'done'; html: string; issues: DeckIssue[] }
  | { type: 'failed'; message: string };

const reply = (message: SlidevWorkerReply) => self.postMessage(message);

let ready: Promise<void> | undefined;

/** Compile and start esbuild once, in this thread (no nested Worker). */
function initialise(): Promise<void> {
  ready ??= esbuild.initialize({ wasmURL: new URL(wasmUrl, self.location.href).href, worker: false })
    .catch((error: unknown) => { ready = undefined; throw error; });
  return ready;
}

function isRequest(value: unknown): value is ConvertRequest {
  const request = value as Partial<ConvertRequest> | null;
  return !!request && request.type === 'convert' && Array.isArray(request.files) && !!request.detection && typeof request.detection === 'object';
}

async function convert(request: ConvertRequest): Promise<void> {
  try {
    await initialise();
    const files: DeckFiles = new Map();
    for (const [path, buffer] of request.files) {
      if (typeof path === 'string' && buffer instanceof ArrayBuffer) files.set(path, new Uint8Array(buffer));
    }
    const result = await convertSlidevFiles(files, request.detection, createEsbuildBundler(esbuild), {
      ...(typeof request.maxHtmlLength === 'number' ? { maxHtmlLength: request.maxHtmlLength } : {}),
      onProgress: (step) => reply({ type: 'progress', step }),
    });
    reply({ type: 'done', html: result.html, issues: result.issues });
  } catch (error) {
    reply({ type: 'failed', message: String(error instanceof Error ? error.message : error).slice(0, 600) });
  }
}

self.addEventListener('message', (event: MessageEvent) => {
  if (isRequest(event.data)) void convert(event.data);
});
