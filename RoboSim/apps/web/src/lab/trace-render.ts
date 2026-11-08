/** Canvas drawing shared by the oscilloscope and the post-mortem plot (TD §18.8). */
/** Line style per series, so series differ by more than colour (WCAG 1.4.1). */
export const TRACE_DASHES: readonly (readonly number[])[] = [[], [6, 3], [2, 3], [8, 3, 2, 3]];
const FALLBACK_COLORS = ['#2563eb', '#dc2626', '#059669', '#9333ea'];

/** Per-pixel columns of one trace: average line, min/max band, and pixels drawn as a vertical step. */
export interface TraceColumns {
  readonly avg: ArrayLike<number>;
  readonly lo: ArrayLike<number>;
  readonly hi: ArrayLike<number>;
  readonly edge?: ArrayLike<number>;
}

/** Sizes the canvas for the device pixel ratio and clears it; null without a 2D context. */
export function prepareCanvas(
  el: HTMLCanvasElement,
  width: number,
  height: number,
): { ctx: CanvasRenderingContext2D; color: (name: string, fallback: string) => string } | null {
  const ctx = el.getContext('2d');
  if (!ctx) return null;
  const dpr = window.devicePixelRatio || 1;
  el.width = Math.round(width * dpr);
  el.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const css = getComputedStyle(el);
  ctx.clearRect(0, 0, width, height);
  return { ctx, color: (name, fallback) => css.getPropertyValue(name).trim() || fallback };
}

export const seriesColor = (color: (name: string, fallback: string) => string, i: number): string =>
  color(`--color-series-${i + 1}`, FALLBACK_COLORS[i] ?? '#000');

export function drawGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  divsX: number,
  divsY: number,
  stroke: string,
): void {
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1;
  for (let i = 0; i <= divsX; i++) {
    const gx = Math.round((i * width) / divsX) + 0.5;
    ctx.beginPath();
    ctx.moveTo(gx, 0);
    ctx.lineTo(gx, height);
    ctx.stroke();
  }
  for (let j = 0; j <= divsY; j++) {
    const gy = Math.round((j * height) / divsY) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(width, gy);
    ctx.stroke();
  }
}

/**
 * One trace (the oscilloscope's renderer): a translucent min/max band, then the average as a line in
 * the series' colour and dash. `step(k)` gives the levels before and after a pixel marked as an edge.
 */
export function drawTrace(
  ctx: CanvasRenderingContext2D,
  col: TraceColumns,
  n: number,
  y: (v: number) => number,
  stroke: string,
  dash: readonly number[],
  step?: (k: number) => readonly [number, number],
): void {
  ctx.fillStyle = stroke;
  ctx.globalAlpha = 0.2;
  for (let k = 0; k < n; k++) {
    const lo = col.lo[k] ?? NaN;
    const hi = col.hi[k] ?? NaN;
    if (Number.isFinite(lo) && Number.isFinite(hi) && hi > lo && !col.edge?.[k])
      ctx.fillRect(k, y(hi), 1, y(lo) - y(hi));
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.setLineDash([...dash]);
  ctx.beginPath();
  let pen = false;
  for (let k = 0; k < n; k++) {
    const v = col.avg[k] ?? NaN;
    if (!Number.isFinite(v)) {
      pen = false;
      continue;
    }
    if (col.edge?.[k] && step) {
      const [before, after] = step(k);
      if (pen) ctx.lineTo(k + 0.5, y(before));
      else ctx.moveTo(k + 0.5, y(before));
      ctx.lineTo(k + 0.5, y(after));
    } else if (pen) ctx.lineTo(k + 0.5, y(v));
    else ctx.moveTo(k + 0.5, y(v));
    pen = true;
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

/** A vertical marker line at pixel `x` with a short label. */
export function drawMarker(
  ctx: CanvasRenderingContext2D,
  x: number,
  width: number,
  height: number,
  stroke: string,
  dash: readonly number[],
  label: string,
): void {
  const cx = Math.round(x) + 0.5;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1;
  ctx.setLineDash([...dash]);
  ctx.beginPath();
  ctx.moveTo(cx, 0);
  ctx.lineTo(cx, height);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = stroke;
  ctx.font = '11px system-ui, sans-serif';
  const w = ctx.measureText(label).width;
  // Right of the line, or left of it when the label would leave the plot.
  ctx.fillText(label, cx + w + 6 > width ? Math.max(2, cx - w - 3) : cx + 3, 12);
}
