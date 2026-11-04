import { describe, expect, it } from 'vitest';
import {
  GMIN,
  Simulation,
  currentInto,
  type ComponentModel,
  type MnaStamper,
  type ModelContext,
  type NetId,
  type ReactiveState,
} from '../src/index.js';
import { FakeCore, Led, Resistor, UNO_ELECTRICAL } from './fixtures.js';

const CLOCK = 16_000_000;

/** Ideal battery between '+' and '−' with a small internal resistance. */
class Battery implements ComponentModel<{ volts: number; r: number }, null> {
  readonly type = 'power.battery';
  private pos: NetId = 0;
  private neg: NetId = 0;
  private props = { volts: 5, r: 1e-3 };
  init(ctx: ModelContext, props: { volts: number; r: number }): void {
    this.pos = ctx.net('+');
    this.neg = ctx.net('-');
    this.props = props;
  }
  stamp(s: MnaStamper): void {
    s.voltageSource(this.pos, this.neg, this.props.volts, this.props.r);
  }
  step(): void {}
  faults(): [] {
    return [];
  }
  snapshot(): null {
    return null;
  }
}

class Capacitor implements ComponentModel<{ farads: number }, null> {
  readonly type = 'passive.capacitor';
  private a: NetId = 0;
  private b: NetId = 0;
  private farads = 1e-6;
  private readonly state: ReactiveState = { volts: 0, amps: 0 };
  init(ctx: ModelContext, props: { farads: number }): void {
    this.a = ctx.net('a');
    this.b = ctx.net('b');
    this.farads = props.farads;
  }
  stamp(s: MnaStamper): void {
    s.capacitor(this.a, this.b, this.farads, this.state);
  }
  step(): void {}
  faults(): [] {
    return [];
  }
  snapshot(): null {
    return null;
  }
}

/** Battery 5 V → 220 Ω → LED (Vf 2 V) → GND. Nets: 1 = +5 V, 2 = LED anode. */
function ledCircuit(): Simulation {
  return new Simulation({
    netCount: 2,
    seed: 1,
    components: [
      { id: 'bat', model: new Battery(), pins: { '+': 1, '-': 0 }, props: { volts: 5, r: 1e-3 } },
      { id: 'r1', model: new Resistor(), pins: { a: 1, b: 2 }, props: { ohms: 220 } },
      { id: 'led1', model: new Led(), pins: { a: 2, k: 0 }, props: { vf: 2, rs: 1e-3 } },
    ],
  });
}

describe('Simulation measurements (FR-SIM-13, ADR-026)', () => {
  it('5 V, 220 Ω and an LED give 13.6 mA ±1 % into the resistor', () => {
    const sim = ledCircuit();
    sim.run(5);
    const i = sim.pinCurrent({ componentId: 'r1', pin: 'a' });
    expect(i).toBeGreaterThan(0.0136 * 0.99);
    expect(i).toBeLessThan(0.0136 * 1.01);
    expect(sim.pinCurrent({ componentId: 'r1', pin: 'b' })).toBeCloseTo(-i, 12);
    expect(sim.pinCurrent({ componentId: 'led1', pin: 'a' })).toBeCloseTo(i, 9);
    expect(() => sim.pinCurrent({ componentId: 'nope', pin: 'a' })).toThrow(/Unknown component/);
    expect(() => sim.pinCurrent({ componentId: 'r1', pin: 'zz' })).toThrow(/no pin/);
  });

  it('battery partPower is < 0 and the loads absorb what it delivers', () => {
    const sim = ledCircuit();
    sim.run(5);
    const bat = sim.partPower('bat');
    expect(bat).toBeLessThan(0);
    expect(bat + sim.partPower('r1') + sim.partPower('led1')).toBeCloseTo(0, 9);
  });

  it('every net obeys KCL over all owners', () => {
    const sim = ledCircuit();
    sim.run(3);
    const { ledger } = sim;
    for (let net = 1; net <= ledger.netCount; net++) {
      let sum = GMIN * sim.currentSolution.voltage(net);
      for (const o of ledger.ownerIds()) sum += currentInto(ledger.elementsOf(o), net, sim.currentSolution);
      expect(Math.abs(sum)).toBeLessThan(1e-9);
    }
  });

  it('a 50 % PWM LED: phase-averaged power differs from V̄·Ī; MCU pin current is signed', () => {
    const core = new FakeCore(
      CLOCK,
      () => new Map([['D5', { mode: 'output', level: 1, pwm: { dutyRatio: 0.5, freqHz: 980 } } as const]]),
    );
    const sim = new Simulation({
      netCount: 2,
      seed: 1,
      mcu: { core, pins: [{ pin: 'D5', net: 1 }], electrical: UNO_ELECTRICAL },
      components: [
        { id: 'r1', model: new Resistor(), pins: { a: 1, b: 2 }, props: { ohms: 220 } },
        { id: 'led1', model: new Led(), pins: { a: 2, k: 0 }, props: { vf: 2, rs: 10 } },
      ],
    });
    sim.run(5);
    const s = sim.currentSolution;
    const vBar = s.voltage(1) - s.voltage(2);
    const iBar = sim.pinCurrent({ componentId: 'r1', pin: 'a' });
    const p = sim.partPower('r1');
    const iOn = 3 / (25 + 220 + 10);
    expect(iBar).toBeCloseTo(0.5 * iOn, 9);
    expect(p).toBeCloseTo(0.5 * iOn * iOn * 220, 9);
    expect(Math.abs(p - vBar * iBar)).toBeGreaterThan(1e-4);
    expect(sim.mcuPinCurrentIn('D5')).toBeCloseTo(-0.5 * iOn, 9); // sourcing
    expect(sim.mcuPinCurrentIn('D9')).toBe(0);
  });

  it('transient: watched power is integrated per sub-step (avg I²R ≥ R·Ī²)', () => {
    const build = () =>
      new Simulation({
        netCount: 2,
        seed: 1,
        components: [
          { id: 'bat', model: new Battery(), pins: { '+': 1, '-': 0 }, props: { volts: 5, r: 1e-3 } },
          { id: 'r1', model: new Resistor(), pins: { a: 1, b: 2 }, props: { ohms: 1000 } },
          { id: 'c1', model: new Capacitor(), pins: { a: 2, b: 0 }, props: { farads: 1e-7 } },
        ],
      });
    const watched = build();
    watched.watchPower(['r1', 'unknown']);
    const plain = build();
    watched.run(1);
    plain.run(1);
    // View-only: the operating point is bit-identical with or without the watch.
    expect(watched.currentSolution.voltage(2)).toBe(plain.currentSolution.voltage(2));
    const iBar = watched.pinCurrent({ componentId: 'r1', pin: 'a' });
    const p = watched.partPower('r1');
    expect(p).toBeGreaterThan(iBar * iBar * 1000);
    // τ = 0.1 ms ≪ 1 ms slice: the charge energy dissipated in R is ½·C·V² over the slice.
    expect(p * 1e-3).toBeCloseTo(0.5 * 1e-7 * 25, 7);
  });

  it('mcuPower closes the energy balance with the MCU pins (TD §18.4)', () => {
    const core = new FakeCore(
      CLOCK,
      () => new Map([['D5', { mode: 'output', level: 1, pwm: { dutyRatio: 0.5, freqHz: 980 } } as const]]),
    );
    const sim = new Simulation({
      netCount: 2,
      seed: 1,
      mcu: { core, pins: [{ pin: 'D5', net: 1 }], electrical: UNO_ELECTRICAL },
      components: [
        { id: 'r1', model: new Resistor(), pins: { a: 1, b: 2 }, props: { ohms: 220 } },
        { id: 'led1', model: new Led(), pins: { a: 2, k: 0 }, props: { vf: 2, rs: 10 } },
      ],
    });
    sim.run(5);
    const mcu = sim.mcuPower();
    expect(mcu).toBeLessThan(0); // the pin delivers
    expect(mcu + sim.partPower('r1') + sim.partPower('led1')).toBeCloseTo(0, 9);
    expect(ledCircuit().mcuPower()).toBe(0); // no MCU
  });
});
