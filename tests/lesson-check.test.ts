import test from 'node:test';
import assert from 'node:assert/strict';
import { checkLesson, formatLessonReport } from '../src/lib/lesson-check.ts';
import { createLessonProject } from '../src/lib/lesson-project.ts';
import { imageReference } from '../src/lib/image-assets.ts';

test('lesson checks report math failures and missing picture/demo sources with useful source lines', () => {
  const project = createLessonProject();
  const source = '# Lesson\n\n$\\unknowncommand$\n\n![Figure](images/missing.png)\n\n```interactive src="demos/missing.html"\n```';
  const report = checkLesson(source, { project });
  assert.equal(report.slides, 1);
  assert.equal(report.demos, 1);
  assert.ok(report.issues.some((issue) => issue.code === 'math' && issue.line === 3));
  assert.ok(report.issues.some((issue) => issue.code === 'missing-image' && issue.line === 5));
  assert.ok(report.issues.some((issue) => issue.severity === 'error' && issue.line === 7));
  const text = formatLessonReport(report);
  assert.match(text, /line 3/);
  assert.match(text, /retain its projectId and file paths/);
  assert.match(text, /static check, not a test of scientific correctness/);
});

test('literal images, formulas, and interactive examples inside ordinary code are not checked as lesson content', () => {
  const report = checkLesson('# Syntax\n\n````markdown\n![Fake](missing.png)\n$\\unknowncommand$\n```interactive src="missing.html"\n```\n````');
  assert.equal(report.demos, 0);
  assert.deepEqual(report.issues, []);
});

test('existing attached and project-relative images pass while remote images remain a classroom dependency', () => {
  const project = createLessonProject();
  const imageId = '9f73d5e1-09c4-4e7f-9795-81c8d276f743';
  project.imagePaths = [{ imageId, path: 'images/picture.png' }];
  const imageSources = new Map([[imageReference(imageId), 'blob:local-attachment']]);
  const local = checkLesson(`![Attached](${imageReference(imageId)})\n\n![Relative](images/picture.png)`, { project, imageSources });
  assert.deepEqual(local.issues, []);
  const remote = checkLesson('![Remote](https://example.org/image.png)', { allowRemoteImages: true });
  assert.equal(remote.issues.length, 1);
  assert.equal(remote.issues[0].code, 'remote-image');
  assert.equal(remote.issues[0].severity, 'warning');
});

test('a demo dependency check is static and explains changes needed for the sandbox', () => {
  const project = createLessonProject();
  project.files = [{ path: 'demos/explore.html', content: '<link rel="stylesheet" href="style.css"><script src="plot.js"></script><button onclick="alert(1)">Test</button><img src="figure.png"><iframe src="https://example.org"></iframe><script>fetch("data.json");localStorage.setItem("test", "x");</script>' }];
  const report = checkLesson('# Explore\n\n```interactive src="demos/explore.html"\n```', { project });
  const codes = new Set(report.issues.map((issue) => issue.code));
  for (const code of ['demo-linked-code', 'demo-inline-event', 'demo-linked-image', 'demo-embedded-frame', 'demo-network', 'demo-storage']) assert.ok(codes.has(code), code);
  assert.ok(report.issues.every((issue) => issue.severity === 'warning'));
});

test('self-contained inline controls and embedded pictures have no dependency warnings', () => {
  const source = '```interactive title="Test"\n<!-- <script src="comment-only.js"></script> -->\n<img src="data:image/png;base64,aGVsbG8=">\n<button id="b">Test</button>\n<script>document.getElementById("b").addEventListener("click", () => {});</script>\n```';
  assert.deepEqual(checkLesson(source).issues, []);
});

test('built-in settings are validated while a second demo on a slide is only a layout recommendation', () => {
  const valid = checkLesson('## Explore\n\n```interactive wave-packet\n{"sigma":1.2,"momentum":0.5,"time":0,"view":"density"}\n```');
  assert.deepEqual(valid.issues, []);
  for (const body of ['{"sigma":1.23}', '{"sigma":9}', '{"unknown":1}', '{"sigma":"1"}', '[]']) {
    const invalid = checkLesson(`## Explore\n\n\`\`\`interactive wave-packet\n${body}\n\`\`\``);
    assert.equal(invalid.issues.length, 1, body);
    assert.equal(invalid.issues[0].severity, 'error', body);
    assert.equal(invalid.issues[0].code, 'demo', body);
    assert.equal(invalid.issues[0].line, 3, body);
  }
  const crowded = checkLesson('## Two demos\n\n```interactive wave-packet\n```\n\n```interactive bloch-sphere\n```');
  assert.ok(crowded.issues.some((issue) => issue.code === 'demo-layout' && issue.severity === 'warning'));
  assert.ok(crowded.issues.every((issue) => issue.severity !== 'error'));
});

test('preserving separate JavaScript and CSS files does not make linked demo dependencies runnable', () => {
  const project = createLessonProject();
  project.files = [
    { path: 'demos/chart.html', content: '<link rel="stylesheet" href="chart.css"><canvas id="chart"></canvas><script src="chart.js"></script>' },
    { path: 'demos/chart.js', content: 'document.getElementById("chart").getContext("2d");' },
    { path: 'demos/chart.css', content: 'canvas{width:100%}' },
  ];
  const report = checkLesson('# Chart\n\n```interactive src="demos/chart.html"\n```', { project });
  assert.equal(report.issues.length, 1);
  assert.equal(report.issues[0].code, 'demo-linked-code');
  assert.match(report.issues[0].message, /directly inside the HTML file/);
});

test('checks bound oversized sources and excessive diagnostics and explain a clean report', () => {
  assert.equal(checkLesson('x'.repeat(400_001)).issues[0].code, 'source-limit');
  const report = checkLesson(Array.from({ length: 120 }, (_, index) => `![Image ${index}](missing-${index}.png)`).join('\n\n'));
  assert.ok(report.issues.length <= 101);
  assert.equal(report.issues.at(-1)?.code, 'issue-limit');
  assert.match(formatLessonReport(checkLesson('# Lesson\n\nA clear explanation.')), /No structural compatibility issues were found/);
});
