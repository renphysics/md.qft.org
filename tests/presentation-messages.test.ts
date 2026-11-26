import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanReportedText, MAX_REPORTED_TEXT, PresentationProblemLog } from '../src/lib/presentation-messages';

test('presentation text becomes one bounded line without hidden control characters', () => {
  assert.equal(cleanReportedText('  Line one\n\tline\u0000two ‮evil‬ '), 'Line one line two evil');
  assert.equal(cleanReportedText(42), '');
  const long = cleanReportedText('x'.repeat(1000));
  assert.equal(long.length, MAX_REPORTED_TEXT);
  assert.ok(long.endsWith('…'));
});

test('the problem log keeps a few distinct problems and counts the rest', () => {
  const log = new PresentationProblemLog(2);
  assert.equal(log.add('presentation', 'First'), true);
  assert.equal(log.add('presentation', 'First'), false, 'repeats are not shown twice');
  assert.equal(log.add('player', 'First'), true, 'the same words from the application are a different message');
  assert.equal(log.add('presentation', 'Third'), false);
  assert.equal(log.add('presentation', ''), false);
  assert.deepEqual(log.problems, [{ origin: 'presentation', text: 'First' }, { origin: 'player', text: 'First' }]);
  assert.equal(log.hidden, 2);
  log.clear();
  assert.equal(log.size, 0);
  assert.equal(log.hidden, 0);
  log.add('presentation', '   ');
  assert.equal(log.problems[0].text, 'An error without a description.');
});
