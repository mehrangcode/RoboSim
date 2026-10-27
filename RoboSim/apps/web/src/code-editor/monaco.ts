// Monaco, trimmed to what a sketch editor needs: the core API, a hand-picked feature set and the
// C++ grammar extended with Arduino names. Loaded lazily (its own chunk, NFR-PERF-04).
import 'monaco-editor/features/bracketMatching/register.js';
import 'monaco-editor/features/caretOperations/register.js';
import 'monaco-editor/features/clipboard/register.js';
import 'monaco-editor/features/codeEditor/register.js';
import 'monaco-editor/features/codicon/register.js';
import 'monaco-editor/features/comment/register.js';
import 'monaco-editor/features/contextmenu/register.js';
import 'monaco-editor/features/cursorUndo/register.js';
import 'monaco-editor/features/find/register.js';
import 'monaco-editor/features/folding/register.js';
import 'monaco-editor/features/format/register.js';
import 'monaco-editor/features/gotoError/register.js';
import 'monaco-editor/features/gotoLine/register.js';
import 'monaco-editor/features/hover/register.js';
import 'monaco-editor/features/indentation/register.js';
import 'monaco-editor/features/linesOperations/register.js';
import 'monaco-editor/features/multicursor/register.js';
import 'monaco-editor/features/parameterHints/register.js';
import 'monaco-editor/features/smartSelect/register.js';
import 'monaco-editor/features/snippet/register.js';
import 'monaco-editor/features/suggest/register.js';
import 'monaco-editor/features/wordHighlighter/register.js';
import 'monaco-editor/features/wordOperations/register.js';
// Contributions `editor.main` adds outside the feature registrations (suggest widget, core commands).
import 'monaco-editor/editor/browser/coreCommands.js';
import 'monaco-editor/editor/common/standaloneStrings.js';
import 'monaco-editor/editor/contrib/gotoError/browser/markerSelectionStatus.js';
import 'monaco-editor/editor/contrib/suggest/browser/suggestController.js';
import 'monaco-editor/editor/contrib/unicodeHighlighter/browser/unicodeHighlighter.js';
import * as monaco from 'monaco-editor/editor/editor.api.js';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import { conf as cppConf, language as cppLanguage } from 'monaco-editor/languages/definitions/cpp/cpp.js';
import {
  ARDUINO_API,
  declaredClass,
  isArduinoClass,
  lookupApi,
  membersOf,
  type ArduinoApiEntry,
} from '@robosim/shared';
import type { TFunction } from 'i18next';
import { apiDocMarkdown } from './api-docs.js';
import { formatSketch } from './format.js';

export { monaco };

export const ARDUINO_LANGUAGE = 'arduino';
export const THEMES = { light: 'robosim-light', dark: 'robosim-dark' } as const;

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };

const names = (kind: ArduinoApiEntry['kind']) => [
  ...new Set(ARDUINO_API.filter((e) => e.kind === kind && kind !== 'method').map((e) => e.name)),
];

/** Translator for hover and completion docs; set by the editor component (follows the UI language). */
let translate: TFunction | undefined;
export const setDocsTranslator = (t: TFunction) => {
  translate = t;
};

const docs = (e: ArduinoApiEntry): monaco.IMarkdownString | undefined => {
  const value = translate && apiDocMarkdown(e, translate);
  return value ? { value } : undefined;
};

/**
 * What `before` (the line up to a word) says about the word's owner: `x.` / `x->` → x's declared
 * class, `Cls::` → Cls. `undefined` when the word is not a member access.
 */
function ownerOf(model: monaco.editor.ITextModel, before: string): { cls?: string } | undefined {
  const member = /(\w+)\s*(?:\.|->|::)\s*$/.exec(before);
  if (!member?.[1]) return undefined;
  const ident = member[1];
  const cls = isArduinoClass(ident) ? ident : declaredClass(model.getValue(), ident);
  return cls ? { cls } : {};
}

/** Methods named `word` on an unknown owner: only when exactly one class has one. */
function uniqueMethod(word: string): ArduinoApiEntry | undefined {
  const found = ARDUINO_API.filter((e) => e.kind === 'method' && e.name === word);
  return found.length === 1 ? found[0] : undefined;
}

const hovers: monaco.languages.HoverProvider = {
  provideHover(model, position) {
    const word = model.getWordAtPosition(position);
    if (!word) return null;
    const before = model.getLineContent(position.lineNumber).slice(0, word.startColumn - 1);
    const owner = ownerOf(model, before);
    const entry = owner
      ? (lookupApi(word.word, owner) ?? (owner.cls ? undefined : uniqueMethod(word.word)))
      : lookupApi(word.word);
    const contents = entry && docs(entry);
    if (!contents) return null;
    return {
      range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
      contents: [contents],
    };
  },
};

/** The C++ Monarch grammar with Arduino functions, constants and types as their own token classes. */
function arduinoGrammar(): monaco.languages.IMonarchLanguage {
  const grammar = structuredClone(cppLanguage) as monaco.languages.IMonarchLanguage & {
    tokenizer: { root: [RegExp, { cases: Record<string, unknown> }][] };
  };
  const identifiers = grammar.tokenizer.root.find(
    (rule) => Array.isArray(rule) && String(rule[0]) === String(/[a-zA-Z_]\w*/),
  );
  if (!identifiers) throw new Error('C++ grammar changed: identifier rule not found');
  identifiers[1].cases = {
    '@keywords': { token: 'keyword.$0' },
    '@arduinoFunctions': 'predefined',
    '@arduinoConstants': 'constant',
    '@arduinoTypes': 'type',
    '@default': 'identifier',
  };
  return {
    ...grammar,
    arduinoFunctions: names('function'),
    arduinoConstants: names('constant'),
    arduinoTypes: names('type'),
  };
}

const KIND = {
  function: monaco.languages.CompletionItemKind.Function,
  method: monaco.languages.CompletionItemKind.Method,
  constant: monaco.languages.CompletionItemKind.Constant,
  type: monaco.languages.CompletionItemKind.Class,
} as const;

/** API completions; after `x.` / `x->` / `Cls::` the members of x's declared class (all methods if unknown). */
const completions: monaco.languages.CompletionItemProvider = {
  triggerCharacters: ['.', '>', ':'],
  provideCompletionItems(model, position, context) {
    const word = model.getWordUntilPosition(position);
    const range = new monaco.Range(
      position.lineNumber,
      word.startColumn,
      position.lineNumber,
      word.endColumn,
    );
    const before = model.getLineContent(position.lineNumber).slice(0, word.startColumn - 1);
    const owner = ownerOf(model, before);
    // `>` and `:` only trigger on `->` and `::`, not on comparisons or labels.
    if (!owner && context.triggerCharacter && context.triggerCharacter !== '.') return { suggestions: [] };
    const entries = !owner
      ? ARDUINO_API.filter((e) => e.kind !== 'method' && !e.member)
      : owner.cls
        ? membersOf(owner.cls)
        : ARDUINO_API.filter((e) => e.kind === 'method');
    return {
      suggestions: entries.map((e) => {
        const documentation = docs(e);
        return {
          label: e.kind === 'method' && !owner?.cls ? { label: e.name, description: e.of ?? '' } : e.name,
          kind: KIND[e.kind],
          detail: e.detail.split('\n')[0] ?? e.detail,
          ...(documentation ? { documentation } : {}),
          insertText: e.insert ?? e.name,
          insertTextRules: e.insert
            ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
            : monaco.languages.CompletionItemInsertTextRule.None,
          range,
        };
      }),
    };
  },
};

// Arduino IDE 2 palette: functions orange, constants and types teal.
monaco.editor.defineTheme(THEMES.light, {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'predefined', foreground: 'D35400' },
    { token: 'constant', foreground: '00979D' },
    { token: 'type', foreground: '00979D' },
  ],
  colors: {},
});
monaco.editor.defineTheme(THEMES.dark, {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'predefined', foreground: 'F39C12' },
    { token: 'constant', foreground: '4DC3C8' },
    { token: 'type', foreground: '4DC3C8' },
  ],
  colors: {},
});

monaco.languages.register({ id: ARDUINO_LANGUAGE, extensions: ['.ino', '.h', '.hpp', '.c', '.cpp'] });
monaco.languages.setLanguageConfiguration(ARDUINO_LANGUAGE, cppConf);
monaco.languages.setMonarchTokensProvider(ARDUINO_LANGUAGE, arduinoGrammar());
monaco.languages.registerCompletionItemProvider(ARDUINO_LANGUAGE, completions);
monaco.languages.registerHoverProvider(ARDUINO_LANGUAGE, hovers);
// Shift+Alt+F / "Format Document" (FR-COD-05); the formatter's WASM loads on first use.
monaco.languages.registerDocumentFormattingEditProvider(ARDUINO_LANGUAGE, {
  async provideDocumentFormattingEdits(model) {
    const source = model.getValue();
    const formatted = await formatSketch(source, model.uri.path.split('/').pop() ?? 'sketch.ino');
    return formatted === source ? [] : [{ range: model.getFullModelRange(), text: formatted }];
  },
});
