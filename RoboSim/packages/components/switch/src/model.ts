import type { ComponentIO, ComponentModel, Fault, MnaStamper, ModelContext, NetId } from '@robosim/sim-core';

export type PowerSwitchProps = Record<string, never>;

export interface PowerSwitchState {
  readonly on: boolean;
  readonly currentMa: number;
}

const ON_OHMS = 0.02;
const MAX_A = 3;

/** Latching rocker / slide switch in series with the battery. */
export class PowerSwitch implements ComponentModel<PowerSwitchProps, PowerSwitchState> {
  readonly type = 'power.switch';
  private id = '';
  private a: NetId = 0;
  private b: NetId = 0;
  private on = false;
  private currentA = 0;

  init(ctx: ModelContext): void {
    this.id = ctx.id;
    this.a = ctx.net('a');
    this.b = ctx.net('b');
  }

  input(name: string, value: number | boolean): void {
    if (name !== 'on' || typeof value !== 'boolean') throw new Error(`power.switch: bad input '${name}'`);
    this.on = value;
  }

  stamp(s: MnaStamper): void {
    if (this.on) s.conductance(this.a, this.b, 1 / ON_OHMS);
  }

  step(_dt: number, io: ComponentIO): void {
    this.currentA = this.on ? (io.solution.voltage(this.a) - io.solution.voltage(this.b)) / ON_OHMS : 0;
  }

  faults(): readonly Fault[] {
    return Math.abs(this.currentA) > MAX_A
      ? [
          {
            code: 'OVER_CURRENT',
            componentId: this.id,
            params: { currentMa: Math.abs(this.currentA) * 1000, limitMa: MAX_A * 1000 },
          },
        ]
      : [];
  }

  snapshot(): PowerSwitchState {
    return { on: this.on, currentMa: this.currentA * 1000 };
  }
}
