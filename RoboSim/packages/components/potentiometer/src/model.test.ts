import { validateManifest } from '@robosim/sim-core';
import { bench, dcSupply } from '@robosim/test-fixtures';
import { describe, expect, it } from 'vitest';
import { definition, manifest, type PotentiometerState } from './index.js';

describe('passive.potentiometer', () => {
  it('has a valid manifest', () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it('divides the supply by wiper position', () => {
    const b = bench({
      parts: { src: { def: dcSupply, props: { volts: 5, ohms: 0 } }, pot: { def: definition } },
      wires: [['src.pos', 'pot.a']],
      ground: ['src.neg', 'pot.b'],
    });
    b.run(0.002);
    expect(b.state<PotentiometerState>('pot').wiperV).toBeCloseTo(2.5, 3);
    b.input('pot', 'position', 0.2); // 20 % of the way from a → wiper is closer to a
    b.run(0.002);
    expect(b.state<PotentiometerState>('pot').wiperV).toBeCloseTo(4, 2);
    b.input('pot', 'position', 1.5); // clamped
    b.run(0.002);
    expect(b.state<PotentiometerState>('pot')).toMatchObject({ position: 1 });
    expect(b.volts('pot.wiper')).toBeLessThan(0.01);
  });
});
