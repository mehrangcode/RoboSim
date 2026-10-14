import { describe, expect, it } from 'vitest';
import { MnaCircuit } from './circuit.js';
import { SingularMatrixError, luSolveInPlace } from './lu.js';

const TOL = 1e-9;

describe('luSolveInPlace', () => {
  it('solves a system that needs pivoting', () => {
    const a = Float64Array.from([0, 2, 1, 1, 1, 1, 2, 1, 0]);
    const b = Float64Array.from([5, 4, 4]); // x = [1, 2, 1]
    luSolveInPlace(a, b, 3);
    expect(Array.from(b).map((v) => Math.round(v * 1e12) / 1e12)).toEqual([1, 2, 1]);
  });

  it('throws on a singular matrix', () => {
    expect(() => luSolveInPlace(Float64Array.from([1, 2, 2, 4]), Float64Array.from([1, 2]), 2)).toThrow(
      SingularMatrixError,
    );
  });
});

describe('MnaCircuit', () => {
  it('solves a voltage divider', () => {
    const c = new MnaCircuit(2);
    const src = c.voltageSource(1, 0, 9);
    c.resistor(1, 2, 1000);
    c.resistor(2, 0, 2000);
    const s = c.solve();
    expect(s.converged).toBe(true);
    expect(s.voltage(1)).toBeCloseTo(9, 9);
    expect(s.voltage(2)).toBeCloseTo(6, 6);
    expect(s.sourceCurrent(src)).toBeCloseTo(3e-3, 9);
  });

  it('applies the series resistance of a real source (battery sag)', () => {
    const c = new MnaCircuit(1);
    const bat = c.voltageSource(1, 0, 9, 1);
    c.resistor(1, 0, 8); // 9 V / (1 + 8) Ω = 1 A
    const s = c.solve();
    expect(s.sourceCurrent(bat)).toBeCloseTo(1, 9);
    expect(s.voltage(1)).toBeCloseTo(8, 9);
  });

  it('honours current-source direction', () => {
    const c = new MnaCircuit(1);
    c.currentSource(0, 1, 2e-3); // 2 mA pushed into node 1
    c.resistor(1, 0, 1000);
    expect(c.solve().voltage(1)).toBeCloseTo(2, 6);
  });

  it('turns an LED on through a resistor (PWL model)', () => {
    // 5 V → 220 Ω → LED (Vf 2 V, Rs 10 Ω) → GND: I = 3 / 230 A
    const c = new MnaCircuit(2);
    c.voltageSource(1, 0, 5);
    c.resistor(1, 2, 220);
    const led = c.diode(2, 0, { vf: 2, rs: 10 });
    const s = c.solve();
    expect(s.converged).toBe(true);
    expect(Math.abs(s.diodeCurrent(led) - 3 / 230)).toBeLessThan(TOL);
    expect(s.voltage(2)).toBeCloseTo(2 + (10 * 3) / 230, 6);
  });

  it('keeps a reverse-biased LED off', () => {
    const c = new MnaCircuit(2);
    c.voltageSource(1, 0, 5);
    c.resistor(1, 2, 220);
    const led = c.diode(0, 2, { vf: 2, rs: 10 });
    const s = c.solve();
    expect(Math.abs(s.diodeCurrent(led))).toBeLessThan(1e-8);
    expect(s.voltage(2)).toBeCloseTo(5, 5);
  });

  it('keeps an LED off below its forward voltage', () => {
    const c = new MnaCircuit(2);
    c.voltageSource(1, 0, 1.5);
    c.resistor(1, 2, 220);
    const led = c.diode(2, 0, { vf: 2, rs: 10 });
    expect(Math.abs(c.solve().diodeCurrent(led))).toBeLessThan(1e-8);
  });

  it('resolves parallel LEDs with different Vf (only the lower one conducts)', () => {
    const c = new MnaCircuit(2);
    c.voltageSource(1, 0, 5);
    c.resistor(1, 2, 100);
    const red = c.diode(2, 0, { vf: 1.8, rs: 5 });
    const blue = c.diode(2, 0, { vf: 3.0, rs: 5 });
    const s = c.solve();
    expect(s.converged).toBe(true);
    expect(s.diodeCurrent(red)).toBeCloseTo(3.2 / 105, 7); // off LED leaks ~2 nA
    expect(Math.abs(s.diodeCurrent(blue))).toBeLessThan(1e-8);
  });

  it('gives floating nets a defined voltage via GMIN instead of failing', () => {
    const c = new MnaCircuit(3);
    c.voltageSource(1, 0, 5);
    c.resistor(2, 3, 1000); // island not connected to anything
    const s = c.solve();
    expect(s.voltage(2)).toBe(0);
    expect(s.voltage(3)).toBe(0);
  });

  it('rejects nets outside the circuit and invalid values', () => {
    const c = new MnaCircuit(1);
    expect(() => c.resistor(1, 2, 10)).toThrow(RangeError);
    expect(() => c.resistor(1, 0, 0)).toThrow(RangeError);
    expect(() => c.conductance(1, 0, -1)).toThrow(RangeError);
  });

  it('clear() drops elements so the circuit can be restamped', () => {
    const c = new MnaCircuit(1);
    c.voltageSource(1, 0, 5);
    c.clear();
    c.voltageSource(1, 0, 3);
    expect(c.solve().voltage(1)).toBeCloseTo(3, 9);
  });
});

describe('MnaCircuit branch elements', () => {
  it('voltageSource supplyFrom draws the output current from another net (linear regulator)', () => {
    // 9 V battery (1 Ω) → regulator input (net 1); regulator 5 V output (net 2) → 50 Ω load
    const c = new MnaCircuit(2);
    const bat = c.voltageSource(1, 0, 9, 1);
    const reg = c.voltageSource(2, 0, 5, 0, { supplyFrom: 1 });
    c.resistor(2, 0, 50);
    const s = c.solve();
    expect(s.voltage(2)).toBeCloseTo(5, 9);
    expect(s.sourceCurrent(reg)).toBeCloseTo(0.1, 9);
    expect(s.sourceCurrent(bat)).toBeCloseTo(0.1, 9); // same current flows from the battery
    expect(s.voltage(1)).toBeCloseTo(8.9, 9);
  });

  it('transformer models a PWM-averaged bridge: Vout = d·Vin − offset, Iin = d·Iout', () => {
    const c = new MnaCircuit(2);
    const supply = c.voltageSource(1, 0, 12);
    const out = c.transformer(1, 0, 2, 0, 0.5, { offsetV: 1, seriesResistance: 0 });
    c.resistor(2, 0, 10);
    const s = c.solve();
    expect(s.voltage(2)).toBeCloseTo(5, 9); // 0.5·12 − 1
    expect(s.sourceCurrent(out)).toBeCloseTo(0.5, 9);
    expect(s.sourceCurrent(supply)).toBeCloseTo(0.25, 9); // d × Iout
  });
});
