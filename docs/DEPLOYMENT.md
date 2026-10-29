# Deploy QFT Markdown to Cloudflare Workers

Target domain: **md.qft.org**  
Worker name: **qft-markdown**  
Repository: **[renphysics/md.qft.org](https://github.com/renphysics/md.qft.org)**

This project produces static files with Astro. `wrangler.jsonc` serves `dist/` through Workers Static Assets. There is no server entry point, SSR adapter, database, R2 bucket, or document-processing API.

Cloudflare's current recommendation for new static applications is [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/). This guide uses **Workers Builds**, including its GitHub integration, rather than the Pages setup screens.

## 1. Prepare the repository

Clone [renphysics/md.qft.org](https://github.com/renphysics/md.qft.org) to work locally. The repository includes `package-lock.json`, `.node-version`, `wrangler.jsonc`, and `.github/workflows/check.yml`. Use `main` as the production branch and feature branches for changes.

Before connecting deployment, run these commands from the project root with Node **24.22.1** and npm **11.9.0**:

```sh
npm ci
npm run check
npm test
npm run build
```

The result is the `dist/` directory. Preserve the lockfile and use `npm ci` in automation. When dependencies change, update the package versions and lockfile together and rerun these checks.

The GitHub **Check** workflow installs the documented toolchain, then runs the same checks. It has read-only repository permissions and no deployment credentials. Cloudflare performs deployment separately.

## 2. Connect GitHub to Workers Builds

In the Cloudflare account that owns the intended deployment:

1. Open **Workers & Pages** and create an application using the Workers GitHub flow.
2. Authorize access to the intended repository and select `renphysics/md.qft.org`.
3. Name the Worker **`qft-markdown`**, matching `wrangler.jsonc`.
4. Use the following build settings.

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Root directory | Repository root |
| Build command | `npm ci && npm run check && npm test && npm run build` |
| Production deploy command | `npx wrangler deploy` |
| Preview command | `npx wrangler preview` |
| Build variable | `SKIP_DEPENDENCY_INSTALL=1` |
| Node version | `.node-version` contains `24.22.1` |
| npm version | `packageManager` in `package.json` specifies `npm@11.9.0` |
| Static assets | `./dist`, read from `wrangler.jsonc` |

`SKIP_DEPENDENCY_INSTALL` avoids an automatic installation before the explicit `npm ci`. Keep the npm version in `packageManager`: Workers Builds does not use `engines.npm` to select npm. Build variables belong in the build settings, rather than runtime environment variables.

The Workers screen uses a **deploy command**, not the Pages build-output-directory setting. Do not use `wrangler pages deploy`. The project also does not need the Cloudflare SSR adapter or the older Workers Sites/KV configuration.

Workers Builds can provision its deployment authentication through the account connection. The application needs no API key or secret at runtime. Never place deployment credentials in client-side environment variables.

References: [Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/) and [build image/version settings](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/).

## 3. Enable branch previews

In the Worker, go to **Settings → Build → Branch control** and enable **Preview Builds**. Confirm that `main` is the production branch. New Workers use `npx wrangler preview` for preview builds; the production command remains `npx wrangler deploy`.

Push a feature branch and open a pull request. Workers Builds runs the build command and then the preview command, producing a preview URL. Review that URL before merging. A subsequent production-branch push deploys the production site.

This is the current Workers preview flow. Older Workers may still have the legacy version-upload preview model; follow Cloudflare's migration prompt if configuring an existing Worker. Do not change the preview command to the production deploy command.

The supplied `_headers` adds `X-Robots-Tag: noindex` to standard `workers.dev` hostnames. Check the actual preview response. Search-engine exclusion is not access control; choose Cloudflare Access if a preview must require sign-in.

Reference: [Workers build branches](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/).

## 4. Attach md.qft.org

First verify the deployed Worker at the URL Cloudflare gives you. Then:

1. Confirm that **`qft.org` is an active Cloudflare zone in the intended account** and that you can manage it.
2. Open **Workers & Pages → qft-markdown → Settings → Domains & Routes**.
3. Select **Add → Custom Domain**, enter **`md.qft.org`**, and confirm.
4. Allow Cloudflare to create the DNS record and certificate. Verify HTTPS at the custom domain.

Workers Custom Domains cannot be created on a hostname that already has a CNAME record. If `md.qft.org` already points to another service, identify that service and deliberately replace its DNS association when you are ready to move the hostname. Do not create a Pages CNAME for this Worker.

The committed Wrangler configuration intentionally does not claim a domain or embed an account/zone identifier. After the domain has been associated with the correct Worker and account, you may record it in `wrangler.jsonc` as a top-level configuration property:

```json
"routes": [
  { "pattern": "md.qft.org", "custom_domain": true }
]
```

Commit that change only once the domain mapping is intentional. Treat the production configuration as the source of truth for future deployments.

Reference: [Workers Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).

## 5. Verify the deployed browser experience

A successful build establishes that the source compiles and the automated regression checks pass. It does not establish that your custom domain, certificate, browser permissions, or production headers are correct.

On the preview and then the custom domain, verify the following concrete behaviors:

- Edit a note containing all four math delimiters, a code fence, a table, and a malformed equation. Valid math renders; code remains literal; an equation error can be located in the editor.
- Create and rename a draft, reload the page, and reopen it. Open the same draft in two tabs and confirm that competing edits are preserved rather than silently overwritten.
- Import a Markdown file, download it again, and compare the source. Export HTML, open that file independently, and confirm the equations still appear. Test **Print / Save PDF**, including wide equations and multipage notes.
- Confirm that remote images make no request before opt-in. Enable them only for the document you are testing. Portable HTML export should fetch and embed permitted remote raster images; an image host that blocks cross-origin downloads should produce a clear export error. Turning off remote images should allow export with placeholders.
- Try the layout on a narrow viewport, navigate the toolbar by keyboard, resize the panes, and check editor/preview modes and theme controls.
- Inspect the browser console for CSP violations and check that script and font files load successfully.

You can inspect response headers with:

```sh
curl -I https://md.qft.org/
```

Expect the `Content-Security-Policy`, `X-Content-Type-Options`, and `Referrer-Policy` supplied by `public/_headers`. Preview hostnames should receive `X-Robots-Tag: noindex`; the production custom domain should not inherit that preview rule.

Visual screenshots cannot establish that saving, clipboard/download permissions, private-browsing storage, or printing works. Test those interactions in the browsers you intend to support, especially mobile Safari. Private windows can have different storage retention; the app's local-draft notice remains applicable.

## Local Cloudflare inspection

To inspect the built site under Wrangler without publishing it:

```sh
npm run build
npx wrangler dev
```

This is useful for testing `_headers` and the static asset routes. Astro's development and preview servers are convenient for UI work but are not a substitute for the Cloudflare header check.

The CSP permits same-origin scripts, local fonts, and the inline styles needed by CodeMirror and KaTeX. Executable inline scripts remain blocked. If an Astro configuration change starts inlining executable JavaScript, fix the build output or use a narrowly scoped policy; do not loosen `script-src` indiscriminately. Remote HTTPS images are permitted by CSP but remain blocked by the application until the user opts in. `connect-src` also permits HTTPS so portable HTML export can intentionally fetch and embed those enabled images; these fetches omit credentials and referrer information and require the image host to allow CORS. The production policy upgrades insecure image URLs to HTTPS.

Reference: [Workers Static Assets headers](https://developers.cloudflare.com/workers/static-assets/headers/).

## Maintenance

Use pull requests and previews for changes. Keep the checked-in Node/npm versions aligned with CI and Workers Builds. Update dependencies deliberately, rerun the regression checks, and inspect exported HTML whenever the rendering or font dependencies change.

For a production regression, revert the relevant commit and redeploy, or use Cloudflare's deployment history. Browser drafts belong to the origin and browser profile, so a deployment rollback does not itself restore or migrate user documents. Preserve storage compatibility when changing draft schemas.
