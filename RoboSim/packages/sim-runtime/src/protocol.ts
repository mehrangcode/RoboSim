/** Worker protocol of the Simulator Lab (Technical Design §5.8, postMessage variant). */

export type BenchScenarioId = 'blink' | 'button' | 'dimmer' | 'servo';
export type SafetyScenarioId = 'led-no-resistor' | 'outputs-fighting' | 'motor-on-pin' | 'floating-input';
export type ScenarioId = 'line-follower' | BenchScenarioId | SafetyScenarioId;

export const BENCH_SCENARIOS: readonly BenchScenarioId[] = ['blink', 'button', 'dimmer', 'servo'];
export const SAFETY_SCENARIOS: readonly SafetyScenarioId[] = [
  'led-no-resistor',
  'outputs-fighting',
  'motor-on-pin',
  'floating-input',
];
export const SCENARIOS: readonly ScenarioId[] = ['line-follower', ...BENCH_SCENARIOS, ...SAFETY_SCENARIOS];

/** A safety finding as shown in the Lab (FR-SAF-06); texts come from i18n `<messageKey>.title|why|fix`. */
export interface FindingView {
  readonly ruleId: string;
  readonly severity: 'error' | 'warning';
  readonly kind: 'static' | 'runtime';
  readonly componentIds: readonly string[];
  readonly pinIds: readonly string[];
  readonly messageKey: string;
  readonly params: Readonly<Record<string, string | number>>;
}

export type MainToWorker =
  | { readonly type: 'load'; readonly scenario: ScenarioId; readonly seed?: number }
  | { readonly type: 'control'; readonly action: 'run' | 'pause' | 'reset' | 'step' }
  | { readonly type: 'speed'; readonly value: number }
  | {
      readonly type: 'input';
      readonly componentId: string;
      readonly name: string;
      readonly value: number | boolean;
    };

export interface PartInfo {
  readonly id: string;
  /** Catalogue type id (i18n: `components:<type>.name`). */
  readonly type: string;
  readonly inputs: readonly {
    readonly name: string;
    readonly type: 'boolean' | 'number';
    readonly min?: number;
    readonly max?: number;
    readonly default: number | boolean;
  }[];
}

export interface ArenaScene {
  readonly widthM: number;
  readonly heightM: number;
  /** Display raster (grayscale, row 0 = arena bottom). */
  readonly floor: { readonly widthPx: number; readonly heightPx: number; readonly data: Uint8Array };
  readonly zones: readonly {
    readonly id: string;
    readonly kind: string;
    readonly x: number;
    readonly y: number;
    readonly radiusM: number;
  }[];
}

export interface RobotScene {
  readonly footprint: readonly { readonly x: number; readonly y: number }[];
  readonly wheels: readonly { readonly x: number; readonly y: number; readonly radiusM: number }[];
  readonly caster: { readonly x: number; readonly y: number };
}

export interface SceneInfo {
  readonly scenario: ScenarioId;
  readonly kind: 'arena' | 'bench';
  readonly parts: readonly PartInfo[];
  /** MCU pins shown in the pin table. */
  readonly pins: readonly string[];
  readonly arena?: ArenaScene;
  readonly robot?: RobotScene;
  /** Wiring findings computed before running (FR-SAF-01). */
  readonly staticFindings: readonly FindingView[];
}

export interface PinView {
  readonly mode: 'input' | 'input_pullup' | 'output';
  /** Driven level for outputs; level the MCU reads (VIL/VIH thresholds) for inputs. */
  readonly level: 0 | 1;
  /** Pin voltage (V). */
  readonly volts: number;
  readonly duty?: number;
}

export interface Frame {
  readonly seq: number;
  readonly simTime: number;
  /** Simulated seconds per wall second over the last frame interval. */
  readonly rtf: number;
  readonly running: boolean;
  readonly parts: Readonly<Record<string, unknown>>;
  readonly pins: Readonly<Record<string, PinView>>;
  readonly robot?: {
    readonly x: number;
    readonly y: number;
    readonly angle: number;
    /** Line-sensor spots in world coordinates with their digital reading (1 = black). */
    readonly sensors: readonly { readonly x: number; readonly y: number; readonly black: boolean }[];
  };
  readonly faults: readonly { readonly code: string; readonly componentId: string }[];
  /** Runtime findings latched so far (FR-SAF-04). */
  readonly findings: readonly FindingView[];
  /** Ids of damaged parts and MCU pins (FR-SIM-10). */
  readonly damaged: { readonly parts: readonly string[]; readonly pins: readonly string[] };
}

export type WorkerToMain =
  | { readonly type: 'loaded'; readonly scene: SceneInfo }
  | { readonly type: 'frame'; readonly frame: Frame }
  | { readonly type: 'error'; readonly message: string };
