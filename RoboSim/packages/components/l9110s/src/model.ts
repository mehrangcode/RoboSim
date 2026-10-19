import type {
  ComponentIO,
  ComponentModel,
  Damageable,
  Fault,
  MnaStamper,
  ModelContext,
  NetId,
  SourceHandle,
} from '@robosim/sim-core';

export type L9110sProps = Record<string, never>;

export type L9110sMode = 'forward' | 'reverse' | 'brake' | 'off';

export interface L9110sState {
  readonly modeA: L9110sMode;
  readonly modeB: L9110sMode;
  /** Current sourced out of OA1 / OB1 (mA). */
  readonly currentAMa: number;
  readonly currentBMa: number;
  readonly vcc: number;
  readonly damaged: boolean;
}

/** Bipolar bridge: ≈ 0.85 V saturation plus 0.6 Ω per conducting leg (≈ 1.2 V total at 300 mA). */
const HIGH_SIDE_DROP_V = 0.85;
const LEG_OHMS = 0.6;
const VIH = 2;
const VIL = 0.8;
const MIN_VCC = 2.5;
const MAX_VCC = 12;
const MAX_PEAK_A = 1.5;
const RESTAMP = 1e-3;
/** Output-stage clamp diodes: a coasting motor's current returns to VCC or comes from GND. */
const CLAMP = { vf: 0.8, rs: 0.2 } as const;

interface Channel {
  readonly ia: NetId;
  readonly ib: NetId;
  readonly out1: NetId;
  readonly out2: NetId;
}

/**
 * L9110S dual H-bridge module (Technical Design §5.4): one supply for motor and logic (2.5–12 V).
 * Per channel IA = H, IB = L drives forward, the reverse turns back, L/L brakes both outputs LOW, and
 * H/H floats them. PWM on the HIGH input sets the averaged leg voltage.
 */
export class L9110s implements ComponentModel<L9110sProps, L9110sState>, Damageable {
  readonly type = 'driver.l9110s';
  private id = '';
  private vccNet: NetId = 0;
  private gnd: NetId = 0;
  private channels: Channel[] = [];
  private drives: ({ a: number; b: number } | null)[] = [null, null];
  private modes: L9110sMode[] = ['off', 'off'];
  private levels = new Map<NetId, 0 | 1>();
  private handles: (SourceHandle | null)[] = [];
  private currents = [0, 0];
  private vcc = 0;

  damaged = false;

  damage(_reason: string): void {
    this.damaged = true;
    this.drives = [null, null];
  }

  init(ctx: ModelContext): void {
    this.id = ctx.id;
    this.vccNet = ctx.net('vcc');
    this.gnd = ctx.net('gnd');
    const ch = (p: 'a' | 'b'): Channel => ({
      ia: ctx.net(`${p}-ia`),
      ib: ctx.net(`${p}-ib`),
      out1: ctx.net(`o${p}1`),
      out2: ctx.net(`o${p}2`),
    });
    this.channels = [ch('a'), ch('b')];
  }

  stamp(s: MnaStamper): void {
    const g = this.gnd;
    for (const c of this.channels)
      for (const out of [c.out1, c.out2]) {
        s.diode(out, this.vccNet, CLAMP);
        s.diode(g, out, CLAMP);
      }
    this.handles = this.channels.map((c, i) => {
      const d = this.damaged ? null : this.drives[i];
      if (!d) return null;
      const leg = (out: NetId, f: number) =>
        s.transformer(this.vccNet, g, out, g, f, {
          seriesResistance: LEG_OHMS,
          offsetV: f * HIGH_SIDE_DROP_V,
        });
      const h = leg(c.out1, d.a);
      leg(c.out2, d.b);
      return h;
    });
  }

  step(_dt: number, io: ComponentIO): void {
    const sol = io.solution;
    const rel = (n: NetId) => sol.voltage(n) - sol.voltage(this.gnd);
    this.vcc = rel(this.vccNet);
    this.currents = this.handles.map((h) => (h === null ? 0 : sol.sourceCurrent(h)));
    let changed = false;
    this.channels.forEach((c, i) => {
      let next: { a: number; b: number } | null = null;
      let mode: L9110sMode = 'off';
      if (!this.damaged && this.vcc >= MIN_VCC) {
        const a = this.fraction(c.ia, io, rel);
        const b = this.fraction(c.ib, io, rel);
        if (a * b < 0.5) {
          next = { a: a * (1 - b), b: (1 - a) * b };
          mode = next.a > next.b ? 'forward' : next.b > next.a ? 'reverse' : 'brake';
        }
      }
      const prev = this.drives[i] ?? null;
      if (
        (prev === null) !== (next === null) ||
        (prev && next && (Math.abs(prev.a - next.a) > RESTAMP || Math.abs(prev.b - next.b) > RESTAMP))
      )
        changed = true;
      this.drives[i] = next;
      this.modes[i] = mode;
    });
    if (changed) io.invalidate();
  }

  faults(): readonly Fault[] {
    const out: Fault[] = [];
    if (this.vcc > MAX_VCC)
      out.push({ code: 'OVER_VOLTAGE', componentId: this.id, params: { volts: this.vcc, limitV: MAX_VCC } });
    this.currents.forEach((a, i) => {
      if (Math.abs(a) > MAX_PEAK_A)
        out.push({
          code: 'OVER_CURRENT',
          componentId: this.id,
          params: { channel: i === 0 ? 'A' : 'B', currentMa: Math.abs(a) * 1000, limitMa: MAX_PEAK_A * 1000 },
        });
    });
    return out;
  }

  snapshot(): L9110sState {
    return {
      modeA: this.modes[0] ?? 'off',
      modeB: this.modes[1] ?? 'off',
      currentAMa: (this.currents[0] ?? 0) * 1000,
      currentBMa: (this.currents[1] ?? 0) * 1000,
      vcc: this.vcc,
      damaged: this.damaged,
    };
  }

  private fraction(net: NetId, io: ComponentIO, rel: (n: NetId) => number): number {
    const pwm = io.pwm(net);
    if (pwm) return pwm.dutyRatio;
    const v = rel(net);
    const prev = this.levels.get(net) ?? 0;
    const level: 0 | 1 = v >= VIH ? 1 : v <= VIL ? 0 : prev;
    this.levels.set(net, level);
    return level;
  }
}
