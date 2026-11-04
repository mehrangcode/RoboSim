import { cellOcv } from '@robosim/component-battery';

export interface BatteryLifeInput {
  /** Cells in series. */
  readonly cells: number;
  readonly capacityMah: number;
  /** Internal resistance when full (Ω); it rises to 3× when empty, as in the battery model. */
  readonly internalOhms: number;
  /** Present state of charge, 0..1. */
  readonly charge: number;
  /** Lowest terminal voltage the loads still work at (V). */
  readonly cutoffV: number;
  /** Average load current (mA). */
  readonly avgMa: number;
  /** Pessimistic steady current: the 90th percentile of 1 s currents (mA). Defaults to `avgMa`. */
  readonly p90Ma?: number;
  /** Peak current (mA): its extra sag over the steady current raises the effective cut-off. */
  readonly peakMa?: number;
}

export type BatteryLife =
  | {
      readonly kind: 'ok';
      /** Estimate at the average current (h). */
      readonly hours: number;
      /** Pessimistic bound: p90 current, cut-off raised by the peak's sag (h). */
      readonly minHours: number;
      /** Optimistic bound: average current, the pack recovering between bursts (no sag) (h). */
      readonly maxHours: number;
      /** Charge at which the terminal voltage reaches the cut-off at the average current. */
      readonly cutoffCharge: number;
      /** Share of the present charge usable before the cut-off: (c0 − c_cut) / c0. */
      readonly usableFraction: number;
    }
  | { readonly kind: 'belowCutoff' }
  | { readonly kind: 'noLoad' };

const BISECTION_STEPS = 40;

/**
 * Battery life (FR-SIM-15, TD §18.4): the charge where the loaded terminal voltage
 * `n·ocv(c) − I·R(c)` meets the cut-off, then linear coulomb counting `t = (c0 − c_cut)·C / I` —
 * the same model as the simulated battery, so a long run agrees. No Peukert term: real alkalines give
 * less at high current. DOM-free; `ocv` is injectable for tests.
 */
export function batteryLife(input: BatteryLifeInput, ocv: (charge: number) => number = cellOcv): BatteryLife {
  const { cells, capacityMah, internalOhms, cutoffV, avgMa } = input;
  const c0 = Math.min(1, Math.max(0, input.charge));
  if (!(avgMa > 0)) return { kind: 'noLoad' };
  const p90Ma = Math.max(avgMa, input.p90Ma ?? avgMa);
  const peakMa = Math.max(p90Ma, input.peakMa ?? p90Ma);
  const r = (c: number): number => internalOhms * (1 + 2 * (1 - c));
  /** Terminal voltage at charge c with a sag current of `sagMa`. */
  const volts = (c: number, sagMa: number): number => cells * ocv(c) - (sagMa / 1000) * r(c);

  const cutAt = (sagMa: number): number | null => {
    if (volts(c0, sagMa) < cutoffV) return null;
    if (volts(0, sagMa) >= cutoffV) return 0;
    // volts rises with c (OCV up, resistance down), so bisect for the crossing.
    let lo = 0;
    let hi = c0;
    for (let i = 0; i < BISECTION_STEPS; i++) {
      const mid = (lo + hi) / 2;
      if (volts(mid, sagMa) >= cutoffV) hi = mid;
      else lo = mid;
    }
    return hi;
  };

  const cut = cutAt(avgMa);
  if (cut === null) return { kind: 'belowCutoff' };
  const hoursFor = (c: number | null, ma: number): number => (c === null ? 0 : ((c0 - c) * capacityMah) / ma);
  const hours = hoursFor(cut, avgMa);
  return {
    kind: 'ok',
    hours,
    minHours: Math.min(hours, hoursFor(cutAt(peakMa), p90Ma)),
    maxHours: Math.max(hours, hoursFor(cutAt(0), avgMa)),
    cutoffCharge: cut,
    usableFraction: c0 > 0 ? (c0 - cut) / c0 : 0,
  };
}
