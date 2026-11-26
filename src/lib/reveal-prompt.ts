import type { LessonAIInput } from './ai-lesson';

/** The Reveal.js release the player supplies; decks name it so they also work elsewhere. */
export const REVEAL_PROMPT_VERSION = '6.0.2';

/** Instructions for a chat AI to write a single-file Reveal.js deck; no request is sent here. */
export function generateRevealPrompt(input: LessonAIInput): string {
  const clean = (value: unknown, fallback: string, limit: number) => typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, limit) || fallback : fallback;
  const duration = Number.isFinite(input.duration) ? Math.max(5, Math.min(240, Math.round(input.duration))) : 45;
  const cdn = `https://cdn.jsdelivr.net/npm/reveal.js@${REVEAL_PROMPT_VERSION}/dist`;
  return `Create a Reveal.js presentation that plays offline in the presentation player at md.qft.org.

LESSON BRIEF
Topic or chapter: ${clean(input.topic, 'My lesson', 3000)}
Audience: ${clean(input.audience, 'Undergraduate students', 300)}
Language: ${clean(input.language, 'English', 100)}
Class duration: ${duration} minutes
Mathematical depth: ${clean(input.mathLevel, 'Match the audience and define every symbol', 300)}
Interactive demonstrations: ${clean(input.demos, 'One useful demonstration with labeled controls', 600)}

FORMAT
- Deliver ONE self-contained file, index.html. Only if separate files are unavoidable, deliver a ZIP with index.html at the top and every file it uses.
- Load exactly these files from jsDelivr, with this exact version, and nothing else from the internet:
${cdn}/reveal.css
${cdn}/theme/white.css
${cdn}/reveal.js
${cdn}/plugin/notes.js
${cdn}/plugin/math.js
- Call Reveal.initialize({ width: 1280, height: 720, plugins: [RevealMath.KaTeX, RevealNotes] }). Write math as \\( ... \\) and \\[ ... \\].
- Ground the slides in any chapter I attach; never invent sources.
- One idea per slide. Use class="fragment" for step-by-step reveals and <aside class="notes"> for what I should say.
- Build each demo in an inline script with canvas or inline SVG, labeled controls and a Reset button. Attach handlers with addEventListener, never onclick attributes.
- No other libraries or CDN files, no web fonts, remote images, iframes, fetch or build step. Draw figures as inline SVG; embed pictures as data: URIs.

HAND-OVER
Give me index.html as a downloadable file. I will download it and open it on md.qft.org, which plays it locally in my browser. If I paste check notes from md.qft.org, fix what they list and return the whole file.`;
}
