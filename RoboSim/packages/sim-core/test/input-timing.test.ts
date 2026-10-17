import { describe, expect, it } from 'vitest';
import { Simulation, type ComponentIO, type ComponentModel, type NetId, type PinEdge } from '../src/index.js';
import { FakeCore, Resistor, UNO_ELECTRICAL, out } from './fixtures.js';

const CLOCK = 16_000_000;

/** Records the MCU edges it sees on its `in` net every slice. */
class EdgeProbe implements ComponentModel<null, null> {
  readonly type = 'test.edge-probe';
  private net: NetId = 0;
  seen: PinEdge[] = [];
  init(ctx: { net(pin: string): NetId }): void {
    this.net = ctx.net('in');
  }
  stamp(): void {}
  step(_dt: number, io: ComponentIO): void {
    this.seen.push(...io.edges(this.net));
  }
  faults() {
    return [];
  }
  snapshot(): null {
    return null;
  }
}

describe('MCU input timing', () => {
  /** 5 V ─ 10 kΩ ─ D2 ─ 10 kΩ ─ GND (a divider) when `divider`; otherwise D2 only has its pull-up. */
  function sim(core: FakeCore, divider: boolean): Simulation {
    return new Simulation({
      netCount: 2,
      seed: 1,
      mcu: {
        core,
        pins: [
          { pin: 'D2', net: 1 },
          { pin: 'D13', net: 2 },
        ],
        electrical: UNO_ELECTRICAL,
      },
      components: divider
        ? [
            { id: 'top', model: new Resistor(), pins: { a: 2, b: 1 }, props: { ohms: 10_000 } },
            { id: 'bot', model: new Resistor(), pins: { a: 1, b: 0 }, props: { ohms: 10_000 } },
          ]
        : [],
    });
  }

  it('solves at power-on, so the first instructions already read real input voltages', () => {
    const seen: number[] = [];
    const core = new FakeCore(CLOCK, (_cycle, inputs) => {
      seen.push(inputs.get('D2')?.volts ?? NaN);
      return new Map([['D13', out(1)]]);
    });
    // D13 is not an output before the first run: the divider top floats, so D2 reads ≈ 0 V at power-on.
    const s = sim(core, true);
    s.step();
    expect(seen[0]).toBeCloseTo(0, 6); // solved (not unset) before the first instruction
    s.step();
    expect(seen[1]).toBeCloseTo(2.5 * (1 - 25 / 20_025), 2);
  });

  it('a fresh INPUT_PULLUP reads HIGH at the cycle it was enabled, not at the end of the slice', () => {
    const core = new FakeCore(CLOCK, () => new Map());
    const s = sim(core, false);
    s.step();
    core.inputs.length = 0;
    core.emitMode('D2', 'input_pullup', 1234);
    expect(core.inputs).toEqual([
      { pin: 'D2', drive: { level: 1, volts: expect.closeTo(5, 3) }, atCycle: 1234 },
    ]);
  });

  it('edges pass through a series resistor marked as signal passthrough, never through ground', () => {
    let core: FakeCore | null = null;
    core = new FakeCore(CLOCK, (cycle) => {
      core?.emitEdge('D13', 1, cycle - 100);
      return new Map([['D13', out(1)]]);
    });
    const behind = new EdgeProbe();
    const grounded = new EdgeProbe();
    const s = new Simulation({
      netCount: 3,
      seed: 1,
      mcu: { core, pins: [{ pin: 'D13', net: 1 }], electrical: UNO_ELECTRICAL },
      components: [
        {
          id: 'r',
          model: new Resistor(),
          pins: { a: 1, b: 2 },
          props: { ohms: 100 },
          signalPassthrough: [['a', 'b']],
        },
        {
          id: 'pd',
          model: new Resistor(),
          pins: { a: 3, b: 0 },
          props: { ohms: 100 },
          signalPassthrough: [['a', 'b']],
        },
        { id: 'probe', model: behind, pins: { in: 2 }, props: null },
        { id: 'probe0', model: grounded, pins: { in: 3 }, props: null },
      ],
    });
    s.run(3);
    expect(behind.seen).toHaveLength(3);
    expect(grounded.seen).toEqual([]);
  });
});
