import { validateManifest } from '@robosim/sim-core';
import { bench, dcSupply, fixedResistor } from '@robosim/test-fixtures';
import { describe, expect, it } from 'vitest';
import { definition, manifest, type LdrState } from './index.js';

describe('sensor.ldr', () => {
  it('has a valid manifest', () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it('follows the R10·(lux/10)^−γ curve and saturates in the dark', () => {
    const b = bench({ parts: { ldr: { def: definition } } });
    const ohmsAt = (lux: number): number => {
      b.input('ldr', 'lux', lux);
      return b.state<LdrState>('ldr').ohms;
    };
    expect(ohmsAt(10)).toBeCloseTo(10_000, 6);
    expect(ohmsAt(1000)).toBeCloseTo(10_000 * 100 ** -0.7, 3);
    expect(ohmsAt(0)).toBe(1_000_000);
    expect(ohmsAt(0.0001)).toBe(1_000_000);
  });

  it('forms a light-dependent divider (LDR to 5 V, 10 kΩ to GND)', () => {
    const b = bench({
      parts: {
        src: { def: dcSupply, props: { volts: 5, ohms: 0 } },
        ldr: { def: definition },
        r: { def: fixedResistor, props: { ohms: 10_000 } },
      },
      wires: [
        ['src.pos', 'ldr.a'],
        ['ldr.b', 'r.a'],
      ],
      ground: ['src.neg', 'r.b'],
    });
    b.input('ldr', 'lux', 10);
    b.run(0.002);
    expect(b.volts('r.a')).toBeCloseTo(2.5, 3);
    b.input('ldr', 'lux', 1000);
    b.run(0.002);
    expect(b.volts('r.a')).toBeGreaterThan(4.5);
  });
});
