import { useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { formatSi, useFormat } from './format.js';
import type { ChartSeries } from './energy-series.js';
import { ltr } from './probe-points.js';

const W = 600;
const H = 160;
const PAD = { left: 52, right: 8, top: 8, bottom: 20 };

/** Texture per slot (secondary encoding for colour-blind and forced-colour readers): angle, gap. */
const TEXTURE: readonly (readonly [number, number])[] = [
  [45, 0],
  [135, 6],
  [45, 6],
  [0, 5],
  [90, 5],
  [135, 0],
  [45, 4],
  [0, 0],
];

function Swatch({ slot }: { slot: number }) {
  return (
    <svg aria-hidden width="14" height="14" className="shrink-0 rounded-sm">
      <rect width="14" height="14" fill={`url(#power-tex-${slot})`} />
    </svg>
  );
}

/**
 * Stacked area of average power per part per bucket (FR-SIM-15): the area is the energy. A crosshair
 * reads every series at a bucket (pointer or ←/→ keys); the panel's table is the text alternative.
 */
export function EnergyChart({
  series,
  bucketSeconds,
  startSeconds,
}: {
  series: readonly ChartSeries[];
  bucketSeconds: number;
  startSeconds: number;
}) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const [at, setAt] = useState<number | null>(null);
  const n = Math.max(0, ...series.map((s) => s.values.length));
  const { stacks, max } = useMemo(() => {
    const stacks: Float64Array[] = [];
    const base = new Float64Array(n);
    for (const s of series) {
      for (let b = 0; b < n; b++) base[b] = (base[b] ?? 0) + (s.values[b] ?? 0);
      stacks.push(Float64Array.from(base));
    }
    return { stacks, max: Math.max(1e-6, ...base) };
  }, [series, n]);
  if (n === 0 || series.length === 0) return null;

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (b: number) => PAD.left + (n === 1 ? plotW / 2 : (b / (n - 1)) * plotW);
  const y = (w: number) => PAD.top + plotH - (w / max) * plotH;
  const watts = (w: number) => {
    const si = formatSi(w, 'W');
    return `${fmt(si.scaled, si.digits)} ${si.symbol}`;
  };
  const seconds = (b: number) => startSeconds + (b + 1) * bucketSeconds;
  const path = (k: number): string => {
    const top = stacks[k] as Float64Array;
    const below = k > 0 ? (stacks[k - 1] as Float64Array) : new Float64Array(n);
    const up = Array.from(top, (v, b) => `${x(b).toFixed(1)},${y(v).toFixed(1)}`);
    const down = Array.from(below, (v, b) => `${x(b).toFixed(1)},${y(v).toFixed(1)}`).reverse();
    return `M${up.join('L')}L${down.join('L')}Z`;
  };
  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const b = Math.round(((px - PAD.left) / plotW) * (n - 1));
    setAt(Math.min(n - 1, Math.max(0, b)));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    // The plot runs left to right in both directions of text: time does not flip in RTL.
    setAt((a) => Math.min(n - 1, Math.max(0, (a ?? n - 1) + step)));
  };
  const tip =
    at === null
      ? null
      : t('editor:power.chart.at', { time: ltr(`${fmt(seconds(at), bucketSeconds < 1 ? 1 : 0)} s`) });

  return (
    <figure className="m-0 flex flex-col gap-1">
      <figcaption className="text-xs text-ink-muted">{t('editor:power.chart.title')}</figcaption>
      <div className="relative" dir="ltr">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block h-auto w-full touch-none rounded border border-line bg-surface outline-none focus-visible:ring-2 focus-visible:ring-accent"
          role="img"
          tabIndex={0}
          aria-label={t('editor:power.chart.summary', { count: series.length, max: ltr(watts(max)) })}
          onPointerMove={pick}
          onPointerLeave={() => setAt(null)}
          onKeyDown={onKey}
          onBlur={() => setAt(null)}
        >
          <defs>
            {TEXTURE.map(([angle, gap], i) => (
              <pattern
                key={i}
                id={`power-tex-${i + 1}`}
                width="6"
                height="6"
                patternUnits="userSpaceOnUse"
                patternTransform={`rotate(${angle})`}
              >
                <rect width="6" height="6" fill={`var(--color-series-${i + 1})`} />
                {gap > 0 && (
                  <line
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="6"
                    stroke="var(--color-surface)"
                    strokeWidth="1.2"
                    opacity="0.55"
                  />
                )}
              </pattern>
            ))}
          </defs>
          {[0.5, 1].map((f) => (
            <g key={f}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y(max * f)}
                y2={y(max * f)}
                stroke="var(--color-line)"
                strokeWidth="0.5"
              />
              <text
                x={PAD.left - 4}
                y={y(max * f) + 3}
                textAnchor="end"
                fontSize="9"
                fill="var(--color-ink-muted)"
              >
                {watts(max * f)}
              </text>
            </g>
          ))}
          <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} stroke="var(--color-line)" />
          {series.map((s, k) => (
            // A 2 px surface edge between stacked fills keeps neighbouring series apart.
            <path
              key={s.key}
              d={path(k)}
              fill={`url(#power-tex-${s.slot})`}
              stroke="var(--color-surface)"
              strokeWidth="1"
              strokeLinejoin="round"
            />
          ))}
          <text x={PAD.left} y={H - 6} fontSize="9" fill="var(--color-ink-muted)">
            {`${fmt(startSeconds, 0)} s`}
          </text>
          <text x={W - PAD.right} y={H - 6} textAnchor="end" fontSize="9" fill="var(--color-ink-muted)">
            {`${fmt(seconds(n - 1), 0)} s`}
          </text>
          {at !== null && (
            <line
              x1={x(at)}
              x2={x(at)}
              y1={PAD.top}
              y2={PAD.top + plotH}
              stroke="var(--color-ink)"
              strokeWidth="1"
            />
          )}
        </svg>
        {at !== null && (
          <div
            role="status"
            className="pointer-events-none absolute top-1 rounded border border-line bg-surface-raised px-2 py-1 text-xs text-ink shadow-sm"
            style={
              x(at) > W / 2
                ? { right: `${(1 - x(at) / W) * 100 + 2}%` }
                : { left: `${(x(at) / W) * 100 + 2}%` }
            }
          >
            <p className="m-0 text-ink-muted">{tip}</p>
            {[...series].reverse().map((s) => (
              <p key={s.key} className="m-0 flex items-center gap-1">
                <Swatch slot={s.slot} />
                <span className="truncate">{s.label}</span>
                <span className="ms-auto ps-2 font-mono tabular-nums">{watts(s.values[at] ?? 0)}</span>
              </p>
            ))}
          </div>
        )}
      </div>
      <ul className="m-0 flex list-none flex-wrap gap-x-3 gap-y-1 p-0 text-xs text-ink">
        {series.map((s) => (
          <li key={s.key} className="flex items-center gap-1">
            <Swatch slot={s.slot} />
            {s.label}
          </li>
        ))}
      </ul>
    </figure>
  );
}
