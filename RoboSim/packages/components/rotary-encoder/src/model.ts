import type { ComponentIO, ComponentModel, Fault, MnaStamper, ModelContext, NetId } from '@robosim/sim-core';

export type RotaryEncoderProps = Record<string, never>;

export interface RotaryEncoderState {
  /** Detents turned so far (clockwise positive). */
  readonly detents: number;
  /** Contacts closed to GND right now (A = CLK, B = DT). */
  readonly a: boolean;
  readonly b: boolean;
  readonly pressed: boolean;
}

/** Module pull-ups on CLK and DT; contacts close to the common pin (GND). */
const PULLUP_OHMS = 10_000;
const CONTACT_OHMS = 5;
/** One quadrature phase every 2 ms: 8 ms per detent, a brisk turn of the knob. */
const PHASE_SLICES = 2;
/** Contact pattern [A, B] through one clockwise detent; counter-clockwise runs it backwards. */
const PHASES: readonly (readonly [boolean, boolean])[] = [
  [false, false],
  [true, false],
  [true, true],
  [false, true],
];

/**
 * KY-040 rotary encoder: 20 detents per turn, two contacts (CLK = A, DT = B) that close to GND in
 * quadrature — A leads B clockwise — and rest open (HIGH through the module's 10 kΩ pull-ups) at each
 * detent. The knob is a bench input (target position in detents); the model turns to it one phase every
 * 2 ms, so polling or interrupt sketches see real quadrature. SW closes to GND when the knob is pushed.
 */
export class RotaryEncoder implements ComponentModel<RotaryEncoderProps, RotaryEncoderState> {
  readonly type = 'sensor.rotary-encoder';
  private nets = { vcc: 0, gnd: 0, sw: 0, dt: 0, clk: 0 } as Record<
    'vcc' | 'gnd' | 'sw' | 'dt' | 'clk',
    NetId
  >;
  private target = 0;
  private position = 0;
  /** Phase within the current detent (0 = at rest). */
  private phase = 0;
  private wait = 0;
  private pressed = false;
  private stamped = '';

  init(ctx: ModelContext): void {
    for (const pin of ['vcc', 'gnd', 'sw', 'dt', 'clk'] as const) this.nets[pin] = ctx.net(pin);
  }

  input(name: string, value: number | boolean): void {
    if (name === 'detents' && typeof value === 'number') this.target = Math.round(value);
    else if (name === 'pressed' && typeof value === 'boolean') this.pressed = value;
    else throw new Error(`${this.type}: bad input '${name}'`);
  }

  stamp(s: MnaStamper): void {
    const { vcc, gnd, clk, dt, sw } = this.nets;
    s.conductance(vcc, clk, 1 / PULLUP_OHMS);
    s.conductance(vcc, dt, 1 / PULLUP_OHMS);
    const [a, b] = PHASES[this.phase] ?? [false, false];
    if (a) s.conductance(clk, gnd, 1 / CONTACT_OHMS);
    if (b) s.conductance(dt, gnd, 1 / CONTACT_OHMS);
    if (this.pressed) s.conductance(sw, gnd, 1 / CONTACT_OHMS);
    this.stamped = this.key();
  }

  step(_dt: number, io: ComponentIO): void {
    if (this.wait > 0) this.wait--;
    else if (this.phase !== 0 || this.target !== this.position) {
      // Mid-detent the knob keeps going the way it started; at rest it heads for the target.
      const dir = this.phase !== 0 ? this.direction : Math.sign(this.target - this.position);
      this.direction = dir;
      this.phase = (this.phase + dir + PHASES.length) % PHASES.length;
      if (this.phase === 0) this.position += dir;
      this.wait = PHASE_SLICES - 1;
    }
    if (this.key() !== this.stamped) io.invalidate();
  }

  faults(): readonly Fault[] {
    return [];
  }

  snapshot(): RotaryEncoderState {
    const [a, b] = PHASES[this.phase] ?? [false, false];
    return { detents: this.position, a, b, pressed: this.pressed };
  }

  private direction = 1;

  private key(): string {
    return `${this.phase}${this.pressed ? 1 : 0}`;
  }
}
