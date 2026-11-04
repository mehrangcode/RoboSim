import { describe, expect, it } from 'vitest';
import { batteryLife, type BatteryLifeInput } from './battery-life.js';

const base: BatteryLifeInput = {
  cells: 4,
  capacityMah: 2000,
  internalOhms: 0,
  charge: 1,
  cutoffV: 0,
  avgMa: 200,
};

/** A flat 1.5 V cell: the life is plain coulomb counting, c·C/I. */
const flat = (): number => 1.5;

describe('batteryLife (TD §18.4)', () => {
  it('equals c·C/I with a constant open-circuit voltage', () => {
    const r = batteryLife({ ...base, charge: 0.8 }, flat);
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.hours).toBeCloseTo((0.8 * 2000) / 200, 9);
    expect(r.minHours).toBeCloseTo(r.hours, 9);
    expect(r.maxHours).toBeCloseTo(r.hours, 9);
  });

  it('gives about 10 h × the usable fraction for 2000 mAh at 200 mA, as a range (US-SIM-11 AC1)', () => {
    const r = batteryLife({ ...base, internalOhms: 0.6, cutoffV: 4, p90Ma: 260, peakMa: 900 });
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.usableFraction).toBeGreaterThan(0.5);
    expect(r.usableFraction).toBeLessThan(1);
    expect(r.hours).toBeCloseTo(10 * r.usableFraction, 6);
    expect(r.minHours).toBeLessThan(r.hours);
    expect(r.maxHours).toBeGreaterThanOrEqual(r.hours);
  });

  it('is monotonic: more current never lasts longer', () => {
    let last = Infinity;
    for (const avgMa of [10, 50, 100, 200, 400, 800, 1500]) {
      const r = batteryLife({ ...base, internalOhms: 0.6, cutoffV: 4.4, avgMa });
      const h = r.kind === 'ok' ? r.hours : 0;
      expect(h).toBeLessThanOrEqual(last);
      last = h;
    }
  });

  it('reports a pack already below its cut-off', () => {
    expect(batteryLife({ ...base, charge: 0.05, cutoffV: 5 }).kind).toBe('belowCutoff');
  });

  it('reports no load instead of an infinite life', () => {
    expect(batteryLife({ ...base, avgMa: 0 }).kind).toBe('noLoad');
  });

  it('solves the cut-off charge by bisection on the real alkaline curve', () => {
    // 4 cells, no load sag: the cut-off of 4.88 V is 1.22 V/cell, which the OCV table puts at 20 % charge.
    const r = batteryLife({ ...base, cutoffV: 4.88 });
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') expect(r.cutoffCharge).toBeCloseTo(0.2, 6);
  });

  it('runs in well under 0.1 ms', () => {
    const input = { ...base, internalOhms: 0.6, cutoffV: 4.4, p90Ma: 260, peakMa: 900 };
    for (let i = 0; i < 200; i++) batteryLife(input); // warm up
    const n = 2000;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) batteryLife(input);
    expect((performance.now() - t0) / n).toBeLessThan(0.1);
  });
});
