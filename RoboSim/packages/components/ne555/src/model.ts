import type {
  ComponentIO,
  ComponentModel,
  Damageable,
  Fault,
  Level,
  MnaSolution,
  MnaStamper,
  ModelContext,
  NetId,
  SourceHandle,
} from '@robosim/sim-core';

export type Ne555Props = Record<string, never>;

export interface Ne555State {
  readonly vcc: number;
  /** Flip-flop: 1 = output high, discharge off; null while unpowered or damaged. */
  readonly output: Level | null;
  /** Output voltage averaged over the last slice (V). */
  readonly outVolts: number;
  /** Output current, positive when sourcing (mA). */
  readonly outMa: number;
  /** Measured from the last full output cycle; 0 when the output has stopped toggling. */
  readonly freqHz: number;
  readonly duty: number;
  readonly damaged: boolean;
}

/** NE555 (TI datasheet, VCC = 5 V): ≈ 3 mA quiescent, ≈ 10 mA at 15 V. */
const QUIESCENT_OHMS = 5 / 0.003;
/** Internal divider: 5 kΩ from VCC to CTRL, 2 × 5 kΩ from CTRL to GND (the trigger reference is the tap). */
const DIVIDER_TOP_OHMS = 5000;
const DIVIDER_BOTTOM_OHMS = 10000;
/** Totem-pole output: high ≈ VCC − 1.4 V (VCC − 1.7 V at 100 mA), low ≈ 0.1 V at 10 mA, 0.4 V at 50 mA. */
const HIGH_DROP_V = 1.4;
const HIGH_OHMS = 3;
const LOW_V = 0.05;
const LOW_OHMS = 7;
/** Discharge transistor saturated (≈ 0.15 V at 10 mA). */
const DISCHARGE_OHMS = 15;
const RESET_THRESHOLD_V = 0.7;
/** Below this the bipolar 555 does not run (datasheet minimum is 4.5 V). */
const MIN_RUN_VCC = 3.5;
const MAX_VCC = 16;
const MAX_OUT_A = 0.2;
/** Frequency readout gives up after this long without an output edge (s). */
const STOPPED_AFTER_S = 2;

/**
 * NE555 timer (Technical Design §5.4, Tier B). The internal divider is stamped (so an external CTRL
 * capacitor or voltage works), the two comparators and the flip-flop are evaluated against the
 * instantaneous operating point in `settle`, and `pendingSwitch` lets the integrator land each switch
 * within a microsecond, so an astable runs at f = 1.44 / ((R1 + 2·R2)·C) like the datasheet.
 */
export class Ne555 implements ComponentModel<Ne555Props, Ne555State>, Damageable {
  readonly type = 'ic.ne555';
  private id = '';
  private gnd: NetId = 0;
  private vccNet: NetId = 0;
  private trig: NetId = 0;
  private thr: NetId = 0;
  private ctrl: NetId = 0;
  private reset: NetId = 0;
  private out: NetId = 0;
  private dis: NetId = 0;
  private q: Level = 0;
  private powered = false;
  private outHandle: SourceHandle | null = null;
  private vcc = 0;
  private outVolts = 0;
  private outA = 0;
  private lastRise: number | null = null;
  private lastFall: number | null = null;
  private periodS = 0;
  private highS = 0;
  private now = 0;

  damaged = false;

  damage(_reason: string): void {
    this.damaged = true;
  }

  init(ctx: ModelContext): void {
    this.id = ctx.id;
    this.gnd = ctx.net('gnd');
    this.vccNet = ctx.net('vcc');
    this.trig = ctx.net('trig');
    this.thr = ctx.net('thr');
    this.ctrl = ctx.net('ctrl');
    this.reset = ctx.net('reset');
    this.out = ctx.net('out');
    this.dis = ctx.net('dis');
  }

  stamp(s: MnaStamper): void {
    const g = this.gnd;
    s.conductance(this.vccNet, g, 1 / QUIESCENT_OHMS);
    s.conductance(this.vccNet, this.ctrl, 1 / DIVIDER_TOP_OHMS);
    s.conductance(this.ctrl, g, 1 / DIVIDER_BOTTOM_OHMS);
    this.outHandle = null;
    if (this.damaged || !this.powered) return;
    // The high side follows VCC (a transformer leg of ratio 1) and draws its current from it.
    this.outHandle =
      this.q === 1
        ? s.transformer(this.vccNet, g, this.out, g, 1, { offsetV: HIGH_DROP_V, seriesResistance: HIGH_OHMS })
        : s.voltageSource(this.out, g, LOW_V, LOW_OHMS);
    if (this.q === 0) s.conductance(this.dis, g, 1 / DISCHARGE_OHMS);
  }

  step(_dt: number, io: ComponentIO): void {
    const sol = io.solution;
    this.vcc = sol.voltage(this.vccNet) - sol.voltage(this.gnd);
    this.outVolts = sol.voltage(this.out) - sol.voltage(this.gnd);
    this.outA = this.outHandle === null ? 0 : sol.sourceCurrent(this.outHandle);
    this.now = io.now;
  }

  settle(io: ComponentIO): boolean {
    if (this.damaged) return false;
    const { powered, q } = this.decide(io.solution);
    if (powered === this.powered && q === this.q) return false;
    if (q !== this.q && powered) this.recordEdge(q, io.now);
    this.powered = powered;
    this.q = q;
    return true;
  }

  pendingSwitch(solution: MnaSolution): boolean {
    if (this.damaged) return false;
    const { powered, q } = this.decide(solution);
    return powered !== this.powered || q !== this.q;
  }

  faults(): readonly Fault[] {
    const out: Fault[] = [];
    if (this.vcc > MAX_VCC)
      out.push({ code: 'OVER_VOLTAGE', componentId: this.id, params: { volts: this.vcc, limitV: MAX_VCC } });
    if (Math.abs(this.outA) > MAX_OUT_A)
      out.push({
        code: 'OVER_CURRENT',
        componentId: this.id,
        params: { currentMa: Math.abs(this.outA) * 1000, limitMa: MAX_OUT_A * 1000 },
      });
    return out;
  }

  snapshot(): Ne555State {
    const running = this.powered && !this.damaged;
    const lastEdge = Math.max(this.lastRise ?? -Infinity, this.lastFall ?? -Infinity);
    const stopped = !running || this.now - lastEdge > Math.max(STOPPED_AFTER_S, 2 * this.periodS);
    return {
      vcc: this.vcc,
      output: running ? this.q : null,
      outVolts: this.outVolts,
      outMa: this.outA * 1000,
      freqHz: stopped || this.periodS <= 0 ? 0 : 1 / this.periodS,
      duty: stopped || this.periodS <= 0 ? 0 : this.highS / this.periodS,
      damaged: this.damaged,
    };
  }

  /** Datasheet truth table: RESET low wins, then TRIG below CTRL/2 sets, THR above CTRL resets. */
  private decide(sol: MnaSolution): { powered: boolean; q: Level } {
    const v = (n: NetId) => sol.voltage(n) - sol.voltage(this.gnd);
    const vcc = v(this.vccNet);
    if (vcc < MIN_RUN_VCC) return { powered: false, q: 0 };
    if (v(this.reset) < RESET_THRESHOLD_V) return { powered: true, q: 0 };
    const ref = v(this.ctrl);
    if (v(this.trig) < ref / 2) return { powered: true, q: 1 };
    if (v(this.thr) > ref) return { powered: true, q: 0 };
    return { powered: true, q: this.q };
  }

  private recordEdge(q: Level, time: number): void {
    if (q === 1) {
      if (this.lastRise !== null) this.periodS = time - this.lastRise;
      this.lastRise = time;
    } else {
      if (this.lastRise !== null) this.highS = time - this.lastRise;
      this.lastFall = time;
    }
  }
}
