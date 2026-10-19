import { describe, expect, it } from 'vitest';
import type { BjtParams, MosfetParams } from '../contracts.js';
import { MnaCircuit } from './circuit.js';

const NPN: BjtParams = { polarity: 'npn', beta: 150, vbe: 0.65, rb: 17, vceSat: 0.1, rceSat: 1.33 };
const PNP: BjtParams = { ...NPN, polarity: 'pnp' };
/** Logic-level N-MOSFET: Vth 1.5 V, Rds(on) 22 mΩ at Vgs = 5 V. */
const NMOS: MosfetParams = { polarity: 'n', vth: 1.5, k: 1 / (2 * 0.022 * 3.5) };

describe('BJT region model', () => {
  /** Net 1: 5 V; base resistor from net 1 to the base (net 2); collector load from net 1 to the collector (net 3). */
  function npnSwitch(rb: number, rc: number) {
    const c = new MnaCircuit(3);
    c.voltageSource(1, 0, 5);
    c.resistor(1, 2, rb);
    c.resistor(1, 3, rc);
    const q = c.bjt(3, 2, 0, NPN);
    return { sol: c.solve(), q };
  }

  it('saturates with a 1 kΩ base resistor: Vce ≈ Vce(sat) + r·Ic, base current set by the resistor', () => {
    const { sol, q } = npnSwitch(1000, 100);
    const t = sol.transistor(q);
    expect(sol.converged).toBe(true);
    expect(t.region).toBe('saturation');
    expect(t.control).toBeCloseTo((5 - 0.65) / (1000 + 17), 4);
    expect(sol.voltage(3)).toBeCloseTo(0.1 + 1.33 * t.main, 4);
    expect(t.main).toBeCloseTo((5 - 0.1) / 101.33, 3);
  });

  it('stays active with a weak base drive: Ic = β·Ib', () => {
    const { sol, q } = npnSwitch(100_000, 100);
    const t = sol.transistor(q);
    expect(t.region).toBe('active');
    expect(t.main).toBeCloseTo(150 * t.control, 9);
    expect(sol.voltage(3)).toBeCloseTo(5 - 100 * t.main, 6);
  });

  it('is off with the base at the emitter', () => {
    const c = new MnaCircuit(2);
    c.voltageSource(1, 0, 5);
    c.resistor(1, 2, 100);
    const q = c.bjt(2, 0, 0, NPN);
    const sol = c.solve();
    expect(sol.transistor(q).region).toBe('cutoff');
    expect(sol.voltage(2)).toBeCloseTo(5, 4);
  });

  it('switches a high-side PNP on when its base is pulled low', () => {
    // Emitter at 5 V (net 1), base through 1 kΩ to ground, collector load 100 Ω to ground (net 3).
    const c = new MnaCircuit(3);
    c.voltageSource(1, 0, 5);
    c.resistor(2, 0, 1000);
    c.resistor(3, 0, 100);
    const q = c.bjt(3, 2, 1, PNP);
    const sol = c.solve();
    const t = sol.transistor(q);
    expect(t.region).toBe('saturation');
    expect(t.control).toBeCloseTo((5 - 0.65) / 1017, 4);
    expect(sol.voltage(3)).toBeGreaterThan(4.7);
  });
});

describe('MOSFET level 1', () => {
  it('is a 22 mΩ switch with 5 V on the gate (triode)', () => {
    const c = new MnaCircuit(3);
    c.voltageSource(1, 0, 12); // drain supply
    c.voltageSource(2, 0, 5); // gate
    c.resistor(1, 3, 10); // 1.2 A load
    const m = c.mosfet(3, 2, 0, NMOS);
    const sol = c.solve();
    const t = sol.transistor(m);
    expect(sol.converged).toBe(true);
    expect(t.region).toBe('linear');
    expect(sol.voltage(3) / t.main).toBeCloseTo(0.022, 3);
  });

  it('limits current in saturation: Id = K·(Vgs − Vth)²', () => {
    const c = new MnaCircuit(3);
    c.voltageSource(1, 0, 12);
    c.voltageSource(2, 0, 2);
    c.resistor(1, 3, 1);
    const m = c.mosfet(3, 2, 0, NMOS);
    const sol = c.solve();
    expect(sol.transistor(m).region).toBe('saturation');
    expect(sol.transistor(m).main).toBeCloseTo(NMOS.k * 0.25, 6);
  });

  it('follows a gate divider (gateScale) and is off below threshold', () => {
    const c = new MnaCircuit(3);
    c.voltageSource(1, 0, 5);
    c.voltageSource(2, 0, 1.6);
    c.resistor(1, 3, 100);
    const m = c.mosfet(3, 2, 0, { ...NMOS, gateScale: 0.9 }); // the gate sees 1.44 V < Vth
    expect(c.solve().transistor(m)).toMatchObject({ region: 'cutoff', main: 0 });
  });

  it('a P-channel switches a high-side load when its gate is pulled below the source', () => {
    const c = new MnaCircuit(3);
    c.voltageSource(1, 0, 5); // source
    c.resistor(2, 0, 10); // load from drain to ground
    c.voltageSource(3, 0, 0); // gate at 0 V: Vgs = −5 V
    const m = c.mosfet(2, 3, 1, { ...NMOS, polarity: 'p' });
    const sol = c.solve();
    expect(sol.transistor(m).region).toBe('linear');
    expect(sol.voltage(2)).toBeCloseTo((5 * 10) / 10.022, 2);
  });

  it('conducts in reverse through its channel when enhanced', () => {
    const c = new MnaCircuit(3);
    c.voltageSource(1, 0, 5); // drives the source side
    c.voltageSource(2, 0, 10); // gate well above both
    c.resistor(3, 0, 10); // load on the drain
    const m = c.mosfet(3, 2, 1, NMOS);
    const sol = c.solve();
    expect(sol.transistor(m).main).toBeLessThan(-0.4); // current flows source → drain
    expect(sol.voltage(3)).toBeGreaterThan(4.9);
  });
});
