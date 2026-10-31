import { addComponent, blankProject } from '@robosim/circuit-canvas';
import { findArena } from '@robosim/content/arenas';
import type { ProjectDocument } from '@robosim/shared';
import { describe, expect, it } from 'vitest';
import {
  arenaViewOf,
  conditionsModified,
  overlayOf,
  poseOf,
  robotOf,
  startPoseOf,
  withArena,
} from './arena-model.js';

const bare = blankProject('Robot', 'void setup() {}\nvoid loop() {}\n');
const withChassis = addComponent(bare, 'mechanical.chassis-2wd', [0, 0]).doc;

describe('arena model', () => {
  it('draws the robot from the chassis props with manifest defaults', () => {
    expect(robotOf(bare)).toBeNull();
    const robot = robotOf(withChassis);
    expect(robot?.wheels.map((w) => w.y)).toEqual([0.065, -0.065]);
    expect(robot?.footprint[1]).toEqual({ x: 0.075, y: -0.075 });
  });

  it('puts a project on an arena with its start pose and challenge, and takes it off again', () => {
    const doc = withArena(withChassis, 'maze');
    expect(doc.arena).toEqual({ arenaVersionId: 'maze', startPose: { x: 0.225, y: 0.225, heading: 90 } });
    expect(doc.successConditions?.id).toBe('maze-goal');
    expect(conditionsModified(doc)).toBe(false);
    const open = withArena(doc, 'open-floor');
    expect(open.successConditions).toBeUndefined();
    const none = withArena(doc, null);
    expect(none.arena).toBeUndefined();
    expect(none.successConditions).toBeUndefined();
  });

  it('detects edited success conditions', () => {
    const doc = withArena(withChassis, 'oval');
    const edited: ProjectDocument = {
      ...doc,
      successConditions: { id: 'mine', condition: { type: 'timeLimit', seconds: 5 } },
    };
    expect(conditionsModified(edited)).toBe(true);
  });

  it('stores poses in millimetres and tenths of a degree, heading in (−180, 180]', () => {
    expect(startPoseOf({ x: 1.23456, y: 0.5, angle: (3 * Math.PI) / 2 })).toEqual({
      x: 1.235,
      y: 0.5,
      heading: -90,
    });
    const doc = withArena(withChassis, 'oval');
    expect(poseOf(doc)).toEqual({ x: 0.9, y: 0.3, angle: 0 });
  });

  it('builds the arena view from the spec (obstacles, zones, walls)', () => {
    const sumo = findArena('sumo');
    if (!sumo) throw new Error('sumo');
    const view = arenaViewOf(sumo);
    expect(view.obstacles).toEqual([
      {
        id: 'opponent',
        shape: { kind: 'box', widthM: 0.15, heightM: 0.15 },
        x: 1.35,
        y: 1,
        angle: 0,
        dynamic: true,
      },
    ]);
    expect(view.perimeterWalls).toBe(true);
  });

  it('overlays line spots, the sonar cone and wheel speeds from part states', () => {
    let doc = withChassis;
    const add = (type: string, id: string, mount: { x: number; y: number; yaw?: number }) => {
      const r = addComponent(doc, type, [0, 0]);
      doc = {
        ...r.doc,
        components: r.doc.components.map((c) =>
          c.id === r.id ? { ...c, id, mount: { x: mount.x, y: mount.y, z: 5, yaw: mount.yaw ?? 0 } } : c,
        ),
      };
    };
    add('sensor.line-3ch', 'line', { x: 60, y: 0 });
    add('sensor.hc-sr04', 'sonar', { x: 50, y: 0 });
    add('actuator.tt-motor', 'motorL', { x: 0, y: 45 });
    add('sensor.vl53l0x', 'tof', { x: 55, y: 0 });
    const robot = robotOf(doc);
    if (!robot) throw new Error('robot');
    const overlay = overlayOf(
      robot,
      { x: 1, y: 1, angle: 0 },
      {
        line: { outputs: { left: 1, center: 0, right: 0 } },
        sonar: { distanceCm: 42.5 },
        motorL: { rpm: 60 },
        tof: { rangeMm: 8190 },
      },
      doc,
      (v, d = 0) => v.toFixed(d),
      { cm: (v) => `${v} cm`, mps: (v) => `${v} m/s`, noEcho: 'none' },
    );
    expect(overlay.lineSpots.map((s) => s.black)).toEqual([true, false, false]);
    expect(overlay.lineSpots[0]?.y).toBeCloseTo(1.012, 12);
    expect(overlay.sonars[0]).toMatchObject({ x: 1.05, y: 1, distanceM: 0.425, label: '42.5 cm' });
    expect(overlay.sonars[1]).toMatchObject({ x: 1.055, distanceM: null, label: 'none', maxM: 1.2 }); // VL53L0X out of range
    // 60 rpm on a 65 mm wheel: π · 0.065 m/s.
    expect(overlay.wheels[0]?.speedMps).toBeCloseTo(Math.PI * 0.065, 12);
    expect(overlay.wheels[0]).toMatchObject({ x: 1, y: 1.065, label: '0.20 m/s' });
  });

  it('turns a sonar on a servo horn with the servo angle', () => {
    let doc = withChassis;
    for (const [type, id, mount] of [
      ['actuator.sg90-servo', 'servo', { x: 50, y: 0, z: 45, yaw: 0 }],
      ['sensor.hc-sr04', 'sonar', { x: 50, y: 0, z: 75, yaw: 0, onServo: 'servo' }],
    ] as const) {
      const r = addComponent(doc, type, [0, 0]);
      doc = {
        ...r.doc,
        components: r.doc.components.map((c) => (c.id === r.id ? { ...c, id, mount } : c)),
      };
    }
    const robot = robotOf(doc);
    if (!robot) throw new Error('robot');
    expect(robot.mounts.find((m) => m.id === 'sonar')?.onServo).toEqual({
      id: 'servo',
      pivotX: 0.05,
      pivotY: 0,
    });
    const sonarAt = (angleDeg: number) =>
      overlayOf(
        robot,
        { x: 1, y: 1, angle: 0 },
        { servo: { angleDeg }, sonar: { distanceCm: 20 } },
        doc,
        (v, d = 0) => v.toFixed(d),
        { cm: (v) => `${v} cm`, mps: (v) => `${v} m/s`, noEcho: 'none' },
      ).sonars[0];
    expect(sonarAt(90)?.angle).toBeCloseTo(0, 12);
    expect(sonarAt(150)?.angle).toBeCloseTo(Math.PI / 3, 12);
    expect(sonarAt(30)?.angle).toBeCloseTo(-Math.PI / 3, 12);
    expect(sonarAt(30)).toMatchObject({ x: 1.05, y: 1 });
  });
});
