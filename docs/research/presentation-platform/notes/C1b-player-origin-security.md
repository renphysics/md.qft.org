# C1b - Security and isolation of a "player origin" (second origin + service worker)

Date: 2026-11-26. Reviewer role: try to break the B1 prototype. Labels: [E] verified empirically here, [P] primary source,
[S] secondary source, [I] inferred, [U] uncertain / not testable here.

## 0. Method and how to re-run

- Work dir `$C = <scratchpad>/research/proto/C1b/` (nothing written into the repo or other agents' directories).
- Browser: full Chromium 158.0.8127.36 (`channel: 'chromium'`, new headless), Playwright.
- **Method trap [E]:** Playwright starts Chromium with `--disable-features=...,ThirdPartyStoragePartitioning,...`
  (playwright-core `lib/coreBundle.js`, comment "See https://github.com/microsoft/playwright/issues/32230").
  With Playwright defaults a cross-site iframe's storage looks *unpartitioned* and Reveal's speaker view "works".
  `lib.cjs: realLaunch()` reads the default command line from `/proc/<pid>/cmdline`, removes that one feature from the
  disable list and relaunches. All results below marked "partitioned" use `realLaunch()` (= what shipping Chrome does
  since 115).
- Origins: app `:4620`; prototype player (unchanged copy of B1 `sandbox-origin/`) `:4621` (`player1/`); hardened player `:4622`
  (`player2/boot.html`, `player2/sw.js`); attacker HTTP `127.0.0.2:4630`, attacker UDP (STUN) `:4631`, raw TCP `:4632`.
  - same-site: app `http://127.0.0.1:4620` + player `http://127.0.0.1:462x`; also `md.qft.test` + `player.qft.test` (q8)
  - cross-site: app `http://localhost:4620` + player `http://127.0.0.1:462x`; also `md.qft.test` + `player.example-player.test`
    and `md.qft.test` + `qft-player.github.io` (q8, `--host-resolver-rules`, `--unsafely-treat-insecure-origin-as-secure`)
- Scripts (each starts and stops its own servers/browser), outputs in `$C/out/*.json`:

| Script | What | Command |
| --- | --- | --- |
| `q1q2.cjs` | SW registration/control, partitioning, process model, freeze, Reveal speaker view | `node q1q2.cjs same real`, `node q1q2.cjs cross real [--test-third-party-cookie-phaseout]` |
| `q3.cjs` | capabilities per sandbox token set, navigation/popup/download channels | `node q3.cjs cross`, `node q3.cjs same` |
| `q4.cjs` | header enforcement + 45-probe egress battery (`hostile/battery.js`) | `node q4.cjs cross`, `node q4.cjs same` |
| `q5.cjs` | shared-origin attacks: prototype (`v1`), hardened (`v2`), idle worker (`idle`) | `node q5.cjs v1`, `node q5.cjs v1 notop`, `node q5.cjs v2`, `node q5.cjs idle` |
| `q6.cjs` | worker mediation, allow-listed "CDN" host, unregister under policy, clipboard in opaque sandbox | `node q6.cjs` |
| `q7.cjs` | Origin-Agent-Cluster for a same-site player; child-realm bypass of worker mediation | `node q7.cjs` |
| `q8.cjs` | real host names: subdomain vs other registrable domain vs `*.github.io` | `node q8.cjs` |
| `q9.cjs` | 9 real Reveal packages under the hardened flow | `node q9.cjs` |

Not testable here: Firefox, Safari (documentation only); real GitHub Pages hosting; idle termination of the worker (see 5.4);
memory exhaustion; Android.

## 1. Q1 - same-site versus cross-site

### 1.1 Chromium 158 [E] (`q1q2-*.json`, `q8.json`)

| | same-site (two ports on 127.0.0.1; `md.qft.test` + `player.qft.test`) | cross-site (`localhost` -> `127.0.0.1`; `md.qft.test` -> `player.example-player.test` / `qft-player.github.io`) |
| --- | --- | --- |
| SW registration in the iframe | works (`boot.controlled=true`) | works; also with `--test-third-party-cookie-phaseout` (`hasStorageAccess=false`, Cache/localStorage/IDB/SW still usable) |
| Deck document controlled (`sandbox="allow-scripts allow-same-origin"`) | yes | yes |
| Storage partitioned by top-level site | **no**: a top-level visit to the player origin sees `caches=["vfs-<id>"]`, `localStorage deck-ls`, IDB `deck-db`; `fetch('/vfs/<id>/index.html')` -> 200; top-level navigation to the deck URL -> `200 deck` | **yes**: top-level visit sees `caches=[]`, `ls=null`, `idb=[]`, 0 registrations; deck URL top-level -> `404` |
| Reveal 6.0.2 speaker view (`S`, popup) | works: both preview iframes `ready=true` | **broken**: popup opens (top-level, first-party partition, no worker there); both iframes show `static 404 /vfs/<id>/index.html?receiver&...`; the request reaches the static host |

With Playwright's default (partitioning disabled) the cross-site column looks like the same-site column - B1's "speaker view works"
was measured same-site and would not hold cross-site.

### 1.2 Firefox (documentation only)

- Storage (localStorage, IndexedDB, Cache API, BroadcastChannel, SharedWorker, **Service Workers**) of third parties is partitioned by
  top-level site; "Dynamic Partitioning: enabled by default for all users since Firefox 103", private browsing since 90
  [P https://developer.mozilla.org/en-US/docs/Web/Privacy/Guides/State_Partitioning].
- Partitioned third-party service workers: registration allowed without storage access, partitioned by top-level site, stay
  partitioned even after storage access is granted; landed for Firefox 96 (pref `privacy.partition.serviceWorkers`)
  [P https://bugzilla.mozilla.org/show_bug.cgi?id=1731999, https://groups.google.com/a/mozilla.org/g/dev-platform/c/-ReVw4IGhaw].
  Current default of the pref not re-checked [U].
- Private browsing: service workers were unavailable until Firefox 140 ("Service Workers are now available in Private Browsing Mode")
  [P https://www.firefox.com/en-US/firefox/140.0/releasenotes/]. Older ESR/private windows: `navigator.serviceWorker` missing ->
  need the Tier-1 (opaque, inlined) fallback.
- Same-site subdomain: first-party storage, not partitioned [I from the same page: partition key is the top-level *site*].

### 1.3 Safari / WebKit (documentation only)

- "Third-party LocalStorage and IndexedDB are partitioned per first-party website and also made ephemeral."
  "Third-party Service Workers are partitioned and their cache and IndexedDB is partitioned too."
  [P https://webkit.org/tracking-prevention/]
- WebKit partitions service workers and clients "by the top level document origin"; Cache API "partitioned by (top origin, frame
  origin) and browsing session", 50 MiB per partition (2017 post) [P https://webkit.org/blog/8090/workers-at-your-service/].
  Whether a same-site *subdomain* frame counts as partitioned today (origin vs registrable domain) [U].
- 7-day cap: "ITP deletes ... all other script-writeable storage after 7 days of no user interaction with the website", including
  "Service Worker registrations and cache" [P same page]. A player origin that is only ever embedded never gets first-party
  interaction, so its registration can be purged: the boot page must (re)register on every start and the first start after a purge
  needs the network. A memory-only design loses nothing else.
- Private Browsing: ephemeral session per tab [P same page]. Whether a partitioned service worker registers in a third-party
  iframe in Private Browsing: not confirmed [U] -> feature-detect and fall back.

## 2. Q2 - process isolation [E]

| | opaque sandbox today (`sandbox="allow-scripts"`, same-origin URL) | player origin same-site | player origin cross-site |
| --- | --- | --- | --- |
| CDP targets | own `iframe` target (A1 exp6; here `iframe .../opaque.html`) | **no iframe target** - deck shares the app's renderer (`page` only; 2 renderers) | `iframe http://<player>/vfs/...` target; 3 renderers |
| App `requestAnimationFrame` during deck `for(;;){}` | 90 frames / 1.5 s, max gap 18-20 ms | **no answer in 4-5 s** (page.evaluate itself hangs) | 88-90 frames / 1.5 s, max gap 19-42 ms |
| Stop button | handled in 73-88 ms (A1: 43 ms) | **click times out (5 s); app frozen** | handled in 64-78 ms |

- Same result with real names: `player.qft.test` under `md.qft.test` -> frozen; `player.example-player.test` and
  `qft-player.github.io` -> separate process, Stop 78 / 65 ms (`q8.json`).
- `Origin-Agent-Cluster: ?1` on the worker's deck responses does not help: `window.originAgentCluster` is `true` with and without
  the header, still no iframe target, still frozen (`q7.json`).
- So a same-site subdomain is a **regression** against today's opaque sandbox on desktop Chromium (and puts hostile deck code in the
  editor's process - Spectre-class reads of drafts become a theoretical concern [I]).
- Elsewhere [P/I, from A1]: Android Chrome isolates only some sites (https://raw.githubusercontent.com/chromium/chromium/main/docs/process_model_and_site_isolation.md);
  Firefox desktop isolates cross-site frames (Fission) but not sandboxed same-site ones (bug 961689) -> a cross-site player origin
  should be *better* than today's opaque sandbox in Firefox [I]; Safari: no confirmed site isolation [U].

## 3. Q3 - what a hostile deck can reach [E] (`q3-cross.json`, `q3-same.json`)

App reachability, identical for same-site and cross-site and for every token set: `parent.document`, `top.location.href`,
`parent.localStorage` -> `SecurityError`; `frameElement` -> `null` (so the deck cannot edit its own `sandbox` attribute);
own `localStorage['app-secret']` -> `null`; `document.domain = ...` -> `SecurityError` ("Assignment is forbidden for sandboxed
iframes"); the app's draft and localStorage stayed intact. `parent.postMessage` arrives at the app (origin = player origin) - the app
must check `event.source === frame.contentWindow`, the origin and a session token.

| Capability | `allow-scripts allow-same-origin` (S0) | + `allow-popups` | + `allow-modals` | "everything" (popups, escape, modals, forms, downloads, pointer-lock, presentation, top-navigation-by-user-activation) |
| --- | --- | --- | --- | --- |
| `top.location = evil` / `<a target=_top>` | `SecurityError` / "Unsafe attempt to initiate navigation" | same | same | **top page replaced by the attacker page** (GET received) |
| `window.open(evil)` / `<a target=_blank>` (after a click) | `null` / "Blocked opening" | **popup opens, attacker receives GET** (popup inherits the sandbox; CSP does not apply to it) | same | same; with `allow-popups-to-escape-sandbox` the popup is unsandboxed |
| `alert` / `confirm` | ignored (0 ms) | ignored | **dialogs shown** ("alert: deck alert", "confirm: deck confirm") | shown |
| download (`<a download>` blob, after a click) | "Download is disallowed ... 'allow-downloads' is not set" | - | - | **file `from-deck.txt` downloaded** |
| form submit to attacker | "Blocked form submission ... sandboxed" | - | - | blocked by the app's `frame-src` (and by `form-action 'none'`) |
| `requestFullscreen` (after a click) | `TypeError: Disallowed by permissions policy` without `allow="fullscreen"` | **entered** with `allow="fullscreen"` | | entered |
| pointer lock | `SecurityError` | | | `locked=true` |
| `navigator.clipboard.writeText` | `NotAllowedError` (policy) | | | `written` with `allow="clipboard-write"` |
| `navigator.clipboard.readText` | `NotAllowedError` | | | `NotAllowedError` |
| `document.execCommand('copy')` after a click | **returns true; the app then reads `DECK-EXEC-COPY` from the clipboard** | same | same | same |
| geolocation / getUserMedia / USB / Notification | "disabled ... by permissions policy" / `NotFoundError` / `SecurityError` / `denied` | same | same | same |
| `navigator.storage.persist()` | `false` | | | |
| `history.pushState` x3 | joint history grows (`history.length=6`) | | | |
| own-frame navigation to the attacker (`location.href`, `<meta refresh>`) | **attacker receives GET** unless the *app page* has `frame-src <player>`; with it: "Framing ... violates ... frame-src", frame shows `chrome-error://` | | | |
| own-frame navigation to an *app* URL | without `frame-src` restriction the app page loads inside the deck frame **with the app's origin** (`origin=http://localhost:4620`, its code reads `APP-LOCALSTORAGE-SECRET`); console: "An iframe which has both allow-scripts and allow-same-origin ... can escape its sandboxing" | | | |

The clipboard write via `execCommand('copy')` also works from today's opaque sandbox (`q6.json` run O: `OPAQUE-EXEC-COPY`), so it is
not a regression.

Token-by-token verdict:

| Token | Needed for | Adds | Verdict |
| --- | --- | --- | --- |
| `allow-scripts` | everything | code execution | required |
| `allow-same-origin` | service-worker control (B1: without it 404 + `SecurityError`) | real origin: storage, Cache, SW API of the *player* origin | required; safe only because the origin differs from the app's **and** no unsandboxed player-origin document is reachable (see 5.1) |
| `allow-popups` | Reveal speaker view | attacker-chosen top-level navigations = unrestricted exfiltration after one click; windows that outlive Stop | **no**. In the cross-site configuration the speaker popup does not work anyway (1.1). Build presenter view in the app |
| `allow-popups-to-escape-sandbox` | nothing | unsandboxed popups | never (the prototype's default has it) |
| `allow-modals` | `window.print()` for `?print-pdf` | `alert/confirm/prompt` dialogs titled with the player origin, tab-blocking loops | only in an explicit, user-started "print" session |
| `allow-forms` | decks with `<form>` widgets | nothing measurable while `form-action 'none'` (worker) and `frame-src` (app) hold | optional, low risk |
| `allow-downloads` | e.g. chalkboard "download drawings" | pushes files to disk after a click | off by default, per-deck opt-in |
| `allow-pointer-lock` | 3D/games | cursor capture | off |
| `allow-presentation` | Presentation API (casting) | second-screen prompts | off (Reveal does not need it) |
| `allow-top-navigation*` | nothing | replaces the editor page | never |
| `allow="fullscreen"` | Reveal `F` key | fullscreen spoofing after a click | optional; safer: the app fullscreens its own stage |

## 4. Q4 - network egress under a worker-delivered policy [E] (`q4-cross.json`, `q4-same.json`, `q6.json`, `q7.json`)

### 4.1 Are headers on worker-synthesised responses enforced?

- CSP: yes (28 distinct `securitypolicyviolation` events in run B).
- `X-Content-Type-Options: nosniff`: yes (script served as `text/plain`: runs without the header, `error ran=false` with it).
- `Referrer-Policy: no-referrer`: yes (attacker saw `referer=http://127.0.0.1:4622/` without it, none with it).
- `Permissions-Policy: fullscreen=()`: yes (`allowsFeature('fullscreen')` false with the header, true without; frame had `allow="fullscreen"`).
- `Clear-Site-Data: "storage"`: **ignored on a worker-synthesised response** (localStorage, caches, registration unchanged); the
  same header on a real network response cleared all three. GitHub Pages cannot send it, so it is unavailable there.
- CSP `sandbox allow-scripts` (no `allow-same-origin`) in the worker's header: the document gets `origin=null`,
  `navigator.serviceWorker` throws `SecurityError`, sub-resources go to the static host (`/vfs/<token>/plain.txt`, `/sub.html` -> 404):
  **breaks worker control**. `sandbox allow-scripts allow-same-origin` keeps control (`controller=true`, `sub.html` 200).
- A worker script gets its policy from **its own** response: with the policy on HTML only (run C) `new Worker('w.js')` and
  `new SharedWorker(...)` fetched the attacker and `importScripts` loaded attacker code. The policy must be on every response.

### 4.2 Egress battery (control run without policy: 36 channels reached the attacker, which validates the harness)

Policy B (fixed, path-restricted, on all responses):
`default-src <dir> 'unsafe-inline' 'unsafe-eval' data: blob:; connect-src <dir> data: blob:; frame-src <dir> data: blob:;
worker-src <dir> blob:; object-src 'none'; base-uri <dir>; form-action 'none'` with `<dir> = <player>/vfs/<token>/`,
plus `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `Cross-Origin-Resource-Policy: same-origin`,
`Cache-Control: no-store`, `Permissions-Policy: geolocation=(), camera=(), microphone=(), display-capture=(), usb=(), ...`.

| Channel | Result under policy B (same-site and cross-site identical) |
| --- | --- |
| `fetch` (cors, no-cors, keepalive POST), XHR, `sendBeacon`, `fetchLater`, WebSocket, EventSource, WebTransport | blocked, `connect-src` |
| `<img>` (attached, detached, srcset), CSS `background:url()`, `<video poster>`, SVG `<image>`, `<link rel=icon>` | blocked, `img-src` (icon: violation reported; no request in the control either) |
| `<script src>`, `import()`, `<link rel=modulepreload>` | blocked, `script-src-elem` |
| `<link rel=stylesheet>`, `@import`, `FontFace` | blocked |
| `<audio>` | blocked, `media-src` |
| `<object>`, `<embed>` | blocked, `object-src` |
| nested `<iframe src=http>` | blocked, `frame-src` |
| `fetch` inside `srcdoc` / `blob:` / `data:` child frames, or through an `about:blank` child's realm | blocked (inherited policy) |
| `<a ping>` (`connect-src`), `<link rel=prefetch>` (`default-src`), `<link rel=preload as=fetch>` (`connect-src`) | blocked |
| `<link rel=manifest>`, speculation rules (prefetch + prerender list rules) | no request even in the no-policy control -> inconclusive [U] |
| `new Worker(file)` + `fetch` / `importScripts`, blob Worker, SharedWorker | blocked (policy on the worker script) |
| `navigator.serviceWorker.register('evil-sw.js')` (deck file) | rejected; the script fetch bypasses the worker and hits the static host: `/vfs/<token>/evil-sw.js [Service-Worker: script]` -> 404. Only the random token reaches the host |
| `navigator.serviceWorker.register(blobUrl)` | rejected ("URL protocol ... not supported") |
| form submit | blocked (sandbox; also `form-action`) |
| `window.open`, `<a target=_blank>` | blocked by the sandbox **only without `allow-popups`** (3) |
| own-frame navigation, `<meta refresh>` | **open unless the app page has `frame-src <player>`** (3) |
| top navigation | blocked by the sandbox |
| **`<link rel=prerender href=attacker>` inserted by script** | **OPEN**: attacker received `GET dest=document sec-purpose=prefetch`, no Referer |
| **WebRTC STUN** | **OPEN**: 3 binding requests on UDP 4631 |
| `<link rel=preconnect|dns-prefetch>` | no TCP connection seen even in the no-policy control with background networking enabled -> inconclusive [U] |

Comparison with A1 (opaque sandbox): the same two channels stay open (A1 W1 prerender, W2 STUN). No regression, no improvement.
What is new in the player-origin design: the frame can navigate itself (blocked only by the *app's* `frame-src`), and popups if the
token is granted.

### 4.3 Can the worker itself be the firewall?

Run M (no CSP at all; the worker answers every cross-origin request itself with 404): still reached the attacker: WebSocket,
`fetchLater`, `<object>`, `<embed>`, nested `<iframe src=http>`, `fetch` in `blob:`/`data:` child frames and through an
`about:blank` child realm, prerender, STUN. Those requests never pass the worker, so CSP remains necessary.

## 5. Q5 - shared-origin risks

### 5.1 The B1 prototype as written [E] (`q5-v1*.json`)

Hostile deck in `sandbox="allow-scripts allow-same-origin"` (stricter than the prototype's default):

1. **Reads other decks**: `caches.keys()` -> `["vfs-<victim>", "vfs-<own>"]`; victim files listed; content read
   (`VICTIM A-SECRET-SLIDES`) from the cache and with `fetch('/vfs/<victim>/index.html')` -> 200. The prototype never deletes
   caches: after one reload a deck saw 6 caches.
2. **Rewrites other decks**: `cache.put(<victim index.html>, ...)` -> the worker then serves `<title>POISONED</title>`.
3. **Escapes the sandbox through the unsandboxed bootstrap iframe** (`parent.frames[i]`, same origin): `boot.alert(...)` showed a
   dialog (own `alert` ignored, no `allow-modals`); `boot.open(attacker)` opened a popup (attacker received the GET);
   an `<a download>` created in the boot document downloaded `via-boot.txt`; `boot.eval('top.location=...')` **replaced the editor
   page with the attacker's page**. None of these tokens was granted.
4. **Trojans every later deck of the page session**: a listener planted with `boot.eval(...)` rewrote the `vfs-put` message:
   the next two decks loaded with `title="TROJANED Victim C/D"`, `window.__trojan` set, and their text was copied to
   `localStorage.loot` (later read back: `Victim D ... VICTIM D-SECRET-SLIDES`).
5. **Persistent state**: `localStorage.persist`, the loot and all caches survive reload; `register('/sw.js?planted=1',
   {scope:'/vfs/'})` succeeded and persisted (`/vfs/ <- /sw.js?planted=1` next to `/ <- /sw.js`); `unregister()` of the root
   registration returned true. The planted worker is still the genuine script (a query string is enough to make a second
   registration), so this is persistence of *state*, not of attacker code.

### 5.2 Hardened variant tested here (`player2/`, `app/app.html: openV2`)

- One frame only: the sandboxed frame first loads `boot.html` (wipes caches / IndexedDB / localStorage, unregisters unexpected
  registrations, registers `/sw.js`), receives the session from the app (`event.origin === APP && event.source === parent`), forwards
  it with a `MessagePort` to the worker, then the **same frame** is navigated to the deck. No sibling, no unsandboxed document.
- Worker: files only in memory, keyed by a 128-bit random path token; no listing; an existing token is never overwritten; control
  (put/close/ping) only on the port that came with the session; every response carries the policy; unknown paths -> 404, never the
  network (except `boot.html`, `sw.js`).
- 9/9 real Reveal packages play this way (6.0.2, 4.6, external Markdown, ES modules, menu, chalkboard, copycode, mermaid, AI deck
  with 36 KaTeX nodes): `ready=true`, 0 CSP violations, 0 failed requests, 0.5-2.5 s to load (`q9.json`).

Attacks repeated [E] (`q5-v2.json`, `q6.json` run U):

| Attack | Result |
| --- | --- |
| list / read storage | `caches=[]`, `idb=[]`, `localStorage=[]` |
| reach another player-origin window | `parent.frames.length=1` (only itself) |
| fetch another session (guessed token, or the victim's real token handed to the attacker) | `Failed to fetch` (path-restricted `connect-src`); with a leaked token a self-navigation would still work, so tokens must stay secret |
| fetch `/boot.html` | `Failed to fetch` |
| ask the worker for a listing | no such API |
| overwrite own / victim session | `refused` |
| register `/sw.js?planted=1` with scope `/vfs/` | `SecurityError` - blocked by path-restricted `worker-src` |
| `getRegistrations()` + `unregister()` | **succeeds** (CSP does not cover it). Own and victim's already-loaded documents keep working (`sub.html 200`), but the victim's **next navigation** falls through to the static host (`static 404 /vfs/<token>/sub.html`). The next `boot.html` re-registers and the next deck plays. Denial of service only |
| leave state | `evil-cache`, `evil-db`, `persist` were found and removed by the next boot (`cachesBefore/idbBefore/lsBefore`); the next deck saw none |
| create a second session from the deck | **accepted** (`ready`): any same-origin document can post to the worker. Harmless while the policy is compiled into the worker. In the test build, where the session message may carry headers, the deck created a policy-free session, navigated its frame to it and the attacker received `self-upgrade-fetch`; from there it registered `/sw.js?planted=1` on `/vfs/`, whose `clients.claim()` took over the victim tab (`sub.html 404`) |

Consequences:
- The policy must be a constant in the worker. A per-session "network allowed" flag sent by message can be forged by any deck.
- The worker cannot authenticate the app after a restart: every client it can talk to is on the shared origin.

### 5.3 Which mitigations work

| Mitigation | Verdict |
| --- | --- |
| Files only in worker memory, handed over per session through a `MessageChannel` | works against read/overwrite/poison [E]. Cost: lost when the worker stops (5.4) |
| Unguessable per-session path tokens | work as capability URLs, given no listing and path-restricted CSP [E] |
| Control messages only on the app's port | works for control (put/close) [E]; cannot stop decks from *creating* sessions, so nothing security-relevant may depend on session parameters |
| Bootstrap inside the same sandboxed frame, no sibling/unsandboxed player document, no popups | required; removes the sandbox escape and the trojan [E] |
| Clearing storage + checking registrations at every start | works for leftovers [E]; it also wipes state of decks open in other tabs |
| `Clear-Site-Data` | not available: ignored on worker responses [E], GitHub Pages sends no custom headers |
| One deck per origin (random sub-domains) | would give real isolation by the same-origin policy [I]; needs wildcard DNS + wildcard TLS + a host that serves any sub-domain. GitHub Pages serves one custom domain per site and "strongly recommend[s] that you do not use wildcard DNS records" [P https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site]. Sub-domains of one registrable domain are same-site with each other (same process). Each new origin needs a fresh worker install from the network. Not feasible on the current hosting |

### 5.4 Worker lifetime (memory-only cost)

- `ServiceWorker.stopAllWorkers` (CDP): deck `fetch('sub.html')` -> `404 no such session`; the app's port ping -> no pong in 1.5 s [E].
- Idle termination could not be measured: after 50 s without events the worker was still the same instance, with and without
  10 s pings - automation keeps workers alive [U]. Browsers stop idle workers (about 30 s in Chromium) [S].
- Design answer [I]: the app pings over the port every ~10-20 s while a deck is shown (events extend the lifetime); on a missed pong
  or a failed deck load it tears the frame down and bootstraps again (restore the slide through the URL hash). Safari may be more
  aggressive [U].

### 5.5 Residual shared-origin risk (hardened design)

- Decks open at the same time in different tabs share one worker: a hostile deck can stop the other (unregister, or exhaust
  quota/memory) but, per the tests, not read or change it.
- A hostile deck can keep junk in the player origin's storage until the next start.
- All decks share one renderer process (same origin) - no defence against Spectre-class reads between simultaneously open decks [I].
- If `allow-popups` were granted, a hostile window would outlive Stop and share the origin with the next deck.

## 6. Q6 - opt-in network mode

Measured with the attacker host standing in for an allow-listed CDN (`q6.json`, `q7.json`) [E]:
- Host in `script-src` / `style-src` / `font-src`, `connect-src` unchanged: `<script>`, `import()`, stylesheet link, `@import`,
  `FontFace`, `<link rel=prefetch>`, `<link rel=modulepreload>` and a worker's `importScripts` all reach that host with **arbitrary
  path and query** (`...?leak=DECKSECRET`). `fetch` stays blocked.
- Letting the worker answer those requests from files the *app* downloaded ("localised" copies) served `lib.js` from memory with no
  request to the host - but only for the deck document itself. A `<script src>` created inside an `about:blank` or `blob:` child
  frame is **not** routed through the worker and reached the host (`script-about-blank-child`, `script-blob-child`).
  So "allow-list + worker mediation" is not a boundary.

Who can read what leaks to a CDN:
- jsDelivr publishes per-file daily hit counts for any npm package/version:
  `https://data.jsdelivr.com/v1/stats/packages/npm/reveal.js@5.2.1/files?period=day` returned `/dist/reveal.js` 10,663 hits on
  2026-11-24 [E]. An attacker who publishes a package with N files can read back which files a deck requested: a slow
  (one day), low-bandwidth covert channel that needs no access to CDN logs. jsDelivr also serves any GitHub repository (`/gh/...`).
- unpkg / cdnjs: no public per-URL statistics known [U]; cdnjs hosts only curated libraries.
- Every allow-listed host learns the user's IP address and the time of each viewing.
- prerender and WebRTC stay open in any mode.

Tightest honest policy if the owner still wants it: `script-src`/`style-src`/`font-src` extended by the **exact URL prefixes** found
statically in the deck (for example `https://cdn.jsdelivr.net/npm/reveal.js@5.2.1/`), shown to the user before play;
`connect-src`, `img-src`, `frame-src` unchanged; `Referrer-Policy: no-referrer`. Because session parameters are forgeable (5.2) this
needs a **second player origin** whose worker has the wider policy built in. It must be labelled "this deck can contact the
internet" - it cannot be made leak-free.

Safer alternative [I, partly E]: keep the offline policy and let the *app* download the statically referenced CDN files once, with
the user's consent, and rewrite those URLs to package-local paths (the Tier-1 CDN-mapping idea, extended). Then only the static URL
list leaves the machine, chosen before any deck code runs; dynamically computed URLs fail closed.

## 7. Threat table

| Attack by a hostile deck | Opaque sandbox today (A1) | Player origin, same-site | Player origin, cross-site | Mitigation / status |
| --- | --- | --- | --- | --- |
| Read/modify editor DOM, drafts, storage | blocked | blocked [E] | blocked [E] | origin boundary |
| Remove own sandbox | n/a (`frameElement=null`) | blocked [E] | blocked [E] | origin differs from embedder |
| Sandbox escape via another player-origin document | n/a | **yes in prototype** (alert, popup, download, top navigation) | **yes in prototype** [E] | single sandboxed frame, no popups -> closed [E] |
| Freeze the editor (`for(;;){}`) | no on desktop Chromium (Stop 43-88 ms) | **yes, Stop dead** [E] | no (Stop 64-78 ms) [E] | cross-site origin; Android/Safari unknown |
| Spectre-class read of editor memory | separate process (desktop Chromium) | same process [E] | separate process [E] | cross-site origin |
| Top navigation | blocked | blocked without top-navigation tokens [E] | same | never grant |
| Popups | blocked | open + exfil if `allow-popups` [E] | same | do not grant |
| Own-frame navigation to attacker | blocked by runner `frame-src blob:` | **open** unless app `frame-src <player>` [E] | same | add to the editor CSP |
| Own-frame navigation to an app URL | blocked | app page runs in the deck's frame with app origin [E] | same | `frame-src` without `'self'` where possible + app pages refuse to run framed |
| Downloads, modal dialogs, pointer lock | blocked | blocked without tokens [E] | same | per-feature opt-in |
| Fullscreen | blocked (`fullscreen 'none'`) | only with `allow="fullscreen"` [E] | same | app-level fullscreen |
| Clipboard write after a click (`execCommand`) | **possible** [E] | possible [E] | possible [E] | none; disclose |
| Clipboard read, camera, mic, geolocation, USB, notifications | blocked | blocked [E] | blocked [E] | Permissions-Policy + cross-origin defaults |
| History pollution | yes (A1 W8) | yes [E] | yes [E] | none |
| fetch/XHR/beacon/WebSocket/EventSource/img/script/style/font/media/frames/workers | blocked | blocked by policy B [E] | blocked [E] | policy on **every** response |
| `<link rel=prerender>` GET | **open** (A1 W1) | **open** [E] | **open** [E] | none known |
| WebRTC STUN | **open** (A1 W2) | **open** [E] | **open** [E] | none known |
| Forged messages to the app | token readable by the deck (A1 W3/W5) | same class [E] | same | check source + origin; treat as untrusted text |
| Read other decks | impossible (no storage) | **yes in prototype**; no in hardened [E] | same | memory-only + tokens |
| Poison later decks / persistent code | impossible | **yes in prototype** (page session); no in hardened [E] | same | single frame, wipe at boot |
| Stop other tabs' decks | no | yes (unregister) [E] | yes [E] | detect + re-bootstrap; accept |
| Top-level visit runs a deck unsandboxed | n/a | yes if URL known (200) [E] | no (other partition, 404) [E] | cross-site origin |
| Reveal speaker view | not available | works [E] | broken (partitioning) [E] | presenter view built by the app |

## 8. Recommended configuration

1. **Where**: a host that is cross-site to `md.qft.org` - not `player.qft.org`. Cheapest: the root user site of a dedicated GitHub
   account/organisation, `https://<name>.github.io/` (`github.io` is in the Public Suffix List, line "github.io" of
   https://publicsuffix.org/list/public_suffix_list.dat [E], so it is a different site; `qft-player.github.io` stand-in tested in q8).
   Nothing else may be published from that account: every project site of an account shares the origin `<name>.github.io`.
   Check that the account has no custom domain that would redirect it. A host with real response headers (for example Cloudflare
   Pages, `pages.dev` also in the PSL) would additionally allow a CSP on `boot.html` and `Clear-Site-Data`, at the price of a second
   provider [I].
2. **Static files there**: only `boot.html` and `sw.js`.
3. **Frame**: `sandbox="allow-scripts allow-same-origin"` (optionally `allow-forms`), `referrerpolicy="no-referrer"`,
   `allow="fullscreen"` only if wanted. No `allow-popups*`, no `allow-top-navigation*`, no `allow-downloads`, no `allow-modals`
   (print mode excepted), no `allow-pointer-lock`, no `allow-presentation`.
4. **Editor page**: add the player origin to `frame-src`; make app pages refuse to initialise when framed (the runner excepted);
   accept deck messages only when `event.source` is the frame, the origin is the player and the session token matches;
   keep-alive ping + re-bootstrap; Stop removes the frame.
5. **Worker**: section 5.2, policy B of section 4.2 as a constant, on every response; never fall through to the network.
6. **Storage**: nothing persistent; boot wipes whatever is found.
7. **Fallback**: keep the opaque Tier-1 path for browsers where the worker cannot register (older Firefox private windows,
   blocked site data, possibly Safari private browsing).
8. **Network**: no network mode in the first version; if needed, app-side download of static CDN files, or a separate
   "network" player origin with an explicit warning.

## 9. Residual risks to accept or disclose

- A deliberately hostile deck can still send data out in Chromium through `<link rel=prerender>` and WebRTC STUN - same as today.
  "No network access" is true for ordinary decks only.
- After the user clicks inside a deck it can overwrite the clipboard; it can add history entries.
- Decks open at the same time share one origin and process: one can stop the others; isolation between them rests on unguessable
  tokens and the worker's rules, not on the browser's origin boundary.
- No process isolation where the browser has none for cross-site frames (Android Chrome partly, Safari unknown): a looping deck
  can freeze the tab there - also true today.
- The design depends on a service worker in a third-party context: documented as partitioned-but-available in Chrome 115+,
  Firefox 96+/103+ (private windows from 140) and Safari; not verified on real Firefox/Safari here.
- Speaker view by popup and `window.print()` are not available with the recommended tokens.

## 10. Open questions

- Real Firefox and Safari (incl. iOS, private browsing): does the partitioned worker register and control a sandboxed
  `allow-same-origin` frame? What do they do on idle?
- Actual idle lifetime of the worker with an open port, and whether pings keep it alive in each engine.
- `<iframe credentialless>` (Chromium) as an extra per-page storage partition - not examined.
- `preconnect` / `dns-prefetch` egress - not observable in this environment.
- Slidev builds on the hardened flow - not part of this task.
