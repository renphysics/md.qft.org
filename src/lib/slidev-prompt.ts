import type { LessonAIInput } from './ai-lesson';

/** The oldest Node.js that the Slidev release the site was checked with (53.1.0) runs on. */
const SLIDEV_PROMPT_NODE = '22.22';

/**
 * Instructions for an AI assistant that can run commands to make an ordinary
 * Slidev project and build it; the site plays the built dist folder. No
 * request is sent here.
 */
export function generateSlidevPrompt(input: LessonAIInput): string {
  const clean = (value: unknown, fallback: string, limit: number) => typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, limit) || fallback : fallback;
  const duration = Number.isFinite(input.duration) ? Math.max(5, Math.min(240, Math.round(input.duration))) : 45;
  return `Create a Slidev presentation that plays offline in the presentation player at md.qft.org.

LESSON BRIEF
Topic or chapter: ${clean(input.topic, 'My lesson', 3000)}
Audience: ${clean(input.audience, 'Undergraduate students', 300)}
Language: ${clean(input.language, 'English', 100)}
Class duration: ${duration} minutes
Mathematical depth: ${clean(input.mathLevel, 'Match the audience and define every symbol', 300)}
Interactive demonstrations: ${clean(input.demos, 'One useful demonstration with labeled controls', 600)}

TEACHING
One idea per slide, a worked example, a prediction question before each demo, and a short recap; leave time for interaction. Ground the lesson in any chapter I attach and never invent sources. Give every control a label and make it work with the keyboard.

PROJECT
- Make an ordinary Slidev project: slides.md, Vue components in components/, pictures and media in public/.
- package.json depends on @slidev/cli and @slidev/theme-default (or the theme slides.md names). Keep Slidev's default base and router settings.
- In the headmatter of slides.md set fonts: { provider: 'none' }. Use system fonts.
- Use \`$...$\` and \`$$...$$\` for math (KaTeX is built in), v-click for steps, and Vue components with canvas or SVG for demos.

RULES THAT KEEP IT PLAYABLE HERE
- No {monaco} code blocks and no Web Workers.
- Put every picture and media file in public/ or import it in a component; nothing may load from the internet while the slides play: no CDN files, web fonts, remote pictures, remote APIs or fetch.
- Install libraries with npm and import them; never with script tags.

BUILD AND DELIVER
Use Node.js ${SLIDEV_PROMPT_NODE} or newer. Run npm install, then npx slidev build, which writes the dist/ folder. Deliver ONE ZIP of the project folder with the built dist/ folder inside and without node_modules. md.qft.org plays dist/; I keep the rest to make changes later. If you cannot run commands, say so plainly and give me the project files plus the exact commands to run.
Optional: the starter at https://md.qft.org/slidev/interactive-physics.zip shows a working example and a packaging tool (pack.mjs); an ordinary build is enough.

HAND-OVER
I will open the ZIP on md.qft.org and read the notes from its check. If I paste a report from md.qft.org, change slides.md or the components, build again, and send the whole new ZIP. Changing the source alone does not change what plays.`;
}
