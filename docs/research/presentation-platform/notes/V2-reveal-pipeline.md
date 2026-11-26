# V2: adversarial verification of the Reveal.js pipeline claims

Work dir: `../prototypes/V2/` ($S = (scratch)). All scripts are copies (`*.copy.*`) or new files in `proto/V2/scripts/`. Nothing in the repo or in other agents' folders was modified.
Browsers: "full" = `chromium.launch({channel:'chromium'})` (new headless); "shell" = default chrome-headless-shell. Both were used where stated. All external network was aborted through Playwright routes unless noted.
Players: **H** = B7's method (the bundled `src/lib/presentation-runtime.ts` IIFE + the shipped `dist/presentation-sandbox.html`, route-fulfilled). **S** = the production site (`astro preview` of `dist` on 127.0.0.1:4680), ZIP uploaded through `[data-file-input]`, Start clicked (A2's method). B7's output was packaged with the same `qft-presentation.json` (engine "slidev") manifest that A2 uses.

## Out-of-sample run (the most important part)

Script: `proto/V2/scripts/oos.mjs`. Results: `proto/V2/out/oos-chromium.json` (full Chromium, H and S), `oos-shell.json` (shell, H only). H and S gave the same outcome in every row, and so did full vs shell.

Input problems found first:
- `corpus/baseline/r1-single-html-cdn`, `r1b-single-html-cdn-5x` and `r2-multifile-local` are **empty**: no files at all (r2 has only empty `assets/ css/ dist/ js/ lib/` folders). They could not be tested. Substitutes: two hand-written decks of mine (`proto/V2/inputs/r1sub` = jsDelivr reveal.js 4.6.1 + RevealMath.KaTeX + highlight + notes, hash:true, a counter button; `r1bsub` = cdnjs 5.1.0 flattened layout + jsDelivr KaTeX 0.16.9 CSS + inline Markdown + range slider/canvas + an inline `onclick=` button). For r2 (external Markdown + ES module) I used B1's `extmd6.zip` and `esm6.zip`.
- `corpus/naive/n3-reveal-offline/entropy-second-law` is **not a usable deck**: no HTML file at all; `code/`, `css/`, `js/` are empty; only vendored reveal.js 6 dist, KaTeX and fonts. B1's detector also rejects it. Not zipped and not counted.
- `corpus/naive/n4-reveal-markdown` is empty as well (not in the task list).

| Deck | B7 inline-deck | A2 wrap-reveal |
|---|---|---|
| n1-reveal-zip (agent, vendored 6.0.2 + KaTeX) | PASS: ready, 9 slides, 36 KaTeX, 0 raw TeX, ArrowRight x2 0.0->2.0, wavelength slider updates readout "550=>700" and canvas | PASS (identical) |
| n2-reveal-chat-nonet (jsDelivr 5.2.1 + RevealMath.KaTeX) | PASS: coerced 5.2.1->6.0.2, 36 KaTeX, nav, speed slider changes readouts (0.600=>0.995, gamma 1.25=>10.01) | FAIL: CDN URLs left untouched -> player "This presentation has separate JavaScript files" (unknown/unresolved CDN) |
| r1sub (mine, jsDelivr 4.6.1) | PASS: coerced 4.6.1->6.0.2, 4/4 math expressions typeset, nav, counter button works | FAIL: same CDN cause |
| r1bsub (mine, cdnjs 5.1.0) | PASS WITH DEFECT: coerced reveal 5.1.0->6.0.2 and KaTeX 0.16.9->0.19.1, Markdown slides + 2 KaTeX, nav, slider redraws canvas; but the `onclick=` button is dead (no error, nothing happens: B7 only reports the hazard, A2's handler conversion is not in B7) | FAIL: same CDN cause |
| B1 extmd6 (external slides.md) | SILENT FAIL: reaches "ready"/"Playing locally" with 1 empty slide (should be 4); fetch of slides.md blocked | SILENT FAIL (same) |
| B1 esm6 (`<script type=module>` import ./dist/reveal.mjs) | FAIL: "Failed to resolve module specifier "./dist/reveal.mjs"" | FAIL (same) |
| B1 classic3 (3.9.2) | FAIL: "A presentation resource could not be loaded" (3.x `dependencies` loader fetches plugin/*.js, `css/print/paper.css` injected at runtime, B7 also leaves theme font @import) | FAIL (same, plugin siblings + paper.css) |
| B1 classic4 (4.6.1, local dist) | FAIL: "A presentation resource could not be loaded" (image inside an inline Markdown `<textarea data-template>`, `data-src` lazy image and `data-background-image` not rewritten by B7; relative theme font @import in local CSS not inlined by B7) | FAIL: only the Markdown-embedded `![](assets/pic.png)` remains, but it is fatal |

Out-of-sample pass rate (8 testable decks; full pass = ready + content intact + navigation + math + own control):
- **B7 inline-deck: 3/8 full pass, 1/8 pass with a defect (dead inline handler) -> 4/8 usable; 4/8 fail (1 silently).**
- **A2 wrap-reveal: 1/8 (only the vendored deck); 7/8 fail (1 silently).**
- Restricted to the AI-made decks plus CDN single-file decks (n1, n2, r1sub, r1bsub): B7 4/4 (one defect), A2 1/4.
- Extra: B1's `corpus-n1.zip` (earlier version of n1) passes through both adapters (36 KaTeX, slider), see V2.4.

Failure causes:
- ES modules: esm6 (both adapters).
- External Markdown fetch: extmd6 (both; silent: "ready" with an empty deck).
- Plugin loading siblings: classic3 (3.x dependencies loader, runtime-injected print CSS) (both).
- Unknown/unresolved CDN library: A2 on n2, r1sub, r1bsub (A2 has no CDN map at all); B7's 4th real deck (ryanbbrown skill example, RevealChart/Chart.js) in the V2.1 rerun.
- Version coercion: no failure observed (4.6.1, 5.1.0, 5.2.1 -> 6.0.2 all worked for the features used).
- Other: asset references the adapters do not rewrite (Markdown-embedded image, `data-src`, `data-background-image`, CSS url()/@import in local stylesheets in B7) -> fatal because the player treats any failed resource as fatal (classic4, both adapters); inline `on*` handler silently dead under B7.

## Claim verdicts (details)

V2.1 (B7-F3) confirmed with caveats. Reran copies of `play-test.mjs` / `play-zip-test.mjs` (`proto/V2/out/b7rerun/`) in full and shell: claude-lecture-1 (28 slides, 126 KaTeX, nav, slider redraws canvas), claude-lecture-2 (44, 301), uchicago (74 slides, 171 KaTeX, 5 hljs, 4/4 images) all ready, 0 network requests; NO-HISTORY-SHIM fails with replaceState as claimed. 5/5 ZIP shapes ready. Caveats: (a) the five ZIP shapes are trivial (A/B: 2 slides, C/D/E: one "Hello" slide), so they test packaging only; (b) the same test set contains a 4th real deck (ryanbbrown skill example) that FAILS (full: style-src-elem; shell: "RevealChart is not defined"), so "3 of 3 real lecture decks" is a selected subset of 4 real decks; (c) interaction check is one synthetic slider event; (d) out of sample, B7 passes 4/8 (see table).

V2.2 (A2-F2) confirmed with caveats. My copy of wrap-reveal reproduces A2's `reveal-wrapped.zip` byte-for-byte (presentation.html identical, 1,795,514 B). E5 rerun through the production site, network blocked, full and shell: "Playing locally", 11 slides, plugins markdown/highlight/notes/search/zoom, 1.0->1.1, fragments f0/f1, auto-animate h2 margin-top 200px, hljs + 3 line-number rows + step 2, Markdown slide with .fragment and notes "markdown notes", r-fit-text 560px, r-stack, converted button "Count: 2", overview, pause, search box. Backgrounds: E5's DOM probe reads `rgba(0,0,0,0)` / `none` (also in A2's own e5 JSON), but E5d via `Reveal.getSlideBackground` gives rgb(42,157,143) and a data: PNG - so they work and E5's probe is wrong. Caveats: S opens nothing (speaker view not available, "notes markup" only), F does nothing (fullscreenEnabled false), math plugin fatal, no CDN handling, manifest must claim engine "slidev"; out of sample A2 passes 1/8.

V2.3 (B1-F6) confirmed with caveats. Copy of `probe-site-chain2.mjs` against B1's www (runner identical to dist/presentation-sandbox.html; runtime bundled from src) in full and shell: 6.0.2, 5.2.1, 4.6.1 (reports 4.6.0) noid+shim: ready, hash #/v1 after arrows, no page errors after F, S, Home, player still running. 3.9.2+shim throws "Cannot read properties of null (reading 'src')" as B1 says. Caveats: "survive" only means no error/stop - F gives no fullscreen in this chain and S opens no speaker view; tested decks are B1's own synthetic 9-slide decks pre-inlined by B1's inliner.

V2.4 (B1-F5) partly refuted. SW player-origin rerun (copy of probe-vfs.mjs, ports 4681/4682, external requests aborted, full Chromium): all 15 runs ready (3.9.2, 4.6.1 + ?print-pdf 14 pages, 5.2.1, 6.0.2 + ?print-pdf, #/3, extmd6 4 slides, esm6, menu button, chalkboard 4 images, copycode 2 buttons, mermaid svg, corpus-n1 36 KaTeX + 8 canvases, repo-style demo 41 slides, speaker popup with 2 ready iframes, F gives fullscreen, postMessage from site page); opaque `allow-scripts` only -> 404, as stated. Inlined (B1's single/*.html through H): menu "Failed to construct 'URL'", copycode script-src violation, chalkboard resource error - reproduced. BUT the corpus deck: B1's description "RevealMath.KaTeX with katex.local" is wrong (n1/corpus-n1 call `renderMathInElement` from vendored KaTeX, no RevealMath), and corpus-n1 plays fine when inlined by B7's or A2's adapter (ready, 36 KaTeX, slider). Only B1's own inliner output fails. So "inlining cannot run the AI-made corpus deck" is false; the menu/copycode/chalkboard part holds. Also: the SW player uses `allow-scripts allow-same-origin allow-popups allow-modals allow-popups-to-escape-sandbox`, a much weaker sandbox than today's; math-katex-default reaches "ready" with 0 KaTeX (math silently missing).

V2.5 confirmed. `proto/V2/scripts/pm-reload.mjs`: from the shipped runner frame (opaque) to the deck's blob frame, no injected code: 0 messages before configure; after configure: callback getTotalSlides (9 / 44 / 9), getSlideNotes text, getState, slide(3,0) -> slidechanged {h:3} and the deck's indices are 3.0 (n2, claude-lecture-2, n1; full Chromium). Note the current site never relays these to the top page.

V2.6 not reproduced (partly). In-place swap (append to current slide + Reveal.sync + layout): 7-25 ms (n1 7-14, n2 10-15, 44-slide deck 16-25 ms full and shell), position unchanged - consistent with the claim. My reload probe (new blob + #/h/v/f set from inside the runner, readiness beacon) timed out in every run, so I have no reload timing and no fragment-restore check of my own. This is probably a flaw in my probe, not evidence against the claim, but the 170-250 ms number stays unverified here.

V2.7 confirmed. Copy of test-map.mjs: demo.html 41/41, md-deck 12/12, cursor->slide correct. Out of sample: n1 9/9, n2 9/9, r1sub 7/7 (vertical stack), r1bsub 4/4 (inline Markdown), classic4 9/9, extmd6 4/4 (external slides.md). Caveat: the check only tests that the runtime heading text lies inside the mapped source range; slides without a heading pass automatically.

V2.8 confirmed (on new inputs). Copy of test-detect.mjs with 14 new samples: 10/10 Reveal decks recognised with right entry and version (n1 nested folder, n2, r1sub, r1bsub, hoyle-part1 4.6.1, uchicago lecture-07/index.html 4.5.0, ryanbbrown 5.1.0, A2 standard folder 6.0.2), 4/4 rejected (n3 unfinished folder with vendored reveal.js but no HTML, empty r1 folder, a Slidev dist, a Markdown file, a non-Reveal HTML -> 5 including empty folder). The original 36/36 was not rerun.

V2.9 confirmed. curl -sI -L of 15 URLs: unversioned jsDelivr dist/reveal.js -> x-jsd-version 6.0.2, plugin/markdown|highlight|notes -> 5.2.1, @latest/plugin/math -> 5.2.1, dist/plugin/markdown.js -> 6.0.2, @6.0.2/plugin/notes/notes.js 404, @5/... 200 5.2.1; unpkg unversioned plugin/markdown/markdown.js and plugin/notes/notes.js redirect to @6.0.2 and 404; unpkg @6.0.2/plugin/markdown -> dist/plugin/markdown.js 200; cdnjs 6.0.2/plugin/markdown.min.js 200.

V2.10 B6 13/13 reproduced; my 6 new messy cases (8 sub-cases, `proto/V2/scripts/patch-new-cases.mjs`): 5/8 behave well.
- PASS smart quotes/typographic apostrophe/en dash in SEARCH vs straight in file.
- PASS truncated SEARCH/REPLACE (no closing marker) -> refused, file unchanged.
- PASS Windows CRLF answer on LF file and LF answer on CRLF file, EOLs preserved.
- PASS(ish) two identical candidates: with a hint picks the right one; WITHOUT a hint it silently edits the first occurrence and only says so in the report ("occurs 2 times; nearest to line 1 was used").
- FAIL wrong indentation: applied, but the replacement keeps the answer's relative spaces -> `\t\t\t\t\t   <p>` (mixed tabs+spaces; harmless in HTML, risky in Markdown/YAML/Python).
- FAIL unified diff with wrong line numbers and trailing spaces in a context line: applied, but the context line from the answer overwrote the file line (`# Two` became `# Two  `).
- FAIL truncated whole file with a bare `...` line: ACCEPTED and applied, deleting slide "Two" (data loss). Only comment-style placeholders are caught.
