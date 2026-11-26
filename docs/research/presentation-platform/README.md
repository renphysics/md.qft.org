# Playing and editing AI-made Reveal.js and Slidev decks on md.qft.org

Research report · 2026-11-26 · **DRAFT — a verification round is still running; sections marked PENDING will change**

The question: how should md.qft.org improve so that a user can (1) ask an AI to create slides with Reveal.js or Slidev, (2) upload the ZIP to the site, processed locally in the browser, (3) see the presentation with its interactions working, and (4) edit the source files in the browser.

## 1. Summary

**Today none of this works for standard decks.** Of 12 deck shapes that AI tools naturally hand over, 0 play and 3 are silently imported as the wrong thing. A standard Reveal.js ZIP is told to "use the QFT Slidev packaging tool". A Slidev source project or an ordinary `slidev build` output is refused. A single `.html` file cannot be opened at all. Editing that changes what plays exists only for the site's own Markdown lessons.

**The gap is smaller than it looks.** The existing sandboxed player already runs a complete Reveal.js 6 deck once the deck is linked into one HTML file. A 150-line in-browser adapter did that for 3 of 3 real AI-made lecture decks and 5 of 5 ZIP shapes, with zero network requests. What blocks standard decks is an upload gate that knows one custom format, a rule that any script error stops playback, a missing History shim, and a package model that cannot be edited. The security design is not the obstacle.

**Reveal.js and Slidev need different treatment.** A Reveal.js deck's source is what runs, so "edit and replay" needs no compiler. Slidev is compiled by a Node toolchain; the site can play builds, but showing edits to Slidev source needs a compiler in the browser, which is feasible only for a defined subset of Slidev.

**Recommended roadmap**

| Stage | What the user gets | Main work | Rough effort |
| --- | --- | --- | --- |
| 0. Repair | The shipped player behaves as promised | Keyboard focus after Start, misleading messages, a handful of defects (section 8) | days |
| 1. Play natural Reveal.js decks | Drop a `.html`, ZIP or folder from any AI and it plays offline | Upload classifier, in-browser linker with CDN-to-bundled mapping, tolerant runtime, short AI prompts, a paste-back check report | 3–4 weeks |
| 2. Edit and replay | A project workspace: slide list, file tree, source editor, live preview, AI revision import with diff | Editable project store, CodeMirror multi-file editor, reload with position restore, slide-to-source sync | 4–8 weeks |
| 3. Slidev | Ordinary Slidev builds play; Slidev source can be edited with a preview for common decks | In-browser build conversion, a published agent skill and build template, parser-based slide editing, optional in-browser compiler | 4–10 weeks |
| 4. Served mode (optional) | Every remaining deck type plays unmodified: third-party plugins, ES modules, speaker view, Monaco decks | A second "player origin" with a service worker | 3–5 weeks |

Stages 1 and 2 deliver the whole goal for Reveal.js on today's hosting and security model. Efforts are estimates for one developer who knows the codebase.

**Decisions for the owner**

1. **Network promise.** The player's "no external connections" statement does not hold against a hostile deck (section 5.5). Decide whether to reword it, and how decks that reference CDN libraries should be handled: bundled copies only, a one-time "download and store with the deck" step, or a per-deck network switch.
2. **A second origin.** Served mode needs a separate origin for deck content. Decide whether that is acceptable and where it lives (section 6).
3. **How far to take Slidev source editing.** A live preview for a subset of Slidev is feasible but hooks into Slidev internals and must be re-tested for each Slidev release.

## 2. How this was researched

Thirteen research agents worked in parallel: two code audits, four technology deep-dives (Reveal.js, Slidev, editor, AI hand-off), prototype work for a second-origin player, a platform fact-check, and three adversarial verifiers. Agents read the repository, read primary sources (upstream source code, official documentation, npm tarballs, CDN statistics), and built and ran prototypes against the site's production build with Playwright.

Limits to keep in mind:

- **Chromium only.** Every experiment ran in Chromium 158 (both full Chromium and the headless shell). Firefox and Safari behaviour is taken from documentation or is unknown.
- **Small deck sample.** Real AI-made decks: 3 lecture decks and a few community skill outputs, plus 2 decks written by AI assistants for this study. No deck was produced by driving ChatGPT, Gemini or Copilot end to end.
- **Prototypes, not products.** The prototypes prove feasibility and give measurements; none is production code.

Evidence is kept next to this report: agent notes in `notes/`, prototype sources in `prototypes/`. Citations such as "A1 F4" refer to finding 4 in `notes/A1-*.md`.

## 3. Baseline: what the site does today

| What the user uploads | What happens |
| --- | --- |
| Single Reveal.js `.html` file | Cannot be chosen: "Choose Markdown (.md), plain text (.txt), a lesson ZIP, or a prepared Slidev presentation ZIP." |
| The same file inside a ZIP | "A ZIP bundle must contain one Markdown document, or a QFT document manifest." |
| Standard Reveal.js project ZIP (`index.html` + `dist/`) | "This is a website build ZIP. Follow tools/slidev/README.md and use the QFT Slidev packaging tool…" |
| Reveal.js project ZIP that also contains a `README.md` | Silently opens the README as a Markdown "lesson" |
| Slidev source project ZIP | "This ZIP contains Slidev source, not a playable presentation…" |
| Ordinary `slidev build` output ZIP | "This is a website build ZIP…" |
| ZIP with Slidev source and build together | Refused as "Slidev source" |
| A lone Slidev `slides.md` | Opens as a Markdown document; front matter and components print as text; "Check lesson" reports success |
| Package made with `tools/slidev/pack.mjs` | Plays. Source tab is read-only; edits cannot change playback |
| QFT lesson project (`qft.json` v2) | Opens; files editable through a modal with one textarea |

Sources: A1 F1, F11; A2 F1, F4, F8; B7 F1. The site's own Markdown slide mode uses Reveal.js only as a pager: of 25 standard Reveal.js features, 18 are unsupported, including fragments, speaker notes, vertical slides and backgrounds (A2 F5).

Five mechanisms cause the rejections (A1 F1, F6, F8, F12):

1. **The manifest gate.** Only a ZIP with `qft-presentation.json` whose engine is exactly `slidev` is treated as a presentation.
2. **The single-HTML rule.** The player takes one self-contained HTML; separate scripts, styles or assets are refused.
3. **The `blob:` document.** The deck runs from a `blob:` URL in an opaque origin: `history.replaceState` to a path throws, fragment navigation is refused, relative URLs cannot resolve.
4. **Fatal errors.** Any uncaught error, unhandled rejection or CSP violation removes the running deck.
5. **An immutable package.** The stored artifact is the original ZIP; there is no update operation, and the player closes over one HTML string.

## 4. What AI tools actually hand over

**Reveal.js.** The natural answer to "make me a reveal.js presentation" is one HTML file that loads Reveal.js 4.x or 5.x from jsDelivr or cdnjs, with one inline script (B7 F2). Reveal.js 6 is rarely targeted: in the month to 2026-11-23, jsDelivr served Reveal.js 5.x for 59.8% of requests, 4.x for 27.3%, 6.x for 11.2%. An agent with a shell tends to produce a small multi-file folder instead and may vendor the libraries (the study's own sample: 37 files, Reveal.js 6.0.2 and KaTeX in `vendor/`, no network). Every sampled deck sets `hash: true`.

**Slidev.** Slidev always needs a build. Who can run it (B7 F5, A2 F21–F22):

| Tool | Can it deliver a built Slidev deck? |
| --- | --- |
| Coding agents (Claude Code, Codex, Cursor, Gemini CLI) | Yes |
| Claude chat (code execution, npm allow-listed, 30 MB file limit) | Probably; Node version and disk space in its sandbox are undocumented |
| ChatGPT Work (paid, internet-enabled code execution) | Yes |
| ChatGPT Chat container | Unreliable: no outbound network; npm installs reported broken in August 2026 |
| Gemini app, consumer Copilot | No: text or a single HTML document only |

An agent that follows Slidev's official skill (14.2K installs) delivers a source project or a default build with the history router and an absolute base path. Those are exactly the shapes the site rejects (B7 F10).

**Consequence.** The site should accept what tools naturally produce and repair it locally, rather than teach each AI a site-specific format. The current "Create with AI" prompts are 849 and 454 words, offer no Reveal.js option, and the Slidev one needs a terminal four times (B7 F8).

## 5. Findings

### 5.1 The player is engine-agnostic but intolerant

A Reveal.js 6.0.2 deck inlined by plain text substitution and labelled as a Slidev package plays in 376 ms with arrows, fragments, internal links, overview and canvas animation (A1 F2). A full-featured standard project plays after five mechanical rewrites done in 0.3 s without a bundler: vertical slides, fragments, auto-animate, backgrounds, highlight, Markdown, search (A2 F2).

Ordinary behaviour then kills the deck, because every error is fatal (A1 F6; B1 F1; B2 F4):

- `hash: true` with a first slide that has no id throws a `SecurityError` from `history.replaceState` at start-up. This is the setting in Reveal's own template.
- Pressing **F** (fullscreen) or **S** (speaker view).
- Any of the 8 stock themes that import Google Fonts, and the math plugin, which always loads MathJax or KaTeX from a CDN.
- For Slidev: the default Wake Lock request, or one remote image.

A 2.2 KB shim (tolerant History calls, fullscreen forwarded to the host, an inert `window.open`, a print stub) plus a non-fatal error policy after start-up removes the first three on Reveal.js 4.x–6.x (B1 F6).

Other player findings:

- **Keyboard focus.** In full Chromium, arrow keys do not reach the deck after Start or Present until the user clicks the slide. This affects the shipped Slidev example. A three-line repair works. CI misses it because it runs the headless shell and clicks first (A1 F7, F24).
- **Fidelity.** The preparation step injects `box-sizing: border-box` on every element, drops `<title>`, the viewport meta and body attributes in some cases (A1 F17).
- **Silent failures.** Inline `onclick` attributes are stripped, JS-handled forms never submit, `alert` is ignored (A1 F16).
- **Size.** Assets must be base64-inlined into at most 24 MiB of HTML, about 18 MB of real media (A1 F19).

### 5.2 Reveal.js: three layouts, rotting CDN links, a cheap adapter

- **Three incompatible file layouts** exist: 3.x, 4.x/5.x, and 6.x. Reveal.js 6.0.0 (2026-03-11) moved plugins from `plugin/<name>/<name>.js` to `dist/plugin/<name>.js`. Models trained on older decks emit old paths (B1 F3).
- **CDN links rot.** Version-pinned URLs still work. Unversioned URLs with 4.x/5.x paths return 404 on unpkg; jsDelivr answers by silently mixing a 6.0.2 core with 5.2.1 plugins (B1 F4).
- **An adapter fixes the common case in the existing sandbox.** It inlines relative files, maps Reveal.js and KaTeX URLs on jsDelivr, unpkg and cdnjs to the copies the site already bundles, replaces the math plugin with a 12-line shim and guards History calls. Result: 3 of 3 real lecture decks and 5 of 5 ZIP shapes reach ready with zero network requests, including a deck written for 4.5.0 with 74 Markdown slides (B7 F3).
- **Detection is cheap.** A 147-line detector recognised 36 of 36 Reveal.js decks, chose the entry file among up to 33 HTML files, read the version, and named problems such as 4.x paths on a 6.x folder. It rejected 3 of 3 non-Reveal inputs (B1 F11).
- **The host can follow and drive a deck without touching its code.** Reveal's own `postMessage` API works across the opaque sandbox and returns slide state and speaker notes once `postMessageEvents` is switched on remotely (B1 F7; B6 F6).
- **What single-file linking cannot run:** anything that loads sibling files relative to its own script at run time. That covers popular third-party plugins (menu, chalkboard, copycode), KaTeX through `katex.local`, and the built-in speaker view (B1 F5, F13).
- **Generators** vary: Quarto bundles Reveal.js 5.1.0 beside the HTML; Pandoc points at unpkg; Jupyter pins 4.0.2 through RequireJS. A self-contained Pandoc deck (`--embed-resources`, 3.08 MB) plays in today's sandbox unchanged (B1 F16–F17).

### 5.3 Slidev: playable after conversion, editable only with a compiler

- **Slidev 53.1.0 is a Vite application.** Markdown is compiled to Vue by 22 plugins in Node. There is no official in-browser mode; the official online option is StackBlitz (B2 F12, F17). It needs Node 22.22 or newer, which is newer than the repository's own starter says (B7 F11).
- **An ordinary build cannot be opened from a ZIP as it is.** It is blank from `file://`, in a `blob:` document, in an opaque sandbox, and under a sub-path with the default base (B2 F1).
- **A build can be converted in the browser.** Six textual patches plus bundling turn an ordinary build into one HTML that the current sandbox plays. This worked for 7 router and base-path variants, and ran entirely client-side with esbuild-wasm inside a same-origin Worker under the site's present CSP in 0.7–1.7 s (B2 F2). Limits: two patches are regular expressions over minified output tested on 53.1.0 only; decks that use Monaco are not covered; esbuild-wasm is a 3.6 MB (gzip) lazy download.
- **A portable build needs only three settings.** A stock project with `routerMode: hash` (or `memory`), `fonts: { provider: none }` and `slidev build --base ./` works offline from any HTTP folder with no external request (B7 F6). The bespoke starter, Vite profile and packer are not required for that.
- **Source can be re-rendered without Node for a subset.** A prebuilt generic Slidev client plus a 708 KB (gzip) in-browser compiler, built from upstream parser and Markdown plugins, produced output identical in DOM and pixels to the real build for a 5-slide deck, 5 of 5 slides on a richer deck, and 7 of 16 on the official kitchen-sink template. Compile time was 0.07–1.4 s, with no `eval` or WebAssembly (B2 F3).
- **Out of reach without Node or network:** npm themes, addons and dependencies, `vite.config` and `setup/` files, Monaco, TwoSlash, remote embeds. Icons need bundled icon data (B2 F8).
- **Running the real toolchain in the browser is not realistic here.** It is 111 MB of npm tarballs and 494 MB on disk; a small deck builds with 774 MB of memory and the official template with about 2.6 GB (B2 F10). *PENDING: WebContainers licence and header requirements (C2).*

### 5.4 Editing in the browser

- **Keep CodeMirror 6.** The site's bundle already contains the HTML, CSS and JavaScript parsers. JSON, YAML, Vue, linting and a merge view add 61.5 KB minified (23.2 KB gzip). Monaco's smallest usable core is 2,833 KB (729 KB gzip) plus workers and does not support mobile browsers (B6 F2, F5).
- **Full reload is fast enough to be the refresh strategy.** Rebuilding and reloading the frame with the slide position restored takes 170–250 ms for 20–41 slide decks and 482 ms for 120 slides with 360 formulas. Loading the new frame hidden and swapping when ready removes the flash and keeps the last good render. An in-place slide swap takes 20–30 ms but loses listeners added by deck scripts (B1 F10; B6 F4).
- **Slide-aware editing is cheap.** A 5 KB mapper on the HTML parser the site already ships matched 41 of 41 slides of Reveal's demo deck and 12 of 12 in a mixed HTML and Markdown deck. Clicking an element on a slide resolved to its source range in 14 of 15 cases (B6 F3, F12).
- **AI revisions can be imported without calling any AI.** A 3.2 KB importer handled 13 of 13 synthetic chat-answer shapes (search/replace blocks, sloppy diffs, whole files) and refused a truncated file; a strict patch library failed on the sloppy diff. Review uses CodeMirror's merge view (B6 F9).
- **Browser storage is not durable by default.** Safari deletes script-writable storage after seven days without interaction. A visible storage state and one-click ZIP export belong in the minimum design (B6 F17).
- **Real-folder editing is Chromium-only.** The File System Access API is opposed by Mozilla and Apple. Dropping a folder for import works everywhere (B6 F10).

### 5.5 Security

**The editor's data is well isolated.** About 75 hostile probes run inside the player failed to reach drafts, storage, the page DOM, top-level navigation, popups, dialogs, ordinary network requests, workers, nested frames or `eval` (A1 F3).

**"No external connections" does not hold against a hostile deck.** Two channels leave the sandbox in Chromium 158, and no CSP directive stops them (A1 F4, F5):

- A script-inserted `<link rel="prerender">` causes a real HTTP GET to any URL.
- WebRTC sends STUN packets to a server the deck names.

Both leak only what the deck already knows (its own content and the viewer's IP address), not the editor's drafts. The UI text "Playback has no external connections" and the README's claim should be reworded to what is true: decks cannot read your documents, and ordinary network requests are blocked. *PENDING: independent re-test and mitigation options (V1).*

Other points:

- **Error reporting is advisory.** A deck can forge the player's "ready" and "error" messages, and forged error text appears in the editor's own notice bar (A1 F13). Deck-supplied text should be labelled as coming from the deck.
- **Runaway decks.** An infinite loop does not freeze the editor on desktop Chromium, which isolates sandboxed frames in their own process; it does freeze the tab where frames share a process (A1 F10).
- **A service worker on the app's own origin is not an option.** It cannot serve the opaque sandboxed frame, and a frame given the app's origin can read the editor's storage (A1 F9).

*PENDING: threat table for served mode on a second origin (C1b).*

### 5.6 Hosting, storage, offline

- The site's CSP is a `<meta>` tag: `script-src 'self'`, `worker-src 'self' blob:`, `connect-src 'self' https: blob:`, `frame-src 'self'`. It blocks `eval` and WebAssembly on the page and in `blob:` workers. A Worker loaded from a same-origin URL is not bound by it, so WebAssembly tools such as esbuild-wasm can run there without loosening the page policy (A2 F14; B2 F5).
- A lesson of 22 MB stored inside one draft record adds about 70 ms per autosave, so IndexedDB is adequate at today's limits (A2 F19).

*PENDING: GitHub Pages limits, second-origin options, storage partitioning and quotas per browser (C2).*

## 6. Architecture options

| Option | Decks it can play | Security | Needs from hosting | Verdict |
| --- | --- | --- | --- | --- |
| **Single-file mode**: link the deck into one HTML, run it in today's opaque sandbox | Natural AI Reveal.js decks, self-contained HTML, converted Slidev builds | Unchanged: strongest editor isolation | Nothing | **Adopt first.** Works on forks and in the standalone HTML export |
| **Blob file system in the sandbox**: transfer files into the frame, create `blob:` URLs there, rewrite references | More multi-file decks; large media without base64 | Unchanged | Nothing | Useful for media; reference rewriting stays heuristic |
| **Served mode**: a service worker on a second origin serves the unzipped files | Every tested deck unmodified, including third-party plugins, ES modules, speaker view, `?print-pdf` | Deck gets a real origin, separate from the editor | A second origin | **Optional later stage** *(PENDING C1a, C1b)* |
| Service worker on the app's own origin | Same as served mode | Breaks isolation: decks could read drafts | Nothing | **Reject** |
| Real Node toolchain in the browser | Any Slidev source | Third-party runtime, packages fetched per project | Cross-origin isolation headers | **Reject for now** |

Single-file mode and served mode are complementary. Single-file mode needs no hosting change and is the only one that also produces a portable classroom file. Served mode removes the remaining compatibility limits at the cost of a second origin and a weaker isolation story for deck-to-deck separation.

## 7. Recommended roadmap

Effort key: S up to 3 days, M 1–2 weeks, L 3–5 weeks.

### Stage 0 — Repair

See section 8. All items are small and independent of the rest.

### Stage 1 — Play what AI naturally produces

| # | Work item | Effort | Evidence |
| --- | --- | --- | --- |
| 1.1 | **Classify uploads.** Accept `.html`, ZIP, a dropped folder and pasted HTML. Detect Reveal.js (entry file, version, problems) and Slidev (source or build, version, base, router mode). Replace the Slidev-specific messages | M | B1 F11; B2 F18 |
| 1.2 | **Reveal.js linker.** In the browser: inline relative CSS, scripts and assets; inline external Markdown; map Reveal.js and KaTeX CDN URLs to the bundled copies; math shim. It never fetches | M | B7 F3; A2 F2 |
| 1.3 | **Tolerant runtime.** History shim; errors after ready become a visible log instead of removing the frame; fullscreen forwarded to the host; remove `navigator.wakeLock`; stop altering the deck's document | M | B1 F6; A1 F6, F17 |
| 1.4 | **Wider package model.** Engines `reveal`, `slidev`, `html`; manifest optional; playability checked at import; de-duplicate by content hash | M | A1 F15, F23 |
| 1.5 | **Other CDN libraries** (MathJax, Chart.js, Plotly, fonts): per the owner's decision, either bundle a short list or offer "download once and store with this deck" | M | B7 F15 |
| 1.6 | **AI dialog.** Add a Reveal.js choice; replace the long prompts with the drafted 191- and 197-word profiles; publish the detail at stable URLs | S | B7 F13 |
| 1.7 | **Check report.** Emit a compact `qft-deck-check/1` report for every import, including rejected ones, with a Copy-for-AI button | M | B7 F14 |

Done when the 12-shape corpus, the AI-written sample decks and the 3 real lecture decks all play offline, and pressing F or S does not stop a deck.

### Stage 2 — Edit and replay

| # | Work item | Effort | Evidence |
| --- | --- | --- | --- |
| 2.1 | **Editable project store.** Keep the original ZIP immutable; store edited files as an overlay with a journal and named snapshots; export as ZIP | L | B6 R3; A1 F12 |
| 2.2 | **Project workspace on its own route.** Slide list first, file tree behind a toggle, framework files collapsed and read-only, CodeMirror with the extra languages loaded lazily | L | B6 F2, F15, F16 |
| 2.3 | **Refresh.** Double-buffered full reload with slide and fragment restore; CSS swap and single-slide patch later | M | B6 F4; B1 F10 |
| 2.4 | **Slide-to-source sync.** Static mapper plus Reveal's `postMessage` API relayed through the runner; compare the map with the runtime after each reload | M | B6 F3, F8; B1 F7 |
| 2.5 | **Presenter panel in the host.** Notes, next slide, timer, fullscreen; the built-in speaker view cannot work in the sandbox | M | B1 F13 |
| 2.6 | **AI revision loop.** Copy-out context pack; paste-in importer with merge review; ZIP revisions reviewed with the existing revision logic | M | B6 F9; A2 F18 |
| 2.7 | **Export.** Edited project ZIP, standalone HTML, PDF through Reveal's print view | M | B1 F9 |
| 2.8 | **Storage honesty.** Request persistent storage, show where work lives, keep backup one click away | S | B6 F17 |

### Stage 3 — Slidev

| # | Work item | Effort | Evidence |
| --- | --- | --- | --- |
| 3.1 | **Play ordinary builds.** Convert in the browser (esbuild-wasm in a same-origin Worker, loaded on demand); name the blocking feature when a build cannot be converted | M | B2 F2, F7 |
| 3.2 | **A standard hand-off contract.** Ask agents for `routerMode: hash`, `fonts.provider: none`, `--base ./`, build and source in one ZIP. Publish it as an agent skill with a zero-dependency checker, discoverable from the site; offer a template repository whose GitHub Action builds the ZIP | M | B7 F6, F9, R5, R9 |
| 3.3 | **Structured source editing.** Slide list, reorder, edit Markdown, notes and front matter with the upstream parser (36 KB gzip); write back to the ZIP | M | B2 R4 |
| 3.4 | **Live preview of edited source (beta).** Generic client plus in-browser compiler, offered only when the classifier finds no blocker; pinned to one Slidev version and diff-tested against real builds per release | L, then ongoing | B2 F3, F8, F19 |

Until 3.4 exists, Slidev source files should stay read-only with a banner that says how to rebuild, because editing them cannot change what plays (B6 R8).

### Stage 4 — Served mode (optional)

*PENDING C1a and C1b.* A separate static site on its own origin registers a service worker that serves a deck's files to the frame. The prototype played 13 Reveal.js decks unmodified, including the speaker view and `?print-pdf` (B1 F5). Forks without a second origin keep working in single-file mode.

### Not recommended

- Converting standard decks into the `qft.json` lesson format: fragments, notes, backgrounds, layout and page-level JavaScript are lost by construction (A2 F23).
- Monaco as the editor (B6 F5).
- An MCP or WebMCP surface now: shell agents gain nothing over a skill and a checker, and WebMCP is an origin trial (B7 F20; B6 F13).
- Bring-your-own API key or an in-browser model: they contradict the no-accounts principle or need multi-gigabyte downloads (B6 F19, F22).

## 8. Defects found in the current site

| Defect | Evidence |
| --- | --- |
| Arrow keys do not reach the deck after Start or Present until the user clicks (full Chromium) | A1 F7 |
| "Playback has no external connections" is inaccurate | A1 F4, F5 |
| A failure during fullscreen is invisible: the notice is outside the fullscreen element | A1 F20 |
| A Reveal.js ZIP containing a README opens the README as a lesson | A1 F11 |
| Deck-supplied error text is shown in the editor's notice bar without attribution | A1 F13 |
| Unplayable packages are saved and fail only at Start | A1 F15 |
| The same package can be saved repeatedly; the example adds 1.6 MB per click | A1 F23 |
| The AI prompt's placeholder `projectId` is itself valid, so unrelated lessons collide as revisions | A2 F12 |
| `?view=scroll` or `?print-pdf` on the site URL breaks the Markdown slide preview | A2 F16 |
| Save PDF is refused for the site's own "Quantum phase" example | A2 F17 |
| "Check lesson" passes decks written in Reveal.js or Slidev syntax | A2 F6 |
| `tools/slidev/pack.mjs` fails on a default Slidev build (Google Fonts link) | A1 F18 |
| Node version statements for Slidev are out of date (53.1.0 needs 22.22+) | B7 F11 |
| The browser test runs the headless shell and clicks before pressing keys | A1 F24 |

*PENDING: independent re-test of the first, ninth and tenth rows (V1).*

## 9. Open questions and risks

- **Firefox and Safari.** Nothing here was run in them. The History behaviour of `blob:` documents, the focus hand-off, Worker CSP rules and the two network channels need a manual pass before release.
- **Version coercion.** Running a 4.x or 5.x deck on the bundled Reveal.js 6.0.2 worked for three real decks. Third-party plugins and 3.x-era APIs may break; the fallback is to vendor one build per major (about 4.7 MB gzip in total, loaded on demand; B1 F15).
- **How models behave.** Whether ChatGPT, Gemini or Copilot follow the short prompts, or a requested patch format, is unmeasured.
- **Slidev drift.** The build conversion and the in-browser compiler depend on minified output and internal module names of one Slidev version.
- **Bundle growth.** Stage 3 adds lazy downloads: esbuild-wasm (3.6 MB gzip), a generic Slidev client (2.5 MB) and compiler (708 KB gzip).

## Appendix A — Evidence index

*PENDING: final list of notes and prototypes.*

## Appendix B — Verification results

*PENDING: the adversarial verifiers are re-running the key experiments on new inputs.*
