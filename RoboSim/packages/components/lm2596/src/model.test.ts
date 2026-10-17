import { validateManifest } from '@robosim/sim-core';
import { bench, dcSupply, fixedResistor } from '@robosim/test-fixtures';
import { describe, expect, it } from 'vitest';
import { definition, manifest, type Lm2596State } from './index.js';

function rig(vin: number, loadOhms: number, outputV = 5, sourceOhms = 0) {
  return bench({
    parts: {
      src: { def: dcSupply, props: { volts: vin, ohms: sourceOhms } },
      buck: { def: definition, props: { outputV } },
      load: { def: fixedResistor, props: { ohms: loadOhms } },
    },
    wires: [
      ['src.pos', 'buck.in+'],
      ['buck.out+', 'load.a'],
    ],
    // Only IN− is grounded: OUT− reaches ground through the module's shared ground plane.
    ground: ['src.neg', 'buck.in-', 'load.b'],
  });
}

describe('power.lm2596', () => {
  it('has a valid manifest', () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it('steps 12 V down to 5 V at 1 A and draws less input current than it delivers', () => {
    const b = rig(12, 5);
    b.run(0.02);
    const s = b.state<Lm2596State>('buck');
    expect(s.vout).toBeCloseTo(5, 1);
    expect(s.outputMa).toBeCloseTo(1000, -1);
    expect(s.inputMa).toBeLessThan(550);
    expect(s.efficiency).toBeGreaterThan(0.8);
    expect(s.efficiency).toBeLessThan(0.9);
  });

  it('holds its output while a battery with internal resistance sags', () => {
    const b = rig(9, 10, 5, 2);
    b.run(0.05);
    expect(b.state<Lm2596State>('buck').vout).toBeCloseTo(5, 1);
    expect(b.volts('buck.in+')).toBeLessThan(9);
  });

  it('drops out near Vin − 1.5 V and locks out below 4.5 V', () => {
    const d = rig(6, 100, 5);
    d.run(0.02);
    expect(d.state<Lm2596State>('buck')).toMatchObject({ dropout: true });
    expect(d.state<Lm2596State>('buck').vout).toBeCloseTo(4.5, 1);
    const u = rig(4, 100, 3.3);
    u.run(0.02);
    expect(u.state<Lm2596State>('buck')).toMatchObject({ undervoltage: true, vout: 0 });
  });

  it('current-limits a short instead of failing', () => {
    const b = rig(12, 0.05);
    const snap = b.run(0.1);
    const s = b.state<Lm2596State>('buck');
    expect(s.currentLimited).toBe(true);
    expect(s.outputMa).toBeCloseTo(3600, -2);
    expect(snap.faults).toEqual([]);
  });
});
