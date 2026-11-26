# B7 — How decks leave AI tools in November 2026, and what md.qft.org should accept and publish

Research date: 2026-11-24. Agent: B7. Scope: the hand-off "AI -> file -> md.qft.org" and the revision loop.
All prototypes and downloads are under
`../prototypes/B7/` (called `$B7` below).
Nothing in `<repo>` was modified (`git status --short` is empty). No TCP server was started: every
browser test used Playwright `context.route()` to serve files for a fake origin `http://b7.test` and to abort
every other request.

Status labels: **[E]** verified-empirically (run here), **[P]** verified-primary-source, **[S]** secondary-source,
**[I]** inferred, **[U]** uncertain.

---

## 0. Summary of what matters

1. **The natural answer to "make me a reveal.js presentation" is ONE HTML file that loads reveal.js 4.x/5.x from
   jsDelivr or cdnjs.** Every real deck, tutorial and community skill found has that shape; on jsDelivr 88.8 % of
   reveal.js requests are still for versions older than 6 (section 3). **[E][P]**
2. **md.qft.org accepts none of the natural shapes today**: 0 of 12 tested shapes play; 3 of the 12 are silently
   imported as the wrong thing (a README becomes "the document"); a `.html` file cannot be opened at all
   (section 6.1). **[E]**
3. **A small browser-side adapter makes the natural Reveal shape work in the site's existing sandbox unchanged**:
   CDN-URL -> bundled-file map (with version coercion to the bundled 6.0.2), a 12-line `RevealMath` shim, and a
   5-line `history.replaceState` guard. With it, 3 of 3 real lecture decks written for reveal.js 4.5.0/4.6.1 (two
   by Claude, one university course) and 5 of 5 synthetic Reveal ZIP shapes reach `ready` in the *real* player with
   0 network requests, math rendered, keyboard navigation and sliders working (section 6.2). **[E]**
4. **`hash: true` is fatal in the current player**: `history.replaceState` throws in an opaque-origin `blob:`
   document. All three real decks use it. Must be fixed site-side (guard), not by prompt (section 6.2). **[E]**
5. **Slidev always needs a build somewhere.** Tools that can run it: coding agents, Claude chat (npm registry is on
   the sandbox allow-list), ChatGPT Work. Tools that cannot: ChatGPT Chat container, Gemini app, consumer Copilot
   chat (section 2). A stock project needs only two headmatter lines and one flag to give a location-independent,
   offline build — no bespoke starter or packer (section 6.3). **[E][P]**
6. **Agent Skills are now the cross-vendor instruction channel** (Claude incl. Free via ZIP upload, Claude Code,
   ChatGPT/Codex, Cursor, Gemini CLI, Copilot, 40+ clients). A static site can serve one at
   `/.well-known/agent-skills/index.json` so `npx skills add https://md.qft.org` works (section 4). **[P]**
7. Drafted artefacts (section 8): Reveal chat prompt 191 words, Slidev chat prompt 197 words, SKILL.md outline
   64 lines, report format `qft-deck-check/1` with JSON Schema; the report prototype produced 483–2,078-character
   reports for 8 corpus items, all valid against the schema. **[E]**

---

## 1. Environment and method

- Container: Linux, 4 vCPU, Node v22.23.5, npm 10.9.9, Playwright + Chromium 158.
- Repo modules were bundled *unmodified* with the repo's own esbuild into `$B7/bundles/` and executed in Node or
  in Chromium: `ai-lesson.ts`, `slidev-prompt.ts`, `lesson-check.ts`, `presentation-package.ts`,
  `document-bundle.ts`, `presentation-runtime.ts` (IIFE, global `QFT`).
- The real player was reproduced exactly: `QFT.createPresentationPlayer(host, html, { sandboxUrl })` with the
  shipped `dist/presentation-sandbox.html` (byte-identical to `public/presentation-sandbox.html`).
- Web sources were read with curl (`.md`/`llms.txt` endpoints where available) or headless Chromium.
  `$B7/scripts/fetch-full.mjs` prints `textContent` including collapsed accordions (needed for Google help pages).

---

## 2. What each AI tool can produce and deliver (November 2026)

### 2.1 Matrix

| Tool / surface | Emits | Can hand over a ZIP? | Sandbox: Node / npm / internet | Can run `npm i @slidev/cli && slidev build`? | Status |
|---|---|---|---|---|---|
| **Claude chat** (web/desktop/mobile, all plans incl. Free) | Artifacts; files created in a private computing environment; "Slides" template is Claude's own deck format (exports PPTX/PDF/Google Slides) | Yes (files up to 30 MB each, downloadable) | "write and run code (for example Python or Javascript)"; network egress on for Free/Pro/Max/Ultra, limited to an allow-list: `registry.npmjs.org, npmjs.com, npmjs.org, github.com, pypi.org, files.pythonhosted.org, pythonhosted.org, crates.io, index.crates.io, static.crates.io, archive.ubuntu.com, security.ubuntu.com, yarnpkg.com, registry.yarnpkg.com, api.anthropic.com, statsig.anthropic.com`. Team: the article says both "disabled by default" and "toggled on with access to package managers only". Enterprise: egress off by default. | By design yes on consumer plans (registry reachable). Not run by me; the sandbox's Node version is unknown and @slidev/cli 53.1.0 requires Node >= 22.22.0. CDNs (jsDelivr, unpkg, cdnjs) and md.qft.org are **not** on the allow-list. | [P] capability; [U] actual Slidev build |
| **Claude Code** (terminal, desktop, cloud) | Files in a repo/folder; can publish Artifacts | Yes | Local: user's machine. Cloud: Ubuntu 24.04 VM, ~4 vCPU / 16 GB / 30 GB; default "Limited" network = package registries, GitHub, cloud SDKs, `fonts.googleapis.com`; jsDelivr/unpkg/cdnjs not in the default list | **Yes — verified in this session** (a Claude Code cloud container): cold `npm install` 42.9 s, `slidev build` 5.7 s | [E][P] |
| **ChatGPT Chat** (free and paid) | Text, canvas (HTML/React preview, Download button), files written by the Python/"container" tool | Yes (Python `zipfile` in the container) | Container has Node.js and Bash (Jan 2026). "the container still can't make outbound network requests"; `pip`/`npm install` worked through an internal proxy in Jan 2026 but "that doesn't seem to work any more" (Aug 2026). `container.download` can fetch a public URL that was viewed in the conversation. | No (or unreliable) | [S] Simon Willison, 2026-01-26 and 2026-08-30; [U] today |
| **ChatGPT Work** (Cloud: web/mobile; Local: desktop app; paid plans, "$20/month and up") | Finished files, "Sites" (hosted on Cloudflare), documents/decks/spreadsheets | Yes | Cloud code execution "can now talk to the rest of the internet" (default appears open; setting *Settings > Data controls > Work network access > Allow public internet access*; admins can restrict). Headless Chrome. Persistent `/workspace`. Local: user's computer with permissions. | By design yes | [P] learn.chatgpt.com + help.openai.com; [S] defaults |
| **Codex** (CLI, IDE, desktop "Codex", Codex Cloud) | Files / PRs | Yes | Local sandbox controls file and network access with approvals. Codex Cloud: per-environment internet setting (all public internet or allow-list; legacy: agent phase offline, setup script online; "Common dependencies" preset includes npmjs.com/npmjs.org/github.com) | Yes | [P] |
| **Gemini app** (gemini.google.com) | Canvas: docs, apps (HTML), slides, code; "Share & export": public share link, Export to Docs, Export to Slides (or PDF), Copy contents; Python to Colab; code to Replit. File generation (since 2026-04-29): Docs, Sheets, Slides, .pdf, .docx, .xlsx, .csv, LaTeX, TXT, RTF, MD | **No ZIP, no .html download documented** — HTML leaves by *Copy* | Code execution is Python only, 30 s max runtime, "You can't install your own libraries" (Gemini API docs) | No | [P] Google help + blog + API docs; [I] that the app sandbox equals the API tool |
| **Gemini CLI** | Files | Yes | Local shell | Yes (local Node) | [P] skills docs; [I] |
| **Microsoft Copilot** (consumer chat) | Text/code blocks; generated-file download links reported unreliable by users (forum threads) | Unreliable | Code interpreter is Python, documented for Microsoft 365 Copilot agents/Copilot Studio (search-result summaries of learn.microsoft.com; pages not opened) | No | [S][U] |
| **Copilot Code** (Preview, Copilot desktop app on Windows, US/Canada, Windows Insiders, M365 Premium/Pro) | Multi-file projects with live preview; "View and edit the generated files"; GitHub connection | Files on disk | Runs commands locally (with review) | Probably | [P] support.microsoft.com; [U] |
| **Cursor** (IDE, CLI, Cloud Agents) | Files / PRs | Yes | Local shell; cloud VMs | Yes | [P] skills docs; [I] |

Sources (all fetched 2026-11-24):
- Claude files/sandbox/allow-list: https://support.claude.com/en/articles/12111783-create-and-edit-files-with-claude.md
- Claude artifacts (legacy cut-over 2026-09-16, templates, exports): https://support.claude.com/en/articles/17153992-what-are-artifacts-and-how-do-i-use-them.md
- Claude skills on all plans, ZIP upload: https://support.claude.com/en/articles/12512180-use-skills-in-claude.md , https://support.claude.com/en/articles/12512198-how-to-create-custom-skills.md , https://support.claude.com/en/articles/12512176-what-are-skills.md
- Claude Code cloud environments (allow-list, resource and time limits): https://code.claude.com/docs/en/cloud-environments.md
- ChatGPT container: https://simonwillison.net/2026/Jan/26/chatgpt-containers/ ; ChatGPT Work: https://simonwillison.net/2026/Aug/30/understanding-chatgpt-work/
- ChatGPT Work official: https://learn.chatgpt.com/docs/enterprise/chatgpt-work-overview.md , https://help.openai.com/en/articles/20001275-chatgpt-work-and-codex , https://learn.chatgpt.com/docs/get-started-with-work.md , https://learn.chatgpt.com/docs/artifacts-viewer.md
- Codex Cloud internet: https://learn.chatgpt.com/docs/cloud/internet-access.md , https://learn.chatgpt.com/docs/environments/cloud-environments.md ; sandbox: https://learn.chatgpt.com/docs/sandboxing.md
- Gemini Canvas: https://support.google.com/gemini/answer/16047321 ; exports: https://support.google.com/gemini/answer/14184041 ; file generation: https://blog.google/innovation-and-ai/products/gemini-app/generate-files-in-gemini/ ; code execution limits: https://ai.google.dev/gemini-api/docs/code-execution
- Copilot Code: https://support.microsoft.com/en-us/microsoft-365-copilot/get-started-with-copilot-code
- Cursor skills: https://cursor.com/docs/skills.md ; Gemini CLI skills: https://geminicli.com/docs/cli/skills.md

### 2.2 Details that change the design

- **Claude artifacts changed on 2026-09-16.** "Legacy artifacts are artifacts made in a chat before September 16,
  2026 ... you can't make new ones." New artifacts start from templates (Docs, Slides, Design, ...). A user who asks
  Claude for "a presentation" now gets Claude Slides (PPTX/PDF/Google Slides export), not reveal.js; reveal.js
  appears only when asked for by name. **[P]**
- The `Artifact` publishing tool available to this very agent states its page contract: external scripts only from
  `cdnjs.cloudflare.com (preferred), cdn.jsdelivr.net/npm/, unpkg.com, cdn.tailwindcss.com or code.jquery.com`,
  stylesheets only from Google Fonts, everything else inline, each script URL pinned to an exact version. So a
  Claude-published reveal.js page tends to be: reveal.js `<script>` from cdnjs + inlined CSS. **[P] (tool
  definition in this session); [I] for what Claude chat emits.**
- **Gemini has no file route for HTML.** Canvas content is copied or shared by link; Chrome extensions exist just to
  export Canvas code. Paste import is therefore the only Gemini path. **[P]**
- **ChatGPT custom GPTs are being replaced by plugins.** "Custom GPTs in ChatGPT Enterprise are being retired";
  plugins bundle *skills* and apps and work in Chat and Work on web, desktop and mobile
  (https://learn.chatgpt.com/docs/build-plugins.md). **[P]**
- **@slidev/cli 53.1.0 requires Node >= 22.22.0** (`npm view @slidev/cli@53.1.0 engines` -> `{"node":">=22.22.0"}`).
  The official Slidev skill and the repo's `tools/slidev/package.json` both still say 22.12. A sandbox with an older
  Node is a silent Slidev blocker. **[P]**
- **Slidev build cost** measured here (cold npm cache, 4 vCPU): `npm install` of `@slidev/cli@53.1.0 +
  @slidev/theme-default@0.25.0 + vue` = 42.9 s, 721 packages in the lockfile, `node_modules` 560–592 MB, npm cache
  469 MB; `npx slidev build` = 5.7 s (Vite "built in 3.12s"); output 106 files, 2.1 MB. Warm cache install: 8 s.
  One Mermaid block raises the output to 195 files, 7.5 MB (largest chunk `elk` 1.59 MB). **[E]**
- Without the theme package and with stdin closed, `slidev build` exits 1 with:
  `The theme "@slidev/theme-default" was not found and cannot prompt for installation`. It does not hang. **[E]**

---

## 3. What AIs naturally produce — evidence

### 3.1 Real decks (static analysis with `$B7/scripts/analyze-deck.mjs`)

| Deck | Made with | Shape | reveal.js | Other URLs | Interactivity |
|---|---|---|---|---|---|
| `real-decks/hoyle-part1.html` (73 KB, 28 slides) | Claude Opus 4.6, web chat, March 2026 (author's blog) | single HTML | `cdn.jsdelivr.net/npm/reveal.js@4.6.1/dist/reveal.js` + `plugin/notes/notes.js`, `dist/reveal.css`, `dist/theme/white.css` | `katex@0.16.9` (katex.min.js, contrib/auto-render.min.js, katex.min.css) from jsDelivr; Google Fonts | one 14.9 KB inline classic script; 4 canvases, 6 range inputs; 0 inline handlers, 0 fetch, 0 eval, 0 storage; `hash: true` |
| `real-decks/hoyle-part2.html` (165 KB, 44 slides) | same | single HTML | same | same | 50 KB inline script; 11 canvases, 9 ranges |
| `real-decks/uchicago/lecture-07/index.html` (53 KB, 74 slides) + `../assets/css/uchicago-theme.css` + 2 images | University of Chicago NLP course, Winter 2026 (hand/AI-assisted; cited by the blog above) | multi-file, CDN engine | `cdnjs.cloudflare.com/ajax/libs/reveal.js/4.5.0/reveal.min.js` + `plugin/markdown|highlight|math/*.min.js` | relative CSS and images | 74 `data-markdown` sections; `RevealMath.KaTeX`; `hash: true` |
| `real-decks/ryanbbrown-example.html` (32 KB, 17 slides) + `styles.css` | example shipped with the `ryanbbrown/revealjs-skill` Claude Code skill | HTML + 1 CSS | `cdn.jsdelivr.net/npm/reveal.js@5.1.0` | `chart.js` (unversioned), `reveal.js-plugins@latest/chart/plugin.js`, Font Awesome 6.5.1 (cdnjs) | Chart.js canvases; `hash: true` |

Source for the first two: https://alexanderhoyle.com/posts/ai-slide-gen.html ("write your lecture notes in
LaTeX/markdown ... prompt your LLM of choice (I used Claude Opus 4.6) to create slides ... using reveal.js";
"the HTML viewer for Claude doesn't play well with reveal.js, so it's best to download the file and open it in your
browser"; "The LLM may skip or reorder your content"; "I used slide numbers when asking for fixes ... the model may
get confused as it requires manual counting"). **[S]** for the workflow, **[E]** for the file contents.

### 3.2 Community skills — what coding agents are told to emit **[P]**

Fetched from raw.githubusercontent.com; install counts from `npx skills@1.9.0 find <query>` on 2026-11-24.

| Skill | Installs | reveal.js source it hard-codes |
|---|---|---|
| `claude-office-skills/skills@html-slides` | 19.3K | `cdn.jsdelivr.net/npm/reveal.js@4/dist/...`, `@4/plugin/highlight/highlight.js` |
| `ryanbbrown/revealjs-skill` | 638 (skills.sh page) | `cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/...` + chart.js + Font Awesome |
| `jwynia/agent-skills@revealjs-presenter` | 436 | `cdnjs.cloudflare.com/ajax/libs/reveal.js/4.6.1/reveal.min.js` + Google Fonts |
| `podo/design-agent-skills@revealjs-skill` | 222 | wraps ryanbbrown's |
| `glaucia86/skills/revealjs` | n/a | `cdn.jsdelivr.net/npm/reveal.js@5/dist/...`, `@5/plugin/markdown/markdown.js` |
| `broeker/reveal-deck` | n/a | `cdn.jsdelivr.net/npm/reveal.js@5.1.0/...` |
| `zarazhangrui/frontend-slides` | n/a | none: "Zero Dependencies — Single HTML files with inline CSS/JS. No npm, no build tools." |
| For scale: `slidevjs/slidev@slidev` 14.2K, `antfu/skills@slidev` 13.8K, `anthropics/skills@pptx` 262.4K | | |

None of the Reveal skills targets reveal.js 6; none vendors files.

### 3.3 jsDelivr request statistics (primary: data.jsdelivr.com API, period = month ending 2026-11-23) **[P]**

`curl "https://data.jsdelivr.com/v1/stats/packages/npm/reveal.js/versions?period=month&limit=40"`

- Total 6,663,177 hits/month. By version: 5.1.0 39.5 %, 5.2.1 17.0 %, 4.5.0 11.5 %, 6.0.2 8.9 %, 4.0.2 6.7 %,
  4.6.1 5.8 %, 5.0.4 2.7 %, 6.0.1 1.7 %, 3.9.2 1.2 %.
- By major: **v5 59.8 %, v4 27.3 %, v6 11.2 %, v3 1.5 %, v2 0.2 %.**
- Per-file shares relative to core loads (`.../reveal.js@<v>/files?period=month`):

| Version | core loads | notes | highlight | markdown | math | zoom | search | white theme | black theme |
|---|---|---|---|---|---|---|---|---|---|
| 5.1.0 | 570,116 | 48.1 % | 19.4 % | 4.2 % | 8.7 % | 2.8 % | 2.1 % | 27.7 % | 14.1 % |
| 5.2.1 | 274,464 | 38.5 % | 12.0 % | 9.3 % | 6.2 % | 6.4 % | 5.7 % | 24.3 % | 23.3 % |
| 4.5.0 | 118,035 | 5.0 % | 11.8 % | 8.5 % | 1.0 % | 1.7 % | 0.4 % | 89.9 % | 14.1 % |
| 6.0.2 | 144,444 | 22.8 % | 17.8 % | 7.2 % | 4.1 % | 7.3 % | 6.7 % | 64.1 % | 5.8 % |

- Other libraries on jsDelivr (web-wide, same period): mathjax 3.84 G (rank 12), three 1.61 G, katex 1.00 G
  (rank 53), chart.js 855 M, mermaid 307 M, d3 64 M, reveal.js 6.66 M (rank 2047), p5 5.5 M, plotly.js-dist-min
  1.4 M, reveal.js-plugins 231 K. MathJax is requested about 4x as often as KaTeX. (Not deck-specific.)

### 3.4 The reveal.js 6 layout change is a trap **[E]**

reveal.js 6.0.0 was published 2026-03-11, 6.0.2 on 2026-09-10 (`npm view reveal.js time`).
- 5.2.1: `plugin/<name>/<name>.js`, `dist/reveal.esm.js`, `dist/theme/fonts/...`.
- 6.0.2: `dist/plugin/<name>.js` (+ `.mjs`), `dist/reveal.mjs`; themes `black/white(-contrast).css` are 575 KB each
  because fonts are embedded as `data:font/woff`; seven other themes `@import` Google Fonts.
- `https://cdn.jsdelivr.net/npm/reveal.js@6.0.2/plugin/notes/notes.js` -> **404**. jsDelivr nevertheless counts
  4,620 requests/month for that path under 6.0.2 (plus 3,218 markdown, 2,852 zoom, 2,661 highlight, 2,169 search):
  decks that bumped the version but kept old paths. **[E] 404; [I] that the counter includes failed requests.**
- Unversioned jsDelivr URLs silently mix versions: `.../npm/reveal.js/dist/reveal.js` answers with header
  `x-jsd-version: 6.0.2`, while `.../npm/reveal.js/plugin/markdown/markdown.js` answers `x-jsd-version: 5.2.1`.
  On unpkg the same unversioned plugin URL is 404.
- cdnjs carries 6.0.2 with a third layout: `/reveal.min.js`, `/theme/white.min.css`, `/plugin/math.min.js` and
  `/plugin/math/plugin.min.js`.
- `RevealMath.KaTeX` in 6.0.2 injects `<link>`/`<script>` for `https://cdn.jsdelivr.net/npm/katex@latest/dist/...`
  at run time (and MathJax 2/3/4 from jsDelivr) — a *vendored* deck that uses the math plugin still needs the
  network unless `katex.local` is set. (`node_modules/reveal.js/dist/plugin/math.js`.)
- revealjs.com now publishes https://revealjs.com/llms.txt (7,166 bytes; no `llms-full.txt`, 404). The reveal.js
  repository has no `AGENTS.md`, `CLAUDE.md`, Copilot instructions or skill (404 on raw.githubusercontent.com).

---

## 4. Existing AI-facing material

### 4.1 Slidev (official) **[P]**

- https://sli.dev/llms.txt (6,933 bytes) and `llms-full.txt` (194,584 bytes); guide page
  https://sli.dev/guide/work-with-ai.md.
- **Skill**: `npx skills add slidevjs/slidev`; source
  https://raw.githubusercontent.com/slidevjs/slidev/main/skills/slidev/SKILL.md — 199 lines, 1,136 words,
  9,490 bytes, plus about 50 files in `references/`. It teaches syntax and commands:
  `pnpm create slidev`, `pnpm run dev`, `pnpm run build` ("Build static SPA"), `--base /talks/my-talk/`, GitHub
  Pages workflow with `--base /${{ github.event.repository.name }}/`, `routerMode: history # 'history' | 'hash'`.
  It says nothing about relative base, ZIP delivery, offline packaging, or `routerMode: memory`. Images: "Place in
  `public/` folder and reference with leading slash ... Do NOT use relative paths like `./pic.png`."
  Consequence: an agent following the official skill delivers source, or a `dist/` with base `/` and history
  routing — shapes F, H and J in section 6.1, all rejected today.
- **MCP server** (https://sli.dev/features/mcp.md): HTTP at `http://localhost:<port>/__mcp` while the dev server
  runs, or stdio `slidev mcp [entry]`. Tools: `slidev-get-info`, `slidev-list-slides`, `slidev-get-slide`,
  `slidev-update-slide`, `slidev-insert-slide`, `slidev-remove-slide`, `slidev-move-slide`, `slidev-goto-slide`.
  It is a local authoring aid; it does not help a static site. Its slide-addressed tool set is a good model for
  slide-level patching in md.qft.org.
- VS Code extension exposes Language Model Tools to Copilot.

### 4.2 Agent Skills format and distribution **[P]**

- Spec: https://agentskills.io/specification.md — a folder with `SKILL.md` (YAML frontmatter `name` <= 64 chars,
  lowercase/hyphens, equal to the folder name; `description` <= 1024 chars; optional `license`, `compatibility`
  <= 500 chars, `metadata`, experimental `allowed-tools`), optional `scripts/`, `references/`, `assets/`.
  Progressive disclosure: metadata (~100 tokens) -> SKILL.md body (< 5000 tokens, < 500 lines recommended) ->
  resources on demand. claude.ai's uploader documents a tighter description limit: "200 characters maximum".
- Clients listed at https://agentskills.io/clients (46 on 2026-11-24) include Claude, Claude Code, ChatGPT & Codex,
  Cursor, GitHub Copilot, VS Code, Gemini CLI, OpenCode, Amp, Goose, Roo Code, Junie, Kiro, Mistral Vibe.
- Where skills live: `.agents/skills/` is read by Codex, Gemini CLI and Cursor; Claude Code reads
  `.claude/skills/`; Cursor also reads `.claude/skills/` and `.codex/skills/`.
- Claude chat: *Customize > Skills > "+" > Create skill > Upload a skill* (ZIP with the skill folder as root), on
  Free, Pro, Max, Ultra, Team, Enterprise; requires code execution. Skills enabled in the Claude account also sync
  into Claude Code >= 2.1.273 and the Microsoft 365 add-ins.
- ChatGPT/Codex: skills "build on the open agent skills standard"; standalone skills in the desktop app, Codex CLI
  and IDE extension; skills bundled in plugins also work in Chat and Work on web and mobile
  (https://learn.chatgpt.com/docs/build-skills.md).
- CLI: npm package `skills` 1.9.0 (vercel-labs/skills), directory https://skills.sh. Discovery in a repository:
  root `SKILL.md`, `skills/`, `.agents/skills/`, `.claude/skills/`, ... (walked three levels deep).
  **Static-site route** (read from `skills@1.9.0` source, `WellKnownProvider`): for any non-GitHub URL the CLI
  fetches `<origin>[/path]/.well-known/agent-skills/index.json` then `.well-known/skills/index.json`.
  v0.2.0 index: `{"$schema":"https://schemas.agentskills.io/discovery/0.2.0/schema.json","skills":[{"name",
  "description" (<=1024),"type":"skill-md"|"archive","url","digest":"sha256:<64 hex>"}]}`; legacy v0.1.0:
  `{"skills":[{"name","description","files":["SKILL.md",...]}]}`. Direct archive URLs also work (limit 10 MiB
  download, 25 MiB extracted, 1000 files). GitHub Pages can serve this.
- AGENTS.md (https://agents.md): "used by over 60k open-source projects"; read by Codex, Cursor, Gemini CLI, Jules,
  Copilot coding agent, VS Code, Zed, Windsurf, Devin, Amp, opencode, RooCode, Aider, goose and others; stewarded
  by the Agentic AI Foundation under the Linux Foundation. Claude Code reads `AGENTS.md` when no `CLAUDE.md` exists
  (https://code.claude.com/docs/en/memory.md#agents-md).
- Other instruction containers: Claude Projects (all plans, five on Free; instructions + knowledge files), Gemini
  Gems (instructions + uploaded files), ChatGPT plugins (skills + apps).
- WebMCP (`navigator.modelContext`): "a proposed web standard", Chrome origin trial M149–M156
  (https://developer.chrome.com/docs/ai/webmcp, updated 2026-10-07; Blink "Intent to Experiment"). Not shipped.

### 4.3 What md.qft.org publishes today **[E]**

`dist/` contains `lesson-format-v2.md`, `lesson.schema.json`, `presentation.schema.json`,
`slidev/interactive-physics.zip`, `robots.txt`, `sitemap.xml`. There is no `llms.txt`, no `.well-known/`, no skill,
no `AGENTS.md`. `docs/SEO.md:35` argues an `llms.txt` "is not required by Google's AI-feature guidance" — true for
search, but agents and the `skills` CLI look for exactly these files. The only AI tool the site names is Codex
(`TeacherWorkflow.astro:11,33`, `site-faq.ts:44`, `README.md:148`).

---

## 5. Critique of the repo's current hand-off

Metrics from `$B7/scripts/prompt-metrics.mjs` (default form values): **[E]**

| Text | Words | Characters | Lines | ~Tokens |
|---|---|---|---|---|
| `generateLessonPrompt` (QFT Markdown) | 849 | 5,693 | 72 | ~1,420 |
| `generateSlidevPrompt` | 454 | 3,307 | 30 | ~830 |
| `public/lesson-format-v2.md` | 1,753 | 11,537 | 181 | ~2,880 |
| `tools/slidev/README.md` | 973 | 6,778 | 144 | ~1,700 |

### 5.1 The format menu does not contain the owner's goal
`TeacherWorkflow.astro:11` offers two formats: "Markdown — edit directly in this workspace" and "Slidev — build
interactive Vue slides with Codex". There is **no Reveal.js prompt**; the QFT prompt forbids it ("No full LaTeX
document, MDX, slide framework directives, or raw HTML layouts", `ai-lesson.ts:77`; "do not paste a React, Slidev,
or Marp project", `:58`). A user who follows the owner's story ("ask an AI for Reveal.js slides") arrives with a
file the site has no door for.

### 5.2 QFT Markdown prompt (849 words)
- It is a private format the model has never seen, specified in prose: 29 imperative rules and 54 numbers.
  Roughly 120 words describe four built-in presets with ranges and step sizes that are validated strictly
  ("Unknown fields, wrong types, out-of-range values, and unsupported increments are rejected").
- **It prefers the shape that needs a ZIP** ("Prefer a separate self-contained HTML file", `:82`) although the
  format also allows inline `interactive` fences. A Gemini or Copilot user cannot produce a ZIP and is left
  assembling folders by hand. A single Markdown file with inline demos would be pasteable.
- **Images**: it demands "actual local PNG, JPEG, WebP, or GIF files" and the format excludes SVG. Chat models
  author SVG natively and can make rasters only with a code sandbox. Expect missing or remote images.
- Models habitually write `onclick=`; the demo sandbox strips inline handlers. The rule is present but is one of 29.
- `projectId`: "generate a fresh UUID" / "keep unchanged when revising" — easy to violate; then the revision
  dialog is skipped and a second document appears.
- It links to `https://md.qft.org/lesson-format-v2.md`, which Claude's sandbox cannot fetch (not on the allow-list)
  and which chat models without browsing cannot read.
- Good: the honesty line ("Do not claim the lesson was tested in md.qft.org unless you actually tested it there").

### 5.3 Slidev prompt (454 words) — terminal required at four points
1. "Use the source/ project in the attached Slidev starter ZIP" — the user must first download a 1.67 MB ZIP
   (it contains a 3.5 MB `presentation.html`, a 1.3 MB notices file, `pack.mjs`, a 364 KB lockfile) and attach it.
   Fallbacks: clone `github.com/renphysics/md.qft.org` (possible in Claude's sandbox, impossible in ChatGPT Chat) or
   download from md.qft.org (not on Claude's allow-list).
2. `npm ci` — 721 packages, ~570 MB; needs the registry and Node >= 22.22.0 (the starter's own `engines` says
   >= 22.12.0).
3. `npm run build` with a bespoke `vite.config.ts` and about 20 headmatter switches that must be preserved
   (`routerMode: memory`, `fonts.provider: none`, `monaco: false`, `presenter: false`, `pwa: false`, ...).
4. `node pack.mjs --dist .build --source . --out lesson.zip --title "..."` — a custom packer with four dev
   dependencies (esbuild, es-module-lexer, fflate, parse5).
- "VERIFY: Open the packaged presentation in md.qft.org, visit every slide, and test each interaction with network
  access disabled" cannot be executed by any chat sandbox and by few agents; it invites either a false claim or a
  long detour. A local checker would make "verify" executable.
- A chat-only user has no Slidev path at all; the UI says so implicitly ("with Codex").

### 5.4 Error messages and reports
- `presentation-package.ts:328` answers a **Reveal.js** project ZIP with "This is a website build ZIP. Follow
  tools/slidev/README.md and use the QFT Slidev packaging tool ..." — wrong framework, and `tools/slidev/README.md`
  is a repository path, not a link.
- `presentation-package.ts:291–301` (`sourceOnly`) runs before the build check, so a ZIP that contains a compiled
  `dist/` *and* the source is rejected as "Slidev source, not a playable presentation".
- `markdown-workspace.ts:1387`: a `.html` file gives "Choose Markdown (.md), plain text (.txt), a lesson ZIP, or a
  prepared Slidev presentation ZIP."; the file picker (`MarkdownWorkspace.astro:87`) does not list `.html` at all.
- `presentation-runtime.ts:164–189`: any `script[src]`, stylesheet link, iframe or non-`data:` `src/href` throws;
  `:180` removes every `on*` attribute silently; `:127–134` + `:237–245`: one uncaught error or CSP violation
  removes the frame ("Rebuild it with the portable Slidev packaging tool").
- "Check lesson" exists only for QFT Markdown. Its text report is decent (sample: 7 issues, 1,418 characters), but
  demo-breaking findings are only WARNINGs, there is no deck identity or revision, and it does not say what the AI
  should send back. Rejected presentation ZIPs get a one-line error and no report.
- `presentation.schema.json` fixes `"engine": {"const": "slidev"}`; there is no manifest for a Reveal deck.

### 5.5 Revision loop today
`lesson-revision.ts` compares files of two versions when a ZIP with the same `projectId` is opened (two-way, no
base revision), keeps a recovery copy, and lets the teacher update or open a copy. For Slidev packages "Editing
`source/slides.md` does not change the compiled player"; the Source tab is read-only. A chat tool that cannot
return a ZIP cannot take part in the loop at all.

---

## 6. Experiments

### 6.1 Baseline: what the current importer does with natural shapes **[E]**

`SHARED=<shared dir> node $B7/scripts/baseline-import.mjs` builds 12 ZIPs in `$B7/corpus/` and passes each to the
repo's own `inspectPresentationArchive` and, when that returns null, to `importWorkspaceBundle`
(results in `$B7/baseline-import-results.json`).

| ZIP | Content | Result |
|---|---|---|
| A | `index.html` (reveal via CDN) | REJECTED: "A ZIP bundle must contain one Markdown document, or a QFT document manifest." |
| A2 | real Claude lecture, single HTML | same rejection |
| B | `index.html` + `README.md` | **Imported as a Markdown document titled "README"** (deck kept as an inert extra file) |
| C | `index.html` + reveal 6 `dist/` | REJECTED: "This is a website build ZIP. Follow tools/slidev/README.md and use the QFT Slidev packaging tool ..." |
| D | C + `README.md` | **Imported as Markdown document "README"** |
| E | C inside a folder | same rejection as C |
| F | Slidev source (`slides.md`, `package.json`, `.vue`) | REJECTED: "This ZIP contains Slidev source, not a playable presentation. ..." |
| G | Slidev `slides.md` only | **Imported as a QFT Markdown document "slides"** (document mode) |
| H | `slidev build` output, base `/` | REJECTED as "website build ZIP" |
| I | `slidev build --base ./` output | same |
| J | relative `dist/` + source | REJECTED as "Slidev source" although it is built |
| K | Slidev source in a folder + README | REJECTED as "Slidev source" |

0 of 12 play. 3 of 12 are silently mis-imported.

### 6.2 Natural Reveal decks in the real player **[E]**

Prototype `$B7/scripts/inline-deck.mjs` (string processing only, about 150 lines):
1. `<script src>` / `<link rel=stylesheet>` pointing at reveal.js or KaTeX on jsDelivr, unpkg or cdnjs (any
   version, minified or not, v3–v6 path layouts) -> inline copy of the site's bundled reveal.js 6.0.2 / KaTeX
   0.19.1; KaTeX fonts inlined as woff2 `data:` URIs; Google Fonts and preconnect links dropped.
2. Relative scripts, stylesheets and images -> inlined from the ZIP.
3. The reveal math plugin -> KaTeX + auto-render + a 12-line `RevealMath` shim (covers `.KaTeX`, `.MathJax2/3/4`).
4. Optional 5-line guard that wraps `history.replaceState/pushState` in try/catch.
5. Anything else is reported as unresolved.

`node $B7/scripts/play-test.mjs` (results: `$B7/play-test-results.json`, screenshots `$B7/shots/`):

| Case | Bytes in -> played | Player state | Inside the sandbox |
|---|---|---|---|
| Claude lecture 1, **raw** | 73,212 | `error`: "This presentation has separate JavaScript files. Create a portable ZIP with the Slidev packaging tool before opening it." | — |
| Claude lecture 1, inlined, **no history guard** | -> 1,534,337 | `error`: "Failed to execute 'replaceState' on 'History': A history state object with URL '' cannot be created in a document with origin 'null' and URL 'blob:null/...'" | — |
| Claude lecture 1, inlined + guard | -> 1,534,650 | **ready** in under 1 s | Reveal 6.0.2, 28 slides, 126 KaTeX nodes, 0 raw `$`, ArrowRight navigates, slider redraws canvas, origin `null`, 0 network requests |
| Claude lecture 2 | 164,669 -> 1,626,107 | **ready** | 44 slides, 301 KaTeX nodes, 11 canvases, slider works, 0 requests |
| UChicago lecture 07 (4.5.0 via cdnjs, Markdown + Highlight + Math plugins, relative CSS, images) | 52,588 -> 2,308,761 | **ready** | 74 slides, 74 Markdown sections parsed, 171 KaTeX nodes via the shim, 5 highlighted blocks, 4/4 images, 0 requests |
| ryanbbrown skill example (5.1.0 + chart.js + chart plugin + Font Awesome) | 31,597 -> 215,866 | `error`: "Uncaught ReferenceError: RevealChart is not defined" | libraries outside the bundle |
| Profile reference deck (section 8.1 output) | 3,460 -> 1,398,142 | **ready** | 4 slides, 4 KaTeX nodes, navigation and slider OK, 0 requests |

`node $B7/scripts/play-zip-test.mjs`: corpus ZIPs A, B, C, D, E all reach **ready** (entry = shortest
`index.html`; one enclosing folder stripped; README ignored), 0 network requests.

Conclusions:
- Coercing decks written for reveal.js 4.5.0/4.6.1 onto the bundled 6.0.2 worked for 3 of 3 real decks, including
  the Markdown, Highlight and Notes plugins. Only one engine version needs to be shipped (sample is small).
- Remaining failure class: third-party libraries (Chart.js, Font Awesome, ...). The report must name them.
- The player's "one error kills the deck" rule turns an optional missing library into a blank stage.
- Overhead per deck is 0.7–2.3 MB (white/black theme 575 KB, highlight plugin 921 KB, KaTeX + fonts ~0.65 MB),
  far below the 24 MB limit.

### 6.3 What a Slidev build needs to be portable **[E]**

`$B7/scripts/slidev-dist-test.mjs`, `slidev-dist-test-hash.mjs`, `slidev-prompt-test.mjs`, `slidev-memory-test.mjs`
serve a build from the sub-folder `/decks/talk/` (or `/u/decks/wave/`) of a fake origin with all other network
aborted.

| Build | From a sub-folder, offline |
|---|---|
| stock `slidev build` (base `/`, history router) | blank page; 404 for `/assets/index-*.js` ...; Google Fonts request blocked |
| `slidev build --base ./` (history router) | assets load, app shows Slidev's own "404 Page /decks/talk/index.html not found" |
| same, served from `/` | works, navigates to `/2` (needs SPA rewrites on reload) |
| headmatter `routerMode: hash` + `fonts: {provider: none}`, `--base ./` | **works**: `#/1` -> `#/2`, 0 external requests, 0 errors, 106 files, 2.1 MB |
| headmatter `routerMode: memory` + `fonts: {provider: none}`, `--base ./` | **works**: URL never changes, navigation OK, Mermaid diagram renders offline (59 files / 3.1 MB fetched by then) |

The exact sequence in the Slidev prompt (section 8.2) was run from an empty directory: `npm init -y`,
`npm install -D @slidev/cli@53.1.0 vue` (39 s), build fails for the missing theme, `npm install -D
@slidev/theme-default` (1 s), `npx slidev build --base ./` (4 s). Result from a sub-folder, offline: KaTeX
rendered, `/dot.png` from `public/` loads, `./images/dot2.png` is bundled as `assets/dot2-<hash>.png`, the Vue
component's slider updates its SVG path. One harmless 404 for the original `images/dot2.png` path. The project ZIP
(source + `dist/` + lockfile, no `node_modules`) is 109 files, 1,291 kB (`$B7/corpus/L-slidev-built-per-prompt.zip`).

The compiled bundle contains the resolved config, e.g. ``routerMode:`history` `` — a checker can read the router
mode statically.

Not tested here (belongs to the player architecture): whether md.qft.org can *play* a multi-file ES-module build.
Today's player needs one self-contained HTML, which is what `tools/slidev/pack.mjs` produces.

---

## 7. Hand-off contract options, ranked

Options:
- **O1** accept the natural single HTML (file, drop, **paste**), with the adapter of 6.2
- **O2** accept ordinary project ZIPs (entry detection, enclosing folder, README tolerated, relative assets)
- **O3** accept a standard Slidev build (`--base ./`, router hash/memory), alone or inside the project ZIP
- **O4** accept Slidev source (in-browser compile or a Markdown-subset preview) — feasibility is another task
- **O5** short compatibility-profile prompts (section 8.1, 8.2)
- **O6** published agent skill + starter + zero-dependency checker/packer script
- **O7** web "Check deck" report that is pasted back to the AI (section 8.4)
- **O8** template repository with a GitHub Action that builds Slidev and attaches the ZIP
- **O9** deep link to the paste box, folder drop, File System Access "open folder"
- **O10** MCP / WebMCP surface

### 7.1 Chat-only users (Claude, ChatGPT, Gemini, Copilot in a browser or phone)

| Rank | Option | Why |
|---|---|---|
| 1 | O1 incl. paste | It is what every chat tool emits; Gemini and Copilot can emit nothing else. Measured: 0/12 -> Reveal shapes 6/6 after the adapter; 3/3 real decks. Needs no prompt at all. |
| 2 | O7 | Turns each residual failure into one copy-paste round. Only the site can observe run-time errors and CSP violations. |
| 3 | O5 | Removes the residual causes in advance (foreign libraries, `onclick`, `fetch`, images by URL). 191 words. |
| 4 | O2 | For Claude and ChatGPT, which do hand over ZIPs; fixes the README mis-import. |
| 5 | O6 as an uploadable skill ZIP | One-time install for Claude (all plans) and ChatGPT plugin users; better consistency on repeat use. |
| 6 | O8 | The only Slidev route for people without Node whose AI cannot build; needs a GitHub account. |
| 7 | O3 | Reachable from chat only via Claude's sandbox or ChatGPT Work. |
| 8 | O9 (deep link `…/#paste`) | Convenience; lets the AI end its answer with one link. |
| 9 | O10 | No chat client can use it today. |

### 7.2 Coding-agent users (Codex, Claude Code, Cursor, Gemini CLI, Copilot agent)

| Rank | Option | Why |
|---|---|---|
| 1 | O6 | Agents load skills automatically (Slidev's has 14.2K installs) and can run a checker and fix before delivering; replaces the 454-word prompt and the un-runnable VERIFY step. |
| 2 | O3 | Removes the bespoke starter, Vite profile and packer: two headmatter lines and one flag, verified. |
| 3 | O2 + O1 | Standard Reveal projects and single files "just open". |
| 4 | O9 folder drop / open folder | Best revision loop: the folder on disk is the shared source of truth. `DataTransferItem.webkitGetAsEntry` (read a dropped folder) exists in Chrome 13+, Edge 14+, Firefox 50+, Safari 11.1+; `showDirectoryPicker` (re-read and write back) is Chromium-only (Chrome 86+, Chrome Android 132+; Firefox and Safari: no) per MDN browser-compat-data. |
| 5 | O7 | Same report as the CLI checker, plus run-time facts the agent cannot see. |
| 6 | O8 | Fits cloud agents, which all work on GitHub repositories; CI produces the ZIP. |
| 7 | O5 | Fallback when no skill is installed; also the body of an `AGENTS.md` snippet. |
| 8 | O10 | A stdio MCP wrapper adds nothing over a CLI for shell-capable agents; WebMCP is an origin trial. |

The rankings are judgments **[I]** resting on the measurements above; no third-party model was driven end-to-end.

### 7.3 The revision loop — keeping both sides in sync

Principle: **the site holds the authored source, and derives the playable form from it.** For a Reveal deck the
stored source is the original `index.html` with its CDN links; the inlined 1–2 MB document is a cache. Editing in
the browser edits the source and re-derives.

1. **Identity and revision travel inside the file.** On first import the site adds
   `<meta name="qft-deck" content="id=<uuid>; rev=<sha256-12>">`. Every export rewrites `rev` to the hash of the
   exported source. For Slidev: `qft-deck.json` beside `slides.md`. The prompt and the skill say only "keep this
   line/file unchanged".
2. **Site -> AI**: "Copy for AI" (whole file to the clipboard) and "Download for AI" (file or ZIP). For big decks:
   "Copy this slide for AI" — one `<section data-qft-id="s7">` preceded by a comment carrying deck id and rev.
   Stable slide ids replace slide counting (the failure reported by the lecturer blog).
3. **AI -> site**: paste, drop or open. Same `id` and incoming `rev` == stored head: show the per-file / per-slide
   diff (existing `lesson-revision.ts` dialog), default "Update", keep a recovery copy. Incoming `rev` older than
   head (the user edited meanwhile): warn "this revision was made from an older copy" and offer keep mine / take
   theirs / open as copy. Missing id: new deck. A pasted single `<section data-qft-id>` replaces that slide only.
4. **Report**: the check report repeats `deck.id` and `deck.rev`, lists `handledForYou` (things the AI must not
   "fix"), and ends with the exact reply shape.
5. **Coding agents**: the folder is the source of truth; the site reads it (drop / open folder), the agent edits
   it, git records history. Where `showDirectoryPicker` exists the site can write browser edits back.
6. **Slidev**: source edits need a rebuild. Until the site can build, an edit made in the browser must be exported
   to whoever rebuilds (agent, GitHub Action); the UI should say "source changed — rebuild needed" instead of
   silently playing the stale build.

### 7.4 Notes on the smaller options
- Deep link carrying the deck in the URL fragment (`#deck=<base64 gzip>`): the fragment never reaches a server, a
  70 KB deck is about 24 KB after gzip + base64, but chat UIs truncate long links and models need a code tool to
  produce it. Experimental. **[I]**
- Loopback bridge (`npx … open deck.zip` serving on 127.0.0.1): works against Private Network Access prompts and
  adds attack surface; not recommended. **[I]**
- PWA `file_handlers` / share target: Chromium desktop / Android only and need an installed PWA. **[I]**
- npm names `qft-deck`, `qft-slides`, `md-qft`, `qft-markdown`, `@qft/deck` are unregistered today (`npm view` ->
  E404). **[E]**

---

## 8. Draft artefacts (files in `$B7/artefacts/`)

### 8.1 Reveal.js prompt for chat users — 191 words (`prompt-reveal-chat.txt`)

```text
Make my slides as ONE self-contained reveal.js file, index.html, for the offline player at md.qft.org.

Topic: [TOPIC]. Audience: [AUDIENCE]. Length: [MINUTES] minutes. Language: [LANGUAGE].

Load exactly these four files and nothing else from the internet:
https://cdn.jsdelivr.net/npm/reveal.js@6.0.2/dist/reveal.css
https://cdn.jsdelivr.net/npm/reveal.js@6.0.2/dist/theme/white.css
https://cdn.jsdelivr.net/npm/reveal.js@6.0.2/dist/reveal.js
https://cdn.jsdelivr.net/npm/reveal.js@6.0.2/dist/plugin/math.js

Rules:
- Call Reveal.initialize({ hash: false, width: 1280, height: 720, plugins: [RevealMath.KaTeX] }). Write maths as $...$ and $$...$$.
- Put all other CSS and JavaScript inline in this one file. No other libraries, fonts, images or data from URLs. No fetch, iframes, ES modules, workers or eval.
- Build each interactive demo from canvas or SVG with labelled sliders and a Reset button. Attach handlers with addEventListener, never onclick attributes.
- Draw figures as inline SVG; embed photos as data: URIs.
- One idea per slide. Reveal steps with class="fragment". Put what I should say in <aside class="notes">.
- If I give you an existing deck, edit that file and keep its <meta name="qft-deck"> line unchanged.

Reply with the complete index.html in a single code block, or as a downloadable file. If I paste a "deck check" report from md.qft.org, fix exactly what it lists and return the whole file again.
```

Design notes: the four URLs are spelled out because models default to the pre-6 plugin path; the same file also
works when opened directly online; a deck that follows this prompt was written by hand
(`$B7/contract/reveal-profile-reference.html`, 3,460 bytes) and plays in the real player (6.2, last row). The
prompt is only safe to publish once the site has the adapter and the history guard; `hash: false` is belt and
braces. Not covered within 200 words: very long decks hitting chat output limits (a 165 KB deck is roughly 45–50k
tokens) — the checker needs a `truncated-html` code. **[I]**

### 8.2 Slidev prompt for chat users — 197 words (`prompt-slidev-chat.txt`)

```text
Create a Slidev presentation for the offline player at md.qft.org.

Topic: [TOPIC]. Audience: [AUDIENCE]. Length: [MINUTES] minutes. Language: [LANGUAGE].

Start slides.md with exactly this headmatter:
---
theme: default
routerMode: memory
fonts:
  provider: none
---

Rules:
- Use Slidev Markdown: --- between slides, built-in layouts, v-click, $...$ and $$...$$ maths, fenced code.
- Write each interactive demo as a Vue component in components/ (script setup, sliders, SVG or canvas, a Reset button) and place it with <MyDemo />. Import only from "vue".
- No other packages, themes or addons. No remote images, fonts, iframes, fetch, Monaco or PlantUML. Put pictures in public/ and reference them as /name.png.
- If I give you an existing project, edit it and leave other files unchanged.

If you can run shell commands with npm access, build it:
npm install -D @slidev/cli@53 @slidev/theme-default vue
npx slidev build --base ./
and give me ONE zip containing slides.md, components/, public/, package.json, package-lock.json and dist/ (never node_modules).

If you cannot run commands, say "NOT BUILT" and give each file in its own code block headed by its path.

If I paste a "deck check" report from md.qft.org, fix what it lists, rebuild, and return the zip.
```

Design notes: every technical line was executed here (6.3). `memory` is used because it never touches the URL and
is what the existing player already relies on; `hash` also passed the sub-folder test; the default `history` does
not. The official Slidev skill documents only `history | hash`. The "NOT BUILT" branch is honest about Gemini,
Copilot and ChatGPT Chat; what the site does with unbuilt source is an open architecture question.

### 8.3 SKILL.md outline for coding agents (`SKILL.outline.md`, 64 lines, 651 words; description 191 characters)

```markdown
---
name: qft-deck
description: Build or revise Reveal.js and Slidev decks that play offline in md.qft.org. Use for slides, lectures or interactive presentations for md.qft.org, or when given a md.qft.org deck check report.
license: MIT
compatibility: Reveal decks need no tools. Slidev decks need Node.js 22.22+ (required by @slidev/cli 53) and npm registry access. The checker runs on Node 20+ with no dependencies.
metadata:
  author: md.qft.org
  version: "1.0"
  profile: qft-deck/1
---
# qft-deck — decks for the offline player at md.qft.org
(what the player is: sandbox, no network, bundles reveal.js 6 + KaTeX)
## 0. Choose the engine            Reveal single index.html by default; Slidev on request; revising -> section 3
## 1. Reveal.js workflow           copy assets/reveal-starter/index.html -> write <section>s -> maths -> demos
                                   -> assets -> hard rules (each = a check code) -> node scripts/check.mjs deck/
                                   -> deliver index.html or node scripts/pack.mjs deck deck.zip
## 2. Slidev workflow              copy assets/slidev-starter/ -> keep routerMode: memory|hash, fonts.provider: none
                                   -> Vue SFC demos, pictures in public/ -> node -v >= 22.22 -> npm ci
                                   -> npx slidev build --base ./ -> check -> pack (source + dist/, no node_modules)
                                   -> if no npm: deliver source, say NOT BUILT, point to build-without-node.md
## 3. Revising a deck              exported file is the source of truth; keep qft-deck id; address slides by id;
                                   given a qft-deck-check/1 block: compare deck.rev, fix mustFix in order,
                                   leave handledForYou alone
## 4. Report back honestly         engine, slide count, checker verdict + exit code, what was not tested
## References                      reveal-profile.md, slidev-profile.md, check-codes.md, teaching.md,
                                   build-without-node.md
```

Folder: `SKILL.md`, `references/` (5 files), `assets/reveal-starter/index.html`, `assets/slidev-starter/`
(slides.md, components/Demo.vue, package.json, package-lock.json ≈ 353 KB), `scripts/check.mjs`, `scripts/pack.mjs`
(both zero-dependency so they also run where npm is unreachable). Because the site bundles the engine, the Reveal
starter is a few KB; the whole skill stays far below the `skills` CLI download limit (10 MiB).

Distribution:
- repository `skills/qft-deck/` -> `npx skills add renphysics/md.qft.org`
- site `/.well-known/agent-skills/index.json` (`well-known-index.example.json`) + `/skills/qft-deck.zip`
  -> `npx skills add https://md.qft.org`; the same ZIP is uploaded in Claude > Customize > Skills
- site `/llms.txt` (`llms.example.txt`) linking `/ai/reveal.md`, `/ai/slidev.md`, `/ai/check-codes.md`
- a 10-line `AGENTS.md` block for template repositories.

### 8.4 Report format `qft-deck-check/1` (`report.schema.outline.json`; prototype `$B7/scripts/check-deck.mjs`;
examples `$B7/check-report-examples.txt`)

Shape: one short human line, then one fenced JSON object.

```json
{
 "report": "qft-deck-check/1",
 "verdict": "blocked",
 "deck": { "id": "unassigned", "rev": "sha256-cebe8ea0358a", "kind": "reveal-html", "entry": "index.html",
           "engine": "reveal.js 5.1.0", "files": 1, "bytes": 31597, "slides": 17 },
 "mustFix": [
  { "code": "lib-not-bundled", "where": "index.html:19", "found": "https://cdn.jsdelivr.net/npm/chart.js",
    "fix": "md.qft.org plays offline and bundles only reveal.js and KaTeX. Remove this script or paste its code inline; do not load it from a URL." }
 ],
 "shouldFix": [],
 "handledForYou": [ "reveal.js 5.1.0 from cdn.jsdelivr.net replaced by bundled reveal.js 6.0.2",
                    "Reveal hash/history option neutralised (URL updates are not available in the player)" ],
 "runtime": { "state": "error", "message": "Uncaught ReferenceError: RevealChart is not defined" },
 "rules": "https://md.qft.org/ai/reveal.md",
 "reply": "Fix every mustFix item and return the complete corrected index.html in one code block. Keep the qft-deck id. Do not change slide content that is not mentioned."
}
```

Rules of the format:
- `verdict`: `plays` | `plays-with-notes` | `blocked`.
- `deck.kind`: `reveal-html` | `reveal-project` | `slidev-dist` | `slidev-source` | `qft-lesson` | `unknown`.
- Issue = `{code, where, found (<=120 chars), fix (one imperative sentence)}`; at most 20 per list.
- `handledForYou` exists so the AI does not undo automatic adaptations.
- `runtime` is filled only after the user starts the deck: state, first error (<= 350 chars), CSP violations as
  `"<directive> <blocked-uri>"`, slide count, rendered-math count, `networkRequests: 0`.
- `reply` states the exact shape of the answer.
- No slide text beyond evidence snippets; say so next to the Copy button.

Codes implemented in the prototype: Reveal — `not-reveal`, `lib-not-bundled`, `missing-file`,
`inline-event-attribute`, `network-call`, `embedded-frame`, `remote-module`, `eval`, `worker`, `external-markdown`,
`remote-image`, `storage`, `persistent-storage`, `math-not-rendered`, `runtime-error`; Slidev —
`slidev-not-built`, `slidev-missing-component`, `slidev-absolute-base`, `slidev-history-router`, `remote-font`,
`no-source`; general — `no-entry`. To add: `truncated-html`, `too-large`, `slide-overflow` (measured in the
player), `theme-not-installed`.

Prototype output on the corpus (all eight validate against the schema with ajv 2020):

| Input | Characters | Verdict | mustFix |
|---|---|---|---|
| Claude lecture 1 | 1,013 | plays-with-notes | — (6 items handled) |
| ryanbbrown example | 2,078 | blocked | 3x `lib-not-bundled`, `missing-file` |
| profile reference | 713 | plays-with-notes | — |
| F Slidev source | 1,005 | blocked | `slidev-not-built` |
| H Slidev dist, base `/` | 1,531 | blocked | `slidev-absolute-base`, `slidev-history-router` |
| C Reveal 6 project | 624 | plays-with-notes | — |
| B HTML + README | 706 | plays-with-notes | — |
| L Slidev built per prompt | 483 | plays | — |

Known prototype weakness: a currency `$` once triggered `math-not-rendered`; the rule now requires `\`, `^` or `_`
between the dollars.

---

## 9. Open questions and risks

1. Can md.qft.org play a standard multi-file Slidev build (ES-module graph) inside its sandbox, or must the
   single-HTML packing stay? This decides whether O3 removes `pack.mjs` or merely moves it into `scripts/pack.mjs`.
2. What should the site do with unbuilt Slidev source from Gemini/Copilot/ChatGPT Chat users?
3. Does Claude's chat sandbox have Node >= 22.22 and enough disk (~1 GB) for Slidev 53? Not verifiable from here.
4. ChatGPT Chat's container: are `npm install` and ZIP downloads working this month? Sources disagree over 2026.
5. How often do GPT- and Gemini-written decks use inline `on…=` handlers, MathJax, Chart.js/Plotly/Three? My real
   sample is five decks, none from those models. A rewrite of inline handlers at prepare time is possible without
   `eval` and would need a test corpus.
6. Version coercion (4.x/5.x -> 6.0.2) held for 3/3 decks; plugins outside the six official ones and decks using
   removed 3.x APIs are untested.
7. Should MathJax be bundled (web-wide it is requested ~4x as often as KaTeX) or mapped onto KaTeX via the shim?
8. Speaker notes: `<aside class="notes">` survive, but reveal's speaker window cannot open in the sandbox.
9. Deck identity inside the file means two people sharing a file share an id; acceptable?

---

## 10. File index

- Notes: this file.
- `$B7/artefacts/` — `prompt-reveal-chat.txt`, `prompt-slidev-chat.txt`, `SKILL.outline.md`,
  `report.schema.outline.json`, `well-known-index.example.json`, `llms.example.txt`
- `$B7/scripts/` — `inline-deck.mjs` (adapter), `check-deck.mjs` (report), `play-test.mjs`, `play-zip-test.mjs`,
  `baseline-import.mjs`, `slidev-dist-test.mjs`, `slidev-dist-test-hash.mjs`, `slidev-prompt-test.mjs`,
  `slidev-memory-test.mjs`, `prompt-metrics.mjs`, `current-report-sample.mjs`, `analyze-deck.mjs`, `fetch-full.mjs`
- `$B7/corpus/` — 13 ZIPs (A–L); `$B7/real-decks/` — downloaded decks (untrusted input; only opened in headless
  Chromium with network aborted)
- `$B7/contract/reveal-profile-reference.html` — reference output of prompt 8.1
- `$B7/inlined/` — adapter outputs; `$B7/shots/` — screenshots
- `$B7/baseline-import-results.json`, `$B7/play-test-results.json`, `$B7/check-report-examples.txt`,
  `$B7/out-qft-prompt.txt`, `$B7/out-slidev-prompt.txt`, `$B7/slidev-timing/timing.txt`
- `$B7/dl/` — fetched primary sources (Slidev skill, Agent Skills spec, `skills` CLI 1.9.0, OpenAI/Anthropic/Google
  docs as Markdown, jsDelivr statistics JSON)

Re-run everything:
```sh
B7=../prototypes/B7
SHARED=(scratch)/research/shared
cd $B7/scripts
node prompt-metrics.mjs
SHARED=$SHARED node baseline-import.mjs
node play-test.mjs && node play-zip-test.mjs
node check-deck.mjs
SHARED=$SHARED node slidev-dist-test.mjs
node slidev-prompt-test.mjs      # needs $B7/slidev-prompt-test/dist (kept)
node slidev-memory-test.mjs      # needs $B7/slidev-prompt-test/dist-memory (kept)
```
