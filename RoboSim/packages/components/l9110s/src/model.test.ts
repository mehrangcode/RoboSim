import { validateManifest } from '@robosim/sim-core';
import { bench, dcSupply, fixedResistor } from '@robosim/test-fixtures';
import { describe, expect, it } from 'vitest';
import { definition, manifest, type L9110sState } from './index.js';

/** 6 V supply, channel A inputs tied HIGH (1) or LOW (0), a 20 Ω "motor" across OA1–OA2. */
function rig(ia: 0 | 1, ib: 0 | 1) {
  const wires: [string, string][] = [
    ['vcc.pos', 'drv.vcc'],
    ['drv.oa1', 'motor.a'],
    ['drv.oa2', 'motor.b'],
  ];
  const ground = ['vcc.neg', 'drv.gnd'];
  for (const [pin, level] of [
    ['a-ia', ia],
    ['a-ib', ib],
  ] as const) {
    if (level === 1) wires.push(['vcc.pos', `drv.${pin}`]);
    else ground.push(`drv.${pin}`);
  }
  return bench({
    parts: {
      vcc: { def: dcSupply, props: { volts: 6, ohms: 0 } },
      motor: { def: fixedResistor, props: { ohms: 20 } },
      drv: { def: definition },
    },
    wires,
    ground,
  });
}

describe('driver.l9110s', () => {
  it('has a valid manifest', () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it('drives forward with its bipolar saturation drop and reverses', () => {
    const fwd = rig(1, 0);
    fwd.run(0.003);
    expect(fwd.state<L9110sState>('drv').modeA).toBe('forward');
    // (6 − 0.85) V across 20 Ω + 2 × 0.6 Ω legs.
    expect(fwd.volts('drv.oa1') - fwd.volts('drv.oa2')).toBeCloseTo(((6 - 0.85) * 20) / 21.2, 2);
    const rev = rig(0, 1);
    rev.run(0.003);
    expect(rev.state<L9110sState>('drv').modeA).toBe('reverse');
  });

  it('brakes on L/L and floats on H/H', () => {
    const brake = rig(0, 0);
    brake.run(0.003);
    expect(brake.state<L9110sState>('drv').modeA).toBe('brake');
    const off = rig(1, 1);
    off.run(0.003);
    expect(off.state<L9110sState>('drv').modeA).toBe('off');
  });
});
