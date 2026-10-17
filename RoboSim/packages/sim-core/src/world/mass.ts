import type { Vec2 } from '../contracts.js';
import type { PointMass, RobotGeometry } from './types.js';

export type { PointMass } from './types.js';

/*
 * Robot mass distribution (FR-ARN-09): the chassis plate plus every mounted part as a point mass at
 * its mount. Engine-free (`@robosim/sim-core/mass`): the mounting editor shows the same centre of
 * mass the physics world uses. Only + − × ÷, so results are bit-identical across engines.
 */

/** Own inertia of a uniform box seen from above (dimensions in mm). */
export function boxInertia(massKg: number, lengthMm: number, widthMm: number): number {
  const l = lengthMm / 1000;
  const w = widthMm / 1000;
  return (massKg * (l * l + w * w)) / 12;
}

export interface RobotMass {
  readonly massKg: number;
  /** Centre of mass in the robot frame (m). */
  readonly center: Vec2;
  /** Moment of inertia about the robot origin (drive-axle midpoint), kg·m². */
  readonly inertiaKgM2: number;
  /** Share of the weight on the drive wheels (the rest is on the caster), by the lever rule. */
  readonly axleShare: number;
}

/** Plate centroid: the footprint's vertex mean (the plate is a rectangle). */
export function plateCentroid(g: Pick<RobotGeometry, 'footprint'>): Vec2 {
  const n = g.footprint.length;
  return g.footprint.reduce((a, p) => ({ x: a.x + p.x / n, y: a.y + p.y / n }), { x: 0, y: 0 });
}

export function robotMass(
  g: Pick<RobotGeometry, 'footprint' | 'caster' | 'bodyMassKg' | 'bodyInertiaKgM2'>,
  payload: readonly PointMass[],
): RobotMass {
  const plate = plateCentroid(g);
  let massKg = g.bodyMassKg;
  let mx = g.bodyMassKg * plate.x;
  let my = g.bodyMassKg * plate.y;
  let inertiaKgM2 = g.bodyInertiaKgM2;
  for (const p of payload) {
    massKg += p.massKg;
    mx += p.massKg * p.x;
    my += p.massKg * p.y;
    inertiaKgM2 += (p.inertiaKgM2 ?? 0) + p.massKg * (p.x * p.x + p.y * p.y);
  }
  const center = { x: mx / massKg, y: my / massKg };
  const xc = g.caster.x;
  const axleShare = xc === 0 ? 1 : Math.min(Math.max((center.x - xc) / (0 - xc), 0), 1);
  return { massKg, center, inertiaKgM2, axleShare };
}
