import { describe, expect, it } from 'vitest';
import { SafetyMonitor, Simulation, type DamageRecord, type RuntimeRule } from '../src/index.js';
import { Resistor } from './fixtures.js';

/** Error condition on `r1` from 20 ms on, sustained 50 ms, damaging it. */
const overheat: RuntimeRule = {
  id: 'SAF-TEST',
  kind: 'runtime',
  check: ({ simTime }) =>
    simTime >= 0.02 - 1e-9
      ? [
          {
            ruleId: 'SAF-TEST',
            severity: 'error',
            componentIds: ['r1'],
            wireIds: [],
            pinIds: [],
            messageKey: 'safety:SAF-TEST',
            params: {},
            learnMoreSlug: 'saf-test',
            key: 'SAF-TEST:r1',
            sustainS: 0.05,
            damage: { componentIds: ['r1'], reason: 'too hot' },
          },
        ]
      : [],
};

function setup(): { sim: Simulation; monitor: SafetyMonitor } {
  const sim = new Simulation({
    netCount: 1,
    seed: 1,
    components: [{ id: 'r1', model: new Resistor(), pins: { a: 1, b: 0 }, props: { ohms: 100 } }],
  });
  const monitor = new SafetyMonitor(sim, { parts: [], mcuPins: [], netCount: 1 } as never, null, [overheat]);
  sim.addObserver(monitor);
  return { sim, monitor };
}

describe('SafetyMonitor damage records (FR-SIM-16, TD §18.8)', () => {
  it('onDamage fires once with the slice and the time the condition started', () => {
    const { sim, monitor } = setup();
    const records: DamageRecord[] = [];
    monitor.onDamage((r) => records.push(r));
    sim.run(200);
    expect(records).toHaveLength(1);
    const [r] = records as [DamageRecord];
    expect(r.conditionKey).toBe('SAF-TEST:r1');
    expect(r.conditionSince).toBeCloseTo(0.02, 9);
    expect(r.slice).toBe(70);
    expect(r.simTime).toBeCloseTo(0.07, 9);
    expect(r.componentIds).toEqual(['r1']);
    expect(r.reason).toBe('too hot');
    expect(r.finding?.ruleId).toBe('SAF-TEST');
    expect(r.pc).toBeNull(); // no MCU
  });

  it('pending() lists the condition while its sustain window runs, then not after the latch', () => {
    const { sim, monitor } = setup();
    sim.run(30);
    expect(monitor.pending()).toEqual([
      {
        key: 'SAF-TEST:r1',
        severity: 'error',
        componentIds: ['r1'],
        pins: [],
        since: expect.closeTo(0.02, 9),
      },
    ]);
    sim.run(50);
    expect(monitor.pending()).toEqual([]);
  });

  it('an unsubscribed listener is not called', () => {
    const { sim, monitor } = setup();
    let calls = 0;
    const off = monitor.onDamage(() => calls++);
    off();
    sim.run(200);
    expect(calls).toBe(0);
  });
});
