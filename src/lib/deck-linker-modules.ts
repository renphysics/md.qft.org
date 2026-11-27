/**
 * Finds the import statements of a deck's ES-module script without running
 * or fully parsing it: a small tokenizer that understands comments, strings,
 * template literals and regular-expression literals, which is all that is
 * needed to tell an `import` keyword from the same letters in data.
 */

export interface ModuleImport {
  /** Offsets of the whole statement or expression in the source (end exclusive). */
  start: number;
  end: number;
  /**
   * import: `import x from 'y'`; side-effect: `import 'y'`; export-from:
   * `export … from 'y'`; dynamic: `import('y')` (specifier undefined when
   * the argument is not a plain string).
   */
  kind: 'import' | 'side-effect' | 'export-from' | 'dynamic';
  specifier?: string;
  /** For kind 'import': the text between `import` and `from`. */
  clause?: string;
  /**
   * For kind 'dynamic': the offset just after the call's closing parenthesis,
   * whatever its argument; undefined when the call is never closed.
   */
  callEnd?: number;
}

export interface ModuleScan {
  imports: ModuleImport[];
  /** False when the source ended inside a comment, string, template or regular expression. */
  complete: boolean;
}

type TokenType = 'name' | 'string' | 'template' | 'regex' | 'number' | 'punct';
interface Token { type: TokenType; value: string; start: number; end: number }

/** After these words a slash starts a regular expression, not a division. */
const KEYWORDS_BEFORE_EXPRESSION = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else',
  'yield', 'await', 'export', 'default', 'extends',
]);

function unquote(literal: string): string {
  const body = literal.slice(1, -1);
  return body.replace(/\\(?:u\{([0-9a-fA-F]+)\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|(\r\n|[\s\S]))/g,
    (_match, braced, unicode, hex, other) => {
      if (braced || unicode || hex) {
        const code = parseInt(braced || unicode || hex, 16);
        return code <= 0x10ffff ? String.fromCodePoint(code) : '';
      }
      if (/^[\r\n\u2028\u2029]/.test(other)) return '';
      return ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0' } as Record<string, string>)[other] ?? other;
    });
}

function tokenize(code: string): { tokens: Token[]; complete: boolean } {
  const tokens: Token[] = [];
  // Template literals nest: each entry counts the braces open inside one ${…}.
  const templates: number[] = [];
  let position = 0;
  const length = code.length;
  const last = () => tokens[tokens.length - 1];
  const regexAllowed = () => {
    const previous = last();
    if (!previous) return true;
    if (previous.type === 'name') return KEYWORDS_BEFORE_EXPRESSION.has(previous.value);
    if (previous.type === 'punct') return previous.value !== ')' && previous.value !== ']';
    return false;
  };
  /** Reads template characters from `from` up to the closing backtick or the next ${. */
  const templatePart = (from: number): number | undefined => {
    for (let index = from; index < length; index += 1) {
      const character = code[index];
      if (character === '\\') { index += 1; continue; }
      if (character === '`') return index + 1;
      if (character === '$' && code[index + 1] === '{') { templates.push(0); return index + 2; }
    }
    return undefined;
  };
  while (position < length) {
    const character = code[position];
    if (/\s/.test(character)) { position += 1; continue; }
    const start = position;
    if (character === '/' && code[position + 1] === '/') {
      const end = code.slice(position).search(/[\n\r\u2028\u2029]/);
      position = end < 0 ? length : position + end;
      continue;
    }
    if (character === '/' && code[position + 1] === '*') {
      const end = code.indexOf('*/', position + 2);
      if (end < 0) return { tokens, complete: false };
      position = end + 2;
      continue;
    }
    if (character === '"' || character === "'") {
      let index = position + 1;
      for (; index < length && code[index] !== character; index += 1) {
        if (code[index] === '\\') index += 1;
        else if (code[index] === '\n') return { tokens, complete: false };
      }
      if (index >= length) return { tokens, complete: false };
      position = index + 1;
      tokens.push({ type: 'string', value: code.slice(start, position), start, end: position });
      continue;
    }
    if (character === '`') {
      const end = templatePart(position + 1);
      if (end === undefined) return { tokens, complete: false };
      position = end;
      tokens.push({ type: 'template', value: '`', start, end: position });
      continue;
    }
    if (character === '}' && templates.length && templates[templates.length - 1] === 0) {
      templates.pop();
      const end = templatePart(position + 1);
      if (end === undefined) return { tokens, complete: false };
      position = end;
      tokens.push({ type: 'template', value: '}`', start, end: position });
      continue;
    }
    if (character === '/' && regexAllowed()) {
      let index = position + 1;
      let inClass = false;
      for (; index < length; index += 1) {
        const current = code[index];
        if (current === '\\') { index += 1; continue; }
        if (current === '\n' || current === '\r') return { tokens, complete: false };
        if (current === '[') inClass = true;
        else if (current === ']') inClass = false;
        else if (current === '/' && !inClass) break;
      }
      if (index >= length) return { tokens, complete: false };
      position = index + 1;
      while (position < length && /[\w$]/.test(code[position])) position += 1;
      tokens.push({ type: 'regex', value: code.slice(start, position), start, end: position });
      continue;
    }
    const name = /^(?:[A-Za-z_$\u0080-\uffff]|\\u)(?:[\w$\u0080-\uffff]|\\u[0-9a-fA-F{}]+)*/.exec(code.slice(position, position + 256));
    if (name && !/^\d/.test(character)) {
      position += name[0].length;
      tokens.push({ type: 'name', value: name[0], start, end: position });
      continue;
    }
    if (/\d/.test(character) || (character === '.' && /\d/.test(code[position + 1] ?? ''))) {
      const number = /^(?:0[xXoObB][\da-fA-F_]+n?|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?n?)/.exec(code.slice(position, position + 64));
      position += number ? number[0].length : 1;
      tokens.push({ type: 'number', value: code.slice(start, position), start, end: position });
      continue;
    }
    if (character === '#') {
      const name = /^#[\w$]+/.exec(code.slice(position, position + 256));
      if (name) { position += name[0].length; tokens.push({ type: 'name', value: name[0], start, end: position }); continue; }
    }
    if (character === '{' && templates.length) templates[templates.length - 1] += 1;
    if (character === '}' && templates.length) templates[templates.length - 1] -= 1;
    const punct = /^(?:\?\.(?!\d)|\.\.\.|=>|[=!]==?|[<>]=?|&&|\|\||\?\?|[-+*/%&|^~!?:;,.(){}[\]<>=@])/.exec(code.slice(position, position + 4));
    position += punct ? punct[0].length : 1;
    tokens.push({ type: 'punct', value: punct ? punct[0] : character, start, end: position });
  }
  return { tokens, complete: templates.length === 0 };
}

/** The end of an import statement: optional `with { … }` / `assert { … }`, then an optional semicolon. */
function statementEnd(tokens: Token[], index: number): { end: number; next: number } {
  let next = index + 1;
  if (tokens[next]?.type === 'name' && (tokens[next].value === 'with' || tokens[next].value === 'assert') && tokens[next + 1]?.value === '{') {
    let depth = 0;
    for (next += 1; next < tokens.length; next += 1) {
      if (tokens[next].value === '{') depth += 1;
      else if (tokens[next].value === '}' && --depth === 0) { next += 1; break; }
    }
  }
  let end = tokens[next - 1].end;
  if (tokens[next]?.value === ';') { end = tokens[next].end; next += 1; }
  return { end, next };
}

/** The end offset of the parenthesis that closes the one at tokens[open], or undefined. */
function closingParenthesis(tokens: Token[], open: number): number | undefined {
  let depth = 0;
  for (let index = open; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== 'punct') continue;
    if (token.value === '(') depth += 1;
    else if (token.value === ')' && --depth === 0) return token.end;
  }
  return undefined;
}

/** Every import of a module script, in source order. */
export function scanModuleImports(code: string): ModuleScan {
  const { tokens, complete } = tokenize(code);
  const imports: ModuleImport[] = [];
  let depth = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type === 'punct') {
      if (token.value === '{' || token.value === '(' || token.value === '[') depth += 1;
      else if (token.value === '}' || token.value === ')' || token.value === ']') depth = Math.max(0, depth - 1);
      continue;
    }
    if (token.type !== 'name') continue;
    const previous = tokens[index - 1];
    if (previous && previous.type === 'punct' && (previous.value === '.' || previous.value === '?.')) continue;
    const next = tokens[index + 1];
    if (token.value === 'import') {
      if (!next) continue;
      if (next.value === '.') continue; // import.meta
      if (next.value === '(') {
        const argument = tokens[index + 2];
        const close = tokens[index + 3];
        if (argument?.type === 'string' && close?.value === ')') {
          imports.push({ kind: 'dynamic', start: token.start, end: close.end, specifier: unquote(argument.value), callEnd: close.end });
        } else {
          const callEnd = closingParenthesis(tokens, index + 1);
          imports.push({ kind: 'dynamic', start: token.start, end: next.end, ...(callEnd === undefined ? {} : { callEnd }) });
        }
        continue;
      }
      if (depth !== 0) continue;
      if (next.type === 'string') {
        const { end, next: after } = statementEnd(tokens, index + 1);
        imports.push({ kind: 'side-effect', start: token.start, end, specifier: unquote(next.value) });
        index = after - 1;
        continue;
      }
      for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
        const current = tokens[cursor];
        if (current.value === ';' || (current.type === 'name' && current.value === 'import')) break;
        if (current.type === 'name' && current.value === 'from' && tokens[cursor + 1]?.type === 'string') {
          const { end, next: after } = statementEnd(tokens, cursor + 1);
          imports.push({
            kind: 'import', start: token.start, end, specifier: unquote(tokens[cursor + 1].value),
            clause: code.slice(next.start, current.start).trim(),
          });
          index = after - 1;
          break;
        }
      }
      continue;
    }
    if (token.value === 'export' && depth === 0 && next && (next.value === '*' || next.value === '{')) {
      for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
        const current = tokens[cursor];
        if (current.value === ';' || (current.type === 'name' && (current.value === 'export' || current.value === 'import'))) break;
        if (current.type === 'name' && current.value === 'from' && tokens[cursor + 1]?.type === 'string') {
          const { end, next: after } = statementEnd(tokens, cursor + 1);
          imports.push({ kind: 'export-from', start: token.start, end, specifier: unquote(tokens[cursor + 1].value) });
          index = after - 1;
          break;
        }
      }
    }
  }
  return { imports, complete };
}

export interface StringLiteral {
  /** Offsets of the literal including its quotes (end exclusive). */
  start: number;
  end: number;
  /** The text it stands for, escapes resolved. */
  value: string;
}

/**
 * Every quoted string and every template literal without substitutions,
 * other than tagged templates, in source order: the places where replacing
 * the whole literal with another string literal keeps the code valid.
 * Undefined when the source could not be read to its end.
 */
export function scanStringLiterals(code: string): StringLiteral[] | undefined {
  const { tokens, complete } = tokenize(code);
  if (!complete) return undefined;
  const literals: StringLiteral[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type === 'string') {
      literals.push({ start: token.start, end: token.end, value: unquote(token.value) });
      continue;
    }
    // A whole template is one token that starts and ends with a backtick; a
    // template with substitutions is split at each ${ and is skipped.
    if (token.type !== 'template' || token.value !== '`' || token.end - token.start < 2 || code[token.end - 1] !== '`') continue;
    const previous = tokens[index - 1];
    const tagged = previous && ((previous.type === 'name' && !KEYWORDS_BEFORE_EXPRESSION.has(previous.value))
      || previous.type === 'template' || previous.value === ')' || previous.value === ']');
    if (!tagged) literals.push({ start: token.start, end: token.end, value: unquote(code.slice(token.start, token.end)) });
  }
  return literals;
}

export interface ImportBinding {
  /** The local name. */
  local: string;
  /** 'default' or '*' (the namespace object). */
  imported: 'default' | '*';
}

/**
 * The bindings of an import clause, when every one of them is the default
 * export or the namespace: `X`, `* as X`, `X, * as Y`, `{ default as X }`.
 * Libraries in their classic builds have nothing else, so any named import
 * returns undefined.
 */
export function defaultImportBindings(clause: string): ImportBinding[] | undefined {
  const identifier = '[A-Za-z_$][\\w$]*';
  const bindings: ImportBinding[] = [];
  let rest = clause.trim();
  const leading = new RegExp(`^(${identifier})\\s*(?:,\\s*|$)`).exec(rest);
  if (leading && leading[1] !== 'type') {
    bindings.push({ local: leading[1], imported: 'default' });
    rest = rest.slice(leading[0].length).trim();
  }
  if (rest) {
    const namespace = new RegExp(`^\\*\\s*as\\s+(${identifier})$`).exec(rest);
    const named = /^\{([\s\S]*)\}$/.exec(rest);
    if (namespace) bindings.push({ local: namespace[1], imported: '*' });
    else if (named) {
      for (const item of named[1].split(',').map((part) => part.trim()).filter(Boolean)) {
        const match = new RegExp(`^default\\s+as\\s+(${identifier})$`).exec(item);
        if (!match) return undefined;
        bindings.push({ local: match[1], imported: 'default' });
      }
    } else return undefined;
  }
  return bindings.length ? bindings : undefined;
}

/**
 * The code's tokens joined by spaces, without its comments (review W3.4):
 * for scans that must not count text in a comment. The code itself when it
 * could not be read to its end.
 */
export function withoutComments(code: string): string {
  if (!code.includes('/')) return code;
  const { tokens, complete } = tokenize(code);
  return complete ? tokens.map((token) => token.value).join(' ') : code;
}

export interface NavigationRewrite {
  code: string;
  /** The web addresses, in source order, as the literals give them. */
  addresses: string[];
}

/** At most this many rewrites in one piece of code; the rest is left as it is. */
const MAX_NAVIGATION_REWRITES = 200;
const LOCATION_OWNERS = new Set(['window', 'self', 'top', 'parent', 'document']);
/** Tokens after which `location = …` starts a statement (not a declaration or a parameter). */
const STATEMENT_STARTS = new Set([';', '{', '}', ')', '=>', 'else']);
const STATEMENT_ENDS = new Set([';', '}', ')', ',']);

/**
 * A script that sends the page to a website by changing its address
 * (review W1.1): `location.href = "https://…"`, `location = "…"`,
 * `location.assign("…")` and `location.replace("…")`, with an optional
 * window., self., top., parent. or document. (or window.top., window.parent.,
 * window.self.) before location and a complete
 * string literal (quotes, or a template without substitutions) that starts
 * with http://, https:// or //. Each becomes `window.open(LITERAL, "_blank")`
 * (`"https:" + LITERAL` for //), which the player offers as a link. Anything else is left alone; undefined
 * when nothing changes.
 */
export function rewriteScriptedNavigation(code: string): NavigationRewrite | undefined {
  if (!code.includes('location')) return undefined;
  const { tokens, complete } = tokenize(code);
  if (!complete) return undefined;
  const isLiteral = (token: Token | undefined) => !!token && (token.type === 'string'
    || (token.type === 'template' && token.value === '`' && token.end - token.start >= 2 && code[token.end - 1] === '`'));
  const web = (token: Token) => {
    const value = unquote(code.slice(token.start, token.end));
    return /^(?:https?:)?\/\//i.test(value) ? value : undefined;
  };
  const newLine = (from: number, to: number) => /[\n\r\u2028\u2029]/.test(code.slice(from, to));
  const edits: { start: number; end: number; literal: Token }[] = [];
  const addresses: string[] = [];
  for (let index = 0; index < tokens.length && edits.length < MAX_NAVIGATION_REWRITES; index += 1) {
    const token = tokens[index];
    if (token.type !== 'name' || token.value !== 'location') continue;
    let first = index;
    const dot = tokens[index - 1];
    if (dot && (dot.value === '.' || dot.value === '?.')) {
      const owner = tokens[index - 2];
      if (dot.value !== '.' || owner?.type !== 'name' || !LOCATION_OWNERS.has(owner.value)) continue;
      first = index - 2;
      // One window. before top, parent or self (review X3.7).
      if (['top', 'parent', 'self'].includes(owner.value) && tokens[index - 3]?.value === '.'
        && tokens[index - 4]?.type === 'name' && tokens[index - 4].value === 'window') first = index - 4;
      const before = tokens[first - 1];
      if (before && (before.value === '.' || before.value === '?.')) continue;
    }
    const at = (offset: number) => tokens[index + offset];
    let literal: Token | undefined;
    let last: Token | undefined;
    if (at(1)?.value === '.' && at(2)?.type === 'name' && (at(2).value === 'assign' || at(2).value === 'replace')
      && at(3)?.value === '(' && isLiteral(at(4)) && at(5)?.value === ')') {
      literal = at(4);
      last = at(5);
    } else {
      const property = at(1)?.value === '.' && at(2)?.type === 'name' && at(2).value === 'href';
      const equals = property ? 3 : 1;
      if (at(equals)?.value !== '=' || at(equals)?.type !== 'punct' || !isLiteral(at(equals + 1))) continue;
      if (!property && first === index) {
        // `var location = …` or a parameter's default value is not the page's address.
        const previous = tokens[index - 1];
        if (previous && !STATEMENT_STARTS.has(previous.value) && !newLine(previous.end, token.start)) continue;
      }
      literal = at(equals + 1);
      const next = at(equals + 2);
      if (next && !STATEMENT_ENDS.has(next.value) && !newLine(literal.end, next.start)) continue;
      last = literal;
    }
    const address = web(literal);
    if (address === undefined) continue;
    edits.push({ start: tokens[first].start, end: last.end, literal });
    addresses.push(address);
    index = tokens.indexOf(last, index);
  }
  if (!edits.length) return undefined;
  const parts: string[] = [];
  let position = 0;
  for (const { start, end, literal } of edits) {
    // The player opens only http and https; //host is an https address, as for links (review X3.1).
    const scheme = code.slice(literal.start + 1, literal.start + 3) === '//' ? '"https:" + ' : '';
    parts.push(code.slice(position, start), `window.open(${scheme}${code.slice(literal.start, literal.end)}, "_blank")`);
    position = end;
  }
  parts.push(code.slice(position));
  return { code: parts.join(''), addresses };
}
