import { validateManifest } from '@robosim/sim-core';
import { bench, dcSupply } from '@robosim/test-fixtures';
import { describe, expect, it } from 'vitest';
import { definition, manifest, type PirState } from './index.js';

function rig(props: { holdS?: number; retrigger?: boolean } = {}) {
  return bench({
    parts: { src: { def: dcSupply, props: { volts: 5, ohms: 0 } }, pir: { def: definition, props } },
    wires: [['src.pos', 'pir.vcc']],
    ground: ['src.neg', 'pir.gnd'],
  });
}

describe('sensor.pir', () => {
  it('has a valid manifest', () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it('drives OUT to 3.3 V for the hold time after motion', () => {
    const b = rig({ holdS: 1 });
    b.input('pir', 'motion', true);
    b.run(0.01);
    b.input('pir', 'motion', false);
    expect(b.volts('pir.out')).toBeCloseTo(3.3, 2);
    b.run(0.95);
    expect(b.state<PirState>('pir').out).toBe(true);
    b.run(0.1);
    expect(b.state<PirState>('pir').out).toBe(false);
    expect(b.volts('pir.out')).toBeCloseTo(0, 3);
  });

  it('repeat mode extends the hold while motion continues; single mode locks out after it', () => {
    const repeat = rig({ holdS: 0.5 });
    repeat.input('pir', 'motion', true);
    repeat.run(2);
    expect(repeat.state<PirState>('pir').out).toBe(true);

    const single = rig({ holdS: 0.5, retrigger: false });
    single.input('pir', 'motion', true);
    single.run(0.6);
    expect(single.state<PirState>('pir')).toMatchObject({ out: false, lockedOut: true });
    single.run(2.5);
    expect(single.state<PirState>('pir').out).toBe(true);
  });
});
