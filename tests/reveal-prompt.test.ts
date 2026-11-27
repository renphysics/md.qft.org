import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateRevealPrompt, REVEAL_PROMPT_VERSION } from '../src/lib/reveal-prompt.ts';

const brief = { topic: 'Quantum interference', audience: 'First-year physics students', language: '中文', duration: 90, mathLevel: 'Complex amplitudes', demos: 'A phase slider' };
const words = (text: string) => text.split(/\s+/).filter(Boolean).length;
const afterBrief = (prompt: string) => prompt.slice(prompt.indexOf('\nFORMAT'));

test('Reveal.js instructions preserve the lesson brief and ask for one offline file', () => {
  const prompt = generateRevealPrompt(brief);
  for (const expected of ['Quantum interference', 'First-year physics students', '中文', '90 minutes', 'Complex amplitudes', 'A phase slider',
    'ONE self-contained file, index.html', 'a ZIP with index.html', 'RevealMath.KaTeX', '<aside class="notes">', 'class="fragment"',
    'addEventListener', 'canvas or inline SVG', 'no web fonts, remote images, iframes', 'build step', 'download it and open it on md.qft.org']) {
    assert.ok(prompt.includes(expected), expected);
  }
});

test('Reveal.js instructions name exact jsDelivr files and nothing else from the internet', () => {
  const prompt = generateRevealPrompt(brief);
  assert.equal(REVEAL_PROMPT_VERSION, '6.0.2');
  const urls = prompt.match(/https?:\/\/\S+/g) ?? [];
  assert.deepEqual(urls, ['reveal.css', 'theme/white.css', 'reveal.js', 'plugin/notes.js', 'plugin/math.js']
    .map((path) => `https://cdn.jsdelivr.net/npm/reveal.js@6.0.2/dist/${path}`));
  assert.match(prompt, /plugins: \[RevealMath\.KaTeX, RevealNotes\]/);
  assert.doesNotMatch(prompt, /reveal\.js@(?:latest|\d+\/)/);
});

test('Reveal.js instructions stay short after the lesson brief', () => {
  const prompt = generateRevealPrompt(brief);
  assert.ok(prompt.indexOf('LESSON BRIEF') < prompt.indexOf('\nFORMAT'));
  assert.ok(words(afterBrief(prompt)) <= 225, `${words(afterBrief(prompt))} words`);
  // The length after the brief does not depend on what the person typed.
  assert.equal(words(afterBrief(generateRevealPrompt({ ...brief, topic: 'x '.repeat(500) }))), words(afterBrief(prompt)));
});

test('Reveal.js instructions bound untrusted form values', () => {
  const prompt = generateRevealPrompt({ topic: 'x'.repeat(10000), audience: '\u0000', language: '', duration: Infinity, mathLevel: '', demos: '\u001b[31m' });
  assert.equal(/[\u0000-\u0008\u000b-\u001f\u007f]/.test(prompt), false);
  assert.equal(prompt.includes('x'.repeat(3001)), false);
  assert.ok(prompt.includes('x'.repeat(3000)));
  assert.ok(prompt.includes('45 minutes'));
  assert.ok(prompt.includes('Undergraduate students'));
  assert.ok(prompt.includes('Language: English'));
  assert.ok(generateRevealPrompt({ ...brief, duration: 2 }).includes('Class duration: 5 minutes'));
  assert.ok(generateRevealPrompt({ ...brief, duration: 1000 }).includes('Class duration: 240 minutes'));
  const wrongTypes = { topic: 42, audience: null, language: undefined, duration: Number.NaN, mathLevel: {}, demos: [] } as unknown as typeof brief;
  assert.ok(generateRevealPrompt(wrongTypes).includes('Topic or chapter: My lesson'));
});

test('Reveal.js instructions warn about Reveal.js class names and a raw "<" in formulas', () => {
  const prompt = generateRevealPrompt(brief);
  for (const name of ['controls', 'progress', 'slides', 'backgrounds', 'slide-number', 'present', 'past', 'future', 'stack']) {
    assert.ok(new RegExp(`\\b${name}\\b`).test(afterBrief(prompt)), name);
  }
  assert.ok(prompt.includes('<div class="demo-controls">'));
  assert.ok(prompt.includes('\\lt') && prompt.includes('\\gt'), 'inside formulas < and > are written \\lt and \\gt');
  assert.match(prompt, /raw < starts an HTML tag/);
});
