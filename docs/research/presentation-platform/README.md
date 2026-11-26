# Playing and editing AI-made Reveal.js and Slidev decks on md.qft.org

Research report · 2026-11-26

**The question.** How should md.qft.org improve so that a user can (1) ask an AI to create slides with Reveal.js or Slidev, (2) upload the ZIP to the site, processed locally in the browser, (3) see the presentation with its interactions working, and (4) edit the source files in the browser?

## 1. Summary

**Today none of this works for standard decks.** Of 12 deck shapes that AI tools naturally hand over, 0 play and 3 are silently imported as the wrong thing. A standard Reveal.js ZIP is told to "use the QFT Slidev packaging tool". A Slidev source project or an ordinary `slidev build` output is refused. A single `.html` file cannot be opened at all. Editing that changes what plays exists only for the site's own Markdown lessons.

**For Reveal.js the gap is smaller than it looks.** The existing sandboxed player already runs a complete Reveal.js 6 deck once the deck is linked into one HTML file. A prototype adapter that does this in the browser played 7 of 8 decks written the way AI tools write them, with no network requests. It failed on all 4 standard-project decks it was tried on (ES modules, external Markdown, run-time asset loading); those need more linker work. What blocks decks today is an upload gate that knows one custom format, a rule that any script error stops playback, a missing History shim, and a package model that cannot be edited. The security design is not the obstacle.

**Reveal.js and Slidev need different treatment.** A Reveal.js deck's source is what runs, so "edit and replay" needs no compiler. Slidev is compiled by a Node toolchain. The site can play Slidev builds: converting an ordinary build in the browser worked for all 10 builds tried, including one made with an older Slidev. Showing edits to Slidev *source* needs a compiler in the browser, which is feasible only for a subset of Slidev and showed visual differences on a new deck.

**Recommended roadmap**

| Stage | What the user gets | Main work | Rough effort |
| --- | --- | --- | --- |
| 0. Repair | The shipped player behaves as promised | Keyboard focus after Start, accurate privacy wording, misleading import messages, smaller defects (section 8) | days |
| 1. Play AI-made Reveal.js decks | Drop the `.html`, ZIP or folder an AI produced and it plays offline | Upload classifier, in-browser linker with CDN-to-bundled mapping, tolerant runtime, short AI prompts, a paste-back check report | 3–5 weeks |
| 2. Edit and replay | A project workspace: slide list, files, source editor, live preview, AI revisions reviewed as diffs | Editable project store, CodeMirror multi-file editor, reload with position restore, slide-to-source sync | 4–8 weeks |
| 3. Play Slidev builds | An ordinary `slidev build` output plays; agents know what to deliver | In-browser build conversion; a published agent skill, checker and build template | 2–4 weeks |
| 4. Edit Slidev source | Reorder and edit slides; a live preview for common decks | Parser-based slide editing; optional in-browser compiler | 2 weeks, then 4–6 for the preview |
| 5. Served mode (optional) | Remaining deck types play unmodified: third-party plugins, ES modules, Monaco decks | A hardened service-worker player on a second, cross-site origin | 4–6 weeks |

Stages 1 and 2 deliver the whole goal for Reveal.js on today's hosting and security model. Efforts are estimates for one developer who knows the codebase.

**Decisions for the owner, with my recommendation**

1. **Privacy wording and CDN libraries.** "Playback has no external connections" does not hold against a deliberately hostile deck (section 5.5). Reword it now. For decks that reference CDN libraries, map Reveal.js and KaTeX to the copies the site already bundles, and add an optional "download these files once and store them with the deck" step. Do not add a mode that lets a running deck reach an allow-list of CDNs: it cannot be made leak-free.
2. **A second origin.** Not needed for stages 0–4. If served mode is built later, put the player on a dedicated origin on a different site, such as the root site of a dedicated GitHub account. A subdomain of `qft.org` on GitHub Pages shares the editor's browser process: a looping deck froze the editor in tests.
3. **How far to take Slidev source editing.** Build parser-based slide editing first; it has no compatibility drift. Treat the live preview as a beta and decide after stage 3: it hooks into Slidev internals and must be re-tested for each Slidev release.

## 2. How this was researched

Fourteen research agents completed work: two code audits, four technology deep-dives (Reveal.js, Slidev, editor, AI hand-off), two assistants that wrote decks from ordinary teacher requests, two prototype agents for a second-origin player, a platform fact-check, and three adversarial verifiers. Agents read the repository and primary sources (upstream source code, official documentation, npm tarballs, CDN statistics), and built and ran prototypes against the site's production build with Playwright.

**Evidence** is kept next to this report. `findings/` holds each agent's numbered findings with evidence pointers; a citation such as "A1 F4" means finding 4 in `findings/A1.txt`. `notes/` holds the long-form notes. `prototypes.zip` holds prototype sources, test scripts and logs; paths such as `prototypes/B7/…` in the findings and notes refer to folders inside that archive.

**What the verification round changed.** The verifiers re-ran the key experiments and tried decks the prototypes were not built against. Their corrections are folded into this report:

- The Reveal.js adapter covers less than first reported. Its "5 of 5 ZIP shapes" were one- and two-slide decks, a fourth real deck fails, and on 8 unseen decks it played 4.
- The Slidev "portable build" recipe still requests a favicon from jsDelivr, so it is not free of external requests.
- The in-browser Slidev compiler's "identical output" was a DOM comparison. A pixel comparison on a new deck found differences on 3 of 7 slides.
- The paste-in importer for AI answers accepted a truncated file and deleted a slide.
- The first served-mode prototype was unsafe, and Playwright's default settings had hidden the effect of browser storage partitioning.
- A proposed fix for the WebRTC channel (removing the constructor) can be bypassed through a child frame; I tested this myself.

Appendix B lists every re-tested claim.

**Limits**

- **Chromium only.** Every experiment ran in Chromium 158. Firefox and Safari behaviour is taken from documentation or is unknown.
- **Small deck sample.** Four real AI-made decks, two written by AI assistants for this study, and decks written by the agents themselves. No deck was produced by driving ChatGPT, Gemini or Copilot.
- **Gaps.** A first research round was cut short by a usage limit. Its topics were re-covered in a smaller second round, except three: a UX and accessibility audit of the workspace, a dedicated study of presenter and export features, and Slidev decks written by assistants from ordinary requests.
- **Prototypes, not products.** They prove feasibility and give measurements. None is production code.

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

Sources: A1 F1, F11; A2 F1, F4, F6, F8; B7 F1. Four agents reproduced these independently. The site's own Markdown slide mode uses Reveal.js only as a pager: of 25 standard Reveal.js features, 18 are unsupported, including fragments, speaker notes, vertical slides and backgrounds (A2 F5).

Five mechanisms cause the rejections (A1 F1, F6, F8, F12):

1. **The manifest gate.** Only a ZIP with `qft-presentation.json` whose engine is exactly `slidev` is treated as a presentation.
2. **The single-HTML rule.** The player takes one self-contained HTML; separate scripts, styles or assets are refused.
3. **The `blob:` document.** The deck runs from a `blob:` URL in an opaque origin: `history.replaceState` to a path throws, fragment navigation is refused, relative URLs cannot resolve.
4. **Fatal errors.** Any uncaught error, unhandled rejection or CSP violation removes the running deck.
5. **An immutable package.** The stored artifact is the original ZIP; there is no update operation, and the player closes over one HTML string.

## 4. What AI tools actually hand over

**Reveal.js.** The natural answer to "make me a reveal.js presentation" is one HTML file that loads Reveal.js 4.x or 5.x from jsDelivr or cdnjs, with one inline script (B7 F2). Reveal.js 6 is rarely targeted: in the month to 2026-11-23, jsDelivr served 5.x for 59.8% of Reveal.js requests, 4.x for 27.3% and 6.x for 11.2%. The two assistants in this study behaved the same way. The one without network access wrote a four-file deck pinned to Reveal.js 5.2.1 and KaTeX on jsDelivr. The one with npm vendored Reveal.js 6.0.2 and KaTeX into a 37-file folder that needs no network. Every sampled deck sets `hash: true`.

**Slidev.** Slidev always needs a build. Who can run it (B7 F5, A2 F21–F22):

| Tool | Can it deliver a built Slidev deck? |
| --- | --- |
| Coding agents (Claude Code, Codex, Cursor, Gemini CLI) | Yes |
| Claude chat (code execution, npm allow-listed, 30 MB file limit) | Probably; Node version and disk space in its sandbox are undocumented |
| ChatGPT Work (paid, internet-enabled code execution) | Yes |
| ChatGPT Chat container | Unreliable: no outbound network; npm installs reported broken in August 2026 |
| Gemini app, consumer Copilot | No: text or a single HTML document only |

An agent that follows Slidev's official skill (14.2K installs) delivers a source project, or a default build with the history router and an absolute base path. Those are the shapes the site rejects (B7 F10).

**Consequence.** The site should accept what tools naturally produce and repair it locally, rather than teach each AI a site-specific format. The current "Create with AI" prompts are about 850 and 450 words, offer no Reveal.js option, and the Slidev one needs a terminal four times (B7 F8; A2 F7).

## 5. Findings

### 5.1 The player is engine-agnostic but intolerant

A Reveal.js 6.0.2 deck inlined by plain text substitution and labelled as a Slidev package plays in 376 ms with arrows, fragments, internal links, overview and canvas animation (A1 F2). A full-featured standard project plays after five mechanical rewrites done in 0.3 s without a bundler: vertical slides, fragments, auto-animate, backgrounds, highlight, Markdown, search (A2 F2, re-run by a verifier).

Ordinary behaviour then kills the deck, because every error is fatal (A1 F6; B1 F1; B2 F4):

- `hash: true` with a first slide that has no id throws a `SecurityError` from `history.replaceState` at start-up. This is the setting in Reveal's own template.
- Pressing **F** (fullscreen), or **S** (speaker view) when the notes plugin is loaded.
- Any of the 8 stock themes that import Google Fonts, and the math plugin, which always loads MathJax or KaTeX from a CDN.
- One image the linker failed to inline.
- For Slidev: the default Wake Lock request, or one remote image.

A 2.2 KB shim (tolerant History calls, fullscreen forwarded to the host, an inert `window.open`, a print stub) removes the first two on Reveal.js 4.x–6.x; the keys then do nothing rather than stop the deck (B1 F6).

Other player findings:

- **Keyboard focus.** In full Chromium, arrow keys do not reach the deck after Start or Present until the user clicks the slide. This affects the shipped Slidev example. A three-line repair works. CI misses it because it runs the headless shell and clicks first (A1 F7, F24; confirmed by two verifiers).
- **"Ready" is not proof of a working deck.** A deck whose external Markdown is blocked reaches "Playing locally" with one empty slide (verifier V2).
- **Fidelity.** The preparation step injects `box-sizing: border-box` on every element and drops `<title>`, the viewport meta and, in some cases, body attributes (A1 F17).
- **Silent failures.** Inline `onclick` attributes are stripped, JS-handled forms never submit, `alert` is ignored (A1 F16).
- **Size.** Assets must be base64-inlined into at most 24 MiB of HTML, about 18 MB of real media (A1 F19).

### 5.2 Reveal.js: three layouts, rotting CDN links, an adapter for the common case

- **Three incompatible file layouts** exist: 3.x, 4.x/5.x, and 6.x. Reveal.js 6.0.0 (2026-03-11) moved plugins from `plugin/<name>/<name>.js` to `dist/plugin/<name>.js`. Models trained on older decks emit old paths (B1 F3).
- **CDN links rot.** Version-pinned URLs still work. Unversioned URLs with 4.x/5.x paths return 404 on unpkg; jsDelivr answers by silently mixing a 6.0.2 core with 5.2.1 plugins (B1 F4, re-checked).
- **An adapter handles AI-style decks in the existing sandbox.** The prototype inlines relative files, maps Reveal.js and KaTeX URLs on jsDelivr, unpkg and cdnjs to the copies the site already bundles, replaces the math plugin with a 12-line shim and guards History calls (B7 F3). Results, with all external network blocked:

| Decks | Played |
| --- | --- |
| Real AI-made decks: three lecture decks and a community skill's example | 3 of 4. The fourth needs a Chart.js plugin the adapter does not know |
| Unseen AI-style decks: two written by assistants for this study, two written by a verifier (CDN-linked, versions 4.6.1 and 5.1.0) | 4 of 4, one with a dead inline `onclick` button |
| Unseen standard-project decks: external Markdown, ES module, 3.9.2 with its dependency loader, 4.6.1 with lazy-loaded assets | 0 of 4 |

- **Why the standard-project decks failed** (verifier V2): the prototype does not bundle ES modules, does not inline external Markdown, and misses asset references in `data-src`, `data-background-image`, Markdown image syntax and `@import` in local CSS. Each is mechanical to add. The player's fatal-error rule turned every miss into a dead deck.
- **Detection is cheap.** A 147-line detector recognised 36 of 36 Reveal.js decks, chose the entry file among up to 33 HTML files and read the version. A verifier confirmed it on 10 new decks and 4 non-decks (B1 F11).
- **The host can follow and drive a deck without touching its code.** Reveal's own `postMessage` API works across the opaque sandbox and returns slide state and speaker notes once `postMessageEvents` is switched on remotely. The runner must relay the messages (B1 F7; B6 F6, re-tested).
- **What single-file linking cannot run:** third-party plugins that load sibling files relative to their own script at run time (menu, chalkboard, copycode), and the built-in speaker view (B1 F5, F13).
- **Generators** vary: Quarto bundles Reveal.js 5.1.0 beside the HTML; Pandoc points at unpkg; Jupyter pins 4.0.2 through RequireJS. A self-contained Pandoc deck (`--embed-resources`, 3.08 MB) plays in today's sandbox unchanged (B1 F16–F17).

### 5.3 Slidev: playable after conversion, editable only with a compiler

- **Slidev 53.1.0 is a Vite application.** Markdown is compiled to Vue by 22 plugins in Node. There is no official in-browser mode; the official online option is StackBlitz (B2 F12, F17). It needs Node 22.22 or newer, which is newer than the repository's own starter says (B7 F11).
- **An ordinary build cannot be opened from a ZIP as it is.** It is blank from `file://`, in a `blob:` document, in an opaque sandbox, and under a sub-path with the default base (B2 F1, re-tested on a new deck).
- **A build can be converted in the browser.** Six textual patches plus bundling turn an ordinary build into one HTML that the current sandbox plays. A verifier replayed this on the production site and extended it: 7 router and base-path variants, a new 7-slide deck, the same deck with a Mermaid diagram, and a build made with Slidev 52.11.5 on Vite 7. No patch broke. Navigation, click steps, KaTeX, an image, scoped CSS and a slider component worked with no external request (B2 F2; verifier V3).
- **Conversion runs under today's CSP.** esbuild-wasm inside a same-origin Worker converted small decks in 0.9–1.8 s. With one Mermaid diagram it took 7.9 s and produced a 10 MB file. esbuild-wasm is a 3.6 MB (gzip) download, loaded on demand. Decks that use Monaco are not covered.
- **A location-independent build needs three settings.** A stock project with `routerMode: hash` (or `memory`), `fonts: { provider: none }` and `slidev build --base ./` works from any HTTP folder with the network blocked. It still requests Slidev's default favicon from jsDelivr, so a truly offline build also needs a local `favicon` (B7 F6, corrected by V3). The bespoke starter, Vite profile and packer are not required for this.
- **Source can be re-rendered without Node for a subset.** A prebuilt generic Slidev client plus a 708 KB (gzip) in-browser compiler, built from upstream parser and Markdown plugins, compiled decks in 0.07–1.4 s with no `eval` or WebAssembly (B2 F3). On a new deck the result had the same DOM on 7 of 7 slides but the same pixels on only 4 of 7: a utility class from slide front matter was lost and code colours differed. Mermaid is unsupported (verifier V3).
- **Out of reach without Node or network:** npm themes, addons and dependencies, `vite.config` and `setup/` files, Monaco, TwoSlash, remote embeds. Icons need bundled icon data (B2 F8).
- **Running the real toolchain in the browser is not realistic here.** It is 111 MB of npm tarballs and 494 MB on disk; a small deck builds with 774 MB of memory and the official template with about 2.6 GB (B2 F10). WebContainers need a commercial licence for for-profit production use, need response headers GitHub Pages cannot send, and are in practice Chromium-desktop only. One measurement of StackBlitz's Slidev starter took 52.5 s and 83.4 MB to reach the first slide, with packages fetched from StackBlitz's CDN (C2 F11).

### 5.4 Editing in the browser

- **Keep CodeMirror 6.** The site's bundle already contains the HTML, CSS and JavaScript parsers. JSON, YAML, Vue, linting and a merge view add 61.5 KB minified (23.2 KB gzip). Monaco's smallest usable core is 2,833 KB (729 KB gzip) plus workers and does not support mobile browsers (B6 F2, F5).
- **Full reload is fast enough to be the refresh strategy.** Two agents measured rebuilding and reloading the frame with the slide position restored at 170–250 ms for 20–41 slide decks, and 482 ms for 120 slides with 360 formulas. Loading the new frame hidden and swapping when ready removes the flash and keeps the last good render. An in-place slide swap takes about 10–30 ms but loses listeners added by deck scripts (B1 F10; B6 F4; swap timing re-measured).
- **Slide-aware editing is cheap.** A 5 KB mapper on the HTML parser the site already ships matched 41 of 41 slides of Reveal's demo deck and every slide of 7 further decks. Clicking an element on a slide resolved to its source range in 14 of 15 cases (B6 F3, F12).
- **AI revisions can be imported without calling any AI, but only behind review.** A 3.2 KB importer handles search/replace blocks, sloppy diffs and whole files, where a strict patch library fails. On 8 new messy cases it behaved well in 5; in one it accepted a file truncated with a bare `...` line and deleted a slide (B6 F9; verifier V2). The merge-view review and a one-step undo are required, not optional.
- **Browser storage is not durable by default.** Safari deletes script-writable storage after seven days of browser use without a visit; home-screen web apps are exempt. A visible storage state and one-click ZIP export belong in the minimum design (B6 F17; C2 F10).
- **Real-folder editing is Chromium-only.** The File System Access API is opposed by Mozilla and Apple. Dropping a folder for import works everywhere (B6 F10).

### 5.5 Security of today's player

**The editor's data is well isolated.** About 75 hostile probes run inside the player failed to reach drafts, storage, the page DOM, top-level navigation, popups, dialogs, ordinary network requests, workers or `eval`. A verifier confirmed this with its own probe set (A1 F3).

**"No external connections" does not hold against a hostile deck.** Two channels leave the sandbox in Chromium 158, with no CSP violation (A1 F4, F5; confirmed by verifier V1, also from the exported HTML opened from `file://`):

- A script-inserted `<link rel="prerender">` causes a real HTTP GET to any URL. It carries data out in the URL only; the deck cannot read a response.
- WebRTC sends STUN packets to a server the deck names.

Both leak only what the deck already holds (its own content, and the viewer's IP address), never the editor's drafts. The small interactive-demo sandbox has the same two channels. Neither can be closed from inside the page: freezing the `rel` setter is bypassed by `document.write`, and removing `RTCPeerConnection` is bypassed from a `srcdoc` child frame, which the player's `frame-src 'none'` does not block. The honest statement is: decks cannot read your documents, and ordinary network requests are blocked.

Other points:

- **Error reporting is advisory.** A deck can forge the player's "ready" and "error" messages, and forged error text appears verbatim in the editor's own notice bar (A1 F13, confirmed). Deck-supplied text should be labelled as coming from the deck.
- **Runaway decks.** An infinite loop does not freeze the editor on desktop Chromium, which gives sandboxed frames their own process. It does freeze the tab where frames share a process, such as Chrome on Android (A1 F10; C2 F1).
- **A service worker on the app's own origin is not an option.** It cannot serve the opaque sandboxed frame, and a frame given the app's origin can read the editor's storage (A1 F9).

### 5.6 Served mode: a player on a second origin

In served mode a service worker on a separate "player origin" serves the unzipped files to the deck frame, so the deck sees ordinary URLs.

**Fidelity is excellent** (C1a):

- Mounting each deck at the root of the player origin, with the worker choosing the deck per browser client, played 9 of 9 Slidev builds unmodified, including the default build. A URL prefix per deck played only 2 of 9.
- The official 37 MB kitchen-sink template played all 16 slides, with Monaco and its Web Workers working offline. First open took 2.0–2.2 s.
- Reveal.js decks with external Markdown, ES modules, and the menu and chalkboard plugins played. `?print-pdf` works (B1 F5).
- An edit-and-reload round trip took 82–99 ms.

**The first prototype was unsafe; a hardened design held** (C1b):

- A hostile deck used the prototype's unsandboxed helper frame to show dialogs, open a popup, download a file and replace the editor page. Through shared Cache Storage it read, rewrote and persistently trojaned other decks.
- The hardened design uses one sandboxed frame, files held only in worker memory under unguessable path tokens, control messages only over a port handed over by the app, and one fixed, path-restricted policy sent by the worker on every response. All of those attacks failed, and 9 of 9 real Reveal.js packages still played.
- What remains: a deck can unregister the worker and break other open decks until the app starts it again, and the same two network channels stay open as in today's sandbox.

**Where the player origin lives decides its isolation** (C1b F3–F4; C2 F1–F2):

| Player origin | Process | Storage | Pop-up speaker view |
| --- | --- | --- | --- |
| Subdomain of `qft.org` (same site) | Shares the editor's process: a looping deck froze the editor and Stop never ran | Unpartitioned; a top-level visit can run a deck unsandboxed | Works |
| Different site, e.g. a dedicated `<name>.github.io` | Own process: Stop handled in 64–78 ms | Partitioned per embedding site, and still works with third-party cookies blocked | Broken: the pop-up lands in another storage partition |

Pop-ups are also an unrestricted exfiltration channel, so the hardened design does not grant them. A presenter view has to be built by the app.

**Not yet reconciled.** The two prototype agents optimised for different things. Root mounting conflicts with a path-restricted policy. Slidev builds were not run under the hardened design, and memory-only files are lost when the browser restarts the worker unless the app re-supplies them on demand (which worked in a test). A served mode that is both hardened and plays default Slidev builds is an open design problem. Stage 3's conversion avoids it.

### 5.7 Hosting, storage, offline

- **GitHub Pages sends no custom headers.** `md.qft.org` returns `cache-control: max-age=600` and no CSP, COOP or COEP. Limits are 1 GB per site and a soft 100 GB per month. Service workers work, but a worker's scope cannot be widened beyond its folder, so a player that mounts decks at the root must sit at the root of its origin (C2 F3, F5; C1a F13).
- **The site's CSP is a `<meta>` tag** with `script-src 'self'`. It blocks `eval` and WebAssembly on the page and in `blob:` workers. A Worker loaded from a same-origin URL is not bound by it, so esbuild-wasm can run there without loosening the page policy (A2 F14; B2 F5, re-tested).
- **Second-origin options** (C2 F4, F13): a subdomain of `qft.org`; the root site of a dedicated GitHub account; or a separate registered domain on Cloudflare, where wildcard subdomains could give every deck its own origin. `github.io` is on the Public Suffix List, so any `<name>.github.io` is a different site from `qft.org`. All project sites of one GitHub account share one origin, so the account must be dedicated to the player.
- **Storage.** Chromium allows an origin up to 60% of the disk; Firefox's best-effort limit is the smaller of 10% of the disk and 10 GiB. Safari deletes script-writable storage after seven days of browser use without a visit, except for home-screen web apps. A 22 MB lesson stored in one draft record adds about 70 ms per autosave, so IndexedDB is adequate at today's limits (C2 F9–F10; A2 F19).
- **Installable app.** Chrome no longer needs a service worker to install a web app. Registering as a handler for `.zip` and `.html` files works in Chrome and Edge on desktop only (C2 F14).
- **Changing host.** Drafts are bound to the origin `https://md.qft.org`. Moving to another host keeps them only if that origin stays the same (C2 F13).
- **Prior art.** CodePen, JSFiddle, LiveCodes, Phoenix Code, StackBlitz and vscode.dev all run user code on a separate origin, usually a separate site. No product was found that plays an uploaded Reveal.js or Slidev ZIP locally and lets the user edit it (C2 F15).

## 6. Architecture options

| Option | Decks it can play | Security | Needs from hosting | Verdict |
| --- | --- | --- | --- | --- |
| **Single-file mode**: link the deck into one HTML and run it in today's opaque sandbox | AI-style Reveal.js decks; more standard projects as the linker grows; converted Slidev builds | Unchanged: the strongest editor isolation of all options | Nothing | **Adopt first.** Works on forks and in the standalone HTML export |
| Blob files inside the sandbox: transfer bytes into the frame and create `blob:` URLs there | Large media without base64 growth | Unchanged | Nothing | A useful addition for media (A1 F9; B6 F11) |
| **Served mode**: a hardened service-worker player on a second, cross-site origin | Decks with relative URLs unmodified: third-party plugins, ES modules, external Markdown, relative-base Slidev builds | Deck gets a real origin separate from the editor; decks share that origin with each other; same two network channels | A dedicated second origin | **Optional later stage** |
| Served mode on a `qft.org` subdomain | Same, plus pop-ups | Shares the editor's process | A subdomain | **Reject** on GitHub Pages |
| Service worker on the app's own origin | Same as served mode | Decks could read drafts | Nothing | **Reject** |
| Real Node toolchain in the browser | Any Slidev source | Third-party runtime; packages fetched per project | Cross-origin isolation headers | **Reject for now** |

Single-file mode and served mode are complementary. Single-file mode needs no hosting change and is the only one that also produces a portable classroom file. Served mode removes most remaining compatibility limits at the cost of a second origin, more moving parts and unknown behaviour in Firefox and Safari.

## 7. Recommended roadmap

Effort key: S up to 3 days, M 1–2 weeks, L 3–5 weeks.

### Stage 0 — Repair

The defects in section 8. All are small and independent of the rest.

### Stage 1 — Play what AI naturally produces

| # | Work item | Effort | Evidence |
| --- | --- | --- | --- |
| 1.1 | **Classify uploads.** Accept `.html`, ZIP, a dropped folder and pasted HTML. Detect Reveal.js (entry file, version, problems) and Slidev (source or build, version, base path). Replace the Slidev-specific messages | M | B1 F11; B2 F18 |
| 1.2 | **Linker for AI-style decks.** In the browser: inline relative CSS, scripts and assets; map Reveal.js and KaTeX CDN URLs to the bundled copies; math shim; convert inline event handlers. It never fetches | M | B7 F3; A2 F2 |
| 1.3 | **Linker for standard projects.** Inline external Markdown; rewrite `data-src`, backgrounds, Markdown images and CSS `url()`/`@import`; bundle ES modules; support the 3.x dependency loader. Name the blocking feature when a deck needs more | M | verifier V2 |
| 1.4 | **Tolerant runtime.** History shim; errors after start-up become a visible log instead of removing the frame; fullscreen forwarded to the host; remove `navigator.wakeLock`; stop altering the deck's document | M | B1 F6; A1 F6, F17 |
| 1.5 | **Wider package model.** Engines `reveal`, `slidev`, `html`; manifest optional; playability checked at import; de-duplicate by content hash | M | A1 F15, F23 |
| 1.6 | **Other CDN libraries** (MathJax, Chart.js, Plotly, fonts): the app downloads the statically referenced files once, with consent, and stores them with the deck | M–L | C1b F13; B7 F15 |
| 1.7 | **AI dialog.** Add a Reveal.js choice; replace the long prompts with the drafted 191- and 197-word profiles; publish the detail at stable URLs | S | B7 F13 |
| 1.8 | **Check report.** Emit a compact `qft-deck-check/1` report for every import, including rejected ones, with a Copy-for-AI button. Check the slide count, not only "ready" | M | B7 F14 |

Item 1.6 is my own proposal and was not prototyped. I verified that jsDelivr, unpkg, cdnjs and Google Fonts all answer with `access-control-allow-origin: *`, so the app page can fetch the files under its current CSP.

Done when the decks in the table of section 5.2 that are AI-style all play offline, each standard-project deck either plays or gets a message naming the blocking feature, and pressing F or S does not stop a deck.

### Stage 2 — Edit and replay

| # | Work item | Effort | Evidence |
| --- | --- | --- | --- |
| 2.1 | **Editable project store.** Keep the original ZIP immutable; store edited files as an overlay with a journal and named snapshots; export as ZIP | L | B6 R3; A1 F12 |
| 2.2 | **Project workspace on its own route.** Slide list first, file tree behind a toggle, framework files collapsed and read-only, CodeMirror with the extra languages loaded lazily | L | B6 F2, F15, F16 |
| 2.3 | **Refresh.** Double-buffered full reload with slide and fragment restore; CSS swap and single-slide patch later | M | B6 F4; B1 F10 |
| 2.4 | **Slide-to-source sync.** Static mapper plus Reveal's `postMessage` API relayed through the runner; compare the map with the runtime after each reload | M | B6 F3, F8; B1 F7 |
| 2.5 | **Presenter panel in the host.** Notes, next slide, timer, fullscreen; the built-in speaker view cannot work in the sandbox | M | B1 F13 |
| 2.6 | **AI revision loop.** Copy-out context pack; paste-in importer behind merge review, hardened against truncated answers; ZIP revisions reviewed with the existing revision logic | M | B6 F9; A2 F18 |
| 2.7 | **Export.** Edited project ZIP, standalone HTML, PDF through Reveal's print view | M | B1 F9 |
| 2.8 | **Storage honesty.** Request persistent storage, show where work lives, keep backup one click away | S | B6 F17 |

### Stage 3 — Play Slidev builds

| # | Work item | Effort | Evidence |
| --- | --- | --- | --- |
| 3.1 | **Convert ordinary builds in the browser.** esbuild-wasm in a same-origin Worker, loaded on demand; show progress for large decks; name the blocking feature (for example Monaco) when a build cannot be converted | M | B2 F2, F7; verifier V3 |
| 3.2 | **A standard hand-off contract.** Ask agents for `routerMode: hash`, `fonts.provider: none`, a local favicon, `slidev build --base ./`, and build plus source in one ZIP. Publish it as an agent skill with a zero-dependency checker, discoverable from the site; offer a template repository whose GitHub Action builds the ZIP | M | B7 F6, F9, R5, R9 |
| 3.3 | **Retire the bespoke packer over time** and correct the Node version statements | S | A1 F18; B7 F11 |

### Stage 4 — Edit Slidev source

| # | Work item | Effort | Evidence |
| --- | --- | --- | --- |
| 4.1 | **Structured source editing.** Slide list, reorder, edit Markdown, notes and front matter with the upstream parser (36 KB gzip); write back to the ZIP | M | B2 R4 |
| 4.2 | **Live preview (beta).** Generic client plus in-browser compiler, offered only when the classifier finds no blocker; pinned to one Slidev version; compared against real builds by pixels, not only DOM, for each release | L, then ongoing | B2 F3, F8, F19; verifier V3 |

Until 4.2 exists, Slidev source files should stay read-only or carry a banner that says how to rebuild, because editing them cannot change what plays (B6 R8).

### Stage 5 — Served mode (optional)

| # | Work item | Evidence |
| --- | --- | --- |
| 5.1 | A separate static site on a dedicated cross-site origin, containing only a boot page and the worker | C1b R1 |
| 5.2 | The hardened design: one sandboxed frame with `allow-scripts allow-same-origin` only, files re-supplied by the app on demand, unguessable path tokens, one fixed policy compiled into the worker | C1b R2–R4; C1a F3 |
| 5.3 | Harden the editor page: add the player origin to `frame-src`, make app pages refuse to run inside a frame, and accept messages only when source, origin and session token match | C1b R5 |
| 5.4 | A build-time setting for the player origin. When it is empty, or service workers are unavailable in the frame, fall back to single-file mode. Forks point it at their own player | C2 R4 |

Decide on this stage after stages 1–3 show how many real decks single-file mode cannot play.

### Not recommended

- A mode that lets a running deck reach an allow-list of CDNs. A deck can request arbitrary paths there, and jsDelivr publishes per-file hit counts that an attacker can read back (C1b F13–F14).
- Converting standard decks into the `qft.json` lesson format: fragments, notes, backgrounds, layout and page-level JavaScript are lost by construction (A2 F23).
- Monaco as the editor (B6 F5).
- An MCP or WebMCP surface now: shell agents gain nothing over a skill and a checker, and WebMCP is an origin trial (B7 F20; B6 F13).
- Bring-your-own API key or an in-browser model: they contradict the no-accounts principle or need multi-gigabyte downloads (B6 F19, F22).

## 8. Defects found in the current site

| Defect | Evidence | Re-tested |
| --- | --- | --- |
| Arrow keys do not reach the deck after Start or Present until the user clicks (full Chromium) | A1 F7 | Confirmed by V1 and V3 |
| "Playback has no external connections" is inaccurate, for the player and for interactive demos | A1 F4, F5 | Confirmed by V1 |
| Deck-supplied error text is shown in the editor's notice bar without attribution | A1 F13 | Confirmed by V1 |
| `?view=scroll` or `?print-pdf` on the site URL breaks the Markdown slide preview | A2 F16 | Confirmed by V1 |
| Save PDF is refused for the site's own "Quantum phase" example | A2 F17 | Confirmed by V1 |
| A Reveal.js ZIP containing a README opens the README as a lesson | A1 F11 | Seen by four agents |
| `tools/slidev/pack.mjs` fails on a default Slidev build (Google Fonts link) | A1 F18 | Seen by three agents |
| Node version statements for Slidev are out of date (53.1.0 needs 22.22+) | B7 F11 | Confirmed by V3 |
| A failure during fullscreen is invisible: the notice is outside the fullscreen element | A1 F20 | No |
| Unplayable packages are saved and fail only at Start | A1 F15 | No |
| The same package can be saved repeatedly; the example adds 1.6 MB per click | A1 F23 | Seen by two agents |
| The AI prompt's placeholder `projectId` is itself valid, so unrelated lessons collide as revisions | A2 F12 | No |
| "Check lesson" passes decks written in Reveal.js or Slidev syntax | A2 F6 | No |
| The browser test runs the headless shell and clicks before pressing keys, so it cannot see the focus defect | A1 F24 | No |

## 9. Open questions and risks

- **Firefox and Safari.** Nothing here was run in them. The History behaviour of `blob:` documents, the focus hand-off, Worker CSP rules, the two network channels and, for served mode, partitioned service workers all need a manual pass.
- **Version coercion.** Running 4.x and 5.x decks on the bundled Reveal.js 6.0.2 worked for every such deck tried (six). Third-party plugins and 3.x-era APIs may break; the fallback is to vendor one build per major, about 4.7 MB gzip in total, loaded on demand (B1 F15).
- **How models behave.** Whether ChatGPT, Gemini or Copilot follow the short prompts, or a requested patch format, is unmeasured.
- **Slidev drift.** The build conversion survived one older version, but it and the in-browser compiler depend on minified output and internal module names.
- **Bundle growth.** Stages 3 and 4 add lazy downloads: esbuild-wasm (3.6 MB gzip), a generic Slidev client (2.5 MB) and compiler (708 KB gzip).
- **The site's own Markdown slide dialect.** Whether it stays a third format or converges on Reveal's Markdown conventions is undecided (A2 R8).
- **Presenter and export features** were researched only as far as the items above; a dedicated study did not complete.

## Appendix A — Evidence index

| Agent | Topic | Files |
| --- | --- | --- |
| A1 | Audit of the presentation player; about 75 hostile probes | `findings/A1.txt`, `notes/A1-audit-player.md`, `prototypes/A1/` |
| A2 | Audit of slide authoring and the AI hand-off | `findings/A2.txt`, `notes/A2-audit-authoring.md`, `prototypes/A2/` |
| B1 | Reveal.js: versions, CDNs, shim, detector, first served-mode prototype | `findings/B1.txt`, `notes/B1-revealjs.md`, `prototypes/B1/` |
| B2 | Slidev: build facts, conversion, in-browser compiler, classifier | `findings/B2.txt`, `notes/B2-slidev.md`, `prototypes/B2/` |
| B6 | Editor: CodeMirror sizes, slide mapper, refresh timings, AI-answer importer | `findings/B6.txt`, `notes/B6-editor-ux.md`, `prototypes/B6/` |
| B7 | AI hand-off: tool capabilities, adapter, prompts, skill outline, check report | `findings/B7.txt`, `notes/B7-ai-authoring.md`, `prototypes/B7/` |
| C1a | Served mode: fidelity for Slidev and Reveal.js | `findings/C1a.txt`, `notes/C1a-player-origin-fidelity.md`, `prototypes/C1a/` |
| C1b | Served mode: security review and hardened design | `findings/C1b.txt`, `notes/C1b-player-origin-security.md`, `prototypes/C1b/` |
| C2 | Platform and hosting facts | `findings/C2.txt`, `notes/C2-platform-facts.md`, `prototypes/C2/` |
| V1 | Verifier: security and player claims | `notes/V1-security-player.md`, `prototypes/V1/` |
| V2 | Verifier: Reveal.js pipeline, unseen decks | `findings/V2.txt`, `notes/V2-reveal-pipeline.md`, `prototypes/V2/` |
| V3 | Verifier: Slidev pipeline, a new deck | `findings/V3.txt`, `notes/V3-slidev-pipeline.md`, `prototypes/V3/` |
| — | My own check of the WebRTC mitigation | `prototypes/M1/` |

The `prototypes/` folders are inside `prototypes.zip`, which has its own README listing the most reusable files. Ready-to-use drafts (the two short AI prompts, a skill outline and the check-report schema) are in `prototypes/B7/artefacts/`. The archive's `test-decks/` folder holds the two decks written by AI assistants for this study. Third-party decks and downloaded packages used in tests are not included.

## Appendix B — Verification results

Verdicts by the three verifiers, who re-ran each experiment from a copy and added new inputs.

| Claim | Verdict |
| --- | --- |
| A script-inserted prerender link sends an HTTP GET from inside the player | Confirmed, also from the `file://` export and with background-networking flags removed |
| WebRTC sends STUN packets from inside the player | Confirmed |
| Removing `RTCPeerConnection` closes that channel | Verifier: yes. My test: no, a `srcdoc` child frame restores it |
| Apart from those two channels, a hostile package cannot reach the editor or the network | Confirmed with an independent probe set |
| Arrow keys do not reach the deck after Start; three-line repair works | Confirmed on the shipped example |
| `hash: true` kills a Reveal.js deck at start; a History shim fixes it; F and S kill a running deck | Confirmed; S only when the notes plugin is loaded |
| A package can forge "ready" and "error" messages | Confirmed |
| Site URL query breaks the slide preview; Save PDF refused for the site's example | Confirmed |
| Service worker cannot serve the opaque sandbox; blob URL behaviour; infinite-loop behaviour | Not re-run by V1; reproduced in part by B6, C1b and C2 |
| The adapter plays 3 of 3 real decks and 5 of 5 ZIP shapes | Confirmed with caveats; on unseen decks 4 of 8 (section 5.2) |
| Five rewrites make a full-featured Reveal.js project play | Confirmed; on unseen decks this simpler wrapper played 1 of 8 because it has no CDN mapping |
| The 2.2 KB shim survives F and S on 4.x–6.x | Confirmed; the keys then do nothing |
| Single-file linking cannot run menu, copycode, chalkboard; served mode plays all 13 decks | Confirmed, except that the AI-made corpus deck does play when linked |
| Reveal `postMessage` API works across the sandbox | Confirmed |
| Reload 170–250 ms; in-place swap 20–30 ms | Swap confirmed (7–25 ms); the verifier's reload probe failed, so reload rests on two agents' measurements |
| Slide mapper 41/41 and 12/12 | Confirmed, plus 6 new decks |
| Detector 36/36 | Confirmed on 14 new inputs |
| Reveal.js 6 layout change and CDN behaviour | Confirmed |
| AI-answer importer handles its 13 cases | Confirmed; 5 of 8 new cases, one with data loss |
| Slidev build conversion works for 7 variants and in a Worker under the site CSP | Confirmed, plus three new builds including Slidev 52.11.5 |
| In-browser Slidev compiler output is identical to the real build | DOM yes (7/7 on a new deck); pixels 4/7 |
| An unmodified Slidev build is blank from `file://`, `blob:`, the sandbox and a sub-path | Confirmed |
| A same-origin Worker is not bound by the page's meta CSP | Confirmed |
| Memory router exists since Slidev 52.17.0 | Confirmed |
| Three settings give a build with 0 external requests | Refuted: the default favicon is still requested |
| Build size and cost figures; template is 314 files and 37 MB | Confirmed by static checks |
| A built Slidev client exposes its router through the Vue app | Confirmed |
| Slidev upload classifier 17/17 | Kinds confirmed; router mode wrong for a 52.11.5 build |
