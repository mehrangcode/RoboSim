import { findDefinition } from '@robosim/catalog';
import { chassisGeometry, type Chassis2wdProps } from '@robosim/component-chassis-2wd';
import { ovalArena, ovalChallenge } from '@robosim/content';
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
import type { FirmwareId } from './firmware/sources.js';
import { loadProject, type Scenario } from './project-loader.js';
import type { FirmwarePayload, RunSource, ScenarioId } from './protocol.js';

export { findingView, loadProject, ProjectLoadError, UNO_BOARD, type Scenario } from './project-loader.js';

/*
 * The Lab's built-in demos as project documents (Technical Design §8.10), exactly what the editor
 * will save. Each ships the Arduino sketch its pre-assembled firmware stands for; the build service
 * will compile the sketch instead.
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
  extra: Pick<ProjectDocument, 'arena' | 'successConditions'> = {},
): ProjectDocument {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    board: { id: 'avr-uno', version: '1.0.0' },
    components,
    wires: wiring,
    code: { language: 'cpp', files: [{ name: 'sketch.ino', content: sketch.trim() + '\n' }] },
    libraries: [],
    ...extra,
    meta: { title },
  };
}

/** Uno D13 → 220 Ω → LED → GND. */
const ledOn = (pin: string, color: string, gnd = 'GND1') => ({
  parts: [
    part('r1', 'passive.resistor', 120, 40, { props: { ohms: 220 } }),
    part('led', 'actuator.led', 200, 40, { props: { color } }),
  ],
  wires: [
    [`board.${pin}`, 'r1.a'],
    ['r1.b', 'led.a'],
    ['led.k', `board.${gnd}`],
  ] as const,
});

const knob = {
  parts: [part('pot', 'passive.potentiometer', 120, 160)],
  wires: [
    ['board.5V', 'pot.a'],
    ['pot.wiper', 'board.A0'],
    ['pot.b', 'board.GND2'],
  ] as const,
};

const SKETCH = {
  blink: `
void setup() { pinMode(13, OUTPUT); }
void loop() { digitalWrite(13, !digitalRead(13)); delay(500); }`,
  button: `
void setup() { pinMode(2, INPUT_PULLUP); pinMode(13, OUTPUT); }
void loop() { digitalWrite(13, !digitalRead(2)); }`,
  dimmer: `
void setup() { pinMode(6, OUTPUT); }
void loop() { analogWrite(6, analogRead(A0) / 4); }`,
  servo: `
#include <Servo.h>
Servo servo;
void setup() { servo.attach(9); }
void loop() { servo.writeMicroseconds(500 + 2 * analogRead(A0)); }`,
  serial: `
void setup() { Serial.begin(115200); Serial.println("RoboSim ready"); pinMode(13, OUTPUT); }
int n = 0;
unsigned long last = 0;
void loop() {
  if (millis() - last >= 1000) { last = millis(); Serial.print("tick "); Serial.println(n++ % 10); }
  if (Serial.available()) { Serial.write(toupper(Serial.read())); digitalWrite(13, !digitalRead(13)); }
}`,
  fighting: `
void setup() { pinMode(2, OUTPUT); pinMode(3, OUTPUT); digitalWrite(2, HIGH); digitalWrite(3, LOW); }
void loop() {}`,
  pinHigh: `
void setup() { pinMode(9, OUTPUT); digitalWrite(9, HIGH); }
void loop() {}`,
  floating: `
void setup() { pinMode(2, INPUT); pinMode(13, OUTPUT); }
void loop() { digitalWrite(13, !digitalRead(2)); }`,
  lineFollower: `
// L/C/R line sensor on D2/D3/D4 (HIGH = black); L298N ENA/ENB on D5/D6, IN1 D7, IN3 D9.
void setup() {
  for (int p = 5; p <= 9; p++) pinMode(p, OUTPUT);
  analogWrite(5, 150); analogWrite(6, 150);
}
void loop() {
  if (digitalRead(2)) { digitalWrite(7, LOW); digitalWrite(9, HIGH); }        // line on the left: turn left
  else if (digitalRead(4)) { digitalWrite(7, HIGH); digitalWrite(9, LOW); }   // on the right: turn right
  else if (digitalRead(3)) { digitalWrite(7, HIGH); digitalWrite(9, HIGH); }  // centred: straight
}`,
} as const satisfies Partial<Record<FirmwareId, string>>;

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
      part('chassis', 'mechanical.chassis-2wd', 400, 300),
      part('bat', 'power.battery-4aa', 60, 60, { mount: { ...deck, x: deck.x - 30 } }),
      part('sw', 'power.switch', 60, 160, { inputs: { on: true } }),
      part('drv', 'driver.l298n', 200, 120, {
        props: { enaJumper: false, enbJumper: false, regulatorJumper: false },
        mount: deck,
      }),
      part('motorL', 'actuator.tt-motor', 340, 60, { mount: slot('motor-left') }),
      part('motorR', 'actuator.tt-motor', 340, 180, { mount: slot('motor-right') }),
      part('line', 'sensor.line-3ch', 200, 260, { props: { spacingMm: 12 }, mount: slot('front-bracket') }),
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
    },
  );
}

function builtins(): Record<ScenarioId, { project: ProjectDocument; firmware: FirmwareId }> {
  const blink = ledOn('D13', 'red');
  const button = ledOn('D13', 'green');
  const btn = part('btn', 'sensor.push-button', 120, 160);
  const dimmer = ledOn('D6', 'yellow', 'GND1');
  const fighting = ledOn('D2', 'green');
  return {
    'line-follower': { project: lineFollower(), firmware: 'lineFollower' },
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
          part('servo', 'actuator.sg90-servo', 220, 60),
          part('pack', 'power.battery-4aa', 320, 160),
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
    'led-no-resistor': {
      project: project(
        'LED without resistor',
        SKETCH.blink,
        [part('led', 'actuator.led', 160, 40)],
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
        [part('motor', 'actuator.tt-motor', 160, 60)],
        wires(['board.D9', 'motor.m1'], ['motor.m2', 'board.GND1']),
      ),
      firmware: 'pinHigh',
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

/** Validates (and migrates) the document, then loads it; built-ins keep their scenario id. */
export function buildRun(source: RunSource, seed = 1): Scenario {
  const { project, firmware } = 'scenario' in source ? builtinSource(source.scenario) : source;
  const scenario = loadProject(parseProjectDocument(project), firmware, seed);
  return 'scenario' in source
    ? { ...scenario, scene: { ...scenario.scene, scenario: source.scenario } }
    : scenario;
}

export function buildScenario(id: ScenarioId, seed = 1): Scenario {
  return buildRun({ scenario: id }, seed);
}
