export type * from './contracts.js';
export { isDamageable, isWheelActuator } from './contracts.js';
export * as dmath from './dmath/index.js';
export { Prng } from './prng.js';
export { buildNetlist, NetlistError, type Netlist, type NetlistInput, type Terminal } from './netlist.js';
export {
  MnaCircuit,
  GMIN,
  DIODE_OFF_CONDUCTANCE,
  MAX_DIODE_ITERATIONS,
  ZERO_SOLUTION,
} from './mna/circuit.js';
export { SingularMatrixError } from './mna/lu.js';
export { McuBus, type McuPinBinding } from './bus.js';
export {
  Simulation,
  SLICE_S,
  SLICES_PER_SECOND,
  PHYS_DT_S,
  type ComponentInstance,
  type ComponentSnapshot,
  type McuAttachment,
  type SimulationOptions,
  type SimulationSnapshot,
  type SliceContext,
  type SliceObserver,
} from './scheduler.js';
export { Pacer, type PacerOptions, type TickResult } from './pacer.js';
export { resolveProps, validateManifest, type PropValue } from './manifest.js';
export { irReflectance, irSpotRadiusMm, sonarRange, toWorld, SPEED_OF_SOUND_M_S } from './sensors.js';
export { PlanckWorld } from './world/planck-world.js';
export { floorAt, rasterizeFloor, type FloorRaster } from './world/floor.js';
export {
  DEFAULT_PHYSICS,
  type ArenaSpec,
  type ArenaZone,
  type FloorSpec,
  type FloorStroke,
  type MountSpec,
  type ObstacleSpec,
  type PhysicsParams,
  type Pose2,
  type RobotGeometry,
  type RobotSpec,
} from './world/types.js';
export {
  assembleCircuit,
  instantiateCircuit,
  type AssembledCircuit,
  type AssembledPart,
  type CircuitPartSpec,
  type CircuitSpec,
  type InstantiateOptions,
} from './circuit.js';
export { SafetyMonitor } from './safety/monitor.js';
export { analyzeCircuit, sortFindings } from './safety/static-analyzer.js';
export {
  finding,
  type BoardInfo,
  type Condition,
  type Finding,
  type RuntimeContext,
  type RuntimeRule,
  type SafetyRule,
  type Severity,
  type StaticContext,
  type StaticProbe,
  type StaticRule,
} from './safety/types.js';
export {
  isSafePattern,
  validateChallenge,
  type ChallengeSpec,
  type ConditionSpec,
  type ConstraintSpec,
  type GoalSpec,
  type ScoreTerm,
} from './challenge/spec.js';
export {
  ConditionTree,
  computeScore,
  type ChallengeMetrics,
  type NodeStatus,
  type NodeView,
  type Score,
  type ScoreLine,
  type TickState,
} from './challenge/evaluate.js';
export { ChallengeTracker, type ChallengeResult, type ChallengeTrackerOptions } from './challenge/tracker.js';
