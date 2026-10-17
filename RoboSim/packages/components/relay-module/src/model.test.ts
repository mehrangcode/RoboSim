import { validateManifest } from '@robosim/sim-core';
import { bench, dcSupply, fixedResistor } from '@robosim/test-fixtures';
import { describe, expect, it } from 'vitest';
import { definition, manifest, type RelayModuleState } from './index.js';

/**
 * 5 V module supply (`supplyV`), the input tied to `inV` through a 100 Ω "pin", and a 12 V lamp
 * (24 Ω) switched through COM–NO.
 */
function rig(trigger: 'high' | 'low', inV: number, supplyV = 5) {
  return bench({
    parts: {
      vcc: { def: dcSupply, props: { volts: supplyV, ohms: 0 } },
      pin: { def: dcSupply, props: { volts: inV, ohms: 25 } },
      lampSrc: { def: dcSupply, props: { volts: 12, ohms: 0 } },
      lamp: { def: fixedResistor, props: { ohms: 24 } },
      relay: { def: definition, props: { trigger } },
    },
    wires: [
      ['vcc.pos', 'relay.vcc'],
      ['pin.pos', 'relay.in'],
      ['lampSrc.pos', 'relay.com'],
      ['relay.no', 'lamp.a'],
    ],
    ground: ['vcc.neg', 'pin.neg', 'relay.gnd', 'lampSrc.neg', 'lamp.b'],
  });
}

describe('actuator.relay-module', () => {
  it('has a valid manifest', () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it('closes COM–NO 10 ms after a HIGH input and draws the coil current', () => {
    const b = rig('high', 5);
    b.run(0.009);
    expect(b.state<RelayModuleState>('relay')).toMatchObject({ commanded: true, energized: false });
    b.run(0.002);
    const s = b.state<RelayModuleState>('relay');
    expect(s.energized).toBe(true);
    expect(s.coilMa).toBeCloseTo((5 / 70) * 1000, 0);
    expect(s.contactMa).toBeCloseTo((12 / 24.1) * 1000, -1);
    expect(b.volts('lamp.a')).toBeGreaterThan(11.9);
  });

  it('stays off with a LOW input on a high-trigger module', () => {
    const b = rig('high', 0);
    b.run(0.05);
    expect(b.state<RelayModuleState>('relay').energized).toBe(false);
    expect(b.volts('lamp.a')).toBeCloseTo(0, 3);
  });

  it('low-trigger module operates when the input is pulled LOW', () => {
    const on = rig('low', 0);
    on.run(0.02);
    expect(on.state<RelayModuleState>('relay').energized).toBe(true);
    const off = rig('low', 5);
    off.run(0.02);
    expect(off.state<RelayModuleState>('relay').energized).toBe(false);
  });

  it('never pulls in on a weak 3.3 V supply', () => {
    const b = rig('high', 3.3, 3.3);
    b.run(0.05);
    expect(b.state<RelayModuleState>('relay')).toMatchObject({ commanded: true, energized: false });
  });

  it('flags contacts carrying more than 10 A', () => {
    const b = bench({
      parts: {
        vcc: { def: dcSupply, props: { volts: 5, ohms: 0 } },
        load: { def: dcSupply, props: { volts: 12, ohms: 0 } },
        relay: { def: definition },
      },
      wires: [
        ['vcc.pos', 'relay.vcc'],
        ['vcc.pos', 'relay.in'],
        ['load.pos', 'relay.com'],
      ],
      ground: ['vcc.neg', 'relay.gnd', 'load.neg', 'relay.no'],
    });
    expect(b.run(0.02).faults.map((f) => f.code)).toEqual(['OVER_CURRENT']);
  });
});
