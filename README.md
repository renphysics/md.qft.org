# QFT Markdown

A reusable workspace for turning **AI answers, notes, and mathematics into documents and interactive presentations**, released under the **MIT license**. Paste Markdown, insert pictures, organize sections, or teach with a live physics demonstration. Keep editable Markdown with its images, portable HTML, or a PDF saved through your browser.

Built with Astro, CodeMirror, markdown-it, KaTeX, and reveal.js. The application runs in the browser and deploys as static files on **GitHub Pages**. Drafts and imported images stay in this browser's storage; there are no accounts or cloud documents. You can fork it, change the branding, and host it on your own domain or GitHub project URL.

## What you can do

- Start with a blank document, paste plain text or Markdown, open a file, or choose an example. Returning visitors resume their saved draft.
- Paste into a new document or append text to the current one, with an optional section title.
- Review conservative formatting cleanup before creating a formatted copy. The original draft is retained, and the changes can also be undone in the editor.
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
2. Choose **Clean up** to review formatting suggestions. It can remove a complete outer `md`/`markdown` code fence, raise document headings together, and trim outer blank lines. Select the changes you want and create a formatted copy; the wording, formulas, and code remain intact.
3. Use **Organize** to move whole sections. A unique first heading above the others is kept as the document title, together with its introduction. Each move updates the editable Markdown and can be undone.
4. Open **Save PDF**, choose a style, and review the typography preview. **Save PDF** then opens the browser's print dialog; choose its PDF destination and check the final pagination. **Download HTML** uses the same document presentation.

The PDF setup includes A4/US Letter, portrait/landscape, three margin presets, 10–13 pt text, spacing, optional author, a linked table of contents, and page breaks before major sections. **Add a title if missing** preserves existing Markdown headings. The typography preview shows the selected appearance; final page boundaries and the destination are controlled by the browser.

Document PDF-style preferences are saved per draft in localStorage, separately from its Markdown. Slide mode, theme, and aspect ratio save with the draft and travel in an exported ZIP bundle. Plain Markdown contains source text and references, not these application preferences or local image bytes. Cleanup and organization are formatting tools; they do not summarize text, validate citations, or rewrite claims.

Live preview, the paste dialog, and structural tools support up to 400,000 characters. Keep longer material in smaller documents for these features. Markdown downloads preserve the source independently of the rendered preview.

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

In Slides mode, **Save PDF** prepares one PDF page per slide through the browser print dialog; check the preview, preferably in a Chromium-based browser. **Download HTML** includes presentation playback, fonts, images, and supported interactive demonstrations in a standalone file. **Slide bundle** keeps editable source plus slide mode, theme, and proportions in a ZIP, including when there are no pictures; **Markdown + images** also carries these settings for decks with local pictures. The five-slide **Quantum phase** example demonstrates equations, lists, and code. This format does not implement Marp directives or Slidev components. Ordinary HTML and script fences remain displayed source; executable demos use the explicit syntax below.

## Interactive teaching demonstrations

Choose **Interactive demo** in the toolbar. Four built-in choices are ready to insert: a spreading Gaussian wave packet, a Bloch sphere with a rotatable camera, a Schwarzschild scalar-field potential, and wave interference. Keep **Add on a new slide** selected for a clean teaching slide. **Open the complete physics lesson** creates a deck containing all four.

````markdown
## Watch a wave packet spread

```interactive wave-packet
```
````

The other preset identifiers are `bloch-sphere`, `effective-potential`, and `interference`. A preset fence is empty: its identifier selects the built-in source and initial illustration. The HTML exporter includes the complete demo code, so exported presentations do not require this website or a CDN.

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

Use inline `<style>` and `<script>` elements and attach handlers with `addEventListener`. External scripts, module imports, network calls, inline event attributes such as `onclick`, `eval`, nested frames, forms, and popup windows are outside this supported format. Include code and styles directly; use embedded raster data images for assets. A complete React, Vue, or Slidev application needs to be converted into self-contained HTML before insertion. A document supports **20 demo blocks**, each custom block up to **100,000 source characters**, within the editor's overall 400,000-character source limit.

Demos run only after an explicit **Run demo** action. The workspace uses a same-site runner inside an iframe with `sandbox="allow-scripts"` and an opaque origin; it does not grant `allow-same-origin`. Portable exports use a nonce-bearing sandboxed `srcdoc` document. The demo's DOM and storage origin remain separate from the editor's drafts. A restrictive child Content Security Policy blocks external dependencies and connections. This isolation does not make arbitrary code well behaved: a custom demo should avoid unbounded loops and excessive computation.

### Interactive HTML and static PDF

Both document and slide HTML exports retain supported demos and their isolated player. Recipients choose **Run demo** themselves; the demo starts from its source-defined initial state. Markdown and ZIP bundles keep the code or preset name, not transient control values or animation time.

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

The application does not send document text to a server. The host still receives ordinary website requests, including the static sandbox runner when a demo starts in the workspace. Demo source is passed to that frame locally in the browser. If you enable remote images, your browser contacts the image hosts. Portable HTML export embeds the math fonts and downloads enabled remote images for embedding; that image download requires the host to allow cross-origin access. If an image cannot be embedded, export reports the problem rather than silently leaving a network-dependent image in the file. You can turn off remote images and export the document with image placeholders instead. There is no link sharing, collaboration, synchronization, or service worker in this release. An open editor continues working without server processing, but reopening the website offline is not guaranteed.

## License

Copyright (c) 2026 Jie Ren. The application source is available under the [MIT license](LICENSE): you may use, modify, redistribute, and sell copies while preserving its copyright and permission notice. You may add your own copyright notice for your contributions without removing the existing one.

Libraries and fonts retain their own licenses, reproduced in [third-party notices](THIRD_PARTY_NOTICES.md). Using the editor does not apply the application's MIT license to the documents you write or import.
