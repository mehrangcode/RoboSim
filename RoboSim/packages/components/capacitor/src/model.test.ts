import { validateManifest } from '@robosim/sim-core';
import { bench, dcSupply, fixedResistor } from '@robosim/test-fixtures';
import { describe, expect, it } from 'vitest';
import {
  ceramicCapacitor,
  definitions,
  electrolyticCapacitor,
  electrolyticEsr,
  type CapacitorState,
} from './index.js';

/** Supply → R → capacitor (first pin) → ground, or reversed. */
function rig(
  def: (typeof definitions)[number],
  props: Record<string, number | string>,
  volts: number,
  ohms: number,
  reversed = false,
) {
  const [p, n] = def === electrolyticCapacitor ? ['pos', 'neg'] : ['a', 'b'];
  return bench({
    parts: {
      src: { def: dcSupply, props: { volts, ohms: 0 } },
      r: { def: fixedResistor, props: { ohms } },
      c: { def, props },
    },
    wires: [
      ['src.pos', 'r.a'],
      ['r.b', `c.${reversed ? n : p}`],
    ],
    ground: ['src.neg', `c.${reversed ? p : n}`],
  });
}

describe('capacitors', () => {
  it('have valid manifests', () => {
    for (const d of definitions) expect(validateManifest(d.manifest)).toEqual([]);
  });

  it('charge through a resistor with τ = RC (100 µF, 1 kΩ: 63 % after 100 ms)', () => {
    const b = rig(electrolyticCapacitor, { capacitanceUf: 100 }, 5, 1000);
    b.run(0.1);
    // ESR (2.1 Ω) and leakage barely move it.
    expect(b.state<CapacitorState>('c').volts).toBeCloseTo(5 * (1 - Math.exp(-1)), 1);
    b.run(0.9);
    expect(b.state<CapacitorState>('c').volts).toBeCloseTo(5, 1);
  });

  it('derive ESR from the dissipation factor and leak about 0.002·C·V µA once charged', () => {
    expect(electrolyticEsr(100e-6, 16)).toBeCloseTo(0.16 / (2 * Math.PI * 120 * 100e-6), 6);
    const b = rig(electrolyticCapacitor, { capacitanceUf: 100, ratedVoltage: 'v16' }, 16, 100);
    b.run(1);
    expect(b.state<CapacitorState>('c').currentMa * 1000).toBeCloseTo(0.002 * 100 * 16, 0); // µA
    expect(b.run(0.01).faults).toEqual([]);
  });

  it('a ceramic follows a fast edge within a microsecond-scale time constant', () => {
    const b = rig(ceramicCapacitor, { capacitanceNf: 10 }, 5, 1000); // τ = 10 µs
    b.run(0.002); // components read the slice average: the first millisecond averages 4.95 V
    expect(b.state<CapacitorState>('c').volts).toBeCloseTo(5, 3);
  });

  it('an electrolytic above its surge rating reports over-voltage', () => {
    const ok = rig(electrolyticCapacitor, { capacitanceUf: 10, ratedVoltage: 'v16' }, 16, 10);
    expect(ok.run(0.05).faults).toEqual([]);
    const over = rig(electrolyticCapacitor, { capacitanceUf: 10, ratedVoltage: 'v16' }, 24, 10);
    expect(over.run(0.05).faults.map((f) => f.code)).toEqual(['OVER_VOLTAGE']);
  });

  it('a reversed electrolytic conducts, reports reverse voltage, and vents open once damaged', () => {
    const b = rig(electrolyticCapacitor, { capacitanceUf: 100 }, 5, 47, true);
    const snap = b.run(0.05);
    const s = b.state<CapacitorState>('c');
    expect(s.volts).toBeLessThan(-1);
    expect(-s.currentMa).toBeGreaterThan(30); // (5 − ~1.2 V) / (47 + 5 Ω)
    expect(snap.faults.map((f) => f.code)).toEqual(['REVERSE_VOLTAGE']);
    b.sim.damageComponent('c', 'REVERSE_VOLTAGE');
    b.run(0.01);
    expect(b.state<CapacitorState>('c')).toMatchObject({ currentMa: 0, damaged: true });
  });

  it('is open in a DC-only (static analysis) solve', () => {
    const b = rig(ceramicCapacitor, { capacitanceNf: 100 }, 5, 1000);
    expect(b.sim.transient).toBe(false);
    b.run(0.001);
    expect(b.sim.transient).toBe(true);
  });
});
