# B6 — In-browser multi-file source editing with a live presentation preview

Research agent B6, 2026-11-24. Everything under "verified-empirically" was run in this container
(Linux, 4 CPUs, Node 22.23.5, Playwright Chromium headless shell 158.0.8127.36). Prototypes live in
`../prototypes/B6/`
(called `$B6` below). Nothing in `<repo>` was modified.

Labels: **[E]** verified-empirically, **[P]** verified-primary-source, **[S]** secondary-source,
**[I]** inferred, **[U]** uncertain.

---

## 0. Short answer

1. **Keep CodeMirror 6.** The site's current bundle already contains the HTML, CSS and JavaScript/TypeScript
   parsers (they arrive through `@codemirror/lang-markdown`). Adding JSON, YAML, Vue, a lint gutter, the
   merge/diff review view, slide mapping and an AI-answer importer costs **+61.5 KB minified / +23.2 KB gzip**
   in total. Monaco's smallest usable core is **2,833 KB minified / 729 KB gzip** plus workers, and its own
   README says mobile browsers are not supported. [E][P]
2. **The differentiator (slide ↔ source) is cheap and works.** A 5 KB mapper built on the Lezer HTML parser
   the site already ships maps every runtime slide of Reveal's own 41-slide demo deck, and of a mixed
   HTML / external Markdown / inline Markdown deck, to the right source range. Reveal's built-in postMessage
   API gives slide sync across the opaque sandbox with no injected code. A built Slidev client gives the
   current slide through vue-router. [E]
3. **Full reload is fast enough to be the default refresh.** Reloading a 41-slide Reveal deck in a sandboxed
   frame and restoring the slide took a median 173–189 ms; a 120-slide deck with 360 KaTeX formulas 482 ms;
   a 3.36 MB compiled Slidev deck 207–216 ms. CSS-only and single-slide patches paint in 25–37 ms. Loading the
   new frame hidden and swapping it in only when it is ready removes the flash and gives "keep the last good
   render" for free. [E]
4. **The AI loop needs no AI service.** A 3.2 KB (gzip) dependency-free importer handled 13 of 13 synthetic
   answer shapes that I wrote to resemble chat output (SEARCH/REPLACE blocks, sloppy unified diffs, OpenAI
   `*** Begin Patch`, labelled whole files), including refusing a "... rest unchanged ..." whole-file answer. jsdiff's strict `applyPatch` threw on the sloppy
   diff. Review uses `@codemirror/merge` (verified accept/reject per change). [E]
5. **Three findings that affect other workstreams:**
   - Reveal with `hash: true` (its template default) throws `SecurityError` from `history.replaceState` in
     the sandbox. The site's player treats any uncaught error as fatal (`src/lib/presentation-runtime.ts:127-131`,
     `:237-245`): in the real production build such a deck ends in "Playback needs attention" with the frame
     removed. A six-line history shim makes the same deck play. [E]
   - A `blob:` URL made by the site cannot be loaded inside the opaque sandbox; bytes sent by `postMessage`
     and turned into a blob inside the frame can (50 MB transferred in 0.1 ms). [E]
   - WebMCP exists in Chromium 158 as `document.modelContext` (not `navigator.modelContext`) behind a flag /
     origin trial; I registered and executed three page tools. [E][P]

---

## 1. Editor engine

### 1.1 What the site ships today

- `package.json` pins `codemirror 6.0.2`, `@codemirror/state 6.7.6`, `view 6.43.15`, `language 6.13.1`,
  `commands 6.11.1`, `search 6.7.2`, `lang-markdown 6.5.2`, `@lezer/highlight 1.2.5`. [P: `package.json`]
- Editor construction: `src/scripts/markdown-workspace.ts:264-274` (`basicSetup`, `markdown()`, a wrapping
  `Compartment`, `Mod-s`). Preview debounce 180 ms (`:293`), autosave debounce 500 ms (`:302`). [P]
- Production build: `dist/_astro/MarkdownWorkspace…js` is 921,451 bytes (299,852 gzip);
  `PresentationLibrary…js` 28,503 (9,057 gzip). [E: `gzip -9c | wc -c` on the files in `dist/_astro`]
- "Source files" today is a read-only textarea: `src/components/PresentationLibrary.astro:52`
  (`<textarea data-pres-source-text readonly>`), view switch at `:34`. [P]
- Site CSP (`src/layouts/BaseLayout.astro:20-32`): `script-src 'self'`, `style-src 'self' 'unsafe-inline'`,
  `worker-src 'self' blob:`, `connect-src 'self' https: blob:`, `frame-src 'self'`. [P]

### 1.2 Current package versions (npm registry, 2026-11-24) [E: `npm view <pkg> version time.modified`]

| Package | Latest version | Registry `time.modified` (version date where checked) |
| --- | --- | --- |
| codemirror | 6.0.2 | 2026-02-07 |
| @codemirror/state / view / language | 6.7.6 / 6.43.15 / 6.13.1 | 2026-09-22 / 2026-10-19 / 2026-10-07 |
| @codemirror/commands / search / autocomplete | 6.11.1 / 6.7.2 / 6.20.4 | 2026-09-15 / 2026-08-31 / 2026-10-19 |
| @codemirror/lint | 6.9.8 | 2026-11-13 |
| @codemirror/merge | 6.12.3 | version published 2026-10-19 |
| @codemirror/lang-html / css / javascript | 6.4.12 / 6.3.1 / 6.2.5 | |
| @codemirror/lang-json / yaml / xml / markdown | 6.0.2 / 6.1.3 / 6.1.0 / 6.5.2 | |
| @codemirror/lang-vue | **0.1.3** (still 0.x; last release 2023-12-28) | |
| @codemirror/language-data | 6.5.2 | |
| @codemirror/lsp-client | 6.3.1 | 2026-11-16 |
| @lezer/common / lr / highlight / html | 1.5.6 / 1.4.12 / 1.2.5 / 1.3.13 | |
| monaco-editor | 0.58.0 | version published 2026-11-23 (`next` tag: 0.59.0-dev) |
| reveal.js | 6.0.2 | version published 2026-09-10 |
| @slidev/parser, @slidev/client | 53.1.0 | (from the shared starter's `node_modules`) |
| diff (jsdiff) | 9.0.0 | |
| fflate | 0.8.3 (already a dependency) | |

Useful exports confirmed by loading the packages [E: `node -e "Object.keys(require(...))"` in `$B6/cm-measure`]:
`lang-html`: `html, htmlCompletionSource, autoCloseTags`; `lang-css`: `css, cssCompletionSource`;
`lang-javascript`: `javascript, localCompletionSource, scopeCompletionSource, snippets, typescriptSnippets, esLint`;
`lang-yaml`: `yaml, yamlFrontmatter`; `lang-json`: `json, jsonParseLinter`;
`lint`: `linter, lintGutter, setDiagnostics, forEachDiagnostic, openLintPanel …`;
`merge`: `MergeView, unifiedMergeView, acceptChunk, rejectChunk, getChunks, getOriginalDoc, updateOriginalDoc, diff, presentableDiff …`;
`search`: `SearchCursor, RegExpCursor, SearchQuery, openSearchPanel, replaceAll …`.

### 1.3 Bundle sizes, measured [E]

Method: `$B6/cm-measure/measure.mjs` — esbuild 0.28.2, `bundle`, `minify`, `format: esm`, `target: es2022`;
gzip level 9, brotli quality 11. The baseline entry imports exactly what `markdown-workspace.ts` imports.
Run: `cd $B6/cm-measure && node measure.mjs` (results in `results.json`).

| Scenario | min KB | gzip KB | Δ min | Δ gzip | Δ brotli |
| --- | ---: | ---: | ---: | ---: | ---: |
| Baseline = site today (basicSetup + markdown) | 599.4 | 204.9 | — | — | — |
| + `html()` | 599.4 | 204.9 | 0.0 | 0.0 | 0.0 |
| + `css()` | 599.4 | 204.9 | 0.0 | 0.0 | 0.0 |
| + `javascript({typescript, jsx})` | 599.4 | 204.9 | 0.0 | 0.0 | 0.0 |
| + `json()` + `jsonParseLinter` | 602.7 | 206.5 | 3.3 | 1.6 | 1.0 |
| + `yaml()` | 611.5 | 210.1 | 12.1 | 5.2 | 3.9 |
| + `vue()` | 602.5 | 206.3 | 3.1 | 1.4 | 0.9 |
| + `xml()` (SVG files) | 613.5 | 209.8 | 14.2 | 4.9 | 3.5 |
| + lint API (`linter`, `lintGutter`, `setDiagnostics`) | 603.2 | 206.1 | 3.8 | 1.2 | 0.7 |
| + merge (`MergeView` + `unifiedMergeView`) | 627.1 | 214.1 | 27.7 | 9.2 | 7.3 |
| + merge, unified view only | 618.8 | 211.8 | 19.4 | 6.9 | 5.4 |
| + autocomplete extras (snippets, `completeFromList`) | 599.4 | 204.9 | 0.0 | 0.0 | 0.0 |
| + all seven languages | 634.8 | 218.6 | 35.4 | 13.7 | 10.4 |
| + all languages + lint + merge | 662.3 | 227.9 | 63.0 | 23.0 | 17.6 |
| + `@codemirror/language-data` (every language, 124 lazy chunks) | 1643.5 | 608.0 | 1044.1 | 403.1 | — |
| + jsdiff 9 (`applyPatch`, `parsePatch`, `structuredPatch`) | 614.2 | 210.2 | 14.8 | 5.3 | 4.5 |
| + diff-match-patch 1.0.5 | 618.7 | 211.2 | 19.4 | 6.3 | 5.1 |

Why HTML/CSS/JS are free: per-package breakdown of the baseline bundle (`node breakdown.mjs entries/00.js`)
shows `@lezer/javascript` 76.0 KB, `@lezer/css` 16.8 KB, `@lezer/html` 14.0 KB, `@codemirror/lang-html`
13.7 KB, `lang-css` 10.7 KB, `lang-javascript` 6.4 KB already present; `@codemirror/lint` (10.9 KB) and
`@codemirror/autocomplete` (34.4 KB) come with `basicSetup`. [E]

Cumulative tiers (`node tiers.mjs`) [E]:

| Tier (library code only) | min KB | gzip KB | Δ min | Δ gzip |
| --- | ---: | ---: | ---: | ---: |
| Baseline | 599.4 | 204.9 | | |
| MVP: + HTML/CSS/JS/TS/JSON/YAML(+frontmatter)/Vue + lint gutter | 620.8 | 213.7 | +21.5 | +8.8 |
| Solid: + merge review + slide map + AI-answer importer | 660.9 | 228.1 | +61.5 | +23.2 |

Own modules measured alone: slide mapper 5.1 KB min / 2.4 KB gzip (with `@lezer/html` external);
AI-answer importer 7.6 KB / 3.2 KB; Reveal bridge 3.4 KB / 1.5 KB; Slidev bridge 1.2 KB / 0.7 KB (the bridges
are injected into the preview document, not shipped in the site bundle). [E]

### 1.4 Monaco 0.58.0, measured the same way [E]

`$B6/monaco-measure/measure.mjs` and `initial.mjs` (esbuild, minified, ESM, code splitting).

| Piece | min KB | gzip KB |
| --- | ---: | ---: |
| `import * as monaco from 'monaco-editor'` — all JS (93 chunks) | 4,536 | 1,208 |
| …of which loaded before first use | 2,779 | 719 |
| Minimal core: editor API + code editor + diff editor + find + 5 Monarch grammars (JS) | 2,833 | 729 |
| Minimal core CSS | 97 | 15 |
| Full CSS (entry) | 180 | — |
| `codicon.ttf` | 151 | — |
| `editor.worker` | 338 | 100 |
| `json.worker` | 465 | 137 |
| `css.worker` | 1,097 | 251 |
| `html.worker` | 775 | 202 |
| `ts.worker` | 6,912 | 1,521 |

- The core cannot be tree-shaken much below ~2.8 MB minified: `editor.api.js` pulls in the standalone
  services. [E]
- Workers: Monaco needs `MonacoEnvironment.getWorker`; the site's `worker-src 'self' blob:` and
  `style-src 'unsafe-inline'` would allow it, so CSP is not the blocker — size is. [P: BaseLayout.astro][I]
- Mobile: Monaco README FAQ — "Is the editor supported in mobile browsers or mobile web app frameworks?
  **No.**" [P: `node_modules/monaco-editor/README.md:104-106` in `$B6/monaco-measure`]
- LiveCodes (which ships both) documents: "Monaco … requires a relatively large download and is not supported
  in mobile browsers. CodeMirror … good mobile support. By default, Monaco editor is used on desktop,
  CodeMirror is used on mobile." [P: https://livecodes.io/docs/features/editor-settings]
- Accessibility: CodeMirror states "Works well with screen readers and keyboard-only users" and leaves Tab
  unbound so the editor is not a keyboard trap (Esc then Tab escapes). [P: https://codemirror.net/ ,
  https://codemirror.net/examples/tab/] Monaco has a dedicated accessibility guide for integrators.
  [P: README link to the wiki "Accessibility-Guide-for-Integrators"] I did not test either with a real screen
  reader. [U]
- DOM probe in Chromium 158 (`$B6/bigfile/a11y.cjs`) [E]: CodeMirror content is
  `div.cm-content[role=textbox][aria-multiline=true][contenteditable=true]` with an `aria-live` region and no
  `aria-label` unless the host sets one (the site sets `aria-label` at `markdown-workspace.ts:271`). Monaco
  0.58 uses the EditContext API: `div.native-edit-context[role=textbox][aria-label="Editor content"][aria-roledescription=editor]`.
  Typing after a tap worked for both in Playwright's Pixel 7 emulation — that is emulation, not a real phone
  keyboard. [E]

### 1.5 Large files [E]

`$B6/bigfile/bench.mjs` (page at port 4575; each case in a fresh page; 20 single-character inserts in the
middle of the document, one animation frame each).

| File | CodeMirror open → painted | CM typing median (max) | CM heap | Monaco open → painted | Monaco typing median (max) | Monaco heap |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Reveal index.html, 22 KB | 54 ms | 17 ms (39) | +5 MB | 105 ms | 17 ms (30) | +11 MB |
| HTML 1 MB, 33 k lines | 66 ms | 28 ms (58) | +20 MB | 127 ms | 17 ms (126) | +35 MB |
| HTML 5 MB, 166 k lines | 93 ms | 25 ms (125) | +34 MB | 190 ms | 18 ms (105) | +47 MB |
| HTML 20 MB, 663 k lines | 171 ms | 24 ms (125) | +106 MB | 282 ms | 16 ms (166) | +114 MB |
| minified reveal.js, 116 KB, longest line 47 KB | 62 ms | 17 ms (43) | +7 MB | 128 ms | 23 ms (81) | +47 MB |
| compiled Slidev presentation.html, 3.36 MB, longest line 1.49 MB (wrap off) | 66 ms | 27 ms (127) | +28 MB | 196 ms | 16 ms (171) | +54 MB |
| same, line wrapping on | 486 ms | 32 ms (130) | +20 MB | 377 ms | 22 ms (190) | +56 MB |

Page boot from localhost: CodeMirror page 86–134 ms, Monaco page 190–384 ms. Both editors are fine up to
20 MB; large-file behaviour is not a reason to choose Monaco. Recommendation: still treat `dist/`, minified
and >2 MB files as "generated — view only" for non-developers. [E][I]

### 1.6 Other engine facts

- **Multi-file model** [E: `$B6/project-lab/run.mjs`]: one `EditorView`, one `EditorState` per file, swapped
  with `view.setState()`. Each file kept its own undo history across tab switches; an edit dispatched with
  `isolateHistory.of('full')` (the repo already does this at `markdown-workspace.ts:623`) undid as one step.
  Creating 48 states for a 4.9 MB Reveal project took 221 ms and ~5 MB heap; a tab switch averaged 2.4 ms.
- **Search across files** [E: `$B6/review-lab/run.mjs`]: over 48 files / 4.9 MB, native `indexOf` found 430
  hits in 13 ms; CodeMirror `SearchCursor` (building a `Text` per file) took 507 ms. Use native string /
  RegExp search over the in-memory project and CodeMirror's panel only for in-file find/replace.
- **Linting**: only JSON has a ready parser linter. For HTML, Lezer error nodes are a cheap signal but can
  point far from the mistake (see §4.4). `esLint` needs a browser build of ESLint (not measured; large). [E][I]
- **Vue SFC**: `@codemirror/lang-vue` is 0.1.3 and unchanged since December 2023; it highlights template,
  script and style but has no template type checking. Fine for teachers; not an IDE. [E][I]
- **Slidev frontmatter**: `yamlFrontmatter({ content: markdown() })` covers the headmatter only; per-slide
  frontmatter blocks need either a small mixed-parser extension or plain Markdown highlighting. [P: export
  list][I]

**Decision: CodeMirror 6.** It is already loaded, the increment is two orders of magnitude smaller than
Monaco, it works on phones, and its Lezer trees double as the source-mapping engine.

---

## 2. Project UI patterns

### 2.1 What comparable tools do

| Tool | Pattern worth noting | Source |
| --- | --- | --- |
| **Slidev integrated editor** | Edits only the *current slide* (frontmatter + content) and its notes in two tabs; saves with a 500 ms throttle by POSTing to the dev server (`/__slidev/slides/{no}.json`). In a static build `update` is a no-op, so the editor does nothing without the dev server. | [P] `@slidev/client@53.1.0` `internals/SideEditor.vue`, `composables/useSlideInfo.ts`; https://sli.dev/features/side-editor |
| **Slidev VS Code extension** | Slides tree with numbers and titles; click to move the cursor to that slide; drag-and-drop reordering; preview that follows the editor cursor (toggle); folding per slide; Language Model Tools for AI assistants: `slidev_getActiveSlide`, `slidev_getSlideContent`, `slidev_getAllSlideTitles`, `slidev_findSlideNoByTitle`, … | [P] https://sli.dev/features/vscode-extension |
| **Slidev notes editor / overview** | One text area for all notes separated by `--- #[slide-number]`; overview page lists every slide with editable notes. | [P] https://sli.dev/guide/ui |
| **Slidev draggable elements** | Position/size/rotation edited by dragging; written back to frontmatter `dragPos`, or "Slidev use regex to update the position value in the slide content". | [P] https://sli.dev/features/draggable |
| **slides.com** (Reveal's hosted editor) | Block-based WYSIWYG. Developer mode adds a per-slide HTML editor ("Some elements, including `<script>` and `<link>`, are not allowed"), custom classes, a deck CSS editor, HTML export. Reveal import = paste the HTML; "Slides inspects the markup and tells you how many slides it found"; import replaces all slides, Ctrl+Z undoes it. Offers a hosted MCP server (`https://mcp.slides.com/`) for Claude/ChatGPT — needs an account. | [P] https://slides.com/docs/developer-mode , /custom-html , /import-from-reveal-js , /connect-ai-tools , /mcp |
| **Phoenix Code** | Live Preview with Highlight / Edit / Preview modes. Edit Mode (Pro): click an element → Control Box (tag, id, classes, size; Insert, Edit Text, Change Image, Edit Link, Duplicate, Delete, Styles); double-click to edit text, Enter saves, Esc cancels; drag to reorder; undo/redo covers preview edits. **"Elements added by JavaScript are not in your HTML source … 'Element not editable - generated by script'."** Opt-out class `phcode-no-lp-edit` for interactive widgets. | [P] https://docs.phcode.dev/docs/Pro%20Features/live-preview-edit |
| **LiveCodes** | Fully client-side playground. Editor is chosen per device (Monaco desktop, CodeMirror mobile, CodeJar read-only). Export: Project JSON, Source ZIP, Result as a single HTML file. Import from URL / gist / ZIP via `?x=`. | [P] https://livecodes.io/docs/features/editor-settings , /export , /import |
| **vscode.dev** | Opens local folders with the File System Access API; "If your browser does not support the File System API, you cannot open a folder locally, but you can open files instead." Stores handles in IndexedDB (`vscode-filehandles-store`). Browser shortcuts collide (Ctrl+W, Ctrl+N, Ctrl+Shift+P in Firefox). | [P] https://code.visualstudio.com/docs/setup/vscode-web ; https://developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api |
| **StackBlitz / WebContainers** | File tree + editor + preview + terminal. Needs `Cross-Origin-Embedder-Policy` and `Cross-Origin-Opener-Policy` response headers; "supported on desktop Chromium-based browsers out of the box"; Safari/Firefox "beta" (page updated October 2026). GitHub Pages cannot set those headers. | [P] https://webcontainers.io/guides/browser-support , /guides/configuring-headers |
| **CodeSandbox Sandpack** | Per-file flags `readOnly`, `active`, `hidden`; `visibleFiles` / `activeFile`; a "Read-only" label above the editor. The hosted CodeSandbox product itself was not examined. | [P] https://sandpack.codesandbox.io/docs/getting-started/usage |

### 2.2 What to copy for a small static site [I, built on the sources above]

- **Slide list first, file tree second.** Teachers think in slides. Default left panel = slide list (number,
  title, tiny status dot for "changed"); a "Files" toggle reveals the tree. This is Slidev's tree view plus
  slides.com's rail.
- **Three file classes** decided on import: *content* (index.html, slides.md, components, custom CSS,
  images) — editable; *vendor/generated* (`dist/`, `plugin/`, `node_modules`-like, minified, compiled
  `presentation.html`) — collapsed, read-only, labelled "Framework files"; *binary* — preview + replace.
- **Tabs** only for files the user opened; a pinned "Slides" tab. One `EditorView`, state per file (§1.6).
- **Binary assets**: preview images with `<img>`, video/audio with native controls, fonts with `FontFace`
  on sample text; show size and where the file is referenced (project search for its name). "Replace" keeps
  the path so references survive; warn when the type changes. Inside the sandbox the asset must be a data URL
  or a blob made *inside* the frame (§4.6).
- **Add / rename / delete**: rename must offer to update references (search-and-replace preview through the
  merge view). Delete goes to a per-project "Removed files" list until the next snapshot.
- **Drag and drop**: `DataTransferItem.webkitGetAsEntry()` works everywhere (Chrome 13, Firefox 50, Safari
  11.1) and is enough to read dropped folders; `getAsFileSystemHandle()` is Chromium-only (Chrome 86, Chrome
  Android 132) and additionally yields writable handles. [P: MDN browser-compat-data, §5.1]
- **Unsaved-change model**: no Save button for browser storage — autosave like the existing drafts (500 ms)
  with a visible "Saved in this browser" state, plus explicit, named actions that leave the browser: "Download
  ZIP", "Save to folder" (Chromium). Keep the existing optimistic `revision` + `BroadcastChannel` conflict
  model (`src/lib/draft-store.ts:281-311`).
- **Storage shape**: the uploaded ZIP stays immutable (the presentation store already keeps it:
  `src/lib/presentation-store.ts:153-157`); the working copy is an overlay `{path → text | Blob | deleted}`
  with a revision; a snapshot is a named copy of the overlay. "Restore original upload" = drop the overlay.
  Export = original entries + overlay through fflate.
- **Undo across files**: CodeMirror history is per file. A project-level journal records multi-file
  operations (AI change, rename-with-references, slide reorder, restore) as one entry with before/after per
  file; "Undo AI change" restores all files and is itself undoable.
- **Export**: fflate round trip of the 48-file / 4.91 MB Reveal project in Chromium — zip 661 ms at level 6
  (synchronous; run it async or in a worker), unzip 167 ms, byte-identical. [E: `$B6/project-lab/run.mjs`]

---

## 3. Slide-aware editing

### 3.1 Reveal.js HTML decks — slide → source range [E]

Prototype: `$B6/reveal-lab/slide-map.mjs` (`mapRevealDeck`, `slideAtOffset`). Method: parse with
`@lezer/html`; find `class="slides"` (preferring one inside `class="reveal"`); direct `section` children are
horizontal slides, their direct `section` children vertical slides; skip `data-visibility="hidden"` (Reveal
removes those: `reveal.js/js/reveal.js:297-299`); expand `data-markdown` sections (see §3.2).

Verification (`node test-map.mjs`, real Reveal 6.0.2 loaded in Chromium, comparing each runtime slide's
indices and heading with the mapped source range):

- Reveal's own `demo.html` (21.6 KB, nested vertical stacks, inline Markdown, a hidden slide, a code block
  containing literal `<section>` text): **41 of 41** runtime slides map to the correct range; cursor →
  slide (`slideAtOffset`) also correct. First mapping call 33 ms (cold), 3 ms on a 1.3 KB deck. In the editor
  the tree comes from CodeMirror's `syntaxTree`, so the extra cost is a tree walk.
- A first version got 9 of 41 because it did not drop the hidden slide — every later index shifted. The
  runtime comparison is what caught it; keep that comparison as a permanent self-check (§4.4).

### 3.2 Reveal.js Markdown decks [E]

Reveal's Markdown plugin splits with regular expressions, not a Markdown parser
(`plugin/markdown/plugin.js` in 6.0.2: default separator `\r?\n---\r?\n`, vertical separator none, notes
`^\s*notes?:`; inline templates are de-indented before splitting). [P: https://cdn.jsdelivr.net/gh/hakimel/reveal.js@6.0.2/plugin/markdown/plugin.js]
`slidifyRanges()` is a line-for-line port that returns ranges; `deindentWithMap()` reproduces the
de-indentation with an offset map so inline `<textarea data-template>` content maps back to `index.html`.

Verification deck (`deck/md-deck.html` + `deck/slides.md`): HTML slide, external Markdown with horizontal
and vertical separators, a `---` inside a code fence under a custom separator, a notes separator, a vertical
stack mixing HTML and inline Markdown, an inline two-slide template → **12 of 12** slides mapped, including
file attribution (`slides.md:41-96` versus `md-deck.html:674-741`).

Consequence worth telling users: with Reveal's *default* separator a `---` line inside a code block does
split the slide. [P]

### 3.3 Slidev [E][P]

- **Source side.** `@slidev/parser@53.1.0` `parseSync` (dist/core.mjs:420-469) splits on a line whose
  `trimEnd()` starts with `---`; exactly three dashes followed by a non-blank line opens a frontmatter block;
  only backtick fences are skipped (a `~~~` fence does **not** protect a `---` line); HTML comments are
  skipped. `mapSlidevMarkdownExact()` ports those ~40 lines. Compared with the official parser on the
  ordinary deck, the starter deck and a tricky file (16 slides, `start` / `contentStart` / `end`):
  **all boundaries identical**. A "more correct" splitter that honoured `~~~` fences disagreed with Slidev on
  4 slides — fidelity beats correctness here. Cost: port 5 KB min / 2.4 KB gzip (shared module) versus
  `@slidev/parser/core` 106 KB / 33.3 KB gzip (it bundles `yaml`). [E: `node test-slidev-map.mjs …`]
  Not covered by the port: `src:` imports and `disabled`/`hide` frontmatter, which change numbering; those
  need the frontmatter keys read (a regexp on `key: value` lines is enough) or the real parser. [I]
- **Runtime side — does the built client expose the current slide?** Yes, but not through an official API:
  - `window.__slidev__` and the postMessage control (`{target:'slidev', type:'navigate', no, clicks}` in,
    `navState` out) exist **only in dev** (`setup/root.ts`: `if (__DEV__) { window.__slidev__ = context; useEmbeddedControl() }`). [P]
  - In a production build `document.querySelector('#app').__vue_app__.config.globalProperties.$router` is
    present. `currentRoute.value.params.no` is the slide number, `query.clicks` the click step;
    `$router.push('/3')` navigates; `$router.afterEach` fires on every slide and click change including
    keyboard navigation. Verified in both history mode (ordinary `dist/`) and memory mode (the portable
    `presentation.html`). [E: `$B6/slidev-lab/probe2.cjs`]
  - DOM markers: `[data-slidev-no="N"]` with class `slidev-page slidev-page-N`; only the current slide and
    its neighbours are mounted. [E]
  - The app-level injection context (with `nav`) is not reachable from outside in production
    (`app._instance` is null). [E]
- **Does the build expose the source range?** Partly. Each slide's metadata object is compiled into the
  bundle: `slide:{…, title:'Amplitudes add', index:1, filepath:'', start:12, sourceIndex:1, id:1, no:2}` —
  `start` is the 0-based first line and equals the parser's value; `filepath`, `raw` and `content` are
  blanked and there is no `end`. The objects are module-scoped, so the site should compute ranges from the
  source it holds rather than read them from the build. [E: grep of `slidev-ordinary/dist/assets/index-*.js`]

### 3.4 Bridges across the opaque sandbox [E]

- **Reveal, zero injection** (`$B6/live-lab/postmessage-test.mjs`): Reveal's config has `postMessage: true`
  by default and `postMessageEvents: false` (`js/config.ts:929-930`). From the parent:
  `frame.contentWindow.postMessage(JSON.stringify({method:'configure', args:[{postMessageEvents:true}]}), '*')`
  then `{method:'isReady'}` until a callback arrives (30–62 ms), then `{method:'slide', args:[h,v,f]}`.
  The deck posts `{"namespace":"reveal","eventName":"slidechanged","state":{"indexh":1,"indexv":1,…}}`.
  Worked for the classic global build **and** for an ES-module deck with no `window.Reveal`. In the site's
  two-level sandbox the runner must relay these string messages in both directions.
- **Reveal, injected bridge** (`bridge-reveal.js`, 1.5 KB gzip): adds what the built-in API lacks — CSS swap,
  single-slide patch, element picking, inline text commit, error forwarding, "painted" acknowledgements.
- **Slidev** (`bridge-slidev.js`, 0.7 KB gzip): the vue-router technique from §3.3.

### 3.5 Preview → source at element level [E]

`$B6/live-lab/pick-test.mjs`. The bridge reports the clicked element as a path of child-element indices from
its slide's `<section>`; the editor walks the same path in the Lezer tree of that slide's source range.

- 15 picks on two decks (headings, list items, table cells, fragments, nested inline formatting, implied
  `</li>` / `</p>` end tags): **14 resolved by path** (my text comparator could not confirm one of them — a
  blockquote with `&ldquo;` entities — but `check-bq.mjs` shows the path pointed at the blockquote);
  **1 needed the text fallback**: a table written without `<tbody>`, which the browser inserts and the source
  does not have.
- **Inline text edit written back**: committing new text for `<h2>Touch Optimized</h2>` produced
  `<h2>Touch &amp; Pen &lt;Optimized&gt;</h2>` at exactly that range; the rest of the file was byte-identical.

Limits [I]: elements produced at runtime (Markdown plugin output, anything a script builds, all Slidev
content) have no HTML source to point at. Copy Phoenix Code's behaviour: mark them "generated" and offer
"go to the Markdown for this slide" (slide-level range plus a text search inside it). For Slidev,
element-level mapping needs source positions injected at compile time — VS Code's Markdown preview does it
with a markdown-it rule that sets `data-line` from `token.map[0]`
([P] `microsoft/vscode` `extensions/markdown-language-features/src/markdownEngine.ts`, `pluginSourceMap`);
`vite-plugin-vue-inspector` 7.0.0 does it for Vue through source maps ([P] package README). Only possible if
the site controls the Slidev compile.

### 3.6 WYSIWYG options, cheapest first [I unless marked]

1. **Slide-level sync only** (cursor ↔ slide). Proven above; no deck modification.
2. **Slide inspector form** — title, speaker notes, background, transition, visibility; plus slide
   operations (reorder, duplicate, delete, add from template). Each control is a targeted source edit:
   Reveal HTML → set/unset an attribute or replace a heading's inner range via Lezer positions (same
   technique as the verified text write-back); Reveal Markdown → `<!-- .slide: data-background="…" -->` and
   the `Note:` block; Slidev → `key: value` lines in the slide's frontmatter range and the trailing HTML
   comment for notes. Works for generated content too, because it edits the source, not the DOM.
3. **Inline text on the slide** — double-click a leaf text element, Enter commits, Esc cancels (Phoenix's
   interaction). Reveal HTML only; refuse with an explanation elsewhere.
4. **Drag/resize** — Slidev's own `v-drag` + frontmatter `dragPos` is the precedent [P]; out of scope for a
   small site.

---

## 4. Live-preview refresh

### 4.1 Measured latency [E]

`$B6/live-lab/measure.mjs` and `heavy.mjs` (host page at port 4574 stands in for the editor shell; frames use
`sandbox="allow-scripts"`; times are host-side `performance.now()` from "start" to the bridge's
double-`requestAnimationFrame` acknowledgement; 9 runs each, 7 for the heavy deck; median (min–max)).

| Deck | Strategy | Time |
| --- | --- | --- |
| Reveal 6.0.2 demo: 41 slides, 5 plugins, inlined document 1.75 MB | full reload, `srcdoc` → Reveal `ready` | 155 ms (139–252) |
| | full reload, `srcdoc` → ready + slide restored + painted | 173 ms (167–281) |
| | full reload, `blob:` → ready | 158 ms (152–183) |
| | full reload, `blob:` → ready + slide restored + painted | 189 ms (183–214) |
| | double-buffered reload (new frame hidden, swapped when painted) | 179 ms (148–203) |
| | CSS soft refresh, 562 KB theme stylesheet replaced | 25 ms (17–31) |
| | CSS soft refresh, 1 KB stylesheet | 30 ms (25–35) |
| | in-place patch of one slide (`innerHTML` + `Reveal.sync()` + re-highlight) | 29 ms (21–38) |
| | follow cursor: go to another slide | 30 ms (27–34) |
| Synthetic lecture deck: 120 slides, 360 KaTeX formulas, 120 highlighted code blocks, 2.0 MB | double-buffered reload → ready | 426 ms (384–488) |
| | → ready + slide 60 restored + painted | 482 ms (434–554) |
| | in-place patch of one slide | 37 ms (32–44) |
| Slidev 53.1.0 portable build: 4 slides, one Vue demo, 3.36 MB document | full reload, `srcdoc` → first slide mounted | 188 ms (178–261) |
| | full reload, `blob:` → slide 3 restored + painted | 207 ms (197–229) |
| | double-buffered (`blob:`) | 205 ms (197–256) |
| | go to another slide | 30 ms (29–34) |

Notes: the 25–37 ms figures are bounded below by two animation frames (~33 ms at 60 Hz). Building the
single-file preview document for the demo deck took 77 ms in Node (first run). Slidev numbers are for a
*compiled* deck; compiling Slidev source is outside this task and comes on top.

### 4.2 Recommended refresh policy [I, from the numbers]

| Edit | Action | Perceived delay after typing stops |
| --- | --- | --- |
| Cursor moves to another slide | bridge "goto" | ~30 ms, no debounce |
| CSS file | swap the `<style>` text, `Reveal.layout()` | debounce 150 ms + ~30 ms |
| Inside one HTML slide, no `<script>` touched | patch that slide in place | debounce 250 ms + ~35 ms |
| Anything else (scripts, config, Markdown, structure, assets) | double-buffered full reload, restore `{h, v, f}` or `{no, clicks}` | debounce 400 ms + 0.2–0.5 s |
| Edit while an interactive demo on the slide has state | same, but show "Preview paused — click to refresh" if the user interacted with the slide in the last few seconds | manual |

In-place Markdown re-rendering is not worth building: a full reload is already under 0.5 s and the
double buffer hides it.

### 4.3 Double buffering = last good render [E]

Load the candidate document in a second sandboxed frame with `visibility:hidden` (it still lays out and
`requestAnimationFrame` still fires — verified), restore the slide, and swap only after the bridge reports
"painted". If the candidate never becomes ready, drop it and keep the old frame.

### 4.4 What breakage looks like [E]

`$B6/live-lab/broken-test.mjs`, six variants of the demo deck:

| Variant | Static map | Lezer problems | Runtime |
| --- | --- | --- | --- |
| intact | 41 slides | none | ready 207 ms, 41 slides |
| one `</section>` deleted | **34** slides (23 vertical) | 1 error, reported at **line 671** (end of file; the edit was near line 250) | ready, **42** slides |
| unclosed `<div` in a slide | 41 | errors at lines 245, 250 (close to the edit) | ready, 41 |
| unterminated attribute quote | 40 | errors at 252, 266, 267 | ready, 40 (one slide swallowed) |
| `Reveal.initialize(` misspelt | 41 | none | **never ready**; `Uncaught TypeError: Reveal.initialise is not a function` |
| JS syntax error in the init script | 41 | none | **never ready**; `Uncaught SyntaxError: Unexpected token ','` |

Design consequences:
- The browser's HTML parser and Lezer recover differently from a missing end tag, so the static map and the
  runtime can disagree (34 versus 42). After every reload compare the map with the slide list the bridge
  reports; on disagreement say so ("The slide structure changed unexpectedly after your last edit at line N —
  41 slides before, 42 now") and fall back to matching by title.
- The most useful error location is the user's own last edit, not the parser's.
- Script errors arrive through the bridge with the browser's message; show them in plain words with "Undo
  last change" and "Copy error for the AI".
- The current player kills the frame on **any** `error` event (`presentation-runtime.ts:127-131`, `:237-245`).
  While editing, errors must be reported without tearing the preview down; only "never became ready"
  discards a candidate.

### 4.5 Reveal `hash: true` in the sandbox [E]

`$B6/live-lab/debug.mjs`. `hash: true` is in Reveal's own template (`reveal.js/index.html`) and its demo.

- `srcdoc` frame: every slide change throws `SecurityError: Failed to execute 'replaceState' on 'History': A
  history state object with URL 'http://127.0.0.1:4574/#/10' cannot be created in a document with origin
  'null' and URL 'about:srcdoc'.` The exception propagates out of `Reveal.slide()`; my first harness hung on it.
- `blob:` frame (what the site's runner uses): slide changes work, but showing the **first** slide throws,
  because Reveal then calls `replaceState(null, null, location.pathname + location.search)`
  (`js/controllers/location.js:155`) and a blob URL's `pathname` is the inner `http://…/uuid`.
- Fix verified in both modes: wrap `history.replaceState` / `pushState` in a try/catch inside the injected
  bootstrap. After that: no page errors; single runs were ready in 166 ms (`blob:`) and 200 ms (`srcdoc`).
- **Confirmed in the site's real production player** (`$B6/real-player/run.mjs`: the built site in
  `dist` served read-only on port 4579, a three-slide self-contained Reveal 6.0.2 deck
  imported through the normal ZIP input; the manifest says `engine: "slidev"` only because the validator
  accepts nothing else):

  | Deck config | Player status 2.5 s after Start | After → then ← to slide 1 |
  | --- | --- | --- |
  | `hash: true` | **"Playback needs attention"**, frame removed, notice "Failed to execute 'replaceState' on 'History': A history state object with URL '' cannot be created in a document with origin 'null' …" | — |
  | `hash: false` | "Playing locally" | "Playing locally" |
  | `history: true` | "Playing locally" (console: "Not allowed to load local resource: blob:null/…#/1") | "Playing locally" |
  | `hash: true` + the six-line shim in the deck's `<head>` (`run-shim.mjs`) | "Playing locally" | "Playing locally" |

  The shim belongs in `presentationBootstrap` (`src/lib/presentation-runtime.ts:93`), next to the existing
  Web Storage fallback.
- The current runner relays only `ready`, `escape` and `error` from the deck and only `qft-presentation-focus`
  to it (`presentation-runtime.ts:42-56`). Slide sync needs one more whitelisted message kind in each
  direction (and `public/presentation-sandbox.html` regenerated from `presentationRunnerDocument`). [P]

### 4.6 Assets inside the sandbox [E]

`$B6/asset-lab/run.cjs`, frame with `img-src data: blob:`:
- `blob:` URL created by the parent page → **blocked** ("Not allowed to load local resource").
- `ArrayBuffer` transferred by `postMessage`, turned into a blob URL inside the frame → loads (2.6 ms);
  a 50 MB buffer transferred in 0.1 ms (zero-copy; the parent's buffer is detached).
- `data:` URL → loads.
So an image or video can be hot-swapped without a reload and without base64 growth (+33%), which also keeps
pressure off the 24 MB HTML limit (`presentation-package.ts:8`).

---

## 5. Working with the user's real files

### 5.1 Support matrix [P: MDN browser-compat-data `main`, fetched 2026-11-24 into `$B6/ref/bcd/`; web-features explorer]

| API | Chrome / Edge desktop | Chrome Android | Firefox | Safari |
| --- | --- | --- | --- | --- |
| `showDirectoryPicker` / `showOpenFilePicker` / `showSaveFilePicker` | 86 | 132 | no — standards position **negative** | no — position **oppose** (security) |
| `FileSystemHandle.queryPermission` / `requestPermission` | 86 | 109 | no | no |
| `DataTransferItem.getAsFileSystemHandle` | 86 | 132 | no | no |
| `FileSystemObserver` | 133 | no | no | no |
| `launchQueue` (File Handling) | 102 | no | no | no |
| `DataTransferItem.webkitGetAsEntry` | 13 | yes | 50 (Android 141) | 11.1 |
| `<input type=file webkitdirectory>` | 7 | 132 | 50 (Android 142) | 11.1 (iOS 18.4) |
| OPFS `navigator.storage.getDirectory` | 86 | 109 | 111 | 15.2 |
| OPFS `createWritable` | 86 | 109 | 111 | 26 |

- web-features: File System Access is "Limited availability … has received a negative standards position from
  at least one browser vendor — It's very unlikely to ever become Baseline in this current form"; usage
  ~0.004% of page loads. OPFS is "Widely Available (since 2025-09-27)". [P: https://web-platform-dx.github.io/web-features-explorer/features/file-system-access/ , …/origin-private-file-system/]
- Chromium 158 here exposes `showDirectoryPicker`, `FileSystemObserver`, `getAsFileSystemHandle`,
  `launchQueue`. [E: `$B6/features/run.cjs`] The pickers themselves cannot be driven in headless Chromium, so
  the open-folder flow below is from documentation, not a test. [U for end-to-end behaviour]

### 5.2 Permission persistence [P: https://developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api]

- Handles are structured-cloneable; store them in IndexedDB (this is what vscode.dev does).
- From Chrome 122, calling `requestPermission()` on a stored handle shows a three-way prompt: "Allow this
  time", "**Allow on every visit**", "Don't allow". Installed apps persist automatically.
- Without persistence, permission is dropped when the tab has been in the background for a while; the app
  must call `requestPermission()` again from a user gesture.

### 5.3 Proposed flow [I]

- **Chromium desktop**: "Open folder" → `showDirectoryPicker({ mode: 'readwrite' })` → read the tree into the
  same in-memory project model (skip `node_modules`, `.git`) → store the handle in IndexedDB. Edits in the
  site write through with `createWritable()` (debounced, per file). Edits made in VS Code are picked up by
  `FileSystemObserver` (Chrome 133+), with a fallback poll of `getFile().lastModified` for the open files.
  External change + unsaved local change in the same file → merge view, never a silent overwrite.
- **Everywhere else**: "Open folder" = `<input webkitdirectory>` (verified: `webkitRelativePath` gives
  `theme/black.css`-style paths [E: `$B6/project-lab/run.mjs`]) or folder drop via `webkitGetAsEntry`; this is
  an import into browser storage; getting changes out is "Download ZIP" or per-file download.
- Say which mode is active in the UI: "Editing files in ~/talks/waves" versus "Editing a copy stored in this
  browser".

### 5.4 OPFS as working storage [E][I]

- Works here: 200 × 10 KB files written in 556 ms (2.8 ms each) and read back in 243 ms; `FileSystemObserver`
  on an OPFS directory reported `appeared` and `modified`; quota estimate 10 GB; `persisted()` false by
  default. [E: `$B6/features/run.cjs`]
- Judgement: OPFS adds little over the existing IndexedDB stores for projects of a few dozen files (the
  original ZIP is already a Blob in IndexedDB). It becomes attractive only for large media or if an in-browser
  build tool wants a real file tree. Do not use it in the first tier.
- Durability applies to both: storage is best-effort unless `navigator.storage.persist()` succeeds
  ([P] MDN "Storage quotas and eviction criteria"); Safari deletes "all of a website's script-writable
  storage after seven days of Safari use without user interaction on the site" (home-screen web apps
  excepted) ([P] https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/).

### 5.5 File Handling for an installed PWA [P]

- Manifest `file_handlers` (`action`, `accept`, `icons`) + `launchQueue.setConsumer()`; "File Handling is
  currently limited to desktop operating systems"; the app must be installed.
  [https://developer.chrome.com/docs/capabilities/web-apis/file-handling]
- Chrome's install criteria list HTTPS and a manifest with name, 192/512 icons, `start_url`, `display` — no
  service worker. [https://web.dev/articles/install-criteria] The site has neither a manifest nor a service
  worker today (`docs/ARCHITECTURE.md:21`), so "Open with QFT Markdown" on a `.zip` needs a manifest; without a
  service worker the installed app still needs the network to start.

---

## 6. The AI revision loop without calling an AI service

### 6.1 Context packs (outbound) [I]

One "Ask AI about…" button producing copyable text; three scopes:
- **This slide**: deck type and version, slide number and title, the slide's exact source (from the map), the
  shared CSS classes it uses, and the answer format (below).
- **This file** / **whole project**: file list with sizes, the content files in full, vendor files by name
  only.
- **This error**: the runtime error text, the file and line of the last edit, the slide count before/after,
  and the affected source. The existing "Check lesson" report (`src/lib/lesson-check.ts`) is the precedent.

Because the site writes the prompt it can prescribe the answer format. Ask for **SEARCH/REPLACE blocks with
the file path on the line above**, and for whole files only when a file is new or under ~150 lines. Aider's
documentation is the evidence base: its formats are `whole`, `diff` (search/replace), `diff-fenced`, `udiff`;
its design rules are "avoid … brittle specifiers like line numbers or line counts" and "be maximally flexible
when interpreting" the model's edits; disabling flexible patching gave "a 9X increase in editing errors".
[P: https://aider.chat/docs/more/edit-formats.html , https://aider.chat/docs/unified-diffs.html]

### 6.2 Importing the answer (inbound) [E]

Prototype `$B6/patch-lab/patch-apply.mjs` (7.6 KB min / 3.2 KB gzip, no dependencies). `parseAnswer()`
recognises, in one pasted text: OpenAI `*** Begin Patch` / `*** Update|Add|Delete File:` blocks; SEARCH/REPLACE
blocks with or without a fence; unified diffs (hunk line numbers and counts are hints only; a blank context
line that lost its leading space is tolerated); labelled whole-file fences (`**path**`, `` `path`: ``,
`### path`, `title="path"`, or a first-line comment). `applyAnswer()` never throws and never writes: it
returns candidate files plus a per-change report. Matching loosens in five steps (exact → trailing spaces →
indentation → inner spacing → quote/dash style) and re-indents the replacement to the file's indentation; an
ambiguous match takes the occurrence nearest the current slide and says so.

`node test.mjs` — 13 synthetic cases modelled on common chat output (my own samples, not a measured corpus):

| Case | Result |
| --- | --- |
| SEARCH/REPLACE in a fence, filename above | applied |
| SEARCH with spaces where the file has tabs | applied ("ignoring indentation"), replacement re-indented with tabs |
| well-formed unified diff | applied |
| unified diff with wrong line numbers/counts, blank context lines stripped | applied |
| whole file under a bold filename, CRLF file | applied, CRLF kept |
| whole file containing `<!-- ... rest of the slides unchanged ... -->` | **refused** with an explanation |
| OpenAI V4A patch updating one file and adding another | applied |
| two files in one answer (whole file + search/replace) | applied |
| SEARCH text occurring twice | applied at the occurrence nearest the current slide, flagged |
| straight quotes in the answer, curly quotes in the file | applied ("ignoring punctuation style") |
| text that is not in the file | **not applied**; report ready to paste back to the AI |
| bare `@@` hunk without a file header | applied to the open file |
| new file from a labelled fence | created |

The first run scored 11 of 13: a fence wrapping a SEARCH/REPLACE block was also read as a whole-file
replacement (it would have overwritten `slides.md` with patch syntax), and a bare `@@` header did not parse.
Both are fixed; the first one is exactly the kind of failure the review step must catch.

Comparison: jsdiff 9 `applyPatch` applied the well-formed diff and **threw** on the sloppy one ("Removed line
count did not match for hunk at line 3") with `fuzzFactor` 0 and 2. A strict patch library is the wrong tool
for chat output.

Review: `@codemirror/merge` `unifiedMergeView({ original, mergeControls: true, collapseUnchanged })` showed 3
changes with Accept/Reject buttons; `rejectChunk` restored the original text for one change while keeping the
others; `acceptChunk` moved the baseline. Side-by-side `MergeView` with `revertControls` also works.
Screenshot: `(scratch)/research/shots/B6-review-merge.png`.
[E: `$B6/review-lab/run.mjs`]

Whole-ZIP revisions keep using the existing path: `compareLessonRevision()` in `src/lib/lesson-revision.ts:34`
already produces per-file before/after; replace its plain comparison panes with the merge view.

### 6.3 Status of the in-browser and agent options (November 2026)

| Option | Status | Fit |
| --- | --- | --- |
| **Chrome Prompt API** (`LanguageModel`, Gemini Nano) | Web: **Chrome 148**; extensions: Chrome 138. Desktop only (Windows 10/11, macOS 13+, Linux, Chromebook Plus); "Chrome for Android, iOS … not yet supported". Needs 22 GB free disk and either >4 GB VRAM or 16 GB RAM + 4 cores; model downloads on first use; languages `en, ja, es, de, fr`; JSON-schema `responseConstraint`; not available in workers. BCD: Chrome 148, Edge 138 behind a flag, Firefox no, Safari no. Chromium 158 here: `LanguageModel` present, `availability()` → `"downloadable"`; `Summarizer`, `Translator`, `LanguageDetector` present; `Writer`/`Rewriter`/`Proofreader` only with experimental features. [P: https://developer.chrome.com/docs/ai/prompt-api (updated 2026-10-21); BCD `api/LanguageModel.json`][E] | Optional helper for small, local tasks (explain this error, tidy this slide's wording). Feature-detect; never a dependency. Quality on code edits not tested. [U] |
| **WebLLM** | `@mlc-ai/web-llm` 0.2.89 (2026-11-17); needs WebGPU (Chrome 113+, Linux from 144; Chrome Android 121; Firefox 141+ on Windows, macOS Apple silicon from 145; Safari 26); models are fetched from Hugging Face. [E: npm; P: project README, BCD `api/GPU.json`] | Multi-gigabyte download and a network fetch to a third party; not for this site's audience. |
| **Bring-your-own API key** | CORS preflights from `Origin: https://md.qft.org` succeed today for Anthropic `/v1/messages` (with `anthropic-dangerous-direct-browser-access`), OpenAI `/v1/responses` and `/v1/chat/completions`, Google `generativelanguage.googleapis.com`, OpenRouter, Mistral. The site CSP already allows `connect-src https:`. [E: `curl -X OPTIONS …`] | Technically easy, but it sends the deck to a third party and adds a secret to manage — contrary to "no API keys". Strictly opt-in, last tier, if at all. |
| **WebMCP** | Chrome docs (updated 2026-11-20): **origin trial from Chrome 149**, flag `chrome://flags/#enable-webmcp-testing`; API is `document.modelContext.registerTool / getTools / executeTool`; annotations `readOnlyHint`, `consequentialHint`, `untrustedContentHint`; cross-origin frames need `allow="tools"`. An Intent to Extend Experiment was posted 2026-09-28 [S: search result]. Chromium 158 here: absent by default **and with `--enable-experimental-web-platform-features` alone**; present with `--enable-blink-features=WebMCP` as `document.modelContext` (`navigator.modelContext` is undefined). I registered `qft_get_current_slide`, `qft_read_file`, `qft_propose_edit`, listed and executed them; CDP `WebMCP.enable` answered. [P: https://developer.chrome.com/docs/ai/webmcp , /imperative-api][E: `$B6/features/webmcp.cjs`] | Cheap progressive enhancement (a few hundred lines). An origin-trial token is per origin, so forks would need their own — keep it feature-detected. Which shipping assistants call page tools is not stated in the docs ("These extensions are separate from Gemini in Chrome"). [U] |
| **Chrome DevTools MCP** | `chrome-devtools-mcp` 1.13.0 (2026-11-11). `--autoConnect` attaches to the user's running Chrome 144+ after they enable remote debugging at `chrome://inspect/#remote-debugging` (Chrome asks for permission). `--categoryExperimentalWebmcp` adds `list_webmcp_tools` / `execute_webmcp_tool`: "Requires Chrome 150+ with … `--enable-features=WebMCP`". [P: repo `docs/configuration.md`, `docs/advanced-usage.md`, `docs/tool-reference.md`] | Lets Claude Desktop / Claude Code / Cursor drive the open site. Setup is developer-grade. |
| **Claude in Chrome** | "Available on paid plans (Pro, Max, Ultra, Team, and Enterprise), in the Chrome side panel, Claude Cowork, and Claude Code"; reads, clicks, types; "not supported on other Chromium-based web browsers or mobile devices". [P: https://support.claude.com/en/articles/12012173-get-started-with-claude-in-chrome] | Works with the site as it is, by operating the UI. Helped by stable labels, a "Paste the AI's answer" box and a visible review step. Whether it uses WebMCP tools: not documented. [U] |
| **Slidev's own precedent** | VS Code extension exposes `slidev_getActiveSlide`, `slidev_getSlideContent`, … to assistants. [P] | Use the same tool vocabulary for WebMCP. |

### 6.4 Suggested page tools if WebMCP is added [I]

`get_project_summary` (read-only), `get_current_slide` (read-only), `read_file` (read-only), `find_in_project`
(read-only), `get_problems` (read-only: last runtime errors and structure warnings), `go_to_slide`,
`propose_changes` (takes the same SEARCH/REPLACE text as the paste box; **never applies** — it opens the
review). No delete/export tools. Mark file contents `untrustedContentHint: true`.

---

## 7. Recommended design in three tiers

Effort is for one developer who knows this codebase; "library Δ" is measured (§1.3), "own code" is an
estimate. All tiers assume another workstream delivers a player that can run a multi-file Reveal project in
the sandbox; this tier list covers the editing layer.

### Tier 1 — Minimum viable (about 3–4 weeks; library Δ +8.8 KB gzip, own code est. 15–20 KB gzip, lazy-loaded)

1. Project model: immutable original ZIP + overlay + revision in IndexedDB; restore original; export ZIP.
2. Slide list + file tree (content / framework / binary classes), tabs, one CodeMirror view with a state per
   file, languages by extension, JSON lint.
3. Binary preview and replace; add / rename / delete.
4. Live preview: double-buffered full reload with slide restore, 400 ms debounce, history shim, problems
   strip (runtime errors, "not ready", slide-count change) with "Undo last change".
5. Slide ↔ source at slide level for Reveal HTML and Reveal Markdown (cursor follows slide, slide follows
   cursor, toggle to unlink).
6. For precompiled packages (today's Slidev portable ZIP): source stays read-only with a banner "This plays a
   compiled copy. Editing here will not change it" until a compile path exists.

### Tier 2 — Solid (about 4–5 more weeks; library Δ +23.2 KB gzip total, own code est. +20–25 KB gzip)

7. AI loop: context packs (slide / file / error), paste-answer importer, merge-view review with per-change
   accept, project journal so one click undoes a multi-file AI change, failure report to paste back.
8. Snapshots ("Before AI change 14:02", manual names), compare any snapshot with now.
9. CSS soft refresh and single-slide in-place patch.
10. Slide inspector (title, notes, background, transition, hidden) and slide operations (reorder, duplicate,
    delete, add).
11. Slidev: slide map + router bridge (once Slidev source can be previewed).
12. Project search, Lezer-based "markup looks broken near line N" hints, map-versus-runtime self-check.
13. Keyboard, screen-reader and narrow-screen pass (stacked layout: slide on top, editor below).

### Tier 3 — Ambitious (about 4–7 more weeks; mostly own code, est. +15–25 KB gzip)

14. Open a real folder (Chromium): read/write handles, stored permission, `FileSystemObserver`, external-change
    merge; folder import elsewhere.
15. Inline text editing on the slide with write-back; element picking ("show me the source of this").
16. Web app manifest + `file_handlers` ("Open with").
17. WebMCP tools (feature-detected), documentation for Chrome DevTools MCP users.
18. Optional built-in Prompt API helper ("explain this error"), clearly labelled as on-device.
19. Bring-your-own-key only if the owner accepts the privacy trade-off.

---

## 8. Top UX risks

1. **Two truths.** Editing source that does not change what plays (compiled Slidev packages today). Until a
   compile path exists, do not offer an editor for those files.
2. **A non-developer breaks the deck and cannot recover.** Needs last-good render, plain-language problems,
   one-click undo, snapshots, restore original. A deleted `</section>` produced no error at all, only a
   different slide count.
3. **Wrong jump target.** The static map and the browser can disagree on malformed HTML (34 versus 42 slides);
   runtime-generated content has no source element. One wrong jump costs more trust than no feature — verify
   against the runtime list and say "approximate" when unsure.
4. **IDE overload.** A Reveal ZIP is 48+ files, mostly framework. Slides first, framework files collapsed and
   locked.
5. **Silent data loss.** Best-effort browser storage, Safari's seven-day rule, second tab, lost folder
   permission. Always show where the work lives and keep "Download ZIP" one click away.
6. **AI answer applied in the wrong place or with content elided.** Review before apply, placeholder
   refusal, size-shrink warning, nearest-occurrence flag, single-step undo.
7. **Preview runs untrusted code while the user edits.** Keep the opaque sandbox and no-network policy; treat
   every bridge message as untrusted (validate slide indices and paths; accept text commits only during an
   explicit edit gesture); WebMCP write tools only propose.
8. **Focus and keys.** The preview captures arrows and Esc; the editor must not trap Tab; browser shortcuts
   (Ctrl+W, Ctrl+N) cannot be rebound.
9. **Reload storms and heavy media.** Debounce, pause while the user interacts with a demo, keep media out of
   the HTML string by transferring bytes.
10. **Phones.** CodeMirror works, but code editing on a phone is poor; make the inspector the phone path.

---

## 9. Reproduce

```sh
B6=../prototypes/B6
cd $B6/cm-measure     && node measure.mjs && node tiers.mjs && node breakdown.mjs entries/00.js
cd $B6/monaco-measure && node measure.mjs && node initial.mjs
cd $B6/reveal-lab     && (node server.mjs deck 4571 &) && node test-map.mjs
cd $B6/reveal-lab     && node test-slidev-map.mjs <slides.md…> tricky-slides.md
cd $B6/slidev-lab     && (node server.mjs www/ordinary 4572 &) && (node server.mjs www/portable 4573 &) && node probe2.cjs
cd $B6/live-lab       && (node server.mjs www 4574 &) && node measure.mjs && node heavy.mjs \
                         && node pick-test.mjs && node postmessage-test.mjs && node broken-test.mjs && node debug.mjs
cd $B6/bigfile        && (node server.mjs www 4575 &) && node bench.mjs && node a11y.cjs
cd $B6/review-lab     && (node server.mjs www 4576 &) && node run.mjs
cd $B6/project-lab    && (node server.mjs www 4577 &) && node run.mjs
cd $B6/asset-lab      && (node server.mjs www 4578 &) && node run.cjs
cd $B6/features       && (node server.mjs . 4570 &) && node run.cjs && node run3.cjs && node webmcp.cjs
cd $B6/patch-lab      && node test.mjs
cd $B6/real-player    && (node server.mjs dist 4579 &) && node run.mjs && node run-shim.mjs
```
Run scripts from these directories, not from the repository root: inside `<repo>`,
`require('playwright')` resolves to the repo's copy, which expects a browser revision that is not installed.

Key prototype files: `reveal-lab/slide-map.mjs` (mapper), `live-lab/bridge-reveal.js`, `live-lab/bridge-slidev.js`,
`live-lab/inline.mjs` (lab-only single-file builder), `live-lab/www/index.html` (host with double buffering),
`patch-lab/patch-apply.mjs`, `review-lab/entry.js`, `project-lab/entry.js`. Downloaded references:
`$B6/ref/` (Chrome WebMCP / Prompt API / file API docs, reveal Markdown plugin source, Chrome DevTools MCP
docs, WebLLM README, MDN BCD JSON).

## 10. Not done / open

- No real screen-reader or real-phone test of either editor.
- The File System Access open-folder flow was not exercised end to end (the picker cannot be automated here).
- Firefox and Safari behaviour is from documentation only (Chromium is the only engine installed).
- The AI-answer cases are my own samples; no measurement of how often current chat models follow the
  requested format.
- Slidev `src:` imports and disabled slides are not handled by the minimal splitter.
- Latency numbers are from a headless browser on a 4-CPU container; a teacher's laptop will differ.
- CodeSandbox was covered only through the Sandpack component docs; StackBlitz only through the WebContainers
  docs.
