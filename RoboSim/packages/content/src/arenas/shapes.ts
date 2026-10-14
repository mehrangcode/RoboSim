import { dmath, type Vec2 } from '@robosim/sim-core';

/**
 * Stadium (oval) centre-line, counter-clockwise from the middle of the bottom straight.
 * Uses deterministic trig so the rasterised floor is identical in every engine.
 */
export function stadiumPath(center: Vec2, straightM: number, radiusM: number, segmentsPerArc = 64): Vec2[] {
  const half = straightM / 2;
  const pts: Vec2[] = [];
  const arc = (cx: number, from: number): void => {
    for (let i = 0; i <= segmentsPerArc; i++) {
      const a = from + (Math.PI * i) / segmentsPerArc;
      pts.push({ x: cx + radiusM * dmath.cos(a), y: center.y + radiusM * dmath.sin(a) });
    }
  };
  pts.push({ x: center.x, y: center.y - radiusM });
  arc(center.x + half, -Math.PI / 2); // right bend, bottom → top
  arc(center.x - half, Math.PI / 2); // left bend, top → bottom
  return pts;
}
