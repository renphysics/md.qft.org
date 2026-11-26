# C1a - Playback fidelity of a service-worker "player origin" (Slidev builds, Reveal spot check, edit loop, restarts)

Date 2026-11-26. Chromium 158 **full build** (`chromium.launch({ channel: 'chromium' })`), Playwright, Linux, 4 CPUs.
`$C` = `../prototypes/C1a`.
Labels: [E] verified-empirically, [P] primary source, [I] inferred, [U] uncertain.

## 0. Setup

- App page (editor origin) `http://127.0.0.1:4600/app.html` = `$C/www/app.html`: unzips with fflate (sync, main thread), keeps its own copy of
  the files (`window.__files`), talks to the player through a hidden frame `http://127.0.0.1:4602/__host.html`.
- Player origin `http://127.0.0.1:4602` = `$C/player/`: `__host.html` (registers `/sw.js`, scope `/`, relays messages) and `sw.js`.
  Only two static files exist on the player origin; everything else comes from the worker.
- Deck frame: `sandbox="allow-scripts allow-same-origin allow-popups allow-modals allow-popups-to-escape-sandbox allow-forms"`,
  `allow="fullscreen; screen-wake-lock; clipboard-write"` (same as B1 plus forms).
- Worker CSP when network is blocked: `default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:; connect-src 'self' data: blob:; form-action 'none'; base-uri 'self'`
  plus a Playwright route that aborts anything not on 127.0.0.1/localhost:46xx. "allow" mode: no CSP, no route block.
- **Both origins are same-site** (127.0.0.1, ports differ). See section 7 for cross-site, where Chrome partitions storage.
- Copies of B1's prototype: `$C/b1-copy/`. ZIPs: `$C/www/zips/` (made by `$C/scripts/make-zips.mjs` from the B2 builds, unchanged bytes).
- Test scripts: `$C/scripts/{q1-matrix,q2q3-routes,q1c-starter,q4q5q6,q5-reveal,extra-checks,cross-site,cross-site-reveal}.mjs`, helpers `lib.mjs`.
  Outputs in `$C/out/` (`q1-matrix.json`, `q2q3-run1.json` (deep links, reload), `q2q3-cd.json` (two decks, presenter), `q1c-block.json`, `q1c-allow.json`,
  `q4q5q6.json` (Q4, Q6, coupling; its Q5-Reveal part is invalid, superseded by `q5-reveal.json`), `q5-reveal.json`, `extra-checks.txt`,
  `cross-site.txt`, `cross-site-partitioned.txt`, `cross-site-reveal.txt`).
- Interaction test for the 5-slide Slidev deck (`slidevInteract` in lib.mjs): first slide h1 rendered -> click into frame -> ArrowRight to slide 2
  (KaTeX present, 2 `.slidev-vclick-hidden`) -> ArrowRight (1 hidden = v-click animation advanced) -> 2x ArrowRight to slide 3 ->
  click Vue button "Opposite · 180°" -> intensity text must be `0.00`. "PASS" = all of those.

## 1. Worker design that was tested (`$C/player/sw.js`, 150 lines)

- Mounts: (i) `/d/<id>/...` prefix; (iii) `/r/<id>/...` prefix + on-the-fly rewrite; (ii) **root mount**: the deck is served at its own build
  base on the player root (base detected from the entry `<script type=module src="/<base>assets/...">` of index.html; `/` or `./` -> `/`,
  `/sub/deck/` -> `/sub/deck/`). Deck selection per request, in order:
  navigation: `?__deck=<id>` in the URL -> token in `Referer` -> same-origin referrer client -> `FetchEvent.clientId` (initiator) ;
  then map `resultingClientId -> id`. Subresources: `clientId` map -> token in `clients.get(clientId).url`; and `resultingClientId -> id`
  for dedicated-worker scripts (so requests made *inside* Monaco's workers resolve).
- SPA fallback: a navigation for a missing path gets the deck's `index.html` (what `404.html` does on Pages).
- Stores: `memory` (Map in worker global), `cache` (Cache Storage `vfs-<id>`), `ondemand` (worker -> host page -> app page over a transferred
  `MessagePort`; the app answers with the bytes). Deck metadata and the client map are persisted in Cache Storage `vfs-meta` unless store=memory.
- Protocol (app -> host -> SW, reply on a MessagePort): `{op:'put', id, store, net, files:[{path, bytes}]}` (ArrayBuffers transferred),
  `{op:'patch', id, files}`, `{op:'forget', id}`, `{op:'stats'}`; SW -> host -> app: `{op:'need', id, path}` + port, app replies `{bytes}`.
- Lifecycle: `skipWaiting()` + `clients.claim()`; the host page waits for `navigator.serviceWorker.ready` before announcing itself, so the first
  deck frame is already controlled.

## 2. Q1 - Slidev builds served unmodified

### Q1a/b - 9 builds x 3 mount strategies [E] (`out/q1-matrix.json`)

| build (router, base) | (i) prefix `/d/<id>/` | (ii) root mount at own base | (iii) rewrite `/r/<id>/` |
|---|---|---|---|
| ordinary (history, `/`) - shared/slidev-ordinary/dist | FAIL `404 /assets/index-BwoNhELd.js` | **PASS**, URL `/1?__deck=<id>` -> `/3?__deck=<id>` | FAIL app boots, "404 Page /1 not found" |
| ordinary dist-relative (history, `./`) | FAIL Slidev page "404 Page /d/<id>/ not found" | **PASS** | n/a |
| history-abs | FAIL 404 assets | **PASS** | FAIL "404 Page /1 not found" |
| history-rel | FAIL router 404 page | **PASS** | n/a |
| hash-abs | FAIL 404 assets | **PASS** `/?__deck=<id>#/1` | FAIL (hash became `#/r/<id>/`) |
| hash-rel | PASS `/d/<id>/#/3` | **PASS** | n/a |
| memory-abs | FAIL 404 assets | **PASS** | FAIL "404 Page /1 not found" |
| memory-rel | PASS | **PASS** | n/a |
| history-sub (history, `/sub/deck/`) | FAIL `404 /sub/deck/assets/...` | **PASS** at `/sub/deck/1?__deck=<id>` | n/a |

Totals: root mount 9/9, prefix 2/9 (only hash/memory + `./`), rewrite 0/4.
First slide visible 106-126 ms after the frame `load` event; unzip 1.24 MB ZIP ~20-40 ms. Only console errors in every PASS run: CSP refusals of
Google Fonts and the jsDelivr favicon (non-fatal here). The rewrite (3 regexes: `"/assets/`, `history:X(`/`)`, Vite preload helper `` `/`+e ``)
loads every chunk but routing breaks; Slidev derives routes from the base in more places than these literals [E for the failure, I for the cause].

Slidev keeps unknown query parameters across its own navigations (`/1?__deck=X` -> `/2?__deck=X&clicks=1` -> `/3?__deck=X`), so the token
survives in-deck navigation and frame reload [E].

### Q1c - official kitchen-sink template build (314 files, 37.35 MB, 9.45 MB ZIP), root mount [E] (`out/q1c-{block,allow}.json`)

| | network blocked (CSP + route abort) | network allowed |
|---|---|---|
| slides rendering (deep link `/N?__deck=`) | 16/16 (h1 present on each) | 16/16 |
| Monaco (slide 15) | 2 editors; typing `const x: number = "s"` -> 1 `.squiggly-error` after 3.5 s (TS worker diagnostics work) | same |
| Web Workers | `ts.worker-DvEKW8Yk.js` (every slide), `editor.worker-CRz__AKW.js`; all served by the SW, 0 misses | same |
| remote images (cover.sli.dev, sli.dev logos, github screenshots) | blocked: 0 loaded (slides 3, 8, 10, 13 lose images; slide-1 cover bg missing) | all load (3:1/1, 8:2/2, 10:3/3, 13:1/1, 16:1/1) |
| Tweet (slide 7) / Bluesky embed | scripts refused by CSP, nothing shown | Tweet iframe present (platform.twitter.com, syndication.twitter.com fetches) |
| PlantUML (slide 12, remote renderer) | image refused | loaded |
| Mermaid (slide 12) | 3 `.mermaid` elements, 0 SVG after 6 s | same [U: B2's direct-HTTP walk also shows svg=0 on slide 12, so not caused by the worker] |
| Google Fonts (PT Serif/Mono) | refused (fallback fonts) | loaded |
| fatal errors / page errors | none | none |

## 3. Q2 - mount strategy, deep links, reload, two decks [E] (`out/q2q3-run1.json`, `out/q2q3-cd.json`)

Root mount, ordinary default build (base `/`, history router):

| case | result |
|---|---|
| `/2?__deck=` | slide 2 "Amplitudes add" |
| `/5?__deck=` | "Thanks" |
| `/3?clicks=1&__deck=` | slide 3 (URL normalised to `/3?__deck=`) |
| `/presenter/1`, `/presenter/2` | presenter UI ("Current Slides Screen Mirror", current + next slide) |
| `/overview` | 5 slide thumbnails |
| `/notes` | notes view ("No notes for Slide 1.") |
| `/entry` | entry chooser (Slides / Presenter / Notes / Overview) |
| `/print`, `/1?print`, `/?print` (extra-checks.txt) | `?print` -> all 5 pages rendered; `/print` route -> 2 pages (not a print route in a build) |
| frame `location.reload()` at `/3?__deck=` | back on slide 3 |
| deck removes token (`history.replaceState('/3')`), then reload | still slide 3: navigation resolved by `FetchEvent.clientId` of the initiating (old) document (`nav-clientId`) |
| two different decks at once, both on `/` (A = ordinary history, B = hash-abs) | both render; A navigated to `/3`, B stayed on `#/1`; full interaction on B PASS (`#/3`) |
| prefix mount `/d/<id>/` for the same builds | only hash/memory with `./` (table above) |

Strategy verdict: **(ii) root mount at the build's own base with per-client deck resolution** is the only one that plays default builds
without touching any deck file. (i) needs relative + hash/memory builds; (iii) is fragile and failed.

Coupling between decks on one player origin [E]: Slidev's channel name is `"<title> - Slidev - shared"` and its ~21 `slidev-*` localStorage keys
are per origin. Deck B (a *different* deck with the same title) opened as presenter drove deck A's audience view: after 5 ArrowRight in B's
presenter, A moved from `/1` to `/4?__deck=DA&clicks=0` (`out/q4q5q6.json` `coupling`). Two plain viewers did not couple. B also saw A's 21
`slidev-*` keys.

## 4. Q3 - presenter + audience [E]

- Two frames on the player origin (`/1?__deck=` audience, `/presenter/1?__deck=` presenter): 2 ArrowRight in the presenter -> audience at
  `/2?clicks=1` (hidden v-clicks 1); 5 -> audience `/4?clicks=0`. BroadcastChannel sync works when both are served by the worker.
- Presenter in a popup opened like Slidev's own link (`<a target=_blank href="/presenter/3">`, no token): resolved by the Referer token
  (`referrer-token`), presenter UI rendered, and the audience frame followed it (`/3?clicks=0`).
- This holds only when app and player are the same site (section 7).

## 5. Q4 - Reveal spot check after the changes [E] (`out/q4q5q6.json` q4)

| deck | prefix | root | notes |
|---|---|---|---|
| extmd6 (external Markdown) | ready, 4 slides, hljs, Right -> h=1 | same | |
| esm6 (ES modules) | ready, 9 slides | same | ArrowRight walks 2 fragments then h=1 (debug run) |
| plugins6/menu.html (third-party menu) | ready, menu button | same | |
| plugins6/chalkboard.html | ready, chalkboard UI | same | |

0 errors, 0 bad responses. Speaker view popup: same-site PASS (both preview iframes `ready=true`; `out/cross-site-reveal.txt`).

## 6. Q5 - edit loop and first-open cost [E]

Reveal classic6: app replaces `index.html` in the worker store (`patch`, title "Code" -> "Code vN"), then sets the frame to
`...index.html?v=N#/3`; timer stops when Reveal is ready on h=3 and the new title is in the present slide (Playwright polling every ~5 ms,
so an upper bound). 9 runs each, all correct (`out/q5-reveal.json`):

| mount / store | median round trip | median frame load | median patch (app -> SW ack) |
|---|---|---|---|
| prefix / cache | 99 ms | 88 ms | 8 ms |
| prefix / memory | 94 ms | 88 ms | 4 ms |
| root / cache | 96 ms | 87 ms | 9 ms |
| root / memory | 82 ms | 76 ms | 4 ms |

Slidev ordinary build: reload of the frame to `/3` until the slide is visible: median 176 ms (148-204). A Slidev *source* edit needs a
recompile first (B2's in-browser compiler, 66-71 ms for slides.md) - not combined here.

First open of the 37 MB build (2 runs): fetch ZIP 58-62 ms, unzip 356-408 ms (sync fflate on the main thread), store 693-825 ms
(of which SW `cache.put` x314 = 293-360 ms; the rest is the two-hop postMessage with transfer plus the app copying its own copy), first slide
840-931 ms after store; **2.0-2.2 s click to first slide**. RSS of all browser processes (CDP SystemInfo pids + /proc VmRSS): 643 MB app only
-> 834 MB after store (+191) -> 1101-1228 MB after first render -> 2047 MB (blocked) / 2875 MB (allowed) after 16 deep-link reloads incl. Monaco.

## 7. Same-site vs cross-site player origin [E] - important for hosting

Playwright disables `ThirdPartyStoragePartitioning` by default (`playwright-core/lib/coreBundle.js`, chromiumSwitches.ts, "See
https://github.com/microsoft/playwright/issues/32230"). Chrome enables it for all users since 115 [P https://privacysandbox.google.com/cookies/storage-partitioning].
`launchPartitioned()` in lib.mjs relaunches with the feature re-enabled. App `http://localhost:4600` + player `http://127.0.0.1:4602` = cross-site:

| | partitioning off (Playwright default) | partitioning on (real Chrome) |
|---|---|---|
| deck in iframe (render + all interactions) | PASS | PASS (partitioned SW, caches visible in frame) |
| two frames presenter -> audience | PASS | PASS |
| Slidev presenter popup | PASS | **FAIL**: popup is top-level = first-party partition: not controlled, `404 /presenter/1?__deck=XS` from the static server |
| Reveal speaker view popup | (B1: PASS) | **FAIL**: popup opens, both preview iframes fail (`TypeError`, deck not served) |
| same-site pair, partitioning on | Reveal speaker view PASS | |

So the player origin must be **same-site** with the app (e.g. `player.qft.org` next to `md.qft.org`), or popups must bootstrap their own
worker + data. On GitHub Pages, project sites share `<user>.github.io`, so a second origin needs a second custom (sub)domain [I].
Firefox and Safari also partition third-party storage and service workers by top-level site [secondary, same Google page; not tested].
Earlier same-site tests (B1, this note sections 2-6) are unaffected by the Playwright flag, since partitioning only keys on the top-level site.

## 8. Q6 - worker terminated and restarted [E] (`out/q4q5q6.json` q6)

`ServiceWorker.enable` + `ServiceWorker.stopAllWorkers` (page CDP session), then: a fetch from the deck, keyboard navigation, frame reload,
and a new frame.

| store | restart confirmed (new boot time) | already-running deck | fetch after restart | frame reload | new frame |
|---|---|---|---|---|---|
| memory | yes | keeps navigating (chunks already loaded) | `404` | FAIL "Unknown deck" | FAIL "Unknown deck" |
| cache (+ meta + client map in Cache Storage) | yes | ok | 200 (`clientId` resolver, map restored) | ok `/3?__deck=` | ok |
| ondemand (meta in Cache Storage, bytes from the app) | yes | ok | 200 | ok | ok; app answered 92 `need` requests |

Not tested: browser-initiated idle termination (30 s idle in Chromium) - simulated with CDP only; storage eviction; shift-reload of the frame
(bypasses the worker -> the static server's 404).

## 9. Recommendation (for this tier)

- **Mount**: root mount at the deck's own detected base; deck chosen by `?__deck=<token>` on the first navigation; resolution chain
  token -> clientId/resultingClientId map (persisted) -> Referer token -> initiator clientId -> client URL; SPA fallback to index.html for
  navigations. Keep prefix mount `/d/<id>/` only as a fallback for relative builds if ever needed.
- **Store**: Cache Storage as primary (survives restarts), with the app as the source of truth answering `need` over a MessagePort when a
  file is missing (eviction, first run after the user cleared site data). Persist deck metadata (base, net policy) and the client map; never
  rely on worker globals. An in-memory LRU in front of the cache is optional (saves 5-10 ms on edits).
- **Protocol**: put / patch / forget / stats from app to SW via the host frame (pin the app origin in the host; reply ports), need from SW to
  app. Edits = `patch` + frame navigation with a cache-busting query and the current route/hash: 80-100 ms for Reveal.
- **Lifecycle**: host page registers `/sw.js` (must sit at the player root: GitHub Pages cannot send `Service-Worker-Allowed`) with
  `skipWaiting` + `clients.claim`, waits for `ready` before the first deck frame.
- **One deck per player origin at a time**, or clear `slidev-*` localStorage between decks: Slidev's BroadcastChannel/localStorage are
  per origin, and a deck's presenter can drive another deck's audience view. Cross-deck isolation needs separate origins.
- **Same-site hosting** of the player (popups, speaker views).

## 10. Works here but not in the opaque sandbox (Tier 1)

Slidev default builds unmodified (history router, absolute base, code-split dynamic imports, localStorage, Wake Lock request not fatal);
any router/base variant including `/sub/deck/`; deep links `/N`, `/presenter/N`, `/overview`, `/notes`, `/entry`, `?print`; frame reload
keeping the slide; presenter + audience sync (frames and popup); Monaco editor with Web Workers and TS diagnostics; remote embeds/images
when the policy allows network; Reveal: external Markdown, ES modules, third-party plugins (menu, chalkboard, copycode), speaker view popup,
`?print-pdf` (B1). Network blocking is done by the worker's CSP, which is per response and does not cover the prerender/WebRTC leaks found in A1 [I].

## 11. Not verified

Firefox, Safari (no engines here); idle termination by the browser (only CDP stop); storage eviction; hard reload; deployment on real
GitHub Pages domains; security of the player origin (cross-deck storage reads, popups, self-navigation) beyond the coupling observed;
memory numbers include the app's duplicate copy of all files; Mermaid on the template (renders in neither mode, cause unknown).
