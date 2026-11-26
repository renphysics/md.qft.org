# B2 — Slidev as it really is in November 2026 (@slidev/cli 53.1.0)

Scope: "accept an AI-made Slidev project ZIP, show it with interactions, let the user edit sources in the browser".
Date of work: 2026-11-24. Browser: Chromium 158 (Playwright, headless). Node v22.23.5, npm 10.9.9, 4 CPUs.
All prototypes and raw results: `../prototypes/B2/` (called `$B2` below).
Nothing in `<repo>` or in `research/shared/` was modified (`git status` clean at the end).

Labels: **[E]** verified empirically here · **[P]** primary source (installed package source, upstream source at tag v53.1.0, official docs, spec/MDN) · **[S]** secondary · **[I]** inferred · **[U]** uncertain.

Shorthand for source references:
- `serve.mjs` = `research/shared/slidev-starter/node_modules/@slidev/cli/dist/serve-CjzN30uY.mjs` (the bundled CLI, 3,418 lines; it keeps `// node/<file>.ts` markers).
- `upstream:` = `https://raw.githubusercontent.com/slidevjs/slidev/v53.1.0/` (tag exists; 78 CLI source files mirrored in `$B2/upstream-src/`).
- `client/` = `…/node_modules/@slidev/client/` (shipped as TypeScript/Vue source).

---

## 0. Conclusions an architect needs first

1. **A Slidev deck is a Vite application, not a document.** `slidev build` compiles Markdown → Vue SFC → JS with 22 Vite plugins in Node; the browser only runs the result. There is no official way to run that compile step without Node, and no official in-browser playground (sli.dev/new is StackBlitz WebContainers). [P][E]
2. **An ordinary `slidev build` output cannot be opened from a ZIP as-is**: not from `file://`, not from a `blob:` document, not in an opaque-origin sandbox, and (with the default base `/`) not from a sub-path. Each failure has a specific, mechanical cause (section 5). [E]
3. **But an ordinary build can be converted in the browser, without rebuilding, into something the current md.qft.org sandbox plays**: six textual patches + bundling the ES module graph. Verified for 7 build variants (history/hash/memory × base `/`, `./`, `/sub/deck/`), first in Node with the repo's packer, then **entirely in the browser** with esbuild-wasm running in a same-origin Worker under the site's present CSP (0.7–1.7 s per deck, section 6). This is the cheapest high-fidelity path for decks an AI agent has already built. It does **not** cover decks with Monaco (web workers, 37 MB, non-static dynamic imports). [E]
4. **Editing source and seeing the result without Node is feasible for a large, well-defined subset of Slidev**, by pairing (a) a *prebuilt generic Slidev client* whose slide list is filled in at runtime with (b) an *in-browser compiler* that reuses upstream code (parser, all Slidev markdown-it plugins, UnoCSS config) and re-implements only ~300 lines of Vite glue. Prototype result: the output is **DOM-identical and pixel-identical** to the real build for a 5-slide deck with KaTeX, v-clicks, Shiki click-highlighting and a TypeScript Vue component; 5/5 slides identical for a richer deck (images, layouts, slots, `<script setup>`, `<style>`, local TS import, UnoCSS utilities); 7/16 slides identical (and 4 more equivalent) for the official kitchen-sink starter. Compile time 0.07–1.4 s; compiler 708 KB gzip; no eval, no WebAssembly, runs under the site's current CSP. [E]
5. **What stays out of reach without Node/network**: themes and addons from npm, npm dependencies of components, `vite.config.ts`/`setup/*.ts`/`uno.config.ts`, Monaco, TwoSlash, PlantUML/Tweet/YouTube (remote by design), icons outside bundled sets, Google Fonts. These need either a fixed catalogue of prebuilt "packs", network access to a CDN, or a clear "rebuild with your AI tool" message. [E][I]
6. **Three policy facts about today's player matter more than any Slidev detail**: it kills a deck on any `securitypolicyviolation` or unhandled rejection; Slidev's defaults produce both (Wake Lock rejection; the official template's first slide has a remote background image). [E]
7. **A same-origin Worker is not bound by the page's `<meta>` CSP** (WebAssembly, `new Function`, `import(blob:)` all work there in Chromium 158; MDN documents this as the general rule). That is what makes wasm tooling possible without loosening the page policy. [E][P]

---

## 1. Architecture of Slidev 53.1.0

### 1.1 Packages (installed versions, `npm ls` in a fresh install) [E]

| Package | Version | What it is | Shipped as |
|---|---|---|---|
| `@slidev/cli` | 53.1.0 | CLI + Vite plugin set (Node only) | bundled ESM, `dist/serve-*.mjs` 124.7 KB + cli/build/export/pptx chunks; also `skills/` (agent skills) and `template.md` |
| `@slidev/client` | 53.1.0 | the Vue app: router, nav, clicks, layouts, built-in components, presenter, overview, drawings | **TypeScript + Vue source** (205 files, 1.4 MB; 109 `.vue`, 75 `.ts`, 15,678 lines) — compiled by the *user's* Vite on every build |
| `@slidev/parser` | 53.1.0 | `slides.md` → slides | ESM; entries `.`, `./core`, `./fs`, `./utils` |
| `@slidev/types` | 53.1.0 | types + `define*` helpers | ESM (0.6 KB of runtime) |
| `@slidev/theme-default` | 0.25.0 | layouts, styles, `slidev.defaults.fonts` | source |
| Vite | 8.3.8 (rolldown 1.2.19) | bundler | native binding per platform (16 builds incl. `@rolldown/binding-wasm32-wasi`) |
| Vue / vue-router / @vueuse/core | 3.5.46 / 5.5.1 / 15 | runtime | |
| markdown-exit | 2.1.3 | async markdown-it fork (via `unplugin-vue-markdown` 32.1.1) | |
| Shiki | 4.6.0 | highlighting, **JavaScript regex engine** at build time (`createJavaScriptRegexEngine`, serve.mjs:982-986) | |
| UnoCSS | 66.13.0 | CSS engine (presetWind3 + attributify + typography + icons) | |
| KaTeX 0.19.1, `@comark/markdown-it` 0.4.0, Mermaid 12.3.0, Monaco 0.57.0 | | | |

`@slidev/cli` engines: `node >=22.22.0`; client/parser/types: `>=22.12.0`; the docs still say "Node.js >= 22.12.0" (https://sli.dev/guide/). [P]

Upstream CLI source at the tag: 10,017 lines in 78 files — pptx export 3,106; cli/options/resolver/utils 1,699; **Vite plugins 1,696 (22 files)**; **markdown syntax 1,045 (16 files)**; commands 987; MCP 498; setups 375; virtual modules 338 (`$B2/upstream-src/lines.txt`). [E]

### 1.2 What runs in Node at build time [P]

`ViteSlidevPlugin()` returns 22 plugins (serve.mjs:3358-3383): slides loader, MCP, markdown, layout wrapper, context injection, Vue + Vue JSX, slide import guard, HMR patch, unplugin-vue-components, unplugin-icons, remote assets, server-ref, config, Monaco types loader, Monaco writer, compiler flags, UnoCSS, static copy, inspect, Monaco source-map patch, PWA, user `setup/vite-plugins.ts`.

Pipeline for one slide:
1. `@slidev/parser/fs` `load()` reads the entry and follows `src:` imports (uses `node:fs`).
2. Virtual module `/@slidev/slides` lists the slides: per slide a static import of `/@slidev/slides/N/frontmatter` and a lazy `import('/@slidev/slides/N/md')` wrapped in `defineAsyncComponent` (serve.mjs:1436-1469). Exported as a **`shallowRef`** — the client reads `slides.value`.
3. The slide Markdown goes through `unplugin-vue-markdown` (`createMarkdownExit({html, linkify, typographer, xhtmlOut, quotes})` + `@mdit-vue/plugin-component`) with Slidev's plugins, in this order (serve.mjs:2531-2550, upstream: `packages/slidev/node/syntax/index.ts`): snippet (`<<<`, reads files), Shiki, code-block transformers (mermaid → `<Mermaid code-lz>`, plantuml → `<PlantUml>`, magic-move → `<ShikiMagicMove steps-lz>`, monaco → `<Monaco>`, default → `<CodeBlockWrapper>`), link, inline-code `v-pre`, footnote, task lists, KaTeX (rendered to HTML **at build time**), v-drag, slot sugar (`::right::`), Comark/MDC (only if `comark`/`mdc`), `<style>` → `<style scoped>`, GitHub alerts. Output is a Vue SFC string.
4. `slidev:layout-wrapper` wraps the template in `<InjectedLayout v-bind="_frontmatterToProps($frontmatter,i)">` and injects `useSlideContext()` + `$clicksContext.setup()` (serve.mjs:666-707). `slidev:context-injection` does the same for user `.vue` files (431-477).
5. `@vitejs/plugin-vue` compiles the SFC; `unplugin-vue-components` resolves component tags from `client/builtin/` and `<root>/components/` (397-424); `unplugin-icons` turns `<carbon:arrow-right/>` into SVG components; UnoCSS scans everything and emits static CSS.
6. Other virtual modules: `#slidev/configs` (the resolved headmatter as JSON), `#slidev/title-renderer`, `#slidev/global-layers`, `#slidev/custom-nav-controls`, `#slidev/setups/{shiki,code-runners,monaco,mermaid,mermaid-renderer,main,root,routes,shortcuts,context-menu}`, `#slidev/conditional-styles`, `#slidev/monaco-types`, `#slidev/monaco-run-deps` (1262-1485).
7. `index.html` is generated with unhead (772-895): title, favicon, Google/Coollabs font link, `<link rel="preload" as="image">` for every image found in slides, `<meta property="slidev:version">`, and — if the deck uses `<Tweet>` / `<BlueSky>` — `<script async src="https://platform.twitter.com/widgets.js">` / `https://embed.bsky.app/static/embed.js` (788-789).
8. Build-time constants decide which client features exist at all (`getDefine`, 1092-1114): `__SLIDEV_HASH_ROUTE__`, `__SLIDEV_MEMORY_ROUTE__`, `__SLIDEV_FEATURE_DRAWINGS__`, `_PRESENTER__`, `_RECORD__`, `_BROWSER_EXPORTER__`, `_WAKE_LOCK__`, `_PWA__`, `_PRINT__`, `__SLIDEV_HAS_SERVER__`.

Node-only extension points a project may contain: `vite.config.*`, `setup/{shiki,katex,unocss,transformers,preparser,vite-plugins}.ts`, `uno.config.ts`, theme and addon packages (resolved from `node_modules`, serve.mjs:711-741 and `resolver-*.mjs`). All are loaded with `jiti` at build time.

### 1.3 What runs in the browser [P][E]

The Vue client: router (`createWebHistory` / `createWebHashHistory` / `createMemoryHistory`, `client/setup/main.ts:25-29`), navigation and click state, transitions, v-click/v-mark/v-drag/v-motion directives, layouts, built-in components, overview, presenter, notes, drawing (drauu), recording, timer. Rendered at runtime: Mermaid (from lz-compressed source), Monaco and its TypeScript workers, Magic Move animation, PlantUML (an `<img>` pointing at `plantUmlServer`, default `https://www.plantuml.com/plantuml`), Tweet/BlueSky/YouTube embeds. **Not** at runtime: Markdown, KaTeX, static code highlighting, UnoCSS, icons.

The Vue *template compiler* is not in a normal build (the `vue` chunk is 86 KB, has no compiler markers, and `new Function`/`eval` do not occur anywhere in the output). [E]

Origin-bound APIs the client touches at **module evaluation time**: `useLocalStorage` ×~25 (`client/state/storage.ts:49…`, `client/logic/dark.ts:6`); `BroadcastChannel` for presenter/viewer sync in serverless builds (`client/state/syncState.ts:22`, channel names `"<slidesTitle> - shared"` and `"<slidesTitle> - drawings"`); `navigator.wakeLock.request('screen')` on the play page (`client/composables/useWakeLock.ts`, enabled by default). [P][E]

### 1.4 Defaults that matter (`getDefaultConfig`, `parser/dist/core.mjs:7-63`) [P]

`routerMode: "history"` · `favicon: "https://cdn.jsdelivr.net/gh/slidevjs/slidev/assets/favicon.png"` · fonts via Google Fonts (`provider: "google"`; theme-default asks for Nunito Sans + Fira Code) · `monaco: true` (only bundled if a block uses `{monaco…}`) · `twoslash: true` · `presenter: true` · `wakeLock: true` · `drawings.enabled: true` · `record: "dev"` · `browserExporter: "dev"` · `mcp: true` · `pwa: false` · `remoteAssets: false` · `preloadImages: true` · `plantUmlServer: "https://www.plantuml.com/plantuml"`.

---

## 2. Which entry points are browser-safe (bundled with esbuild 0.27.2, `platform: browser`, minified) [E]

Command: `node $B2/tools/bundle-sizes.mjs $B2/cold-install` → `$B2/bundles/sizes.json`.

| Entry | min KB | gzip KB | Result |
|---|---:|---:|---|
| `@slidev/parser/core` (= `@slidev/parser`) | 112.3 | 36.0 | ok (101 KB of it is `yaml`) |
| `@slidev/parser/utils` | 2.3 | 1.1 | ok |
| `@slidev/parser/fs` | – | – | fails: `Could not resolve "node:fs"` — works once `node:fs` is aliased to an in-memory shim (done in the prototype; `src:` imports then work) |
| `@slidev/types` | 0.6 | 0.3 | ok |
| `@slidev/client` (`index.ts`, `main.ts`) | – | – | fails: `Could not resolve "#slidev/slides"` (36 errors) — needs Slidev's Vite plugins |
| `@slidev/client/context.ts` | 92 (raw) | | ok |
| `@slidev/cli` | – | – | fails, 370 errors (Node only) |
| `unplugin-vue-markdown` | – | – | fails (Node); its `createMarkdown` core is ~40 lines |
| markdown-exit | 109.2 | 37.0 | ok |
| `@comark/markdown-it` | 52.5 | 18.1 | ok |
| KaTeX | 261.9 | 75.4 | ok |
| Shiki core + JS engine | 170.6 | 55.6 | ok |
| Shiki full bundle (all grammars) | 9,572.7 | 1,616.7 | ok; split into ~390 lazy chunks when code-split |
| `@vue/compiler-dom` | 83.0 | 29.6 | ok |
| `@vue/compiler-sfc` (resolves to `compiler-sfc.esm-browser.js`) | 791.8 | 244.8 | ok |
| Vue full build (with runtime compiler) vs runtime-only | 186.2 vs 119.6 | 69.9 vs 46.6 | runtime compiler uses `new Function` (`vue.esm-bundler.js`) → needs `'unsafe-eval'` |
| UnoCSS core + wind3 + attributify + typography | 411.9 | 114.3 | ok |
| `unocss` umbrella package | – | – | fails (Node) |
| `@iconify-json/carbon` / `ph` | 1,111 / 4,290 | 307 / 917 | data only |
| Mermaid | 5,251 | 1,501 | ok |
| TypeScript (needed for TwoSlash) | 3,491 | 1,001 | ok |
| sucrase (TypeScript strip + ESM→CJS) | 201 | 46 | ok |

---

## 3. The build output of `slidev build` 53.1.0

### 3.1 Layout and size [E]

Small deck (5 slides: KaTeX, v-clicks, one Vue component, one code block; `research/shared/slidev-ordinary`): **106 files, 1.92 MB** — 31 JS (600 KB), 12 CSS (154 KB), 59 KaTeX fonts in woff2/woff/ttf (1.07 MB), `logo.png` 94 KB, `index.html` + identical `404.html` (1.3 KB), `_redirects` (`/*    /index.html   200`).

```
index.html, 404.html, _redirects
assets/index-<hash>.js|css          entry
assets/rolldown-runtime-<hash>.js
assets/modules/{vue,shiki,unplugin-icons,file-saver}-<hash>.js     (manualChunks, serve.mjs:598-604)
assets/slidev/{play,presenter,overview,notes,notes-edit,entry,404,shortcuts,env,md…}-<hash>.js   (client chunks)
assets/md-<hash>.js|css             slide chunks that include user components
assets/KaTeX_*.{woff2,woff,ttf}, assets/logo-<hash>.png
```
Module graph: 122 static edges, 15 dynamic import sites (written as template literals, e.g. ``import(`./slidev/md-….js`)``), no static cycles, no bare specifiers (`node $B2/packer/graph.mjs <dist>`).

Official `create-slidev` 53.1.0 template (16 slides, theme seriph, Monaco, Mermaid, PlantUML, Tweet, magic-move): **314 files, 37.35 MB** — 230 JS = 35.6 MB (`assets/monaco/bundled-types` 9.99 MB, `assets/modules/shiki` 9.76 MB, `ts.worker` 6.93 MB, css/html/json/editor workers, ~100 Mermaid chunks), 818 static edges, 190 dynamic import sites. [E]

### 3.2 Base path [E]
`--base` is baked in three places: `index.html` (`src="/assets/…"` or `./assets/…`), CSS `url(/sub/deck/assets/…)`, and JS (`createWebHistory("<base>")`, asset literals such as `` `/assets/logo-….png` `` for an absolute base or ``new URL(`../logo-….png`, import.meta.url).href`` for a relative one, and Vite's preload helper).

### 3.3 Router modes [P][E]
`routerMode: history | hash | memory` (headmatter) or `slidev build --router-mode <mode>` (CLI flag since 52.15.0). `memory` exists since 52.17.0 (2026-07-10). In the minified output the three differ only in which vue-router factory is called: `history:le(`/`),routes:` vs `history:ke(`/`),routes:`.

### 3.4 Routes present in a default static build (probed over HTTP) [E]
`/` → `/1`; `/N`; `/N?clicks=k`; `/presenter` → `/presenter/1`; `/overview`; `/notes`; `/notes-edit`; `/entry`; `?embedded=true`; `?print` (print mode works even without `download`). `/export` is **not** a route in a build (`browserExporter: dev`), `/print` only with `download`; unknown single-segment paths match `/:no` and show slide 1 rather than the 404 page. Presenter ↔ viewer sync in a static build is `BroadcastChannel` + ~25 `slidev-*` localStorage keys, i.e. per origin: two decks with the same title on one origin would drive each other. (`node $B2/tools/test-routes.mjs`)

### 3.5 Remote resources referenced by a default build [E]
Small deck: `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@200;400;600&family=Fira+Code:wght@200;400;600&display=swap">` and `<link rel="icon" href="https://cdn.jsdelivr.net/gh/slidevjs/slidev/assets/favicon.png">`. Nothing else; no `fetch`/XHR at runtime, no workers, no eval.

Official starter deck, walking all 16 slides (`$B2/results/starter-walk.json`): Google Fonts (PT Serif, PT Mono); `https://cover.sli.dev/` (slide 1 background — a remote image in the **first slide of the official template**); 5 images on sli.dev; 2 on github.com; **scripts** `https://platform.twitter.com/widgets.js` and `https://embed.bsky.app/static/embed.js`; `https://www.plantuml.com/plantuml/svg/…` (the diagram source travels in the URL); and **Web Workers** `ts.worker` (6.9 MB) + `editor.worker` — `ts.worker` starts on every slide, including slide 1, as soon as the deck contains one `{monaco}` block.

---

## 4. Where can a build be opened from? (Playwright, Chromium 158) [E]

Harness: `node $B2/tools/test-hosting.mjs $B2/cold-install [filter]`; raw results `$B2/results/hosting-*.json`. "works" = first slide renders, 4 key presses reach the component slide, clicking a button in the Vue component changes its output.

| Where | history, base `/` (default) | history, `--base ./` | history, `--base /sub/deck/` | hash, `./` | memory, `./` |
|---|---|---|---|---|---|
| HTTP root | works; deep links need a server fallback | works | – | works | works (URL never changes; reload → slide 1) |
| HTTP sub-path | **blank** — `404 /assets/index-….js` | first slide works, then the URL becomes `/2` (escapes the folder) → reload 404; `/rel/index.html` shows Slidev's 404 page | works only at exactly that path; deep link needs fallback | **works** incl. deep links and reload | **works** |
| `file://` | blank | blank | – | blank | blank |
| `blob:` document | blank | blank | – | blank | blank |
| `srcdoc` + `<base href>` (same origin) | – | – | – | works only by navigating away to the HTTP URL | works |
| `<iframe sandbox="allow-scripts">` over HTTP | blank | blank | – | blank | blank |

Exact causes:
- **Sub-path with default base**: `404 http://localhost:4511/assets/index-DoWwi6HK.js` (and every other asset).
- **`file://`**: `Access to script at 'file:///…/assets/index-….js' from origin 'null' has been blocked by CORS policy: Cross origin requests are only supported for protocol schemes: chrome, chrome-untrusted, data, http, https.` Same for the stylesheets. With `--allow-file-access-from-files`, hash and memory builds with a relative base work. (Firefox/Safari not tested here [U].)
- **`blob:` document**: relative and absolute-path URLs cannot be resolved against a `blob:` base; Chrome logs `<link rel=modulepreload> has no \`href\` value` and requests nothing.
- **Opaque-origin sandbox, assets over HTTP**: (1) without CORS headers every `<script type="module" crossorigin>` / `<link rel="stylesheet" crossorigin>` fails: `…from origin 'null' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header…`; (2) with `Access-Control-Allow-Origin: *` the modules load and the app dies during module evaluation: `SecurityError: Failed to read the 'localStorage' property from 'Window': The document is sandboxed and lacks the 'allow-same-origin' flag.`
- **With an in-memory storage shim in the sandbox**: memory mode works fully. Hash and history modes call `history.replaceState`, which throws `SecurityError: … A history state object with URL '…' cannot be created in a document with origin 'null' and URL 'about:srcdoc'`; vue-router then falls back to `location.replace(url)` and **navigates the frame away**.
- In a `blob:` document *without* `<base>`, hash mode's `replaceState('#/1')` is allowed (frame URL became `blob:null/<uuid>#/`), history mode is fatal: `Failed to execute 'replace' on 'Location': '' is not a valid URL.`

What an opaque-origin `sandbox="allow-scripts"` document can and cannot do (probe `$B2/tools/shim-probe.js`): `localStorage`, `sessionStorage`, `document.cookie`, `indexedDB.open`, `caches`, `navigator.serviceWorker` → `SecurityError`; `history.replaceState` to any other URL → `SecurityError`; `BroadcastChannel` → constructible; `new Worker(blobURL)` → allowed by the browser (md.qft.org's CSP forbids it with `worker-src 'none'`); `document.fullscreenEnabled` → `false`; `navigator.wakeLock.request` → `Permissions policy violation: screen-wake-lock is not allowed in this document.`

---

## 5. Playing a built deck in the md.qft.org player

A faithful replica of the site player was used: the real `public/presentation-sandbox.html` plus `src/lib/presentation-runtime.ts` transpiled with esbuild (`$B2/qftplayer/`). Baseline: the starter's `lesson.zip` plays (`stopped → loading → ready`, no errors). [E]

### 5.1 What happens to an ordinary build today [E]
- Upload check: `src/lib/presentation-package.ts:325-329` rejects it ("This is a website build ZIP…").
- The repo's own packer on an ordinary default build: `Slidev packaging failed: External asset cannot be packaged: https://fonts.googleapis.com/css2?…` (first thing it meets).
- With only that link dropped the packer succeeds, but the result is blank in the player:
  - hash/memory: `TypeError: Failed to construct 'URL': Invalid URL` — Vite's preload helper (`new URL(dep, import.meta.url)`), and, for a relative base, ``new URL(`../logo-….png`, import.meta.url)`` at the top of the play chunk;
  - history: `SecurityError … replaceState` then `Failed to execute 'replace' on 'Location': '' is not a valid URL.`
- After fixing those, absolute-base builds are killed by the player with `Failed to execute 'request' on 'WakeLock': Access to Screen Wake Lock features is disallowed by permissions policy` — an unhandled rejection, which `presentationBootstrap` treats as fatal (`presentation-runtime.ts:131`).

### 5.2 The conversion that makes all of them play [E]
`$B2/packer/convert-dist.mjs` (111 lines, Node) and `$B2/wasmtest/site/worker.js` (90 lines, browser):

1. Drop remote `<link>`s (Google Fonts, favicon) → system-font fallback.
2. Neutralise Vite's preload helper: `__vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=[…])))=>i.map(i=>d[i])` → `__vite__mapDeps=()=>[]` (3 occurrences in the small build, 10 in the starter).
3. Because CSS is code-split, link/inline **all** CSS files up-front (10 extra files).
4. Router → an injected in-memory history: regex `history:([\w$]+)\(([`'"])([^`'"]*)\2\),routes:` (exactly 1 match in every variant).
5. URL-addressed assets inside JS → `data:` URIs: ``new URL(`…`, import.meta.url)(.href)`` for relative bases, quoted `<base>assets/…` literals for absolute bases.
6. `delete Navigator.prototype.wakeLock` before the app starts.
7. For a sub-path base, strip the prefix in CSS/JS.
8. Bundle the ES module graph into one classic script (esbuild; dynamic `import()` results tagged as modules, as `tools/slidev/pack.mjs` already does), inline CSS with `url()` → `data:`.

Result in the player replica, all 7 variants: `ready`, no errors, slide navigation, KaTeX, scoped CSS and the interactive component all work (`$B2/results/run-qft-converted.txt`).

**The same conversion entirely in the browser** (`node $B2/tools/test-wasm-converter.mjs $B2/wasmtest/site 4517 dist-memory-rel dist-history-abs dist-hash-rel dist-history-sub`): host page carries the site's exact CSP; esbuild-wasm 0.27.2 (13.5 MB wasm, 3.61 MB gzip, + 50 KB JS) and es-module-lexer run in a same-origin module Worker. Worker init 148 ms; conversion 1.70 s for the first deck, 0.72–0.77 s afterwards (31 chunks → 1.03 MB bundle); output HTML 1.45 MB; player `ready`, interactions work, KaTeX fonts loaded; no console errors, no external requests.

Limits [E]: the official starter build fails this route — `The compiled application still contains imports. Dynamic import paths must be statically resolvable.` (Monaco), and it would also exceed the 24 MB HTML limit and need Web Workers. Patches 2 and 4 are regexes over minified output: they held for all seven 53.1.0 variants but are tied to Vite's helper shape and Slidev's `createRouter({ history, routes })` source shape [I].

Also relevant: runtime-resolved asset URLs (frontmatter `background: /x.png`, component props) are plain strings resolved with `import.meta.env.BASE_URL` at runtime; they are not covered by step 5 and would hit the CSP [I, from `client/layoutHelper.ts`].

### 5.3 CSP facts (Chromium 158) [E]
Page with the site's meta CSP (`script-src 'self'`), `node $B2/tools/run-csptest.mjs`:

| | main thread | Worker from same-origin URL (classic or module) | Worker from `blob:` |
|---|---|---|---|
| `WebAssembly.compile` | blocked (`CompileError … 'unsafe-eval' is not an allowed source`) | **allowed** | blocked |
| `new Function` | blocked (`EvalError`) | **allowed** | blocked |
| `import(blob:…)` | blocked | **allowed** | blocked |

MDN: "Workers are in general not governed by the content security policy of the document (or parent worker) that created them… The exception … data or blob" (https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy#csp_in_workers). GitHub Pages sends no CSP header, so Workers there are unrestricted. Firefox/Safari behaviour follows the same rule per MDN but was not run here [U].

---

## 6. Build cost [E]

| | Value | How |
|---|---|---|
| Cold `npm install` (`@slidev/cli` 53.1.0 + `@slidev/theme-default`), empty cache | **42.9 s** | `npm install --cache <empty dir>` |
| Same with warm cache | 15–28 s | |
| Packages | 720 lockfile entries (70 optional platform builds), 646 tarballs | |
| Download | **111.3 MB** of tarballs (+336 MB of registry metadata that `npm install` fetches without a lockfile) | gzip-magic count in the cache |
| On disk | **494 MB apparent / 560 MB**, 26,512 files | largest: mermaid 127 MB, monaco-editor 107 MB, typescript 24 MB, pdf-lib 24 MB, @rolldown 21 MB |
| Install scripts | none except `fsevents` (macOS) | lockfile `hasInstallScript` |
| Build, 5-slide deck | **3.9–4.5 s** wall (Vite "built in 2.2–2.6 s", 487 modules), peak RSS **774 MB**, 5.4 s CPU | 3 runs |
| Build, official starter | **12.9 s** wall (2,571 modules; 21 s in one run), peak RSS **≈2.6 GB**, 22.8 s CPU | |
| Minimum packages | `@slidev/cli` + the theme named in the headmatter (`theme: none` avoids even that); `vue` comes transitively; `playwright-chromium` only for export | serve.mjs:727-734 |
| Node | `>=22.22.0` (`@slidev/cli` engines) | package.json |

A missing theme in a non-interactive shell ends the build: `The theme "<pkg>" was not found and cannot prompt for installation` (`resolver-*.mjs`). [P]

---

## 7. What changed recently (verified by unpacking published `@slidev/cli` tarballs; dates from the npm registry) [E]

| Version | Date | Change |
|---|---|---|
| 0.48.0 | 2024-03-10 | `<div id="mermaid-rendering-container">` in index.html |
| 0.49.0 | 2024-05-10 | **`<meta property="slidev:version">`** appears (absent in ≤0.48.0) |
| 0.50.0 | 2024-12-18 | Vite 6; browser exporter (docs: "since v0.50.0-beta.11") |
| 51.0.0 | 2025-01-09 | version scheme jump |
| 52.0.0 | 2025-06-30 | Vite 7 |
| 52.11.5 | 2026-01-30 | `skills/` shipped inside `@slidev/cli` (generated from docs at v52.11.3) |
| 52.13.0 | 2026-02-27 | markdown-it → **markdown-exit** (async rendering) |
| 52.14.0 | 2026-03-02 | MDC → **Comark** (`@comark/markdown-it`; `comark: true`, `mdc` still accepted); Shiki 4 |
| 52.14.2 | 2026-04-05 | Node ≥ 20.12 |
| 52.15.0 | 2026-04-28 | **Vite 8 / rolldown**; `--router-mode` CLI flag |
| 52.15.2 | 2026-05-10 | slide import guard (`server.fs.allow`) |
| 52.17.0 | 2026-07-10 | **built-in MCP server**, **`routerMode: memory`**, **PWA option** |
| 52.20.0 | 2026-09-16 | `--format pptx-editable` |
| 53.0.0 | 2026-09-16 | Node ≥ 22.12 |
| 53.1.0 | 2026-11-05 | latest (`npm view @slidev/cli dist-tags` → `latest: 53.1.0`); Node ≥ 22.22.0 |

The markdown layer was restructured twice within nine months (52.13 and 52.14, then to the `node/syntax/*.ts` plugin layout of 53.x) — relevant to anyone who would *copy* that code instead of bundling it. [E][I]

- **MCP server** [P]: dev server endpoint `http://localhost:<port>/__mcp` (streamable HTTP) and `slidev mcp [entry]` (stdio, works on files without a dev server). Tools: `slidev-get-info`, `-list-slides`, `-get-slide`, `-update-slide`, `-insert-slide`, `-remove-slide`, `-move-slide`, and `-goto-slide` (dev server only). `mcp: false` disables it. Node only. (https://sli.dev/features/mcp, serve.mjs:2755-2886, 2997-3061.) The slide operations themselves (`applySlidePatch`, `insertSlide`, `moveSlide`) are built on `@slidev/parser`'s `prettifySlide`/`stringify`, which are browser-safe — the site could offer the same structured edits on `slides.md` locally. [I]
- **Agent skills** [P]: `npx skills add slidevjs/slidev`; one `SKILL.md` + 53 reference files, also shipped in `node_modules/@slidev/cli/skills/`. The skill tells agents to run `pnpm create slidev`, `pnpm run build`; its hosting reference recommends `--base /<repo>/` or `routerMode: hash`, and its headmatter reference still reads `routerMode: history  # 'history' | 'hash'` (`skills/slidev/references/core-headmatter.md:155`) — no `memory`, no relative base, no offline constraints (the skill was generated from the docs at v52.11.3, before memory mode existed). An AI following it produces exactly the "ordinary build" of section 3. (https://sli.dev/guide/work-with-ai)
- **Browser exporter** [P]: `/export` route in the dev server UI (PDF, PNG zip, image PPTX); `browserExporter: dev` by default, so it is not in a static build unless set to `true`/`build`. (https://sli.dev/guide/exporting)
- **PWA** [P]: opt-in `pwa: true|build|dev`, needs the optional peer `vite-plugin-pwa`, generates a Workbox service worker that precaches the deck. Only useful on a real origin. (https://sli.dev/features/pwa)
- **Playground** [P][S]: none in-browser. `https://sli.dev/new` → `302` → `https://stackblitz.com/github/slidevjs/new?file=slides.md` (WebContainers running the real Node toolchain; that starter pins `@slidev/cli ^52.14.2`). No statement about a Node-less mode was found in the docs or by search [U].
- **VS Code extension** [P]: slide tree, drag-and-drop reordering, preview panel that starts the dev server, Language Model Tools for Copilot. Needs Node. (https://sli.dev/features/vscode-extension)
- **Community** [S]: *Slidecko* (https://github.com/JonasTebben/slidecko) — a browser-only editor that imports and exports Slidev projects by re-implementing rendering ("renders each slide like Slidev does and measures its elements"), projects in IndexedDB; *slidev-addon-studio* — a visual editor addon that still needs the dev server.
- **What `create-slidev` 53.1.0 generates** [E]: `package.json` with `@slidev/cli ^53.1.0`, `@slidev/theme-default`, `@slidev/theme-seriph`, `vue`; `slides.md` (662 lines, `theme: seriph`, `background: https://cover.sli.dev`, `comark: true`), `components/Counter.vue`, `snippets/external.ts`, `pages/imported-slides.md`, `netlify.toml`, `vercel.json`.

---

## 8. Updating a deck from edited source without Node

### 8.1 What the compile step is, in terms of reusable vs Node-bound code [P][E]

| Piece | Reuse in a browser |
|---|---|
| `@slidev/parser` (`load`, `parse`, `resolveConfig`, `detectFeatures`, `prettify`, `stringify`) | as-is; `fs` entry with `node:fs` aliased to a 23-line in-memory shim |
| Slidev markdown plugins (`node/syntax/**`, 1,045 lines) | **bundled unmodified from the upstream TypeScript sources**; needs 3 aliases (`node:fs`, `../utils` for one path helper, `../vite/monacoWrite`) and a stub for `@shikijs/vitepress-twoslash`; contributes 13 KB minified |
| `unplugin-vue-markdown` | Node-bound wrapper; its `createMarkdown` is ~40 lines, re-implemented |
| layout wrapper, context injection, slide/frontmatter loaders | ~120 lines, re-implemented |
| `@vitejs/plugin-vue` | replaced by direct `@vue/compiler-sfc` calls (`parse`, `compileScript({ inlineTemplate })`, `compileStyle`) |
| TypeScript + module linking (Vite) | sucrase `['typescript','imports']` → CommonJS-style module table, evaluated by one inline classic script (no eval) |
| unplugin-vue-components | global registration by file name |
| UnoCSS Vite plugin | `createGenerator(<client uno.config.ts>).generate(allSources)` at compile time |
| Shiki | same construction as upstream (`createBundledHighlighter` + JS regex engine); grammars as lazy chunks |
| `@slidev/client` | cannot be loaded directly → a **prebuilt generic client** |

### 8.2 Prototype [E]

**Generic client** (`$B2/inbrowser/generic-client/`, a normal Slidev project built once with `slidev build`): a `vite.config.ts` plugin (`enforce: 'pre'`) replaces the virtual module `/@slidev/slides` with one that builds the slide list from `globalThis.__QFT_DECK__` and exposes `host.update(deck)` (the client already treats `slides` as a `shallowRef`); `/@slidev/configs` gets a runtime override; `setup/main.ts` registers all built-in components globally and exposes `vue`, `@slidev/client`, `@vueuse/core` to user modules; `runtime/layouts.ts` is a layout registry. 101 lines in total. Built with `routerMode: memory`, fonts `provider: none`, presenter/record/wakeLock/drawings off. Output: 12 files, 2.54 MB (JS 980 KB / 464 KB gzip; CSS 1.56 MB because 60 KaTeX fonts are inlined in three formats — woff2-only would be ≈0.5 MB).

Side finding: Slidev's own `#slidev/layouts` virtual module is unused by the client and emits invalid JavaScript in 53.1.0 for hyphenated layout names (`import __layout_iframe-left from …` → `[PARSE_ERROR] Expected \`from\` but found \`-\``, serve.mjs:1322-1332).

**Compiler** (`$B2/inbrowser/compiler/`, 282 lines + 42 lines of shims, bundled with esbuild): eager part **2.36 MB minified / 708 KB gzip / 573 KB brotli**; 388 lazy chunks (9.6 MB, Shiki grammars and themes, fetched per language). Largest parts: `@vue/compiler-sfc` 812 KB, KaTeX 270 KB, css-tree 189 KB (pulled in by UnoCSS's directives transformer), sucrase 185 KB, yaml 104 KB.

**Runs under the site's CSP** on the main thread (no eval, no wasm), output played in the player replica:

| Deck | Compile (cold / warm) | Player boot | Result |
|---|---|---|---|
| `ordinary` (5 slides: KaTeX, `<v-clicks>`, Shiki `{1|2-3|all}`, `QuantumInterference.vue` with `<script setup lang="ts">`, scoped CSS, `onSlideLeave` from `@slidev/client`) | 333 ms / 66–71 ms | ≈0.38 s | `ready`, no errors; clicks reveal one by one; component interactive |
| edit `slides.md` title → recompile | 71 ms | 0.38 s | new title shown |
| edit the `.vue` component → recompile | 66 ms | 0.36 s | new button label shown |
| `rich` (5 slides, see below) | 266–274 ms | 0.42 s | `ready`, no errors, images load |
| official starter (16 slides) | 1.1–1.4 s | 0.40 s | compiles with 0 diagnostics; killed by the player at boot because slide 1 loads `https://cover.sli.dev/` (`img-src` violation) |

**Fidelity against the real `slidev build`** (same headmatter fonts; `node $B2/tools/test-fidelity.mjs`, `test-fidelity-slides.mjs`):
- `ordinary`: all 9 states (5 slides incl. click steps) **DOM-identical** after removing scope-id attributes, **0 differing pixels** at 1280×720.
- `rich`: cover with `background: /logo.png` from `public/`, `two-cols` + `::right::`, task list, GitHub alert, table with inline math, footnote, `image-right` with frontmatter `image:`, relative Markdown image, public `<img>`, UnoCSS utilities written in the slide, a component using `defineProps<…>`, `useNav()` and a local `.ts` import, `v-click`, slide-level `<script setup lang="ts">` and `<style>`, slide link, Python code with click ranges, KaTeX block with line ranges, `<Arrow>` → **5/5 slides DOM-identical** (asset URLs normalised).
- official starter with `theme: default`: **7/16 identical**; 4 more differ only by test noise or cosmetics (data-URI logo, Magic Move mid-transition classes, random rough-notation paths, token spans inside one Markdown code block); 5 show real gaps: icons (`<carbon:arrow-right/>` unresolved), `<Toc>` (title renderer still the stub's), `<Tweet>`, Mermaid/PlantUML, Monaco.

### 8.3 What a "Slidev-compatible in-browser player" would have to own [E][I]

Works in the prototype: slide parsing incl. `src:` imports and `<<<` snippets; all Markdown syntax handled by upstream plugins (code blocks, line highlighting, magic-move, KaTeX, slot sugar, alerts, footnotes, task lists, Comark when enabled); built-in layouts and components of the default theme; `v-click`, `v-mark`, `v-motion`, `v-drag` directives; user `.vue` components with TypeScript and scoped styles; local `.ts/.js/.json` imports; images (relative, `public/`, frontmatter) as `data:` URIs; UnoCSS utilities.

Small, missing in the prototype (each tens of lines): title renderer for `<Toc>`; `layouts/*.vue`; global layers (`global-top.vue` …); speaker notes HTML; `styles/*.css` with `@apply` (UnoCSS directives transformer); fonts from headmatter (baked into the client's CSS at its build time); in-place hot update via `host.update()` instead of a restart; CSS `url()` assets.

Needs a catalogue or network:
- **Themes** (`theme: seriph`, community themes) and **addons** — npm packages with layouts, styles, setup files, their own UnoCSS config. Either prebuilt "theme packs" per supported theme, or fetch from a CDN and compile like project files.
- **Icons** — `@iconify-json/*` collections are large (carbon 1.1 MB, ph 4.3 MB minified JSON); bundle one or two, or fetch.
- **npm dependencies** of components (d3, three, chart.js…) — CDN ESM or unsupported.
- **Mermaid** — a 5.25 MB (1.5 MB gzip) optional chunk in the generic client.

Not reproducible without Node: `vite.config.*` plugins, `setup/{shiki,katex,unocss,transformers,preparser,vite-plugins}.ts`, `uno.config.ts` (they are code to execute; a Worker could evaluate simple config objects, not Vite plugins), `<style lang="scss">`, **TwoSlash** (TypeScript language service, 3.5 MB + lib typings), **Monaco** (10 MB + 5 workers; forbidden by the sandbox), remote things (PlantUML, Tweet, YouTube, Google Fonts, remote images).

Structural limits: one generic client per Slidev version (and per theme, unless themes become runtime packs); features guarded by build-time defines (presenter, drawings, recording) are fixed when the client is built; a deck written for Slidev 0.4x/51/52 is compiled by the 53.1 pipeline.

Honest size of the job [I]: the prototype is ~430 lines and took the core from zero to pixel-identical for simple decks. A shippable "supported subset" (default + a few official themes as packs, one icon set, the small missing pieces above, diagnostics that name what is unsupported, tests that diff against real builds) is weeks, not days, and it has a standing cost: every Slidev minor can move the virtual-module contract (`/@slidev/slides`, `/@slidev/configs`, the `SlideRoute` shape, `useSlideContext`) that the generic client hooks into.

### 8.4 Cheaper partial solutions, ranked [I, grounded in the measurements above]

1. **Play built decks (section 5.2).** No Slidev knowledge beyond six patches; fidelity is that of the real build; covers what AI coding agents with a shell produce. Source editing then means "edit, rebuild elsewhere, re-upload".
2. **Structured Markdown edits with the upstream parser only** (36 KB gzip): list/reorder/insert/delete slides, edit a slide's Markdown, notes and frontmatter, and write a correct `slides.md` back into the ZIP — the same operations the MCP server offers — with no preview. Honest, tiny, zero drift.
3. **Markdown-only live preview** = the prototype minus `@vue/compiler-sfc` and sucrase. Saves ≈1 MB minified (≈290 KB gzip) but then templates must be compiled with the Vue runtime compiler, which needs `'unsafe-eval'` in the sandbox, and components/`<script setup>`/scoped styles are gone. Poor trade.
4. **The full prototype approach** (generic client + in-browser compiler) for decks whose detection report (section 9) shows no blockers; everything else falls back to 1.
5. **WebContainers** (what sli.dev/new uses): real fidelity, but needs cross-origin isolation headers that GitHub Pages cannot send, downloads ~111 MB of packages per project from the network, and a build of the starter peaked at 2.6 GB RSS natively. Not examined further here.

---

## 9. Detecting what was uploaded

Classifier prototype: `$B2/tools/detect.mjs` (113 lines, uses `@slidev/parser/core`), `node $B2/tools/run-detect.mjs <research dir>` — **17/17 fixtures classified correctly** in 0.1–21 ms each. [E]

**Slidev build (dist)**
- Strong: `index.html` contains `<meta property="slidev:version" content="X">` (since 0.49.0). Fallback for older builds: `<div id="app"></div>` + `<div id="mermaid-rendering-container">` (since 0.48.0) or an `assets/slidev/` folder.
- Root inside the ZIP: directory of that `index.html` (handles `dist/…` and a top-level folder).
- Version: the meta content.
- Base: `src` of `<script type="module" crossorigin src="…assets/index-<hash>.js">` minus `assets/index-….js` → `/`, `./`, `/sub/path/`.
- Router mode (heuristic on minified code, correct for all 7 variants): `assets/modules/vue-*.js` without `popstate` → memory; with `location.host` (or a quoted `…#/` literal in a client chunk) → hash; else history.
- Capability flags: `assets/monaco/` or `*.worker-<hash>.js` (Monaco, Web Workers), Mermaid chunks, `<script src="https://…">` in index.html (Tweet/BlueSky), Google Fonts link, number of remote `rel="preload"` images, `sw.js`/`manifest.webmanifest` (PWA), `*.pdf` (download), total bytes/files.

**Slidev source project**
- Strong: a `package.json` (shallowest first) with `@slidev/cli` in `dependencies`/`devDependencies` (gives the version range), or scripts that call `slidev`. Entry: a `.md` named in those scripts, else `slides.md` next to it.
- Without `package.json` (AI chat tools often return only `slides.md`): score the Markdown — headmatter keys (`theme`, `layout`, `transition`, `mdc`/`comark`, `fonts`, `drawings`, `routerMode`…) and Slidev-only syntax (`<v-click(s)>`, `v-click`, `::slot::`, `{monaco}`, `{1|2-3}` ranges, `<<< file`, `$slidev`, built-in component tags, ```` ````md magic-move````, `src: x.md`); `marp: true` is a negative signal.
- Then parse with `@slidev/parser/core` for slide count, title, `theme`, `addons`, `routerMode`, `detectFeatures()` (katex/monaco/mermaid/tweet/bluesky), and list what the project contains (`components/`, `layouts/`, `setup/*`, `vite.config.*`, `uno.config.*`, `public/`, global layers, non-Slidev npm dependencies, lockfile, `node_modules`). From that the classifier derives an `inBrowserCompileBlockers` list — e.g. for the official template: `theme "seriph"`, `monaco`, `mermaid`, `tweet (remote script)`.

Both in one ZIP (source + `dist/`): prefer the build for playback and keep the source for the editor.

---

## 10. Open questions
- Firefox and Safari: `file://` module loading, Worker-vs-meta-CSP behaviour, `history.replaceState` in `blob:` documents — taken from documentation only.
- How stable are the two regex patches (preload helper, router call) across Slidev 0.49–52 builds? Only 53.1.0 outputs were available to test.
- Does upstream plan anything for Node-less use? Nothing found; GitHub issues were not reachable from here.
- Runtime-resolved asset URLs in *built* decks (frontmatter backgrounds, component props) need either URL virtualisation or a real origin; not prototyped.
- esbuild-wasm was measured from localhost; the 3.6 MB (gzip) first download and its caching on GitHub Pages were not.

---

## 11. Artifact index (`$B2/…`)

| Path | What |
|---|---|
| `tools/bundle-sizes.mjs`, `bundles/sizes.json` | browser-bundling table (section 2) |
| `cold-install/` | fresh install; builds `dist-{history,hash,memory}-{abs,rel}`, `dist-history-sub` |
| `starter-deck/` | official create-slidev template, installed and built (37 MB dist) |
| `tools/test-hosting.mjs`, `results/hosting-*.json`, `results/run-*.txt` | hosting matrix (section 4) |
| `tools/shim-probe.js` | opaque-origin API probe |
| `tools/test-routes.mjs` | routes in a static build |
| `tools/test-starter-walk.mjs`, `results/starter-walk.json` | external requests / workers per slide |
| `qftplayer/` | replica of the site player; `tools/test-qft-player.mjs` |
| `packer/pack-relaxed.mjs`, `packer/convert-dist.mjs`, `packer/graph.mjs` | Node converter and module-graph analysis |
| `wasmtest/site/` (`worker.js`, `app.js`), `tools/test-wasm-converter.mjs`, `results/wasm-converter.json` | in-browser converter with esbuild-wasm in a Worker |
| `csptest/`, `tools/run-csptest.mjs` | CSP: main thread vs Worker |
| `upstream-src/` | @slidev/cli TypeScript sources at v53.1.0 + `lines.txt` |
| `inbrowser/generic-client/` | runtime-driven Slidev client (`vite.config.ts`, `setup/main.ts`, `runtime/layouts.ts`) |
| `inbrowser/compiler/` (`src/index.js`, `src/shims/`, `build.mjs`, `dist/size-report.json`) | browser compiler |
| `inbrowser/site/` | test site (host page with the site's CSP, decks `ordinary`, `ordinary-ref`, `rich`, `starter`, `starter-default`) |
| `tools/test-inbrowser.mjs`, `test-inbrowser-sandbox.mjs`, `test-fidelity.mjs`, `test-fidelity-slides.mjs`, `test-gaps.mjs`; `results/inbrowser-*.json`, `results/fidelity-*/` (reports + screenshots) | compile, edit, fidelity and gap tests |
| `tools/detect.mjs`, `tools/run-detect.mjs`, `detect-fixtures/` | upload classifier |
| `create-slidev-template/` | what `npm init slidev` generates at 53.1.0 |

Ports used: 4510–4519 only; all servers and browsers started by these scripts are closed by the scripts.

## 12. Re-running the experiments

```sh
B2=../prototypes/B2
node $B2/tools/bundle-sizes.mjs $B2/cold-install                      # section 2
node $B2/tools/test-hosting.mjs $B2/cold-install [filter]             # section 4 (ports 4510-4516)
node $B2/tools/test-routes.mjs $B2/cold-install/dist-history-abs 4510 # section 3.4
node $B2/tools/test-starter-walk.mjs $B2/starter-deck/dist 4510 16    # section 3.5
node $B2/packer/convert-dist.mjs <dist> <out.zip>                      # section 5.2 (Node)
node $B2/tools/test-qft-player.mjs $B2/qftplayer 4517 packed/<file>.html
node $B2/tools/test-wasm-converter.mjs $B2/wasmtest/site 4517 dist-memory-rel dist-history-abs dist-hash-rel dist-history-sub
node $B2/tools/run-csptest.mjs                                         # section 5.3 (port 4518)
(cd $B2/inbrowser/generic-client && ./node_modules/.bin/slidev build slides.md --out dist)
node $B2/packer/pack-relaxed.mjs --dist $B2/inbrowser/generic-client/dist --out $B2/inbrowser/generic-client.zip --title x
(cd $B2/inbrowser/compiler && node build.mjs && rm -rf ../site/compiler && cp -r dist ../site/compiler)
node $B2/tools/test-inbrowser.mjs $B2/inbrowser/site 4519 ordinary --shot
node $B2/tools/test-inbrowser-sandbox.mjs $B2/inbrowser/site 4519 rich ordinary starter-default
node $B2/tools/test-fidelity.mjs $B2/inbrowser/ref-ordinary/dist $B2/inbrowser/site ordinary-ref 9
node $B2/tools/test-fidelity-slides.mjs $B2/inbrowser/ref-rich/dist $B2/inbrowser/site rich 5
node $B2/tools/test-fidelity-slides.mjs $B2/inbrowser/ref-starter/dist $B2/inbrowser/site starter-default 16
node $B2/tools/run-detect.mjs (scratch)/research                                       # section 9
```

One thing to avoid: `npm install` inside `$B2/tools` follows symlinks under `node_modules` and prunes their targets; do not link another install into it.

