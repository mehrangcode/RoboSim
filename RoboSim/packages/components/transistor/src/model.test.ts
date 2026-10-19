import { validateManifest } from '@robosim/sim-core';
import { bench, dcSupply, fixedDiode, fixedInductor, fixedResistor } from '@robosim/test-fixtures';
import { describe, expect, it } from 'vitest';
import {
  definitions,
  mosfetIrlz44n,
  transistor2n2222,
  transistor2n3906,
  transistorTip120,
  type TransistorState,
} from './index.js';

type Def = (typeof definitions)[number];

/** Low-side switch: `drive` volts through `rb` into the base (gate), a `rl` load from `vload` to the collector. */
function lowSide(def: Def, opts: { drive: number; rb: number; rl: number; vload: number }) {
  const mos = def === mosfetIrlz44n;
  const [c, b, e] = mos ? ['d', 'g', 's'] : ['c', 'b', 'e'];
  return bench({
    parts: {
      supply: { def: dcSupply, props: { volts: opts.vload, ohms: 0.01 } },
      drive: { def: dcSupply, props: { volts: opts.drive, ohms: 0 } },
      rb: { def: fixedResistor, props: { ohms: opts.rb } },
      load: { def: fixedResistor, props: { ohms: opts.rl } },
      q: { def },
    },
    wires: [
      ['drive.pos', 'rb.a'],
      ['rb.b', `q.${b}`],
      ['supply.pos', 'load.a'],
      ['load.b', `q.${c}`],
    ],
    ground: ['supply.neg', 'drive.neg', `q.${e}`],
  });
}

describe('discrete transistors', () => {
  it('have valid manifests', () => {
    for (const d of definitions) expect(validateManifest(d.manifest)).toEqual([]);
  });

  it('2N2222 saturates as a switch with a 1 kΩ base resistor', () => {
    const b = lowSide(transistor2n2222, { drive: 5, rb: 1000, rl: 100, vload: 5 });
    b.run(0.01);
    const s = b.state<TransistorState>('q');
    expect(s.region).toBe('saturation');
    expect(s.controlMa).toBeCloseTo(4.28, 1); // (5 − 0.65 V) / 1017 Ω
    expect(s.volts).toBeLessThan(0.2);
    expect(s.mainMa).toBeCloseTo(48.4, 0);
    expect(b.run(0.01).faults).toEqual([]);
  });

  it('2N2222 amplifies in the active region: Ic = β·Ib', () => {
    const b = lowSide(transistor2n2222, { drive: 5, rb: 470_000, rl: 1000, vload: 9 });
    b.run(0.01);
    const s = b.state<TransistorState>('q');
    expect(s.region).toBe('active');
    expect(s.mainMa / s.controlMa).toBeCloseTo(150, 3);
  });

  it('2N3906 switches a load on the high side when its base is pulled low', () => {
    const b = bench({
      parts: {
        supply: { def: dcSupply, props: { volts: 5, ohms: 0.01 } },
        rb: { def: fixedResistor, props: { ohms: 4700 } },
        load: { def: fixedResistor, props: { ohms: 220 } },
        q: { def: transistor2n3906 },
      },
      wires: [
        ['supply.pos', 'q.e'],
        ['q.b', 'rb.a'],
        ['q.c', 'load.a'],
      ],
      ground: ['supply.neg', 'rb.b', 'load.b'],
    });
    b.run(0.01);
    const s = b.state<TransistorState>('q');
    expect(s.region).toBe('saturation');
    expect(s.mainMa).toBeGreaterThan(20);
    expect(b.volts('load.a')).toBeGreaterThan(4.6);
  });

  it('TIP120 drives an amp with a few mA of base current, and overheats near 4 A without a heatsink', () => {
    const ok = lowSide(transistorTip120, { drive: 5, rb: 1000, rl: 10, vload: 12 });
    ok.run(0.01);
    const s = ok.state<TransistorState>('q');
    expect(s.controlMa).toBeLessThan(4);
    expect(s.mainMa).toBeGreaterThan(1000);
    expect(s.volts).toBeCloseTo(0.75 + 0.4 * (s.mainMa / 1000), 1);

    const hot = lowSide(transistorTip120, { drive: 5, rb: 470, rl: 2.5, vload: 12 });
    let faults: string[] = [];
    for (let t = 0; t < 60 && faults.length === 0; t++) faults = hot.run(1).faults.map((f) => f.code);
    expect(faults).toEqual(['OVER_POWER']);
    expect(hot.state<TransistorState>('q').junctionC).toBeGreaterThan(150);
    hot.sim.damageComponent('q', 'OVER_POWER');
    hot.run(0.01);
    expect(hot.state<TransistorState>('q')).toMatchObject({ damaged: true });
    expect(hot.state<TransistorState>('q').volts).toBeLessThan(2); // failed short: the load stays on
  });

  it('IRLZ44N turns fully on from a 5 V pin, and runs partly on (hot) from 3 V', () => {
    const full = lowSide(mosfetIrlz44n, { drive: 5, rb: 100, rl: 5, vload: 12 });
    full.run(0.01);
    const s = full.state<TransistorState>('q');
    expect(s.region).toBe('linear');
    expect(s.volts / (s.mainMa / 1000)).toBeCloseTo(0.025, 3);
    expect(s.partiallyOn).toBe(false);
    expect(full.run(0.01).faults).toEqual([]);

    const weak = lowSide(mosfetIrlz44n, { drive: 3, rb: 100, rl: 5, vload: 12 });
    expect(weak.run(0.01).faults.map((f) => f.code)).toEqual(['PARTIAL_ENHANCEMENT']);
  });

  /** 12 V ─ coil (100 mH, 50 Ω) ─ collector; base from `drive` through 1 kΩ; optional flyback diode. */
  function coil(flyback: boolean) {
    return bench({
      parts: {
        supply: { def: dcSupply, props: { volts: 12, ohms: 0.01 } },
        drive: { def: dcSupply, props: { volts: 5, ohms: 0 } },
        rb: { def: fixedResistor, props: { ohms: 1000 } },
        l: { def: fixedInductor, props: { henries: 0.1, ohms: 50 } },
        q: { def: transistor2n2222 },
        ...(flyback ? { d: { def: fixedDiode } } : {}),
      },
      wires: [
        ['drive.pos', 'rb.a'],
        ['rb.b', 'q.b'],
        ['supply.pos', 'l.a'],
        ['l.b', 'q.c'],
        ...(flyback
          ? ([
              ['l.b', 'd.a'],
              ['supply.pos', 'd.k'],
            ] as const)
          : []),
      ],
      ground: ['supply.neg', 'drive.neg', 'q.e'],
    });
  }

  it('an unclamped coil switched off drives the collector into avalanche at its 40 V rating', () => {
    const b = coil(false);
    b.run(0.02); // 240 mA through the coil
    b.input('drive', 'volts', 0);
    const snap = b.run(0.001);
    expect(b.sim.netEnvelope(b.net('q.c')).max).toBeGreaterThan(40);
    expect(snap.faults.map((f) => f.code)).toEqual(['OVER_VOLTAGE']);
    expect(b.state<TransistorState>('q').avalanche).toBe(true);
  });

  it('a flyback diode clamps the same switch-off to one diode drop above the supply', () => {
    const b = coil(true);
    b.run(0.02);
    b.input('drive', 'volts', 0);
    const snap = b.run(0.001);
    const peak = b.sim.netEnvelope(b.net('q.c')).max;
    expect(peak).toBeGreaterThan(12.5);
    expect(peak).toBeLessThan(13.5);
    expect(snap.faults).toEqual([]);
  });
});
