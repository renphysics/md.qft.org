import { basicSetup } from 'codemirror';
import { isolateHistory } from '@codemirror/commands';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { tags } from '@lezer/highlight';

/**
 * A small code editor for a deck's text files, loaded only when the Source
 * files view opens. Each file keeps its own editor state, so moving between
 * files keeps every file's text, selection and undo history. The editor only
 * edits text: nothing typed here is run or fetched by the page.
 */

export interface DeckEditorFile {
  path: string;
  text: string;
  editable: boolean;
}

export interface DeckEditorOptions {
  parent: HTMLElement;
  /** The text of a file changed: typing, undo, or replace(). */
  onChange?: (path: string) => void;
  /** Ctrl+S or Cmd+S while the editor has focus. */
  onSave?: () => void;
}

export interface DeckEditor {
  /** Show a file. Its earlier state is kept when it was opened before. */
  open(file: DeckEditorFile): void;
  /** The file on show. */
  current(): string | undefined;
  /** The text of a file opened in this editor; undefined for files never opened. */
  text(path: string): string | undefined;
  /**
   * Set a file's text. By default the change can be undone; fresh starts the
   * file again with no history, as when the whole deck is restored.
   */
  replace(path: string, text: string, options?: { fresh?: boolean }): void;
  /** Forget every file, for the next deck. */
  clear(): void;
  focus(): void;
  destroy(): void;
}

/** Colours come from the site's theme variables, so the editor follows light and dark. */
const highlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword, tags.operatorKeyword, tags.definitionKeyword, tags.moduleKeyword, tags.modifier], color: 'var(--deck-code-keyword)' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp, tags.attributeValue], color: 'var(--deck-code-string)' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment], color: 'var(--deck-code-comment)', fontStyle: 'italic' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom, tags.unit, tags.color], color: 'var(--deck-code-number)' },
  { tag: [tags.tagName, tags.angleBracket], color: 'var(--deck-code-tag)' },
  { tag: [tags.attributeName, tags.propertyName], color: 'var(--deck-code-attribute)' },
  { tag: [tags.className, tags.typeName, tags.function(tags.variableName), tags.definition(tags.variableName)], color: 'var(--deck-code-name)' },
  { tag: tags.heading, color: 'var(--accent)', fontWeight: '600' },
  { tag: tags.strong, fontWeight: '600' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: [tags.link, tags.url], color: 'var(--deck-code-string)', textDecoration: 'underline' },
  { tag: [tags.meta, tags.processingInstruction, tags.documentMeta], color: 'var(--faint)' },
  { tag: tags.invalid, color: 'var(--deck-code-invalid)' },
]);

/** The language for a file, from its extension; plain text when none fits. */
export function deckLanguage(path: string): Extension {
  switch (/\.([A-Za-z0-9]+)$/.exec(path)?.[1].toLowerCase()) {
    case 'html': case 'htm': case 'vue': case 'svg': return html();
    case 'css': case 'scss': case 'less': return css();
    case 'js': case 'mjs': case 'cjs': return javascript();
    case 'jsx': return javascript({ jsx: true });
    case 'ts': case 'mts': case 'cts': return javascript({ typescript: true });
    case 'tsx': return javascript({ typescript: true, jsx: true });
    case 'json': case 'map': return json();
    case 'md': case 'markdown': return markdown();
    default: return [];
  }
}

const isDark = () => document.documentElement.dataset.theme === 'dark';

export function createDeckEditor(options: DeckEditorOptions): DeckEditor {
  const states = new Map<string, EditorState>();
  const dark = new Compartment();
  let path: string | undefined;
  // Suppresses onChange while a file's state is swapped in, not edited.
  let swapping = false;

  const stateFor = (file: DeckEditorFile): EditorState => EditorState.create({
    doc: file.text,
    extensions: [
      basicSetup,
      deckLanguage(file.path),
      syntaxHighlighting(highlight),
      dark.of(EditorView.darkTheme.of(isDark())),
      EditorState.readOnly.of(!file.editable),
      EditorView.editable.of(file.editable),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({
        'aria-label': `${file.path}${file.editable ? '' : ', read-only'}`,
        autocapitalize: 'off',
        // A read-only file is not editable, but stays reachable by keyboard for reading and scrolling.
        ...(file.editable ? {} : { tabindex: '0' }),
      }),
      keymap.of([{ key: 'Mod-s', preventDefault: true, stopPropagation: true, run: () => { options.onSave?.(); return true; } }]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !swapping && path) options.onChange?.(path);
      }),
    ],
  });

  const view = new EditorView({ parent: options.parent, state: EditorState.create({ doc: '' }) });
  view.dom.hidden = true;

  // Follow the site's theme switch while the editor is open.
  const observer = new MutationObserver(() => {
    view.dispatch({ effects: dark.reconfigure(EditorView.darkTheme.of(isDark())) });
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  const remember = () => { if (path) states.set(path, view.state); };

  const show = (next: string, state: EditorState) => {
    swapping = true;
    try {
      path = next;
      view.setState(state);
      view.dispatch({ effects: dark.reconfigure(EditorView.darkTheme.of(isDark())) });
    } finally { swapping = false; }
    view.dom.hidden = false;
  };

  return {
    open(file) {
      if (file.path === path) return;
      remember();
      show(file.path, states.get(file.path) ?? stateFor(file));
    },
    current: () => path,
    text(target) {
      if (target === path) return view.state.doc.toString();
      return states.get(target)?.doc.toString();
    },
    replace(target, text, replaceOptions = {}) {
      if (target === path) {
        if (replaceOptions.fresh) {
          show(target, stateFor({ path: target, text, editable: !view.state.readOnly }));
          options.onChange?.(target);
        } else if (view.state.doc.toString() !== text) {
          // An ordinary change, so Undo brings the earlier text back: one step
          // of its own, never joined with typing just before or after it.
          view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, annotations: isolateHistory.of('full') });
        }
        return;
      }
      const state = states.get(target);
      if (!state) return;
      // A file that is not on show starts again from the caller's text when it is next opened.
      if (replaceOptions.fresh) states.delete(target);
      else states.set(target, state.update({ changes: { from: 0, to: state.doc.length, insert: text } }).state);
      options.onChange?.(target);
    },
    clear() {
      states.clear();
      path = undefined;
      swapping = true;
      try { view.setState(EditorState.create({ doc: '' })); } finally { swapping = false; }
      view.dom.hidden = true;
    },
    focus() { if (path) view.focus(); },
    destroy() { observer.disconnect(); states.clear(); view.destroy(); },
  };
}
