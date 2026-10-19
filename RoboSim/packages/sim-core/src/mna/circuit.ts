import type {
  BjtParams,
  CapacitorOptions,
  DiodeHandle,
  DiodeParams,
  InductorOptions,
  MnaSolution,
  MnaStamper,
  MosfetParams,
  NetId,
  ReactiveState,
  SourceHandle,
  TransistorHandle,
  TransistorReading,
  TransistorRegion,
  VoltageSourceOptions,
} from '../contracts.js';
import { luSolveInPlace } from './lu.js';

/** Conductance from every net to ground so floating nets never make the matrix singular (SPICE GMIN). */
export const GMIN = 1e-12;
/** Leakage conductance of a diode in its off region. */
export const DIODE_OFF_CONDUCTANCE = 1e-9;
/** Upper bound on PWL region-selection passes (Technical Design §5.4). */
export const MAX_DIODE_ITERATIONS = 10;
/** Passes allowed when transistors join the diodes: BJT regions plus MOSFET Newton steps. */
export const MAX_NONLINEAR_ITERATIONS = 60;
/** A MOSFET linearisation has converged when its Vgs and Vds move less than this (V). */
const MOSFET_TOLERANCE_V = 1e-6;
/** Largest Vgs change per Newton step (V), so a gate swinging rail to rail does not overshoot. */
const MOSFET_VGS_STEP_V = 2;
/** Time step of a DC solve: capacitors open, inductors short. */
export const DC_STEP = Infinity;
/** Resistance standing in for an open capacitor in a DC solve (Ω). */
const OPEN_OHMS = 1e12;
/** Steps shorter than this are "instant" re-solves (no time passes): always first order. */
const INSTANT_LIMIT_S = 1e-7;
/**
 * Local truncation error allowed per step, absolute + relative: capacitor voltages tightly (timers
 * switch on them), inductor currents (motor windings) to what a load needs.
 */
const LTE_ABS_V = 1e-3;
const LTE_REL_V = 1e-3;
const LTE_ABS_A = 1e-3;
const LTE_REL_A = 5e-3;

interface Conductance {
  readonly a: NetId;
  readonly b: NetId;
  readonly g: number;
}
interface CurrentSource {
  readonly from: NetId;
  readonly to: NetId;
  readonly amps: number;
}
/**
 * Branch element with its own current unknown I (flowing into `pos`). KVL row:
 * V(pos) − V(neg) − ratio·(V(ctrlPos) − V(ctrlNeg)) − r·I = volts. KCL: I leaves `pos` and enters
 * `returnNet`; a transformer additionally draws ratio·I from its primary.
 */
interface Branch {
  readonly pos: NetId;
  readonly neg: NetId;
  readonly volts: number;
  readonly r: number;
  readonly returnNet: NetId;
  readonly control: { readonly pos: NetId; readonly neg: NetId; readonly ratio: number } | null;
  /** Capacitor / inductor: `r` and `volts` follow from the time step and the element's state. */
  readonly reactive: Reactive | null;
}
type Reactive =
  | { readonly kind: 'C'; readonly farads: number; readonly esr: number; readonly state: ReactiveState }
  | {
      readonly kind: 'L';
      readonly henries: number;
      readonly r: number;
      readonly emf: number;
      readonly state: ReactiveState;
    };
interface Diode extends DiodeParams {
  readonly anode: NetId;
  readonly cathode: NetId;
}
interface Bjt extends BjtParams {
  readonly c: NetId;
  readonly b: NetId;
  readonly e: NetId;
}
interface Mosfet extends MosfetParams {
  readonly d: NetId;
  readonly g: NetId;
  readonly s: NetId;
}
type BjtRegion = 'cutoff' | 'active' | 'saturation';
/** Operating point a MOSFET is linearised around, in its own frame (N-channel signs). */
interface MosfetPoint {
  readonly vgs: number;
  readonly vds: number;
}

/** Transistor results of one solve: main / control current and region per device. */
interface TransistorResults {
  readonly main: Float64Array;
  readonly control: Float64Array;
  readonly power: Float64Array;
  readonly regions: readonly TransistorRegion[];
}
const NO_TRANSISTORS: TransistorResults = {
  main: new Float64Array(0),
  control: new Float64Array(0),
  power: new Float64Array(0),
  regions: [],
};
const CUTOFF: TransistorReading = { main: 0, control: 0, region: 'cutoff', power: 0 };

class Solution implements MnaSolution {
  constructor(
    readonly converged: boolean,
    private readonly volts: Float64Array,
    private readonly sources: Float64Array,
    private readonly diodes: Float64Array,
    private readonly devices: TransistorResults = NO_TRANSISTORS,
  ) {}

  get shape(): SolutionShape {
    return {
      nets: this.volts.length - 1,
      sources: this.sources.length,
      diodes: this.diodes.length,
      transistors: this.devices.regions.length,
    };
  }

  transistor(h: TransistorHandle): TransistorReading {
    const region = this.devices.regions[h];
    if (region === undefined) return CUTOFF;
    return {
      main: this.devices.main[h] ?? 0,
      control: this.devices.control[h] ?? 0,
      region,
      power: this.devices.power[h] ?? 0,
    };
  }

  voltage(net: NetId): number {
    return this.volts[net] ?? 0;
  }

  sourceCurrent(h: SourceHandle): number {
    return this.sources[h] ?? 0;
  }

  diodeCurrent(h: DiodeHandle): number {
    return this.diodes[h] ?? 0;
  }
}

/**
 * Time-averaged operating point for PWM (Technical Design §5.4): `base` has every PWM source low and
 * each part has exactly one PWM source high, so avg = base + Σ dutyᵢ·(partᵢ − base). Exact when the
 * PWM-driven sub-circuits are independent (separate LEDs, motor channels); an approximation otherwise.
 * All solutions must come from identically structured stamps so handles line up.
 */
export class AveragedSolution implements MnaSolution {
  readonly converged: boolean;

  constructor(
    private readonly base: MnaSolution,
    private readonly parts: readonly { readonly solution: MnaSolution; readonly duty: number }[],
  ) {
    this.converged = base.converged && parts.every((p) => p.solution.converged);
  }

  get shape(): SolutionShape | null {
    return shapeOf(this.base);
  }

  voltage(net: NetId): number {
    return this.blend((s) => s.voltage(net));
  }

  sourceCurrent(h: SourceHandle): number {
    return this.blend((s) => s.sourceCurrent(h));
  }

  diodeCurrent(h: DiodeHandle): number {
    return this.blend((s) => s.diodeCurrent(h));
  }

  /** Currents blended like everything else; the region is the base (all-low) phase's. */
  transistor(h: TransistorHandle): TransistorReading {
    return {
      main: this.blend((s) => s.transistor(h).main),
      control: this.blend((s) => s.transistor(h).control),
      region: this.base.transistor(h).region,
      power: this.blend((s) => s.transistor(h).power),
    };
  }

  private blend(read: (s: MnaSolution) => number): number {
    const b = read(this.base);
    let v = b;
    for (const p of this.parts) v += p.duty * (read(p.solution) - b);
    return v;
  }
}

/** Sizes of a solution, for blending solutions of identically structured stamps. */
export interface SolutionShape {
  readonly nets: number;
  readonly sources: number;
  readonly diodes: number;
  readonly transistors: number;
}

/**
 * Time average of the operating points of one slice (Tier B transient integration): each sub-step's
 * solution weighted by its duration. Components read it in `step`, so an LED blinked by a 555 at 1 kHz
 * shows its mean brightness and a motor sees its mean current, as with PWM averaging.
 */
export class WeightedSolution implements MnaSolution {
  private readonly volts: Float64Array;
  private readonly sources: Float64Array;
  private readonly diodes: Float64Array;
  private readonly main: Float64Array;
  private readonly control: Float64Array;
  private readonly power: Float64Array;
  private regions: TransistorRegion[] = [];
  private weight = 0;
  private allConverged = true;

  constructor(readonly shape: SolutionShape) {
    this.volts = new Float64Array(shape.nets + 1);
    this.sources = new Float64Array(shape.sources);
    this.diodes = new Float64Array(shape.diodes);
    this.main = new Float64Array(shape.transistors);
    this.control = new Float64Array(shape.transistors);
    this.power = new Float64Array(shape.transistors);
  }

  get converged(): boolean {
    return this.allConverged;
  }

  get empty(): boolean {
    return this.weight === 0;
  }

  /** Adds `s` held for `w` seconds; returns false (and ignores it) when its shape differs. */
  add(s: MnaSolution, w: number): boolean {
    const { nets, sources, diodes } = this.shape;
    if (!sameShape(shapeOf(s), this.shape)) return false;
    for (let n = 1; n <= nets; n++) this.volts[n] = (this.volts[n] ?? 0) + w * s.voltage(n);
    for (let k = 0; k < sources; k++)
      this.sources[k] = (this.sources[k] ?? 0) + w * s.sourceCurrent(k as SourceHandle);
    for (let k = 0; k < diodes; k++)
      this.diodes[k] = (this.diodes[k] ?? 0) + w * s.diodeCurrent(k as DiodeHandle);
    const regions: TransistorRegion[] = [];
    for (let k = 0; k < this.shape.transistors; k++) {
      const t = s.transistor(k as TransistorHandle);
      this.main[k] = (this.main[k] ?? 0) + w * t.main;
      this.control[k] = (this.control[k] ?? 0) + w * t.control;
      this.power[k] = (this.power[k] ?? 0) + w * t.power;
      regions.push(t.region);
    }
    this.regions = regions; // the region at the end of the slice
    this.weight += w;
    this.allConverged &&= s.converged;
    return true;
  }

  voltage(net: NetId): number {
    return this.weight > 0 ? (this.volts[net] ?? 0) / this.weight : 0;
  }

  sourceCurrent(h: SourceHandle): number {
    return this.weight > 0 ? (this.sources[h] ?? 0) / this.weight : 0;
  }

  diodeCurrent(h: DiodeHandle): number {
    return this.weight > 0 ? (this.diodes[h] ?? 0) / this.weight : 0;
  }

  transistor(h: TransistorHandle): TransistorReading {
    const region = this.regions[h];
    if (region === undefined || this.weight === 0) return CUTOFF;
    const w = this.weight;
    return {
      main: (this.main[h] ?? 0) / w,
      control: (this.control[h] ?? 0) / w,
      region,
      power: (this.power[h] ?? 0) / w,
    };
  }
}

/** Shape of a solution produced by {@link MnaCircuit} (directly, PWM-averaged or weighted), else null. */
export function shapeOf(s: MnaSolution): SolutionShape | null {
  const shaped = s as Partial<{ shape: SolutionShape }>;
  return shaped.shape ?? null;
}

function sameShape(a: SolutionShape | null, b: SolutionShape): boolean {
  return (
    a !== null &&
    a.nets === b.nets &&
    a.sources === b.sources &&
    a.diodes === b.diodes &&
    a.transistors === b.transistors
  );
}

/** Solution of an empty / not-yet-solved circuit: every node at 0 V. */
export const ZERO_SOLUTION: MnaSolution = new Solution(
  true,
  new Float64Array(1),
  new Float64Array(0),
  new Float64Array(0),
);

/**
 * Modified nodal analysis at DC operating points (Technical Design §5.4). Components stamp elements
 * via the {@link MnaStamper} API; {@link solve} assembles and solves A·x = z, iterating diode regions.
 * Unknowns: node voltages for nets 1..N, then one branch current per voltage source.
 */
export class MnaCircuit implements MnaStamper {
  private conductances: Conductance[] = [];
  private currents: CurrentSource[] = [];
  private sources: Branch[] = [];
  private diodes: Diode[] = [];
  /** Transistors in stamp order: a BJT or a MOSFET per handle. */
  private devices: (Bjt | Mosfet)[] = [];
  /** Indices into `sources` of capacitors and inductors. */
  private reactive: number[] = [];
  /** Diode regions from the previous solve, used as the starting guess (warm start). */
  private regions: boolean[] = [];
  /** Transistor regions and MOSFET operating points from the previous solve (warm start). */
  private deviceRegions: BjtRegion[] = [];
  private devicePoints: MosfetPoint[] = [];

  constructor(readonly netCount: number) {}

  /** Drops all stamped elements; call before restamping after a change. */
  clear(): void {
    this.conductances = [];
    this.currents = [];
    this.sources = [];
    this.diodes = [];
    this.devices = [];
    this.reactive = [];
  }

  conductance(a: NetId, b: NetId, siemens: number): void {
    this.checkNet(a);
    this.checkNet(b);
    if (!(siemens >= 0) || !Number.isFinite(siemens))
      throw new RangeError(`Conductance must be finite and ≥ 0, got ${siemens}`);
    this.conductances.push({ a, b, g: siemens });
  }

  /** Convenience for resistors (Ω). */
  resistor(a: NetId, b: NetId, ohms: number): void {
    if (!(ohms > 0)) throw new RangeError(`Resistance must be > 0, got ${ohms}`);
    this.conductance(a, b, 1 / ohms);
  }

  currentSource(from: NetId, to: NetId, amps: number): void {
    this.checkNet(from);
    this.checkNet(to);
    this.currents.push({ from, to, amps });
  }

  voltageSource(
    pos: NetId,
    neg: NetId,
    volts: number,
    seriesResistance = 0,
    options: VoltageSourceOptions = {},
  ): SourceHandle {
    this.checkNet(pos);
    this.checkNet(neg);
    const returnNet = options.supplyFrom ?? neg;
    this.checkNet(returnNet);
    if (!(seriesResistance >= 0))
      throw new RangeError(`Series resistance must be ≥ 0, got ${seriesResistance}`);
    this.sources.push({ pos, neg, volts, r: seriesResistance, returnNet, control: null, reactive: null });
    return (this.sources.length - 1) as SourceHandle;
  }

  transformer(
    primaryPos: NetId,
    primaryNeg: NetId,
    secondaryPos: NetId,
    secondaryNeg: NetId,
    ratio: number,
    options: { readonly seriesResistance?: number; readonly offsetV?: number } = {},
  ): SourceHandle {
    for (const n of [primaryPos, primaryNeg, secondaryPos, secondaryNeg]) this.checkNet(n);
    const r = options.seriesResistance ?? 0;
    if (!(r >= 0)) throw new RangeError(`Series resistance must be ≥ 0, got ${r}`);
    if (!Number.isFinite(ratio)) throw new RangeError(`Transformer ratio must be finite, got ${ratio}`);
    this.sources.push({
      pos: secondaryPos,
      neg: secondaryNeg,
      volts: -(options.offsetV ?? 0),
      r,
      returnNet: secondaryNeg,
      control: { pos: primaryPos, neg: primaryNeg, ratio },
      reactive: null,
    });
    return (this.sources.length - 1) as SourceHandle;
  }

  diode(anode: NetId, cathode: NetId, params: DiodeParams): DiodeHandle {
    this.checkNet(anode);
    this.checkNet(cathode);
    if (!(params.rs > 0)) throw new RangeError(`Diode series resistance must be > 0, got ${params.rs}`);
    this.diodes.push({ anode, cathode, vf: params.vf, rs: params.rs });
    return (this.diodes.length - 1) as DiodeHandle;
  }

  bjt(collector: NetId, base: NetId, emitter: NetId, params: BjtParams): TransistorHandle {
    for (const n of [collector, base, emitter]) this.checkNet(n);
    if (!(params.beta > 0) || !(params.rb > 0) || !(params.rceSat > 0))
      throw new RangeError('BJT beta, rb and rceSat must be > 0');
    this.devices.push({ ...params, c: collector, b: base, e: emitter });
    return (this.devices.length - 1) as TransistorHandle;
  }

  mosfet(drain: NetId, gate: NetId, source: NetId, params: MosfetParams): TransistorHandle {
    for (const n of [drain, gate, source]) this.checkNet(n);
    if (!(params.k > 0)) throw new RangeError(`MOSFET k must be > 0, got ${params.k}`);
    this.devices.push({ ...params, d: drain, g: gate, s: source });
    return (this.devices.length - 1) as TransistorHandle;
  }

  capacitor(
    a: NetId,
    b: NetId,
    farads: number,
    state: ReactiveState,
    options: CapacitorOptions = {},
  ): SourceHandle {
    this.checkNet(a);
    this.checkNet(b);
    if (!(farads > 0) || !Number.isFinite(farads))
      throw new RangeError(`Capacitance must be finite and > 0, got ${farads}`);
    const esr = options.esr ?? 0;
    if (!(esr >= 0)) throw new RangeError(`ESR must be ≥ 0, got ${esr}`);
    return this.pushReactive(a, b, { kind: 'C', farads, esr, state });
  }

  inductor(
    a: NetId,
    b: NetId,
    henries: number,
    state: ReactiveState,
    options: InductorOptions = {},
  ): SourceHandle {
    this.checkNet(a);
    this.checkNet(b);
    if (!(henries > 0) || !Number.isFinite(henries))
      throw new RangeError(`Inductance must be finite and > 0, got ${henries}`);
    const r = options.seriesResistance ?? 0;
    if (!(r >= 0)) throw new RangeError(`Series resistance must be ≥ 0, got ${r}`);
    return this.pushReactive(a, b, { kind: 'L', henries, r, emf: options.emf ?? 0, state });
  }

  /** Number of capacitors and inductors in the present stamp; > 0 means the circuit needs time steps. */
  get reactiveCount(): number {
    return this.reactive.length;
  }

  /** Nets touched by a capacitor or inductor (ground excluded). */
  reactiveNets(): Set<NetId> {
    const nets = new Set<NetId>();
    for (const k of this.reactive) {
      const b = this.sources[k];
      if (b && b.pos !== 0) nets.add(b.pos);
      if (b && b.neg !== 0) nets.add(b.neg);
    }
    return nets;
  }

  /** Base and gate nets of the stamped transistors (ground excluded). */
  controlNets(): Set<NetId> {
    const nets = new Set<NetId>();
    for (const d of this.devices) {
      const n = isBjt(d) ? d.b : d.g;
      if (n !== 0) nets.add(n);
    }
    return nets;
  }

  /**
   * Accepts a step of length `h` that produced `s` (from `solve(h)` with the same stamp): capacitor
   * voltages and inductor currents move on, every element's `state` is updated, and the old value
   * becomes the history of the next second-order step.
   */
  commit(s: MnaSolution, h: number): void {
    if (!Number.isFinite(h)) return;
    for (const k of this.reactive) {
      const b = this.sources[k];
      const r = b?.reactive;
      if (!b || !r) continue;
      const amps = -s.sourceCurrent(k as SourceHandle);
      const { a0, a1, a2 } = bdf(r.state, h);
      if (r.kind === 'C') {
        // I = C·(a0·v' + a1·v + a2·v_prev)  →  the new capacitance voltage v'.
        const prev = r.state.history?.value ?? 0;
        const next = (amps / r.farads - a1 * r.state.volts - a2 * prev) / a0;
        r.state.history = { value: r.state.volts, h };
        r.state.volts = next;
      } else {
        r.state.history = { value: r.state.amps, h };
        r.state.volts = s.voltage(b.pos) - s.voltage(b.neg);
      }
      r.state.amps = amps;
    }
  }

  /**
   * Forgets integration history after a discontinuity (an MCU edge, a comparator switching): the next
   * step is first order (backward Euler), like SPICE after a breakpoint.
   */
  restart(): void {
    for (const k of this.reactive) {
      const r = this.sources[k]?.reactive;
      if (r) r.state.history = undefined;
    }
  }

  /**
   * Local truncation error of a backward-Euler step, relative to its tolerance (≤ 1 is acceptable).
   * `start` is the operating point at the beginning of the step with the same stamp: the second
   * derivative follows from how much the element's current (C) or voltage (L) moved across the step.
   */
  lteRatio(start: MnaSolution, end: MnaSolution, h: number): number {
    let worst = 0;
    for (const k of this.reactive) {
      const b = this.sources[k];
      const r = b?.reactive;
      if (!b || !r) continue;
      const i0 = -start.sourceCurrent(k as SourceHandle);
      const i1 = -end.sourceCurrent(k as SourceHandle);
      let ratio: number;
      if (r.kind === 'C') {
        const err = (h * Math.abs(i1 - i0)) / (2 * r.farads);
        ratio = err / (LTE_ABS_V + LTE_REL_V * Math.abs(r.state.volts));
      } else {
        const vl = (s: MnaSolution, i: number) => s.voltage(b.pos) - s.voltage(b.neg) - r.r * i - r.emf;
        const err = (h * Math.abs(vl(end, i1) - vl(start, i0))) / (2 * r.henries);
        ratio = err / (LTE_ABS_A + LTE_REL_A * Math.abs(r.state.amps));
      }
      if (ratio > worst) worst = ratio;
    }
    return worst;
  }

  private pushReactive(a: NetId, b: NetId, reactive: Reactive): SourceHandle {
    this.sources.push({ pos: a, neg: b, volts: 0, r: 0, returnNet: b, control: null, reactive });
    this.reactive.push(this.sources.length - 1);
    return (this.sources.length - 1) as SourceHandle;
  }

  /**
   * Solves the operating point at the end of a time step of `h` seconds (backward Euler for capacitors
   * and inductors); the default is a DC solve. Element states change only through {@link commit}.
   */
  solve(h: number = DC_STEP): MnaSolution {
    if (!(h > 0)) throw new RangeError(`Time step must be > 0, got ${h}`);
    const regions = this.diodes.map((_, i) => this.regions[i] ?? false);
    const bjtRegions = this.devices.map((_, i) => this.deviceRegions[i] ?? 'cutoff');
    const points = this.devices.map((_, i) => this.devicePoints[i] ?? { vgs: 0, vds: 0 });
    // Circuits without transistors keep the diode-only bound, so their results never change.
    const limit = this.devices.length > 0 ? MAX_NONLINEAR_ITERATIONS : MAX_DIODE_ITERATIONS;
    for (let iteration = 1; iteration <= limit; iteration++) {
      const x = this.solveLinear(regions, h, bjtRegions, points);
      const volts = this.nodeVoltages(x);
      let changed = false;
      const diodeCurrents = new Float64Array(this.diodes.length);
      this.diodes.forEach((d, i) => {
        const vd = (volts[d.anode] ?? 0) - (volts[d.cathode] ?? 0);
        const on = regions[i] ?? false;
        const current = on ? (vd - d.vf) / d.rs : vd * DIODE_OFF_CONDUCTANCE;
        diodeCurrents[i] = current;
        const nextOn = on ? current >= 0 : vd > d.vf;
        if (nextOn !== on) {
          regions[i] = nextOn;
          changed = true;
        }
      });
      const devices = this.updateDevices(volts, bjtRegions, points);
      if (devices.changed) changed = true;
      if (!changed || iteration === limit) {
        this.regions = regions;
        this.deviceRegions = bjtRegions;
        this.devicePoints = points;
        const n = this.netCount;
        const sourceCurrents = new Float64Array(this.sources.length);
        this.sources.forEach((_, k) => (sourceCurrents[k] = -(x[n + k] ?? 0)));
        return new Solution(!changed, volts, sourceCurrents, diodeCurrents, devices.results);
      }
    }
    throw new Error('unreachable');
  }

  /**
   * Reads every transistor at the solved voltages: BJTs move to the region the solution implies,
   * MOSFETs take a Newton step to the new operating point. `changed` asks for another pass.
   */
  private updateDevices(
    volts: Float64Array,
    bjtRegions: BjtRegion[],
    points: MosfetPoint[],
  ): { changed: boolean; results: TransistorResults } {
    if (this.devices.length === 0) return { changed: false, results: NO_TRANSISTORS };
    let changed = false;
    const v = (net: NetId) => volts[net] ?? 0;
    const main = new Float64Array(this.devices.length);
    const control = new Float64Array(this.devices.length);
    const power = new Float64Array(this.devices.length);
    const out: TransistorRegion[] = [];
    this.devices.forEach((dev, i) => {
      if (isBjt(dev)) {
        const sg = dev.polarity === 'npn' ? 1 : -1;
        const vbe = sg * (v(dev.b) - v(dev.e));
        const vce = sg * (v(dev.c) - v(dev.e));
        const region = bjtRegions[i] ?? 'cutoff';
        const ib = region === 'cutoff' ? vbe * DIODE_OFF_CONDUCTANCE : (vbe - dev.vbe) / dev.rb;
        const ic =
          region === 'cutoff'
            ? vce * DIODE_OFF_CONDUCTANCE
            : region === 'active'
              ? dev.beta * ib
              : (vce - dev.vceSat) / dev.rceSat;
        let next: BjtRegion = region;
        if (region === 'cutoff') {
          if (vbe > dev.vbe) next = 'active';
        } else if (ib < 0) next = 'cutoff';
        else if (region === 'active' && vce < dev.vceSat) next = 'saturation';
        else if (region === 'saturation' && ic > dev.beta * ib) next = 'active';
        if (next !== region) {
          bjtRegions[i] = next;
          changed = true;
        }
        main[i] = ic;
        control[i] = ib;
        power[i] = vce * ic + vbe * ib;
        out.push(region);
      } else {
        const sg = dev.polarity === 'n' ? 1 : -1;
        const vgs = sg * (v(dev.g) - v(dev.s));
        const vds = sg * (v(dev.d) - v(dev.s));
        const op = points[i] ?? { vgs: 0, vds: 0 };
        const step = Math.max(-MOSFET_VGS_STEP_V, Math.min(MOSFET_VGS_STEP_V, vgs - op.vgs));
        const nextPoint = { vgs: op.vgs + step, vds };
        if (Math.abs(nextPoint.vgs - op.vgs) + Math.abs(nextPoint.vds - op.vds) > MOSFET_TOLERANCE_V) {
          points[i] = nextPoint;
          changed = true;
        }
        const e = mosfetAt(dev, vgs, vds);
        main[i] = e.id;
        control[i] = 0;
        power[i] = vds * e.id;
        out.push(e.region);
      }
    });
    return { changed, results: { main, control, power, regions: out } };
  }

  private solveLinear(
    diodeOn: readonly boolean[],
    h: number,
    bjtRegions: readonly BjtRegion[] = [],
    points: readonly MosfetPoint[] = [],
  ): Float64Array {
    const n = this.netCount;
    const size = n + this.sources.length;
    const a = new Float64Array(size * size);
    const z = new Float64Array(size);
    const addA = (row: NetId, col: NetId, v: number): void => {
      if (row > 0 && col > 0) a[(row - 1) * size + (col - 1)] = (a[(row - 1) * size + (col - 1)] ?? 0) + v;
    };
    const addZ = (row: NetId, v: number): void => {
      if (row > 0) z[row - 1] = (z[row - 1] ?? 0) + v;
    };
    const stampG = (p: NetId, q: NetId, g: number): void => {
      addA(p, p, g);
      addA(q, q, g);
      addA(p, q, -g);
      addA(q, p, -g);
    };
    const stampI = (from: NetId, to: NetId, amps: number): void => {
      addZ(from, -amps);
      addZ(to, amps);
    };

    for (let net = 1; net <= n; net++) addA(net, net, GMIN);
    for (const c of this.conductances) stampG(c.a, c.b, c.g);
    for (const c of this.currents) stampI(c.from, c.to, c.amps);
    this.diodes.forEach((d, i) => {
      if (diodeOn[i]) {
        // On region: I = (Vd − Vf)/Rs  ≡  conductance 1/Rs plus constant Vf/Rs injected into the anode.
        stampG(d.anode, d.cathode, 1 / d.rs);
        stampI(d.cathode, d.anode, d.vf / d.rs);
      } else {
        stampG(d.anode, d.cathode, DIODE_OFF_CONDUCTANCE);
      }
    });
    /** Current gm·(V(cp) − V(cn)) flowing from `from` through the device into `to`. */
    const stampVccs = (from: NetId, to: NetId, cp: NetId, cn: NetId, gm: number): void => {
      addA(from, cp, gm);
      addA(from, cn, -gm);
      addA(to, cp, -gm);
      addA(to, cn, gm);
    };
    this.devices.forEach((dev, i) => {
      if (isBjt(dev)) {
        const sg = dev.polarity === 'npn' ? 1 : -1;
        const region = bjtRegions[i] ?? 'cutoff';
        if (region === 'cutoff') {
          stampG(dev.b, dev.e, DIODE_OFF_CONDUCTANCE);
          stampG(dev.c, dev.e, DIODE_OFF_CONDUCTANCE);
          return;
        }
        // Base junction as an on PWL diode: Ib = (sg·Vbe − vbe) / rb, flowing b → e (NPN frame).
        stampG(dev.b, dev.e, 1 / dev.rb);
        stampI(dev.b, dev.e, (-sg * dev.vbe) / dev.rb);
        if (region === 'active') {
          // Ic = β·Ib, from c to e.
          stampVccs(dev.c, dev.e, dev.b, dev.e, dev.beta / dev.rb);
          stampI(dev.c, dev.e, (-sg * dev.beta * dev.vbe) / dev.rb);
          stampG(dev.c, dev.e, DIODE_OFF_CONDUCTANCE);
        } else {
          stampG(dev.c, dev.e, 1 / dev.rceSat);
          stampI(dev.c, dev.e, (-sg * dev.vceSat) / dev.rceSat);
        }
        return;
      }
      // MOSFET linearised at its operating point: id ≈ Id0 + gm·Δvgs + gds·Δvds (device frame).
      const sg = dev.polarity === 'n' ? 1 : -1;
      const op = points[i] ?? { vgs: 0, vds: 0 };
      const e = mosfetAt(dev, op.vgs, op.vds);
      const ieq = e.id - e.gm * op.vgs - e.gds * op.vds;
      stampG(dev.d, dev.s, e.gds + DIODE_OFF_CONDUCTANCE);
      stampVccs(dev.d, dev.s, dev.g, dev.s, e.gm);
      stampI(dev.d, dev.s, sg * ieq);
    });
    const add = (row: number, col: number, v: number): void => {
      a[row * size + col] = (a[row * size + col] ?? 0) + v;
    };
    this.sources.forEach((b, k) => {
      const m = n + k; // branch row/column, 0-based
      if (b.pos > 0) {
        add(b.pos - 1, m, 1);
        add(m, b.pos - 1, 1);
      }
      if (b.neg > 0) add(m, b.neg - 1, -1);
      if (b.returnNet > 0) add(b.returnNet - 1, m, -1);
      if (b.control) {
        const { pos, neg, ratio } = b.control;
        if (pos > 0) {
          add(m, pos - 1, -ratio);
          add(pos - 1, m, -ratio);
        }
        if (neg > 0) {
          add(m, neg - 1, ratio);
          add(neg - 1, m, ratio);
        }
      }
      const { r, volts } = b.reactive ? companion(b.reactive, h) : b;
      a[m * size + m] = -r;
      z[m] = volts;
    });

    luSolveInPlace(a, z, size);
    return z;
  }

  private nodeVoltages(x: Float64Array): Float64Array {
    const volts = new Float64Array(this.netCount + 1);
    volts.set(x.subarray(0, this.netCount), 1);
    return volts;
  }

  private checkNet(net: NetId): void {
    if (!Number.isInteger(net) || net < 0 || net > this.netCount) {
      throw new RangeError(`Net ${net} is outside 0..${this.netCount}`);
    }
  }
}

/**
 * Coefficients of the derivative at the end of a step of `h`: dx/dt ≈ a0·x' + a1·x + a2·x_prev.
 * Variable-step BDF2 (Gear 2: second order, L-stable, so stiff parts do not ring) when the element
 * has history; backward Euler (a2 = 0) on the first step and after a restart.
 */
function bdf(state: ReactiveState, h: number): { a0: number; a1: number; a2: number } {
  const hist = state.history;
  if (!hist || !(hist.h > 0)) return { a0: 1 / h, a1: -1 / h, a2: 0 };
  const w = h / hist.h;
  return { a0: (1 + 2 * w) / (h * (1 + w)), a1: -(1 + w) / h, a2: (w * w) / (h * (1 + w)) };
}

/**
 * Companion of a reactive branch for a step of `h` (Infinity = DC): the series resistance and source
 * voltage of its KVL row V(a) − V(b) − r·I = volts. "Instant" solves (tiny h) use backward Euler.
 */
function companion(e: Reactive, h: number): { r: number; volts: number } {
  if (!Number.isFinite(h)) return e.kind === 'C' ? { r: OPEN_OHMS, volts: 0 } : { r: e.r, volts: e.emf };
  const { a0, a1, a2 } = h < INSTANT_LIMIT_S ? { a0: 1 / h, a1: -1 / h, a2: 0 } : bdf(e.state, h);
  const prev = e.state.history?.value ?? 0;
  if (e.kind === 'C')
    // v' = (I/C − a1·v − a2·v_prev) / a0
    return { r: e.esr + 1 / (e.farads * a0), volts: -(a1 * e.state.volts + a2 * prev) / a0 };
  // V = r·I + emf + L·(a0·I + a1·I_n + a2·I_prev)
  return { r: e.r + e.henries * a0, volts: e.emf + e.henries * (a1 * e.state.amps + a2 * prev) };
}

const isBjt = (d: Bjt | Mosfet): d is Bjt => 'beta' in d;

/**
 * Level-1 MOSFET in its own frame (N-channel signs; `vgs` already includes the polarity): drain
 * current and its true derivatives with respect to the frame's Vgs (gate scale included) and Vds.
 * Reverse Vds swaps drain and source.
 */
function mosfetAt(
  p: Mosfet,
  vgs: number,
  vds: number,
): { id: number; gm: number; gds: number; region: TransistorRegion } {
  if (vds < 0) {
    // Source and drain trade places: id(vgs, vds) = −f(vgs − vds, −vds).
    const r = mosfetAt(p, vgs - vds, -vds);
    return { id: -r.id, gm: -r.gm, gds: r.gm + r.gds, region: r.region };
  }
  const scale = p.gateScale ?? 1;
  const vov = scale * vgs - p.vth;
  if (vov <= 0) return { id: 0, gm: 0, gds: 0, region: 'cutoff' };
  if (vds >= vov) return { id: p.k * vov * vov, gm: 2 * p.k * vov * scale, gds: 0, region: 'saturation' };
  return {
    id: p.k * (2 * vov * vds - vds * vds),
    gm: 2 * p.k * vds * scale,
    gds: 2 * p.k * (vov - vds),
    region: 'linear',
  };
}
