# Reuse and customize the website

You can use this project for a personal tool, a course website, an organization's editor, or another public service. The application source is released under the [MIT license](../LICENSE). It builds to ordinary static files and needs no document server, account system, or deployment secret.

## Fork and publish on GitHub Pages

1. Fork the repository into your account and give the fork any repository name you prefer.
2. Enable GitHub Actions in the fork if GitHub prompts you to do so.
3. Open **Settings → Pages** and select **GitHub Actions** as the publishing source.
4. If you want a custom domain, configure it in Pages settings and then update its DNS. Otherwise, keep the default GitHub Pages address.
5. Customize the branding described below, commit your changes to `main`, and let **Deploy to GitHub Pages** run. You can also start that workflow manually from the Actions tab.

The workflow obtains the deployment URL from GitHub Pages. A fork at `https://your-name.github.io/your-repository/` gets the corresponding path prefix automatically; a custom domain uses its configured URL. The workflow contains no hardcoded owner, repository name, or production domain. With this Actions deployment, a `CNAME` file in the repository is not needed.

The original project's domain is `md.qft.org`; a fork should use its own default Pages address or a domain it controls. See the [deployment guide](DEPLOYMENT.md) for setup and verification details, and GitHub's [custom-domain instructions](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site).

## Change the identity in one place

Edit [`src/config/site.ts`](../src/config/site.ts):

| Setting | Purpose |
| --- | --- |
| `name` | The application name used by pages, the workspace, and exports |
| `title` | The descriptive workspace title used in search and browser tabs |
| `tagline` | The short phrase accompanying the identity |
| `description` | Default page description |
| `repositoryUrl` | Your source repository, used for the source-code link |

Use a name and description that fit your audience, and point `repositoryUrl` to your fork so visitors can find the code they are actually using. You may change the QFT name and visual identity; preserving them or a promotional backlink is not a condition of the project's MIT license.

Other customization points:

| File or directory | What to change |
| --- | --- |
| `public/favicon.svg` | Browser-tab icon |
| `public/social-card.svg` and `public/social-card.png` | Editable sharing artwork and its 1200 × 630 PNG export |
| `src/styles/app.css` | Interface colors, spacing, and responsive layout |
| `src/styles/document.css` | Preview, export, and print typography |
| `src/lib/document-presentation.ts` | Clean/Study Notes/Academic styles, page presets, and presentation validation |
| `src/lib/document-tools.ts` | Conservative cleanup and source-preserving section operations |
| `src/lib/examples.ts` | Starter documents and their descriptions |
| `src/pages/guide.astro` | Writing guide and syntax examples |
| `src/pages/about.astro` | About and privacy text describing your version |
| `src/lib/site-faq.ts` | Visible FAQ answers and their matching structured data |
| `src/lib/site-seo.ts` | Public sitemap routes and static structured data |

The default app has no analytics, remote document storage, accounts, or background synchronization. If you introduce any of these features, update the About page to describe the resulting behavior accurately.

The [search and AI discovery guide](SEO.md) explains generated metadata, sitemaps, robots rules, and webmaster-tool setup. All generated site URLs follow the configured domain and project path; project-path robots files need the additional considerations documented there.

## Adapt the examples and document styles

The first-use workspace opens a blank draft with actions for pasting text, opening a file, or exploring examples. The example gallery can serve a course, research group, or general audience. Add entries in `src/lib/examples.ts` with a stable `id`, a descriptive `title`, a short `description`, and ordinary Markdown in `source`. Links use `?example=<id>`; keep existing IDs if you want previously shared example links to continue working.

Document styles are independent of the interface's light/dark theme. The three built-in choices share the same HTML and print presentation code. To adjust their appearance, change `src/lib/document-presentation.ts` and the base rules in `src/styles/document.css`. To introduce another choice, update the allowlisted settings type and normalizer, the style controls in `src/components/MarkdownWorkspace.astro`, and the relevant presentation tests together.

Keep the typography preview labeled accurately: it shows the document's appearance, while the browser print preview determines final pagination. **Save PDF** opens the browser's print dialog. The same selected presentation is available through standalone HTML export. Neither requires a document server or an AI API key.

Per-document paper and presentation preferences are stored locally and separately from the Markdown. A downloaded Markdown file contains the source text; it does not carry those application preferences to another installation. Cleanup creates a formatted copy and retains the original. Preserve this review-and-undo behavior when adapting the tool for your own audience.

## Build for another static host

Use the Node and npm versions recorded in `.node-version` and `package.json`. Install with `npm ci`, then run the source checks and tests.

```sh
npm ci
npm run check
npm test
```

Set `SITE_URL` to the full public URL, including a subdirectory when applicable. For a shell such as bash or zsh:

```sh
export SITE_URL=https://example.com/notes/
npm run build
npm run preview
```

In PowerShell, set the same environment variable with `$env:SITE_URL = "https://example.com/notes/"` before running the build and preview commands.

Publish the contents of `dist/` at that URL. Keep the environment variable set when previewing a subdirectory build so the preview uses the same path prefix. No server-side JavaScript is required. Configure HTTPS with your hosting provider.

The application includes a meta Content Security Policy and referrer policy suitable for GitHub Pages. Other hosts may support additional response headers; review the [architecture](ARCHITECTURE.md) before adding or changing policies so editing, fonts, and intentional image exports continue to work.

## Preserve the license notices

Keep the existing copyright and permission notice in [LICENSE](../LICENSE) with copies or substantial portions of the application. You may add your own copyright notice for new contributions. The MIT license permits modification and redistribution, including commercial use; it does not require publishing your modifications or retaining the original branding.

Dependencies have their own licenses. Preserve the applicable texts in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md), including the font notices. The About page exposes these texts in the built site, and portable HTML exports include the KaTeX notice for their embedded math fonts. If you replace either presentation, keep the notices available with the redistributed application or exported resources. If you add or replace a dependency, update the notices to match what you distribute.

The editor's license covers its software. It does not change the copyright or licensing of documents that someone writes or imports.

## Keep future updates manageable

Keep the original repository as an `upstream` Git remote if you want to bring in later improvements. Put branding changes in the configuration and styles above, use focused commits for functional changes, and review upstream changes before merging them. Preserve `package-lock.json` so installations remain reproducible.

After an update, run the checks and build, then verify editing, local saving, mathematics, downloads, and printing in a browser. Drafts and preferences are scoped to the browser origin and the application's deployment path, independently of the display name. Separate path namespaces prevent accidental mixing between project sites on the same Pages hostname; they are not a security boundary against other code on that origin.

Export important notes before changing the site's address or storage format. Moving from `your-name.github.io/your-repository/` to a custom domain does not transfer drafts automatically; download Markdown from the old address and import it at the new one.
