import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findInteractiveFences, interactiveFence, replaceInteractiveFence } from '../src/lib/interactive-demos';
import { renderMarkdown } from '../src/lib/render-markdown';
import { renderSlides } from '../src/lib/slides';
import type { LessonProject } from '../src/lib/lesson-project';

const project: LessonProject = {
  version: 2, id: 'sample-lesson', document: 'lecture/slides.md',
  files: [{ path: 'demos/oscillator.html', content: '<button id="go">Start</button><script>document.getElementById("go").addEventListener("click",()=>{});</script>' }],
  imagePaths: [{ imageId: '6c82b849-6264-4676-9db4-ef5fb8a79b72', path: 'images/diagram.png' }],
};

function payload(html: string): { html: string; title: string; preset?: string } {
  const text = html.match(/<template data-demo-source>([\s\S]*?)<\/template>/)?.[1];
  assert.ok(text);
  return JSON.parse(text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&'));
}

describe('lesson demo source files', () => {
  it('resolves a separate HTML file relative to the main Markdown, while keeping the outer page inert', () => {
    const source = interactiveFence({ src: '../demos/oscillator.html', title: 'An oscillator' });
    const result = renderSlides(source, { project, editableDemos: true });
    assert.deepEqual(result.errors, []);
    assert.equal(payload(result.html).html, project.files[0].content);
    assert.equal(payload(result.html).title, 'An oscillator');
    assert.doesNotMatch(result.html, /<script\b|<iframe\b|<button id="go"/);
    assert.match(result.html, /data-demo-edit/);
    assert.doesNotMatch(renderSlides(source, { project }).html, /data-demo-edit/);
  });

  it('does not resolve external URLs, escaped paths, missing files, or a non-HTML file', () => {
    for (const src of ['https://example.org/demo.html', '//example.org/demo.html', '../../outside.html', '../missing.html', '../config.json', '..\\demos\\oscillator.html']) {
      const result = renderMarkdown(interactiveFence({ src }), { project });
      assert.equal(result.errors.length, 1, src);
      assert.doesNotMatch(result.html, /data-demo-source>|data-demo-run/);
    }
    assert.match(renderMarkdown(interactiveFence({ src: '../demos/oscillator.html' })).errors[0].message, /Import the lesson ZIP/);
  });

  it('retains invalid demo files for editing but never emits an oversized or empty runnable payload', () => {
    for (const content of ['', 'x'.repeat(100_001)]) {
      const result = renderSlides(interactiveFence({ src: '../demos/oscillator.html' }), {
        project: { ...project, files: [{ ...project.files[0], content }] }, editableDemos: true,
      });
      assert.equal(result.errors.length, 1);
      assert.match(result.html, /data-demo-edit/);
      assert.doesNotMatch(result.html, /<template/);
    }
  });

  it('accepts options in either order, with quoted escaping, and rejects ambiguous inputs', () => {
    const result = renderMarkdown('```interactive title="A \\"quoted\\" demo" src="../demos/oscillator.html"\n```', { project });
    assert.deepEqual(result.errors, []);
    assert.equal(payload(result.html).title, 'A "quoted" demo');
    for (const source of [
      '```interactive src="../demos/oscillator.html"\n<script>extra()</script>\n```',
      '```interactive wave-packet src="../demos/oscillator.html"\n```',
      '```interactive title="A" title="B"\n<p>test</p>\n```',
    ]) assert.equal(renderMarkdown(source, { project }).errors.length, 1);
  });

  it('renders a typed project-relative image and retains the internal reference for portable exports', () => {
    const ref = 'qft-image:' + project.imagePaths[0].imageId;
    const result = renderMarkdown('![Diagram](../images/diagram.png)', {
      project, imageSources: new Map([[ref, 'blob:https://md.qft.org/diagram']]),
    });
    assert.match(result.html, /<img src="blob:https:\/\/md.qft.org\/diagram"/);
    assert.ok(result.html.includes(`data-qft-image="${ref}"`));
    assert.doesNotMatch(renderMarkdown('![Diagram](../../images/diagram.png)', { project }).html, /<img\b/);
  });
});

describe('editing an existing demo', () => {
  it('finds actual fences and gives repeated demos distinct keys matching both rendered views', () => {
    const fence = interactiveFence({ preset: 'wave-packet' });
    const source = '# Example\r\n\r\n````markdown\r\n' + fence.replace(/\n/g, '\r\n') + '````\r\n\r\n'
      + fence.replace(/\n/g, '\r\n') + '\r\n---\r\n\r\n' + fence.replace(/\n/g, '\r\n');
    const found = findInteractiveFences(source);
    assert.equal(found.length, 2);
    assert.notEqual(found[0].sourceKey, found[1].sourceKey);
    for (const entry of found) assert.match(source.slice(entry.from, entry.to), /^```interactive wave-packet/);
    for (const result of [renderMarkdown(source, { editableDemos: true }), renderSlides(source, { editableDemos: true })]) {
      const keys = [...result.html.matchAll(/data-demo-source-key="([^"]+)"/g)].map(match => match[1]);
      assert.deepEqual(keys, found.map(entry => entry.sourceKey));
    }
    const updated = replaceInteractiveFence(source, found[1], interactiveFence({ preset: 'wave-packet', settings: { time: 2 } }));
    const after = findInteractiveFences(updated);
    assert.equal(after[0].settings?.time, 0);
    assert.equal(after[1].settings?.time, 2);
    assert.match(updated, /````markdown/);
  });

  it('preserves nested Markdown prefixes and protects against stale editor writes', () => {
    for (const prefix of ['> ', '- ', '  ']) {
      const continuation = prefix === '- ' ? '  ' : prefix;
      const source = prefix + '```interactive bloch-sphere\n' + continuation + '```\n';
      const found = findInteractiveFences(source);
      assert.equal(found.length, 1);
      const updated = replaceInteractiveFence(source, found[0], interactiveFence({ preset: 'bloch-sphere', settings: { theta: 90 } }));
      assert.equal(findInteractiveFences(updated)[0].settings?.theta, 90);
      assert.ok(updated.startsWith(prefix));
      assert.deepEqual(renderMarkdown(updated).errors, []);
      assert.throws(() => replaceInteractiveFence('# A new heading\n' + source, found[0], interactiveFence({ preset: 'bloch-sphere' })), /changed while/);
    }
  });

  it('edits a shared footnote demo once without repeating its definition marker', () => {
    const source = 'First[^demo]\n\n---\n\nSecond[^demo]\n\n[^demo]: ```interactive bloch-sphere\n    ```\n';
    const found = findInteractiveFences(source);
    assert.equal(found.length, 1);
    assert.equal((renderSlides(source).html.match(/data-demo-source-key=/g) ?? []).length, 2);
    const after = replaceInteractiveFence(source, found[0], interactiveFence({ preset: 'bloch-sphere', settings: { theta: 180 } }));
    assert.equal((after.match(/\[\^demo\]:/g) ?? []).length, 1);
    assert.equal(findInteractiveFences(after)[0].settings?.theta, 180);
    const result = renderSlides(after);
    assert.deepEqual(result.errors, []);
    assert.equal((result.html.match(/P\(0\) = 0\.000/g) ?? []).length, 2);
  });

  it('exposes malformed settings for repair and retains an Edit action on the error card', () => {
    const source = '```interactive wave-packet\n{"time":999}\n```';
    const entry = findInteractiveFences(source)[0];
    assert.equal(entry.preset, 'wave-packet');
    assert.match(entry.error!, /between 0 and 6/);
    const result = renderMarkdown(source, { editableDemos: true });
    assert.ok(result.html.includes(`data-demo-source-key="${entry.sourceKey}"`));
    assert.match(result.html, /data-demo-edit/);
  });

  it('serializes a configured preset without letting a quoted title close the fence', () => {
    const source = interactiveFence({ preset: 'bloch-sphere', title: 'State "A" ```', settings: { theta: 90, phi: 180 } });
    const entry = findInteractiveFences(source)[0];
    assert.deepEqual(entry.settings, { theta: 90, phi: 180 });
    assert.equal(entry.title, 'State "A" ```');
    const result = renderMarkdown(source);
    assert.deepEqual(result.errors, []);
    assert.match(payload(result.html).html, /id="theta"[^>]*value="90"/);
    assert.equal(payload(result.html).title, 'State "A" ```');
  });
});
