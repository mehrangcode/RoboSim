import type { ArduinoLibrary, BuildDiagnostic } from '@robosim/shared';
import type { FindingView } from '@robosim/sim-runtime/client';
import { Button, Card, cn } from '@robosim/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CodeEditor } from '../code-editor/code-editor.js';
import type { EditorCommand, RevealRequest, SketchFile } from '../code-editor/types.js';
import { useFormat } from './format.js';
import type { BuildState } from './use-build.js';

/** Icon plus text, never colour alone. */
const SEVERITY_ICON = { error: '⛔', warning: '⚠️', note: 'ℹ️' } as const;

/**
 * Sketch editor with build feedback (FR-COD-01, FR-COD-03): the code editor over the sketch's
 * files, build status, and diagnostics with plain-language explanations that jump to their line.
 */
export function SketchPanel({
  files,
  onChange,
  onFilesChange,
  onCompile,
  onRestore,
  state,
  modified,
  fill = false,
  title,
  findings = [],
  readOnly = false,
  command = null,
  onLibraryAdd,
}: {
  files: readonly SketchFile[];
  onChange: (name: string, content: string) => void;
  /** Lets the learner add, rename and delete `.h`/`.cpp` files. */
  onFilesChange?: ((files: readonly SketchFile[]) => void) | undefined;
  /** Without these the panel has no buttons (the workspace compiles from its Run button). */
  onCompile?: (() => void) | undefined;
  onRestore?: (() => void) | undefined;
  state: BuildState;
  modified: boolean;
  /** Fill the parent's height (workspace pane) instead of a fixed-height editor. */
  fill?: boolean;
  title?: string | undefined;
  /** Safety findings of the loaded run; code-aware ones (FR-SAF-03) are marked on their sketch lines. */
  findings?: readonly FindingView[] | undefined;
  readOnly?: boolean;
  /** A code tool to run (format, library manager), e.g. from the command palette. */
  command?: EditorCommand | null;
  onLibraryAdd?: ((lib: ArduinoLibrary) => void) | undefined;
}) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const main = files.find((f) => f.name.endsWith('.ino'))?.name ?? files[0]?.name ?? '';
  const [selected, setSelected] = useState(main);
  const active = files.some((f) => f.name === selected) ? selected : main;
  const [reveal, setReveal] = useState<RevealRequest | null>(null);
  const diagnostics = state.status === 'done' ? state.result.diagnostics : [];
  // One marker per sketch line a code-aware finding points at, titled like the Safety panel.
  const inCode = findings.flatMap((f) =>
    (f.codeRefs ?? [])
      .filter((r) => files.some((file) => file.name === r.file))
      .map((r) => ({ finding: f, ...r, title: t(`${f.messageKey}.title`, f.params) })),
  );
  const markers: BuildDiagnostic[] = [
    ...diagnostics,
    ...inCode.map((c) => ({
      file: c.file,
      line: c.line,
      column: c.column,
      severity: c.finding.severity,
      message: c.title,
    })),
  ];

  /** Opens the diagnostic's file and puts the caret on its line. */
  const show = (d: Pick<BuildDiagnostic, 'file' | 'line' | 'column'>) => {
    if (d.line < 1 || !files.some((f) => f.name === d.file)) return;
    setSelected(d.file);
    setReveal((r) => ({ file: d.file, line: d.line, column: d.column, seq: (r?.seq ?? 0) + 1 }));
  };

  const building = state.status === 'building';
  const result = state.status === 'done' ? state.result : null;
  const errors = diagnostics.filter((d) => d.severity === 'error').length;

  return (
    <Card className={cn('p-3', fill && 'flex h-full min-h-0 flex-col rounded-none border-0')}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-ink-muted">{title ?? t('shell:lab.sketch.title')}</h2>
        <div className="ms-auto flex gap-2">
          {onRestore && (
            <Button size="sm" variant="secondary" onClick={onRestore} disabled={!modified || building}>
              {t('shell:lab.sketch.restore')}
            </Button>
          )}
          {onCompile && (
            <Button size="sm" onClick={onCompile} disabled={building} aria-busy={building}>
              {state.status === 'building' && state.progress?.phase === 'queued'
                ? t('shell:lab.sketch.queued', { position: state.progress.position })
                : building
                  ? t('shell:lab.sketch.compiling')
                  : t('shell:lab.sketch.compile')}
            </Button>
          )}
        </div>
      </div>
      <CodeEditor
        files={files}
        active={active}
        onActiveChange={setSelected}
        onChange={onChange}
        onFilesChange={onFilesChange}
        diagnostics={markers}
        reveal={reveal}
        label={t('shell:lab.sketch.editor')}
        readOnly={readOnly}
        command={command}
        onLibraryAdd={onLibraryAdd}
        className={fill ? 'min-h-0 flex-1' : 'h-72'}
      />

      <div role="status" aria-live="polite" className="mt-2 text-sm">
        {state.status === 'error' && (
          <p className="text-danger">{t('shell:lab.sketch.unreachable', { message: state.message })}</p>
        )}
        {result?.status === 'succeeded' && result.artifact && (
          <p>
            {t('shell:lab.sketch.succeeded', {
              flash: fmt(result.artifact.flashPct, 1),
              ram: fmt(result.artifact.ramPct, 1),
              ms: fmt(result.durationMs, 0),
            })}
            {result.cacheHit && ` · ${t('shell:lab.sketch.cached')}`}
          </p>
        )}
        {result?.status === 'failed' && (
          <p className="text-danger">{t('shell:lab.sketch.failed', { count: errors })}</p>
        )}
      </div>

      {diagnostics.length > 0 && (
        <ul
          aria-label={t('shell:lab.sketch.diagnostics')}
          className={cn('mt-2 flex flex-col gap-2', fill && 'max-h-[40%] overflow-y-auto')}
        >
          {diagnostics.map((d, k) => (
            <li key={k} className="rounded-md border border-line p-2 text-sm">
              <button
                type="button"
                onClick={() => show(d)}
                className={cn(
                  'flex w-full flex-wrap items-baseline gap-x-2 text-start',
                  d.severity === 'error' && 'text-danger',
                )}
              >
                <span aria-hidden>{SEVERITY_ICON[d.severity]}</span>
                <span className="font-semibold">{t(`shell:lab.sketch.severity.${d.severity}`)}</span>
                {d.line > 0 && (
                  <span className="text-ink-muted">
                    {t('shell:lab.sketch.location', {
                      file: d.file,
                      line: fmt(d.line, 0),
                      column: fmt(d.column, 0),
                    })}
                  </span>
                )}
                <code dir="ltr" className="break-all font-mono text-xs">
                  {d.message}
                </code>
              </button>
              {d.explanationKey && <p className="mt-1 text-ink">{t(`build:explain.${d.explanationKey}`)}</p>}
            </li>
          ))}
        </ul>
      )}

      {inCode.length > 0 && (
        <ul
          aria-label={t('shell:lab.sketch.safety')}
          className={cn('mt-2 flex flex-col gap-2', fill && 'max-h-[40%] overflow-y-auto')}
        >
          {inCode.map((c, k) => (
            <li key={k} className="rounded-md border border-line p-2 text-sm">
              <button
                type="button"
                onClick={() => show(c)}
                className={cn(
                  'flex w-full flex-wrap items-baseline gap-x-2 text-start',
                  c.finding.severity === 'error' && 'text-danger',
                )}
              >
                <span aria-hidden>{SEVERITY_ICON[c.finding.severity]}</span>
                <span className="font-semibold">{t(`shell:lab.sketch.severity.${c.finding.severity}`)}</span>
                <span className="text-ink-muted">
                  {t('shell:lab.sketch.location', {
                    file: c.file,
                    line: fmt(c.line, 0),
                    column: fmt(c.column, 0),
                  })}
                </span>
                <span>{c.title}</span>
              </button>
              <p className="mt-1 text-ink">{t(`${c.finding.messageKey}.fix`, c.finding.params)}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
