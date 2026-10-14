import type {
  ComponentIO,
  ComponentModel,
  Fault,
  MnaStamper,
  ModelContext,
  NetId,
  SourceHandle,
} from '@robosim/sim-core';

export interface BatteryProps {
  readonly capacityMah: number;
  readonly internalOhms: number;
  readonly initialCharge: number;
}

export interface BatteryState {
  /** Terminal voltage under load (V). */
  readonly volts: number;
  /** Open-circuit voltage at the current charge (V). */
  readonly ocv: number;
  /** State of charge 0..1. */
  readonly charge: number;
  readonly currentMa: number;
}

export interface BatteryVariant {
  readonly type: string;
  readonly cells: number;
  readonly maxCurrentMa: number;
}

/** Alkaline cell open-circuit voltage by state of charge (piecewise linear, typical discharge curve). */
const ALKALINE_OCV: readonly (readonly [charge: number, volts: number])[] = [
  [0, 0.9],
  [0.1, 1.15],
  [0.2, 1.22],
  [0.5, 1.32],
  [0.8, 1.42],
  [0.9, 1.48],
  [1, 1.58],
];

export function cellOcv(charge: number): number {
  const c = Math.min(1, Math.max(0, charge));
  for (let i = 1; i < ALKALINE_OCV.length; i++) {
    const [c1, v1] = ALKALINE_OCV[i] ?? [1, 1.58];
    const [c0, v0] = ALKALINE_OCV[i - 1] ?? [0, 0.9];
    if (c <= c1) return v0 + ((v1 - v0) * (c - c0)) / (c1 - c0);
  }
  return 1.58;
}

/** Re-stamp when the open-circuit voltage drifts by more than this (V). */
const RESTAMP_EPSILON_V = 1e-3;

/**
 * Alkaline battery (Technical Design §5.5): OCV curve × cells, internal resistance rising as it drains,
 * coulomb-counted state of charge. Sag under motor load falls out of the MNA solution.
 */
export class Battery implements ComponentModel<BatteryProps, BatteryState> {
  readonly type: string;
  private id = '';
  private pos: NetId = 0;
  private neg: NetId = 0;
  private props: BatteryProps = { capacityMah: 550, internalOhms: 1.5, initialCharge: 1 };
  private charge = 1;
  private stampedOcv = 0;
  private handle = 0 as SourceHandle;
  private currentA = 0;
  private terminalV = 0;

  constructor(private readonly variant: BatteryVariant) {
    this.type = variant.type;
  }

  init(ctx: ModelContext, props: BatteryProps): void {
    this.id = ctx.id;
    this.pos = ctx.net('pos');
    this.neg = ctx.net('neg');
    this.props = props;
    this.charge = props.initialCharge;
  }

  input(name: string, value: number | boolean): void {
    if (name !== 'charge' || typeof value !== 'number') throw new Error(`${this.type}: bad input '${name}'`);
    this.charge = Math.min(1, Math.max(0, value));
  }

  ocv(): number {
    return this.variant.cells * cellOcv(this.charge);
  }

  stamp(s: MnaStamper): void {
    this.stampedOcv = this.ocv();
    this.handle = s.voltageSource(this.pos, this.neg, this.stampedOcv, this.resistance());
  }

  step(dt: number, io: ComponentIO): void {
    this.currentA = io.solution.sourceCurrent(this.handle);
    this.terminalV = io.solution.voltage(this.pos) - io.solution.voltage(this.neg);
    const coulombs = this.props.capacityMah * 3.6;
    this.charge = Math.max(0, this.charge - (Math.max(0, this.currentA) * dt) / coulombs);
    if (Math.abs(this.ocv() - this.stampedOcv) > RESTAMP_EPSILON_V) io.invalidate();
  }

  faults(): readonly Fault[] {
    const ma = Math.abs(this.currentA) * 1000;
    return ma > this.variant.maxCurrentMa
      ? [
          {
            code: 'SHORT_CIRCUIT',
            componentId: this.id,
            params: { currentMa: ma, limitMa: this.variant.maxCurrentMa },
          },
        ]
      : [];
  }

  snapshot(): BatteryState {
    return { volts: this.terminalV, ocv: this.ocv(), charge: this.charge, currentMa: this.currentA * 1000 };
  }

  private resistance(): number {
    return this.props.internalOhms * (1 + 2 * (1 - this.charge)); // ~3× when empty
  }
}
