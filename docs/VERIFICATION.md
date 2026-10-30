# GitHub Pages revision verification — 2026-10-29

This record describes local source, build, and browser verification for the GitHub Pages revision. Live deployment results are recorded in GitHub Actions. DNS, the production certificate, and the final custom-domain behavior must be checked after the repository's Pages settings are configured.

## Automated checks

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

## Browser checks for this revision

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

## Verification limits

The generated HTML download was not reopened independently during this revision, and native print/PDF dialogs were not exercised. The earlier download-event interface timed out, so a successful export-generation message is not treated as proof that a downloaded file was reopened successfully. Follow the download/reopen and native print checks in [DEPLOYMENT.md](DEPLOYMENT.md) in the browsers you intend to support.

The local production preview does not establish that GitHub Pages is enabled, that a live deployment has succeeded, or that custom-domain DNS and HTTPS are correct. Complete those hosting checks after applying the repository settings. GitHub Pages does not deliver the former host's custom response headers; the documented CSP and referrer policies are delivered in the HTML instead.

Drafts are scoped to the browser, origin, and application base path. Notes on a project hostname/path do not automatically transfer to a custom domain. Export Markdown before changing addresses and import it at the new address.
