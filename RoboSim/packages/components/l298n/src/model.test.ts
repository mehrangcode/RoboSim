import { validateManifest } from '@robosim/sim-core';
import { bench, dcSupply, fixedResistor } from '@robosim/test-fixtures';
import { describe, expect, it } from 'vitest';
import { definition, manifest, type L298nState } from './index.js';

/** 9 V supply → L298N; 10 Ω load on OUT1/OUT2; logic inputs driven by test supplies (0 / 5 V). */
function rig(in1: number, in2: number, props: Record<string, boolean> = {}, vs = 9) {
  return bench({
    parts: {
      bat: { def: dcSupply, props: { volts: vs, ohms: 0.2 } },
      drv: { def: definition, props },
      load: { def: fixedResistor, props: { ohms: 10 } },
      i1: { def: dcSupply, props: { volts: in1, ohms: 0 } },
      i2: { def: dcSupply, props: { volts: in2, ohms: 0 } },
    },
    wires: [
      ['bat.pos', 'drv.vs'],
      ['drv.out1', 'load.a'],
      ['drv.out2', 'load.b'],
      ['i1.pos', 'drv.in1'],
      ['i2.pos', 'drv.in2'],
    ],
    ground: ['bat.neg', 'drv.gnd', 'i1.neg', 'i2.neg'],
  });
}

describe('driver.l298n', () => {
  it('has a valid manifest', () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it('drives forward with the calibrated ~2 V bridge drop and draws from VS', () => {
    const b = rig(5, 0);
    b.run(0.005);
    const s = b.state<L298nState>('drv');
    expect(s).toMatchObject({ bridgeA: 'forward', enableA: 1, bridgeB: 'brake' });
    expect(s.v5).toBeCloseTo(5, 1);
    const vLoad = b.volts('load.a') - b.volts('load.b');
    expect(9 - vLoad).toBeGreaterThan(1.8);
    expect(9 - vLoad).toBeLessThan(2.6);
    expect(s.currentAMa).toBeCloseTo((vLoad / 10) * 1000, 3);
  });

  it('reverses, brakes and coasts', () => {
    const rev = rig(0, 5);
    rev.run(0.005);
    expect(rev.state<L298nState>('drv').bridgeA).toBe('reverse');
    expect(rev.volts('load.a') - rev.volts('load.b')).toBeLessThan(-6);

    const brake = rig(5, 5);
    brake.run(0.005);
    expect(brake.state<L298nState>('drv').bridgeA).toBe('brake');
    expect(Math.abs(brake.volts('load.a') - brake.volts('load.b'))).toBeLessThan(1e-6);

    const coast = rig(5, 0, { enaJumper: false }); // ENA left floating → disabled
    coast.run(0.005);
    expect(coast.state<L298nState>('drv')).toMatchObject({ bridgeA: 'coast', enableA: 0, currentAMa: 0 });
  });

  it('logic is dead and the regulator drops out when VS is too low', () => {
    const b = rig(5, 0, {}, 6);
    b.run(0.005);
    const s = b.state<L298nState>('drv');
    expect(s.v5).toBeLessThan(4.5);
    expect(s.bridgeA).toBe('coast');
  });

  it('flags over-voltage on VS', () => {
    expect(
      rig(5, 0, {}, 40)
        .run(0.005)
        .faults.map((f) => f.code),
    ).toContain('OVER_VOLTAGE');
  });
});
