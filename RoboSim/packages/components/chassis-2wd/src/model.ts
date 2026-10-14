import type {
  BodySnapshot,
  ComponentIO,
  ComponentModel,
  Fault,
  MnaStamper,
  ModelContext,
  Vec2,
} from '@robosim/sim-core';

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

export interface Chassis2wdState {
  readonly geometry: ChassisGeometry;
  /** Robot pose from the world, or null on the bench. */
  readonly pose: BodySnapshot | null;
}

/**
 * Two-wheel differential chassis with rear caster. Purely mechanical: no circuit stamp. The world
 * model (slice 4) creates the rigid body from {@link chassisGeometry} and drives the wheels from the
 * TT motors mounted in the motor slots.
 */
export class Chassis2wd implements ComponentModel<Chassis2wdProps, Chassis2wdState> {
  readonly type = 'mechanical.chassis-2wd';
  private geometry: ChassisGeometry | null = null;
  private pose: BodySnapshot | null = null;

  init(_ctx: ModelContext, props: Chassis2wdProps): void {
    this.geometry = chassisGeometry(props);
  }

  stamp(_s: MnaStamper): void {}

  step(_dt: number, io: ComponentIO): void {
    this.pose = io.world?.bodies()[0] ?? null;
  }

  faults(): readonly Fault[] {
    return [];
  }

  snapshot(): Chassis2wdState {
    if (!this.geometry) throw new Error('mechanical.chassis-2wd: snapshot before init');
    return { geometry: this.geometry, pose: this.pose };
  }
}
