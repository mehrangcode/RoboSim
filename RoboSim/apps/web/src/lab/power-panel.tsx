import type { BudgetStatus } from '@robosim/circuit-canvas';
import type { BatteryLife, FindingView } from '@robosim/sim-runtime/client';
import { BOARD_PART, type ProjectDocument } from '@robosim/shared';
import { Button, SegmentedControl } from '@robosim/ui';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EnergyChart } from './energy-chart.js';
import { chartSeries } from './energy-series.js';
import { findingKey } from './finding-key.js';
import { formatSi, formatSliceTime, useFormat, type SiUnit } from './format.js';
import { ltr } from './probe-points.js';
import { RAIL_PARTS, sourceKey, useDuration, type BatteryCard, type PowerModel } from './use-power.js';

export type PowerMode = 'static' | 'measured';

/** A table row: static (typical × duty) or measured (this run). */
export interface PowerRow {
  readonly id: string;
  readonly source: string | null;
  readonly duty: number | null;
  readonly avgMa: number;
  readonly peakMa: number;
  readonly avgMw: number | null;
  readonly peakMw: number | null;
  readonly joules: number | null;
}

/** A supply output with its draw against its rating. */
export interface SupplyRow {
  readonly key: string;
  readonly avgMa: number;
  readonly peakMa: number;
  readonly ratingMa: number;
  readonly status: BudgetStatus;
}

type SortKey = 'id' | 'source' | 'avgMa' | 'peakMa' | 'avgMw' | 'joules';
/** Decorative sort arrows (aria-sort carries the state). */
const SORT_GLYPH = { desc: ' ▾', asc: ' ▴' } as const;
/** Sortable columns. */
const COL = {
  id: 'id',
  source: 'source',
  avgMa: 'avgMa',
  peakMa: 'peakMa',
  avgMw: 'avgMw',
  joules: 'joules',
} as const satisfies Record<SortKey, SortKey>;

const statusOf = (avg: number, peak: number, rating: number): BudgetStatus =>
  avg > rating ? 'over' : peak > rating ? 'peakOver' : 'ok';

/** The run supply a SAF-SUPPLY-OVERLOAD finding names for a document supply key. */
const runSupply = (key: string): string => {
  const rail = Object.entries(RAIL_PARTS).find(([, k]) => k === key)?.[0];
  return rail ? `${rail}.pos` : key;
};

/**
 * Power budget dock panel (FR-SIM-15, US-SIM-11): supplies against their ratings, battery life as a
 * range, a sortable per-part table and a stacked energy graph. "Estimate" before a run (manifest typical
 * currents × duty), "Measured" once the run has reported.
 */
export function PowerPanel({
  doc,
  power,
  findings,
  onShowFinding,
}: {
  doc: ProjectDocument;
  power: PowerModel;
  /** Findings of the loaded run: an over-rated supply links to its SAF-SUPPLY-OVERLOAD. */
  findings: readonly FindingView[];
  onShowFinding: (key: string) => void;
}) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const duration = useDuration();
  const { budget, energy } = power;
  const [picked, setPicked] = useState<PowerMode>('measured');
  const mode: PowerMode = energy && energy.seconds > 0 ? picked : 'static';
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'avgMa', desc: true });

  const si = (v: number, unit: SiUnit) => {
    const s = formatSi(v, unit);
    return ltr(`${fmt(s.scaled, s.digits)} ${s.symbol}`);
  };
  const ma = (v: number) => si(v / 1000, 'A');
  const label = (key: string | null): string =>
    key === null
      ? t('editor:power.noSupply')
      : key.startsWith(`${BOARD_PART}.`)
        ? t('editor:power.boardPin', { pin: key.slice(BOARD_PART.length + 1) })
        : key;
  const loadOf = useMemo(() => new Map(budget.loads.map((l) => [l.id, l])), [budget]);
  /** Drivers feeding loads: measured, their supply current includes what their outputs pass on. */
  const drivers = useMemo(() => new Set(budget.loads.flatMap((l) => (l.via ? [l.via] : []))), [budget]);

  const rows: PowerRow[] = useMemo(() => {
    if (mode === 'static' || !energy)
      return budget.loads.map((l) => ({
        id: l.id,
        source: l.source,
        duty: l.duty,
        avgMa: l.typMa,
        peakMa: l.peakMa,
        avgMw: null,
        peakMw: null,
        joules: null,
      }));
    const ids = new Set(doc.components.map((c) => c.id));
    // Batteries deliver energy: they have their own cards, not a load row.
    const batteries = new Set(budget.sources.filter((s) => s.kind === 'battery').map((s) => s.part));
    return energy.parts
      .filter((p) => ids.has(p.id) && !batteries.has(p.id) && (p.joules > 0 || p.avgMa > 0))
      .map((p) => ({
        id: p.id,
        source: loadOf.get(p.id)?.source ?? null,
        duty: null,
        avgMa: p.avgMa,
        peakMa: p.peakMa,
        avgMw: p.avgMw,
        peakMw: p.peakMw,
        joules: p.joules,
      }));
  }, [mode, energy, budget, doc, loadOf]);

  const supplies: SupplyRow[] = useMemo(() => {
    const shown = budget.sources.filter((s) => s.kind !== 'rail' || s.loads.length > 0);
    if (mode === 'static' || !energy)
      return shown.map((s) => ({
        key: s.key,
        avgMa: s.typMa,
        peakMa: s.peakMa,
        ratingMa: s.ratingMa,
        status: s.status,
      }));
    return shown.flatMap((s) => {
      const m = energy.sources.find((x) => sourceKey(x.id, x.pin) === s.key);
      if (!m) return [];
      return [
        {
          key: s.key,
          avgMa: m.avgMa,
          peakMa: m.peakMa,
          ratingMa: s.ratingMa,
          status: statusOf(m.avgMa, m.peakMa, s.ratingMa),
        },
      ];
    });
  }, [mode, energy, budget]);

  const sorted = useMemo(() => {
    const k = sort.key;
    const val = (r: PowerRow): number | string =>
      k === 'id' ? r.id : k === 'source' ? label(r.source) : (r[k] ?? -Infinity);
    return [...rows].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      const c = typeof va === 'string' ? va.localeCompare(String(vb)) : va - (vb as number);
      return sort.desc ? -c : c;
    });
    // `label` only reads translations; rows and sort decide the order.
  }, [rows, sort]); // eslint-disable-line react-hooks/exhaustive-deps

  const series = useMemo(
    () =>
      energy && mode === 'measured'
        ? chartSeries(
            doc.components.map((c) => c.id),
            energy.series,
            energy.bucketSeconds,
            t('editor:power.chart.other'),
          )
        : [],
    [energy, mode, doc, t],
  );

  const overload = (key: string) =>
    findings.find((f) => f.ruleId === 'SAF-SUPPLY-OVERLOAD' && f.params['supply'] === runSupply(key));

  const measuredLabel = energy
    ? energy.fromSlice > 0
      ? t('editor:power.mode.measuredSince', {
          since: ltr(formatSliceTime(energy.fromSlice).replace(/\.\d+$/, '')),
          seconds: fmt(energy.seconds, 0),
        })
      : t('editor:power.mode.measured', { seconds: fmt(energy.seconds, 0) })
    : '';

  const header = (key: SortKey, text: string, numeric = true) => (
    <th
      scope="col"
      aria-sort={sort.key === key ? (sort.desc ? 'descending' : 'ascending') : 'none'}
      className={`px-1 py-1 font-medium ${numeric ? 'text-end' : 'text-start'}`}
    >
      <button
        type="button"
        className="rounded px-0.5 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
        onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : numeric }))}
      >
        {text}
        {sort.key === key && <span aria-hidden>{sort.desc ? SORT_GLYPH.desc : SORT_GLYPH.asc}</span>}
      </button>
    </th>
  );
  const num = (v: number | null, unit: SiUnit, scale = 1) => (
    <td className="px-1 py-0.5 text-end font-mono tabular-nums">{v === null ? '—' : si(v * scale, unit)}</td>
  );

  const batteries = mode === 'measured' ? power.batteries.measured : power.batteries.static;

  return (
    <section aria-label={t('editor:power.title')} className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          label={t('editor:power.mode.label')}
          value={mode}
          options={[
            { value: 'static', label: t('editor:power.mode.static') },
            ...(energy && energy.seconds > 0 ? [{ value: 'measured' as const, label: measuredLabel }] : []),
          ]}
          onChange={setPicked}
        />
        <label className="flex items-center gap-1 text-xs text-ink-muted">
          <input
            type="checkbox"
            checked={power.recordAll}
            onChange={(e) => power.setRecordAll(e.target.checked)}
          />
          {t('editor:power.recordAll')}
        </label>
      </div>
      <p className="m-0 text-xs text-ink-muted" data-testid="power-basis">
        {mode === 'static' ? t('editor:power.basis.static') : t('editor:power.basis.measured')}
      </p>

      {supplies.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label={t('editor:power.supplies')}>
          {supplies.map((s) => {
            const finding = s.status === 'ok' ? undefined : overload(s.key);
            return (
              <li
                key={s.key}
                data-testid={`power-supply-${s.key}`}
                className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded border border-line bg-surface-raised px-2 py-1"
              >
                <span className="font-medium text-ink">{label(s.key)}</span>
                <span className="text-xs text-ink-muted">
                  {t('editor:power.supplyLine', {
                    avg: ma(s.avgMa),
                    peak: ma(s.peakMa),
                    rating: ma(s.ratingMa),
                  })}
                </span>
                {s.status !== 'ok' && (
                  <span className={`text-xs font-medium ${s.status === 'over' ? 'text-danger' : 'text-ink'}`}>
                    <span aria-hidden>{s.status === 'over' ? '✖ ' : '⚠ '}</span>
                    {t(`editor:power.status.${s.status}`)}
                  </span>
                )}
                {finding && (
                  <Button size="sm" variant="ghost" onClick={() => onShowFinding(findingKey(finding))}>
                    {t('editor:power.showFinding')}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {batteries.length > 0 && (
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0" aria-label={t('editor:power.batteries')}>
          {batteries.map((b) => (
            <BatteryCardView key={b.key} card={b} mode={mode} duration={duration} />
          ))}
        </ul>
      )}

      {mode === 'measured' && series.length > 0 && energy && (
        <EnergyChart
          series={series}
          bucketSeconds={energy.bucketSeconds}
          startSeconds={energy.fromSlice / 1000}
        />
      )}

      {sorted.length === 0 ? (
        <p className="m-0 text-xs text-ink-muted">{t('editor:power.empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <caption className="sr-only">{t('editor:power.table')}</caption>
            <thead className="text-ink-muted">
              <tr>
                {header(COL.id, t('editor:power.col.part'), false)}
                {header(COL.source, t('editor:power.col.supply'), false)}
                {mode === 'static' && (
                  <th scope="col" className="px-1 py-1 text-end font-medium">
                    {t('editor:power.col.duty')}
                  </th>
                )}
                {header(
                  COL.avgMa,
                  mode === 'static' ? t('editor:power.col.typMa') : t('editor:power.col.avgMa'),
                )}
                {header(COL.peakMa, t('editor:power.col.peakMa'))}
                {mode === 'measured' && header(COL.avgMw, t('editor:power.col.avgMw'))}
                {mode === 'measured' && (
                  <th scope="col" className="px-1 py-1 text-end font-medium">
                    {t('editor:power.col.peakMw')}
                  </th>
                )}
                {mode === 'measured' && header(COL.joules, t('editor:power.col.energy'))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.id} className="border-t border-line text-ink">
                  <th scope="row" className="px-1 py-0.5 text-start font-normal">
                    {r.id}
                    {mode === 'measured' && drivers.has(r.id) ? (
                      <span className="text-ink-muted"> {t('editor:power.includesOutputs')}</span>
                    ) : null}
                    {loadOf.get(r.id)?.via ? (
                      <span className="text-ink-muted">
                        {' '}
                        {t('editor:power.via', { driver: loadOf.get(r.id)?.via })}
                      </span>
                    ) : null}
                  </th>
                  <td className="px-1 py-0.5 text-ink-muted">{label(r.source)}</td>
                  {mode === 'static' && (
                    <td className="px-1 py-0.5 text-end">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={5}
                        dir="ltr"
                        aria-label={t('editor:power.dutyOf', { part: r.id })}
                        className="w-14 rounded border border-line bg-surface px-1 text-end tabular-nums"
                        value={Math.round((r.duty ?? 1) * 100)}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          if (Number.isFinite(v)) power.setDuty(r.id, Math.min(100, Math.max(0, v)) / 100);
                        }}
                      />
                      <span aria-hidden> %</span>
                    </td>
                  )}
                  {num(r.avgMa, 'A', 1e-3)}
                  {num(r.peakMa, 'A', 1e-3)}
                  {mode === 'measured' && num(r.avgMw, 'W', 1e-3)}
                  {mode === 'measured' && num(r.peakMw, 'W', 1e-3)}
                  {mode === 'measured' && num(r.joules, 'J')}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function BatteryCardView({
  card,
  mode,
  duration,
}: {
  card: BatteryCard;
  mode: PowerMode;
  duration: (hours: number) => string;
}) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const life: BatteryLife = card.life;
  const text =
    life.kind === 'ok'
      ? t('editor:power.life.range', {
          life: duration(life.hours),
          min: duration(life.minHours),
          max: duration(life.maxHours),
        })
      : t(`editor:power.life.${life.kind}`);
  const assumptions = t('editor:power.life.assumptions', {
    cutoff: ltr(`${fmt(card.cutoffV, 1)} V`),
    current: ltr(`${fmt(card.avgMa, 0)} mA`),
  });
  return (
    <li
      data-testid={`power-battery-${card.part}`}
      title={assumptions}
      className="flex min-w-48 flex-1 flex-col rounded border border-line bg-surface-raised px-2 py-1"
    >
      <span className="text-xs text-ink-muted">
        {t(mode === 'static' ? 'editor:power.life.titleEstimate' : 'editor:power.life.titleMeasured', {
          part: card.part,
        })}
      </span>
      <span className="font-medium text-ink">{text}</span>
      <span className="text-xs text-ink-muted">{assumptions}</span>
    </li>
  );
}
