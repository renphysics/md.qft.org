# QFT Markdown

A quiet browser workspace for Markdown and mathematics, prepared for **md.qft.org**. Write in a source editor, read the result alongside it, and take your document with you as Markdown, HTML, or a printed PDF.

The application runs in your browser. Drafts stay in this browser's storage; there are no accounts or cloud documents. It is built with Astro, CodeMirror, markdown-it, and KaTeX, and deploys as static files on **Cloudflare Workers Static Assets**.

## What you can do

- Write in a CodeMirror editor with line numbers, find and replace, and adjustable text size.
- Switch between split view, editor, and preview; resize the panes and toggle synchronized scrolling.
- Use inline and display mathematics with `$…$`, `$$…$$`, `\(…\)`, and `\[…\]`.
- Keep named drafts with automatic local saving. Concurrent edits in other tabs are preserved as conflict copies.
- Import a `.md` file as a separate draft and download Markdown without changing its source.
- Export a portable HTML document with embedded math fonts, or use **Print / Save PDF**.
- Start from worked mathematical and physics examples; use the outline to navigate longer notes.
- Read in light or dark mode. Math errors remain visible and link back to their source.
- Choose whether to load remote images. They are blocked by default.

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
```

Astro writes the finished static website to `dist/`. To inspect that output with Cloudflare's local asset serving and response headers:

```sh
npx wrangler dev
```

`npm run preview` also serves the Astro build, but it does not reproduce every Cloudflare response header. The GitHub workflow runs type checking, the regression tests, and the production build; it does not deploy.

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

Local saving is convenient, but it is not a backup. Clearing site data, private-browsing policies, or changing browser/profile can remove or hide local drafts. The production domain, a preview deployment, and localhost each have their own storage. **Download Markdown for anything you want to keep independently.**

The application does not send document text to a server. The host still receives ordinary website requests. If you enable remote images, your browser contacts the image hosts. Portable HTML export embeds the math fonts and downloads enabled remote images for embedding; that image download requires the host to allow cross-origin access. If an image cannot be embedded, export reports the problem rather than silently leaving a network-dependent image in the file. You can turn off remote images and export the document with image placeholders instead. There is no link sharing, collaboration, synchronization, or service worker in this release. An open editor continues working without server processing, but reopening the website offline is not guaranteed.

## Deploy

Use the [deployment guide](docs/DEPLOYMENT.md) to connect [renphysics/md.qft.org](https://github.com/renphysics/md.qft.org) to Workers Builds, verify a preview, and attach `md.qft.org`. The configuration uses the Worker name `qft-markdown` and serves `dist/`; it needs no Worker script, database, R2 bucket, or runtime secrets.

See [architecture](docs/ARCHITECTURE.md) for the rendering, storage, and export boundaries.

The release archive includes both the complete source and a prebuilt `dist/` directory. For GitHub, commit the source; `dist/` is intentionally ignored because Workers Builds regenerates it. See the [verification record](docs/VERIFICATION.md) for completed checks and remaining browser checks before public launch.

## Credits and license

This project follows the Markdown-editor idea at [BlackHole.org](https://blackhole.org/about/markdown/), by Jie Ren. The BlackHole source is [available on GitHub](https://github.com/renphysics/blackhole) under the MIT license. Its copyright notice is preserved in this project's [MIT license](LICENSE).

Third-party libraries and fonts retain their own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md).
