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
  /** Sketch lines the finding is about (code-aware rules, FR-SAF-03); the editor marks them. */
  readonly codeRefs?: readonly CodeRef[];
}

/** A position in the sketch: file name as in the project, 1-based line and column. */
export interface CodeRef {
  readonly file: string;
  readonly line: number;
  readonly column: number;
}

/** How a sketch uses a pin (FR-COD-06). `servo` is `Servo.attach`; `tone` drives the pin like an output. */
export type PinUseKind =
  'pinMode' | 'digitalWrite' | 'digitalRead' | 'analogWrite' | 'analogRead' | 'servo' | 'tone';

export interface PinUse {
  /** Board pin id: 'D0'…'D13', 'A0'…'A5'. */
  readonly pin: string;
  readonly use: PinUseKind;
  /** `pinMode` only. */
  readonly mode?: 'INPUT' | 'OUTPUT' | 'INPUT_PULLUP';
  readonly at: CodeRef;
}

/** Pin usage extracted from the sketch (`@robosim/code-analysis`), input to the code-aware rules. */
export interface CodeFacts {
  readonly uses: readonly PinUse[];
  /**
   * Pin calls whose pin or mode is not a compile-time constant (a variable, an array element), and direct
   * port register access (`DDRB`, `PORTD`). While any remain the pin set is incomplete, so rules that need
   * every output stay conservative.
   */
  readonly unresolved: readonly { readonly call: string; readonly at: CodeRef }[];
  /** Library `#include`s, e.g. 'Servo.h' (the project's own files are left out): libraries drive pins without calls the analysis sees. */
  readonly includes: readonly string[];
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
  /** Small-signal resistance from `net` to ground (Ω); very large means the net floats. */
  netResistance(net: NetId): number;
}

/** What happens right after a pin switches (reactive circuits): extreme voltages and faults. */
export interface TransitionProbe {
  /** Lowest and highest voltage of `net` in the window after the switch. */
  peak(net: NetId): { readonly min: number; readonly max: number };
  readonly faults: readonly Fault[];
}

export interface StaticContext {
  readonly circuit: AssembledCircuit;
  readonly board: BoardInfo | null;
  /** Pin usage of the sketch, when the project has one (code-aware rules). */
  readonly code: CodeFacts | null;
  /** Power-on state: every MCU pin high-impedance, before any firmware runs. */
  readonly idle: StaticProbe;
  /** Worst case for one pin: driven as an output at `level`, every other MCU pin high-impedance. */
  drive(pin: string, level: Level): StaticProbe;
  /**
   * Integrated in time (capacitors charge, inductors carry current): `pin` driven at `from` until the
   * circuit settles, then switched to `to`. Shows an inductive kickback the DC probes cannot.
   */
  transition(pin: string, from: Level, to: Level): TransitionProbe;
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
