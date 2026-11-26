# QFT Markdown

A reusable workspace for turning **AI answers, notes, and mathematics into documents and interactive presentations**, released under the **MIT license**. Paste Markdown, insert pictures, organize sections, or teach with a live physics demonstration. Keep editable Markdown with its images, portable HTML, or a PDF saved through your browser.

Built with Astro, CodeMirror, markdown-it, KaTeX, and reveal.js. The application runs in the browser and deploys as static files on **GitHub Pages**. Drafts and imported images stay in this browser's storage; there are no accounts or cloud documents. You can fork it, change the branding, and host it on your own domain or GitHub project URL.

## What you can do

- Start with a blank document, paste plain text or Markdown, open a file, or choose an example. Returning visitors resume their saved draft.
- Choose **Create with AI** for a copyable lesson brief and working starter ZIP. Open the AI's project, run **Check lesson**, and copy a compatibility report back to the AI when needed. The website does not require an AI account or API key.
- Open a Reveal.js deck or a Slidev build that an AI tool made, as an HTML file or a ZIP. It plays offline in an isolated player, with notes on anything that was replaced or left out and a report to copy back to the AI. Edit a Reveal.js deck's source files and replay it on the same slide.
- Keep editable slide source, separate demo HTML files, pictures, and notes together in a **Project ZIP**. Reopen an AI revision, review the changes, and update the existing lesson with a recovery copy or import a new copy.
- Paste into a new document or append text to the current one, with an optional section title.
- Review formatting changes in **Clean up**, choose **General Markdown** or **HackMD**, and copy the result or create a formatted draft. Changed lines and compatibility notes help you review the output; the original draft is retained.
- Move complete peer sections, including their nested headings, equations, code, and paragraphs. Undo section moves from the organizer.
- Search saved document titles and text.
- Choose **Clean**, **Study Notes**, or **Academic** presentation for PDF and HTML. Adjust paper size, orientation, margins, text size, spacing, optional author, contents, and major-section page breaks.
- Write in a CodeMirror editor with line numbers, undo/redo, find and replace, and adjustable text size. Switch between split view, editor, and preview; resize the panes and toggle synchronized scrolling.
- Use inline and display mathematics with `$…$`, `$$…$$`, `\(…\)`, and `\[…\]`.
- Insert PNG, JPEG, WebP, and GIF pictures through **Insert image**, clipboard paste, or drag and drop. Pictures save with the draft without filling its Markdown with base64 text.
- Switch between **Document** and **Slides** without adding another toolbar. Use `---` slide breaks, Paper/Midnight/Academic themes, 16:9 or 4:3 proportions, and fullscreen **Present** playback.
- Insert interactive wave-packet, Bloch-sphere, effective-potential, and interference demonstrations, or add a self-contained HTML/CSS/JavaScript demo. Run each explicitly inside an isolated frame.
- Keep named drafts with automatic local saving. Concurrent edits in other tabs are preserved as conflict copies.
- Import a `.md` file as a separate draft and download Markdown without changing its source.
- Download **Markdown + images** as an editable ZIP with local pictures and slide settings, then reopen it using **Open file**.
- Use **Slide bundle** to retain slide mode, theme, and proportions even when a presentation has no local pictures.
- Export a portable HTML document with embedded math fonts, or open **Save PDF** to style the document before using the browser's print dialog.
- Export a standalone interactive HTML presentation or a slide PDF with one page per slide.
- Start from study notes, a project report, mathematical and physics examples, or the Markdown field guide; use the outline to navigate longer notes.
- Read in light or dark mode. Math errors remain visible and link back to their source.
- Choose whether to load remote images. They are blocked by default.

## From pasted text to a document

1. Choose **Paste** and insert plain text or Markdown. Use the source form of equations and code when it is available from the application you are copying from. Pasting does not import rich HTML or call an AI service.
2. Choose **Clean up** and select **General Markdown** to review formatting suggestions. It can remove a complete outer `md`/`markdown` code fence, raise document headings together, and trim outer blank lines. Review the highlighted changes, then choose **Copy Markdown** or **Create formatted copy**. The copy action is available even when no changes are needed; creating a new draft requires a change.
3. Use **Organize** to move whole sections. A unique first heading above the others is kept as the document title, together with its introduction. Each move updates the editable Markdown and can be undone.
4. Open **Save PDF**, choose a style, and review the typography preview. **Save PDF** then opens the browser's print dialog; choose its PDF destination and check the final pagination. **Download HTML** uses the same document presentation.

The PDF setup includes A4/US Letter, portrait/landscape, three margin presets, 10–13 pt text, spacing, optional author, a linked table of contents, and page breaks before major sections. **Add a title if missing** preserves existing Markdown headings. The typography preview shows the selected appearance; final page boundaries and the destination are controlled by the browser.

Document PDF-style preferences are saved per draft in localStorage, separately from its Markdown. Slide mode, theme, and aspect ratio save with the draft and travel in an exported ZIP bundle. Plain Markdown contains source text and references, not these application preferences or local image bytes. Cleanup and organization are formatting tools; they do not summarize text, validate citations, or rewrite claims.

Live preview, the paste dialog, and structural tools support up to 400,000 characters. Keep longer material in smaller documents for these features. Markdown downloads preserve the source independently of the rendered preview.

## Copy Markdown for HackMD

Open **Clean up**, choose **HackMD** under **Format for**, and review the selected changes. **Prepare mathematics for HackMD** converts recognized `\(...\)` and `\[...\]` delimiters to dollar delimiters and handles Markdown-sensitive mathematical lines when it can do so safely. For example, a standalone `=` can become a Markdown heading underline even inside `$$`; the formatter can join it to the preceding mathematical line:

```markdown
$$
ds_{\mathrm{ind}}^2 =
-\sin^2\theta_0\,dt^2
+4L^2\sin^2\theta_0\,d\Omega_5^2.
$$
```

Use **Copy for HackMD** to paste the reviewed result into HackMD, or **Create formatted copy** to keep editing it here. Both actions use the selected changes. If clipboard access is unavailable, select and copy the visible result. The original document remains available. Processing happens in this browser; copying does not publish or upload a HackMD note.

A math line beginning with `>`, such as `>0.`, can start a Markdown blockquote. Within recognized display math, the formatter joins that continuation to the preceding mathematical line when safe. This also works with existing dollar delimiters and preserves the inequality, TeX row breaks, and comments. A comment or macro definition that prevents safe joining is reported for review.

**Remove link tracking** is selected by default when HackMD preparation finds UTM tags or common tracking IDs in Markdown links. For example, `[arxiv.org](https://arxiv.org/html/0808.2691v3?utm_source=chatgpt.com)` becomes `[arxiv.org](https://arxiv.org/html/0808.2691v3)`. Review the cleaned links in the preview or uncheck the option to keep the original URLs. It supports link and image destinations, reference definitions, and angle autolinks; other URL parameters, fragments, labels, and titles retain their source spelling. Code, mathematics, raw HTML tags, and signed URLs are preserved. Copying leaves the original draft unchanged.

The dialog distinguishes no applicable changes, unchecked suggestions, and processing limits. **No changes found by these checks** describes the formatter's checks, not a guarantee that every feature will render in another editor. Code examples, genuine TeX row breaks, and comment semantics are preserved. Ambiguous delimiters or escaping are kept with a compatibility note instead of being globally unescaped; review these notes before copying.

Check the destination preview, especially when using custom macros or mathematical extensions. HackMD's MathJax configuration can differ from this editor's KaTeX renderer. Copying Markdown does not upload browser-local images or transfer custom interactive demo playback: upload the images or use accessible URLs, and share an HTML export when you need a working demonstration.

## Pictures and portable drafts

Choose **Insert image**, paste an image into the editor, or drop image files onto the workspace. Imports support PNG, JPEG, WebP, and GIF, with limits of **8 MiB per image**, **24 MiB total**, and **50 images per draft**. File signatures determine the image format. Local pictures are stored as blobs with the draft in IndexedDB; short Markdown references resolve to browser-local image URLs while editing. Image bytes do not count toward the Markdown character limit.

When a draft has local pictures, its Markdown download becomes **Markdown + images**, an editable ZIP bundle. It contains the Markdown, image files, and slide settings, and can be reopened through **Open file**. A plain `.md` import cannot read neighboring files on your computer. Source text copied into a Markdown-only file contains local image references but does not contain those images.

Ordinary HTTPS image links are supported when **Load remote images** is enabled in Settings. Those links remain remote in Markdown bundles. HTML exports embed local images and attempt to embed enabled remote images; their hosts must permit the download. Embedded PNG/JPEG/WebP/GIF data URLs also work, but their text counts toward the source limit.

## Markdown slides

Choose **Slides** in the format selector. **Editor / Split / Preview** still controls the visible panes. Put `---` on its own line, with blank lines before and after, to begin a slide. Separators inside fenced code and display math stay literal. Document mode keeps ordinary horizontal rules.

```markdown
# A presentation

One idea at a time.

---

## An equation

$$
i\hbar\,\partial_t|\psi\rangle=\hat H|\psi\rangle
$$
```

Slides reuse the document Markdown/KaTeX renderer, including all four math delimiters and the same image permissions. Choose **Paper**, **Midnight**, or **Academic**, and **16:9** or **4:3**. **Present** opens fullscreen playback; use arrows to navigate. Keep content short enough to fit each slide.

In Slides mode, **Save PDF** prepares one PDF page per slide through the browser print dialog; check the preview, preferably in a Chromium-based browser. **Download HTML** includes presentation playback, fonts, images, and supported interactive demonstrations in a standalone file. **Slide bundle** keeps editable source plus slide mode, theme, and proportions in a ZIP, including when there are no pictures; **Markdown + images** also carries these settings for decks with local pictures. The five-slide **Quantum phase** example demonstrates equations, lists, and code. This Reveal.js Markdown format does not implement Marp directives or Slidev components. Reveal.js decks and Slidev builds made elsewhere open in the separate presentation library described below. Ordinary HTML and script fences remain displayed source; executable demos use the explicit syntax below.

## Presentations from AI tools: Reveal.js, web pages, and Slidev

Ask an AI tool for slides made with Reveal.js or Slidev, then open what it
gives you here. The file is read and prepared in this browser; nothing is
uploaded. Use **Open file** in the workspace (or drag the file onto it), or
**Presentations** in the sidebar and then **Open presentation**.

| What you open | What happens |
| --- | --- |
| A Reveal.js deck: one `.html` file, or a ZIP with `index.html` at the top | Linked into one self-contained page and played. Its source can be edited here |
| Another web page (`.html` or a ZIP) | Played the same way, and editable |
| An ordinary `slidev build` output: a ZIP of the `dist` folder | Converted in the browser and played. Read-only |
| A portable package with `qft-presentation.json` (made with [the Slidev starter and packager](tools/slidev/README.md)) | Played as before. Read-only |
| An unbuilt Slidev project (`slides.md` and `package.json`) | Explained: it has to be built first, with `npx slidev build` |
| A Markdown file, Markdown bundle, or lesson ZIP | Opened by the Markdown importer, as before |

**Create with AI → Reveal.js** copies a short prompt that asks for one
`index.html` that loads Reveal.js 6.0.2 from jsDelivr (the site substitutes
its own copy), with KaTeX math, speaker notes, and demos written as inline
scripts. No starter file is needed.

### What is changed so a deck plays offline

The player has no network access, so the site prepares each deck first. It
only reads and rewrites text; nothing in the deck runs until you choose
**Start**.

- Reveal.js and KaTeX loaded from a CDN (jsDelivr, unpkg, cdnjs, esm.sh,
  Skypack, jspm), or expected next to `index.html` but missing, are replaced
  by the copies bundled with this site: Reveal.js 6.0.2 with its 14 themes and
  the markdown, highlight, notes, math, search, and zoom plugins, and KaTeX
  0.19.1 with auto-render, mhchem, copy-tex, and its fonts. Decks made for
  Reveal.js 3, 4, or 5 play with Reveal.js 6; some old plugins may not work.
- Decks that typeset formulas with MathJax are typeset with KaTeX instead,
  using the deck's delimiters and macros. A few MathJax-only commands may show
  as errors.
- The deck's own scripts, stylesheets, pictures, media, fonts, and external
  Markdown slides are embedded. Inline handlers such as `onclick` become
  ordinary event listeners.
- Google Fonts and other web fonts are left out; the slides use fonts
  installed on the device. Other files on the internet (scripts, stylesheets,
  pictures, video) are left out too. Embedded pages (`iframe`) and remote
  pictures stay blank or show a placeholder.
- Module scripts that import only Reveal.js or KaTeX use the bundled copies.
  Other module imports cannot be played yet and are reported.
- A Slidev build's modules are bundled into one script with esbuild, running
  in a Web Worker. Its router keeps its history in memory, its styles and
  assets are embedded, and remote fonts and embeds are left out. Builds that
  use the Monaco editor or Web Workers are refused with a note that says why.
  Conversion was checked on builds from Slidev 53.1.0 and 52.11.5; older
  builds may not play.

### Notes from the check and the report for an AI

Every file is checked and prepared before it is saved, so a deck that cannot
play is reported rather than stored. **Notes from the check** lists what was
replaced, left out, or needs a fix (marked **Needs a fix**, **Check**, or
**Note**), and, under **While playing**, up to 20 warnings the deck reported
while it ran. Text from a deck is always labelled as the presentation's own
words and shown as plain text. A deck keeps playing when one of its scripts
fails or a file is missing; portable packages still stop at their first
error. **Copy report for AI** copies a short
plain-text report (`qft-deck-check/1`) that ends with what to send back, so
you can paste it into the AI tool that made the deck.

The player bar shows the slide count a deck reports. **Present** opens
fullscreen, and so does a deck's own fullscreen key, such as **F** in
Reveal.js.

### Edit the source and replay

For Reveal.js decks and other web pages, **Source files** is an editor. Edit a
text file, then choose **Apply changes** (or press Ctrl/⌘+S in the editor):
the deck is prepared again and replays on the same slide and fragment. If the
changed deck cannot be prepared, nothing is applied and the last version that
worked keeps playing. **Discard changes to this file** returns one file to its
imported text, and **Restore original** returns the whole deck.

Edits are saved in this browser beside the original file, which is never
rewritten. **ZIP** downloads the deck with your edits applied; **Original**
downloads it as you imported it (a single HTML file comes back inside a
ZIP). **HTML** downloads a standalone player that opens offline.

Copies of libraries inside a deck (such as `dist/reveal.js` or `*.min.js`),
pictures, fonts, and media are shown but not edited. Portable packages and
Slidev builds are read-only: change the Slidev project, build it again, and
open the new ZIP. Slidev source is not compiled in the browser.

### Limits

- ZIP: 60 MiB, 120 MiB expanded, 1,000 files, 40 MiB per file. A single HTML
  file: 24 MiB.
- The prepared, self-contained deck: 24 MiB. A Slidev build's scripts: 24 MiB.
- Editing: text files up to 2 MiB each, 8 MiB of edited text in total. Source
  previews: 2 MiB per file, 8 MiB in total; larger files stay in the ZIP.
- ZIPs are checked for path traversal, ambiguous or duplicate paths, expansion
  limits, CRC integrity, encryption, and other unsupported archive features.

Presentations are saved in a separate IndexedDB database for this site and
path, with their original files, and a deck already in the library is not
added twice. Opening a saved Slidev build converts it again, which takes a
few seconds. If a deck cannot be saved, it stays in the library until you
leave the page; keep your original file. Reopening the website itself offline is a separate
feature; use the standalone HTML download in a classroom without internet.

### Isolation and privacy

Imported code runs only inside an opaque-origin sandbox (an iframe with
`sandbox="allow-scripts"`) under a restrictive Content Security Policy. A
presentation cannot read your documents or other saved presentations, and
its ordinary network requests are blocked. Opening, checking, linking, and
converting a deck never runs it.

Blocking network requests is a privacy default rather than a guarantee: a
deck written to get around it can still make limited outbound connections (in
current browsers, for example, a prerender or preconnect link, or WebRTC STUN
traffic), which can reveal your IP address and what the deck itself contains.
Open presentations from sources you trust. The sandbox also does not make
code well behaved; in Firefox, a deck with an endless loop can freeze the
tab.

The bundled Reveal.js and KaTeX files, the KaTeX fonts, the Slidev converter,
and its `esbuild.wasm` (about 14 MB, under 4 MB compressed) are served by this
site, loaded only when a deck needs them. No third-party server is contacted
to prepare or play a deck.

## From an AI brief to a classroom lesson

1. Choose **Create with AI**. Enter the topic, audience, language, duration, mathematical depth, and desired demonstrations. Copy the generated instructions into Codex or another AI tool. You can also download a working starter ZIP to give the AI as a reference.
2. Give the AI the relevant chapter or source material in that tool. Ask for a complete version-2 project ZIP with `qft.json`, `slides.md`, local pictures, and self-contained HTML demos. The website itself does not upload material or call an AI model.
3. Open the ZIP in the workspace. Edit the Markdown directly, choose **Edit demo** to revise a demonstration, or use **Lesson files** for other source files. Built-in demos have editable starting values; custom demos keep their HTML in the project.
4. Choose **Check lesson**. The static check reports Markdown/math failures, missing assets, unsupported demo dependencies, and potentially crowded slides. Copy the report back to AI for fixes. It does not verify scientific correctness or execute demo JavaScript: run the controls and rehearse with **Present**.
5. Download **Project ZIP** for the next revision and **HTML** for a classroom copy that opens independently. If AI revises the project, keep its `projectId` and paths; reopening the ZIP lets you review before updating the saved lesson or importing a copy. An update keeps the previous version as a recovery draft.

The [version-2 format guide](public/lesson-format-v2.md) and [manifest JSON schema](public/lesson.schema.json) are public, stable authoring references. Version-1 image/slide bundles remain readable. A lesson project preserves the main Markdown path, supported extra text files, local pictures, and separate demo source. It can be unpacked and edited in an ordinary text editor without using this website.

````markdown
## Predict, then explore

```interactive src="demos/explore.html" title="Explore the model"
```
````

Keep a demo slide to its short heading and interactive block, with prediction questions on the preceding slide. The referenced file contains all needed HTML, CSS, and JavaScript. Linked `.js` and `.css` files can be kept as editable project source, but a running demo requires their code to be inlined. Relative references resolve from the main Markdown file's directory. Project files stay in this browser until downloaded; clearing site data can remove them.

## Interactive teaching demonstrations

Choose **Interactive demo** in the toolbar. Four built-in choices are ready to insert: a spreading Gaussian wave packet, a Bloch sphere with a rotatable camera, a Schwarzschild scalar-field potential, and wave interference. Keep **Add on a new slide** selected for a clean teaching slide. **Open the complete physics lesson** creates a deck containing all four.

````markdown
## Watch a wave packet spread

```interactive wave-packet
```
````

The other preset identifiers are `bloch-sphere`, `effective-potential`, and `interference`. An empty preset fence uses defaults. **Edit demo** can save starting parameters as a JSON object in the fence, for example `{"sigma":1.2,"momentum":0.5,"time":0,"view":"density"}` for a wave packet. Those values travel with the lesson and are used on Run or Restart. The HTML exporter includes the complete demo code, so exported presentations do not require this website or a CDN.

Choose **Run demo** on a preview to start it. The plot and controls work in both the workspace and fullscreen presentation. Timers and animations pause when the slide or browser tab becomes inactive and resume when it returns. **Stop** removes the running frame; **Restart** begins from the initial state. Editing Markdown recreates the affected rendered cards, and running demo state is not part of saved Markdown.

### Custom HTML, CSS, and JavaScript

In the insertion dialog, expand **Use your own HTML & JavaScript**, then paste the source or open a self-contained HTML file. The following syntax also works directly in Markdown:

````markdown
```interactive title="A small counter"
<button id="counter">Count: 0</button>
<script>
  let count = 0;
  const button = document.getElementById('counter');
  button.addEventListener('click', () => {
    button.textContent = `Count: ${++count}`;
  });
</script>
```
````

Use inline `<style>` and `<script>` elements and attach handlers with `addEventListener`. External scripts, module imports, network calls, inline event attributes such as `onclick`, `eval`, nested frames, forms, and popup windows are outside this supported format. Include code and styles directly; use embedded raster data images for assets. A complete Reveal.js deck or Slidev build belongs in the separate presentation library; this small-demo format does not compile React or Vue source. A document supports **20 demo blocks**, each custom block up to **100,000 source characters**, within the editor's overall 400,000-character source limit.

Demos run only after an explicit **Run demo** action. The workspace uses a same-site runner inside an iframe with `sandbox="allow-scripts"` and an opaque origin; it does not grant `allow-same-origin`. Portable exports use a nonce-bearing sandboxed `srcdoc` document. The demo's DOM and storage origin remain separate from the editor's drafts. A restrictive child Content Security Policy blocks external dependencies and ordinary network requests; as for presentations, it is not a complete network firewall against code written to get around it. This isolation does not make arbitrary code well behaved: a custom demo should avoid unbounded loops and excessive computation.

### Interactive HTML and static PDF

Both document and slide HTML exports retain supported demos and their isolated player. Recipients choose **Run demo** themselves; the demo starts from its source-defined initial state. Project ZIPs keep separate demo files and saved starting settings. Markdown and ZIP bundles do not record transient control changes or animation time during playback.

PDF output uses the most recently captured canvas PNG when available. Otherwise a built-in demo uses its initial SVG illustration; a custom demo uses a labeled static placeholder. Printing never starts a demo just to capture it. For a custom visualization without a canvas, include an ordinary image in the Markdown if the PDF needs a specific illustration. A PDF has no sliders or animation; use HTML for the interactive version.

## Start locally

Use **Node 24.22.1** and **npm 11.9.0**. The Node version is recorded in `.node-version`; package versions and the dependency graph are recorded in `package.json` and `package-lock.json`.

```sh
npm ci
npm run dev
```

Open the local address printed by Astro. The editor is at `/`; supporting pages include `/guide/`, `/examples/`, and `/about/`.

## Check and build

```sh
npm run check
npm test
npm run build
npm run preview
```

After a build, `npm run test:browser` runs every end-to-end suite in `tests/browser/*.browser.mjs` against the production preview in full Chromium (`npx playwright install chromium`; set `QFT_BROWSER_EXECUTABLE` to use another Chromium build). Pass a suite name to run one, for example `npm run test:browser -- slides`. Screenshots and results go to `artifacts/`.

Astro writes the finished static website to `dist/`. Commit the source and lockfile; `dist/` and `node_modules/` are intentionally ignored. The [Check workflow](.github/workflows/check.yml) runs the checks without publishing.

## Deploy to GitHub Pages

1. Open the repository's **Settings → Pages** and choose **GitHub Actions** as the source.
2. Configure a custom domain there if you want one. For the original deployment, use `md.qft.org` and follow the DNS instructions in the [deployment guide](docs/DEPLOYMENT.md).
3. Push to `main`, or run **Deploy to GitHub Pages** from the Actions tab.

The [deployment workflow](.github/workflows/pages.yml) installs the pinned toolchain, checks the source, runs the tests, builds the site, and publishes `dist/`. It obtains the site's URL from GitHub Pages, so it also supports forks served at `https://your-name.github.io/your-repository/`. No personal access token or application secret is needed.

GitHub Pages does not provide configurable HTTP response headers. The HTML layout supplies a Content Security Policy and referrer policy; see [architecture](docs/ARCHITECTURE.md) for the limits of those policies. See the [verification record](docs/VERIFICATION.md) for completed checks and remaining browser checks.

## Make it your own

Edit [`src/config/site.ts`](src/config/site.ts) for the site name, tagline, description, and source repository link. Replace `public/favicon.svg` and adjust the interface, document styles, or examples as needed. Deployment URLs are separate from branding: the Pages workflow supplies `SITE_URL` automatically; another host can supply the same build-time setting.

The [reuse guide](docs/REUSE.md) covers forks, custom domains, subdirectory deployments, customization, and the license notices to preserve. The project does not require a QFT name, logo, or promotional backlink on your version.

The [search and AI discovery guide](docs/SEO.md) covers static metadata, structured data, the public FAQ, generated sitemaps, and optional webmaster-tool setup. These describe the application; users' drafts remain local.

## Mathematics

```markdown
The commutator is $[x,p]=i\hbar$.

\[
i\hbar\frac{\partial}{\partial t}\lvert\psi(t)\rangle
=\hat H\lvert\psi(t)\rangle.
\]
```

Use backticks or fenced code blocks when demonstrating syntax literally. A backslash-escaped dollar sign is ordinary text. KaTeX renders a supported subset of TeX mathematics, rather than compiling a complete LaTeX document. Document-local definitions can be written in the source; no separate macro settings panel is required. See the in-app guide for supported syntax and examples.

## Your documents

Local saving is convenient, but it is not a backup. Clearing site data, private-browsing policies, or changing browser/profile can remove or hide local drafts. A custom domain, a different Pages hostname, and localhost have separate browser storage; project paths on the same host use separate application storage names. **Download Markdown + images for drafts whose editable source and pictures you want to keep independently.** Markdown alone is sufficient when there are no local image attachments to preserve.

The application does not send document text, imported pictures, or presentations to a server. The host still receives ordinary website requests, including the static sandbox runners when a demo or presentation starts and the bundled Reveal.js, KaTeX, and Slidev-converter files when a deck needs them. Demo source is passed to that frame locally in the browser. Running demos and presentations cannot read your documents, and their ordinary network requests are blocked; deliberately hostile code can still make limited outbound connections, so run code from sources you trust. If you enable remote images, your browser contacts the image hosts. Portable HTML export embeds the math fonts and downloads enabled remote images for embedding; that image download requires the host to allow cross-origin access. If an image cannot be embedded, export reports the problem rather than silently leaving a network-dependent image in the file. You can turn off remote images and export the document with image placeholders instead. There is no link sharing, collaboration, synchronization, or service worker in this release. An open editor continues working without server processing, but reopening the website offline is not guaranteed.

## License

Copyright (c) 2026 Jie Ren. The application source is available under the [MIT license](LICENSE): you may use, modify, redistribute, and sell copies while preserving its copyright and permission notice. You may add your own copyright notice for your contributions without removing the existing one.

Libraries and fonts retain their own licenses, reproduced in [third-party notices](THIRD_PARTY_NOTICES.md). Using the editor does not apply the application's MIT license to the documents you write or import.
