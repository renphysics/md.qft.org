import { siteConfig } from '../config/site';
import type { SiteFaq } from './site-faq';

/** Public, canonical routes only. Drafts and example query strings are local UI state. */
export const publicPages = [
  { path: '', name: 'Workspace' },
  { path: 'guide/', name: 'Markdown, math, and slides guide' },
  { path: 'examples/', name: 'Document and slide examples' },
  { path: 'faq/', name: 'Frequently asked questions' },
  { path: 'about/', name: 'About and privacy' },
] as const;

/** JSON-LD is an inert data block. Escape HTML delimiters before placing it in a script element. */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

interface PageMetadata {
  homeUrl: string;
  canonicalUrl: string;
  title: string;
  description: string;
  faq?: readonly SiteFaq[];
}

/** This receives build-time site metadata, never document text or browser storage. */
export function structuredData({ homeUrl, canonicalUrl, title, description, faq }: PageMetadata) {
  const websiteId = `${homeUrl}#website`;
  const applicationId = `${homeUrl}#application`;
  const isHome = canonicalUrl === homeUrl;
  const page = {
    '@type': faq ? 'FAQPage' : 'WebPage',
    '@id': `${canonicalUrl}#webpage`,
    url: canonicalUrl,
    name: title,
    description,
    inLanguage: 'en',
    isPartOf: { '@id': websiteId },
    about: { '@id': applicationId },
    ...(faq ? {
      mainEntity: faq.map(({ question, answer }) => ({
        '@type': 'Question', name: question,
        acceptedAnswer: { '@type': 'Answer', text: answer },
      })),
    } : isHome ? { mainEntity: { '@id': applicationId } } : {}),
  };
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite', '@id': websiteId,
        name: siteConfig.name, url: homeUrl,
        description: siteConfig.description, inLanguage: 'en',
      },
      {
        '@type': 'WebApplication', '@id': applicationId,
        name: siteConfig.name, url: homeUrl,
        description: siteConfig.description,
        applicationCategory: 'ProductivityApplication',
        operatingSystem: 'Any',
        browserRequirements: 'Requires JavaScript and a modern web browser.',
        isAccessibleForFree: true,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        license: 'https://opensource.org/license/mit',
        sameAs: siteConfig.repositoryUrl,
        softwareHelp: { '@type': 'WebPage', url: new URL('guide/', homeUrl).href },
        featureList: [
          'Live Markdown preview', 'KaTeX mathematics',
          'Local browser drafts and image attachments', 'Reviewed formatting cleanup',
          'Section organization', 'Markdown and image ZIP bundles',
          'Standalone document and interactive presentation HTML export',
          'Markdown slides with themes and fullscreen presentation',
          'Interactive physics demonstrations and isolated custom HTML demos',
          'Offline interactive HTML and static demo snapshots for PDF',
          'Document styles and browser print-to-PDF', 'One-page-per-slide PDF printing',
        ],
      },
      page,
    ],
  };
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export function sitemapXml(homeUrl: string): string {
  const entries = publicPages.map(({ path }) => `  <url><loc>${escapeXml(new URL(path, homeUrl).href)}</loc></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</urlset>\n`;
}

export function robotsText(homeUrl: string): string {
  return `User-agent: *\nAllow: /\n\nSitemap: ${new URL('sitemap.xml', homeUrl).href}\n`;
}
