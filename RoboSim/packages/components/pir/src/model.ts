import type { ComponentIO, ComponentModel, Fault, MnaStamper, ModelContext, NetId } from '@robosim/sim-core';

export interface PirProps {
  /** Output hold time set by the Tx potentiometer (s). */
  readonly holdS: number;
  /** Repeat-trigger jumper (H): motion during the hold extends it; single (L) ignores it. */
  readonly retrigger: boolean;
}

export interface PirState {
  readonly motion: boolean;
  readonly out: boolean;
  /** Seconds the output stays HIGH, or the single-trigger lockout remaining. */
  readonly holdLeftS: number;
  readonly lockedOut: boolean;
}

/** BISS0001 module: 3.3 V output from its own regulator; ≈ 2.5 s blocked after a single trigger. */
const OUT_HIGH_V = 3.3;
const OUT_OHMS = 100;
const MIN_VCC = 4.5;
const QUIESCENT_A = 65e-6;
const LOCKOUT_S = 2.5;

/**
 * HC-SR501 passive-infrared motion sensor. "Motion" (a person moving in its field) drives OUT to
 * 3.3 V for the hold time — a 3.3 V level an Uno reads as HIGH. In repeat mode the hold restarts
 * while motion continues; in single mode the output drops after the hold and ignores motion for
 * ≈ 2.5 s. (The real module also needs about a minute to settle after power-up; not modelled.)
 */
export class Pir implements ComponentModel<PirProps, PirState> {
  readonly type = 'sensor.pir';
  private vccNet: NetId = 0;
  private gnd: NetId = 0;
  private outNet: NetId = 0;
  private props: PirProps = { holdS: 5, retrigger: true };
  private motion = false;
  private high = false;
  private holdLeft = 0;
  private lockout = 0;
  private vcc = 0;
  private stamped: string | null = null;

  init(ctx: ModelContext, props: PirProps): void {
    this.vccNet = ctx.net('vcc');
    this.gnd = ctx.net('gnd');
    this.outNet = ctx.net('out');
    this.props = props;
  }

  input(name: string, value: number | boolean): void {
    if (name !== 'motion' || typeof value !== 'boolean') throw new Error(`${this.type}: bad input '${name}'`);
    this.motion = value;
  }

  stamp(s: MnaStamper): void {
    s.conductance(this.vccNet, this.gnd, QUIESCENT_A / 5);
    if (this.vcc >= MIN_VCC)
      s.voltageSource(this.outNet, this.gnd, this.high ? OUT_HIGH_V : 0, OUT_OHMS, {
        supplyFrom: this.vccNet,
      });
    this.stamped = this.key();
  }

  step(dt: number, io: ComponentIO): void {
    this.vcc = io.solution.voltage(this.vccNet) - io.solution.voltage(this.gnd);
    if (this.vcc < MIN_VCC) {
      this.high = false;
      this.holdLeft = 0;
    } else if (this.high) {
      if (this.motion && this.props.retrigger) this.holdLeft = this.props.holdS;
      this.holdLeft -= dt;
      if (this.holdLeft <= 1e-9) {
        this.high = false;
        this.holdLeft = 0;
        if (!this.props.retrigger) this.lockout = LOCKOUT_S;
      }
    } else if (this.lockout > 1e-9) this.lockout -= dt;
    else if (this.motion) {
      this.high = true;
      this.holdLeft = this.props.holdS;
    }
    if (this.key() !== this.stamped) io.invalidate();
  }

  faults(): readonly Fault[] {
    return [];
  }

  snapshot(): PirState {
    return {
      motion: this.motion,
      out: this.high,
      holdLeftS: this.high ? this.holdLeft : Math.max(0, this.lockout),
      lockedOut: !this.high && this.lockout > 1e-9,
    };
  }

  private key(): string {
    return `${this.vcc >= MIN_VCC ? 1 : 0}${this.high ? 1 : 0}`;
  }
}
