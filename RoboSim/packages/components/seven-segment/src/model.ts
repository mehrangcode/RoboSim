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

export const SEGMENTS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'] as const;
export type Segment = (typeof SEGMENTS)[number];
export type SegmentColor = 'red' | 'green' | 'blue';

export interface SevenSegmentProps {
  readonly common: 'cathode' | 'anode';
  readonly color: SegmentColor;
}

export interface SevenSegmentState {
  /** Brightness 0..1 per segment, in `SEGMENTS` order (a…g, dp). */
  readonly brightness: readonly number[];
  readonly currentMa: readonly number[];
  readonly damaged: boolean;
}

/** 0.56" single digit, one LED die per segment (2.0 V red / 3.1 V green, blue at 20 mA). */
const DIE: Readonly<Record<SegmentColor, DiodeParams>> = {
  red: { vf: 1.8, rs: 10 },
  green: { vf: 2.8, rs: 15 },
  blue: { vf: 2.8, rs: 15 },
};
const RATED_A = 0.02;
const ABS_MAX_A = 0.03;
const MAX_REVERSE_V = 5;

/**
 * Single seven-segment digit: eight LEDs (a–g, dp) sharing a common cathode or anode. The two
 * common pins are one conductor inside the package. Each segment needs its own series resistor.
 */
export class SevenSegment implements ComponentModel<SevenSegmentProps, SevenSegmentState>, Damageable {
  readonly type = 'display.seven-segment';
  private id = '';
  private props: SevenSegmentProps = { common: 'cathode', color: 'red' };
  private commonNet: NetId = 0;
  private legs: NetId[] = [];
  private handles: DiodeHandle[] = [];
  private currents: number[] = SEGMENTS.map(() => 0);
  private reverse: number[] = SEGMENTS.map(() => 0);

  damaged = false;

  damage(_reason: string): void {
    this.damaged = true;
  }

  init(ctx: ModelContext, props: SevenSegmentProps): void {
    this.id = ctx.id;
    this.props = props;
    this.commonNet = ctx.net('com1');
    this.legs = SEGMENTS.map((s) => ctx.net(s));
  }

  stamp(s: MnaStamper): void {
    if (this.damaged) return;
    this.handles = this.legs.map((leg) => {
      const [anode, cathode] = this.terminals(leg);
      return s.diode(anode, cathode, DIE[this.props.color]);
    });
  }

  step(_dt: number, io: ComponentIO): void {
    this.legs.forEach((leg, i) => {
      const [anode, cathode] = this.terminals(leg);
      const h = this.handles[i];
      this.currents[i] = this.damaged || h === undefined ? 0 : io.solution.diodeCurrent(h);
      this.reverse[i] = io.solution.voltage(cathode) - io.solution.voltage(anode);
    });
  }

  faults(): readonly Fault[] {
    const out: Fault[] = [];
    SEGMENTS.forEach((segment, i) => {
      const amps = this.currents[i] ?? 0;
      const rev = this.reverse[i] ?? 0;
      if (amps > ABS_MAX_A)
        out.push({
          code: 'OVER_CURRENT',
          componentId: this.id,
          params: { segment, currentMa: amps * 1000, limitMa: ABS_MAX_A * 1000 },
        });
      if (rev > MAX_REVERSE_V)
        out.push({
          code: 'REVERSE_VOLTAGE',
          componentId: this.id,
          params: { segment, volts: rev, limitV: MAX_REVERSE_V },
        });
    });
    return out;
  }

  snapshot(): SevenSegmentState {
    return {
      brightness: this.currents.map((a) => Math.min(1, Math.max(0, a / RATED_A))),
      currentMa: this.currents.map((a) => a * 1000),
      damaged: this.damaged,
    };
  }

  private terminals(leg: NetId): [NetId, NetId] {
    return this.props.common === 'cathode' ? [leg, this.commonNet] : [this.commonNet, leg];
  }
}
