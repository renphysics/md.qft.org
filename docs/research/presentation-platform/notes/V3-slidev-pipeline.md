# V3: adversarial verification of the Slidev pipeline claims (B2, B6, B7)

Work dir: research/proto/V3/. Nothing in the repo or in other agents' directories was modified; B2 scripts were copied into V3/tools and V3/packer, then edited only in the copies (ports, output dirs, browser channel).
Browser: Playwright with Chromium 158. "full" means `channel: 'chromium'` (new headless); "shell" means the default chrome-headless-shell.
Player: unless stated otherwise, the REAL production build dist, served by a static server on :4701. The ZIP is uploaded through the presentation library's `[data-pres-input]` and started with `[data-pres-start-button]`. Harness: V3/tools/play-real-site.mjs.

## New input
V3/newdeck: a 7-slide "Simple Pendulum" deck written from scratch. It contains:
- headmatter with a transition
- two-cols with `class: pt-6` and `::right::`
- `/sun.png` from public/
- `<v-clicks>` with 3 items plus a `v-click` div
- a KaTeX block and inline maths
- PendulumSlider.vue (`<script setup lang="ts">`, range slider with v-model.number, computed period, scoped CSS)
- a Python block with `{2-3|5}` line highlighting
- `layout: center` and `layout: end` slides
- 3 speaker notes

node_modules is a symlink to shared/slidev-starter (@slidev/cli 53.1.0). Built with plain `npx slidev build`: 109 files, 2.2 MB, 9 s (run while another npm install was going). index.html references Google Fonts and the jsDelivr favicon.

V3/newdeck-mermaid: the same deck plus an "Energy flow" slide with a Mermaid `graph LR`. Build: 199 files, 7.5 MB.

V3/old52: the same deck built with @slidev/cli 52.11.5 (Vite 7 / Rollup), from a cold install with an empty cache: 36 s, 622 packages, 425 MB node_modules. Build: 107 files, 2.1 MB.

## (a) Converter on the default build
- **Node converter** (copy of convert-dist.mjs): ok. Report: mapDeps 3, router 1 (`ke(\`/\`)`), 3 asset literals, 11 extra CSS. Output: 1.33 MB ZIP, 2.31 MB HTML.
- **Real site, full Chromium:** status "Playing locally" in about 1.3 s. Walking the deck:
  - slides 1 to 7 reached
  - public image shown as 120x80 data: URI
  - KaTeX present (3 on slide 2, 2 on slide 4)
  - v-clicks revealed 1, 2, 3, 4 items in turn
  - code highlight went from 2 lines to 1 line after a click
  - slider: input event 1.00/2.006 s to 4.00/4.012 s, bar width 60 to 240 px; a real mouse click on the slider moved it to about 3.2
  - scoped CSS applied (dashed border)
  - 0 external requests
  - only console error: "Permissions policy violation: focus-without-user-activation"
- **Real site, headless shell:** same result.
- **esbuild-wasm Worker** (copy of the wasmtest site, which carries the site's exact meta CSP; replica player): worker init 171-210 ms. Conversion: 1.50 s cold, 0.88 s warm, 1.46 MB HTML, state ready. Its HTML, swapped into the portable ZIP, played on the real site with the same walk results.
- **Harness notes:**
  - `frame.locator('body').press()`, which B2's tests use, did NOT deliver keys to the nested opaque frame on the real site. Keys only arrived after a real click in the deck.
  - After the slider has focus, the first ArrowDown after clicking elsewhere in the slide was lost; the next keys worked. This was seen in both the converted and the in-browser variants. The reference build at a top-level URL did not lose the key.
  - An early harness bug produced a false "slider starts at 0.10" result. Rechecked: the initial value is 1.00.

## (b) In-browser compiler and generic client on the SOURCE
Run with B2's site copy (V3/inbsite) and a copy of test-fidelity-slides.mjs, full Chromium.
- Compile: 353 ms (278 ms in a second run). 0 diagnostics, unsupported [].
- DOM: 7/7 slides identical, with all clicks revealed. (The 8th compared "slide" lies past the end of the deck and is ignored.)
- Pixels (new canvas diff, V3/tools/pixdiff.mjs): 4/7 identical. The three that differ:
  - **Slide 2: 35,432 px.** The frontmatter `class: pt-6` has no CSS: the reference CSS has `.pt-6{padding-top:1.5rem}`, but the compiled HTML contains the class name and no rule. The in-browser UnoCSS pass does not scan per-slide frontmatter `class:`. DOM equality hides this.
  - **Slide 6: 6,037 px.** Shiki token colours differ (`*` operators coloured in the in-browser version).
  - **Slide 5: 12 px**, in one run only (noise).
- The compiled HTML (3.88 MB), packed into the portable ZIP, played on the real site: ready, every slide, clicks, code steps and slider work.
- Caveat on B2's tooling: test-fidelity-slides plays the compiled HTML with `page.setContent` at top level, not in the sandbox, and compares normalised DOM only (style, src, id and url() are stripped). Its "identical" verdicts are DOM verdicts, not pixel verdicts.

## (c) Mermaid
- **Node converter:** ok (mapDeps 6). 2.96 MB ZIP, 7.77 MB HTML.
- **esbuild-wasm:** 7.86 s, 9.96 MB HTML, ready.
- **Real site, both conversions:** ready; all 8 slides reached; the Mermaid SVG rendered (1 svg inside the `.mermaid` shadow root, as in the reference build); slider fine.
- Probe gotcha: Slidev renders Mermaid inside a ShadowRoot, so `querySelectorAll('svg')` reports 0. A naive probe calls this a failure.
- **In-browser compile:** reports `unsupported: ["mermaid (needs the mermaid chunk in the client)"]` and leaves an unknown `<mermaid code-lz>` element. DOM 7/8 identical; pixels 5/8 identical (slides 2 and 6 as above, plus slide 7 with no diagram).

## (d) Older Slidev, 52.11.5
- Cold install 36 s (well under 3 min).
- **Node converter:** both regexes matched (mapDeps 3, router 1 on `To("/")`, double quotes instead of backticks); 2 asset literals; 2.29 MB HTML.
- **esbuild-wasm:** 1.79 s, ready.
- **Real site, both conversions:** ready; full walk; slider works.
- Console error "Failed to patch FloatingVue TypeError ... 'Popper'": it also appears in the unconverted 52.11.5 build over HTTP, so it is upstream and not caused by the converter.
- **No patch broke** on 53.1.0 default, 53.1.0 plus Mermaid, or 52.11.5.
- **detect.mjs** labels the default 52.11.5 build `routerMode: "hash"`. It is a history build: routerMode was not set and the default is history. The router heuristic fails on older minified output.

## Claim re-runs
- **V3.1** (7 B2 variants, my copy of the converter): all 7 converted ok (router `le`/`ke` patched once, mapDeps 3 each). On the REAL site, full Chromium: 6 of 7 (hash-abs, hash-rel, history-abs, history-rel, history-sub, memory-abs) "Playing locally", slides 1-5 reached, 0 external, no console errors besides the focus warning. The memory-rel replay was cut off when I stopped my servers, so it was converted but not played by me.
- **V3.3** (on the new default build, full Chromium):
  - file://: CORS block on /assets
  - sub-path /sub/deck/: 404 /assets, blank
  - opaque sandbox iframe (sub-path, and the deck at an origin root): CORS block (no ACAO), blank
  - blob: document: blank
  - control (http root): works
- **V3.4** (csptest copy, full Chromium): main thread blocks wasm, new Function and blob import; a same-origin Worker allows all three; a blob: Worker blocks.
- **V3.5:** the 52.16.0 tarball has no memory-route reference; 52.17.0 has one. I did not test whether memory is the only mode that works in an opaque frame (B2's own results only); the converter makes the question moot for converted builds.
- **V3.6:** `routerMode: hash` plus `fonts.provider: none` plus `--base ./`, served from /decks/talk/: renders, navigates, image, KaTeX and slider all work. BUT index.html still has `<link rel=icon href=https://cdn.jsdelivr.net/gh/slidevjs/slidev/assets/favicon.png>`, which full Chromium requested 4 times. "0 external requests" holds only if favicons are not fetched (headless shell does not fetch them).
- **V3.7:** engines.node `>=22.22.0` confirmed. New build: 109 files / 2.2 MB with Google Fonts and the jsDelivr favicon. 52.11.5 cold install: 36 s, 425 MB. I did not redo the 53.1.0 cold install.
- **V3.8:** starter dist: 314 files, 37,354,226 bytes; twitter and bsky script tags; 7 JS files contain `new Worker`.
- **V3.9:** `window.__slidev__` is undefined; `__vue_app__.config.globalProperties.$router.push('/5')` navigated in a hash build and in converted (memory-patched) builds.
- **V3.10:** detect copy, 17 original fixtures: classifications look right. On new inputs, the kinds are right, but the 52.11.5 router mode is wrong (see above).
