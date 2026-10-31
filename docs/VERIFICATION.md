# Verification history

## Compact toolbars and public discovery — 2026-10-31

The title/actions row is 64 px on desktop and at least 60 px on mobile. The document-tools row has a 48 px minimum height and can wrap when needed. Duplicate is a labeled document tool between Paste and Clean up, with one unchanged controller hook. The existing compact site-header heights remain unchanged.

Local verification for this revision:

- Astro check: 39 files, no errors, warnings, or hints.
- Automated tests: 73 passed. New coverage checks sitemap and robots URLs under a custom domain and a project path, structured-data identities, FAQ fidelity, safe JSON-LD/XML serialization, and the blank workspace title after initialization.
- Both production builds passed for `https://md.qft.org/` and `https://reuse-example.github.io/reuse-check/`.
- Each built output passed an audit of six HTML pages, five canonical sitemap entries, 98 internal links/assets, matching canonical/social/schema URLs, valid FAQ data, the 404 noindex policy, and the 1200 × 630 sharing image.
- The executable-script CSP was preserved. JSON-LD is an inert data block; private draft content is not included in build-time metadata.

Deployment and CI results are recorded in GitHub Actions. Search indexing, search rankings, rich results, and citations by AI assistants are external outcomes and are not established by these checks. See [SEO.md](SEO.md) for webmaster-tool setup and reuse details.

## Earlier document workflow verification — 2026-10-30

This record covers the paste, organization, document-style, and PDF-setup revision. It distinguishes source/build checks from browser and native PDF checks.

### Deployment of the document-workflow revision

Feature commit [`4f10e027412b582d2bf47a3bd5f02ca6f126c2e7`](https://github.com/renphysics/md.qft.org/commit/4f10e027412b582d2bf47a3bd5f02ca6f126c2e7) is deployed at **[https://md.qft.org/](https://md.qft.org/)**. The GitHub **Check** and **Deploy to GitHub Pages** workflows both succeeded for this commit. The custom domain is serving the upgraded application over HTTPS; GitHub Pages setup is complete.

Deployment success establishes that the built application was published. Interaction, downloaded-file, and native PDF verification are recorded separately below.

## Automated and source checks

| Check | Result |
| --- | --- |
| `npm run check` | Passed: 33 files, 0 errors, 0 warnings, 0 hints |
| `npm test` | Passed: 67 tests, 0 failures |
| Production build for `https://md.qft.org/` | Passed: 5 static pages |
| Production build for a GitHub project path | Passed for `https://reuse-example.github.io/reuse-check/` |
| Built links and fonts | Both builds passed: 80 HTML links/assets and 86 font references in linked stylesheets |
| CSP, canonical URLs, and internal URLs | Passed for domain-root and project-path builds |
| Dependencies and licenses | `package.json`, lockfile, MIT license, and third-party notices are unchanged |

New regression coverage includes conservative cleanup of complete Markdown wrappers, protected mathematical/code content, heading promotion, CRLF handling in structural helpers, whole-section movement, escaping appended headings, presentation allowlists, title reuse, table-of-contents anchors, original-draft preservation, stale append/cleanup targets, queued PDF actions, and duplicate print activation. The prior rendering, draft-conflict, autosave, and deployment tests continue to pass.

Source review also addressed short-screen welcome and PDF-panel layouts, preview anchor collisions, failed-image diagnostics, title-length bounds during duplication, and presentation settings for conflict-recovered drafts. Vite still reports its existing large-editor-bundle advisory; builds succeed.

## Current browser verification

The deployed application was exercised in Chrome at `https://md.qft.org/`. Verified:

- A previously saved draft loaded after the deployment; creating a blank document showed the new welcome panel.
- The paste dialog accepted a document containing an outer Markdown fence, nested code, a table, and all four mathematical delimiter styles.
- Cleanup showed the original and proposed source, removed the enclosing wrapper, promoted headings, and created a separate formatted draft while keeping the original.
- The formatted document rendered all four equations, its table, and its inner code block.
- The organizer moved a complete section and Undo restored the original order.
- Document search matched text inside drafts as well as document titles.
- PDF setup changed the selected style, paper size, orientation, font size, margins, author, and table of contents. The preview reused the source title once and rendered its equations.
- The preview had no duplicate DOM IDs or horizontal overflow. Its table-of-contents links scrolled inside the preview.
- The active formatted draft and its rendered content survived a page reload.

These checks cover the document workflow and typography preview. Reopened HTML downloads and an actual PDF saved through the native print dialog were not verified in this session. Mobile interaction checks were not repeated for this revision.

## PDF behavior and remaining checks

Save PDF prepares a clean HTML/text print document with the selected style and opens the browser's print dialog. The in-app preview shows typography at the selected paper width; final pagination is determined by the browser. It is not a direct PDF downloader or an exact paginated preview.

Native PDF checks should verify A4/Letter dimensions, portrait/landscape, margins, selectable/searchable prose, mathematical glyphs, long tables/code, internal links, and mixed-language text. A print-dialog action alone is not evidence that a PDF was saved successfully. Standalone HTML should also be downloaded and reopened independently to confirm its embedded fonts and images.

---

## Earlier deployment revision record

The following is the historical verification record for the GitHub Pages migration at commit [`dab9687e636929a9b01cd1babeedd84babec3e2e`](https://github.com/renphysics/md.qft.org/commit/dab9687e636929a9b01cd1babeedd84babec3e2e), recorded on 2026-10-29. At that stage, the checks below were local and repository/domain setup remained to be completed. That setup was subsequently completed; the current deployment status is recorded above. These older browser checks are not claims about the new document-workflow interface.

### Earlier automated checks

| Check | Result |
| --- | --- |
| Clean `npm ci` installation | Passed with Node 24.22.1 and npm 11.9.0 |
| `npm run check` | Passed: 0 errors, 0 warnings, 0 hints |
| `npm test` | Passed: 38 tests, 0 failures |
| Production build for `https://md.qft.org/` | Passed: 5 static pages |
| Production build for `https://reuse-example.github.io/reuse-check/` | Passed: 5 static pages |
| Built navigation and assets | Both URL layouts passed: 78 HTML links/asset references and 86 font references in the stylesheets used by the pages |
| Pages workflow configuration | YAML parsed; main-branch guard, build/deploy dependency, permissions, metadata-derived URL, and immutable action pins checked |
| License preservation | Original MIT license and all preserved dependency license texts are unchanged |

The tests cover mathematical delimiters, malformed formula recovery, source-line diagnostics, literal code, escaped HTML, unsafe links, optional images, macro isolation and expansion limits, unique heading IDs, footnotes, task lists, example documents, exact source persistence, atomic competing saves, deleted-document conflicts, unavailable storage, and autosave races. New checks cover deployment URL parsing, separate project-path storage names, and continued access to the original root-domain draft database.

The built-output audit checked canonical URLs, internal navigation, example links, favicon, scripts, styles, and font files for both a domain root and a project path. It also checked that each page includes its CSP and no-referrer meta tags, no inline executable scripts, and no obsolete hosting configuration or previous-site references. Source-code and MIT-license links are visible in the workspace and supporting pages.

Vite still reports a bundle-size advisory because the editor, Markdown parser, and math renderer run in the browser. Both production builds complete successfully. This revision does not suppress the advisory.

### Earlier browser checks

The built production files were served in the available Chrome environment, with the production CSP active. Verified:

- Root deployment opens the editor and still shows previously saved local drafts.
- The `/reuse-check/` project deployment uses its own draft list and correctly prefixed navigation.
- A new project-path draft renders all four mathematical delimiter styles and a task list.
- The new draft's exact source survives autosave and a page reload.
- About and license navigation works at both deployment paths.
- The About page explains MIT reuse, provides the source link, displays the original license, and preserves dependency notices.
- Standalone HTML export at the project path completes font collection and document generation, reaching its download-ready state.
- No application CSP violations or application errors appeared in the inspected browser logs. Browser-extension diagnostics were unrelated to the app.

The initial release's browser checks also covered Markdown file import, document renaming and switching, the outline, light/dark themes, and 320 px/390 px layouts. Those broader checks were not all repeated for this deployment-focused revision.

### Earlier verification limits

The generated HTML download was not reopened independently during this revision, and native print/PDF dialogs were not exercised. The earlier download-event interface timed out, so a successful export-generation message is not treated as proof that a downloaded file was reopened successfully. Follow the download/reopen and native print checks in [DEPLOYMENT.md](DEPLOYMENT.md) in the browsers you intend to support.

The local production preview at that time did not establish live deployment, DNS, or HTTPS status. Those deployment checks have since been completed, as recorded in the current deployment section. GitHub Pages delivers the documented CSP and referrer policies through the HTML rather than configurable response headers.

Drafts are scoped to the browser, origin, and application base path. Notes on a project hostname/path do not automatically transfer to a custom domain. Export Markdown before changing addresses and import it at the new address.
