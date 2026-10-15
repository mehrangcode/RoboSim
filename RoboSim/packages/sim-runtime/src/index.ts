export { SimHost, type SimHostOptions } from './host.js';
export { SimClient, SERIAL_TAIL_CHARS } from './client.js';
export { HeadlessRun, InputLogger, applyInput, type LiveInput } from './input-log.js';
export {
  EngineVersionMismatchError,
  MAX_SIM_SECONDS,
  TRACE_INTERVAL_SLICES,
  grade,
  traceDigest,
  type GradeJob,
  type GradeResult,
  type Pose,
  type Trace,
  type TraceSample,
} from './grade.js';
export { ENGINE_PACKAGES, ENGINE_VERSION } from './engine-version.js';
export { SnapshotDecoder, SnapshotEncoder, TAG, type DictDelta, type Path } from './snapshot-codec.js';
export {
  SharedSnapshotReader,
  SharedSnapshotWriter,
  packSnapshot,
  unpackSnapshot,
  type SnapshotData,
} from './snapshot-channel.js';
export {
  ProjectLoadError,
  buildRun,
  buildScenario,
  builtinSource,
  loadProject,
  type Scenario,
} from './scenarios.js';
export { buildCircuit, type Circuit, type CircuitSpec } from './circuit.js';
export {
  BENCH_SCENARIOS,
  SAFETY_SCENARIOS,
  SCENARIOS,
  type BenchScenarioId,
  type FindingView,
  type SafetyScenarioId,
  type ArenaScene,
  type ChallengeNodeView,
  type ChallengeView,
  type Damage,
  type Fault,
  type HotFrame,
  type FirmwarePayload,
  type InputLog,
  type RunSource,
  type InputLogEntry,
  type Frame,
  type MainToWorker,
  type PartInfo,
  type PinView,
  type RobotScene,
  type ScenarioId,
  type SceneInfo,
  type WorkerToMain,
} from './protocol.js';
