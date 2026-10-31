# Search and AI discovery

The website exposes public product information in static HTML while keeping documents in the visitor's browser. These changes help crawlers understand the application; they do not guarantee indexing, rankings, rich results, or citations in AI answers.

## What the build provides

- Descriptive titles and unique descriptions for the workspace, guide, examples, FAQ, and About page.
- One absolute canonical URL per indexable page, excluding query strings and fragments.
- Open Graph and Twitter/X metadata, including a 1200 × 630 PNG sharing image.
- Static Schema.org `WebSite`, `WebApplication`, and `WebPage` data. The FAQ uses `FAQPage` and the exact question/answer array rendered on the page.
- A generated `sitemap.xml` listing only the five canonical public pages.
- A generated `robots.txt` allowing public crawling and advertising the sitemap.
- A `noindex, follow` directive on the 404 page, which has no canonical or structured-data block and is excluded from the sitemap.
- Crawlable links to the guide, examples, FAQ, About page, source code, and license.

The blank workspace retains its descriptive static browser title after JavaScript starts. Named or nonempty drafts can use document-specific tab titles. Document titles and contents never enter the build-generated canonical, social metadata, sitemap, or structured data. Drafts have no public document URLs.

JSON-LD is serialized with HTML delimiters escaped and emitted as an inert `application/ld+json` data block. The executable-script CSP remains `script-src 'self'`; no inline JavaScript permission was added. No analytics, AI API, indexing service, or tracking dependency is required.

## Deployments and forks

The build derives absolute URLs from `SITE_URL`, including its optional project path. The Pages workflow obtains this value from the repository's Pages configuration. A fork at `https://owner.github.io/editor/` gets canonical and sitemap URLs under `/editor/`, rather than links to the original deployment.

**Robots rules are read only at the origin root.** A project site's `/editor/robots.txt` is not authoritative for `owner.github.io`. Submit that project's sitemap URL directly to webmaster tools, or advertise it from `https://owner.github.io/robots.txt` if you control that file. A custom domain served at `/` can use this project's generated robots file directly.

Update `src/config/site.ts` to rebrand the site and `public/social-card.svg` plus `public/social-card.png` to rebrand the sharing image. Keep the PNG at 1200 × 630 pixels. `src/lib/site-seo.ts` owns the public page list; add or remove routes there when the site's public structure changes. The sitemap deliberately omits invented modification dates, priority values, example query variants, and private documents.

## After publishing

1. Verify the domain in Google Search Console and Bing Webmaster Tools using an account that controls the site.
2. Submit the public sitemap, normally `https://your-domain/sitemap.xml`, or its project-path equivalent.
3. Inspect the workspace, guide, and FAQ URLs to confirm indexing eligibility. Check the canonical selected by the search engine after it has crawled the site.
4. Review impressions, queries, and indexing reports over time. Publishing this code does not itself submit the site or verify a webmaster account.

For AI discovery, the useful foundation is accessible factual content, clear page structure, accurate metadata, and crawlable links. This project does not create hidden crawler-only prose or duplicate keyword pages. It does not invent ratings or reviews to qualify for software rich results, and it makes no claim that its FAQ will receive a special search presentation. An `llms.txt` file is not required by Google's AI-feature guidance.

## References

- [Google: AI features and your website](https://developers.google.com/search/docs/appearance/ai-features)
- [Google: JavaScript SEO basics](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics)
- [Google: canonical URLs](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)
- [Google: robots.txt specification](https://developers.google.com/crawling/docs/robots-txt/robots-txt-spec)
- [Schema.org: WebApplication](https://schema.org/WebApplication)

## Validation

`tests/site-seo.test.ts` checks domain-root and project-path discovery URLs, shared structured-data identities, FAQ answer fidelity, safe JSON-LD serialization, and XML escaping. Production output should also be checked for working sitemap routes, matching canonicals and social URLs, an excluded/noindexed 404, a valid sharing image, and the unchanged CSP. Browser checks should confirm the blank workspace keeps its public title and that the FAQ is reachable without editor initialization.
