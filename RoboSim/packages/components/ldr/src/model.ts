import {
  dmath,
  type ComponentIO,
  type ComponentModel,
  type Fault,
  type MnaStamper,
  type ModelContext,
  type NetId,
} from '@robosim/sim-core';

export interface LdrProps {
  readonly r10LuxOhms: number;
  readonly gamma: number;
  readonly darkOhms: number;
}

export interface LdrState {
  readonly lux: number;
  readonly ohms: number;
}

/**
 * GL5528-style photoresistor: R = R10 · (lux / 10)^−γ, capped at the dark resistance.
 * Uses deterministic math so the curve is identical in every engine. Light comes from user input
 * now and from the arena lighting once the world model lands.
 */
export class Ldr implements ComponentModel<LdrProps, LdrState> {
  readonly type = 'sensor.ldr';
  private a: NetId = 0;
  private b: NetId = 0;
  private props: LdrProps = { r10LuxOhms: 10_000, gamma: 0.7, darkOhms: 1_000_000 };
  private lux = 300;

  init(ctx: ModelContext, props: LdrProps): void {
    this.a = ctx.net('a');
    this.b = ctx.net('b');
    this.props = props;
  }

  input(name: string, value: number | boolean): void {
    if (name !== 'lux' || typeof value !== 'number') throw new Error(`sensor.ldr: bad input '${name}'`);
    this.lux = Math.max(0, value);
  }

  resistance(): number {
    const { r10LuxOhms, gamma, darkOhms } = this.props;
    if (this.lux <= 0) return darkOhms;
    return Math.min(darkOhms, r10LuxOhms * dmath.exp(-gamma * dmath.log(this.lux / 10)));
  }

  stamp(s: MnaStamper): void {
    s.conductance(this.a, this.b, 1 / this.resistance());
  }

  step(_dt: number, _io: ComponentIO): void {}

  faults(): readonly Fault[] {
    return [];
  }

  snapshot(): LdrState {
    return { lux: this.lux, ohms: this.resistance() };
  }
}
