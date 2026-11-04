import { SLICES_PER_SECOND, type MnaSolution, type PartTerminal, type Simulation } from '@robosim/sim-core';
import type { Scenario } from './project-loader.js';
import type { EnergyPart, EnergyReport, EnergySource } from './protocol.js';

/** 1 s buckets at first; when this many are full, pairs merge and the bucket width doubles. */
export const MAX_ENERGY_BUCKETS = 300;

interface PartSpec {
  readonly id: string;
  /** One terminal per distinct net of the part's supply pins (or of all pins for a two-terminal part). */
  readonly terminals: readonly PartTerminal[];
  /** No supply pin: the part's current is its through-current, Σ|I| / 2. */
  readonly through: boolean;
}

interface SourceSpec {
  readonly id: string;
  readonly pin: string;
  readonly ratingMa: number;
  /** Reads the battery's state of charge from its snapshot (batteries only). */
  readonly charge: (() => number) | null;
}

const DT = 1 / SLICES_PER_SECOND;

export interface EnergyMeterOptions {
  /** Reuse readings while the solution is unchanged (default true; tests compare against false). */
  readonly cache?: boolean;
  /** Bucket count before a 2:1 merge (default {@link MAX_ENERGY_BUCKETS}). */
  readonly maxBuckets?: number;
  /** Slices per bucket at first (default 1 s). */
  readonly bucketSlices?: number;
}

/**
 * Per-part energy, supply current and peaks over a run (FR-SIM-15, TD §18.4). View-only (ADR-026):
 * it reads `partPower` and ledger currents after each slice and never changes the run. When a slice
 * did not re-solve (`ctx.solution` is the previous object) the per-part readings are reused, so a quiet
 * slice only advances accumulators. Transient slices are exact because the hub watches every part's
 * power per sub-step (`Simulation.watchPower`).
 */
export class EnergyMeter {
  readonly partIds: readonly string[];
  private readonly parts: readonly PartSpec[];
  private readonly sources: readonly SourceSpec[];
  private readonly n: number;
  // Present readings (W, A), reused while the solution is unchanged.
  private readonly p: Float64Array;
  private readonly i: Float64Array;
  private readonly si: Float64Array;
  private mcuP = 0;
  private last: MnaSolution | null = null;
  // Run totals.
  private readonly joules: Float64Array;
  private readonly coulombs: Float64Array;
  private readonly peakP: Float64Array;
  private readonly minP: Float64Array;
  private readonly peakI: Float64Array;
  private readonly srcCoulombs: Float64Array;
  private readonly srcPeak: Float64Array;
  private mcuJoules = 0;
  private slices = 0;
  private firstSlice = -1;
  private lastSlice = 0;
  // Graph buckets: energy per part, and charge per source for the p90 current.
  private bucketSlices: number;
  private readonly maxBuckets: number;
  private readonly cache: boolean;
  private buckets: Float64Array[] = [];
  private srcBuckets: Float64Array[] = [];
  private inBucket = 0;
  /** Lowest bucket index changed since the last drain (Infinity: none). */
  private dirtyFrom = 0;

  constructor(scenario: Scenario, options: EnergyMeterOptions = {}) {
    this.cache = options.cache ?? true;
    this.maxBuckets = options.maxBuckets ?? MAX_ENERGY_BUCKETS;
    this.bucketSlices = options.bucketSlices ?? SLICES_PER_SECOND;
    const parts: PartSpec[] = [];
    const sources: SourceSpec[] = [];
    for (const part of scenario.circuit.assembled.parts) {
      const m = part.def.manifest;
      const supplyPins = new Set(
        (m.supplyPins ?? [])
          .filter((s) => !s.enabledByProp || part.props[s.enabledByProp] === true)
          .map((s) => s.pin),
      );
      const power = m.pins.filter((p) => p.kind === 'power' && !supplyPins.has(p.name)).map((p) => p.name);
      const through = power.length === 0;
      const pins = through ? m.pins.map((p) => p.name) : power;
      const seen = new Set<number>();
      const terminals: PartTerminal[] = [];
      for (const pin of pins) {
        const net = part.pins[pin];
        if (net === undefined || seen.has(net)) continue;
        seen.add(net);
        terminals.push({ componentId: part.id, pin });
      }
      parts.push({ id: part.id, terminals, through });
      for (const sp of m.supplyPins ?? [])
        if (supplyPins.has(sp.pin) && part.pins[sp.pin] !== undefined) {
          const model = scenario.circuit.models[part.id];
          const isBattery = (m.traits ?? []).includes('source') && m.props['capacityMah'] !== undefined;
          sources.push({
            id: part.id,
            pin: sp.pin,
            ratingMa: sp.maxCurrentMa,
            charge:
              isBattery && model
                ? () => Number((model.snapshot() as { charge?: number })?.charge ?? 0)
                : null,
          });
        }
    }
    this.parts = parts;
    this.sources = sources;
    this.partIds = parts.map((p) => p.id);
    this.n = parts.length;
    const f = (k: number): Float64Array => new Float64Array(k);
    this.p = f(this.n);
    this.i = f(this.n);
    this.si = f(sources.length);
    this.joules = f(this.n);
    this.coulombs = f(this.n);
    this.peakP = f(this.n).fill(-Infinity);
    this.minP = f(this.n).fill(Infinity);
    this.peakI = f(this.n);
    this.srcCoulombs = f(sources.length);
    this.srcPeak = f(sources.length);
  }

  /** One slice. `solution` is the slice's published solution (identity tells whether it re-solved). */
  record(sim: Simulation, solution: MnaSolution): void {
    if (solution !== this.last || !this.cache) {
      this.last = solution;
      this.read(sim);
    }
    const { n } = this;
    if (this.inBucket === 0) this.openBucket();
    const bucket = this.buckets[this.buckets.length - 1] as Float64Array;
    const srcBucket = this.srcBuckets[this.srcBuckets.length - 1] as Float64Array;
    for (let k = 0; k < n; k++) {
      const p = this.p[k] as number;
      const i = this.i[k] as number;
      this.joules[k] = (this.joules[k] as number) + p * DT;
      this.coulombs[k] = (this.coulombs[k] as number) + i * DT;
      if (p > (this.peakP[k] as number)) this.peakP[k] = p;
      if (p < (this.minP[k] as number)) this.minP[k] = p;
      if (i > (this.peakI[k] as number)) this.peakI[k] = i;
      bucket[k] = (bucket[k] as number) + p * DT;
    }
    for (let k = 0; k < this.sources.length; k++) {
      const i = this.si[k] as number;
      this.srcCoulombs[k] = (this.srcCoulombs[k] as number) + i * DT;
      if (i > (this.srcPeak[k] as number)) this.srcPeak[k] = i;
      srcBucket[k] = (srcBucket[k] as number) + i * DT;
    }
    this.mcuJoules += this.mcuP * DT;
    this.slices++;
    if (this.firstSlice < 0) this.firstSlice = sim.slice - 1;
    this.lastSlice = sim.slice;
    this.dirtyFrom = Math.min(this.dirtyFrom, this.buckets.length - 1);
    if (++this.inBucket >= this.bucketSlices) this.inBucket = 0;
  }

  /** Slices recorded since the last drain could change the report. */
  get pending(): boolean {
    return this.dirtyFrom !== Infinity;
  }

  /** The run so far; buckets changed since the last drain only. */
  drain(): EnergyReport {
    const seconds = this.slices * DT;
    const avg = (total: number): number => (seconds > 0 ? total / seconds : 0);
    const parts: EnergyPart[] = this.parts.map((part, k) => {
      const joules = this.joules[k] as number;
      // A source's power is negative: report the extreme on the side its energy is on.
      const peakW = joules < 0 ? (this.minP[k] as number) : (this.peakP[k] as number);
      return {
        id: part.id,
        avgMa: avg(this.coulombs[k] as number) * 1000,
        peakMa: (this.peakI[k] as number) * 1000,
        avgMw: avg(joules) * 1000,
        peakMw: Number.isFinite(peakW) ? peakW * 1000 : 0,
        joules,
      };
    });
    const sources: EnergySource[] = this.sources.map((s, k) => ({
      id: s.id,
      pin: s.pin,
      avgMa: avg(this.srcCoulombs[k] as number) * 1000,
      peakMa: (this.srcPeak[k] as number) * 1000,
      p90Ma: this.p90(k) * 1000,
      ratingMa: s.ratingMa,
      ...(s.charge ? { charge: s.charge() } : {}),
    }));
    const from = Math.min(this.dirtyFrom, this.buckets.length);
    const count = this.buckets.length - from;
    const buckets = new Float32Array(this.n * count);
    for (let b = 0; b < count; b++) {
      const src = this.buckets[from + b] as Float64Array;
      for (let k = 0; k < this.n; k++) buckets[k * count + b] = src[k] as number;
    }
    this.dirtyFrom = Infinity;
    return {
      fromSlice: Math.max(0, this.firstSlice),
      upToSlice: this.lastSlice,
      seconds,
      parts,
      sources,
      mcuJoules: this.mcuJoules,
      bucketSeconds: this.bucketSlices * DT,
      bucketFrom: from,
      buckets,
    };
  }

  private read(sim: Simulation): void {
    for (let k = 0; k < this.n; k++) {
      const part = this.parts[k] as PartSpec;
      this.p[k] = sim.partPower(part.id);
      let i = 0;
      for (const t of part.terminals) {
        const into = sim.pinCurrent(t);
        i += part.through ? Math.abs(into) : Math.max(0, into);
      }
      this.i[k] = part.through ? i / 2 : i;
    }
    this.sources.forEach((s, k) => {
      this.si[k] = -sim.pinCurrent({ componentId: s.id, pin: s.pin });
    });
    this.mcuP = sim.mcuPower();
  }

  private openBucket(): void {
    if (this.buckets.length >= this.maxBuckets) {
      this.buckets = merge(this.buckets);
      this.srcBuckets = merge(this.srcBuckets);
      this.bucketSlices *= 2;
      this.dirtyFrom = 0;
    }
    this.buckets.push(new Float64Array(this.n));
    this.srcBuckets.push(new Float64Array(this.sources.length));
  }

  /** 90th percentile of a source's current over the full buckets (A); its average before the first. */
  private p90(k: number): number {
    const full = this.inBucket === 0 ? this.srcBuckets.length : this.srcBuckets.length - 1;
    const width = this.bucketSlices * DT;
    if (full < 1) return this.slices > 0 ? (this.srcCoulombs[k] as number) / (this.slices * DT) : 0;
    const amps = this.srcBuckets
      .slice(0, full)
      .map((b) => (b[k] as number) / width)
      .sort((a, b) => a - b);
    return amps[Math.min(amps.length - 1, Math.ceil(0.9 * amps.length) - 1)] as number;
  }

  /** Every part the meter reads: the hub watches their power per sub-step. */
  get watched(): readonly string[] {
    return this.partIds;
  }

  /** Builds the meter for a run, or null when the run has no parts. */
  static for(scenario: Scenario, options?: EnergyMeterOptions): EnergyMeter | null {
    return scenario.circuit.assembled.parts.length ? new EnergyMeter(scenario, options) : null;
  }
}

/** Pairs of buckets summed into one (an odd last bucket stays as it is). */
function merge(buckets: readonly Float64Array[]): Float64Array[] {
  const out: Float64Array[] = [];
  for (let b = 0; b < buckets.length; b += 2) {
    const a = buckets[b] as Float64Array;
    const c = buckets[b + 1];
    const sum = Float64Array.from(a);
    if (c) for (let k = 0; k < sum.length; k++) sum[k] = (sum[k] as number) + (c[k] as number);
    out.push(sum);
  }
  return out;
}
