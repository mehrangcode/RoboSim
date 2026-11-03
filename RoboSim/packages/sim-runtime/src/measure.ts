import { BOARD_PART } from '@robosim/shared';
import type { NetId, Simulation, SliceContext, SliceObserver } from '@robosim/sim-core';
import { boardTerminal, type Scenario } from './project-loader.js';
import type { MeasureChannel, MeasureProbe, PointRef } from './protocol.js';

/** A point resolved to the engine: its net, and how to read current into it (null: no current). */
export interface ResolvedPoint {
  readonly net: NetId;
  readonly current: ((sim: Simulation) => number) | null;
  /** Ledger identity of the current reading, so pins of one part on one net are counted once. */
  readonly key: string | null;
}

/**
 * Resolves a document point to the engine (TD §18.2): a part pin through the assembled circuit, a
 * board pin to an MCU pin, a supply rail or GND (net 0). Breadboard holes never reach the worker (the
 * main thread maps them to an electrical pin). Null when the point is not simulated or not wired.
 */
export function resolvePoint(scenario: Scenario, ref: PointRef): ResolvedPoint | null {
  const { assembled } = scenario.circuit;
  if (ref.part === BOARD_PART) {
    const t = boardTerminal(ref.pin);
    if (!t) return null;
    if (t.kind === 'ground') return { net: 0, current: null, key: null };
    if (t.kind === 'mcu') {
      const bound = assembled.mcuPins.find((p) => p.pin === t.pin);
      if (!bound) return null;
      return { net: bound.net, current: (sim) => sim.mcuPinCurrentIn(t.pin), key: `mcu:${bound.net}` };
    }
    const rail = assembled.parts.find((p) => p.id === t.partId);
    const net = rail?.pins['pos'];
    if (net === undefined) return null;
    return {
      net,
      current: (sim) => sim.pinCurrent({ componentId: t.partId, pin: 'pos' }),
      key: `${t.partId}:${net}`,
    };
  }
  const part = assembled.parts.find((p) => p.id === ref.part);
  const net = part?.pins[ref.pin];
  if (net === undefined) return null;
  return {
    net,
    current: (sim) => sim.pinCurrent({ componentId: ref.part, pin: ref.pin }),
    key: `${ref.part}:${net}`,
  };
}

type Reader = (sim: Simulation) => number;

/** A probe compiled to a reader, or null when any of its points does not resolve. */
function compile(scenario: Scenario, probe: MeasureProbe): Reader | null {
  switch (probe.kind) {
    case 'v': {
      const red = resolvePoint(scenario, probe.red);
      const black = probe.black ? resolvePoint(scenario, probe.black) : { net: 0 };
      if (!red || !black) return null;
      const a = red.net;
      const b = black.net;
      return (sim) => sim.currentSolution.voltage(a) - sim.currentSolution.voltage(b);
    }
    case 'i': {
      const seen = new Set<string>();
      const readers: Reader[] = [];
      for (const ref of probe.pins) {
        const p = resolvePoint(scenario, ref);
        if (!p?.current || !p.key) return null;
        if (seen.has(p.key)) continue; // bonded pins of one part share a net: their current is one
        seen.add(p.key);
        readers.push(p.current);
      }
      if (readers.length === 0) return null;
      const scale = probe.scale;
      return (sim) => {
        let sum = 0;
        for (const r of readers) sum += r(sim);
        return scale * sum;
      };
    }
    case 'p': {
      if (!scenario.circuit.assembled.parts.some((p) => p.id === probe.part)) return null;
      const id = probe.part;
      return (sim) => sim.partPower(id);
    }
  }
}

/**
 * Meter recorder (FR-SIM-13): reads its probes after every slice and keeps avg / min / max until the
 * host drains them with the next snapshot. View-only (ADR-026): it only reads the simulation.
 */
export class MeasureRecorder {
  readonly unresolved: readonly number[];
  private readonly readers: readonly (Reader | null)[];
  private sum: Float64Array;
  private min: Float64Array;
  private max: Float64Array;
  private slices = 0;
  private fromSlice = 0;

  constructor(
    scenario: Scenario,
    readonly probes: readonly MeasureProbe[],
  ) {
    this.readers = probes.map((p) => compile(scenario, p));
    this.unresolved = this.readers.flatMap((r, i) => (r ? [] : [i]));
    this.sum = new Float64Array(probes.length);
    this.min = new Float64Array(probes.length).fill(Infinity);
    this.max = new Float64Array(probes.length).fill(-Infinity);
    this.fromSlice = scenario.circuit.sim.slice;
  }

  /** Parts whose power the probes read (the simulation integrates them per sub-step). */
  get powerParts(): readonly string[] {
    return this.probes.flatMap((p) => (p.kind === 'p' ? [p.part] : []));
  }

  get pending(): number {
    return this.slices;
  }

  record(sim: Simulation): void {
    this.readers.forEach((r, i) => {
      if (!r) return;
      const v = r(sim);
      this.sum[i] = (this.sum[i] ?? 0) + v;
      if (v < (this.min[i] ?? Infinity)) this.min[i] = v;
      if (v > (this.max[i] ?? -Infinity)) this.max[i] = v;
    });
    this.slices++;
  }

  /**
   * `[avg, min, max]` per probe over the slices since the last drain; with none recorded, a sample of
   * the present operating point (a paused run). Unresolved probes read NaN.
   */
  drain(sim: Simulation): { fromSlice: number; slices: number; data: Float32Array } {
    const data = new Float32Array(this.probes.length * 3);
    const slices = this.slices;
    this.readers.forEach((r, i) => {
      let avg: number;
      let lo: number;
      let hi: number;
      if (!r) avg = lo = hi = NaN;
      else if (slices === 0) avg = lo = hi = r(sim);
      else {
        avg = (this.sum[i] ?? 0) / slices;
        lo = this.min[i] ?? NaN;
        hi = this.max[i] ?? NaN;
      }
      data[3 * i] = avg;
      data[3 * i + 1] = lo;
      data[3 * i + 2] = hi;
    });
    const fromSlice = this.fromSlice;
    this.fromSlice = sim.slice;
    this.slices = 0;
    this.sum.fill(0);
    this.min.fill(Infinity);
    this.max.fill(-Infinity);
    return { fromSlice, slices, data };
  }
}

/**
 * The run's single measurement observer, registered before the InputLogger (which must stay last):
 * instruments subscribe and unsubscribe through it mid-run without reordering observers.
 */
export class MeasureHub implements SliceObserver {
  readonly viewOnly = true;
  private readonly recorders = new Map<MeasureChannel, MeasureRecorder>();

  constructor(private readonly scenario: Scenario) {}

  set(channel: MeasureChannel, probes: readonly MeasureProbe[] | null): MeasureRecorder | null {
    if (probes?.length) this.recorders.set(channel, new MeasureRecorder(this.scenario, probes));
    else this.recorders.delete(channel);
    this.scenario.circuit.sim.watchPower([...this.recorders.values()].flatMap((r) => r.powerParts));
    return this.recorders.get(channel) ?? null;
  }

  get(channel: MeasureChannel): MeasureRecorder | null {
    return this.recorders.get(channel) ?? null;
  }

  channels(): IterableIterator<[MeasureChannel, MeasureRecorder]> {
    return this.recorders.entries();
  }

  afterSlice(_ctx: SliceContext): void {
    const sim = this.scenario.circuit.sim;
    for (const r of this.recorders.values()) r.record(sim);
  }
}
