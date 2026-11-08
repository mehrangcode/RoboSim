import { describe, expect, it } from 'vitest';
import { BLACKBOX_LOW_EVERY, BlackBox, POSTMORTEM_LOW_SAMPLES } from './blackbox.js';
import type { PostMortem, PostMortemSeries } from './protocol.js';
import { buildRun } from './scenarios.js';

function recorded(scenario: 'led-no-resistor' | 'outputs-fighting', slices: number, options = {}) {
  const run = buildRun({ scenario });
  const box = new BlackBox(run, options);
  run.circuit.sim.addObserver(box);
  run.circuit.sim.run(slices);
  return { run, box, records: box.drain() };
}

const series = (pm: PostMortem, key: string, interval: 1 | 10): PostMortemSeries => {
  const s = pm.series.find((x) => x.key === key && x.intervalSlices === interval);
  if (!s) throw new Error(`no ${key} @${interval}`);
  return s;
};

describe('BlackBox (FR-SIM-16, TD §18.8)', () => {
  it('led-no-resistor: the 1 kHz window holds ≥ 40 mA for at least the 50 ms sustain', () => {
    const { records } = recorded('led-no-resistor', 1200);
    const pin = records.find((r) => r.record.pins.includes('D13'));
    expect(pin?.record.finding?.ruleId).toBe('SAF-PIN-CURRENT');
    const pm = pin as PostMortem;
    const hi = series(pm, 'mcu:D13:A', 1);
    const over = [...hi.data].filter((a) => Math.abs(a) >= 0.04).length;
    expect(over).toBeGreaterThanOrEqual(50);
    // The window ends on the damage slice and starts no later than the violation.
    expect(hi.startSlice + hi.data.length - 1).toBe(pm.record.slice);
    expect(hi.startSlice).toBeLessThanOrEqual(Math.round(pm.record.conditionSince * 1000) + 1);
    expect(pm.record.slice - pm.record.conditionSince * 1000).toBeGreaterThanOrEqual(50 - 1e-6);
    // Low rate: 100 Hz history of the same pin up to the damage, with a peak per sample.
    const lo = series(pm, 'mcu:D13:V', 10);
    expect(lo.peak).toBeDefined();
    expect(lo.startSlice + lo.data.length * BLACKBOX_LOW_EVERY).toBeLessThanOrEqual(pm.record.slice + 1);
    expect(pm.record.pc).toBeGreaterThan(0);
  });

  it('records the LED part too, with V and A per pin', () => {
    const { records } = recorded('led-no-resistor', 1200);
    const led = records.find((r) => r.record.componentIds.includes('led'));
    expect(led?.record.finding?.ruleId).toBe('SAF-COMPONENT-FAULT');
    const keys = new Set(led?.series.map((s) => s.key));
    expect([...keys].filter((k) => k.startsWith('led:')).length).toBeGreaterThanOrEqual(4);
  });

  it('reports what the code did just before: D13 switched on as the violation began', () => {
    const { records } = recorded('led-no-resistor', 1200);
    const changed = records[0]?.code.changedPins ?? [];
    expect(changed.map((c) => c.pin)).toContain('D13');
    const pm = records[0] as PostMortem;
    const window = (pm.record.simTime - pm.record.conditionSince) * 1000 + 50;
    expect(changed.every((c) => c.msBefore >= 0 && c.msBefore <= window)).toBe(true);
    expect(changed.find((c) => c.pin === 'D13')?.level).toBe(1);
  });

  it('both rings wrap and keep the newest samples', () => {
    // Damage at slice 55: 5 low-rate samples into a ring of 3, ~50 pending slices into a ring of 30.
    const { records } = recorded('led-no-resistor', 200, { lowSamples: 3, highSamples: 30 });
    const pm = records.find((r) => r.record.pins.includes('D13')) as PostMortem;
    const lo = series(pm, 'mcu:D13:A', 10);
    expect(lo.data.length).toBe(3);
    expect(pm.record.slice - (lo.startSlice + 3 * BLACKBOX_LOW_EVERY)).toBeLessThan(BLACKBOX_LOW_EVERY);
    expect(lo.startSlice).toBeGreaterThan(1);
    expect(Math.abs(lo.peak?.at(-1) ?? 0)).toBeGreaterThanOrEqual(0.04);
    const hi = series(pm, 'mcu:D13:A', 1);
    expect(hi.data.length).toBe(30);
    expect(hi.startSlice + 29).toBe(pm.record.slice);
    expect([...hi.data].every((a) => Math.abs(a) >= 0.04)).toBe(true);
  });

  it('outputs fighting: one record naming both pins', () => {
    const { records } = recorded('outputs-fighting', 200);
    expect(records).toHaveLength(1);
    expect(records[0]?.record.pins).toEqual(['D2', 'D3']);
    expect(records[0]?.series.length).toBeGreaterThanOrEqual(4);
  });

  it('caps at 5 s of low-rate history', () => {
    expect(POSTMORTEM_LOW_SAMPLES * BLACKBOX_LOW_EVERY).toBe(5000);
  });

  for (const id of ['led-no-resistor', 'blink', 'line-follower'] as const) {
    it(`${id}: the run is bit-identical with the black box on`, { timeout: 120_000 }, () => {
      const plain = buildRun({ scenario: id });
      const boxed = buildRun({ scenario: id });
      boxed.circuit.sim.addObserver(new BlackBox(boxed));
      const slices = 1500;
      plain.circuit.sim.run(slices);
      boxed.circuit.sim.run(slices);
      expect(boxed.circuit.sim.snapshot()).toEqual(plain.circuit.sim.snapshot());
      expect(boxed.world?.bodies()).toEqual(plain.world?.bodies());
    });
  }
});
