import type {
  ComponentIO,
  ComponentModel,
  Damageable,
  DiodeHandle,
  Fault,
  MnaStamper,
  ModelContext,
  NetId,
  ReactiveState,
  SourceHandle,
} from '@robosim/sim-core';

export interface CapacitorProps {
  /** Ceramic: capacitance in nF. */
  readonly capacitanceNf?: number;
  /** Electrolytic: capacitance in µF and voltage rating (`v16` = 16 V). */
  readonly capacitanceUf?: number;
  readonly ratedVoltage?: string;
}

export interface CapacitorState {
  /** Terminal voltage a → b (ceramic) or + → − (electrolytic) (V). */
  readonly volts: number;
  /** Mean current into the first terminal over the last slice (mA). */
  readonly currentMa: number;
  readonly ratedV: number;
  /** Electrolytic that over-voltage or reverse bias has vented: it no longer works. */
  readonly damaged: boolean;
}

export interface CapacitorVariant {
  readonly type: string;
  readonly pins: readonly [string, string];
  readonly polarized: boolean;
}

export const CERAMIC: CapacitorVariant = {
  type: 'passive.capacitor-ceramic',
  pins: ['a', 'b'],
  polarized: false,
};
export const ELECTROLYTIC: CapacitorVariant = {
  type: 'passive.capacitor-electrolytic',
  pins: ['pos', 'neg'],
  polarized: true,
};

/** X7R multilayer ceramic: 50 V rating, a few mΩ ESR. */
const CERAMIC_RATED_V = 50;
const CERAMIC_ESR = 0.01;
/** Dissipation factor tan δ at 120 Hz per rated voltage (general-purpose aluminium electrolytics). */
const TAN_DELTA: Readonly<Record<number, number>> = {
  6.3: 0.22,
  10: 0.19,
  16: 0.16,
  25: 0.14,
  35: 0.12,
  50: 0.1,
  63: 0.09,
};
/** Reverse bias an electrolytic tolerates before its oxide conducts (V), and how it then conducts. */
const REVERSE_TOLERANCE_V = 1;
const REVERSE_CONDUCTION = { vf: 1, rs: 5 } as const;
/** Datasheet surge voltage: 1.15 × rated. */
const SURGE_FACTOR = 1.15;

export function ratedVoltageOf(option: string | undefined): number {
  const v = Number((option ?? 'v16').slice(1).replace('_', '.'));
  if (!Number.isFinite(v) || v <= 0) throw new Error(`capacitor: bad voltage rating '${option}'`);
  return v;
}

/** ESR of an aluminium electrolytic from its dissipation factor: ESR = tan δ / (2π · 120 Hz · C). */
export function electrolyticEsr(farads: number, ratedV: number): number {
  const tanDelta = TAN_DELTA[ratedV] ?? 0.16;
  return Math.min(50, Math.max(0.02, tanDelta / (2 * Math.PI * 120 * farads)));
}

/**
 * Capacitor (Technical Design §5.4, Tier B): a backward-Euler companion branch with ESR. Electrolytics
 * leak (≈ 0.002·C·V µA), conduct when reverse-biased beyond about 1 V, and vent — opening for good —
 * when the damage model acts on reverse bias or a voltage above the surge rating.
 */
export class Capacitor implements ComponentModel<CapacitorProps, CapacitorState>, Damageable {
  readonly type: string;
  private id = '';
  private a: NetId = 0;
  private b: NetId = 0;
  private farads = 1e-7;
  private esr = CERAMIC_ESR;
  private ratedV = CERAMIC_RATED_V;
  private leakS = 0;
  private handle = 0 as SourceHandle;
  private reverse: DiodeHandle | null = null;
  private readonly charge: ReactiveState = { volts: 0, amps: 0 };
  private volts = 0;
  private currentA = 0;

  damaged = false;

  constructor(private readonly variant: CapacitorVariant) {
    this.type = variant.type;
  }

  damage(_reason: string): void {
    this.damaged = true;
  }

  init(ctx: ModelContext, props: CapacitorProps): void {
    this.id = ctx.id;
    this.a = ctx.net(this.variant.pins[0]);
    this.b = ctx.net(this.variant.pins[1]);
    if (this.variant.polarized) {
      const uf = props.capacitanceUf ?? 100;
      this.farads = uf * 1e-6;
      this.ratedV = ratedVoltageOf(props.ratedVoltage);
      this.esr = electrolyticEsr(this.farads, this.ratedV);
      this.leakS = 0.002 * uf * 1e-6; // 0.002·C·V µA at V volts
    } else {
      this.farads = (props.capacitanceNf ?? 100) * 1e-9;
    }
  }

  stamp(s: MnaStamper): void {
    if (this.damaged) {
      this.charge.volts = 0;
      this.charge.amps = 0;
      return;
    }
    this.handle = s.capacitor(this.a, this.b, this.farads, this.charge, { esr: this.esr });
    this.reverse = null;
    if (this.variant.polarized) {
      s.conductance(this.a, this.b, this.leakS);
      this.reverse = s.diode(this.b, this.a, REVERSE_CONDUCTION);
    }
  }

  step(_dt: number, io: ComponentIO): void {
    const sol = io.solution;
    this.volts = sol.voltage(this.a) - sol.voltage(this.b);
    // Everything entering the first terminal: the capacitance, leakage, and reverse conduction.
    this.currentA = this.damaged
      ? 0
      : -sol.sourceCurrent(this.handle) +
        this.leakS * this.volts -
        (this.reverse === null ? 0 : sol.diodeCurrent(this.reverse));
  }

  faults(): readonly Fault[] {
    if (this.damaged) return [];
    const out: Fault[] = [];
    if (this.variant.polarized && this.volts < -REVERSE_TOLERANCE_V)
      out.push({
        code: 'REVERSE_VOLTAGE',
        componentId: this.id,
        params: { volts: -this.volts, limitV: REVERSE_TOLERANCE_V },
      });
    const limit = this.variant.polarized ? this.ratedV * SURGE_FACTOR : this.ratedV;
    if (Math.abs(this.volts) > limit)
      out.push({
        code: 'OVER_VOLTAGE',
        componentId: this.id,
        params: { volts: Math.abs(this.volts), limitV: limit },
      });
    return out;
  }

  snapshot(): CapacitorState {
    return {
      volts: this.volts,
      currentMa: this.currentA * 1000,
      ratedV: this.ratedV,
      damaged: this.damaged,
    };
  }
}
