import type {
  ComponentIO,
  ComponentModel,
  Fault,
  MnaStamper,
  ModelContext,
  NetId,
  ReactiveState,
  SourceHandle,
  WheelActuator,
  Damageable,
} from '@robosim/sim-core';

export interface TtMotorProps {
  readonly ratedVoltageV: number;
  readonly noLoadRpm: number;
  readonly noLoadCurrentMa: number;
  readonly stallCurrentMa: number;
  readonly gearRatio: number;
  readonly gearEfficiency: number;
  readonly timeConstantMs: number;
  /** Winding inductance: interrupting the current makes the kickback a flyback diode exists for. */
  readonly inductanceMh: number;
}

export interface TtMotorState {
  /** Output-shaft speed; positive when m1 is more positive than m2. */
  readonly rpm: number;
  readonly currentMa: number;
  readonly volts: number;
  /** Output-shaft torque delivered (N·m). */
  readonly torqueNm: number;
  readonly damaged: boolean;
}

/** Motor constants (motor side of the gearbox) derived from datasheet-style properties. */
export interface MotorConstants {
  /** Winding resistance (Ω). */
  readonly r: number;
  /** Back-EMF constant = torque constant (V·s/rad = N·m/A). */
  readonly ke: number;
  /** Viscous friction (N·m·s/rad). */
  readonly b: number;
  /** Rotor + gearbox inertia (kg·m²). */
  readonly j: number;
}

export function motorConstants(p: TtMotorProps): MotorConstants {
  const r = p.ratedVoltageV / (p.stallCurrentMa / 1000);
  const i0 = p.noLoadCurrentMa / 1000;
  const omega0 = ((p.noLoadRpm * 2 * Math.PI) / 60) * p.gearRatio;
  const ke = (p.ratedVoltageV - i0 * r) / omega0;
  const b = (ke * i0) / omega0; // friction torque balances Kt·I0 at no-load speed
  const j = ((p.timeConstantMs / 1000) * ke * ke) / r; // τm = J·R / (Kt·Ke)
  return { r, ke, b, j };
}

/** Re-stamp when the back-EMF changes by more than this (V). */
const RESTAMP_EPSILON_V = 1e-4;
/**
 * Losses across the terminals (brush arcing, eddy currents): what an interrupted winding current flows
 * into when nothing clamps it, so an opened switch shows a kick of hundreds of volts, not megavolts.
 */
const DAMPING_OHMS = 2200;

/**
 * Brushed DC gear motor (Technical Design §5.4–5.5): winding resistance + back-EMF source in the circuit;
 * τ = Kt·i, first-order mechanics with gearbox ratio and efficiency. The world model (next slice) couples
 * the output shaft to a wheel through `loadTorqueNm` / `outputOmega()`.
 */
export class TtMotor implements ComponentModel<TtMotorProps, TtMotorState>, WheelActuator, Damageable {
  readonly type = 'actuator.tt-motor';
  private m1: NetId = 0;
  private m2: NetId = 0;
  private props: TtMotorProps | null = null;
  private k: MotorConstants = { r: 5, ke: 0.004, b: 5e-7, j: 1e-7 };
  /** Motor-side angular velocity (rad/s). */
  private omega = 0;
  private stampedEmf = 0;
  private handle = 0 as SourceHandle;
  /** Winding current between integration steps. */
  private readonly winding: ReactiveState = { volts: 0, amps: 0 };
  private currentA = 0;
  private volts = 0;
  private loadTorqueNm = 0;
  private stalled = false;
  /** True once a drivetrain imposes the shaft speed (mounted on a wheel in the world). */
  private coupled = false;

  damaged = false;

  damage(_reason: string): void {
    this.damaged = true; // burnt winding: open circuit, no torque
  }

  init(ctx: ModelContext, props: TtMotorProps): void {
    this.m1 = ctx.net('m1');
    this.m2 = ctx.net('m2');
    this.props = props;
    this.k = motorConstants(props);
  }

  input(name: string, value: number | boolean): void {
    if (name === 'loadTorqueNm' && typeof value === 'number') this.loadTorqueNm = value;
    else if (name === 'stalled' && typeof value === 'boolean') {
      this.stalled = value;
      if (value) this.omega = 0;
    } else throw new Error(`actuator.tt-motor: bad input '${name}'`);
  }

  /** Output-shaft angular velocity (rad/s) for the drivetrain. */
  outputOmega(): number {
    return this.omega / this.gear();
  }

  // --- WheelActuator: the world reads torque and imposes the wheel speed (no-slip coupling) ---

  shaftTorque(): number {
    if (this.damaged) return -this.k.b * this.omega * this.gear();
    return (
      (this.k.ke * this.currentA - this.k.b * this.omega) * this.gear() * (this.props?.gearEfficiency ?? 1)
    );
  }

  setShaftSpeed(omega: number): void {
    this.coupled = true;
    this.omega = omega * this.gear();
  }

  get shaftInertia(): number {
    return this.k.j * this.gear() * this.gear();
  }

  stamp(s: MnaStamper): void {
    this.stampedEmf = this.k.ke * this.omega;
    if (this.damaged) {
      this.winding.amps = 0;
      return;
    }
    s.conductance(this.m1, this.m2, 1 / DAMPING_OHMS);
    this.handle = s.inductor(this.m1, this.m2, (this.props?.inductanceMh ?? 1.5) / 1000, this.winding, {
      seriesResistance: this.k.r,
      emf: this.stampedEmf,
    });
  }

  step(dt: number, io: ComponentIO): void {
    this.volts = io.solution.voltage(this.m1) - io.solution.voltage(this.m2);
    // Source current is reported out of its + terminal; motor current flows m1 → m2 inside the motor.
    this.currentA = this.damaged ? 0 : -io.solution.sourceCurrent(this.handle);
    if (this.stalled) {
      this.omega = 0;
    } else if (!this.coupled) {
      const { ke, b, j } = this.k;
      const loadMotorSide = this.loadTorqueNm / (this.gear() * (this.props?.gearEfficiency ?? 1));
      // Semi-implicit Euler on the viscous term keeps the update stable for any time constant.
      this.omega = (this.omega + (dt * (ke * this.currentA - loadMotorSide)) / j) / (1 + (dt * b) / j);
    }
    if (!this.damaged && Math.abs(this.k.ke * this.omega - this.stampedEmf) > RESTAMP_EPSILON_V)
      io.invalidate();
  }

  faults(): readonly Fault[] {
    return [];
  }

  snapshot(): TtMotorState {
    const torqueMotor = this.k.ke * this.currentA - this.k.b * this.omega;
    return {
      rpm: (this.outputOmega() * 60) / (2 * Math.PI),
      currentMa: this.currentA * 1000,
      volts: this.volts,
      torqueNm: torqueMotor * this.gear() * (this.props?.gearEfficiency ?? 1),
      damaged: this.damaged,
    };
  }

  private gear(): number {
    return this.props?.gearRatio ?? 1;
  }
}
