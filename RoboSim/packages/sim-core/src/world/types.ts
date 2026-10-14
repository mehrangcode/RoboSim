import type { Vec2 } from '../contracts.js';

/** Planar pose in the arena (m, rad). Arena origin is the bottom-left corner; +y up. */
export interface Pose2 {
  readonly x: number;
  readonly y: number;
  readonly angle: number;
}

/** Floor paint (Technical Design §5.5: rasterised at 1 px = 1 mm). Luminance 0 = black … 1 = white. */
export type FloorStroke =
  | {
      readonly kind: 'polyline';
      readonly points: readonly Vec2[];
      readonly closed?: boolean;
      readonly widthMm: number;
      readonly value: number;
    }
  | { readonly kind: 'rect'; readonly min: Vec2; readonly max: Vec2; readonly value: number }
  | { readonly kind: 'circle'; readonly center: Vec2; readonly radiusM: number; readonly value: number };

export interface FloorSpec {
  readonly background: number;
  readonly strokes: readonly FloorStroke[];
}

export interface ObstacleSpec {
  readonly id: string;
  readonly shape:
    | { readonly kind: 'box'; readonly widthM: number; readonly heightM: number }
    | { readonly kind: 'circle'; readonly radiusM: number };
  readonly pose: Pose2;
  /** Static obstacles never move; dynamic ones can be pushed (floor friction applies). */
  readonly dynamic?: boolean;
  readonly massKg?: number;
}

export interface ArenaSpec {
  readonly id: string;
  readonly widthM: number;
  readonly heightM: number;
  readonly floor: FloorSpec;
  /** Solid walls along the arena boundary (default true). */
  readonly perimeterWalls?: boolean;
  readonly obstacles?: readonly ObstacleSpec[];
  /** Default robot start pose. */
  readonly start: Pose2;
  /** Named circular regions for success conditions (checkpoints, goals, start box). */
  readonly zones?: readonly ArenaZone[];
}

export interface ArenaZone {
  readonly id: string;
  readonly kind: 'start' | 'checkpoint' | 'goal';
  readonly center: Vec2;
  readonly radiusM: number;
}

/** Robot body geometry in the robot frame (origin = drive-axle midpoint, +x forward, metres). */
export interface RobotGeometry {
  readonly wheels: readonly {
    readonly side: 'left' | 'right';
    readonly position: Vec2;
    readonly radiusM: number;
  }[];
  readonly caster: Vec2;
  readonly footprint: readonly Vec2[];
  readonly bodyMassKg: number;
  /** Inertia about the robot origin (kg·m²). */
  readonly bodyInertiaKgM2: number;
}

export interface MountSpec {
  readonly xMm: number;
  readonly yMm: number;
  readonly angle?: number;
  readonly heightMm: number;
}

export interface RobotSpec {
  readonly id: string;
  readonly geometry: RobotGeometry;
  /** Mass of everything mounted on the chassis (kg), lumped at the plate centre. */
  readonly payloadKg: number;
  /** Component id → mount in the robot frame. */
  readonly mounts: Readonly<Record<string, MountSpec>>;
  /** Component ids of the motors driving each wheel. */
  readonly drives: { readonly left: string; readonly right: string };
  readonly start: Pose2;
}

/** Tunable contact parameters (Technical Design §5.5). */
export interface PhysicsParams {
  readonly gravity: number;
  /** Rubber tyre on arena vinyl: traction and lateral grip. */
  readonly wheelFriction: number;
  readonly wheelRollingResistance: number;
  /** Swivel caster: effective friction opposing motion in any direction. */
  readonly casterFriction: number;
  /** Floor friction for pushable obstacles. */
  readonly obstacleFloorFriction: number;
}

export const DEFAULT_PHYSICS: PhysicsParams = {
  gravity: 9.81,
  wheelFriction: 0.9,
  wheelRollingResistance: 0.015,
  casterFriction: 0.03,
  obstacleFloorFriction: 0.4,
};
