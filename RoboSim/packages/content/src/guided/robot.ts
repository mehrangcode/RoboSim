import {
  chassisGeometry,
  manifest as chassisManifest,
  type Chassis2wdProps,
} from '@robosim/component-chassis-2wd';
import {
  PROJECT_SCHEMA_VERSION,
  type ComponentInstance,
  type GuidedRef,
  type PinRef,
  type ProjectDocument,
  type Wire,
} from '@robosim/shared';
import { resolveProps, type ArenaSpec, type ChallengeSpec } from '@robosim/sim-core';

/* Building blocks for guided-project documents: the pre-placed robot base and the reference finish. */

/** Canvas position on the 0.1" grid (the board sits at the origin). */
export const g = (steps: number): number => steps * 2.54;

type Mount = NonNullable<ComponentInstance['mount']>;

const geometry = chassisGeometry(resolveProps(chassisManifest) as unknown as Chassis2wdProps);

/** Pose of a chassis mount slot, like the mounting editor's "put on the robot". */
export function slot(id: string, dx = 0): Mount {
  const s = geometry.mountSlots.find((m) => m.id === id);
  if (!s) throw new Error(`chassis has no slot '${id}'`);
  return { x: s.xMm + dx, y: s.yMm, z: s.heightMm, yaw: 0 };
}

export function part(
  id: string,
  type: string,
  x: number,
  y: number,
  extra: Partial<Pick<ComponentInstance, 'props' | 'inputs' | 'mount'>> = {},
): ComponentInstance {
  return { id, type, typeVersion: '1.0.0', x, y, rotation: 0, flipped: false, props: {}, ...extra };
}

const ref = (t: string): PinRef => {
  const dot = t.indexOf('.');
  return { part: t.slice(0, dot), pin: t.slice(dot + 1) };
};

/** Wires from `part.pin` pairs, numbered from `first`; black to a GND pin, red to 5V. */
export function wires(first: number, ...pairs: readonly (readonly [string, string])[]): Wire[] {
  return pairs.map(([from, to], i) => {
    const ends = `${from} ${to}`;
    return {
      id: `w${first + i}`,
      from: ref(from),
      to: ref(to),
      color: /GND|\.neg|\.gnd/.test(ends) ? 'black' : /5V|\.pos/.test(ends) ? 'red' : 'yellow',
      points: [],
    };
  });
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const DECK = slot('deck');

/**
 * What every guided robot starts with: the 2WD chassis, the Uno stacked on the deck, a 4×AA pack and its
 * switch on the robot, with the pack's + already going to the switch.
 */
export function robotBase(
  guided: GuidedRef,
  title: string,
  sketch: string,
  arena: ArenaSpec,
  challenge: ChallengeSpec,
): ProjectDocument {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    board: { id: 'avr-uno', version: '1.0.0', mount: { x: DECK.x, y: 0, z: 75, yaw: 0 } },
    components: [
      part('chassis', 'mechanical.chassis-2wd', g(-36), g(12)),
      part('bat', 'power.battery-4aa', g(66), g(30), { mount: { ...DECK, x: DECK.x - 65 } }),
      part('sw', 'power.switch', g(32), g(30), {
        inputs: { on: true },
        mount: { x: -125, y: 55, z: DECK.z, yaw: 0 },
      }),
    ],
    wires: wires(1, ['bat.pos', 'sw.a']),
    code: { language: 'cpp', files: [{ name: 'sketch.ino', content: sketch.trim() + '\n' }] },
    libraries: [],
    arena: {
      arenaVersionId: arena.id,
      startPose: { x: arena.start.x, y: arena.start.y, heading: (arena.start.angle * 180) / Math.PI },
    },
    successConditions: clone(challenge) as ProjectDocument['successConditions'],
    guided,
    meta: { title },
  };
}

/** The L298N on the deck with its jumpers off, two TT motors, powered from the switch, on D5–D10. */
export const DRIVE_PARTS: readonly ComponentInstance[] = [
  part('drv', 'driver.l298n', g(32), g(-24), {
    props: { enaJumper: false, enbJumper: false, regulatorJumper: false },
    mount: DECK,
  }),
  part('motorL', 'actuator.tt-motor', g(28), g(-17), { mount: slot('motor-left') }),
  part('motorR', 'actuator.tt-motor', g(62), g(-17), { mount: slot('motor-right') }),
];

export const DRIVE_WIRES: readonly (readonly [string, string])[] = [
  ['sw.b', 'drv.vs'],
  ['bat.neg', 'board.GND1'],
  ['drv.gnd', 'board.GND2'],
  ['board.5V', 'drv.v5'],
  ['drv.out1', 'motorL.m1'],
  ['drv.out2', 'motorL.m2'],
  ['drv.out3', 'motorR.m1'],
  ['drv.out4', 'motorR.m2'],
  ['board.D5', 'drv.ena'],
  ['board.D6', 'drv.enb'],
  ['board.D7', 'drv.in1'],
  ['board.D8', 'drv.in2'],
  ['board.D9', 'drv.in3'],
  ['board.D10', 'drv.in4'],
];

/** The starter with the reference parts, wiring and sketch: what a learner ends up with. */
export function finished(
  starter: ProjectDocument,
  parts: readonly ComponentInstance[],
  pairs: readonly (readonly [string, string])[],
  sketch: string,
): ProjectDocument {
  return {
    ...starter,
    components: [...starter.components, ...parts],
    wires: [...starter.wires, ...wires(starter.wires.length + 1, ...pairs)],
    code: { language: 'cpp', files: [{ name: 'sketch.ino', content: sketch.trim() + '\n' }] },
  };
}
