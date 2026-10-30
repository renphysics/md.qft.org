# Architecture

QFT Markdown is a static application with local document storage. Astro builds the application shell and supporting pages; the browser owns editing, rendering, saving, and exporting. GitHub Pages serves files and does not receive document text as part of those operations. The same build can be served by another static host.

## Application boundaries

| Component | Responsibility |
| --- | --- |
| Astro | Static HTML routes, page metadata, shared layout, and bundled assets |
| CodeMirror | Source editing, selections, undo/redo, find/replace, and editor navigation |
| Markdown renderer | Markdown parsing, math token handling, code highlighting, and preview HTML |
| KaTeX | Supported TeX mathematics rendered with HTML and MathML |
| Document tools | Source-preserving cleanup suggestions, title suggestions, appending, and complete peer-section moves |
| Browser storage | Named drafts, autosave, and conflict preservation |
| Document presentation | Allowlisted document styles, page settings, optional title/author, and linked contents |
| Export | Original Markdown, styled portable HTML, and browser printing |
| GitHub Pages | Distribution of the built `dist/` directory |

The project has no SSR adapter, server request handler, remote document API, authentication service, or external database. It also has no service worker: document operations are local, while loading or reopening the app still depends on available application assets.

## Source and rendering

Markdown source is the canonical document. Previewing or exporting rendered HTML must never replace the stored source. CodeMirror owns the text and selection state; rendered elements can link back to source locations for navigation and error correction.

Math delimiters are interpreted during Markdown parsing, before Markdown escapes can destroy their meaning. Both dollar and backslash delimiter forms are supported. Code spans and fenced code blocks preserve literal examples. Errors are document diagnostics rather than exceptions that disable the whole editor.

The renderer uses markdown-it with extensions for mathematics, footnotes, and task lists. Code highlighting uses highlight.js. KaTeX is a TeX-math renderer, not a complete LaTeX engine; unsupported commands should remain understandable errors. Document-local macro definitions belong to a single render/document, not to global state shared by unrelated drafts.

Preview and HTML export use the same rendering path. This prevents an equation from having one meaning while editing and another after export. Source locations and any editor-only controls are presentation metadata; the downloaded Markdown remains the user's text.

## Paste, cleanup, and organization

The first-use workspace starts with a blank draft and a compact welcome area. Saved users resume an existing draft. The paste dialog accepts plain text/Markdown and can create a document or append to the active document with an optional heading. It does not read the clipboard automatically, import rich HTML, or call a model. A title suggestion is extracted from an existing Markdown heading or paragraph.

`src/lib/document-tools.ts` uses Markdown-it with the same mathematical delimiters and footnote parsing as the renderer. It operates on original source offsets instead of serializing the parsed document. This preserves code, backslashes, original line endings, and meaningful whitespace.

Cleanup offers three bounded operations: remove a complete outer fence explicitly labeled `md` or `markdown`; promote document headings together so the shallowest starts at level one; trim blank lines outside the document. The user reviews selected changes in an original/result comparison. Applying them creates a separate formatted draft, retains the original, and records the text change in editor undo history. It does not remove conversational wording or reinterpret citations.

The section organizer identifies peer sections at the shallowest applicable heading level. A unique first heading above all others is treated as a document title and remains with the preamble. A move carries the full section, including nested headings and all following content up to the next peer. Headings inside code, display mathematics, blockquotes, lists, and footnotes are excluded. Source separators are retained so moving a final section without a newline does not join it to another heading. Section IDs refer to exact source offsets and must be refreshed after an edit. The controller checks the active source before applying a reviewed operation and offers undo for section moves.

These structural operations are bounded by the 400,000-character preview limit. They do not infer a semantic outline, rewrite explanations, validate sources, or resolve duplicated citation/footnote definitions when documents are combined.

## Untrusted document content

Opening a Markdown file must not turn it into executable application code. Raw HTML is disabled in the Markdown renderer. KaTeX uses untrusted input settings. Link protocols and image sources are checked rather than blindly copied into attributes.

Remote images are blocked by default because loading them makes a request to the image host. A user can opt in explicitly. That opt-in does not grant permission for scripts, embedded applications, or arbitrary HTML. The HTML layout delivers a Content Security Policy through a `meta` element, providing an additional browser-level boundary while permitting the styles required by CodeMirror and KaTeX. It also delivers a `no-referrer` policy.

GitHub Pages does not apply `_headers` files or offer arbitrary response-header configuration. A meta CSP cannot enforce `frame-ancestors`, and it does not replace headers such as `X-Content-Type-Options` or `Cross-Origin-Opener-Policy`. The application does not depend on those headers for editing or exporting. A host that supports response headers can add them separately. See the [CSP specification](https://www.w3.org/TR/CSP3/#meta-element) for meta-policy limitations.

The app bundles its JavaScript, styles, and fonts. There is no analytics script or document telemetry. Hosting still involves ordinary requests for the site and its assets; enabling remote images creates requests to those image hosts. Portable HTML export makes explicit fetch requests for enabled remote images so it can embed them. The CSP permits HTTPS connections for that purpose; those requests omit credentials and referrer information, and remain subject to the image host's CORS policy.

## Drafts and competing edits

Named drafts are stored in IndexedDB through a small storage layer. Draft identifiers must remain stable when titles change. Local autosave operates independently of Markdown downloads; both paths should preserve the text faithfully.

Document search filters the local draft list by title and source text. Per-document presentation preferences are stored in localStorage using the draft ID and the same deployment-path namespace. They are allowlisted on read, and remain separate from the Markdown and the IndexedDB draft schema. Changing paper size or document style does not rewrite the user's source. These preferences are not embedded in a Markdown download or transferred when it is imported at another address.

Another browser tab can edit the same stored draft. The storage layer detects stale revisions and preserves competing text as a conflict copy instead of silently overwriting a newer revision. Draft switching, import, and example loading must first preserve any outstanding edits.

Storage errors must be visible. A full or unavailable storage database must not be presented as a successful save. Downloads are the durable, portable escape route when browser persistence is unavailable or the user changes browser/profile.

Browser storage is origin-specific. A custom domain, a different `github.io` hostname, and localhost do not share drafts. Within an origin, this application also scopes its database, cross-tab messages, and preferences by its deployment path. This avoids accidental overlap between project sites such as `/notes/` and `/editor/`. A path namespace is not a security boundary: scripts on the same origin can access the same origin's browser storage.

The root-path deployment preserves the original storage identifiers, so existing drafts at `https://md.qft.org/` remain compatible. Changing the display name does not change the storage namespace. Moving to another hostname or deployment path requires exporting and importing the notes you want to transfer. Clearing browser site data can erase them. There is no cloud synchronization or cross-device recovery.

## Export

**Markdown** downloads the source. It is the preferred archival and editable format.

`src/lib/document-presentation.ts` defines the **Clean**, **Study Notes**, and **Academic** styles and normalizes all presentation values. It prepares optional title/author and a linked contents list from the rendered headings, escapes user-provided text, and supplies scoped CSS shared by the typography preview, HTML export, and print copy. It receives renderer-produced HTML, never raw clipboard HTML.

Presentation controls include A4/US Letter, portrait/landscape, margin presets, 10–13 pt text, spacing, and page breaks before major sections. The title option adds a title when needed and preserves source headings. The PDF setup's typography preview is continuous; it does not claim exact page boundaries or page counts. Layout checks can flag wide equations/tables, missing images, and other specific issues, while the browser's final print preview remains the pagination authority.

**HTML** includes the rendered document, selected presentation styles, original Markdown in a disclosure, and embedded KaTeX fonts so the mathematics does not require a font CDN. It is a rendered document rather than a copy of the editor application. Enabled remote PNG, JPEG, WebP, and GIF images are fetched and embedded as data URLs. The exporter applies per-image and total image-byte limits and fails visibly when an image cannot be embedded, including when its host disallows cross-origin downloads. With remote images disabled, the rendered placeholders are exported instead. The exported file has a restrictive CSP and needs no executable scripts.

**Save PDF** opens the setup panel, then uses `window.print()` with a clean copy and the selected document settings. It waits for fonts/images and omits editor controls. Internal anchors are remapped to the print copy. Pagination and the printer/PDF destination remain browser-controlled; this is not a direct PDF-byte generator. The implementation uses HTML/text printing rather than rasterizing complete pages into images. Browser-specific text extraction, links, page breaks, and font rendering require actual PDF checks; see [verification](VERIFICATION.md).

## Deployment and configuration

`astro build` produces `dist/`. The GitHub Pages workflow runs the checks and builds the static files, then deploys the artifact from a successful build. Repository Pages settings select GitHub Actions as the publishing source and hold the custom-domain association. No personal access token, runtime secret, or hosting-specific server adapter is required. Details are in [deployment](DEPLOYMENT.md).

The workflow passes the full deployment URL from GitHub Pages metadata as `SITE_URL`. Astro derives the origin and path prefix from that URL. Internal navigation and public-asset references respect the prefix, allowing a custom domain or a project URL such as `https://example.github.io/markdown/`. An explicit `SITE_URL` also supports another static host.

`src/config/site.ts` owns the display name, tagline, description, and repository link. A fork can change those values without editing every page or export label. The [reuse guide](REUSE.md) maps other customization points and explains which license notices travel with the source and built application.

The Node version is pinned in `.node-version`; npm is pinned in `packageManager`; the lockfile records resolved packages. Use `npm ci`, type checking, tests, and the production build as the common local and CI gate. The separate Check workflow validates pull requests without publishing them.

## Scope of this release

The editor focuses on bringing text into a useful document: paste, review formatting, arrange sections, choose a presentation, and export. Accounts, cloud saves, share links, collaborative editing, uploaded asset hosting, semantic AI rewriting, rich-HTML import, bulk draft backup, direct PDF download, paginated preview, a macro-settings panel, and offline installation are not part of the release. Adding any of them should preserve source fidelity and the clear boundary between local documents and network activity.
