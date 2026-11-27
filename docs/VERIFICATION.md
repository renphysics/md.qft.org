# Verification history

## Fixes after an independent review — 2026-11-26

Seven reviewers examined the presentation-library work (commits a73456b..9109318) independently of its authors, each with their own scripts and test presentations. None of them found a way out of the sandbox or markup injected into the app page; they found two ways to lose saved edits and one way to lose files with non-ASCII names (all fixed below). They reported 58 findings, nearly all demonstrated with a file or script. Every fix below started with a test that failed on the reviewed code.

### What the review did

- **A defensive trust-boundary review.** The sandbox attributes, the `allow` list, the three Content Security Policies, the token and nonce checks and the message limits were compared with the previous release and found unchanged. A hostile presentation (markup, quotes and right-to-left overrides in its title, file names and error texts; requests to other hosts) was played in every view while the app page was searched for injected elements, event attributes and dialogs; none appeared. The ZIP reader, the scanners and the report for AI were attacked with crafted input. Found: two regular expressions that froze the page for 15 and 37 seconds on small crafted files, ZIP names decoded in the wrong encoding, a file named `__proto__` that broke the edited download, presentation paths outside the report's untrusted-text fence, and direction-changing characters shown in file names.
- **Differential testing against ordinary HTTP serving.** Generated Reveal.js presentations (Reveal.js 3 to 6 from jsDelivr, unpkg, cdnjs and local copies, ES modules, MathJax, plugins, `noscript`, async stylesheets, `image-set()`, sprites, links, caption tracks, cookies, `alert()`), ordinary web pages and Slidev builds (a feature-rich Slidev 53.1.0 build, the router and base-path variants, damaged builds) were played in the built site and, for reference, served over plain HTTP with network access in the same Chromium. Slide text at every step, fragments, highlighting, math, fonts, pictures and demo behaviour were compared. Libraries and Slidev features matched; the differences became findings (for example noscript fallbacks that refused the presentation, dead links, cookies and `alert()` that stopped or silenced scripts, MathJax-only commands).
- **An upgrade test with real stored data.** The previous release, in a persistent browser profile, saved the site's Slidev example, imported the starter ZIP and saved a Markdown draft. The new release on the same origin listed and played both presentations and kept the draft. A tab still running the old release got a misleading message (now "This page was updated in another tab. Reload the page to continue."). Edit-loss scenarios found two ways to lose saved edits: reopening the original file of a presentation fixed by edits, and editing in two tabs.
- **Seven presentations written by AI assistants on the spot.** Three Claude models wrote one presentation each from the site's own Reveal.js prompt, and four more from casual requests without it (single HTML files and ZIPs, one with Mermaid and Chart.js from a CDN). Each went through the teacher's whole path: open, read the notes, play every slide and demo, Present, Restart, Stop, copy the report, edit and Apply, reload, reopen, the three downloads, the standalone HTML from `file://` with the network blocked, and re-import. This found the `class="controls"` collision with Reveal.js's own controls in two of the three prompt-made presentations, a raw `<` in TeX that hid text, a blank white stage labelled "Playing locally" when a left-out library stopped the start-up script, and "same slide" promised for a plain page.
- **Documentation, wording and licences.** Every limit and privacy statement was checked against the code; the standalone HTML download of an imported presentation was found to lack the licence notices of the bundled code.

### What changed

The player now keeps tolerant presentations going where the sandbox used to stop or silence them (cookies in memory, `crypto.randomUUID`, a message box for `alert()`, one note for pop-up questions and new windows, no false caption-track warning), starts a Reveal.js presentation whose start-up script failed with basic settings or says on the stage that it did not start, counts problems in the status line and opens the notes for start-up problems, and offers links to websites behind a confirmation. Saved edits are never replaced silently. Scanning is linear in the file size, ZIP names keep their UTF-8 spelling, the report fences every text from the presentation, and the linker keeps or explains more (noscript, async stylesheets, `image-set()`, sprites, left-out plugins and libraries, links, files loaded while playing, Reveal.js class names, `<` in formulas, MathJax-only commands). The Slidev prompt asks for an ordinary project with its build, the converter has a time limit and a plain error, the standalone HTML download carries third-party notices, and the wording says "presentation" with a next step after every error. The details are in [ARCHITECTURE.md](ARCHITECTURE.md) and the README. Two linker differences were kept on purpose and are documented in `deck-linker.ts`: deferred scripts run during parsing, and `<picture>` art direction is dropped.

### Automated checks on the final tree

| Check | Result |
| --- | --- |
| `npm run check` | Passed: 139 files, 0 errors, 0 warnings, 1 hint (ts(2570) in `tests/browser/deck-problems.browser.mjs`, fixed in the second fix round; this table first said 0 hints) |
| `npm test` | Passed: 637 tests in 71 suites; 635 passed, 2 skipped (`QFT_SLIDEV_BUILDS` and `QFT_SLIDEV_MONACO_BUILD` unset), 0 failures |
| `npm run build` | Passed: 6 pages. Vite still reports its large-chunk advisory |
| `npm run test:browser` | Passed: 9 of 9 suites, 95 checks, 1 skipped (`QFT_SLIDEV_MONACO_BUILD` unset), in full Chromium |

Two new browser suites cover the rescue start and its strip (also in Present), the problem box when the slides do not start, the link strip and its button in the library, in Present and in the standalone download, and the wording after Apply on a plain page (`deck-problems`); and a presentation fixed by an edit, reopening its original, Apply and Escape in the editor, two tabs editing one presentation, a direction override in a file name, several problems on the stage at 1280×800 and 390×844, focus after closing at 320 px, the notice for a large file, and Original for a single HTML import (`library-edits`). The `player` suite adds cookies, `randomUUID`, the message box, `confirm`/`prompt`, the S key and `noscript`; `deck-linker` adds left-out plugins, MathJax-only commands and `<` in formulas. `tests/deck-pathological.test.ts` times the scanners on crafted input. The two AI-made research presentations now come from `docs/research/presentation-platform/prototypes.zip` and run in every environment, CI included; the larger research Slidev builds are optional through `QFT_SLIDEV_BUILDS` and `QFT_SLIDEV_MONACO_BUILD` (see the README). The browser runner serves this checkout's `dist/` itself on a free port. The starter ZIP's `source/` files are checked against `tools/slidev`.

### Automated checks after the second fix round

The tree after the second round of fixes (the findings of an independent verification of the first round's fixes; see ARCHITECTURE.md and the README for the behaviour) gave:

| Check | Result |
| --- | --- |
| `npm run check` | Passed: 147 files, 0 errors, 0 warnings, 0 hints |
| `npm test` | Passed: 721 tests in 87 suites; 719 passed, 2 skipped (`QFT_SLIDEV_BUILDS` and `QFT_SLIDEV_MONACO_BUILD` unset), 0 failures |
| `npm run build` | Passed: 6 pages. Vite still reports its large-chunk advisory |
| `npm run test:browser` | Passed: 11 of 11 suites, 118 checks, 1 skipped (`QFT_SLIDEV_MONACO_BUILD` unset), in full Chromium |

The new browser suites are `deck-notices` (the notices over the slides at 1280×800, 390×844 and 320×568) and `library-phone` (the dialog at phone width, and the library after a new release). The exact sandbox and policy strings of the interactive demo frame, `public/demo-sandbox.html` and the document and slide exports are now pinned by unit tests, as the presentation player's already were.

### Automated checks after the third fix round

The tree after the third round of fixes (the findings of the verification of the second round; see ARCHITECTURE.md and the README for the behaviour) gave, run on 2026-11-27 in full Chromium against this tree's own build:

| Check | Result |
| --- | --- |
| `npm run check` | Passed: 151 files, 0 errors, 0 warnings, 0 hints |
| `npm test` | Passed: 791 tests in 95 suites; 789 passed, 2 skipped (`QFT_SLIDEV_BUILDS` and `QFT_SLIDEV_MONACO_BUILD` unset), 0 failures |
| `npm run build` | Passed: 6 pages. Vite still reports its large-chunk advisory |
| `npm run test:browser` | Passed: 12 of 12 suites, 133 checks, 1 skipped (`QFT_SLIDEV_MONACO_BUILD` unset), in full Chromium |

The new browser suite is `player-actions` (a quiz form that answers on a click and on Enter, a required empty field, `requestSubmit()` and implicit submission, a form that no handler stops; `window.open` of a website after a click and links the presentation cancels; an error thrown with an empty value; a button that sends the presentation to a website). New unit test files cover the `onload` and `onerror` code of replaced scripts (`deck-linker-events`), the rewrite of literal page-address changes (`deck-linker-navigation`) and the report lines for the linker's and the player's new notes (`deck-report-merge`); `interactive-exports` now checks that the exports declare `no-referrer` exactly once in their own head, before any embedded runtime.

### Not verified in this round

- **The review's own tools on the fixed tree.** The fixes rest on the regression tests above, each of which reproduced its finding first. The reviewers' scripts and the seven AI-made presentations were not run again for this record.
- **Browsers.** Only full Chromium ran the suites. Firefox and Safari were not tested; neither was the message box, the link strip or `navigator.userActivation` in them (where that property is missing, the link and fullscreen checks let the request through, and opening a link still needs the button).
- **Phones and touch.** Several problems on the stage were checked in Chromium at 1280×800 and 390×844; the strips' compact phone layout and their place beside Exit fullscreen were not checked in a suite, and no phone, tablet or touch input was used.
- **Screen readers.** Roles, labels and live regions were checked in code and in the suites; no screen reader was used.
- **The deployed site.** These changes were not deployed; the converter's time limit and GitHub Pages compression of `esbuild.wasm` were not checked on the live host.

## Presentations from AI tools — 2026-11-26

This iteration lets the presentation library open Reveal.js decks (a single HTML file or a ZIP), other web pages, and ordinary Slidev builds, play them offline in the existing sandbox, edit the source of Reveal.js decks and web pages, and report what the check found to the AI that made the deck. It also repairs the defects confirmed by the research in [docs/research/presentation-platform](research/presentation-platform/README.md), section 9: keyboard focus after Start and Present, attribution of deck error text, the privacy wording, the page query in the slide preview, Save PDF on the site's own example, the lesson prompt's placeholder `projectId`, and the Slidev Node version.

### Automated checks on the final tree

| Check | Result |
| --- | --- |
| `npm run check` | Passed: 127 files, 0 errors, 0 warnings, 0 hints |
| `npm test` | Passed: 520 tests in 51 suites, 0 failures |
| `npm run build` | Passed: 6 pages. Vite still reports its large-chunk advisory |
| `npm run test:browser` | Passed: 7 of 7 suites, 69 checks, in full Chromium |

The browser suites run against the production preview in full Chromium (`QFT_BROWSER_EXECUTABLE=/opt/pw-browsers/chromium`), press keys without clicking into the deck first, and fail if any request leaves the local server. They cover: the Markdown slide preview and its PDF checks (`slides`); the portable Slidev package, its standalone export with networking disabled, and attribution of deck errors (`presentations`); both player profiles, History guards, fullscreen requests, warnings, and replay at a slide (`player`); linked test decks (`deck-linker`); opening every kind of deck from each entry point, the two AI-made research decks with their simulations, duplicates, Slidev source, Markdown and lesson ZIPs, and a library saved by the previous version (`decks`); editing, Apply, Discard, Restore original, the edited and original downloads, and leaving with unapplied changes (`deck-editing`); and converting, saving, replaying, and exporting an ordinary Slidev 53.1.0 build, refusing a Monaco build, and loading the converter only when needed (`slidev-builds`).

Unit tests also run, when the research files are on the machine, ten research Slidev builds (router and base-path variants, a Mermaid deck, a Slidev 52.11.5 build) and the official template build with Monaco. The naive-AI corpus from the research was rechecked in Node through `openDeck` and `buildPlayable`: both complete Reveal.js decks link with no errors or warnings (one note: Reveal.js 5.2.1 from jsDelivr is replaced by the bundled 6.0.2); the third agent's output has no HTML page and is correctly not treated as a deck; the fourth is empty.

### First load

The workspace (`/`) loads, before any action: JavaScript 1,296.3 KiB before this iteration (commit 974fa5e) and 1,321.3 KiB after (425.6 and 432.3 KiB gzip, +1.6%); CSS 171.8 and 181.3 KiB (35.4 and 37.0 KiB gzip); HTML 135.4 and 139.3 KiB. Almost all of the JavaScript growth is the presentation library's own script (8.8 to 15.1 KiB gzip), which carries the tolerant player bootstrap and the new library controls. The guide, FAQ, and About pages load the same 0.8 KiB of JavaScript as before; the About page's HTML grows from 85.0 to 114.9 KiB because it embeds the longer third-party notices.

Everything new is a separate lazy chunk: deck reading, detection, linking, and storage; each bundled Reveal.js and KaTeX file; the source editor; and the Slidev converter Worker with `esbuild.wasm` (13.3 MB, 3.6 MB gzip), which is requested only when a Slidev build is opened. The built `dist/_astro` grows from 3.3 MB to 21.4 MB on disk, mostly `esbuild.wasm` and the Reveal.js themes.

### Not verified in this iteration

- **Browsers.** Only full Chromium ran the automated suites. Firefox was used only during the research, in Playwright's headless build ([Appendix C](research/presentation-platform/README.md#appendix-c--firefox-pass)); in that pass a deck with an endless loop froze the Firefox tab. Safari and WebKit were not run. Whether Firefox gives the page user activation after a key press inside a sandboxed deck (needed for a deck's own fullscreen key) was not checked.
- **Devices and input.** Phones, tablets, and touch input were not tested beyond the existing narrow-layout screenshot.
- **Assistive technology.** Keyboard reachability, focus order, and `aria-live` announcements were checked in code and in the browser suites; no screen reader was used.
- **Decks.** Results rest on the test fixtures, two AI-made research decks, and the research Slidev builds. Rendering MathJax decks with KaTeX is covered by unit tests, not by a sample of real MathJax decks. Slidev conversion depends on minified build output and was checked on Slidev 53.1.0 and 52.11.5 only.
- **Deployment.** These changes were not deployed; GitHub Pages compression of `esbuild.wasm` and the Worker's policy on the live host follow from the research, not from a check of the deployed site.

## Header exports and removal of the title row — 2026-10-31

Download and Save PDF now live in the workspace's site header. The document title row is removed; the sidebar toggle precedes Paste, and Settings sits immediately before the Editor/Split/Preview group. The current document's rename control and autosave status are in the sidebar.

- Production build passed; Astro check covered 40 files with no errors, warnings, or hints.
- All 74 automated tests passed, including a regression for header export events, menu focus, Markdown download, PDF setup, and explicit association with the correct workspace.
- Browser checks of the production build confirmed the Download menu, Save PDF setup, Settings, sidebar toggling, and the rename dialog. The math example remained fully rendered.
- The desktop header remains 56 px; the document-tools row remains 48 px, with no separate title row.
- Layout checks at 320, 375, 640, and 850 px found no horizontal page overflow. The header remains 52 px at the smaller widths and 56 px at 850 px. The tools wrap at 320 px and stay on one 48 px row at the other checked widths. At 320 px the open Download menu stays within the viewport.

## Compact toolbars and public discovery — 2026-10-31

The title/actions row is 64 px on desktop and at least 60 px on mobile. The document-tools row has a 48 px minimum height and can wrap when needed. Duplicate is a labeled document tool between Paste and Clean up, with one unchanged controller hook. The existing compact site-header heights remain unchanged.

Local verification for this revision:

- Astro check: 39 files, no errors, warnings, or hints.
- Automated tests: 73 passed. New coverage checks sitemap and robots URLs under a custom domain and a project path, structured-data identities, FAQ fidelity, safe JSON-LD/XML serialization, and the blank workspace title after initialization.
- Both production builds passed for `https://md.qft.org/` and `https://reuse-example.github.io/reuse-check/`.
- Each built output passed an audit of six HTML pages, five canonical sitemap entries, 98 internal links/assets, matching canonical/social/schema URLs, valid FAQ data, the 404 noindex policy, and the 1200 × 630 sharing image.
- The executable-script CSP was preserved. JSON-LD is an inert data block; private draft content is not included in build-time metadata.

Deployment and CI results are recorded in GitHub Actions. Search indexing, search rankings, rich results, and citations by AI assistants are external outcomes and are not established by these checks. See [SEO.md](SEO.md) for webmaster-tool setup and reuse details.

## Earlier document workflow verification — 2026-10-30

This record covers the paste, organization, document-style, and PDF-setup revision. It distinguishes source/build checks from browser and native PDF checks.

### Deployment of the document-workflow revision

Feature commit [`4f10e027412b582d2bf47a3bd5f02ca6f126c2e7`](https://github.com/renphysics/md.qft.org/commit/4f10e027412b582d2bf47a3bd5f02ca6f126c2e7) is deployed at **[https://md.qft.org/](https://md.qft.org/)**. The GitHub **Check** and **Deploy to GitHub Pages** workflows both succeeded for this commit. The custom domain is serving the upgraded application over HTTPS; GitHub Pages setup is complete.

Deployment success establishes that the built application was published. Interaction, downloaded-file, and native PDF verification are recorded separately below.

## Automated and source checks

| Check | Result |
| --- | --- |
| `npm run check` | Passed: 33 files, 0 errors, 0 warnings, 0 hints |
| `npm test` | Passed: 67 tests, 0 failures |
| Production build for `https://md.qft.org/` | Passed: 5 static pages |
| Production build for a GitHub project path | Passed for `https://reuse-example.github.io/reuse-check/` |
| Built links and fonts | Both builds passed: 80 HTML links/assets and 86 font references in linked stylesheets |
| CSP, canonical URLs, and internal URLs | Passed for domain-root and project-path builds |
| Dependencies and licenses | `package.json`, lockfile, MIT license, and third-party notices are unchanged |

New regression coverage includes conservative cleanup of complete Markdown wrappers, protected mathematical/code content, heading promotion, CRLF handling in structural helpers, whole-section movement, escaping appended headings, presentation allowlists, title reuse, table-of-contents anchors, original-draft preservation, stale append/cleanup targets, queued PDF actions, and duplicate print activation. The prior rendering, draft-conflict, autosave, and deployment tests continue to pass.

Source review also addressed short-screen welcome and PDF-panel layouts, preview anchor collisions, failed-image diagnostics, title-length bounds during duplication, and presentation settings for conflict-recovered drafts. Vite still reports its existing large-editor-bundle advisory; builds succeed.

## Current browser verification

The deployed application was exercised in Chrome at `https://md.qft.org/`. Verified:

- A previously saved draft loaded after the deployment; creating a blank document showed the new welcome panel.
- The paste dialog accepted a document containing an outer Markdown fence, nested code, a table, and all four mathematical delimiter styles.
- Cleanup showed the original and proposed source, removed the enclosing wrapper, promoted headings, and created a separate formatted draft while keeping the original.
- The formatted document rendered all four equations, its table, and its inner code block.
- The organizer moved a complete section and Undo restored the original order.
- Document search matched text inside drafts as well as document titles.
- PDF setup changed the selected style, paper size, orientation, font size, margins, author, and table of contents. The preview reused the source title once and rendered its equations.
- The preview had no duplicate DOM IDs or horizontal overflow. Its table-of-contents links scrolled inside the preview.
- The active formatted draft and its rendered content survived a page reload.

These checks cover the document workflow and typography preview. Reopened HTML downloads and an actual PDF saved through the native print dialog were not verified in this session. Mobile interaction checks were not repeated for this revision.

## PDF behavior and remaining checks

Save PDF prepares a clean HTML/text print document with the selected style and opens the browser's print dialog. The in-app preview shows typography at the selected paper width; final pagination is determined by the browser. It is not a direct PDF downloader or an exact paginated preview.

Native PDF checks should verify A4/Letter dimensions, portrait/landscape, margins, selectable/searchable prose, mathematical glyphs, long tables/code, internal links, and mixed-language text. A print-dialog action alone is not evidence that a PDF was saved successfully. Standalone HTML should also be downloaded and reopened independently to confirm its embedded fonts and images.

---

## Earlier deployment revision record

The following is the historical verification record for the GitHub Pages migration at commit [`dab9687e636929a9b01cd1babeedd84babec3e2e`](https://github.com/renphysics/md.qft.org/commit/dab9687e636929a9b01cd1babeedd84babec3e2e), recorded on 2026-10-29. At that stage, the checks below were local and repository/domain setup remained to be completed. That setup was subsequently completed; the current deployment status is recorded above. These older browser checks are not claims about the new document-workflow interface.

### Earlier automated checks

| Check | Result |
| --- | --- |
| Clean `npm ci` installation | Passed with Node 24.22.1 and npm 11.9.0 |
| `npm run check` | Passed: 0 errors, 0 warnings, 0 hints |
| `npm test` | Passed: 38 tests, 0 failures |
| Production build for `https://md.qft.org/` | Passed: 5 static pages |
| Production build for `https://reuse-example.github.io/reuse-check/` | Passed: 5 static pages |
| Built navigation and assets | Both URL layouts passed: 78 HTML links/asset references and 86 font references in the stylesheets used by the pages |
| Pages workflow configuration | YAML parsed; main-branch guard, build/deploy dependency, permissions, metadata-derived URL, and immutable action pins checked |
| License preservation | Original MIT license and all preserved dependency license texts are unchanged |

The tests cover mathematical delimiters, malformed formula recovery, source-line diagnostics, literal code, escaped HTML, unsafe links, optional images, macro isolation and expansion limits, unique heading IDs, footnotes, task lists, example documents, exact source persistence, atomic competing saves, deleted-document conflicts, unavailable storage, and autosave races. New checks cover deployment URL parsing, separate project-path storage names, and continued access to the original root-domain draft database.

The built-output audit checked canonical URLs, internal navigation, example links, favicon, scripts, styles, and font files for both a domain root and a project path. It also checked that each page includes its CSP and no-referrer meta tags, no inline executable scripts, and no obsolete hosting configuration or previous-site references. Source-code and MIT-license links are visible in the workspace and supporting pages.

Vite still reports a bundle-size advisory because the editor, Markdown parser, and math renderer run in the browser. Both production builds complete successfully. This revision does not suppress the advisory.

### Earlier browser checks

The built production files were served in the available Chrome environment, with the production CSP active. Verified:

- Root deployment opens the editor and still shows previously saved local drafts.
- The `/reuse-check/` project deployment uses its own draft list and correctly prefixed navigation.
- A new project-path draft renders all four mathematical delimiter styles and a task list.
- The new draft's exact source survives autosave and a page reload.
- About and license navigation works at both deployment paths.
- The About page explains MIT reuse, provides the source link, displays the original license, and preserves dependency notices.
- Standalone HTML export at the project path completes font collection and document generation, reaching its download-ready state.
- No application CSP violations or application errors appeared in the inspected browser logs. Browser-extension diagnostics were unrelated to the app.

The initial release's browser checks also covered Markdown file import, document renaming and switching, the outline, light/dark themes, and 320 px/390 px layouts. Those broader checks were not all repeated for this deployment-focused revision.

### Earlier verification limits

The generated HTML download was not reopened independently during this revision, and native print/PDF dialogs were not exercised. The earlier download-event interface timed out, so a successful export-generation message is not treated as proof that a downloaded file was reopened successfully. Follow the download/reopen and native print checks in [DEPLOYMENT.md](DEPLOYMENT.md) in the browsers you intend to support.

The local production preview at that time did not establish live deployment, DNS, or HTTPS status. Those deployment checks have since been completed, as recorded in the current deployment section. GitHub Pages delivers the documented CSP and referrer policies through the HTML rather than configurable response headers.

Drafts are scoped to the browser, origin, and application base path. Notes on a project hostname/path do not automatically transfer to a custom domain. Export Markdown before changing addresses and import it at the new address.
