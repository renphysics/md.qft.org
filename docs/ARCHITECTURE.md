# Architecture

QFT Markdown is a static application with local document storage. Astro builds the application shell and supporting pages; the browser owns editing, rendering, saving, and exporting. GitHub Pages serves files and does not receive document text as part of those operations. The same build can be served by another static host.

## Application boundaries

| Component | Responsibility |
| --- | --- |
| Astro | Static HTML routes, page metadata, shared layout, and bundled assets |
| CodeMirror | Source editing, selections, undo/redo, find/replace, and editor navigation |
| Markdown renderer | Markdown parsing, math token handling, code highlighting, and preview HTML |
| KaTeX | Supported TeX mathematics rendered with HTML and MathML |
| reveal.js | Embedded slide preview, fullscreen presentation, and portable slide playback |
| Interactive demos | Explicit demo fences, inert preview cards, isolated execution, and static print fallbacks |
| Document tools | Source-preserving cleanup suggestions, title suggestions, appending, and complete peer-section moves |
| Browser storage | Named drafts with image blobs and slide preferences, autosave, and conflict preservation |
| Document presentation | Allowlisted document styles, page settings, optional title/author, and linked contents |
| Export | Original Markdown, editable image/slide ZIP bundles, portable HTML, and browser printing |
| GitHub Pages | Distribution of the built `dist/` directory |

The project has no SSR adapter, server request handler, remote document API, authentication service, or external database. It also has no service worker: document operations are local, while loading or reopening the app still depends on available application assets.

## Source and rendering

Markdown source is the canonical document. Previewing or exporting rendered HTML must never replace the stored source. CodeMirror owns the text and selection state; rendered elements can link back to source locations for navigation and error correction.

Math delimiters are interpreted during Markdown parsing, before Markdown escapes can destroy their meaning. Both dollar and backslash delimiter forms are supported. Code spans and fenced code blocks preserve literal examples. Errors are document diagnostics rather than exceptions that disable the whole editor.

The renderer uses markdown-it with extensions for mathematics, footnotes, and task lists. Code highlighting uses highlight.js. KaTeX is a TeX-math renderer, not a complete LaTeX engine; unsupported commands should remain understandable errors. Document-local macro definitions belong to a single render/document, not to global state shared by unrelated drafts.

Slides use the same parser and mathematical macro scope for the entire deck. Only an exact top-level `---` horizontal-rule token starts a slide; code, mathematics, quoted rules, and table syntax retain their normal meaning. Heading, footnote, and task-list identifiers are namespaced so the document, slide, and print views can coexist without collisions.

The explicit `interactive` fence is an application extension. Preset identifiers select bundled HTML and a trusted static SVG illustration; custom blocks carry their own HTML/CSS/JavaScript. `src/lib/interactive-demos.ts` escapes the payload as text inside an inert template. Rendering does not create a running iframe. Ordinary HTML and JavaScript fences remain readable code. A document can contain 20 demo blocks, each custom source up to 100,000 JavaScript string characters, within the 400,000-character overall source limit.

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

### Explicit interactive execution

`src/scripts/interactive-demo-runtime.ts` creates a frame only after **Run demo** or **Restart**. The frame uses `sandbox="allow-scripts"` without `allow-same-origin`, forms, popups, or top-level navigation permissions. Its origin is opaque, so demo code cannot directly access the editor DOM or its IndexedDB/localStorage drafts.

The application shell keeps `script-src 'self'`; it adds a same-site frame destination rather than allowing inline scripts in the editor. `public/demo-sandbox.html` is a small static runner with its own policy. Before accepting a single parent load message, it verifies that it is embedded and that `self.origin === 'null'`. Direct navigation to that file does not accept demo code. The parent passes the HTML locally through `postMessage`, rather than placing document text in a URL or sending it to a server.

The runtime parses the demo HTML before loading it, removes base/meta declarations, external scripts, embedded frame/object surfaces, and inline event attributes, and stamps accepted inline scripts with a generated nonce. The child Content Security Policy permits those scripts and inline styles while denying connections, workers, external media, nested frames, forms, and object embedding. Demos should use self-contained source, embedded raster data images, and `addEventListener`. External libraries, module imports, `eval`, and inline `onclick` handlers are outside the supported format.

The parent only accepts lifecycle, error, and bounded PNG-snapshot messages from the matching frame window with its per-frame token. Demo messages cannot edit drafts or invoke workspace commands. Timer, animation-frame, and CSS-animation work pauses while a slide or browser tab is inactive, and resumes when it returns. **Stop** destroys the frame; **Restart** creates it afresh. Re-rendering or changing a draft discards the transient interactive state.

These are execution and origin boundaries, not a guarantee that arbitrary JavaScript is well behaved. Source limits do not impose an execution-time budget; a custom program can still consume excessive CPU or memory. CSP makes network-dependent demos unsupported, but is not a complete network firewall: arbitrary code may still attempt navigation of its own frame. Use custom source that is understood and intended for this isolated format.

GitHub Pages does not apply `_headers` files or offer arbitrary response-header configuration. A meta CSP cannot enforce `frame-ancestors`, and it does not replace headers such as `X-Content-Type-Options` or `Cross-Origin-Opener-Policy`. The application does not depend on those headers for editing or exporting. A host that supports response headers can add them separately. See the [CSP specification](https://www.w3.org/TR/CSP3/#meta-element) for meta-policy limitations.

The app bundles its JavaScript, styles, and fonts. There is no analytics script or document telemetry. Hosting still involves ordinary requests for the site and its assets; enabling remote images creates requests to those image hosts. Portable HTML export makes explicit fetch requests for enabled remote images so it can embed them. The CSP permits HTTPS connections for that purpose; those requests omit credentials and referrer information, and remain subject to the image host's CORS policy.

## Drafts and competing edits

Named drafts are stored in IndexedDB through a small storage layer. Draft identifiers must remain stable when titles change. Local autosave operates independently of Markdown downloads; both paths should preserve the text faithfully.

Document search filters the local draft list by title and source text. Document PDF-style preferences are stored in localStorage using the draft ID and the same deployment-path namespace. They are allowlisted on read and remain separate from the Markdown and the IndexedDB draft schema. Changing paper size or document style does not rewrite the user's source. These preferences are not embedded in a Markdown download or transferred when it is imported at another address.

Image blobs and slide mode/theme/aspect ratio are part of the IndexedDB draft revision, so they are committed and recovered together with its source. Duplicate, formatting-copy, and conflict recovery retain that complete snapshot. Demo source is part of Markdown; live frame state and captured canvas images are session data, not persisted draft metadata.

Another browser tab can edit the same stored draft. The storage layer detects stale revisions and preserves competing text as a conflict copy instead of silently overwriting a newer revision. Draft switching, import, and example loading must first preserve any outstanding edits.

Storage errors must be visible. A full or unavailable storage database must not be presented as a successful save. Downloads are the durable, portable escape route when browser persistence is unavailable or the user changes browser/profile.

Browser storage is origin-specific. A custom domain, a different `github.io` hostname, and localhost do not share drafts. Within an origin, this application also scopes its database, cross-tab messages, and preferences by its deployment path. This avoids accidental overlap between project sites such as `/notes/` and `/editor/`. A path namespace is not a security boundary: scripts on the same origin can access the same origin's browser storage.

The root-path deployment preserves the original storage identifiers, so existing drafts at `https://md.qft.org/` remain compatible. Changing the display name does not change the storage namespace. Moving to another hostname or deployment path requires exporting and importing the notes you want to transfer. Clearing browser site data can erase them. There is no cloud synchronization or cross-device recovery.

## Export

**Markdown** downloads the source. A draft with local pictures downloads as an editable **Markdown + images** ZIP containing ordinary relative image paths and the referenced image files. A **Slide bundle** also retains slide mode, theme, and proportions, including when there are no pictures. ZIP import restores short browser-local image references. Pictures retained solely for undo, but no longer referenced by the current source, are excluded from the bundle. Demo fences retain their source or preset identifier, not runtime slider values or animation time.

`src/lib/document-presentation.ts` defines the **Clean**, **Study Notes**, and **Academic** styles and normalizes all presentation values. It prepares optional title/author and a linked contents list from the rendered headings, escapes user-provided text, and supplies scoped CSS shared by the typography preview, HTML export, and print copy. It receives renderer-produced HTML, never raw clipboard HTML.

Presentation controls include A4/US Letter, portrait/landscape, margin presets, 10–13 pt text, spacing, and page breaks before major sections. The title option adds a title when needed and preserves source headings. The PDF setup's typography preview is continuous; it does not claim exact page boundaries or page counts. Layout checks can flag wide equations/tables, missing images, and other specific issues, while the browser's final print preview remains the pagination authority.

**HTML** includes rendered content, selected presentation styles, original Markdown in a disclosure, and embedded KaTeX fonts so mathematics does not require a font CDN. It is an exported document or presentation rather than a copy of the editor application. Enabled remote PNG, JPEG, WebP, and GIF images are fetched and embedded as data URLs. The exporter applies per-image and total image-byte limits and fails visibly when an image cannot be embedded, including when its host disallows cross-origin downloads. With remote images disabled, the rendered placeholders are exported instead.

A document HTML export with no demos remains script-free. Slide HTML includes reveal.js. When demo cards exist, the exported file includes the same self-contained controller used in the workspace; it serializes the runtime as an evaluable factory expression rather than loading a CDN. The parent CSP authorizes only its generated script nonce and denies inline event handlers. Each demo uses an opaque sandboxed `srcdoc` frame, with the same nonce on accepted inline child scripts to satisfy the inherited parent policy. This permits supported self-contained demos to work offline without allowing authored scripts to run in the exported parent. A recipient still chooses **Run demo** explicitly. Application, reveal.js, and KaTeX license notices travel with the bundled code as applicable.

**Save PDF** opens the setup panel, then uses `window.print()` with a clean copy and the selected document settings. It waits for fonts/images and omits editor controls. Internal anchors are remapped to the print copy. Pagination and the printer/PDF destination remain browser-controlled; this is not a direct PDF-byte generator. The implementation uses HTML/text printing rather than rasterizing complete pages into images. Browser-specific text extraction, links, page breaks, and font rendering require actual PDF checks; see [verification](VERIFICATION.md).

Slide printing creates fixed-size 16:9 or 4:3 pages and checks every slide for overflow before opening the print dialog. Both app printing and portable HTML printing replace demo cards with static copies: the most recently captured PNG of the first readable canvas, a built-in preset's initial SVG illustration, or a labeled custom-demo placeholder. Canvas capture is best effort; it does not rasterize arbitrary HTML, multiple canvases, video, or every possible WebGL surface. It does not include controls outside the canvas. No demo is started solely to print it. Users can add an ordinary Markdown image for a required custom PDF figure. Live iframes, source templates, and Run/Stop/Restart controls are absent from the print copy.

## Deployment and configuration

`astro build` produces `dist/`. The GitHub Pages workflow runs the checks and builds the static files, then deploys the artifact from a successful build. Repository Pages settings select GitHub Actions as the publishing source and hold the custom-domain association. No personal access token, runtime secret, or hosting-specific server adapter is required. Details are in [deployment](DEPLOYMENT.md).

The workflow passes the full deployment URL from GitHub Pages metadata as `SITE_URL`. Astro derives the origin and path prefix from that URL. Internal navigation and public-asset references respect the prefix, allowing a custom domain or a project URL such as `https://example.github.io/markdown/`. An explicit `SITE_URL` also supports another static host.

`src/config/site.ts` owns the display name, tagline, description, and repository link. A fork can change those values without editing every page or export label. The [reuse guide](REUSE.md) maps other customization points and explains which license notices travel with the source and built application.

The Node version is pinned in `.node-version`; npm is pinned in `packageManager`; the lockfile records resolved packages. Use `npm ci`, type checking, tests, and the production build as the common local and CI gate. The separate Check workflow validates pull requests without publishing them.

## Scope of this release

The editor focuses on bringing text into useful documents and presentations: paste, review formatting, arrange sections, add pictures or isolated demos, present, and export. Accounts, cloud saves, share links, collaborative editing, uploaded asset hosting, semantic AI rewriting, rich-HTML-to-Markdown import, bulk draft backup, direct PDF download, paginated preview, a macro-settings panel, and offline installation are not part of the release. Adding any of them should preserve source fidelity and the clear boundary between local documents and network activity.
