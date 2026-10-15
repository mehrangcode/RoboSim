import type { BuildDiagnostic } from '@robosim/shared';
import { Button, Card, cn } from '@robosim/ui';
import { useRef, type UIEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useFormat } from './format.js';
import type { BuildState } from './use-build.js';

/** Icon plus text, never colour alone. */
const SEVERITY_ICON = { error: '⛔', warning: '⚠️', note: 'ℹ️' } as const;
/** Gutter markers next to line numbers. */
const LINE_MARK = { error: '●', warning: '○', note: '' } as const;

/**
 * The Lab's sketch editor (build service demo, FR-COD-03): edit the demo's Arduino code, compile it with the build
 * service, and run the firmware on the same circuit. A plain textarea with line markers until the code editor lands.
 */
export function SketchPanel({
  fileName,
  code,
  onChange,
  onCompile,
  onRestore,
  state,
  modified,
  fill = false,
  title,
}: {
  fileName: string;
  code: string;
  onChange: (code: string) => void;
  /** Without these the panel has no buttons (the workspace compiles from its Run button). */
  onCompile?: (() => void) | undefined;
  onRestore?: (() => void) | undefined;
  state: BuildState;
  modified: boolean;
  /** Fill the parent's height (workspace pane) instead of a fixed-height editor. */
  fill?: boolean;
  title?: string | undefined;
}) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const editor = useRef<HTMLTextAreaElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const diagnostics = state.status === 'done' ? state.result.diagnostics : [];
  const marks = new Map<number, BuildDiagnostic['severity']>();
  for (const d of diagnostics)
    if (d.file === fileName && d.line > 0 && marks.get(d.line) !== 'error') marks.set(d.line, d.severity);
  const lines = code.split('\n').length;

  /** Puts the caret on the diagnostic's line so the learner lands on it. */
  const reveal = (d: BuildDiagnostic) => {
    const el = editor.current;
    if (!el || d.file !== fileName || d.line < 1) return;
    const starts = code.split('\n').slice(0, d.line - 1);
    const start = starts.reduce((n, l) => n + l.length + 1, 0);
    const end = start + (code.split('\n')[d.line - 1]?.length ?? 0);
    el.focus();
    el.setSelectionRange(start, end);
  };

  const syncScroll = (e: UIEvent<HTMLTextAreaElement>) => {
    if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop;
  };

  const building = state.status === 'building';
  const result = state.status === 'done' ? state.result : null;
  const errors = diagnostics.filter((d) => d.severity === 'error').length;

  return (
    <Card className={cn('p-3', fill && 'flex h-full min-h-0 flex-col rounded-none border-0')}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-ink-muted">
          {title ?? t('shell:lab.sketch.title')}{' '}
          <span dir="ltr" className="font-mono">
            {fileName}
          </span>
        </h2>
        <div className="ms-auto flex gap-2">
          {onRestore && (
            <Button size="sm" variant="secondary" onClick={onRestore} disabled={!modified || building}>
              {t('shell:lab.sketch.restore')}
            </Button>
          )}
          {onCompile && (
            <Button size="sm" onClick={onCompile} disabled={building} aria-busy={building}>
              {building ? t('shell:lab.sketch.compiling') : t('shell:lab.sketch.compile')}
            </Button>
          )}
        </div>
      </div>
      {/* Code is always LTR, also in the Persian UI. No ligatures: `<=` must not render as `≤`. */}
      <div
        dir="ltr"
        className={cn(
          'flex overflow-hidden rounded-md border border-line font-mono text-xs leading-5 [font-variant-ligatures:none]',
          fill ? 'min-h-0 flex-1' : 'h-72',
        )}
      >
        <div
          ref={gutter}
          aria-hidden
          className="select-none overflow-hidden border-e border-line bg-surface-raised px-2 py-2 text-end text-ink-muted"
        >
          {Array.from({ length: lines }, (_, k) => {
            const mark = marks.get(k + 1);
            return (
              <div
                key={k}
                className={cn(
                  mark === 'error' && 'font-bold text-danger',
                  mark === 'warning' && 'font-bold text-ink',
                )}
              >
                {mark ? LINE_MARK[mark] : ''} {k + 1}
              </div>
            );
          })}
        </div>
        <textarea
          ref={editor}
          value={code}
          onChange={(e) => onChange(e.target.value)}
          onScroll={syncScroll}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          wrap="off"
          aria-label={t('shell:lab.sketch.editor')}
          className="min-w-0 flex-1 resize-none bg-transparent p-2 leading-5 outline-none"
        />
      </div>

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
                onClick={() => reveal(d)}
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
    </Card>
  );
}
