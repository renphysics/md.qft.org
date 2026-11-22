import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateSlidevPrompt } from '../src/lib/slidev-prompt.ts';

test('Slidev instructions preserve the lesson brief and require a playable build plus source', () => {
  const prompt = generateSlidevPrompt({ topic: 'Quantum interference', audience: 'First-year physics students', language: '中文', duration: 90, mathLevel: 'Complex amplitudes', demos: 'A phase slider' });
  for (const expected of ['Quantum interference', 'First-year physics students', '中文', '90 minutes', 'Complex amplitudes', 'A phase slider', 'npm ci', 'pack.mjs', 'qft-presentation.json', 'presentation.html', 'source/', 'network access disabled', 'not been compiled']) assert.ok(prompt.includes(expected), expected);
});

test('Slidev instructions bound untrusted form values and never promise a browser build', () => {
  const prompt = generateSlidevPrompt({ topic: 'x'.repeat(10000), audience: '\u0000', language: '', duration: Infinity, mathLevel: '', demos: '' });
  assert.equal(prompt.includes('\u0000'), false);
  assert.equal(prompt.includes('x'.repeat(3001)), false);
  assert.ok(prompt.includes('45 minutes'));
  assert.ok(prompt.includes('Undergraduate students'));
  assert.ok(prompt.includes('changing the source alone does not update playback'));
});
