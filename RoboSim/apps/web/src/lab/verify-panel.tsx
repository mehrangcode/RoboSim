import type { Frame } from '@robosim/sim-runtime/client';
import { Card, cn } from '@robosim/ui';
import { useTranslation } from 'react-i18next';
import { useFormat } from './format.js';
import { compareWithLive } from './compare-run.js';
import type { VerifyState } from './use-verified-run.js';

/** Icon plus text, never colour alone. */
const MATCH_ICON = { identical: '✓', differs: '✗', moved: '…' } as const;

/** Verified-run card (US-LRN verified runs, FR-SIM-09): grader result next to the unofficial live run. */
export function VerifyPanel({
  state,
  frame,
  serial,
}: {
  state: VerifyState;
  frame: Frame | null;
  serial: string;
}) {
  const { t } = useTranslation();
  const fmt = useFormat();
  if (state.status === 'idle') return null;
  const match = state.status === 'done' ? compareWithLive(state.result, frame, serial) : 'moved';
  return (
    <Card
      className={cn('p-3', match === 'identical' && 'border-ok', match === 'differs' && 'border-danger')}
      aria-busy={state.status === 'grading'}
    >
      <h2 className="text-sm font-semibold text-ink-muted">{t('shell:lab.verify.title')}</h2>
      {state.status === 'grading' && <p className="mt-1 text-sm">{t('shell:lab.verify.grading')}</p>}
      {state.status === 'error' && (
        <p role="alert" className="mt-1 text-sm text-danger">
          {t('shell:lab.verify.error', { message: state.message })}
        </p>
      )}
      {state.status === 'done' && (
        <div role="status" className="mt-1 flex flex-col gap-1 text-sm tabular-nums">
          <p className="font-semibold">
            {t(`shell:lab.verify.outcome.${state.result.outcome}`, {
              seconds: fmt(state.result.endSlice / 1000, 2),
            })}
          </p>
          {state.result.score && (
            <p>
              {t('shell:lab.verify.score', {
                total: fmt(state.result.score.total),
                max: fmt(state.result.score.max),
              })}
            </p>
          )}
          <p className={cn(match === 'identical' && 'text-ok', match === 'differs' && 'text-danger')}>
            <span aria-hidden>{MATCH_ICON[match]} </span>
            {t(`shell:lab.verify.match.${match}`, {
              seconds: fmt(state.result.endSlice / 1000, 2),
            })}
          </p>
          <p className="text-xs text-ink-muted">
            {t('shell:lab.verify.speed', {
              sim: fmt(state.result.endSlice / 1000, 2),
              wall: fmt(state.wallMs / 1000, 2),
              factor: fmt(state.result.endSlice / Math.max(state.wallMs, 1), 1),
            })}
          </p>
          <p className="text-xs text-ink-muted">
            {t('shell:lab.verify.trace', { count: state.samples })}{' '}
            <code dir="ltr" title={state.digest}>
              {state.digest.slice(0, 12)}
            </code>
          </p>
        </div>
      )}
      <p className="mt-2 text-xs text-ink-muted">{t('shell:lab.verify.hint')}</p>
    </Card>
  );
}
