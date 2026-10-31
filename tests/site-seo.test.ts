import test from 'node:test';
import assert from 'node:assert/strict';
import { publicPages, robotsText, serializeJsonLd, sitemapXml, structuredData } from '../src/lib/site-seo';
import { siteFaqs } from '../src/lib/site-faq';

test('public discovery URLs respect a custom domain and a project subdirectory', () => {
  for (const homeUrl of ['https://md.qft.org/', 'https://reuse-example.github.io/reuse-check/']) {
    const xml = sitemapXml(homeUrl);
    const urls = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);
    assert.deepEqual(urls, publicPages.map(({ path }) => new URL(path, homeUrl).href));
    assert.equal(urls.length, new Set(urls).size);
    assert.ok(urls.every((url) => url.startsWith(homeUrl) && !/[?#]/.test(url)));
    assert.ok(!xml.includes('404') && !xml.includes('example='));
    assert.equal(robotsText(homeUrl), `User-agent: *\nAllow: /\n\nSitemap: ${homeUrl}sitemap.xml\n`);
  }
});

test('structured data uses consistent, base-aware site and page identities', () => {
  const homeUrl = 'https://example.org/notes/';
  const canonicalUrl = `${homeUrl}guide/`;
  const data = structuredData({ homeUrl, canonicalUrl, title: 'Writing guide', description: 'A public guide.' });
  assert.equal(data['@context'], 'https://schema.org');
  const [website, application, page] = data['@graph'];
  assert.equal(website['@id'], `${homeUrl}#website`);
  assert.equal(application['@id'], `${homeUrl}#application`);
  assert.equal(page.url, canonicalUrl);
  assert.equal(page['@id'], `${canonicalUrl}#webpage`);
  assert.ok(!serializeJsonLd(data).includes('SearchAction'));
  assert.ok(!serializeJsonLd(data).includes('aggregateRating'));
});

test('FAQ structured answers match the visible FAQ source exactly', () => {
  const data = structuredData({ homeUrl: 'https://example.org/', canonicalUrl: 'https://example.org/faq/', title: 'FAQ', description: 'Help', faq: siteFaqs });
  const page = data['@graph'].find((entry) => entry['@type'] === 'FAQPage');
  assert.ok(page);
  assert.ok('mainEntity' in page);
  assert.deepEqual(page.mainEntity, siteFaqs.map(({ question, answer }) => ({
    '@type': 'Question', name: question, acceptedAnswer: { '@type': 'Answer', text: answer },
  })));
});

test('JSON-LD serialization cannot close its HTML data block and preserves text', () => {
  const input = { name: 'A "name" & </script><script>alert(1)</script>\u2028\u2029' };
  const output = serializeJsonLd(input);
  assert.ok(!/[<>&\u2028\u2029]/.test(output));
  assert.deepEqual(JSON.parse(output), input);
});

test('sitemap serializes URL characters safely as XML', () => {
  const xml = sitemapXml('https://example.org/a&b/');
  assert.ok(xml.includes('https://example.org/a&amp;b/'));
  assert.ok(!xml.includes('https://example.org/a&b/'));
});
