import { validateManifest } from '@robosim/sim-core';
import { bench, dcSupply } from '@robosim/test-fixtures';
import { describe, expect, it } from 'vitest';
import { definition, manifest, type SoundSensorState } from './index.js';

function rig() {
  return bench({
    parts: { src: { def: dcSupply, props: { volts: 5, ohms: 0 } }, mic: { def: definition } },
    wires: [['src.pos', 'mic.vcc']],
    ground: ['src.neg', 'mic.gnd'],
  });
}

/** Peak-to-peak of AO over `ms` slices, as a sound-level sketch measures it. */
function peakToPeak(b: ReturnType<typeof rig>, ms: number): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < ms; i++) {
    b.run(0.001);
    const v = b.volts('mic.ao');
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  return hi - lo;
}

describe('sensor.sound', () => {
  it('has a valid manifest', () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it('sits at VCC / 2 in silence and swings with loudness', () => {
    const b = rig();
    expect(peakToPeak(b, 50)).toBeLessThan(0.01);
    expect(b.volts('mic.ao')).toBeCloseTo(2.5, 2);
    b.input('mic', 'level', 0.8);
    expect(peakToPeak(b, 50)).toBeGreaterThan(2.5);
  });

  it('DO fires on loud peaks above the threshold and stays LOW when quiet', () => {
    const quiet = rig();
    quiet.input('mic', 'level', 0.2); // peaks reach ≈ 0.59 VCC < 0.7
    let fired = false;
    for (let i = 0; i < 50; i++) {
      quiet.run(0.001);
      fired ||= quiet.state<SoundSensorState>('mic').do === 1;
    }
    expect(fired).toBe(false);
    const loud = rig();
    loud.input('mic', 'level', 1);
    for (let i = 0; i < 50; i++) {
      loud.run(0.001);
      fired ||= loud.state<SoundSensorState>('mic').do === 1;
    }
    expect(fired).toBe(true);
  });
});
