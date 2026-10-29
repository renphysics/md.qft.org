import katexCss from 'katex/dist/katex.min.css?raw';
import katexLicense from 'katex/LICENSE?raw';
import documentCss from '../styles/document.css?raw';
import { escapeHtml, renderMarkdown, type RenderOptions } from './render-markdown';

const fontAssets = import.meta.glob('../../node_modules/katex/dist/fonts/*.woff2', {
  eager: true,
  // Vite otherwise excludes node_modules from glob matches.
  exhaustive: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_EXPORT_IMAGE_BYTES = 24 * 1024 * 1024;
let embeddedKatexCss: Promise<string> | undefined;
let printing = false;

export function fileName(title: string, extension: string): string {
  let safeTitle = title.normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/[. ]+$/g, '').trim().replace(/\s+/g, '-').slice(0, 96) || 'document';
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safeTitle)) safeTitle = `note-${safeTitle}`;
  const suffix = extension.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'md';
  return `${safeTitle}.${suffix}`;
}

function download(content: string, title: string, extension: string, mime: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName(title, extension);
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function downloadMarkdown(source: string, title: string): void {
  download(source, title, 'md', 'text/markdown');
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('A document asset could not be read.'));
    reader.readAsDataURL(blob);
  });
}

async function waitForPrintAssets(article: HTMLElement): Promise<void> {
  let timer: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error('The document assets are taking too long to load. Please try printing again.')), 20_000);
  });
  try {
    // The off-screen document participates in layout, so its font requests
    // have started before we wait for the FontFaceSet.
    void article.offsetHeight;
    await Promise.race([
      Promise.all([
        document.fonts.ready,
        ...[...article.querySelectorAll('img')].map((image) => image.decode().catch(() => {})),
      ]),
      timeout,
    ]);
  } finally {
    if (timer) window.clearTimeout(timer);
  }
}

async function fetchLimited(url: string, limit: number): Promise<Blob> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`An export asset could not be downloaded (HTTP ${response.status}).`);
    const advertisedSize = Number(response.headers.get('content-length') ?? 0);
    if (advertisedSize > limit) throw new Error('An image is too large to embed in this export.');
    if (!response.body) {
      const blob = await response.blob();
      if (blob.size > limit) throw new Error('An image is too large to embed in this export.');
      return blob;
    }
    const reader = response.body.getReader();
    const chunks: BlobPart[] = [];
    let size = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error('An image is too large to embed in this export.');
      }
      // Copy to an ordinary ArrayBuffer for browsers with strict Blob typings.
      chunks.push(new Uint8Array(chunk.value).buffer);
    }
    return new Blob(chunks, { type: response.headers.get('content-type')?.split(';')[0] ?? '' });
  } finally {
    window.clearTimeout(timer);
  }
}

async function standaloneMathCss(): Promise<string> {
  if (embeddedKatexCss) return embeddedKatexCss;
  embeddedKatexCss = (async () => {
    const files = Object.entries(fontAssets);
    if (!files.length) throw new Error('The math fonts are unavailable. Please reload the application and try again.');
    const fontData = new Map(await Promise.all(files.map(async ([path, url]) => {
      const blob = await fetchLimited(url, 1024 * 1024);
      return [path.split('/').pop()!, await blobToDataUrl(new Blob([blob], { type: 'font/woff2' }))] as const;
    })));
    return katexCss.replace(/@font-face\s*\{[^}]*\}/g, (rule) => {
      const filename = rule.match(/url\(["']?(?:\.\/)?fonts\/([^\s)"']+\.woff2)["']?\)/)?.[1];
      if (!filename || !fontData.has(filename)) throw new Error('A required math font could not be embedded.');
      return rule.replace(/src:[^;}]*/g, `src:url("${fontData.get(filename)}") format("woff2")`);
    });
  })().catch((error) => {
    embeddedKatexCss = undefined;
    throw error;
  });
  return embeddedKatexCss;
}

async function embedImages(html: string): Promise<string> {
  const template = document.createElement('template');
  template.innerHTML = html;
  let embeddedBytes = 0;
  for (const image of template.content.querySelectorAll<HTMLImageElement>('img')) {
    const src = image.getAttribute('src') ?? '';
    if (src.startsWith('data:')) continue;
    try {
      const blob = await fetchLimited(src, MAX_IMAGE_BYTES);
      if (!/^image\/(png|jpeg|webp|gif)$/i.test(blob.type)) {
        throw new Error('Only PNG, JPEG, WebP, and GIF images can be embedded.');
      }
      embeddedBytes += blob.size;
      if (embeddedBytes > MAX_EXPORT_IMAGE_BYTES) throw new Error('The document has too many image bytes for a portable HTML export.');
      image.src = await blobToDataUrl(blob);
      image.removeAttribute('referrerpolicy');
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'The image server may block downloads.';
      throw new Error(`A remote image could not be embedded. Turn off remote images in Settings, or embed the image in your Markdown. ${detail}`);
    }
  }
  return template.innerHTML;
}

/** Export a standalone, script-free HTML document with embedded math fonts. */
export async function exportPortableHtml(source: string, title: string, options: RenderOptions = {}): Promise<void> {
  const rendered = renderMarkdown(source, options);
  if (!rendered.html && source.trim()) throw new Error(rendered.errors[0]?.message ?? 'The document could not be rendered.');
  const [mathStyle, html] = await Promise.all([standaloneMathCss(), embedImages(rendered.html)]);
  const warning = rendered.errors.length
    ? `<p class="export-warning">This document contains ${rendered.errors.length} unresolved mathematical rendering issue${rendered.errors.length === 1 ? '' : 's'}. The original Markdown is included below.</p>`
    : '';
  const exported = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="QFT Markdown">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:; base-uri 'none'; object-src 'none'">
<title>${escapeHtml(title || 'Markdown document')}</title>
<style>
${mathStyle}
${documentCss}
:root{color-scheme:light;background:#fffefa;color:#29282e}
*{box-sizing:border-box}
body{margin:0;padding:48px 24px}
main{max-width:780px;margin:0 auto}
.markdown-document{--doc-font:Georgia,'Times New Roman',serif;font-size:16px}
.source-document{margin-top:48px;border-top:1px solid #e6e1dd;padding-top:20px;color:#777;font:13px/1.6 system-ui,sans-serif}
.source-document summary{cursor:pointer}
.source-document pre{white-space:pre-wrap;overflow-wrap:anywhere;color:#444;font:12px/1.7 ui-monospace,monospace}
.export-warning{border-left:3px solid #a33548;padding:12px 16px;background:#fbe8ec;font:13px/1.6 system-ui,sans-serif}
@media print{@page{margin:17mm}body{padding:0;background:white}.source-document{display:none}main{max-width:none}.markdown-document{font-size:10.5pt}}
</style>
</head>
<body><main>
${warning}
<article class="markdown-document">${html}</article>
<details class="source-document"><summary>Original Markdown · exported with QFT Markdown</summary><pre>${escapeHtml(source)}</pre><details><summary>KaTeX math typesetting and fonts · MIT license</summary><pre>${escapeHtml(katexLicense)}</pre></details></details>
</main></body></html>`;
  download(exported, title, 'html', 'text/html');
}

/** Print a clean copy without moving or restyling the live editor. */
export async function printDocument(html: string, title: string): Promise<void> {
  if (printing) return;
  printing = true;
  let article: HTMLElement | undefined;
  let printStyle: HTMLStyleElement | undefined;
  const oldTitle = document.title;
  let cleanupTimer: number | undefined;
  const restore = () => {
    article?.remove();
    printStyle?.remove();
    document.title = oldTitle;
    delete document.body.dataset.qftPrinting;
    window.removeEventListener('afterprint', restore);
    if (cleanupTimer) window.clearTimeout(cleanupTimer);
    printing = false;
  };
  try {
    article = document.createElement('article');
    article.className = 'qft-print-document markdown-document';
    article.setAttribute('aria-hidden', 'true');
    article.innerHTML = html;
    article.querySelectorAll('[tabindex]').forEach((element) => element.removeAttribute('tabindex'));
    // The live preview remains in the DOM. Give the print copy distinct
    // anchors so internal PDF links resolve to the visible printed targets.
    const printIds = new Map<string, string>();
    article.querySelectorAll<HTMLElement>('[id]').forEach((element) => {
      const id = `qft-print-${element.id}`;
      printIds.set(element.id, id);
      element.id = id;
    });
    article.querySelectorAll<HTMLAnchorElement>('a[href^="#"]').forEach((anchor) => {
      let target = anchor.getAttribute('href')!.slice(1);
      try { target = decodeURIComponent(target); } catch { /* Preserve malformed fragments. */ }
      const id = printIds.get(target);
      if (id) anchor.setAttribute('href', `#${id}`);
    });
    printStyle = document.createElement('style');
    printStyle.textContent = `.qft-print-document{position:fixed;left:-10000px;top:0;width:720px;visibility:hidden;pointer-events:none}@media print{@page{margin:17mm}html,body{height:auto!important;overflow:visible!important;background:#fff!important}body[data-qft-printing]>:not(.qft-print-document){display:none!important}.qft-print-document{display:block!important;position:static!important;visibility:visible!important;margin:0!important;padding:0!important;width:auto!important;max-width:none!important;background:#fff!important;color:#222!important;--doc-font:Georgia,'Times New Roman',serif}body[data-qft-printing]{margin:0!important;padding:0!important}.qft-print-document .katex-display{overflow:visible!important}}`;
    document.head.append(printStyle);
    document.body.append(article);
    await waitForPrintAssets(article);
    document.title = title || 'Markdown document';
    document.body.dataset.qftPrinting = 'true';
    window.addEventListener('afterprint', restore, { once: true });
    window.print();
    // afterprint is normally dispatched when the dialog closes. Retain a
    // conservative cleanup path for browsers that omit it after cancellation.
    if (printing) cleanupTimer = window.setTimeout(restore, 5 * 60 * 1000);
  } catch (error) {
    restore();
    throw error;
  }
}
