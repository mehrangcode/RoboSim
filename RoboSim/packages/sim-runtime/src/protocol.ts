/**
 * Worker protocol (Technical Design §5.8). Hot state (time, parts, pins, robot, challenge) travels as
 * binary snapshots — a shared double buffer, or transferable buffers without cross-origin isolation;
 * discrete happenings (serial output, findings, faults, damage) travel as events.
 */
import type { ProjectDocument } from '@robosim/shared';
import type { DictDelta } from './snapshot-codec.js';

export type BenchScenarioId = 'blink' | 'button' | 'dimmer' | 'servo' | 'serial';
export type SafetyScenarioId = 'led-no-resistor' | 'outputs-fighting' | 'motor-on-pin' | 'floating-input';
export type ScenarioId = 'line-follower' | BenchScenarioId | SafetyScenarioId;

export const BENCH_SCENARIOS: readonly BenchScenarioId[] = ['blink', 'button', 'dimmer', 'servo', 'serial'];
export const SAFETY_SCENARIOS: readonly SafetyScenarioId[] = [
  'led-no-resistor',
  'outputs-fighting',
  'motor-on-pin',
  'floating-input',
];
/** Longest verified run in simulated seconds (Technical Design §11.1). */
export const MAX_SIM_SECONDS = 300;

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

/** A user interaction, stamped with the slice it was applied at (the simulation was at that slice). */
export type InputLogEntry =
  | {
      readonly slice: number;
      readonly kind: 'component';
      readonly componentId: string;
      readonly name: string;
      readonly value: number | boolean;
    }
  | { readonly slice: number; readonly kind: 'serial'; readonly text: string };

/** A compiled program for the board; the build service produces it (Intel HEX for the Uno). */
export interface FirmwarePayload {
  readonly format: 'ihex';
  readonly text: string;
  readonly sha256: string;
}

export interface SourceFile {
  readonly name: string;
  readonly content: string;
}

/**
 * What to simulate: a built-in Lab demo, a project document with its firmware, or a built-in demo's
 * circuit running the user's own code (the Lab's sketch tab: files + the firmware built from them).
 */
export type RunSource =
  | { readonly scenario: ScenarioId }
  | { readonly project: ProjectDocument; readonly firmware: FirmwarePayload }
  | {
      readonly template: ScenarioId;
      readonly files: readonly SourceFile[];
      readonly firmware: FirmwarePayload;
    };

/**
 * Everything needed to reproduce a run bit for bit (Technical Design §5.9): the project and
 * firmware themselves, so an exported log replays anywhere with the same engine version.
 */
export interface InputLog {
  readonly engineVersion: string;
  /** Set when the run was a built-in demo. */
  readonly scenario: ScenarioId | null;
  readonly project: ProjectDocument;
  readonly firmware: FirmwarePayload;
  readonly seed: number;
  readonly entries: readonly InputLogEntry[];
  /** Slice the run had reached when the log was exported (a verified run can stop there). */
  readonly endSlice?: number;
}

export type MainToWorker =
  | (RunSource & {
      readonly type: 'load';
      readonly seed?: number;
      /** Replays these inputs at their recorded slices. */
      readonly inputLog?: readonly InputLogEntry[];
    })
  | { readonly type: 'control'; readonly action: 'run' | 'pause' | 'reset' | 'step' }
  | { readonly type: 'speed'; readonly value: number }
  | {
      readonly type: 'input';
      readonly componentId: string;
      readonly name: string;
      readonly value: number | boolean;
    }
  /** Bytes for the MCU's UART RX (Serial Monitor), UTF-8 encoded. */
  | { readonly type: 'serial'; readonly text: string }
  /** Asks for the input log of the current run (answered with `inputLog`). */
  | { readonly type: 'exportLog' };

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
  /** The built-in demo, or null for a project load. */
  readonly scenario: ScenarioId | null;
  readonly title: string;
  readonly kind: 'arena' | 'bench';
  readonly parts: readonly PartInfo[];
  /** MCU pins shown in the pin table. */
  readonly pins: readonly string[];
  readonly arena?: ArenaScene;
  readonly robot?: RobotScene;
  /** Wiring findings computed before running (FR-SAF-01). */
  readonly staticFindings: readonly FindingView[];
  /** The firmware talks over the UART: the Lab shows a Serial Monitor. */
  readonly serial: boolean;
  /** The project's source files (what the firmware was built from). */
  readonly code: readonly SourceFile[];
  /** The loaded document itself, so an editor can open a demo (or the running project). */
  readonly project: ProjectDocument;
}

/** Bytes the firmware transmitted during one slice at one baud rate (0 = transmitter off). */
export interface SerialChunk {
  readonly slice: number;
  readonly baud: number;
  readonly bytes: Uint8Array;
}

export interface PinView {
  readonly mode: 'input' | 'input_pullup' | 'output';
  /** Driven level for outputs; level the MCU reads (VIL/VIH thresholds) for inputs. */
  readonly level: 0 | 1;
  /** Pin voltage (V). */
  readonly volts: number;
  /** PWM duty ratio (0–1) and frequency (Hz) while a timer drives the pin. */
  readonly duty?: number;
  readonly freqHz?: number;
  /** Nothing is wired to the pin: values are the MCU's ideal ones. */
  readonly unwired?: true;
  /** An input with no pull-up and nothing driving it: its reading is undefined on real hardware. */
  readonly floating?: true;
}

/** The part of a {@link Frame} carried by binary snapshots. */
export type HotFrame = Pick<
  Frame,
  'seq' | 'simTime' | 'rtf' | 'running' | 'parts' | 'pins' | 'robot' | 'challenge'
>;

/** What the UI renders: the latest snapshot merged with the state carried by events. */
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
  /** Arena challenge progress / outcome (FR-ARN-11), when the scenario has one. */
  readonly challenge?: ChallengeView;
}

export interface ChallengeNodeView {
  readonly type: string;
  readonly status: 'pending' | 'met' | 'failed';
  readonly final: boolean;
  readonly params: Readonly<Record<string, number | string>>;
  readonly children?: readonly ChallengeNodeView[];
}

export interface ChallengeView {
  readonly id: string;
  readonly status: 'running' | 'success' | 'failure';
  readonly decidedAt: number | null;
  readonly tree: ChallengeNodeView;
  readonly score: {
    readonly total: number;
    readonly max: number;
    readonly lines: readonly { readonly type: string; readonly weight: number; readonly points: number }[];
  } | null;
  /** Checkpoints passed on the current lap, and the zone the robot must reach next. */
  readonly visitedZones: readonly string[];
  readonly nextZone: string | null;
}

export type Fault = Frame['faults'][number];
export type Damage = Frame['damaged'];

export type WorkerToMain =
  | {
      readonly type: 'loaded';
      readonly scene: SceneInfo;
      readonly seed: number;
      readonly engineVersion: string;
      /** Number of input-log entries being replayed (0 for a live run). */
      readonly replaying: number;
    }
  /** Shared snapshot buffer of the current run; replaced when snapshots outgrow it. */
  | { readonly type: 'channel'; readonly buffer: SharedArrayBuffer }
  /** One snapshot as a transferred buffer (no cross-origin isolation). */
  | { readonly type: 'snapshot'; readonly buffer: ArrayBuffer }
  /** Snapshot dictionary additions; always posted before the snapshot that needs them. */
  | { readonly type: 'dict'; readonly delta: DictDelta }
  /** UART output since the last frame, as raw bytes so the monitor can decode at its own baud. */
  | { readonly type: 'serial'; readonly chunks: readonly SerialChunk[] }
  /** All findings latched so far (sorted), sent when one was added. */
  | { readonly type: 'findings'; readonly findings: readonly FindingView[] }
  | { readonly type: 'faults'; readonly faults: readonly Fault[] }
  | { readonly type: 'damaged'; readonly damaged: Damage }
  | { readonly type: 'inputLog'; readonly log: InputLog }
  | { readonly type: 'error'; readonly message: string };
