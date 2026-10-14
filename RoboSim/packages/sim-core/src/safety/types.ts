import type { AssembledCircuit } from '../circuit.js';
import type { BoardPinDef, Fault, Level, MnaSolution, NetId, PinElectrical } from '../contracts.js';
import type { Simulation } from '../scheduler.js';

export type Severity = 'error' | 'warning';

/** One safety finding (Technical Design §5.6). Texts are i18n keys in the `safety` namespace. */
export interface Finding {
  readonly ruleId: string;
  readonly severity: Severity;
  readonly componentIds: readonly string[];
  readonly wireIds: readonly string[];
  readonly pinIds: readonly string[];
  /** `safety:<rule>`; the UI renders `<key>.title`, `.why`, `.fix` with `params`. */
  readonly messageKey: string;
  readonly params: Readonly<Record<string, string | number>>;
  readonly learnMoreSlug: string;
  /** Static (wiring, before Run) or runtime (observed while running). */
  readonly kind: 'static' | 'runtime';
}

export interface BoardInfo {
  readonly pins: readonly BoardPinDef[];
  readonly electrical: PinElectrical;
  /** Total current through all MCU I/O pins (mA). */
  readonly packageMaxCurrentMa: number;
}

/** DC operating point of a static probe circuit (fresh models, settled for a few slices). */
export interface StaticProbe {
  readonly solution: MnaSolution;
  volts(net: NetId): number;
  /** Current out of an MCU pin (mA; negative when sinking); 0 for high-Z pins. */
  pinCurrentMa(pin: string): number;
  /** Faults reported by component models in this probe. */
  readonly faults: readonly Fault[];
}

export interface StaticContext {
  readonly circuit: AssembledCircuit;
  readonly board: BoardInfo | null;
  /** Power-on state: every MCU pin high-impedance, before any firmware runs. */
  readonly idle: StaticProbe;
  /** Worst case for one pin: driven as an output at `level`, every other MCU pin high-impedance. */
  drive(pin: string, level: Level): StaticProbe;
}

export interface StaticRule {
  readonly id: string;
  readonly kind: 'static';
  check(ctx: StaticContext): readonly Finding[];
}

/** A runtime violation that becomes a finding once it has persisted for `sustainS`. */
export interface Condition extends Omit<Finding, 'kind'> {
  /** Identity across slices, e.g. `SAF-PIN-CURRENT:D13`. */
  readonly key: string;
  readonly sustainS: number;
  /** What breaks when an Error condition latches (FR-SIM-10). */
  readonly damage?: {
    readonly componentIds?: readonly string[];
    readonly pins?: readonly string[];
    readonly reason: string;
  };
}

export interface RuntimeContext {
  readonly sim: Simulation;
  readonly circuit: AssembledCircuit;
  readonly board: BoardInfo | null;
  readonly simTime: number;
  readonly solution: MnaSolution;
}

export interface RuntimeRule {
  readonly id: string;
  readonly kind: 'runtime';
  /** Evaluate at most this often (s of simulated time); results carry over in between. Default: every check. */
  readonly periodS?: number;
  check(ctx: RuntimeContext): readonly Condition[];
}

export type SafetyRule = StaticRule | RuntimeRule;

export function finding(
  f: Omit<Finding, 'wireIds' | 'learnMoreSlug' | 'messageKey' | 'kind'> & Partial<Finding>,
): Finding {
  return {
    wireIds: [],
    kind: 'static',
    messageKey: `safety:${f.ruleId}`,
    learnMoreSlug: f.ruleId.toLowerCase(),
    ...f,
  };
}
