import { UNO_BODY } from '@robosim/board-avr-uno/pins';
import { findManifest } from '@robosim/catalog/manifests';
import {
  chassisGeometry,
  type Chassis2wdProps,
  type ChassisGeometry,
  type MountSlot,
} from '@robosim/component-chassis-2wd/geometry';
import {
  mountOverlaps,
  mountProblem,
  snapMount,
  type MountPose,
  type MountProblem,
  type MountedBox,
} from '@robosim/component-chassis-2wd/mounting';
import { boxInertia, robotMass, type PointMass, type RobotMass } from '@robosim/sim-core/mass';
import { BOARD_PART, type ProjectDocument } from '@robosim/shared';

/*
 * Mounting editor model (FR-ARN-09), engine-free and pure: which parts can go on the chassis, where
 * they sit, the rules the loader enforces, and the mass distribution the physics world will use.
 */

const CHASSIS = 'mechanical.chassis-2wd';
const MOTOR = 'actuator.tt-motor';
export const BOARD_ID = BOARD_PART;
const YAW_SNAP_DEG = 15;

export interface Mountable {
  readonly id: string;
  /** Catalogue type; `board` for the Uno. */
  readonly type: string;
  readonly massG: number;
  readonly lengthMm: number;
  readonly widthMm: number;
  readonly heightMm: number;
  /** Sensors may overhang the front of the plate. */
  readonly overhang: boolean;
  /** TT motors sit in their side's motor slot (the wheels are chassis props). */
  readonly motor: boolean;
  readonly mount: MountPose | null;
}

export interface Chassis {
  readonly id: string;
  readonly props: Chassis2wdProps;
  readonly geometry: ChassisGeometry;
}

export function chassisOf(doc: ProjectDocument): Chassis | null {
  const chassis = doc.components.find((c) => c.type === CHASSIS);
  const manifest = findManifest(CHASSIS);
  if (!chassis || !manifest) return null;
  const props = Object.fromEntries(
    Object.entries(manifest.props).map(([name, p]) => [name, chassis.props[name] ?? p.default]),
  ) as unknown as Chassis2wdProps;
  return { id: chassis.id, props, geometry: chassisGeometry(props) };
}

/** Where the loader puts a board without a mount: on the plate centre. */
export const defaultBoardMount = (c: Chassis): MountPose => ({
  x: c.props.bodyCenterXMm,
  y: 0,
  z: 0,
  yaw: 0,
});

/** The board first, then every part whose manifest has a mounting footprint (document order). */
export function mountablesOf(doc: ProjectDocument): readonly Mountable[] {
  const chassis = chassisOf(doc);
  const out: Mountable[] = [
    {
      id: BOARD_ID,
      type: 'board',
      massG: UNO_BODY.massG,
      ...UNO_BODY.mounting,
      overhang: false,
      motor: false,
      mount: doc.board.mount ?? (chassis ? defaultBoardMount(chassis) : null),
    },
  ];
  for (const c of doc.components) {
    const m = findManifest(c.type);
    if (!m?.mounting || c.type === CHASSIS) continue;
    out.push({
      id: c.id,
      type: c.type,
      massG: m.massG,
      ...m.mounting,
      overhang: m.category === 'sensor',
      motor: c.type === MOTOR,
      mount: c.mount ?? null,
    });
  }
  return out;
}

export const boxOf = (p: Mountable, pose: MountPose): MountedBox => ({
  id: p.id,
  pose,
  lengthMm: p.lengthMm,
  widthMm: p.widthMm,
  heightMm: p.heightMm,
  overhang: p.overhang,
});

export function setMount(doc: ProjectDocument, id: string, mount: MountPose | null): ProjectDocument {
  if (id === BOARD_ID) {
    const { mount: _old, ...board } = doc.board;
    return { ...doc, board: mount ? { ...board, mount } : board };
  }
  return {
    ...doc,
    components: doc.components.map((c) => {
      if (c.id !== id) return c;
      const { mount: _old, ...rest } = c;
      return mount ? { ...rest, mount } : rest;
    }),
  };
}

const slot = (c: Chassis, id: string): MountSlot | undefined =>
  c.geometry.mountSlots.find((s) => s.id === id);

/** A motor's pose in its side's slot (left: y > 0). */
export function motorMount(c: Chassis, side: 'left' | 'right'): MountPose {
  const s = slot(c, side === 'left' ? 'motor-left' : 'motor-right') as MountSlot;
  return { x: s.xMm, y: s.yMm, z: s.heightMm, yaw: 0 };
}

/** Lowest height at (x, y) where the part clears everything already mounted (stacking on the deck). */
function clearHeight(parts: readonly Mountable[], part: Mountable, at: MountPose): number {
  let z = at.z;
  for (let tries = 0; tries < parts.length; tries++) {
    const box = boxOf(part, { ...at, z });
    const others = parts
      .filter((p) => p.mount && p.id !== part.id)
      .map((p) => boxOf(p, p.mount as MountPose));
    const hits = mountOverlaps([box, ...others]).filter(([a]) => a === part.id);
    if (hits.length === 0) return z;
    z = Math.max(
      ...hits.map(([, b]) => {
        const o = others.find((x) => x.id === b) as MountedBox;
        return o.pose.z + o.heightMm;
      }),
    );
  }
  return z;
}

/** Where a part goes when it is put on the robot: its natural slot, stacked clear of what is there. */
export function defaultMount(doc: ProjectDocument, id: string): MountPose | null {
  const c = chassisOf(doc);
  const parts = mountablesOf(doc);
  const part = parts.find((p) => p.id === id);
  if (!c || !part) return null;
  if (part.motor) {
    const leftTaken = parts.some((p) => p.motor && p.id !== id && p.mount && p.mount.y > 0);
    return motorMount(c, leftTaken ? 'right' : 'left');
  }
  const at = (slotId: string): MountPose => {
    const s = slot(c, slotId) as MountSlot;
    return { x: s.xMm, y: s.yMm, z: s.heightMm, yaw: 0 };
  };
  const base =
    part.type === 'sensor.hc-sr04' || part.type === 'sensor.vl53l0x'
      ? at('front-top')
      : part.overhang
        ? at('front-bracket')
        : at('deck');
  return { ...base, z: Math.min(clearHeight(parts, part, base), 150) };
}

export interface MoveResult {
  readonly mount: MountPose;
  readonly problem: MountProblem | null;
}

/**
 * A dragged part's new pose: motors switch sides only; others snap onto a slot (taking its height)
 * or to the 1 mm grid (`free`: 0.1 mm). The problem, if any, refuses the move.
 */
export function moveTo(
  c: Chassis,
  part: Mountable,
  from: MountPose,
  at: { x: number; y: number },
  free: boolean,
): MoveResult {
  if (part.motor) {
    const mount = motorMount(c, at.y >= 0 ? 'left' : 'right');
    return { mount, problem: null };
  }
  const slots = c.geometry.mountSlots.filter((s) => !s.id.startsWith('motor-'));
  const s = snapMount(slots, at, free, from.z);
  const mount = { ...from, x: s.x, y: s.y, z: s.slot ? s.slot.heightMm : from.z };
  return { mount, problem: mountProblem(c.props, mount, part.overhang) };
}

/** Yaw (degrees, −180…180) facing from the part's centre towards `at`; 15° steps unless `free`. */
export function yawTowards(from: MountPose, at: { x: number; y: number }, free: boolean): number {
  const deg = (Math.atan2(at.y - from.y, at.x - from.x) * 180) / Math.PI;
  const yaw = free ? Math.round(deg) : Math.round(deg / YAW_SNAP_DEG) * YAW_SNAP_DEG;
  return yaw === -180 ? 180 : yaw;
}

export function checkMount(c: Chassis, part: Mountable, mount: MountPose): MountProblem | null {
  return mountProblem(c.props, mount, part.overhang);
}

/** Changes a wheel prop (track width, wheel diameter); motors follow their slots. */
export function setChassisProp(doc: ProjectDocument, name: keyof Chassis2wdProps, value: number) {
  const c = chassisOf(doc);
  if (!c) return doc;
  const next: ProjectDocument = {
    ...doc,
    components: doc.components.map((x) =>
      x.id === c.id ? { ...x, props: { ...x.props, [name]: value } } : x,
    ),
  };
  const moved = chassisOf(next) as Chassis;
  return {
    ...next,
    components: next.components.map((x) =>
      x.type === MOTOR && x.mount ? { ...x, mount: motorMount(moved, x.mount.y > 0 ? 'left' : 'right') } : x,
    ),
  };
}

/** Pairs of mounted parts that occupy the same space. */
export function overlapsOf(doc: ProjectDocument): readonly (readonly [string, string])[] {
  return mountOverlaps(mountablesOf(doc).flatMap((p) => (p.mount ? [boxOf(p, p.mount)] : [])));
}

/** Mass distribution exactly as the loader builds it (board, mounted parts, parts plugged into them). */
export function massOf(doc: ProjectDocument): RobotMass | null {
  const c = chassisOf(doc);
  if (!c) return null;
  const at = (m: { x: number; y: number }, massG: number, box?: Mountable): PointMass => ({
    x: m.x / 1000,
    y: m.y / 1000,
    massKg: massG / 1000,
    ...(box ? { inertiaKgM2: boxInertia(massG / 1000, box.lengthMm, box.widthMm) } : {}),
  });
  const parts = new Map(mountablesOf(doc).map((p) => [p.id, p]));
  const board = parts.get(BOARD_ID) as Mountable;
  const payload: PointMass[] = [at(board.mount ?? defaultBoardMount(c), board.massG, board)];
  const byId = new Map(doc.components.map((x) => [x.id, x]));
  for (const x of doc.components) {
    if (x.id === c.id) continue;
    const massG = findManifest(x.type)?.massG ?? 0;
    if (x.mount) payload.push(at(x.mount, massG, parts.get(x.id)));
    else {
      const host = byId.get(Object.values(x.seats ?? {})[0]?.part ?? '');
      if (host?.mount && host.id !== c.id) payload.push(at(host.mount, massG));
    }
  }
  return robotMass(c.geometry, payload);
}
