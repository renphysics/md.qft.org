/**
 * Small scripts the deck linker inserts into a linked deck, and the escaping
 * that keeps inlined code inside its <script> element. Every snippet runs
 * only inside the presentation sandbox, as part of the deck; none of them is
 * ever evaluated by the site. Each inserted element carries
 * data-qft-linker="<name>" so that linking a linked deck again changes nothing.
 */
export const LINKER_MARKER = 'data-qft-linker';

/** Names of the inserted scripts, as the values of data-qft-linker. */
export type LinkerScript = 'math' | 'mathjax' | 'mathjax-config' | 'dependencies' | 'media' | 'handlers' | 'plugins' | 'script-event';

/**
 * The HTML tokenizer ends a script at "</script" and, after "<!--" followed
 * by "<script", stops recognising the end tag at all. Escape the first
 * everywhere; escape "<!--" only when the text would otherwise reach that
 * second state at its end, because "<\!--" is not valid in every regular
 * expression.
 */
export function escapeScriptText(code: string): string {
  const escaped = code.replace(/<\/(script)/gi, '<\\/$1');
  return reachesDoubleEscape(escaped) ? escaped.replace(/<!--/g, '<\\!--') : escaped;
}

/** Follows the script-data states of the HTML tokenizer (no end tags remain). */
function reachesDoubleEscape(text: string): boolean {
  let state: 'data' | 'escaped' | 'double' = 'data';
  const marks = /<!--|-->|<script[\s/>]/gi;
  for (let match; (match = marks.exec(text));) {
    const mark = match[0].toLowerCase();
    if (mark === '<!--') { if (state === 'data') state = 'escaped'; }
    else if (mark === '-->') state = 'data';
    else if (state === 'escaped') state = 'double';
  }
  return state === 'double';
}

/** A style element ends only at "</style". */
export function escapeStyleText(css: string): string {
  return css.replace(/<\/(style)/gi, '<\\/$1');
}

/** Source-map comments would ask developer tools to fetch a file. */
export function stripSourceMapComment(code: string): string {
  return code.replace(/(?:\/\/|\/\*)[#@]\s*sourceMappingURL=[^\s*]*\s*(?:\*\/)?\s*$/, '');
}

/**
 * Helpers that both math stand-ins share, as script source: the delimiter
 * pairs of a configuration, the macros for MathJax-only commands, the
 * eqnarray, multline and flalign rewrite, and the placeholder for references
 * written in ordinary text. They are written into each stand-in's own
 * function scope.
 */
function mathHelpersSource(): string {
  return `  var ignored = ['script', 'noscript', 'style', 'textarea', 'pre', 'code'];
  function pairs(list, display) {
    return (Array.isArray(list) ? list : []).filter(function (pair) {
      return Array.isArray(pair) && typeof pair[0] === 'string' && typeof pair[1] === 'string' && pair[0];
    }).map(function (pair) { return { left: pair[0], right: pair[1], display: display }; });
  }
  // \\\\unicode[font]{x2192} or \\\\unicode{8594}: the character itself, or nothing.
  function unicodeMacro(context) {
    try {
      if (context.future().text === '[') {
        for (var guard = 0; guard < 100; guard += 1) {
          var token = context.popToken();
          if (!token || token.text === ']' || token.text === 'EOF') break;
        }
      }
      var text = context.consumeArgs(1)[0].slice().reverse().map(function (item) { return item.text; }).join('').replace(/\\s+/g, '');
      var hex = /^(?:0?x|U\\+)([0-9a-f]{1,6})$/i.exec(text);
      var code = hex ? parseInt(hex[1], 16) : /^\\d{1,7}$/.test(text) ? parseInt(text, 10) : -1;
      return code > 31 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? '{\\\\char"' + code.toString(16).toUpperCase() + '}' : '';
    } catch (error) { return ''; }
  }
  // MathJax-only commands that KaTeX does not know: \\\\label and \\\\require
  // produce nothing, \\\\eqref and \\\\ref a placeholder (KaTeX numbers nothing),
  // \\\\unicode the character. The deck's own macros of the same names win.
  function defaultMacros() {
    return {
      '\\\\label': { tokens: [], numArgs: 1 },
      '\\\\require': { tokens: [], numArgs: 1 },
      '\\\\eqref': '(\\\\text{?})\\\\label{#1}',
      '\\\\ref': '\\\\text{?}\\\\label{#1}',
      '\\\\unicode': unicodeMacro
    };
  }
  // KaTeX has no eqnarray, multline or flalign: align lays out the rows of
  // eqnarray and flalign, gather those of multline (centred, review X3.3).
  function preProcess(math) {
    return math.replace(/\\\\(begin|end)\\{(eqnarray|flalign|multline)(\\*?)\\}/g, function (whole, side, name, star) {
      return '\\\\' + side + '{' + (name === 'multline' ? 'gather' : 'align') + star + '}';
    });
  }
  function macros(source) {
    var result = defaultMacros();
    if (source && typeof source === 'object') Object.keys(source).forEach(function (name) {
      var value = Array.isArray(source[name]) ? source[name][0] : source[name];
      if (typeof value === 'string') result[name.charAt(0) === '\\\\' ? name : '\\\\' + name] = value;
    });
    return result;
  }
  // MathJax also typesets LaTeX environments written directly in the text
  // (review W3.2), unless processEnvironments is false. These are the ones
  // KaTeX can typeset at the top level; eqnarray, multline and flalign go
  // through preProcess.
  var environmentNames = ['equation', 'equation*', 'align', 'align*', 'alignat', 'alignat*', 'gather', 'gather*', 'CD', 'eqnarray', 'eqnarray*',
    'multline', 'multline*', 'flalign', 'flalign*'];
  function environments(off) {
    return off === false ? [] : environmentNames.map(function (name) {
      return { left: '\\\\begin{' + name + '}', right: '\\\\end{' + name + '}', display: true };
    });
  }
  function longestFirst(list) {
    return list.map(function (item, index) { return [item, index]; }).sort(function (a, b) {
      return b[0].left.length - a[0].left.length || a[1] - b[1];
    }).map(function (entry) { return entry[0]; });
  }
  // MathJax also reads \\\\eqref{…} and \\\\ref{…} in ordinary text (review
  // VF2b.3); show the same placeholder as inside a formula. One walk over
  // the text, skipping typeset formulas and the ignored elements.
  var reference = /\\\\(eqref|ref)\\s*\\{[^{}\\n]{0,200}\\}/g;
  function replaceReferences(root, skip) {
    if (!root || !root.nodeType) return;
    var skipped = {};
    (Array.isArray(skip) ? skip : ignored).forEach(function (name) { skipped[String(name).toLowerCase()] = true; });
    var stack = [root];
    while (stack.length) {
      var node = stack.pop();
      if (node.nodeType === 3) {
        var value = node.nodeValue;
        if (value.indexOf('ref') < 0 || value.indexOf('\\\\') < 0) continue;
        var next = value.replace(reference, function (whole, name) { return name === 'eqref' ? '(?)' : '?'; });
        if (next !== value) node.nodeValue = next;
        continue;
      }
      if (node.nodeType !== 1 && node.nodeType !== 9 && node.nodeType !== 11) continue;
      if (node.nodeType === 1 && (skipped[String(node.localName).toLowerCase()] || (node.classList && node.classList.contains('katex')))) continue;
      for (var child = node.lastChild; child; child = child.previousSibling) stack.push(child);
    }
  }`;
}

/**
 * Reveal's math plugin in all its forms (RevealMath, RevealMath.KaTeX,
 * MathJax2, MathJax3, MathJax4) loads MathJax or KaTeX from a CDN at run time.
 * This stand-in has the same shape and typesets with the bundled KaTeX
 * auto-render, using the delimiters and macros from the deck's configuration.
 */
export function mathStandInSource(): string {
  return `(function () {
  if (window.RevealMath && window.RevealMath.qftStandIn) return;
${mathHelpersSource()}
  var katexDelimiters = [
    { left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false },
    { left: '\\\\(', right: '\\\\)', display: false }, { left: '\\\\[', right: '\\\\]', display: true }
  ];
  var mathjaxInline = [['$', '$'], ['\\\\(', '\\\\)']];
  var mathjaxDisplay = [['$$', '$$'], ['\\\\[', '\\\\]']];
  function options(id, config) {
    if (id === 'katex') {
      var given = config.katex || {}, result = { throwOnError: false };
      Object.keys(given).forEach(function (key) {
        if (key !== 'local' && key !== 'version' && key !== 'extensions') result[key] = given[key];
      });
      result.delimiters = Array.isArray(result.delimiters) ? result.delimiters : katexDelimiters;
      result.ignoredTags = Array.isArray(result.ignoredTags) ? result.ignoredTags : ignored;
      result.macros = Object.assign(defaultMacros(), result.macros && typeof result.macros === 'object' ? result.macros : {});
      if (typeof result.preProcess !== 'function') result.preProcess = preProcess;
      return result;
    }
    var settings = (id === 'mathjax2' ? (config.mathjax2 || config.math) : config[id]) || {};
    var tex = (id === 'mathjax2' ? settings.tex2jax : settings.tex) || {};
    var skip = id === 'mathjax2' ? tex.skipTags : settings.options && settings.options.skipHtmlTags;
    return {
      throwOnError: false,
      delimiters: longestFirst(pairs(tex.displayMath || mathjaxDisplay, true).concat(pairs(tex.inlineMath || mathjaxInline, false), environments(tex.processEnvironments))),
      ignoredTags: Array.isArray(skip) ? skip : ignored,
      macros: macros(id === 'mathjax2' ? settings.TeX && settings.TeX.Macros : tex.macros),
      preProcess: preProcess
    };
  }
  function plugin(id) {
    return function () {
      return {
        id: id,
        init: function (deck) {
          var typeset = function () {
            if (typeof window.renderMathInElement !== 'function') return;
            var settings = options(id, deck.getConfig() || {});
            window.renderMathInElement(deck.getSlidesElement(), settings);
            if (id !== 'katex') try { replaceReferences(deck.getSlidesElement(), settings.ignoredTags); } catch (error) {}
            deck.layout();
          };
          var run = function () {
            if (typeof window.renderMathInElement === 'function' || document.readyState === 'complete') typeset();
            else window.addEventListener('load', typeset, { once: true });
          };
          if (deck.isReady()) run(); else deck.on('ready', run);
        }
      };
    };
  }
  var math = plugin('mathjax2')();
  math.KaTeX = plugin('katex');
  math.MathJax2 = plugin('mathjax2');
  math.MathJax3 = plugin('mathjax3');
  math.MathJax4 = plugin('mathjax4');
  math.qftStandIn = true;
  window.RevealMath = math;
})();`;
}

/** The global that converted text/x-mathjax-config scripts queue their code in until the stand-in exists. */
export const MATHJAX_CONFIG_QUEUE = '__qftMathJaxConfig';

/**
 * MathJax loaded on its own (review VF5.2): a script from a CDN such as
 * mathjax@3/es5/tex-svg.js, or MathJax.js of version 2. This stand-in takes
 * its place as `window.MathJax` and typesets with the bundled KaTeX
 * auto-render when the page has loaded, with the delimiters and macros of the
 * page's configuration (a `window.MathJax = { tex: … }` object of version 3
 * and 4, or `tex2jax` and `TeX.Macros` of version 2, also given later to
 * MathJax.Hub.Config) and otherwise MathJax's defaults: \( \) inline, $$ $$
 * and \[ \] display, no single dollars. It offers the calls presentations
 * make after changing a slide; each typesets the given elements (or the
 * body) again and never throws. A configuration object assigned after it
 * runs is merged into its configuration.
 */
export function mathJaxStandInSource(version: 2 | 3 | 4 = 3): string {
  const versionText = version === 2 ? '2.7.9' : version === 4 ? '4.0.0' : '3.2.2';
  return `(function () {
  var current = window.MathJax;
  if (current && current.qftStandIn) return;
${mathHelpersSource()}
  var skipTags = ignored.concat(['annotation', 'annotation-xml']);
  var config = {};
  function plain(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) && !value.nodeType; }
  function merge(target, source, depth) {
    if (!plain(source)) return target;
    Object.keys(source).forEach(function (key) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') return;
      var value = source[key];
      if (plain(value) && depth < 5) target[key] = merge(plain(target[key]) ? target[key] : {}, value, depth + 1);
      else target[key] = value;
    });
    return target;
  }
  function later(error) { setTimeout(function () { throw error; }); }
  function nothing() {}
  function settings() {
    var tex = plain(config.tex) ? config.tex : {}, two = plain(config.tex2jax) ? config.tex2jax : {};
    var options = plain(config.options) ? config.options : {};
    var skip = Array.isArray(options.skipHtmlTags) ? options.skipHtmlTags : Array.isArray(two.skipTags) ? two.skipTags : skipTags;
    var inline = Array.isArray(tex.inlineMath) ? tex.inlineMath : Array.isArray(two.inlineMath) ? two.inlineMath : [['\\\\(', '\\\\)']];
    var display = Array.isArray(tex.displayMath) ? tex.displayMath : Array.isArray(two.displayMath) ? two.displayMath : [['$$', '$$'], ['\\\\[', '\\\\]']];
    var given = {};
    if (plain(config.TeX) && plain(config.TeX.Macros)) Object.assign(given, config.TeX.Macros);
    if (plain(tex.macros)) Object.assign(given, tex.macros);
    return {
      throwOnError: false,
      delimiters: longestFirst(pairs(display, true).concat(pairs(inline, false), environments(tex.processEnvironments === false ? false : two.processEnvironments))),
      ignoredTags: skip,
      ignoredClasses: ['tex2jax_ignore', 'mathjax_ignore'],
      macros: macros(given),
      preProcess: preProcess
    };
  }
  function roots(elements) {
    var list = [];
    function add(item) {
      if (typeof item === 'string') {
        var byId = document.getElementById(item);
        if (byId) { list.push(byId); return; }
        try { Array.prototype.push.apply(list, document.querySelectorAll(item)); } catch (error) {}
      } else if (item && item.nodeType) list.push(item);
    }
    if (elements == null) add(document.body);
    else if (typeof elements === 'string' || elements.nodeType) add(elements);
    else if (typeof elements.length === 'number') for (var index = 0; index < elements.length && index < 10000; index += 1) add(elements[index]);
    return list;
  }
  function typeset(elements) {
    try {
      if (typeof window.renderMathInElement !== 'function') return;
      var options = settings();
      roots(elements).forEach(function (root) {
        try { window.renderMathInElement(root, options); } catch (error) {}
        try { replaceReferences(root, options.ignoredTags); } catch (error) {}
      });
      var reveal = window.Reveal;
      if (reveal && typeof reveal.layout === 'function' && (typeof reveal.isReady !== 'function' || reveal.isReady())) reveal.layout();
    } catch (error) {}
  }
  function typesetPromise(elements) { typeset(elements); return Promise.resolve(); }
  function convert(math, options) {
    var node = document.createElement('mjx-container');
    try {
      window.katex.render(String(math), node, { displayMode: !options || options.display !== false, throwOnError: false, macros: settings().macros });
    } catch (error) { node.textContent = String(math); }
    return node;
  }
  var started = false, resolveStartup = nothing, waiting = [];
  var startupPromise = new Promise(function (resolve) { resolveStartup = resolve; });
  function startupConfig() { return plain(config.startup) ? config.startup : {}; }
  function defaultPageReady() {
    var own = startupConfig();
    if (own.typeset !== false && config.skipStartupTypeset !== true) typeset(own.elements == null ? null : own.elements);
    return Promise.resolve();
  }
  function defaultReady() {
    var own = startupConfig();
    var done = function () { resolveStartup(); };
    try {
      if (typeof own.pageReady === 'function') Promise.resolve(own.pageReady.call(startup)).then(done, function (error) { done(); later(error); });
      else { defaultPageReady(); done(); }
    } catch (error) { done(); later(error); }
    return startupPromise;
  }
  // Version 2 callbacks: a function, [function, data…], or ["method", object, data…].
  function call(item) {
    try {
      if (typeof item === 'function') return item();
      if (!Array.isArray(item)) return undefined;
      if (typeof item[0] === 'function') return item[0].apply(window, item.slice(1));
      if (typeof item[0] === 'string' && item[1] && typeof item[1][item[0]] === 'function') return item[1][item[0]].apply(item[1], item.slice(2));
      if (item[0] && typeof item[1] === 'function') return item[1].apply(item[0], item.slice(2));
    } catch (error) { later(error); }
    return undefined;
  }
  function queue(items) {
    items.forEach(function (item) { if (started) call(item); else waiting.push(item); });
  }
  var startup = {
    promise: startupPromise,
    defaultReady: defaultReady,
    defaultPageReady: defaultPageReady,
    getComponents: nothing,
    toMML: function () { return ''; },
    document: { state: function () { return startup.document; }, clear: function () { return startup.document; }, updateDocument: function () { return startup.document; }, reset: function () { return startup.document; } }
  };
  var hub = {
    Config: function (value) { merge(config, value, 0); },
    Configured: nothing,
    Queue: function () { queue(Array.prototype.slice.call(arguments)); },
    Typeset: function (element, callback) {
      queue([function () { typeset(element == null ? null : element); }].concat(callback ? [callback] : []));
    },
    Reprocess: function (element, callback) { hub.Typeset(element, callback); },
    Rerender: function (element, callback) { hub.Typeset(element, callback); },
    Update: function (element, callback) { hub.Typeset(element, callback); },
    getAllJax: function () { return []; },
    Register: {
      StartupHook: function (name, callback) { queue([callback]); },
      MessageHook: nothing,
      LoadHook: nothing
    },
    signal: { Interest: nothing },
    config: config
  };
  var api = {
    qftStandIn: true,
    version: '${versionText}',
    config: config,
    startup: startup,
    typeset: function (elements) { typeset(elements); },
    typesetPromise: typesetPromise,
    typesetClear: nothing,
    texReset: nothing,
    tex2chtml: convert,
    tex2svg: convert,
    tex2chtmlPromise: function (math, options) { return Promise.resolve(convert(math, options)); },
    tex2svgPromise: function (math, options) { return Promise.resolve(convert(math, options)); },
    Hub: hub,
    Callback: { Queue: function () { queue(Array.prototype.slice.call(arguments)); } },
    Ajax: { config: {}, Require: nothing, loadComplete: nothing }
  };
  function adopt(value) {
    if (!plain(value) || value === api) return;
    merge(config, value, 0);
  }
  adopt(current);
  try {
    Object.defineProperty(window, 'MathJax', {
      configurable: true, enumerable: true,
      get: function () { return api; },
      set: function (value) { adopt(value); }
    });
  } catch (error) { window.MathJax = api; }
  // text/x-mathjax-config scripts of version 2 that ran before this one.
  var queued = window.${MATHJAX_CONFIG_QUEUE};
  if (Array.isArray(queued)) queued.splice(0, queued.length).forEach(function (run) { call(run); });
  function start() {
    if (started) return;
    var own = startupConfig();
    if (typeof config.AuthorInit === 'function') call(config.AuthorInit);
    if (typeof own.ready === 'function') {
      try { own.ready.call(startup); } catch (error) { later(error); defaultReady(); }
      resolveStartup();
    } else defaultReady();
    started = true;
    waiting.splice(0, waiting.length).forEach(call);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else setTimeout(start, 0);
})();`;
}

/**
 * A version 2 `text/x-mathjax-config` script, as an ordinary script: its code
 * runs once the MathJax stand-in exists, before the first typesetting.
 */
export function mathJaxConfigSource(code: string): string {
  return `(function (run) {
  var current = window.MathJax;
  if (current && current.qftStandIn) { try { run(); } catch (error) { setTimeout(function () { throw error; }); } }
  else (window.${MATHJAX_CONFIG_QUEUE} = window.${MATHJAX_CONFIG_QUEUE} || []).push(run);
})(function () {
${code}
});`;
}

/**
 * Reveal.js plugins that the deck lists in `plugins: [ … ]` but whose script
 * was left out. Each name that is still undefined when this runs becomes a
 * plugin that does nothing, as a function returning `{ id, init }`, which
 * Reveal.js accepts both as a plugin and as a plugin factory. Any other
 * member of either is a function that does nothing (review VF2b.8), so that
 * a key bound to `RevealChalkboard.toggleNotesCanvas()` does nothing instead
 * of throwing; `then` and symbol keys stay undefined, so the stub is never
 * taken for a promise or an iterable. `typeof` on a name declared later with
 * let or const throws (temporal dead zone), hence one try per name. `names`
 * must be plain identifiers.
 */
export function pluginStubSource(names: readonly string[]): string {
  const valid = names.filter((name) => /^[A-Za-z_$][\w$]*$/.test(name));
  const lines = valid.map((name) => `  try { if (typeof ${name} === 'undefined') window[${JSON.stringify(name)}] = unavailable(${JSON.stringify(`${name}-unavailable`)}); } catch (error) {}`);
  return `(function () {
  function nothing() {}
  function quiet(target) {
    if (typeof Proxy !== 'function') return target;
    return new Proxy(target, {
      get: function (object, key) {
        if (key in object || typeof key === 'symbol' || key === 'then') return object[key];
        return nothing;
      },
    });
  }
  function unavailable(id) {
    return quiet(function () { return quiet({ id: id, init: nothing }); });
  }
${lines.join('\n')}
})();`;
}

/** What the dependency adapter does with one entry of Reveal's 3.x dependency list. */
export type DependencyAction =
  /** Register the plugin that this global defines (the bundled build was inlined before). */
  | { plugin: string }
  /** The deck's own file was inlined before: drop the entry, run its callback. */
  | { inlined: true }
  /** Nothing to load: drop the entry. */
  | { skip: true };

/**
 * Reveal.js 3.x decks list plugins as `dependencies: [{ src, async, callback,
 * condition }]`, which Reveal loads as separate script files. The linker
 * inlines those files instead; this adapter, placed just before the script
 * that calls Reveal.initialize, rewrites the list to match: bundled plugins
 * are registered as plugin objects, inlined deck files run their callbacks.
 */
export function dependencyAdapterSource(actions: Record<string, DependencyAction>): string {
  const table = JSON.stringify(actions).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `(function (actions) {
  var reveal = window.Reveal;
  if (!reveal || typeof reveal.initialize !== 'function') return;
  var initialize = reveal.initialize;
  var own = Object.prototype.hasOwnProperty;
  reveal.initialize = function (options) {
    if (options && Array.isArray(options.dependencies)) {
      var kept = [], callbacks = [];
      options.dependencies.forEach(function (item) {
        var action = item && typeof item.src === 'string' && own.call(actions, item.src) ? actions[item.src] : undefined;
        if (!action) { kept.push(item); return; }
        if (typeof item.condition === 'function' && !item.condition()) return;
        if (action.plugin) {
          var source = window[action.plugin];
          var instance = typeof source === 'function' ? source() : source;
          if (instance && typeof instance.id === 'string') kept.push(instance);
        } else if (action.inlined && typeof item.callback === 'function') callbacks.push(item.callback);
      });
      options = Object.assign({}, options, { dependencies: kept });
      callbacks.forEach(function (callback) {
        try { callback(); } catch (error) { setTimeout(function () { throw error; }); }
      });
    }
    return initialize.apply(this, [options].concat(Array.prototype.slice.call(arguments, 1)));
  };
})(${table});`;
}

/**
 * Reveal splits data-background-video at commas, which breaks a data: URI.
 * Before the deck starts, and for slides that Markdown creates later, swap
 * each embedded video for an equivalent blob: URL.
 */
export function mediaHelperSource(): string {
  return `(function () {
  var name = 'data-background-video';
  function convert(element) {
    var value = element.getAttribute && element.getAttribute(name);
    if (!value || value.slice(0, 5) !== 'data:') return;
    var comma = value.indexOf(',');
    if (comma < 0 || !/;base64$/i.test(value.slice(0, comma))) return;
    try {
      var binary = atob(value.slice(comma + 1)), bytes = new Uint8Array(binary.length);
      for (var index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      element.setAttribute(name, URL.createObjectURL(new Blob([bytes], { type: value.slice(5, comma).split(';')[0] })));
    } catch (error) { element.removeAttribute(name); }
  }
  function scan(root) {
    convert(root);
    if (root.querySelectorAll) Array.prototype.forEach.call(root.querySelectorAll('[' + name + ']'), convert);
  }
  scan(document.documentElement);
  new MutationObserver(function (records) {
    records.forEach(function (record) {
      if (record.type === 'attributes') convert(record.target);
      else Array.prototype.forEach.call(record.addedNodes, function (node) { if (node.nodeType === 1) scan(node); });
    });
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: [name] });
})();`;
}

export interface HandlerSource {
  /** Event type: "click" for onclick. */
  event: string;
  /** The attribute's code, unchanged. */
  code: string;
  /** Always cancel the default action (converted javascript: links). */
  prevent?: boolean;
}

/**
 * The equivalent of inline event-handler attributes, which the player's
 * policy blocks: the same code with the same `this`, `event` and scope
 * (document, then the form, then the element) and the same meaning of
 * `return false`. `target` is a selector for the element, or "window" for the
 * window events that <body onload> and its kind set.
 */
export function handlerScriptSource(target: string, handlers: HandlerSource[]): string {
  const windowTarget = target === 'window';
  const registrations = handlers.map(({ event, code, prevent }) => {
    const scope = windowTarget ? 'with (document) {' : 'with (document) with (this.form || {}) with (this) {';
    return `  element.addEventListener(${JSON.stringify(event)}, function (event) {
    var result = function (event) { ${scope}
${code}
} }.call(this, event);
    if (${prevent ? 'true' : 'result === false'}) event.preventDefault();
  });`;
  }).join('\n');
  const element = windowTarget ? 'window' : `document.querySelector(${JSON.stringify(target)})`;
  return `(function (element) {
  if (!element) return;
${registrations}
})(${element});`;
}

/**
 * The onload (or onerror) attribute of a script that the linker replaced or
 * left out, run once where the browser would have run it: `this` is the
 * element that `target` selects (the replacement), or this script itself when
 * nothing replaced the original; `event` is an Event of that type.
 */
export function scriptEventSource(type: 'load' | 'error', code: string, target?: string): string {
  const element = target === undefined ? 'document.currentScript' : `document.querySelector(${JSON.stringify(target)}) || document.currentScript`;
  // The event parameter is the innermost scope, as in the browser: the
  // element's own legacy event property must not hide it (review X3.6).
  return `(function (element) {
  (function () { with (document) with (this) { (function (event) {
${code}
}).call(this, new Event(${JSON.stringify(type)})); } }).call(element);
})(${element});`;
}
