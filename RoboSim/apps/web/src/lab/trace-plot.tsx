import { useEffect, useRef } from 'react';
import {
  TRACE_DASHES,
  drawGrid,
  drawMarker,
  drawTrace,
  prepareCanvas,
  seriesColor,
  type TraceColumns,
} from './trace-render.js';
import { useWidth } from './use-width.js';

export interface PlotMarker {
  /** Fraction of the width (0 … 1). */
  readonly at: number;
  readonly label: string;
  readonly dash?: readonly number[];
}

/**
 * A static trace chart (no interaction): columns already reduced to the plot width, a fixed value range,
 * vertical markers. The canvas is an image with `label` as its accessible name; the caller gives the
 * numbers as text too.
 */
export function TracePlot({
  columns,
  range,
  markers = [],
  height = 160,
  divsX = 10,
  divsY = 4,
  label,
}: {
  /** Columns for a given width; called again when the width changes. */
  columns: (n: number) => readonly TraceColumns[];
  range: readonly [number, number];
  markers?: readonly PlotMarker[];
  height?: number;
  divsX?: number;
  divsY?: number;
  label: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const width = useWidth(box);
  useEffect(() => {
    const el = canvas.current;
    const prepared = el ? prepareCanvas(el, width, height) : null;
    if (!prepared) return;
    const { ctx, color } = prepared;
    drawGrid(ctx, width, height, divsX, divsY, color('--color-line', '#ccc'));
    const n = Math.max(1, Math.floor(width));
    const [lo, hi] = range;
    const span = hi - lo || 1;
    const y = (v: number) => height - ((v - lo) / span) * height;
    columns(n).forEach((col, i) => drawTrace(ctx, col, n, y, seriesColor(color, i), TRACE_DASHES[i] ?? []));
    const ink = color('--color-ink', '#111');
    for (const m of markers) drawMarker(ctx, m.at * width, width, height, ink, m.dash ?? [], m.label);
  }, [columns, range, markers, width, height, divsX, divsY]);
  return (
    <div ref={box} dir="ltr" className="rounded-md border border-line">
      <canvas ref={canvas} role="img" aria-label={label} style={{ width, height }} className="block" />
    </div>
  );
}
