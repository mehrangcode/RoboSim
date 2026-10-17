import type {
  ComponentIO,
  ComponentModel,
  Damageable,
  DiodeHandle,
  Fault,
  MnaStamper,
  ModelContext,
  NetId,
} from '@robosim/sim-core';

export type Uln2003Props = Record<string, never>;

export interface Uln2003State {
  /** Channels 1–7 sinking current. */
  readonly on: readonly boolean[];
  /** Collector current per channel (mA, into the output). */
  readonly currentMa: readonly number[];
  readonly damaged: boolean;
}

const CHANNELS = 7;
/** 2.7 kΩ base resistor + two base-emitter junctions: ≈ 0.9 mA at 3.85 V (datasheet II(on)). */
const INPUT = { vf: 1.4, rs: 2700 };
/** Darlington saturation: ≈ 0.9 V at 100 mA, 1.05 V at 200 mA, 1.3 V at 350 mA. */
const SATURATED = { vf: 0.75, rs: 1.5 };
/** Clamp diode from each output to COM, for inductive loads. */
const CLAMP = { vf: 0.7, rs: 1 };
/** Base current that saturates the output for loads up to a few hundred mA (VI(on) ≈ 2.4 V). */
const ON_A = 0.3e-3;
const MAX_A = 0.5;
const MAX_V = 50;

/**
 * ULN2003A seven-channel Darlington sink (Technical Design §5.4): each input loads its driver like a
 * 2.7 kΩ resistor into two junctions; a driven channel sinks its output to ground with the Darlington
 * saturation voltage; every output has a clamp diode to COM, so a coil switched off with COM on its
 * supply is clamped. Outputs never source current.
 */
export class Uln2003a implements ComponentModel<Uln2003Props, Uln2003State>, Damageable {
  readonly type = 'ic.uln2003a';
  private id = '';
  private gnd: NetId = 0;
  private com: NetId = 0;
  private ins: NetId[] = [];
  private outs: NetId[] = [];
  private on: boolean[] = Array<boolean>(CHANNELS).fill(false);
  private inputHandles: DiodeHandle[] = [];
  private sinkHandles: (DiodeHandle | null)[] = [];
  private clampHandles: DiodeHandle[] = [];
  private currents: number[] = Array<number>(CHANNELS).fill(0);
  private peakV = 0;

  damaged = false;

  damage(_reason: string): void {
    this.damaged = true;
  }

  init(ctx: ModelContext): void {
    this.id = ctx.id;
    this.gnd = ctx.net('gnd');
    this.com = ctx.net('com');
    for (let i = 1; i <= CHANNELS; i++) {
      this.ins.push(ctx.net(`in${i}`));
      this.outs.push(ctx.net(`out${i}`));
    }
  }

  logicNets(): { inputs: NetId[]; outputs: NetId[] } {
    return { inputs: this.ins, outputs: this.outs };
  }

  stamp(s: MnaStamper): void {
    this.inputHandles = this.ins.map((n) => s.diode(n, this.gnd, INPUT));
    this.clampHandles = this.outs.map((n) => s.diode(n, this.com, CLAMP));
    this.sinkHandles = this.outs.map((n, i) =>
      this.on[i] && !this.damaged ? s.diode(n, this.gnd, SATURATED) : null,
    );
  }

  step(_dt: number, io: ComponentIO): void {
    const { solution } = io;
    const ground = solution.voltage(this.gnd);
    this.currents = this.sinkHandles.map((h) => (h === null ? 0 : solution.diodeCurrent(h)));
    this.peakV = Math.max(
      ...this.outs.map((n) => solution.voltage(n) - ground),
      solution.voltage(this.com) - ground,
    );
    // Timed input edges reappear inverted on the outputs (an energized channel pulls LOW), so a
    // stepper behind the driver sees the firmware's exact step timing.
    if (!this.damaged)
      this.ins.forEach((n, i) => {
        const out = this.outs[i] ?? 0;
        for (const e of io.edges(n)) io.emitEdge(out, e.level === 1 ? 0 : 1, e.time);
      });
    let changed = false;
    this.inputHandles.forEach((h, i) => {
      const on = !this.damaged && solution.diodeCurrent(h) >= ON_A;
      if (on !== this.on[i]) {
        this.on[i] = on;
        changed = true;
      }
    });
    if (changed) io.invalidate();
  }

  faults(): readonly Fault[] {
    const out: Fault[] = [];
    if (this.peakV > MAX_V)
      out.push({ code: 'OVER_VOLTAGE', componentId: this.id, params: { volts: this.peakV, limitV: MAX_V } });
    this.currents.forEach((a, i) => {
      if (a > MAX_A)
        out.push({
          code: 'OVER_CURRENT',
          componentId: this.id,
          params: { channel: i + 1, currentMa: a * 1000, limitMa: MAX_A * 1000 },
        });
    });
    return out;
  }

  snapshot(): Uln2003State {
    return { on: [...this.on], currentMa: this.currents.map((a) => a * 1000), damaged: this.damaged };
  }
}
