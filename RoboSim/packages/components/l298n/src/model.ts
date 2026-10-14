import type {
  ComponentIO,
  ComponentModel,
  Fault,
  MnaSolution,
  MnaStamper,
  ModelContext,
  NetId,
  SourceHandle,
} from '@robosim/sim-core';

export interface L298nProps {
  readonly regulatorJumper: boolean;
  readonly enaJumper: boolean;
  readonly enbJumper: boolean;
}

export type BridgeMode = 'forward' | 'reverse' | 'brake' | 'coast';

export interface L298nState {
  readonly enableA: number;
  readonly enableB: number;
  readonly bridgeA: BridgeMode;
  readonly bridgeB: BridgeMode;
  /** Current sourced out of OUT1 / OUT3 (mA). */
  readonly currentAMa: number;
  readonly currentBMa: number;
  readonly vs: number;
  readonly v5: number;
}

// Calibration (Technical Design §5.4: total drop ≈ 1.8–2.5 V; L298 datasheet VCEsat(H) + VCEsat(L)):
// 1.6 V saturation floor plus 0.5 Ω per conducting leg → 1.75 V at 0.15 A, 2.1 V at 0.5 A, 2.6 V at 1 A.
const HIGH_SIDE_DROP_V = 1.6;
const LEG_OHMS = 0.5;
const VIH = 2.3;
const VIL = 1.5;
const LOGIC_MIN_V = 4.5;
const LOGIC_OHMS = 5 / 0.036; // 36 mA logic supply current
const REG_OUT_V = 5;
const REG_DROPOUT_V = 2; // 78M05
const REG_OHMS = 0.3;
const JUMPER_OHMS = 0.01;
const MAX_VS_V = 35;
const MAX_CHANNEL_A = 2;
const RESTAMP_EPSILON = 1e-3;

interface Channel {
  readonly en: NetId;
  readonly inA: NetId;
  readonly inB: NetId;
  readonly outA: NetId;
  readonly outB: NetId;
  readonly jumper: boolean;
}

/** Drive state of one bridge: high-side fractions for its two outputs (0..1), or null when coasting. */
interface Drive {
  readonly a: number;
  readonly b: number;
}

/**
 * L298N dual H-bridge module (behavioural, Technical Design §5.4). Logic inputs are high-impedance and
 * read as PWM duty (from the MCU) or as DC levels with hysteresis. Each enabled output is a
 * PWM-averaged leg: V(out) = f·(V(vs) − 1.6 V) − 0.5 Ω·I with f·I drawn from VS, so a battery
 * behind the module sags realistically. ENA/ENB jumpers tie enable to the module's 5 V, as shipped.
 */
export class L298n implements ComponentModel<L298nProps, L298nState> {
  readonly type = 'driver.l298n';
  private id = '';
  private props: L298nProps = { regulatorJumper: true, enaJumper: true, enbJumper: true };
  private vsNet: NetId = 0;
  private gnd: NetId = 0;
  private v5Net: NetId = 0;
  private channels: readonly [Channel, Channel] | null = null;
  private drives: [Drive | null, Drive | null] = [null, null];
  private enables: [number, number] = [0, 0];
  private levels = new Map<NetId, 0 | 1>();
  private regulatorV = 0;
  private handles: [SourceHandle, SourceHandle, SourceHandle, SourceHandle] | null = null;
  /** Which channels were stamped (and so own two consecutive handles). */
  private handleLayout: boolean[] = [false, false];
  private currents: [number, number] = [0, 0];
  private vs = 0;
  private v5 = 0;

  init(ctx: ModelContext, props: L298nProps): void {
    this.id = ctx.id;
    this.props = props;
    this.vsNet = ctx.net('vs');
    this.gnd = ctx.net('gnd');
    this.v5Net = ctx.net('v5');
    const ch = (en: string, a: string, b: string, oa: string, ob: string, jumper: boolean): Channel => ({
      en: ctx.net(en),
      inA: ctx.net(a),
      inB: ctx.net(b),
      outA: ctx.net(oa),
      outB: ctx.net(ob),
      jumper,
    });
    this.channels = [
      ch('ena', 'in1', 'in2', 'out1', 'out2', props.enaJumper),
      ch('enb', 'in3', 'in4', 'out3', 'out4', props.enbJumper),
    ];
  }

  stamp(s: MnaStamper): void {
    const g = this.gnd;
    s.conductance(this.v5Net, g, 1 / LOGIC_OHMS);
    if (this.props.regulatorJumper) {
      s.voltageSource(this.v5Net, g, this.regulatorV, REG_OHMS, { supplyFrom: this.vsNet });
    }
    const handles: SourceHandle[] = [];
    this.channels?.forEach((c, i) => {
      if (c.jumper) s.conductance(c.en, this.v5Net, 1 / JUMPER_OHMS);
      const d = this.drives[i];
      if (!d) return;
      for (const [out, f] of [
        [c.outA, d.a],
        [c.outB, d.b],
      ] as const) {
        handles.push(
          s.transformer(this.vsNet, g, out, g, f, {
            seriesResistance: LEG_OHMS,
            offsetV: f * HIGH_SIDE_DROP_V,
          }),
        );
      }
    });
    this.handles = handles as [SourceHandle, SourceHandle, SourceHandle, SourceHandle];
    this.handleLayout = this.drives.map((d) => d !== null);
  }

  step(_dt: number, io: ComponentIO): void {
    const sol = io.solution;
    const rel = (net: NetId): number => sol.voltage(net) - sol.voltage(this.gnd);
    this.vs = rel(this.vsNet);
    this.v5 = rel(this.v5Net);
    this.readCurrents(sol);

    const nextReg = Math.min(REG_OUT_V, Math.max(0, this.vs - REG_DROPOUT_V));
    let changed = Math.abs(nextReg - this.regulatorV) > RESTAMP_EPSILON;
    this.regulatorV = nextReg;

    const logicOk = this.v5 >= LOGIC_MIN_V;
    this.channels?.forEach((c, i) => {
      const en = logicOk ? this.fraction(c.en, io, rel) : 0;
      this.enables[i] = en;
      const next: Drive | null =
        en > 0 ? { a: en * this.fraction(c.inA, io, rel), b: en * this.fraction(c.inB, io, rel) } : null;
      const prev = this.drives[i] ?? null;
      if (
        (prev === null) !== (next === null) ||
        (prev &&
          next &&
          (Math.abs(prev.a - next.a) > RESTAMP_EPSILON || Math.abs(prev.b - next.b) > RESTAMP_EPSILON))
      ) {
        changed = true;
      }
      this.drives[i] = next;
    });
    if (changed) io.invalidate();
  }

  faults(): readonly Fault[] {
    const out: Fault[] = [];
    if (this.vs > MAX_VS_V)
      out.push({ code: 'OVER_VOLTAGE', componentId: this.id, params: { volts: this.vs, limitV: MAX_VS_V } });
    this.currents.forEach((a, i) => {
      if (Math.abs(a) > MAX_CHANNEL_A) {
        out.push({
          code: 'OVER_CURRENT',
          componentId: this.id,
          params: {
            channel: i === 0 ? 'A' : 'B',
            currentMa: Math.abs(a) * 1000,
            limitMa: MAX_CHANNEL_A * 1000,
          },
        });
      }
    });
    return out;
  }

  snapshot(): L298nState {
    return {
      enableA: this.enables[0],
      enableB: this.enables[1],
      bridgeA: mode(this.drives[0] ?? null),
      bridgeB: mode(this.drives[1] ?? null),
      currentAMa: this.currents[0] * 1000,
      currentBMa: this.currents[1] * 1000,
      vs: this.vs,
      v5: this.v5,
    };
  }

  /** Logic input as a 0..1 fraction: MCU PWM duty when driven by PWM, else a thresholded DC level. */
  private fraction(net: NetId, io: ComponentIO, rel: (n: NetId) => number): number {
    const pwm = io.pwm(net);
    if (pwm) return pwm.dutyRatio;
    const v = rel(net);
    const prev = this.levels.get(net) ?? 0;
    const level: 0 | 1 = v >= VIH ? 1 : v <= VIL ? 0 : prev;
    this.levels.set(net, level);
    return level;
  }

  private readCurrents(sol: MnaSolution): void {
    let h = 0;
    this.currents = [0, 0];
    this.handleLayout.forEach((stamped, i) => {
      if (!stamped || !this.handles) return;
      const outA = this.handles[h] ?? (0 as SourceHandle);
      this.currents[i] = sol.sourceCurrent(outA);
      h += 2;
    });
  }
}

function mode(d: Drive | null): BridgeMode {
  if (!d) return 'coast';
  if (Math.abs(d.a - d.b) < 1e-9) return 'brake';
  return d.a > d.b ? 'forward' : 'reverse';
}
