import { validateManifest } from '@robosim/sim-core';
import { bench, dcSupply } from '@robosim/test-fixtures';
import { describe, expect, it } from 'vitest';
import { definition, manifest, type RotaryEncoderState } from './index.js';

function rig() {
  return bench({
    parts: { src: { def: dcSupply, props: { volts: 5, ohms: 0 } }, enc: { def: definition } },
    wires: [['src.pos', 'enc.vcc']],
    ground: ['src.neg', 'enc.gnd'],
  });
}

/** Records (CLK, DT) levels slice by slice while the knob turns. */
function trace(b: ReturnType<typeof rig>, slices: number): string[] {
  const seen: string[] = [];
  for (let i = 0; i < slices; i++) {
    b.run(0.001);
    const s = `${b.volts('enc.clk') > 2.5 ? 1 : 0}${b.volts('enc.dt') > 2.5 ? 1 : 0}`;
    if (seen.at(-1) !== s) seen.push(s);
  }
  return seen;
}

describe('sensor.rotary-encoder', () => {
  it('has a valid manifest', () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it('rests HIGH/HIGH and steps through quadrature, CLK leading clockwise', () => {
    const b = rig();
    b.input('enc', 'detents', 1);
    expect(trace(b, 12)).toEqual(['01', '00', '10', '11']);
    expect(b.state<RotaryEncoderState>('enc').detents).toBe(1);
    b.input('enc', 'detents', 0);
    expect(trace(b, 12)).toEqual(['10', '00', '01', '11']);
    expect(b.state<RotaryEncoderState>('enc').detents).toBe(0);
  });

  it('turns several detents to reach the target, 8 ms each', () => {
    const b = rig();
    b.input('enc', 'detents', 5);
    b.run(0.038); // detent k completes at 8k − 1 ms
    expect(b.state<RotaryEncoderState>('enc').detents).toBe(4);
    b.run(0.001);
    expect(b.state<RotaryEncoderState>('enc').detents).toBe(5);
  });
});
