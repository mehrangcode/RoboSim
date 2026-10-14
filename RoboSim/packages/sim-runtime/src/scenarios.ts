import { UNO_ELECTRICAL, avrUno } from '@robosim/board-avr-uno';
import { findDefinition } from '@robosim/catalog';
import { chassisGeometry, type Chassis2wdProps } from '@robosim/component-chassis-2wd';
import { ovalArena, ovalChallenge } from '@robosim/content';
import { RUNTIME_RULES, STATIC_RULES } from '@robosim/safety-rules';
import {
  ChallengeTracker,
  PlanckWorld,
  SafetyMonitor,
  analyzeCircuit,
  resolveProps,
  type BoardInfo,
  type Finding,
  type FirmwareImage,
  type RobotSpec,
} from '@robosim/sim-core';
import { unoFiveVolt } from './board-rail.js';
import { buildCircuit, type Circuit, type CircuitSpec } from './circuit.js';
import { FIRMWARE_HEX } from './firmware/generated.js';
import type { FirmwareId } from './firmware/sources.js';
import type {
  ArenaScene,
  BenchScenarioId,
  FindingView,
  PartInfo,
  RobotScene,
  SafetyScenarioId,
  ScenarioId,
  SceneInfo,
} from './protocol.js';

export interface Scenario {
  readonly circuit: Circuit;
  readonly world: PlanckWorld | null;
  readonly scene: SceneInfo;
  /** Runtime safety: latched findings + damage model, observing every slice. */
  readonly safety: SafetyMonitor;
  /** Arena challenge (FR-ARN-11), when the scenario has one. */
  readonly challenge?: ChallengeTracker;
}

export const UNO_BOARD: BoardInfo = {
  pins: avrUno.pins,
  electrical: UNO_ELECTRICAL,
  packageMaxCurrentMa: avrUno.power.mcuPackageMaxCurrentMa,
};

export function findingView(f: Finding): FindingView {
  return {
    ruleId: f.ruleId,
    severity: f.severity,
    kind: f.kind,
    componentIds: f.componentIds,
    pinIds: f.pinIds,
    messageKey: f.messageKey,
    params: f.params,
  };
}

/** Static analysis before running + runtime monitor attached to the simulation (Technical Design §5.6). */
function withSafety(
  base: Omit<Scenario, 'safety' | 'scene'> & { scene: Omit<SceneInfo, 'staticFindings'> },
): Scenario {
  const staticFindings = analyzeCircuit(base.circuit.assembled, STATIC_RULES, UNO_BOARD).map(findingView);
  const safety = new SafetyMonitor(base.circuit.sim, base.circuit.assembled, UNO_BOARD, RUNTIME_RULES);
  base.circuit.sim.addObserver(safety);
  return { ...base, safety, scene: { ...base.scene, staticFindings } };
}

function firmware(id: FirmwareId): FirmwareImage {
  const hex = FIRMWARE_HEX[id];
  return { format: 'ihex', bytes: Uint8Array.from(hex, (c) => c.charCodeAt(0)), sha256: `demo:${id}` };
}

const def = findDefinition;
const LINE_SPACING_MM = 12;

function partInfos(spec: CircuitSpec): PartInfo[] {
  return Object.entries(spec.parts)
    .filter(([, p]) => p.def !== unoFiveVolt)
    .map(([id, p]) => ({ id, type: p.def.manifest.id, inputs: p.def.manifest.inputs }));
}

function bench(id: BenchScenarioId | SafetyScenarioId, seed: number): Scenario {
  const firmwareFor: Record<BenchScenarioId | SafetyScenarioId, FirmwareId> = {
    blink: 'blink',
    button: 'button',
    dimmer: 'dimmer',
    servo: 'servo',
    'led-no-resistor': 'blink',
    'outputs-fighting': 'fighting',
    'motor-on-pin': 'pinHigh',
    'floating-input': 'floating',
  };
  const core = avrUno.createCore(firmware(firmwareFor[id]));
  const led = (pin: string, color = 'red') => ({
    parts: {
      r1: { def: def('passive.resistor'), props: { ohms: 220 } },
      led: { def: def('actuator.led'), props: { color } },
    },
    wires: [
      [`mcu.${pin}`, 'r1.a'],
      ['r1.b', 'led.a'],
    ] as const,
    ground: ['led.k'],
  });
  const pot = {
    parts: { pot: { def: def('passive.potentiometer') }, rail: { def: unoFiveVolt } },
    wires: [
      ['rail.pos', 'pot.a'],
      ['pot.wiper', 'mcu.A0'],
    ] as const,
    ground: ['pot.b', 'rail.neg'],
  };
  let spec: CircuitSpec;
  switch (id) {
    case 'blink': {
      const l = led('D13');
      spec = {
        parts: l.parts,
        wires: [...l.wires],
        ground: l.ground,
        mcu: { core, electrical: UNO_ELECTRICAL, pins: ['D13'] },
      };
      break;
    }
    case 'button': {
      const l = led('D13', 'green');
      spec = {
        parts: { ...l.parts, btn: { def: def('sensor.push-button') } },
        wires: [...l.wires, ['btn.b1', 'mcu.D2']],
        ground: [...l.ground, 'btn.a1'],
        mcu: { core, electrical: UNO_ELECTRICAL, pins: ['D2', 'D13'] },
      };
      break;
    }
    case 'dimmer': {
      const l = led('D6', 'yellow');
      spec = {
        parts: { ...pot.parts, ...l.parts },
        wires: [...pot.wires, ...l.wires],
        ground: [...pot.ground, ...l.ground],
        mcu: { core, electrical: UNO_ELECTRICAL, pins: ['A0', 'D6'] },
      };
      break;
    }
    case 'servo':
      // A stalled SG90 draws up to 650 mA — more than the Uno's 5 V pin (500 mA) can give
      // (SAF-SUPPLY-OVERLOAD), so the servo gets its own 4×AA pack with a common ground.
      spec = {
        parts: {
          ...pot.parts,
          servo: { def: def('actuator.sg90-servo') },
          pack: { def: def('power.battery-4aa') },
        },
        wires: [...pot.wires, ['mcu.D9', 'servo.signal'], ['pack.pos', 'servo.vcc']],
        ground: [...pot.ground, 'servo.gnd', 'pack.neg'],
        mcu: { core, electrical: UNO_ELECTRICAL, pins: ['A0', 'D9'] },
      };
      break;
    case 'led-no-resistor':
      spec = {
        parts: { led: { def: def('actuator.led') } },
        wires: [['mcu.D13', 'led.a']],
        ground: ['led.k'],
        mcu: { core, electrical: UNO_ELECTRICAL, pins: ['D13'] },
      };
      break;
    case 'outputs-fighting': {
      const l = led('D2', 'green');
      spec = {
        parts: l.parts,
        wires: [...l.wires, ['mcu.D2', 'mcu.D3']],
        ground: l.ground,
        mcu: { core, electrical: UNO_ELECTRICAL, pins: ['D2', 'D3'] },
      };
      break;
    }
    case 'motor-on-pin':
      spec = {
        parts: { motor: { def: def('actuator.tt-motor') } },
        wires: [['mcu.D9', 'motor.m1']],
        ground: ['motor.m2'],
        mcu: { core, electrical: UNO_ELECTRICAL, pins: ['D9'] },
      };
      break;
    case 'floating-input': {
      const l = led('D13', 'green');
      spec = {
        parts: { ...l.parts, btn: { def: def('sensor.push-button') } },
        wires: [...l.wires, ['btn.b1', 'mcu.D2']],
        ground: [...l.ground, 'btn.a1'],
        mcu: { core, electrical: UNO_ELECTRICAL, pins: ['D2', 'D13'] },
      };
      break;
    }
  }
  return withSafety({
    circuit: buildCircuit({ ...spec, seed }),
    world: null,
    scene: { scenario: id, kind: 'bench', parts: partInfos(spec), pins: spec.mcu.pins },
  });
}

/** Display raster at 2 mm/px: a quarter of the memory of the 1 mm physics raster. */
function displayFloor(world: PlanckWorld): ArenaScene['floor'] {
  const src = world.floor;
  const widthPx = Math.ceil(src.widthPx / 2);
  const heightPx = Math.ceil(src.heightPx / 2);
  const data = new Uint8Array(widthPx * heightPx);
  for (let y = 0; y < heightPx; y++) {
    for (let x = 0; x < widthPx; x++) data[y * widthPx + x] = src.data[2 * y * src.widthPx + 2 * x] ?? 255;
  }
  return { widthPx, heightPx, data };
}

function lineFollower(seed: number): Scenario {
  const chassis = def('mechanical.chassis-2wd');
  const geometry = chassisGeometry(resolveProps(chassis.manifest) as unknown as Chassis2wdProps);
  const front = geometry.mountSlots.find((s) => s.id === 'front-bracket');
  const mass = (id: string) => def(id).manifest.massG / 1000;
  const robot: RobotSpec = {
    id: 'robot',
    geometry,
    payloadKg:
      mass('power.battery-4aa') +
      2 * mass('actuator.tt-motor') +
      mass('driver.l298n') +
      mass('sensor.line-3ch') +
      0.025,
    mounts: { line: { xMm: front?.xMm ?? 65, yMm: 0, heightMm: front?.heightMm ?? 5 } },
    drives: { left: 'motorL', right: 'motorR' },
    start: ovalArena.start,
  };
  const world = new PlanckWorld(ovalArena, [robot]);
  const pins = ['D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10'];
  const spec: CircuitSpec = {
    parts: {
      bat: { def: def('power.battery-4aa') },
      sw: { def: def('power.switch') },
      drv: {
        def: def('driver.l298n'),
        props: { enaJumper: false, enbJumper: false, regulatorJumper: false },
      },
      motorL: { def: def('actuator.tt-motor') },
      motorR: { def: def('actuator.tt-motor') },
      line: { def: def('sensor.line-3ch'), props: { spacingMm: LINE_SPACING_MM } },
      rail: { def: unoFiveVolt },
    },
    wires: [
      ['bat.pos', 'sw.a'],
      ['sw.b', 'drv.vs'],
      ['rail.pos', 'drv.v5'],
      ['rail.pos', 'line.vcc'],
      ['mcu.D5', 'drv.ena'],
      ['mcu.D6', 'drv.enb'],
      ['mcu.D7', 'drv.in1'],
      ['mcu.D8', 'drv.in2'],
      ['mcu.D9', 'drv.in3'],
      ['mcu.D10', 'drv.in4'],
      ['drv.out1', 'motorL.m1'],
      ['drv.out2', 'motorL.m2'],
      ['drv.out3', 'motorR.m1'],
      ['drv.out4', 'motorR.m2'],
      ['line.left', 'mcu.D2'],
      ['line.center', 'mcu.D3'],
      ['line.right', 'mcu.D4'],
    ],
    ground: ['bat.neg', 'drv.gnd', 'rail.neg', 'line.gnd'],
    mcu: { core: avrUno.createCore(firmware('lineFollower')), electrical: UNO_ELECTRICAL, pins },
    world,
    seed,
  };
  const circuit = buildCircuit(spec);
  circuit.sim.input('sw', 'on', true);
  const challenge = new ChallengeTracker(circuit.sim, world, ovalArena, ovalChallenge);
  circuit.sim.addObserver(challenge);
  const robotScene: RobotScene = {
    footprint: geometry.footprint,
    wheels: geometry.wheels.map((w) => ({ x: w.position.x, y: w.position.y, radiusM: w.radiusM })),
    caster: geometry.caster,
  };
  return withSafety({
    circuit,
    world,
    challenge,
    scene: {
      scenario: 'line-follower',
      kind: 'arena',
      parts: partInfos(spec),
      pins,
      arena: {
        widthM: ovalArena.widthM,
        heightM: ovalArena.heightM,
        floor: displayFloor(world),
        zones: (ovalArena.zones ?? []).map((z) => ({
          id: z.id,
          kind: z.kind,
          x: z.center.x,
          y: z.center.y,
          radiusM: z.radiusM,
        })),
      },
      robot: robotScene,
    },
  });
}

export function buildScenario(id: ScenarioId, seed = 1): Scenario {
  return id === 'line-follower' ? lineFollower(seed) : bench(id, seed);
}

export { LINE_SPACING_MM };
