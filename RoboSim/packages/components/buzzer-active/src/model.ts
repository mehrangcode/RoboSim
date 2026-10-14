import type {
  ComponentIO,
  ComponentModel,
  Damageable,
  Fault,
  MnaStamper,
  ModelContext,
  NetId,
} from '@robosim/sim-core';

export type ActiveBuzzerProps = Record<string, never>;

export interface ActiveBuzzerState {
  readonly sounding: boolean;
  readonly volts: number;
  readonly currentMa: number;
  /** Fixed tone of the built-in oscillator (Hz), for the audio renderer. */
  readonly toneHz: number;
  readonly damaged: boolean;
}

const OHMS = 5 / 0.03; // ~30 mA at 5 V
const MIN_V = 3;
const MAX_V = 8;
const TONE_HZ = 2300;

/**
 * Active (self-oscillating) buzzer: polarised, sounds whenever ≥ 3 V is applied. Electrically a
 * ~167 Ω load; reverse polarity draws current but stays silent, as the internal driver does not run.
 */
export class ActiveBuzzer implements ComponentModel<ActiveBuzzerProps, ActiveBuzzerState>, Damageable {
  readonly type = 'actuator.buzzer-active';
  private id = '';
  private pos: NetId = 0;
  private neg: NetId = 0;
  private volts = 0;

  damaged = false;

  damage(_reason: string): void {
    this.damaged = true;
  }

  init(ctx: ModelContext): void {
    this.id = ctx.id;
    this.pos = ctx.net('pos');
    this.neg = ctx.net('neg');
  }

  stamp(s: MnaStamper): void {
    if (this.damaged) return;
    s.conductance(this.pos, this.neg, 1 / OHMS);
  }

  step(_dt: number, io: ComponentIO): void {
    this.volts = io.solution.voltage(this.pos) - io.solution.voltage(this.neg);
  }

  faults(): readonly Fault[] {
    return this.volts > MAX_V
      ? [{ code: 'OVER_VOLTAGE', componentId: this.id, params: { volts: this.volts, limitV: MAX_V } }]
      : [];
  }

  snapshot(): ActiveBuzzerState {
    return {
      sounding: !this.damaged && this.volts >= MIN_V,
      volts: this.volts,
      currentMa: this.damaged ? 0 : (this.volts / OHMS) * 1000,
      toneHz: TONE_HZ,
      damaged: this.damaged,
    };
  }
}
