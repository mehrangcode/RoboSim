import { validateManifest } from '@robosim/sim-core';
import { bench, dcSupply, fixedResistor } from '@robosim/test-fixtures';
import { describe, expect, it } from 'vitest';
import { definition, manifest, type PowerSwitchState } from './index.js';

describe('power.switch', () => {
  it('has a valid manifest', () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it('opens and closes the circuit and flags a short', () => {
    const b = bench({
      parts: {
        src: { def: dcSupply, props: { volts: 9, ohms: 0.5 } },
        sw: { def: definition },
        load: { def: fixedResistor, props: { ohms: 90 } },
      },
      wires: [
        ['src.pos', 'sw.a'],
        ['sw.b', 'load.a'],
      ],
      ground: ['src.neg', 'load.b'],
    });
    b.run(0.002);
    expect(b.state<PowerSwitchState>('sw').currentMa).toBe(0);
    b.input('sw', 'on', true);
    const snap = b.run(0.002);
    expect(b.state<PowerSwitchState>('sw').currentMa).toBeCloseTo((9 / 90.52) * 1000, 2);
    expect(snap.faults).toEqual([]);
  });
});
