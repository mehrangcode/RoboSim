import { validateManifest } from '@robosim/sim-core';
import { bench, fixedResistor } from '@robosim/test-fixtures';
import { describe, expect, it } from 'vitest';
import { battery4aa, battery9v, cellOcv, definitions, type BatteryState } from './index.js';

describe('power.battery-*', () => {
  it('has valid manifests', () => {
    for (const d of definitions) expect(validateManifest(d.manifest)).toEqual([]);
  });

  it('fresh packs read their nominal open-circuit voltage', () => {
    expect(6 * cellOcv(1)).toBeCloseTo(9.48, 6);
    expect(4 * cellOcv(1)).toBeCloseTo(6.32, 6);
    expect(cellOcv(0.35)).toBeCloseTo(1.27, 6); // interpolated between 0.2 and 0.5
  });

  it('sags under load through its internal resistance', () => {
    const b = bench({
      parts: { bat: { def: battery4aa }, load: { def: fixedResistor, props: { ohms: 6 } } },
      wires: [['bat.pos', 'load.a']],
      ground: ['bat.neg', 'load.b'],
    });
    b.run(0.002);
    const s = b.state<BatteryState>('bat');
    expect(s.currentMa).toBeCloseTo((6.32 / 6.6) * 1000, 0);
    expect(s.volts).toBeCloseTo(6.32 - 0.6 * (6.32 / 6.6), 3);
  });

  it('drains by coulomb counting and the voltage follows the curve', () => {
    // 1 mAh capacity at ~94 mA → ~38 s to empty; run 19 s ≈ half.
    const b = bench({
      parts: {
        bat: { def: battery9v, props: { capacityMah: 1 } },
        load: { def: fixedResistor, props: { ohms: 100 } },
      },
      wires: [['bat.pos', 'load.a']],
      ground: ['bat.neg', 'load.b'],
    });
    b.run(19);
    const s = b.state<BatteryState>('bat');
    expect(s.charge).toBeGreaterThan(0.3);
    expect(s.charge).toBeLessThan(0.6);
    expect(s.ocv).toBeLessThan(8.4);
    b.input('bat', 'charge', 1); // swap in a fresh battery
    b.run(0.002);
    expect(b.state<BatteryState>('bat').ocv).toBeCloseTo(9.48, 2); // tiny test capacity drains a little in 2 ms
  });

  it('flags a short circuit', () => {
    const b = bench({
      parts: { bat: { def: battery9v }, wire: { def: fixedResistor, props: { ohms: 0.01 } } },
      wires: [['bat.pos', 'wire.a']],
      ground: ['bat.neg', 'wire.b'],
    });
    expect(b.run(0.002).faults.map((f) => f.code)).toEqual(['SHORT_CIRCUIT']);
  });
});
