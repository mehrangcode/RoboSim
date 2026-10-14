import type { Vec2 } from '../contracts.js';
import type { FloorSpec, FloorStroke } from './types.js';

/** Luminance raster, row-major from the arena's bottom-left corner; 0 = black … 255 = white. */
export interface FloorRaster {
  readonly widthPx: number;
  readonly heightPx: number;
  readonly mmPerPx: number;
  readonly data: Uint8Array;
  readonly background: number;
}

const toByte = (v: number): number => Math.round(Math.min(1, Math.max(0, v)) * 255);

/** Rasterises vector floor paint at `mmPerPx` (1 mm by default). Pure integer/IEEE arithmetic: deterministic. */
export function rasterizeFloor(spec: FloorSpec, widthM: number, heightM: number, mmPerPx = 1): FloorRaster {
  const widthPx = Math.ceil((widthM * 1000) / mmPerPx);
  const heightPx = Math.ceil((heightM * 1000) / mmPerPx);
  const data = new Uint8Array(widthPx * heightPx).fill(toByte(spec.background));
  const px = (m: number): number => (m * 1000) / mmPerPx;
  for (const stroke of spec.strokes) paint(stroke);
  return { widthPx, heightPx, mmPerPx, data, background: spec.background };

  function set(ix: number, iy: number, v: number): void {
    if (ix >= 0 && iy >= 0 && ix < widthPx && iy < heightPx) data[iy * widthPx + ix] = v;
  }

  function paint(s: FloorStroke): void {
    const v = toByte(s.value);
    if (s.kind === 'rect') {
      for (let iy = Math.floor(px(s.min.y)); iy < Math.ceil(px(s.max.y)); iy++) {
        for (let ix = Math.floor(px(s.min.x)); ix < Math.ceil(px(s.max.x)); ix++) set(ix, iy, v);
      }
    } else if (s.kind === 'circle') {
      const cx = px(s.center.x);
      const cy = px(s.center.y);
      const r = px(s.radiusM);
      for (let iy = Math.floor(cy - r); iy <= Math.ceil(cy + r); iy++) {
        for (let ix = Math.floor(cx - r); ix <= Math.ceil(cx + r); ix++) {
          const dx = ix + 0.5 - cx;
          const dy = iy + 0.5 - cy;
          if (dx * dx + dy * dy <= r * r) set(ix, iy, v);
        }
      }
    } else {
      const pts = s.closed && s.points.length > 2 ? [...s.points, s.points[0] as Vec2] : s.points;
      const half = s.widthMm / 2 / mmPerPx;
      for (let i = 1; i < pts.length; i++) segment(pts[i - 1] as Vec2, pts[i] as Vec2, half, v);
    }
  }

  function segment(a: Vec2, b: Vec2, half: number, v: number): void {
    const ax = px(a.x);
    const ay = px(a.y);
    const bx = px(b.x);
    const by = px(b.y);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    for (let iy = Math.floor(Math.min(ay, by) - half); iy <= Math.ceil(Math.max(ay, by) + half); iy++) {
      for (let ix = Math.floor(Math.min(ax, bx) - half); ix <= Math.ceil(Math.max(ax, bx) + half); ix++) {
        const qx = ix + 0.5 - ax;
        const qy = iy + 0.5 - ay;
        const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, (qx * dx + qy * dy) / len2));
        const ex = qx - t * dx;
        const ey = qy - t * dy;
        if (ex * ex + ey * ey <= half * half) set(ix, iy, v);
      }
    }
  }
}

/** Luminance 0..1 at a world point (m); outside the raster reads as the background. */
export function floorAt(raster: FloorRaster, p: Vec2): number {
  const ix = Math.floor((p.x * 1000) / raster.mmPerPx);
  const iy = Math.floor((p.y * 1000) / raster.mmPerPx);
  if (ix < 0 || iy < 0 || ix >= raster.widthPx || iy >= raster.heightPx) return raster.background;
  return (raster.data[iy * raster.widthPx + ix] ?? 0) / 255;
}
