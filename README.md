# QFT Markdown

A reusable workspace for turning **AI answers, notes, and mathematics into documents worth keeping**, released under the **MIT license**. Paste Markdown, organize its sections, choose a document style, and take your work with you as editable Markdown, portable HTML, or a PDF saved through your browser.

Built with Astro, CodeMirror, markdown-it, and KaTeX. The application runs in the browser and deploys as static files on **GitHub Pages**. Drafts stay in this browser's storage; there are no accounts or cloud documents. You can fork it, change the branding, and host it on your own domain or GitHub project URL.

## What you can do

- Start with a blank document, paste plain text or Markdown, open a file, or choose an example. Returning visitors resume their saved draft.
- Paste into a new document or append text to the current one, with an optional section title.
- Review conservative formatting cleanup before creating a formatted copy. The original draft is retained, and the changes can also be undone in the editor.
- Move complete peer sections, including their nested headings, equations, code, and paragraphs. Undo section moves from the organizer.
- Search saved document titles and text.
- Choose **Clean**, **Study Notes**, or **Academic** presentation for PDF and HTML. Adjust paper size, orientation, margins, text size, spacing, optional author, contents, and major-section page breaks.
- Write in a CodeMirror editor with line numbers, undo/redo, find and replace, and adjustable text size. Switch between split view, editor, and preview; resize the panes and toggle synchronized scrolling.
- Use inline and display mathematics with `$…$`, `$$…$$`, `\(…\)`, and `\[…\]`.
- Keep named drafts with automatic local saving. Concurrent edits in other tabs are preserved as conflict copies.
- Import a `.md` file as a separate draft and download Markdown without changing its source.
- Export a portable HTML document with embedded math fonts, or open **Save PDF** to style the document before using the browser's print dialog.
- Start from study notes, a project report, mathematical and physics examples, or the Markdown field guide; use the outline to navigate longer notes.
- Read in light or dark mode. Math errors remain visible and link back to their source.
- Choose whether to load remote images. They are blocked by default.

## From pasted text to a document

1. Choose **Paste** and insert plain text or Markdown. Use the source form of equations and code when it is available from the application you are copying from. Pasting does not import rich HTML or call an AI service.
2. Choose **Clean up** to review formatting suggestions. It can remove a complete outer `md`/`markdown` code fence, raise document headings together, and trim outer blank lines. Select the changes you want and create a formatted copy; the wording, formulas, and code remain intact.
3. Use **Organize** to move whole sections. A unique first heading above the others is kept as the document title, together with its introduction. Each move updates the editable Markdown and can be undone.
4. Open **Save PDF**, choose a style, and review the typography preview. **Save PDF** then opens the browser's print dialog; choose its PDF destination and check the final pagination. **Download HTML** uses the same document presentation.

The PDF setup includes A4/US Letter, portrait/landscape, three margin presets, 10–13 pt text, spacing, optional author, a linked table of contents, and page breaks before major sections. **Add a title if missing** preserves existing Markdown headings. The typography preview shows the selected appearance; final page boundaries and the destination are controlled by the browser.

Presentation preferences are saved per document in localStorage, separately from its Markdown. Downloaded Markdown contains the source text, not these application preferences. Cleanup and organization are formatting tools; they do not summarize text, validate citations, or rewrite claims.

Live preview, the paste dialog, and structural tools support up to 400,000 characters. Keep longer material in smaller documents for these features. Markdown downloads preserve the source independently of the rendered preview.

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

Local saving is convenient, but it is not a backup. Clearing site data, private-browsing policies, or changing browser/profile can remove or hide local drafts. A custom domain, a different Pages hostname, and localhost have separate browser storage; project paths on the same host use separate application storage names. **Download Markdown for anything you want to keep independently.**

The application does not send document text to a server. The host still receives ordinary website requests. If you enable remote images, your browser contacts the image hosts. Portable HTML export embeds the math fonts and downloads enabled remote images for embedding; that image download requires the host to allow cross-origin access. If an image cannot be embedded, export reports the problem rather than silently leaving a network-dependent image in the file. You can turn off remote images and export the document with image placeholders instead. There is no link sharing, collaboration, synchronization, or service worker in this release. An open editor continues working without server processing, but reopening the website offline is not guaranteed.

## License

Copyright (c) 2026 Jie Ren. The application source is available under the [MIT license](LICENSE): you may use, modify, redistribute, and sell copies while preserving its copyright and permission notice. You may add your own copyright notice for your contributions without removing the existing one.

Libraries and fonts retain their own licenses, reproduced in [third-party notices](THIRD_PARTY_NOTICES.md). Using the editor does not apply the application's MIT license to the documents you write or import.
