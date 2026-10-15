import type { FindingView } from '@robosim/sim-runtime/client';
import { Button, Card, SegmentedControl, cn } from '@robosim/ui';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

type Filter = 'all' | 'error' | 'warning';
const FILTERS = ['all', 'error', 'warning'] as const;
const FILTER_LABEL = { all: 'all', error: 'errors', warning: 'warnings' } as const;
const ICON = { error: '⛔', warning: '⚠️' } as const;

const keyOf = (f: FindingView): string => `${f.kind}:${f.ruleId}:${f.componentIds.join()}:${f.pinIds.join()}`;

/**
 * Findings panel (FR-SAF-06): wiring findings from before the run plus runtime findings, filterable
 * by severity. Warnings can be acknowledged; Errors cannot. Severity is shown as icon + text, never colour only.
 */
export function FindingsPanel({
  findings,
  partTypes,
}: {
  findings: readonly FindingView[];
  /** Part id → catalogue type, so messages show "LED" instead of the instance id. */
  partTypes: Readonly<Record<string, string>>;
}) {
  const { t } = useTranslation();
  /** Message params with part ids replaced by component names and fault codes translated. */
  const params = (f: FindingView): Record<string, string | number> => {
    const name = (id: string): string => {
      const [part, pin] = id.split('.');
      const type = partTypes[part ?? ''];
      return type ? `${t(`components:${type}.name`)}${pin ? ` (${pin})` : ''}` : id;
    };
    const out: Record<string, string | number> = { ...f.params };
    for (const key of ['part', 'supply'] as const)
      if (typeof out[key] === 'string') out[key] = name(out[key]);
    if (typeof out['parts'] === 'string') out['parts'] = out['parts'].split(', ').map(name).join('، ');
    if (typeof out['code'] === 'string') out['code'] = t(`safety:codes.${out['code']}`);
    return out;
  };
  const [filter, setFilter] = useState<Filter>('all');
  const [acked, setAcked] = useState<ReadonlySet<string>>(new Set());
  const visible = useMemo(
    () => findings.filter((f) => (filter === 'all' || f.severity === filter) && !acked.has(keyOf(f))),
    [findings, filter, acked],
  );
  const ackedCount = findings.filter((f) => acked.has(keyOf(f))).length;

  return (
    <Card className="p-3">
      <h2 className="mb-2 text-sm font-semibold text-ink-muted">{t('shell:lab.findings.title')}</h2>
      {findings.length > 0 && (
        <SegmentedControl
          label={t('shell:lab.findings.filterLabel')}
          value={filter}
          options={FILTERS.map((v) => ({ value: v, label: t(`shell:lab.findings.${FILTER_LABEL[v]}`) }))}
          onChange={setFilter}
        />
      )}
      {visible.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">{t('shell:lab.findings.none')}</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2" aria-live="polite">
          {visible.map((f) => (
            <li
              key={keyOf(f)}
              className={cn(
                'rounded-md border p-2 text-sm',
                f.severity === 'error' ? 'border-danger' : 'border-line',
              )}
            >
              <p className="flex flex-wrap items-center gap-x-2 text-xs text-ink-muted">
                <span aria-hidden>{ICON[f.severity]}</span>
                <span className={cn('font-semibold', f.severity === 'error' && 'text-danger')}>
                  {t(`shell:lab.findings.${f.severity}`)}
                </span>
                <span>· {t(`shell:lab.findings.${f.kind}`)}</span>
              </p>
              <p className="mt-1 font-medium">{t(`${f.messageKey}.title`, params(f))}</p>
              <details className="mt-1">
                <summary className="cursor-pointer text-xs text-ink-muted">
                  {t('shell:lab.findings.why')}
                </summary>
                <p className="mt-1">{t(`${f.messageKey}.why`, params(f))}</p>
                <p className="mt-1 text-xs font-semibold text-ink-muted">{t('shell:lab.findings.fix')}</p>
                <p>{t(`${f.messageKey}.fix`, params(f))}</p>
              </details>
              {f.severity === 'warning' && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-2"
                  onClick={() => setAcked(new Set([...acked, keyOf(f)]))}
                >
                  {t('shell:lab.findings.acknowledge')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {ackedCount > 0 && (
        <p className="mt-2 text-xs text-ink-muted">
          {t('shell:lab.findings.acknowledged', { count: ackedCount })}
        </p>
      )}
    </Card>
  );
}
