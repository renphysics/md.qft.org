import MarkdownIt, { type Token } from 'markdown-it';
import { katex as mathPlugin } from '@mdit/plugin-katex';
import { footnote } from '@mdit/plugin-footnote';
import { renderSlides } from './slides';
import { MAX_SOURCE_LENGTH, type RenderOptions } from './render-markdown';
import { findInteractiveFences, MAX_INTERACTIVE_DEMOS, MAX_INTERACTIVE_CODE_LENGTH } from './interactive-demos';
import { projectFilePath } from './lesson-project';
import { imageReference } from './image-assets';

export interface LessonIssue {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  line?: number;
}

export interface LessonReport { issues: LessonIssue[]; slides: number; demos: number }

const embeddedRaster = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/i;
const parser = new MarkdownIt({ html: false, linkify: false, typographer: false })
  .use(mathPlugin, { delimiters: 'all', mathFence: false, allowInlineWithSpace: false })
  .use(footnote);
const MAX_ISSUES = 100;

function issueCode(message: string): string {
  if (/KaTeX|formula|Undefined control sequence|ParseError/i.test(message)) return 'math';
  if (/slide.*limit|slide preview limit/i.test(message)) return 'slide-limit';
  if (/demo|interactive|HTML file/i.test(message)) return 'demo';
  return 'render';
}

/** Structural compatibility only. No demo code is run and no network request is made. */
export function checkLesson(source: string, options: RenderOptions = {}): LessonReport {
  const report: LessonReport = { issues: [], slides: 0, demos: 0 };
  const seen = new Set<string>();
  let omitted = false;
  const add = (issue: LessonIssue): void => {
    const key = `${issue.code}:${issue.line ?? ''}:${issue.message}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (report.issues.length >= MAX_ISSUES) { omitted = true; return; }
    report.issues.push(issue);
  };
  if (typeof source !== 'string' || source.length > MAX_SOURCE_LENGTH) {
    add({ severity: 'error', code: 'source-limit', line: 1, message: 'Keep the lesson Markdown below 400,000 characters so it can be previewed and checked.' });
    return report;
  }
  if (!source.trim()) {
    add({ severity: 'warning', code: 'empty-lesson', line: 1, message: 'Add lesson content before presenting.' });
    return report;
  }

  const demos = findInteractiveFences(source);
  const demoErrorLines = new Set(demos.filter((demo) => demo.error).map((demo) => demo.line));
  const rendered = renderSlides(source, { ...options, editableDemos: false });
  report.slides = rendered.slides.length;
  for (const error of rendered.errors) add({ severity: 'error', code: demoErrorLines.has(error.line) ? 'demo' : issueCode(error.message), message: error.message, line: error.line });

  // Parse images as Markdown tokens so literal syntax inside code is not flagged.
  const walk = (tokens: Token[], inheritedLine = 1): void => {
    let line = inheritedLine;
    for (const token of tokens) {
      if (token.map) line = token.map[0] + 1;
      if (token.type === 'image') {
        const reference = String(token.attrGet('src') ?? '');
        const description = token.content.trim();
        if (!description) add({ severity: 'warning', code: 'image-description', message: 'Give this image a short description for readers and screen readers.', line });
        if (/^https?:\/\//i.test(reference)) {
          add({ severity: 'warning', code: 'remote-image', line, message: `${options.allowRemoteImages ? 'This image depends on a remote host' : 'This remote image is currently blocked'}: ${reference.slice(0, 180)}. Insert a local image for reliable classroom use and portable export.` });
        } else if (reference.startsWith('qft-image:')) {
          if (!options.imageSources?.has(reference)) add({ severity: 'error', code: 'missing-image', line, message: 'An attached image is missing. Insert it again, or reopen the complete project ZIP.' });
        } else if (!embeddedRaster.test(reference)) {
          const projectPath = options.project ? projectFilePath(reference, options.project.document) : undefined;
          const image = options.project?.imagePaths.find((item) => item.path === projectPath);
          if (!image || !options.imageSources?.has(imageReference(image.imageId))) {
            add({ severity: 'error', code: 'missing-image', line, message: `Image not available: ${reference.slice(0, 180) || '(empty path)'}. Use Insert image, or include the raster file in the project ZIP.` });
          }
        }
      }
      if (token.children) walk(token.children, line);
    }
  };
  walk(parser.parse(source, {}));

  report.demos = demos.length;
  for (const demo of demos.slice(0, MAX_INTERACTIVE_DEMOS)) {
    if (demo.preset || demo.error) continue; // Renderer reports invalid fences/settings.
    const path = demo.src && options.project ? projectFilePath(demo.src, options.project.document) : undefined;
    const html = demo.src ? options.project?.files.find((file) => file.path === path)?.content : demo.body;
    if (!html || html.length > MAX_INTERACTIVE_CODE_LENGTH) continue; // The renderer reports missing/oversized HTML.
    const contents = html.replace(/<!--[\s\S]*?-->/g, '');
    const prefix = demo.src ? `Demo “${demo.src}”` : 'This demo';
    const warn = (code: string, message: string) => add({ severity: 'warning', code, message: `${prefix}: ${message}`, line: demo.line });
    if (/<script\b[^>]*\bsrc\s*=/i.test(contents) || /<link\b/i.test(contents)) {
      warn('demo-linked-code', 'linked scripts and stylesheets cannot load. Put the needed JavaScript and CSS directly inside the HTML file.');
    }
    if (/<(?:iframe|object|embed)\b/i.test(contents)) warn('demo-embedded-frame', 'embedded frames and external objects are blocked. Include the demonstration itself in this file.');
    if (/<[a-z][^>]*\s+on[a-z]+\s*=/i.test(contents)) warn('demo-inline-event', 'inline event attributes are removed. Attach handlers with addEventListener.');
    if (/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|Worker|SharedWorker)\s*\(/.test(contents)
      || /\bimport\s*(?:\(|[\w*{][^;\n]*\bfrom\s*['"]|['"])/.test(contents)) {
      warn('demo-network', 'network requests, module imports, and workers are unavailable. Include the required data and code in the HTML.');
    }
    let linkedImage = false;
    for (const match of contents.matchAll(/<(?:img|source)\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
      if (!embeddedRaster.test(match[1] ?? match[2] ?? match[3] ?? '')) linkedImage = true;
    }
    if (linkedImage || /\burl\(\s*['"]?(?!data:image\/(?:png|jpeg|webp|gif);base64,)[^)'"\s]/i.test(contents)) {
      warn('demo-linked-image', 'linked image/CSS resources cannot load in the demo. Embed raster data images directly or draw the figure on canvas.');
    }
    if (/\b(?:localStorage|sessionStorage|indexedDB)\b/.test(contents)) warn('demo-storage', 'browser storage is unavailable inside the demo. Keep its state in memory and define initial values in the source.');
  }

  for (const [index, slide] of rendered.slides.entries()) {
    const demoCount = [...slide.html.matchAll(/<figure\b[^>]*\bclass="qft-demo"/g)].length;
    if (demoCount > 1) {
      add({ severity: 'warning', code: 'demo-layout', line: slide.startLine + 1, message: `Slide ${index + 1} has ${demoCount} demonstrations. Give each demo its own slide with a short heading so the controls have room.` });
    }
    const plain = slide.html.replace(/<template\b[\s\S]*?<\/template>/gi, '').replace(/<[^>]*>/g, ' ');
    if (plain.split(/\s+/).filter(Boolean).length > 180) {
      add({ severity: 'warning', code: 'dense-slide', line: slide.startLine + 1, message: `Slide ${index + 1} may be crowded. Rehearse it in Present mode and split long explanations across slides.` });
    }
  }
  if (omitted) report.issues.push({ severity: 'info', code: 'issue-limit', message: 'Additional issues were omitted. Fix the reported issues and run Check lesson again.' });
  return report;
}

/** The teacher can paste this report directly into the same AI conversation. */
export function formatLessonReport(report: LessonReport): string {
  const errors = report.issues.filter((issue) => issue.severity === 'error').length;
  const warnings = report.issues.filter((issue) => issue.severity === 'warning').length;
  const heading = `QFT Markdown lesson compatibility check\n${report.slides} slide${report.slides === 1 ? '' : 's'} · ${report.demos} demo${report.demos === 1 ? '' : 's'} · ${errors} error${errors === 1 ? '' : 's'} · ${warnings} warning${warnings === 1 ? '' : 's'}`;
  const issues = report.issues.length
    ? report.issues.map((issue) => `- ${issue.severity.toUpperCase()} [${issue.code}]${issue.line ? ` line ${issue.line}` : ''}: ${issue.message}`).join('\n')
    : 'No structural compatibility issues were found.';
  return `${heading}\n\n${issues}\n\nThis is a static check, not a test of scientific correctness, visual fit, or JavaScript behavior. Run each demo and rehearse the exported presentation before class.\n\nFor AI revision: fix the listed issues in the complete project, retain its projectId and file paths, and return the updated ZIP. Format: https://md.qft.org/lesson-format-v2.md\n`;
}
