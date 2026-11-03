import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanupOptions, reviewCleanup, cleanupDiff } from '../src/lib/cleanup-review.ts';
import { DOCUMENT_TOOLS_LIMIT } from '../src/lib/document-tools.ts';

const metric = String.raw`\[
ds_{\mathrm{ind}}^2
=
-\sin^2\theta_0\,dt^2
+4L^2\sin^2\theta_0\,d\Omega_5^2.
\]`;

test('cleanup distinguishes no matching checks from deselected changes', () => {
  const ready = reviewCleanup('# A note\n\nPlain text.', 'markdown', []);
  assert.equal(ready.changed, false);
  assert.match(ready.status, /No basic formatting changes found/);
  assert.doesNotMatch(ready.status, /already ready/);
  const deselected = reviewCleanup('## A note\n', 'markdown', []);
  assert.equal(deselected.changed, false);
  assert.match(deselected.status, /Select a change/);
});

test('General Markdown leaves mathematical source intact while HackMD provides a relevant option', () => {
  assert.equal(reviewCleanup(metric, 'markdown', []).source, metric);
  const options = cleanupOptions(metric, 'hackmd');
  assert.ok(options.some(({ id }) => id === 'hackmd-format'));
  const review = reviewCleanup(metric, 'hackmd', ['hackmd-format']);
  assert.ok(review.changed);
  assert.ok(review.changes.length > 0);
  assert.match(review.source, /\$\$/);
  assert.doesNotMatch(review.source, /^=\s*$/m);
});

test('math inside an enclosing AI Markdown fence is converted after the chosen unwrap', () => {
  const original = '```markdown\n' + metric + '\n```';
  const ids = cleanupOptions(original, 'hackmd').map(({ id }) => id);
  assert.ok(ids.includes('unwrap-fence'));
  assert.ok(ids.includes('hackmd-format'));
  const converted = reviewCleanup(original, 'hackmd', ids);
  assert.ok(converted.changed);
  assert.doesNotMatch(converted.source, /```/);
  assert.doesNotMatch(converted.source, /^=\s*$/m);
  const unchanged = reviewCleanup(original, 'hackmd', ['hackmd-format']);
  assert.equal(unchanged.source, original, 'an unchecked wrapper operation must not silently change a code block');
  assert.match(unchanged.status, /selected changes do not alter/);
});

test('existing escaped working source is preserved and has a review note', () => {
  const source = String.raw`\\[
ds_{\mathrm{ind}}^2
\\=
-\sin^2\theta_0\,dt^2
+4L^2\sin^2\theta_0\,d\Omega_5^2.
\\]`;
  const review = reviewCleanup(source, 'hackmd', ['hackmd-format']);
  assert.equal(review.source, source);
  assert.ok(review.issues.length > 0);
  assert.match(review.status, /review/i);
});

test('oversized input has a precise limit message and remains available to copy', () => {
  const source = 'x'.repeat(DOCUMENT_TOOLS_LIMIT + 1);
  const review = reviewCleanup(source, 'hackmd', ['hackmd-format']);
  assert.equal(review.limited, true);
  assert.equal(review.changed, false);
  assert.equal(review.source, source);
  assert.match(review.status, /400,000-character cleanup limit/);
  assert.deepEqual(cleanupOptions(source, 'hackmd'), []);
});

test('source preview highlights insertions/removals while leaving nearby unchanged lines clear', () => {
  const diff = cleanupDiff('```md\n# Title\n\nText\n```', '# Title\n\nText');
  assert.equal(diff.truncated, false);
  assert.deepEqual(diff.before.filter(({ changed }) => changed).map(({ text }) => text), ['```md', '```']);
  assert.ok(diff.after.every(({ changed }) => !changed));
  const changed = cleanupDiff('# Title\n\nx =\n1\n\nEnd', '# Title\n\nx = 1\n\nEnd');
  assert.deepEqual(changed.after.filter(({ changed }) => changed).map(({ text }) => text), ['x = 1']);
});

test('bounded previews cannot truncate the actual cleanup result', () => {
  const source = '# Title\n\n' + 'Paragraph\n'.repeat(4_000) + 'Last line';
  const review = reviewCleanup(source, 'markdown', []);
  const diff = cleanupDiff(source, review.source);
  assert.equal(diff.truncated, true);
  assert.ok(diff.after.length <= 1_000);
  assert.ok(review.source.endsWith('Last line'));
  assert.equal(review.source, source);
});
