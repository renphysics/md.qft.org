# Playing and editing AI-made Reveal.js and Slidev decks on md.qft.org

Research report · 2026-11-26

**The question.** How should md.qft.org improve so that a user can (1) ask an AI to create slides with Reveal.js or Slidev, (2) upload the ZIP to the site, processed locally in the browser, (3) see the presentation with its interactions working, and (4) edit the source files in the browser?

## 1. Summary

**Today none of this works for standard decks.** Of 12 deck shapes that AI tools naturally hand over, 0 play and 3 are silently imported as the wrong thing. A standard Reveal.js ZIP is told to "use the QFT Slidev packaging tool". A Slidev source project or an ordinary `slidev build` output is refused. A single `.html` file cannot be opened at all. Editing that changes what plays exists only for the site's own Markdown lessons.

**For Reveal.js the gap is smaller than it looks.** The existing sandboxed player already runs a complete Reveal.js 6 deck once the deck is linked into one HTML file. A prototype adapter that does this in the browser played 3 of the 4 real AI-made decks it was developed against, and 4 of 4 new decks written in the same style (one with a dead inline button), with no network requests. It failed on all 4 standard-project decks it was tried on (ES modules, external Markdown, the 3.x plugin loader, asset references it does not rewrite); those need more linker work. What blocks decks today is an upload gate that knows one custom format, a rule that any script error stops playback, a missing History shim, and a package model that cannot be edited. The security design is not the obstacle.

**Reveal.js and Slidev need different treatment.** A Reveal.js deck's source is what runs, so "edit and replay" needs no compiler. Slidev is compiled by a Node toolchain. The site can play Slidev *builds*: converting an ordinary build into one file worked for all 10 builds tried, including one made with an older Slidev, and the converter also runs in the browser. A Slidev *source* project cannot play without being built. Showing edits to Slidev source needs a compiler in the browser, which is feasible only for a subset of Slidev; on a new deck, 3 of 7 slides came out visually different.

**Where the roadmap ends up.** Reveal.js decks can be played and edited in the browser. Slidev builds can be played. Slidev source can be edited, with a rebuild outside the browser or, for simple decks, an approximate preview.

| Stage | What the user gets | Size |
| --- | --- | --- |
| 0. Repair and de-risk | The shipped player behaves as promised. The plan is checked in Firefox, Safari and on a tablet before more is built | 1–3 weeks |
| 1. Play AI-made Reveal.js decks | Drop the `.html`, ZIP or folder an AI produced and it plays with no network; take a standalone file to class | 6–13 weeks; first usable slice 3–7 |
| 2. Play Slidev builds and standard projects | An ordinary `slidev build` output plays. Reveal.js projects with ES modules play. Agents know what to deliver | 4–10 weeks |
| 3. Edit and replay | A project workspace for Reveal.js: slide list, files, source editor, live preview, AI revisions reviewed as diffs | 9–18 weeks; first usable slice 5–10 |
| 4. Edit Slidev source | Reorder and edit slides with an explicit rebuild step; later a preview for simple decks | 1–2 weeks, then 3–5 plus upkeep |
| 5. Remaining decks (optional) | Third-party plugins, large media, Monaco decks | 1–2 week design spike, then re-estimate |

Sizes are the sums of the per-item estimates in section 8, for one developer working conventionally, with basic tests. Read them as relative sizes. Stages 0, 1 and 3 deliver the whole goal for Reveal.js on today's hosting and security model.

**Decisions for the owner, with my recommendation**

1. **Privacy wording, and libraries that decks load from CDNs.** "Playback has no external connections" does not hold against a deliberately hostile deck (section 5.5). Reword it now. For CDN libraries, map Reveal.js and KaTeX to copies served by the site, and prototype a "download these files once and keep them with the deck" step for the rest. The alternative, letting a running deck load from an allow-list of CDNs, is simpler, but it makes decks depend on the network in class, tells the CDN every time a deck is played, and lets the code change after the deck was checked. MathJax needs its own choice: the adapter prototype renders MathJax decks with KaTeX, and that was not tested.
2. **How far to take Slidev.** Treat Reveal.js as the engine users edit on the site, and Slidev as play-first: builds play, and source edits go through a rebuild elsewhere. The live preview is a possible later step with a standing cost for every Slidev release.
3. **Classrooms without internet.** The site itself needs a network connection to open. Either add an app-shell service worker so the site opens offline, or rely on the exported standalone file. I recommend the service worker; it is separate from everything else here and compatible with it.
4. **A second origin.** Not needed for stages 0–4. If the remaining decks matter later, compare two designs first (section 7). If served mode is chosen, host the player on a different site, such as the root site of a dedicated GitHub organization. A subdomain of `qft.org` on GitHub Pages shares the editor's browser process: a looping deck froze the editor in tests.

## 2. How this was researched

Fourteen research agents completed work: two code audits, four technology deep-dives (Reveal.js, Slidev, editor, AI hand-off), two assistants that wrote decks from ordinary teacher requests, two prototype agents for a second-origin player, a platform fact-check, and three adversarial verifiers. Agents read the repository and primary sources (upstream source code, official documentation, npm tarballs, CDN statistics), and built and ran prototypes against the site's production build with Playwright. Two reviewers then checked a draft of this report, one against the evidence and one as a critical reader.

**Evidence** is kept next to this report. `findings/` holds each agent's numbered findings with evidence pointers; a citation such as "A1 F4" means finding 4 in `findings/A1.txt`. `notes/` holds the long-form notes. `prototypes.zip` holds prototype sources, test scripts and logs; paths such as `prototypes/B7/…` in the findings and notes refer to folders inside that archive.

**What the later rounds changed.** Their corrections are folded into this report:

- *Verifiers.* The Reveal.js adapter covers less than first reported: its "5 of 5 ZIP shapes" were one- and two-slide decks, a fourth real deck fails, and on 8 unseen decks it played 4.
- *Verifiers.* The Slidev "portable build" recipe still requests a favicon from jsDelivr, so it is not free of external requests.
- *Verifiers.* The in-browser Slidev compiler's "identical output" was a DOM comparison. A pixel comparison on a new deck found differences on 3 of 7 slides.
- *Verifiers.* The paste-in importer for AI answers accepted a truncated file and deleted a slide.
- *Second-round agents.* The first served-mode prototype was unsafe, and Playwright's default settings had hidden the effect of browser storage partitioning.
- *My own test.* A proposed fix for the WebRTC channel, removing the constructor, can be bypassed through a child frame.
- *Reviewers.* The stage sizes in the summary did not add up from the per-item estimates, the roadmap order ignored two dependencies, and the served-mode stage claimed more than was proven. All three are corrected here.

Appendix B lists every re-tested claim.

**Limits**

- **Desktop Chromium only.** Every experiment ran in Chromium 158 on Linux. Nothing was run in Safari, on a phone or tablet, with touch input, or with a screen reader. Firefox: see Appendix B.
- **Small deck sample.** Four real AI-made decks; two written by AI assistants for this study, both from one model family; and decks written by the agents themselves. No deck was produced by ChatGPT, Gemini or Copilot.
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

**Reveal.js.** The natural answer to "make me a reveal.js presentation" is one HTML file that loads Reveal.js 4.x or 5.x from jsDelivr or cdnjs, with one inline script (B7 F2). Reveal.js 6 is rarely targeted: in the month to 2026-11-23, jsDelivr served 5.x for 59.8% of Reveal.js requests, 4.x for 27.3% and 6.x for 11.2%. The two assistants in this study showed the two patterns to expect. The one without network access wrote a four-file deck pinned to Reveal.js 5.2.1 and KaTeX on jsDelivr. The one with npm vendored Reveal.js 6.0.2 and KaTeX into a 37-file folder that needs no network (B1 F18). Every sampled deck sets `hash: true`.

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
- Any of the 8 stock themes that import Google Fonts, and the math plugin with its default settings, which loads MathJax or KaTeX from a CDN at run time.
- One image the linker failed to inline.
- For Slidev: the default Wake Lock request, or one remote image.

A 2.2 KB shim (tolerant History calls, fullscreen forwarded to the host, an inert `window.open`, a print stub) removes the first two on Reveal.js 4.x–6.x; the keys then do nothing rather than stop the deck (B1 F6).

Other player findings:

- **Keyboard focus.** In full Chromium, arrow keys do not reach the deck after Start or Present until the user clicks the slide. This affects the shipped Slidev example. A three-line repair works. CI misses it because it runs the headless shell and clicks first (A1 F7, F24; confirmed by two verifiers).
- **"Ready" is not proof of a working deck.** A deck whose external Markdown is blocked reaches "Playing locally" with one empty slide (verifier V2).
- **Remote content cannot load.** The player's policy blocks frames and remote images, so embedded videos, web simulations in iframes and hot-linked pictures stay blank or stop the deck. This is by design and applies to every single-file deck.
- **Fidelity.** The preparation step injects `box-sizing: border-box` on every element and drops `<title>`, the viewport meta and, in some cases, body attributes (A1 F17).
- **Silent failures.** Inline `onclick` attributes are stripped, JS-handled forms never submit, `alert` is ignored (A1 F16).
- **Size.** Assets must be base64-inlined into at most 24 MiB of HTML, about 18 MB of real media (A1 F19).

### 5.2 Reveal.js: three layouts, rotting CDN links, an adapter for the common case

- **Three incompatible file layouts** exist: 3.x, 4.x/5.x, and 6.x. Reveal.js 6.0.0 (2026-03-11) moved plugins from `plugin/<name>/<name>.js` to `dist/plugin/<name>.js`. Models trained on older decks emit old paths (B1 F3).
- **CDN links rot.** Version-pinned URLs still work. Unversioned URLs with 4.x/5.x paths return 404 on unpkg; jsDelivr answers by silently mixing a 6.0.2 core with 5.2.1 plugins (B1 F4, re-checked).
- **An adapter handles AI-style decks in the existing sandbox.** The prototype inlines relative files, maps Reveal.js and KaTeX URLs on jsDelivr, unpkg and cdnjs to local copies of Reveal.js 6.0.2 and KaTeX, replaces the math plugin with a 12-line shim and guards History calls (B7 F3). Results, with all external network blocked:

| Decks | Played |
| --- | --- |
| Real AI-made decks the adapter was developed against: three lecture decks and a community skill's example | 3 of 4. The fourth needs a Chart.js plugin the adapter does not know |
| New AI-style decks: two written by assistants for this study, two written by a verifier (CDN-linked, versions 4.6.1 and 5.1.0) | 4 of 4, one with a dead inline `onclick` button |
| New standard-project decks: external Markdown, ES module, 3.9.2 with its dependency loader, 4.6.1 with lazy-loaded assets | 0 of 4 |

- **Why the standard-project decks failed** (verifier V2): the prototype does not bundle ES modules, does not inline external Markdown, and misses asset references in `data-src`, `data-background-image`, Markdown image syntax and `@import` in local CSS. Each is mechanical to add. The player's fatal-error rule turned every miss into a dead deck.
- **The site does not ship what the adapter needs yet.** Today's bundle contains only the Reveal.js core and its base stylesheet. The stock themes and plugins that AI decks reference add about 3.7 MB uncompressed, to be loaded on demand; the highlight plugin alone is 920 KB (B1 F15).
- **Math needs a decision.** The shim renders every variant of Reveal's math plugin with KaTeX, including decks written for MathJax. MathJax decks were not tested, and MathJax is far more common on the web than KaTeX (B7 F15).
- **Detection is cheap.** A 147-line detector recognised 36 of 36 Reveal.js decks, chose the entry file among up to 33 HTML files and read the version. A verifier confirmed it on 14 new inputs: 10 decks recognised, the rest correctly rejected (B1 F11).
- **The host can follow and drive a deck without touching its code.** Reveal's own `postMessage` API works across the opaque sandbox and returns slide state and speaker notes once `postMessageEvents` is switched on remotely. The runner must relay the messages, and everything the deck returns is untrusted data (B1 F7; B6 F6, re-tested).
- **What single-file linking cannot run:** third-party plugins that load sibling files relative to their own script at run time (menu, chalkboard, copycode), and the built-in speaker view (B1 F5, F13).
- **Generators** vary: Quarto bundles Reveal.js 5.1.0 beside the HTML; Pandoc points at unpkg; Jupyter pins 4.0.2 through RequireJS. A self-contained Pandoc deck (`--embed-resources`, 3.08 MB) plays in today's sandbox unchanged (B1 F16–F17).

### 5.3 Slidev: playable after conversion, editable only with a compiler

- **Slidev 53.1.0 is a Vite application.** Markdown is compiled to Vue by 22 plugins in Node. There is no official in-browser mode; the official online option is StackBlitz (B2 F12, F17). It needs Node 22.22 or newer, which is newer than the repository's own starter says (B7 F11).
- **An ordinary build cannot be opened from a ZIP as it is.** It is blank from `file://`, in a `blob:` document, in an opaque sandbox, and under a sub-path with the default base (B2 F1, re-tested on a new deck).
- **A build can be converted.** Six textual patches plus bundling turn an ordinary build into one HTML that the current sandbox plays; it worked for 7 router and base-path variants (B2 F2). A verifier converted all 7 again and replayed 6 on the production site before its run was cut off. It then converted three new builds with both the Node and the in-browser converter: a new 7-slide deck, the same deck with a Mermaid diagram, and a build made with Slidev 52.11.5 on Vite 7. No patch broke. Navigation, click steps, KaTeX, an image, scoped CSS and a slider component worked with no external request (verifier V3).
- **Conversion runs under today's CSP.** esbuild-wasm inside a same-origin Worker converted small decks in 0.9–1.8 s. With one Mermaid diagram it took 7.9 s and produced a 10 MB file. esbuild-wasm is a 3.6 MB (gzip) download, loaded on demand. Decks that use Monaco are not covered.
- **A location-independent build needs three settings.** A stock project with `routerMode: hash` (or `memory`), `fonts: { provider: none }` and `slidev build --base ./` works from any HTTP folder with the network blocked. It still requests Slidev's default favicon from jsDelivr, so a truly offline build also needs a local `favicon` (B7 F6, corrected by V3). The bespoke starter, Vite profile and packer are not required for this.
- **Source can be re-rendered without Node for a subset.** A prebuilt generic Slidev client plus a 708 KB (gzip) in-browser compiler, built from upstream parser and Markdown plugins, compiled decks in 0.07–1.4 s with no `eval` or WebAssembly (B2 F3). On a new deck the result had the same DOM on 7 of 7 slides but the same pixels on only 4 of 7: a utility class from slide front matter was lost and code colours differed. Mermaid is unsupported. On the official kitchen-sink template only 7 of 16 slides matched (verifier V3; B2 F3).
- **Out of reach without Node or network:** npm themes, addons and dependencies, `vite.config` and `setup/` files, Monaco, TwoSlash, remote embeds. Icons need bundled icon data (B2 F8).
- **Running the real toolchain in the browser is not realistic here.** It is 111 MB of npm tarballs and 494 MB on disk; a small deck builds with 774 MB of memory and the official template with about 2.6 GB (B2 F10). WebContainers need a commercial licence for for-profit production use, need response headers GitHub Pages cannot send, and are in practice Chromium-desktop only. One measurement of StackBlitz's Slidev starter took 52.5 s and 83.4 MB to reach the first slide, with packages fetched from StackBlitz's CDN (C2 F11).

### 5.4 Editing in the browser

- **Keep CodeMirror 6.** The site's bundle already contains the HTML, CSS and JavaScript parsers. JSON, YAML, Vue, linting and a merge view, plus the slide mapper and AI-answer importer below, add 61.5 KB minified (23.2 KB gzip). Monaco's smallest usable core is 2,833 KB (729 KB gzip) plus workers and does not support mobile browsers (B6 F2, F5).
- **Full reload is fast enough to be the refresh strategy.** Two agents measured rebuilding and reloading the frame with the slide position restored at 170–190 ms for 20–41 slide decks, about 220–235 ms for 200 slides, and 482 ms for 120 slides with 360 formulas. Loading the new frame hidden and swapping when ready removes the flash and keeps the last good render. An in-place slide swap takes about 10–30 ms but loses listeners added by deck scripts (B1 F10; B6 F4; swap timing re-measured).
- **Slide-aware editing is cheap.** A 5 KB mapper on the HTML parser the site already ships matched 41 of 41 slides of Reveal's demo deck and every slide of 7 further decks. Clicking an element on a slide resolved to its source range in 14 of 15 cases (B6 F3, F12).
- **AI revisions can be imported without calling any AI, but only behind review.** A 3.2 KB importer handles search/replace blocks, sloppy diffs and whole files, where a strict patch library fails. On 8 new messy cases it behaved well in 5; in one it accepted a file truncated with a bare `...` line and deleted a slide (B6 F9; verifier V2). The merge-view review and a one-step undo are required, not optional.
- **Browser storage is not durable by default.** Safari deletes script-writable storage after seven days of Safari use without user interaction on the site; home-screen web apps are exempt. A visible storage state and one-click ZIP export belong in the minimum design (B6 F17; C2 F10).
- **Real-folder editing is Chromium-only.** The File System Access API is opposed by Mozilla and Apple. Dropping a folder for import works everywhere (B6 F10).

### 5.5 Security of today's player

**The editor's data is well isolated.** About 75 hostile probes run inside the player failed to reach drafts, storage, the page DOM, top-level navigation, popups, dialogs, ordinary network requests, workers or `eval`. A verifier confirmed this with its own probe set (A1 F3).

**"No external connections" does not hold against a hostile deck.** Two channels leave the sandbox in Chromium 158, with no CSP violation (A1 F4, F5; confirmed by verifier V1, also from the exported HTML opened from `file://`):

- A script-inserted `<link rel="prerender">` causes a real HTTP GET to any URL. It carries data out in the URL only; the deck cannot read a response.
- WebRTC sends STUN packets to a server the deck names. Only sending was tested; with a cooperating server the channel may work in both directions.

What can leave: the deck's own content, whatever the viewer types or clicks inside the deck, and the viewer's IP address. Once decks are editable on the site, "its own content" includes the teacher's edits and speaker notes. What cannot: the editor's drafts and other saved decks. The small interactive-demo sandbox has the same two channels.

No tested in-page fix closes either channel. Freezing the `rel` setter is bypassed by `document.write`. Removing `RTCPeerConnection` is bypassed from a `srcdoc` child frame, which `frame-src 'none'` does not govern; this was shown on a test page carrying the player's exact policy (Appendix B). The accurate statement for users is: decks cannot read your documents, and ordinary network requests are blocked.

Other points:

- **A deck can speak in the editor's voice.** It can forge the player's "ready" and "error" messages, and forged error text appears verbatim in the editor's own notice bar (A1 F13, confirmed). Combined with the two channels, a deck could show "your session expired, sign in at …" in the editor's interface and send out what the user types into the deck. Deck-supplied text should be labelled, or shown only inside the deck's frame.
- **Runaway decks.** An infinite loop does not freeze the editor on desktop Chromium, which gives sandboxed frames their own process. It froze the tab in a single-process Chromium build. Chrome on Android is documented to share processes in most cases, so the same is expected there; that was not tested (A1 F10; C2 F1).
- **A service worker on the app's own origin cannot serve decks.** It cannot reach the opaque sandboxed frame, and a frame given the app's origin can read the editor's storage (A1 F9).

### 5.6 Served mode: a player on a second origin

In served mode a service worker on a separate "player origin" serves the unzipped files to the deck frame, so the deck sees ordinary URLs.

**Fidelity was excellent in the first, permissive prototype** (C1a):

- Mounting each deck at the root of the player origin, with the worker choosing the deck per browser client, played 9 of 9 Slidev builds unmodified, including the default build. A URL prefix per deck played only 2 of 9.
- The official 37 MB kitchen-sink template played all 16 slides, with Monaco and its Web Workers working offline. First open took 2.0–2.2 s.
- Reveal.js decks with external Markdown, ES modules, and the menu and chalkboard plugins played. `?print-pdf` works (B1 F5).
- An edit-and-reload round trip took 82–99 ms.

**That prototype was unsafe; a hardened design held for Reveal.js** (C1b):

- A hostile deck used the prototype's unsandboxed helper frame to show dialogs, open a popup, download a file and replace the editor page. Through shared Cache Storage it read, rewrote and persistently trojaned other decks.
- The hardened design uses one sandboxed frame, files held only in worker memory under unguessable path tokens, control messages only over a port handed over by the app, and one fixed, path-restricted policy sent by the worker on every response. All of those attacks failed, and 9 of 9 real Reveal.js packages still played. Slidev builds were not run under it.

**What remains in the hardened design:**

- A deck can unregister the worker and break other open decks until the app starts it again.
- The same two network channels stay open as in today's sandbox.
- Decks open at the same time share one origin and one process. One Slidev deck's presenter drove another deck's audience view through a shared BroadcastChannel (C1a F4), and clearing storage at start also wipes the state of decks open in other tabs. One deck at a time per player origin is the safe rule.
- Files held only in worker memory vanish when the browser restarts the worker. Re-supplying them from the app worked in a test, but only through the helper frame that the hardened design removes. This is untested in the hardened layout (C1a F3; C1b F17).

**Where the player origin lives decides its isolation** (measured in desktop Chromium; C1b F3–F4; C2 F1–F2):

| Player origin | Process | Storage | Pop-up speaker view |
| --- | --- | --- | --- |
| Subdomain of `qft.org` (same site) | Shares the editor's process: a looping deck froze the editor and Stop never ran | Unpartitioned; a top-level visit can run a deck unsandboxed | Works |
| Different site, e.g. a dedicated `<name>.github.io` | Own process: Stop handled in 64–78 ms | Partitioned per embedding site, and still works with third-party cookies blocked | Broken: the pop-up lands in another storage partition |

Pop-ups are also an unrestricted exfiltration channel, so the hardened design does not grant them. A presenter view has to be built by the app.

**Not yet reconciled.** The two prototype agents optimised for different things. Root mounting, which default Slidev builds need, conflicts with a path-restricted policy. A served mode that is both hardened and plays Slidev or Monaco decks is an open design problem. Stage 2's conversion avoids it for ordinary Slidev builds.

### 5.7 Hosting, storage, offline

- **GitHub Pages sends no custom headers.** `md.qft.org` returns `cache-control: max-age=600` and no CSP, COOP or COEP. Limits are 1 GB per site and a soft 100 GB per month. Service workers work, but a worker's scope cannot be widened beyond its folder, so a player that mounts decks at the root must sit at the root of its origin (C2 F3, F5; C1a F13).
- **The site cannot be opened offline.** It has no service worker and no web app manifest. Decks play without a network once the page is loaded, and the exported standalone file works from disk.
- **The site's CSP is a `<meta>` tag** with `script-src 'self'`. It blocks `eval` and WebAssembly on the page and in `blob:` workers. A Worker loaded from a same-origin URL is not bound by it, so esbuild-wasm can run there without loosening the page policy (A2 F14; B2 F5, re-tested).
- **Second-origin options** (C2 F4, F13; C1b R1): a subdomain of `qft.org`; a `github.io` site, either a project site of the existing account or, more safely, the root site of a dedicated organization; or a domain on Cloudflare, where wildcard subdomains could give every deck its own origin. `github.io` is on the Public Suffix List, so any `<name>.github.io` is a different site from `qft.org`. All project sites of one GitHub account share one origin, so that account or organization must hold nothing but the player. Hosting the player on GitHub Pages was not tried.
- **Storage.** Chromium allows an origin up to 60% of the disk; Firefox's best-effort limit is the smaller of 10% of the disk and 10 GiB. A 22 MB lesson stored in one draft record adds about 70 ms per autosave, so IndexedDB is adequate at today's limits (C2 F9; A2 F19).
- **Installable app.** Chrome no longer needs a service worker to install a web app. Registering as a handler for `.zip` and `.html` files works in Chrome and Edge on desktop only (C2 F14).
- **Changing host.** Drafts are bound to the origin `https://md.qft.org`. Moving to another host keeps them only if that origin stays the same (C2 F13).
- **Prior art.** CodePen, JSFiddle, LiveCodes, Phoenix Code, StackBlitz and vscode.dev all run user code on a separate origin, usually a separate site. No product was found that plays an uploaded Reveal.js or Slidev ZIP unmodified and lets the user edit it. Slidecko imports Slidev projects into a browser editor by re-implementing the rendering; it does not show custom Vue components (C2 F15).

## 6. A teacher's path

From "an AI gave me a file" to "I am presenting in class": what works today, and which stage changes it.

| Step | Today | Changes in |
| --- | --- | --- |
| Get a deck from an AI | Only with the site's long, format-specific prompts | Stage 1 (any natural Reveal.js output, short prompts); stage 2 (Slidev builds) |
| Open it on the site | Rejected or misread | Stage 1 |
| Find out what is wrong and ask the AI to fix it | "Check lesson" covers Markdown lessons only | Stage 1 (paste-back check report) |
| Edit it | Not possible for decks | Stage 3 (Reveal.js); stage 4 (Slidev, with a rebuild) |
| Take it to a room without internet | A standalone file can be exported for packages; the site itself needs a network to open | Stage 1 (export for every imported deck); app-shell service worker if the owner chooses it |
| Present | Keys need a click first; no notes view; the screen may sleep | Stage 0 (keys); stage 1 (the host holds the screen wake lock); stage 3 (presenter view in a second window) |
| Hand out a PDF | Works for Markdown slides only | Stage 3; needs a small sandbox change |
| Use an embedded video or web simulation | Blank by design | Not in single-file mode; a deck that needs it should say so in the check report |

None of this path was tried on an iPad or phone.

## 7. Architecture options

| Option | Decks it can play | Security | Needs from hosting | Verdict |
| --- | --- | --- | --- | --- |
| **Single-file mode**: link the deck into one HTML and run it in today's opaque sandbox | AI-style Reveal.js decks; more standard projects as the linker grows; converted Slidev builds | Unchanged: the strongest editor isolation of all options | Nothing | **Adopt first.** Works on forks and in the standalone file |
| **Blob files in the sandbox**: transfer the deck's files into the frame, create `blob:` URLs there, rewrite references | In a test: images, styles, classic and module scripts, `fetch`, `import()` and workers. Large media without base64 growth | Opaque origin kept; `blob:` added to five CSP directives and workers enabled | Nothing | **Compare in a design spike.** It may cover much of what served mode is for. Run-time relative URLs still need shims (A1 F9; B6 F11) |
| **Served mode**: a hardened service-worker player on a second origin on another site | In the permissive prototype, every tested deck unmodified. Under the hardened design, proven for 9 Reveal.js packages | Deck gets a real origin separate from the editor; decks share that origin; same two network channels | A dedicated second origin | **Optional.** Design spike first |
| Served mode on a `qft.org` subdomain | Same, plus pop-ups | Shares the editor's process | A subdomain | **Reject** on GitHub Pages |
| Service worker on the app's own origin, serving decks | Same as served mode | Decks could read drafts | Nothing | **Reject** |
| Real Node toolchain in the browser | Any Slidev source | Third-party runtime; packages fetched per project | Cross-origin isolation headers | **Reject for now** |

Single-file mode needs no hosting change and is the only option that also produces a portable classroom file. The other two remove compatibility limits at a cost: more moving parts, and for served mode a second origin and unknown behaviour in Firefox and Safari. A service worker that only caches the app's own files for offline use is a different thing and fits every option.

## 8. Recommended roadmap

Effort key: S up to 3 days, M 1–2 weeks, L 3–5 weeks.

### Stage 0 — Repair and de-risk

| # | Work item | Effort |
| --- | --- | --- |
| 0.1 | Fix the defects in section 9 | S each, most of them hours |
| 0.2 | Cross-browser spike: re-run the prototype scripts in Firefox and WebKit, and try the current player by hand on an iPad and an Android phone (open, Start, swipe, a looping deck, a 20 MB deck) | S |
| 0.3 | Collect 20–30 decks from ordinary teacher prompts in ChatGPT, Gemini, Copilot and Claude, and record how many the adapter prototype plays | S |
| 0.4 | Make the saved-package list tolerant of records it does not understand, before any new engine is stored | S |
| 0.5 | Accessibility pass on the current player: keyboard path into and out of the deck frame, announcements, focus order | S |

*If you stop here:* the shipped product does what it says, and you know whether the plan holds outside desktop Chromium.

### Stage 1 — Play AI-made Reveal.js decks

| # | Work item | Effort | Evidence |
| --- | --- | --- | --- |
| 1.1 | **Classify uploads.** Accept `.html`, ZIP, a dropped folder and pasted HTML. Detect Reveal.js (entry file, version, problems) and Slidev (source or build, version, base path). Replace the Slidev-specific messages | M | B1 F11; B2 F18 |
| 1.2 | **Linker.** In the browser: inline relative CSS, scripts and assets, including `data-src`, backgrounds, Markdown images and CSS `url()`/`@import`; inline external Markdown; map Reveal.js and KaTeX CDN URLs to a Reveal.js 6.0.2 distribution served by the site as lazy assets; math shim; convert inline event handlers. It never fetches from third parties | M | B7 F3; A2 F2; verifier V2 |
| 1.3 | **Tolerant runtime.** History shim; errors after start-up become a visible log instead of removing the frame; relay Reveal's messages through the runner so the host knows slide count and position; fullscreen and the screen wake lock handled by the host; stop altering the deck's document | M | B1 F6, F7; A1 F6, F17 |
| 1.4 | **Package model and migration.** Engines `reveal`, `slidev`, `html`; manifest optional; playability checked at import; de-duplicate by content hash. Design the schema together with stage 3's editable store, version the database, keep existing packages playable, and offer "download everything" before upgrading | M | A1 F15, F23 |
| 1.5 | **Check report and AI dialog.** Emit a compact `qft-deck-check/1` report for every import, including rejected ones, with a Copy-for-AI button. Add a Reveal.js choice; replace the long prompts with the drafted 191- and 197-word profiles | M | B7 F13, F14 |
| 1.6 | **Standalone file for every imported deck.** The export exists for packages today | S | — |
| 1.7 | **Tests.** A regression corpus of self-written or freely licensed decks; the browser test in full Chromium, Firefox and WebKit; the hostile probe battery as a standing test | M | A1 F24 |
| 1.8 | *Optional:* **libraries from other CDNs** (MathJax, Chart.js, Plotly, fonts). The app downloads the statically referenced files once, with consent, and keeps them with the deck | prototype, then estimate | C1b R6, F13; B7 F15 |

Notes on these items:

- Items 1.1–1.3 and 1.6 are the first usable slice.
- Everything a deck reports about itself, including its slide count, can be forged. The check detects honest failures only.
- Item 1.8 follows C1b R6 and was not prototyped. I verified that jsDelivr, unpkg, cdnjs and Google Fonts answer with `access-control-allow-origin: *`, so the app page can fetch from them under its current CSP. It should accept only a fixed list of CDN hosts and version-pinned URLs, show the list before downloading, and record hashes and licences. It cannot cover libraries that compute URLs at run time, which includes MathJax's fonts. It would be the first time the app itself contacts third parties, so the About text must say so.

*Done when:* the AI-style decks of section 5.2 and the stage 0.3 collection play offline in three browser engines; each remaining deck gets a message naming the blocking feature; pressing F or S does not stop a deck.

*If you stop here:* a teacher can play the Reveal.js deck an AI produced and take a standalone file to class. No editing.

### Stage 2 — Play Slidev builds and standard projects

| # | Work item | Effort | Evidence |
| --- | --- | --- | --- |
| 2.1 | **Bundler in a Worker, and Slidev build conversion.** esbuild-wasm in a same-origin Worker, loaded on demand; show progress for large decks; name the blocking feature (for example Monaco) when a build cannot be converted | M | B2 F2, F7; verifier V3 |
| 2.2 | **Reveal.js ES-module decks and the 3.x plugin loader** through the same bundler | M | verifier V2 |
| 2.3 | **A standard Slidev hand-off contract.** `routerMode: hash`, `fonts.provider: none`, a local favicon, `slidev build --base ./`, and build plus source in one ZIP; the short prompt | S | B7 F6 |
| 2.4 | **Agent skill** with a zero-dependency checker that shares one rule source with the web checker, discoverable from the site (`/.well-known/agent-skills/index.json`, `llms.txt`) | M | B7 F9, R5 |
| 2.5 | **Template repository** whose GitHub Action builds the ZIP, for users whose AI cannot build. It needs a GitHub account and was not prototyped | M | B7 R9 |
| 2.6 | **Retire the bespoke packer over time**; packages made with it keep playing. Correct the Node version statements | S | A1 F18; B7 F11 |
| 2.7 | **Slidev version matrix in CI** for the conversion | S | verifier V3 |

*If you stop here:* everything common plays: AI-made Reveal.js decks, standard Reveal.js projects without third-party plugins, and Slidev builds without Monaco. A Slidev source-only upload gets a clear message and a route to a build.

This stage does not depend on stage 3 and has the best verification record in this report, so it comes before editing.

### Stage 3 — Edit and replay (Reveal.js)

| # | Work item | Effort | Evidence |
| --- | --- | --- | --- |
| 3.1 | **Editable project store.** Keep the original ZIP immutable; store edited files as an overlay with a journal and named snapshots; export as ZIP. Decide first whether lessons, Reveal.js projects and Slidev packages share one model | M | B6 R3; A1 F12; A2 R9 |
| 3.2 | **Project workspace on its own route**, designed after an accessibility review. Slide list first, file tree behind a toggle, framework files collapsed and read-only, CodeMirror with the extra languages loaded lazily | L | B6 F2, F15, F16 |
| 3.3 | **Refresh.** Double-buffered full reload with slide and fragment restore; CSS swap and single-slide patch later | M | B6 F4; B1 F10 |
| 3.4 | **Slide-to-source sync.** Static mapper plus the message relay from 1.3; compare the map with the runtime after each reload | M | B6 F3, F8 |
| 3.5 | **Presenter view in a second window** synchronised by the app: notes, next slide, timer. The built-in speaker view cannot work in the sandbox, and a panel in the projected window would show the notes to the class | M | B1 F13 |
| 3.6 | **AI revision loop.** Copy-out context pack; paste-in importer behind merge review, hardened against truncated answers; ZIP revisions reviewed with the existing revision logic | M | B6 F9; A2 F18 |
| 3.7 | **Export.** Edited project ZIP; PDF through Reveal's print view, which needs `allow-modals` added to the sandbox | M | B1 F9 |
| 3.8 | **Storage honesty.** Request persistent storage, show where work lives, keep backup one click away | S | B6 F17 |

Design rule for this stage: everything arriving from the deck is untrusted. Show speaker notes as plain text or inside a second sandboxed frame, never as HTML in the app's document. Cap message size and rate. Mark deck-derived strings in the check report, because they travel into the user's AI chat.

Items 3.1–3.3 and 3.8 are the first usable slice: edit a file and see the deck update.

*If you stop here:* the full goal for Reveal.js.

### Stage 4 — Edit Slidev source

| # | Work item | Effort | Evidence |
| --- | --- | --- | --- |
| 4.1 | **Structured source editing with an explicit rebuild step.** Slide list, reorder, edit Markdown, notes and front matter with the upstream parser (36 KB gzip). The site says plainly that changes appear after a rebuild, exports the ZIP, and reviews the rebuilt package as a revision | M | B2 R4 |
| 4.2 | **Live preview (beta).** Generic client plus in-browser compiler, offered only when the classifier finds no blocker; pinned to one Slidev version; compared against real builds by pixels, not only DOM, for each release | L, then upkeep | B2 F3, F8, F19; verifier V3 |

Until 4.1 ships, Slidev source stays read-only, because editing it cannot change what plays (B6 R8).

### Stage 5 — Remaining decks (optional)

Start with a 1–2 week design spike that compares blob files in the sandbox with served mode on the stage 1.7 corpus. If served mode is chosen:

| # | Work item | Evidence |
| --- | --- | --- |
| 5.1 | A separate static site on the root of a dedicated GitHub organization, containing only a boot page and the worker | C1b R1 |
| 5.2 | The hardened design: one sandboxed frame with `allow-scripts allow-same-origin` only, unguessable path tokens, one fixed policy compiled into the worker, one deck at a time. How files survive a worker restart still has to be designed | C1b R2–R4; C1a F3, R4 |
| 5.3 | Harden the editor page: add the player origin to `frame-src`, make app pages refuse to run inside a frame, and accept messages only when source, origin and session token match | C1b R5 |
| 5.4 | A build-time setting for the player origin. When it is empty, or service workers are unavailable in the frame, fall back to single-file mode. A fork that wants served mode sets up its own organization and player | C2 R4 |

### Work that runs through every stage

- **Licences and notices.** The site would bundle and re-export more third-party code: Reveal.js themes and plugins (the highlight plugin contains highlight.js), esbuild-wasm, a Slidev client with Vue, UnoCSS and Shiki, and libraries downloaded for a deck. Each item that adds one updates `THIRD_PARTY_NOTICES.md` and embeds the notices in exported files, as the current export does.
- **Accessibility.** State a target standard, and review the workspace and presenter view against it before building them.
- **Recurring work:**

| Recurring work | Comes with | When |
| --- | --- | --- |
| Keep the Reveal.js CDN path table and the served distribution current | Stage 1 | Each Reveal.js major |
| Re-test the Slidev build conversion | Stage 2 | Each Slidev release |
| Keep the web checker and the skill's checker on one rule source | Stage 2 | Each rule change |
| Maintain the template repository's build action | Stage 2 | When Slidev or Node move |
| Rebuild and pixel-compare the Slidev preview client and compiler | Stage 4.2 | Each Slidev release |
| Test two playback paths | Stage 5 | Every release |

### Not recommended

- Letting a running deck load from an allow-list of CDNs. Honest decks would then fail in a room without internet, the CDN would learn of every play, and the code could change after the deck was checked. A deck can also request arbitrary paths on an allowed host (C1b F13–F14).
- Converting standard decks into the `qft.json` lesson format: fragments, notes, backgrounds, layout and page-level JavaScript are lost by construction (A2 F23).
- Monaco as the editor (B6 F5).
- An MCP or WebMCP surface now: shell agents gain nothing over a skill and a checker, and WebMCP is an origin trial (B7 F20; B6 F13).
- Bring-your-own API key or an in-browser model: they contradict the no-accounts principle or need multi-gigabyte downloads (B6 F19, F22).

## 9. Defects found in the current site

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
| One saved record the code does not recognise makes the whole library list fail | A1 F23 | Code reading by two agents |
| A failure during fullscreen is invisible: the notice is outside the fullscreen element | A1 F20 | No |
| Unplayable packages are saved and fail only at Start | A1 F15 | No |
| The same package can be saved repeatedly; the example adds 1.6 MB per click | A1 F23 | Seen by two agents |
| The AI prompt's placeholder `projectId` is itself valid, so unrelated lessons collide as revisions | A2 F12 | No |
| "Check lesson" passes decks written in Reveal.js or Slidev syntax | A2 F6 | No |
| The browser test runs the headless shell and clicks before pressing keys, so it cannot see the focus defect | A1 F24 | No |

## 10. Open questions and risks

- **Other browsers and devices.** Safari, phones, tablets and touch input were not tested. The History behaviour of `blob:` documents, the focus hand-off, Worker CSP rules, the two network channels and, for served mode, partitioned service workers all need checking; stage 0.2 exists for this.
- **Deck sample.** The adapter's pass rates rest on a dozen decks from one AI vendor and from the agents. Stage 0.3 exists for this.
- **Version coercion.** Six of the seven CDN-linked 4.x and 5.x decks tried played on Reveal.js 6.0.2; the seventh failed for an unrelated reason, a chart plugin. About 87% of jsDelivr's Reveal.js traffic is 4.x or 5.x, so this needs a larger sample. The fallback is to serve one build per major, about 4.7 MB gzip in total (B1 F15).
- **MathJax.** Rendering MathJax decks with KaTeX is untested; for a physics site this is a central case.
- **How models behave.** Whether ChatGPT, Gemini or Copilot follow the short prompts, or a requested patch format, is unmeasured.
- **Slidev drift.** The build conversion survived one older version, but it and the in-browser compiler depend on minified output and internal module names.
- **Download growth.** Lazy assets by stage: the Reveal.js distribution (about 3.7 MB uncompressed) in stage 1; esbuild-wasm (3.6 MB gzip) in stage 2; a generic Slidev client (2.5 MB) and compiler (708 KB gzip) in stage 4.2.
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

Verdicts by the three verifiers, who re-ran most experiments from a copy and added new inputs.

| Claim | Verdict |
| --- | --- |
| A script-inserted prerender link sends an HTTP GET from inside the player | Confirmed, also from the `file://` export and with background-networking flags removed |
| WebRTC sends STUN packets from inside the player | Confirmed |
| Removing `RTCPeerConnection` closes that channel | Verifier: yes. My test on a page carrying the player's policy: no, a `srcdoc` child frame restores it |
| Apart from those two channels, a hostile package cannot reach the editor or the network | Confirmed with an independent probe set, run in the deck's main document |
| Arrow keys do not reach the deck after Start; three-line repair works | Confirmed on the shipped example |
| `hash: true` kills a Reveal.js deck at start; a History shim fixes it; F and S kill a running deck | Confirmed; S only when the notes plugin is loaded |
| A package can forge "ready" and "error" messages | Confirmed |
| Site URL query breaks the slide preview; Save PDF refused for the site's example | Confirmed |
| Service worker cannot serve the opaque sandbox; blob URL behaviour; infinite-loop behaviour | Not re-run by V1. The service-worker part was reproduced by V2; the rest in part by B6, C1b and C2 |
| The adapter plays 3 of 3 real decks and 5 of 5 ZIP shapes | Confirmed with caveats: the ZIP shapes are trivial and a fourth real deck fails; on unseen decks 4 of 8 (section 5.2) |
| Five rewrites make a full-featured Reveal.js project play | Confirmed with caveats: S and F do nothing and the math plugin is fatal. On unseen decks this simpler wrapper played 1 of 8: it has no CDN mapping and fails on the same standard-project decks |
| The 2.2 KB shim survives F and S on 4.x–6.x | Confirmed with caveats, on the original agent's synthetic decks; the keys then do nothing |
| Single-file linking cannot run menu, copycode, chalkboard; served mode plays all 13 decks | Partly refuted: those three plugins do fail when linked, but the AI-made corpus deck plays. Served mode played all 13 under a much weaker sandbox than today's |
| Reveal `postMessage` API works across the sandbox | Confirmed |
| Reload about 170–250 ms; in-place swap 20–30 ms | Swap confirmed (7–25 ms); the verifier's reload probe failed, so reload rests on two agents' measurements |
| Slide mapper 41/41 and 12/12 | Confirmed, plus 6 new decks; the test compares headings only |
| Detector 36/36 | Confirmed on 14 new inputs; the original 36 were not re-run |
| Reveal.js 6 layout change and CDN behaviour | Confirmed |
| AI-answer importer handles its 13 cases | Confirmed; 5 of 8 new cases, one with data loss |
| Slidev build conversion works for 7 variants and in a Worker under the site CSP | Confirmed with caveats: 6 of 7 replayed on the production site; three new builds including Slidev 52.11.5 also worked; timing holds for small decks only |
| In-browser Slidev compiler output is identical to the real build | DOM yes (7/7 on a new deck); pixels 4/7 |
| An unmodified Slidev build is blank from `file://`, `blob:`, the sandbox and a sub-path | Confirmed |
| A same-origin Worker is not bound by the page's meta CSP | Confirmed |
| Memory router exists since Slidev 52.17.0 | Confirmed |
| Three settings give a build with 0 external requests | Refuted: the default favicon is still requested |
| Build size and cost figures; template is 314 files and 37 MB | Confirmed with caveats: the template was checked statically, and install cost was measured on 52.11.5 |
| A built Slidev client exposes its router through the Vue app | Confirmed |
| Slidev upload classifier 17/17 | Kinds confirmed; router mode wrong for a 52.11.5 build |
