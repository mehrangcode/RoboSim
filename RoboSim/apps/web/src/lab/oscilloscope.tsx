import type { ProjectDocument } from '@robosim/shared';
import { Button, SegmentedControl } from '@robosim/ui';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { downloadBlob, fileBase } from '../editor/project-file.js';
import { toCsv } from '../lib/csv.js';
import { durationParts } from './analyzer.js';
import { formatSi, useFormat } from './format.js';
import { niceTicks } from './plotter.js';
import { decodePoint, encodePoint, ltr, pointOptions } from './probe-points.js';
import {
  PRE_TRIGGER,
  SLICE_S,
  columns,
  extent,
  measure,
  scopeRows,
  steps125,
  sweep,
  valueAt,
  type Edge,
  type TriggerMode,
} from './scope-math.js';
import { TRACE_DASHES, drawGrid, drawTrace, prepareCanvas, seriesColor } from './trace-render.js';
import { DIVS_X, DIVS_Y, probeLabel, unitOf, type ScopeModel } from './use-scope.js';
import { useWidth } from './use-width.js';

const HEIGHT = 240;
/** 10 µs/div … 1 s/div; below 1 ms/div fine mode shows a reactive circuit's sub-steps. */
const TIMEBASES = steps125(0.00001, 1);
const SCALES = steps125(0.001, 10);
const MODES: readonly TriggerMode[] = ['auto', 'normal', 'single'];
const EDGES: readonly Edge[] = ['rising', 'falling'];
const COLUMNS = ['channel', 'atA', 'atB', 'delta', 'min', 'max', 'avg', 'rms', 'freq'] as const;

type View = { readonly follow: true } | { readonly follow: false; readonly from: number };
interface Held {
  readonly from: number | null;
  readonly frozen: boolean;
  readonly armedAt: number;
}

/**
 * Oscilloscope dock panel (FR-SIM-14, US-SIM-10): up to 4 channels over net voltages and part currents,
 * timebase, per-channel scale and position, trigger (edge, level, auto/normal/single, holdoff), cursors
 * A/B with Δt, ΔV, frequency, RMS, min/max/average, and CSV export. Readings come once per 1 ms slice;
 * PWM edges are rebuilt from the timer. Paused or held, the whole buffer can be scrolled back.
 */
export function Oscilloscope({
  doc,
  scope,
  run,
}: {
  doc: ProjectDocument;
  scope: ScopeModel;
  run: 'none' | 'paused' | 'running';
}) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const width = useWidth(box);
  const { settings, setSettings, buffer, version } = scope;
  const { channels, timebase, trigger } = settings;
  const span = timebase * DIVS_X;
  const [view, setView] = useState<View>({ follow: true });
  const [held, setHeld] = useState<Held>({ from: null, frozen: false, armedAt: 0 });
  const [cursors, setCursors] = useState<{ a: number | null; b: number | null }>({ a: null, b: null });
  const [pick, setPick] = useState('');
  const drag = useRef<{ x: number; from: number; moved: boolean } | null>(null);
  const groups = useMemo(() => pointOptions(doc), [doc]);

  // Live screen: follow the trigger; the sweep state carries over between renders (normal / single).
  const ext = buffer ? extent(buffer) : null;
  const trigCh = trigger.ch !== null && trigger.ch < channels.length ? trigger.ch : null;
  const sw = buffer && view.follow && run !== 'none' ? sweep(buffer, trigCh, trigger, span, held) : null;
  if (sw && (sw.from !== held.from || sw.frozen !== held.frozen))
    setHeld({ ...held, from: sw.from, frozen: sw.frozen });
  const from = view.follow ? (sw?.from ?? held.from ?? 0) : view.from;
  const status = sw?.status ?? (trigger.mode === 'single' && !held.frozen ? 'armed' : null);

  const unitLabel = (v: number, unit: ReturnType<typeof unitOf>) => {
    const si = formatSi(v, unit);
    return `${fmt(si.scaled, si.digits)} ${si.symbol}`;
  };
  const time = (seconds: number) => {
    const { value, unit } = durationParts(seconds);
    const a = Math.abs(value);
    return t(`shell:lab.analyzer.unit.${unit}`, { value: fmt(value, a >= 100 ? 1 : a >= 10 ? 2 : 3) });
  };
  const hertz = (hz: number) =>
    hz >= 1e3
      ? t('shell:lab.analyzer.unit.kHz', { value: fmt(hz / 1e3, 3) })
      : t('shell:lab.analyzer.unit.Hz', { value: fmt(hz, 2) });

  const x = (s: number) => ((s - from) / span) * width;
  const timeAt = (px: number) => from + (px / width) * span;

  // Draw (canvas 2D): grid, per channel a min/max band, the trace in its colour and dash, cursors.
  useEffect(() => {
    const el = canvas.current;
    const prepared = el ? prepareCanvas(el, width, HEIGHT) : null;
    if (!prepared) return;
    const { ctx, color } = prepared;
    drawGrid(ctx, width, HEIGHT, DIVS_X, DIVS_Y, color('--color-line', '#ccc'));
    if (!buffer) return;
    const n = Math.max(1, Math.floor(width));
    const dy = HEIGHT / DIVS_Y;
    channels.forEach((c, i) => {
      if (buffer.unresolved.includes(i)) return;
      const y = (v: number) => HEIGHT / 2 - (v / c.scale + c.offset) * dy;
      const col = columns(buffer, i, from, from + span, n);
      // A rebuilt PWM edge: a vertical step from the level before to the level after.
      drawTrace(ctx, col, n, y, seriesColor(color, i), TRACE_DASHES[i] ?? [], (k) => [
        valueAt(buffer, i, from + (k / n) * span),
        valueAt(buffer, i, from + ((k + 1) / n) * span),
      ]);
    });
    ctx.strokeStyle = color('--color-ink', '#111');
    ctx.lineWidth = 1;
    for (const [which, at] of [
      ['A', cursors.a],
      ['B', cursors.b],
    ] as const) {
      if (at === null || at < from || at > from + span) continue;
      const cx = Math.round(((at - from) / span) * width) + 0.5;
      ctx.setLineDash(which === 'B' ? [4, 3] : []);
      ctx.beginPath();
      ctx.moveTo(cx, 0);
      ctx.lineTo(cx, HEIGHT);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }, [buffer, version, channels, from, span, width, cursors]);

  const hold = (at: number) => setView({ follow: false, from: Math.max(ext?.from ?? 0, at) });
  const onWheel = (e: WheelEvent<HTMLCanvasElement>) => {
    if (!ext) return;
    hold(from + (e.deltaY > 0 ? 0.1 : -0.1) * span);
  };
  const onDown = (e: PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, from, moved: false };
  };
  const onMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (Math.abs(dx) > 3) d.moved = true;
    if (d.moved) hold(d.from - (dx / width) * span);
  };
  const onUp = (e: PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved) return;
    const at = timeAt(e.clientX - e.currentTarget.getBoundingClientRect().left);
    setCursors((c) => (e.shiftKey ? { ...c, b: at } : { ...c, a: at }));
  };
  const setTimebase = (tb: number) => setSettings((s) => ({ ...s, timebase: tb }));
  const zoom = (dir: 1 | -1) => {
    const i = TIMEBASES.indexOf(timebase);
    const next = TIMEBASES[Math.min(TIMEBASES.length - 1, Math.max(0, (i < 0 ? 6 : i) + dir))];
    if (next !== undefined) setTimebase(next);
  };
  const onKey = (e: KeyboardEvent<HTMLCanvasElement>) => {
    if (e.key === '+' || e.key === '=') return zoom(-1);
    if (e.key === '-') return zoom(1);
    if (e.key === 'Home') return setView({ follow: true });
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    // Time runs left to right in both page directions.
    const step = (e.key === 'ArrowRight' ? 1 : -1) * (span / 100);
    const which = e.shiftKey ? 'b' : 'a';
    setCursors((c) => ({ ...c, [which]: (c[which] ?? from + span / 2) + step }));
  };

  const arm = () => {
    setHeld({ from: null, frozen: false, armedAt: ext?.to ?? 0 });
    setView({ follow: true });
  };
  const setTrigger = (patch: Partial<typeof trigger>) => {
    setSettings((s) => ({ ...s, trigger: { ...s.trigger, ...patch } }));
    if (patch.mode !== undefined || patch.ch !== undefined)
      setHeld({ from: null, frozen: false, armedAt: ext?.to ?? 0 });
  };

  const name = (i: number) => t('editor:scope.channel', { n: fmt(i + 1) });
  const exportCsv = (whole: boolean) => {
    if (!buffer) return;
    const rows = scopeRows(
      buffer,
      channels.map((c, i) => ({ name: `ch${i + 1}`, unit: unitOf(c.probe) })),
      whole ? -Infinity : from,
      whole ? Infinity : from + span,
    );
    downloadBlob(`${fileBase(doc)}-scope.csv`, new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }));
  };

  const both = cursors.a !== null && cursors.b !== null;
  const [w0, w1] = both ? [cursors.a ?? 0, cursors.b ?? 0] : [from, from + span];
  const dt = both ? Math.abs((cursors.b ?? 0) - (cursors.a ?? 0)) : null;
  const ticks = niceTicks(from, from + span, Math.max(2, Math.floor(width / 110)));
  const pwmShown = buffer
    ? channels.some((_, i) => buffer.pwmAt(i, Math.ceil((from + span / 2) / SLICE_S)))
    : false;

  return (
    <section aria-label={t('editor:scope.title')} className="flex flex-col gap-2 text-xs">
      <ul className="flex flex-col gap-1" aria-label={t('editor:scope.channels')}>
        {channels.map((c, i) => {
          const unit = unitOf(c.probe);
          return (
            <li
              key={i}
              className="flex flex-wrap items-center gap-x-2 gap-y-1"
              data-testid={`scope-ch${i + 1}`}
            >
              <svg width="28" height="10" aria-hidden="true" className="shrink-0">
                <line
                  x1="1"
                  x2="27"
                  y1="5"
                  y2="5"
                  stroke={`var(--color-series-${i + 1})`}
                  strokeWidth="2"
                  strokeDasharray={TRACE_DASHES[i]?.join(' ') || undefined}
                />
              </svg>
              <span className="font-semibold">{name(i)}</span>
              <span className="ltr">{probeLabel(c.probe)}</span>
              <span className="text-ink-muted">({t(`editor:scope.kind.${c.probe.kind}`)})</span>
              {scope.gone[i] && <span title={t('editor:scope.gone')}>—</span>}
              <label className="flex items-center gap-1 text-ink-muted">
                {t('editor:scope.scale')}
                <select
                  className="rounded border border-line bg-surface px-1 py-0.5 text-ink"
                  value={c.scale}
                  aria-label={t('editor:scope.scaleOf', { channel: name(i) })}
                  onChange={(e) => scope.updateChannel(i, { scale: Number(e.target.value) })}
                >
                  {SCALES.map((v) => (
                    <option key={v} value={v}>
                      {t('editor:scope.perDiv', { value: unitLabel(v, unit) })}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                size="sm"
                variant="ghost"
                aria-label={t('editor:scope.up', { channel: name(i) })}
                onClick={() => scope.updateChannel(i, { offset: Math.min(DIVS_Y / 2, c.offset + 0.5) })}
              >
                ↑
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={t('editor:scope.down', { channel: name(i) })}
                onClick={() => scope.updateChannel(i, { offset: Math.max(-DIVS_Y / 2, c.offset - 0.5) })}
              >
                ↓
              </Button>
              <Button size="sm" variant="ghost" onClick={() => scope.remove(i)}>
                {t('editor:scope.remove', { channel: name(i) })}
              </Button>
            </li>
          );
        })}
      </ul>

      {scope.full ? (
        <p className="text-ink-muted">{t('editor:scope.add.full')}</p>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-0 flex-col gap-0.5 text-ink-muted">
            {t('editor:scope.add.point')}
            <select
              className="min-w-0 rounded border border-line bg-surface px-1 py-1 text-sm text-ink"
              value={pick}
              onChange={(e) => setPick(e.target.value)}
            >
              <option value="">{t('editor:scope.add.choose')}</option>
              {groups.map((g) => (
                <optgroup key={g.group} label={g.group}>
                  {g.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <Button
            size="sm"
            variant="secondary"
            disabled={!pick}
            onClick={() => {
              scope.add({ kind: 'v', red: decodePoint(pick), black: null });
              setPick(encodePoint(null));
            }}
          >
            {t('editor:scope.add.button')}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            aria-pressed={scope.armed}
            className="aria-pressed:ring-2 aria-pressed:ring-accent"
            onClick={() => scope.setArmed(!scope.armed)}
          >
            {t('editor:scope.add.place')}
          </Button>
        </div>
      )}
      {scope.armed && (
        <p role="status" className="rounded-md border border-accent/50 px-2 py-1">
          {t('editor:scope.add.armed')}
        </p>
      )}

      <div className="flex flex-wrap items-end gap-x-3 gap-y-1.5">
        <label className="flex flex-col gap-0.5 text-ink-muted">
          {t('editor:scope.timebase')}
          <select
            className="rounded border border-line bg-surface px-1 py-1 text-ink"
            value={timebase}
            onChange={(e) => setTimebase(Number(e.target.value))}
          >
            {TIMEBASES.map((v) => (
              <option key={v} value={v}>
                {t('editor:scope.perDiv', { value: time(v) })}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5 text-ink-muted">
          {t('editor:scope.trigger.source')}
          <select
            className="rounded border border-line bg-surface px-1 py-1 text-ink"
            value={trigCh ?? ''}
            onChange={(e) => setTrigger({ ch: e.target.value === '' ? null : Number(e.target.value) })}
          >
            <option value="">{t('editor:scope.trigger.none')}</option>
            {channels.map((_, i) => (
              <option key={i} value={i}>
                {name(i)}
              </option>
            ))}
          </select>
        </label>
        <SegmentedControl
          label={t('editor:scope.trigger.edge.label')}
          value={trigger.edge}
          onChange={(edge) => setTrigger({ edge })}
          options={EDGES.map((e) => ({ value: e, label: t(`editor:scope.trigger.edge.${e}`) }))}
        />
        <label className="flex flex-col gap-0.5 text-ink-muted">
          {t('editor:scope.trigger.level', {
            unit: trigCh !== null && channels[trigCh] ? unitOf(channels[trigCh].probe) : 'V',
          })}
          <input
            type="number"
            step="any"
            dir="ltr"
            className="w-20 rounded border border-line bg-surface px-1 py-1 text-ink"
            value={trigger.level}
            onChange={(e) =>
              Number.isFinite(e.target.valueAsNumber) && setTrigger({ level: e.target.valueAsNumber })
            }
          />
        </label>
        <label className="flex flex-col gap-0.5 text-ink-muted">
          {t('editor:scope.trigger.holdoff')}
          <input
            type="number"
            min={0}
            step="any"
            dir="ltr"
            className="w-16 rounded border border-line bg-surface px-1 py-1 text-ink"
            value={trigger.holdoffS * 1000}
            onChange={(e) =>
              Number.isFinite(e.target.valueAsNumber) &&
              setTrigger({ holdoffS: Math.max(0, e.target.valueAsNumber) / 1000 })
            }
          />
        </label>
        <SegmentedControl
          label={t('editor:scope.trigger.mode.label')}
          value={trigger.mode}
          onChange={(mode) => setTrigger({ mode })}
          options={MODES.map((m) => ({ value: m, label: t(`editor:scope.trigger.mode.${m}`) }))}
        />
        {trigger.mode === 'single' && (
          <Button size="sm" variant="secondary" onClick={arm}>
            {t('editor:scope.trigger.arm')}
          </Button>
        )}
        {!view.follow && (
          <Button size="sm" variant="ghost" onClick={() => setView({ follow: true })}>
            {t('editor:scope.live')}
          </Button>
        )}
      </div>

      <p role="status" className="text-ink-muted" data-testid="scope-status">
        {!view.follow ? t('editor:scope.held') : status ? t(`editor:scope.status.${status}`) : ''}
      </p>

      <div ref={box} dir="ltr" className="relative rounded-md border border-line">
        {!channels.length ? (
          <p dir="auto" className="p-4 text-center text-ink-muted">
            {t('editor:scope.empty')}
          </p>
        ) : run === 'none' && !buffer ? (
          <p dir="auto" className="p-4 text-center text-ink-muted">
            {t('editor:scope.noRun')}
          </p>
        ) : (
          <>
            <canvas
              ref={canvas}
              role="img"
              tabIndex={0}
              style={{ width, height: HEIGHT }}
              aria-label={t('editor:scope.chart', {
                channels: channels.map((c, i) => `${name(i)} ${probeLabel(c.probe)}`).join(', '),
                from: time(from),
                to: time(from + span),
              })}
              aria-keyshortcuts="ArrowLeft ArrowRight Shift+ArrowLeft Shift+ArrowRight + - Home"
              onWheel={onWheel}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onKeyDown={onKey}
              className="block cursor-crosshair touch-none select-none outline-offset-[-2px]"
            />
            <div className="relative h-4 text-[10px] text-ink-muted tabular-nums" aria-hidden="true">
              {ticks.map((s) => (
                <span key={s} className="absolute" style={{ left: x(s) + 2 }}>
                  {time(s)}
                </span>
              ))}
            </div>
            {view.follow && status === 'triggered' && (
              // Trigger point marker (10 % into the screen).
              <svg
                aria-hidden="true"
                width="8"
                height="6"
                className="absolute top-0 fill-ink"
                style={{ left: PRE_TRIGGER * width - 4 }}
              >
                <path d="M0 0h8L4 6z" />
              </svg>
            )}
          </>
        )}
      </div>

      {channels.length > 0 && (
        <div className="flex flex-col gap-1">
          {scope.fine === 'on' && (
            <p className="text-ink-muted" data-testid="scope-fine">
              {t('editor:scope.note.fineOn')}
            </p>
          )}
          {scope.fine === 'none' && (
            <p className="text-ink-muted" data-testid="scope-fine">
              {t('editor:scope.note.fineNone')}
            </p>
          )}
          {scope.fine === 'slow' && (
            <p role="status" className="flex flex-wrap items-center gap-2" data-testid="scope-fine">
              {t('editor:scope.note.fineSlow')}
              <Button size="sm" variant="secondary" onClick={scope.retryFine}>
                {t('editor:scope.fineRetry')}
              </Button>
            </p>
          )}
          {scope.fine === 'off' && timebase <= 0.002 && (
            <p className="text-ink-muted">{t('editor:scope.note.aliasing')}</p>
          )}
          {pwmShown && <p className="text-ink-muted">{t('editor:scope.note.pwm')}</p>}
          <p className="text-ink-muted" data-testid="scope-cursors">
            {cursors.a === null && cursors.b === null ? (
              t('editor:scope.cursor.hint')
            ) : (
              <>
                {cursors.a !== null && t('editor:scope.cursor.a', { time: ltr(time(cursors.a)) })}
                {cursors.b !== null && <> · {t('editor:scope.cursor.b', { time: ltr(time(cursors.b)) })}</>}
                {dt !== null && (
                  <>
                    {' · '}
                    {t('editor:scope.cursor.delta', {
                      time: ltr(time(dt)),
                      freq: dt > 0 ? ltr(hertz(1 / dt)) : '—',
                    })}
                  </>
                )}
              </>
            )}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-start tabular-nums" data-testid="scope-measurements">
              <caption className="text-start text-ink-muted">
                {t(both ? 'editor:scope.window.cursors' : 'editor:scope.window.screen')}
              </caption>
              <thead className="text-ink-muted">
                <tr>
                  {COLUMNS.map((col) => (
                    <th key={col} className="pe-3 text-start font-normal">
                      {t(`editor:scope.col.${col}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {channels.map((c, i) => {
                  const unit = unitOf(c.probe);
                  const ok = buffer && !buffer.unresolved.includes(i) && !scope.gone[i];
                  const m = ok ? measure(buffer, i, w0, w1) : null;
                  const at = (s: number | null) => (ok && s !== null ? valueAt(buffer, i, s) : NaN);
                  const cell = (v: number | null | undefined) =>
                    v !== null && v !== undefined && Number.isFinite(v) ? (
                      <bdi className="ltr">{unitLabel(v, unit)}</bdi>
                    ) : (
                      '—'
                    );
                  const va = at(cursors.a);
                  const vb = at(cursors.b);
                  return (
                    <tr key={i}>
                      <td className="pe-3">{name(i)}</td>
                      <td className="pe-3">{cell(va)}</td>
                      <td className="pe-3">{cell(vb)}</td>
                      <td className="pe-3">{cell(both ? vb - va : null)}</td>
                      <td className="pe-3">{cell(m?.min)}</td>
                      <td className="pe-3">{cell(m?.max)}</td>
                      <td className="pe-3">{cell(m?.avg)}</td>
                      <td className="pe-3">{cell(m?.rms)}</td>
                      <td>{m?.freqHz ? <bdi className="ltr">{hertz(m.freqHz)}</bdi> : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" disabled={!buffer} onClick={() => exportCsv(false)}>
              {t('editor:scope.csv.screen')}
            </Button>
            <Button size="sm" variant="secondary" disabled={!buffer} onClick={() => exportCsv(true)}>
              {t('editor:scope.csv.all')}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
