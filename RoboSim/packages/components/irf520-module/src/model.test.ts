import { validateManifest } from '@robosim/sim-core';
import { bench, dcSupply, fixedResistor } from '@robosim/test-fixtures';
import { describe, expect, it } from 'vitest';
import { definition, manifest, type Irf520ModuleState } from './index.js';

/** 12 V into VIN, a resistive load across V+ / V−, SIG from a logic-level source. */
function module(sig: number, loadOhms: number) {
  return bench({
    parts: {
      supply: { def: dcSupply, props: { volts: 12, ohms: 0.01 } },
      logic: { def: dcSupply, props: { volts: sig, ohms: 25 } },
      load: { def: fixedResistor, props: { ohms: loadOhms } },
      m: { def: definition },
    },
    wires: [
      ['supply.pos', 'm.vin'],
      ['m.vplus', 'load.a'],
      ['load.b', 'm.vminus'],
      ['logic.pos', 'm.sig'],
    ],
    ground: ['supply.neg', 'logic.neg', 'm.gnd'],
  });
}

describe('driver.irf520-module', () => {
  it('has a valid manifest', () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it('switches a small load from a 5 V pin and lights its indicator', () => {
    const b = module(5, 100); // 120 mA
    b.run(0.01);
    const s = b.state<Irf520ModuleState>('m');
    expect(s.ledOn).toBe(true);
    expect(s.vgs).toBeCloseTo((5 - 25 * 0.0025) * (10 / 11), 1);
    expect(s.loadMa).toBeGreaterThan(117); // 12 V / 100 Ω, less a fraction of a volt across the MOSFET
    expect(s.vds).toBeLessThan(0.3);
  });

  it('from 5 V only partly turns on: an amp-sized load is current-limited and heats the MOSFET', () => {
    const b = module(5, 4); // 3 A wanted
    const snap = b.run(0.01);
    const s = b.state<Irf520ModuleState>('m');
    expect(s.region).toBe('saturation');
    expect(s.loadMa).toBeLessThan(800); // K·(Vgs − Vth)² ≈ 0.6 A
    expect(s.vds).toBeGreaterThan(8);
    expect(snap.faults.map((f) => f.code)).toEqual(['PARTIAL_ENHANCEMENT']);
    const hot = module(5, 4);
    let codes: string[] = [];
    for (let i = 0; i < 120 && !codes.includes('OVER_POWER'); i++)
      codes = hot.run(1).faults.map((f) => f.code);
    expect(codes).toContain('OVER_POWER');
  });

  it('turns fully on with a 12 V gate drive (the rating is at Vgs = 10 V)', () => {
    const b = module(12, 4);
    const snap = b.run(0.01);
    const s = b.state<Irf520ModuleState>('m');
    expect(s.region).toBe('linear');
    expect(s.loadMa).toBeGreaterThan(2800);
    expect(snap.faults).toEqual([]);
  });

  it('is off with SIG low', () => {
    const b = module(0, 4);
    b.run(0.01);
    expect(b.state<Irf520ModuleState>('m')).toMatchObject({ region: 'cutoff', ledOn: false });
  });
});
