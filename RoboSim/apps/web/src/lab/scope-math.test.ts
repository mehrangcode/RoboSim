import { MeasureHub, ScopeBuffer, ScopeRecorder, buildRun, type MeasureProbe } from '@robosim/sim-runtime';
import { describe, expect, it } from 'vitest';
import { toCsv } from '../lib/csv.js';
import {
  SLICE_S,
  columns,
  crossings,
  findTrigger,
  measure,
  scopeRows,
  steps125,
  sweep,
  triggers,
  valueAt,
} from './scope-math.js';

/** A one-channel buffer from `f(k)` = `[avg, min, max]` for slices `from` … `from + n − 1`. */
function buffer(n: number, f: (k: number) => readonly [number, number, number], from = 0, pwm?: number[]) {
  const data = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) data.set(f(from + k), 3 * k);
  const b = new ScopeBuffer(1);
  b.append(from, n, data, pwm ? Float64Array.from(pwm) : undefined);
  return b;
}
const plain = (f: (k: number) => number) => (k: number) => [f(k), f(k), f(k)] as const;

describe('trigger (TD §18.3)', () => {
  it('interpolates the crossing between readings', () => {
    const b = buffer(
      100,
      plain((k) => k / 10),
    ); // 0.1 V per ms
    const [t] = crossings(b, 0, 0, 0.1, 2.55, 'rising');
    expect(t).toBeCloseTo(0.0255, 9);
    expect(crossings(b, 0, 0, 0.1, 2.55, 'falling')).toEqual([]);
    expect(findTrigger(b, 0, { edge: 'rising', level: 2.55, holdoffS: 0 }, 0)).toBeCloseTo(0.0255, 9);
  });

  it('holdoff skips crossings too soon after the last trigger', () => {
    const square = buffer(
      200,
      plain((k) => (Math.floor(k / 5) % 2 ? 5 : 0)),
    ); // 100 Hz
    const all = triggers(square, 0, { edge: 'rising', level: 2.5, holdoffS: 0 }, 0, 0.2);
    expect(all.length).toBeGreaterThanOrEqual(19);
    all.slice(1).forEach((t, i) => expect(t - (all[i] ?? 0)).toBeCloseTo(0.01, 9));
    const held = triggers(square, 0, { edge: 'rising', level: 2.5, holdoffS: 0.015 }, 0, 0.2);
    held.slice(1).forEach((t, i) => expect(t - (held[i] ?? 0)).toBeCloseTo(0.02, 9));
  });

  it('auto free-runs, normal holds, single freezes after arming', () => {
    const flat = buffer(
      1000,
      plain(() => 1),
    );
    const opts = { edge: 'rising', level: 2.5, holdoffS: 0 } as const;
    const prev = { from: 0.3, frozen: false, armedAt: 0 };
    expect(sweep(flat, 0, { ...opts, mode: 'auto' }, 0.1, prev)).toMatchObject({ status: 'auto' });
    expect(sweep(flat, 0, { ...opts, mode: 'auto' }, 0.1, prev).from).toBeCloseTo(0.899, 9);
    expect(sweep(flat, 0, { ...opts, mode: 'normal' }, 0.1, prev)).toEqual({
      from: 0.3,
      status: 'waiting',
      frozen: false,
    });
    const sq = buffer(
      1000,
      plain((k) => (Math.floor(k / 50) % 2 ? 5 : 0)),
    );
    const single = sweep(sq, 0, { ...opts, mode: 'single' }, 0.1, {
      from: null,
      frozen: false,
      armedAt: 0.5,
    });
    expect(single.status).toBe('triggered');
    expect(single.frozen).toBe(true);
    expect((single.from ?? 0) + 0.01).toBeGreaterThan(0.5); // a trigger after arming, 10 % pre-trigger
    expect(sweep(sq, 0, { ...opts, mode: 'single' }, 0.1, { ...single, armedAt: 0.5 })).toEqual(single);
  });
});

describe('cursor measurements', () => {
  it('RMS of a sampled sine is A/√2 within 0.5 %', () => {
    const A = 3;
    const sine = buffer(
      1000,
      plain((k) => A * Math.sin(2 * Math.PI * 50 * k * SLICE_S)),
    );
    const m = measure(sine, 0, 0, 0.999);
    expect(m?.rms).toBeCloseTo(A / Math.SQRT2, 1);
    expect(Math.abs((m?.rms ?? 0) / (A / Math.SQRT2) - 1)).toBeLessThan(0.005);
    expect(m?.freqHz).toBeCloseTo(50, 0);
    expect(m?.avg).toBeCloseTo(0, 2);
  });

  it('frequency is "—" (null) with fewer than 2 crossings', () => {
    expect(
      measure(
        buffer(
          100,
          plain(() => 2),
        ),
        0,
        0,
        0.1,
      )?.freqHz,
    ).toBeNull();
  });

  it('timer-555: frequency within 2 % of 1/(ln2·(R1+2R2)·C)', { timeout: 120_000 }, () => {
    const run = buildRun({ scenario: 'timer-555' });
    const hub = new MeasureHub(run);
    const probe: MeasureProbe = { kind: 'v', red: { part: 'timer', pin: 'out' }, black: null };
    const rec = hub.set('scope', [probe]);
    run.circuit.sim.addObserver(hub);
    const buf = new ScopeBuffer(1);
    for (let k = 0; k < 60; k++) {
      run.circuit.sim.run(100);
      const d = rec?.drain(run.circuit.sim);
      if (d) buf.append(d.fromSlice, d.slices, d.data, d.pwm);
    }
    const expected = 1 / (Math.LN2 * (1000 + 2 * 68_000) * 10e-6);
    const m = measure(buf, 0, 1, 6); // after the first charge from 0 V
    expect(Math.abs((m?.freqHz ?? 0) / expected - 1)).toBeLessThan(0.02);
  });
});

describe('RC charge curve (Release Plan IT-3 exit)', () => {
  it('rc-charge: τ read with the scope is within 2 % of R·C = 1 s', { timeout: 120_000 }, () => {
    const run = buildRun({ scenario: 'rc-charge' });
    const hub = new MeasureHub(run);
    const rec = hub.set('scope', [
      { kind: 'v', red: { part: 'c', pin: 'pos' }, black: null },
      { kind: 'v', red: { part: 'board', pin: 'D7' }, black: null },
    ]);
    run.circuit.sim.addObserver(hub);
    const buf = new ScopeBuffer(2);
    for (let k = 0; k < 35; k++) {
      run.circuit.sim.run(100);
      const d = rec?.drain(run.circuit.sim);
      if (d) buf.append(d.fromSlice, d.slices, d.data, d.pwm);
    }
    const high = buf.value(1, buf.end - 1);
    // D7 goes high in setup(), before or at the first reading: the charge starts in that slice (±1 ms).
    let first = buf.start;
    while (first < buf.end && !(buf.value(1, first) > high / 2)) first++;
    const start = crossings(buf, 1, 0, 3.5, high / 2, 'rising')[0] ?? (first - 1) * SLICE_S;
    const [at63] = crossings(buf, 0, 0, 3.5, high * (1 - Math.exp(-1)), 'rising');
    expect(start).toBeDefined();
    expect(Math.abs((at63 ?? 0) - (start ?? 0) - 1)).toBeLessThan(0.02);
  });
});

describe('PWM rebuilt from the timer (US-SIM-10 AC1)', () => {
  // D5 at analogWrite 128: 976.5625 Hz, 50 %, between 0 and 5 V.
  const pwm = (freqHz: number, duty: number) => buffer(1000, () => [5 * duty, 0, 5], 0, [0, 0, freqHz, duty]);

  for (const [pin, hz] of [
    ['D5', 976.5625],
    ['D9', 490.196],
  ] as const) {
    it(`${pin} at ${hz} Hz: square 0/5 V, stable rising triggers, cursor frequency within 2 %`, () => {
      const b = pwm(hz, 0.5);
      expect(valueAt(b, 0, 0.1 / hz)).toBe(5);
      expect(valueAt(b, 0, 0.6 / hz)).toBe(0);
      const opts = { edge: 'rising', level: 2.5, holdoffS: 0 } as const;
      const t = triggers(b, 0, opts, 0.1, 0.2);
      // Every trigger sits on a period boundary: successive sweeps line up (a stable trace).
      for (const x of t) expect(frac(x * hz)).toBeCloseTo(0, 6);
      const m = measure(b, 0, 0.1, 0.2);
      expect(Math.abs((m?.freqHz ?? 0) / hz - 1)).toBeLessThan(0.02);
      expect(m?.avg).toBeCloseTo(2.5, 5);
      expect(m?.rms).toBeCloseTo(5 / Math.SQRT2, 4);
      const s1 = sweep(b, 0, { ...opts, mode: 'normal' }, 0.005, { from: null, frozen: false, armedAt: 0 });
      expect(frac(((s1.from ?? 0) + 0.0005) * hz)).toBeCloseTo(0, 6);
    });
  }

  it('columns show crisp edges zoomed in and a min/max band zoomed out', () => {
    const b = pwm(976.5625, 0.5);
    const fine = columns(b, 0, 0.1, 0.105, 500); // 10 µs per column
    expect([...fine.edge].filter(Boolean).length).toBeGreaterThanOrEqual(9);
    expect(new Set(fine.avg)).toEqual(new Set([0, 5]));
    const coarse = columns(b, 0, 0, 0.9, 90); // 10 ms per column
    expect(coarse.lo[3]).toBe(0);
    expect(coarse.hi[3]).toBe(5);
    expect(coarse.avg[3]).toBeCloseTo(2.5, 5);
  });
});

describe('CSV export (US-SIM-10 AC3)', () => {
  it('time in ms and each channel in its unit; round-trips', () => {
    const data = new Float32Array(10 * 2 * 3);
    for (let k = 0; k < 10; k++)
      data.set([k / 3, k / 3 - 0.1, k / 3 + 0.1, k * 1e-3, k * 1e-3, k * 1e-3], 6 * k);
    const b = new ScopeBuffer(2);
    b.append(40, 10, data);
    const rows = scopeRows(b, [
      { name: 'ch1', unit: 'V' },
      { name: 'ch2', unit: 'A' },
    ]);
    expect(rows[0]).toEqual([
      'time_ms',
      'ch1_avg_V',
      'ch1_min_V',
      'ch1_max_V',
      'ch2_avg_A',
      'ch2_min_A',
      'ch2_max_A',
    ]);
    const csv = toCsv(rows);
    const parsed = csv
      .replace(/^\uFEFF/, '')
      .trim()
      .split('\r\n')
      .slice(1)
      .map((l) => l.split(',').map(Number));
    expect(parsed).toHaveLength(10);
    parsed.forEach((row, k) => {
      expect(row[0]).toBe(40 + k);
      for (let c = 0; c < 6; c++)
        expect(row[c + 1]).toBeCloseTo(b.value(c >= 3 ? 1 : 0, 40 + k, (c % 3) as 0 | 1 | 2), 5);
    });
    expect(scopeRows(b, [{ name: 'ch1', unit: 'V' }], 0.045, 0.047).map((r) => r[0])).toEqual([
      'time_ms',
      45,
      46,
      47,
    ]);
  });
});

describe('steps125', () => {
  it('lists 1-2-5 steps', () => {
    expect(steps125(0.0005, 1)).toEqual([0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1]);
  });
});

function frac(x: number): number {
  const f = x - Math.round(x);
  return Math.abs(f);
}

describe('fine mode (TD §18.3 phase 2)', () => {
  it('between readings the trace follows the sub-steps: value, crossings and the column band', () => {
    const b = buffer(
      10,
      plain(() => 0),
    );
    // Slice 5 ((4, 5] ms): a 10 V pulse from 4.2 to 4.6 ms, then back to 0 at 5 ms.
    b.appendFine(
      true,
      Float64Array.from([0, 0.0042, 0, 0, 0.0043, 10, 0, 0.0046, 10, 0, 0.0047, 0, 0, 0.005, 0]),
    );
    expect(valueAt(b, 0, 0.00445)).toBe(10);
    expect(valueAt(b, 0, 0.00425)).toBeCloseTo(5, 6);
    expect(valueAt(b, 0, 0.0025)).toBe(0); // no sub-steps there: linear between readings
    const up = crossings(b, 0, 0, 0.009, 5, 'rising');
    const down = crossings(b, 0, 0, 0.009, 5, 'falling');
    expect(up).toHaveLength(1);
    expect(up[0]).toBeCloseTo(0.00425, 9);
    expect(down[0]).toBeCloseTo(0.00465, 9);
    const cols = columns(b, 0, 0.004, 0.005, 10); // 100 µs per column
    expect(cols.hi[0]).toBe(0); // the slice's envelope does not smear across the whole slice
    expect(cols.hi[2]).toBeCloseTo(10, 6);
    expect(cols.avg[5]).toBe(10);
  });

  it('no-flyback: fine mode resolves the kickback spike the 1 kHz readings average away', () => {
    const run = buildRun({ scenario: 'no-flyback' });
    const hub = new MeasureHub(run);
    hub.setFine(true);
    const probe: MeasureProbe = { kind: 'v', red: { part: 'q', pin: 'c' }, black: null };
    const rec = hub.set('scope', [probe]);
    run.circuit.sim.addObserver(hub);
    const coarse = new ScopeBuffer(1);
    const fine = new ScopeBuffer(1);
    for (let i = 0; i < 20; i++) {
      run.circuit.sim.run(100);
      const d = rec?.drain(run.circuit.sim);
      if (!d) break;
      coarse.append(d.fromSlice, d.slices, d.data);
      fine.append(d.fromSlice, d.slices, d.data);
      const f = rec instanceof ScopeRecorder ? rec.drainFine(run.circuit.sim) : null;
      if (f) fine.appendFine(f.reactive, f.data);
    }
    const peak = (b: ScopeBuffer) =>
      Math.max(
        ...columns(b, 0, b.start * SLICE_S, (b.end - 1) * SLICE_S, 40_000).avg.filter(Number.isFinite),
      );
    expect(peak(fine)).toBeGreaterThan(20);
    expect(peak(fine)).toBeGreaterThan(peak(coarse) + 10);
  });
});
