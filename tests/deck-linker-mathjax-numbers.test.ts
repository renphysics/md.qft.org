import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import vm from 'node:vm';
import katex from 'katex';
import { mathJaxConfigSource, mathJaxStandInSource, mathStandInSource } from '../src/lib/deck-linker-runtime.ts';

/*
 * Equation numbers, \label, \eqref and \ref in the two math stand-ins (final
 * check: KaTeX numbered with a CSS counter, which skips slides that are not
 * displayed, whatever MathJax's own setting said). The stand-ins rewrite the
 * TeX before KaTeX sees it: environments starred, explicit \tag{N} where
 * MathJax would put a number.
 */

type Options = { preProcess: (math: string) => string; macros: Record<string, unknown>; ignoredTags: string[]; ignoredClasses?: string[]; maxExpand?: number };
interface FakeNode { nodeType: number; nodeValue?: string; localName?: string; classList?: { contains(name: string): boolean }; lastChild?: FakeNode | null; previousSibling?: FakeNode | null }

const textNode = (value: string): FakeNode => ({ nodeType: 3, nodeValue: value });
function element(localName: string, children: FakeNode[]): FakeNode {
  children.forEach((child, index) => { child.previousSibling = children[index - 1] ?? null; });
  return { nodeType: 1, localName, classList: { contains: () => false }, lastChild: children[children.length - 1] ?? null };
}

/** A page with the MathJax stand-in; `formulas` are what auto-render would find in the body, in document order. */
function mathJaxPage(before = '', version: 2 | 3 | 4 = 3) {
  const seen: Options[] = [];
  const rendered: string[] = [];
  const converted: Array<{ maxExpand?: number }> = [];
  const statusClasses: string[] = [];
  let formulas: string[] = [];
  const body = element('body', []);
  const context: Record<string, any> = {
    setTimeout: (callback: () => void) => callback(),
    document: { readyState: 'loading', body, addEventListener: () => {}, getElementById: () => null, createElement: () => ({}),
      // Reveal.js's text copy of the current slide for screen readers.
      querySelectorAll: (selector: string) => selector === '.reveal > .aria-status' ? [{ classList: { add: (name: string) => { statusClasses.push(name); } } }] : [] },
    renderMathInElement: (_root: unknown, options: Options) => { seen.push(options); for (const tex of formulas) rendered.push(options.preProcess(tex)); formulas = []; },
    katex: { render: (tex: string, _node: unknown, options: { maxExpand?: number }) => { rendered.push(tex); converted.push(options); } },
  };
  context.window = context;
  vm.createContext(context);
  if (before) vm.runInContext(before, context);
  vm.runInContext(mathJaxStandInSource(version), context);
  const typeset = (...list: string[]) => { formulas = list; context.MathJax.typeset(); return rendered.splice(0); };
  return { context, seen, converted, statusClasses, typeset };
}

/** The rewrite of one configuration, for formulas given one by one. */
const rewrite = (before: string, version: 2 | 3 | 4 = 3) => {
  const { typeset } = mathJaxPage(before, version);
  return (tex: string) => typeset(tex)[0];
};
const ams = "window.MathJax = { tex: { tags: 'ams' } };";

/** What KaTeX shows in its column of tags (no error, no number from a CSS counter). */
function shown(tex: string, macros: object = {}, maxExpand?: number) {
  const html = katex.renderToString(tex, { displayMode: true, throwOnError: true, output: 'html', macros: { ...macros }, ...(maxExpand === undefined ? {} : { maxExpand }) });
  assert.doesNotMatch(html, /class="eqn-num"/, `${tex}: no number from a CSS counter`);
  const at = html.indexOf('<span class="katex-tag">');
  return at < 0 ? '' : html.slice(at).replace(/<[^>]*>/g, '').replace(/\u200b/g, '').trim();
}

describe('equation numbers as MathJax gives them', () => {
  it('numbers nothing by default, keeps an explicit \\tag, and stars every environment so that KaTeX numbers nothing either', () => {
    for (const before of ['', "window.MathJax = { tex: { tags: 'none' } };"]) {
      const tex = rewrite(before);
      assert.equal(tex('\\begin{align} a &= b \\\\ c &= d \\end{align}'), '\\begin{align*} a &= b \\\\ c &= d \\end{align*}');
      assert.equal(tex('\\begin{equation} E = mc^2 \\tag{E} \\end{equation}'), '\\begin{equation*} E = mc^2 \\tag{E} \\end{equation*}');
      assert.equal(tex('\\begin{multline} a \\\\ b \\end{multline}'), '\\begin{gather*} a \\\\ b \\end{gather*}');
      assert.equal(tex('{\\begin{gather} a \\end{gather}}'), '{\\begin{gather*} a \\end{gather*}}', 'a nested one too');
    }
  });

  it('with tags: \'ams\', numbers each row of each environment in order, except \\notag, \\nonumber and an explicit \\tag', () => {
    const tex = rewrite(ams);
    assert.equal(tex('\\begin{align} a &= b \\\\ c &= d \\notag \\\\[2pt] e &= f \\tag{T} \\\\* g &= h \\nonumber \\\\ i &= j \\end{align}'),
      '\\begin{align*} a &= b \\tag{1}\\\\ c &= d \\notag \\\\[2pt] e &= f \\tag{T} \\\\* g &= h \\nonumber \\\\ i &= j \\tag{2}\\end{align*}');
    assert.equal(tex('\\begin{equation} \\begin{split} a &= b \\\\ c &= d \\end{split} \\end{equation}'),
      '\\begin{equation*} \\begin{split} a &= b \\\\ c &= d \\end{split} \\tag{3}\\end{equation*}', 'one number for an equation with split');
    assert.equal(tex('\\begin{gather} \\begin{cases} a \\\\ b \\end{cases} \\\\ \\begin{pmatrix} 1 \\\\ 2 \\end{pmatrix} \\end{gather}'),
      '\\begin{gather*} \\begin{cases} a \\\\ b \\end{cases} \\tag{4}\\\\ \\begin{pmatrix} 1 \\\\ 2 \\end{pmatrix} \\tag{5}\\end{gather*}', 'rows of nested environments are not rows');
    assert.equal(tex('\\begin{alignat}{2} a &= b & c &= d \\\\ e &= f \\end{alignat}'), '\\begin{alignat*}{2} a &= b & c &= d \\tag{6}\\\\ e &= f \\tag{7}\\end{alignat*}');
    assert.equal(tex('\\begin{eqnarray} a &=& b \\end{eqnarray}'), '\\begin{align*} a &=& b \\tag{8}\\end{align*}');
    assert.equal(tex('\\begin{flalign} a &= b \\end{flalign}'), '\\begin{align*} a &= b \\tag{9}\\end{align*}');
    // Braces, escaped braces, \\% and comments do not end a row.
    assert.equal(tex('\\begin{align} {a \\\\ b} &= \\{ c \\} \\% % a comment \\\\ \\end{align}\n d \\end{align}'),
      '\\begin{align*} {a \\\\ b} &= \\{ c \\} \\% % a comment \\\\ \\end{align*}\n d \\tag{10}\\end{align*}');
    // An empty last row (a trailing \\\\) has no number.
    assert.equal(tex('\\begin{align} a \\\\ b \\\\ \\end{align}'), '\\begin{align*} a \\tag{11}\\\\ b \\tag{12}\\\\ \\end{align*}');
    // Starred environments: no numbers, explicit tags stay.
    for (const name of ['equation*', 'align*', 'alignat*', 'gather*']) {
      const body = `${name === 'alignat*' ? '{1}' : ''} a ${name === 'equation*' ? '' : '\\\\ b \\tag*{B}'} `;
      assert.equal(tex(`\\begin{${name}}${body}\\end{${name}}`), `\\begin{${name}}${body}\\end{${name}}`, name);
    }
    assert.equal(tex('\\begin{align*} a \\end{align*} x = y'), '\\begin{align*} a \\end{align*} x = y', 'unchanged text stays the same string');
    assert.equal(tex('\\begin{equation} x \\end{equation}'), '\\begin{equation*} x \\tag{13}\\end{equation*}', 'numbering goes on across formulas');
  });

  it('gives multline one number, on its last row, as MathJax does', () => {
    const tex = rewrite(ams);
    assert.equal(tex('\\begin{multline} a + b \\\\ + c \\\\ = d \\label{m} \\end{multline}'), '\\begin{gather*} a + b \\\\ + c \\\\ = d \\label{m} \\tag{1}\\end{gather*}');
    assert.equal(tex('\\begin{multline} a \\\\ b \\\\ \\end{multline}'), '\\begin{gather*} a \\\\ b \\tag{2}\\\\ \\end{gather*}');
    assert.equal(tex('\\begin{multline} a \\notag \\\\ b \\end{multline}'), '\\begin{gather*} a \\notag \\\\ b \\end{gather*}');
    assert.equal(tex('\\begin{multline*} a \\\\ b \\end{multline*}'), '\\begin{gather*} a \\\\ b \\end{gather*}');
    assert.equal(tex('\\begin{equation} c \\eqref{m} \\end{equation}'), '\\begin{equation*} c \\text{(1)} \\tag{3}\\end{equation*}');
  });

  it('reads the setting of MathJax 2, 3 and 4, also given later; \'all\' counts as \'ams\'', () => {
    const numbered = (tex: (math: string) => string) => /\\tag\{1\}/.test(tex('\\begin{equation} x \\end{equation}'));
    assert.equal(numbered(rewrite("window.MathJax = { tex: { tags: 'all' } };")), true);
    assert.equal(numbered(rewrite("window.MathJax = { tex: { tags: 'ams' } };", 4)), true);
    assert.equal(numbered(rewrite(mathJaxConfigSource("MathJax.Hub.Config({ TeX: { equationNumbers: { autoNumber: 'AMS' } } });"), 2)), true);
    assert.equal(numbered(rewrite("window.MathJax = { TeX: { equationNumbers: { autoNumber: 'all' } } };", 2)), true);
    assert.equal(numbered(rewrite(mathJaxConfigSource("MathJax.Hub.Config({ TeX: { equationNumbers: { autoNumber: 'none' } } });"), 2)), false);
    assert.equal(numbered(rewrite('', 2)), false);
    // Given after the stand-in ran: an assignment to window.MathJax, and Hub.Config.
    const later = mathJaxPage();
    later.context.MathJax = { tex: { tags: 'ams' } };
    assert.deepEqual(later.typeset('\\begin{equation} x \\end{equation}'), ['\\begin{equation*} x \\tag{1}\\end{equation*}']);
    const hub = mathJaxPage('', 2);
    hub.context.MathJax.Hub.Config({ TeX: { equationNumbers: { autoNumber: 'AMS' } } });
    assert.deepEqual(hub.typeset('\\begin{equation} x \\end{equation}'), ['\\begin{equation*} x \\tag{1}\\end{equation*}']);
  });

  it('keeps the numbers when the presentation asks for typesetting again, and goes on for new formulas', () => {
    const { context, typeset } = mathJaxPage(ams);
    assert.deepEqual(typeset('\\begin{align} a \\\\ b \\end{align}'), ['\\begin{align*} a \\tag{1}\\\\ b \\tag{2}\\end{align*}']);
    // Formulas typeset before are not found again; only the new one is.
    context.MathJax.typesetPromise();
    context.MathJax.Hub.Queue(['Typeset', context.MathJax.Hub]);
    assert.deepEqual(typeset('\\begin{equation} c \\end{equation}'), ['\\begin{equation*} c \\tag{3}\\end{equation*}']);
    // A direct conversion goes through the same rewrite.
    context.MathJax.tex2chtml('\\begin{equation} d \\label{d} \\end{equation}');
    context.MathJax.tex2svg('\\eqref{d}', { display: false });
    assert.deepEqual(typeset(), ['\\begin{equation*} d \\label{d} \\tag{4}\\end{equation*}', '\\text{(4)}']);
  });
});

describe('\\label, \\eqref and \\ref', () => {
  it('fills references inside formulas, for numbers and for explicit tags, also later in the same formula', () => {
    const tex = rewrite(ams);
    assert.equal(tex('\\begin{align} a &= b \\label{eq:a} \\\\ c &= d \\tag{$\\ast$} \\label{eq:c} \\end{align}'),
      '\\begin{align*} a &= b \\label{eq:a} \\tag{1}\\\\ c &= d \\tag{$\\ast$} \\label{eq:c} \\end{align*}');
    assert.equal(tex('\\eqref{eq:a} + \\ref {eq:a} + \\eqref{eq:c} + \\eqref{nothing} + \\ref{later}'),
      '\\text{(1)} + \\text{1} + \\text{($\\ast$)} + \\eqref{nothing} + \\ref{later}', 'an unknown name keeps the placeholder macro');
    assert.equal(tex('\\begin{gather} x = \\eqref{b} \\\\ y \\label{b} \\end{gather}'), '\\begin{gather*} x = \\text{(3)} \\tag{2}\\\\ y \\label{b} \\tag{3}\\end{gather*}');
    // A label on a row without a number, or outside a numbered row, names nothing.
    assert.equal(tex('\\begin{align} a \\notag \\label{n} \\end{align} \\eqref{n}'), '\\begin{align*} a \\notag \\label{n} \\end{align*} \\eqref{n}');
    assert.equal(tex('x \\label{plain} \\eqref{plain}'), 'x \\label{plain} \\eqref{plain}');
    assert.equal(tex('x \\tag{7} \\label{seven} \\ref{seven}'), 'x \\tag{7} \\label{seven} \\text{7}', 'a tag outside an environment');
    // The first definition of a name counts.
    assert.equal(tex('\\begin{equation} z \\label{eq:a} \\end{equation} \\ref{eq:a}'), '\\begin{equation*} z \\label{eq:a} \\tag{4}\\end{equation*} \\text{1}');
  });

  it('names explicit tags without automatic numbers too', () => {
    const tex = rewrite('');
    assert.equal(tex('\\begin{align} a \\tag{A} \\label{a} \\\\ b \\label{b} \\end{align} \\eqref{a} \\eqref{b}'),
      '\\begin{align*} a \\tag{A} \\label{a} \\\\ b \\label{b} \\end{align*} \\text{(A)} \\eqref{b}');
  });

  it('leaves references to the presentation\'s own \\eqref and \\ref macros', () => {
    const tex = rewrite("window.MathJax = { tex: { tags: 'ams', macros: { eqref: ['[#1]', 1] } } };");
    assert.equal(tex('\\begin{equation} a \\label{a} \\end{equation} \\eqref{a} \\ref{a}'), '\\begin{equation*} a \\label{a} \\tag{1}\\end{equation*} \\eqref{a} \\text{1}');
  });

  it('shows the number in ordinary text, also for a reference before its equation, and the placeholder for an unknown name', () => {
    const before = textNode('See \\eqref{eq:late}, \\ref{eq:late} and \\eqref{eq:none}.');
    const after = textNode('Again \\eqref{eq:late}.');
    const root = element('section', [element('p', [before]), element('p', [after])]);
    const { context } = mathJaxPage(ams);
    context.document.getElementById = () => root;
    context.renderMathInElement = (_root: unknown, options: Options) => { options.preProcess('\\begin{align} a \\\\ b \\label{eq:late} \\end{align}'); };
    context.MathJax.typeset('root');
    assert.equal(before.nodeValue, 'See (2), 2 and (?).');
    assert.equal(after.nodeValue, 'Again (2).');
  });

  it('keeps one numbering and one set of names for the whole document, shared by both stand-ins', () => {
    const { context, typeset } = mathJaxPage(ams);
    assert.deepEqual(typeset('\\begin{equation} a \\label{a} \\end{equation}'), ['\\begin{equation*} a \\label{a} \\tag{1}\\end{equation*}']);
    let options: Options | undefined;
    context.renderMathInElement = (_root: unknown, value: Options) => { options = value; };
    vm.runInContext(mathStandInSource(), context);
    context.RevealMath.MathJax3().init({ getConfig: () => ({ mathjax3: { tex: { tags: 'ams' } } }), isReady: () => true, getSlidesElement: () => element('div', []), layout: () => {} });
    assert.equal(options!.preProcess('\\begin{equation} b \\end{equation} \\eqref{a}'), '\\begin{equation*} b \\tag{2}\\end{equation*} \\text{(1)}');
  });
});

describe('Reveal\'s math plugin stand-in', () => {
  const pluginOptions = (factory: string, config: unknown) => {
    let options: Options | undefined;
    const context: Record<string, any> = { document: { readyState: 'complete' }, renderMathInElement: (_root: unknown, value: Options) => { options = value; } };
    context.window = context;
    vm.runInNewContext(mathStandInSource(), context);
    (factory ? context.RevealMath[factory] : () => context.RevealMath)().init({ getConfig: () => config, isReady: () => true, getSlidesElement: () => element('div', []), layout: () => {} });
    return options!;
  };

  it('reads the numbering setting of each MathJax form, and leaves the KaTeX form to KaTeX', () => {
    const equation = '\\begin{equation} x \\end{equation}';
    for (const [factory, config, expected] of [
      ['', { math: { TeX: { equationNumbers: { autoNumber: 'AMS' } } } }, '\\begin{equation*} x \\tag{1}\\end{equation*}'],
      ['MathJax2', { mathjax2: { TeX: { equationNumbers: { autoNumber: 'all' } } } }, '\\begin{equation*} x \\tag{1}\\end{equation*}'],
      ['MathJax2', { mathjax2: {} }, '\\begin{equation*} x \\end{equation*}'],
      ['MathJax3', { mathjax3: { tex: { tags: 'ams' } } }, '\\begin{equation*} x \\tag{1}\\end{equation*}'],
      ['MathJax3', {}, '\\begin{equation*} x \\end{equation*}'],
      ['MathJax4', { mathjax4: { tex: { tags: 'ams' } } }, '\\begin{equation*} x \\tag{1}\\end{equation*}'],
      ['KaTeX', { mathjax3: { tex: { tags: 'ams' } } }, equation],
    ] as const) assert.equal(pluginOptions(factory, config).preProcess(equation), expected, `${factory} ${JSON.stringify(config)}`);
  });

  it('gives KaTeX room for the added numbers in each MathJax form, and leaves the KaTeX form its own limit (Y1.1)', () => {
    for (const factory of ['', 'MathJax2', 'MathJax3', 'MathJax4']) assert.equal(pluginOptions(factory, {}).maxExpand, 10_000, factory || 'RevealMath');
    assert.equal(pluginOptions('KaTeX', {}).maxExpand, undefined);
    assert.equal(pluginOptions('KaTeX', { katex: { maxExpand: 50 } }).maxExpand, 50, 'the presentation\'s own KaTeX setting stays');
  });
});

describe('what KaTeX makes of the rewritten formulas', () => {
  it('accepts \\tag in a row of each starred environment it is given, and numbers nothing by itself', () => {
    assert.equal(shown('\\begin{equation*} a \\tag{1}\\end{equation*}'), '(1)');
    assert.equal(shown('\\begin{align*} a &= b \\tag{1}\\\\ c &= d \\tag{2}\\end{align*}'), '(1)(2)');
    assert.equal(shown('\\begin{alignat*}{2} a &= b \\tag{1}\\\\ c &= d \\tag{2}\\end{alignat*}'), '(1)(2)');
    assert.equal(shown('\\begin{gather*} a \\\\ b \\tag{1}\\end{gather*}'), '(1)');
    assert.equal(shown('\\begin{align*} a \\notag \\\\ b \\nonumber \\\\ c \\end{align*}'), '', '\\notag and \\nonumber are accepted');
    // A second \\tag in a row is an error in KaTeX: the rewrite never adds one to a row that has one.
    assert.throws(() => katex.renderToString('\\begin{align*} a \\tag{A}\\tag{1}\\end{align*}', { displayMode: true, throwOnError: true }), /Multiple \\tag/);
  });

  it('renders every rewritten formula without an error, in every mode', () => {
    const formulas = [
      '\\begin{align} E &= mc^2 \\label{eq:emc} \\\\ F &= ma \\tag{N2} \\end{align}', '\\begin{eqnarray} a &=& b \\\\ c &=& d \\nonumber \\end{eqnarray}',
      '\\begin{multline} a + b + c \\\\ + d + e \\label{eq:m} \\end{multline}', '\\begin{multline*} a \\\\ b \\end{multline*}', '\\begin{flalign} x &= y & z &= w \\\\ a &= b & c &= d \\end{flalign}',
      '\\begin{gather} a \\notag \\\\ b \\tag*{B} \\\\ c \\end{gather}', '\\begin{equation} \\begin{aligned} a &= b \\\\ c &= d \\end{aligned} \\label{eq:x} \\end{equation}',
      '\\begin{alignat}{2} a &= b &\\quad c &= d \\\\[3pt] e &= f \\\\* g &= h \\end{alignat}', 'x = \\eqref{eq:emc} + \\ref{eq:m} + \\eqref{unknown}', '\\begin{align*} a \\tag{S} \\end{align*}',
      '\\begin{align} a % \\\\ comment\n \\\\ b \\\\ \\end{align}', '\\begin{CD} A @>a>> B \\end{CD}',
    ];
    for (const before of ['', ams, "window.MathJax = { tex: { tags: 'all' } };"]) {
      const { seen, typeset } = mathJaxPage(before);
      for (const tex of typeset(...formulas)) assert.doesNotThrow(() => shown(tex, seen[0].macros), `${before} ${tex}`);
    }
  });
});

describe('a long numbered environment (closing check Y1.1)', () => {
  // 90 rows that use a macro of the presentation six times each (540 expansions): MathJax 3 typesets this with (1) to (90)
  // (measured in the closing check and its re-check; 120 such rows pass MathJax's own limit on the expanded text).
  // In KaTeX the added \\tag costs about six more a row, which passes its limit of 1,000.
  const rows = Array.from({ length: 90 }, (_, index) => `\\v{a}_{${index}} &= \\v{b} + \\v{c} + \\v{d} + \\v{e} + \\v{f}`).join(' \\\\ ');
  const long = `\\begin{align} ${rows} \\end{align}`;
  const config = "window.MathJax = { tex: { tags: 'ams', macros: { v: ['\\\\mathbf{#1}', 1] } } };";
  const numbers = Array.from({ length: 90 }, (_, index) => `(${index + 1})`).join('');

  it('is typeset with its numbers: \\tag costs KaTeX macro expansions that MathJax does not count', () => {
    const { seen, typeset } = mathJaxPage(config);
    const [tex] = typeset(long);
    assert.equal(seen[0].maxExpand, 10_000);
    assert.equal(shown(tex, seen[0].macros, seen[0].maxExpand), numbers);
    // The reason for the setting: with KaTeX's own limit of 1,000 the rewritten formula fails, and the unnumbered one does not.
    assert.throws(() => shown(tex, seen[0].macros), /Too many expansions/);
    assert.equal(shown(long.replace(/align/g, 'align*'), seen[0].macros), '');
  });

  it('has the same room in a direct conversion (tex2chtml) and in MathJax 2', () => {
    const { context, converted } = mathJaxPage(config);
    context.MathJax.tex2chtml(long);
    assert.equal(converted[0].maxExpand, 10_000);
    const two = mathJaxPage("window.MathJax = { TeX: { equationNumbers: { autoNumber: 'AMS' } } };", 2);
    two.typeset('x');
    assert.equal(two.seen[0].maxExpand, 10_000);
  });

  it('still stops a macro that calls itself', () => {
    const { seen, typeset } = mathJaxPage("window.MathJax = { tex: { macros: { loop: '\\\\loop x' } } };");
    const [tex] = typeset('\\loop');
    const started = performance.now();
    assert.throws(() => shown(tex, seen[0].macros, seen[0].maxExpand), /Too many expansions/);
    assert.ok(performance.now() - started < 1000);
  });
});

describe('typesetting again (closing check Y1.3)', () => {
  it('never reads the stand-in\'s own output again, also when the presentation lists its own skipped tags', () => {
    for (const before of ['', "window.MathJax = { options: { skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre'] } };", "window.MathJax = { tex2jax: { skipTags: ['script', 'pre'] } };"]) {
      const { seen, typeset } = mathJaxPage(before);
      typeset('x');
      for (const name of ['katex', 'katex-error', 'tex2jax_ignore', 'mathjax_ignore']) assert.ok(seen[0].ignoredClasses?.includes(name), `${before}: ${name}`);
    }
  });
});

describe('Reveal.js\'s text copy of the current slide (re-check W1.1)', () => {
  it('is marked as not to be typeset before each pass, so its equations never take numbers', () => {
    const { statusClasses, seen, typeset } = mathJaxPage(ams);
    typeset('x');
    assert.deepEqual(statusClasses, ['tex2jax_ignore']);
    assert.ok(seen[0].ignoredClasses?.includes('tex2jax_ignore'));
    typeset('y');
    assert.deepEqual(statusClasses, ['tex2jax_ignore', 'tex2jax_ignore'], 'again on a later pass: Reveal.js may have made the element since');
    // A page's own element with that class name is not skipped as a class.
    assert.equal(seen[0].ignoredClasses?.includes('aria-status'), false);
  });
});

describe('the rewrite on awkward input', () => {
  it('is linear in the length of the formula', () => {
    const tex = rewrite(ams);
    const awkward = [
      '\\begin{align}' + 'a \\\\[2pt '.repeat(40_000) + '\\end{align}',
      '\\begin{gather}' + '\\label{'.repeat(40_000) + '\\eqref{' + 'x'.repeat(150_000) + '\\end{gather}',
      '{'.repeat(100_000) + '\\begin{align}'.repeat(20_000) + '\\end{align}'.repeat(20_000) + '}'.repeat(100_000),
      '\\begin{align}' + '\\tag*{a}\\\\'.repeat(40_000) + '% \\\\'.repeat(20_000) + '\\end{align}',
      '\\begin{equation}' + '\\abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz'.repeat(10_000) + '\\end{equation}',
    ];
    for (const formula of awkward) {
      const started = performance.now();
      tex(formula);
      const elapsed = performance.now() - started;
      assert.ok(elapsed < 1000, `${formula.slice(0, 40)}…: ${Math.round(elapsed)} ms`);
    }
  });
});
