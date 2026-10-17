import type {
  ComponentIO,
  ComponentModel,
  Damageable,
  DiodeHandle,
  DiodeParams,
  Fault,
  MnaStamper,
  ModelContext,
  NetId,
} from '@robosim/sim-core';

export type RgbChannel = 'r' | 'g' | 'b';
export type RgbCommon = 'cathode' | 'anode';

export interface RgbLedProps {
  readonly common: RgbCommon;
}

export interface RgbLedState {
  readonly common: RgbCommon;
  /** Per-die current (mA), r/g/b. */
  readonly currentMa: readonly [number, number, number];
  /** Per-die brightness 0..1 relative to the rated 20 mA; renderers mix them into one colour. */
  readonly brightness: readonly [number, number, number];
  readonly damaged: boolean;
}

/** 5 mm diffused RGB LED (typ. datasheet): red 2.0 V, green and blue 3.1 V at 20 mA. */
const DIES: Readonly<Record<RgbChannel, DiodeParams>> = {
  r: { vf: 1.8, rs: 10 },
  g: { vf: 2.8, rs: 15 },
  b: { vf: 2.8, rs: 15 },
};
const CHANNELS: readonly RgbChannel[] = ['r', 'g', 'b'];
const RATED_A = 0.02;
const ABS_MAX_A = 0.03;
const MAX_REVERSE_V = 5;

/**
 * Four-leg RGB LED: three PWL dies sharing a common cathode or anode (prop). Each die is its own
 * LED electrically, so each colour needs its own series resistor; one burnt die kills the package.
 */
export class RgbLed implements ComponentModel<RgbLedProps, RgbLedState>, Damageable {
  readonly type = 'actuator.led-rgb';
  private id = '';
  private common: RgbCommon = 'cathode';
  private commonNet: NetId = 0;
  private legs: Record<RgbChannel, NetId> = { r: 0, g: 0, b: 0 };
  private handles: DiodeHandle[] = [];
  private currents: [number, number, number] = [0, 0, 0];
  private reverse: [number, number, number] = [0, 0, 0];

  damaged = false;

  damage(_reason: string): void {
    this.damaged = true;
  }

  init(ctx: ModelContext, props: RgbLedProps): void {
    this.id = ctx.id;
    this.common = props.common;
    this.commonNet = ctx.net('common');
    this.legs = { r: ctx.net('r'), g: ctx.net('g'), b: ctx.net('b') };
  }

  stamp(s: MnaStamper): void {
    if (this.damaged) return;
    this.handles = CHANNELS.map((c) => {
      const [anode, cathode] = this.terminals(c);
      return s.diode(anode, cathode, DIES[c]);
    });
  }

  step(_dt: number, io: ComponentIO): void {
    CHANNELS.forEach((c, i) => {
      const [anode, cathode] = this.terminals(c);
      const h = this.handles[i];
      this.currents[i] = this.damaged || h === undefined ? 0 : io.solution.diodeCurrent(h);
      this.reverse[i] = io.solution.voltage(cathode) - io.solution.voltage(anode);
    });
  }

  faults(): readonly Fault[] {
    const out: Fault[] = [];
    CHANNELS.forEach((channel, i) => {
      const amps = this.currents[i] ?? 0;
      const rev = this.reverse[i] ?? 0;
      if (amps > ABS_MAX_A)
        out.push({
          code: 'OVER_CURRENT',
          componentId: this.id,
          params: { channel, currentMa: amps * 1000, limitMa: ABS_MAX_A * 1000 },
        });
      if (rev > MAX_REVERSE_V)
        out.push({
          code: 'REVERSE_VOLTAGE',
          componentId: this.id,
          params: { channel, volts: rev, limitV: MAX_REVERSE_V },
        });
    });
    return out;
  }

  snapshot(): RgbLedState {
    const [r, g, b] = this.currents;
    const level = (a: number) => Math.min(1, Math.max(0, a / RATED_A));
    return {
      common: this.common,
      currentMa: [r * 1000, g * 1000, b * 1000],
      brightness: [level(r), level(g), level(b)],
      damaged: this.damaged,
    };
  }

  /** [anode, cathode] nets of one die. */
  private terminals(c: RgbChannel): [NetId, NetId] {
    return this.common === 'cathode' ? [this.legs[c], this.commonNet] : [this.commonNet, this.legs[c]];
  }
}
