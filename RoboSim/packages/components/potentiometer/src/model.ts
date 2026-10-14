import type { ComponentIO, ComponentModel, Fault, MnaStamper, ModelContext, NetId } from '@robosim/sim-core';

export interface PotentiometerProps {
  readonly ohms: number;
}

export interface PotentiometerState {
  readonly position: number;
  readonly wiperV: number;
}

/** Real pots never reach 0 Ω at the ends; this also keeps the matrix well-conditioned. */
const END_RESISTANCE_OHMS = 1;

/** Linear potentiometer: a–wiper = position·R, wiper–b = (1 − position)·R. */
export class Potentiometer implements ComponentModel<PotentiometerProps, PotentiometerState> {
  readonly type = 'passive.potentiometer';
  private a: NetId = 0;
  private wiper: NetId = 0;
  private b: NetId = 0;
  private ohms = 10_000;
  private position = 0.5;
  private wiperV = 0;

  init(ctx: ModelContext, props: PotentiometerProps): void {
    this.a = ctx.net('a');
    this.wiper = ctx.net('wiper');
    this.b = ctx.net('b');
    this.ohms = props.ohms;
  }

  input(name: string, value: number | boolean): void {
    if (name !== 'position' || typeof value !== 'number')
      throw new Error(`passive.potentiometer: bad input '${name}'`);
    this.position = Math.min(1, Math.max(0, value));
  }

  stamp(s: MnaStamper): void {
    s.conductance(this.a, this.wiper, 1 / (this.position * this.ohms + END_RESISTANCE_OHMS));
    s.conductance(this.wiper, this.b, 1 / ((1 - this.position) * this.ohms + END_RESISTANCE_OHMS));
  }

  step(_dt: number, io: ComponentIO): void {
    this.wiperV = io.solution.voltage(this.wiper);
  }

  faults(): readonly Fault[] {
    return [];
  }

  snapshot(): PotentiometerState {
    return { position: this.position, wiperV: this.wiperV };
  }
}
