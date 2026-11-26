import type { LessonAIInput } from './ai-lesson';

/** Instructions for a coding tool that can build Slidev; no request is sent here. */
export function generateSlidevPrompt(input: LessonAIInput): string {
  const clean = (value: unknown, fallback: string, limit: number) => typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, limit) || fallback : fallback;
  const duration = Number.isFinite(input.duration) ? Math.max(5, Math.min(240, Math.round(input.duration))) : 45;
  return `Create a complete, ready-to-present Slidev lesson for the local ZIP player at md.qft.org.

LESSON BRIEF
Topic or chapter: ${clean(input.topic, 'My lesson', 3000)}
Audience: ${clean(input.audience, 'Undergraduate students', 300)}
Language: ${clean(input.language, 'English', 100)}
Class duration: ${duration} minutes
Mathematical depth: ${clean(input.mathLevel, 'Match the audience and define every symbol', 300)}
Interactive demonstrations: ${clean(input.demos, 'One useful demonstration with labeled controls', 600)}

TEACHING AND DESIGN
Explain prerequisites, assumptions, and notation. Use one main idea per slide, readable figures and equations, a worked example, a prediction question before each demo, and a short recap. Leave time for interaction within the class duration. If I provide a chapter, ground the lesson in it and cite page or section references; identify missing material rather than inventing sources. Include meaningful accessible labels and keyboard-operable controls. Respect reduced-motion preferences and stop expensive animation when its slide is inactive.

USE THE WORKING STARTER
Use the source/ project in the attached Slidev starter ZIP. If no starter is attached, obtain the tools/slidev directory from https://github.com/renphysics/md.qft.org or the prepared example at https://md.qft.org/slidev/interactive-physics.zip. Keep the pinned dependencies, pack.mjs, the portable Vite configuration, and the license notices. Use normal Vue components for interactive diagrams and import required libraries before building.

PORTABLE PLAYBACK REQUIREMENTS
- Preserve routerMode: memory and the starter's temporary-storage compatibility adapter. Keep presenter windows, PWA registration, recording, and Monaco disabled.
- Include JavaScript, CSS, math fonts, pictures, and data locally. Use fonts.provider: none and system or bundled fonts. No CDN scripts, remote APIs, fetch-at-playback, runtime URL imports, service workers, web workers, nested frames, forms, eval, or new Function.
- The presentation runs inside an opaque-origin sandbox. It cannot access the editor's storage, cookies, parent document, or local filesystem. Use Vue state for controls.
- Vue, SVG, Canvas, and compatible WebGL demonstrations are appropriate. Review a library's runtime requirements before including it. Merely adding a CDN link does not package the library.

BUILD AND DELIVER
Use Node.js 22.22 or newer, which the pinned Slidev 53.1.0 requires. From the starter source directory, run npm ci, then npm run build. Run:
node pack.mjs --dist .build --source . --out lesson.zip --title "Your lesson title"

Deliver lesson.zip, containing qft-presentation.json, the self-contained compiled presentation.html, and the editable source/ project including its lockfile and build instructions. Do not send only slides.md or an ordinary dist ZIP. Do not include node_modules, private files, credentials, or repository metadata. If you cannot run the build, say clearly that the source has not been compiled and provide exact build steps.

VERIFY
Open the packaged presentation in md.qft.org, visit every slide, and test each interaction with network access disabled. Check math, fonts, images, navigation, slider keyboard handling, and fullscreen layout. A successful compile does not establish offline compatibility. Summarize what you actually tested and any remaining limitations. When revising, update both source and compiled presentation; changing the source alone does not update playback.`;
}
