import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanReportedText, linkParts, MAX_REPORTED_TEXT, PresentationProblemLog, visiblePath } from '../src/lib/presentation-messages';

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

test('file paths on screen show invisible and reordering characters, and keep everything else', () => {
  assert.equal(visiblePath('evil\u202egnp.js'), 'evil\ufffdgnp.js');
  assert.equal(visiblePath('a\u200bb\u2066c\u2069\ufeffd\u2028e\u0007f'), 'a\ufffdb\ufffdc\ufffd\ufffdd\ufffde\ufffdf');
  assert.equal(visiblePath('Schrödinger/图片 1.png'), 'Schrödinger/图片 1.png');
});

test('a link address on screen: the host as parsed, the path decoded only when that is safe, shortened without a full stop', () => {
  const parts = (href: string) => linkParts(new URL(href));
  assert.deepEqual(parts('https://phet.colorado.edu/'), { host: 'phet.colorado.edu', rest: '', shortened: false });
  assert.deepEqual(parts('https://en.wikipedia.org/wiki/Newton%27s_laws_of_motion'), { host: 'en.wikipedia.org', rest: "/wiki/Newton's_laws_of_motion", shortened: false });
  assert.equal(parts('https://de.wikipedia.org/wiki/Schr%C3%B6dinger?x=%C3%B6#a').rest, '/wiki/Schrödinger?x=%C3%B6#a', 'only the path is decoded');
  assert.equal(parts('https://bücher.example:8080/a').host, 'xn--bcher-kva.example', 'punycode, as the parser gives it');
  assert.equal(parts('https://example.org:8080/a').rest, ':8080/a');
  // Spaces, invisible, reordering, private-use, unassigned and malformed: kept encoded.
  for (const path of ['/a%20b', '/a%E2%80%AEb', '/a%E2%80%8Bb', '/a%EE%80%80b', '/a%CD%B8b', '/a%E2%80%A8b', '/a%C3', '/a%ED%A0%80b']) {
    assert.equal(parts(`https://example.org${path}`).rest, path, path);
  }
  assert.equal(parts('https://example.org/a%2Fb%3Fc%23d').rest, '/a%2Fb%3Fc%23d', 'reserved characters stay encoded');
  const long = linkParts(new URL(`https://example.org/${'é'.repeat(80)}`));
  assert.equal(long.shortened, true);
  assert.equal(Array.from(long.rest).length, 60);
  assert.ok(long.rest.endsWith('…'));
  const emoji = linkParts(new URL(`https://example.org/${'😀'.repeat(80)}`), 10);
  assert.equal(emoji.rest, `/${'😀'.repeat(8)}…`, 'never splits a character');
});
