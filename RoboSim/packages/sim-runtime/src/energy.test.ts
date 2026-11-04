import { describe, expect, it } from 'vitest';
import { findDefinition } from '@robosim/catalog';
import type { ProjectDocument } from '@robosim/shared';
import { BATTERY_CELLS } from '@robosim/component-battery';
import { batteryLife } from './battery-life.js';
import { EnergyMeter, type EnergyMeterOptions } from './energy.js';
import { MeasureHub } from './measure.js';
import type { Scenario } from './project-loader.js';
import { buildRun, builtinSource } from './scenarios.js';
import { SimClient } from './client.js';
import { SimHost } from './host.js';
import type { WorkerToMain } from './protocol.js';

type Part = { id: string; type: string; props?: Record<string, unknown> };
type Wire = readonly [string, string, string, string];

/** A bench project on the blink demo's board and firmware. */
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

/** Attaches a meter the way the hub does: every part's power watched per sub-step. */
function metered(scenario: Scenario, options?: EnergyMeterOptions): EnergyMeter {
  const meter = EnergyMeter.for(scenario, options);
  if (!meter) throw new Error('no parts');
  const sim = scenario.circuit.sim;
  sim.watchPower(meter.watched, { mcu: true });
  sim.addObserver({ viewOnly: true, afterSlice: (ctx) => meter.record(sim, ctx.solution) });
  return meter;
}

/** 4×AA → 100 Ω and 220 Ω to GND, and an LM7805 feeding 47 Ω. */
const benchSupply = () =>
  buildRun(
    project(
      [
        { id: 'pack', type: 'power.battery-4aa' },
        { id: 'r1', type: 'passive.resistor', props: { ohms: 100, powerRatingMw: 2000 } },
        { id: 'r2', type: 'passive.resistor', props: { ohms: 220 } },
        { id: 'reg', type: 'semiconductor.lm7805' },
        { id: 'r3', type: 'passive.resistor', props: { ohms: 47, powerRatingMw: 2000 } },
      ],
      [
        ['pack', 'pos', 'r1', 'a'],
        ['pack', 'pos', 'r2', 'a'],
        ['pack', 'pos', 'reg', 'in'],
        ['reg', 'out', 'r3', 'a'],
        ['r1', 'b', 'board', 'GND1'],
        ['r2', 'b', 'board', 'GND1'],
        ['r3', 'b', 'board', 'GND1'],
        ['reg', 'gnd', 'board', 'GND1'],
        ['pack', 'neg', 'board', 'GND1'],
      ],
    ),
  );

describe('EnergyMeter (FR-SIM-15, TD §18.4)', () => {
  it('per-part currents on a supply sum to its delivered current within 1 % (exit criterion)', () => {
    const s = benchSupply();
    const meter = metered(s);
    s.circuit.sim.run(200);
    const r = meter.drain();
    const part = (id: string) => r.parts.find((p) => p.id === id);
    const pack = r.sources.find((x) => x.id === 'pack');
    expect(pack?.avgMa).toBeGreaterThan(50);
    const sum = ['r1', 'r2', 'reg'].reduce((n, id) => n + (part(id)?.avgMa ?? 0), 0);
    expect(Math.abs(sum - (pack?.avgMa ?? 0)) / (pack?.avgMa ?? 1)).toBeLessThan(0.01);
    // The regulator passes its output current through: in ≈ out + quiescent.
    const reg = r.sources.find((x) => x.id === 'reg');
    expect(reg?.avgMa).toBeCloseTo(part('r3')?.avgMa ?? 0, 3);
    expect(reg?.ratingMa).toBe(1500);
    expect(pack?.charge).toBeLessThan(1);
    expect(r.seconds).toBeCloseTo(0.2, 9);
  });

  for (const id of ['motor-driver', 'dimmer'] as const) {
    it(`${id}: the energy of every part and the MCU pins balances within 2 %`, { timeout: 120_000 }, () => {
      const s = buildRun({ scenario: id });
      const meter = metered(s);
      s.circuit.sim.run(1500);
      const r = meter.drain();
      const delivered = -r.parts.filter((p) => p.joules < 0).reduce((n, p) => n + p.joules, 0);
      const net = r.parts.reduce((n, p) => n + p.joules, r.mcuJoules);
      expect(delivered).toBeGreaterThan(0);
      expect(Math.abs(net) / delivered).toBeLessThan(0.02);
    });
  }

  it('identity caching gives the same totals as reading every slice', { timeout: 120_000 }, () => {
    const a = buildRun({ scenario: 'motor-driver' });
    const b = buildRun({ scenario: 'motor-driver' });
    const cached = metered(a);
    const uncached = metered(b, { cache: false });
    a.circuit.sim.run(800);
    b.circuit.sim.run(800);
    expect(cached.drain()).toEqual(uncached.drain());
  });

  it('merges buckets 2:1 when full and keeps the run total', () => {
    const s = benchSupply();
    const meter = metered(s, { maxBuckets: 4, bucketSlices: 10 });
    s.circuit.sim.run(30);
    const first = meter.drain();
    expect(first.bucketSeconds).toBeCloseTo(0.01, 9);
    expect(first.bucketFrom).toBe(0);
    s.circuit.sim.run(20); // fills 4 buckets, the 5th merges them to 2 of 20 slices
    const r = meter.drain();
    expect(r.bucketSeconds).toBeCloseTo(0.02, 9);
    expect(r.bucketFrom).toBe(0);
    const k = r.parts.findIndex((p) => p.id === 'r1');
    const n = r.buckets.length / r.parts.length;
    expect(n).toBe(3);
    let sum = 0;
    for (let b = 0; b < n; b++) sum += r.buckets[k * n + b] ?? 0;
    expect(sum).toBeCloseTo(r.parts[k]?.joules ?? 0, 6);
    // Nothing new: only the open bucket is resent.
    s.circuit.sim.run(1);
    expect(meter.drain().bucketFrom).toBe(2);
  });

  for (const id of ['motor-driver', 'dimmer'] as const) {
    it(`${id}: the run is bit-identical with the meter (US-SIM-11 AC4)`, { timeout: 120_000 }, () => {
      const plain = buildRun({ scenario: id });
      const withMeter = buildRun({ scenario: id });
      const hub = new MeasureHub(withMeter);
      hub.setEnergy(true);
      withMeter.circuit.sim.addObserver(hub);
      plain.circuit.sim.run(1500);
      withMeter.circuit.sim.run(1500);
      expect(withMeter.circuit.sim.snapshot()).toEqual(plain.circuit.sim.snapshot());
    });
  }
});

describe('battery life against a simulated discharge (Release-Plan IT-4 exit)', () => {
  it('agrees within 10 % with the time a 9 V pack takes to brown out an LM7805', { timeout: 300_000 }, () => {
    // 1 mAh so the discharge takes seconds, not hours; the model is coulomb counting either way.
    const s = buildRun(
      project(
        [
          { id: 'bat', type: 'power.battery-9v', props: { capacityMah: 1 } },
          { id: 'reg', type: 'semiconductor.lm7805' },
          { id: 'load', type: 'passive.resistor', props: { ohms: 47, powerRatingMw: 2000 } },
        ],
        [
          ['bat', 'pos', 'reg', 'in'],
          ['reg', 'out', 'load', 'a'],
          ['load', 'b', 'board', 'GND1'],
          ['reg', 'gnd', 'board', 'GND1'],
          ['bat', 'neg', 'board', 'GND1'],
        ],
      ),
    );
    const meter = metered(s);
    const bat = s.circuit.models['bat'];
    const volts = () => (bat?.snapshot() as { volts: number }).volts;
    const CUTOFF_V = 7; // the LM7805's minSupplyV: 5 V out + 2 V dropout
    s.circuit.sim.run(50); // the battery reports its terminal voltage from the first step on
    let slices = 50;
    expect(volts()).toBeGreaterThan(CUTOFF_V);
    while (volts() >= CUTOFF_V && slices < 120_000) {
      s.circuit.sim.run(50);
      slices += 50;
    }
    expect(volts()).toBeLessThan(CUTOFF_V);
    const r = meter.drain();
    const src = r.sources.find((x) => x.id === 'bat');
    const life = batteryLife({
      cells: BATTERY_CELLS['power.battery-9v'] ?? 6,
      capacityMah: 1,
      internalOhms: 1.5,
      charge: 1,
      cutoffV: CUTOFF_V,
      avgMa: src?.avgMa ?? 0,
    });
    expect(life.kind).toBe('ok');
    const estimated = life.kind === 'ok' ? life.hours * 3600 : 0;
    const simulated = slices / 1000;
    expect(simulated).toBeGreaterThan(5);
    expect(Math.abs(estimated - simulated) / simulated).toBeLessThan(0.1);
  });
});

describe('board supply ratings', () => {
  it('rates the Uno 3.3 V pin 50 mA (Arduino spec), so 80 mA on it is an overload', () => {
    const onPin = (pin: string) =>
      buildRun(
        project(
          [{ id: 'line', type: 'sensor.line-5ch' }],
          [
            ['board', pin, 'line', 'vcc'],
            ['line', 'gnd', 'board', 'GND1'],
          ],
        ),
      ).scene.staticFindings.filter((f) => f.ruleId === 'SAF-SUPPLY-OVERLOAD');
    expect(onPin('3V3')).toEqual([
      expect.objectContaining({
        params: expect.objectContaining({ supply: '3V3-rail.pos', ma: 80, limit: 50 }),
      }),
    ]);
    expect(onPin('5V')).toEqual([]); // 80 mA is fine on the 500 mA pin
  });
});

describe('energy messages', () => {
  it('reach the client on a forced publish and fold into a per-part series', () => {
    const client = new SimClient();
    const host = new SimHost(
      (m: WorkerToMain) => void client.receive(m),
      () => 0,
    );
    host.handle({ type: 'load', scenario: 'dimmer' });
    host.handle({ type: 'control', action: 'step' });
    expect(client.energy).toBeNull(); // off until the panel asks
    host.handle({ type: 'energy', on: true });
    for (let k = 0; k < 3; k++) host.handle({ type: 'control', action: 'step' });
    const e = client.energy;
    expect(e?.fromSlice).toBe(10); // started mid-run: "measured since"
    expect(e?.seconds).toBeCloseTo(0.03, 9);
    expect(e?.parts.length).toBeGreaterThan(0);
    expect(e?.series.get(e.parts[0]?.id ?? '')?.length).toBe(1);
    host.handle({ type: 'control', action: 'reset' });
    expect(client.energy?.seconds ?? 0).toBe(0); // recording stays on across the reset
    host.handle({ type: 'control', action: 'step' });
    expect(client.energy?.fromSlice).toBe(0);
    host.handle({ type: 'energy', on: false });
    host.handle({ type: 'control', action: 'step' });
    expect(client.energy?.upToSlice).toBe(10); // no new reports
  });
});
