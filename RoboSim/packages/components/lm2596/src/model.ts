import type {
  ComponentIO,
  ComponentModel,
  Damageable,
  Fault,
  MnaStamper,
  ModelContext,
  NetId,
  SourceHandle,
} from '@robosim/sim-core';

export interface Lm2596Props {
  /** Output set by the module's trimmer (V). */
  readonly outputV: number;
}

export interface Lm2596State {
  readonly vin: number;
  readonly vout: number;
  readonly outputMa: number;
  readonly inputMa: number;
  /** Pout / Pin, 0 when idle. */
  readonly efficiency: number;
  readonly dropout: boolean;
  readonly currentLimited: boolean;
  /** Input below the undervoltage lockout: the output is off. */
  readonly undervoltage: boolean;
  readonly damaged: boolean;
}

/** LM2596 module: max duty leaves Vin − ≈ 1.5 V (switch Vsat + catch diode); UVLO 4.5 V; 3 A rated. */
const DROPOUT_V = 1.5;
const MIN_VIN = 4.5;
const MAX_VIN = 40;
const LIMIT_A = 3.6;
const OUTPUT_OHMS = 0.05;
/** Losses: switching + quiescent (W) plus conduction proportional to output power → η ≈ 80–88 %. */
const FIXED_LOSS_W = 0.08;
const PROPORTIONAL_LOSS = 0.12;
const RESTAMP_RATIO = 1e-4;

/**
 * LM2596 buck module (Technical Design §5.4): an averaged DC transformer from input to output whose
 * ratio follows the solved input, so the output holds its set voltage while the input current is
 * Vout·I / (η·Vin) — a buck draws less input current than it delivers. Current limiting and the
 * undervoltage lockout protect the module; only input over-voltage damages it.
 */
export class Lm2596 implements ComponentModel<Lm2596Props, Lm2596State>, Damageable {
  readonly type = 'power.lm2596';
  private id = '';
  private net = { inP: 0, inN: 0, outP: 0, outN: 0 } as Record<'inP' | 'inN' | 'outP' | 'outN', NetId>;
  private setV = 5;
  private handle: SourceHandle | null = null;
  private ratio = 0;
  private lossA = 0;
  private limitV = Infinity;
  private vin = 0;
  private vout = 0;
  private outA = 0;

  damaged = false;

  damage(_reason: string): void {
    this.damaged = true;
  }

  init(ctx: ModelContext, props: Lm2596Props): void {
    this.id = ctx.id;
    this.setV = props.outputV;
    this.net = { inP: ctx.net('in+'), inN: ctx.net('in-'), outP: ctx.net('out+'), outN: ctx.net('out-') };
  }

  stamp(s: MnaStamper): void {
    const { inP, inN, outP, outN } = this.net;
    this.handle = null;
    if (this.damaged || this.ratio <= 0) return;
    this.handle = s.transformer(inP, inN, outP, outN, this.ratio, { seriesResistance: OUTPUT_OHMS });
    if (this.lossA > 0) s.currentSource(inP, inN, this.lossA);
  }

  step(_dt: number, io: ComponentIO): void {
    const v = (n: NetId) => io.solution.voltage(n);
    this.vin = v(this.net.inP) - v(this.net.inN);
    this.vout = v(this.net.outP) - v(this.net.outN);
    this.outA = this.handle === null ? 0 : Math.max(0, io.solution.sourceCurrent(this.handle));

    const stampedV = this.ratio * this.vin;
    // A resistive load at the limit sits where V·limit/I = V; above it the output folds back.
    this.limitV = this.outA > 1e-6 ? (stampedV * LIMIT_A) / this.outA : Infinity;
    // The feedback pin regulates the output terminal, so the internal voltage covers the I·R drop.
    const regulated = this.setV + this.outA * OUTPUT_OHMS;
    const target =
      this.damaged || this.vin < MIN_VIN ? 0 : Math.min(regulated, this.vin - DROPOUT_V, this.limitV);
    const ratio = target > 0 ? target / this.vin : 0;
    const pout = Math.max(0, this.vout * this.outA);
    const lossA = ratio > 0 ? (FIXED_LOSS_W + PROPORTIONAL_LOSS * pout) / this.vin : 0;
    const moved = (a: number, b: number) => Math.abs(a - b) > RESTAMP_RATIO * Math.max(Math.abs(b), 1e-3);
    if (moved(ratio, this.ratio) || moved(lossA, this.lossA)) {
      this.ratio = ratio;
      this.lossA = lossA;
      io.invalidate();
    }
  }

  faults(): readonly Fault[] {
    return this.vin > MAX_VIN
      ? [{ code: 'OVER_VOLTAGE', componentId: this.id, params: { volts: this.vin, limitV: MAX_VIN } }]
      : [];
  }

  snapshot(): Lm2596State {
    const pout = Math.max(0, this.vout * this.outA);
    const inA = this.ratio * this.outA + this.lossA;
    const pin = this.vin * inA;
    return {
      vin: this.vin,
      vout: this.vout,
      outputMa: this.outA * 1000,
      inputMa: inA * 1000,
      efficiency: pin > 1e-9 ? pout / pin : 0,
      dropout: this.vin >= MIN_VIN && this.vin - DROPOUT_V < this.setV,
      currentLimited: this.limitV < Math.min(this.setV + this.outA * OUTPUT_OHMS, this.vin - DROPOUT_V),
      undervoltage: this.vin < MIN_VIN,
      damaged: this.damaged,
    };
  }
}
