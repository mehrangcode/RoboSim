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

export type LinearRegulatorProps = Record<string, never>;

export interface LinearRegulatorState {
  readonly vin: number;
  readonly vout: number;
  readonly currentMa: number;
  /** Power turned into heat (W). */
  readonly dissipationW: number;
  readonly junctionC: number;
  /** In dropout: the input is too low to hold the output. */
  readonly dropout: boolean;
  readonly currentLimited: boolean;
  readonly thermalShutdown: boolean;
  readonly damaged: boolean;
}

export interface RegulatorVariant {
  readonly type: string;
  readonly vout: number;
  readonly dropoutV: number;
  readonly maxVin: number;
  /** Internal current limit (A). */
  readonly limitA: number;
  readonly quiescentA: number;
  /** Junction-to-ambient thermal resistance (°C/W) and time constant (s) without a heatsink. */
  readonly thetaJa: number;
  readonly tauS: number;
}

/** LM7805 (TO-220): 2 V dropout at 1 A, 2.2 A peak, 5 mA quiescent, θJA 50 °C/W. */
export const LM7805: RegulatorVariant = {
  type: 'semiconductor.lm7805',
  vout: 5,
  dropoutV: 2,
  maxVin: 35,
  limitA: 2.2,
  quiescentA: 0.005,
  thetaJa: 50,
  tauS: 45,
};

/** AMS1117-3.3 (SOT-223 module): 1.1 V dropout at 800 mA, ≈ 1.1 A limit, θJA ≈ 90 °C/W. */
export const AMS1117_3V3: RegulatorVariant = {
  type: 'semiconductor.ams1117-3v3',
  vout: 3.3,
  dropoutV: 1.1,
  maxVin: 15,
  limitA: 1.1,
  quiescentA: 0.005,
  thetaJa: 90,
  tauS: 20,
};

const AMBIENT_C = 25;
const SHUTDOWN_C = 150;
const RESTART_C = 135;
const OUTPUT_OHMS = 0.02;
const RESTAMP_V = 1e-3;

/**
 * Three-terminal linear regulator (Technical Design §5.4): a voltage source whose current is drawn
 * from the input, so the battery behind it sags. Below `vout + dropout` the output follows the input;
 * above the current limit it folds back. The dropped power heats the junction (first-order thermal
 * model) until the built-in thermal shutdown cuts the output, as on the real part.
 */
export class LinearRegulator
  implements ComponentModel<LinearRegulatorProps, LinearRegulatorState>, Damageable
{
  readonly type: string;
  private id = '';
  private inNet: NetId = 0;
  private gnd: NetId = 0;
  private out: NetId = 0;
  private handle: SourceHandle | null = null;
  private stampedV = 0;
  private vin = 0;
  private vout = 0;
  private currentA = 0;
  private junctionC = AMBIENT_C;
  private shutdown = false;
  private limited = false;

  damaged = false;

  constructor(private readonly variant: RegulatorVariant) {
    this.type = variant.type;
  }

  damage(_reason: string): void {
    this.damaged = true;
  }

  init(ctx: ModelContext): void {
    this.id = ctx.id;
    this.inNet = ctx.net('in');
    this.gnd = ctx.net('gnd');
    this.out = ctx.net('out');
    this.stampedV = this.variant.vout;
  }

  stamp(s: MnaStamper): void {
    if (this.damaged) return;
    // Quiescent draw, sized at the minimum input that regulates.
    s.conductance(
      this.inNet,
      this.gnd,
      this.variant.quiescentA / (this.variant.vout + this.variant.dropoutV),
    );
    this.handle =
      this.stampedV > 0 && !this.shutdown
        ? s.voltageSource(this.out, this.gnd, this.stampedV, OUTPUT_OHMS, { supplyFrom: this.inNet })
        : null;
  }

  step(dt: number, io: ComponentIO): void {
    const { solution } = io;
    const { vout, dropoutV, limitA, thetaJa, tauS, quiescentA } = this.variant;
    this.vin = solution.voltage(this.inNet) - solution.voltage(this.gnd);
    this.vout = solution.voltage(this.out) - solution.voltage(this.gnd);
    this.currentA = this.handle === null ? 0 : Math.max(0, solution.sourceCurrent(this.handle));

    const power = this.dissipation(quiescentA);
    this.junctionC += ((AMBIENT_C + power * thetaJa - this.junctionC) * dt) / tauS;
    const shutdown = this.shutdown ? this.junctionC > RESTART_C : this.junctionC >= SHUTDOWN_C;

    // Fixed point of a resistive load at the limit: V·limit/I gives exactly limitA.
    const limitV = this.currentA > 1e-6 ? (this.stampedV * limitA) / this.currentA : Infinity;
    this.limited = limitV < Math.min(vout, this.vin - dropoutV);
    const target = Math.max(0, Math.min(vout, this.vin - dropoutV, limitV));
    if (shutdown !== this.shutdown || Math.abs(target - this.stampedV) > RESTAMP_V) {
      this.shutdown = shutdown;
      this.stampedV = target;
      io.invalidate();
    }
  }

  faults(): readonly Fault[] {
    const { maxVin } = this.variant;
    return this.vin > maxVin
      ? [{ code: 'OVER_VOLTAGE', componentId: this.id, params: { volts: this.vin, limitV: maxVin } }]
      : [];
  }

  snapshot(): LinearRegulatorState {
    return {
      vin: this.vin,
      vout: this.vout,
      currentMa: this.currentA * 1000,
      dissipationW: this.dissipation(this.variant.quiescentA),
      junctionC: this.junctionC,
      dropout: !this.shutdown && this.vin > 0 && this.vin - this.variant.dropoutV < this.variant.vout,
      currentLimited: this.limited,
      thermalShutdown: this.shutdown,
      damaged: this.damaged,
    };
  }

  private dissipation(quiescentA: number): number {
    if (this.damaged) return 0;
    return Math.max(0, this.vin - this.vout) * this.currentA + Math.max(0, this.vin) * quiescentA;
  }
}
