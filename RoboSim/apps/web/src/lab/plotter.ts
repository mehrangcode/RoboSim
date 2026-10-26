import type { SerialLine } from '@robosim/sim-runtime/client';

/** Series beyond this many are not plotted (Arduino IDE 2 draws at most 8 too). */
export const MAX_SERIES = 8;
export const PLOT_WINDOWS = [50, 100, 250, 500, 1000] as const;

/** A value on a line: `label:value`, or a bare number (named by its column among bare numbers). */
export interface PlotValue {
  /** `label` for named values, `#n` (1-based) for the n-th bare number. */
  readonly key: string;
  readonly value: number;
}

const TOKEN = /([^\s,:]+)\s*:\s*([^\s,]+)|([^\s,]+)/g;

/**
 * One serial line as plotter values, following the Arduino IDE 2 plotter: fields separated by
 * commas, tabs or spaces; `label:value` names a series, bare numbers are series by position.
 * Words that are not numbers are skipped, so a line of plain text yields nothing.
 */
export function parsePlotLine(text: string): PlotValue[] {
  const out: PlotValue[] = [];
  const seen = new Set<string>();
  let bare = 0;
  for (const m of text.matchAll(TOKEN)) {
    const [, label, labelled, plain] = m;
    const key = label !== undefined ? label : `#${bare + 1}`;
    const value = toNumber(label !== undefined ? labelled : plain);
    if (value === null) continue;
    if (label === undefined) bare++;
    if (seen.has(key)) continue; // a repeated label on one line: the first wins
    seen.add(key);
    out.push({ key, value });
  }
  return out;
}

function toNumber(s: string | undefined): number | null {
  if (!s || !/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export interface PlotSample {
  /** Slice (ms) the line was sent in. */
  readonly slice: number;
  readonly values: ReadonlyMap<string, number>;
}

export interface PlotData {
  /** The newest samples (lines that carried at least one value), oldest first. */
  readonly samples: readonly PlotSample[];
  /** Series keys in order of first appearance in the whole log. */
  readonly keys: readonly string[];
  /** Keys past {@link MAX_SERIES}: present in the data but not plotted. */
  readonly dropped: readonly string[];
}

/**
 * The plotter's view of the decoded serial log: the last `window` samples. An unterminated last
 * line is left out, since its number may still be arriving.
 */
export function buildPlot(lines: readonly SerialLine[], partial: boolean, window: number): PlotData {
  const complete = partial ? lines.slice(0, -1) : lines;
  const all: PlotSample[] = [];
  const keys: string[] = [];
  const known = new Set<string>();
  for (const line of complete) {
    const values = parsePlotLine(line.text);
    if (!values.length) continue;
    for (const v of values)
      if (!known.has(v.key)) {
        known.add(v.key);
        keys.push(v.key);
      }
    all.push({ slice: line.slice, values: new Map(values.map((v) => [v.key, v.value])) });
  }
  return {
    samples: all.slice(-window),
    keys: keys.slice(0, MAX_SERIES),
    dropped: keys.slice(MAX_SERIES),
  };
}

/** Y range over the visible series with 5 % headroom; a flat signal gets ±1 around its value. */
export function plotRange(
  samples: readonly PlotSample[],
  keys: readonly string[],
): { readonly min: number; readonly max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (const s of samples)
    for (const k of keys) {
      const v = s.values.get(k);
      if (v === undefined) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  if (min > max) return null;
  if (min === max) return { min: min - 1, max: max + 1 };
  const pad = (max - min) * 0.05;
  return { min: min - pad, max: max + pad };
}

/** About `count` round tick values across [min, max] (1, 2, 5 × 10ⁿ steps). */
export function niceTicks(min: number, max: number, count = 5): number[] {
  const span = max - min;
  if (!(span > 0)) return [min];
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step =
    [1, 2, 5, 10].reduce((best, m) => (Math.abs(m * mag - raw) < Math.abs(best * mag - raw) ? m : best)) *
    mag;
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step)
    ticks.push(Math.abs(v) < step * 1e-9 ? 0 : Number(v.toPrecision(12)));
  return ticks;
}
