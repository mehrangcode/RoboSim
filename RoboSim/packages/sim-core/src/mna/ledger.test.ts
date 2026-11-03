import { describe, expect, it } from 'vitest';
import type { MnaSolution, NetId, ReactiveState } from '../contracts.js';
import { AveragedSolution, GMIN, MnaCircuit } from './circuit.js';
import { currentInto, elementTerminalCurrents, powerInto } from './ledger.js';

/** Σ over every owner of the current into its elements at `net`, plus GMIN to ground: KCL says 0. */
function kclResidual(c: MnaCircuit, s: MnaSolution, net: NetId): number {
  let sum = GMIN * s.voltage(net);
  for (const owner of c.ownerIds()) sum += currentInto(c.elementsOf(owner), net, s);
  return sum;
}

function expectKcl(c: MnaCircuit, s: MnaSolution, tol = 1e-9): void {
  for (let net = 1; net <= c.netCount; net++) expect(Math.abs(kclResidual(c, s, net))).toBeLessThan(tol);
}

const currentsOf = (c: MnaCircuit, owner: number, s: MnaSolution): Map<NetId, number> => {
  const out = new Map<NetId, number>();
  for (const el of c.elementsOf(owner))
    elementTerminalCurrents(el, s, (n, a) => out.set(n, (out.get(n) ?? 0) + a));
  return out;
};

describe('measurement ledger (ADR-026)', () => {
  it('owner tags never change the solution', () => {
    const build = (tag: boolean) => {
      const c = new MnaCircuit(2);
      if (tag) c.beginOwner(0);
      c.voltageSource(1, 0, 5);
      if (tag) c.beginOwner(1);
      c.resistor(1, 2, 220);
      c.diode(2, 0, { vf: 2, rs: 10 });
      return c.solve();
    };
    const a = build(false);
    const b = build(true);
    expect(b.voltage(2)).toBe(a.voltage(2));
    expect(b.diodeCurrent(0 as never)).toBe(a.diodeCurrent(0 as never));
  });

  it('signs per kind: source delivers, resistor and diode absorb, current source draws from `from`', () => {
    const c = new MnaCircuit(3);
    c.beginOwner(0);
    c.voltageSource(1, 0, 5);
    c.beginOwner(1);
    c.resistor(1, 2, 220);
    c.beginOwner(2);
    c.diode(2, 0, { vf: 2, rs: 1e-3 });
    c.beginOwner(3);
    c.currentSource(1, 3, 1e-3);
    c.beginOwner(4);
    c.resistor(3, 0, 1000);
    const s = c.solve();
    const i = (5 - 2) / 220;
    const src = currentsOf(c, 0, s);
    expect(src.get(1)).toBeCloseTo(-(i + 1e-3), 6); // delivering out of + is negative "into"
    expect(currentsOf(c, 1, s).get(1)).toBeCloseTo(i, 4);
    expect(currentsOf(c, 1, s).get(2)).toBeCloseTo(-i, 4);
    expect(currentsOf(c, 2, s).get(2)).toBeCloseTo(i, 4);
    expect(currentsOf(c, 3, s).get(1)).toBeCloseTo(1e-3, 12);
    expect(currentsOf(c, 3, s).get(3)).toBeCloseTo(-1e-3, 12);
    expectKcl(c, s);
  });

  it('power: a source delivering is negative, the loads sum to what it delivers', () => {
    const c = new MnaCircuit(2);
    c.beginOwner(0);
    c.voltageSource(1, 0, 5);
    c.beginOwner(1);
    c.resistor(1, 2, 220);
    c.beginOwner(2);
    c.diode(2, 0, { vf: 2, rs: 1e-3 });
    const s = c.solve();
    const p = [0, 1, 2].map((o) => powerInto(c.elementsOf(o), s));
    expect(p[0]).toBeLessThan(0);
    expect((p[0] ?? 0) + (p[1] ?? 0) + (p[2] ?? 0)).toBeCloseTo(0, 9);
    expect(p[1]).toBeCloseTo(((5 - 2) / 220) ** 2 * 220, 4);
  });

  it('supplyFrom: the branch current returns through `returnNet`, not the sensing node', () => {
    const c = new MnaCircuit(3);
    c.beginOwner(0);
    c.voltageSource(1, 0, 9); // supply
    c.beginOwner(1);
    c.voltageSource(2, 0, 5, 0.1, { supplyFrom: 1 }); // regulator output fed from net 1
    c.beginOwner(2);
    c.resistor(2, 0, 100);
    const s = c.solve();
    const reg = currentsOf(c, 1, s);
    expect(reg.get(2)).toBeCloseTo(-(s.voltage(2) / 100), 9);
    expect(reg.get(1)).toBeCloseTo(s.voltage(2) / 100, 9);
    expect(reg.get(0) ?? 0).toBe(0);
    expectKcl(c, s);
  });

  it('transformer: primary draws ratio·I', () => {
    const c = new MnaCircuit(3);
    c.beginOwner(0);
    c.voltageSource(1, 0, 4);
    c.beginOwner(1);
    c.transformer(1, 0, 2, 0, 2, { seriesResistance: 0.5 });
    c.beginOwner(2);
    c.resistor(2, 0, 50);
    const s = c.solve();
    expectKcl(c, s);
    const t = currentsOf(c, 1, s);
    expect(t.get(1)).toBeCloseTo(2 * -(t.get(2) ?? 0), 9);
  });

  it('BJT and MOSFET terminals balance; NPN/PNP and N/P signs', () => {
    for (const npn of [true, false]) {
      const c = new MnaCircuit(4);
      c.beginOwner(0);
      c.voltageSource(1, 0, npn ? 5 : -5);
      c.beginOwner(1);
      c.resistor(1, 2, 1000); // collector load
      c.resistor(1, 3, 47_000); // base drive
      c.beginOwner(2);
      c.bjt(2, 3, 0, {
        polarity: npn ? 'npn' : 'pnp',
        beta: 100,
        vbe: 0.7,
        rb: 100,
        vceSat: 0.2,
        rceSat: 5,
      });
      const s = c.solve();
      const q = currentsOf(c, 2, s);
      expect(Math.abs((q.get(2) ?? 0) + (q.get(3) ?? 0) + (q.get(0) ?? 0))).toBeLessThan(1e-12);
      expect(Math.sign(q.get(2) ?? 0)).toBe(npn ? 1 : -1);
      expectKcl(c, s, 1e-7);
    }
    for (const n of [true, false]) {
      const c = new MnaCircuit(3);
      c.beginOwner(0);
      c.voltageSource(1, 0, n ? 5 : -5);
      c.voltageSource(3, 0, n ? 5 : -5);
      c.beginOwner(1);
      c.resistor(1, 2, 100);
      c.beginOwner(2);
      c.mosfet(2, 3, 0, { polarity: n ? 'n' : 'p', k: 0.5, vth: 2 });
      const s = c.solve();
      const m = currentsOf(c, 2, s);
      expect(Math.sign(m.get(2) ?? 0)).toBe(n ? 1 : -1);
      expectKcl(c, s, 1e-6);
    }
  });

  it('capacitor branch and transient averaging keep KCL', () => {
    const c = new MnaCircuit(2);
    const state: ReactiveState = { volts: 0, amps: 0 };
    const stamp = () => {
      c.clear();
      c.beginOwner(0);
      c.voltageSource(1, 0, 5);
      c.beginOwner(1);
      c.resistor(1, 2, 1000);
      c.beginOwner(2);
      c.capacitor(2, 0, 1e-6, state);
    };
    stamp();
    const s = c.solve(1e-4);
    expectKcl(c, s);
    expect(currentsOf(c, 2, s).get(2)).toBeGreaterThan(0); // charging
  });

  it('PWM average: currents are exact, phases weight base by 1 − Σduty', () => {
    const solveAt = (volts: number) => {
      const c = new MnaCircuit(1);
      c.beginOwner(-1);
      c.voltageSource(1, 0, volts, 25);
      c.beginOwner(0);
      c.resistor(1, 0, 100);
      return { c, s: c.solve() };
    };
    const low = solveAt(0);
    const high = solveAt(5);
    const avg = new AveragedSolution(low.s, [{ solution: high.s, duty: 0.25 }]);
    expect(avg.phases().map((p) => p.weight)).toEqual([0.75, 0.25]);
    expectKcl(high.c, avg);
    expect(currentInto(high.c.elementsOf(0), 1, avg)).toBeCloseTo(0.25 * (5 / 125), 12);
  });
});
