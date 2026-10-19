import { describe, expect, it } from 'vitest';
import {
  Simulation,
  type ComponentIO,
  type ComponentModel,
  type Level,
  type MnaStamper,
  type ModelContext,
  type NetId,
  type PinOutput,
  type ReactiveState,
  type SourceHandle,
} from '../src/index.js';
import { FakeCore, Resistor, UNO_ELECTRICAL } from './fixtures.js';

const CLOCK = 16_000_000;

class Supply implements ComponentModel<{ volts: number }, null> {
  readonly type = 'test.supply';
  private pos: NetId = 0;
  private volts = 0;
  init(ctx: ModelContext, props: { volts: number }): void {
    this.pos = ctx.net('pos');
    this.volts = props.volts;
  }
  stamp(s: MnaStamper): void {
    s.voltageSource(this.pos, 0, this.volts, 0.01);
  }
  step(): void {}
  faults(): [] {
    return [];
  }
  snapshot(): null {
    return null;
  }
}

class Cap implements ComponentModel<{ farads: number; esr?: number }, ReactiveState> {
  readonly type = 'test.capacitor';
  private a: NetId = 0;
  private b: NetId = 0;
  private farads = 1e-6;
  private esr = 0;
  readonly state: ReactiveState = { volts: 0, amps: 0 };
  init(ctx: ModelContext, props: { farads: number; esr?: number }): void {
    this.a = ctx.net('a');
    this.b = ctx.net('b');
    this.farads = props.farads;
    this.esr = props.esr ?? 0;
  }
  stamp(s: MnaStamper): void {
    s.capacitor(this.a, this.b, this.farads, this.state, { esr: this.esr });
  }
  step(): void {}
  faults(): [] {
    return [];
  }
  snapshot(): ReactiveState {
    return { ...this.state };
  }
}

class Coil implements ComponentModel<{ henries: number; ohms: number }, ReactiveState> {
  readonly type = 'test.inductor';
  private a: NetId = 0;
  private b: NetId = 0;
  private props = { henries: 1e-3, ohms: 1 };
  handle = 0 as SourceHandle;
  readonly state: ReactiveState = { volts: 0, amps: 0 };
  averageAmps = 0;
  init(ctx: ModelContext, props: { henries: number; ohms: number }): void {
    this.a = ctx.net('a');
    this.b = ctx.net('b');
    this.props = props;
  }
  stamp(s: MnaStamper): void {
    this.handle = s.inductor(this.a, this.b, this.props.henries, this.state, {
      seriesResistance: this.props.ohms,
    });
  }
  step(_dt: number, io: ComponentIO): void {
    this.averageAmps = -io.solution.sourceCurrent(this.handle);
  }
  faults(): [] {
    return [];
  }
  snapshot(): ReactiveState {
    return { ...this.state };
  }
}

/** 5 V ─ R ─ net 2 ─ C ─ GND. */
function rc(ohms: number, farads: number, dcOnly = false): { sim: Simulation; cap: Cap } {
  const cap = new Cap();
  const sim = new Simulation({
    netCount: 2,
    seed: 1,
    dcOnly,
    components: [
      { id: 'src', model: new Supply(), pins: { pos: 1 }, props: { volts: 5 } },
      { id: 'r', model: new Resistor(), pins: { a: 1, b: 2 }, props: { ohms } },
      { id: 'c', model: cap, pins: { a: 2, b: 0 }, props: { farads } },
    ],
  });
  return { sim, cap };
}

/** MCU stand-in toggling D9 every `halfPeriodS`, reporting each edge at its exact cycle. */
function squareWave(halfPeriodS: number): FakeCore {
  let last = 0;
  const halfCycles = Math.round(halfPeriodS * CLOCK);
  const core: FakeCore = new FakeCore(CLOCK, (cycle) => {
    for (let c = (Math.floor(last / halfCycles) + 1) * halfCycles; c <= cycle; c += halfCycles)
      core.emitEdge('D9', (Math.round(c / halfCycles) % 2 === 1 ? 1 : 0) as Level, c);
    last = cycle;
    const level: Level = Math.floor(cycle / halfCycles) % 2 === 1 ? 1 : 0;
    return new Map<string, PinOutput>([['D9', { mode: 'output', level }]]);
  });
  return core;
}

describe('transient integration (reactive elements)', () => {
  it('charges an RC to 63 % after one time constant and settles at the supply', () => {
    const { sim, cap } = rc(1000, 100e-6); // τ = 100 ms
    expect(sim.transient).toBe(false); // not stamped yet
    sim.run(100);
    expect(sim.transient).toBe(true);
    expect(cap.state.volts).toBeCloseTo(5 * (1 - Math.exp(-1)), 1);
    expect(Math.abs(cap.state.volts / (5 * (1 - Math.exp(-1))) - 1)).toBeLessThan(0.01);
    sim.run(900);
    expect(cap.state.volts).toBeCloseTo(5, 2);
    expect(cap.state.amps).toBeLessThan(1e-6);
  });

  it('follows a fast RC within one slice (τ = 10 µs) and reports the slice average to components', () => {
    const { sim, cap } = rc(100, 100e-9);
    sim.run(1);
    expect(cap.state.volts).toBeCloseTo(5, 3);
  });

  it('treats capacitors as open in a DC-only simulation (static analysis)', () => {
    const { sim, cap } = rc(1000, 100e-6, true);
    sim.run(1);
    expect(sim.transient).toBe(false);
    expect(sim.currentSolution.voltage(2)).toBeCloseTo(5, 6);
    expect(cap.state.volts).toBe(0);
  });

  it('builds up inductor current with τ = L/R', () => {
    const coil = new Coil();
    const sim = new Simulation({
      netCount: 1,
      seed: 1,
      components: [
        { id: 'src', model: new Supply(), pins: { pos: 1 }, props: { volts: 5 } },
        { id: 'l', model: coil, pins: { a: 1, b: 0 }, props: { henries: 10e-3, ohms: 10 } },
      ],
    });
    sim.run(1); // τ = 1 ms (plus the 10 mΩ supply)
    expect(coil.state.amps).toBeCloseTo(0.5 * (1 - Math.exp(-1)), 2);
    sim.run(20);
    expect(coil.state.amps).toBeCloseTo(0.5, 3);
  });

  it('integrates a PWM-like square wave edge by edge: the RC ripples between its analytic bounds', () => {
    // D9 (25 Ω driver) ─ 975 Ω ─ net 2 ─ 100 nF ─ GND: τ = 100 µs, square wave with 200 µs halves.
    const core = squareWave(200e-6);
    const cap = new Cap();
    const sim = new Simulation({
      netCount: 2,
      seed: 1,
      mcu: { core, pins: [{ pin: 'D9', net: 1 }], electrical: UNO_ELECTRICAL },
      components: [
        {
          id: 'r',
          model: new Resistor(),
          pins: { a: 1, b: 2 },
          props: { ohms: 975 },
          signalPassthrough: [['a', 'b']],
        },
        { id: 'c', model: cap, pins: { a: 2, b: 0 }, props: { farads: 100e-9 } },
      ],
    });
    sim.run(20);
    const vmax = (5 * (1 - Math.exp(-2))) / (1 - Math.exp(-4));
    const env = sim.netEnvelope(2);
    expect(env.max).toBeCloseTo(vmax, 1);
    expect(env.min).toBeCloseTo(5 - vmax, 1);
    // Components see the mean of the waveform, like PWM averaging.
    expect(sim.currentSolution.voltage(2)).toBeCloseTo(2.5, 0);
  });

  it('is deterministic', () => {
    const a = rc(470, 22e-6);
    const b = rc(470, 22e-6);
    a.sim.run(37);
    b.sim.run(37);
    expect(a.cap.state).toEqual(b.cap.state);
  });

  it('keeps purely resistive circuits on the DC path', () => {
    const sim = new Simulation({
      netCount: 1,
      seed: 1,
      components: [
        { id: 'src', model: new Supply(), pins: { pos: 1 }, props: { volts: 5 } },
        { id: 'r', model: new Resistor(), pins: { a: 1, b: 0 }, props: { ohms: 100 } },
      ],
    });
    sim.run(3);
    expect(sim.transient).toBe(false);
    expect(sim.netEnvelope(1)).toEqual({
      min: sim.currentSolution.voltage(1),
      max: sim.currentSolution.voltage(1),
    });
  });
});
