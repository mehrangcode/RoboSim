import type { BuildDiagnostic } from '@robosim/shared';
import { addApiDocs } from '@robosim/i18n/apidocs';
import { useEffect, useId, useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ARDUINO_LANGUAGE, THEMES, monaco, setDocsTranslator } from './monaco.js';
import type { EditorImplProps } from './types.js';

const SEVERITY: Record<BuildDiagnostic['severity'], monaco.MarkerSeverity> = {
  error: monaco.MarkerSeverity.Error,
  warning: monaco.MarkerSeverity.Warning,
  note: monaco.MarkerSeverity.Info,
};

const darkScheme = () => window.matchMedia('(prefers-color-scheme: dark)');

/**
 * Monaco on the sketch files (FR-COD-01): one model per file (undo history survives tab switches),
 * build diagnostics as inline markers (FR-COD-03), theme follows the system colour scheme.
 */
export function MonacoEditor({
  files,
  active,
  onChange,
  diagnostics,
  reveal,
  label,
  readOnly = false,
}: EditorImplProps) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const models = useRef(new Map<string, monaco.editor.ITextModel>());
  /** Set while the editor applies prop changes, so they are not echoed back through onChange. */
  const syncing = useRef(false);
  const onChangeRef = useRef(onChange);
  useLayoutEffect(() => {
    onChangeRef.current = onChange;
  });
  const scope = useId().replace(/[^a-z0-9]/gi, '');
  const { t, i18n } = useTranslation();
  // Hover and completion docs in the UI language (FR-COD-02); the bundle ships with this chunk.
  useLayoutEffect(() => {
    addApiDocs(i18n);
    setDocsTranslator(t);
  }, [i18n, t]);

  useEffect(() => {
    editor.current?.updateOptions({ readOnly });
  }, [readOnly]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const scheme = darkScheme();
    const ed = monaco.editor.create(el, {
      model: null,
      language: ARDUINO_LANGUAGE,
      theme: scheme.matches ? THEMES.dark : THEMES.light,
      ariaLabel: label,
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 13,
      // `<=` must not render as `≤`: learners copy what they see.
      fontLigatures: false,
      tabSize: 2,
      insertSpaces: true,
      scrollBeyondLastLine: false,
      renderLineHighlight: 'line',
      fixedOverflowWidgets: true,
      unicodeHighlight: { ambiguousCharacters: true, invisibleCharacters: true },
      readOnly,
    });
    editor.current = ed;
    const changes = ed.onDidChangeModelContent(() => {
      const model = ed.getModel();
      if (syncing.current || !model) return;
      const name = [...models.current].find(([, m]) => m === model)?.[0];
      if (name) onChangeRef.current(name, model.getValue());
    });
    const theme = () => monaco.editor.setTheme(scheme.matches ? THEMES.dark : THEMES.light);
    scheme.addEventListener('change', theme);
    const owned = models.current;
    return () => {
      scheme.removeEventListener('change', theme);
      changes.dispose();
      ed.dispose();
      for (const m of owned.values()) m.dispose();
      owned.clear();
      editor.current = null;
    };
    // The editor lives as long as the component; the label is updated below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => editor.current?.updateOptions({ ariaLabel: label }), [label]);

  // Files → models: create, update on outside changes (restore, import), drop removed ones.
  useEffect(() => {
    const ed = editor.current;
    if (!ed) return;
    const own = models.current;
    syncing.current = true;
    try {
      for (const f of files) {
        let model = own.get(f.name);
        if (!model) {
          model = monaco.editor.createModel(
            f.content,
            ARDUINO_LANGUAGE,
            monaco.Uri.parse(`inmemory://sketch-${scope}/${f.name}`),
          );
          own.set(f.name, model);
        } else if (model.getValue() !== f.content) {
          // As one undoable edit, so Ctrl+Z can take back a restore.
          model.pushEditOperations([], [{ range: model.getFullModelRange(), text: f.content }], () => null);
        }
      }
      for (const [name, model] of own)
        if (!files.some((f) => f.name === name)) {
          model.dispose();
          own.delete(name);
        }
      const model = own.get(active) ?? null;
      if (ed.getModel() !== model) ed.setModel(model);
    } finally {
      syncing.current = false;
    }
  }, [files, active, scope]);

  // Build diagnostics → markers on every file's model.
  useEffect(() => {
    for (const [name, model] of models.current) {
      const markers = diagnostics
        .filter((d) => d.file === name && d.line > 0 && d.line <= model.getLineCount())
        .map((d) => {
          const column = Math.max(1, d.column);
          const word = model.getWordAtPosition({ lineNumber: d.line, column });
          return {
            severity: SEVERITY[d.severity],
            message: d.message,
            startLineNumber: d.line,
            endLineNumber: d.line,
            startColumn: d.column ? (word?.startColumn ?? column) : 1,
            endColumn: d.column ? (word?.endColumn ?? column + 1) : model.getLineMaxColumn(d.line),
          };
        });
      monaco.editor.setModelMarkers(model, 'build', markers);
    }
  }, [diagnostics, files]);

  useEffect(() => {
    const ed = editor.current;
    if (!ed || !reveal || reveal.file !== active || reveal.line < 1) return;
    const position = { lineNumber: reveal.line, column: Math.max(1, reveal.column) };
    ed.setPosition(position);
    ed.revealLineInCenterIfOutsideViewport(reveal.line);
    ed.focus();
  }, [reveal, active]);

  return <div ref={host} dir="ltr" className="h-full min-h-0 w-full" />;
}
