import test from 'node:test';
import assert from 'node:assert/strict';
import { checkLesson, findRevealSyntaxLine, formatLessonReport } from '../src/lib/lesson-check.ts';
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

test('slides written for Slidev are named as such, with what plays instead, and no longer pass as a lesson', () => {
  const slidev = '---\ntheme: seriph\ntitle: Photosynthesis\nlayout: cover\ntransition: slide-left\n---\n\n# Photosynthesis\n\n<v-click>\n\n- Light reactions\n\n</v-click>\n\n---\nlayout: two-cols\n---\n\n# Calvin cycle\n\n::right::\n\n<Tweet id="20" />\n';
  const report = checkLesson(slidev);
  const found = report.issues.filter((issue) => issue.code === 'slidev-source');
  assert.equal(found.length, 1);
  assert.equal(found[0].severity, 'warning');
  assert.equal(found[0].line, 1);
  assert.match(found[0].message, /looks like the source of a Slidev presentation/);
  assert.match(found[0].message, /npx slidev build/);
  assert.match(found[0].message, /dist\/ inside/);
  const text = formatLessonReport(report);
  assert.match(text, /1 warning/);
  assert.match(text, /WARNING \[slidev-source\] line 1: This looks like the source of a Slidev presentation\./);
  assert.equal(report.issues.some((issue) => issue.code === 'reveal-syntax'), false);
});

test('Reveal.js conventions in Markdown are named at their first line, and not when a lesson only shows them as code', () => {
  const markdown = '# Waves\n\n<!-- .slide: data-background="#000" -->\n\n- First <!-- .element: class="fragment" -->\n- Second <!-- .element: class="fragment" -->\n\n---\n\n## End\n';
  const found = checkLesson(markdown).issues.filter((issue) => issue.code === 'reveal-syntax');
  assert.equal(found.length, 1, 'one line for the whole document');
  assert.equal(found[0].severity, 'warning');
  assert.equal(found[0].line, 3);
  assert.match(found[0].message, /Reveal\.js conventions/);
  assert.match(found[0].message, /ask your AI assistant for the complete presentation as one HTML file or a ZIP, and open that file here\.$/);

  const sections = '<section>\n<h2>Slide one</h2>\n<p class="fragment">Appears later</p>\n</section>\n<section data-markdown>\n## Slide two\n</section>\n';
  assert.equal(checkLesson(sections).issues.find((issue) => issue.code === 'reveal-syntax')?.line, 1);
  assert.equal(checkLesson('# Setup\n\nText.\n\n<script>Reveal.initialize({ hash: true });</script>\n').issues.find((issue) => issue.code === 'reveal-syntax')?.line, 5);
  assert.equal(checkLesson('# Slide\n\n<p class="big fragment fade-up">Later</p>\n').issues.some((issue) => issue.code === 'reveal-syntax'), true);

  const shown = '# How Reveal.js writes slides\n\n```html\n<section data-background="#000">\n  <p class="fragment">Later</p>\n</section>\n<script>Reveal.initialize();</script>\n```\n\nThe tag `<section>` holds one slide, and `<!-- .slide: data-background="#000" -->` sets its background.\n\n    <section data-markdown>\n';
  assert.deepEqual(checkLesson(shown).issues, []);
  const slidevShown = '# How Slidev writes slides\n\n```md\n---\ntheme: seriph\nlayout: cover\ntransition: slide-left\nmdc: true\n---\n\n<v-click>\n\n::right::\n```\n';
  assert.deepEqual(checkLesson(slidevShown).issues, []);
});

test('the examples of this site and an ordinary lesson get neither line', async () => {
  const { EXAMPLES } = await import('../src/lib/examples.ts');
  assert.ok(EXAMPLES.length > 3);
  for (const example of EXAMPLES) {
    const codes = checkLesson(example.source).issues.map((issue) => issue.code);
    assert.equal(codes.includes('slidev-source') || codes.includes('reveal-syntax'), false, example.id);
  }
  const lesson = '# Pendulum\n\nPredict the period, then measure it.\n\n---\n\n## The section on energy\n\nA fragment of the argument: $T = 2\\pi\\sqrt{L/g}$.\n\nThe data-background of this experiment is in the appendix.\n';
  assert.deepEqual(checkLesson(lesson).issues, []);
});

test('the scan for Reveal.js conventions stays fast on one very long awkward line', () => {
  const awkward = ['<section'.repeat(48_000), '<a data-x '.repeat(39_000), ('<a ' + 'x'.repeat(299)).repeat(1300), '`'.repeat(390_000),
    ('class="' + 'f'.repeat(199)).repeat(1900), 'Reveal '.repeat(55_000), '<!--  .'.repeat(55_000)];
  for (const line of awkward) assert.ok(line.length > 380_000);
  const started = performance.now();
  assert.equal(findRevealSyntaxLine(awkward), -1);
  assert.ok(performance.now() - started < 1500, `took ${Math.round(performance.now() - started)} ms`);
  assert.equal(findRevealSyntaxLine(['text', '<a data-x ' .repeat(1000) + '<section>']), 1);
});

