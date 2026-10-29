# Architecture

QFT Markdown is a static application with local document storage. Astro builds the application shell and supporting pages; the browser owns editing, rendering, saving, and exporting. Cloudflare serves files and does not receive document text as part of those operations.

## Application boundaries

| Component | Responsibility |
| --- | --- |
| Astro | Static HTML routes, page metadata, shared layout, and bundled assets |
| CodeMirror | Source editing, selections, undo/redo, find/replace, and editor navigation |
| Markdown renderer | Markdown parsing, math token handling, code highlighting, and preview HTML |
| KaTeX | Supported TeX mathematics rendered with HTML and MathML |
| Browser storage | Named drafts, autosave, and conflict preservation |
| Export | Original Markdown, portable rendered HTML, and print styles |
| Workers Static Assets | Distribution of the built `dist/` directory and response headers |

The project has no SSR adapter, Worker request handler, remote document API, authentication service, or external database. It also has no service worker: document operations are local, while loading or reopening the app still depends on available application assets.

## Source and rendering

Markdown source is the canonical document. Previewing or exporting rendered HTML must never replace the stored source. CodeMirror owns the text and selection state; rendered elements can link back to source locations for navigation and error correction.

Math delimiters are interpreted during Markdown parsing, before Markdown escapes can destroy their meaning. Both dollar and backslash delimiter forms are supported. Code spans and fenced code blocks preserve literal examples. Errors are document diagnostics rather than exceptions that disable the whole editor.

The renderer uses markdown-it with extensions for mathematics, footnotes, and task lists. Code highlighting uses highlight.js. KaTeX is a TeX-math renderer, not a complete LaTeX engine; unsupported commands should remain understandable errors. Document-local macro definitions belong to a single render/document, not to global state shared by unrelated drafts.

Preview and HTML export use the same rendering path. This prevents an equation from having one meaning while editing and another after export. Source locations and any editor-only controls are presentation metadata; the downloaded Markdown remains the user's text.

## Untrusted document content

Opening a Markdown file must not turn it into executable application code. Raw HTML is disabled in the Markdown renderer. KaTeX uses untrusted input settings. Link protocols and image sources are checked rather than blindly copied into attributes.

Remote images are blocked by default because loading them makes a request to the image host. A user can opt in explicitly. That opt-in does not grant permission for scripts, embedded applications, or arbitrary HTML. The CSP in `public/_headers` provides an additional browser-level boundary while permitting the styles required by CodeMirror and KaTeX.

The app bundles its JavaScript, styles, and fonts. There is no analytics script or document telemetry. Hosting still involves ordinary requests for the site and its assets; enabling remote images creates requests to those image hosts. Portable HTML export makes explicit fetch requests for enabled remote images so it can embed them. The CSP permits HTTPS connections for that purpose; those requests omit credentials and referrer information, and remain subject to the image host's CORS policy.

## Drafts and competing edits

Named drafts are stored in IndexedDB through a small storage layer. Draft identifiers must remain stable when titles change. Local autosave operates independently of Markdown downloads; both paths should preserve the text faithfully.

Another browser tab can edit the same stored draft. The storage layer detects stale revisions and preserves competing text as a conflict copy instead of silently overwriting a newer revision. Draft switching, import, and example loading must first preserve any outstanding edits.

Storage errors must be visible. A full or unavailable storage database must not be presented as a successful save. Downloads are the durable, portable escape route when browser persistence is unavailable or the user changes browser/profile.

Storage is origin-specific. `md.qft.org`, a `workers.dev` preview, and localhost do not share drafts. Clearing browser site data can erase them. There is no cloud synchronization or cross-device recovery.

## Export

**Markdown** downloads the source. It is the preferred archival and editable format.

**HTML** includes the rendered document, presentation styles, and embedded KaTeX fonts so the mathematics does not require a font CDN. It is a rendered document rather than a copy of the editor application. Enabled remote PNG, JPEG, WebP, and GIF images are fetched and embedded as data URLs. The exporter applies per-image and total image-byte limits and fails visibly when an image cannot be embedded, including when its host disallows cross-origin downloads. With remote images disabled, the rendered placeholders are exported instead. The exported file has a restrictive CSP and needs no executable scripts.

**Print / Save PDF** uses browser printing and the document's print stylesheet. Pagination and the printer/PDF destination remain browser-controlled. Print mode should omit editor controls and preserve equation and code readability.

## Deployment and configuration

`astro build` produces `dist/`. `wrangler.jsonc` points Workers Static Assets at that directory. It contains no account identifier or active domain route. Domain association is an account-level action described in [deployment](DEPLOYMENT.md).

Cloudflare Workers Builds handles GitHub-connected builds and publishing. The separate GitHub workflow checks the source without deploying or requiring a Cloudflare secret.

The Node version is pinned in `.node-version`; npm is pinned in `packageManager`; the lockfile records resolved packages. Use `npm ci`, type checking, tests, and the production build as the common local/CI/Cloudflare gate.

## Scope of this release

The editor focuses on writing and reading mathematical Markdown with local drafts and useful exports. Accounts, cloud saves, share links, collaborative editing, uploaded asset hosting, a macro-settings panel, and offline installation are not part of the release. Adding any of them should preserve source fidelity and the clear boundary between local documents and network activity.
