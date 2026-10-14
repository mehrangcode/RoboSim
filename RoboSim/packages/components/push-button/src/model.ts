import type { ComponentIO, ComponentModel, Fault, MnaStamper, ModelContext, NetId } from '@robosim/sim-core';

export type PushButtonProps = Record<string, never>;

export interface PushButtonState {
  readonly pressed: boolean;
}

const LEG_OHMS = 0.01; // internally joined legs
const CONTACT_OHMS = 0.05;

/**
 * 6 mm 4-leg tactile switch: a1–a2 and b1–b2 are always joined inside the package; pressing joins
 * a↔b. Wiring both legs of the same side is the classic beginner mistake the canvas will highlight.
 */
export class PushButton implements ComponentModel<PushButtonProps, PushButtonState> {
  readonly type = 'sensor.push-button';
  private nets = { a1: 0 as NetId, a2: 0 as NetId, b1: 0 as NetId, b2: 0 as NetId };
  private pressed = false;

  init(ctx: ModelContext): void {
    this.nets = { a1: ctx.net('a1'), a2: ctx.net('a2'), b1: ctx.net('b1'), b2: ctx.net('b2') };
  }

  input(name: string, value: number | boolean): void {
    if (name !== 'pressed' || typeof value !== 'boolean')
      throw new Error(`sensor.push-button: bad input '${name}'`);
    this.pressed = value;
  }

  stamp(s: MnaStamper): void {
    const { a1, a2, b1, b2 } = this.nets;
    if (a1 !== a2) s.conductance(a1, a2, 1 / LEG_OHMS);
    if (b1 !== b2) s.conductance(b1, b2, 1 / LEG_OHMS);
    if (this.pressed && a1 !== b1) s.conductance(a1, b1, 1 / CONTACT_OHMS);
  }

  step(_dt: number, _io: ComponentIO): void {}

  faults(): readonly Fault[] {
    return [];
  }

  snapshot(): PushButtonState {
    return { pressed: this.pressed };
  }
}
