# Release verification — 2026-10-29

This is a build and local verification record. The website has **not** been published to Cloudflare or connected to `md.qft.org` as part of this release.

## Automated checks

| Check | Result |
| --- | --- |
| `npm run check` | Passed: 0 errors, 0 warnings, 0 hints |
| `npm test` | Passed: 31 tests, 0 failures |
| `npm run build` | Passed: 5 static pages |
| `npx wrangler deploy --dry-run` | Passed with Wrangler 4.155.0; no bindings or deployment credentials needed |

The test suite covers all mathematical delimiter styles, malformed formula recovery, source-line diagnostics, literal code, escaped HTML, unsafe links, optional images, macro isolation and expansion limits, unique heading IDs, footnotes, task lists, example documents, exact source persistence, atomic competing saves, deleted-document conflicts, unavailable storage, and autosave races during creation/deletion/recovery.

The build emits one relatively large editor bundle because CodeMirror, KaTeX, and Markdown parsing run in the browser. Vite reports a bundle-size advisory; the build succeeds and the assets are comfortably within Workers Static Assets limits. This release does not suppress the advisory.

## Browser checks

Verified in the available Chrome environment:

- First-load example, live source editing, inline/display mathematics, and rendered tables.
- Creating and renaming a draft, followed by a reload that retained both title and source.
- Switching between documents, the document outline, and preview-only mode.
- Importing a real `.md` file as a separate draft with inline and matrix mathematics.
- Light and dark themes.
- Responsive rendering in 390 px and 320 px browsing contexts, including editor/preview switching and the mobile document sidebar.
- HTML export completed font collection and document generation and reached its success state.

The browser's download-event interface timed out for both Markdown and HTML, so the downloaded files could not be captured and reopened through that interface. Native print/PDF dialogs were not exercised. These are explicit limits of this verification record; the deployment guide includes the remaining real-browser export/print checks.

## Cloudflare serving checks

Local Wrangler serving returned the four regular routes successfully, redirected `/guide` to `/guide/`, and returned the custom 404 page for missing routes. JavaScript and WOFF2 assets had the expected content types. The CSP, `nosniff`, and referrer headers were present. The preview-host `noindex` rule applied to the tested `workers.dev` hostname and did not apply to `md.qft.org`.

The built HTML contains no inline executable scripts. CSS font references resolve to files in the build. The portable HTML exporter includes the complete KaTeX license with its embedded mathematical fonts.

## Before public launch

Connect the source repository to Workers Builds, deploy a preview, and complete the domain, HTTPS, download/reopen, and native print checks in [DEPLOYMENT.md](DEPLOYMENT.md). Browser-local drafts are scoped to the origin; notes written on a preview hostname do not automatically transfer to `md.qft.org`.
