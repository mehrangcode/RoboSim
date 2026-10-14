import { UNO_ELECTRICAL, avrUno } from '@robosim/board-avr-uno';
import { chassisGeometry, type Chassis2wdProps } from '@robosim/component-chassis-2wd';
import type { Line3chState } from '@robosim/component-line-3ch';
import { ovalArena, ovalChallenge } from '@robosim/content';
import {
  ChallengeTracker,
  PlanckWorld,
  resolveProps,
  type ChallengeResult,
  type RobotSpec,
} from '@robosim/sim-core';
import { bench, dcSupply, firmware } from '@robosim/test-fixtures';
import { describe, expect, it } from 'vitest';
import { findDefinition } from './index.js';

/**
 * Bang-bang line follower in AVR assembly (what the starter sketch compiles to, minus Arduino core):
 * sensors HIGH on black — left sees the line → stop left wheel; right sees it → stop right wheel;
 * centre → both forward; line lost → keep the last command. ENA/ENB = timer0 PWM at OCR = duty.
 */
function followerFirmware(duty: number) {
  return firmware(`
      ldi r16, 0xE0
      out 0x0a, r16        ; DDRD: D5, D6 (PWM), D7 (IN1) outputs; D2–D4 sensor inputs
      ldi r16, 0x07
      out 0x04, r16        ; DDRB: D8 (IN2), D9 (IN3), D10 (IN4) outputs, all low
      ldi r16, ${duty}
      out 0x27, r16        ; OCR0A → ENB (D6)
      out 0x28, r16        ; OCR0B → ENA (D5)
      ldi r16, 0xA3
      out 0x24, r16        ; TCCR0A: COM0A1 | COM0B1 | fast PWM
      ldi r16, 0x03
      out 0x25, r16        ; TCCR0B: /64
    loop:
      sbic 0x09, 2         ; left sensor on black?
      rjmp left
      sbic 0x09, 4         ; right sensor on black?
      rjmp right
      sbic 0x09, 3         ; centre on black?
      rjmp straight
      rjmp loop            ; lost: keep going as before
    straight:
      sbi 0x0b, 7
      sbi 0x05, 1
      rjmp loop
    left:
      cbi 0x0b, 7          ; left wheel off
      sbi 0x05, 1
      rjmp loop
    right:
      sbi 0x0b, 7
      cbi 0x05, 1          ; right wheel off
      rjmp loop
  `);
}

const chassis = findDefinition('mechanical.chassis-2wd');
const geometry = chassisGeometry(resolveProps(chassis.manifest) as unknown as Chassis2wdProps);
const mass = (id: string) => findDefinition(id).manifest.massG / 1000;
const UNO_MASS_KG = 0.025;

function starterRobot(duty: number) {
  const front = geometry.mountSlots.find((s) => s.id === 'front-bracket');
  const robot: RobotSpec = {
    id: 'robot',
    geometry,
    payloadKg:
      mass('power.battery-4aa') +
      2 * mass('actuator.tt-motor') +
      mass('driver.l298n') +
      mass('sensor.line-3ch') +
      UNO_MASS_KG,
    mounts: { line: { xMm: front?.xMm ?? 65, yMm: 0, heightMm: front?.heightMm ?? 5 } },
    drives: { left: 'motorL', right: 'motorR' },
    start: ovalArena.start,
  };
  const world = new PlanckWorld(ovalArena, [robot]);
  const b = bench({
    parts: {
      bat: { def: findDefinition('power.battery-4aa') },
      sw: { def: findDefinition('power.switch') },
      drv: {
        def: findDefinition('driver.l298n'),
        props: { enaJumper: false, enbJumper: false, regulatorJumper: false },
      },
      motorL: { def: findDefinition('actuator.tt-motor') },
      motorR: { def: findDefinition('actuator.tt-motor') },
      line: { def: findDefinition('sensor.line-3ch') },
      uno5v: { def: dcSupply, props: { volts: 5, ohms: 0.1 } }, // Uno 5 V pin until board power is modelled
    },
    wires: [
      ['bat.pos', 'sw.a'],
      ['sw.b', 'drv.vs'],
      ['uno5v.pos', 'drv.v5'],
      ['uno5v.pos', 'line.vcc'],
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
    ground: ['bat.neg', 'drv.gnd', 'uno5v.neg', 'line.gnd'],
    mcu: {
      core: avrUno.createCore(followerFirmware(duty)),
      electrical: UNO_ELECTRICAL,
      pins: ['D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10'],
    },
    world,
  });
  return { b, world };
}

interface LapResult {
  readonly completed: boolean;
  readonly lapTimeS: number | null;
  readonly visited: readonly string[];
  readonly maxOffLineS: number;
}

/** Drives until the robot passes every checkpoint in order and re-enters the start zone. */
function runLap(duty: number, limitS = 40): LapResult {
  const { b, world } = starterRobot(duty);
  b.input('sw', 'on', true);
  const zones = ovalArena.zones ?? [];
  const order = zones.filter((z) => z.kind === 'checkpoint').map((z) => z.id);
  const start = zones.find((z) => z.kind === 'start');
  const visited: string[] = [];
  let offLine = 0;
  let maxOffLine = 0;
  for (let t = 0; t < limitS; t += 0.01) {
    b.run(0.01);
    const pose = world.bodies()[0];
    if (!pose) break;
    const next = zones.find((z) => z.id === order[visited.length]);
    const inside = (z: { center: { x: number; y: number }; radiusM: number }) =>
      Math.hypot(pose.position.x - z.center.x, pose.position.y - z.center.y) < z.radiusM;
    if (next && inside(next)) visited.push(next.id);
    if (visited.length === order.length && start && inside(start)) {
      return {
        completed: true,
        lapTimeS: Math.round((t + 0.01) * 100) / 100,
        visited,
        maxOffLineS: maxOffLine,
      };
    }
    const s = b.state<Line3chState>('line').outputs;
    offLine = s.left + s.center + s.right === 0 ? offLine + 0.01 : 0;
    maxOffLine = Math.max(maxOffLine, offLine);
  }
  return { completed: false, lapTimeS: null, visited, maxOffLineS: maxOffLine };
}

/** Runs the oval's default challenge headless, like the grader (unpaced, stop on decision). */
function runChallenge(duty: number, maxSimSeconds = 70): ChallengeResult {
  const { b, world } = starterRobot(duty);
  let decided: ChallengeResult | null = null;
  const tracker = new ChallengeTracker(b.sim, world, ovalArena, ovalChallenge, {
    maxSimSeconds,
    onDecided: (r) => (decided = r),
  });
  b.sim.addObserver(tracker);
  b.input('sw', 'on', true);
  for (let t = 0; t < maxSimSeconds && !decided; t += 0.1) b.run(0.1);
  return decided ?? tracker.result();
}

describe('oval challenge (US-ARN-08, FR-ARN-11)', () => {
  it(
    'the starter robot passes "1 lap < 60 s, no collisions, on line ≥ 85 %" with a score',
    { timeout: 120_000 },
    () => {
      const r = runChallenge(150);
      expect(r.status).toBe('success');
      expect(r.decidedAt).toBeGreaterThan(5);
      expect(r.decidedAt).toBeLessThan(30);
      expect(r.metrics).toMatchObject({
        lapsDone: 1,
        collisions: 0,
        checkpointsPassed: 3,
        checkpointsTotal: 3,
      });
      expect(r.metrics.onLineRatio).toBeGreaterThan(0.85);
      expect(r.score?.max).toBe(100);
      expect(r.score?.total).toBeGreaterThan(95); // full laps + full time bonus (< 45 s) + on-line share
    },
  );

  it('a robot that never moves fails at the time limit', { timeout: 120_000 }, () => {
    const r = runChallenge(0);
    expect(r.status).toBe('failure');
    expect(r.decidedAt).toBeCloseTo(60.01, 1);
    expect(r.score?.total).toBeCloseTo(15, 0); // only the on-line share: it never left the line
  });

  it('the result is identical run to run (grader determinism)', { timeout: 120_000 }, () => {
    expect(runChallenge(150)).toEqual(runChallenge(150));
  });
});

describe('starter line-follower on the oval (Release Plan P1 exit criterion, physics part)', () => {
  it('completes a lap through every checkpoint in order', { timeout: 120_000 }, () => {
    const lap = runLap(150);
    expect(lap.visited).toEqual(['cp-right', 'cp-top', 'cp-left']);
    expect(lap.completed).toBe(true);
    expect(lap.lapTimeS).toBeGreaterThan(5);
    expect(lap.lapTimeS).toBeLessThan(30);
    expect(lap.maxOffLineS).toBeLessThan(0.5); // never loses the line for long
  });

  it('is deterministic: the same lap, to the hundredth of a second', { timeout: 120_000 }, () => {
    expect(runLap(150)).toEqual(runLap(150));
  });
});
