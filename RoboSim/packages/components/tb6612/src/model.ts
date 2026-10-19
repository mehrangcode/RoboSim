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

export type Tb6612Props = Record<string, never>;

export type Tb6612Mode = 'forward' | 'reverse' | 'brake' | 'stop' | 'standby';

export interface Tb6612State {
  readonly modeA: Tb6612Mode;
  readonly modeB: Tb6612Mode;
  /** Current sourced out of AO1 / BO1 (mA). */
  readonly currentAMa: number;
  readonly currentBMa: number;
  readonly vm: number;
  readonly vcc: number;
  readonly damaged: boolean;
}

/** MOSFET bridge: ≈ 0.5 Ω upper + lower on-resistance (datasheet typ.), so ≈ 0.25 Ω per leg. */
const LEG_OHMS = 0.25;
const VIH = 0.7;
const VIL = 0.3;
const LOGIC_MIN_V = 2.7;
/** Internal 200 kΩ pull-downs on every input: a floating STBY keeps the chip in standby. */
const PULL_DOWN_OHMS = 200_000;
const LOGIC_OHMS = 5 / 0.0011; // ≈ 1.1 mA logic supply current
const MAX_VM = 15;
const MAX_PEAK_A = 3.2;
const RESTAMP = 1e-3;
/** Body diodes of the output MOSFETs: a coasting motor's current returns to VM or comes from GND. */
const BODY_DIODE = { vf: 0.8, rs: 0.1 } as const;

interface Channel {
  readonly in1: NetId;
  readonly in2: NetId;
  readonly pwm: NetId;
  readonly out1: NetId;
  readonly out2: NetId;
}

/** High-side fractions of the two outputs, or null with both floating (stop / standby). */
interface Drive {
  readonly a: number;
  readonly b: number;
}

/**
 * TB6612FNG dual MOSFET H-bridge breakout (Technical Design §5.4). Truth table per channel: IN1/IN2
 * pick the direction, PWM HIGH drives and PWM LOW short-brakes, IN1 = IN2 = LOW stops (outputs
 * float), IN1 = IN2 = HIGH brakes, STBY LOW floats everything. PWM duty from the MCU timer sets the
 * averaged leg voltage; logic needs VCC ≥ 2.7 V. Inputs have 200 kΩ pull-downs.
 */
export class Tb6612 implements ComponentModel<Tb6612Props, Tb6612State>, Damageable {
  readonly type = 'driver.tb6612fng';
  private id = '';
  private vmNet: NetId = 0;
  private vccNet: NetId = 0;
  private gnd: NetId = 0;
  private stby: NetId = 0;
  private channels: Channel[] = [];
  private drives: (Drive | null)[] = [null, null];
  private modes: Tb6612Mode[] = ['standby', 'standby'];
  private levels = new Map<NetId, 0 | 1>();
  private handles: (SourceHandle | null)[] = [];
  private currents = [0, 0];
  private vm = 0;
  private vcc = 0;

  damaged = false;

  damage(_reason: string): void {
    this.damaged = true;
    this.drives = [null, null];
  }

  init(ctx: ModelContext): void {
    this.id = ctx.id;
    this.vmNet = ctx.net('vm');
    this.vccNet = ctx.net('vcc');
    this.gnd = ctx.net('gnd');
    this.stby = ctx.net('stby');
    const ch = (p: 'a' | 'b'): Channel => ({
      in1: ctx.net(`${p}in1`),
      in2: ctx.net(`${p}in2`),
      pwm: ctx.net(`pwm${p}`),
      out1: ctx.net(`${p}o1`),
      out2: ctx.net(`${p}o2`),
    });
    this.channels = [ch('a'), ch('b')];
  }

  stamp(s: MnaStamper): void {
    const g = this.gnd;
    s.conductance(this.vccNet, g, 1 / LOGIC_OHMS);
    for (const n of [this.stby, ...this.channels.flatMap((c) => [c.in1, c.in2, c.pwm])])
      s.conductance(n, g, 1 / PULL_DOWN_OHMS);
    this.handles = [];
    for (const c of this.channels)
      for (const out of [c.out1, c.out2]) {
        s.diode(out, this.vmNet, BODY_DIODE);
        s.diode(g, out, BODY_DIODE);
      }
    this.channels.forEach((c, i) => {
      const d = this.damaged ? null : this.drives[i];
      if (!d) {
        this.handles.push(null);
        return;
      }
      this.handles.push(s.transformer(this.vmNet, g, c.out1, g, d.a, { seriesResistance: LEG_OHMS }));
      s.transformer(this.vmNet, g, c.out2, g, d.b, { seriesResistance: LEG_OHMS });
    });
  }

  step(_dt: number, io: ComponentIO): void {
    const sol = io.solution;
    const rel = (n: NetId) => sol.voltage(n) - sol.voltage(this.gnd);
    this.vm = rel(this.vmNet);
    this.vcc = rel(this.vccNet);
    this.currents = this.handles.map((h) => (h === null ? 0 : sol.sourceCurrent(h)));
    const logicOk = this.vcc >= LOGIC_MIN_V;
    const awake = logicOk && this.fraction(this.stby, io, rel) > 0.5;
    let changed = false;
    this.channels.forEach((c, i) => {
      let next: Drive | null = null;
      let mode: Tb6612Mode = 'standby';
      if (awake) {
        const a = this.fraction(c.in1, io, rel);
        const b = this.fraction(c.in2, io, rel);
        const p = this.fraction(c.pwm, io, rel);
        if (a === 0 && b === 0) mode = 'stop';
        else {
          next = { a: a * (1 - b) * p, b: (1 - a) * b * p };
          mode = next.a > next.b ? 'forward' : next.b > next.a ? 'reverse' : 'brake';
        }
      }
      if (this.damaged) next = null;
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
    if (this.vm > MAX_VM)
      out.push({ code: 'OVER_VOLTAGE', componentId: this.id, params: { volts: this.vm, limitV: MAX_VM } });
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

  snapshot(): Tb6612State {
    return {
      modeA: this.modes[0] ?? 'standby',
      modeB: this.modes[1] ?? 'standby',
      currentAMa: (this.currents[0] ?? 0) * 1000,
      currentBMa: (this.currents[1] ?? 0) * 1000,
      vm: this.vm,
      vcc: this.vcc,
      damaged: this.damaged,
    };
  }

  /** Logic input as a 0..1 fraction: MCU PWM duty, else a level thresholded against VCC. */
  private fraction(net: NetId, io: ComponentIO, rel: (n: NetId) => number): number {
    const pwm = io.pwm(net);
    if (pwm) return pwm.dutyRatio;
    const v = rel(net);
    const prev = this.levels.get(net) ?? 0;
    const level: 0 | 1 = v >= VIH * this.vcc ? 1 : v <= VIL * this.vcc ? 0 : prev;
    this.levels.set(net, level);
    return level;
  }
}
