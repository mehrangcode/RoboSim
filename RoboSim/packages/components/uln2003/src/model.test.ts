import { validateManifest } from '@robosim/sim-core';
import { bench, dcSupply, fixedResistor } from '@robosim/test-fixtures';
import { describe, expect, it } from 'vitest';
import { definition, manifest, type Uln2003State } from './index.js';

/** IN1 driven at `inV` (25 Ω like a pin); OUT1 pulls a `loadOhms` load from `supplyV`; COM on the supply. */
function rig(inV: number, loadOhms = 50, supplyV = 5) {
  return bench({
    parts: {
      sup: { def: dcSupply, props: { volts: supplyV, ohms: 0 } },
      pin: { def: dcSupply, props: { volts: inV, ohms: 25 } },
      load: { def: fixedResistor, props: { ohms: loadOhms } },
      u: { def: definition },
    },
    wires: [
      ['pin.pos', 'u.in1'],
      ['sup.pos', 'load.a'],
      ['load.b', 'u.out1'],
      ['sup.pos', 'u.com'],
    ],
    ground: ['sup.neg', 'pin.neg', 'u.gnd'],
  });
}

describe('ic.uln2003a', () => {
  it('has a valid manifest', () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it('a HIGH input sinks a 50 Ω coil with ≈ 0.9 V Darlington saturation', () => {
    const b = rig(5);
    b.run(0.003);
    const s = b.state<Uln2003State>('u');
    expect(s.on[0]).toBe(true);
    expect(s.currentMa[0]).toBeCloseTo(((5 - 0.75) / 51.5) * 1000, 0);
    expect(b.volts('u.out1')).toBeCloseTo(0.87, 1);
    // Input draws ≈ (5 − 1.4) / 2.7 kΩ from the pin.
    expect((5 - b.volts('u.in1')) / 25).toBeCloseTo((5 - 1.4) / 2725, 4);
  });

  it('stays off below its input threshold and the clamp holds the output at COM', () => {
    const b = rig(1.5);
    b.run(0.003);
    expect(b.state<Uln2003State>('u').on[0]).toBe(false);
    expect(b.volts('u.out1')).toBeCloseTo(5, 3);
  });

  it('flags more than 500 mA in one channel', () => {
    expect(
      rig(5, 5, 12)
        .run(0.003)
        .faults.map((f) => f.code),
    ).toEqual(['OVER_CURRENT']);
  });
});
