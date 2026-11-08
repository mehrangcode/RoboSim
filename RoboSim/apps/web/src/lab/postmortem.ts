import type { PostMortem, PostMortemSeries } from '@robosim/sim-runtime/client';
import type { TraceColumns } from './trace-render.js';

const SLICE_S = 0.001;
/** The panel's window: the last 5 s before the damage plus a little after it. */
export const POSTMORTEM_WINDOW_S = 5;
const AFTER_S = 0.02;

/** One recorded quantity of a victim, with its 100 Hz history and its 1 kHz segment (if any). */
export interface VictimTrace {
  readonly key: string;
  readonly label: PostMortemSeries['label'];
  readonly quantity: 'V' | 'A';
  readonly low: PostMortemSeries | null;
  readonly high: PostMortemSeries | null;
}

/** Identity of a post-mortem in a list (a replay posts the same damage again with the same identity). */
export const postMortemKey = (pm: PostMortem): string => `${pm.record.slice}:${pm.record.conditionKey}`;

export function victimTraces(pm: PostMortem): VictimTrace[] {
  const out = new Map<string, VictimTrace>();
  for (const s of pm.series) {
    const t = out.get(s.key) ?? { key: s.key, label: s.label, quantity: s.quantity, low: null, high: null };
    out.set(s.key, s.intervalSlices === 1 ? { ...t, high: s } : { ...t, low: s });
  }
  return [...out.values()];
}

/** Seconds each sample of `s` starts at. */
const timeOf = (s: PostMortemSeries, k: number): number => (s.startSlice + k * s.intervalSlices) * SLICE_S;

/** Plot window [t0, t1] (s) of a post-mortem. */
export function windowOf(pm: PostMortem): readonly [number, number] {
  const t1 = pm.record.simTime + AFTER_S;
  let first = pm.record.simTime;
  for (const s of pm.series) first = Math.min(first, timeOf(s, 0));
  return [Math.max(first, pm.record.simTime - POSTMORTEM_WINDOW_S), t1];
}

/**
 * Columns of one trace over [t0, t1] in `n` pixels: 1 kHz samples where the segment covers the pixel,
 * else 100 Hz averages with the band reaching each sample's peak. Pixels without data are NaN.
 */
export function traceColumns(trace: VictimTrace, t0: number, t1: number, n: number): TraceColumns {
  const avg = new Float32Array(n).fill(NaN);
  const lo = new Float32Array(n).fill(NaN);
  const hi = new Float32Array(n).fill(NaN);
  const sum = new Float64Array(n);
  const count = new Uint32Array(n);
  const dt = (t1 - t0) / n;
  const highFrom = trace.high ? timeOf(trace.high, 0) : Infinity;
  const add = (k: number, v: number, extreme: number) => {
    if (k < 0 || k >= n || !Number.isFinite(v)) return;
    sum[k] = (sum[k] ?? 0) + v;
    count[k] = (count[k] ?? 0) + 1;
    const a = Math.min(v, extreme);
    const b = Math.max(v, extreme);
    if (!(a >= (lo[k] ?? NaN))) lo[k] = a;
    if (!(b <= (hi[k] ?? NaN))) hi[k] = b;
  };
  const low = trace.low;
  if (low)
    for (let j = 0; j < low.data.length; j++) {
      const t = timeOf(low, j);
      if (t >= highFrom) break; // the 1 kHz segment takes over
      const v = low.data[j] ?? NaN;
      // A 100 Hz sample spans 10 ms: fill every pixel it covers.
      const ka = Math.floor((t - t0) / dt);
      const kb = Math.floor((t + low.intervalSlices * SLICE_S - t0) / dt);
      for (let k = ka; k <= Math.max(ka, kb - 1); k++) add(k, v, low.peak?.[j] ?? v);
    }
  const high = trace.high;
  if (high)
    for (let j = 0; j < high.data.length; j++) {
      const v = high.data[j] ?? NaN;
      add(Math.floor((timeOf(high, j) - t0) / dt), v, v);
    }
  for (let k = 0; k < n; k++) if ((count[k] ?? 0) > 0) avg[k] = (sum[k] ?? 0) / (count[k] ?? 1);
  return { avg, lo, hi };
}

/** Value range of the columns, padded, always including 0. */
export function rangeOf(cols: readonly TraceColumns[]): readonly [number, number] {
  let a = 0;
  let b = 0;
  for (const c of cols)
    for (let k = 0; k < c.avg.length; k++) {
      const l = c.lo[k] ?? NaN;
      const h = c.hi[k] ?? NaN;
      if (Number.isFinite(l)) a = Math.min(a, l);
      if (Number.isFinite(h)) b = Math.max(b, h);
    }
  const pad = (b - a) * 0.1 || 1e-3;
  return [a < 0 ? a - pad : 0, b + pad];
}

/** Largest |value| of a trace within [from, to] (s), signed; 0 without samples. */
export function peakIn(trace: VictimTrace, from: number, to: number): number {
  let peak = 0;
  const visit = (s: PostMortemSeries | null, values: ArrayLike<number> | undefined) => {
    if (!s || !values) return;
    for (let j = 0; j < values.length; j++) {
      const t = timeOf(s, j);
      if (t + s.intervalSlices * SLICE_S <= from || t > to) continue;
      const v = values[j] ?? 0;
      if (Math.abs(v) > Math.abs(peak)) peak = v;
    }
  };
  visit(trace.low, trace.low?.peak);
  visit(trace.high, trace.high?.data);
  return peak;
}

/** The numbers of the "what happened" sentence (TD §18.8). */
export interface Narrative {
  /** Sim time the violation started and the damage happened (s). */
  readonly since: number;
  readonly at: number;
  /** Where the current was measured. */
  readonly target: PostMortemSeries['label'] | null;
  /** Largest current into the target while the violation lasted (A, magnitude). */
  readonly peakA: number;
  /** The rule's limit (A), when the finding states one. */
  readonly limitA: number | null;
}

export function narrative(pm: PostMortem): Narrative {
  const { record } = pm;
  const currents = victimTraces(pm).filter((t) => t.quantity === 'A');
  let target: VictimTrace | null = null;
  let peak = 0;
  for (const t of currents) {
    const p = Math.abs(peakIn(t, record.conditionSince, record.simTime));
    if (!target || p > peak) {
      target = t;
      peak = p;
    }
  }
  const limit = record.finding?.params['limit'];
  return {
    since: record.conditionSince,
    at: record.simTime,
    target: target?.label ?? null,
    peakA: peak,
    limitA: typeof limit === 'number' ? limit / 1000 : null,
  };
}
