import {
  isDamageable,
  type DamageRecord,
  type Level,
  type MnaSolution,
  type Simulation,
  type SliceContext,
  type SliceObserver,
  type Unsubscribe,
} from '@robosim/sim-core';
import { findingView, type Scenario } from './project-loader.js';
import { BLACKBOX_MAX_PARTS, type PostMortem, type PostMortemSeries } from './protocol.js';

/** Slices per low-rate sample (100 Hz). */
export const BLACKBOX_LOW_EVERY = 10;
/** Low-rate ring: 10 s. */
export const BLACKBOX_LOW_SAMPLES = 1000;
/** High-rate ring while a condition is pending: 2 s at 1 kHz. */
export const BLACKBOX_HIGH_SAMPLES = 2000;
/** A post-mortem carries the last 5 s of the low-rate ring. */
export const POSTMORTEM_LOW_SAMPLES = 500;
/** "Pins that changed just before": from this long (s) before the violation began until the damage. */
const CHANGED_BEFORE_S = 0.05;
const SERIAL_TAIL_CHARS = 512;
const PENDING_EVERY_SLICES = 5;

interface Series {
  readonly key: string;
  readonly label: PostMortemSeries['label'];
  readonly quantity: 'V' | 'A';
  readonly read: (sim: Simulation) => number;
  sum: number;
  peak: number;
  readonly loAvg: Float32Array;
  readonly loPeak: Float32Array;
  /** 1 kHz ring while a pending condition names this series' owner, else null. */
  hi: { readonly ring: Float32Array; count: number; lastSlice: number } | null;
}

/**
 * Always-on flight recorder for damage post-mortems (FR-SIM-16, TD §18.8). Watches every damageable part
 * (V and current per pin) and every wired MCU pin: 100 Hz averages and peaks in a 10 s ring, plus 1 kHz
 * while the safety monitor has a pending condition on them. When the monitor damages something it
 * copies the victim's window into a {@link PostMortem}. View-only (ADR-026): it only reads the run.
 */
export class BlackBox implements SliceObserver {
  readonly viewOnly = true;
  /** More damageable parts than {@link BLACKBOX_MAX_PARTS}: the rest are not recorded. */
  readonly capped: boolean;
  private readonly series: Series[] = [];
  /** Series indices per owner: a part id, or `mcu:<pin>`. */
  private readonly owners = new Map<string, number[]>();
  private readonly values: Float64Array;
  private lastSolution: MnaSolution | null = null;
  private inBucket = 0;
  /** Low-rate samples written so far, and the slice the first one starts at. */
  private loCount = 0;
  private loStart = -1;
  private bucketStart = 0;
  private suspected: readonly number[] = [];
  private readonly queued: DamageRecord[] = [];
  private readonly ready: PostMortem[] = [];
  private readonly offs: Unsubscribe[] = [];
  private readonly changes = new Map<string, { level: Level; cycle: number }>();
  private serialTail = '';
  private readonly utf8 = new TextDecoder();

  private readonly lowSamples: number;
  private readonly highSamples: number;

  constructor(
    private readonly scenario: Scenario,
    options: { readonly lowSamples?: number; readonly highSamples?: number } = {},
  ) {
    this.lowSamples = options.lowSamples ?? BLACKBOX_LOW_SAMPLES;
    this.highSamples = options.highSamples ?? BLACKBOX_HIGH_SAMPLES;
    const sim = scenario.circuit.sim;
    const { assembled } = scenario.circuit;
    let parts = 0;
    let capped = false;
    for (const part of assembled.parts) {
      if (!isDamageable(sim.model(part.id))) continue;
      if (++parts > BLACKBOX_MAX_PARTS) {
        capped = true;
        continue;
      }
      const nets = new Set<number>();
      for (const [pin, net] of Object.entries(part.pins)) {
        if (nets.has(net)) continue; // bonded pins share a net and a current
        nets.add(net);
        const label = { part: part.id, pin };
        const terminal = { componentId: part.id, pin };
        this.add(part.id, `${part.id}:${pin}:V`, label, 'V', (s) => s.currentSolution.voltage(net));
        this.add(part.id, `${part.id}:${pin}:A`, label, 'A', (s) => s.pinCurrent(terminal));
      }
    }
    for (const { pin, net } of assembled.mcuPins) {
      if (net === 0) continue;
      const label = { mcuPin: pin };
      this.add(`mcu:${pin}`, `mcu:${pin}:V`, label, 'V', (s) => s.currentSolution.voltage(net));
      this.add(`mcu:${pin}`, `mcu:${pin}:A`, label, 'A', (s) => s.mcuPinCurrentIn(pin));
    }
    this.capped = capped;
    this.values = new Float64Array(this.series.length);
    this.offs.push(scenario.safety.onDamage((r) => this.queued.push(r)));
    const mcu = sim.mcu;
    if (mcu) {
      const change = (pin: string, level: Level, cycle: number) => this.changes.set(pin, { level, cycle });
      this.offs.push(mcu.onPinEdge(change));
      if (mcu.onPinInput) this.offs.push(mcu.onPinInput(change));
      this.offs.push(
        mcu.uart(0).onData((bytes) => {
          this.serialTail = (this.serialTail + this.utf8.decode(bytes, { stream: true })).slice(
            -SERIAL_TAIL_CHARS,
          );
        }),
      );
    }
  }

  /** Number of recorded series (tests, budgets). */
  get seriesCount(): number {
    return this.series.length;
  }

  afterSlice(ctx: SliceContext): void {
    const sim = this.scenario.circuit.sim;
    const n = this.series.length;
    // The solution object stays the same while nothing re-solved: so do the readings.
    if (ctx.solution !== this.lastSolution) {
      this.lastSolution = ctx.solution;
      for (let k = 0; k < n; k++) this.values[k] = (this.series[k] as Series).read(sim);
    }
    if (ctx.slice % PENDING_EVERY_SLICES === 0) this.suspect();
    if (this.inBucket === 0) this.bucketStart = ctx.slice;
    for (let k = 0; k < n; k++) {
      const s = this.series[k] as Series;
      const v = this.values[k] as number;
      s.sum += v;
      if (Math.abs(v) > Math.abs(s.peak)) s.peak = v;
    }
    for (const k of this.suspected) {
      const hi = (this.series[k] as Series).hi;
      if (!hi) continue;
      hi.ring[hi.count % this.highSamples] = this.values[k] as number;
      hi.count++;
      hi.lastSlice = ctx.slice;
    }
    if (++this.inBucket >= BLACKBOX_LOW_EVERY) {
      const at = this.loCount % this.lowSamples;
      for (let k = 0; k < n; k++) {
        const s = this.series[k] as Series;
        s.loAvg[at] = s.sum / BLACKBOX_LOW_EVERY;
        s.loPeak[at] = s.peak;
        s.sum = 0;
        s.peak = 0;
      }
      if (this.loStart < 0) this.loStart = this.bucketStart;
      this.loCount++;
      this.inBucket = 0;
    }
    if (this.queued.length) {
      for (const r of this.queued.splice(0)) {
        this.ready.push(this.postMortem(r));
        for (const k of this.victims(r)) (this.series[k] as Series).hi = null;
      }
      this.suspected = this.suspected.filter((k) => (this.series[k] as Series).hi !== null);
    }
  }

  /** Post-mortems completed since the last drain, oldest first. */
  drain(): PostMortem[] {
    return this.ready.splice(0);
  }

  get pending(): number {
    return this.ready.length;
  }

  dispose(): void {
    for (const off of this.offs.splice(0)) off();
  }

  private add(
    owner: string,
    key: string,
    label: PostMortemSeries['label'],
    quantity: 'V' | 'A',
    read: (sim: Simulation) => number,
  ): void {
    const list = this.owners.get(owner) ?? [];
    list.push(this.series.length);
    this.owners.set(owner, list);
    this.series.push({
      key,
      label,
      quantity,
      read,
      sum: 0,
      peak: 0,
      loAvg: new Float32Array(this.lowSamples),
      loPeak: new Float32Array(this.lowSamples),
      hi: null,
    });
  }

  /** Series of the parts and pins pending conditions name: they record at 1 kHz from now on. */
  private suspect(): void {
    const next = new Set<number>();
    for (const c of this.scenario.safety.pending()) {
      for (const id of c.componentIds) for (const k of this.owners.get(id) ?? []) next.add(k);
      for (const pin of c.pins) for (const k of this.owners.get(`mcu:${pin}`) ?? []) next.add(k);
    }
    // A cleared suspicion drops its ring; one that latched this slice keeps it for its post-mortem.
    const latched = new Set(this.queued.flatMap((r) => this.victims(r)));
    for (const k of this.suspected) if (!next.has(k) && !latched.has(k)) (this.series[k] as Series).hi = null;
    for (const k of latched) if ((this.series[k] as Series).hi) next.add(k);
    for (const k of next) {
      const s = this.series[k] as Series;
      s.hi ??= { ring: new Float32Array(this.highSamples), count: 0, lastSlice: -1 };
    }
    this.suspected = [...next];
  }

  private victims(r: DamageRecord): number[] {
    return [
      ...r.componentIds.flatMap((id) => this.owners.get(id) ?? []),
      ...r.pins.flatMap((pin) => this.owners.get(`mcu:${pin}`) ?? []),
    ];
  }

  private postMortem(r: DamageRecord): PostMortem {
    const victims = this.victims(r);
    const series: PostMortemSeries[] = [];
    const loN = Math.min(this.loCount, this.lowSamples, POSTMORTEM_LOW_SAMPLES);
    for (const k of victims) {
      const s = this.series[k] as Series;
      if (loN > 0) {
        const data = new Float32Array(loN);
        const peak = new Float32Array(loN);
        const first = this.loCount - loN;
        for (let j = 0; j < loN; j++) {
          const at = (first + j) % this.lowSamples;
          data[j] = s.loAvg[at] as number;
          peak[j] = s.loPeak[at] as number;
        }
        series.push({
          key: s.key,
          label: s.label,
          quantity: s.quantity,
          startSlice: this.loStart + first * BLACKBOX_LOW_EVERY,
          intervalSlices: BLACKBOX_LOW_EVERY,
          data,
          peak,
        });
      }
      const hi = s.hi;
      if (hi && hi.count > 0) {
        const m = Math.min(hi.count, this.highSamples);
        const data = new Float32Array(m);
        for (let j = 0; j < m; j++) data[j] = hi.ring[(hi.count - m + j) % this.highSamples] as number;
        series.push({
          key: s.key,
          label: s.label,
          quantity: s.quantity,
          startSlice: hi.lastSlice - m + 1,
          intervalSlices: 1,
          data,
        });
      }
    }
    return {
      record: { ...r, finding: r.finding ? findingView(r.finding) : null },
      series,
      code: this.code(r),
      ...(this.capped ? { capped: true as const } : {}),
    };
  }

  private code(r: DamageRecord): PostMortem['code'] {
    const mcu = this.scenario.circuit.sim.mcu;
    const lines = this.serialTail.split(/\r?\n/).filter((l) => l.trim() !== '');
    const changedPins: { pin: string; level: 0 | 1; msBefore: number }[] = [];
    if (mcu) {
      const now = mcu.cycle;
      // The damage comes a sustain window after the cause: look back to just before the violation began.
      const window = (r.simTime - r.conditionSince + CHANGED_BEFORE_S) * mcu.clockHz;
      for (const [pin, c] of this.changes)
        if (now - c.cycle <= window)
          changedPins.push({ pin, level: c.level, msBefore: ((now - c.cycle) / mcu.clockHz) * 1000 });
      changedPins.sort((a, b) => a.msBefore - b.msBefore);
    }
    return { serialLine: lines.at(-1) ?? null, changedPins };
  }
}
