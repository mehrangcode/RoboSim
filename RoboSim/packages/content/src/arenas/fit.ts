import type { ArenaSpec, ObstacleSpec, Pose2, Vec2 } from '@robosim/sim-core';
import * as dmath from '@robosim/sim-core/dmath';

/*
 * Start-pose checks (FR-ARN-06): the robot's footprint must lie on the mat and clear of every
 * obstacle. Shared by the editor (drag feedback) and the loader (rejects a bad saved pose), so it
 * uses deterministic trig: both always agree.
 */

export type PoseProblem = { readonly kind: 'outside' } | { readonly kind: 'obstacle'; readonly id: string };

/** A robot-frame outline moved to `pose` (world metres). */
export function placeOutline(outline: readonly Vec2[], pose: Pose2): Vec2[] {
  const c = dmath.cos(pose.angle);
  const s = dmath.sin(pose.angle);
  return outline.map((p) => ({ x: pose.x + c * p.x - s * p.y, y: pose.y + s * p.x + c * p.y }));
}

/** Corners of a box obstacle in the world. */
export function obstacleOutline(o: ObstacleSpec): Vec2[] | null {
  if (o.shape.kind !== 'box') return null;
  const hw = o.shape.widthM / 2;
  const hh = o.shape.heightM / 2;
  return placeOutline(
    [
      { x: -hw, y: -hh },
      { x: hw, y: -hh },
      { x: hw, y: hh },
      { x: -hw, y: hh },
    ],
    o.pose,
  );
}

/** First reason the footprint cannot start at `pose`, or null when it fits. */
export function startPoseProblem(
  arena: ArenaSpec,
  footprint: readonly Vec2[],
  pose: Pose2,
): PoseProblem | null {
  const body = placeOutline(footprint, pose);
  if (body.some((p) => p.x < 0 || p.y < 0 || p.x > arena.widthM || p.y > arena.heightM)) {
    return { kind: 'outside' };
  }
  for (const o of arena.obstacles ?? []) {
    const hit =
      o.shape.kind === 'circle'
        ? circleHitsPolygon(o.pose, o.shape.radiusM, body)
        : polygonsOverlap(body, obstacleOutline(o) ?? []);
    if (hit) return { kind: 'obstacle', id: o.id };
  }
  return null;
}

/** Separating-axis test for two convex polygons (touching counts as clear). */
export function polygonsOverlap(a: readonly Vec2[], b: readonly Vec2[]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i] as Vec2;
      const q = poly[(i + 1) % poly.length] as Vec2;
      const nx = q.y - p.y;
      const ny = p.x - q.x;
      const [minA, maxA] = project(a, nx, ny);
      const [minB, maxB] = project(b, nx, ny);
      if (maxA <= minB || maxB <= minA) return false;
    }
  }
  return true;
}

function project(poly: readonly Vec2[], nx: number, ny: number): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const p of poly) {
    const d = p.x * nx + p.y * ny;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return [min, max];
}

/** Whether a circle overlaps a convex polygon (centre inside, or an edge closer than the radius). */
export function circleHitsPolygon(center: Vec2, radius: number, poly: readonly Vec2[]): boolean {
  if (pointInConvex(center, poly)) return true;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i] as Vec2;
    const b = poly[(i + 1) % poly.length] as Vec2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t =
      len2 === 0 ? 0 : Math.max(0, Math.min(1, ((center.x - a.x) * dx + (center.y - a.y) * dy) / len2));
    const ex = a.x + t * dx - center.x;
    const ey = a.y + t * dy - center.y;
    if (ex * ex + ey * ey < radius * radius) return true;
  }
  return false;
}

function pointInConvex(p: Vec2, poly: readonly Vec2[]): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i] as Vec2;
    const b = poly[(i + 1) % poly.length] as Vec2;
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (cross === 0) continue;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
}
