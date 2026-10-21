import { findDefinition } from '@robosim/catalog';
import { chassisGeometry, type Chassis2wdProps } from '@robosim/component-chassis-2wd';
import { ARENAS, CHALLENGES, ovalArena, ovalChallenge } from '@robosim/content';
import { resolveProps } from '@robosim/sim-core';
import {
  PROJECT_SCHEMA_VERSION,
  parseProjectDocument,
  type ComponentInstance,
  type PinRef,
  type ProjectDocument,
  type Wire,
} from '@robosim/shared';
import { FIRMWARE_HEX } from './firmware/generated.js';
import { FIRMWARE_SKETCHES as SKETCH, type FirmwareId } from './firmware/sketches.js';
import { loadProject, type Scenario } from './project-loader.js';
import type { FirmwarePayload, RunSource, ScenarioId } from './protocol.js';

export { findingView, loadProject, ProjectLoadError, UNO_BOARD, type Scenario } from './project-loader.js';

/*
 * The Lab's built-in demos as project documents (Technical Design §8.10), exactly what the editor
 * will save. Each ships its Arduino sketch (firmware/sketches.ts) and the HEX the build service
 * compiled from it (firmware/generated.ts, `pnpm firmware:gen`).
 */

type Placement = Partial<Pick<ComponentInstance, 'props' | 'inputs' | 'mount'>>;

function part(id: string, type: string, x: number, y: number, extra: Placement = {}): ComponentInstance {
  return { id, type, typeVersion: '1.0.0', x, y, rotation: 0, flipped: false, props: {}, ...extra };
}

const ref = (t: string): PinRef => {
  const dot = t.indexOf('.');
  return { part: t.slice(0, dot), pin: t.slice(dot + 1) };
};

/** Wires from `part.pin` pairs; black when one end is a board GND pin. */
function wires(...pairs: readonly (readonly [string, string])[]): Wire[] {
  return pairs.map(([from, to], i) => ({
    id: `w${i + 1}`,
    from: ref(from),
    to: ref(to),
    color: `${from} ${to}`.includes('board.GND') ? 'black' : 'yellow',
    points: [],
  }));
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function project(
  title: string,
  sketch: string,
  components: ComponentInstance[],
  wiring: Wire[],
  extra: Pick<ProjectDocument, 'arena' | 'successConditions'> & {
    boardMount?: NonNullable<ProjectDocument['board']['mount']>;
  } = {},
): ProjectDocument {
  const { boardMount, ...rest } = extra;
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    board: { id: 'avr-uno', version: '1.0.0', ...(boardMount ? { mount: boardMount } : {}) },
    components,
    wires: wiring,
    code: { language: 'cpp', files: [{ name: 'sketch.ino', content: sketch.trim() + '\n' }] },
    libraries: [],
    ...rest,
    meta: { title },
  };
}

/** Canvas position on the 0.1" grid (the board sits at the origin, 27 × 21 grid steps). */
const g = (steps: number): number => steps * 2.54;

/** Uno D13 → 220 Ω → LED → GND. */
const ledOn = (pin: string, color: string, gnd = 'GND1') => ({
  parts: [
    part('r1', 'passive.resistor', g(32), g(4), { props: { ohms: 220 } }),
    part('led', 'actuator.led', g(38), g(4), { props: { color } }),
  ],
  wires: [
    [`board.${pin}`, 'r1.a'],
    ['r1.b', 'led.a'],
    ['led.k', `board.${gnd}`],
  ] as const,
});

/** D9 → 1 kΩ → TIP120 base; 4×AA → TT motor → collector; with or without a 1N4007 across the motor. */
const transistorMotor = (flyback: boolean) => ({
  parts: [
    part('pack', 'power.battery-4aa', g(58), g(22)),
    part('rb', 'passive.resistor', g(30), g(4), { props: { ohms: 1000 } }),
    part('q', 'semiconductor.tip120', g(38), g(6)),
    ...(flyback ? [part('d', 'semiconductor.diode-1n4007', g(44), g(-2))] : []),
    part('motor', 'actuator.tt-motor', g(52), g(6)),
  ],
  wires: [
    ['board.D9', 'rb.a'],
    ['rb.b', 'q.b'],
    ['q.e', 'board.GND1'],
    ['pack.neg', 'board.GND2'],
    ['pack.pos', 'motor.m1'],
    ['motor.m2', 'q.c'],
    ...(flyback
      ? ([
          ['d.a', 'motor.m2'],
          ['d.k', 'motor.m1'],
        ] as const)
      : []),
  ] as const,
});

const knob = {
  parts: [part('pot', 'passive.potentiometer', g(32), g(16))],
  wires: [
    ['board.5V', 'pot.a'],
    ['pot.wiper', 'board.A0'],
    ['pot.b', 'board.GND2'],
  ] as const,
};

function lineFollower(): ProjectDocument {
  const chassis = findDefinition('mechanical.chassis-2wd');
  const geometry = chassisGeometry(resolveProps(chassis.manifest) as unknown as Chassis2wdProps);
  const slot = (id: string) => {
    const s = geometry.mountSlots.find((m) => m.id === id);
    if (!s) throw new Error(`chassis has no slot '${id}'`);
    return { x: s.xMm, y: s.yMm, z: s.heightMm, yaw: 0 };
  };
  const deck = slot('deck');
  return project(
    'Line follower',
    SKETCH.lineFollower,
    [
      part('chassis', 'mechanical.chassis-2wd', g(-36), g(12)),
      part('bat', 'power.battery-4aa', g(66), g(30), { mount: { ...deck, x: deck.x - 65 } }),
      part('sw', 'power.switch', g(32), g(30), {
        inputs: { on: true },
        mount: { x: -125, y: 55, z: deck.z, yaw: 0 },
      }),
      part('drv', 'driver.l298n', g(32), g(-24), {
        props: { enaJumper: false, enbJumper: false, regulatorJumper: false },
        mount: deck,
      }),
      part('motorL', 'actuator.tt-motor', g(28), g(-17), { mount: slot('motor-left') }),
      part('motorR', 'actuator.tt-motor', g(62), g(-17), { mount: slot('motor-right') }),
      part('line', 'sensor.line-3ch', g(40), g(42), {
        props: { spacingMm: 12 },
        mount: slot('front-bracket'),
      }),
    ],
    wires(
      ['bat.pos', 'sw.a'],
      ['sw.b', 'drv.vs'],
      ['board.5V', 'drv.v5'],
      ['board.5V', 'line.vcc'],
      ['board.D5', 'drv.ena'],
      ['board.D6', 'drv.enb'],
      ['board.D7', 'drv.in1'],
      ['board.D8', 'drv.in2'],
      ['board.D9', 'drv.in3'],
      ['board.D10', 'drv.in4'],
      ['drv.out1', 'motorL.m1'],
      ['drv.out2', 'motorL.m2'],
      ['drv.out3', 'motorR.m1'],
      ['drv.out4', 'motorR.m2'],
      ['line.left', 'board.D2'],
      ['line.center', 'board.D3'],
      ['line.right', 'board.D4'],
      ['bat.neg', 'board.GND1'],
      ['drv.gnd', 'board.GND2'],
      ['line.gnd', 'board.GND3'],
    ),
    {
      arena: {
        arenaVersionId: 'oval',
        startPose: { x: ovalArena.start.x, y: ovalArena.start.y, heading: 0 },
      },
      successConditions: clone(ovalChallenge) as ProjectDocument['successConditions'],
      // Stacked above the driver on the deck.
      boardMount: { x: deck.x, y: 0, z: 75, yaw: 0 },
    },
  );
}

/**
 * The line follower's drive train with two lever switches at the front corners instead of the line
 * sensor, on the obstacle course with its default challenge (catalogue Tier A, slice 16c).
 */
function bumpAvoider(): ProjectDocument {
  const base = lineFollower();
  const course = ARENAS['obstacle-course'];
  const challenge = CHALLENGES['obstacle-course'];
  if (!course || !challenge) throw new Error('obstacle course missing from @robosim/content');
  const bump = (id: string, y: number, yaw: number) =>
    part(id, 'sensor.bump-switch', g(40), g(38 + (55 - y) / 18), { mount: { x: 70, y, z: 20, yaw } });
  return {
    ...base,
    components: [
      ...base.components.filter((c) => c.type !== 'sensor.line-3ch'),
      bump('bumpL', 55, 25),
      bump('bumpC', 0, 0),
      bump('bumpR', -55, -25),
    ],
    wires: wires(
      ...base.wires
        .filter((w) => w.from.part !== 'line' && w.to.part !== 'line')
        .map((w) => [`${w.from.part}.${w.from.pin}`, `${w.to.part}.${w.to.pin}`] as const),
      ['bumpL.no', 'board.D2'],
      ['bumpC.no', 'board.D4'],
      ['bumpR.no', 'board.D3'],
      ['bumpL.com', 'board.GND3'],
      ['bumpC.com', 'board.GND3'],
      ['bumpR.com', 'board.GND3'],
    ),
    code: { language: 'cpp', files: [{ name: 'sketch.ino', content: SKETCH.bumpAvoider.trim() + '\n' }] },
    arena: {
      arenaVersionId: 'obstacle-course',
      startPose: { x: course.start.x, y: course.start.y, heading: 0 },
    },
    successConditions: clone(challenge) as ProjectDocument['successConditions'],
    meta: { title: 'Bump-and-turn obstacle avoider' },
  };
}

/**
 * The bump avoider's drive train with a VL53L0X laser ranger looking ahead instead of the lever
 * switches (catalogue Tier C): it spins away from anything closer than 25 cm.
 */
function laserAvoider(): ProjectDocument {
  const base = bumpAvoider();
  return {
    ...base,
    components: [
      ...base.components.filter((c) => c.type !== 'sensor.bump-switch'),
      part('tof', 'sensor.vl53l0x', g(40), g(40), { mount: { x: 70, y: 0, z: 40, yaw: 0 } }),
    ],
    wires: wires(
      ...base.wires
        .filter((w) => !w.from.part.startsWith('bump') && !w.to.part.startsWith('bump'))
        .map((w) => [`${w.from.part}.${w.from.pin}`, `${w.to.part}.${w.to.pin}`] as const),
      ['board.5V', 'tof.vin'],
      ['tof.gnd', 'board.GND3'],
      ['tof.sda', 'board.A4'],
      ['tof.scl', 'board.A5'],
      ['board.D11', 'tof.xshut'],
    ),
    code: { language: 'cpp', files: [{ name: 'sketch.ino', content: SKETCH.laserAvoider.trim() + '\n' }] },
    meta: { title: 'Laser-ranging obstacle avoider' },
  };
}

/** The line follower's drive train and power, without its sensor wiring: the base of the arena robots. */
function driveTrain(): Pick<ProjectDocument, 'components' | 'wires'> & { base: ProjectDocument } {
  const base = lineFollower();
  return {
    base,
    components: base.components.filter((c) => c.type !== 'sensor.line-3ch'),
    wires: base.wires.filter((w) => w.from.part !== 'line' && w.to.part !== 'line'),
  };
}

const pairsOf = (list: readonly Wire[]) =>
  list.map((w) => [`${w.from.part}.${w.from.pin}`, `${w.to.part}.${w.to.pin}`] as const);

/** Arena + start pose + the arena's default challenge, from `@robosim/content`. */
function arenaOf(id: string): Pick<ProjectDocument, 'arena' | 'successConditions'> {
  const spec = ARENAS[id];
  const challenge = CHALLENGES[id];
  if (!spec || !challenge) throw new Error(`arena '${id}' missing from @robosim/content`);
  return {
    arena: {
      arenaVersionId: id,
      startPose: {
        x: spec.start.x,
        y: spec.start.y,
        heading: Math.round((spec.start.angle * 180e6) / Math.PI) / 1e6,
      },
    },
    successConditions: clone(challenge) as ProjectDocument['successConditions'],
  };
}

/**
 * Right-hand wall follower for the 5 × 5 maze: three HC-SR04s (front, left, right) on the line
 * follower's drive train, with NewPing.
 */
function mazeSolver(): ProjectDocument {
  const { base, components, wires: drive } = driveTrain();
  const sonar = (id: string, y: number, mount: NonNullable<ComponentInstance['mount']>) =>
    part(id, 'sensor.hc-sr04', g(40), g(y), { mount });
  return {
    ...base,
    components: [
      ...components,
      sonar('sonarF', 36, { x: 60, y: 0, z: 60, yaw: 0 }),
      sonar('sonarL', 42, { x: 40, y: 55, z: 45, yaw: 90 }),
      sonar('sonarR', 48, { x: 40, y: -55, z: 45, yaw: -90 }),
    ],
    wires: wires(
      ...pairsOf(drive),
      ['board.5V', 'sonarF.vcc'],
      ['board.5V', 'sonarL.vcc'],
      ['board.5V', 'sonarR.vcc'],
      ['board.D2', 'sonarF.trig'],
      ['sonarF.echo', 'board.D3'],
      ['board.D4', 'sonarL.trig'],
      ['sonarL.echo', 'board.D11'],
      ['board.A0', 'sonarR.trig'],
      ['sonarR.echo', 'board.A1'],
      ['sonarF.gnd', 'board.GND3'],
      ['sonarL.gnd', 'board.GND3'],
      ['sonarR.gnd', 'board.GND3'],
    ),
    code: { language: 'cpp', files: [{ name: 'sketch.ino', content: SKETCH.mazeSolver.trim() + '\n' }] },
    ...arenaOf('maze'),
    meta: { title: 'Wall-following maze solver' },
  };
}

/**
 * Sumo bot for the ring: an HC-SR04 looks for the opponent and the 3-channel line sensor, now facing
 * the white edge of the ring, keeps the robot inside.
 */
function sumoBot(): ProjectDocument {
  const { base, components, wires: drive } = driveTrain();
  const line = base.components.find((c) => c.type === 'sensor.line-3ch');
  if (!line) throw new Error('line follower has no line sensor');
  return {
    ...base,
    components: [
      ...components,
      line,
      part('sonar', 'sensor.hc-sr04', g(40), g(36), { mount: { x: 60, y: 0, z: 60, yaw: 0 } }),
    ],
    wires: wires(
      ...pairsOf(drive),
      ['board.5V', 'line.vcc'],
      ['line.left', 'board.D11'],
      ['line.center', 'board.D12'],
      ['line.right', 'board.A0'],
      ['line.gnd', 'board.GND3'],
      ['board.5V', 'sonar.vcc'],
      ['board.D2', 'sonar.trig'],
      ['sonar.echo', 'board.D3'],
      ['sonar.gnd', 'board.GND3'],
    ),
    code: { language: 'cpp', files: [{ name: 'sketch.ino', content: SKETCH.sumoBot.trim() + '\n' }] },
    ...arenaOf('sumo'),
    meta: { title: 'Sumo bot' },
  };
}

/** I²C module wiring to the Uno: power, ground and SDA/SCL on A4/A5. */
const i2cWires = (id: string, vcc = 'vcc', supply = '5V', gnd = 'GND1') =>
  [
    [`board.${supply}`, `${id}.${vcc}`],
    [`${id}.gnd`, `board.${gnd}`],
    [`${id}.sda`, 'board.A4'],
    [`${id}.scl`, 'board.A5'],
  ] as const;

function builtins(): Record<ScenarioId, { project: ProjectDocument; firmware: FirmwareId }> {
  const blink = ledOn('D13', 'red');
  const button = ledOn('D13', 'green');
  const btn = part('btn', 'sensor.push-button', g(32), g(12));
  const dimmer = ledOn('D6', 'yellow', 'GND1');
  const fighting = ledOn('D2', 'green');
  return {
    'line-follower': { project: lineFollower(), firmware: 'lineFollower' },
    'bump-avoider': { project: bumpAvoider(), firmware: 'bumpAvoider' },
    'laser-avoider': { project: laserAvoider(), firmware: 'laserAvoider' },
    'maze-solver': { project: mazeSolver(), firmware: 'mazeSolver' },
    'sumo-bot': { project: sumoBot(), firmware: 'sumoBot' },
    blink: { project: project('Blink', SKETCH.blink, blink.parts, wires(...blink.wires)), firmware: 'blink' },
    button: {
      project: project(
        'Button + LED',
        SKETCH.button,
        [...button.parts, btn],
        wires(...button.wires, ['btn.b1', 'board.D2'], ['btn.a1', 'board.GND2']),
      ),
      firmware: 'button',
    },
    dimmer: {
      project: project(
        'Knob dims an LED',
        SKETCH.dimmer,
        [...knob.parts, ...dimmer.parts],
        wires(...knob.wires, ...dimmer.wires),
      ),
      firmware: 'dimmer',
    },
    // A stalled SG90 draws up to 650 mA — more than the Uno's 5 V pin (500 mA) can give
    // (SAF-SUPPLY-OVERLOAD), so the servo gets its own 4×AA pack with a common ground.
    servo: {
      project: project(
        'Knob turns a servo',
        SKETCH.servo,
        [
          ...knob.parts,
          part('servo', 'actuator.sg90-servo', g(50), g(6)),
          part('pack', 'power.battery-4aa', g(50), g(20)),
        ],
        wires(
          ...knob.wires,
          ['board.D9', 'servo.signal'],
          ['pack.pos', 'servo.vcc'],
          ['servo.gnd', 'board.GND1'],
          ['pack.neg', 'board.GND3'],
        ),
      ),
      firmware: 'servo',
    },
    serial: {
      project: project('Serial Monitor', SKETCH.serial, button.parts, wires(...button.wires)),
      firmware: 'serial',
    },
    // Catalogue Tier A (slice 16a): RGB LED, passive buzzer (with the recommended series resistor).
    'rgb-melody': {
      project: project(
        'RGB mood light + melody',
        SKETCH.rgbMelody,
        [
          ...knob.parts,
          part('rr', 'passive.resistor', g(32), g(-6), { props: { ohms: 220 } }),
          part('rg', 'passive.resistor', g(32), g(-4), { props: { ohms: 220 } }),
          part('rb', 'passive.resistor', g(32), g(-2), { props: { ohms: 220 } }),
          part('rgb', 'actuator.led-rgb', g(40), g(-3)),
          { ...btn, y: g(12) },
          part('rbz', 'passive.resistor', g(32), g(8), { props: { ohms: 220 } }),
          part('buz', 'actuator.buzzer-passive', g(40), g(8)),
        ],
        wires(
          ...knob.wires,
          ['board.D9', 'rr.a'],
          ['rr.b', 'rgb.r'],
          ['board.D6', 'rg.a'],
          ['rg.b', 'rgb.g'],
          ['board.D5', 'rb.a'],
          ['rb.b', 'rgb.b'],
          ['rgb.common', 'board.GND1'],
          ['btn.b1', 'board.D2'],
          ['btn.a1', 'board.GND2'],
          ['board.D8', 'rbz.a'],
          ['rbz.b', 'buz.pos'],
          ['buz.neg', 'board.GND3'],
        ),
      ),
      firmware: 'rgbMelody',
    },
    // 7-segment digit, relay module switching a separate 9 V circuit through an LM7805.
    'relay-counter': {
      project: project(
        'Relay counter',
        SKETCH.relayCounter,
        [
          ...(['a', 'b', 'c', 'd', 'e', 'f', 'g'] as const).map((s, i) =>
            part(`r${s}`, 'passive.resistor', g(30), g(-10 + 2 * i), { props: { ohms: 220 } }),
          ),
          part('seg', 'display.seven-segment', g(38), g(-8)),
          { ...btn, x: g(10), y: g(26) },
          part('relay', 'actuator.relay-module', g(30), g(6)),
          part('bat', 'power.battery-9v', g(66), g(4)),
          part('reg', 'semiconductor.lm7805', g(60), g(14)),
          part('rl', 'passive.resistor', g(60), g(18), { props: { ohms: 330 } }),
          part('lamp', 'actuator.led', g(66), g(18), { props: { color: 'white' } }),
        ],
        wires(
          ...(['a', 'b', 'c', 'd', 'e', 'f', 'g'] as const).flatMap(
            (s, i) =>
              [
                [`board.D${2 + i}`, `r${s}.a`],
                [`r${s}.b`, `seg.${s}`],
              ] as const,
          ),
          ['seg.com1', 'board.GND1'],
          ['btn.b1', 'board.A1'],
          ['btn.a1', 'board.GND2'],
          ['board.D12', 'relay.in'],
          ['board.5V', 'relay.vcc'],
          ['relay.gnd', 'board.GND3'],
          ['bat.pos', 'relay.com'],
          ['relay.no', 'reg.in'],
          ['reg.out', 'rl.a'],
          ['rl.b', 'lamp.a'],
          ['lamp.k', 'reg.gnd'],
          ['reg.gnd', 'bat.neg'],
        ),
      ),
      firmware: 'relayCounter',
    },
    // Catalogue Tier A (slice 16b): logic ICs, shift register, stepper, MOSFET H-bridge.
    'half-adder': {
      project: project(
        'Half adder',
        SKETCH.halfAdder,
        [
          part('xor', 'ic.74hc86', g(34), g(4)),
          part('and', 'ic.74hc08', g(34), g(12)),
          part('btnA', 'sensor.push-button', g(48), g(2)),
          part('btnB', 'sensor.push-button', g(48), g(10)),
          part('rA', 'passive.resistor', g(54), g(2), { props: { ohms: 10_000 } }),
          part('rB', 'passive.resistor', g(54), g(10), { props: { ohms: 10_000 } }),
          part('rs', 'passive.resistor', g(34), g(20), { props: { ohms: 330 } }),
          part('sum', 'actuator.led', g(40), g(20), { props: { color: 'green' } }),
          part('rc', 'passive.resistor', g(46), g(20), { props: { ohms: 330 } }),
          part('carry', 'actuator.led', g(52), g(20), { props: { color: 'red' } }),
        ],
        wires(
          ['board.5V', 'xor.vcc'],
          ['board.5V', 'and.vcc'],
          ['xor.gnd', 'board.GND1'],
          ['and.gnd', 'board.GND1'],
          ['board.5V', 'btnA.a1'],
          ['board.5V', 'btnB.a1'],
          ['btnA.b1', 'rA.a'],
          ['rA.b', 'board.GND2'],
          ['btnB.b1', 'rB.a'],
          ['rB.b', 'board.GND2'],
          ['btnA.b1', 'xor.1a'],
          ['btnB.b1', 'xor.1b'],
          ['btnA.b1', 'and.1a'],
          ['btnB.b1', 'and.1b'],
          ['xor.1y', 'board.D2'],
          ['and.1y', 'board.D3'],
          ['xor.1y', 'rs.a'],
          ['rs.b', 'sum.a'],
          ['sum.k', 'board.GND3'],
          ['and.1y', 'rc.a'],
          ['rc.b', 'carry.a'],
          ['carry.k', 'board.GND3'],
        ),
      ),
      firmware: 'halfAdder',
    },
    'led-bar': {
      project: project(
        'LED bar (74HC595)',
        SKETCH.ledBar,
        [
          ...knob.parts,
          part('sr', 'ic.74hc595', g(36), g(2)),
          ...Array.from({ length: 8 }, (_, i) =>
            part(`r${i}`, 'passive.resistor', g(48), g(-6 + 3 * i), { props: { ohms: 220 } }),
          ),
          ...Array.from({ length: 8 }, (_, i) =>
            part(`led${i}`, 'actuator.led', g(56), g(-5 + 3 * i), { props: { color: 'red' } }),
          ),
        ],
        wires(
          ...knob.wires,
          ['board.5V', 'sr.vcc'],
          ['sr.gnd', 'board.GND1'],
          ['board.5V', 'sr.srclr'],
          ['sr.oe', 'board.GND1'],
          ['board.D11', 'sr.ser'],
          ['board.D12', 'sr.srclk'],
          ['board.D8', 'sr.rclk'],
          ...(['qa', 'qb', 'qc', 'qd', 'qe', 'qf', 'qg', 'qh'] as const).flatMap(
            (q, i) =>
              [
                [`sr.${q}`, `r${i}.a`],
                [`r${i}.b`, `led${i}.a`],
                [`led${i}.k`, 'board.GND3'],
              ] as const,
          ),
        ),
      ),
      firmware: 'ledBar',
    },
    'stepper-knob': {
      project: project(
        'Stepper follows a knob',
        SKETCH.stepperKnob,
        [
          ...knob.parts,
          part('drv', 'ic.uln2003a', g(34), g(6)),
          part('motor', 'actuator.stepper-28byj48', g(50), g(20)),
        ],
        wires(
          ...knob.wires,
          ['board.D8', 'drv.in1'],
          ['board.D9', 'drv.in2'],
          ['board.D10', 'drv.in3'],
          ['board.D11', 'drv.in4'],
          ['drv.gnd', 'board.GND1'],
          ['board.5V', 'drv.com'],
          ['drv.out1', 'motor.blue'],
          ['drv.out2', 'motor.pink'],
          ['drv.out3', 'motor.yellow'],
          ['drv.out4', 'motor.orange'],
          ['board.5V', 'motor.red'],
        ),
      ),
      firmware: 'stepperKnob',
    },
    'motor-driver': {
      project: project(
        'Two motors on a TB6612FNG',
        SKETCH.motorDriver,
        [
          part('drv', 'driver.tb6612fng', g(36), g(8)),
          part('motorA', 'actuator.tt-motor', g(62), g(4)),
          part('motorB', 'actuator.tt-motor', g(62), g(14)),
          part('pack', 'power.battery-4aa', g(60), g(24)),
        ],
        wires(
          ['pack.pos', 'drv.vm'],
          ['pack.neg', 'board.GND1'],
          ['board.5V', 'drv.vcc'],
          ['drv.gnd', 'board.GND1'],
          ['board.D7', 'drv.stby'],
          ['board.D5', 'drv.pwma'],
          ['board.D4', 'drv.ain1'],
          ['board.D2', 'drv.ain2'],
          ['board.D6', 'drv.pwmb'],
          ['board.D8', 'drv.bin1'],
          ['board.D9', 'drv.bin2'],
          ['drv.ao1', 'motorA.m1'],
          ['drv.ao2', 'motorA.m2'],
          ['drv.bo1', 'motorB.m1'],
          ['drv.bo2', 'motorB.m2'],
        ),
      ),
      firmware: 'motorDriver',
    },
    // Catalogue Tier A (slice 16c): keypad (Keypad library), encoder + joystick.
    'keypad-lock': {
      project: project(
        'Keypad lock',
        SKETCH.keypadLock,
        [
          part('keys', 'sensor.keypad-4x4', g(42), g(34)),
          part('rl', 'passive.resistor', g(34), g(-4), { props: { ohms: 220 } }),
          part('led', 'actuator.led', g(40), g(-4), { props: { color: 'green' } }),
        ],
        wires(
          ['board.D9', 'keys.r1'],
          ['board.D8', 'keys.r2'],
          ['board.D7', 'keys.r3'],
          ['board.D6', 'keys.r4'],
          ['board.D5', 'keys.c1'],
          ['board.D4', 'keys.c2'],
          ['board.D3', 'keys.c3'],
          ['board.D2', 'keys.c4'],
          ['board.D12', 'rl.a'],
          ['rl.b', 'led.a'],
          ['led.k', 'board.GND1'],
        ),
      ),
      firmware: 'keypadLock',
    },
    'input-devices': {
      project: project(
        'Encoder and joystick',
        SKETCH.inputDevices,
        [part('enc', 'sensor.rotary-encoder', g(36), g(14)), part('joy', 'sensor.joystick', g(50), g(16))],
        wires(
          ['enc.gnd', 'board.GND1'],
          ['board.5V', 'enc.vcc'],
          ['enc.sw', 'board.D4'],
          ['enc.dt', 'board.D3'],
          ['enc.clk', 'board.D2'],
          ['joy.gnd', 'board.GND2'],
          ['board.5V', 'joy.vcc'],
          ['joy.vrx', 'board.A0'],
          ['joy.vry', 'board.A1'],
          ['joy.sw', 'board.D5'],
        ),
      ),
      firmware: 'inputDevices',
    },
    // Catalogue Tier B (P2): reactive parts — a free-running 555, an RC time constant.
    'timer-555': {
      project: project(
        '555 blinker',
        SKETCH.timer555,
        [
          part('timer', 'ic.ne555', g(36), g(10)),
          part('r1', 'passive.resistor', g(30), g(4), { props: { ohms: 1000 } }),
          part('r2', 'passive.resistor', g(38), g(4), { props: { ohms: 68_000 } }),
          part('ct', 'passive.capacitor-electrolytic', g(44), g(16), {
            props: { capacitanceUf: 10, ratedVoltage: 'v16' },
          }),
          part('cc', 'passive.capacitor-ceramic', g(36), g(18), { props: { capacitanceNf: 10 } }),
          part('rl', 'passive.resistor', g(44), g(8), { props: { ohms: 330 } }),
          part('led', 'actuator.led', g(50), g(8), { props: { color: 'red' } }),
        ],
        wires(
          ['board.5V', 'timer.vcc'],
          ['board.5V', 'timer.reset'],
          ['timer.gnd', 'board.GND1'],
          ['board.5V', 'r1.a'],
          ['r1.b', 'timer.dis'],
          ['timer.dis', 'r2.a'],
          ['r2.b', 'timer.thr'],
          ['timer.thr', 'timer.trig'],
          ['timer.thr', 'ct.pos'],
          ['ct.neg', 'board.GND1'],
          ['timer.ctrl', 'cc.a'],
          ['cc.b', 'board.GND1'],
          ['timer.out', 'rl.a'],
          ['rl.b', 'led.a'],
          ['led.k', 'board.GND2'],
          ['timer.out', 'board.D2'],
        ),
      ),
      firmware: 'timer555',
    },
    'rc-charge': {
      project: project(
        'Capacitor charging curve',
        SKETCH.rcCharge,
        [
          part('r', 'passive.resistor', g(32), g(6), { props: { ohms: 10_000 } }),
          part('c', 'passive.capacitor-electrolytic', g(40), g(12), {
            props: { capacitanceUf: 100, ratedVoltage: 'v16' },
          }),
        ],
        wires(['board.D7', 'r.a'], ['r.b', 'c.pos'], ['r.b', 'board.A0'], ['c.neg', 'board.GND1']),
      ),
      firmware: 'rcCharge',
    },
    'transistor-motor': {
      project: project(
        'Motor speed with a TIP120',
        SKETCH.transistorMotor,
        [...transistorMotor(true).parts, ...knob.parts],
        wires(...transistorMotor(true).wires, ...knob.wires),
      ),
      firmware: 'transistorMotor',
    },
    'mosfet-ramp': {
      project: project(
        'MOSFET soft start',
        SKETCH.mosfetRamp,
        [
          part('pack', 'power.battery-4aa', g(58), g(22)),
          part('rg', 'passive.resistor', g(30), g(4), { props: { ohms: 220 } }),
          part('rpd', 'passive.resistor', g(36), g(10), { props: { ohms: 10_000 } }),
          part('q', 'semiconductor.irlz44n', g(40), g(6)),
          part('d', 'semiconductor.diode-1n4007', g(46), g(-2)),
          part('motor', 'actuator.tt-motor', g(54), g(6)),
        ],
        wires(
          ['board.D6', 'rg.a'],
          ['rg.b', 'q.g'],
          ['q.g', 'rpd.a'],
          ['rpd.b', 'board.GND1'],
          ['q.s', 'board.GND1'],
          ['pack.neg', 'board.GND2'],
          ['pack.pos', 'motor.m1'],
          ['motor.m2', 'q.d'],
          ['d.a', 'motor.m2'],
          ['d.k', 'motor.m1'],
        ),
      ),
      firmware: 'mosfetRamp',
    },
    // Catalogue Tier C (P2): I²C displays and sensors on A4/A5.
    'oled-knob': {
      project: project(
        'OLED display',
        SKETCH.oledKnob,
        [...knob.parts, part('oled', 'display.oled-ssd1306', g(44), g(4))],
        wires(...knob.wires, ...i2cWires('oled')),
      ),
      firmware: 'oledKnob',
    },
    'lcd-hello': {
      project: project(
        'Character LCD',
        SKETCH.lcdHello,
        [part('lcd', 'display.lcd1602-i2c', g(40), g(6))],
        wires(...i2cWires('lcd')),
      ),
      firmware: 'lcdHello',
    },
    'imu-tilt': {
      project: project(
        'Tilt sensor (MPU-6050)',
        SKETCH.imuTilt,
        [...blink.parts, part('imu', 'sensor.mpu6050', g(44), g(14))],
        wires(...blink.wires, ...i2cWires('imu', 'vcc', '5V', 'GND2')),
      ),
      firmware: 'imuTilt',
    },
    'weather-station': {
      project: project(
        'Weather station (BMP280)',
        SKETCH.weatherStation,
        [part('bmp', 'sensor.bmp280', g(40), g(8))],
        wires(...i2cWires('bmp', 'vcc', '3V3')),
      ),
      firmware: 'weatherStation',
    },
    // Catalogue Tier C (P2): timed single-wire buses.
    thermometers: {
      project: project(
        'Two thermometers',
        SKETCH.thermometers,
        [
          part('dht', 'sensor.dht11', g(34), g(8)),
          part('ds', 'sensor.ds18b20', g(46), g(8)),
          part('rp', 'passive.resistor', g(46), g(2), { props: { ohms: 4700 } }),
        ],
        wires(
          ['board.5V', 'dht.vcc'],
          ['dht.data', 'board.D2'],
          ['dht.gnd', 'board.GND1'],
          ['board.5V', 'ds.vdd'],
          ['ds.dq', 'board.D4'],
          ['ds.gnd', 'board.GND2'],
          ['board.5V', 'rp.a'],
          ['rp.b', 'ds.dq'],
        ),
      ),
      firmware: 'thermometers',
    },
    'neopixel-rainbow': {
      project: project(
        'NeoPixel rainbow',
        SKETCH.neopixelRainbow,
        [
          ...knob.parts,
          part('rd', 'passive.resistor', g(32), g(4), { props: { ohms: 330 } }),
          part('strip', 'actuator.ws2812-strip', g(40), g(2), { props: { count: 8 } }),
        ],
        wires(
          ...knob.wires,
          ['board.D6', 'rd.a'],
          ['rd.b', 'strip.din'],
          ['board.5V', 'strip.vcc'],
          ['strip.gnd', 'board.GND1'],
        ),
      ),
      firmware: 'neopixelRainbow',
    },
    'led-no-resistor': {
      project: project(
        'LED without resistor',
        SKETCH.blink,
        [part('led', 'actuator.led', g(36), g(4))],
        wires(['board.D13', 'led.a'], ['led.k', 'board.GND1']),
      ),
      firmware: 'blink',
    },
    'outputs-fighting': {
      project: project(
        'Outputs fighting',
        SKETCH.fighting,
        fighting.parts,
        wires(...fighting.wires, ['board.D2', 'board.D3']),
      ),
      firmware: 'fighting',
    },
    'motor-on-pin': {
      project: project(
        'Motor on a pin',
        SKETCH.pinHigh,
        [part('motor', 'actuator.tt-motor', g(44), g(10))],
        wires(['board.D9', 'motor.m1'], ['motor.m2', 'board.GND1']),
      ),
      firmware: 'pinHigh',
    },
    'no-flyback': {
      project: project(
        'Motor without a flyback diode',
        SKETCH.motorPwm,
        transistorMotor(false).parts,
        wires(...transistorMotor(false).wires),
      ),
      firmware: 'motorPwm',
    },
    'floating-input': {
      project: project(
        'Floating input',
        SKETCH.floating,
        [...button.parts, btn],
        wires(...button.wires, ['btn.b1', 'board.D2'], ['btn.a1', 'board.GND2']),
      ),
      firmware: 'floating',
    },
  };
}

let cache: ReturnType<typeof builtins> | null = null;

/** Built-in demo as document + firmware (what an exported input log carries). */
export function builtinSource(id: ScenarioId): { project: ProjectDocument; firmware: FirmwarePayload } {
  cache ??= builtins();
  const b = cache[id];
  return {
    project: clone(b.project),
    firmware: { format: 'ihex', text: FIRMWARE_HEX[b.firmware], sha256: `demo:${b.firmware}` },
  };
}

/** Any run source as document + firmware; only an unmodified built-in keeps its scenario id. */
export function resolveSource(source: RunSource): {
  scenario: ScenarioId | null;
  project: ProjectDocument;
  firmware: FirmwarePayload;
} {
  if ('scenario' in source) return { scenario: source.scenario, ...builtinSource(source.scenario) };
  if ('template' in source) {
    const { project } = builtinSource(source.template);
    return {
      scenario: null,
      project: { ...project, code: { ...project.code, files: source.files.map((f) => ({ ...f })) } },
      firmware: source.firmware,
    };
  }
  return { scenario: null, project: source.project, firmware: source.firmware };
}

/** Validates (and migrates) the document, then loads it; built-ins keep their scenario id. */
export function buildRun(source: RunSource, seed = 1): Scenario {
  const { scenario: id, project, firmware } = resolveSource(source);
  const scenario = loadProject(parseProjectDocument(project), firmware, seed);
  return id ? { ...scenario, scene: { ...scenario.scene, scenario: id } } : scenario;
}

export function buildScenario(id: ScenarioId, seed = 1): Scenario {
  return buildRun({ scenario: id }, seed);
}
