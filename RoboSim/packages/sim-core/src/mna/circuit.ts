import type {
  DiodeHandle,
  DiodeParams,
  MnaSolution,
  MnaStamper,
  NetId,
  SourceHandle,
  VoltageSourceOptions,
} from '../contracts.js';
import { luSolveInPlace } from './lu.js';

/** Conductance from every net to ground so floating nets never make the matrix singular (SPICE GMIN). */
export const GMIN = 1e-12;
/** Leakage conductance of a diode in its off region. */
export const DIODE_OFF_CONDUCTANCE = 1e-9;
/** Upper bound on PWL region-selection passes (Technical Design §5.4). */
export const MAX_DIODE_ITERATIONS = 10;

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
}
interface Diode extends DiodeParams {
  readonly anode: NetId;
  readonly cathode: NetId;
}

class Solution implements MnaSolution {
  constructor(
    readonly converged: boolean,
    private readonly volts: Float64Array,
    private readonly sources: Float64Array,
    private readonly diodes: Float64Array,
  ) {}

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

  voltage(net: NetId): number {
    return this.blend((s) => s.voltage(net));
  }

  sourceCurrent(h: SourceHandle): number {
    return this.blend((s) => s.sourceCurrent(h));
  }

  diodeCurrent(h: DiodeHandle): number {
    return this.blend((s) => s.diodeCurrent(h));
  }

  private blend(read: (s: MnaSolution) => number): number {
    const b = read(this.base);
    let v = b;
    for (const p of this.parts) v += p.duty * (read(p.solution) - b);
    return v;
  }
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
  /** Diode regions from the previous solve, used as the starting guess (warm start). */
  private regions: boolean[] = [];

  constructor(readonly netCount: number) {}

  /** Drops all stamped elements; call before restamping after a change. */
  clear(): void {
    this.conductances = [];
    this.currents = [];
    this.sources = [];
    this.diodes = [];
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
    this.sources.push({ pos, neg, volts, r: seriesResistance, returnNet, control: null });
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

  solve(): MnaSolution {
    const regions = this.diodes.map((_, i) => this.regions[i] ?? false);
    for (let iteration = 1; iteration <= MAX_DIODE_ITERATIONS; iteration++) {
      const x = this.solveLinear(regions);
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
      if (!changed || iteration === MAX_DIODE_ITERATIONS) {
        this.regions = regions;
        const n = this.netCount;
        const sourceCurrents = new Float64Array(this.sources.length);
        this.sources.forEach((_, k) => (sourceCurrents[k] = -(x[n + k] ?? 0)));
        return new Solution(!changed, volts, sourceCurrents, diodeCurrents);
      }
    }
    throw new Error('unreachable');
  }

  private solveLinear(diodeOn: readonly boolean[]): Float64Array {
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
      a[m * size + m] = -b.r;
      z[m] = b.volts;
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
