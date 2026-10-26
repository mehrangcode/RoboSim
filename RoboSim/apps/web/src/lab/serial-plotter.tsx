import type { SerialLine } from '@robosim/sim-runtime/client';
import { Button } from '@robosim/ui';
import { useMemo, useRef, useState, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { formatSliceTime, useFormat } from './format.js';
import { PLOT_WINDOWS, buildPlot, niceTicks, plotRange, type PlotData } from './plotter.js';
import { useWidth } from './use-width.js';

const SETTINGS_KEY = 'robosim.plotter.v1';
const HEIGHT = 160;
const PAD = { left: 48, right: 8, top: 8, bottom: 18 };

function loadWindow(): number {
  try {
    const raw = (JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') as { window?: number } | null)
      ?.window;
    return PLOT_WINDOWS.includes(raw as never) ? (raw as number) : 100;
  } catch {
    return 100;
  }
}

/** Compact axis number: up to 4 significant digits, exponent for very large or small values. */
function axisLabel(v: number): string {
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e5 || a < 1e-3)) return v.toExponential(1);
  return String(Number(v.toPrecision(4)));
}

/**
 * Serial plotter (FR-SIM-07, P2): numbers on each serial line become series, one colour per series
 * in the order they first appeared (US-SIM-03 AC2). Drawn in SVG with a crosshair and tooltip; the
 * legend carries every series' latest value as text, so identity never rests on colour alone.
 */
export function SerialPlotter({ lines, partial }: { lines: readonly SerialLine[]; partial: boolean }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box);
  const [points, setPoints] = useState(loadWindow);
  const [frozen, setFrozen] = useState<PlotData | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [hover, setHover] = useState<number | null>(null);

  const live = useMemo(() => buildPlot(lines, partial, points), [lines, partial, points]);
  const plot = frozen ?? live;
  const { samples, keys, dropped } = plot;
  const shown = keys.filter((k) => !hidden.has(k));
  const range = plotRange(samples, shown);

  const plotW = Math.max(10, width - PAD.left - PAD.right);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const step = plotW / Math.max(1, points - 1);
  // The newest sample sits on the right edge; a short history enters from the right.
  const offset = points - samples.length;
  const x = (i: number) => PAD.left + (i + offset) * step;
  const y = (v: number) =>
    range ? PAD.top + plotH - ((v - range.min) / (range.max - range.min)) * plotH : PAD.top + plotH / 2;

  const name = (key: string) => (key.startsWith('#') ? t('shell:lab.plot.value', { n: key.slice(1) }) : key);
  const color = (key: string) => `var(--color-series-${keys.indexOf(key) + 1})`;

  const paths = shown.map((key) => {
    let d = '';
    let pen = false;
    samples.forEach((s, i) => {
      const v = s.values.get(key);
      if (v === undefined) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
      pen = true;
    });
    return { key, d };
  });

  const setWin = (w: number) => {
    setPoints(w);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ window: w }));
    } catch {
      // Storage unavailable: the choice lasts for the session.
    }
  };

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!samples.length) return;
    const left = e.currentTarget.getBoundingClientRect().left;
    const i = Math.round((e.clientX - left - PAD.left) / step) - offset;
    setHover(i >= 0 && i < samples.length ? i : null);
  };

  const latest = (key: string) => {
    for (let i = samples.length - 1; i >= 0; i--) {
      const v = samples[i]?.values.get(key);
      if (v !== undefined) return v;
    }
    return undefined;
  };
  const hovered = hover !== null ? samples[hover] : undefined;
  const select = 'rounded-md border border-line bg-surface px-1.5 py-0.5 text-xs';

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
        <label className="flex items-center gap-1">
          {t('shell:lab.plot.window')}
          <select className={select} value={points} onChange={(e) => setWin(Number(e.target.value))}>
            {PLOT_WINDOWS.map((w) => (
              <option key={w} value={w}>
                {fmt(w)}
              </option>
            ))}
          </select>
        </label>
        <Button
          size="sm"
          variant="ghost"
          aria-pressed={frozen !== null}
          onClick={() => setFrozen(frozen ? null : live)}
        >
          {frozen ? t('shell:lab.plot.resume') : t('shell:lab.plot.pause')}
        </Button>
        <ul className="flex flex-wrap items-center gap-x-3 gap-y-1" aria-label={t('shell:lab.plot.legend')}>
          {keys.map((key) => {
            const v = latest(key);
            const off = hidden.has(key);
            return (
              <li key={key}>
                <button
                  type="button"
                  aria-pressed={!off}
                  title={t('shell:lab.plot.toggle', { name: name(key) })}
                  onClick={() =>
                    setHidden((h) => {
                      const next = new Set(h);
                      if (off) next.delete(key);
                      else next.add(key);
                      return next;
                    })
                  }
                  className={`flex items-center gap-1 rounded px-1 ${off ? 'opacity-50 line-through' : ''}`}
                >
                  <span
                    aria-hidden
                    className="inline-block h-0.5 w-3 rounded"
                    style={{ background: color(key) }}
                  />
                  <span>{name(key)}</span>
                  {v !== undefined && <span className="ltr tabular-nums text-ink-muted">{axisLabel(v)}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      {dropped.length > 0 && (
        <p role="status" className="mb-1 text-xs text-ink-muted">
          {t('shell:lab.plot.dropped', { max: fmt(keys.length), names: dropped.join(', ') })}
        </p>
      )}
      <div ref={box} dir="ltr" className="relative rounded-md border border-line">
        {samples.length === 0 ? (
          <p
            dir="auto"
            className="flex h-40 items-center justify-center p-4 text-center text-xs text-ink-muted"
          >
            {t('shell:lab.plot.empty')}
          </p>
        ) : (
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            aria-label={t('shell:lab.plot.chart', { count: fmt(shown.length), points: fmt(samples.length) })}
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
            className="block touch-none select-none"
          >
            {range &&
              niceTicks(range.min, range.max, 4).map((v) => (
                <g key={v}>
                  <line
                    x1={PAD.left}
                    x2={PAD.left + plotW}
                    y1={y(v)}
                    y2={y(v)}
                    className="stroke-line"
                    strokeWidth={1}
                  />
                  <text
                    x={PAD.left - 4}
                    y={y(v)}
                    textAnchor="end"
                    dominantBaseline="middle"
                    className="fill-ink-muted text-[10px] tabular-nums"
                  >
                    {axisLabel(v)}
                  </text>
                </g>
              ))}
            <text x={PAD.left} y={HEIGHT - 4} className="fill-ink-muted text-[10px] tabular-nums">
              {formatSliceTime(samples[0]?.slice ?? 0)}
            </text>
            <text
              x={PAD.left + plotW}
              y={HEIGHT - 4}
              textAnchor="end"
              className="fill-ink-muted text-[10px] tabular-nums"
            >
              {formatSliceTime(samples.at(-1)?.slice ?? 0)}
            </text>
            {paths.map(({ key, d }) => (
              <path
                key={key}
                d={d}
                fill="none"
                stroke={color(key)}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                data-series={key}
              />
            ))}
            {hovered && hover !== null && (
              <g>
                <line
                  x1={x(hover)}
                  x2={x(hover)}
                  y1={PAD.top}
                  y2={PAD.top + plotH}
                  className="stroke-ink-muted"
                  strokeWidth={1}
                />
                {shown.map((key) => {
                  const v = hovered.values.get(key);
                  return v === undefined ? null : (
                    <circle
                      key={key}
                      cx={x(hover)}
                      cy={y(v)}
                      r={4}
                      fill={color(key)}
                      className="stroke-surface"
                      strokeWidth={2}
                    />
                  );
                })}
              </g>
            )}
          </svg>
        )}
        {hovered && hover !== null && (
          <div
            role="tooltip"
            className="pointer-events-none absolute top-1 rounded-md border border-line bg-surface-raised px-2 py-1 text-xs shadow"
            style={x(hover) > width / 2 ? { right: width - x(hover) + 8 } : { left: x(hover) + 8 }}
          >
            <div className="tabular-nums text-ink-muted">{formatSliceTime(hovered.slice)}</div>
            {shown.map((key) => {
              const v = hovered.values.get(key);
              return v === undefined ? null : (
                <div key={key} className="flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ background: color(key) }}
                  />
                  <span>{name(key)}</span>
                  <span className="ms-auto ps-2 tabular-nums">{axisLabel(v)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
