import { BOARD_PART } from '@robosim/shared';
import type { MnaSolution, NetId, Simulation, SliceContext, SliceObserver } from '@robosim/sim-core';
import { EnergyMeter } from './energy.js';
import { boardTerminal, type Scenario } from './project-loader.js';
import { MAX_FINE_PER_SLICE, type MeasureChannel, type MeasureProbe, type PointRef } from './protocol.js';

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
export class MeasureRecorder implements ChannelRecorder {
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

/** What the host drains from an instrument of the measurement channel. */
export interface ChannelRecorder {
  readonly unresolved: readonly number[];
  readonly powerParts: readonly string[];
  readonly pending: number;
  record(sim: Simulation): void;
  drain(sim: Simulation): { fromSlice: number; slices: number; data: Float32Array; pwm?: Float64Array };
}

type Phased = MnaSolution & {
  phases(): readonly { readonly solution: MnaSolution; readonly weight: number }[];
};
const isPhased = (s: MnaSolution): s is Phased => typeof (s as Partial<Phased>).phases === 'function';

/** Writes `[avg, min, max]` at `out[o..o+2]`; returns the PWM to rebuild the trace from, or null. */
type ScopeReader = (
  sim: Simulation,
  out: Float32Array,
  o: number,
) => { freqHz: number; dutyRatio: number } | null;

function compileScope(scenario: Scenario, probe: MeasureProbe): ScopeReader | null {
  const plain = compile(scenario, probe);
  if (!plain) return null;
  if (probe.kind !== 'v')
    return (sim, out, o) => {
      out[o] = out[o + 1] = out[o + 2] = plain(sim);
      return null;
    };
  // Resolved again for the nets (compile already proved both points resolve).
  const a = resolvePoint(scenario, probe.red)?.net ?? 0;
  const b = probe.black ? (resolvePoint(scenario, probe.black)?.net ?? 0) : 0;
  // Per-phase extremes only change with the solution, which stays the same object while nothing changes.
  let seen: MnaSolution | null = null;
  let lo = 0;
  let hi = 0;
  return (sim, out, o) => {
    const published = sim.currentSolution;
    const avg = published.voltage(a) - published.voltage(b);
    // PWM phase levels; a transient slice average has none, its last sub-step still does.
    const s = sim.transient ? sim.stepSolution : published;
    if (s !== seen) {
      seen = s;
      lo = hi = s.voltage(a) - s.voltage(b);
      if (isPhased(s))
        for (const ph of s.phases()) {
          if (ph.weight <= 0) continue;
          const v = ph.solution.voltage(a) - ph.solution.voltage(b);
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
    }
    let min = Math.min(lo, avg);
    let max = Math.max(hi, avg);
    if (sim.transient && b === 0) {
      // Sub-step extremes (a kickback the average hides); only against GND, where they are exact.
      const e = sim.netEnvelope(a);
      min = Math.min(min, e.min);
      max = Math.max(max, e.max);
    }
    out[o] = avg;
    out[o + 1] = min;
    out[o + 2] = max;
    // PWM edges are rebuilt between the phase levels (against GND only, where they are the pin's).
    return b === 0 && hi > lo ? sim.pwmOn(a) : null;
  };
}

/**
 * Oscilloscope recorder (FR-SIM-14, TD §18.3): `[avg, min, max]` per channel after every slice, kept
 * until the host drains them. `min`/`max` of a `v` channel are the transient sub-step envelope, or the
 * PWM phase levels; PWM driving a channel is reported on change so the main thread can rebuild its
 * edges (1 kHz sampling cannot show a 490 / 980 Hz square wave). View-only (ADR-026).
 */
export class ScopeRecorder implements ChannelRecorder {
  readonly unresolved: readonly number[];
  readonly powerParts: readonly string[] = [];
  private readonly readers: readonly (ScopeReader | null)[];
  private data: Float32Array;
  private slices = 0;
  private fromSlice: number;
  private events: number[] = [];
  /** Last reported PWM per channel as `[freqHz, duty]` (NaN: nothing reported yet). */
  private readonly sent: Float64Array;

  /** Fine mode (TD §18.3): `v` channels and their nets, sampled at every integration sub-step. */
  private readonly fineNets: readonly { readonly ch: number; readonly a: NetId; readonly b: NetId }[];
  private fineOff: (() => void) | null = null;
  /** This slice's sub-steps: times, and per fine channel the values (row-major by sub-step). */
  private subT = new Float64Array(64);
  private subV = new Float64Array(0);
  private subN = 0;
  private fine: number[] = [];
  /** `reactive` last told to the main thread (null: nothing sent since fine mode went on). */
  private fineSent: boolean | null = null;

  constructor(
    private readonly scenario: Scenario,
    readonly probes: readonly MeasureProbe[],
  ) {
    this.fineNets = probes.flatMap((p, ch) => {
      if (p.kind !== 'v') return [];
      const a = resolvePoint(scenario, p.red)?.net;
      const b = p.black ? resolvePoint(scenario, p.black)?.net : 0;
      return a === undefined || b === undefined ? [] : [{ ch, a, b }];
    });
    this.subV = new Float64Array(64 * this.fineNets.length);
    this.readers = probes.map((p) => compileScope(scenario, p));
    this.unresolved = this.readers.flatMap((r, i) => (r ? [] : [i]));
    this.data = new Float32Array(probes.length * 3 * 64);
    this.sent = new Float64Array(probes.length * 2).fill(NaN);
    this.fromSlice = scenario.circuit.sim.slice;
  }

  get pending(): number {
    return this.slices;
  }

  /** True while fine mode records sub-steps. */
  get fineOn(): boolean {
    return this.fineOff !== null;
  }

  /** Turns fine mode on or off; only reads the simulation (view-only). */
  setFine(on: boolean): void {
    if (on === this.fineOn) return;
    if (on) this.fineOff = this.scenario.circuit.sim.addSubstepObserver(this.onSubstep);
    else {
      this.fineOff?.();
      this.fineOff = null;
      this.fine = [];
    }
    this.subN = 0;
    this.fineSent = null;
  }

  /** Stops observing the simulation (the subscription ended). */
  dispose(): void {
    this.setFine(false);
  }

  private readonly onSubstep = (t: number, s: MnaSolution): void => {
    const n = this.fineNets.length;
    if (n === 0) return;
    if (this.subN >= this.subT.length) {
      const t2 = new Float64Array(this.subT.length * 2);
      t2.set(this.subT);
      this.subT = t2;
      const v2 = new Float64Array(this.subV.length * 2);
      v2.set(this.subV);
      this.subV = v2;
    }
    this.subT[this.subN] = t;
    const o = this.subN * n;
    for (let j = 0; j < n; j++) {
      const f = this.fineNets[j];
      if (f) this.subV[o + j] = s.voltage(f.a) - s.voltage(f.b);
    }
    this.subN++;
  };

  /**
   * Moves this slice's sub-steps to the outgoing samples: all of them up to MAX_FINE_PER_SLICE, else
   * per channel the min and max of each of MAX_FINE_PER_SLICE / 2 equal runs, in time order.
   */
  private flushSubsteps(): void {
    const n = this.fineNets.length;
    const count = this.subN;
    this.subN = 0;
    if (count === 0) return;
    for (let j = 0; j < n; j++) {
      const ch = this.fineNets[j]?.ch ?? 0;
      const at = (k: number) => this.subV[k * n + j] ?? NaN;
      if (count <= MAX_FINE_PER_SLICE) {
        for (let k = 0; k < count; k++) this.fine.push(ch, this.subT[k] ?? 0, at(k));
        continue;
      }
      const buckets = MAX_FINE_PER_SLICE / 2;
      for (let b = 0; b < buckets; b++) {
        const k0 = Math.floor((b * count) / buckets);
        const k1 = Math.floor(((b + 1) * count) / buckets);
        let lo = k0;
        let hi = k0;
        for (let k = k0 + 1; k < k1; k++) {
          if (at(k) < at(lo)) lo = k;
          if (at(k) > at(hi)) hi = k;
        }
        const first = Math.min(lo, hi);
        const second = Math.max(lo, hi);
        this.fine.push(ch, this.subT[first] ?? 0, at(first));
        if (second !== first) this.fine.push(ch, this.subT[second] ?? 0, at(second));
      }
    }
  }

  /**
   * Sub-step samples since the last call, as `[channel, t_s, value]` triples per channel in time order;
   * null when fine mode is off or there is nothing new to tell (no samples and `reactive` unchanged).
   */
  drainFine(sim: Simulation): { reactive: boolean; data: Float64Array } | null {
    if (!this.fineOn) return null;
    const reactive = sim.transient;
    if (this.fine.length === 0 && this.fineSent === reactive) return null;
    this.fineSent = reactive;
    const data = Float64Array.from(this.fine);
    this.fine = [];
    return { reactive, data };
  }

  record(sim: Simulation): void {
    if (this.fineOn) this.flushSubsteps();
    const row = this.readers.length * 3;
    if (this.slices === 0) this.fromSlice = sim.slice;
    if ((this.slices + 1) * row > this.data.length) {
      const grown = new Float32Array(this.data.length * 2);
      grown.set(this.data);
      this.data = grown;
    }
    const base = this.slices * row;
    for (let i = 0; i < this.readers.length; i++) {
      const r = this.readers[i];
      const o = base + 3 * i;
      if (!r) {
        this.data[o] = this.data[o + 1] = this.data[o + 2] = NaN;
        continue;
      }
      const pwm = r(sim, this.data, o);
      const f = pwm?.freqHz ?? 0;
      const d = pwm?.dutyRatio ?? 0;
      if (this.sent[2 * i] !== f || this.sent[2 * i + 1] !== d) {
        this.sent[2 * i] = f;
        this.sent[2 * i + 1] = d;
        this.events.push(sim.slice, i, f, d);
      }
    }
    this.slices++;
  }

  drain(sim: Simulation): { fromSlice: number; slices: number; data: Float32Array; pwm?: Float64Array } {
    const slices = this.slices;
    const row = this.readers.length * 3;
    let data: Float32Array;
    if (slices > 0) data = this.data.slice(0, slices * row);
    else {
      // A paused sample of the present operating point, like the meter's.
      data = new Float32Array(row);
      this.readers.forEach((r, i) => {
        if (r) r(sim, data, 3 * i);
        else data[3 * i] = data[3 * i + 1] = data[3 * i + 2] = NaN;
      });
    }
    const fromSlice = slices > 0 ? this.fromSlice : sim.slice;
    const pwm = this.events.length ? Float64Array.from(this.events) : undefined;
    this.events = [];
    this.slices = 0;
    return { fromSlice, slices, data, ...(pwm ? { pwm } : {}) };
  }
}

/**
 * The run's single measurement observer, registered before the InputLogger (which must stay last):
 * instruments subscribe and unsubscribe through it mid-run without reordering observers.
 */
export class MeasureHub implements SliceObserver {
  readonly viewOnly = true;
  private readonly recorders = new Map<MeasureChannel, ChannelRecorder>();
  private fine = false;
  private meter: EnergyMeter | null = null;

  constructor(private readonly scenario: Scenario) {}

  /** The power budget meter (TD §18.4), while the panel is open or "record every run" is on. */
  get energy(): EnergyMeter | null {
    return this.meter;
  }

  /**
   * Starts or stops the energy meter. It costs a few % of slice time on a circuit that re-solves every
   * slice, so it only runs on request; started mid-run, it reports from that slice on.
   */
  setEnergy(on: boolean): void {
    if (on === (this.meter !== null)) return;
    this.meter = on ? EnergyMeter.for(this.scenario) : null;
    this.watch();
  }

  set(channel: MeasureChannel, probes: readonly MeasureProbe[] | null): ChannelRecorder | null {
    const prev = this.recorders.get(channel);
    if (prev instanceof ScopeRecorder) prev.dispose();
    if (probes?.length) {
      if (channel === 'scope') {
        const scope = new ScopeRecorder(this.scenario, probes);
        scope.setFine(this.fine);
        this.recorders.set(channel, scope);
      } else this.recorders.set(channel, new MeasureRecorder(this.scenario, probes));
    } else this.recorders.delete(channel);
    this.watch();
    return this.recorders.get(channel) ?? null;
  }

  /** Parts whose power is integrated per sub-step: every part for the energy meter, plus probes. */
  private watch(): void {
    const parts = new Set([...this.recorders.values()].flatMap((r) => r.powerParts));
    for (const id of this.meter?.watched ?? []) parts.add(id);
    this.scenario.circuit.sim.watchPower([...parts], { mcu: this.meter !== null });
  }

  /** Scope fine mode, kept for the scope subscriptions that follow (TD §18.3). */
  setFine(on: boolean): void {
    this.fine = on;
    const scope = this.recorders.get('scope');
    if (scope instanceof ScopeRecorder) scope.setFine(on);
  }

  get(channel: MeasureChannel): ChannelRecorder | null {
    return this.recorders.get(channel) ?? null;
  }

  channels(): IterableIterator<[MeasureChannel, ChannelRecorder]> {
    return this.recorders.entries();
  }

  afterSlice(ctx: SliceContext): void {
    const sim = this.scenario.circuit.sim;
    this.meter?.record(sim, ctx.solution);
    for (const r of this.recorders.values()) r.record(sim);
  }
}
