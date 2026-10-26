import type { PinTrace } from '@robosim/sim-runtime/client';

/** Index of the last edge at or before `cycle` (−1 when the cycle precedes every edge). */
export function edgeIndexAt(trace: PinTrace, cycle: number): number {
  let lo = 0;
  let hi = trace.cycles.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((trace.cycles[mid] ?? Infinity) <= cycle) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

export function levelAt(trace: PinTrace, cycle: number): 0 | 1 {
  const i = edgeIndexAt(trace, cycle);
  return i < 0 ? trace.initial : (trace.levels[i] ?? trace.initial);
}

/** What the logic analyzer reads at a cursor (all durations in CPU cycles). */
export interface Measurement {
  readonly level: 0 | 1;
  /** Length of the high or low pulse the cursor is in, when both of its edges were recorded. */
  readonly width?: number;
  /** From this pulse's start to the start of the next pulse of the same level. */
  readonly period?: number;
  /** Share of the period spent high. */
  readonly duty?: number;
}

/** The pulse under the cursor and, when its neighbour was recorded too, the period and duty. */
export function measureAt(trace: PinTrace, cycle: number): Measurement {
  const i = edgeIndexAt(trace, cycle);
  const level = i < 0 ? trace.initial : (trace.levels[i] ?? trace.initial);
  if (i < 0) return { level };
  const start = trace.cycles[i] ?? 0;
  const end = trace.cycles[i + 1];
  if (end === undefined) return { level };
  const width = end - start;
  const next = trace.cycles[i + 2];
  if (next === undefined) return { level, width };
  const period = next - start;
  const high = level === 1 ? width : period - width;
  return { level, width, period, duty: high / period };
}

/** The nearest edge on any trace strictly before (`dir` −1) or after (+1) `cycle`. */
export function nearestEdge(traces: readonly PinTrace[], cycle: number, dir: -1 | 1): number | null {
  let best: number | null = null;
  for (const t of traces) {
    const i = edgeIndexAt(t, dir < 0 ? cycle - 1 : cycle);
    const c = dir < 0 ? t.cycles[i] : t.cycles[i + 1];
    if (c === undefined) continue;
    if (best === null || (dir < 0 ? c > best : c < best)) best = c;
  }
  return best;
}

/**
 * SVG path of one trace between `from` and `to` (cycles), `x` mapping a cycle to pixels. Edges
 * that land on the same pixel column collapse into one vertical stroke, so a megahertz signal
 * zoomed out draws as a solid band with at most two points per column.
 */
export function tracePath(
  trace: PinTrace,
  from: number,
  to: number,
  x: (cycle: number) => number,
  y: (level: 0 | 1) => number,
): string {
  let level = levelAt(trace, from);
  let d = `M${x(from).toFixed(1)} ${y(level)}`;
  // Edges are grouped by pixel column; each column becomes one vertical stroke that ends at the
  // column's last level and, when the signal went both ways inside it, spans both levels.
  let column = null as { px: number; enter: 0 | 1; both: boolean } | null;
  const flush = () => {
    if (!column) return;
    const { px, enter, both } = column;
    if (level !== enter) d += `H${px}V${y(level)}`;
    else if (both) d += `H${px}V${y(enter === 1 ? 0 : 1)}V${y(level)}`;
  };
  for (let i = edgeIndexAt(trace, from) + 1; i < trace.cycles.length; i++) {
    const c = trace.cycles[i] ?? 0;
    if (c > to) break;
    const px = Math.round(x(c));
    const next = trace.levels[i] ?? level;
    if (column?.px !== px) {
      flush();
      column = { px, enter: level, both: false };
    }
    if (next !== column.enter) column.both = true;
    level = next;
  }
  flush();
  d += `H${x(to).toFixed(1)}`;
  return d;
}

/** A duration in seconds with a unit that keeps it readable (ns, µs, ms, s). */
export function durationParts(seconds: number): {
  readonly value: number;
  readonly unit: 'ns' | 'us' | 'ms' | 's';
} {
  const a = Math.abs(seconds);
  if (a !== 0 && a < 1e-6) return { value: seconds * 1e9, unit: 'ns' };
  if (a !== 0 && a < 1e-3) return { value: seconds * 1e6, unit: 'us' };
  if (a !== 0 && a < 1) return { value: seconds * 1e3, unit: 'ms' };
  return { value: seconds, unit: 's' };
}
