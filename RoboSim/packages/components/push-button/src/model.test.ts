import { validateManifest } from '@robosim/sim-core';
import { bench, dcSupply, fixedResistor } from '@robosim/test-fixtures';
import { describe, expect, it } from 'vitest';
import { definition, manifest } from './index.js';

describe('sensor.push-button', () => {
  it('has a valid manifest', () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it('pulls a 10 kΩ pull-up low only while pressed (a side to GND, b side to the pull-up)', () => {
    const b = bench({
      parts: {
        src: { def: dcSupply, props: { volts: 5, ohms: 0 } },
        pull: { def: fixedResistor, props: { ohms: 10_000 } },
        btn: { def: definition },
      },
      wires: [
        ['src.pos', 'pull.a'],
        ['pull.b', 'btn.b2'],
      ],
      ground: ['src.neg', 'btn.a1'],
    });
    b.run(0.002);
    expect(b.volts('btn.b2')).toBeCloseTo(5, 3);
    b.input('btn', 'pressed', true);
    b.run(0.002);
    expect(b.volts('btn.b2')).toBeLessThan(0.01);
    b.input('btn', 'pressed', false);
    b.run(0.002);
    expect(b.volts('btn.b2')).toBeCloseTo(5, 3);
  });

  it('legs on the same side are always connected (rotated-button mistake)', () => {
    const b = bench({
      parts: {
        src: { def: dcSupply, props: { volts: 5, ohms: 0 } },
        pull: { def: fixedResistor },
        btn: { def: definition },
      },
      wires: [
        ['src.pos', 'pull.a'],
        ['pull.b', 'btn.a2'],
      ],
      ground: ['src.neg', 'btn.a1'],
    });
    b.run(0.002);
    expect(b.volts('btn.a2')).toBeLessThan(0.01); // reads "pressed" forever
  });
});
