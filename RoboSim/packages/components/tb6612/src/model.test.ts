import { validateManifest } from '@robosim/sim-core';
import { bench, dcSupply, fixedResistor } from '@robosim/test-fixtures';
import { describe, expect, it } from 'vitest';
import { definition, manifest, type Tb6612State } from './index.js';

type Level = 0 | 1 | null; // null: left floating

/** VM 6 V, VCC 5 V, channel A inputs at the given levels, a 10 Ω "motor" across AO1–AO2. */
function rig(ain1: Level, ain2: Level, pwma: Level, stby: Level) {
  const parts: Record<string, unknown> = {
    vm: { def: dcSupply, props: { volts: 6, ohms: 0 } },
    vcc: { def: dcSupply, props: { volts: 5, ohms: 0 } },
    motor: { def: fixedResistor, props: { ohms: 10 } },
    drv: { def: definition },
  };
  const wires: [string, string][] = [
    ['vm.pos', 'drv.vm'],
    ['vcc.pos', 'drv.vcc'],
    ['drv.ao1', 'motor.a'],
    ['drv.ao2', 'motor.b'],
  ];
  const ground = ['vm.neg', 'vcc.neg', 'drv.gnd'];
  for (const [pin, level] of [
    ['ain1', ain1],
    ['ain2', ain2],
    ['pwma', pwma],
    ['stby', stby],
  ] as const) {
    if (level === 1) wires.push(['vcc.pos', `drv.${pin}`]);
    else if (level === 0) ground.push(`drv.${pin}`);
  }
  return bench({ parts: parts as never, wires, ground });
}

const across = (b: ReturnType<typeof rig>) => b.volts('drv.ao1') - b.volts('drv.ao2');

describe('driver.tb6612fng', () => {
  it('has a valid manifest', () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it('drives forward and reverse with ≈ 0.5 Ω total bridge resistance', () => {
    const fwd = rig(1, 0, 1, 1);
    fwd.run(0.003);
    expect(fwd.state<Tb6612State>('drv').modeA).toBe('forward');
    expect(across(fwd)).toBeCloseTo((6 * 10) / 10.5, 2);
    const rev = rig(0, 1, 1, 1);
    rev.run(0.003);
    expect(rev.state<Tb6612State>('drv').modeA).toBe('reverse');
    expect(across(rev)).toBeCloseTo((-6 * 10) / 10.5, 2);
  });

  it('short-brakes with PWM LOW or both inputs HIGH, and stops (floats) with both LOW', () => {
    for (const [a, b, p] of [
      [1, 0, 0],
      [1, 1, 1],
    ] as const) {
      const r = rig(a, b, p, 1);
      r.run(0.003);
      expect(r.state<Tb6612State>('drv').modeA).toBe('brake');
      expect(r.volts('drv.ao1')).toBeCloseTo(0, 3);
    }
    const stop = rig(0, 0, 1, 1);
    stop.run(0.003);
    expect(stop.state<Tb6612State>('drv').modeA).toBe('stop');
  });

  it('stays in standby with STBY floating (internal pull-down) — a classic wiring mistake', () => {
    const b = rig(1, 0, 1, null);
    b.run(0.003);
    expect(b.state<Tb6612State>('drv').modeA).toBe('standby');
    expect(Math.abs(across(b))).toBeLessThan(0.01);
  });
});
