import { validateManifest } from '@robosim/sim-core';
import { bench, dcSupply } from '@robosim/test-fixtures';
import { describe, expect, it } from 'vitest';
import { definition, manifest, type SoilMoistureState } from './index.js';

function rig() {
  return bench({
    parts: { src: { def: dcSupply, props: { volts: 5, ohms: 0 } }, soil: { def: definition } },
    wires: [['src.pos', 'soil.vcc']],
    ground: ['src.neg', 'soil.gnd'],
  });
}

describe('sensor.soil-moisture', () => {
  it('has a valid manifest', () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it('AO falls as the soil gets wetter; DO goes LOW past the threshold', () => {
    const b = rig();
    b.input('soil', 'moisture', 0);
    b.run(0.002);
    expect(b.volts('soil.ao')).toBeCloseTo(5, 2);
    expect(b.volts('soil.do')).toBeCloseTo(5, 2);
    b.input('soil', 'moisture', 1);
    b.run(0.002);
    expect(b.volts('soil.ao')).toBeCloseTo(1.5, 2);
    expect(b.state<SoilMoistureState>('soil').wet).toBe(true);
    expect(b.volts('soil.do')).toBeLessThan(0.05);
  });
});
