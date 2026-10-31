import { addComponent, blankProject } from '@robosim/circuit-canvas';
import type { ProjectDocument } from '@robosim/shared';
import { buildRun, builtinSource } from '@robosim/sim-runtime';
import { describe, expect, it } from 'vitest';
import {
  BOARD_ID,
  chassisOf,
  defaultMount,
  massOf,
  mountOnServo,
  mountablesOf,
  moveTo,
  overlapsOf,
  setChassisProp,
  setMount,
  servoHostsFor,
  yawTowards,
  type Mountable,
} from './robot-model.js';

const lineFollower = (): ProjectDocument => builtinSource('line-follower').project;
const partOf = (doc: ProjectDocument, id: string) => mountablesOf(doc).find((p) => p.id === id) as Mountable;

function robot(...types: string[]): ProjectDocument {
  let doc = addComponent(blankProject('Robot', ''), 'mechanical.chassis-2wd', [0, 0]).doc;
  for (const type of types) doc = addComponent(doc, type, [0, 0]).doc;
  return doc;
}

describe('FR-ARN-09 mounting editor model', () => {
  it('lists the board and every mountable part, never the chassis or bench-only parts', () => {
    const parts = mountablesOf(lineFollower());
    expect(parts.map((p) => p.id)).toEqual([BOARD_ID, 'bat', 'sw', 'drv', 'motorL', 'motorR', 'line']);
    expect(partOf(lineFollower(), 'line')).toMatchObject({ overhang: true, motor: false });
    expect(partOf(lineFollower(), 'motorL')).toMatchObject({ overhang: false, motor: true });
    expect(mountablesOf(robot('actuator.led')).map((p) => p.id)).toEqual([BOARD_ID]);
  });

  it('the stock line follower is laid out without overlaps', () => {
    expect(overlapsOf(lineFollower())).toEqual([]);
  });

  it('mounts and unmounts parts and the board', () => {
    let doc = setMount(lineFollower(), 'line', null);
    expect(doc.components.find((c) => c.id === 'line')).not.toHaveProperty('mount');
    doc = setMount(doc, BOARD_ID, { x: -100, y: 10, z: 50, yaw: 90 });
    expect(doc.board.mount).toEqual({ x: -100, y: 10, z: 50, yaw: 90 });
    expect(setMount(doc, BOARD_ID, null).board).not.toHaveProperty('mount');
  });

  it('puts new parts in their natural slot: line sensors in front, sonar on top, motors on a free side', () => {
    const doc = robot('sensor.line-3ch', 'sensor.hc-sr04', 'actuator.tt-motor', 'actuator.tt-motor');
    expect(defaultMount(doc, 'line1')).toEqual({ x: 65, y: 0, z: 5, yaw: 0 });
    expect(defaultMount(doc, 'sonar1')).toEqual({ x: 60, y: 0, z: 60, yaw: 0 });
    const left = setMount(doc, 'motor1', defaultMount(doc, 'motor1'));
    expect(left.components.find((c) => c.id === 'motor1')?.mount?.y).toBe(45);
    expect(defaultMount(left, 'motor2')?.y).toBe(-45);
  });

  it('stacks a part dropped on the deck above what is already there', () => {
    let doc = robot('driver.l298n', 'power.battery-9v');
    doc = setMount(doc, 'drv1', defaultMount(doc, 'drv1'));
    expect(doc.components.find((c) => c.id === 'drv1')?.mount?.z).toBe(45);
    expect(defaultMount(doc, 'bat1')?.z).toBe(45 + 27); // on top of the 27 mm driver
    // The board's default spot is the plate centre at floor level, under the deck.
    expect(partOf(doc, BOARD_ID).mount).toEqual({ x: -30, y: 0, z: 0, yaw: 0 });
  });

  it('drags snap to slots, keep the grid, refuse off-chassis spots; motors only switch sides', () => {
    const doc = lineFollower();
    const c = chassisOf(doc);
    if (!c) throw new Error('chassis');
    const drv = partOf(doc, 'drv');
    const from = drv.mount ?? { x: 0, y: 0, z: 0, yaw: 0 };
    expect(moveTo(c, drv, from, { x: 63, y: -2 }, false)).toEqual({
      mount: { x: 60, y: 0, z: 60, yaw: 0 }, // front-top slot, its height
      problem: null,
    });
    expect(moveTo(c, drv, from, { x: -80.4, y: 20.6 }, false).mount).toMatchObject({ x: -80, y: 21, z: 45 });
    expect(moveTo(c, drv, from, { x: 120, y: 0 }, false).problem).toBe('offChassis');
    // Sensors may overhang the front.
    const line = partOf(doc, 'line');
    expect(moveTo(c, line, line.mount ?? from, { x: 120, y: 0 }, false).problem).toBeNull();
    const motor = partOf(doc, 'motorL');
    expect(moveTo(c, motor, motor.mount ?? from, { x: -50, y: -30 }, false).mount).toEqual({
      x: 0,
      y: -45,
      z: 20,
      yaw: 0,
    });
  });

  it('mounts a part on a servo horn; it rides along when the servo moves or comes off', () => {
    let doc = robot('actuator.sg90-servo', 'sensor.hc-sr04', 'actuator.tt-motor');
    const [servo, sonar, motor] = doc.components.slice(1).map((c) => c.id) as [string, string, string];
    expect(servoHostsFor(doc, sonar)).toEqual([]); // the servo is not on the robot yet
    doc = setMount(doc, servo, { x: 55, y: 0, z: 45, yaw: 0 });
    doc = setMount(doc, sonar, defaultMount(doc, sonar));
    expect(servoHostsFor(doc, sonar).map((p) => p.id)).toEqual([servo]);
    expect(servoHostsFor(doc, servo)).toEqual([]); // no servo on a servo
    expect(servoHostsFor(doc, motor)).toEqual([]);

    doc = mountOnServo(doc, sonar, servo);
    expect(partOf(doc, sonar).mount).toEqual({ x: 55, y: 0, z: 45 + 30, yaw: 0, onServo: servo });
    expect(overlapsOf(doc)).toEqual([]); // sitting on its servo is not an overlap

    doc = setMount(doc, servo, { x: 40, y: 10, z: 45, yaw: 90 });
    expect(partOf(doc, sonar).mount).toEqual({ x: 40, y: 10, z: 75, yaw: 90, onServo: servo });

    expect(partOf(mountOnServo(doc, sonar, null), sonar).mount).toEqual({ x: 40, y: 10, z: 75, yaw: 90 });
    expect(partOf(setMount(doc, servo, null), sonar).mount).toBeNull();
  });

  it('turns parts in 15° steps (free with Shift)', () => {
    const at = { x: 0, y: 0, z: 0, yaw: 0 };
    expect(yawTowards(at, { x: 10, y: 1 }, false)).toBe(0);
    expect(yawTowards(at, { x: 0, y: 10 }, false)).toBe(90);
    expect(yawTowards(at, { x: 10, y: 4 }, false)).toBe(15);
    expect(yawTowards(at, { x: 10, y: 4 }, true)).toBe(22);
    expect(yawTowards(at, { x: -10, y: 0 }, false)).toBe(180);
  });

  it('wheels are chassis props: changing the track width moves the motors with their wheels', () => {
    const doc = setChassisProp(lineFollower(), 'trackWidthMm', 160);
    expect(chassisOf(doc)?.props.trackWidthMm).toBe(160);
    expect(doc.components.find((c) => c.id === 'motorL')?.mount?.y).toBe(60);
    expect(doc.components.find((c) => c.id === 'motorR')?.mount?.y).toBe(-60);
  });

  it('computes the same centre of mass as the loader the simulation runs', () => {
    const moved = setMount(lineFollower(), 'bat', { x: 40, y: 30, z: 45, yaw: 0 });
    for (const doc of [lineFollower(), moved]) {
      const source = { ...builtinSource('line-follower'), project: doc };
      expect(massOf(doc)?.center).toEqual(buildRun(source).scene.robot?.centerOfMass);
    }
    // Moving the 110 g battery forward and left pulls the centre of mass along.
    const a = massOf(lineFollower());
    const b = massOf(moved);
    expect(b?.center.x).toBeGreaterThan(a?.center.x ?? 0);
    expect(b?.center.y).toBeGreaterThan(0);
    expect(b?.axleShare).toBeGreaterThan(a?.axleShare ?? 1);
  });
});
