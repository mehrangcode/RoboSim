import type { ConsistencyFinding, QuickFix } from '@robosim/safety-rules/consistency';
import type { FindingView } from '@robosim/sim-runtime/client';
import { Button, Card, SegmentedControl, cn } from '@robosim/ui';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { findingKey, type AnyFinding } from './finding-key.js';

type Severity = AnyFinding['severity'];
type Filter = 'all' | Severity;
const FILTER_LABEL = { all: 'all', error: 'errors', warning: 'warnings', info: 'infos' } as const;
const ICON = { error: '⛔', warning: '⚠️', info: 'ℹ️' } as const;

/**
 * Findings panel (FR-SAF-06): the wiring ↔ sketch check while editing (FR-SAF-08), then the wiring
 * findings from before the run plus runtime findings, filterable by severity. Warnings and infos can be
 * acknowledged; Errors cannot. Severity is shown as icon + text, never colour only. A finding can be
 * shown on the circuit, and a wiring ↔ sketch finding offers quick fixes.
 */
export function FindingsPanel({
  findings,
  consistency = [],
  partTypes,
  running = true,
  selected = null,
  onSelect,
  onFix,
}: {
  findings: readonly FindingView[];
  /** Wiring ↔ sketch findings of the project as edited (FR-SAF-08). */
  consistency?: readonly ConsistencyFinding[] | undefined;
  /** Part id → catalogue type, so messages show "LED" instead of the instance id. */
  partTypes: Readonly<Record<string, string>>;
  /** False while editing: the electrical checks of the run are not there yet. */
  running?: boolean | undefined;
  /** Key of the finding shown on the circuit. */
  selected?: string | null | undefined;
  onSelect?: ((key: string | null) => void) | undefined;
  /** Without it (read-only), fixes are not offered. */
  onFix?: ((fix: QuickFix) => void) | undefined;
}) {
  const { t } = useTranslation();
  /** Message params with part ids replaced by component names and fault codes translated. */
  const params = (f: AnyFinding): Record<string, string | number> => {
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
  const all: readonly AnyFinding[] = useMemo(() => [...consistency, ...findings], [consistency, findings]);
  const [filter, setFilter] = useState<Filter>('all');
  const [acked, setAcked] = useState<ReadonlySet<string>>(new Set());
  const show = (f: AnyFinding) => (filter === 'all' || f.severity === filter) && !acked.has(findingKey(f));
  const ackedCount = all.filter((f) => acked.has(findingKey(f))).length;
  const filters: Filter[] = [
    'all',
    'error',
    'warning',
    ...(all.some((f) => f.severity === 'info') ? (['info'] as const) : []),
  ];
  const groups = [
    { id: 'consistency', items: consistency.filter(show) },
    { id: 'run', items: findings.filter(show) },
  ] as const;

  const fixLabel = (fix: QuickFix): string =>
    t(`shell:lab.findings.fix.${fix.kind === 'code.replacePin' ? 'code' : 'wire'}`, {
      from: fix.from,
      to: fix.to,
    });

  const item = (f: AnyFinding) => {
    const key = findingKey(f);
    const fixes = 'fixes' in f && onFix ? f.fixes : [];
    return (
      <li
        key={key}
        className={cn(
          'rounded-md border p-2 text-sm',
          f.severity === 'error' ? 'border-danger' : 'border-line',
          selected === key && 'ring-2 ring-accent',
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
          <summary className="cursor-pointer text-xs text-ink-muted">{t('shell:lab.findings.why')}</summary>
          <p className="mt-1">{t(`${f.messageKey}.why`, params(f))}</p>
          <p className="mt-1 text-xs font-semibold text-ink-muted">{t('shell:lab.findings.fix.title')}</p>
          <p>{t(`${f.messageKey}.fix`, params(f))}</p>
        </details>
        <div className="mt-2 flex flex-wrap gap-2">
          {fixes.map((fix) => (
            <Button key={`${fix.kind}:${fix.from}:${fix.to}`} size="sm" onClick={() => onFix?.(fix)}>
              {fixLabel(fix)}
            </Button>
          ))}
          {onSelect && (f.pinIds.length > 0 || f.componentIds.length > 0) && (
            <Button
              size="sm"
              variant="secondary"
              aria-pressed={selected === key}
              onClick={() => onSelect(selected === key ? null : key)}
            >
              {t(selected === key ? 'shell:lab.findings.hide' : 'shell:lab.findings.show')}
            </Button>
          )}
          {f.severity !== 'error' && (
            <Button size="sm" variant="ghost" onClick={() => setAcked(new Set([...acked, key]))}>
              {t('shell:lab.findings.acknowledge')}
            </Button>
          )}
        </div>
      </li>
    );
  };

  return (
    <Card className="p-3">
      <h2 className="mb-2 text-sm font-semibold text-ink-muted">{t('shell:lab.findings.title')}</h2>
      {all.length > 0 && (
        <SegmentedControl
          label={t('shell:lab.findings.filterLabel')}
          value={filters.includes(filter) ? filter : 'all'}
          options={filters.map((v) => ({ value: v, label: t(`shell:lab.findings.${FILTER_LABEL[v]}`) }))}
          onChange={setFilter}
        />
      )}
      {groups.every((g) => g.items.length === 0) ? (
        <p className="mt-2 text-sm text-ink-muted">{t('shell:lab.findings.none')}</p>
      ) : (
        groups.map(
          (g) =>
            g.items.length > 0 && (
              <section key={g.id} className="mt-2">
                {g.id === 'consistency' && (
                  <h3 className="mb-1 text-xs font-semibold text-ink-muted">
                    {t('shell:lab.findings.group.consistency')}
                  </h3>
                )}
                <ul className="flex flex-col gap-2" aria-live="polite">
                  {g.items.map(item)}
                </ul>
              </section>
            ),
        )
      )}
      {!running && <p className="mt-2 text-xs text-ink-muted">{t('shell:lab.findings.runForMore')}</p>}
      {ackedCount > 0 && (
        <p className="mt-2 text-xs text-ink-muted">
          {t('shell:lab.findings.acknowledged', { count: ackedCount })}
        </p>
      )}
    </Card>
  );
}
