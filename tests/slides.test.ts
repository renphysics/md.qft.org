import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSlides, normalizeSlideSettings, slideDimensions } from '../src/lib/slides.ts';
import { renderMarkdown, MAX_SLIDE_COUNT } from '../src/lib/render-markdown.ts';

test('slide separators preserve source locations and document rules stay horizontal rules', () => {
  const source = '# First\n\nText.\n\n---\n\n# Second\n\nMore text.\n\n---\n\n# Third';
  const result = renderSlides(source);
  assert.equal(result.slides.length, 3);
  assert.deepEqual(result.slides.map(({ startLine, endLine }) => [startLine, endLine]), [[0, 4], [5, 10], [11, 13]]);
  assert.match(result.slides[1].html, /Second/);
  assert.doesNotMatch(result.html, /<hr\b/);
  assert.equal((renderMarkdown(source).html.match(/<hr\b/g) ?? []).length, 2);
  assert.equal((result.html.match(/class="qft-slide-content"/g) ?? []).length, 3);
});

test('code, math, quoted rules, table alignment, and non-slide horizontal rules cannot create slides', () => {
  const source = String.raw`# First

\(a\) and $b$.

~~~markdown
---
~~~

$$
c = 1
---
$$

\[
d = 1
---
\]

> ---

| A | B |
| --- | --- |
| x | y |

***

- - -

----

---

# Second`;
  const result = renderSlides(source);
  assert.equal(result.slides.length, 2);
  assert.equal(result.mathCount, 4);
  assert.match(result.slides[0].html, /<code class="language-markdown">---/);
  assert.match(result.slides[0].html, /<blockquote/);
  assert.match(result.slides[0].html, /<table/);
  assert.equal((result.slides[0].html.match(/<hr\b/g) ?? []).length, 4);
});

test('frontmatter is excluded without shifting math diagnostics or slide source anchors', () => {
  const source = '---\r\nmarp: true\r\ntheme: default\r\n---\r\n\r\n# First\r\n\r\n---\r\n\r\n$\\unknown$';
  const result = renderSlides(source);
  assert.equal(result.slides.length, 2);
  assert.doesNotMatch(result.html, /marp:|theme: default/);
  assert.equal(result.headings[0].line, 6);
  assert.equal(result.errors[0].line, 10);
  assert.equal(result.slides[1].startLine, 8);
});

test('all four math delimiters and macros work across slides without leaking between decks', () => {
  const source = String.raw`# Definitions

$\gdef\decktest{\mathbb{R}}$

---

# Inline

$\decktest$ and \(x\in\decktest\).

---

# Display

$$f:\decktest\to\decktest$$

\[g:\decktest\to\decktest\]`;
  const result = renderSlides(source);
  assert.equal(result.slides.length, 3);
  assert.equal(result.mathCount, 5);
  assert.deepEqual(result.errors, []);
  assert.match(result.slides[2].html, /<math/);
  assert.equal(renderSlides(String.raw`$\decktest$`).errors.length, 1);
});

test('headings and slide-local footnotes have unique IDs and valid references throughout a deck', () => {
  const result = renderSlides('# Same\n\nFirst[^a] and again[^a].\n\n---\n\n# Same\n\nSecond[^a] and another[^b]. [Back](#same).\n\n[^a]: A shared note.\n\n[^b]: A second note.');
  assert.equal(result.slides.length, 2);
  const ids = [...result.html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(ids.length, new Set(ids).size);
  const targets = [...result.html.matchAll(/\bhref="#([^"]+)"/g)].map((match) => match[1]);
  for (const target of targets) assert.ok(ids.includes(target), `Missing ${target}`);
  assert.match(result.slides[0].html, /A shared note/);
  assert.match(result.slides[1].html, /A shared note/);
  assert.match(result.slides[1].html, /A second note/);
  assert.doesNotMatch(result.slides[0].html, /A second note/);
  assert.match(result.slides[1].html, /href="#qft-slide-h-same"/);
  const documentIds = [...renderMarkdown('# Same\n\nText[^a].\n\n[^a]: Note.').html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(documentIds.some((id) => ids.includes(id)), false);
});

test('reference-style links and attached images resolve across slide boundaries', () => {
  const source = '# First\n\n![Figure][figure]\n\n---\n\n[Read][article]\n\n[figure]: qft-image:figure-one\n[article]: https://example.org/paper';
  const result = renderSlides(source, { imageSources: new Map([['qft-image:figure-one', 'blob:https://md.qft.org/one']]) });
  assert.equal(result.slides.length, 2);
  assert.match(result.slides[0].html, /src="blob:https:\/\/md.qft.org\/one"/);
  assert.match(result.slides[1].html, /href="https:\/\/example.org\/paper"/);
});

test('task-list labels stay associated and IDs are unique across views and repeated footnotes', () => {
  const source = '- [x] Main task\n\nOne[^a]\n\n---\n\nTwo[^a]\n\n[^a]: Tasks\n\n    - [ ] Shared task';
  const doc = renderMarkdown(source);
  const deck = renderSlides(source);
  const combined = doc.html + deck.html;
  const ids = [...combined.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(ids.length, new Set(ids).size);
  const labels = [...combined.matchAll(/\bfor="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(labels.length, 5);
  for (const target of labels) assert.ok(ids.includes(target), `Missing input for ${target}`);
  assert.match(doc.html, /id="qft-task-0"/);
  assert.match(deck.slides[0].html, /for="qft-s1-task-1"/);
  assert.match(deck.slides[1].html, /for="qft-s2-task-1"/);
  assert.match(renderMarkdown('`id="task-item-0"`').html, /id=&quot;task-item-0&quot;/);
});

test('repeated footnote demos have stable independent snapshot identities on every slide', () => {
  const source = 'First.[^demo]\n\n---\n\nSecond.[^demo]\n\n[^demo]: A demonstration.\n\n    ```interactive wave-packet\n    ```';
  const ids = (html: string) => [...html.matchAll(/data-demo-id="([^"]+)"/g)].map((match) => match[1]);
  const deck = renderSlides(source);
  assert.deepEqual(deck.errors, []);
  const instances = deck.slides.flatMap((slide) => ids(slide.html));
  assert.equal(instances.length, 2);
  assert.equal(new Set(instances).size, 2, 'independent frames must not overwrite each other’s snapshot');
  assert.match(instances[0], /-s1$/);
  assert.match(instances[1], /-s2$/);
  assert.deepEqual(ids(deck.html), instances, 'preview and per-slide print fragments must use the same keys');
  assert.deepEqual(ids(renderSlides(source).html), instances, 're-rendering for export must preserve snapshot keys');
  assert.equal(ids(renderMarkdown(source).html).some((id) => instances.includes(id)), false);
  assert.match(renderSlides('`data-demo-id="demo-example-1"`').html, /data-demo-id=&quot;demo-example-1&quot;/);
});

test('attachments only render through a trusted map and preserve the image safety boundary', () => {
  const source = '![Local](qft-image:one)\n\n![Raw blob](blob:https://md.qft.org/two)\n\n![Remote](https://example.org/three.png)';
  const unresolved = renderMarkdown(source);
  assert.doesNotMatch(unresolved.html, /<img\b/);
  assert.match(unresolved.html, /Image unavailable/);
  const resolved = renderSlides(source, { imageSources: new Map([
    ['qft-image:one', 'data:image/png;base64,aGVsbG8='],
    ['blob:https://md.qft.org/two', 'data:image/png;base64,aGVsbG8='],
  ]) });
  assert.equal((resolved.html.match(/<img\b/g) ?? []).length, 1);
  assert.match(resolved.html, /data-qft-image="qft-image:one"/);
  const invalid = renderSlides('![Bad](qft-image:one)', { imageSources: new Map([['qft-image:one', 'javascript:alert(1)']]) });
  assert.doesNotMatch(invalid.html, /<img\b/);
});

test('slides retain the document renderer protections for untrusted Markdown', () => {
  const result = renderSlides('<script>alert(1)</script>\n\n---\n\n<img src=x onerror=alert(1)>\n\n[Run](javascript:alert%281%29)');
  assert.equal(result.slides.length, 2);
  assert.doesNotMatch(result.html, /<script|<img|href="javascript:/i);
  assert.match(result.html, /&lt;script&gt;/);
});

test('empty and intentionally blank slides have a readable placeholder', () => {
  const empty = renderSlides('');
  assert.equal(empty.slides.length, 1);
  assert.match(empty.html, /Your next idea starts here/);
  const blank = renderSlides('# First\n\n---\n\n---\n\n# Third');
  assert.equal(blank.slides.length, 3);
  assert.match(blank.slides[1].html, /qft-slide-empty/);
});

test('slide preview bounds prevent excessive slide trees without discarding Markdown', () => {
  const source = Array.from({ length: MAX_SLIDE_COUNT + 1 }, (_, i) => `# ${i}`).join('\n\n---\n\n');
  const result = renderSlides(source);
  assert.equal(result.slides.length, 0);
  assert.equal(result.html, '');
  assert.match(result.errors[0].message, /200-slide/);
  assert.ok(source.endsWith(`# ${MAX_SLIDE_COUNT}`));
});

test('slide settings normalize unknown input and preserve exact aspect ratios', () => {
  assert.deepEqual(normalizeSlideSettings({ theme: '<style>', ratio: 'wide' }), { theme: 'paper', ratio: '16:9' });
  assert.deepEqual(normalizeSlideSettings({ theme: 'midnight', ratio: '4:3' }), { theme: 'midnight', ratio: '4:3' });
  assert.deepEqual(slideDimensions(), { width: 1280, height: 720 });
  assert.deepEqual(slideDimensions({ ratio: '4:3' }), { width: 1280, height: 960 });
});
