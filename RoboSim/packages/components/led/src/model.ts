import type {
  ComponentIO,
  Damageable,
  ComponentModel,
  DiodeHandle,
  DiodeParams,
  Fault,
  MnaStamper,
  ModelContext,
  NetId,
} from '@robosim/sim-core';

export type LedColor = 'red' | 'yellow' | 'green' | 'blue' | 'white';

export interface LedProps {
  readonly color: LedColor;
}

export interface LedState {
  readonly color: LedColor;
  readonly currentMa: number;
  /** 0..1 relative to the rated 20 mA; renderers map it to glow. */
  readonly brightness: number;
  readonly damaged: boolean;
}

/** Piecewise-linear 5 mm LED models (Vf at threshold, Rs so V ≈ datasheet typ. at 20 mA). */
const LED_PARAMS: Readonly<Record<LedColor, DiodeParams>> = {
  red: { vf: 1.8, rs: 10 }, // 2.0 V @ 20 mA
  yellow: { vf: 1.9, rs: 10 }, // 2.1 V
  green: { vf: 2.0, rs: 10 }, // 2.2 V
  blue: { vf: 2.8, rs: 15 }, // 3.1 V
  white: { vf: 2.8, rs: 15 },
};
const RATED_A = 0.02;
const ABS_MAX_A = 0.03;
const MAX_REVERSE_V = 5;

export class Led implements ComponentModel<LedProps, LedState>, Damageable {
  readonly type = 'actuator.led';
  private id = '';
  private anode: NetId = 0;
  private cathode: NetId = 0;
  private color: LedColor = 'red';
  private handle = 0 as DiodeHandle;
  private currentA = 0;
  private reverseV = 0;

  damaged = false;

  damage(_reason: string): void {
    this.damaged = true;
  }

  init(ctx: ModelContext, props: LedProps): void {
    this.id = ctx.id;
    this.anode = ctx.net('a');
    this.cathode = ctx.net('k');
    this.color = props.color;
  }

  stamp(s: MnaStamper): void {
    if (this.damaged) return; // burnt die: open circuit
    this.handle = s.diode(this.anode, this.cathode, LED_PARAMS[this.color]);
  }

  step(_dt: number, io: ComponentIO): void {
    this.currentA = this.damaged ? 0 : io.solution.diodeCurrent(this.handle);
    this.reverseV = io.solution.voltage(this.cathode) - io.solution.voltage(this.anode);
  }

  faults(): readonly Fault[] {
    const out: Fault[] = [];
    if (this.currentA > ABS_MAX_A) {
      out.push({
        code: 'OVER_CURRENT',
        componentId: this.id,
        params: { currentMa: this.currentA * 1000, limitMa: ABS_MAX_A * 1000 },
      });
    }
    if (this.reverseV > MAX_REVERSE_V) {
      out.push({
        code: 'REVERSE_VOLTAGE',
        componentId: this.id,
        params: { volts: this.reverseV, limitV: MAX_REVERSE_V },
      });
    }
    return out;
  }

  snapshot(): LedState {
    return {
      color: this.color,
      currentMa: this.currentA * 1000,
      brightness: Math.min(1, Math.max(0, this.currentA / RATED_A)),
      damaged: this.damaged,
    };
  }
}
