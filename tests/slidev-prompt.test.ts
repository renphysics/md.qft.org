import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateSlidevPrompt } from '../src/lib/slidev-prompt.ts';

const brief = { topic: 'Quantum interference', audience: 'First-year physics students', language: '中文', duration: 90, mathLevel: 'Complex amplitudes', demos: 'A phase slider' };

test('Slidev instructions preserve the lesson brief and ask for an ordinary project with its built dist folder', () => {
  const prompt = generateSlidevPrompt(brief);
  for (const expected of ['Quantum interference', 'First-year physics students', '中文', '90 minutes', 'Complex amplitudes', 'A phase slider',
    'ordinary Slidev project', 'slides.md', 'components/', 'public/', "fonts: { provider: 'none' }", 'No {monaco} code blocks and no Web Workers',
    'no CDN files, web fonts, remote pictures, remote APIs', 'Node.js 22.22 or newer', 'npx slidev build',
    'ONE ZIP of the project folder with the built dist/ folder inside and without node_modules', 'If you cannot run commands, say so plainly',
    'the exact commands']) {
    assert.ok(prompt.includes(expected), expected);
  }
});

test('Slidev instructions no longer forbid an ordinary build or require the packaging tool', () => {
  const prompt = generateSlidevPrompt(brief);
  assert.doesNotMatch(prompt, /Do not send only slides\.md or an ordinary dist ZIP/);
  assert.doesNotMatch(prompt, /routerMode: memory|compatibility adapter|qft-presentation\.json/);
  // The packager is mentioned once, as optional.
  assert.equal(prompt.match(/pack\.mjs/g)?.length, 1);
  assert.match(prompt, /Optional: [^\n]*pack\.mjs[^\n]*an ordinary build is enough/);
  // Nothing a coding assistant cannot do: it is not asked to open md.qft.org itself.
  assert.doesNotMatch(prompt, /Open the packaged presentation in md\.qft\.org|network access disabled/);
  assert.doesNotMatch(prompt, /Codex/);
});

test('Slidev instructions stay short', () => {
  const words = generateSlidevPrompt({ topic: '', audience: '', language: '', duration: 45, mathLevel: '', demos: '' }).split(/\s+/).length;
  assert.ok(words < 400, `${words} words`);
});

test('Slidev instructions bound untrusted form values', () => {
  const prompt = generateSlidevPrompt({ topic: 'x'.repeat(10000), audience: '\u0000', language: '', duration: Infinity, mathLevel: '', demos: '' });
  assert.equal(prompt.includes('\u0000'), false);
  assert.equal(prompt.includes('x'.repeat(3001)), false);
  assert.ok(prompt.includes('45 minutes'));
  assert.ok(prompt.includes('Undergraduate students'));
  assert.ok(prompt.includes('Changing the source alone does not change what plays'));
});
