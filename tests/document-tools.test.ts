import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCleanup, getCleanupSuggestions, getDocumentSections, moveDocumentSection,
  suggestDocumentTitle, appendDocumentSection, DOCUMENT_TOOLS_LIMIT,
} from '../src/lib/document-tools.ts';

test('cleanup removes only an enclosing explicit Markdown fence and preserves original CRLF content', () => {
  const body = '## A note\r\n\r\n$x \\ne y$\r\n\r\n```python\r\nprint("# literal")\r\n```\r\n';
  const source = '````markdown\r\n' + body + '````\r\n';
  assert.equal(applyCleanup(source, ['unwrap-fence']), body);
  assert.ok(getCleanupSuggestions(source).some((suggestion) => suggestion.id === 'unwrap-fence'));
  for (const source of ['```python\n# A note\n```', '```\n# A note\n```', '```md\n# Unclosed', 'Before\n\n```md\n# A note\n```', '```md\n# A\n```\n\nAfter']) {
    assert.equal(applyCleanup(source, ['unwrap-fence']), source);
  }
});

test('cleanup selection is explicit and heading promotion preserves protected blocks and punctuation', () => {
  const source = '## **A title**\n\n### Part\n\n> ## Quoted\n\n- Item\n\n  ### In a list\n\n```md\n## In code\n```\n\n    ## Indented code\n\n$$\n# In mathematics\n$$\n\nA footnote.[^a]\n\n[^a]: Definition\n    ## In a footnote\n';
  assert.equal(applyCleanup(source, []), source);
  assert.equal(applyCleanup(source, ['unknown']), source);
  const cleaned = applyCleanup(source, ['heading-levels']);
  assert.equal(cleaned, source.replace('## **A title**', '# **A title**').replace('### Part', '## Part'));
});

test('heading cleanup supports setext headings and keeps CRLF', () => {
  const source = 'A title\r\n-------\r\n\r\n### Part\r\n\r\nText.\r\n';
  assert.equal(applyCleanup(source, ['heading-levels']), 'A title\r\n=======\r\n\r\n## Part\r\n\r\nText.\r\n');
  assert.equal(applyCleanup('# Title\n\n### Deep\n', ['heading-levels']), '# Title\n\n### Deep\n');
});

test('outer whitespace cleanup preserves internal blank lines, hard breaks, and the content newline', () => {
  const source = '\r\n \r\n# Title\r\n\r\nLine with a hard break.  \r\nNext line.\r\n\r\n\t\r\n';
  assert.equal(applyCleanup(source, ['outer-blank-lines']), '# Title\r\n\r\nLine with a hard break.  \r\nNext line.\r\n');
  assert.equal(applyCleanup('# Title\n', ['outer-blank-lines']), '# Title\n');
  assert.equal(applyCleanup('# Title', ['outer-blank-lines']), '# Title');
  assert.equal(applyCleanup('\u00a0\n# Title\n', ['outer-blank-lines']), '\u00a0\n# Title\n');
});

test('compound cleanup reveals Markdown inside its wrapper without changing formula syntax', () => {
  const source = '\n```markdown\n\n## A note\n\n$$\\frac{a}{b}$$\n\n```\n';
  const suggestions = getCleanupSuggestions(source);
  assert.deepEqual(suggestions.map((suggestion) => suggestion.id), ['unwrap-fence', 'heading-levels', 'outer-blank-lines']);
  assert.equal(applyCleanup(source, suggestions.map((suggestion) => suggestion.id)), '# A note\n\n$$\\frac{a}{b}$$\n');
});

test('sections retain a title and preamble while carrying their nested headings and complete source', () => {
  const preamble = '# The document\n\nIntroduction.\n\n';
  const first = '## First\n\nA paragraph.\n\n### Detail\n\n```md\n## Code heading\n```\n\n$$\n## Math heading\n$$\n\n';
  const second = '## Second\n\nAnother paragraph.[^x]\n\n[^x]: A reference.\n';
  const source = preamble + first + second;
  const sections = getDocumentSections(source);
  assert.deepEqual(sections.map((section) => section.title), ['First', 'Second']);
  assert.equal(source.slice(sections[0].from, sections[0].to), first);
  assert.equal(source.slice(sections[1].from, sections[1].to), second);
  const moved = moveDocumentSection(source, sections[1].id, 'up');
  assert.ok(moved.startsWith(preamble + second.trimEnd() + '\n\n'));
  assert.ok(moved.includes('```md\n## Code heading\n```'));
  assert.ok(moved.includes('$$\n## Math heading\n$$'));
  const reversed = moveDocumentSection(moved, getDocumentSections(moved)[0].id, 'down');
  assert.equal(reversed, source);
});

test('section movement preserves line endings and a missing final newline', () => {
  const source = '# Title\r\n\r\n## A\r\n\r\nFirst.\r\n\r\n## B\r\n\r\nLast.';
  const moved = moveDocumentSection(source, getDocumentSections(source)[0].id, 'down');
  assert.equal(moved, '# Title\r\n\r\n## B\r\n\r\nLast.\r\n\r\n## A\r\n\r\nFirst.');
  assert.equal(moved.length, source.length);
  assert.equal(moveDocumentSection(moved, getDocumentSections(moved)[0].id, 'down'), source);
});

test('section movement handles multiple top-level headings and safely ignores unavailable moves', () => {
  const source = '# A\n\nOne.\n\n# B\n\nTwo.\n';
  const sections = getDocumentSections(source);
  assert.deepEqual(sections.map((section) => section.level), [1, 1]);
  assert.equal(moveDocumentSection(source, sections[0].id, 'up'), source);
  assert.equal(moveDocumentSection(source, sections[1].id, 'down'), source);
  assert.equal(moveDocumentSection(source, 'missing', 'up'), source);
  assert.deepEqual(getDocumentSections('> # Quoted\n\n    # Code\n\n\\[\n# Formula\n\\]'), []);
});

test('title suggestions use plain visible heading or paragraph text without losing Unicode', () => {
  assert.equal(suggestDocumentTitle('# **中文** and [a link](https://example.org) with `$x$`'), '中文 and a link with $x$');
  assert.equal(suggestDocumentTitle('A useful **answer**.\nWith a second line.'), 'A useful answer. With a second line.');
  assert.equal(suggestDocumentTitle('```md\n# A code example\n```'), 'Untitled document');
  assert.equal(suggestDocumentTitle('# ' + 'a'.repeat(200)).length, 100);
});

test('appending text keeps both inputs literal and makes the optional heading safe Markdown', () => {
  const source = '# Existing\r\n\r\n$x$';
  const addition = 'A new answer with $y$.\r\n';
  assert.equal(appendDocumentSection(source, addition, 'A *heading*\nnext'), '# Existing\r\n\r\n$x$\r\n\r\n## A \\*heading\\* next\r\n\r\n' + addition);
  assert.equal(appendDocumentSection(source, addition), source + '\r\n\r\n' + addition);
  assert.equal(appendDocumentSection('# Existing\r\n', addition), '# Existing\r\n\r\n' + addition);
  assert.equal(appendDocumentSection('', addition), addition);
  assert.equal(appendDocumentSection(source, '\n '), source);
});

test('oversized documents remain unchanged by parser-based structural tools', () => {
  const source = 'a'.repeat(DOCUMENT_TOOLS_LIMIT + 1);
  assert.deepEqual(getCleanupSuggestions(source), []);
  assert.deepEqual(getDocumentSections(source), []);
  assert.equal(applyCleanup(source, ['outer-blank-lines']), source);
  assert.equal(moveDocumentSection(source, 'section-0', 'down'), source);
});
