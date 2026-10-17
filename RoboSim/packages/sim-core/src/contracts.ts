/**
 * Engine contracts shared by boards, components, and the scheduler (Technical Design §5.2).
 * Everything here must stay structured-clone-able and free of DOM / Node APIs.
 */

export type Level = 0 | 1;

/** Board-scoped pin identifier, e.g. 'D13', 'A0'. */
export type PinId = string;

/** Net index produced by the netlist builder; 0 is ground. */
export type NetId = number;

export type Unsubscribe = () => void;

export interface FirmwareImage {
  readonly format: 'ihex' | 'uf2' | 'elf';
  readonly bytes: Uint8Array;
  readonly sha256: string;
}

export type PinMode = 'input' | 'input_pullup' | 'output';

export interface PwmOutput {
  /** 0..1, derived from timer registers, never from sampled edges. */
  readonly dutyRatio: number;
  readonly freqHz: number;
}

export interface PinOutput {
  readonly mode: PinMode;
  readonly level: Level;
  readonly pwm?: PwmOutput;
}

/** What the outside world presents to an MCU input pin: thresholded level plus raw voltage for the ADC. */
export interface PinDrive {
  readonly level: Level;
  readonly volts: number;
}

export interface UartPort {
  write(bytes: Uint8Array): void;
  /** Current baud rate from the USART registers (0 while the transmitter is off). */
  baud(): number;
  onData(cb: (bytes: Uint8Array) => void): Unsubscribe;
}

export interface McuCore {
  readonly clockHz: number;
  /** Monotonically increasing CPU cycle count. */
  readonly cycle: number;
  /** Executes until `untilCycle`, applying scheduled inputs at their exact cycles. */
  run(untilCycle: number): void;
  scheduleInput(pin: PinId, drive: PinDrive, atCycle: number): void;
  pinOutputs(): ReadonlyMap<PinId, PinOutput>;
  /** Cycle-stamped edges for software PWM, servo pulses, ultrasonic TRIG. */
  onPinEdge(cb: (pin: PinId, level: Level, cycle: number) => void): Unsubscribe;
  /**
   * Pin mode changes (`pinMode`, enabling a pull-up) at their cycle. The scheduler re-solves the
   * circuit there, so an input reads its real level at once instead of at the end of the slice.
   */
  onPinModeChange?(cb: (pin: PinId, mode: PinMode, cycle: number) => void): Unsubscribe;
  uart(index: number): UartPort;
  reset(): void;
}

/** Electrical characteristics of a board's GPIO used by the component bus. */
export interface PinElectrical {
  /** Supply voltage of the pin driver (V). */
  readonly vcc: number;
  /** Output driver resistance (Ω); pin current falls out of the MNA solution. */
  readonly outputResistance: number;
  /** Internal pull-up resistance when `input_pullup` (Ω). */
  readonly pullupResistance: number;
  /** Input low / high thresholds (V); between them the previous level is kept (hysteresis). */
  readonly vil: number;
  readonly vih: number;
}

export type PinCapability =
  'digital' | 'pwm' | 'adc' | 'uart' | 'i2c' | 'spi' | 'interrupt' | 'power' | 'ground';

export interface BoardPinDef {
  readonly id: PinId;
  /** Silkscreen label, e.g. '~9', 'A0', '5V'. */
  readonly label: string;
  readonly capabilities: readonly PinCapability[];
  /** Absolute-maximum voltage on the pin (V). */
  readonly absMaxV: number;
  /** Absolute-maximum continuous pin current (mA); exceeding it feeds the damage model. */
  readonly maxCurrentMa: number;
}

export interface PowerRailDef {
  readonly id: string; // '5V', '3V3', 'VIN'
  readonly volts: number;
  /** Maximum current the rail can supply (mA). */
  readonly maxCurrentMa: number;
}

export interface PowerTreeDef {
  readonly rails: readonly PowerRailDef[];
  /** VIN regulator: valid input window and dropout (V). */
  readonly regulator: { readonly minInV: number; readonly maxInV: number; readonly dropoutV: number };
  /** Total current through all GND/VCC pins of the MCU package (mA). */
  readonly mcuPackageMaxCurrentMa: number;
}

export interface UploadProtocolDef {
  readonly protocol: 'stk500v1' | 'stk500v2' | 'uf2';
  readonly baud: number;
  /** MCU signature bytes checked before flashing. */
  readonly signature: readonly number[];
  readonly flashBytes: number;
}

export interface Board {
  readonly id: string; // 'avr-uno'
  readonly fqbn: string; // 'arduino:avr:uno'
  readonly clockHz: number;
  readonly pins: readonly BoardPinDef[];
  readonly electrical: PinElectrical;
  readonly power: PowerTreeDef;
  readonly upload: UploadProtocolDef;
  createCore(fw: FirmwareImage): McuCore;
}

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export interface RayHit {
  readonly point: Vec2;
  readonly distance: number;
  readonly bodyId: string;
}

export interface BodySnapshot {
  readonly id: string;
  readonly position: Vec2;
  readonly angle: number;
}

/** Where a mounted component sits in the arena (world units: metres, radians). */
export interface ComponentPose {
  readonly position: Vec2;
  /** Heading of the component's +x axis (rad, counter-clockwise). */
  readonly angle: number;
  /** Height of the component's sensing face above the floor (mm). */
  readonly heightMm: number;
}

export interface WorldModel {
  /** Fixed-step physics. */
  step(dt: number): void;
  /** Nearest obstacle hit along a unit direction, within maxDist metres. */
  raycast(origin: Vec2, dir: Vec2, maxDist: number): RayHit | null;
  /** Floor luminance 0 (black) .. 1 (white) averaged over a disc (metres). */
  sampleFloor(p: Vec2, radius: number): number;
  bodies(): readonly BodySnapshot[];
  /** Pose of a component mounted on a robot, or null when it is not mounted (e.g. on the bench). */
  componentPose(componentId: string): ComponentPose | null;
  /**
   * Called once by the scheduler after component models are initialised, so the world can couple
   * drivetrain actuators (motors) to wheels by component id.
   */
  bind?(lookup: (componentId: string) => ComponentModel | undefined): void;
}

/**
 * A component that drives a wheel (gear motor). The world reads the shaft torque each physics step,
 * applies F = τ / r at the wheel, and feeds the resulting wheel speed back (no-slip coupling), which
 * sets the motor's back-EMF for the next electrical solve (Technical Design §5.4–5.5).
 */
export interface WheelActuator {
  /** Output-shaft torque delivered now (N·m); positive drives the robot forward. */
  shaftTorque(): number;
  /** Output-shaft speed imposed by the drivetrain (rad/s). */
  setShaftSpeed(omega: number): void;
  /** Rotor + gearbox inertia reflected to the output shaft (kg·m²). */
  readonly shaftInertia: number;
}

export function isWheelActuator(model: unknown): model is WheelActuator {
  const m = model as Partial<WheelActuator> | null;
  return (
    typeof m?.shaftTorque === 'function' &&
    typeof m.setShaftSpeed === 'function' &&
    typeof m.shaftInertia === 'number'
  );
}

export interface Fault {
  readonly code: string;
  readonly componentId: string;
  readonly params: Readonly<Record<string, string | number>>;
}

/** Handle to a stamped ideal/real voltage source, used to read its current after a solve. */
export type SourceHandle = number & { readonly __brand: 'SourceHandle' };
/** Handle to a stamped piecewise-linear diode. */
export type DiodeHandle = number & { readonly __brand: 'DiodeHandle' };

export interface DiodeParams {
  /** Forward voltage at which the diode turns on (V). */
  readonly vf: number;
  /** Series resistance in the on region (Ω). */
  readonly rs: number;
}

/** Electrical contribution of a component to the circuit (§5.4). */
export interface MnaStamper {
  conductance(a: NetId, b: NetId, siemens: number): void;
  /** Constant current flowing from `from` through the element into `to` (A). */
  currentSource(from: NetId, to: NetId, amps: number): void;
  /** Source of `volts` between `pos` and `neg` with optional series resistance (Ω). */
  voltageSource(
    pos: NetId,
    neg: NetId,
    volts: number,
    seriesResistance?: number,
    options?: VoltageSourceOptions,
  ): SourceHandle;
  /**
   * Ideal averaged DC transformer: V(secPos) − V(secNeg) = ratio·(V(priPos) − V(priNeg)) − offsetV − r·I,
   * drawing ratio × the secondary current from the primary. Models PWM-averaged H-bridges and buck stages.
   */
  transformer(
    primaryPos: NetId,
    primaryNeg: NetId,
    secondaryPos: NetId,
    secondaryNeg: NetId,
    ratio: number,
    options?: { readonly seriesResistance?: number; readonly offsetV?: number },
  ): SourceHandle;
  diode(anode: NetId, cathode: NetId, params: DiodeParams): DiodeHandle;
}

export interface VoltageSourceOptions {
  /**
   * Net the delivered current is drawn from instead of `neg` — a linear regulator draws its output
   * current from its input, so a battery behind it sags realistically.
   */
  readonly supplyFrom?: NetId;
}

/** Read-only view of the latest DC operating point. */
export interface MnaSolution {
  readonly converged: boolean;
  voltage(net: NetId): number;
  /** Current delivered out of the source's + terminal (A). */
  sourceCurrent(h: SourceHandle): number;
  /** Anode → cathode current (A). */
  diodeCurrent(h: DiodeHandle): number;
}

export interface ModelContext {
  readonly id: string;
  /** Net connected to the component's named pin. */
  net(pin: string): NetId;
  /** Deterministic random stream scoped to this component. */
  random(): number;
}

/** Output edge of an MCU pin, stamped with simulated time (s) at CPU-cycle precision. */
export interface PinEdge {
  readonly level: Level;
  readonly time: number;
}

export interface ComponentIO {
  /** Simulated time at the start of this slice (s). */
  readonly simTime: number;
  /** MCU output edges during this slice on pins wired directly to `net` (servo pulses, TRIG), in time order. */
  edges(net: NetId): readonly PinEdge[];
  /**
   * PWM generated by an MCU pin wired directly to `net`, or null. Logic inputs use it to tell a PWM
   * average (duty) from a DC level, which the averaged operating point alone cannot.
   */
  pwm(net: NetId): PwmOutput | null;
  /**
   * Drives MCU input pins wired to `net` to `level` at simulated `time` with CPU-cycle precision,
   * bypassing per-slice thresholding — for timed outputs such as an ultrasonic echo pulse.
   * Times already executed are applied at the next cycle.
   */
  scheduleMcuInput(net: NetId, level: Level, time: number): void;
  /**
   * Publishes a timed logic edge a part drives onto `net` this slice (a 74HC595's QH′ feeding the next
   * shift register). Parts reading `edges(net)` later in the slice see it; logic parts step in the
   * order of their `logicNets`, producers first.
   */
  emitEdge(net: NetId, level: Level, time: number): void;
  readonly solution: MnaSolution;
  readonly world: WorldModel | null;
  /** Tells the scheduler the component's stamp changed and the circuit must be re-solved. */
  invalidate(): void;
}

export interface ComponentModel<Props = unknown, State = unknown> {
  /** Manifest id, e.g. 'driver.l298n'. */
  readonly type: string;
  init(ctx: ModelContext, props: Props): void;
  stamp(s: MnaStamper): void;
  /** Reads the operating point and MCU signals; writes mechanical outputs. */
  step(dt: number, io: ComponentIO): void;
  faults(): readonly Fault[];
  /** Plain data for renderers and the inspector. */
  snapshot(): State;
  /**
   * User interaction declared in the manifest's `inputs` (press, rotate, light level). The scheduler
   * re-solves the circuit afterwards, so models only update state here.
   */
  input?(name: string, value: number | boolean): void;
  /**
   * Logic part (Technical Design §5.4, digital timing): its input and output nets. Logic parts step in
   * topological order of these nets, and `mcuEdge` is subscribed to MCU edges on the inputs.
   */
  logicNets?(): { readonly inputs: readonly NetId[]; readonly outputs: readonly NetId[] };
  /**
   * MCU edge on an input net, delivered synchronously in the middle of an instruction. A part that
   * answers the firmware (keypad, gate read back by the MCU) calls `io.scheduleMcuInput` at `time`.
   */
  mcuEdge?(net: NetId, level: Level, time: number, io: ComponentIO): void;
  /**
   * Combinational re-evaluation after each solve: return true when outputs changed. The scheduler
   * re-solves and asks again (at most 16 passes), so a chain of gates settles within one slice.
   */
  settle?(io: ComponentIO): boolean;
}

export type PropSpec =
  | {
      readonly type: 'number';
      readonly default: number;
      readonly min?: number;
      readonly max?: number;
      readonly unit?: string;
    }
  | { readonly type: 'enum'; readonly default: string; readonly options: readonly string[] }
  | { readonly type: 'boolean'; readonly default: boolean };

export interface InputSpec {
  readonly name: string;
  readonly type: 'boolean' | 'number';
  readonly default: number | boolean;
  readonly min?: number;
  readonly max?: number;
}

export type PinKind = 'power' | 'ground' | 'digital' | 'analog' | 'passive' | 'output';

/** Catalogue entry of a component package (`packages/components/<slug>/manifest.json`, Technical Design §3). */
export interface ComponentManifest {
  /** Stable type id, e.g. 'driver.l298n'. */
  readonly id: string;
  readonly version: string;
  readonly category:
    | 'power'
    | 'semiconductor'
    | 'ic'
    | 'actuator'
    | 'driver'
    | 'sensor'
    | 'display'
    | 'comms'
    | 'passive'
    | 'mechanical';
  readonly tier: 'basic' | 'pro';
  readonly phase: 'P1' | 'P2' | 'P3' | 'P4';
  /** i18n key in the `components` namespace. */
  readonly nameKey: string;
  readonly pins: readonly { readonly name: string; readonly kind: PinKind }[];
  readonly props: Readonly<Record<string, PropSpec>>;
  readonly inputs: readonly InputSpec[];
  readonly massG: number;
  /**
   * Mounting footprint (FR-ARN-09) of a part that can sit on a robot chassis: a box in the part's own
   * frame (+x = the way it faces), height above its mount point. Parts without one stay on the bench.
   */
  readonly mounting?: MountingSpec;
  /**
   * Electrical / mechanical limits used by faults and safety rules (units in the key). Generic rules read:
   * `peakCurrentMa` (worst-case draw, e.g. stall), `maxVoltageV` (abs. max across the polarity pins).
   */
  readonly limits: Readonly<Record<string, number>>;
  /** Behaviour classes generic safety rules key on (FR-SAF-05). */
  readonly traits?: readonly ComponentTrait[];
  /** [positive pin, negative pin] of a polarised supply input; reversed wiring is an Error. */
  readonly polarity?: readonly [string, string];
  /** Pins that act as a supply output (battery +, regulator out), optionally only when a boolean prop is true. */
  readonly supplyPins?: readonly SupplyPinSpec[];
  /**
   * Pins that are one conductor inside the part (two common pins of a display, a module's shared
   * ground plane). Merged by the netlist like a wire; unlike `internalConnections` the part is still
   * simulated.
   */
  readonly bondedPins?: readonly (readonly [string, string])[];
  /**
   * Pin pairs a logic signal passes through unchanged in timing (a series resistor). MCU edges and PWM
   * on one side are visible to parts on the other (`io.edges`, `io.pwm`), so a buzzer or servo behind a
   * current-limiting resistor still hears its pulses.
   */
  readonly signalPassthrough?: readonly (readonly [string, string])[];
  /**
   * Pin groups with no electrical path between them inside the part (relay coil vs contacts). Safety
   * rules that trace a circuit do not cross between groups; without it all pins are one group.
   */
  readonly isolationGroups?: readonly (readonly string[])[];
  /** Per-pin absolute maximum voltage to the part's negative polarity pin (V). */
  readonly pinMaxVolts?: Readonly<Record<string, number>>;
}

export interface MountingSpec {
  readonly lengthMm: number;
  readonly widthMm: number;
  readonly heightMm: number;
}

export type ComponentTrait = 'inductive' | 'led' | 'source';

export interface SupplyPinSpec {
  readonly pin: string;
  readonly maxCurrentMa: number;
  /** Boolean prop that must be true for the pin to supply (e.g. a regulator jumper). */
  readonly enabledByProp?: string;
}

/**
 * A component the damage model can break (FR-SIM-10): once damaged it stops working (open circuit,
 * stuck output…) and shows it in its snapshot until the simulation is reset.
 */
export interface Damageable {
  readonly damaged: boolean;
  damage(reason: string): void;
}

export function isDamageable(model: unknown): model is Damageable {
  const m = model as Partial<Damageable> | null;
  return typeof m?.damage === 'function' && typeof m.damaged === 'boolean';
}

export interface ComponentDefinition<Props = unknown> {
  readonly manifest: ComponentManifest;
  create(): ComponentModel<Props>;
  /**
   * Pin pairs that are the same conductor inside the part (breadboard strips). The netlist builder
   * merges them like wires, so they cost nothing in the MNA solve.
   */
  internalConnections?(): readonly (readonly [string, string])[];
}
