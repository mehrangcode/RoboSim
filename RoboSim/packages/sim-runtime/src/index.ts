export { SimHost, type SimHostOptions } from './host.js';
export {
  SimClient,
  SERIAL_TAIL_CHARS,
  METER_WINDOW_SLICES,
  type OhmsAnswer,
  type ProbeReading,
} from './client.js';
export {
  MeasureHub,
  MeasureRecorder,
  ScopeRecorder,
  resolvePoint,
  type ChannelRecorder,
  type ResolvedPoint,
} from './measure.js';
export {
  SCOPE_BUFFER_SLICES,
  SCOPE_FINE_MAX_POINTS,
  SCOPE_FINE_SECONDS,
  ScopeBuffer,
  type FineTrace,
  type ScopePwm,
} from './scope.js';
export { HeadlessRun, InputLogError, InputLogger, applyInput, type LiveInput } from './input-log.js';
export {
  EngineVersionMismatchError,
  MAX_SERIAL_CHARS,
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
export { FIRMWARE_HEX } from './firmware/generated.js';
export { FIRMWARE_SKETCHES, type FirmwareId } from './firmware/sketches.js';
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
  resolveSource,
  buildScenario,
  builtinSource,
  loadProject,
  type Scenario,
} from './scenarios.js';
export { buildCircuit, type Circuit, type CircuitSpec } from './circuit.js';
export {
  BENCH_SCENARIOS,
  MAX_METER_PROBES,
  MAX_SCOPE_CHANNELS,
  MAX_FINE_PER_SLICE,
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
  type MeasureChannel,
  type MeasureProbe,
  type OhmsRefusal,
  type PointRef,
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
