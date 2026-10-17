import type { Chassis2wdProps, MountSlot } from './geometry.js';

/*
 * Mounting rules (FR-ARN-09), engine-free and shared by the loader (refuses a part off the chassis)
 * and the mounting editor (refuses the drag, warns about overlaps, snaps to slots). Robot frame:
 * origin at the drive-axle midpoint, +x forward, +y left, z = height above the floor (mm).
 */

/** Sensors may sit on a bracket ahead of the plate, up to this far (mm). */
export const FRONT_OVERHANG_MM = 60;
export const MAX_MOUNT_HEIGHT_MM = 150;
/** A drag that ends this close to a slot (mm) snaps onto it. */
export const SLOT_SNAP_MM = 8;

export interface MountPose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Degrees, counter-clockwise; 0 = facing forward. */
  readonly yaw: number;
}

/** A part as a box on the robot: its pose plus its manifest's mounting footprint. */
export interface MountedBox {
  readonly id: string;
  readonly pose: MountPose;
  readonly lengthMm: number;
  readonly widthMm: number;
  readonly heightMm: number;
  /** Sensors may overhang the front of the plate. */
  readonly overhang: boolean;
}

export type MountProblem = 'offChassis' | 'height';

export interface MountRegion {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

/** Where a part's mount point may be: on the plate, or ahead of it for sensors. */
export function mountRegion(p: Chassis2wdProps, overhang: boolean): MountRegion {
  const front = p.bodyCenterXMm + p.lengthMm / 2;
  return {
    minX: p.bodyCenterXMm - p.lengthMm / 2,
    maxX: front + (overhang ? FRONT_OVERHANG_MM : 0),
    minY: -p.widthMm / 2,
    maxY: p.widthMm / 2,
  };
}

/** Why a pose is not allowed, or null. Only comparisons: the loader's verdict is engine-independent. */
export function mountProblem(
  p: Chassis2wdProps,
  pose: Pick<MountPose, 'x' | 'y' | 'z'>,
  overhang: boolean,
): MountProblem | null {
  if (!(pose.z >= 0 && pose.z <= MAX_MOUNT_HEIGHT_MM)) return 'height';
  const r = mountRegion(p, overhang);
  if (!(pose.x >= r.minX && pose.x <= r.maxX && pose.y >= r.minY && pose.y <= r.maxY)) return 'offChassis';
  return null;
}

type Pt = readonly [number, number];

/** The box outline seen from above (mm, robot frame). */
export function boxCorners(b: MountedBox): readonly Pt[] {
  const a = (b.pose.yaw * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const hl = b.lengthMm / 2;
  const hw = b.widthMm / 2;
  return (
    [
      [-hl, -hw],
      [hl, -hw],
      [hl, hw],
      [-hl, hw],
    ] as const
  ).map(([dx, dy]) => [b.pose.x + c * dx - s * dy, b.pose.y + s * dx + c * dy] as const);
}

/** Separating-axis test of two convex outlines (touching edges do not count). */
function outlinesOverlap(a: readonly Pt[], b: readonly Pt[]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i] as Pt;
      const q = poly[(i + 1) % poly.length] as Pt;
      const axis: Pt = [q[1] - p[1], p[0] - q[0]];
      const project = (pts: readonly Pt[]) => pts.map((v) => v[0] * axis[0] + v[1] * axis[1]);
      const pa = project(a);
      const pb = project(b);
      const eps = 1e-6 * Math.hypot(axis[0], axis[1]);
      if (Math.max(...pa) <= Math.min(...pb) + eps || Math.max(...pb) <= Math.min(...pa) + eps) return false;
    }
  }
  return true;
}

/** Pairs of parts that occupy the same space (outline and height range both overlap). */
export function mountOverlaps(boxes: readonly MountedBox[]): readonly (readonly [string, string])[] {
  const out: (readonly [string, string])[] = [];
  const corners = boxes.map(boxCorners);
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i] as MountedBox;
      const b = boxes[j] as MountedBox;
      const vertical = a.pose.z < b.pose.z + b.heightMm && b.pose.z < a.pose.z + a.heightMm;
      if (vertical && outlinesOverlap(corners[i] as Pt[], corners[j] as Pt[])) out.push([a.id, b.id]);
    }
  }
  return out;
}

/**
 * Snaps a dragged mount point: onto a slot within {@link SLOT_SNAP_MM} (taking its height), else
 * to the 1 mm grid; `free` (Shift) keeps 0.1 mm. Slots that coincide from above (front bracket and
 * front top) are told apart by height: the one closest to the part's current `z` wins.
 */
export function snapMount(
  slots: readonly MountSlot[],
  at: { readonly x: number; readonly y: number },
  free: boolean,
  z = 0,
): { x: number; y: number; slot: MountSlot | null } {
  if (!free) {
    const near = slots
      .map((s) => ({ s, d: Math.hypot(s.xMm - at.x, s.yMm - at.y) }))
      .filter((c) => c.d <= SLOT_SNAP_MM)
      .sort((a, b) => Math.abs(a.s.heightMm - z) - Math.abs(b.s.heightMm - z) || a.d - b.d);
    const best = near[0]?.s;
    if (best) return { x: best.xMm, y: best.yMm, slot: best };
  }
  const step = free ? 10 : 1;
  return { x: Math.round(at.x * step) / step, y: Math.round(at.y * step) / step, slot: null };
}
