import type { Vec2 } from '@robosim/sim-core';
import * as dmath from '@robosim/sim-core/dmath';

/*
 * Track centre-lines. Deterministic trig (dmath) so the rasterised floor is identical in every
 * engine; engine-free so the editor can draw arenas without loading the simulator.
 */

/** Stadium (oval) centre-line, counter-clockwise from the middle of the bottom straight. */
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

/**
 * Lemniscate of Bernoulli (figure eight) with half-width `a`; the lobes cross at 90° in the centre.
 * Starts at the right tip and runs the right lobe counter-clockwise, the left lobe clockwise.
 */
export function lemniscatePath(center: Vec2, a: number, segments = 256): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i < segments; i++) {
    const t = (2 * Math.PI * i) / segments;
    const s = dmath.sin(t);
    const c = dmath.cos(t);
    const d = 1 + s * s;
    pts.push({ x: center.x + (a * c) / d, y: center.y + (a * s * c) / d });
  }
  return pts;
}

/** Axis-aligned rectangle centre-line with sharp 90° corners, counter-clockwise from the bottom middle. */
export function rectanglePath(center: Vec2, widthM: number, heightM: number): Vec2[] {
  const hw = widthM / 2;
  const hh = heightM / 2;
  return [
    { x: center.x, y: center.y - hh },
    { x: center.x + hw, y: center.y - hh },
    { x: center.x + hw, y: center.y + hh },
    { x: center.x - hw, y: center.y + hh },
    { x: center.x - hw, y: center.y - hh },
  ];
}
