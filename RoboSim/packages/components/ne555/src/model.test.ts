import { validateManifest } from '@robosim/sim-core';
import { bench, dcSupply, fixedCapacitor, fixedResistor } from '@robosim/test-fixtures';
import { describe, expect, it } from 'vitest';
import { definition, manifest, type Ne555State } from './index.js';

/** Classic astable: VCC ─ R1 ─ DIS ─ R2 ─ THR/TRIG ─ C ─ GND, RESET to VCC, CTRL open. */
function astable(r1: number, r2: number, c: number, volts = 5) {
  return bench({
    parts: {
      src: { def: dcSupply, props: { volts, ohms: 0.05 } },
      t: { def: definition },
      r1: { def: fixedResistor, props: { ohms: r1 } },
      r2: { def: fixedResistor, props: { ohms: r2 } },
      c: { def: fixedCapacitor, props: { farads: c } },
      load: { def: fixedResistor, props: { ohms: 1000 } },
    },
    wires: [
      ['src.pos', 't.vcc'],
      ['src.pos', 't.reset'],
      ['src.pos', 'r1.a'],
      ['r1.b', 't.dis'],
      ['t.dis', 'r2.a'],
      ['r2.b', 't.thr'],
      ['t.thr', 't.trig'],
      ['t.thr', 'c.a'],
      ['t.out', 'load.a'],
    ],
    ground: ['src.neg', 't.gnd', 'c.b', 'load.b'],
  });
}

describe('ic.ne555', () => {
  it('has a valid manifest', () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it('runs astable at 1 / (ln 2 · (R1 + 2·R2) · C) with duty (R1 + R2) / (R1 + 2·R2)', () => {
    const b = astable(1000, 10_000, 100e-9);
    b.run(0.05);
    const s = b.state<Ne555State>('t');
    const f = 1 / (Math.LN2 * 21_000 * 100e-9); // ≈ 687 Hz
    expect(Math.abs(s.freqHz / f - 1)).toBeLessThan(0.02);
    expect(s.duty).toBeCloseTo(11 / 21, 1);
    // Over many cycles the load sees the mean of a ≈ 3.6 V / 0.05 V square wave: ≈ 1.9 V.
    let sum = 0;
    for (let i = 0; i < 100; i++) {
      b.run(0.001);
      sum += b.state<Ne555State>('t').outVolts;
    }
    expect(sum / 100).toBeCloseTo(3.59 * (11 / 21) + 0.05 * (10 / 21), 1);
  });

  it('blinks at about 1 Hz with 1 kΩ, 68 kΩ and 10 µF, and the capacitor swings between ⅓ and ⅔ VCC', () => {
    const b = astable(1000, 68_000, 10e-6);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < 4000; i++) {
      b.run(0.001);
      if (i > 1500) {
        const env = b.sim.netEnvelope(b.net('c.a'));
        lo = Math.min(lo, env.min);
        hi = Math.max(hi, env.max);
      }
    }
    const s = b.state<Ne555State>('t');
    expect(s.freqHz).toBeCloseTo(1 / (Math.LN2 * 137_000 * 10e-6), 1);
    expect(lo).toBeCloseTo(5 / 3, 1);
    expect(hi).toBeCloseTo(10 / 3, 1);
  });

  it('as a monostable, stretches a short trigger to 1.1·R·C', () => {
    const b = bench({
      parts: {
        src: { def: dcSupply, props: { volts: 5, ohms: 0.05 } },
        trigger: { def: dcSupply, props: { volts: 5, ohms: 100 } },
        t: { def: definition },
        r: { def: fixedResistor, props: { ohms: 10_000 } },
        c: { def: fixedCapacitor, props: { farads: 10e-6 } },
      },
      wires: [
        ['src.pos', 't.vcc'],
        ['src.pos', 't.reset'],
        ['src.pos', 'r.a'],
        ['r.b', 't.dis'],
        ['t.dis', 't.thr'],
        ['t.thr', 'c.a'],
        ['trigger.pos', 't.trig'],
      ],
      ground: ['src.neg', 'trigger.neg', 't.gnd', 'c.b'],
    });
    b.run(0.02);
    expect(b.state<Ne555State>('t').output).toBe(0);
    b.input('trigger', 'volts', 0);
    b.run(0.001);
    b.input('trigger', 'volts', 5);
    let highFor = 0;
    for (let i = 0; i < 300 && b.state<Ne555State>('t').output === 1; i++) {
      b.run(0.001);
      highFor += 0.001;
    }
    expect(highFor).toBeCloseTo(1.1 * 10_000 * 10e-6, 2); // 110 ms
  });

  it('holds the output low while RESET is low', () => {
    const b = bench({
      parts: {
        src: { def: dcSupply, props: { volts: 5, ohms: 0.05 } },
        t: { def: definition },
        r1: { def: fixedResistor, props: { ohms: 1000 } },
        r2: { def: fixedResistor, props: { ohms: 10_000 } },
        c: { def: fixedCapacitor, props: { farads: 100e-9 } },
      },
      wires: [
        ['src.pos', 't.vcc'],
        ['src.pos', 'r1.a'],
        ['r1.b', 't.dis'],
        ['t.dis', 'r2.a'],
        ['r2.b', 't.thr'],
        ['t.thr', 't.trig'],
        ['t.thr', 'c.a'],
      ],
      ground: ['src.neg', 't.gnd', 'c.b', 't.reset'],
    });
    b.run(0.02);
    expect(b.state<Ne555State>('t')).toMatchObject({ output: 0, freqHz: 0 });
  });

  it('reports over-voltage above 16 V', () => {
    const b = astable(1000, 10_000, 100e-9, 18);
    expect(b.run(0.002).faults.map((f) => f.code)).toContain('OVER_VOLTAGE');
  });
});
