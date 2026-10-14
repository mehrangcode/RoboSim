import { validateManifest } from '@robosim/sim-core';
import { bench, dcSupply } from '@robosim/test-fixtures';
import { describe, expect, it } from 'vitest';
import { definition, manifest, type ActiveBuzzerState } from './index.js';

const at = (volts: number) => {
  const b = bench({
    parts: { src: { def: dcSupply, props: { volts, ohms: 0 } }, bz: { def: definition } },
    wires: [['src.pos', 'bz.pos']],
    ground: ['src.neg', 'bz.neg'],
  });
  const snap = b.run(0.002);
  return { state: b.state<ActiveBuzzerState>('bz'), faults: snap.faults.map((f) => f.code) };
};

describe('actuator.buzzer-active', () => {
  it('has a valid manifest', () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it('sounds from 3 V, draws ~30 mA at 5 V, and flags over-voltage', () => {
    expect(at(2.5).state.sounding).toBe(false);
    expect(at(5).state).toMatchObject({ sounding: true, toneHz: 2300 });
    expect(at(5).state.currentMa).toBeCloseTo(30, 6);
    expect(at(5).faults).toEqual([]);
    expect(at(12).faults).toEqual(['OVER_VOLTAGE']);
  });
});
