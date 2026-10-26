import { MAX_PROBE_PINS, type PinCapture } from '@robosim/sim-runtime/client';
import { Button } from '@robosim/ui';
import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { durationParts, measureAt, nearestEdge, tracePath } from './analyzer.js';
import { useFormat } from './format.js';
import { niceTicks } from './plotter.js';
import { useWidth } from './use-width.js';

const SETTINGS_KEY = 'robosim.analyzer.v1';
const ROW = 30;
const AXIS = 20;
const LABEL = 44;
const PAD_END = 8;
/** Default visible span while following a live capture (seconds). */
const DEFAULT_SPAN = 0.02;
const MIN_SPAN = 2e-6;

function loadPins(available: readonly string[]): string[] {
  try {
    const raw = (JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') as { pins?: unknown } | null)?.pins;
    if (Array.isArray(raw)) {
      const kept = raw.filter((p): p is string => typeof p === 'string' && available.includes(p));
      if (kept.length) return kept.slice(0, MAX_PROBE_PINS);
    }
  } catch {
    // Unreadable storage: fall back to the first pins.
  }
  return available.slice(0, Math.min(4, MAX_PROBE_PINS));
}

/** View window: following the live end of the capture, or fixed (seconds from the capture start). */
type View =
  | { readonly follow: true; readonly span: number }
  | { readonly follow: false; readonly from: number; readonly span: number };

/**
 * Logic analyzer (FR-SIM-08): records selected MCU pins with CPU-cycle timestamps and draws them as
 * a timing diagram. Click places cursor A (Shift+click: B); arrow keys move A to the previous or
 * next edge (with Shift: B), so pulse widths are read edge to edge, exact to the cycle (62.5 ns).
 */
export function LogicAnalyzer({
  pins,
  capture,
  probing,
  probe,
  onClear,
}: {
  /** MCU pins that can be recorded (the wired ones). */
  pins: readonly string[];
  capture: PinCapture | null;
  /** Pins being recorded now, or null. */
  probing: readonly string[] | null;
  probe: (pins: readonly string[] | null) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box);
  const [selected, setSelected] = useState(() => loadPins(pins));
  const [view, setView] = useState<View>({ follow: true, span: DEFAULT_SPAN });
  const [cursors, setCursors] = useState<{ a: number | null; b: number | null }>({ a: null, b: null });
  const drag = useRef<{ x: number; from: number; moved: boolean } | null>(null);

  const recording = probing !== null;
  const choose = (pin: string, on: boolean) => {
    const next = on ? [...selected, pin].slice(0, MAX_PROBE_PINS) : selected.filter((p) => p !== pin);
    // Keep the header order.
    const ordered = pins.filter((p) => next.includes(p));
    setSelected(ordered);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ pins: ordered }));
    } catch {
      // The choice lasts for the session.
    }
    if (recording) probe(ordered.length ? ordered : null);
  };

  const clock = capture?.clockHz ?? 16e6;
  const start = capture?.startCycle ?? 0;
  const length = capture ? capture.seconds(capture.until) : 0;
  const span = Math.max(MIN_SPAN, view.span);
  const from = view.follow ? Math.max(0, length - span) : view.from;
  const plotW = Math.max(10, width - LABEL - PAD_END);
  const cycleFrom = start + from * clock;
  const cycleTo = cycleFrom + span * clock;
  const x = (cycle: number) => LABEL + ((cycle - cycleFrom) / (cycleTo - cycleFrom)) * plotW;
  const cycleAt = (px: number) => cycleFrom + ((px - LABEL) / plotW) * (cycleTo - cycleFrom);
  const traces = capture?.traces ?? [];
  const height = AXIS + traces.length * ROW;

  const { version } = capture ?? { version: 0 };
  const paths = useMemo(
    () =>
      traces.map((trace, i) => {
        const top = AXIS + i * ROW;
        return tracePath(trace, cycleFrom, Math.min(cycleTo, capture?.until ?? cycleTo), x, (l) =>
          l ? top + 6 : top + ROW - 8,
        );
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` marks in-place appends to the capture.
    [capture, version, cycleFrom, cycleTo, plotW],
  );

  const units = (seconds: number) => {
    const { value, unit } = durationParts(seconds);
    const a = Math.abs(value);
    return t(`shell:lab.analyzer.unit.${unit}`, { value: fmt(value, a >= 100 ? 1 : a >= 10 ? 2 : 3) });
  };
  const hertz = (hz: number) =>
    hz >= 1e6
      ? t('shell:lab.analyzer.unit.MHz', { value: fmt(hz / 1e6, 3) })
      : hz >= 1e3
        ? t('shell:lab.analyzer.unit.kHz', { value: fmt(hz / 1e3, 3) })
        : t('shell:lab.analyzer.unit.Hz', { value: fmt(hz, 2) });

  const zoom = (factor: number, anchorCycle?: number) => {
    const next = Math.min(Math.max(MIN_SPAN, span * factor), Math.max(length, DEFAULT_SPAN) * 1.05);
    if (view.follow && anchorCycle === undefined) return setView({ follow: true, span: next });
    const anchor = anchorCycle !== undefined ? (anchorCycle - start) / clock : from + span / 2;
    const ratio = (anchor - from) / span;
    setView({ follow: false, from: Math.max(0, anchor - ratio * next), span: next });
  };
  const fit = () => setView({ follow: false, from: 0, span: Math.max(length, MIN_SPAN) });

  const onWheel = (e: WheelEvent<SVGSVGElement>) => {
    if (!capture) return;
    const left = e.currentTarget.getBoundingClientRect().left;
    zoom(e.deltaY > 0 ? 1.25 : 0.8, cycleAt(e.clientX - left));
  };
  const onDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!capture) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, from, moved: false };
  };
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (Math.abs(dx) > 3) d.moved = true;
    if (d.moved) setView({ follow: false, from: Math.max(0, d.from - (dx / plotW) * span), span });
  };
  const onUp = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved || !capture) return;
    const left = e.currentTarget.getBoundingClientRect().left;
    const px = e.clientX - left;
    if (px < LABEL) return;
    const cycle = Math.round(cycleAt(px));
    setCursors((c) => (e.shiftKey ? { ...c, b: cycle } : { ...c, a: cycle }));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (!capture) return;
    if (e.key === '+' || e.key === '=') return zoom(0.8);
    if (e.key === '-') return zoom(1.25);
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    // Time runs left to right in both directions of the page.
    const dir = e.key === 'ArrowRight' ? 1 : -1;
    const which = e.shiftKey ? 'b' : 'a';
    const at = cursors[which] ?? (dir > 0 ? cycleFrom : cycleTo);
    const edge = nearestEdge(traces, at, dir);
    if (edge === null) return;
    setCursors((c) => ({ ...c, [which]: edge }));
    const s = (edge - start) / clock;
    if (s < from || s > from + span) setView({ follow: false, from: Math.max(0, s - span / 2), span });
  };

  const ticks = niceTicks(from, from + span, Math.max(2, Math.floor(plotW / 110)));
  const cursorLine = (cycle: number | null, name: 'A' | 'B') =>
    cycle === null || cycle < cycleFrom || cycle > cycleTo ? null : (
      <g key={name}>
        <line
          x1={x(cycle)}
          x2={x(cycle)}
          y1={AXIS - 4}
          y2={height}
          className="stroke-ink"
          strokeWidth={1}
          strokeDasharray={name === 'B' ? '4 3' : undefined}
        />
        <text x={x(cycle) + 3} y={AXIS - 6} className="fill-ink text-[10px] font-semibold">
          {name}
        </text>
      </g>
    );

  const delta = cursors.a !== null && cursors.b !== null ? (cursors.b - cursors.a) / clock : null;

  return (
    <div className="flex flex-col gap-2 text-xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <fieldset className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <legend className="sr-only">{t('shell:lab.analyzer.pins', { max: fmt(MAX_PROBE_PINS) })}</legend>
          {pins.map((pin) => {
            const on = selected.includes(pin);
            return (
              <label key={pin} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={on}
                  disabled={!on && selected.length >= MAX_PROBE_PINS}
                  onChange={(e) => choose(pin, e.target.checked)}
                />
                <span className="ltr">{pin}</span>
              </label>
            );
          })}
        </fieldset>
        <div className="flex items-center gap-1">
          {recording ? (
            <Button size="sm" onClick={() => probe(null)}>
              {t('shell:lab.analyzer.stop')}
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={!selected.length}
              onClick={() => {
                setCursors({ a: null, b: null });
                setView({ follow: true, span: view.span });
                probe(selected);
              }}
            >
              {t('shell:lab.analyzer.record')}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => zoom(0.5)} disabled={!capture}>
            {t('shell:lab.analyzer.zoomIn')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => zoom(2)} disabled={!capture}>
            {t('shell:lab.analyzer.zoomOut')}
          </Button>
          <Button size="sm" variant="ghost" onClick={fit} disabled={!capture}>
            {t('shell:lab.analyzer.fit')}
          </Button>
          {recording && !view.follow && (
            <Button size="sm" variant="ghost" onClick={() => setView({ follow: true, span })}>
              {t('shell:lab.analyzer.follow')}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            disabled={!capture || recording}
            onClick={() => {
              setCursors({ a: null, b: null });
              onClear();
            }}
          >
            {t('shell:lab.analyzer.clear')}
          </Button>
        </div>
        {capture && (
          <span className="text-ink-muted" role="status">
            {t('shell:lab.analyzer.status', { length: units(length), edges: fmt(capture.edgeCount) })}
          </span>
        )}
      </div>
      {capture?.full && (
        <p role="status" className="rounded-md border border-danger/50 px-2 py-1">
          {t('shell:lab.analyzer.full')}
        </p>
      )}
      <div ref={box} dir="ltr" className="rounded-md border border-line">
        {!capture ? (
          <p dir="auto" className="p-4 text-center text-ink-muted">
            {recording ? t('shell:lab.analyzer.waiting') : t('shell:lab.analyzer.empty')}
          </p>
        ) : (
          <svg
            width={width}
            height={height}
            role="img"
            tabIndex={0}
            aria-label={t('shell:lab.analyzer.chart', {
              pins: traces.map((tr) => tr.pin).join(', '),
              from: units(from),
              to: units(from + span),
            })}
            aria-keyshortcuts="ArrowLeft ArrowRight Shift+ArrowLeft Shift+ArrowRight + -"
            onWheel={onWheel}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onKeyDown={onKey}
            className="block cursor-crosshair touch-none select-none outline-offset-[-2px]"
          >
            {ticks.map((s) => (
              <g key={s}>
                <line
                  x1={x(start + s * clock)}
                  x2={x(start + s * clock)}
                  y1={AXIS - 4}
                  y2={height}
                  className="stroke-line"
                  strokeWidth={1}
                />
                <text x={x(start + s * clock) + 2} y={10} className="fill-ink-muted text-[10px] tabular-nums">
                  {units(s)}
                </text>
              </g>
            ))}
            {traces.map((trace, i) => (
              <g key={trace.pin}>
                <text
                  x={4}
                  y={AXIS + i * ROW + ROW / 2}
                  dominantBaseline="middle"
                  className="fill-ink text-[11px] font-medium"
                >
                  {trace.pin}
                </text>
                <path
                  d={paths[i]}
                  fill="none"
                  stroke={`var(--color-series-${i + 1})`}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  data-pin={trace.pin}
                />
              </g>
            ))}
            {cursorLine(cursors.a, 'A')}
            {cursorLine(cursors.b, 'B')}
          </svg>
        )}
      </div>
      {capture && (
        <div className="overflow-x-auto">
          <p className="mb-1 text-ink-muted">
            {cursors.a === null ? (
              t('shell:lab.analyzer.hint')
            ) : (
              <>
                {t('shell:lab.analyzer.cursorA', { time: units((cursors.a - start) / clock) })}
                {cursors.b !== null && (
                  <>
                    {' · '}
                    {t('shell:lab.analyzer.cursorB', { time: units((cursors.b - start) / clock) })}
                  </>
                )}
                {delta !== null && (
                  <>
                    {' · '}
                    <span data-testid="analyzer-delta">
                      {t('shell:lab.analyzer.delta', { time: units(Math.abs(delta)) })}
                      {delta !== 0 && ` (${hertz(1 / Math.abs(delta))})`}
                    </span>
                  </>
                )}
              </>
            )}
          </p>
          {cursors.a !== null && (
            <table className="w-full text-start tabular-nums">
              <caption className="sr-only">{t('shell:lab.analyzer.measurements')}</caption>
              <thead className="text-ink-muted">
                <tr>
                  <th className="pe-3 text-start font-normal">{t('shell:lab.analyzer.col.pin')}</th>
                  <th className="pe-3 text-start font-normal">{t('shell:lab.analyzer.col.level')}</th>
                  <th className="pe-3 text-start font-normal">{t('shell:lab.analyzer.col.width')}</th>
                  <th className="pe-3 text-start font-normal">{t('shell:lab.analyzer.col.period')}</th>
                  <th className="pe-3 text-start font-normal">{t('shell:lab.analyzer.col.frequency')}</th>
                  <th className="text-start font-normal">{t('shell:lab.analyzer.col.duty')}</th>
                </tr>
              </thead>
              <tbody>
                {traces.map((trace) => {
                  const m = measureAt(trace, cursors.a ?? 0);
                  return (
                    <tr key={trace.pin}>
                      <td className="ltr pe-3">{trace.pin}</td>
                      <td className="pe-3">
                        {m.level ? t('shell:lab.analyzer.high') : t('shell:lab.analyzer.low')}
                      </td>
                      <td className="pe-3">{m.width !== undefined ? units(m.width / clock) : '—'}</td>
                      <td className="pe-3">{m.period !== undefined ? units(m.period / clock) : '—'}</td>
                      <td className="pe-3">{m.period !== undefined ? hertz(clock / m.period) : '—'}</td>
                      <td>
                        {m.duty !== undefined
                          ? t('shell:lab.analyzer.percent', { value: fmt(m.duty * 100, 1) })
                          : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
