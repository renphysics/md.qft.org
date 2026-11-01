import MarkdownIt from 'markdown-it';
import { katex as mathPlugin } from '@mdit/plugin-katex';
import { footnote } from '@mdit/plugin-footnote';
import { DEMO_PRESETS, configureDemoPreset } from './demo-presets';
import { normalizeDemoSettings, type DemoSettings } from './demo-settings';
import { projectFilePath, type LessonProject } from './lesson-project';

/** The Markdown source stays portable; only this explicitly named fence can run. */
export const MAX_INTERACTIVE_CODE_LENGTH = 100_000;
export const MAX_INTERACTIVE_DEMOS = 20;

export interface InteractiveDemoPayload {
  version: 1;
  title: string;
  description: string;
  html: string;
  preset?: string;
}

export interface InteractiveFenceResult { html: string; error?: string }
export interface InteractiveFenceOptions {
  preset?: string;
  title?: string;
  html?: string;
  src?: string;
  settings?: DemoSettings;
}
export interface InteractiveFenceSource {
  from: number;
  to: number;
  /** One-based source line; stable across document and slides views. */
  line: number;
  info: string;
  body: string;
  sourceKey: string;
  prefix: string;
  preset?: string;
  title?: string;
  src?: string;
  settings?: DemoSettings;
  error?: string;
}
export interface InteractiveRenderOptions {
  project?: LessonProject;
  editableDemos?: boolean;
}

function escape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fingerprint(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function sourceKey(info: string, body: string, sourceLine: number): string {
  return `${fingerprint(`${info}\n${body}`)}-${Math.max(0, sourceLine)}`;
}

export function isInteractiveFence(info: string): boolean {
  return /^interactive(?:\s|$)/.test(info.trim());
}

function cleanTitle(title: string): string {
  return title.replace(/[\r\n\u0000-\u001f]/g, ' ').trim().slice(0, 100);
}

/** Parse only the documented literal options. No expressions or HTML are evaluated. */
function readFence(info: string, body: string): Pick<InteractiveFenceSource, 'preset' | 'title' | 'src' | 'settings' | 'error'> {
  const value: ReturnType<typeof readFence> = {};
  try {
    let extra = info.trim().slice('interactive'.length).trim();
    if (extra && !/^[a-z][a-z0-9-]*=/.test(extra)) {
      const match = /^([a-z][a-z0-9-]*)(?:\s+|$)/.exec(extra);
      if (!match) throw new Error('Use interactive followed by a built-in demo name, or a quoted title and src for custom HTML.');
      value.preset = match[1];
      extra = extra.slice(match[0].length).trim();
    }
    const seen = new Set<string>();
    while (extra) {
      const match = /^(title|src)=("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')(?:\s+|$)/.exec(extra);
      if (!match) throw new Error('Use quoted title="Your title" and src="demos/example.html" options.');
      const key = match[1] as 'title' | 'src';
      if (seen.has(key)) throw new Error(`The ${key} option can appear only once.`);
      seen.add(key);
      const decoded: string = match[2].startsWith('"') ? JSON.parse(match[2]) : match[2].slice(1, -1).replace(/\\(['\\])/g, '$1');
      value[key] = key === 'title' ? cleanTitle(decoded) : decoded;
      extra = extra.slice(match[0].length).trim();
    }
    if (value.preset && !DEMO_PRESETS.some(item => item.id === value.preset)) {
      throw new Error(`Unknown interactive demo “${value.preset}”. Choose wave-packet, bloch-sphere, effective-potential, or interference.`);
    }
    if (value.preset && value.src !== undefined) throw new Error('Choose a built-in demo or a demo file, not both in the same fence.');
    if (value.src !== undefined) {
      if (!value.src || /[\r\n\u0000-\u001f]/.test(value.src)) throw new Error('Choose a relative HTML file path for this demo.');
      if (body.trim()) throw new Error('A demo with a src file must have an empty fence body. Edit the HTML file to change its code.');
    } else if (value.preset) {
      let settings: unknown = {};
      if (body.trim()) {
        try { settings = JSON.parse(body); }
        catch { throw new Error('Built-in demo settings must be a JSON object, for example {"time":0}.'); }
      }
      value.settings = normalizeDemoSettings(value.preset, settings);
    } else if (!body.trim()) throw new Error('Add self-contained HTML, CSS, and JavaScript inside this interactive fence.');
  } catch (error) {
    value.error = error instanceof Error ? error.message : 'This interactive demo could not be read.';
  }
  return value;
}

/** Generate a fence that cannot be prematurely closed by the demo's own code. */
export function interactiveFence(value: InteractiveFenceOptions): string {
  const title = cleanTitle(value.title ?? '') || undefined;
  const quote = (text: string) => JSON.stringify(text).replace(/`/g, '\\u0060');
  if (value.preset) {
    if (value.src !== undefined || value.html !== undefined) throw new Error('Choose a built-in demo or custom HTML.');
    if (!DEMO_PRESETS.some(preset => preset.id === value.preset)) throw new Error('Choose one of the available interactive demos.');
    const settings = value.settings === undefined ? '' : JSON.stringify(normalizeDemoSettings(value.preset, value.settings), null, 2) + '\n';
    return `\`\`\`interactive ${value.preset}${title ? ` title=${quote(title)}` : ''}\n${settings}\`\`\`\n`;
  }
  if (value.src !== undefined) {
    if (value.html !== undefined || value.settings !== undefined) throw new Error('A demo file reference cannot also contain inline code or built-in settings.');
    if (!value.src || /[\r\n\u0000-\u001f]/.test(value.src)) throw new Error('Choose a relative HTML file path for this demo.');
    return `\`\`\`interactive src=${quote(value.src)}${title ? ` title=${quote(title)}` : ''}\n\`\`\`\n`;
  }
  if (value.settings !== undefined) throw new Error('Initial settings apply to built-in demos. Set custom starting values in the HTML code.');
  const html = value.html ?? '';
  if (!html.trim()) throw new Error('Add the HTML and JavaScript for your demonstration.');
  const content = html.replace(/\n?$/, '\n');
  if (content.length > MAX_INTERACTIVE_CODE_LENGTH) throw new Error(`An interactive demo can contain up to ${MAX_INTERACTIVE_CODE_LENGTH.toLocaleString('en-US')} characters.`);
  const longest = Math.max(0, ...[...html.matchAll(/`+/g)].map(match => match[0].length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}interactive title=${quote(title || 'Interactive demo')}\n${content}${fence}\n`;
}

/** Actual Markdown tokens, not text matching, keep code examples and nested fences distinct. */
export function findInteractiveFences(source: string): InteractiveFenceSource[] {
  const parser = new MarkdownIt({ html: false, linkify: false, typographer: false })
    .use(mathPlugin, { delimiters: 'all', mathFence: false, allowInlineWithSpace: false }).use(footnote);
  const offsets = [0];
  for (const match of source.matchAll(/\r\n?|\n/g)) offsets.push(match.index + match[0].length);
  const results: InteractiveFenceSource[] = [];
  for (const token of parser.parse(source, {})) {
    if (token.type !== 'fence' || !token.map || !isInteractiveFence(token.info)) continue;
    const from = offsets[token.map[0]], to = offsets[token.map[1]] ?? source.length;
    const firstLine = source.slice(from, offsets[token.map[0] + 1] ?? to);
    const prefix = firstLine.match(/^(.*?)(?:`{3,}|~{3,})/)?.[1] ?? '';
    results.push({
      from, to, line: token.map[0] + 1, info: token.info, body: token.content,
      sourceKey: sourceKey(token.info, token.content, token.map[0]), prefix,
      ...readFence(token.info, token.content),
    });
  }
  return results.sort((a, b) => a.from - b.from);
}

/** Preserve list/blockquote indentation when the editor replaces a whole fence. */
export function replaceInteractiveFence(source: string, original: InteractiveFenceSource, replacement: string): string {
  const current = findInteractiveFences(source).find(entry => entry.sourceKey === original.sourceKey);
  if (!current || current.from !== original.from || current.to !== original.to) throw new Error('This demo changed while it was being edited. Open Edit demo again.');
  const prefix = current.prefix;
  const continuation = prefix
    .replace(/\[\^[^\]]+\]:[ \t]*/g, '    ')
    .replace(/(?:[-+*]|\d+[.)])(?=\s)/g, match => ' '.repeat(match.length));
  const rows = replacement.replace(/\n$/, '').split('\n');
  const next = rows.map((row, index) => (index ? continuation : prefix) + row).join('\n') + '\n';
  return source.slice(0, current.from) + next + source.slice(current.to);
}

/** HTML is carried as inert template text, never injected into the workspace. */
export function renderInteractiveFence(info: string, body: string, sourceLine: number, options: InteractiveRenderOptions = {}): InteractiveFenceResult {
  const key = sourceKey(info, body, sourceLine);
  const editButton = options.editableDemos ? '<button type="button" data-demo-edit>Edit demo</button>' : '';
  const errorCard = (message: string): InteractiveFenceResult => ({
    error: message,
    html: `<div class="qft-demo-error" data-demo-source-key="${key}" role="note"><strong>Interactive demo</strong><p>${escape(message)}</p>${editButton}</div>\n`,
  });
  if (body.length > MAX_INTERACTIVE_CODE_LENGTH) return errorCard('This interactive demo exceeds the 100,000-character limit. Its source is still preserved in your Markdown.');
  const parsed = readFence(info, body);
  if (parsed.error) return errorCard(parsed.error);
  let html = body;
  let preset = parsed.preset ? configureDemoPreset(parsed.preset, parsed.settings) : undefined;
  if (parsed.src !== undefined) {
    if (!options.project) return errorCard('Import the lesson ZIP to load this separate demo file. A Markdown file alone does not include its demo code.');
    const path = projectFilePath(parsed.src, options.project.document);
    if (!path || !/\.html?$/i.test(path)) return errorCard('Demo src must name an HTML file inside this lesson project.');
    const file = options.project.files.find(entry => entry.path === path);
    if (!file) return errorCard(`The demo file “${path}” is missing from this lesson project.`);
    if (!file.content.trim()) return errorCard(`The demo file “${path}” is empty. Add self-contained HTML and JavaScript.`);
    if (file.content.length > MAX_INTERACTIVE_CODE_LENGTH) return errorCard('This interactive demo file exceeds the 100,000-character limit. Its source is still preserved in the lesson project.');
    html = file.content;
  }
  const payload: InteractiveDemoPayload = {
    version: 1,
    title: parsed.title || preset?.title || 'Interactive demo',
    description: preset?.description || 'A self-contained HTML and JavaScript demonstration. Run it to use its controls.',
    html: preset?.html ?? html,
    ...(preset ? { preset: preset.id } : {}),
  };
  const id = `demo-${key}`;
  const poster = preset?.poster || '<div class="qft-demo-placeholder"><svg viewBox="0 0 64 64" aria-hidden="true"><rect x="6" y="10" width="52" height="44" rx="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="m26 22 16 10-16 10z" fill="currentColor"/></svg><strong>Ready to explore</strong><span>Run this demo to interact with it.</span></div>';
  return { html: `<figure class="qft-demo" data-demo-id="${id}" data-demo-source-key="${key}" data-demo-state="idle"${preset ? ` data-demo-preset="${escape(preset.id)}"` : ''}>
<div class="qft-demo-heading"><span class="qft-demo-kicker">Interactive demo</span><strong>${escape(payload.title)}</strong></div>
<div class="qft-demo-stage"><div class="qft-demo-poster" data-demo-poster>${poster}</div><div class="qft-demo-frame" data-demo-frame></div></div>
<figcaption class="qft-demo-caption"><span data-demo-description>${escape(payload.description)}</span><span class="qft-demo-status" data-demo-status role="status" aria-live="polite">Ready when you are</span></figcaption>
<div class="qft-demo-controls"><button type="button" data-demo-run><span aria-hidden="true">▶</span> Run demo</button><button type="button" data-demo-stop hidden>Stop</button><button type="button" data-demo-restart hidden>Restart</button>${editButton}<span>Runs in this browser</span></div>
<template data-demo-source>${escape(JSON.stringify(payload))}</template>
</figure>\n` };
}
