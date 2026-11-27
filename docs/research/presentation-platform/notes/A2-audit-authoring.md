# A2 - Audit of the site's slide-authoring and AI hand-off features against the owner's goal

Agent A2, 2026-11-24. Repo: <repo> at commit 974fa5e ("Add portable Slidev presentations with offline interactive playback (#1)"). Nothing in the repo was modified.

Owner's goal (the yardstick): (1) user asks an AI for Reveal.js or Slidev slides, (2) uploads the ZIP, processed locally, (3) the site shows the presentation with interactions, (4) the user edits source files in the browser and sees the edited presentation.

## 0. Method, labels, reproduction

Labels used on every claim:
- **[E]** verified-empirically: run here against the production build in `dist`, served read-only by `proto/A2/scripts/serve.mjs` on `http://127.0.0.1:4410`, driven by Playwright + headless Chromium 158 (viewport 1440x900 unless stated).
- **[C]** verified-primary-source, code: `file:line` in the repo (or in `node_modules/reveal.js` 6.0.2).
- **[D]** verified-primary-source, docs/registry: URL given.
- **[S]** secondary-source (blog/forum): URL given.
- **[I]** inferred. **[U]** uncertain.

Everything lives under `(scratch)/research/` (called `$R` below):
- Scripts: `$R/proto/A2/scripts/` (run as `node scripts/<name> fixtures $R/shots` from `$R/proto/A2`; `lib.cjs` holds the Playwright helpers; `A2_BASE` overrides the URL).
- Fixtures (40 files): `$R/proto/A2/fixtures/` built by `make-fixtures.mjs`, `make-fixtures2.mjs`, `make-math-fixture.mjs`, `make-big-lesson.mjs`, `wrap-reveal.mjs`.
- Raw outputs: `$R/proto/A2/out/` (`e1-feature-probe.json`, `e2-keys.json`, `e3-export.json`, `e3b.log`, `e4-upload-matrix.json`, `e5-wrapped-reveal.json`, `e5d-math-backgrounds.json`, `e6-journey.log`, `e8.log`, `e8b.log`, `e9.log`, `e11.log`, `slidev-timing.txt`, the two prompts as copied by the UI: `ui-prompt-markdown.txt`, `ui-prompt-slidev.txt`, the UI's starter ZIPs, `export-probe-slides.html`, `interactive-physics.pdf`).
- Screenshots: `$R/shots/A2-*.png` (35 files).

Experiment index:

| Id | Script | What it establishes |
| --- | --- | --- |
| E1/E2 | `e1-feature-probe.cjs` | Which Reveal.js authoring conventions survive the Markdown slide mode; keys in preview and Present |
| E3 | `e3-export-html.cjs`, `e3b-export-keys.cjs` | Features of the standalone HTML export; navigation keys; URL-query override of the embedded deck; themes; 390 px viewport |
| E4 | `e4-upload-matrix.cjs` | What each kind of AI-returned file does when opened (20 cases, exact messages) |
| E5 | `wrap-reveal.mjs`, `e5-wrapped-reveal.cjs`, `e5b-debug-keys.cjs`, `e5d-math-and-backgrounds.cjs` | A standard Reveal.js 6.0.2 deck inlined into one HTML and played in the EXISTING portable player |
| E6 | `e6-journey.cjs` | The whole Create-with-AI journey through the UI, both formats, including Lesson files editing and revision review |
| E8 | `e8-slidev-md-and-pdf.cjs`, `e8b-pdf-overflow.cjs`, `e8c-overflow-detail.cjs` | Slidev Markdown opened in the editor; slide-PDF path; overflow false positive |
| E9 | `e9-misc.cjs` | Placeholder projectId collision, odd ZIP layouts, paste-only path, duplicate Slidev imports |
| E10 | `e10-start-latency.cjs` | Import and start latency of packages in the player |
| E11 | `e11-csp-capabilities.cjs`, `e11b-eval.cjs` | What the app shell CSP and the sandbox CSP allow (wasm, eval, workers, fetch) |
| E12 | `e12-autosave-cost.cjs` | Autosave cost of a 22 MB lesson project |
| E13/E14 | `e13-check-probe.cjs`, `e14-html-as-demo.cjs` | Check lesson on a foreign-dialect deck; Reveal HTML through the demo path |
| T1 | shell, see section 5.3 | Cold `npm ci` + `slidev build` + `pack.mjs` timings for the Slidev starter |

Files read completely: `src/lib/slides.ts`, `src/scripts/slide-preview.ts`, `src/lib/export-slides.ts`, `src/styles/slides.css`, `src/lib/lesson-project.ts`, `src/lib/document-bundle.ts`, `src/lib/lesson-check.ts`, `src/lib/lesson-revision.ts`, `src/lib/ai-lesson.ts`, `src/lib/slidev-prompt.ts`, `src/lib/interactive-demos.ts`, `src/scripts/interactive-demo-runtime.ts`, `public/demo-sandbox.html`, `src/components/TeacherWorkflow.astro`, `public/lesson-format-v2.md`, `public/lesson.schema.json`, `src/pages/guide.astro`, `src/lib/site-faq.ts`, `src/lib/examples.ts`, plus `src/lib/render-markdown.ts`, `src/lib/presentation-package.ts`, `src/lib/presentation-runtime.ts`, `src/lib/presentation-store.ts`, `src/lib/draft-store.ts`, `src/lib/image-assets.ts`, `src/lib/export-document.ts`, `src/lib/cleanup-review.ts`, `src/scripts/presentation-library.ts`, `src/scripts/markdown-workspace.ts` (2,175 lines; the lesson/AI parts line by line), the three Astro components, `tools/slidev/*` (README, pack.mjs, slides.md, portable-runtime.js, vite.config.ts, package.json), README.md, docs/ARCHITECTURE.md, docs/VERIFICATION.md, and the tests `slides`, `ai-lesson`, `slidev-prompt`, `lesson-check`, `lesson-revision`, `lesson-project`, `lesson-demos`, `demo-sandbox`.

## 1. The current "Create with AI" journey

### 1.1 Entry point and UI [C][E]

- Sidebar button "Create with AI" (`src/components/MarkdownWorkspace.astro:17`) opens one modal dialog (`src/components/TeacherWorkflow.astro:5-41`).
- First field: `Presentation format` select with exactly two options (`TeacherWorkflow.astro:11`): "Markdown — edit directly in this workspace" (value `qft`) and "Slidev — build interactive Vue slides with Codex" (value `slidev`). **There is no "Reveal.js" option**; the Reveal.js path of the site is the Markdown lesson.
- Other fields: topic (textarea, max 3,000 chars), audience (default "Undergraduate students"), class length (default 45 min), and under a disclosure: language (default English), mathematics (4 choices, default "Match the audience"), demos (optional).
- Buttons: "Copy AI instructions" (`copyAIInstructions`, `src/scripts/markdown-workspace.ts:1411-1425`), "Starter ZIP" (`starterLesson(true)`, `:1427-1454`), "Open AI lesson" (opens the normal file picker), "Try the starter in the workspace", link "Format guide for AI & developers" -> `/lesson-format-v2.md`.
- The dialog states "No account or API key needed. You choose the AI assistant." The site never calls a model (`src/lib/ai-lesson.ts:36` comment; no network code in either prompt module).
- The three-step aside names "Codex or another assistant" (`TeacherWorkflow.astro:33`). Screenshots: `$R/shots/A2-ai-dialog-markdown.png`, `A2-ai-dialog-slidev.png`.

### 1.2 Path A - Markdown lesson (the site's Reveal.js path)

| # | User does | AI must produce | Site validates | Where it fails (exact strings from E4/E6/E9) |
| --- | --- | --- | --- | --- |
| A1 | Opens the dialog, types a topic, clicks "Copy AI instructions" | - | Clipboard write; on failure the prompt is shown selected in a textarea (`markdown-workspace.ts:1406-1409`) | - |
| A2 | Optionally clicks "Starter ZIP" | - | Generated client-side (`createStarterLesson`, `ai-lesson.ts:198-263`): 5 entries, 9,067 bytes: `qft.json`, `slides.md` (7 slides, 184 words), `demos/explore.html` (4,829 chars sine-wave canvas demo), `LICENSE`, `README.md` [E] | - |
| A3 | Pastes the 833-word prompt into a chat/agent, attaches chapter + starter | A ZIP with `qft.json` (format `qft-markdown`, version 2, fresh `projectId`), `slides.md`, `images/*.{png,jpg,webp,gif}`, `demos/*.html` (each self-contained, <=100,000 chars, no CDN, no `onclick`), `README.md` | nothing (off-site) | AI that cannot emit a ZIP: the prompt's only fallback is "create the files in the working directory and give me their download links" (`ai-lesson.ts:58`). There is no multi-file paste import on the site (section 5.1). |
| A4 | "Open AI lesson" / "Open file" / drag-drop the ZIP | - | `openFile` (`markdown-workspace.ts:1372-1393`): first `inspectPresentationArchive` (is it a Slidev package?), then `importWorkspaceBundle` (`src/lib/document-bundle.ts:266-340`): ZIP <=30 MB, <=150 entries, safe unique paths, expanded <=30 MB, text file <=2 MB, `qft.json` <=32 KB, image <=8 MB; manifest fields; UTF-8 (fatal decode); Markdown <=400,000 chars; image magic bytes (`src/lib/image-assets.ts:53-60`); project limits (`src/lib/lesson-project.ts:60-97`) | See table 1.5. Typical: "This lesson contains an unsupported file: images/diagram.svg. Use Markdown, HTML, CSS, JavaScript, JSON, text, or PNG/JPEG/WebP/GIF images." / "This lesson project needs a valid projectId." / "A ZIP bundle must contain one Markdown document, or a QFT document manifest." |
| A5 | Sees the deck in Slides mode (`mode: "slides"` in manifest) with live diagnostics | - | Live render errors only: KaTeX failures and invalid/missing demo fences (`render-markdown.ts:193-198`, `interactive-demos.ts:180-198`). NOT checked on import: missing images, CDN-dependent demos, crowded slides | A ZIP without manifest opens in Document mode, not Slides [E]. Foreign syntax (Reveal/Slidev/Marp) shows as literal text with no error (section 2.4) |
| A6 | Clicks "Check lesson" (visible in Slides mode or for any project) | - | `checkLesson` (`src/lib/lesson-check.ts:33-125`), static only: source limit, empty lesson, render errors, image without alt text, remote image, missing image, demo with linked code / frames / inline events / network / linked images / storage, >1 demo per slide, >180 words per slide; max 100 issues | Starter: "The format check passed. Your lesson is ready for a rehearsal." [E]. A deck full of Reveal.js or Slidev syntax also passes (E8, E13) |
| A7 | "Copy report for AI", pastes it back, receives a revised ZIP, opens it | Same `projectId`, same paths | `projectId` match against stored drafts (`markdown-workspace.ts:1380-1382`) -> "Review this lesson update." dialog (`:1480-1505`, `src/lib/lesson-revision.ts`); "Update lesson" first stores a recovery draft "(before update)" (`:1533-1560`) | Two read-only textareas, no line diff (`TeacherWorkflow.astro:59-62`). A kept placeholder id collides across unrelated lessons (E9) |
| A8 | On each demo slide clicks "Run demo" | - | Runtime: opaque-origin iframe, CSP, `script[src]`/`link`/`iframe` removed, `on*` attributes removed (`src/scripts/interactive-demo-runtime.ts:198-229`) | CDN demo: "Demo error: Uncaught ReferenceError: Chart is not defined" [E]. Inline `onclick` buttons silently dead |
| A9 | Edits: Markdown in CodeMirror; demo HTML via "Edit demo" or "Lesson files" (modal with `<select>` + 300 px `<textarea>`) | - | `validateLessonProject`, stale-edit guards (`markdown-workspace.ts:1588-1603`) | Works: edited demo heading appeared after Save + Run demo [E6]. A running demo is reset to idle by any edit |
| A10 | "Present" (fullscreen overlay), then Download -> Project ZIP / Standalone HTML / Save PDF | - | PDF: per-slide overflow check before `window.print()` (`src/lib/export-slides.ts:270-280`) | The site's own "Quantum phase" example is refused: "Slides 3, 5 contain too much content for the selected slide size..." although both fit (section 2.5) |

Happy-path cost: about 8 actions on the site plus 4 in the AI tool. Each AI revision loop costs about 6 more (download Project ZIP, attach, download result, open, review, update). Measured [E6]: import of the starter is instant; "Lesson files" lists 4 editable files ("4 editable files · 0 images. Images stay in the project; use Insert image to add more.").

### 1.3 Path B - Slidev

| # | User does | AI must produce | Site validates | Where it fails |
| --- | --- | --- | --- | --- |
| B1 | Selects "Slidev" in the dialog; help text becomes "Your coding assistant builds the Slidev package. Open it here to present; revise its source and rebuild for changes." (`markdown-workspace.ts:1715-1721`) | - | - | The path presumes a coding agent with a terminal |
| B2 | "Copy AI instructions" (446 words) and "Starter ZIP" | - | Starter = the checked-in `public/slidev/interactive-physics.zip`, 1,674,968 bytes, 14 entries: `qft-presentation.json`, `presentation.html` (3.4 MB), `README.txt`, `THIRD_PARTY_NOTICES.txt` (1.2 MB), `source/` (slides.md, components/QuantumInterference.vue, pack.mjs, pack.test.mjs, portable-runtime.js, vite.config.ts, package.json, package-lock.json 355 KB, README.md, LICENSE) [E6] | - |
| B3 | Gives prompt + starter to a coding agent | In `source/`: edit `slides.md` and Vue components keeping the portable headmatter (`routerMode: memory`, `fonts.provider: none`, monaco/presenter/pwa/record off; `tools/slidev/slides.md:1-31`), then `npm ci`, `npm run build`, `node pack.mjs --dist .build --source . --out lesson.zip --title "..."` (`src/lib/slidev-prompt.ts:30-34`) | - | Needs Node >= 22.12 (`tools/slidev/package.json` engines), the npm registry (751 lockfile packages; 128 MB tarballs, 573 MB `node_modules`; T1), and a terminal. A chat-only AI cannot comply |
| B4 | "Open file" with `lesson.zip` | - | `inspectPresentationArchive` (`src/lib/presentation-package.ts:308-380`): ZIP <=60 MB, central-directory audit (no ZIP64/encryption/symlinks, methods 0/8, <=1,000 entries, <=40 MB per file, <=120 MB expanded, expansion ratio, overlap), exactly one `qft-presentation.json`, `format: qft-presentation`, `version: 1`, `engine: slidev` (`:258`), entry HTML present, <=24 MB, contains `<html` and `<body`, declared source present, CRC of every entry | Source-only: "This ZIP contains Slidev source, not a playable presentation. Ask the AI to build it with the QFT Slidev packaging tool, following tools/slidev/README.md, and include the compiled presentation." Ordinary `slidev build` dist: "This is a website build ZIP. Follow tools/slidev/README.md and use the QFT Slidev packaging tool to bundle its scripts, fonts, and assets for local playback." A lone `slides.md` (with or without ZIP) is silently opened as a Markdown **document** [E4] |
| B5 | Dialog "Slidev presentations" opens; "Start presentation" | - | `preparePresentationDocument` (`src/lib/presentation-runtime.ts:158-218`): rejects `script[src]`, `link[rel~=stylesheet]`, `iframe/object/embed`, import maps, any `src/href/poster/background/data` that is not `data:` or `#`; strips `on*`, `meta`, `base`, `link`, `title`. Runtime: opaque sandbox + CSP; any uncaught error, unhandled rejection or CSP violation stops playback (`:127-134`, `:237-245`); 20 s load timeout (`:270-272`) | Started in 427 ms [E6]; 441-486 ms over 3 runs [E10] |
| B6 | "Source files" tab | - | Read-only textarea per file (`src/scripts/presentation-library.ts:311-320`), "Copy source" | Note shown: "Source is preserved exactly as imported. Revise it with your editor or AI assistant, rebuild the presentation, then open the new ZIP. The compiled slides do not change when source files are edited elsewhere." Goal 4 is not met |
| B7 | Revision: back to the agent, rebuild, re-upload | Updated source and rebuilt HTML | none: no project identity | Every upload is stored as a new library row; the same ZIP twice gives two identical rows [E9]. No review, no diff, no recovery copy |

### 1.4 The generated prompts (verbatim) and their size [E][C]

Measured with the dialog defaults and the topic "Wave packets and the uncertainty principle"; the clipboard text equals `generateLessonPrompt()` / `generateSlidevPrompt()` output byte for byte (`out/ui-prompt-*.txt` vs `out/prompt-*.txt`).

| Prompt | Words | Characters | Lines | ~Tokens (chars/4) |
| --- | --- | --- | --- | --- |
| Markdown lesson (`src/lib/ai-lesson.ts:37-111`) | **833** | 5,613 | 72 | ~1,400 |
| Slidev (`src/lib/slidev-prompt.ts:4-38`) | **446** | 3,267 | 30 | ~820 |

Words per section - Markdown: intro 14, LESSON BRIEF 37, TEACHING GOALS 163, DELIVERABLE 138, SLIDE SYNTAX 108, INTERACTIVE DEMOS 241, COMPATIBILITY CHECK BEFORE DELIVERY 132. Slidev: intro 13, LESSON BRIEF 33, TEACHING AND DESIGN 81, USE THE WORKING STARTER 57, PORTABLE PLAYBACK REQUIREMENTS 113, BUILD AND DELIVER 87, VERIFY 62.

So 619 of 833 words (74%: DELIVERABLE + SLIDE SYNTAX + INTERACTIVE DEMOS + COMPATIBILITY CHECK) of the Markdown prompt and 319 of 446 (72%: STARTER + PORTABLE PLAYBACK + BUILD AND DELIVER + VERIFY) of the Slidev prompt teach the AI a site-specific format or build recipe rather than the lesson. The documents the prompts point to add 1,744 words (`public/lesson-format-v2.md`) and 973 words (`tools/slidev/README.md`). The check report that is pasted back is 69-72 words when clean (`formatLessonReport`, `lesson-check.ts:128-136`).

Markdown lesson prompt:

````text
Create an editable teaching presentation for md.qft.org using QFT Markdown lesson format version 2.

LESSON BRIEF
Topic or chapter: Wave packets and the uncertainty principle
Audience: Undergraduate students
Language: English
Class duration: 45 minutes
Mathematical depth: Match the audience
Interactive demonstrations: One interactive demonstration that helps students explore the central idea

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
  "title": "Wave packets and the uncertainty principle",
  "mode": "slides",
  "slideTheme": "paper",
  "slideRatio": "16:9",
  "images": []
}
The importer discovers local raster images automatically, so images may be an empty array. Include a brief README.md with attribution, assumptions, and instructions for any demo. Keep projectId and file paths unchanged when revising an existing lesson. Return the complete updated project so it can replace the earlier version after review.

SLIDE SYNTAX
- Use ordinary Markdown, headings, lists, tables, and fenced code blocks.
- Separate slides with --- on its own line, with blank lines on both sides. Keep text and equations short enough for a 16:9 slide.
- Use $...$ or \(...\) for inline math, and $$...$$ or \[...\] for display math. Use KaTeX-supported notation. No full LaTeX document, MDX, slide framework directives, or raw HTML layouts.
- Insert a local picture with ![A meaningful description](images/figure.png).
- Give a demonstration its own slide with only a short heading and one interactive block. Put the prediction question and explanation on the preceding slide so the demo has room.

INTERACTIVE DEMOS
Prefer a separate self-contained HTML file, for example demos/explore.html, referenced from slides.md like this:

```interactive src="demos/explore.html" title="Explore the model"
```

Put all CSS and JavaScript inside that HTML file. Use native HTML controls and canvas; use addEventListener for events. No external scripts, CDN libraries, module imports, fetch/network requests, embedded frames, onclick attributes, or separate linked JS/CSS files. For a picture inside a demo, embed a raster data URL directly. Markdown math is typeset outside the demo; inside HTML, draw or write labels yourself. Code runs only after the teacher selects Run demo, in an isolated frame. Keep the demo responsive within a roughly 1100 by 400 pixel area. Stop unnecessary animations when idle.

Alternatively, use a built-in demo with an optional JSON object defining its starting settings:
```interactive wave-packet
{"sigma":1,"momentum":1,"time":0,"view":"density"}
```
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
````

Slidev prompt:

````text
Create a complete, ready-to-present Slidev lesson for the local ZIP player at md.qft.org.

LESSON BRIEF
Topic or chapter: Wave packets and the uncertainty principle
Audience: Undergraduate students
Language: English
Class duration: 45 minutes
Mathematical depth: Match the audience
Interactive demonstrations: One useful demonstration with labeled controls

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
From the starter source directory, run npm ci, then npm run build. Run:
node pack.mjs --dist .build --source . --out lesson.zip --title "Your lesson title"

Deliver lesson.zip, containing qft-presentation.json, the self-contained compiled presentation.html, and the editable source/ project including its lockfile and build instructions. Do not send only slides.md or an ordinary dist ZIP. Do not include node_modules, private files, credentials, or repository metadata. If you cannot run the build, say clearly that the source has not been compiled and provide exact build steps.

VERIFY
Open the packaged presentation in md.qft.org, visit every slide, and test each interaction with network access disabled. Check math, fonts, images, navigation, slider keyboard handling, and fullscreen layout. A successful compile does not establish offline compatibility. Summarize what you actually tested and any remaining limitations. When revising, update both source and compiled presentation; changing the source alone does not update playback.
````

### 1.5 Upload matrix: what the built site does with what an AI hands back [E4, E9, E14]

Each case ran in a fresh browser context; the "outcome" is the toast or dialog text verbatim.

| # | Fixture (in `proto/A2/fixtures/`) | What it is | Outcome |
| --- | --- | --- | --- |
| 1 | `reveal-standard.zip` | Standard Reveal.js 6.0.2 project: `index.html` + `dist/` (core, 14 themes, 6 plugins under `dist/plugin/`) + `assets/`; 27 entries, 2.26 MB | "This is a website build ZIP. Follow tools/slidev/README.md and use the QFT Slidev packaging tool to bundle its scripts, fonts, and assets for local playback." Nothing opens. (`presentation-package.ts:325-329`) |
| 2 | `reveal-standard-folder.zip` | Same inside `my-deck/` | Same message |
| 3 | `reveal-standard-readme.zip` | Same plus one `README.md` | **Silently opens README.md** as a document titled "README" in Document mode with the toast "Lesson opened. Check lesson helps you spot missing images, equations, or demo dependencies." The deck is ignored; its html/js/css land in "Lesson files" as inert text |
| 4 | `reveal-standard-two-md.zip` | Same plus `README.md` and `slides.md` | "A ZIP bundle must contain one Markdown document, or a QFT document manifest." (`document-bundle.ts:310`) |
| 5 | `reveal-npm-package.zip` | Whole npm package (css/, js/, dist/) + index.html; 111 entries, 3.2 MB | Same as 4 (two README.md) |
| 6 | `reveal-cdn-single.zip` | One `index.html` using jsDelivr URLs | Same as 4 |
| 7 | `reveal-cdn-single.html` | The same file, not zipped (the most common chat-AI answer) | "Choose Markdown (.md), plain text (.txt), a lesson ZIP, or a prepared Slidev presentation ZIP." (`markdown-workspace.ts:1387`; the picker's `accept` also hides `.html`, `MarkdownWorkspace.astro:87`) |
| 8 | `slidev-source.zip` | `slides.md` + `package.json` (@slidev/cli) + `components/Counter.vue` | "This ZIP contains Slidev source, not a playable presentation. Ask the AI to build it with the QFT Slidev packaging tool, following tools/slidev/README.md, and include the compiled presentation." (`presentation-package.ts:322-324`) |
| 9 | `slidev-source-no-pkg.zip` | `slides.md` + a `.vue` file | Same as 8 |
| 10 | `slidev-md-only.zip` | Only a Slidev `slides.md` | "Lesson opened. ..." - opened as a Markdown **document** titled "slides" |
| 11 | `slidev-slides.md` | The same file, not zipped | "Opened as a new document. Your original file is unchanged." Document mode |
| 12 | `slidev-dist.zip` | Ordinary `slidev build` output, 106 entries, 1.2 MB | Same message as 1 |
| 13 | `slidev-dist-relative.zip` | `slidev build --base ./` | Same message as 1 |
| 14 | `lesson-with-svg.zip` | Valid v2 lesson plus `images/diagram.svg` | "This lesson contains an unsupported file: images/diagram.svg. Use Markdown, HTML, CSS, JavaScript, JSON, text, or PNG/JPEG/WebP/GIF images." Whole import fails (`document-bundle.ts:306-308`) |
| 15 | `lesson-with-py.zip` | Valid v2 lesson plus `scripts/make_plot.py` | Same with `scripts/make_plot.py` |
| 16 | `lesson-no-manifest.zip` | `slides.md` + image + demo, no `qft.json` | Opens as "slides" in **Document** mode (no `mode` without manifest) |
| 17 | `lesson-missing-projectid.zip` | v2 manifest without `projectId` | "This lesson project needs a valid projectId." |
| 18 | `lesson-cdn-demo.zip` | Demo HTML loads Chart.js from a CDN | Opens with no diagnostics. Run demo: "Demo error: Uncaught ReferenceError: Chart is not defined". Check lesson: "Demo “demos/chart.html”: linked scripts and stylesheets cannot load. Put the needed JavaScript and CSS directly inside the HTML file." |
| 19 | `lesson-ok.zip` | Minimal valid lesson | Slides mode, "1 / 2" |
| 20 | `shared/slidev-starter/lesson.zip` | Portable Slidev package | Dialog "Quantum interference — Slidev", "Slidev · 14 files · 1.6 MB" |
| 21 | `lesson-fake-png.zip` | `.png` whose bytes are SVG | "“diagram.png” is not a supported image. Choose a PNG, JPEG, WebP, or GIF file." Whole import fails |
| 22 | `lesson-nested-with-stray.zip` | `lesson/qft.json` + a stray root file | Manifest ignored; opens "slides" in Document mode, identity lost |
| 23 | `lesson-many-files.zip` | 162 entries | "This ZIP bundle could not be opened. Invalid or duplicate archive path." (the 150-entry limit reported as a path error, `document-bundle.ts:277`) |
| 24 | `placeholder-id-A.zip` then `-B.zip` | Two unrelated lessons that both kept `"projectId": "REPLACE-WITH-A-NEW-UUID"` from the prompt | Second import opens "Review this lesson update." - "This ZIP is a revision of “Thermodynamics” in your workspace." The placeholder satisfies the id pattern `^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$` (`lesson-project.ts:16`) |
| 25 | `reveal-cdn-single.html` through Interactive demo -> "Open HTML file" | CDN deck as a demo | Inserted; Run demo: "Demo error: Uncaught ReferenceError: Reveal is not defined" (`script[src]` is stripped) |
| 26 | `reveal-inlined-single.html` (1.8 MB, everything inlined) through the same path | Self-contained deck as a demo | "Choose a self-contained HTML demo smaller than 100 KB." (`markdown-workspace.ts:1782`); reveal.js alone is 118,912 bytes |

Net result: **no form of standard Reveal.js output and no form of Slidev source plays today**. The only playable inputs are the site's own Markdown dialect and a package produced by `tools/slidev/pack.mjs`. Three cases (3, 10, 11) are worse than a refusal: they report success ("Lesson opened") while showing something else.

## 2. Markdown-to-reveal.js slide mode versus standard Reveal.js authoring

### 2.1 How the mode is built [C]

- Parsing: one markdown-it instance with `html: false` (`src/lib/render-markdown.ts:114-123`), KaTeX (`@mdit/plugin-katex`, four delimiter styles), footnotes, task lists; highlight.js core with exactly seven languages - javascript, typescript, python, json, bash, latex, css (`render-markdown.ts:18-20`).
- Slides: a top-level `hr` token whose source line matches `/^ {0,3}---[ \t]*$/` starts a new slide (`render-markdown.ts:320-328`); `***`, `- - -`, `----` stay horizontal rules. Each slide becomes a flat `<section class="qft-slide" data-slide-index="n"><div class="qft-slide-content">…</div></section>` (`render-markdown.ts:352-358`, `src/lib/slides.ts:31`). No attribute, class or nested section can be authored.
- Only a leading YAML block is blanked (`withoutFrontmatter`, `render-markdown.ts:367-374`).
- Preview player (`src/scripts/slide-preview.ts:42-80`): `new Reveal(canvas, {...})` with **no `plugins`** and

  ```
  embedded:true, controls:false, progress:false, slideNumber:false, hash:false, history:false,
  keyboard:{27:noop,70:noop,66:noop,190:noop}, overview:false, help:false, pause:false,
  jumpToSlide:false, center:false, margin:0, minScale:0.05, maxScale:2, transition:'none',
  backgroundTransition:'none', autoAnimate:false, autoSlide:0, touch:true, mouseWheel:false,
  view:null, scrollActivationWidth:0, width:1280, height:720|960
  ```
- Standalone HTML export (`src/lib/export-slides.ts:48-56`) embeds the raw reveal.js 6.0.2 runtime, again without plugins, with `controls:true, progress:true, slideNumber:'c/t', hash:true, transition:'none', embedded:false, pdfSeparateFragments:false, pdfMaxPagesPerSlide:1, view:null, scrollActivationWidth:0`. The probe deck exported to 603,351 bytes; CSP `default-src 'none'; script-src 'nonce-…'; style-src 'unsafe-inline'; img-src data:; font-src data:; frame-src 'self' blob:; connect-src 'none'; …`.
- Themes: three CSS-variable themes on the wrapper, `paper`, `midnight`, `serif` ("Academic") (`src/styles/slides.css:2-38`, `slides.ts:3`); two sizes, 1280x720 and 1280x960 (`slides.ts:19-21`).

### 2.2 Feature matrix

Probe deck: `fixtures/reveal-conventions.md` (8 slides written with the conventions documented at https://revealjs.com/markdown/ [D]), imported as `lesson-reveal-conventions.zip`. "App" = workspace preview and Present overlay. "Export" = the downloaded standalone HTML opened from `file://`.

| Standard Reveal.js feature | App | Export | Evidence |
| --- | --- | --- | --- |
| Horizontal slides | **Supported** (own `---` rule, needs blank lines around it) | Supported | [E1] 8 top-level sections; [C] `render-markdown.ts:320-328` |
| Vertical slides (`--`, nested `<section>`) | **Not supported** | Not supported | [E1] `--` printed as text inside slide 2; the only nested `<section>` is markdown-it's `<section class="footnotes">` |
| Fragments | **Not supported** | Not supported | [E1] 0 `.fragment` elements; `<!-- .element: class="fragment" -->` printed literally (`shots/A2-probe-slide-03.png`) |
| Speaker notes (`Note:`, `<aside class="notes">`, S key) | **Not supported** | Not supported | [E1] "Note: These are my speaker notes…" is visible slide text; 0 `aside.notes`; [E2][E3b] S opens nothing |
| Auto-animate | **Not supported** | Not supported | [C] `autoAnimate:false`; `data-auto-animate` cannot be authored |
| Slide backgrounds (colour, image, video, iframe) | **Not supported** | Not supported | [E1] `<!-- .slide: data-background="#ff0000" … -->` printed literally; no `data-*` on any section |
| Transitions | **Not supported** (`'none'`) | Not supported by authoring; `?transition=zoom` in the URL changes it | [C] config; [E3] class `zoom` after the query |
| Per-slide attributes (`<!-- .slide: -->`) | **Not supported** | Not supported | [E1] |
| Per-element attributes (`<!-- .element: -->`) | **Not supported** | Not supported | [E1] |
| Themes | **Partial**: 3 site themes; none of Reveal's 14 (`node_modules/reveal.js/dist/theme/`) | Same | [E3b] `data-slide-theme` paper/midnight/serif; backgrounds rgb(255,254,251) / rgb(23,28,41) / rgb(250,247,238) |
| Custom CSS | **Not supported** | Not supported | [E1] `<style>` printed as text; project `.css` files are preserved but never loaded (`lesson-format-v2.md:91`) |
| Custom JS in the slide | **Not supported** | Not supported | [E1] `<script>` printed as text, `window.__probeScriptRan` false |
| Custom JS via `interactive` fence | **Partial** (site-specific): sandboxed iframe card, <=100,000 chars each, <=20 per deck, explicit "Run demo" | Same, offline | [C] `interactive-demos.ts:9-10`; [E6] |
| Plugin: Markdown | **Partial/different**: site's markdown-it, not `RevealMarkdown`; no HTML, no attribute comments | Same | [C] |
| Plugin: Highlight | **Partial**: highlight.js at render time, 7 languages, no line numbers | Same | [E1] 7 `hljs-*` spans, `data-line-numbers` null |
| Code line highlighting and step-through (` ```js [1-2\|3] `) | **Not supported** (suffix silently ignored) | Not supported | [E1] no line table |
| Plugin: Math | **Supported differently**: KaTeX 0.19.1 at render time, `$…$`, `$$…$$`, `\(…\)`, `\[…\]`; no MathJax | Same, fonts embedded | [E1] 2 `.katex` nodes |
| Plugin: Notes / Search / Zoom | **Not supported** | Not supported | [E2][E3b] S, Ctrl+Shift+F, Alt+click do nothing |
| Third-party plugins | **Not supported** (no plugin hook) | Not supported | [C] no `plugins` option anywhere |
| Images | **Partial**: PNG, JPEG, WebP, GIF only; SVG rejected; remote images blocked until opted in | Embedded as data URIs | [E1] local image rendered, "Remote image · enable in Settings" |
| Video / audio / iframe embeds | **Not supported** | Not supported | [E1] 0 `video`, 0 `iframe`; tags printed as text |
| `r-fit-text`, `r-stack`, `r-stretch` (and `r-hstack`, `r-vstack`, `r-frame`) | **Not supported** (reveal.css is loaded but no class can be applied) | Not supported | [E1] 0 elements with these classes |
| Lightbox (`data-preview-image/-video/-link`, Reveal 5.2+ [D https://revealjs.com/lightbox/]) | **Not supported** | Not supported | [E1] |
| Overview (O / Esc) | **Not supported** (disabled) | **Supported** | [E2] no `overview` class; [E3] `overview:true` after O and after Esc |
| Scroll view (Reveal 5.0+ [D https://revealjs.com/scroll-view/]) | **Not supported**; `?view=scroll` on the site URL breaks the preview | Only via `?view=scroll` (8 scroll pages) | [E3] |
| PDF export | **Partial/different**: own print copy, one slide per page, through the browser print dialog; refuses on overflow | Own "Save PDF" button; Reveal's `?print-pdf` also works (8 `.pdf-page`) | [E8b] `interactive-physics` example -> 5 pages, MediaBox 960x540 pt; quantum example refused (2.5) |
| Keyboard navigation | **Supported**: arrows, Space, N/P, H/J/K/L, Home/End, PageUp/PageDown | Supported | [E3] each key moved 1/8 -> 2/8 or 8/8 -> 7/8 |
| Fullscreen | **Supported** by the Present overlay (F key disabled) | Button and F key | [E2] `fs:true` in Present; [E3b] |
| Pause/blackout (B, .) | Not supported | Supported | [E2][E3] |
| Jump to slide (G), help (?) | Not supported | Supported | [E3][E3b] |
| Controls, progress bar, slide number | Replaced by the site's own counter and arrows | Reveal's own | [E1] `display:none`; [E3] "1/8" |
| Hash deep links | Not supported (`hash:false`) | Supported (`#/1`) | [E3] |
| Touch swipe | Enabled in config, not tested | Enabled | [C] `touch:true` [I] |
| Auto-slide, presenter timer, multiplex | Not supported | Not supported | [C] |

Count over the 25 features named in the task (vertical slides … lightbox): in the app **1 is supported by different means** (math), **6 are partial** (themes, custom JS only as isolated demos, highlight, markdown, media limited to raster images, PDF) and **18 are not supported**. The standalone export additionally exposes overview, and scroll view and Reveal's print view through URL parameters.

### 2.3 What the Markdown mode has that stock Reveal.js lacks [C][E]

Live split editing with 180 ms debounced preview (`markdown-workspace.ts:293`); per-slide overflow detection (`slide-preview.ts:201-213`); sandboxed demo cards with Run/Stop/Restart, pause on inactive slides, canvas snapshots for PDF; math rendered without a runtime plugin; a static checker and a "copy report for AI" loop; project ZIP round trip with identity; one-file offline export; no network at any point.

### 2.4 Foreign slide dialects render as text and pass the checker [E]

- Reveal.js conventions: see `shots/A2-probe-slide-03.png` and `-06.png`. "Check lesson" on that deck reports "8 slides · 0 demos · 0 errors · 1 warning" - the single warning is the remote image [E13].
- Slidev `slides.md` switched to Slides mode [E8]: 3 slides; the per-slide frontmatter `---\nlayout: two-cols\n---` becomes an `<h2>` reading "layout: two-cols" (setext heading); `<v-click>`, `::right::`, `<Counter :count="10" />` and the presenter-note comment print literally. "Check lesson": "The format check passed. Your lesson is ready for a rehearsal."
- The site describes the mode as "a simple Markdown slide format, powered by reveal.js" (`src/pages/guide.astro:143`) and "This Reveal.js format" (`src/lib/site-faq.ts:36`). A user or an AI reading that can reasonably expect Reveal.js syntax to work. [I]

### 2.5 Defects found while probing

1. **The site URL's query string reconfigures or breaks the embedded deck.** reveal.js merges `location.search` into its config last (`node_modules/reveal.js/js/reveal.js:144-156`, `js/utils/util.ts:208-232`) and the site passes nothing to stop it. [E3] on `http://127.0.0.1:4410/`: `?controls=true&progress=true&slideNumber=true` shows Reveal's controls in the workspace; `?view=scroll` gives "Slides could not be loaded. Switch to Document and back to try again."; `?print-pdf` throws `TypeError: Cannot read properties of null (reading 'appendChild')`, adds `reveal-print print-pdf` to `<html>` and blanks the slide (`shots/A2-site-query-_print_pdf.png`); `?embedded=false` turns `<body>` into the Reveal viewport.
2. **Save PDF is refused for the site's own example.** `?example=quantum-slides` -> Save PDF -> "Slides 3, 5 contain too much content for the selected slide size. Split the content across slides or choose 4:3 before saving the PDF." [E8b]. Cause: the print check also tests every `pre, .katex-display, table` for `scrollHeight > clientHeight + 3` (`export-slides.ts:274-276`, same logic in the exported file `:111-115`). Display equations with fractions measure 101 vs 97 px (slide 3) and 93 vs 88 px (slide 5) while the slide itself has 131 px and 87 px of free space (`shots/A2-quantum-slide-3.png`) [E8c]. The live preview shows no overflow notice for those slides.
3. **Footnote sections count as slides in some Reveal code paths.** markdown-it emits `<section class="footnotes">` inside a slide; Reveal's `.slides section` selector includes it. [E1] 9 background elements for 8 slides; [E3] the export in `?view=scroll` shows slide number "10 / 9". Invisible in the app (controls are hidden); visible only through the scroll-view query.
4. **Checker false green** for foreign dialects (2.4).
5. **Placeholder id is a valid id** (1.5 row 24).
6. **Documentation versus behaviour.** `public/lesson-format-v2.md:56` says "SVG and PDF are not imported as pictures" and "keep its generation source in the project when useful"; in a v2 project any such file aborts the import (rows 14, 15). The 833-word prompt never lists the allowed file types or says that other files are fatal.

## 3. Distance from the lesson format to standard Reveal.js and Slidev projects

### 3.1 Structural comparison

| Aspect | QFT lesson (`qft.json` v2) | Standard Reveal.js project | Slidev project |
| --- | --- | --- | --- |
| Entry / manifest | `qft.json` (required for Slides mode and identity) + one Markdown file | `index.html`; no manifest | `slides.md` headmatter + `package.json` |
| Slide source | Markdown, `---` separators, no HTML | HTML `<section>` elements; optionally Markdown inside `<section data-markdown>` or an external `.md` loaded over HTTP [D https://revealjs.com/markdown/] | Markdown + Vue templates + UnoCSS classes, `---` separators with per-slide frontmatter, layouts, `<v-click>`, components |
| Runtime | Site renderer -> embedded Reveal core without plugins | `dist/reveal.js` + plugins + the author's own scripts; opens from `file://` ("Basic setup", [D https://revealjs.com/installation/]) | A Vite-built Vue 3 application; the source cannot run without compiling |
| Styling | 3 themes | 14 themes + arbitrary CSS; 8 of 14 themes `@import` Google Fonts, black/white embed fonts as data URIs (575 KB each) [C `dist/theme/*.css`] | Theme packages, UnoCSS, `<style>` |
| Assets | PNG/JPEG/WebP/GIF, <=8 MiB each, <=50, <=24 MiB | Anything: SVG, video, audio, fonts | Anything, via `public/` or imports |
| Interactivity | Isolated demo iframes, self-contained, <=100,000 chars, explicit Run | Any script in page scope, any library | Vue components, npm dependencies |
| Size | <=150 entries, <=30 MiB, text <=2 MiB per file and <=6 MiB total | Measured: `dist/` without `.d.ts`/`.mjs` = 25 files, 3.57 MB; npm package = 111 files, 6.1 MB | Source ~3-20 files; `node_modules` 573 MB; `dist` 106 files, 2.1 MB |
| Build step | None | None | Required |
| Edit -> see | Immediate | Reload | Dev-server HMR; on the site: none |

Reveal.js version drift matters for any importer [D https://revealjs.com/upgrading/, npm registry]: 6.0.0 (2026-03-11) moved plugins from `plugin/<name>/<name>.js` to `dist/plugin/<name>.js` and renamed `.esm.js` to `.mjs`; latest is 6.0.2 (2026-09-10); 5.2.1 is 2025-03-28. [E] today: `https://unpkg.com/reveal.js/plugin/notes/notes.js` -> 404 (resolves to 6.0.2); `https://cdn.jsdelivr.net/npm/reveal.js/plugin/notes/notes.js` -> 200 but served from `x-jsd-version: 5.2.1` while `…/dist/reveal.js` is 6.0.2 (mixed majors); `…/reveal.js@6/plugin/notes/notes.js` -> 404. AI models trained before 2026 write the 4.x/5.x paths. (Agent B1 has the full CDN matrix.)

### 3.2 Auto-converting a standard deck INTO the lesson format: possible, very lossy [I, grounded in 2.2]

What maps: section order (vertical stacks flattened), headings, paragraphs, lists, tables, links, code blocks (language only), raster `<img>`, TeX delimiters left in text. What is lost, by construction of the target format: fragments (everything appears at once), speaker notes (must be dropped or they become visible text), backgrounds, transitions, auto-animate, vertical navigation, layout helpers, columns/grids/absolute positioning, every theme and custom style, SVG/video/audio/iframes, code line steps, and **all page-scope JavaScript** - which is the "interactions" of goal 3. Interactive widgets could be moved into `demos/*.html` only when they are self-contained in under 100,000 characters; common libraries do not fit inline (reveal.js itself is 118,912 bytes; the highlight plugin 920,644). Conclusion: conversion yields a text outline of the deck, not the deck.

### 3.3 Wrapping a standard deck for the EXISTING player: works after five mechanical rewrites [E5]

`proto/A2/scripts/wrap-reveal.mjs` (about 70 lines of string and Map operations, no bundler; 0.31-0.32 s per run including Node start-up) takes `reveal-standard.zip` and:

- T1 inlines 4 stylesheets as `<style>` (CSS `url()` -> `data:`),
- T2 inlines 6 scripts,
- T3 rewrites asset attributes including `data-background-image` to `data:` URIs (2 assets),
- T4 removes `hash: true` / `history: true` from the init call,
- T5 converts inline `on*` attributes into `addEventListener` calls (1 handler),

then writes `qft-presentation.json` with `engine: "slidev"` (the only value the validator accepts, `presentation-package.ts:258`). Output: `presentation.html` 1,795,514 bytes, ZIP 836,822 bytes.

| Variant | Player status | Message shown |
| --- | --- | --- |
| All five rewrites | "Playing locally" | none |
| Without T4 (`hash: true`, as in Reveal's own `index.html` template) | "Playback needs attention" | "Failed to execute 'replaceState' on 'History': A history state object with URL '' cannot be created in a document with origin 'null' and URL 'blob:null/…'." |
| Without T5 (`onclick` kept) | Plays; the button stays "Count: 0" | console only: inline event handler blocked by CSP |
| Without T3 (`<img src="assets/pixel.png">`) | "Playback needs attention" | "This presentation references an asset outside its HTML. Rebuild the portable package with its pictures, fonts, and media included." |
| CDN single file | "Playback needs attention" | "This presentation has separate JavaScript files. Create a portable ZIP with the Slidev packaging tool before opening it." |
| Plus `RevealMath.KaTeX` | "Playback needs attention" | "This presentation requested an unsupported resource (style-src-elem). Rebuild it with the portable Slidev packaging tool." (the plugin loads `https://cdn.jsdelivr.net/npm/katex@latest/dist/katex.min.css`) |
| Plus `RevealMath.MathJax3` or default `RevealMath` (MathJax 2) | "Playback needs attention" | Same with `script-src-elem` (`…/mathjax@3/es5/tex-mml-chtml.js`, `…/mathjax@2/MathJax.js?config=TeX-AMS_HTML-full`) |

Inside the fully wrapped deck these all worked (`out/e5-wrapped-reveal.json`, `out/e5d-math-backgrounds.json`): 11 slides counted; plugins `markdown, highlight, notes, search, zoom` registered; vertical navigation (1.0 -> 1.1); fragments; auto-animate (target `margin-top: 200px` reached); background colour `rgb(42, 157, 143)`; `data:` image background; highlighted code with a 3-row line-number table and a second highlight step; a Markdown slide with an `.element` fragment and `Note:` turned into `aside.notes`; `r-fit-text` (computed 560 px); `r-stack`; the converted button counted to 2; overview, pause, jump-to-slide, help overlay, search box. Import took 214-275 ms and start 468-644 ms [E10].

Two ordinary keys kill the deck because the player treats any uncaught error as fatal (`presentation-runtime.ts:127-131`, `:237-245`) [E5b]:
- **S** (speaker view): "Blocked opening 'about:blank' in a new window because the request was made in a sandboxed frame whose 'allow-popups' permission is not set." -> "Uncaught TypeError: Cannot set properties of null (setting 'marked')".
- **F** (fullscreen): "Permissions policy violation: fullscreen is not allowed in this document." -> "Disallowed by permissions policy" (the frame is created with `fullscreen 'none'`, `presentation-runtime.ts:260`).

What a wrapped deck still loses [I]: the speaker window, in-frame fullscreen (the host's Present button replaces it), URL deep links, external iframes and remote media (`frame-src 'none'`, `connect-src 'none'`), external Markdown (`data-markdown="file.md"` uses XHR) unless the importer inlines it, anything needing `eval` or WebAssembly (no `'unsafe-eval'` / `'wasm-unsafe-eval'` in the frame policy), and Reveal's math plugin unless the importer substitutes a local KaTeX.

The decisive property for goal 4: **in Reveal.js the source is the runtime**. Editing `index.html`, a CSS file or a script and re-running the 0.3 s inlining step gives the edited presentation; no compiler is involved. [E][I]

### 3.4 Slidev

- Into the lesson format: only the Markdown text between frontmatter blocks survives; layouts, slots, components, UnoCSS/HTML (escaped by `html: false`), click animations, code steps and presenter notes are lost; `/public` absolute image paths are rejected by `projectFilePath` (`lesson-project.ts:30-44`). The naive import already shows the result (2.4). [E][C]
- Into the player: needs a real build. The repo's answer is `tools/slidev/pack.mjs` (297 lines: esbuild bundles the module graph to one IIFE, parse5 inlines CSS and assets, `portable-runtime.js` shims storage/BroadcastChannel). The browser compiles nothing (`tools/slidev/vite.config.ts:3-4`). In-browser compilation is a separate research question (other agents).

## 4. Reusable assets for the new goal

| Asset | Where (lines) | What it does today | Generalises to arbitrary Reveal.js/Slidev projects? | What must be rewritten |
| --- | --- | --- | --- | --- |
| Project model | `src/lib/lesson-project.ts` (131) | `LessonProject {version:2, id, document, files[{path, content}], imagePaths[]}`; `safeProjectPath`, `projectFilePath` (relative resolution with traversal and URL rejection), `relativeProjectPath`; limits 150 entries, 2 MB per text file, 6 MB text | Path safety and resolution: yes, as is | Text whitelist `md, markdown, txt, json, html, htm, css, js` + README/LICENSE/NOTICE (`:24-27`) excludes `svg, vue, ts, yaml, scss, woff2, mp4`…; `document` must be Markdown (`:64`); binary files exist only as "images". Needs engine + entry file, generic binary assets, larger limits (a Reveal `dist/` is 25 files / 3.57 MB of mostly text, close to the 6 MB cap) |
| ZIP import/export | `src/lib/document-bundle.ts` (340) | fflate `unzipSync` with a filter enforcing limits; single-root-folder detection; manifest v1/v2; image reference rewriting that respects code and math; `zipSync` export | The skeleton and the root-folder heuristic: yes | Fatal on unknown types (`:306-308`); one-Markdown-file assumption (`:309-312`); 150-entry and 30 MB caps. The stricter central-directory audit in `presentation-package.ts:97-201` (CRC, overlap, ZIP64, symlinks, ratio) is the better base for untrusted archives |
| Storage | `src/lib/draft-store.ts` (327), `src/lib/presentation-store.ts` (189) | Drafts: one IndexedDB store, whole project inside the draft record, optimistic revision check in one transaction, conflict copies, BroadcastChannel. Presentations: separate database with the original ZIP Blob + metadata, no per-file state | Revision/conflict logic: yes | Two unrelated stores; packages are immutable blobs. Every autosave re-validates and rewrites the full record and compares projects with `JSON.stringify` (`markdown-workspace.ts:80-86`). Measured cost is small at today's cap: +70 ms per save for a 22 MB project (575-591 ms vs 504-518 ms cycle), storage constant at 20.6 MB [E12]. A file-level store is needed only if limits rise |
| "Lesson files" editor | `markdown-workspace.ts:1568-1603`, `TeacherWorkflow.astro:68-79` | Modal dialog, `<select>` of text files, one 300 px `<textarea>`, Save applies all edits atomically with stale-edit guards | The guards and the atomic apply: yes | No tree, no add/rename/delete, no binary handling, no syntax highlighting, modal (preview hidden while editing). CodeMirror is already bundled and `@codemirror/lang-html`, `lang-css`, `lang-javascript` are already installed and shipped as dependencies of `lang-markdown` (HTML grammar found in the 921 KB workspace chunk), so a real editor costs little weight; Vue would need `@codemirror/lang-vue` |
| Revision review | `src/lib/lesson-revision.ts` (63), `markdown-workspace.ts:1480-1566` | Path-level added/changed/removed with full before/after text; images compared by bytes; settings as a pseudo-file; update keeps a recovery draft; guards against concurrent edits | Almost entirely engine-agnostic | `portableLessonSource` is Markdown-image specific; no line diff (a bounded one exists: `cleanupDiff`, `src/lib/cleanup-review.ts:89-126`, 80,000 chars / 1,000 lines); needs an identity for projects without a manifest; not wired to Slidev packages at all |
| Static checker | `src/lib/lesson-check.ts` (136) | Re-renders the deck; regex checks on demo HTML for linked scripts/styles, frames, inline events, fetch/XHR/WebSocket/Worker/import, linked images, storage; formatted report for pasting to an AI | The idea and the report format: yes. These are exactly the checks "will this HTML run in the opaque sandbox" | Regex on text -> DOM parse in an inert template (as `preparePresentationDocument` already does); resolve every `src/href/url()` against the ZIP file map; classify CDN URLs (known and replaceable vs unknown); detect `hash: true`, external Markdown, Google Fonts, `eval`. Add runtime findings (sandbox errors, CSP violations) to the report. Detect foreign dialects |
| Demo sandbox | `public/demo-sandbox.html` (34), `src/scripts/interactive-demo-runtime.ts` (354) | Opaque iframe (`sandbox="allow-scripts"`), `document.write` of a prepared document <=160,000 chars, nonce + inline-only CSP, virtualised timers for pause/resume, canvas snapshot relay, error relay | Too small for a deck (reveal.js alone exceeds the 100,000-char source cap) | Keep for small demos. Port its pause/resume and snapshot ideas to the deck player |
| Presentation sandbox | `public/presentation-sandbox.html`, `src/lib/presentation-runtime.ts` (331) | Opaque runner -> `blob:` child, CSP, in-memory storage shim, error relay, 20 s timeout, <=26 M chars, Start/Stop/Restart, standalone export shell | **Yes - it already runs a full Reveal.js deck** [E5] | Engine check and 20+ "Slidev" strings (9 in the runtime, 13 in the library UI); fatal-on-first-error policy; `fullscreen 'none'` and no popups; no History shim; `script-src-attr 'none'` plus attribute stripping; assets must be `data:` (base64 +33%); no state bridge (current slide is lost on reload); math/CDN substitution |
| Slidev packager | `tools/slidev/pack.mjs` (297) | Node-side esbuild + parse5 inliner with licence collection | Its HTML/CSS inlining logic is the model for a browser-side Reveal importer | Node-only (fs, esbuild); for Reveal no bundler is needed |
| Exports | `document-bundle.ts:162-212`, `export-slides.ts`, `presentation-runtime.ts:324-331` | Project ZIP; one-file offline deck (reveal runtime + KaTeX fonts + demo runtime); one-file player for packages; print-to-PDF | ZIP writer and the "player shell around an opaque frame" export: yes | For a wrapped Reveal deck the inlined HTML is already a standalone file. PDF from inside an opaque sandbox is unsolved (`window.print` needs `allow-modals`) [I] |
| AI hand-off | `src/lib/ai-lesson.ts`, `src/lib/slidev-prompt.ts`, `TeacherWorkflow.astro` | Brief form -> prompt; starter ZIP; report loop; projectId-based revision | Brief form, starter idea, report loop: yes | Prompt bodies (74% and 72% format-specific) become short for standard Reveal.js, which models already know [I] |

App-shell constraints an in-browser pipeline must respect [E11]: the page CSP (`src/layouts/BaseLayout.astro:20-32`, delivered as `<meta>`) is `script-src 'self'` -> `eval`/`new Function` blocked, **WebAssembly blocked** in the page and in `blob:` workers ("…because 'unsafe-eval' is not an allowed source…"), `import(blobUrl)` blocked; allowed: `blob:` workers (`worker-src 'self' blob:`), `fetch` to any https host (`connect-src 'self' https: blob:`; jsDelivr returned 200 from page and worker), IndexedDB, OPFS (`navigator.storage.getDirectory()` ok), `frame-src 'self'` only. `crossOriginIsolated` is false and `SharedArrayBuffer` undefined. Because the policy is a meta tag in the site's own layout, adding `'wasm-unsafe-eval'` or `blob:` is a source change, not a hosting change.

## 5. Friction and failure points

### 5.1 Teacher with only a chat AI (no terminal)

1. **Asking for "Reveal.js slides" produces something the site cannot open.** A chat answer is normally one `index.html` with CDN links, sometimes a ZIP of it. Rows 1-7 and 25-26 of table 1.5: refused or mis-opened in every form. [E]
2. To succeed the teacher must discover "Create with AI", choose "Markdown", and paste an 833-word contract; the AI must then honour a format it has never seen. Observed and code-derived failure modes:
   - No ZIP capability: the site has no multi-file paste import. The workable fallback is single-file: paste the Markdown (Paste dialog), switch to Slides by hand (pasted text opens in Document mode with the toast "Your text is ready. Try Clean up or choose a PDF style."), and keep demos inline. A pasted `interactive src="demos/…"` fence yields "Import the lesson ZIP to load this separate demo file. A Markdown file alone does not include its demo code." [E9] The prompt recommends separate files and mentions inline fences only in its last INTERACTIVE DEMOS sentence.
   - Any extra file type (SVG diagram, `.py` plot script, `.csv`, `.ipynb`) aborts the import (rows 14-15). Chat AIs without image generation tend to produce SVG. [E][I]
   - Wrong image bytes abort the import (row 21). [E]
   - Kept placeholder id -> false "revision" of an unrelated lesson (row 24). [E]
   - Missing manifest or extra root file -> Document mode, no identity (rows 16, 22). [E]
   - Library-based demos (Chart.js, Plotly, D3, three.js) fail at Run; the 100,000-char cap rules out inlining them. Only hand-written canvas/DOM code works. [E][C]
   - `onclick=` handlers are stripped silently; only "Check lesson" mentions it. [C `interactive-demo-runtime.ts:207-210`]
   - Reveal/Marp/Slidev syntax from habit renders as text and passes the check (2.4). [E]
3. **Slidev is unreachable** unless the chat product can run npm. What the vendors document today:
   - Claude: "Code execution and file creation is available to all Claude users (Free, Pro, Max, Ultra, Team, and Enterprise)"; for individual plans "Network access is enabled, allowing Claude to install packages from approved sources"; approved package managers include npm (registry.npmjs.org); "The maximum file size is 30MB per file for both uploads and downloads." [D https://support.claude.com/en/articles/12111783-create-and-edit-files-with-claude]. Whether a 128 MB / 573 MB Slidev install fits that sandbox's time and disk limits was not tested. [U]
   - ChatGPT: a January 2026 write-up reports that its container runs Bash and Node.js and that "`pip install package` and `npm install package` both work now via a custom proxy mechanism" while general outbound requests stay blocked [S https://simonwillison.net/2026/Jan/26/chatgpt-containers/]. A user report dated 2026-08-02 says the internal npm registry returned HTTP 503 on July 24-25 and HTTP 404 on August 2, with no staff reply [S https://community.openai.com/t/chatgpt-container-internal-npm-registry-changed-from-http-503-to-http-404-npm-installs-remain-unavailable/1388749]. Current state unknown. [U]
   - Gemini: the Canvas help page documents export to Docs, Slides, PDF and Colab; it does not mention multi-file projects or ZIP download [D https://support.google.com/gemini/answer/16047321]. [U] for actual capability.
4. Every error on the Slidev side sends the teacher to "tools/slidev/README.md", a repository path with no link, and calls any website ZIP a Slidev problem. [E]
5. Demo interaction during class needs a "Run demo" click per demo, again after every edit and in every export. [E6][C]

### 5.2 User with a coding agent (terminal available)

1. Reveal.js: the agent can build a perfect standard project (`npm i reveal.js`, copy `dist/`), and the site still refuses it (rows 1-5). The agent succeeds only by abandoning Reveal.js for the site's Markdown dialect.
2. Slidev: works when the agent follows the starter exactly. Measured here (T1, 4 CPUs, Node 22.23.5, npm 10.9.9, empty npm cache): `npm ci` 10.8 s, 128 MB of tarballs, 573 MB `node_modules`, 751 lockfile packages; `npm run build` 3.7 s (rebuild 4.2 s); `node pack.mjs` 0.94 s -> `lesson.zip` 1,674,953 bytes with a 3,523,631-byte `presentation.html`. So the machine cost of one revision is about 5 s; the human cost is the download/upload/restart cycle and the loss of the current slide.
3. Where agents go wrong: starting from an ordinary Slidev project instead of the starter. [E] Running the repo's own packager on the default-config build in `shared/slidev-ordinary/dist` (and on `dist-relative`) fails at once: "Slidev packaging failed: External asset cannot be packaged: https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@200;400;600&family=Fira+Code:wght@200;400;600&display=swap. Bundle it during the Slidev build." So the site's advice for row 12 ("use the QFT Slidev packaging tool to bundle its scripts, fonts, and assets") does not work on a default build; the headmatter must first be changed to the portable profile (`fonts.provider: none`, `routerMode: memory`, …) and the deck rebuilt. Other packager stops [C `tools/slidev/pack.mjs:81, 104, 122, 164, 193`]: "The build still contains CSS @import. Bundle styles in Vite before packaging.", "Unbundled module …", "The built presentation contains <iframe>…", "Inline HTML event handlers are not supported." Delivering `dist/` or source is refused (rows 8, 12). Libraries that need workers, `eval`, or runtime fetch pass the build and fail in the player [C `tools/slidev/README.md:67-80`].
4. The agent cannot run the acceptance test the prompt demands ("Open the packaged presentation in md.qft.org, visit every slide…", `slidev-prompt.ts:37`) without driving a browser against the live site.
5. No revision support for packages: duplicates in the library, no diff, no identity (B7).

### 5.3 Both

- Two products behind one "Open file": drafts in the workspace versus packages in a modal library with a separate database; a Markdown lesson opened from the library's own picker is refused with "This is a Markdown lesson ZIP. Close this panel and use Open file in the workspace to edit it." (`presentation-library.ts:71`).
- Goal 4 is met only by Path A, and there only through a modal textarea.
- Goal 3 ("interactions") is met by Path A only inside isolated demo cards, and by Path B only for pre-built packages.

## 6. Improvement ideas

Effort: S <= 2 days, M <= 2 weeks, L <= 6 weeks, XL more. Ordered by value for the owner's goal.

| # | Idea | Effort | Impact | Why (evidence) |
| --- | --- | --- | --- | --- |
| 1 | **Native Reveal.js project import and playback.** Accept a standard ZIP or a single HTML file; in the browser: unzip -> find the entry -> rewrite local references (and known CDN URLs, see 2) -> inject a small compat shim (History no-op, `window.open`/fullscreen stubs) -> run in the existing opaque runner with a non-fatal error policy and an engine-neutral manifest/UI | L | Very high | E5: the existing player already runs a full 6.0.2 deck after five mechanical rewrites; import 0.2-0.3 s, start ~0.5 s. Today every standard deck is refused (1.5) |
| 2 | **Vendor Reveal.js and resolve CDN references locally.** Ship pinned copies (6.0.2 `dist/` is 3.57 MB; core + one theme + markdown/highlight/notes ~1.2 MB) and map `cdn.jsdelivr.net/npm/reveal.js…`, `unpkg.com/reveal.js…`, `cdnjs…/reveal.js/…` including the 4.x/5.x `plugin/<n>/<n>.js` layout; substitute a local KaTeX for `RevealMath` | M | Very high | The typical chat answer is a CDN single file; the math plugin is CDN-only and fatal (3.3); v6 path drift breaks unpinned URLs (3.1). The site already ships KaTeX 0.19.1 and reveal.js |
| 3 | **Edit-and-replay loop for Reveal projects.** File tree + CodeMirror (HTML/CSS/JS grammars already shipped) beside the player; on save re-inline and reload the frame; restore position through a postMessage bridge (`Reveal.getState()/setState()`) | M (after 1) | Very high | Source equals runtime in Reveal.js (3.3); this is goal 4 with no compiler |
| 4 | **Stop false successes and wrong-engine messages.** Detect Reveal decks (`class="reveal"`, `Reveal.initialize`), Slidev source (headmatter keys, `<v-click>`, `.vue`) and generic sites; never open a lone README/`slides.md` as a "lesson"; replace "tools/slidev/README.md" with a link and a next step | S | High | Rows 1, 3, 10, 11, 12 |
| 5 | **Make the checker dialect-aware and runtime-aware.** Warn on `<!-- .slide:`, `<!-- .element:`, `Note:`, `--`, raw HTML, Slidev frontmatter/components; append sandbox errors and CSP violations to the copyable report | S-M | High | E8/E13 false green; the report loop is the site's best AI-facing idea |
| 6 | **Teach the Markdown mode the Reveal.js Markdown conventions** (allowlisted): `Note:`, `<!-- .slide: … -->`, `<!-- .element: class="fragment" -->`, vertical `--`, code line steps; enable fragments, transitions, backgrounds from project images, overview, pause | M | High for Path A | Removes most of the 108-word SLIDE SYNTAX section and matches what "powered by reveal.js" promises (2.4). Does not deliver arbitrary HTML/JS decks |
| 7 | **Tolerant lesson import.** Skip unknown files with a listed warning instead of aborting; preserve them as opaque blobs; accept SVG as an image (sanitised or `<img>`-only); report the 150-entry limit truthfully | S (skip + warn) / M (preserve) | Medium-high | Rows 14, 15, 21, 23; doc mismatch (2.5 item 6) |
| 8 | **Prompt fixes.** Insert a real UUID generated at copy time instead of a valid-looking placeholder, or reject the placeholder; list allowed file types and state that others are dropped; offer a "single message, no ZIP" variant with inline demos; add a "Reveal.js" option whose prompt is a few lines once idea 1 exists | S | Medium-high | Row 24; 5.1 item 2; prompt is 74% format teaching (1.4) |
| 9 | **Multi-file paste import** for chat tools without files: accept one pasted message containing fenced blocks labelled with paths and build the project | S-M | Medium | 5.1 item 2 first bullet |
| 10 | **Non-fatal player policy and host-provided affordances.** Log errors instead of stopping; provide presenter notes and fullscreen from the host; allow inline handlers inside the opaque frame or convert them | S-M | High (prerequisite of 1) | S and F keys kill a deck (3.3) |
| 11 | **Line diff and per-file accept in revision review; extend review and identity to packages** (reuse `cleanupDiff`) | S-M | Medium | Textareas only (A7); packages duplicate (B7) |
| 12 | **One project model and store** for Markdown lessons, Reveal projects and Slidev packages: manifest with `engine`, per-file records including binaries, shared revision/recovery logic | L | High (structural) | Section 4 rows 1-3; two databases today |
| 13 | **Slidev: publish the packager** (`npx …` one-liner that works on any Slidev project, applying the portable profile itself) and return structured errors | M | Medium | 5.2 items 2-3; removes "copy these four files" |
| 14 | **Slidev source in the browser** (compile Vue/Markdown/UnoCSS client-side) | XL | High for goal 4 on Slidev | Requires at least `'wasm-unsafe-eval'` or pure-JS compilers and a module loader inside the sandbox (E11). Feasibility belongs to the prototype agents |
| 15 | **Fix the two Reveal integration defects**: ignore the page query string for the embedded deck; relax the `.katex-display` overflow test | S | Medium | 2.5 items 1-2 |
| 16 | **Auto-start and persistence for demos** (optional autoplay when the slide becomes active in Present; keep running demos across unrelated edits) | S-M | Medium | 5.1 item 5 |

## 7. Open questions

1. Should the Markdown dialect stay as a third format, or converge on Reveal's Markdown conventions so one mental model serves both?
2. Is downloading public library files (Reveal plugins, KaTeX, fonts) at import time compatible with "nothing is sent to a server"? No user content leaves the browser, but requests are made; vendoring avoids the question at a cost of roughly 1-4 MB of static files.
3. Which runtime errors should stop a third-party deck? Today all do.
4. How should a project without a manifest get a stable identity for revision review - a sidecar file added on export, a content hash, or the file name?
5. Is a presenter view required? The sandbox forbids pop-ups; the host could render notes itself.
6. PDF for arbitrary decks: print from an exported standalone file, or build a host-side print view?
7. Do current chat products reliably emit ZIPs and v6-style paths? (Corpus work by other agents.)
8. Storage quotas for video-heavy decks if the 30/60 MB caps are raised.
9. The app-shell CSP forbids WebAssembly and `eval`; is the owner willing to add `'wasm-unsafe-eval'` if an in-browser compiler needs it?

## 8. Appendix

### 8.1 Limits in code

| Limit | Value | Source |
| --- | --- | --- |
| Markdown source | 400,000 chars; 200 slides | `render-markdown.ts:22-23` |
| Lesson ZIP | 30 MiB, 150 entries, text file 2 MiB, manifest 32 KiB, image 8 MiB | `document-bundle.ts:12-14`, `:277-288` |
| Project text | 2 MiB per file, 6 MiB total, 150 entries | `lesson-project.ts:13-15` |
| Images | 8 MiB each, 24 MiB total, 50 | `image-assets.ts:11-13` |
| Demos | 20 per document, 100,000 chars each, 160,000 prepared | `interactive-demos.ts:9-10`, `interactive-demo-runtime.ts:235` |
| Presentation package | ZIP 60 MiB, expanded 120 MiB, HTML 24 MiB, file 40 MiB, 1,000 entries, source preview 2 MiB per file / 8 MiB | `presentation-package.ts:5-14` |
| Player | 26 M chars prepared, 20 s load timeout | `presentation-runtime.ts:60`, `:216`, `:272` |

### 8.2 Sizes measured

- Built site chunks: workspace 921,451 B; `dist.*.js` 374,954 B; export-slides 197,853 B; reveal (lazy) 118,470 B; presentation library 28,503 B; presentation-package 9,178 B; document-bundle 8,523 B; slide-preview 8,810 B.
- reveal.js 6.0.2: `dist/reveal.js` 118,912 B; `reveal.css` 53,963 B; plugins highlight 920,644 B, notes 67,789 B, markdown 49,498 B, math 4,015 B, search 2,870 B, zoom 2,877 B; themes 5-6 KB (remote fonts), 46 KB (beige, league, moon, solarized), 575 KB (black, white and their contrast variants).
- Exported Markdown deck (8 slides): 603,351 B. Wrapped standard deck: 1,795,514 B.

### 8.3 Timings

- Slidev starter, cold npm cache: `npm ci` 10.83 s; build 3.68 s; pack 0.94 s; rebuild 4.23 s (`out/slidev-timing.txt`).
- Player: wrapped Reveal import 214-275 ms, start 468-644 ms; portable Slidev import 349-367 ms, start 441-486 ms (3 runs each).
- Autosave cycle: 504-518 ms (tiny lesson) vs 572-591 ms (22 MB lesson); 500 ms of each is the debounce (`markdown-workspace.ts:302`).

### 8.4 Housekeeping

The static server on port 4410 and all browsers were stopped at the end of the session. The 573 MB timing install was deleted; logs remain in `out/`.
