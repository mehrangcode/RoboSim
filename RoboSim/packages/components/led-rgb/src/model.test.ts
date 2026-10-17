import { validateManifest } from '@robosim/sim-core';
import { bench, dcSupply, fixedResistor } from '@robosim/test-fixtures';
import { describe, expect, it } from 'vitest';
import { definition, manifest, type RgbLedState } from './index.js';

/** 5 V through 220 Ω into each channel that is `on` (common cathode to ground, or common anode to 5 V). */
function rig(common: 'cathode' | 'anode', on: { r?: boolean; g?: boolean; b?: boolean }, ohms = 220) {
  const wires: [string, string][] = [];
  const ground = ['src.neg'];
  const parts: Record<string, { def: typeof fixedResistor | typeof definition; props?: object }> = {
    src: { def: dcSupply, props: { volts: 5, ohms: 0 } },
    led: { def: definition, props: { common } },
  };
  for (const c of ['r', 'g', 'b'] as const) {
    if (!on[c]) continue;
    parts[`r${c}`] = { def: fixedResistor, props: { ohms } };
    if (common === 'cathode') wires.push(['src.pos', `r${c}.a`], [`r${c}.b`, `led.${c}`]);
    else {
      wires.push([`led.${c}`, `r${c}.a`]);
      ground.push(`r${c}.b`);
    }
  }
  if (common === 'cathode') ground.push('led.common');
  else wires.push(['src.pos', 'led.common']);
  return bench({ parts: parts as never, wires, ground });
}

describe('actuator.led-rgb', () => {
  it('has a valid manifest', () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it('lights only the driven dies with colour-specific forward voltage', () => {
    const b = rig('cathode', { r: true, b: true });
    expect(b.run(0.002).faults).toEqual([]);
    const s = b.state<RgbLedState>('led');
    expect(s.currentMa[0]).toBeCloseTo(((5 - 1.8) / 230) * 1000, 3);
    expect(s.currentMa[1]).toBeCloseTo(0, 3);
    expect(s.currentMa[2]).toBeCloseTo(((5 - 2.8) / 235) * 1000, 3);
    expect(s.brightness[0]).toBeGreaterThan(s.brightness[2]);
  });

  it('works as common anode (sinking channels)', () => {
    const b = rig('anode', { g: true });
    b.run(0.002);
    expect(b.state<RgbLedState>('led').currentMa[1]).toBeCloseTo(((5 - 2.8) / 235) * 1000, 3);
  });

  it('flags a channel without a resistor', () => {
    const faults = rig('cathode', { r: true }, 1).run(0.002).faults;
    expect(faults.map((f) => [f.code, f.params['channel']])).toEqual([['OVER_CURRENT', 'r']]);
  });
});
