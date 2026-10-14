import type { ChallengeNodeView, ChallengeView, MainToWorker } from '@robosim/sim-runtime';
import { Button, Card, cn } from '@robosim/ui';
import { useTranslation } from 'react-i18next';

/** Leaves of the condition tree as checklist rows (one level of all/any is flattened). */
function rows(tree: ChallengeNodeView): readonly ChallengeNodeView[] {
  return tree.type === 'all' || tree.type === 'any' ? (tree.children ?? []) : [tree];
}

/** done ✓ / failed ✗ / holding (constraint satisfied so far) ● / not yet ○ — icon plus text, never colour alone. */
function stateOf(
  n: ChallengeNodeView,
  decided: boolean,
): { icon: string; label: 'met' | 'failed' | 'pending' | 'holding' } {
  // Once the run is decided every row is settled: a constraint still holding counts as met.
  if (n.final || decided)
    return n.status === 'met' ? { icon: '✓', label: 'met' } : { icon: '✗', label: 'failed' };
  if (n.status === 'pending') return { icon: '○', label: 'pending' };
  return n.status === 'met' ? { icon: '●', label: 'holding' } : { icon: '◐', label: 'pending' };
}

/** Live challenge checklist and result card (US-ARN-08, FR-ARN-11). */
export function ChallengePanel({
  challenge,
  send,
}: {
  challenge: ChallengeView;
  send: (m: MainToWorker) => void;
}) {
  const { t } = useTranslation();
  const decided = challenge.status !== 'running';
  return (
    <Card
      className={cn(
        'p-3',
        challenge.status === 'success' && 'border-ok',
        challenge.status === 'failure' && 'border-danger',
      )}
    >
      <h2 className="text-sm font-semibold text-ink-muted">{t('shell:lab.challenge.title')}</h2>
      <p className="mt-1 text-sm">{t(`shell:lab.challenge.name.${challenge.id}`)}</p>

      <ul className="mt-2 flex flex-col gap-1 text-sm tabular-nums" aria-live="polite">
        {rows(challenge.tree).map((n, i) => {
          const s = stateOf(n, decided);
          return (
            <li key={`${n.type}-${i}`} className="flex items-start gap-2">
              <span
                aria-hidden
                className={cn(
                  'w-4 shrink-0 text-center',
                  s.label === 'met' && 'text-ok',
                  s.label === 'failed' && 'text-danger',
                )}
              >
                {s.icon}
              </span>
              <span>
                {t(`shell:lab.challenge.cond.${n.type}`, n.params)}
                <span className="sr-only"> — {t(`shell:lab.challenge.stateLabel.${s.label}`)}</span>
              </span>
            </li>
          );
        })}
      </ul>

      {decided && (
        <div role="status" className="mt-3 border-t border-line pt-3">
          <p className={cn('font-semibold', challenge.status === 'success' ? 'text-ok' : 'text-danger')}>
            <span aria-hidden>{challenge.status === 'success' ? '🏁 ' : '⛔ '}</span>
            {t(`shell:lab.challenge.status.${challenge.status}`)}
          </p>
          {challenge.decidedAt !== null && (
            <p className="text-xs text-ink-muted">
              {t('shell:lab.challenge.decided', { time: challenge.decidedAt })}
            </p>
          )}
          {challenge.score && (
            <>
              <p className="mt-2 text-lg font-bold tabular-nums">
                {t('shell:lab.challenge.score.title', challenge.score)}
              </p>
              <ul className="mt-1 text-xs tabular-nums text-ink-muted">
                {challenge.score.lines.map((l) => (
                  <li key={l.type} className="flex justify-between gap-2">
                    <span>{t(`shell:lab.challenge.score.${l.type}`)}</span>
                    <span>{t('shell:lab.challenge.score.points', l)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <Button
            size="sm"
            className="mt-3"
            onClick={() => {
              send({ type: 'control', action: 'reset' });
              send({ type: 'control', action: 'run' });
            }}
          >
            {t('shell:lab.challenge.again')}
          </Button>
        </div>
      )}
      {!decided && <p className="mt-2 text-xs text-ink-muted">{t('shell:lab.challenge.status.running')}</p>}
    </Card>
  );
}
