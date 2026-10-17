import { findManifest } from '@robosim/catalog/manifests';
import { chassisGeometry, type Chassis2wdProps } from '@robosim/component-chassis-2wd/geometry';
import { findArena, type BuiltinArena, type PoseProblem, startPoseProblem } from '@robosim/content/arenas';
import {
  robotToWorld,
  type ArenaView,
  type Pose,
  type RobotView,
  type SensorOverlay,
} from '@robosim/renderer-2d';
import type { ProjectDocument } from '@robosim/shared';
import type { RobotScene } from '@robosim/sim-runtime/client';

/*
 * Main-thread arena model (engine-free): what the editor draws and edits while nothing runs, and
 * the sensor overlay built from a live frame's part states.
 */

const CHASSIS = 'mechanical.chassis-2wd';
const RAD_PER_DEG = Math.PI / 180;

export function arenaViewOf(a: BuiltinArena): ArenaView {
  const s = a.spec;
  return {
    widthM: s.widthM,
    heightM: s.heightM,
    floor: s.floor,
    perimeterWalls: s.perimeterWalls !== false,
    obstacles: (s.obstacles ?? []).map((o) => ({
      id: o.id,
      shape: o.shape,
      x: o.pose.x,
      y: o.pose.y,
      angle: o.pose.angle,
      dynamic: o.dynamic === true,
    })),
    zones: (s.zones ?? []).map((z) => ({
      id: z.id,
      kind: z.kind,
      x: z.center.x,
      y: z.center.y,
      radiusM: z.radiusM,
    })),
  };
}

/** The chassis outline the editor draws: from the project's chassis props (manifest defaults filled in). */
export function robotOf(doc: ProjectDocument): RobotScene | null {
  const chassis = doc.components.find((c) => c.type === CHASSIS);
  const manifest = findManifest(CHASSIS);
  if (!chassis || !manifest) return null;
  const props = Object.fromEntries(
    Object.entries(manifest.props).map(([name, p]) => [name, chassis.props[name] ?? p.default]),
  ) as unknown as Chassis2wdProps;
  const g = chassisGeometry(props);
  return {
    footprint: g.footprint,
    wheels: g.wheels.map((w) => ({ x: w.position.x, y: w.position.y, radiusM: w.radiusM })),
    caster: g.caster,
    mounts: doc.components
      .filter((c) => c.mount && c.id !== chassis.id)
      .map((c) => {
        const m = c.mount as NonNullable<typeof c.mount>;
        return { id: c.id, type: c.type, x: m.x / 1000, y: m.y / 1000, angle: m.yaw * RAD_PER_DEG };
      }),
  };
}

export const hasChassis = (doc: ProjectDocument): boolean => doc.components.some((c) => c.type === CHASSIS);

/** Document start pose (heading in degrees) ↔ view pose (radians). */
export function poseOf(doc: ProjectDocument): Pose | null {
  const p = doc.arena?.startPose;
  return p ? { x: p.x, y: p.y, angle: p.heading * RAD_PER_DEG } : null;
}

/** Rounded the way the editor stores it: millimetres and tenths of a degree. */
export function startPoseOf(pose: Pose): { x: number; y: number; heading: number } {
  let heading = Math.round((pose.angle / RAD_PER_DEG) * 10) / 10;
  heading = ((((heading + 180) % 360) + 360) % 360) - 180;
  return { x: Math.round(pose.x * 1000) / 1000, y: Math.round(pose.y * 1000) / 1000, heading };
}

export function poseProblem(arenaId: string, robot: RobotView, pose: Pose): PoseProblem | null {
  const a = findArena(arenaId);
  return a ? startPoseProblem(a.spec, robot.footprint, pose) : null;
}

/** Puts the project on an arena with its default start pose and challenge (none for open floor). */
export function withArena(doc: ProjectDocument, arenaId: string | null): ProjectDocument {
  const { arena: _arena, successConditions: _conditions, ...rest } = doc;
  const a = arenaId ? findArena(arenaId) : undefined;
  if (!a) return rest;
  return {
    ...rest,
    arena: { arenaVersionId: a.id, startPose: startPoseOf(a.spec.start) },
    ...(a.challenge
      ? {
          successConditions: structuredClone(a.challenge) as NonNullable<
            ProjectDocument['successConditions']
          >,
        }
      : {}),
  };
}

/** Whether switching arenas would discard success conditions the user changed. */
export function conditionsModified(doc: ProjectDocument): boolean {
  if (!doc.successConditions) return false;
  const current = doc.arena ? findArena(doc.arena.arenaVersionId) : undefined;
  return JSON.stringify(doc.successConditions) !== JSON.stringify(current?.challenge ?? null);
}

// Overlay ---------------------------------------------------------------------------------------

/** HC-SR04 model constants (Technical Design §5.5): 15° cone, 4 m range. */
const SONAR_CONE_RAD = 15 * RAD_PER_DEG;
const SONAR_MAX_M = 4;
const IR_CONE_RAD = 20 * RAD_PER_DEG;
/** 5-channel array: S1 leftmost (+2 spacings) … S5 rightmost. */
const LINE5_CHANNELS = [
  ['s1', 2],
  ['s2', 1],
  ['s3', 0],
  ['s4', -1],
  ['s5', -2],
] as const;
const LINE_CHANNELS = [
  ['left', 1],
  ['center', 0],
  ['right', -1],
] as const;

type Format = (value: number, digits?: number) => string;
interface Units {
  readonly cm: (value: string) => string;
  readonly mps: (value: string) => string;
  readonly noEcho: string;
}

/**
 * Overlay of what the robot senses and how its wheels turn (FR-ARN-07), from the live part states:
 * line spots with their reading, ultrasonic cone + range, wheel surface speeds.
 */
export function overlayOf(
  robot: RobotScene,
  pose: Pose,
  parts: Readonly<Record<string, unknown>>,
  project: ProjectDocument,
  fmt: Format,
  units: Units,
): SensorOverlay {
  const overlay: {
    lineSpots: SensorOverlay['lineSpots'][number][];
    sonars: SensorOverlay['sonars'][number][];
    wheels: SensorOverlay['wheels'][number][];
  } = {
    lineSpots: [],
    sonars: [],
    wheels: [],
  };
  for (const m of robot.mounts) {
    const state = parts[m.id] as Record<string, unknown> | undefined;
    const at = (dx: number, dy: number) => {
      const c = Math.cos(m.angle);
      const s = Math.sin(m.angle);
      return robotToWorld(pose, { x: m.x + c * dx - s * dy, y: m.y + s * dx + c * dy });
    };
    if (m.type === 'sensor.line-3ch') {
      const spacing = Number(project.components.find((c) => c.id === m.id)?.props['spacingMm'] ?? 12) / 1000;
      const outputs = (state?.['outputs'] ?? {}) as Record<string, number>;
      for (const [ch, side] of LINE_CHANNELS) {
        overlay.lineSpots.push({ ...at(0, side * spacing), black: outputs[ch] === 1 });
      }
    } else if (m.type === 'sensor.line-5ch') {
      const spacing = Number(project.components.find((c) => c.id === m.id)?.props['spacingMm'] ?? 15) / 1000;
      const outputs = (state?.['outputs'] ?? {}) as Record<string, number>;
      for (const [ch, side] of LINE5_CHANNELS)
        overlay.lineSpots.push({ ...at(0, side * spacing), black: outputs[ch] === 1 });
    } else if (m.type === 'sensor.ir-obstacle') {
      // The FC-51 beam out to the range set on its potentiometer; the label says whether it sees anything.
      const rangeM = Number(project.components.find((c) => c.id === m.id)?.props['rangeCm'] ?? 10) / 100;
      const cm = state?.['distanceCm'];
      const distanceM = typeof cm === 'number' && cm / 100 <= rangeM ? cm / 100 : null;
      overlay.sonars.push({
        ...at(0, 0),
        angle: pose.angle + m.angle,
        coneRad: IR_CONE_RAD,
        maxM: rangeM,
        distanceM,
        label: distanceM === null ? units.noEcho : units.cm(fmt(distanceM * 100, 1)),
      });
    } else if (m.type === 'sensor.tcrt5000') {
      overlay.lineSpots.push({ ...at(0, 0), black: state?.['d0'] === 1 });
    } else if (m.type === 'sensor.hc-sr04') {
      const cm = state?.['distanceCm'];
      const distanceM = typeof cm === 'number' ? cm / 100 : null;
      overlay.sonars.push({
        ...at(0, 0),
        angle: pose.angle + m.angle,
        coneRad: SONAR_CONE_RAD,
        maxM: SONAR_MAX_M,
        distanceM,
        label: distanceM === null ? units.noEcho : units.cm(fmt(distanceM * 100, 1)),
      });
    } else if (m.type === 'actuator.tt-motor') {
      // The motor drives the wheel on its side; positive rpm drives the robot forward.
      const wheel = robot.wheels.find((w) => Math.sign(w.y) === Math.sign(m.y));
      if (!wheel) continue;
      const rpm = Number(state?.['rpm'] ?? 0);
      const speedMps = (rpm * 2 * Math.PI * wheel.radiusM) / 60;
      overlay.wheels.push({
        ...robotToWorld(pose, wheel),
        angle: pose.angle,
        speedMps,
        label: units.mps(fmt(speedMps, 2)),
      });
    }
  }
  return overlay;
}
