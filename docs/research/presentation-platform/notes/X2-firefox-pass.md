# X2 - First Firefox pass (Firefox 159.0, Playwright-patched, headless)

Browser: the isolated copy at corpus/naive/n3-reveal-offline/_work (playwright-core + browsers/firefox-1572), launched through
proto/X2/ff.cjs. Site: production build dist served by a copy of the V1 static server (lib.cjs) on 4740.
Scripts, logs and shots: proto/X2/ (f1-focus.cjs, f1b-repair.cjs, f2-reveal.cjs, f3f4.mjs, f5-csp.cjs, f6-net.cjs,
f6b-net-releaseprefs.cjs, f6c-stun-nonloopback.cjs, f7-freeze.cjs, f7b-procs.cjs, f7c-freeze-isolated.cjs, f7d-procs-isolated.cjs,
f8-blob.cjs; logs/*.json).

Important harness caveat: Playwright's Firefox ships playwright.cfg that changes defaults relevant here:
`fission.webContentIsolationStrategy=0` (no cross-process iframes) and `network.http.speculative-parallel-limit=0`
(no speculative connections). Where that matters I re-ran with the release defaults set through firefoxUserPrefs.
This is still the Juggler-patched build in headless mode, not release Firefox on a desktop.

## Results

| # | Behaviour | Chromium 158 (digests) | Firefox 159 (this pass) | Roadmap assumption in Firefox |
|---|---|---|---|---|
| F1 | Shipped Slidev example: Start -> "Playing locally" | yes | yes, 551 ms | holds |
| F1 | Arrow keys before any click | do nothing | work (01 -> 02 slide); deck document hasFocus true, active=body | the focus bug is Chromium-only |
| F1 | Arrow keys after a click; with blur+focus+focus-message repair | work; repair fixes pre-click case | both work; repair harmless (keys still advance) | repair is safe to ship cross-browser |
| F2 | A1 reveal-inlined.zip plays and navigates | plays (376 ms) | plays (348 ms), arrows navigate without a click | holds |
| F2 | hash:true + id-less first slide | killed: SecurityError in replaceState | killed: notice "The operation is insecure." | holds (same failure) |
| F2 | try/catch shim on replaceState/pushState | plays | plays (303 ms), navigates; hash later becomes #/second | holds |
| F2 | location.hash = '#x' in blob: deck | silently refused ("Not allowed to load local resource") | THROWS TypeError "Location.hash setter: Access to 'blob:null/...#x' from script denied." | differs: in Firefox it is an exception, which is fatal in the player if uncaught; shims must catch it |
| F2 | anchor href="#second" click | hash stays empty | hash stays empty, no error | same |
| F2 | history.replaceState(null,'','#/2') / pushState path | fragment ok / SecurityError | fragment ok / SecurityError | same |
| F3 | B7 inline-deck on n2 (5.2.1 -> 6.0.2) | ready, 36 KaTeX, nav, slider readout 0.600=>0.995 | ready 470 ms, 9 slides, 36 KaTeX, nav without click, slider 0.600=>0.995, gamma 1.250=>10.01 | holds |
| F4 | B2 converted Slidev build dist-history-abs.zip | ready, nav, "Opposite" button changes intensity | ready 466 ms, nav (keys without click), intensity 1.00 -> 0.00 | holds |
| F5 | Page with site meta CSP (script-src 'self'): main thread wasm / new Function / import(blob:) | blocked / blocked / blocked | blocked / blocked / blocked | same |
| F5 | Same-origin URL Worker (classic and module) | all allowed | all allowed (wasm, new Function -> 42, import(blob:) -> 42) | holds: esbuild-wasm in a same-origin Worker needs no CSP change |
| F5 | blob: Worker | blocked | blocked (wasm CompileError, EvalError, blob import refused) | same |
| F6 | link rel=prerender | real GET reaches attacker | nothing (also nothing from an ordinary page: Firefox has no prerender) | n/a in Firefox |
| F6 | link rel=prefetch | not reported | nothing from the player; ordinary page control: GET arrives | blocked in the sandbox |
| F6 | link rel=preconnect (TCP listener) | not observable (Playwright disables background networking) | Playwright default prefs: nothing (control also nothing). With release default speculative-parallel-limit=6: TCP connection reaches listener from inside the player (control same) | NEW leak in Firefox: a TCP connect to any host:port (no HTTP bytes) |
| F6 | link rel=dns-prefetch | not observable | not observable (no DNS listener; control also nothing) | unknown |
| F6 | RTCPeerConnection + STUN | 8 STUN Binding Requests | 127.0.0.1 STUN with defaults: 0 (Firefox excludes loopback ICE). STUN on 192.0.2.2 (non-loopback, release ICE defaults): 6 datagrams; with ice.loopback=true: 12 | same leak as Chromium |
| F6 | fetch / img controls | blocked | fetch: connect-src violation, nothing received. img: nothing received; the player stopped with "A presentation resource could not be loaded" | blocked |
| F6 | link rel=preload as=script | - | nothing received; player stopped (resource error) | blocked |
| F7 | Runaway loop after ready: top page rAF / evaluate / Stop click | rAF 0 ms, Stop 43 ms (separate processes) | FROZEN in every variant: no rAF, no evaluate answer in 4 s, Stop click times out after 6 s. Same with fission.autostart true/false and with webContentIsolationStrategy=1 (release default). No new content process appears when the deck starts: deck runs in the editor's content process | does NOT hold: a hostile or buggy deck freezes the whole editor tab in Firefox |
| F8 | Blob URL created by the runner (parent), loaded in the opaque deck frame (img, classic script, fetch) | fails | fails ("Security Error: Content at moz-nullprincipal:{...}?http://127.0.0.1:4740 may not load data from blob:null/...") | same |
| F8 | Blob URLs created inside the frame: img, CSS, classic script, module script (with blob: dep), fetch, import(), Worker | all work | all work (23 ms total) | holds |

## Caveats
- Headless Juggler Firefox with Playwright's emulated focus; F1 keyboard result should be confirmed on a real desktop Firefox.
- F7: release Firefox with Fission isolates sandboxed opaque-origin frames by their precursor site, so the same-process outcome is
  expected there too, but this pass did not run release Firefox.
- F6 preconnect/STUN leaks needed release-default prefs restored; the default Playwright profile hides them.
- WebKit not attempted (known not to launch here).
