import { BLACKBOX_MAX_PARTS, type PostMortem, type PostMortemSeries } from '@robosim/sim-runtime/client';
import { Button, Card, SegmentedControl, cn } from '@robosim/ui';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { durationParts } from './analyzer.js';
import { findingParams, partName } from './finding-key.js';
import { formatSi, useFormat, type SiUnit } from './format.js';
import {
  POSTMORTEM_WINDOW_S,
  narrative,
  peakIn,
  postMortemKey,
  rangeOf,
  traceColumns,
  victimTraces,
  windowOf,
} from './postmortem.js';
import { TracePlot, type PlotMarker } from './trace-plot.js';
import { TRACE_DASHES } from './trace-render.js';

type Translate = ReturnType<typeof useTranslation>['t'];

/** Shared text helpers: times, SI values, where a series was measured, what was damaged. */
function useTexts(partTypes: Readonly<Record<string, string>>) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const time = (seconds: number) => {
    const { value, unit } = durationParts(seconds);
    const a = Math.abs(value);
    return t(`shell:lab.analyzer.unit.${unit}`, { value: fmt(value, a >= 100 ? 1 : a >= 10 ? 2 : 3) });
  };
  const si = (v: number, unit: SiUnit) => {
    const s = formatSi(v, unit);
    return `${fmt(s.scaled, s.digits)} ${s.symbol}`;
  };
  const point = (label: PostMortemSeries['label']) =>
    'mcuPin' in label
      ? t('editor:postmortem.victim.pin', { pin: label.mcuPin })
      : t('editor:postmortem.victim.part', { part: partName(label.part, partTypes, t), pin: label.pin });
  const victim = (pm: PostMortem) =>
    [
      ...pm.record.componentIds.map((id) => partName(id, partTypes, t)),
      ...pm.record.pins.map((pin) => t('editor:postmortem.victim.pin', { pin })),
    ].join('، ');
  return { t, fmt, time, si, point, victim };
}

/**
 * Non-modal "Part damaged: what happened?" notice (FR-SIM-16). Announced assertively (role="alert") so a
 * screen reader hears it at once; it opens the post-mortem tab or goes away.
 */
export function PostmortemToast({
  record,
  partTypes,
  onOpen,
  onDismiss,
}: {
  record: PostMortem;
  partTypes: Readonly<Record<string, string>>;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const { t, time, victim } = useTexts(partTypes);
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex flex-wrap items-center gap-2 rounded-md border border-danger bg-surface-raised p-2 text-sm shadow-lg"
    >
      <span aria-hidden>⛔</span>
      <span className="font-medium">{t('editor:postmortem.toast')}</span>
      <span className="text-ink-muted">
        {t('editor:postmortem.damagedAt', { victim: victim(record), time: time(record.record.simTime) })}
      </span>
      <Button size="sm" onClick={onOpen}>
        {t('editor:postmortem.open')}
      </Button>
      <Button size="sm" variant="ghost" onClick={onDismiss}>
        {t('editor:postmortem.dismiss')}
      </Button>
    </div>
  );
}

/**
 * "What happened?" dock panel (FR-SIM-16, US-SIM-12): every damage of the run, newest first; for the
 * chosen one the narrative, the victim's current or voltage over the last seconds with markers where the
 * violation started and where the part was damaged, what the code was doing, the rule's why and fix, and
 * Show on circuit / Fix / Replay the last 5 s.
 */
export function PostmortemPanel({
  records,
  partTypes,
  selected,
  onSelect,
  onShow,
  onFix,
  onReplay,
  fastForward,
  onCancelReplay,
  replayReady = false,
}: {
  records: readonly PostMortem[];
  partTypes: Readonly<Record<string, string>>;
  /** Key ({@link postMortemKey}) of the record shown; the newest when null or gone. */
  selected: string | null;
  onSelect: (key: string) => void;
  onShow: (pm: PostMortem) => void;
  /** Without it the finding is not in the Safety tab (no run), so there is nothing to open. */
  onFix?: ((pm: PostMortem) => void) | undefined;
  /** Without it (read-only, no run) the replay is not offered. */
  onReplay?: ((pm: PostMortem) => void) | undefined;
  fastForward: { readonly done: number; readonly total: number } | null;
  onCancelReplay: () => void;
  /** The run waits paused before the damage after a replay. */
  replayReady?: boolean;
}) {
  const texts = useTexts(partTypes);
  const { t, fmt, time } = texts;
  const newest = [...records].reverse();
  const pm = newest.find((r) => postMortemKey(r) === selected) ?? newest[0];
  if (!pm) return <p className="text-sm text-ink-muted">{t('editor:postmortem.empty')}</p>;
  return (
    <div className="grid gap-3 text-sm">
      {fastForward ? (
        <div className="flex items-center gap-2" role="status">
          <progress
            className="h-2 flex-1"
            max={fastForward.total || 1}
            value={fastForward.done}
            aria-label={t('editor:postmortem.replay.progress', {
              seconds: fmt(POSTMORTEM_WINDOW_S),
              percent: fmt(Math.round((100 * fastForward.done) / (fastForward.total || 1))),
            })}
          />
          <span>
            {t('editor:postmortem.replay.progress', {
              seconds: fmt(POSTMORTEM_WINDOW_S),
              percent: fmt(Math.round((100 * fastForward.done) / (fastForward.total || 1))),
            })}
          </span>
          <Button size="sm" variant="ghost" onClick={onCancelReplay}>
            {t('editor:postmortem.replay.cancel')}
          </Button>
        </div>
      ) : replayReady ? (
        <p role="status" className="text-ink-muted">
          {t('editor:postmortem.replay.ready')}
        </p>
      ) : null}
      {records.length > 1 && (
        <label className="flex items-center gap-2">
          <span>{t('editor:postmortem.records')}</span>
          <select
            className="rounded-md border border-line bg-surface px-2 py-1"
            value={postMortemKey(pm)}
            onChange={(e) => onSelect(e.target.value)}
          >
            {newest.map((r) => (
              <option key={postMortemKey(r)} value={postMortemKey(r)}>
                {t('editor:postmortem.damagedAt', { victim: texts.victim(r), time: time(r.record.simTime) })}
              </option>
            ))}
          </select>
        </label>
      )}
      <Record
        key={postMortemKey(pm)}
        pm={pm}
        partTypes={partTypes}
        texts={texts}
        onShow={onShow}
        onFix={onFix}
        onReplay={fastForward ? undefined : onReplay}
      />
    </div>
  );
}

function Record({
  pm,
  partTypes,
  texts,
  onShow,
  onFix,
  onReplay,
}: {
  pm: PostMortem;
  partTypes: Readonly<Record<string, string>>;
  texts: ReturnType<typeof useTexts>;
  onShow: (pm: PostMortem) => void;
  onFix?: ((pm: PostMortem) => void) | undefined;
  onReplay?: ((pm: PostMortem) => void) | undefined;
}) {
  const { t, fmt, time, si, point, victim } = texts;
  const { record } = pm;
  const finding = record.finding;
  const traces = useMemo(() => victimTraces(pm), [pm]);
  const n = useMemo(() => narrative(pm), [pm]);
  const [quantity, setQuantity] = useState<'A' | 'V'>('A');
  const shown = traces.filter((x) => x.quantity === quantity);
  const [t0, t1] = windowOf(pm);
  const columns = useCallback((w: number) => shown.map((x) => traceColumns(x, t0, t1, w)), [shown, t0, t1]);
  const range = useMemo(() => rangeOf(columns(200)), [columns]);
  const markers = useMemo(
    (): PlotMarker[] => [
      {
        at: (record.conditionSince - t0) / (t1 - t0),
        label: t('editor:postmortem.markers.since'),
        dash: [4, 3],
      },
      { at: (record.simTime - t0) / (t1 - t0), label: t('editor:postmortem.markers.at') },
    ],
    [record, t0, t1, t],
  );
  const sustain = record.simTime - record.conditionSince;
  const story = !n.target
    ? t('editor:postmortem.narrative.noTrace', {
        since: time(n.since),
        sustain: time(sustain),
        at: time(n.at),
      })
    : t(`editor:postmortem.narrative.${n.limitA === null ? 'noLimit' : 'limit'}`, {
        since: time(n.since),
        target: point(n.target),
        peak: si(n.peakA, 'A'),
        limit: n.limitA === null ? '' : si(n.limitA, 'A'),
        sustain: time(sustain),
        at: time(n.at),
      });
  const params = finding ? findingParams(finding, partTypes, t as Translate) : {};
  const level = (l: 0 | 1) => t(`editor:postmortem.code.${l ? 'high' : 'low'}`);
  const { serialLine, changedPins } = pm.code;
  return (
    <Card className="grid gap-3 p-3">
      <div>
        <h3 className="font-medium">
          <span aria-hidden>⛔ </span>
          {t('editor:postmortem.damagedAt', { victim: victim(pm), time: time(record.simTime) })}
        </h3>
        {finding && <p className="mt-1">{t(`${finding.messageKey}.title`, params)}</p>}
      </div>
      <p>{story}</p>
      {traces.length > 0 && (
        <div className="grid gap-2">
          <SegmentedControl
            label={t('editor:postmortem.series')}
            value={quantity}
            options={(['A', 'V'] as const).map((q) => ({
              value: q,
              label: t(`editor:postmortem.quantity.${q}`),
            }))}
            onChange={setQuantity}
          />
          <TracePlot
            columns={columns}
            range={range}
            markers={markers}
            label={t('editor:postmortem.chart', {
              quantity: t(`editor:postmortem.quantity.${quantity}`),
              point: shown.map((x) => point(x.label)).join('، '),
              from: time(t0),
              to: time(t1),
              peak: shown.map((x) => si(peakIn(x, t0, t1), quantity)).join('، '),
            })}
          />
          <ul className="flex flex-wrap gap-3 text-xs text-ink-muted" dir="auto">
            {shown.map((x, i) => (
              <li key={x.key} className="flex items-center gap-1">
                <svg width="20" height="6" aria-hidden>
                  <line
                    x1="0"
                    y1="3"
                    x2="20"
                    y2="3"
                    strokeWidth="2"
                    stroke={`var(--color-series-${i + 1})`}
                    strokeDasharray={TRACE_DASHES[i]?.join(' ') || undefined}
                  />
                </svg>
                {point(x.label)}
              </li>
            ))}
          </ul>
        </div>
      )}
      <section className="grid gap-1">
        <h4 className="font-medium">{t('editor:postmortem.code.title')}</h4>
        <p className="text-ink-muted">{t('editor:postmortem.code.line')}</p>
        <p>
          {serialLine === null
            ? t('editor:postmortem.code.noSerial')
            : t('editor:postmortem.code.serial', { line: `\u2068${serialLine}\u2069` })}
        </p>
        <p>
          {changedPins.length === 0
            ? t('editor:postmortem.code.noPins')
            : t('editor:postmortem.code.pins', {
                pins: changedPins
                  .map((c) =>
                    t('editor:postmortem.code.pin', {
                      pin: c.pin,
                      level: level(c.level),
                      ms: fmt(c.msBefore, 1),
                    }),
                  )
                  .join('، '),
              })}
        </p>
      </section>
      {finding && (
        <section className="grid gap-1">
          <h4 className="font-medium">{t('editor:postmortem.why')}</h4>
          <p>{t(`${finding.messageKey}.why`, params)}</p>
          <h4 className="font-medium">{t('editor:postmortem.fix')}</h4>
          <p>{t(`${finding.messageKey}.fix`, params)}</p>
        </section>
      )}
      {pm.capped && (
        <p className="text-ink-muted">{t('editor:postmortem.capped', { count: fmt(BLACKBOX_MAX_PARTS) })}</p>
      )}
      <div className={cn('flex flex-wrap gap-2')}>
        <Button size="sm" variant="secondary" onClick={() => onShow(pm)}>
          {t('editor:postmortem.actions.show')}
        </Button>
        {onFix && finding && (
          <Button size="sm" variant="secondary" onClick={() => onFix(pm)}>
            {t('editor:postmortem.actions.fix')}
          </Button>
        )}
        {onReplay && (
          <Button size="sm" onClick={() => onReplay(pm)}>
            {t('editor:postmortem.actions.replay', { seconds: fmt(POSTMORTEM_WINDOW_S) })}
          </Button>
        )}
      </div>
    </Card>
  );
}
