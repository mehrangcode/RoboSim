/** The palette has 8 categorical hues: 7 parts and "Other" (never a generated 9th hue). */
export const MAX_SERIES = 8;

export interface ChartSeries {
  readonly key: string;
  readonly label: string;
  /** Average power per bucket (W). */
  readonly values: Float64Array;
  /** Palette slot 1..8, fixed to the part, not to its rank. */
  readonly slot: number;
}

/**
 * Picks the stacked series (TD §18.4): the 7 parts with the most energy, coloured in document order so
 * a part keeps its hue as others rise and fall, and the rest folded into "Other".
 */
export function chartSeries(
  order: readonly string[],
  series: ReadonlyMap<string, Float32Array>,
  bucketSeconds: number,
  otherLabel: string,
): ChartSeries[] {
  const total = (a: Float32Array) => a.reduce((n, v) => n + v, 0);
  const loads = order.filter((id) => total(series.get(id) ?? new Float32Array(0)) > 0);
  const n = Math.max(0, ...[...series.values()].map((a) => a.length));
  const ranked = [...loads].sort(
    (a, b) => total(series.get(b) as Float32Array) - total(series.get(a) as Float32Array),
  );
  const shown = new Set(ranked.slice(0, loads.length > MAX_SERIES ? MAX_SERIES - 1 : MAX_SERIES));
  const toWatts = (a: Float32Array): Float64Array => {
    const out = new Float64Array(n);
    for (let b = 0; b < n; b++) out[b] = Math.max(0, a[b] ?? 0) / bucketSeconds;
    return out;
  };
  const out: ChartSeries[] = loads
    .filter((id) => shown.has(id))
    .map((id, i) => ({ key: id, label: id, values: toWatts(series.get(id) as Float32Array), slot: i + 1 }));
  const rest = loads.filter((id) => !shown.has(id));
  if (rest.length) {
    const sum = new Float32Array(n);
    for (const id of rest) (series.get(id) as Float32Array).forEach((v, b) => (sum[b] = (sum[b] ?? 0) + v));
    out.push({ key: '\u0000other', label: otherLabel, values: toWatts(sum), slot: MAX_SERIES });
  }
  return out;
}
