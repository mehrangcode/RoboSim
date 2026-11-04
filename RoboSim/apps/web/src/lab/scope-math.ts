import type { ScopeBuffer } from '@robosim/sim-runtime/client';
import type { Cell } from '../lib/csv.js';

/**
 * Oscilloscope maths (FR-SIM-14, TD §18.3): the signal between readings, level crossings, triggers,
 * cursor measurements, per-pixel decimation and CSV rows. Pure functions over a ScopeBuffer.
 *
 * Reading `k` is the slice ending at `k` ms. Between readings the trace is linear, except on a channel
 * driven by PWM: 1 kHz readings cannot show a 490 / 980 Hz square wave, so its edges are rebuilt from
 * the timer's frequency and duty, between the slice's low and high phase levels (min / max). The PWM
 * phase is counted from t = 0 (the timer runs from reset), high first. In fine mode (TD §18.3 phase 2)
 * a reactive circuit's slice also carries its integration sub-steps, and the trace is linear between
 * them instead.
 */

/** Seconds per reading (one simulation slice). */
export const SLICE_S = 0.001;

export type ScopeSource = Pick<ScopeBuffer, 'start' | 'end' | 'channels' | 'value' | 'pwmAt'> &
  Partial<Pick<ScopeBuffer, 'fine'>>;

/** Slice whose reading covers time `t` (s): (k − 1, k] ms. */
const sliceOf = (t: number) => Math.ceil(t / SLICE_S - 1e-9);
const frac = (x: number) => x - Math.floor(x);

/** First and last reading times (s), or null for an empty buffer. */
export function extent(buf: ScopeSource): { from: number; to: number } | null {
  return buf.end > buf.start ? { from: buf.start * SLICE_S, to: (buf.end - 1) * SLICE_S } : null;
}

/** PWM rebuilding `ch` in slice `k`, with its levels; null when the slice is not a rebuildable PWM. */
function pwmIn(buf: ScopeSource, ch: number, k: number) {
  const p = buf.pwmAt(ch, k);
  if (!p || p.duty <= 0 || p.duty >= 1) return null;
  const lo = buf.value(ch, k, 1);
  const hi = buf.value(ch, k, 2);
  return Number.isFinite(lo) && Number.isFinite(hi) && hi > lo ? { ...p, lo, hi } : null;
}

/** First index in [from, to) with `t[i] ≥ x`. */
function lowerBound(t: Float64Array, from: number, to: number, x: number): number {
  let lo = from;
  let hi = to;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((t[mid] ?? Infinity) < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Sub-step samples of slice `k` ((k − 1, k] ms) as a polyline starting at the slice's left edge: the
 * previous slice's last sample, else the previous reading. Null when the slice has no sub-steps.
 */
function fineIn(buf: ScopeSource, ch: number, k: number): { t: number[]; v: number[] } | null {
  const f = buf.fine?.(ch);
  if (!f || f.to === f.from) return null;
  const left = (k - 1) * SLICE_S;
  const i0 = lowerBound(f.t, f.from, f.to, left + 1e-9);
  const i1 = lowerBound(f.t, f.from, f.to, k * SLICE_S + 1e-9);
  if (i1 <= i0) return null;
  const t: number[] = [];
  const v: number[] = [];
  const prev = i0 - 1;
  if (prev >= f.from && (f.t[prev] ?? -Infinity) >= left - 1e-9) {
    t.push(f.t[prev] ?? left);
    v.push(f.v[prev] ?? NaN);
  } else if (Number.isFinite(buf.value(ch, k - 1))) {
    t.push(left);
    v.push(buf.value(ch, k - 1));
  }
  for (let i = i0; i < i1; i++) {
    t.push(f.t[i] ?? 0);
    v.push(f.v[i] ?? NaN);
  }
  return { t, v };
}

/** The polyline at `t`: linear between its points, held beyond them. */
function polyAt(line: { t: number[]; v: number[] }, t: number): number {
  const n = line.t.length;
  if (t <= (line.t[0] ?? 0)) return line.v[0] ?? NaN;
  for (let i = 1; i < n; i++) {
    const tb = line.t[i] ?? 0;
    if (t <= tb) {
      const ta = line.t[i - 1] ?? 0;
      const va = line.v[i - 1] ?? NaN;
      const vb = line.v[i] ?? NaN;
      return tb > ta ? va + ((vb - va) * (t - ta)) / (tb - ta) : vb;
    }
  }
  return line.v[n - 1] ?? NaN;
}

/** True when slice `k` of `ch` carries fine-mode sub-steps. */
export function hasFine(buf: ScopeSource, ch: number, k: number): boolean {
  return fineIn(buf, ch, k) !== null;
}

/**
 * The trace at time `t` (s): rebuilt PWM, else linear between fine-mode sub-steps, else linear between
 * readings; NaN outside the buffer.
 */
export function valueAt(buf: ScopeSource, ch: number, t: number): number {
  const k = sliceOf(t);
  const p = pwmIn(buf, ch, k);
  if (p) return frac(t * p.freqHz) < p.duty ? p.hi : p.lo;
  const line = fineIn(buf, ch, k);
  if (line) return polyAt(line, t);
  const x = t / SLICE_S;
  const k0 = Math.floor(x);
  const a = buf.value(ch, k0);
  const b = buf.value(ch, k0 + 1);
  if (!Number.isFinite(a)) return b;
  if (!Number.isFinite(b)) return a;
  return a + (b - a) * (x - k0);
}

export type Edge = 'rising' | 'falling';

/** Times (s, ascending) in [t0, t1] where the trace crosses `level` in direction `edge` (or both). */
export function crossings(
  buf: ScopeSource,
  ch: number,
  t0: number,
  t1: number,
  level: number,
  edge?: Edge,
): number[] {
  const out: number[] = [];
  const first = Math.max(buf.start + 1, sliceOf(t0));
  const last = Math.min(buf.end - 1, sliceOf(t1));
  for (let k = first; k <= last; k++) {
    const ta = Math.max(t0, (k - 1) * SLICE_S);
    const tb = Math.min(t1, k * SLICE_S);
    const p = pwmIn(buf, ch, k);
    if (p) {
      if (!(p.lo < level && level < p.hi)) continue;
      const period = 1 / p.freqHz;
      for (let n = Math.floor(ta * p.freqHz) - 1; n * period <= tb; n++) {
        const rise = n * period;
        const fall = (n + p.duty) * period;
        if (edge !== 'falling' && rise > ta && rise <= tb) out.push(rise);
        if (edge !== 'rising' && fall > ta && fall <= tb) out.push(fall);
      }
      continue;
    }
    const line = fineIn(buf, ch, k);
    if (line) {
      for (let i = 1; i < line.t.length; i++) {
        const a = line.v[i - 1] ?? NaN;
        const b = line.v[i] ?? NaN;
        if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) continue;
        const up = a < level && b >= level;
        const down = a >= level && b < level;
        if ((edge === 'rising' && !up) || (edge === 'falling' && !down) || (!up && !down)) continue;
        const ta2 = line.t[i - 1] ?? 0;
        const t = ta2 + (((line.t[i] ?? 0) - ta2) * (level - a)) / (b - a);
        if (t > ta - 1e-12 && t <= tb && t >= t0 && t <= t1) out.push(t);
      }
      continue;
    }
    const a = buf.value(ch, k - 1);
    const b = buf.value(ch, k);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) continue;
    const up = a < level && b >= level;
    const down = a >= level && b < level;
    if ((edge === 'rising' && !up) || (edge === 'falling' && !down) || (!up && !down)) continue;
    const t = (k - 1 + (level - a) / (b - a)) * SLICE_S;
    if (t >= t0 && t <= t1) out.push(t);
  }
  return out.sort((x, y) => x - y);
}

export interface TriggerOptions {
  readonly edge: Edge;
  readonly level: number;
  /** Crossings closer than this to the last accepted trigger are ignored (s). */
  readonly holdoffS: number;
}

/** Accepted trigger times in [t0, t1]: `edge` crossings of `level`, each ≥ holdoff after the last. */
export function triggers(
  buf: ScopeSource,
  ch: number,
  opts: TriggerOptions,
  t0: number,
  t1: number,
): number[] {
  const out: number[] = [];
  for (const t of crossings(buf, ch, t0, t1, opts.level, opts.edge)) {
    const prev = out.at(-1);
    if (prev === undefined || t - prev >= opts.holdoffS) out.push(t);
  }
  return out;
}

/** First accepted trigger at or after `from` (s), or null. */
export function findTrigger(buf: ScopeSource, ch: number, opts: TriggerOptions, from: number): number | null {
  const e = extent(buf);
  if (!e) return null;
  return triggers(buf, ch, opts, Math.max(from, e.from), e.to)[0] ?? null;
}

export type TriggerMode = 'auto' | 'normal' | 'single';
/** What the trigger status line says: free-running, locked, waiting for a trigger, armed (single). */
export type SweepStatus = 'auto' | 'triggered' | 'waiting' | 'armed';

export interface Sweep {
  /** Left edge of the screen (s), or null while nothing can be shown. */
  readonly from: number | null;
  readonly status: SweepStatus;
  /** Single: the frozen sweep (no more updates until re-armed). */
  readonly frozen: boolean;
}

/** Share of the screen before the trigger point. */
export const PRE_TRIGGER = 0.1;

/**
 * Where the live screen starts (TD §18.3): the latest trigger with a full screen after it, 10 % of the
 * screen before it. Auto free-runs without one, normal holds the last sweep, single arms once (only
 * triggers after `armedAt` count) and freezes.
 */
export function sweep(
  buf: ScopeSource,
  ch: number | null,
  opts: TriggerOptions & { readonly mode: TriggerMode },
  span: number,
  prev: { readonly from: number | null; readonly frozen: boolean; readonly armedAt: number },
): Sweep {
  if (prev.frozen) return { from: prev.from, status: 'triggered', frozen: true };
  const e = extent(buf);
  if (!e) return { from: null, status: opts.mode === 'single' ? 'armed' : 'waiting', frozen: false };
  const free = Math.max(e.from, e.to - span);
  const pre = PRE_TRIGGER * span;
  const lo = Math.max(e.from + pre, opts.mode === 'single' ? prev.armedAt : -Infinity, e.to - 3 * span);
  const hi = e.to - (1 - PRE_TRIGGER) * span;
  const found = ch !== null && hi >= lo ? (triggers(buf, ch, opts, lo, hi).at(-1) ?? null) : null;
  if (found !== null) return { from: found - pre, status: 'triggered', frozen: opts.mode === 'single' };
  if (opts.mode === 'auto') return { from: free, status: 'auto', frozen: false };
  if (opts.mode === 'single') return { from: prev.from ?? free, status: 'armed', frozen: false };
  return { from: prev.from ?? free, status: 'waiting', frozen: false };
}

export interface WindowStats {
  readonly min: number;
  readonly max: number;
  readonly avg: number;
  /** √(mean(v²)); a rebuilt PWM slice counts both its levels by duty. */
  readonly rms: number;
  /** From the median period of mid-level rising crossings; null with fewer than 2. */
  readonly freqHz: number | null;
}

/** Cursor measurements of `ch` over [t0, t1] (s), or null when there is no reading in it. */
export function measure(buf: ScopeSource, ch: number, t0: number, t1: number): WindowStats | null {
  const a = Math.min(t0, t1);
  const b = Math.max(t0, t1);
  let n = 0;
  let sum = 0;
  let sq = 0;
  let min = Infinity;
  let max = -Infinity;
  const first = Math.max(buf.start, sliceOf(a));
  const last = Math.min(buf.end - 1, Math.floor(b / SLICE_S + 1e-9));
  for (let k = first; k <= last; k++) {
    const v = buf.value(ch, k);
    if (!Number.isFinite(v)) continue;
    const p = pwmIn(buf, ch, k);
    n++;
    sum += v;
    sq += p ? p.duty * p.hi * p.hi + (1 - p.duty) * p.lo * p.lo : v * v;
    min = Math.min(min, buf.value(ch, k, 1));
    max = Math.max(max, buf.value(ch, k, 2));
  }
  if (n === 0) return null;
  const ups = crossings(buf, ch, a, b, (min + max) / 2, 'rising');
  const periods = ups.slice(1).map((t, i) => t - (ups[i] ?? t));
  return {
    min,
    max,
    avg: sum / n,
    rms: Math.sqrt(sq / n),
    freqHz: periods.length ? 1 / median(periods) : null,
  };
}

function median(xs: readonly number[]): number {
  const s = [...xs].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? (s[m] ?? NaN) : ((s[m - 1] ?? NaN) + (s[m] ?? NaN)) / 2;
}

/** Per pixel column: the trace value, the band it spans, and whether a rebuilt edge falls inside. */
export interface Columns {
  readonly avg: Float32Array;
  readonly lo: Float32Array;
  readonly hi: Float32Array;
  readonly edge: Uint8Array;
}

/**
 * Min/max decimation of [t0, t1] into `n` columns (render budget: ≤ 4 ms at 2 000 px). A column wider
 * than a slice spans the readings' min…max and their mean; a narrower one reads the trace at its middle
 * (rebuilt PWM: a single level, or both with `edge` set where an edge falls inside).
 */
export function columns(buf: ScopeSource, ch: number, t0: number, t1: number, n: number): Columns {
  const avg = new Float32Array(n).fill(NaN);
  const lo = new Float32Array(n).fill(NaN);
  const hi = new Float32Array(n).fill(NaN);
  const edge = new Uint8Array(n);
  const dt = (t1 - t0) / n;
  for (let i = 0; i < n; i++) {
    const ta = t0 + i * dt;
    const tb = ta + dt;
    const p = pwmIn(buf, ch, sliceOf(ta + dt / 2));
    if (p && dt < 0.5 / p.freqHz) {
      const va = valueAt(buf, ch, ta);
      const vb = valueAt(buf, ch, tb);
      avg[i] = valueAt(buf, ch, ta + dt / 2);
      lo[i] = Math.min(va, vb);
      hi[i] = Math.max(va, vb);
      edge[i] = va !== vb ? 1 : 0;
      continue;
    }
    if (dt < SLICE_S) {
      const k = sliceOf(ta + dt / 2);
      const line = fineIn(buf, ch, k);
      if (line) {
        // Fine mode: the band spans the sub-steps inside the column, not the whole slice's envelope.
        const va = polyAt(line, ta);
        const vb = polyAt(line, tb);
        let l = Math.min(va, vb);
        let h = Math.max(va, vb);
        line.t.forEach((tk, j) => {
          if (tk <= ta || tk >= tb) return;
          const v = line.v[j] ?? NaN;
          l = Math.min(l, v);
          h = Math.max(h, v);
        });
        avg[i] = polyAt(line, ta + dt / 2);
        lo[i] = l;
        hi[i] = h;
        continue;
      }
      const v = valueAt(buf, ch, ta + dt / 2);
      avg[i] = v;
      lo[i] = Math.min(v, buf.value(ch, k, 1));
      hi[i] = Math.max(v, buf.value(ch, k, 2));
      continue;
    }
    let s = 0;
    let c = 0;
    let l = Infinity;
    let h = -Infinity;
    const last = Math.min(buf.end - 1, sliceOf(tb));
    for (let k = Math.max(buf.start, sliceOf(ta)); k <= last; k++) {
      const v = buf.value(ch, k);
      if (!Number.isFinite(v)) continue;
      s += v;
      c++;
      l = Math.min(l, buf.value(ch, k, 1));
      h = Math.max(h, buf.value(ch, k, 2));
    }
    if (c > 0) {
      avg[i] = s / c;
      lo[i] = l;
      hi[i] = h;
    }
  }
  return { avg, lo, hi, edge };
}

/** Value with 7 significant digits (Float32 precision), as a CSV number. */
const num = (v: number): Cell => (Number.isFinite(v) ? Number(v.toPrecision(7)) : null);

/**
 * CSV rows (US-SIM-10 AC3): `time_ms`, then avg / min / max of each channel in its unit, one row per
 * reading in [t0, t1] (s; the whole buffer by default).
 */
export function scopeRows(
  buf: ScopeSource,
  channels: readonly { readonly name: string; readonly unit: string }[],
  t0 = -Infinity,
  t1 = Infinity,
): Cell[][] {
  const header: Cell[] = ['time_ms'];
  for (const c of channels) for (const f of ['avg', 'min', 'max']) header.push(`${c.name}_${f}_${c.unit}`);
  const rows: Cell[][] = [header];
  const first = Math.max(buf.start, sliceOf(t0));
  const last = Math.min(buf.end - 1, Math.floor(t1 / SLICE_S + 1e-9));
  for (let k = first; k <= last; k++) {
    const row: Cell[] = [k];
    for (let c = 0; c < channels.length; c++)
      row.push(num(buf.value(c, k, 0)), num(buf.value(c, k, 1)), num(buf.value(c, k, 2)));
    rows.push(row);
  }
  return rows;
}

/** 1-2-5 steps from `min` to `max` (inclusive), for timebase and per-division scales. */
export function steps125(min: number, max: number): number[] {
  const out: number[] = [];
  for (let e = Math.floor(Math.log10(min)) - 1; e <= Math.ceil(Math.log10(max)); e++)
    for (const m of [1, 2, 5]) {
      const v = Number((m * 10 ** e).toPrecision(3));
      if (v >= min * 0.999 && v <= max * 1.001) out.push(v);
    }
  return out;
}
