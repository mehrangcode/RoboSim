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

export type DiodeProps = Record<string, never>;

export interface DiodeState {
  /** Anode → cathode current (mA); negative while a Zener conducts in breakdown. */
  readonly currentMa: number;
  /** Anode − cathode voltage (V). */
  readonly volts: number;
  readonly powerMw: number;
  readonly damaged: boolean;
}

export interface DiodeVariant {
  readonly type: string;
  /** Forward PWL segment, fitted to two datasheet points. */
  readonly forward: DiodeParams;
  /** Reverse breakdown as a second PWL diode (Zener), or none for rectifier/signal diodes. */
  readonly breakdown?: DiodeParams;
  readonly maxForwardA: number;
  /** Repetitive peak reverse voltage; exceeding it is a REVERSE_VOLTAGE fault (non-Zener). */
  readonly maxReverseV?: number;
  /** Total dissipation limit (W), used for Zeners. */
  readonly maxPowerW?: number;
}

/** 1N4007: 0.65 V knee, 0.93 V at 1 A (datasheet typ.); 1000 V PIV. */
export const VARIANT_1N4007: DiodeVariant = {
  type: 'semiconductor.diode-1n4007',
  forward: { vf: 0.65, rs: 0.28 },
  maxForwardA: 1,
  maxReverseV: 1000,
};

/** 1N4148: 0.63 V at 10 mA, ≈ 0.9 V at 100 mA; 100 V PIV, 300 mA. */
export const VARIANT_1N4148: DiodeVariant = {
  type: 'semiconductor.diode-1n4148',
  forward: { vf: 0.6, rs: 3 },
  maxForwardA: 0.3,
  maxReverseV: 100,
};

/** 1N4733A (5.1 V, 1 W): Vz = 5.1 V at Izt = 49 mA with Zzt = 7 Ω. */
export const VARIANT_ZENER_5V1: DiodeVariant = {
  type: 'semiconductor.zener-5v1',
  forward: { vf: 0.7, rs: 0.5 },
  breakdown: { vf: 5.1 - 0.049 * 7, rs: 7 },
  maxForwardA: 0.2,
  maxPowerW: 1,
};

/**
 * Discrete diode as a piecewise-linear element (Technical Design §5.4); a Zener adds the reverse
 * breakdown as a second PWL diode from cathode to anode. A burnt diode opens.
 */
export class Diode implements ComponentModel<DiodeProps, DiodeState>, Damageable {
  readonly type: string;
  private id = '';
  private anode: NetId = 0;
  private cathode: NetId = 0;
  private forward = 0 as DiodeHandle;
  private reverse: DiodeHandle | null = null;
  private currentA = 0;
  private volts = 0;

  damaged = false;

  constructor(private readonly variant: DiodeVariant) {
    this.type = variant.type;
  }

  damage(_reason: string): void {
    this.damaged = true;
  }

  init(ctx: ModelContext): void {
    this.id = ctx.id;
    this.anode = ctx.net('a');
    this.cathode = ctx.net('k');
  }

  stamp(s: MnaStamper): void {
    if (this.damaged) return;
    this.forward = s.diode(this.anode, this.cathode, this.variant.forward);
    this.reverse = this.variant.breakdown ? s.diode(this.cathode, this.anode, this.variant.breakdown) : null;
  }

  step(_dt: number, io: ComponentIO): void {
    const { solution } = io;
    this.volts = solution.voltage(this.anode) - solution.voltage(this.cathode);
    if (this.damaged) {
      this.currentA = 0;
      return;
    }
    this.currentA =
      solution.diodeCurrent(this.forward) - (this.reverse === null ? 0 : solution.diodeCurrent(this.reverse));
  }

  faults(): readonly Fault[] {
    const { maxForwardA, maxReverseV, maxPowerW } = this.variant;
    const out: Fault[] = [];
    const fault = (code: string, params: Record<string, number>) =>
      out.push({ code, componentId: this.id, params });
    if (this.currentA > maxForwardA)
      fault('OVER_CURRENT', { currentMa: this.currentA * 1000, limitMa: maxForwardA * 1000 });
    if (maxReverseV !== undefined && -this.volts > maxReverseV)
      fault('REVERSE_VOLTAGE', { volts: -this.volts, limitV: maxReverseV });
    if (maxPowerW !== undefined && this.power() > maxPowerW)
      fault('OVER_POWER', { powerMw: this.power() * 1000, limitMw: maxPowerW * 1000 });
    return out;
  }

  snapshot(): DiodeState {
    return {
      currentMa: this.currentA * 1000,
      volts: this.volts,
      powerMw: this.power() * 1000,
      damaged: this.damaged,
    };
  }

  private power(): number {
    return Math.abs(this.volts * this.currentA);
  }
}
