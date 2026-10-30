/** Portable presentation options. Document text remains ordinary Markdown. */
export interface DocumentSettings {
  style: 'clean' | 'study' | 'academic';
  paper: 'a4' | 'letter';
  orientation: 'portrait' | 'landscape';
  margins: 'standard' | 'compact' | 'wide';
  fontSize: 10 | 11 | 12 | 13;
  spacing: 'comfortable' | 'compact';
  showTitle: boolean;
  author: string;
  toc: boolean;
  breakBeforeSections: boolean;
}

export const DEFAULT_DOCUMENT_SETTINGS: Readonly<DocumentSettings> = Object.freeze({
  style: 'clean', paper: 'a4', orientation: 'portrait', margins: 'standard',
  fontSize: 11, spacing: 'comfortable', showTitle: true, author: '',
  toc: false, breakBeforeSections: false,
});

/** Stored preferences and form values are always reduced to a small allowlist. */
export function normalizeDocumentSettings(value: unknown): DocumentSettings {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const fontSize = typeof input.fontSize === 'number' || typeof input.fontSize === 'string' ? Number(input.fontSize) : NaN;
  return {
    style: input.style === 'study' || input.style === 'academic' ? input.style : 'clean',
    paper: input.paper === 'letter' ? 'letter' : 'a4',
    orientation: input.orientation === 'landscape' ? 'landscape' : 'portrait',
    margins: input.margins === 'compact' || input.margins === 'wide' ? input.margins : 'standard',
    fontSize: [10, 11, 12, 13].includes(fontSize) ? fontSize as DocumentSettings['fontSize'] : 11,
    spacing: input.spacing === 'compact' ? 'compact' : 'comfortable',
    showTitle: typeof input.showTitle === 'boolean' ? input.showTitle : true,
    author: typeof input.author === 'string' ? input.author.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 160) : '',
    toc: input.toc === true,
    breakBeforeSections: input.breakBeforeSections === true,
  };
}

export function documentPageMetrics(value: DocumentSettings = DEFAULT_DOCUMENT_SETTINGS): {
  widthMm: number; heightMm: number; marginMm: number; contentWidthMm: number; contentHeightMm: number;
} {
  const settings = normalizeDocumentSettings(value);
  let [widthMm, heightMm] = settings.paper === 'letter' ? [215.9, 279.4] : [210, 297];
  if (settings.orientation === 'landscape') [widthMm, heightMm] = [heightMm, widthMm];
  const marginMm = { standard: 18, compact: 12, wide: 24 }[settings.margins];
  return { widthMm, heightMm, marginMm, contentWidthMm: widthMm - 2 * marginMm, contentHeightMm: heightMm - 2 * marginMm };
}

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function decode(text: string): string {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code: string) => {
    if (code[0] !== '#') return named[code.toLowerCase()] ?? entity;
    const value = code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff) ? String.fromCodePoint(value) : '\ufffd';
  });
}

/** Read labels from our renderer's HTML, omitting duplicate KaTeX visual text. */
function headingText(html: string): string {
  let ignored = 0;
  let text = '';
  for (const part of html.match(/<[^>]*>|[^<]+/g) ?? []) {
    if (!part.startsWith('<')) { if (!ignored) text += part; continue; }
    const closing = /^<\//.test(part);
    const selfClosing = /\/\s*>$/.test(part) || /^<(?:br|img|hr|input|wbr)\b/i.test(part);
    if (ignored) {
      if (closing) ignored -= 1;
      else if (!selfClosing) ignored += 1;
      continue;
    }
    if (/^<annotation\b/i.test(part) || /^<span\b[^>]*\bclass="[^"]*\bkatex-html\b/i.test(part)) {
      ignored = 1;
    } else if (/^<(?:br|mspace)\b/i.test(part)) text += ' ';
    else if (/^<img\b/i.test(part)) text += part.match(/\balt="([^"]*)"/i)?.[1] ?? '';
  }
  return decode(text).replace(/\s+/g, ' ').trim();
}

interface Heading { id: string; text: string; level: number; start: number; end: number; html: string }

function readHeadings(html: string): Heading[] {
  const headings: Heading[] = [];
  for (const match of html.matchAll(/<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1>/g)) {
    const id = match[2].match(/\bid="([^"]*)"/)?.[1];
    if (!id) continue;
    headings.push({ id: decode(id), text: headingText(match[3]), level: Number(match[1]), start: match.index!, end: match.index! + match[0].length, html: match[0] });
  }
  return headings;
}

/**
 * Add presentation to HTML already produced by renderMarkdown. This function
 * is not an HTML sanitizer and must never receive raw clipboard HTML.
 * showTitle adds the draft title only when the source has no leading H1.
 * A leading source title always takes precedence, including its inline math.
 */
export function prepareDocumentHtml(renderedHtml: string, title: string, value: DocumentSettings = DEFAULT_DOCUMENT_SETTINGS): string {
  const settings = normalizeDocumentSettings(value);
  const headings = readHeadings(renderedHtml);
  const first = headings[0];
  const isLeadingTitle = first?.level === 1 && renderedHtml.slice(0, first.start).trim() === '';
  const normalizedTitle = title.replace(/\s+/g, ' ').trim();
  let body = renderedHtml;
  let header = '';
  if (isLeadingTitle || (settings.showTitle && normalizedTitle)) {
    const titleHtml = isLeadingTitle ? first.html : `<h1 class="document-cover-title">${escape(normalizedTitle)}</h1>`;
    if (isLeadingTitle) body = renderedHtml.slice(first.end).replace(/^\s*\n/, '');
    header = `<header class="document-masthead">${titleHtml}${settings.author ? `<p class="document-byline">${escape(settings.author)}</p>` : ''}</header>\n`;
  } else if (settings.author) header = `<p class="document-byline">${escape(settings.author)}</p>\n`;

  // A leading H1 is the document title; list the sections beneath it.
  const entries = headings.filter((heading) => !(isLeadingTitle && heading === first));
  let contents = '';
  if (settings.toc && entries.length) {
    // A document can contain many short headings within the source limit.
    // Avoid spreading them into a call, which can exceed the JS argument cap.
    const baseLevel = entries.reduce((level, heading) => Math.min(level, heading.level), 6);
    contents = `<nav class="document-contents" aria-label="Table of contents"><p class="document-contents-label">Contents</p><ol>${entries.map((heading) => `<li class="document-contents-level-${Math.min(heading.level - baseLevel, 3)}"><a href="#${escape(heading.id)}">${escape(heading.text || 'Untitled section')}</a></li>`).join('')}</ol></nav>\n`;
  }
  return `${header}${contents}<div class="document-body">${body}</div>`;
}

/** Scoped typography shared by the workspace preview, standalone HTML, and print. */
export function documentPresentationCss(value: DocumentSettings = DEFAULT_DOCUMENT_SETTINGS, selector = '.document-presentation'): string {
  const settings = normalizeDocumentSettings(value);
  const metrics = documentPageMetrics(settings);
  const faces = {
    clean: "Arial, Helvetica, sans-serif",
    study: "Georgia, 'Times New Roman', serif",
    academic: "'Times New Roman', Times, serif",
  };
  const lineHeight = settings.spacing === 'compact'
    ? { clean: 1.45, study: 1.52, academic: 1.35 }[settings.style]
    : { clean: 1.65, study: 1.78, academic: 1.55 }[settings.style];
  const accent = { clean: '#315867', study: '#38675e', academic: '#593641' }[settings.style];
  return `${selector}{--doc-font:${faces[settings.style]};--doc-text:#252a2e;--doc-muted:#636a70;--doc-border:#dce1e2;--doc-code-bg:#f4f6f6;--doc-accent:${accent};color:var(--doc-text);font-family:var(--doc-font);font-size:${settings.fontSize}pt;line-height:${lineHeight};background:#fff;color-scheme:light}
${selector} .document-body>:first-child{margin-top:0}
${selector} .document-masthead{margin:0 0 2em;padding:0 0 1.25em;border-bottom:1px solid var(--doc-border);break-inside:avoid}
${selector} .document-masthead h1{margin:0;font-size:${settings.style === 'academic' ? '1.9' : '2.15'}em;line-height:1.2;font-weight:${settings.style === 'academic' ? '700' : '600'};letter-spacing:-.035em}
${selector} .document-byline{margin:.9em 0 0;color:var(--doc-muted);font:400 .82em/1.5 Arial,Helvetica,sans-serif}
${selector}>.document-byline{margin:0 0 1.6em}
${selector} h2{color:${settings.style === 'academic' ? '#252a2e' : accent};font-size:${settings.style === 'academic' ? '1.25' : '1.3'}em}
${selector} h3{font-size:1.08em}
${selector} blockquote{font-style:${settings.style === 'study' ? 'italic' : 'normal'};background:${settings.style === 'study' ? '#f4f8f5' : 'transparent'};padding:${settings.style === 'study' ? '.8em 1.1em' : '.15em 0 .15em 1.15em'}}
${selector} pre,${selector} code{font-family:ui-monospace,SFMono-Regular,Consolas,'Liberation Mono',monospace}
${selector} pre{font-size:.8em;line-height:1.6;border-radius:${settings.style === 'academic' ? '0' : '5px'}}
${selector} th{font:600 .91em/1.5 Arial,Helvetica,sans-serif;color:var(--doc-text)}
${selector} :is(th,td){padding:.65em .85em}
${selector} .document-contents{margin:0 0 2em;padding:1.15em 1.35em;border:1px solid var(--doc-border);border-radius:${settings.style === 'academic' ? '0' : '5px'};background:#fafbfb;break-inside:avoid}
${selector} .document-contents-label{margin:0 0 .65em;font:600 .7em/1.4 Arial,Helvetica,sans-serif;text-transform:uppercase;letter-spacing:.12em;color:var(--doc-muted)}
${selector} .document-contents ol{list-style:none;margin:0;padding:0;font-size:.87em}
${selector} .document-contents li{padding:0;margin:.32em 0;line-height:1.5}
${selector} .document-contents .document-contents-level-1{padding-left:1.1em}
${selector} .document-contents .document-contents-level-2{padding-left:2.2em}
${selector} .document-contents .document-contents-level-3{padding-left:3.3em}
${selector} .document-contents a{color:var(--doc-text);text-decoration:none}
${settings.style === 'academic' ? `${selector} .document-masthead{text-align:center;border-bottom:0;padding-bottom:.5em}${selector} .document-masthead h1{letter-spacing:-.02em}${selector} .document-contents{background:white}` : ''}
@media print{@page{size:${settings.paper === 'a4' ? 'A4' : 'letter'} ${settings.orientation};margin:${metrics.marginMm}mm}${selector}{font-size:${settings.fontSize}pt!important;line-height:${lineHeight};background:white!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}${selector} .document-body>h2:not(:first-child){break-before:${settings.breakBeforeSections ? 'page' : 'auto'}}${selector} pre,${selector} blockquote{break-inside:auto;box-decoration-break:clone}${selector} .document-contents{break-inside:auto}${selector} .document-contents li{break-inside:avoid}${selector} table{display:table;width:auto;max-width:100%;overflow:visible}${selector} .katex-display{overflow:visible}}
`;
}

/** Check the mounted typography preview, without claiming exact pagination. */
export function inspectPrintLayout(article: HTMLElement, value: DocumentSettings = DEFAULT_DOCUMENT_SETTINGS): string[] {
  const messages: string[] = [];
  const settings = normalizeDocumentSettings(value);
  const metrics = documentPageMetrics(settings);
  const styles = getComputedStyle(article);
  const contentWidth = article.clientWidth - (parseFloat(styles.paddingLeft) || 0) - (parseFloat(styles.paddingRight) || 0);
  if (contentWidth <= 0) return messages;
  const equations = article.querySelectorAll<HTMLElement>('.katex-display');
  const tables = article.querySelectorAll<HTMLElement>('table');
  const images = article.querySelectorAll<HTMLImageElement>('img');
  const maxChecks = 1000;
  const overflow = (elements: NodeListOf<HTMLElement>) => [...elements].slice(0, maxChecks)
    .filter((element) => Math.max(element.scrollWidth, element.offsetWidth) > contentWidth + 3).length;
  const wideEquations = overflow(equations);
  const wideTables = overflow(tables);
  if (wideEquations) messages.push(`${wideEquations} equation${wideEquations === 1 ? '' : 's'} may be wider than the page. Try landscape or split a long calculation into aligned lines.`);
  if (wideTables) messages.push(`${wideTables} table${wideTables === 1 ? '' : 's'} may be wider than the page. Try landscape, smaller type, or fewer columns.`);
  const errors = article.querySelectorAll('.math-error').length;
  if (errors) messages.push(`${errors} formula${errors === 1 ? '' : 's'} could not be typeset. Review the highlighted source before sharing.`);
  const placeholders = article.querySelectorAll('.image-placeholder').length;
  if (placeholders) messages.push(`${placeholders} image${placeholders === 1 ? ' is' : 's are'} shown as a placeholder. Check image settings if you want to include ${placeholders === 1 ? 'it' : 'them'}.`);
  const failedImages = [...images].slice(0, maxChecks).filter((image) => image.complete && image.naturalWidth === 0).length;
  if (failedImages) messages.push(`${failedImages} image${failedImages === 1 ? '' : 's'} could not be loaded. Check the image source before printing.`);
  const pageHeight = metrics.contentHeightMm * 96 / 25.4;
  const longCode = [...article.querySelectorAll<HTMLElement>('pre')].slice(0, maxChecks).filter((element) => element.scrollHeight > pageHeight).length;
  if (longCode) messages.push(`${longCode} code block${longCode === 1 ? '' : 's'} will span multiple pages. Check the line breaks in the browser print preview.`);
  if (equations.length > maxChecks || tables.length > maxChecks || images.length > maxChecks) messages.push('This is a large document. Review the complete browser print preview before saving.');
  return messages;
}
