import { createLessonProject, type LessonProject } from './lesson-project';

export interface LessonAIInput {
  topic: string;
  audience: string;
  language: string;
  duration: number;
  mathLevel: string;
  demos: string;
}

export interface StarterLesson {
  title: string;
  source: string;
  mode: 'slides';
  slideTheme: 'paper';
  slideRatio: '16:9';
  project: LessonProject;
}

function shortText(value: unknown, fallback: string, limit = 300): string {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit) || fallback : fallback;
}

function lessonInput(input: LessonAIInput): LessonAIInput {
  return {
    topic: shortText(input.topic, 'My lesson', 3000),
    audience: shortText(input.audience, 'Undergraduate students'),
    language: shortText(input.language, 'English', 100),
    duration: Number.isFinite(input.duration) ? Math.max(5, Math.min(240, Math.round(input.duration))) : 45,
    mathLevel: shortText(input.mathLevel, 'Explain each equation and define its symbols'),
    demos: shortText(input.demos, 'One interactive demonstration that helps students explore the central idea', 600),
  };
}

/** A complete, copyable contract. No AI request or document upload is made here. */
export function generateLessonPrompt(value: LessonAIInput): string {
  const input = lessonInput(value);
  return `Create an editable teaching presentation for md.qft.org using QFT Markdown lesson format version 2.

LESSON BRIEF
Topic or chapter: ${input.topic}
Audience: ${input.audience}
Language: ${input.language}
Class duration: ${input.duration} minutes
Mathematical depth: ${input.mathLevel}
Interactive demonstrations: ${input.demos}

TEACHING GOALS
- Introduce the prerequisites and learning objectives. Build the explanation in small steps, with one main idea per slide.
- Define mathematical symbols, state assumptions, and include a worked example, a prediction question before each demo, and a short recap.
- Leave time for discussion and demonstrations within the stated class duration. Prefer readable, concise slides over a fixed slide count.
- If I supply a chapter or other source, ground the lesson in that material and cite page/section references. If a needed source is unavailable, ask for it; do not invent quotations, citations, or textbook figures.
- Use original diagrams or properly attributed pictures whose reuse is permitted. Supply actual local PNG, JPEG, WebP, or GIF files; do not leave broken image paths or depend on remote image hosts.
- Check the scientific reasoning and numerical limits. Label simplified models and units. Interactive plots must update from the displayed parameters, have sensible initial values, labeled controls, and a Reset button.

DELIVERABLE
Return a ZIP with qft.json at its root, slides.md, and any images/ and demos/ files. Use UTF-8. If this interface cannot attach a ZIP, create the files in the working directory and give me their download links; do not paste a React, Slidev, or Marp project.

qft.json must have this shape (generate a fresh UUID for projectId for a new lesson):
{
  "format": "qft-markdown",
  "version": 2,
  "projectId": "REPLACE-WITH-A-NEW-UUID",
  "document": "slides.md",
  "title": ${JSON.stringify(shortText(input.topic, 'My lesson', 200))},
  "mode": "slides",
  "slideTheme": "paper",
  "slideRatio": "16:9",
  "images": []
}
The importer discovers local raster images automatically, so images may be an empty array. Include a brief README.md with attribution, assumptions, and instructions for any demo. Keep projectId and file paths unchanged when revising an existing lesson. Return the complete updated project so it can replace the earlier version after review.

SLIDE SYNTAX
- Use ordinary Markdown, headings, lists, tables, and fenced code blocks.
- Separate slides with --- on its own line, with blank lines on both sides. Keep text and equations short enough for a 16:9 slide.
- Use $...$ or \\(...\\) for inline math, and $$...$$ or \\[...\\] for display math. Use KaTeX-supported notation. No full LaTeX document, MDX, slide framework directives, or raw HTML layouts.
- Insert a local picture with ![A meaningful description](images/figure.png).
- Give a demonstration its own slide with only a short heading and one interactive block. Put the prediction question and explanation on the preceding slide so the demo has room.

INTERACTIVE DEMOS
Prefer a separate self-contained HTML file, for example demos/explore.html, referenced from slides.md like this:

\`\`\`interactive src="demos/explore.html" title="Explore the model"
\`\`\`

Put all CSS and JavaScript inside that HTML file. Use native HTML controls and canvas; use addEventListener for events. No external scripts, CDN libraries, module imports, fetch/network requests, embedded frames, onclick attributes, or separate linked JS/CSS files. For a picture inside a demo, embed a raster data URL directly. Markdown math is typeset outside the demo; inside HTML, draw or write labels yourself. Code runs only after the teacher selects Run demo, in an isolated frame. Keep the demo responsive within a roughly 1100 by 400 pixel area. Stop unnecessary animations when idle.

Alternatively, use a built-in demo with an optional JSON object defining its starting settings:
\`\`\`interactive wave-packet
{"sigma":1,"momentum":1,"time":0,"view":"density"}
\`\`\`
Available presets and allowed settings:
- wave-packet: sigma 0.6–2.5 (step 0.05), momentum -2–2 (step 0.1), time 0–6 (step 0.01), view "density" or "amplitude".
- bloch-sphere: theta 0–180 degrees (step 1), phi 0–360 degrees (step 1).
- effective-potential: mass 0.5–2 (step 0.05), ell an integer 0–6 (step 1).
- interference: k 0.8–3 (step 0.05), delta 0.15–1 (step 0.05), time 0–12 (step 0.01), dispersion "quadratic" or "linear".
Numeric values must use the stated increments starting at the minimum.
An empty built-in fence uses default settings. For custom HTML inline in Markdown, use an interactive fence with title="..." and put the HTML inside it; a separate file is easier to revise.

COMPATIBILITY CHECK BEFORE DELIVERY
- Resolve every referenced picture and demo file relative to slides.md. Use safe relative paths within the project.
- Keep the main Markdown below 400,000 characters, the deck below 200 slides, and each demo below 100,000 characters. Use at most 20 demos.
- Keep images below 8 MiB each, 24 MiB combined, and 50 images total. The ZIP and its expanded supported contents must be below 30 MiB and 150 entries.
- Check math syntax, controls, reset behavior, keyboard usability, contrast, small-screen layout, and labels. Describe any checks you could not perform.
- Do not claim the lesson was tested in md.qft.org unless you actually tested it there. I will open the ZIP, choose Check lesson, and run the demos before teaching.

Format reference: https://md.qft.org/lesson-format-v2.md
Manifest schema: https://md.qft.org/lesson.schema.json
`;
}

const starterLicense = `MIT License

Copyright (c) 2026 Jie Ren

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

const starterDemo = `<!doctype html>
<!-- ${starterLicense} -->
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Explore a sine wave</title>
<style>
*{box-sizing:border-box}body{margin:0;padding:18px;font:16px system-ui,sans-serif;color:#24312f;background:#fbfcf9}main{max-width:980px;margin:auto}h1{font-size:19px;margin:0 0 8px}p{margin:4px 0 12px;color:#52645d}.controls{display:flex;flex-wrap:wrap;align-items:center;gap:12px 24px}label{display:flex;align-items:center;gap:8px}input{max-width:160px;accent-color:#7a3949}output{min-width:32px;font-variant-numeric:tabular-nums}button{padding:7px 13px;border:1px solid #c6d1ca;background:white;border-radius:6px;color:inherit;font:inherit}canvas{display:block;width:100%;height:230px;margin-top:12px;border:1px solid #d8e0da;border-radius:8px;background:white}button:focus-visible,input:focus-visible{outline:3px solid #986174;outline-offset:3px}
</style>
<main>
<h1>Explore y = A sin(kx)</h1>
<p>Predict how amplitude A and wave number k change the graph, then test your prediction.</p>
<div class="controls">
<label for="amplitude">Amplitude A <input id="amplitude" type="range" min="0.2" max="2" step="0.1" value="1"><output id="amplitude-value" for="amplitude">1.0</output></label>
<label for="wave-number">Wave number k <input id="wave-number" type="range" min="0.5" max="3" step="0.1" value="1"><output id="wave-number-value" for="wave-number">1.0</output></label>
<button type="button" id="reset">Reset</button>
</div>
<canvas id="plot" role="img" aria-label="Graph of y equals A sine kx for x from minus pi to pi"></canvas>
</main>
<script>
const canvas = document.getElementById('plot');
const amplitude = document.getElementById('amplitude');
const waveNumber = document.getElementById('wave-number');
function draw() {
  const width = Math.max(300, canvas.clientWidth), height = 230;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = width * ratio; canvas.height = height * ratio;
  const context = canvas.getContext('2d'); context.scale(ratio, ratio);
  const a = Number(amplitude.value), k = Number(waveNumber.value);
  document.getElementById('amplitude-value').value = a.toFixed(1);
  document.getElementById('wave-number-value').value = k.toFixed(1);
  canvas.setAttribute('aria-label', 'Sine graph with amplitude ' + a + ' and wave number ' + k);
  const left = 34, right = width - 18, top = 18, bottom = height - 30;
  const xPixel = x => left + (x + Math.PI) / (2 * Math.PI) * (right - left);
  const yPixel = y => (top + bottom) / 2 - y / 2.3 * (bottom - top) / 2;
  context.strokeStyle = '#d9e1db'; context.lineWidth = 1;
  context.beginPath(); context.moveTo(left, yPixel(0)); context.lineTo(right, yPixel(0));
  context.moveTo(xPixel(0), top); context.lineTo(xPixel(0), bottom); context.stroke();
  context.fillStyle = '#52645d'; context.font = '12px system-ui';
  context.fillText('-π', left - 4, bottom + 20); context.fillText('π', right - 5, bottom + 20);
  context.fillText('0', xPixel(0) + 5, yPixel(0) + 16); context.fillText('y', xPixel(0) + 5, top + 8);
  context.fillText('x', right - 7, yPixel(0) - 7);
  context.strokeStyle = '#7a3949'; context.lineWidth = 2.5; context.beginPath();
  for (let index = 0; index <= 600; index++) {
    const x = -Math.PI + index / 600 * 2 * Math.PI;
    if (!index) context.moveTo(xPixel(x), yPixel(a * Math.sin(k * x)));
    else context.lineTo(xPixel(x), yPixel(a * Math.sin(k * x)));
  }
  context.stroke();
}
amplitude.addEventListener('input', draw); waveNumber.addEventListener('input', draw);
document.getElementById('reset').addEventListener('click', () => { amplitude.value = '1'; waveNumber.value = '1'; draw(); });
window.addEventListener('resize', draw); draw();
</script>
</html>
`;

function markdownText(value: string): string {
  return value.replace(/[\\`*_{}\[\]<>#!|$]/g, '\\$&');
}

/** An honest scaffold with a working demonstration, ready to give to any AI. */
export function createStarterLesson(value: LessonAIInput): StarterLesson {
  const input = lessonInput(value);
  const title = shortText(input.topic, 'My lesson', 200);
  const project = createLessonProject('slides.md');
  project.files = [
    { path: 'demos/explore.html', content: starterDemo },
    { path: 'LICENSE', content: starterLicense },
    { path: 'README.md', content: `# ${title}\n\nThis is an editable lesson starter, not a completed lesson. Replace the teaching prompts and example sine-wave demo with material for your topic.\n\n## Brief\n\n${input.topic}\n\n- Audience: ${input.audience}\n- Language: ${input.language}\n- Duration: ${input.duration} minutes\n- Mathematical depth: ${input.mathLevel}\n- Demonstrations: ${input.demos}\n\n## Teach and revise\n\n1. Open the ZIP at https://md.qft.org/.\n2. Edit slides.md in the Markdown editor. Choose Edit demo to revise the linked HTML.\n3. Choose Check lesson, then Run demo and Present to rehearse.\n4. Download Project ZIP for further editing, or HTML for an offline classroom copy.\n5. Give this complete ZIP to AI for revisions. Keep projectId in qft.json and existing file paths. Reopen the updated ZIP and review its changes before updating the saved lesson.\n\nThe sine-wave example uses y = A sin(kx), dimensionless axes, and no external libraries. Its code and this starter are MIT-licensed as part of QFT Markdown. Add your own source attributions and image licenses here; the application does not license your lesson content.\n\nFormat: https://md.qft.org/lesson-format-v2.md\n` },
  ];
  const source = `# ${markdownText(title)}

${markdownText(input.audience)} · ${input.duration} minutes

*Lesson starter — replace the prompts before presenting.*

---

## What will we learn?

- State the central question.
- Name two or three learning objectives.
- Recall the prerequisite idea students need.

---

## Build the explanation

Introduce one idea. Define each symbol and state the assumptions.

Add a short equation, an original diagram, or a locally stored picture.

---

## Work through an example

Show the first step and ask students to predict the next one.

Check the units and discuss what the result means.

For the next slide, predict how amplitude and wave number change a sine wave. Replace this example with a demonstration for your topic.

---

## Predict, then explore

\`\`\`interactive src="demos/explore.html" title="Explore a sine wave"
\`\`\`

---

## Check understanding

Ask a question that reveals the most likely misconception.

Give students a moment to explain their reasoning.

---

## Take the idea with you

- Restate the main result.
- Connect it to the next lesson.
- Add sources, image attribution, and a short follow-up task.
`;
  return { title, source, mode: 'slides', slideTheme: 'paper', slideRatio: '16:9', project };
}
