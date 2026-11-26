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
          imports.push({ kind: 'dynamic', start: token.start, end: close.end, specifier: unquote(argument.value) });
        } else imports.push({ kind: 'dynamic', start: token.start, end: next.end });
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
