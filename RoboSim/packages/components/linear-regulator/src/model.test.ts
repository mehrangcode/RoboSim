import { validateManifest } from '@robosim/sim-core';
import { bench, dcSupply, fixedResistor } from '@robosim/test-fixtures';
import { describe, expect, it } from 'vitest';
import { ams1117, definitions, lm7805, type LinearRegulatorState } from './index.js';

function rig(def: (typeof definitions)[number], vin: number, loadOhms: number, sourceOhms = 0) {
  return bench({
    parts: {
      src: { def: dcSupply, props: { volts: vin, ohms: sourceOhms } },
      reg: { def },
      load: { def: fixedResistor, props: { ohms: loadOhms } },
    },
    wires: [
      ['src.pos', 'reg.in'],
      ['reg.out', 'load.a'],
    ],
    ground: ['src.neg', 'reg.gnd', 'load.b'],
  });
}

describe('linear regulators', () => {
  it('have valid manifests', () => {
    for (const d of definitions) expect(validateManifest(d.manifest)).toEqual([]);
  });

  it('LM7805 holds 5 V from 9 V and the input supplies the load current plus quiescent', () => {
    const b = rig(lm7805, 9, 50, 1);
    b.run(0.01);
    const s = b.state<LinearRegulatorState>('reg');
    expect(s.vout).toBeCloseTo(5, 1);
    expect(s.currentMa).toBeCloseTo(100, 0);
    expect(s.dropout).toBe(false);
    // 1 Ω source: input sags by ≈ (100 mA + quiescent) × 1 Ω.
    expect(9 - b.volts('reg.in')).toBeCloseTo(0.106, 2);
  });

  it('LM7805 drops out on a 6 V input (output ≈ Vin − 2 V)', () => {
    const b = rig(lm7805, 6, 100);
    b.run(0.02);
    const s = b.state<LinearRegulatorState>('reg');
    expect(s.dropout).toBe(true);
    expect(s.vout).toBeCloseTo(4, 1);
  });

  it('AMS1117-3.3 regulates from 5 V and limits a short to ≈ 1.1 A', () => {
    const ok = rig(ams1117, 5, 33);
    ok.run(0.01);
    expect(ok.state<LinearRegulatorState>('reg').vout).toBeCloseTo(3.3, 1);
    const short = rig(ams1117, 5, 0.1);
    short.run(0.05);
    const s = short.state<LinearRegulatorState>('reg');
    expect(s.currentLimited).toBe(true);
    expect(s.currentMa).toBeCloseTo(1100, -1);
  });

  it('heats up and shuts down thermally, then restarts after cooling', () => {
    // 12 V → 5 V at 0.5 A ≈ 3.5 W × 50 °C/W ≫ 150 °C.
    const b = rig(lm7805, 12, 10);
    b.run(60); // τ = 45 s: reaches 150 °C after ≈ 56 s
    expect(b.state<LinearRegulatorState>('reg').thermalShutdown).toBe(true);
    expect(b.state<LinearRegulatorState>('reg').vout).toBeLessThan(0.1);
    b.run(10); // cools to 135 °C in ≈ 6 s
    expect(b.state<LinearRegulatorState>('reg').thermalShutdown).toBe(false);
  });

  it('flags input over-voltage', () => {
    expect(
      rig(ams1117, 18, 100)
        .run(0.005)
        .faults.map((f) => f.code),
    ).toEqual(['OVER_VOLTAGE']);
  });
});
