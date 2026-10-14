import { validateManifest } from '@robosim/sim-core';
import { bench, dcSupply } from '@robosim/test-fixtures';
import { describe, expect, it } from 'vitest';
import { definition as resistor, manifest, type ResistorState } from './index.js';

describe('passive.resistor', () => {
  it('has a valid manifest', () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it('obeys Ohm’s law', () => {
    const b = bench({
      parts: { src: { def: dcSupply, props: { volts: 5 } }, r: { def: resistor, props: { ohms: 1000 } } },
      wires: [['src.pos', 'r.a']],
      ground: ['src.neg', 'r.b'],
    });
    b.run(0.002);
    const v = b.volts('src.pos');
    expect(b.state<ResistorState>('r').currentMa).toBeCloseTo(v, 6); // V / 1 kΩ in mA
  });

  it('reports OVER_POWER beyond its rating', () => {
    const b = bench({
      parts: {
        src: { def: dcSupply, props: { volts: 9 } },
        r: { def: resistor, props: { ohms: 100, powerRatingMw: 250 } },
      },
      wires: [['src.pos', 'r.a']],
      ground: ['src.neg', 'r.b'],
    });
    const snap = b.run(0.002); // ~9 V² / 100 Ω ≈ 0.8 W
    expect(snap.faults.map((f) => f.code)).toEqual(['OVER_POWER']);
  });
});
