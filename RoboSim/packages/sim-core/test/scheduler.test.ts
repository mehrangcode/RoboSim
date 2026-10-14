import { describe, expect, it } from 'vitest';
import {
  Pacer,
  PHYS_DT_S,
  Simulation,
  type ComponentInstance,
  type SimulationSnapshot,
} from '../src/index.js';
import {
  Button,
  CountingWorld,
  FakeCore,
  Led,
  NoisySensor,
  Resistor,
  UNO_ELECTRICAL,
  out,
} from './fixtures.js';

const CLOCK = 16_000_000;

/** D13 → 220 Ω → LED → GND, the classic blink circuit. Nets: 1 = D13, 2 = LED anode. */
function blinkCircuit(core: FakeCore, extra: ComponentInstance[] = [], netCount = 2): Simulation {
  return new Simulation({
    netCount,
    seed: 1,
    mcu: {
      core,
      pins: [{ pin: 'D13', net: 1 }, ...(netCount > 2 ? [{ pin: 'D2', net: 3 }] : [])],
      electrical: UNO_ELECTRICAL,
    },
    components: [
      { id: 'r1', model: new Resistor(), pins: { a: 1, b: 2 }, props: { ohms: 220 } },
      { id: 'led1', model: new Led(), pins: { a: 2, k: 0 }, props: { vf: 2, rs: 10 } },
      ...extra,
    ],
  });
}

const ledState = (s: SimulationSnapshot) =>
  s.components.find((c) => c.id === 'led1')?.state as { currentMa: number; lit: boolean };

describe('Simulation scheduler', () => {
  it('blinks an LED from MCU output with Ohm-correct current', () => {
    const core = new FakeCore(
      CLOCK,
      (cycle) => new Map([['D13', out(Math.floor(cycle / (CLOCK / 2)) % 2 === 0 ? 0 : 1)]]),
    );
    const sim = blinkCircuit(core);
    const pinCurrents: number[] = [];
    sim.addObserver({ afterSlice: (ctx) => pinCurrents.push(ctx.bus?.pinCurrent(ctx.solution, 'D13') ?? 0) });

    sim.run(400);
    expect(ledState(sim.snapshot()).lit).toBe(false);
    sim.run(200); // t = 600 ms: pin high
    const expected = 3 / (25 + 220 + 10); // (Vcc − Vf) / (Rout + R + Rs)
    expect(ledState(sim.snapshot()).currentMa).toBeCloseTo(expected * 1000, 6);
    expect(pinCurrents.at(-1)).toBeCloseTo(expected, 9);
    sim.run(500); // t = 1.1 s: low again
    expect(ledState(sim.snapshot()).lit).toBe(false);
    expect(sim.snapshot().cycle).toBe(1100 * 16_000);
  });

  it('closes the loop: button with INPUT_PULLUP drives an LED through the MCU', () => {
    // Sketch: pinMode(2, INPUT_PULLUP); digitalWrite(13, !digitalRead(2));
    const core = new FakeCore(CLOCK, (_cycle, inputs) => {
      const pressed = (inputs.get('D2')?.level ?? 1) === 0;
      return new Map([
        ['D2', { mode: 'input_pullup', level: 0 }],
        ['D13', out(pressed ? 1 : 0)],
      ]);
    });
    const button = new Button();
    const sim = blinkCircuit(core, [{ id: 'btn', model: button, pins: { a: 3, b: 0 }, props: null }], 3);

    sim.run(10);
    expect(ledState(sim.snapshot()).lit).toBe(false);
    expect(sim.currentSolution.voltage(3)).toBeCloseTo(5, 3); // pulled up

    button.press(true);
    sim.run(2); // input seen at end of slice 1, sketch reacts in slice 2
    expect(sim.currentSolution.voltage(3)).toBeLessThan(0.01);
    sim.run(1);
    expect(ledState(sim.snapshot()).lit).toBe(true);

    button.press(false);
    sim.run(3);
    expect(ledState(sim.snapshot()).lit).toBe(false);
  });

  it('averages PWM phases so a dimmed LED carries duty × on-current (not 0 below Vf)', () => {
    const pwm = (duty: number) => ({
      mode: 'output' as const,
      level: 1 as const,
      pwm: { dutyRatio: duty, freqHz: 976.5625 },
    });
    let duty = 0.25;
    const core = new FakeCore(CLOCK, () => new Map([['D13', pwm(duty)]]));
    const sim = blinkCircuit(core);
    const onCurrentMa = (3 / (25 + 220 + 10)) * 1000;

    sim.run(5);
    expect(ledState(sim.snapshot()).currentMa).toBeCloseTo(0.25 * onCurrentMa, 6);
    expect(sim.currentSolution.voltage(1)).toBeCloseTo(0.25 * (5 - (25 * onCurrentMa) / 1000), 6); // average pin voltage

    duty = 0.75;
    sim.run(2);
    expect(ledState(sim.snapshot()).currentMa).toBeCloseTo(0.75 * onCurrentMa, 6);
  });

  it('keeps independent PWM channels independent', () => {
    const core = new FakeCore(
      CLOCK,
      () =>
        new Map([
          ['D13', { mode: 'output', level: 0, pwm: { dutyRatio: 0.2, freqHz: 490 } }],
          ['D2', { mode: 'output', level: 0, pwm: { dutyRatio: 0.9, freqHz: 490 } }],
        ]),
    );
    const sim = blinkCircuit(
      core,
      [
        { id: 'r2', model: new Resistor(), pins: { a: 3, b: 4 }, props: { ohms: 220 } },
        { id: 'led2', model: new Led(), pins: { a: 4, k: 0 }, props: { vf: 2, rs: 10 } },
      ],
      4,
    );
    sim.run(3);
    const on = (3 / 255) * 1000;
    const led2 = sim.snapshot().components.find((c) => c.id === 'led2')?.state as { currentMa: number };
    expect(ledState(sim.snapshot()).currentMa).toBeCloseTo(0.2 * on, 6);
    expect(led2.currentMa).toBeCloseTo(0.9 * on, 6);
  });

  it('applies VIL/VIH hysteresis and reports analog voltage', () => {
    const core = new FakeCore(CLOCK, () => new Map());
    const sim = new Simulation({
      netCount: 1,
      seed: 3,
      mcu: { core, pins: [{ pin: 'A0', net: 1 }], electrical: UNO_ELECTRICAL },
      components: [
        { id: 'sens', model: new NoisySensor(), pins: { out: 1 }, props: { volts: 2.25, noise: 0.5 } },
      ],
    });
    sim.run(50);
    const drives = core.inputs.filter((i) => i.pin === 'A0');
    expect(drives.length).toBeGreaterThan(0);
    for (const d of drives) {
      expect(d.drive.level).toBe(0); // 2.0–2.5 V sits between VIL and VIH: level is held
      expect(d.drive.volts).toBeGreaterThan(1.9);
      expect(d.drive.volts).toBeLessThan(2.6);
    }
  });

  it('steps physics every second slice', () => {
    const world = new CountingWorld();
    const sim = new Simulation({ netCount: 0, seed: 1, components: [], world });
    sim.run(101);
    expect(world.steps).toHaveLength(50);
    expect(world.steps.every((dt) => dt === PHYS_DT_S)).toBe(true);
    expect(sim.snapshot().bodies[0]?.position.x).toBe(50);
    expect(sim.simTime).toBe(0.101);
  });

  it('routes user input to the component and re-solves in the next slice', () => {
    const core = new FakeCore(CLOCK, () => new Map([['D2', { mode: 'input_pullup', level: 0 }]]));
    const sim = blinkCircuit(
      core,
      [{ id: 'btn', model: new Button(), pins: { a: 3, b: 0 }, props: null }],
      3,
    );
    sim.run(2);
    expect(sim.currentSolution.voltage(3)).toBeCloseTo(5, 3);
    sim.input('btn', 'pressed', true);
    sim.run(1);
    expect(sim.currentSolution.voltage(3)).toBeLessThan(0.01);
    expect(() => sim.input('nope', 'pressed', true)).toThrow(/Unknown component/);
    expect(() => sim.input('r1', 'x', 1)).toThrow(/accepts no input/);
  });

  it('exposes MCU edges of the current slice per net, in seconds', () => {
    let core: FakeCore | null = null;
    core = new FakeCore(CLOCK, (cycle) => {
      if (cycle === 16_000) {
        core?.emitEdge('D13', 1, 4_000); // 0.25 ms
        core?.emitEdge('D13', 0, 28_000); // pretend a 1.5 ms pulse
      }
      return new Map([['D13', out(0)]]);
    });
    const seen: number[][] = [];
    const probe = {
      type: 'test.probe',
      init: () => undefined,
      stamp: () => undefined,
      step: (_dt: number, io: { edges: (n: number) => readonly { level: number; time: number }[] }) =>
        seen.push(io.edges(1).map((e) => e.time)),
      faults: () => [],
      snapshot: () => null,
    };
    const sim = blinkCircuit(core, [{ id: 'probe', model: probe, pins: {}, props: null }]);
    sim.run(2);
    expect(seen[0]).toEqual([0.00025, 0.00175]);
    expect(seen[1]).toEqual([]); // cleared every slice
  });

  it('rejects duplicate ids and unknown pins', () => {
    const make = () => ({ id: 'r', model: new Resistor(), pins: { a: 0, b: 0 }, props: { ohms: 1 } });
    expect(() => new Simulation({ netCount: 0, seed: 1, components: [make(), make()] })).toThrow(/Duplicate/);
    expect(
      () => new Simulation({ netCount: 0, seed: 1, components: [{ ...make(), pins: { a: 0 } }] }),
    ).toThrow(/no pin 'b'/);
  });
});

describe('determinism', () => {
  function noisyRun(seed: number, extraSensor = false): SimulationSnapshot[] {
    const world = new CountingWorld();
    const components: ComponentInstance[] = [
      { id: 's1', model: new NoisySensor(), pins: { out: 1 }, props: { volts: 2.5, noise: 0.2 } },
      ...(extraSensor
        ? [{ id: 's0', model: new NoisySensor(), pins: { out: 3 }, props: { volts: 1, noise: 0.2 } }]
        : []),
      { id: 'r', model: new Resistor(), pins: { a: 1, b: 2 }, props: { ohms: 1000 } },
      { id: 'led1', model: new Led(), pins: { a: 2, k: 0 }, props: { vf: 1.8, rs: 10 } },
    ];
    const sim = new Simulation({ netCount: 3, seed, components, world });
    const out: SimulationSnapshot[] = [];
    for (let i = 0; i < 20; i++) {
      sim.run(100);
      out.push(sim.snapshot());
    }
    return out;
  }

  it('same seed and inputs → identical snapshot stream', () => {
    expect(noisyRun(42)).toEqual(noisyRun(42));
  });

  it('different seed → different stream', () => {
    expect(noisyRun(42)).not.toEqual(noisyRun(43));
  });

  it("adding a component does not change another component's random stream", () => {
    const sensor = (run: SimulationSnapshot[]) =>
      run.map((s) => s.components.find((c) => c.id === 's1')?.state);
    expect(sensor(noisyRun(42, true))).toEqual(sensor(noisyRun(42)));
  });
});

describe('Pacer', () => {
  it('runs one slice per wall millisecond at speed 1 and scales with speed', () => {
    let wall = 0;
    const sim = new Simulation({ netCount: 0, seed: 1, components: [] });
    const pacer = new Pacer(sim, { now: () => wall });
    pacer.start();
    wall = 16;
    expect(pacer.tick()).toMatchObject({ slicesRun: 16, behind: false, realTimeFactor: 1 });
    pacer.setSpeed(0.5);
    wall = 36;
    expect(pacer.tick().slicesRun).toBe(10);
    expect(sim.slice).toBe(26);
  });

  it('slows down instead of dropping slices when over budget', () => {
    let wall = 0;
    const sim = new Simulation({ netCount: 0, seed: 1, components: [] });
    const pacer = new Pacer(sim, { now: () => wall, budgetMs: 12 });
    pacer.start();
    wall = 100;
    const original = sim.step.bind(sim);
    sim.step = () => {
      original();
      wall += 1; // each slice costs 1 ms wall → only ~12 fit
    };
    const r = pacer.tick();
    expect(r.behind).toBe(true);
    expect(r.slicesRun).toBe(12);
    // Rebased: the next tick does not try to catch up the 88 missed milliseconds.
    wall += 5;
    expect(pacer.tick().slicesRun).toBeLessThanOrEqual(5);
  });

  it('does nothing while paused', () => {
    let wall = 0;
    const sim = new Simulation({ netCount: 0, seed: 1, components: [] });
    const pacer = new Pacer(sim, { now: () => wall });
    pacer.start();
    pacer.pause();
    wall = 50;
    expect(pacer.tick().slicesRun).toBe(0);
  });
});
