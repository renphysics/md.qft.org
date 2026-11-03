import test from 'node:test';
import assert from 'node:assert/strict';
import MarkdownIt from 'markdown-it';
import { cleanLinkTracking } from '../src/lib/link-tracking.ts';

test('many unmatched math delimiters do not consume a later citation or change their literal source', () => {
  const link = '[arxiv.org](https://arxiv.org/html/0808.2691v3?utm_source=chatgpt.com)';
  for (const prefix of ['\\( '.repeat(12_000), '\\[\n'.repeat(12_000), String.raw`\\(`.repeat(12_000)]) {
    const result = cleanLinkTracking(prefix + '\n\n' + link);
    assert.equal(result.source, prefix + '\n\n[arxiv.org](https://arxiv.org/html/0808.2691v3)');
    assert.equal(result.changes.length, 1);
  }
});

const markdown = new MarkdownIt({ html: true, linkify: false });
const tracked = 'https://arxiv.org/html/0808.2691v3?utm_source=chatgpt.com';
const clean = 'https://arxiv.org/html/0808.2691v3';

function hrefs(source: string): string[] {
  return markdown.parse(source, {}).flatMap((token) => token.children ?? [])
    .filter((token) => token.type === 'link_open')
    .map((token) => String(token.attrGet('href') ?? ''));
}

test('the actual AI citation loses its tracking query and keeps its label', () => {
  const result = cleanLinkTracking('[arxiv.org](' + tracked + ')');
  assert.equal(result.source, '[arxiv.org](' + clean + ')');
  assert.ok(result.changes.length > 0);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(hrefs(result.source), [clean]);
});

test('functional query bytes, duplicate keys, order, path spelling, and fragments stay exact', () => {
  const source = '[Paper](https://Example.test:443/paper%2Fpart?q=a%20b+%2B~&utm_source=chatgpt.com&lang=zh&q=second&empty=&flag#Section%2F2)';
  const expected = '[Paper](https://Example.test:443/paper%2Fpart?q=a%20b+%2B~&lang=zh&q=second&empty=&flag#Section%2F2)';
  const result = cleanLinkTracking(source);
  assert.equal(result.source, expected);
  assert.deepEqual(result.issues, []);
});

test('tracking parameters can be first, middle, last, repeated, empty, or valueless', () => {
  for (const [query, expected] of [
    ['utm_source=x', ''],
    ['utm_source=x&v=2', '?v=2'],
    ['v=2&utm_source=x&lang=en', '?v=2&lang=en'],
    ['v=2&utm_source=x', '?v=2'],
    ['utm_source=x&v=2&utm_source=y', '?v=2'],
    ['utm_source=&v=', '?v='],
    ['utm_source&v=2', '?v=2'],
  ]) {
    const result = cleanLinkTracking('[Paper](https://example.test/p?' + query + '#result)');
    assert.equal(result.source, '[Paper](https://example.test/p' + expected + '#result)', query);
  }
});

test('the explicit tracking families are case insensitive', () => {
  for (const key of [
    'utm_source', 'UTM_SOURCE', 'UtM_Campaign', 'utm_custom_campaign_field',
    'gclid', 'DCLID', 'fbclid', 'msclkid', 'gbraid', 'wbraid', 'mc_cid', 'mc_eid',
  ]) {
    const result = cleanLinkTracking('[Paper](https://example.test/p?' + key + '=campaign&page=2)');
    assert.equal(result.source, '[Paper](https://example.test/p?page=2)', key);
  }
});

test('generic and functional keys are preserved even if their values mention tracking', () => {
  const url = 'https://example.test/p?ref=chatgpt.com&source=chatgpt.com&id=utm_source&q=physics&page=2&lang=en&token=abc&format=pdf&utm=keep&utmfoo=keep';
  const source = '[Paper](' + url + ')';
  const result = cleanLinkTracking(source);
  assert.equal(result.source, source);
  assert.deepEqual(result.changes, []);
  assert.deepEqual(result.issues, []);
});

test('a fragment is never treated as a second query string', () => {
  const withOnlyFragment = '[Paper](https://example.test/p#section?utm_source=chatgpt.com&gclid=123)';
  assert.equal(cleanLinkTracking(withOnlyFragment).source, withOnlyFragment);
  const withBoth = '[Paper](https://example.test/p?utm_source=x&lang=en#section?utm_source=y&gclid=123)';
  assert.equal(cleanLinkTracking(withBoth).source,
    '[Paper](https://example.test/p?lang=en#section?utm_source=y&gclid=123)');
});

test('percent-encoded separators inside functional values remain data', () => {
  const source = '[Paper](https://example.test/p?return=https%3A%2F%2Fother.test%2F%3Futm_source%3Dx&payload=%26utm_source%3Dx&utm_medium=chat&hash=%23section)';
  const expected = '[Paper](https://example.test/p?return=https%3A%2F%2Fother.test%2F%3Futm_source%3Dx&payload=%26utm_source%3Dx&hash=%23section)';
  assert.equal(cleanLinkTracking(source).source, expected);
});

test('inline labels, angle destinations, parentheses, and titles remain byte exact', () => {
  const source = '[A **paper**](<https://example.test/paper(part)?utm_source=x&v=2#s> "Title with ?utm_source=literal")';
  const expected = '[A **paper**](<https://example.test/paper(part)?v=2#s> "Title with ?utm_source=literal")';
  assert.equal(cleanLinkTracking(source).source, expected);
  const escaped = String.raw`[A paper](https://example.test/paper\(part\)?utm_source=x&v=2 'Keep this title')`;
  const escapedExpected = String.raw`[A paper](https://example.test/paper\(part\)?v=2 'Keep this title')`;
  assert.equal(cleanLinkTracking(escaped).source, escapedExpected);
  assert.deepEqual(hrefs(escapedExpected), ['https://example.test/paper(part)?v=2']);
});

test('Markdown-escaped and entity-encoded query separators preserve their source spelling', () => {
  for (const separator of [String.raw`\&`, '&amp;', '&#38;', '&#x26;']) {
    const source = '[Paper](https://example.test/p?q=a' + separator + 'utm_source=x' + separator + 'lang=en)';
    const expected = '[Paper](https://example.test/p?q=a' + separator + 'lang=en)';
    const result = cleanLinkTracking(source);
    assert.equal(result.source, expected, separator);
    assert.deepEqual(hrefs(result.source), ['https://example.test/p?q=a&lang=en'], separator);
  }
});

test('full, collapsed, and shortcut references use the cleaned definition without rewriting labels', () => {
  const source = '[First][paper], [paper][], and [paper].\n\n[paper]: ' + tracked + ' "A paper"\n';
  const expected = '[First][paper], [paper][], and [paper].\n\n[paper]: ' + clean + ' "A paper"\n';
  const result = cleanLinkTracking(source);
  assert.equal(result.source, expected);
  assert.deepEqual(hrefs(result.source), [clean, clean, clean]);
});

test('multiline reference definitions and CRLF source endings are retained', () => {
  const source = '# Notes\r\n\r\n[Read][paper]\r\n\r\n[paper]:\r\n  <https://example.test/p?q=one&amp;utm_source=x&amp;lang=en>\r\n  "Keep this title"\r\n';
  const expected = '# Notes\r\n\r\n[Read][paper]\r\n\r\n[paper]:\r\n  <https://example.test/p?q=one&amp;lang=en>\r\n  "Keep this title"\r\n';
  const result = cleanLinkTracking(source);
  assert.equal(result.source, expected);
  assert.deepEqual(hrefs(result.source), ['https://example.test/p?q=one&lang=en']);
  assert.deepEqual(result.changes.map((change) => change.line), [6]);
});

test('angle autolinks clean real query keys and leave entity-like text literal', () => {
  assert.equal(cleanLinkTracking('<' + tracked + '>').source, '<' + clean + '>');
  const literalEntity = '<https://example.test/p?q=one&amp;utm_source=x>';
  assert.equal(cleanLinkTracking(literalEntity).source, literalEntity);
  const mixed = '<https://example.test/p?q=one&amp;utm_source=x&utm_medium=y#frag>';
  const expected = '<https://example.test/p?q=one&amp;utm_source=x#frag>';
  assert.equal(cleanLinkTracking(mixed).source, expected);
  assert.deepEqual(hrefs(expected), ['https://example.test/p?q=one&amp;utm_source=x#frag']);
});

test('image destinations are cleaned without changing alternate text or titles', () => {
  const source = '![Diagram](https://example.test/figure.png?width=800&utm_source=ai&format=webp "Figure 1")';
  const expected = '![Diagram](https://example.test/figure.png?width=800&format=webp "Figure 1")';
  const result = cleanLinkTracking(source);
  assert.equal(result.source, expected);
  const image = markdown.parse(result.source, {}).flatMap((token) => token.children ?? []).find((token) => token.type === 'image');
  assert.equal(image?.attrGet('src'), 'https://example.test/figure.png?width=800&format=webp');
  assert.equal(image?.attrGet('title'), 'Figure 1');
});

test('links inside lists and blockquotes retain all container prefixes and surrounding prose', () => {
  const source = '- Read [this](' + tracked + ').\n\n> A citation follows:\n> [arxiv.org](' + tracked + ')\n\n1. Another [paper](' + tracked + ').';
  const expected = '- Read [this](' + clean + ').\n\n> A citation follows:\n> [arxiv.org](' + clean + ')\n\n1. Another [paper](' + clean + ').';
  const result = cleanLinkTracking(source);
  assert.equal(result.source, expected);
  assert.deepEqual(hrefs(result.source), [clean, clean, clean]);
});

test('an unmapped table cell cannot redirect a later link edit into protected code', () => {
  const trackedUrl = 'https://example.org/article?utm_source=chatgpt.com';
  const cleanUrl = 'https://example.org/article';
  const protectedRow = '| `[x](' + trackedUrl + ')` \\| extra | [x](' + trackedUrl + ') |';
  const source = [
    '| A | B |',
    '| --- | --- |',
    protectedRow,
    '| Plain | [next](' + trackedUrl + ') |',
    '',
    'After: [paper](' + trackedUrl + ')',
  ].join('\n');
  const expected = [
    '| A | B |',
    '| --- | --- |',
    protectedRow,
    '| Plain | [next](' + cleanUrl + ') |',
    '',
    'After: [paper](' + cleanUrl + ')',
  ].join('\n');
  const result = cleanLinkTracking(source);
  assert.equal(result.source, expected);
  assert.ok(result.issues.some((issue) => issue.line === 3));
  assert.deepEqual(result.changes.map((change) => change.line), [4, 6]);
});

test('code examples, TeX, raw HTML, and interactive demo bodies remain literal', () => {
  const link = '[Paper](' + tracked + ')';
  const code = '\x60' + link + '\x60\n\n\x60\x60\x60markdown\n' + link + '\n\x60\x60\x60\n\n    ' + link + '\n';
  const math = '\n$' + String.raw`\text{` + link + '}$\n\n'
    + String.raw`\(\text{` + link + String.raw`}\)` + '\n\n'
    + '$$\n' + String.raw`\text{` + link + '}\n$$\n\n'
    + String.raw`\[` + '\n' + String.raw`\text{` + link + '}\n' + String.raw`\]` + '\n';
  const html = '\n<div>\n' + link + '\n</div>\n\n<a href="' + tracked + '">Paper</a>\n';
  const demo = '\n\x60\x60\x60interactive title="Example"\n<a href="' + tracked + '">Paper</a>\n\x60\x60\x60\n';
  const protectedSource = code + math + html + demo;
  const source = protectedSource + '\nOutside: ' + link + '\n';
  const expected = protectedSource + '\nOutside: [Paper](' + clean + ')\n';
  assert.equal(cleanLinkTracking(source).source, expected);
});

test('already escaped math delimiters do not expose TeX contents to link rewriting', () => {
  const link = '[Paper](' + tracked + ')';
  for (const protectedSource of [
    String.raw`\\[` + '\n' + String.raw`\text{` + link + '}\n' + String.raw`\\]`,
    String.raw`\\(\text{` + link + String.raw`}\\)`,
  ]) {
    const source = protectedSource + '\n\nOutside: ' + link;
    assert.equal(cleanLinkTracking(source).source, protectedSource + '\n\nOutside: [Paper](' + clean + ')');
  }
});

test('signed URLs are preserved with a review issue only when tracking is present', () => {
  for (const key of [
    'signature', 'SIG', 'hmac', 'X-Amz-Signature', 'X-Goog-Signature', 'AWSAccessKeyId', 'GoogleAccessId',
  ]) {
    const source = '[Private file](https://example.test/file?' + key + '=abc&utm_source=x&expires=123)';
    const result = cleanLinkTracking(source);
    assert.equal(result.source, source, key);
    assert.deepEqual(result.changes, [], key);
    assert.ok(result.issues.length > 0, key);
    const alreadyUntracked = '[Private file](https://example.test/file?' + key + '=abc&expires=123)';
    const noChange = cleanLinkTracking(alreadyUntracked);
    assert.equal(noChange.source, alreadyUntracked);
    assert.deepEqual(noChange.issues, []);
  }
});

test('relative and non-HTTP destinations are preserved', () => {
  const source = '[Local](../paper.md?utm_source=x)\n\n[Email](mailto:author@example.test?subject=Hello&utm_source=x)\n\n[Data](data:text/plain,utm_source=x)';
  const result = cleanLinkTracking(source);
  assert.equal(result.source, source);
  assert.deepEqual(result.changes, []);
});

test('cleaning is idempotent and already clean links do not create changes', () => {
  const source = '[Paper](' + tracked + ')\n\n<https://example.test/?q=a%20b&utm_medium=chat#result>';
  const first = cleanLinkTracking(source);
  const second = cleanLinkTracking(first.source);
  assert.equal(second.source, first.source);
  assert.deepEqual(second.changes, []);
  assert.deepEqual(second.issues, []);
  const plain = '[Paper](' + clean + ')';
  assert.deepEqual(cleanLinkTracking(plain), { source: plain, changes: [], issues: [] });
});
