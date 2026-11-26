/**
 * Small scripts the deck linker inserts into a linked deck, and the escaping
 * that keeps inlined code inside its <script> element. Every snippet runs
 * only inside the presentation sandbox, as part of the deck; none of them is
 * ever evaluated by the site. Each inserted element carries
 * data-qft-linker="<name>" so that linking a linked deck again changes nothing.
 */
export const LINKER_MARKER = 'data-qft-linker';

/** Names of the inserted scripts, as the values of data-qft-linker. */
export type LinkerScript = 'math' | 'dependencies' | 'media' | 'handlers';

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
 * Reveal's math plugin in all its forms (RevealMath, RevealMath.KaTeX,
 * MathJax2, MathJax3, MathJax4) loads MathJax or KaTeX from a CDN at run time.
 * This stand-in has the same shape and typesets with the bundled KaTeX
 * auto-render, using the delimiters and macros from the deck's configuration.
 */
export function mathStandInSource(): string {
  return `(function () {
  if (window.RevealMath && window.RevealMath.qftStandIn) return;
  var ignored = ['script', 'noscript', 'style', 'textarea', 'pre', 'code'];
  var katexDelimiters = [
    { left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false },
    { left: '\\\\(', right: '\\\\)', display: false }, { left: '\\\\[', right: '\\\\]', display: true }
  ];
  var mathjaxInline = [['$', '$'], ['\\\\(', '\\\\)']];
  var mathjaxDisplay = [['$$', '$$'], ['\\\\[', '\\\\]']];
  function pairs(list, display) {
    return (Array.isArray(list) ? list : []).filter(function (pair) {
      return Array.isArray(pair) && typeof pair[0] === 'string' && typeof pair[1] === 'string' && pair[0];
    }).map(function (pair) { return { left: pair[0], right: pair[1], display: display }; });
  }
  function macros(source) {
    var result = {};
    if (source && typeof source === 'object') Object.keys(source).forEach(function (name) {
      var value = Array.isArray(source[name]) ? source[name][0] : source[name];
      if (typeof value === 'string') result[name.charAt(0) === '\\\\' ? name : '\\\\' + name] = value;
    });
    return result;
  }
  function longestFirst(list) {
    return list.map(function (item, index) { return [item, index]; }).sort(function (a, b) {
      return b[0].left.length - a[0].left.length || a[1] - b[1];
    }).map(function (entry) { return entry[0]; });
  }
  function options(id, config) {
    if (id === 'katex') {
      var given = config.katex || {}, result = { throwOnError: false };
      Object.keys(given).forEach(function (key) {
        if (key !== 'local' && key !== 'version' && key !== 'extensions') result[key] = given[key];
      });
      result.delimiters = Array.isArray(result.delimiters) ? result.delimiters : katexDelimiters;
      result.ignoredTags = Array.isArray(result.ignoredTags) ? result.ignoredTags : ignored;
      return result;
    }
    var settings = (id === 'mathjax2' ? (config.mathjax2 || config.math) : config[id]) || {};
    var tex = (id === 'mathjax2' ? settings.tex2jax : settings.tex) || {};
    var skip = id === 'mathjax2' ? tex.skipTags : settings.options && settings.options.skipHtmlTags;
    return {
      throwOnError: false,
      delimiters: longestFirst(pairs(tex.displayMath || mathjaxDisplay, true).concat(pairs(tex.inlineMath || mathjaxInline, false))),
      ignoredTags: Array.isArray(skip) ? skip : ignored,
      macros: macros(id === 'mathjax2' ? settings.TeX && settings.TeX.Macros : tex.macros)
    };
  }
  function plugin(id) {
    return function () {
      return {
        id: id,
        init: function (deck) {
          var typeset = function () {
            if (typeof window.renderMathInElement !== 'function') return;
            window.renderMathInElement(deck.getSlidesElement(), options(id, deck.getConfig() || {}));
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
