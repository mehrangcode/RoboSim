import type { Vec2 } from '@robosim/sim-core';

/* Engine-free entry (`@robosim/component-chassis-2wd/geometry`): the editor draws and places the robot from it. */

export interface Chassis2wdProps {
  readonly trackWidthMm: number;
  readonly wheelDiameterMm: number;
  readonly lengthMm: number;
  readonly widthMm: number;
  /** Body (plate) centre relative to the drive-axle midpoint, +x forward. */
  readonly bodyCenterXMm: number;
  readonly casterXMm: number;
  readonly bodyMassG: number;
}

export interface MountSlot {
  readonly id: string;
  /** Robot frame: origin at the drive-axle midpoint, +x forward, +y left (mm). */
  readonly xMm: number;
  readonly yMm: number;
  readonly heightMm: number;
}

export interface ChassisGeometry {
  /** Drive wheels in the robot frame (m); wheel axis along ±y. */
  readonly wheels: readonly {
    readonly side: 'left' | 'right';
    readonly position: Vec2;
    readonly radiusM: number;
  }[];
  readonly caster: Vec2;
  /** Plate outline (m), counter-clockwise. */
  readonly footprint: readonly Vec2[];
  readonly bodyMassKg: number;
  /** Plate moment of inertia about the robot origin (kg·m²), parallel-axis corrected. */
  readonly bodyInertiaKgM2: number;
  readonly mountSlots: readonly MountSlot[];
}

/** Geometry and mass properties the physics world builds the robot body from (Technical Design §5.5). */
export function chassisGeometry(p: Chassis2wdProps): ChassisGeometry {
  const mm = (v: number): number => v / 1000;
  const half = mm(p.trackWidthMm) / 2;
  const cx = mm(p.bodyCenterXMm);
  const l = mm(p.lengthMm);
  const w = mm(p.widthMm);
  const m = p.bodyMassG / 1000;
  return {
    wheels: [
      { side: 'left', position: { x: 0, y: half }, radiusM: mm(p.wheelDiameterMm) / 2 },
      { side: 'right', position: { x: 0, y: -half }, radiusM: mm(p.wheelDiameterMm) / 2 },
    ],
    caster: { x: mm(p.casterXMm), y: 0 },
    footprint: [
      { x: cx - l / 2, y: -w / 2 },
      { x: cx + l / 2, y: -w / 2 },
      { x: cx + l / 2, y: w / 2 },
      { x: cx - l / 2, y: w / 2 },
    ],
    bodyMassKg: m,
    bodyInertiaKgM2: (m * (l * l + w * w)) / 12 + m * cx * cx,
    mountSlots: [
      { id: 'motor-left', xMm: 0, yMm: p.trackWidthMm / 2 - 20, heightMm: 20 },
      { id: 'motor-right', xMm: 0, yMm: -(p.trackWidthMm / 2 - 20), heightMm: 20 },
      { id: 'front-bracket', xMm: p.bodyCenterXMm + p.lengthMm / 2 - 10, yMm: 0, heightMm: 5 },
      { id: 'front-top', xMm: p.bodyCenterXMm + p.lengthMm / 2 - 15, yMm: 0, heightMm: 60 },
      { id: 'deck', xMm: p.bodyCenterXMm, yMm: 0, heightMm: 45 },
    ],
  };
}
