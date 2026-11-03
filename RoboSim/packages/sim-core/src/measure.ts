import type { MnaSolution } from './contracts.js';

/** A component pin addressed by document ids (FR-SIM-13 measurement channel). */
export interface PartTerminal {
  readonly componentId: string;
  readonly pin: string;
}

type Phased = MnaSolution & {
  phases(): readonly { readonly solution: MnaSolution; readonly weight: number }[];
};

const isPhased = (s: MnaSolution): s is Phased => typeof (s as Partial<Phased>).phases === 'function';

/**
 * `power` of a solution (W), averaged over PWM phases when `s` is a PWM average: power is not linear,
 * so V̄·Ī of a 50 % PWM LED would be wrong. A weighted transient average cannot be split here; the
 * simulation accumulates such power per sub-step instead (see Simulation.watchPower).
 */
export function phaseAveragedPower(power: (s: MnaSolution) => number, s: MnaSolution): number {
  if (!isPhased(s)) return power(s);
  let p = 0;
  for (const ph of s.phases()) if (ph.weight !== 0) p += ph.weight * phaseAveragedPower(power, ph.solution);
  return p;
}
