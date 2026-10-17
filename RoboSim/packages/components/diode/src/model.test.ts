import { validateManifest } from '@robosim/sim-core';
import { bench, dcSupply, fixedResistor } from '@robosim/test-fixtures';
import { describe, expect, it } from 'vitest';
import { definitions, diode1n4007, diode1n4148, zener5v1, type DiodeState } from './index.js';

/** Supply → R → diode (anode first unless reversed) → ground. */
function rig(def: (typeof definitions)[number], volts: number, ohms: number, reversed = false) {
  return bench({
    parts: {
      src: { def: dcSupply, props: { volts, ohms: 0 } },
      r: { def: fixedResistor, props: { ohms } },
      d: { def },
    },
    wires: [['src.pos', 'r.a'], reversed ? ['r.b', 'd.k'] : ['r.b', 'd.a']],
    ground: ['src.neg', reversed ? 'd.a' : 'd.k'],
  });
}

describe('diodes', () => {
  it('have valid manifests', () => {
    for (const d of definitions) expect(validateManifest(d.manifest)).toEqual([]);
  });

  it('1N4007 drops ≈ 0.93 V at 1 A and ≈ 0.65 V at 10 mA', () => {
    const big = rig(diode1n4007, 10.93, 10);
    big.run(0.002);
    expect(big.state<DiodeState>('d').volts).toBeCloseTo(0.93, 2);
    const small = rig(diode1n4007, 5, 435);
    small.run(0.002);
    expect(small.state<DiodeState>('d').volts).toBeCloseTo(0.653, 2);
  });

  it('1N4148 blocks in reverse with no fault below its PIV', () => {
    const b = rig(diode1n4148, 12, 1000, true);
    const snap = b.run(0.002);
    expect(Math.abs(b.state<DiodeState>('d').currentMa)).toBeLessThan(0.001);
    expect(snap.faults).toEqual([]);
  });

  it('1N4148 is over-current at 5 V straight across it', () => {
    expect(
      rig(diode1n4148, 5, 0.1)
        .run(0.002)
        .faults.map((f) => f.code),
    ).toEqual(['OVER_CURRENT']);
  });

  it('Zener regulates ≈ 5.1 V at its test current and conducts forward like a diode', () => {
    // 9 V − 5.1 V across 80 Ω ≈ 49 mA (Izt).
    const z = rig(zener5v1, 9, 80, true);
    z.run(0.002);
    const s = z.state<DiodeState>('d');
    expect(-s.volts).toBeCloseTo(5.1, 1);
    expect(-s.currentMa).toBeCloseTo(49, 0);
    expect(z.run(0.001).faults).toEqual([]);
    const fwd = rig(zener5v1, 5, 220);
    fwd.run(0.002);
    expect(fwd.state<DiodeState>('d').volts).toBeCloseTo(0.71, 1);
  });

  it('Zener overheats beyond 1 W and opens once damaged', () => {
    const z = rig(zener5v1, 12, 20, true); // ≈ 0.26 A × 5.2 V ≈ 1.4 W
    expect(z.run(0.002).faults.map((f) => f.code)).toEqual(['OVER_POWER']);
    z.sim.damageComponent('d', 'OVER_POWER');
    z.run(0.002);
    expect(z.state<DiodeState>('d')).toMatchObject({ currentMa: 0, damaged: true });
  });
});
