import { describe, expect, it } from 'vitest';
import { findDefinition } from '@robosim/catalog';
import { GMIN, currentInto, elementTerminalCurrents, ohmmeter } from '@robosim/sim-core';
import type { ProjectDocument } from '@robosim/shared';
import { SimClient } from './client.js';
import { SimHost } from './host.js';
import { SCENARIOS, type Frame, type MeasureProbe, type WorkerToMain } from './protocol.js';
import { buildRun, builtinSource } from './scenarios.js';
import { MeasureHub, ScopeRecorder } from './measure.js';

type Part = {
  id: string;
  type: string;
  props?: Record<string, unknown>;
  inputs?: Record<string, number | boolean>;
};
type Wire = readonly [string, string, string, string]; // from part, pin, to part, pin

/** A bench project from parts and wires, on the blink demo's board and firmware. */
function project(parts: readonly Part[], wires: readonly Wire[]) {
  const base = builtinSource('blink');
  const doc: ProjectDocument = {
    ...base.project,
    components: parts.map((p, i) => ({
      id: p.id,
      type: p.type,
      typeVersion: findDefinition(p.type).manifest.version,
      x: 20 * i,
      y: 0,
      rotation: 0,
      flipped: false,
      props: p.props ?? {},
      ...(p.inputs ? { inputs: p.inputs } : {}),
    })) as ProjectDocument['components'],
    wires: wires.map(([fp, fpin, tp, tpin], i) => ({
      id: `w${i}`,
      from: { part: fp, pin: fpin },
      to: { part: tp, pin: tpin },
      color: 'black',
      points: [],
    })) as ProjectDocument['wires'],
  };
  return { project: doc, firmware: base.firmware };
}

/** 5 V → 220 Ω → red LED → GND. */
const ledProject = () =>
  project(
    [
      { id: 'r1', type: 'passive.resistor', props: { ohms: 220 } },
      { id: 'led', type: 'actuator.led', props: { color: 'red' } },
    ],
    [
      ['board', '5V', 'r1', 'a'],
      ['r1', 'b', 'led', 'a'],
      ['led', 'k', 'board', 'GND1'],
    ],
  );

function harness() {
  let wall = 0;
  const messages: WorkerToMain[] = [];
  const client = new SimClient();
  const host = new SimHost(
    (m) => {
      messages.push(m);
      client.receive(m);
    },
    () => wall,
  );
  return {
    host,
    client,
    messages,
    advance(ms: number) {
      for (let t = 0; t < ms; t += 16) {
        wall += 16;
        host.tick();
      }
    },
    measures: () =>
      messages.filter((m): m is Extract<WorkerToMain, { type: 'measures' }> => m.type === 'measures'),
  };
}

const METER: readonly MeasureProbe[] = [
  { kind: 'i', pins: [{ part: 'led', pin: 'a' }], scale: 1 },
  { kind: 'v', red: { part: 'r1', pin: 'a' }, black: { part: 'r1', pin: 'b' } },
  { kind: 'v', red: { part: 'led', pin: 'a' }, black: null },
  { kind: 'p', part: 'r1' },
  { kind: 'v', red: { part: 'ghost', pin: 'a' }, black: null },
  { kind: 'v', red: { part: 'board', pin: 'VIN' }, black: null },
];

describe('measurement channel (FR-SIM-13, ADR-026)', () => {
  it('US-SIM-09 AC1: LED + 220 Ω at 5 V reads 13–14 mA, ≈3 V across the resistor, live and paused', () => {
    const h = harness();
    h.host.handle({ type: 'load', ...ledProject() });
    h.host.handle({ type: 'measure', channel: 'meter', probes: METER });
    // Paused: one sample of the operating point (0 slices).
    const paused = h.measures().at(-1);
    expect(paused).toMatchObject({ channel: 'meter', slices: 0, unresolved: [4, 5] });
    h.host.handle({ type: 'control', action: 'run' });
    h.advance(300);
    const r = h.client.readings('meter');
    if (!r) throw new Error('no readings');
    const [i, vr, vled, p, ghost, vin] = r;
    expect(i?.avg).toBeGreaterThan(0.013);
    expect(i?.avg).toBeLessThan(0.014);
    expect(vr?.avg).toBeGreaterThan(2.8);
    expect(vr?.avg).toBeLessThan(3.2);
    expect(vled?.avg).toBeGreaterThan(1.7);
    expect(p?.avg).toBeCloseTo((vr?.avg ?? 0) * (i?.avg ?? 0), 4);
    expect(ghost?.avg).toBeNaN();
    expect(vin?.avg).toBeNaN();
    const running = h.measures().filter((m) => m.slices > 0);
    expect(running.length).toBeGreaterThan(3);
    // Contiguous batches: every slice is counted once.
    for (let k = 1; k < running.length; k++)
      expect(running[k]?.fromSlice).toBe((running[k - 1]?.fromSlice ?? 0) + (running[k - 1]?.slices ?? 0));
  });

  it('survives a reset and a new load; probes: null unsubscribes', () => {
    const h = harness();
    h.host.handle({ type: 'load', ...ledProject() });
    h.host.handle({ type: 'measure', channel: 'meter', probes: METER.slice(0, 1) });
    h.host.handle({ type: 'control', action: 'reset' });
    h.host.handle({ type: 'control', action: 'step' });
    const after = h.measures().at(-1);
    expect(after?.slices).toBe(10);
    expect(after?.data[0]).toBeGreaterThan(0.013);
    h.host.handle({ type: 'measure', channel: 'meter', probes: null });
    const n = h.measures().length;
    h.host.handle({ type: 'control', action: 'step' });
    expect(h.measures().length).toBe(n);
  });

  it('the logger stays the last observer: input-log entries never mention the meter', () => {
    const h = harness();
    h.host.handle({ type: 'load', ...ledProject() });
    h.host.handle({ type: 'measure', channel: 'meter', probes: METER });
    h.host.handle({ type: 'control', action: 'step' });
    h.host.handle({ type: 'exportLog' });
    const log = h.messages.find((m) => m.type === 'inputLog');
    expect(log && 'log' in log ? log.log.entries : null).toEqual([]);
  });

  it('US-SIM-09 AC2: Ω refuses while running; 10 kΩ reads ±1 % when stopped; caches per state', () => {
    const h = harness();
    h.host.handle({
      type: 'load',
      ...project(
        [{ id: 'r10k', type: 'passive.resistor', props: { ohms: 10_000 } }],
        [['r10k', 'b', 'board', 'GND1']],
      ),
    });
    const answers: unknown[] = [];
    h.client.onOhms = (a) => answers.push(a);
    h.host.handle({ type: 'control', action: 'run' });
    h.host.handle({
      type: 'ohms',
      id: 1,
      red: { part: 'r10k', pin: 'a' },
      black: { part: 'r10k', pin: 'b' },
    });
    h.host.handle({ type: 'control', action: 'pause' });
    h.host.handle({
      type: 'ohms',
      id: 2,
      red: { part: 'r10k', pin: 'a' },
      black: { part: 'r10k', pin: 'b' },
    });
    h.host.handle({ type: 'ohms', id: 3, red: { part: 'r10k', pin: 'a' }, black: null });
    h.host.handle({ type: 'ohms', id: 4, red: { part: 'nope', pin: 'a' }, black: null });
    expect(answers[0]).toEqual({ type: 'ohms', id: 1, ohms: null, reason: 'running' });
    const two = answers[1] as { ohms: number };
    expect(two.ohms).toBeGreaterThan(9900);
    expect(two.ohms).toBeLessThan(10_100);
    expect((answers[2] as { ohms: number }).ohms).toBeCloseTo(two.ohms, 6); // b is on GND
    expect(answers[3]).toMatchObject({ id: 4, ohms: null, reason: 'unresolved' });
  });

  it('Ω on the document being edited: no run needed, OL across an open pair', () => {
    const h = harness();
    const answers: unknown[] = [];
    h.client.onOhms = (a) => answers.push(a);
    const { project: doc } = project(
      [
        { id: 'r', type: 'passive.resistor', props: { ohms: 10_000 } },
        { id: 'r2', type: 'passive.resistor', props: { ohms: 330 } },
      ],
      [['r', 'b', 'board', 'GND2']],
    );
    h.host.handle({ type: 'ohms', id: 1, red: { part: 'r', pin: 'a' }, black: null, project: doc });
    h.host.handle({
      type: 'ohms',
      id: 2,
      red: { part: 'r', pin: 'a' },
      black: { part: 'r2', pin: 'a' },
      project: doc,
    });
    h.host.handle({
      type: 'ohms',
      id: 3,
      red: { part: 'r2', pin: 'a' },
      black: { part: 'r2', pin: 'b' },
      project: doc,
    });
    expect((answers[0] as { ohms: number }).ohms).toBeCloseTo(10_000, -1);
    expect(answers[1]).toMatchObject({ id: 2, ohms: null, reason: 'open' });
    expect((answers[2] as { ohms: number }).ohms).toBeCloseTo(330, 0);
  });

  it('meter running alongside does not change the run (frames and input log identical)', () => {
    const plain = harness();
    const metered = harness();
    for (const h of [plain, metered]) h.host.handle({ type: 'load', scenario: 'blink' });
    metered.host.handle({
      type: 'measure',
      channel: 'meter',
      probes: [
        { kind: 'v', red: { part: 'board', pin: 'D13' }, black: null },
        { kind: 'i', pins: [{ part: 'board', pin: 'D13' }], scale: -1 },
        { kind: 'p', part: 'led' },
      ],
    });
    const strip = (f: Frame | null) => (f ? { ...f, seq: 0, rtf: 0 } : null);
    for (let k = 0; k < 120; k++)
      for (const h of [plain, metered]) h.host.handle({ type: 'control', action: 'step' });
    expect(strip(metered.client.frame)).toEqual(strip(plain.client.frame));
    const r = metered.client.readings('meter');
    expect(r?.[0]?.max).toBeGreaterThan(4.5); // D13 high part of the time
  });
});

describe('determinism with the meter attached (US-SIM-09 AC4)', () => {
  for (const id of ['blink', 'line-follower'] as const) {
    it(`${id}: bit-identical state with every probe kind subscribed`, { timeout: 120_000 }, () => {
      const plain = buildRun({ scenario: id });
      const metered = buildRun({ scenario: id });
      const parts = metered.circuit.assembled.parts;
      const hub = new MeasureHub(metered);
      const pins = parts.flatMap((p) => Object.keys(p.pins).map((pin) => ({ part: p.id, pin })));
      hub.set('meter', [
        ...pins.slice(0, 3).map((ref): MeasureProbe => ({ kind: 'v', red: ref, black: null })),
        { kind: 'i', pins: pins.slice(0, 2), scale: 1 },
        ...parts.slice(0, 3).map((p): MeasureProbe => ({ kind: 'p', part: p.id })),
      ]);
      metered.circuit.sim.addObserver(hub);
      const slices = id === 'blink' ? 2500 : 2000;
      plain.circuit.sim.run(slices);
      metered.circuit.sim.run(slices);
      expect(metered.circuit.sim.snapshot()).toEqual(plain.circuit.sim.snapshot());
      expect(metered.world?.bodies()).toEqual(plain.world?.bodies());
    });
  }
});

describe('Ω meter on a fresh static instance (TD §18.2 point 4)', () => {
  const run = (parts: readonly Part[], wires: readonly Wire[]) => buildRun(project(parts, wires));
  const ohms = (s: ReturnType<typeof run>, a: string, b: string, state = {}) =>
    ohmmeter(s.circuit.assembled, state, s.circuit.net(a), s.circuit.net(b));

  it('1 kΩ reads 1000 Ω ±0.1 %', () => {
    const s = run([{ id: 'r', type: 'passive.resistor', props: { ohms: 1000 } }], []);
    const r = ohms(s, 'r.a', 'r.b');
    expect(r).toBeGreaterThan(999);
    expect(r).toBeLessThan(1001);
  });

  it('a forward diode reads finite, reversed reads OL', () => {
    const s = run([{ id: 'd', type: 'semiconductor.diode-1n4148' }], []);
    const fwd = ohms(s, 'd.a', 'd.k');
    expect(fwd).not.toBeNull();
    expect(fwd).toBeGreaterThan(100);
    expect(fwd).toBeLessThan(2000);
    expect(ohms(s, 'd.k', 'd.a')).toBeNull();
  });

  it('a pot reads its current input', () => {
    const s = run([{ id: 'pot', type: 'passive.potentiometer', inputs: { position: 0.5 } }], []);
    const full = ohms(s, 'pot.a', 'pot.b') ?? 0;
    const half = ohms(s, 'pot.a', 'pot.wiper') ?? 0;
    const quarter =
      ohms(s, 'pot.a', 'pot.wiper', { inputs: [{ componentId: 'pot', name: 'position', value: 0.25 }] }) ?? 0;
    expect(half).toBeCloseTo(full / 2, -1);
    expect(Math.abs(quarter - half)).toBeGreaterThan(full / 10);
  });

  it('the battery is removed from the measurement (power off) and the live run is untouched', () => {
    const s = run(
      [
        { id: 'bat', type: 'power.battery-9v' },
        { id: 'r', type: 'passive.resistor', props: { ohms: 4700 } },
      ],
      [
        ['bat', 'pos', 'r', 'a'],
        ['r', 'b', 'bat', 'neg'],
      ],
    );
    s.circuit.sim.run(5);
    const before = s.circuit.sim.snapshot();
    const r = ohms(s, 'r.a', 'r.b');
    expect(r).toBeGreaterThan(4700 * 0.99);
    expect(r).toBeLessThan(4700 * 1.01);
    expect(s.circuit.sim.snapshot()).toEqual(before);
  });
});

describe('KCL audit per catalogue part (TD §18.2 risks)', () => {
  it(
    'every net balances, and no part sends current into a net that is not one of its pins',
    { timeout: 300_000 },
    () => {
      const offenders: string[] = [];
      const types = new Set<string>();
      for (const id of SCENARIOS) {
        const s = buildRun({ scenario: id });
        const sim = s.circuit.sim;
        sim.run(300);
        const { ledger } = sim;
        const sol = sim.currentSolution;
        for (let net = 1; net <= ledger.netCount; net++) {
          let sum = GMIN * sol.voltage(net);
          for (const o of ledger.ownerIds()) sum += currentInto(ledger.elementsOf(o), net, sol);
          if (Math.abs(sum) > 1e-6) offenders.push(`${id} net ${net}: KCL ${sum}`);
        }
        // Nets that belong to someone: any part pin, any MCU pin, ground.
        const owned = new Set<number>([0, ...s.circuit.assembled.mcuPins.map((p) => p.net)]);
        for (const p of s.circuit.assembled.parts) for (const n of Object.values(p.pins)) owned.add(n);
        for (const part of s.circuit.assembled.parts) {
          types.add(part.def.manifest.id);
          const owner = sim.ledgerOwner(part.id);
          if (owner === undefined) continue;
          const own = new Set(Object.values(part.pins));
          const into = new Map<number, number>();
          for (const el of ledger.elementsOf(owner))
            elementTerminalCurrents(el, sol, (n, a) => into.set(n, (into.get(n) ?? 0) + a));
          for (const [n, a] of into)
            if (!own.has(n) && owned.has(n) && Math.abs(a) > 1e-9)
              offenders.push(`${id}: ${part.def.manifest.id} (${part.id}) puts ${a} A into foreign net ${n}`);
        }
      }
      expect(offenders).toEqual([]);
      expect(types.size).toBeGreaterThan(40);
    },
  );
});

describe('scope channel (FR-SIM-14, TD §18.3)', () => {
  /** Scope readings of `probes` over `slices` slices of a built-in run, as `[avg, min, max]` rows. */
  function scope(
    id: 'timer-555' | 'no-flyback' | 'rgb-melody',
    probes: readonly MeasureProbe[],
    slices: number,
  ) {
    const run = buildRun({ scenario: id });
    const hub = new MeasureHub(run);
    const rec = hub.set('scope', probes);
    run.circuit.sim.addObserver(hub);
    const rows: { avg: number; min: number; max: number }[][] = [];
    let pwm: number[] = [];
    for (let done = 0; done < slices; done += 100) {
      run.circuit.sim.run(100);
      const d = rec?.drain(run.circuit.sim);
      if (!d) break;
      for (let k = 0; k < d.slices; k++)
        rows.push(
          probes.map((_, c) => {
            const o = (k * probes.length + c) * 3;
            return { avg: d.data[o] ?? NaN, min: d.data[o + 1] ?? NaN, max: d.data[o + 2] ?? NaN };
          }),
        );
      if (d.pwm) pwm = [...pwm, ...d.pwm];
    }
    return { rows, pwm };
  }
  const on = (part: string, pin: string): MeasureProbe => ({ kind: 'v', red: { part, pin }, black: null });

  it('timer-555: the envelope max of the output net exceeds the slice average at its edges', () => {
    const { rows } = scope('timer-555', [on('timer', 'out')], 4000);
    expect(rows).toHaveLength(4000);
    const excess = Math.max(...rows.map(([r]) => (r?.max ?? 0) - (r?.avg ?? 0)));
    expect(excess).toBeGreaterThan(1);
    for (const [r] of rows) expect(r?.min).toBeLessThanOrEqual(r?.avg ?? NaN);
  });

  it('no-flyback: the inductive kickback on the collector is visible in max, hidden by the average', () => {
    const { rows } = scope('no-flyback', [on('q', 'c')], 4000);
    const peak = Math.max(...rows.map(([r]) => r?.max ?? 0));
    const avgPeak = Math.max(...rows.map(([r]) => r?.avg ?? 0));
    expect(peak).toBeGreaterThan(20); // far above the 6 V pack
    expect(peak).toBeGreaterThan(avgPeak + 10);
  });

  it('reports PWM for rebuilding: D5 at 976.6 Hz (rgb-melody), D9 at 490.2 Hz in a transient circuit', () => {
    const fast = scope('rgb-melody', [on('board', 'D5')], 300);
    expect(fast.pwm.slice(1, 4)).toEqual([0, 976.5625, 0.5]);
    const last = fast.rows.at(-1)?.[0];
    expect(last?.min).toBeLessThan(0.5);
    expect(last?.max).toBeGreaterThan(4.5);
    const slow = scope('no-flyback', [on('board', 'D9')], 300);
    const d9 = slow.pwm.slice(-4);
    expect(d9[2]).toBeCloseTo(490.196, 2);
    expect(d9[3]).toBeGreaterThan(0);
    const row = slow.rows.at(-1)?.[0];
    expect((row?.max ?? 0) - (row?.min ?? 0)).toBeGreaterThan(4); // phase levels survive the transient average
  });

  it('i and p channels read min = max = avg', () => {
    const { rows } = scope(
      'rgb-melody',
      [
        { kind: 'i', pins: [{ part: 'board', pin: 'D5' }], scale: -1 },
        { kind: 'p', part: 'rb' },
      ],
      200,
    );
    for (const row of rows) for (const r of row) expect([r.min, r.max]).toEqual([r.avg, r.avg]);
  });
});

describe('scope fine mode (TD §18.3 phase 2)', () => {
  const on = (part: string, pin: string): MeasureProbe => ({ kind: 'v', red: { part, pin }, black: null });
  /** Fine samples `[ch, t, v]` and the readings of `slices` slices with fine mode on. */
  function fine(id: 'timer-555' | 'no-flyback' | 'blink', probes: readonly MeasureProbe[], slices: number) {
    const run = buildRun({ scenario: id });
    const hub = new MeasureHub(run);
    hub.setFine(true);
    const rec = hub.set('scope', probes) as ScopeRecorder;
    run.circuit.sim.addObserver(hub);
    const samples: number[] = [];
    const max: number[] = [];
    let reactive: boolean | null = null;
    for (let done = 0; done < slices; done += 100) {
      run.circuit.sim.run(100);
      const d = rec.drain(run.circuit.sim);
      for (let k = 0; k < d.slices; k++) max.push(d.data[k * probes.length * 3 + 2] ?? NaN);
      const f = rec.drainFine(run.circuit.sim);
      if (f) {
        reactive = f.reactive;
        samples.push(...f.data);
      }
    }
    return { samples, max, reactive, rec, run };
  }

  it('no-flyback: sub-steps show the kickback; ≤ 64 per slice, in time order, extremes kept', () => {
    const { samples, max, reactive } = fine('no-flyback', [on('q', 'c')], 2000);
    expect(reactive).toBe(true);
    const t = samples.filter((_, i) => i % 3 === 1);
    const v = samples.filter((_, i) => i % 3 === 2);
    expect(t.length).toBeGreaterThan(2000); // at least the slice-end step of every slice
    for (let i = 1; i < t.length; i++) expect(t[i]).toBeGreaterThan(t[i - 1] ?? Infinity);
    const perSlice = new Map<number, number>();
    for (const x of t) {
      const k = Math.ceil(x * 1000 - 1e-6);
      perSlice.set(k, (perSlice.get(k) ?? 0) + 1);
    }
    expect(Math.max(...perSlice.values())).toBeLessThanOrEqual(64);
    // Decimation keeps the min and max of every run: the peak equals the envelope's.
    expect(Math.fround(Math.max(...v))).toBe(Math.max(...max)); // readings are Float32
    expect(Math.max(...v)).toBeGreaterThan(20);
  });

  it('a circuit without capacitors or inductors answers reactive: false and no samples', () => {
    const { samples, reactive } = fine('blink', [on('board', 'D13')], 300);
    expect(reactive).toBe(false);
    expect(samples).toHaveLength(0);
  });

  it('turning fine mode off stops observing sub-steps', () => {
    const { rec, run } = fine('timer-555', [on('timer', 'out')], 100);
    rec.setFine(false);
    run.circuit.sim.run(100);
    expect(rec.drainFine(run.circuit.sim)).toBeNull();
  });
});

describe('determinism with the scope attached (US-SIM-10 AC4)', () => {
  for (const id of ['timer-555', 'no-flyback', 'rgb-melody'] as const) {
    it(`${id}: bit-identical state with 4 scope channels`, { timeout: 120_000 }, () => {
      const plain = buildRun({ scenario: id });
      const scoped = buildRun({ scenario: id });
      const hub = new MeasureHub(scoped);
      const parts = scoped.circuit.assembled.parts;
      const pins = parts.flatMap((p) => Object.keys(p.pins).map((pin) => ({ part: p.id, pin })));
      hub.setFine(true); // fine mode only reads sub-steps
      const rec = hub.set('scope', [
        ...pins.slice(0, 2).map((red): MeasureProbe => ({ kind: 'v', red, black: null })),
        { kind: 'v', red: { part: 'board', pin: 'D9' }, black: null },
        { kind: 'i', pins: pins.slice(0, 1), scale: 1 },
      ]);
      scoped.circuit.sim.addObserver(hub);
      for (let k = 0; k < 20; k++) {
        plain.circuit.sim.run(100);
        scoped.circuit.sim.run(100);
        rec?.drain(scoped.circuit.sim);
        if (rec instanceof ScopeRecorder) rec.drainFine(scoped.circuit.sim);
      }
      expect(scoped.circuit.sim.snapshot()).toEqual(plain.circuit.sim.snapshot());
    });
  }
});
