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
import { ARDUINO_API, type ArduinoApiEntry } from '@robosim/shared';

export { monaco };

export const ARDUINO_LANGUAGE = 'arduino';
export const THEMES = { light: 'robosim-light', dark: 'robosim-dark' } as const;

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };

const names = (kind: ArduinoApiEntry['kind']) =>
  ARDUINO_API.filter((e) => e.kind === kind && !e.of).map((e) => e.name);

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

/** Core API completions; after `x.` only methods (Serial's for `Serial.`, library classes' otherwise). */
const completions: monaco.languages.CompletionItemProvider = {
  triggerCharacters: ['.'],
  provideCompletionItems(model, position) {
    const word = model.getWordUntilPosition(position);
    const range = new monaco.Range(
      position.lineNumber,
      word.startColumn,
      position.lineNumber,
      word.endColumn,
    );
    const before = model.getLineContent(position.lineNumber).slice(0, word.startColumn - 1);
    const member = /(\w+)\s*\.\s*$/.exec(before);
    const entries = member
      ? ARDUINO_API.filter((e) => e.kind === 'method' && (member[1] === 'Serial') === (e.of === 'Serial'))
      : ARDUINO_API.filter((e) => e.kind !== 'method');
    return {
      suggestions: entries.map((e) => ({
        label: e.name,
        kind: KIND[e.kind],
        detail: e.detail,
        insertText: e.insert ?? e.name,
        insertTextRules: e.insert
          ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
          : monaco.languages.CompletionItemInsertTextRule.None,
        range,
      })),
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
