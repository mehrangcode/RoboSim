import { validateManifest } from '@robosim/sim-core';
import { bench, dcSupply, fixedResistor } from '@robosim/test-fixtures';
import { describe, expect, it } from 'vitest';
import { definition, manifest, type LedState } from './index.js';

function circuit(volts: number, ohms: number, color = 'red', reversed = false) {
  return bench({
    parts: {
      src: { def: dcSupply, props: { volts, ohms: 0 } },
      r: { def: fixedResistor, props: { ohms } },
      led: { def: definition, props: { color } },
    },
    wires: [['src.pos', 'r.a'], reversed ? ['r.b', 'led.k'] : ['r.b', 'led.a']],
    ground: ['src.neg', reversed ? 'led.a' : 'led.k'],
  });
}

describe('actuator.led', () => {
  it('has a valid manifest', () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it('draws ~(V − Vf)/(R + Rs) and reports brightness', () => {
    const b = circuit(5, 220);
    const snap = b.run(0.002);
    const s = b.state<LedState>('led');
    expect(s.currentMa).toBeCloseTo(((5 - 1.8) / 230) * 1000, 4);
    expect(s.brightness).toBeCloseTo(s.currentMa / 20, 6);
    expect(snap.faults).toEqual([]);
  });

  it('uses colour-specific forward voltage (blue needs more)', () => {
    const red = circuit(3, 100, 'red');
    const blue = circuit(3, 100, 'blue');
    red.run(0.002);
    blue.run(0.002);
    expect(red.state<LedState>('led').currentMa).toBeGreaterThan(5 * blue.state<LedState>('led').currentMa);
  });

  it('flags over-current without a resistor and reverse voltage when flipped', () => {
    expect(
      circuit(5, 1)
        .run(0.002)
        .faults.map((f) => f.code),
    ).toEqual(['OVER_CURRENT']);
    const rev = circuit(9, 220, 'red', true);
    const snap = rev.run(0.002);
    expect(rev.state<LedState>('led').currentMa).toBeLessThan(0.001);
    expect(snap.faults.map((f) => f.code)).toEqual(['REVERSE_VOLTAGE']);
  });
});
