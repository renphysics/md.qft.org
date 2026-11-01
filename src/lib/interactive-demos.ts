import { DEMO_PRESETS } from './demo-presets';

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

export function isInteractiveFence(info: string): boolean {
  return /^interactive(?:\s|$)/.test(info.trim());
}

/** Generate a fence that cannot be prematurely closed by the demo's own code. */
export function interactiveFence(value: { preset?: string; title?: string; html?: string }): string {
  if (value.preset) {
    if (!DEMO_PRESETS.some((preset) => preset.id === value.preset)) throw new Error('Choose one of the available interactive demos.');
    return `\`\`\`interactive ${value.preset}\n\`\`\`\n`;
  }
  const html = value.html ?? '';
  if (!html.trim()) throw new Error('Add the HTML and JavaScript for your demonstration.');
  const content = html.replace(/\n?$/, '\n');
  if (content.length > MAX_INTERACTIVE_CODE_LENGTH) throw new Error(`An interactive demo can contain up to ${MAX_INTERACTIVE_CODE_LENGTH.toLocaleString('en-US')} characters.`);
  const title = (value.title ?? 'Interactive demo').replace(/[\r\n\u0000-\u001f]/g, ' ').trim().slice(0, 100) || 'Interactive demo';
  const longest = Math.max(0, ...[...html.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  const titleOption = JSON.stringify(title).replace(/`/g, '\\u0060');
  return `${fence}interactive title=${titleOption}\n${content}${fence}\n`;
}

/** HTML is carried as inert template text, never injected into the workspace. */
export function renderInteractiveFence(info: string, body: string, sourceLine: number): InteractiveFenceResult {
  const errorCard = (message: string): InteractiveFenceResult => ({
    error: message,
    html: `<div class="qft-demo-error" role="note"><strong>Interactive demo</strong><p>${escape(message)}</p></div>\n`,
  });
  if (body.length > MAX_INTERACTIVE_CODE_LENGTH) return errorCard('This interactive demo exceeds the 100,000-character limit. Its source is still preserved in your Markdown.');
  let extra = info.trim().slice('interactive'.length).trim();
  let presetId: string | undefined;
  if (extra && !extra.startsWith('title=')) {
    const match = /^([a-z][a-z0-9-]*)(?:\s+|$)/.exec(extra);
    if (!match) return errorCard('Use interactive followed by a built-in demo name, or title="Your title" for custom HTML.');
    presetId = match[1];
    extra = extra.slice(match[0].length).trim();
  }
  let title: string | undefined;
  if (extra) {
    const match = /^title=("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')$/.exec(extra);
    if (!match) return errorCard('The only supported demo option is a quoted title, for example title="Wave packet".');
    try {
      title = match[1].startsWith('"') ? JSON.parse(match[1]) as string : match[1].slice(1, -1).replace(/\\(['\\])/g, '$1');
    } catch { return errorCard('The interactive demo title has an invalid quoted value.'); }
    title = title.replace(/[\r\n\u0000-\u001f]/g, ' ').trim().slice(0, 100);
  }
  const preset = presetId ? DEMO_PRESETS.find((item) => item.id === presetId) : undefined;
  if (presetId && !preset) return errorCard(`Unknown interactive demo “${presetId}”. Choose wave-packet, bloch-sphere, effective-potential, or interference.`);
  if (preset && body.trim()) return errorCard('A built-in demo fence should be empty. Remove the demo name to use custom HTML instead.');
  if (!preset && !body.trim()) return errorCard('Add self-contained HTML, CSS, and JavaScript inside this interactive fence.');
  const payload: InteractiveDemoPayload = {
    version: 1,
    title: title || preset?.title || 'Interactive demo',
    description: preset?.description || 'A self-contained HTML and JavaScript demonstration. Run it to use its controls.',
    html: preset?.html ?? body,
    ...(preset ? { preset: preset.id } : {}),
  };
  const id = `demo-${fingerprint(`${info}\n${body}`)}-${Math.max(0, sourceLine)}`;
  const poster = preset?.poster || '<div class="qft-demo-placeholder"><svg viewBox="0 0 64 64" aria-hidden="true"><rect x="6" y="10" width="52" height="44" rx="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="m26 22 16 10-16 10z" fill="currentColor"/></svg><strong>Ready to explore</strong><span>Run this demo to interact with it.</span></div>';
  return { html: `<figure class="qft-demo" data-demo-id="${id}" data-demo-state="idle"${preset ? ` data-demo-preset="${escape(preset.id)}"` : ''}>
<div class="qft-demo-heading"><span class="qft-demo-kicker">Interactive demo</span><strong>${escape(payload.title)}</strong></div>
<div class="qft-demo-stage"><div class="qft-demo-poster" data-demo-poster>${poster}</div><div class="qft-demo-frame" data-demo-frame></div></div>
<figcaption class="qft-demo-caption"><span data-demo-description>${escape(payload.description)}</span><span class="qft-demo-status" data-demo-status role="status" aria-live="polite">Ready when you are</span></figcaption>
<div class="qft-demo-controls"><button type="button" data-demo-run><span aria-hidden="true">▶</span> Run demo</button><button type="button" data-demo-stop hidden>Stop</button><button type="button" data-demo-restart hidden>Restart</button><span>Runs in this browser</span></div>
<template data-demo-source>${escape(JSON.stringify(payload))}</template>
</figure>\n` };
}
