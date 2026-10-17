import type { ComponentIO, ComponentModel, Fault, MnaStamper, ModelContext, NetId } from '@robosim/sim-core';

export type JoystickProps = Record<string, never>;

export interface JoystickState {
  /** Stick position, −1 (left / down) … 1 (right / up). */
  readonly x: number;
  readonly y: number;
  readonly pressed: boolean;
}

/** Two 10 kΩ potentiometers and a push switch to GND (no pull-up on the module). */
const POT_OHMS = 10_000;
const MIN_SEGMENT_OHMS = 1;
const SWITCH_OHMS = 0.1;

/**
 * KY-023 thumb joystick: VRx and VRy are the wipers of two 10 kΩ potentiometers across VCC–GND, so
 * the centre reads ≈ VCC / 2 (≈ 512); pressing the stick closes SW to GND — use INPUT_PULLUP, the
 * module has no pull-up of its own.
 */
export class Joystick implements ComponentModel<JoystickProps, JoystickState> {
  readonly type = 'sensor.joystick';
  private nets = { vcc: 0, gnd: 0, vrx: 0, vry: 0, sw: 0 } as Record<
    'vcc' | 'gnd' | 'vrx' | 'vry' | 'sw',
    NetId
  >;
  private x = 0;
  private y = 0;
  private pressed = false;

  init(ctx: ModelContext): void {
    for (const pin of ['vcc', 'gnd', 'vrx', 'vry', 'sw'] as const) this.nets[pin] = ctx.net(pin);
  }

  input(name: string, value: number | boolean): void {
    if (name === 'pressed' && typeof value === 'boolean') this.pressed = value;
    else if ((name === 'x' || name === 'y') && typeof value === 'number')
      this[name] = Math.min(1, Math.max(-1, value));
    else throw new Error(`${this.type}: bad input '${name}'`);
  }

  stamp(s: MnaStamper): void {
    const { vcc, gnd } = this.nets;
    for (const [wiper, pos] of [
      [this.nets.vrx, this.x],
      [this.nets.vry, this.y],
    ] as const) {
      const toGnd = Math.max(MIN_SEGMENT_OHMS, ((pos + 1) / 2) * POT_OHMS);
      const toVcc = Math.max(MIN_SEGMENT_OHMS, POT_OHMS - toGnd);
      s.conductance(vcc, wiper, 1 / toVcc);
      s.conductance(wiper, gnd, 1 / toGnd);
    }
    if (this.pressed) s.conductance(this.nets.sw, gnd, 1 / SWITCH_OHMS);
  }

  step(_dt: number, _io: ComponentIO): void {}

  faults(): readonly Fault[] {
    return [];
  }

  snapshot(): JoystickState {
    return { x: this.x, y: this.y, pressed: this.pressed };
  }
}
