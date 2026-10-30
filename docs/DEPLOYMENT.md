# Deploy to GitHub Pages

Production repository: **[renphysics/md.qft.org](https://github.com/renphysics/md.qft.org)**  
Production URL: **https://md.qft.org**

Astro builds this application into ordinary static files in `dist/`. GitHub Pages serves those files; document editing, math rendering, local draft saving, and export run in the visitor's browser. There is no server entry point, database, or document-processing API.

## 1. Check the source locally

Use **Node 24.22.1** and **npm 11.9.0**, as recorded in `.node-version` and `package.json`:

```sh
npm ci
npm run check
npm test
npm run build
npm run preview
```

Open the preview URL printed by Astro. Preserve `package-lock.json` and use `npm ci` in automation. When changing dependencies, update the package versions and lockfile together and repeat the checks.

The read-only **Check** workflow runs on pushes to `main`, pull requests, and manual requests. It remains useful before a fork has enabled Pages. It does not publish a website.

## 2. Enable GitHub Pages once

In the repository:

1. Open **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. If this is a fork, enable GitHub Actions in its **Actions** tab when GitHub asks.
4. For the production site, set the custom domain as described below before pointing DNS at GitHub.
5. Open **Actions → Deploy to GitHub Pages → Run workflow**, select `main`, and run it. Later pushes to `main` trigger deployment automatically.

Do not select branch-based publishing of the repository root. The repository contains Astro source; the workflow publishes only the generated `dist/` directory.

[`.github/workflows/pages.yml`](../.github/workflows/pages.yml) contains two jobs:

- **Build:** installs the pinned toolchain and dependencies, runs type checking and tests, reads the repository's Pages URL, builds for that URL, and uploads `dist/` as the Pages artifact.
- **Deploy:** runs only after the build succeeds and publishes that artifact through the `github-pages` environment.

The build job has read-only repository/Pages permissions. Only the deployment job has `pages: write` and `id-token: write`. GitHub supplies the short-lived workflow credentials; no personal access token, API key, or repository secret is needed. Actions are pinned to immutable commit hashes. Manual runs from branches other than `main` do not deploy.

If **Read GitHub Pages configuration** fails because Pages is not enabled, complete step 2 and rerun the workflow. Do not add a personal token to work around the missing repository setting. If your repository requires approval for the `github-pages` environment, approve the deployment there.

Reference: [Using custom workflows with GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## 3. Attach md.qft.org

GitHub recommends verifying a custom domain in your account before assigning it to a repository. Keep any verification TXT record that GitHub provides. See [Verifying your custom domain](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/verifying-your-custom-domain-for-github-pages).

1. In **renphysics/md.qft.org → Settings → Pages → Custom domain**, enter **md.qft.org** and save.
2. Then, at the DNS provider for `qft.org`, create or update this record:

   | Setting | Value |
   | --- | --- |
   | Type | `CNAME` |
   | Name | `md` |
   | Target | `renphysics.github.io` |
   | TTL | Default / Auto |

3. If Cloudflare manages the DNS zone, use **DNS only** for a direct GitHub Pages setup. Remove any conflicting DNS record for this exact hostname when switching it to the new target; leave unrelated subdomains alone.
4. Wait for GitHub's DNS check and certificate provisioning, then select **Enforce HTTPS** in Pages settings. GitHub says the option can take up to 24 hours to become available.
5. Run **Deploy to GitHub Pages** again after changing the domain. The build reads the current Pages URL, so this updates canonical URLs, links, and assets to the custom-domain location.
6. Open **https://md.qft.org** and complete the browser checks below.

The CNAME target is the account hostname `renphysics.github.io`, without `https://`, a repository name, or a path. The DNS record applies only to `md.qft.org`; it does not change the main `qft.org` site.

**No repository `CNAME` file is required.** GitHub's documentation says such files are ignored when publishing through a custom Actions workflow. Configure the custom domain in repository Pages settings. No `gh-pages` branch, Jekyll configuration, or `.nojekyll` file is needed for this artifact-based deployment.

References: [Managing a custom domain](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site) and [HTTPS for GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https).

## 4. Deploy a fork or another domain

A fork can use its normal Pages URL, such as `https://your-name.github.io/your-repository/`, or its own custom domain. It does not need access to `qft.org` or the original owner's accounts.

The deployment workflow obtains the full URL from [`actions/configure-pages`](https://github.com/actions/configure-pages) and supplies it as the build-time **`SITE_URL`**. Astro derives the origin and base path from that URL. Site navigation, the favicon, example links, and bundled assets respect the base path. There is no account or production-domain constant in the deployment workflow to replace.

For a local build aimed at another host or subdirectory, set the same variable. For example, in a POSIX shell:

```sh
export SITE_URL=https://your-name.github.io/your-repository/
npm run build
npm run preview
```

For PowerShell:

```powershell
$env:SITE_URL = 'https://your-name.github.io/your-repository/'
npm run build
npm run preview
```

Use the project's base-path URL when previewing a build intended for a subdirectory. When changing from a project URL to a custom domain, rerun the Pages workflow after saving the domain in GitHub. It will build at the domain root automatically.

See [Reuse and customization](REUSE.md) for branding and MIT-license guidance. For another static host, upload the contents of `dist/` after building for that host's URL.

## 5. Browser security on Pages

The shared HTML layout includes a **Content Security Policy meta tag** and a **no-referrer meta tag**. The policy permits the site's own scripts and fonts, plus the inline styling required by CodeMirror and KaTeX. Remote HTTPS images remain blocked by the application until a user enables them; HTTPS fetches are allowed for embedding enabled images in portable HTML exports.

GitHub Pages does not apply a `_headers` file or expose arbitrary response-header configuration. Consequently, the application does not claim to send custom framing, opener, permissions, MIME-sniffing, or immutable-cache response headers. CSP directives such as `frame-ancestors` cannot be enforced through a meta tag. If a deployment needs those headers, configure them on a compatible hosting layer.

The editor still disables raw Markdown HTML, renders math with untrusted-input settings, and checks image and link protocols. Its JavaScript and fonts are served with the application. Exported HTML includes its own document policy and embedded math fonts.

References: [GitHub Pages response-header limitation](https://github.com/orgs/community/discussions/54257) and [CSP meta delivery](https://www.w3.org/TR/CSP3/#meta-element).

## 6. Verify the deployed website

A successful workflow verifies the build and publishes an artifact. It does not by itself verify your DNS, every browser, downloaded files, or native print dialogs. The concrete verification record and known limits are in [VERIFICATION.md](VERIFICATION.md).

After deployment:

- Open the workspace, guide, examples, About page, and a nonexistent URL. Confirm the custom 404 page and its navigation work.
- Edit Markdown containing all four math delimiters, a code fence, a table, and a malformed equation. Valid math should render; an equation error should link back to its source.
- Create and rename a draft, reload, and reopen it. Open a draft in two tabs and check that competing edits are preserved.
- Import a Markdown file, download it again, and compare its source. Export HTML and open that file independently. Test **Print / Save PDF**, including wide equations and multiple pages.
- Confirm remote images make no request before opt-in. Enabled remote raster images should be embedded in HTML exports; an image host that denies cross-origin downloads should produce a clear error.
- Try narrow screens, keyboard navigation, split-pane resizing, preview mode, and both themes.
- Inspect the browser console for CSP errors and verify scripts, CSS, and fonts load. The page source should contain the CSP and referrer meta tags; these policies are not expected in `curl -I` response headers.

Drafts and preferences are scoped to the browser, origin, and application base path. Separate project paths use separate database and preference names to avoid accidental overlap; this is not a security boundary between scripts on the same origin. A `github.io` URL and a custom domain also have separate storage. Export important notes before changing the hostname or base path, then import them at the new address. Keeping the same HTTPS origin, base path, and storage schema while changing hosts does not itself move or erase browser drafts.

## Maintenance

Use pull requests for changes. The **Check** workflow verifies them without publishing; the production Pages workflow publishes `main`. This setup does not create separate live preview sites for pull requests. Use local Astro preview for review.

To undo a production regression, revert the source change and let the Pages workflow rebuild. For changes to domain settings or Pages configuration, rerun the workflow from `main`. Keep the Node/npm pins aligned with the project and update dependency versions deliberately.
