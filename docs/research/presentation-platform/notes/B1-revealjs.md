# B1 - Reveal.js as it really is in November 2026

Scope: "play any AI-made Reveal.js deck from a ZIP, locally, and let the user edit it" on md.qft.org.
Date of all measurements: 2026-11-24. Browser: Playwright Chromium 158 (headless), Linux, 4 CPUs, Node 22.
Firefox and Safari were NOT available: everything about them is from documentation and is labelled so.

Labels used: **[E]** verified-empirically (run here), **[P]** verified-primary-source (official docs / source code),
**[S]** secondary-source, **[I]** inferred, **[U]** uncertain.

Prototype root (everything is re-runnable):
`../prototypes/B1` (called `$P` below).
Nothing inside `<repo>` was modified (read-only use; `git status --short` empty after the runs).

---------------------------------------------------------------------------------------------------

## 0. The 15 things an architect must know

1. **Three incompatible file layouts exist** (3.x, 4.x/5.x, 6.x). 6.0.0 (2026-03-11) moved plugins from
   `plugin/<name>/<name>.js` to `dist/plugin/<name>.js` and renamed `*.esm.js` to `*.mjs`. Global names
   (`Reveal`, `RevealMarkdown`, `RevealHighlight`, `RevealNotes`, `RevealMath`, `RevealZoom`, `RevealSearch`)
   and the HTML markup did not change. [P][E]
2. **4.x/5.x-style paths on 6.x are fatal**: plugin scripts 404, then `ReferenceError: RevealMarkdown is not defined`
   aborts the inline init script, so the deck never initialises. [E]
3. **Unversioned CDN URLs rot differently per CDN**: jsDelivr silently serves each missing file from the newest
   version that still has it (6.0.2 core + 5.2.1 plugins: works); unpkg and esm.sh return 404 (deck dead);
   3.x-style unversioned URLs are dead on both. Version-pinned URLs for 3.x-5.x all still work. [E][P]
4. **Old pandoc output is very probably dead**: pandoc 3.1.3 emits `https://unpkg.com/reveal.js@^4//dist/reveal.js`
   (double slash); unpkg redirects it to `/reveal.js@4.6.1//dist/reveal.js` and answers 404 (curl, Node fetch), and
   pandoc 3.1.3 `--embed-resources` embeds the text "Not found" instead of reveal.js. Caveat: Chromium inside this
   container cannot reproduce the 404 because its egress path collapses `//` (see 1.4). [E][I]
5. **Classic `<script src>` decks with local files work from file:// in all majors**; external Markdown
   (silently one blank slide) and ES modules (CORS error, nothing runs) do not. [E]
6. **The site's current sandbox kills ordinary Reveal decks**, even when fully inlined:
   - `hash: true` (in the official template) + first slide without `id` => `SecurityError` in
     `history.replaceState` at startup (4.x, 5.x, 6.x); 3.x fails the same way with its default `hash: false`. [E]
   - pressing **F** => unhandled rejection "Disallowed by permissions policy" => player `fail()`. [E]
   - pressing **S** (RevealNotes loaded) => `TypeError: Cannot set properties of null (setting 'marked')` => `fail()`. [E]
   - 8 of 14 stock themes `@import` Google Fonts => CSP violation => `fail()`. [E]
   A small shim (2.2 KB source, about 1.2 KB minified: history / fullscreen / window.open) fixes the first three for 4.x-6.x. [E]
7. **Reveal's postMessage API works inside `sandbox="allow-scripts"`** and needs no global: JSON *strings*
   `{"method":"slide","args":[2]}` in; `{"namespace":"reveal","eventName":...,"state":{...}}` out. Return values
   (`callback` events, e.g. `getSlideNotes`) only flow when `postMessageEvents` is true, which a host can switch
   on remotely with `{"method":"configure","args":[{"postMessageEvents":true}]}`. [E][P]
8. **All Reveal events bubble from `.reveal` to `document`** (`ready`, `slidechanged`, `fragmentshown`, ...), so an
   injected script can observe a deck without a reference to the Reveal object (ESM/AMD decks have no global). [E][P]
9. **A blob: URL can carry `#/h/v/f` but not `?query`** => deep links/restore work, `?print-pdf` / `?view=scroll`
   do not. `view: 'print'` as config works on 5.x/6.x; 4.x has only the query. [E]
10. **The built-in speaker view cannot work from a blob document** (it builds
    `protocol + '//' + host + pathname` => `blob://http://...`, and needs same-origin popups). A host-rendered
    presenter console via `getSlideNotes` is the alternative. [E][P]
11. **Third-party plugins load sibling files relative to their own script URL** (`document.currentScript`):
    inlining breaks them (menu: fatal `Invalid URL`; copycode: deck never ready; chalkboard: images missing).
    Mermaid (3.2 MB, self-contained) survives inlining and strict CSP. [E]
12. **Math needs network or a URL space**: `RevealMath` (default MathJax 2), `.KaTeX`, `.MathJax3/4` all inject
    `<script src>` at runtime (jsDelivr by default, or `katex.local` path). [P][E]
13. **Detection is easy and cheap**: `.reveal > .slides` + init call + core script reference; version = the single
    semver string literal in the core file. Prototype: 36/36 positives, 3/3 negatives, 0.3-5 ms per folder. [E]
14. **Live edit**: reload + restore through the blob URL fragment costs 170-250 ms (470 ms with 8.7 MB of inline
    images) and is always correct; an in-place keyed `<section>` swap + `Reveal.sync()` costs 20-30 ms round trip
    but loses listeners attached by custom scripts. Both preserved slide + fragment in every run (12/12 on 6.0.2,
    6/6 on 4.6.1 and 5.2.1). [E]
15. **A service-worker "player origin" plays every tested ZIP unmodified** (15/15 runs, 13 decks from 9 ZIPs: all
    majors, external Markdown, ES modules, menu/chalkboard/copycode plugins, local KaTeX, speaker view, `?print-pdf`),
    but needs `allow-same-origin` relative to a second origin. [E]

---------------------------------------------------------------------------------------------------

## 1. Version history that matters

### 1.1 Releases (npm `time`) [P]
Command: `npm view reveal.js time --json`, `npm view reveal.js dist-tags`.

| Version | Published | Note |
|---|---|---|
| 3.0.0 | 2015-01-15 | |
| 3.6.0 | 2017-11-23 | the version most old tutorials pin on cdnjs |
| 3.8.0 | 2019-04-01 | `lib/js/head.min.js` deleted (upgrade guide); `Reveal.registerPlugin` introduced (absent in 3.6.0/3.7.0 source) [E] |
| 3.9.2 | 2020-01-31 | last 3.x |
| 4.0.0 | 2020-05-20 | `dist/` layout, ES modules, `plugins: [...]`, auto-animate, `embedded`, multiple instances |
| 4.6.1 | 2023-09-13 | last 4.x (its `Reveal.VERSION` and banner say `4.6.0`) [E] |
| 5.0.0 | 2023-10-27 | scroll view, `view` config, auto scroll view below 435 px |
| 5.2.0 / 5.2.1 | 2025-03-19 / 2025-03-28 | lightbox (`data-preview-image/-video`), lightbox state in getState |
| 6.0.0 | 2026-03-11 | Vite build, plugin paths moved, `.mjs`, bundled TS types, `@revealjs/react` |
| 6.0.1 | 2026-04-11 | `previewIframe` blacklisted in postMessage API |
| 6.0.2 | 2026-09-10 | `latest`; postMessage/iframe-preview XSS fix, perf fixes |

Release notes read through WebFetch of github.com/hakimel/reveal.js/releases (summaries, not verbatim) [P]:
- 4.0.0: CSS/JS moved to `dist/`; core and plugins rewritten as ES modules; new plugin registration; highlight theme
  moved `lib/css/monokai.css` -> `plugin/highlight/monokai.css`; multiplex + notes-server moved out; print CSS built in;
  `Reveal.initialize` returns a promise; notes plugin no longer needs `notes.html`; `Reveal.navigateTo` removed
  (use `Reveal.slide`), `addEventListener` kept as alias of `on`.
- 5.0.0: scroll view (`view: 'scroll'`, `?view=scroll`); BREAKING: scroll view turns on automatically for viewports
  narrower than 435 px (`scrollActivationWidth: null` disables); print via `view: 'print'` / `?view=print`
  (`?print-pdf` still works).
- 5.2.0: lightbox; `initialize` can no longer be called twice; `controls: 'speaker-only'`.
- 6.0.0 breaking: plugin paths, `.esm.js` -> `.mjs`, npm CSS paths lose `dist/`, type names. New: `@revealjs/react`
  (0.2.2 on npm, 2026-09-10), MathJax 4 in the math plugin, `sync()` updates slide classes and fires a `sync` event,
  `removeHiddenSlides()`, `preventIframeAutoFocus`, revealjs.com gained `llms.txt`.
- Upgrade guide: https://revealjs.com/upgrading/ (tables reproduced in 1.3). [P]

### 1.2 Package layouts [E]
Command: `npm pack reveal.js@<v>` for 3.9.2, 4.0.0, 4.6.1, 5.0.0, 5.2.1, 6.0.0, 6.0.2 (unpacked in `$P/pkgs/v*/package`).

| | 3.9.2 | 4.0.0 - 5.2.1 | 6.0.0 - 6.0.2 |
|---|---|---|---|
| core UMD | `js/reveal.js` (173 KB, unminified) | `dist/reveal.js` (82-112 KB) | `dist/reveal.js` (119 KB) |
| core ESM | none | `dist/reveal.esm.js` | `dist/reveal.mjs` (141 KB) |
| core CSS | `css/reveal.css`, `css/reset.css` | `dist/reveal.css`, `dist/reset.css` | same |
| themes | `css/theme/*.css` | `dist/theme/*.css` (7 KB each) | `dist/theme/*.css` (5 KB - 575 KB) |
| theme fonts | `lib/font/**` (eot/ttf/woff) | `dist/theme/fonts/**` | **inlined as base64 woff in the theme CSS**; no fonts dir |
| plugins UMD | `plugin/markdown/{marked,markdown}.js`, `plugin/highlight/highlight.js`, `plugin/notes/notes.js`, `plugin/math/math.js`, `plugin/zoom-js/zoom.js`, `plugin/search/search.js`, `plugin/print-pdf/print-pdf.js` | `plugin/<n>/<n>.js` (+ `<n>.esm.js`, + source `plugin.js`) | `dist/plugin/<n>.js` (+ `<n>.mjs`); **no top-level `plugin/` in the npm package** |
| highlight CSS | `lib/css/{monokai,zenburn}.css` | `plugin/highlight/{monokai,zenburn}.css` | `dist/plugin/highlight/{monokai,zenburn}.css` |
| speaker view | separate `plugin/notes/notes.html` | inlined in `notes.js` (+ unused `speaker-view.html`) | inlined in `dist/plugin/notes.js` |
| runtime payload (UMD + CSS + woff) | 1.62 MB (gzip 0.81) | 1.78-1.83 MB (gzip 0.84-0.85) | 3.74 MB (gzip 2.25) |

- The 6.x git tree additionally holds `plugin/<n>/plugin.js` **sources** (ES imports, not loadable as scripts), `examples/`,
  `test/`, `react/`: 230 files, 11.8 MB, **33 HTML files** (listing: `$P/out/gh-602-flat.json`). The official
  "basic setup" tells users to download that archive and edit `index.html` (https://revealjs.com/installation/). [P]
- Official packaging: `npm run package` -> `presentation.zip` = the HTML + `dist/**` + `*/*.md` + optional `lib/`,
  `images/`, `slides/` (6.0.2 `scripts/zip.js`; it also rewrites `<script type="module">` imports into static
  `<script src="dist/...">` tags "so that this presentation can run anywhere (including offline via file://)").
  5.2.1: `gulp package` -> `reveal-js-presentation.zip` = `index.html`, `dist/**`, `plugin/**`, `*/*.md`, `lib`, `images`,
  `slides` (gulpfile.js:278-292). [P]
- 6.0.2 `dist/*.mjs` files are self-contained (no `import` statements, one `export { X as default }`). [E]
- 6.0.2 `dist/reveal.js` is ES2015+ (template literals); an ES5 build is optional (`npm run build:es5`). [P]
- 14 themes in 6.0.2: beige, black, black-contrast, blood, dracula, league, moon, night, serif, simple, sky,
  solarized, white, white-contrast. `white_contrast_compact_verbatim_headers.css` (4.6-5.2) is gone. [E]

### 1.3 Old references that break on 6.x [P upgrade guide + E]

| Written for | Reference | On 6.x |
|---|---|---|
| 4.x/5.x | `plugin/notes/notes.js`, `plugin/markdown/markdown.js`, `plugin/highlight/highlight.js`, `plugin/math/math.js`, `plugin/search/search.js`, `plugin/zoom/zoom.js` | 404 -> `ReferenceError: Reveal<Name> is not defined` -> no init [E] |
| 4.x/5.x | `plugin/highlight/monokai.css`, `zenburn.css` | 404 (unstyled code only) |
| 4.x/5.x | `dist/reveal.esm.js`, `plugin/<n>/<n>.esm.js` | 404 -> module graph fails, nothing runs [E] |
| 4.x/5.x | `dist/theme/fonts/source-sans-pro/source-sans-pro.css` | 404 (fonts now inside theme CSS) |
| 4.x/5.x npm | `reveal.js/dist/reveal.css`, `reveal.js/dist/theme/x.css`, `reveal.js/plugin/markdown/markdown.esm.js` | not in `exports` map -> bundler error; use `reveal.js/reveal.css`, `reveal.js/theme/x.css`, `reveal.js/plugin/markdown` |
| 3.x | `js/reveal.js` | exists in 4.x-6.x but is **ES-module source** -> `SyntaxError: Cannot use import statement outside a module` + `Reveal is not defined` [E] |
| 3.x | `css/reveal.css`, `css/theme/*.css`, `lib/css/zenburn.css`, `lib/js/head.min.js`, `plugin/markdown/marked.js`, `plugin/zoom-js/zoom.js`, `plugin/print-pdf/print-pdf.js`, `plugin/notes/notes.html`, `css/print/pdf.css` | 404 |
| 3.x API | `Reveal.navigateTo` | removed in 4.0 (0 occurrences in 6.0.2 dist) [E] |
| @types | `Reveal.Api`, `Reveal.Options`, `Reveal.PluginDefinition` | `RevealApi`, `RevealConfig`, `RevealPlugin` |

Still working on 6.0.2 [E, source + tests]: `dependencies: [{ src, async, callback, condition }]` loader,
`Reveal.registerPlugin('id', obj)` (3.9 style), calling `configure/on/addEventListener/registerPlugin` before
`initialize`, `Reveal.addEventListener`, legacy CSS (`.stretch`, transitions `cube/page/linear/default`), `data-background`.

### 1.4 CDN matrix [E]
Method: `curl -I -L` of 1149 URLs (`$P/scripts/cdn-matrix.sh`, raw `$P/out/cdn-matrix.tsv`, pivot `$P/out/cdn-matrix.md`,
condensed `$P/out/cdn-matrix-condensed.md`). "none" = no version in the URL.

jsDelivr (`https://cdn.jsdelivr.net/npm/reveal.js[@v]/<path>`):

| path | @3.9.2 | @3 | @4.6.1 / @4 | @5.2.1 / @5 | @6.0.2 / @6 | @latest / none |
|---|---|---|---|---|---|---|
| `js/reveal.js` | ok (UMD) | ok | ok (**ESM source**) | ok (ESM source) | ok (ESM source) | ok -> 6.0.2 ESM source |
| `css/reveal.css`, `plugin/markdown/marked.js` | ok | ok | 404 | 404 | 404 | ok -> served from **3.9.2** |
| `lib/js/head.min.js` | 404 | ok (-> 3.7.0) | 404 | 404 | 404 | ok -> 3.7.0 |
| `dist/reveal.js`, `dist/reveal.css`, `dist/theme/black.css` | 404 | 404 | ok | ok | ok | ok -> 6.0.2 |
| `dist/reveal.esm.js`, `plugin/<n>/<n>.esm.js` | 404 | 404 | ok | ok | 404 | ok -> **5.2.1** |
| `plugin/{markdown,highlight,notes,math,search}/<n>.js` | ok (3.x files) | ok | ok | ok | 404 | ok -> **5.2.1** |
| `plugin/zoom/zoom.js`, `plugin/highlight/monokai.css` | 404 | 404 | ok | ok | 404 | ok -> **5.2.1** |
| `dist/reveal.mjs`, `dist/plugin/<n>.js`, `dist/plugin/highlight/monokai.css` | 404 | 404 | 404 | 404 | ok | ok -> 6.0.2 |

- jsDelivr "version fallback" is documented: "if a file used in version 1.0.1 is no longer available in 1.0.2 ... we will
  fall back to the previous 1.0.1 version" (https://raw.githubusercontent.com/jsdelivr/jsdelivr/master/README.md, line 54;
  also for ranges, line 211). The serving version is visible in the `x-jsd-version` response header. [P][E]
- Consequence, measured (`$P/out/probe-cdn.txt`): a deck with unversioned jsDelivr URLs and 4.x paths gets
  `dist/reveal.js` 6.0.2 + `plugin/*/*.js` 5.2.1 and **works** (ready, Markdown rendered, code highlighted); the ESM
  variant gets `reveal.esm.js` 5.2.1 with 6.0.2 CSS and works. [E]

unpkg (`https://unpkg.com/reveal.js[@v]/<path>`), strict resolution:
- pinned or ranged 3.x/4.x/5.x paths: ok. `@6`, `@latest`, none + `plugin/<n>/<n>.js` or `dist/reveal.esm.js`: **404**. [E]
- unpkg honours the package `exports` map: `reveal.js@6.0.2/plugin/markdown` -> `dist/plugin/markdown.js`,
  `/reveal.css` -> `dist/reveal.css`, `/theme/black.css`, `/plugin/highlight/monokai.css` all 200. [E]
- `https://unpkg.com/reveal.js@^4//dist/reveal.js` (double slash, pandoc < 3.7): curl and Node `fetch` get 302 ->
  `/reveal.js@4.6.1//dist/reveal.js` -> 404 "Not found: /reveal.js@4.6.1//dist/reveal.js" (jsDelivr answers 400 to a `//` path);
  the single-slash form works. **Environment artifact:** Chromium in this container showed the same deck loading, because
  its requests reach public servers with `//` collapsed to `/` (an echo server saw `/a/b` for `//a//b`; curl sent `//a//b`),
  while Chromium itself sends `//` verbatim (checked against a local server: `/pkg@%5E4//dist/reveal.css`). Real browsers
  therefore get the 404; this matches pandoc's changelog for 3.7 ("v4 is no longer available on unpkg.com", #10740) and the
  earlier "Remove trailing slash from default revealjs URL (#8749)". Scripts: `$P/scripts/probe-pandoc2.mjs`,
  `probe-slashes.mjs`, `probe-slashes2.mjs`. [E for each observation; "dead in real browsers" is [I]]
- `@^5/dist/plugin/notes.js` 404, `@^6/dist/plugin/notes.js` 200. [E]

cdnjs (`https://cdnjs.cloudflare.com/ajax/libs/reveal.js/<v>/<path>`; always version-pinned; file lists from api.cdnjs.com):
- 3.x: `js/reveal.min.js` (3.6.0; 3.9.2 has only `js/reveal.js`), `css/reveal.min.css`, `css/theme/black.min.css`,
  `lib/js/head.min.js` (in 3.6.0, not in 3.9.2), `plugin/markdown/marked.js`.
- 4.x/5.x: **`dist/` is flattened**: `reveal.min.js`, `reveal.min.css`, `reveal.esm.min.js`, `theme/black.min.css`,
  `plugin/markdown/markdown.min.js`, `plugin/highlight/monokai.min.css`. `dist/reveal.js` is 404 on every version.
- 6.0.2: `reveal.min.js`, `plugin/markdown.min.js`, `plugin/highlight.min.js`, `plugin/notes.min.js`; **no `.mjs`/ESM
  build at all**; `plugin/markdown/markdown.min.js` 404. `plugin/<n>/plugin.js` exists but is ESM source.
- `plugin/notes/notes.html` / `speaker-view.html`: 403 on every version.

esm.sh: `https://esm.sh/reveal.js` and `/reveal.js@6.0.2/plugin/markdown` resolve through `exports`; old deep paths 404. [E]

What actually happens in a browser (`$P/out/probe-cdn.txt`, `$P/out/probe-cdn3.txt`) [E]:

| Deck style | Result today |
|---|---|
| jsDelivr / unpkg / cdnjs pinned 3.6.0, 3.9.2, 4.6.1, 5.2.1; ranges `@3`, `@4`, `@5` | works |
| jsDelivr none/`@latest` + 4.x paths | works (6.0.2 core + 5.2.1 plugins) |
| jsDelivr none/`@latest` + ESM 5.x paths | works (5.2.1 JS + 6.0.2 CSS) |
| unpkg none + 4.x paths | **dead**: `RevealMarkdown is not defined`, 3 x `net::ERR_BLOCKED_BY_ORB` |
| unpkg none + ESM 5.x paths, esm.sh old path | **dead**: 404 -> CORS error |
| cdnjs 6.0.2 + 4.x paths | **dead**: `RevealMarkdown is not defined` |
| jsDelivr or unpkg none/`@latest` + 3.x paths | **dead**: `Cannot use import statement outside a module`, `Reveal is not defined` |
| cdnjs 6.0.2 + 6.x paths, jsDelivr 6.0.2 + 6.x paths | works |

---------------------------------------------------------------------------------------------------

## 2. Anatomy of real decks

### 2.1 Canonical `index.html`
6.x (identical in npm 6.0.2 and git tag 6.0.2) [P]:
```html
<link rel="stylesheet" href="dist/reset.css" /><link rel="stylesheet" href="dist/reveal.css" />
<link rel="stylesheet" href="dist/theme/black.css" /><link rel="stylesheet" href="dist/plugin/highlight/monokai.css" />
<div class="reveal"><div class="slides"><section>Slide 1</section><section>Slide 2</section></div></div>
<script src="dist/reveal.js"></script><script src="dist/plugin/notes.js"></script>
<script src="dist/plugin/markdown.js"></script><script src="dist/plugin/highlight.js"></script>
<script>Reveal.initialize({ hash: true, plugins: [RevealMarkdown, RevealHighlight, RevealNotes] });</script>
```
4.x/5.x: same with `plugin/notes/notes.js`, `plugin/markdown/markdown.js`, `plugin/highlight/highlight.js`,
`plugin/highlight/monokai.css`. 3.9.2: `css/reveal.css`, `css/theme/black.css`, `lib/css/monokai.css`, a print-CSS
loader script, `js/reveal.js`, and `Reveal.initialize({ hash: true, dependencies: [{ src: 'plugin/markdown/marked.js' }, ...] })`.
Note: **`hash: true` and a first slide without an id are in the official 3.9.2, 4.x, 5.x and 6.x templates**
(3.8.0 had neither `hash` nor `history`; 3.6.0/3.7.0 still loaded `lib/js/head.min.js`). [E]

### 2.2 What the two AI decks in the shared corpus do [E, read-only look at `research/corpus/naive`]
- `n1-reveal-zip/double-slit-presentation` (agent with npm): `vendor/reveal/dist/reveal.js` 6.0.2 + `dist/plugin/{notes,math}.js`,
  `RevealMath.KaTeX` with `katex: { local: 'vendor/katex' }`, `hash: true`, `css/deck.css`, `js/simulation.js` (8 canvases).
  Works from file:// (ready, 36 KaTeX nodes). 37 files, 0.88 MB zipped.
- `n2-reveal-chat-nonet` (chat model): jsDelivr **pinned** `reveal.js@5.2.1` with 5.x paths, `RevealMath.KaTeX` from CDN,
  `hash: true`, `css/custom.css`, `js/relativity-demo.js`; its README tells the teacher to press F and S.

### 2.3 What is fetched at runtime (beyond the tags in the HTML)

| Feature | Fetch | Mechanism | Source |
|---|---|---|---|
| External Markdown `<section data-markdown="slides.md">` | the `.md` file | `XMLHttpRequest` GET; `status === 0` is treated as success | 6.0.2 `plugin/markdown/plugin.js:263-305` [P] |
| `RevealMath` (default = MathJax 2) | `https://cdn.jsdelivr.net/npm/mathjax@2/MathJax.js?config=TeX-AMS_HTML-full` then config, fontdata, woff fonts (7 requests for two formulas; resolves to 2.7.9) | script injection | `plugin/math/mathjax2.js:60` [P][E] |
| `RevealMath.KaTeX` | `https://cdn.jsdelivr.net/npm/katex@latest/dist/katex.min.css`, `katex.min.js`, `contrib/auto-render.min.js` (+ `mhchem`), then KaTeX fonts; `katex.local` replaces the base URL | link + script injection | `plugin/math/katex.js:62-74` [P][E] |
| `RevealMath.MathJax3` / `.MathJax4` | `https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js` / `mathjax@4/tex-mml-chtml.js` (+ fonts) | script injection | `mathjax3.js:62`, `mathjax4.js:62` [P] |
| Themes beige, league, moon, solarized (Lato), blood (Ubuntu), night (Montserrat, Open Sans), simple (News Cycle, Lato), sky (Quicksand, Open Sans) | `@import` from `fonts.googleapis.com` (then gstatic) | CSS | grep of `dist/theme/*.css`, identical list in 3.9.2, 4.6.1, 5.2.1, 6.0.2 [E] |
| Themes black, white, *-contrast (Source Sans Pro) | 3.x-5.x: local font files via `@import url(./fonts/...)`; 6.x: none (base64) | CSS | [E] |
| Highlight theme | only monokai + zenburn ship; other highlight.js themes are usually a cdnjs/jsDelivr `<link>` | - | [E] |
| Speaker view | 3.x: `window.open(<dir of notes.js>/notes.html)`; 4.x+: `window.open('about:blank')` + `document.write(inlined HTML)`; the popup then loads the deck URL twice in iframes with `?receiver&progress=false&history=false&transition=none&autoSlide=0&backgroundTransition=none&scrollActivationWidth=false&postMessageEvents=true#/h/v` | popup + iframes | 3.9.2 `plugin/notes/notes.js:24-29`; 6.0.2 `plugin/notes/plugin.js:32-34`, `speaker-view.html` `setupIframes` [P] |
| Lazy media | `img|video|audio|iframe[data-src]`, `source[data-src]` copied to `src` when the slide is within `viewDistance` (3; mobile 2); iframes only when visible unless `data-preload`/`preloadIframes` | attribute copy | `js/controllers/slidecontent.js:84-125` [P] |
| Backgrounds | `data-background-image` (comma list; a single `data:` URI is special-cased since at least 4.6.1, not in 4.0.0), `data-background-video` (always split on commas: **a `data:` URI breaks, use `blob:`**), `data-background-iframe`, `parallaxBackgroundImage` config | style / created elements | `slidecontent.js:136-200` [P], dist grep [E] |
| Lightbox / previews | `data-preview-image`, `data-preview-video`, `data-preview-link` (iframe) | overlay | `js/controllers/overlay.js` [P] |
| 3.x-style `dependencies` | every `src` | script injection by core | `js/controllers/plugins.js:35-90` [P] |
| YouTube/Vimeo iframes | autoplay/pause via postMessage to the iframe | - | 3.9.2 `js/reveal.js:4176-4233` [P] |

URL-bearing attributes a rewriter must know: `src`, `href`, `poster`, `data-src`, `data-background-image`,
`data-background-video`, `data-background-iframe`, `data-background` (legacy), `data-preview-image`, `data-preview-video`,
`data-preview-link`, `data-markdown="<file>"`, CSS `url()` / `@import`, and **Markdown image syntax inside
`<textarea data-template>`** (only becomes `<img>` at runtime, so static HTML rewriting misses it). [P][I]

---------------------------------------------------------------------------------------------------

## 3. Opening a deck from file:// (double-click) [E]
Script: `$P/scripts/probe-decks.mjs`, decks in `$P/decks`, output `$P/out/probe-local*.json`.

| Deck | file:// | http:// |
|---|---|---|
| classic UMD, local files: 3.9.2 (dependencies loader), 4.6.1, 5.2.1, 6.0.2 | works (Markdown, highlight, images, hash) | works |
| AI deck n1 (local vendor + `katex.local`) | works, 13 requests | works |
| external Markdown (6.0.2) | `Reveal.isReady()` true but **1 empty slide, no error slide**. Console: `Access to XMLHttpRequest at 'file:///.../slides.md' from origin 'null' has been blocked by CORS policy: Cross origin requests are only supported for protocol schemes: chrome, chrome-untrusted, data, http, https.` (status 0 counts as success, empty text) | 4 slides |
| ES modules (`import Reveal from './dist/reveal.mjs'`) | nothing initialises. Console: `Access to script at 'file:///.../dist/reveal.mjs' from origin 'null' has been blocked by CORS policy ...` | works |
| speaker view (S) on 3.9.2, 5.2.1, 6.0.2 | popup opens and connects (notes shown) in Chromium 158, although the docs say "When used locally, this feature requires that reveal.js runs from a local web server" | works |
| CDN decks | same result as over http (needs network) | - |

- MDN: "Many browsers, including Firefox and Chrome, now treat all local files as having opaque origins (by default) ...
  fetch(), XMLHttpRequest, Web Fonts (@font-face), WebGL textures" fail from file://
  (https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS/Errors/CORSRequestNotHttp). [P] Firefox/Safari not run here.
- So the file:// pain is real only for external Markdown, ES modules, `fetch`/XHR-driven content (chart CSV, loadcontent,
  external code) and for anything on a CDN when offline or when the CDN path has rotted (section 1.4). [I]

---------------------------------------------------------------------------------------------------

## 4. Runtime APIs for a host application

### 4.1 Initialisation facts [P: 6.0.2 `js/reveal.js`, `js/index.ts`, `js/config.ts`]
- `config = { ...defaults, ...configure() calls, ...constructor options, ...initialize options, ...query string }`
  (`js/reveal.js:151`): **query parameters override the deck's own config** (`?controls=false&transition=none`);
  `dependencies` is excluded. A blob URL cannot have a query (4.4).
- `Reveal.initialize(opts)` (global singleton API) does `Object.assign(Reveal, new Deck(el, opts))` then `initialize()`;
  returns a promise resolved by the `ready` event. `new Reveal(el, opts)` for several decks on one page.
- Defaults that matter: `hash: false`, `history: false`, `respondToHashChanges: true`, `fragmentInURL: true` (false in 3.x),
  `embedded: false`, `keyboardCondition: null` (`'focused'` or a function), `postMessage: true`, `postMessageEvents: false`,
  `view: null` (`'print'`, `'scroll'`), `scrollActivationWidth: 435`, `scrollLayout: 'full'`, `scrollSnap: 'mandatory'`,
  `scrollProgress: 'auto'`, `pdfMaxPagesPerSlide: Infinity`, `pdfSeparateFragments: true`, `pdfPageHeightOffset: -1`,
  `showNotes: false`, `preloadIframes: null`, `viewDistance: 3`, `autoSlide: 0`, `width: 960`, `height: 700`.
- `embedded: true` makes `.reveal` (not `body`) the viewport; size comes from the element; call `Reveal.layout()` after resizing
  (https://revealjs.com/presentation-size/).
- Public API of 6.0.2 (from the API object): initialize, configure, destroy, sync, syncSlide, syncFragments, slide, left/right/up/down,
  prev/next, prevFragment/nextFragment, navigateFragment, on/off, layout, shuffle, availableRoutes, availableFragments, toggleHelp,
  toggleOverview, toggleScrollView, togglePause, toggleAutoSlide, toggleJumpToSlide, isFirstSlide, isLastSlide, isPaused,
  isAutoSliding, isSpeakerNotes, isOverview, isFocused, isOverlayOpen, isScrollView, isPrintView, isReady, loadSlide, unloadSlide,
  previewIframe/Image/Video, hidePreview, getState, setState, getProgress, getIndices, getSlidesAttributes, getSlidePastCount,
  getTotalSlides, getSlide, getCurrentSlide, getSlideNotes, getSlides, getHorizontalSlides, getVerticalSlides, addKeyBinding,
  removeKeyBinding, triggerKey, getComputedSlideSize, removeHiddenSlides, getScale, getConfig, getQueryHash, getSlidePath,
  getRevealElement, getSlidesElement, getViewportElement, registerPlugin, hasPlugin, getPlugin, getPlugins.
- `Reveal.VERSION` exists in every major (3.9.2 "3.9.2", 4.6.1 "4.6.0", 5.2.1 "5.2.1", 6.0.2 "6.0.2"). [E]

### 4.2 postMessage API (exact format) [P https://revealjs.com/postmessage/ + source; E]
- In: `frameWindow.postMessage(JSON.stringify({ method: 'slide', args: [2, 1] }), '*')`. The data must be a **string**
  starting with `{` and ending with `}`; a posted object is ignored [E]. No origin check. Blacklist (6.0.2
  `js/utils/constants.ts`): `registerPlugin|registerKeyboardShortcut|addKeyBinding|addEventListener|showPreview|previewIframe`
  (console warning `reveal.js: "registerPlugin" is is blacklisted from the postMessage API`).
- Out (only if `postMessageEvents` is true and the deck is in a frame), to `window.parent` only, as a JSON string:
  `{"namespace":"reveal","eventName":"slidechanged","state":{"indexh":0,"indexv":0,"indexf":0,"paused":false,"overview":false}}`.
- Return values: after every method call a `callback` event:
  `{"namespace":"reveal","eventName":"callback","state":{...},"method":"getTotalSlides","result":9}`. Also gated by `postMessageEvents`.
- Remote enabling works: `{"method":"configure","args":[{"postMessageEvents":true}]}` then produced a `sync` event and
  `callback:configure` [E]. Without it: 0 messages [E].
- Measured results inside `sandbox="allow-scripts"` (`$P/out/probe-sandbox-6.json`, test T5) [E]:
  `getState` -> `{"indexh":2,"indexv":0,"indexf":-1,"paused":false,"overview":false}`; `getTotalSlides` 9; `getProgress` 0.375;
  `getSlidePastCount` 3; `getIndices`; `isLastSlide`; `availableRoutes` `{"left":true,"right":true,"up":false,"down":false}`;
  `availableFragments`; `getSlidesAttributes` (array of attribute maps); `getSlideNotes` -> `"<p>markdown speaker note</p>\n"`
  and `"Speaker note for title slide."`; `getConfig`; `setState` restored `{indexh:3,indexf:0}`; `getCurrentSlide` is useless
  (a DOM node serialises to `{"slideBackgroundElement":{},...}`). Events seen: `beforeslidechange`, `slidechanged`,
  `fragmentshown`, `fragmenthidden`, `overviewshown`, `overviewhidden`, `slidetransitionend`, `sync`.
- Present with the same shape in 3.9.2 (`js/reveal.js:1260-1292`, `2004-2017`). [P]
- With several instances on one page every instance has its own `message` listener, so one command drives all of them. [I]
- Security history: 5.0.5 "Fixed a postMessage XSS exploit", 6.0.1 blacklisted `previewIframe`, 6.0.2 "Fixed cross-origin XSS
  through the postMessage API by validating iframe preview URLs". Old decks carry old cores: keep them in an opaque or
  separate origin. [P]

### 4.3 Events without the Reveal object [P][E]
`dispatchEvent` creates an `HTMLEvents` event with `bubbles = true` on `.reveal` (`js/reveal.js:746-760`; 3.9.2 `:1990-1995`).
`document.addEventListener('ready' | 'slidechanged' | 'fragmentshown' | 'fragmenthidden' | ...)` therefore works in an injected
script; `slidechanged` carries `indexh`, `indexv`, `currentSlide`, `previousSlide`. Used by the live-edit agent on 4.6.1, 5.2.1
and 6.0.2 [E]. Decks loaded through RequireJS (nbconvert) or ES modules have **no `window.Reveal`**.

### 4.4 Opaque-origin sandbox matrix (plain `<iframe sandbox="allow-scripts">`, blob: document, 6.0.2) [E]
Harness `$P/www/generic.html`, script `$P/scripts/probe-sandbox.mjs`, output `$P/out/probe-sandbox-6.{json,txt}`.

| Feature | Result |
|---|---|
| init, Markdown, highlight, images as data URIs | ok (`self.origin === 'null'`) |
| `hash: true`, first slide has an id | ok; fragment-only `replaceState('#/bg')` is allowed |
| `hash: true`, first slide has no id | **uncaught `SecurityError: Failed to execute 'replaceState' on 'History': A history state object with URL '...' cannot be created in a document with origin 'null' and URL 'blob:...'`**, thrown inside `start()`: `Reveal.isReady()` is true but the `ready` event never fires, `.reveal.ready` is never set, `.slides.no-transition` stays, the `initialize()` promise never resolves |
| same in `srcdoc` | worse: every hash write throws (base URL is the parent's), `Reveal.slide()` throws synchronously |
| `history: true` | no exception; console `Not allowed to load local resource: blob:...#/code`; hash never changes; Back does nothing |
| deep link `blob:...#/3/0/1`, `#/code` | ok (lands on the slide/fragment at init) |
| `blob:...?view=scroll` | frame shows `chrome-error://chromewebdata/` (blob URLs cannot have a query) |
| arrows, space, fragments, overview (O/Esc), pause (B), help (F1), jump-to-slide (G) | ok |
| F (fullscreen) | without `allow="fullscreen"`: unhandled rejection `Disallowed by permissions policy` + console `Permissions policy violation: fullscreen is not allowed in this document.`; with `allow="fullscreen"`: works |
| S (speaker view) | no `allow-popups`: console `Blocked opening 'about:blank' in a new window because the request was made in a sandboxed frame whose 'allow-popups' permission is not set.` + uncaught `TypeError: Cannot set properties of null (setting 'marked')`. With `allow-popups`: blank popup + `Failed to set a named property 'marked' on 'Window': Blocked a frame with origin "null" from accessing a cross-origin frame.` With `allow-popups allow-same-origin`: popup renders but its iframes get `blob://http://127.0.0.1:4500/<uuid>?receiver&...` (broken) |
| `window.print()` | `Ignored call to 'print()'. The document is sandboxed, and the 'allow-modals' keyword is not set.`; with `allow-scripts allow-modals` `beforeprint` fires |
| `view: 'print'` as config | ok: `html.reveal-print.print-pdf`, 14 `.pdf-page` elements |
| scroll view (`view: 'scroll'`, or frame width 400 px <= 435) | active, but uncaught `SecurityError: Failed to read the 'sessionStorage' property from 'Window'` (unguarded use in `js/controllers/scrollview.js:792-806`) |
| lightbox `data-preview-image` | ok; state gains `previewImage`, `previewFit` |
| internal link `<a href="#/code">` | ok |
| `data-preview-link` | creates an overlay iframe pointing at the external URL |
| auto-slide | ok |
| `sync()` after appending a `<section>`; `destroy()`; `initialize()` again; second `new Reveal(el, { embedded: true })` | ok |
| localStorage / sessionStorage / document.cookie | `SecurityError` on access |

### 4.5 The same decks through the site's real player [E]
Harness: `$P/www/site.html` imports an esbuild bundle of the repo's `src/lib/presentation-runtime.ts`
(`createPresentationPlayer`) and uses a copy of `public/presentation-sandbox.html`; inner frame URL is `blob:null/<uuid>`.
Scripts `$P/scripts/probe-site-chain.mjs`, `probe-site-chain2.mjs`, `probe-noid.mjs`, `probe-plugins.mjs`, `probe-real.mjs`.

| Case | Player result |
|---|---|
| folder `index.html` or CDN deck given as HTML | rejected before start: `This presentation has separate JavaScript files. Create a portable ZIP with the Slidev packaging tool before opening it.` |
| inlined 6.0.2 / 5.2.1 / 4.6.1 / 3.9.2 deck, first slide has an id | `ready` after 262 / 349 / 372 / 338 ms (1.8 - 4.0 MB documents) |
| inlined 4.6.1 / 5.2.1 / 6.0.2, `hash: true`, first slide without id | **error at startup**: `Failed to execute 'replaceState' on 'History': A history state object with URL '' cannot be created in a document with origin 'null' and URL 'blob:null/...'` |
| inlined 3.9.2 | fine with `hash: true`; **same fatal error with `hash: false`** (3.x default; it calls `replaceState(pathname + search)`, 3.9.2 `js/reveal.js:4440`) |
| any major with `history: true` | ready; console `Not allowed to load local resource: blob:null/...#/code` |
| press F | `error`: `Disallowed by permissions policy` (frame removed) |
| press S (RevealNotes) | `error`: `Uncaught TypeError: Cannot set properties of null (setting 'marked')`; on 3.9.2: `Cannot read properties of null (reading 'src')` |
| Esc | Reveal overview toggles and the host `onEscape` fires |
| frame 400 px wide | scroll view, no error (the player's storage shim covers sessionStorage) |
| league theme (Google Fonts `@import`) | `error`: `This presentation requested an unsupported resource (style-src-elem). Rebuild it with the portable Slidev packaging tool.` |
| `RevealMath.KaTeX` / `RevealMath` defaults | `error` (CSP `style-src-elem` / `script-src-elem`) |
| menu plugin inlined | `error`: `Failed to construct 'URL': Invalid URL` |
| chalkboard inlined | `error`: `A presentation resource could not be loaded...` |
| copycode inlined | `error` (CSP `script-src`) |
| mermaid plugin inlined (5.0 MB document) | **ready, SVG rendered** |
| pandoc 3.1.3 `--embed-resources` deck (reveal 4.6.1, 3.08 MB, all slides have ids) | **ready as-is** in 271 ms |
| same with `--mathjax` + league theme | `error` (resource could not be loaded) |
| AI deck n1 inlined (KaTeX via `katex.local`) | `error` (runtime `<script src="vendor/katex/...">` cannot resolve) |
| un-inlined `data-markdown="slides.md"` | ready, but the slide reads `ERROR: The attempt to fetch undefined failed with HTTP status undefined...` |
| Reveal postMessage API from the top page | not reachable: the runner relays only `qft-presentation-*` messages |
| ZIP level (`inspectPresentationArchive`, real code via tsx) | Reveal ZIP without `.md`: `This is a website build ZIP. Follow tools/slidev/README.md and use the QFT Slidev packaging tool ...`; Reveal ZIP containing any `.md` (external Markdown deck, or the reveal.js repo with README.md): returns `null` and falls through to the Markdown importer (`src/lib/presentation-package.ts:325-330`) |

Root causes in the player (`src/lib/presentation-runtime.ts`): `window 'error'`, `unhandledrejection` and
`securitypolicyviolation` are all fatal (`:127-134`); frames have `fullscreen 'none'` (`:67`, `:260`); no `allow-popups`.

### 4.6 Compat shim prototype [E]
`$P/www/reveal-compat-shim.js` (runs before deck scripts): wraps `History.prototype.replaceState/pushState` (retry with the
fragment only, else swallow), replaces `Element.prototype.requestFullscreen` (post a message, resolve), replaces `window.open`
with an inert stand-in (post a message), replaces `window.print`.
It posts `{qftReveal: 1, kind: 'fullscreen' | 'popup' | 'print'}` to its parent (the runner would have to relay these).
Result in the site chain: 4.6.1, 5.2.1, 6.0.2 decks without first-slide id reach `ready`; hash updates to `#/v1`; F and S no
longer kill the deck; `extmd6` (inlined) plays 4 slides. 3.9.2 still dies on S (`script[src$="notes.js"]` lookup) => the
error policy must also stop being fatal after `ready`.

### 4.7 Init-time overrides without touching deck code [E]
`$P/www/reveal-config-trap.js`: an accessor property on `window.Reveal` whose setter wraps `initialize` and merges overrides.
UMD builds assign `globalThis.Reveal = ...`, which triggers it. Verified on 4.6.1, 5.2.1, 6.0.2: `{hash:false, postMessageEvents:true,
scrollActivationWidth:null}` applied (no scroll view at 400 px); `{view:'print'}` gives 14 pdf pages on 5.2.1 and 6.0.2 and is
ignored by 4.6.1 (no `view` option). Not for 3.9.2 (`hash:false` is the fatal path there) and not for ESM/AMD decks.

### 4.8 Print / PDF
Official route: `?print-pdf` (or `?view=print` since 5.0), Chrome only, landscape, no margins, background graphics
(https://revealjs.com/pdf-export/) [P]. In a blob document: reload with `view: 'print'` (5.x/6.x) and call `window.print()`
from inside a frame that has `allow-modals` [E for the pieces]. `showNotes: true | 'separate-page'` prints notes.

### 4.9 Speaker view internals [P]
Handshake over `postMessage` with JSON strings in namespace `reveal-notes` (`connect` every 500 ms -> `connected` -> `state`
with `notes`, `markdown`, `whitespace`, `state`; `call`/`return` for API calls; `heartbeat` every second to reconnect after
reloads). The plugin only accepts messages whose `event.source.location.origin` equals its own (source comment: "added 12/5/22 as a XSS safeguard").
The popup drives the main window with plain Reveal postMessage (`setState`). Nothing here can cross an opaque origin.

---------------------------------------------------------------------------------------------------

## 5. Plugins and generators

### 5.1 Third-party plugins
The wiki lists 94 plugin entries (117 plugins) and 35 tools
(https://github.com/hakimel/reveal.js/wiki/Plugins,-Tools-and-Hardware, read via WebFetch) [P]. Packages inspected with
`npm pack` (`$P/plugins`), behaviour tested with reveal 6.0.2 (`$P/out/probe-plugins.txt`) [E]:

| Plugin (npm, version, last publish) | Shipped as | Global | Runtime behaviour | Folder over http | Inlined in sandbox |
|---|---|---|---|---|---|
| reveal.js-menu 2.1.0 (2022) | `menu.js`, `menu.esm.js`, `menu.css`, `font-awesome/**` (2.6 MB) | `RevealMenu` | finds its path via `document.currentScript`, injects `menu.css` + `font-awesome/css/all.css` (+ 2 woff2) | ok, 4 runtime requests | **`Failed to construct 'URL': Invalid URL`, Reveal never ready** |
| reveal.js-plugins 4.6.0 (2025-06; rajgoel): chalkboard, customcontrols, chart, anything, animate, audio-slideshow, poll, questions, seminar, loadcontent, fullscreen | `<name>/plugin.js` + css/img | `RevealChalkboard`, `RevealChart`, ... | chalkboard: `scriptPath()` + `img/*.png`, `sessionStorage`, XHR; chart/loadcontent/audio: XHR; anything/animate: `eval`; seminar/poll/questions: socket.io | chalkboard ok (4 images) | ready but images unresolved; fatal in the site chain |
| reveal.js-mermaid-plugin 11.15.0 (2026-05) | `plugin/mermaid/mermaid.js` 3.2 MB UMD (mermaid bundled) | `RevealMermaid` | none | ok | **ok, also under the site CSP** |
| reveal.js-copycode 1.4.2 (2026-02), -appearance 1.4.5 (2026-11), -simplemenu 2.2.0 (2026-09), -verticator 1.3.5 (2026-09) (Martinomagnifico) | `plugin/<n>/<n>.js|.mjs|.css` | `CopyCode`, `Appearance`, `Simplemenu`, `Verticator` | `cssautoload` through `document.currentScript` (`csspath` option), clipboard API | ok (css fetched) | **Reveal never ready** (plain sandbox); CSP error in site chain |
| reveal.js-pointer 0.1.4, reveal.js-drawer 0.1.3 (2022) | `dist/<n>.js`, `.esm.js`, `.css` | `RevealPointer`, `RevealDrawer` | css is a normal `<link>` | not run | not run |
| Quarto-bundled: reveal-menu, reveal-chalkboard, pdf-export, quarto-line-highlight, quarto-support, multiplex | inside `<name>_files/libs/revealjs/plugin/` | - | as above | - | - |

Rule of thumb: self-contained single-file plugins survive inlining; anything with sibling CSS/images/fonts needs real URLs.

Wrappers: `@revealjs/react` 0.2.2 (peer `react >= 18`, `reveal.js >= 5`) describes decks as JSX (`<Deck>`, `<Slide>`, `<Stack>`,
`<Fragment>`, `<Code>`, `<Markdown>`) with CSS imports (`reveal.js/reveal.css`): source-only React decks need a bundler, exactly
like Slidev sources (README in the 6.0.2 tag, `react/README.md`). [P]

### 5.2 Generators that emit Reveal.js

| Tool (version checked) | Reveal version | Output | Playable from a ZIP? |
|---|---|---|---|
| **Quarto** 1.11.9 stable (2026-10-30), 1.12.3 prerelease | **5.1.0** bundled (1.3-1.5: 4.3.1); 4.x/5.x layout. Checked in quarto-cli at tags v1.3.450, v1.4.557, v1.5.57, v1.6.43, v1.11.9, main [P] | `deck.html` + `deck_files/libs/revealjs/{dist,plugin}/...`; `embed-resources: true` gives one HTML, but "math libraries like MathJax and KaTeX are not embedded by default" (`self-contained-math: true`) (https://quarto.org/docs/output-formats/html-publishing.html) [P] | folder: needs a folder-aware player; embedded: single HTML with inline scripts (same mechanism as pandoc) [I, Quarto not installed here] |
| **Pandoc** 3.14 (2026-11-10) | default `revealjs-url`: `https://unpkg.com/reveal.js@^6` since 3.12.1 (2026-10-07); `@^5` in 3.7 - 3.11; `@^4/` with trailing slash before 3.7; template uses `dist/plugin/*.js` since 3.12 (so 3.12.0 itself paired 6.x paths with `@^5`); MANUAL.txt still says `@^5` (pandoc `changelog.md`, `data/templates/default.revealjs`, `src/Text/Pandoc/Writers/HTML.hs:482`) [P] | one HTML pointing at unpkg; `--embed-resources` inlines everything | pandoc 3.1.3 (installed here): default output uses `@^4//` (404 for curl/Node, see 1.4), and `--embed-resources` embedded the 404 text as `data:text/plain` (deck dead: `Unexpected identifier 'found'`, `Reveal is not defined`) [E]. With `-V revealjs-url=https://unpkg.com/reveal.js@4.6.1 --embed-resources`: 3.08 MB HTML that plays in the site's sandbox unchanged [E] |
| **Jupyter nbconvert** 7.17.2 (`--to slides`) | pinned `https://unpkg.com/reveal.js@4.0.2` (`nbconvert/exporters/slides.py:131`) [P] | one `<nb>.slides.html`; loads jQuery 2.0.3 + RequireJS 2.1.10 + MathJax 2.7.7 + mermaid from cdnjs; `require([...reveal.js, ...notes.js], function (Reveal, RevealNotes) { Reveal.initialize({ history: true, plugins: [RevealNotes] }) })` (template `share/templates/reveal/index.html.j2`) | only with network or URL rewriting; **no `window.Reveal`** (AMD) |
| **RISE** (jupyterlab-rise 0.43.1) | live inside Jupyter | nothing to export | no |
| **reveal-md** 6.1.4 (2024-11) | reveal.js 5.1.0 dependency | `--static`: `index.html` + `dist/` + `plugin/` + `css/highlight/` + `_assets/`; one `<section data-markdown><textarea data-template>`; `history: true` | yes with a folder-aware player |
| **@asciidoctor/reveal.js** 6.0.1 (2026-11-05) | depends on reveal.js 6.0.2; 6.x paths; default `revealjsdir` = `node_modules/reveal.js` (`js/src/converter.js:249`) | one HTML + whatever `revealjsdir` points to | only if the ZIP includes that folder or a CDN is used |
| **org-re-reveal** 3.40.0 | `org-re-reveal-revealjs-version` "6", "4" (4.x/5.x), "3.8", "3"; root default `./reveal.js` | HTML + local reveal dir; `org-re-reveal-single-file` embeds | yes |
| **slides.com** "Download HTML" | "regular reveal.js presentation" | ZIP: `index.html`, a **`lib/` folder with the framework**, a media folder; images and built-in fonts bundled; embeds may need internet (https://slides.com/export-html) [P] | yes with a folder-aware player; note `lib/`, not `dist/` |
| R `revealjs`, sphinx-revealjs 3.2.1, vscode-reveal 4.3.3, mkslides 2.0.24, hugo/reveal-hugo | not checked [U] | folders or single file | - |
| decktape 3.17.0 | - | PDF exporter | - |

---------------------------------------------------------------------------------------------------

## 6. Detection heuristics

Prototype: `$P/www/detect-reveal.js` (`detectRevealDeck(files)`, 147 lines, uses `DOMParser`, executes nothing).
Test: `$P/scripts/test-detect.mjs`, output `$P/out/detect.txt` and `detect.json`. **36/36 positive samples recognised with
the right entry file, 3/3 negatives rejected** (plain page with `<section>`s, a Slidev build, the site's own `dist/`).
Cost: 0.3-5 ms for folders of 35-122 files, 45-82 ms for 1.8-3.8 MB single files. [E]

Is it a Reveal deck? (all three in the same HTML file)
1. Markup: `.reveal > .slides` (or `.reveal .slides`) with `<section>` descendants. Same in every version and generator.
2. A start call: `Reveal.initialize(`, `new Reveal(`, or an `.initialize({ ... plugins|hash|controls ... })` (covers aliases and AMD).
3. The core: a `<script src>`, `import` or string literal ending in `reveal(.min).js`, `reveal.esm(.min).js`, `reveal.mjs`
   (any directory: `dist/`, `js/`, `lib/`, `vendor/reveal/dist/`, `_files/libs/revealjs/dist/`, cdnjs root), a bare
   `reveal.js` package URL (esm.sh, jsDelivr), or the inlined banner (`reveal.js ... MIT licensed ... Hakim El Hattab`).
Markup alone is not enough (the site's own pages contain similar class names).

Entry file when there are several HTML files (score, highest wins; show a chooser when the top scores tie):
+10 markup, +6 start call, +4 core reference, +2 `reveal.css`, +3 named `index.html`, +2 named slides/presentation/deck/talk
or `*.slides.html`, +up to 3 for the number of sections, -0.5 per directory level, -12 inside `node_modules|test|tests|examples|__MACOSX`,
-20 for `plugin/notes/notes.html`, `speaker-view.html`, `plugin/markdown/example.html`, -8 stock `demo.html`,
-6 untouched starter (`<section>Slide 1</section><section>Slide 2</section>`).
Cases covered: reveal repo clone with the user's deck as `index.html` (26 vs `demo.html` 17), nested top folder
(`my-talk/Presentation.html`), 3.9.2 package with `test/*.html`, folder with six decks and no index (tie -> chooser).

Version:
- Local core file: **every build from 3.9.2 to 6.0.2 (UMD, ESM, cdnjs-minified) contains exactly one semver string literal**
  (two identical ones in 4.0.0) and it equals `Reveal.VERSION`; 3.x also matches `VERSION = '3.9.2'`. 6.x has no version in
  the banner. Caveat: the 4.6.1 files say 4.6.0; the 5.2.1 banner says 5.2.0 but the literal says 5.2.1. [E]
- `package.json` with `"name": "reveal.js"` next to the files.
- CDN URL: `reveal.js@4.3.1`, `/reveal.js/4.3.1/`, ranges `@^5`, or none (= latest; on jsDelivr a per-file mix).
- Layout when nothing else: `dist/plugin/<n>.js` or `.mjs` => 6; `dist/reveal.js` + `plugin/<n>/<n>.js` => 4 or 5;
  `js/reveal.js` + `css/reveal.css` or `head.min.js` => 3 or older; `dependencies: [{ src` => 3-style loader.
- At runtime: `Reveal.VERSION` (not available for ESM/AMD decks).

Useful diagnostics the prototype already emits: `v4-plugin-paths-on-v6`, `missing-local-file`, `file-case-mismatch`,
`unpinned-cdn`, `unpinned-cdn-old-path-404` (unpkg/esm.sh), `unpinned-cdn-version-mix` (jsDelivr), `cdn-double-slash`,
`embedded-resource-is-error-page`, `external-markdown-needs-http`, `es-modules-need-http`, `math-plugin-loads-cdn`,
`google-fonts`; plus features (plugins, AMD, ESM, math flavour, hash/history/view, notes, lazy media, backgrounds, iframes)
and generator (`meta[name=generator]` quarto/pandoc/asciidoctor, `body.jp-Notebook`, `.sl-block`, reveal-md shape).

---------------------------------------------------------------------------------------------------

## 7. Live editing

Prototype: host `$P/www/live.html`, in-frame agent `$P/www/live-agent.js`, runner `$P/scripts/measure-live.mjs`
(12 measured edits after 2 warm-ups), cross-version check `$P/scripts/check-live-old.mjs`, screenshots
`research/shots/B1-live-*.png`. Deck: reveal 6.0.2 + markdown + highlight + notes inlined, sandbox `allow-scripts`, blob URL.
Each edit changes the text of the slide being viewed (slide 12 of 20 or 152 of 200, fragment index 1).
Round trip = host call until the frame reports after two animation frames. [E]

| Strategy | 20 slides (1.77 MB) | 200 slides (1.81 MB) | 20 slides + 12 JPEGs (8.75 MB) | Position + text kept |
|---|---|---|---|---|
| A1 rebuild document, new iframe, restore with `blob:...#/h/v/f` | median 186 ms (p90 186) | 235 (p90 253) | 469 (p90 485) | 12/12 |
| A2 same, new frame hidden until `ready`, then swap (no blank flash) | 170 (p90 187) | 219 (p90 237) | 454 (p90 526) | 12/12 |
| B1 replace `.slides` innerHTML + re-run plugins + `sync()` + `slide(h,v,f)` | 20.7 (DOM work 10.7) | 53.6 (46.7) | 99 (55.5) | 12/12 |
| B2 replace only changed top-level `<section>`s (keyed) + same | 20.5 (DOM work 4.7) | 29.7 (21.3) | 72 (14.4) | 12/12 |
| C replace one `<style>` text + `layout()` | 20.6 (0.9) | 20.4 (2.1) | 21 (0.9) | 12/12 |

- A1, B1, B2 also 6/6 on 4.6.1 and 5.2.1 with the same agent code; Markdown and highlighted code re-render correctly
  (visual check in the screenshots: line-highlight fragment state survives the swap). [E]
- How B works: `Reveal.getPlugin('markdown').processSlides(slidesEl)` then `.convertSlides()` (only touches
  `[data-markdown]:not([data-markdown-parsed])`; `slidify(text, opts)` is also exposed for external `.md` files);
  highlight has no per-block entry point that does the trimming/escaping, so the agent calls
  `getPlugin('highlight').init({ getConfig, getRevealElement: () => newSection, on() {} })` scoped to the new section;
  then `Reveal.sync()` (rebinds, re-creates backgrounds, re-applies slide classes) and `Reveal.slide(h, v, f)` because
  `currentSlide` is otherwise a detached node. Keys: a `data-qft-src` attribute survives Markdown expansion because the
  plugin forwards unknown attributes; the agent follows the viewed slide by key when slides are inserted above it
  (index 12 -> 13, same slide shown). [E][P]
- Limits of B: listeners that deck scripts attached to replaced nodes are gone (canvas demos, custom widgets, most
  third-party plugins); math needs a re-typeset call per engine; `data-visibility="hidden"` slides were removed at
  init; changes outside `.slides`/`<style>` (init options, scripts, plugin list) need a reload anyway. [I]
- Limits of A: every reload re-parses the whole document (cost grows with inlined media); state must be known before the
  reload (track `slidechanged`/`fragment*` events or ask `getState`); 3.x has `fragmentInURL: false` by default so the
  fragment needs `setState` after `ready`; overview/paused state is not in the hash (use `setState`). [E][P]
- Restore matrix (`$P/scripts/probe-hash-restore.mjs`, `$P/out/probe-hash-restore.txt`) [E]: `blob:...#/2` lands on slide 2 at
  init on 3.9.2, 4.6.1, 5.2.1 and 6.0.2, with `hash: true` and with `hash: false` (the hash is always read in `start()`);
  `blob:...#/0/0/1` restores fragment 1 on 4.6.1/5.2.1/6.0.2 but not on 3.9.2 (`f: -1`); `Reveal.setState({indexh, indexv,
  indexf})` after `ready` restores the fragment on all four.
- "Follow the cursor" is cheap in both: top-level `<section>` index = horizontal slide; nested = vertical; for Markdown
  count matches of `data-separator` (default `\r?\n---\r?\n`) and `data-separator-vertical` before the caret. [I]

---------------------------------------------------------------------------------------------------

## 8. Alternative tested: service-worker "player origin" [E]

Prototype: site page `$P/www/vfs-site.html` (port 4500) unzips with fflate, posts the files to a hidden bootstrap page on a
second origin (`$P/sandbox-origin/sw-host.html`, port 4502) which stores them in Cache Storage; `sw.js` serves
`/vfs/<id>/<path>` (query ignored) with `Content-Security-Policy: default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:;
connect-src 'self'`. Deck frame: `sandbox="allow-scripts allow-same-origin allow-popups allow-modals"`, `allow="fullscreen"`.
Runner `$P/scripts/probe-vfs.mjs`, output `$P/out/probe-vfs.{json,txt}`.

**15/15 runs ready (13 decks from 9 unmodified ZIPs)**: 6.0.2, 5.2.1, 4.6.1 (`?print-pdf` -> 14 pages on 6.0.2 and 4.6.1), 3.9.2 (S opens
`plugin/notes/notes.html`), external Markdown (4 slides), ES modules, menu (button + CSS), chalkboard (4 images), copycode
(2 buttons), mermaid, AI deck n1 (36 KaTeX nodes, 8 canvases), repo-style nested ZIP (`reveal.js-master/demo.html`, 41 slides),
`#/3` deep link, hash updates without any shim, F fullscreen, speaker popup with both preview iframes `ready=true`, and the
Reveal postMessage API straight from the site page (`callback:getSlideNotes`, `slidechanged`).
CDN requests are blocked by the injected CSP (KaTeX default: deck ready, formulas raw).
Cost: unzip 41-600 ms (0.9-5.7 MB ZIPs, synchronous fflate), store 23-286 ms, load 145-380 ms.
With `sandbox="allow-scripts"` only, the navigation is not intercepted (404; `navigator.serviceWorker` throws SecurityError):
the approach requires `allow-same-origin` towards an origin that is **not** the editor's origin.
Not examined here: second-origin hosting on GitHub Pages, cross-deck isolation on the player origin, exfiltration through
popups/self-navigation, Safari/Firefox behaviour. [U]

---------------------------------------------------------------------------------------------------

## 9. Recommendations for the site (details in the structured result)
1. Stop treating runtime errors as fatal after `ready`; add the compat shim; neutralise remote `@import`.
2. Recognise Reveal decks (ZIP folder or single HTML) with the detector; give Reveal-specific messages.
3. Give decks a URL space (service-worker player origin) or, if a second origin is unacceptable, a rewriting bundler
   plus a runtime resolver; inlining alone cannot run third-party plugins, `katex.local`, dependencies loaders.
4. Vendor reveal.js 3.9.2 / 4.6.1 / 5.2.1 / 6.0.2 (about 9 MB raw, 4.7 MB gzip, fetched on demand) and rewrite reveal CDN
   URLs to it, normalising rotten paths; decide a policy for other CDNs (KaTeX, MathJax, fonts, highlight themes).
5. Relay Reveal's postMessage protocol through the runner: slide counter, notes panel, follow-cursor, state restore.
6. Live edit: buffered reload + hash restore first; keyed in-place swap as a fast path for slide-content edits.
7. PDF: `view: 'print'` override (5.x/6.x) or `?print-pdf` (URL space) + `allow-modals` + in-frame `print()`.
8. Speaker view: host-rendered console from `getSlideNotes`; never rely on the built-in popup inside blob/opaque frames.
9. AI prompt + starter ZIP with vendored 6.0.2 and the 6.x path table; point models at https://revealjs.com/llms.txt.
10. Decide what narrow panes do (`scrollActivationWidth`).

## 9b. Method caveats
- Chromium 158 headless only. Timings are from a 4-CPU container; treat them as relative.
- Public-network requests made by Chromium in this container arrive with `//` collapsed to `/` (curl and Node `fetch` keep it).
  Only the pandoc double-slash URL is affected; every other CDN result was identical between curl and Chromium.
- The site-chain tests bundle `src/lib/presentation-runtime.ts` from the current checkout with esbuild and use a copy of
  `public/presentation-sandbox.html`; the ZIP test calls the real `inspectPresentationArchive` through tsx.
- `$P/scripts/inline-deck.mjs` is a deliberately naive regex inliner used only to feed the sandbox tests; it is not a design.
- Vendoring estimate: UMD + CSS + woff per major = 1,619,179 (3.9.2) + 1,775,843 (4.6.1) + 1,827,355 (5.2.1) + 3,741,327 (6.0.2)
  = 8.96 MB raw, 4.74 MB gzip -9. 6.0.2 is large because 8 theme files embed fonts as base64 (4 x 575 KB + 4 x 46 KB).

## 10. Open questions
- Firefox and Safari: blob documents in opaque frames, `replaceState` rules, service-worker control of sandboxed frames.
- Real frequency of each AI pattern (CDN pinned vs unversioned vs local vendor) - needs the corpus agents' numbers.
- Quarto `embed-resources` decks and slides.com exports were not run (Quarto not installed, no account).
- PDF for 4.x decks in a blob document (no `view` option) and for 3.x (needs `css/print/pdf.css` + query).
- Cost of vendoring MathJax 2/3/4 versus allowing a CDN allowlist.

## 11. Artifact index
- Packages: `$P/pkgs/v{3.9.2,4.0.0,4.6.1,5.0.0,5.2.1,6.0.0,6.0.2}`; 6.0.2 plugin sources `$P/src602`; plugins `$P/plugins`; generators `$P/gen`.
- Decks: `$P/decks/{classic3,classic4,classic5,classic6,esm6,extmd6,paths5-on-6,plugins6,cdn,cdn3}`; inlined `$P/single/*.html`; ZIPs `$P/zips`.
- Scripts: `$P/scripts/{cdn-matrix.sh,make-decks.mjs,inline-deck.mjs,probe-decks.mjs,probe-sandbox.mjs,probe-site-chain.mjs,probe-site-chain2.mjs,probe-noid.mjs,probe-plugins.mjs,probe-trap.mjs,probe-print.mjs,probe-real.mjs,probe-speaker.mjs,probe-cdn3.mjs,probe-extmd-blob.mjs,probe-vfs.mjs,measure-live.mjs,check-live-old.mjs,test-detect.mjs,site-inspect.mts,static-server.mjs}`.
- Prototypes: `$P/www/{reveal-compat-shim.js,reveal-config-trap.js,detect-reveal.js,live-agent.js,live.html,generic.html,site.html,vfs-site.html}`, `$P/sandbox-origin/{sw.js,sw-host.html}`.
- Outputs: `$P/out/*` (txt + json for every probe).
- Rerun: `node $P/scripts/static-server.mjs $P/www 4500 &` and `node $P/scripts/static-server.mjs $P/sandbox-origin 4502 &`,
  then e.g. `node $P/scripts/probe-site-chain.mjs http://127.0.0.1:4500/site.html out.json`.
