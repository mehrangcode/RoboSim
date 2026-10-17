import { validateManifest } from '@robosim/sim-core';
import { bench, dcSupply, fixedResistor } from '@robosim/test-fixtures';
import { describe, expect, it } from 'vitest';
import { definition, manifest } from './index.js';

function rig() {
  return bench({
    parts: {
      src: { def: dcSupply, props: { volts: 5, ohms: 0 } },
      pull: { def: fixedResistor, props: { ohms: 35_000 } },
      joy: { def: definition },
    },
    wires: [
      ['src.pos', 'joy.vcc'],
      ['src.pos', 'pull.a'],
      ['pull.b', 'joy.sw'],
    ],
    ground: ['src.neg', 'joy.gnd'],
  });
}

describe('sensor.joystick', () => {
  it('has a valid manifest', () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it('centre reads VCC / 2; full deflection reads the rails', () => {
    const b = rig();
    b.run(0.002);
    expect(b.volts('joy.vrx')).toBeCloseTo(2.5, 3);
    b.input('joy', 'x', 1);
    b.input('joy', 'y', -1);
    b.run(0.002);
    expect(b.volts('joy.vrx')).toBeCloseTo(5, 2);
    expect(b.volts('joy.vry')).toBeCloseTo(0, 2);
  });

  it('pressing the stick pulls SW to ground against a pull-up', () => {
    const b = rig();
    b.run(0.002);
    expect(b.volts('joy.sw')).toBeCloseTo(5, 2);
    b.input('joy', 'pressed', true);
    b.run(0.002);
    expect(b.volts('joy.sw')).toBeLessThan(0.01);
  });
});
