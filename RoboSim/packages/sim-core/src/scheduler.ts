import { McuBus, type McuPinBinding } from './bus.js';
import type {
  BodySnapshot,
  ComponentIO,
  ComponentModel,
  Fault,
  McuCore,
  MnaSolution,
  ModelContext,
  NetId,
  PinEdge,
  PinElectrical,
  PwmOutput,
  WorldModel,
} from './contracts.js';
import { AveragedSolution, MnaCircuit, ZERO_SOLUTION } from './mna/circuit.js';
import { Prng } from './prng.js';

/** MCU ↔ component bus exchange period (Technical Design §5.3). */
export const SLICE_S = 0.001;
export const SLICES_PER_SECOND = 1000;
/** Physics step: every second slice. */
export const PHYS_DT_S = 0.002;
const SLICES_PER_PHYS_STEP = 2;

export interface ComponentInstance {
  readonly id: string;
  readonly model: ComponentModel;
  /** Component pin name → net. */
  readonly pins: Readonly<Record<string, NetId>>;
  readonly props: unknown;
}

export interface McuAttachment {
  readonly core: McuCore;
  readonly pins: readonly McuPinBinding[];
  readonly electrical: PinElectrical;
}

export interface SimulationOptions {
  readonly netCount: number;
  /** Order is significant: components step in this order every slice. */
  readonly components: readonly ComponentInstance[];
  readonly mcu?: McuAttachment;
  readonly world?: WorldModel;
  readonly seed: number;
}

export interface SliceContext {
  readonly slice: number;
  readonly simTime: number;
  readonly solution: MnaSolution;
  readonly components: readonly ComponentInstance[];
  readonly bus: McuBus | null;
}

/** Hook for per-slice consumers: runtime safety rules (§5.6), success conditions (§5.7), tracing. */
export interface SliceObserver {
  afterSlice(ctx: SliceContext): void;
}

export interface ComponentSnapshot {
  readonly id: string;
  readonly type: string;
  readonly state: unknown;
}

export interface SimulationSnapshot {
  readonly slice: number;
  readonly simTime: number;
  readonly cycle: number | null;
  readonly components: readonly ComponentSnapshot[];
  readonly bodies: readonly BodySnapshot[];
  readonly faults: readonly Fault[];
}

/** Live view handed to component models: reads the current slice and solution on every access. */
class SimulationIO implements ComponentIO {
  constructor(
    private readonly sim: Simulation,
    readonly world: WorldModel | null,
  ) {}

  get simTime(): number {
    return this.sim.simTime;
  }

  get solution(): MnaSolution {
    return this.sim.currentSolution;
  }

  edges(net: NetId): readonly PinEdge[] {
    return this.sim.edgesOn(net);
  }

  pwm(net: NetId): PwmOutput | null {
    return this.sim.pwmOn(net);
  }

  invalidate(): void {
    this.sim.invalidate();
  }
}

/**
 * Fixed-slice simulation loop (Technical Design §5.3). Time is an integer slice counter, so results
 * never depend on wall-clock or float drift; pacing against real time lives in {@link Pacer}.
 */
export class Simulation {
  private sliceCount = 0;
  private dirty = true;
  private solution: MnaSolution = ZERO_SOLUTION;
  private readonly circuit: MnaCircuit;
  private readonly bus: McuBus | null;
  private readonly world: WorldModel | null;
  private readonly components: readonly ComponentInstance[];
  private readonly observers: SliceObserver[] = [];
  private readonly io: ComponentIO;
  /** MCU output edges of the current slice per pin, and the pins wired to each net. */
  private readonly sliceEdges = new Map<string, PinEdge[]>();
  private readonly pinsByNet = new Map<NetId, string[]>();
  private readonly byId = new Map<string, ComponentInstance>();

  constructor(options: SimulationOptions) {
    this.circuit = new MnaCircuit(options.netCount);
    this.components = options.components;
    this.world = options.world ?? null;
    this.bus = options.mcu ? new McuBus(options.mcu.core, options.mcu.pins, options.mcu.electrical) : null;

    const ids = new Set<string>();
    const root = Prng.fromSeed(options.seed);
    for (const c of this.components) {
      if (ids.has(c.id)) throw new Error(`Duplicate component id '${c.id}'`);
      ids.add(c.id);
      const rng = root.fork(c.id);
      const ctx: ModelContext = {
        id: c.id,
        net: (pin) => {
          const net = c.pins[pin];
          if (net === undefined) throw new Error(`Component '${c.id}' has no pin '${pin}'`);
          return net;
        },
        random: () => rng.next(),
      };
      c.model.init(ctx, c.props);
    }

    this.io = new SimulationIO(this, this.world);
    for (const c of this.components) this.byId.set(c.id, c);
    if (options.mcu) {
      const { core } = options.mcu;
      for (const { pin, net } of options.mcu.pins)
        this.pinsByNet.set(net, [...(this.pinsByNet.get(net) ?? []), pin]);
      core.onPinEdge((pin, level, cycle) => {
        const list = this.sliceEdges.get(pin) ?? [];
        list.push({ level, time: cycle / core.clockHz });
        this.sliceEdges.set(pin, list);
      });
    }
  }

  /** Delivers a user interaction declared in the component's manifest (button press, pot position…). */
  input(componentId: string, name: string, value: number | boolean): void {
    const c = this.byId.get(componentId);
    if (!c) throw new Error(`Unknown component '${componentId}'`);
    if (!c.model.input) throw new Error(`Component '${componentId}' (${c.model.type}) accepts no input`);
    c.model.input(name, value);
    this.dirty = true;
  }

  /** PWM driven onto `net` by an MCU pin, or null. */
  pwmOn(net: NetId): PwmOutput | null {
    return this.bus?.pwmOnNet(net) ?? null;
  }

  /** MCU output edges on pins wired to `net` during the current slice, in time order. */
  edgesOn(net: NetId): readonly PinEdge[] {
    const pins = this.pinsByNet.get(net);
    if (!pins) return [];
    if (pins.length === 1) return this.sliceEdges.get(pins[0] ?? '') ?? [];
    return pins.flatMap((p) => this.sliceEdges.get(p) ?? []).sort((a, b) => a.time - b.time);
  }

  /** Marks the circuit for re-solving (component stamp or user input changed). */
  invalidate(): void {
    this.dirty = true;
  }

  get slice(): number {
    return this.sliceCount;
  }

  get simTime(): number {
    return this.sliceCount / SLICES_PER_SECOND;
  }

  get currentSolution(): MnaSolution {
    return this.solution;
  }

  addObserver(o: SliceObserver): () => void {
    this.observers.push(o);
    return () => {
      const i = this.observers.indexOf(o);
      if (i >= 0) this.observers.splice(i, 1);
    };
  }

  /** CPU cycle at the start of `slice`. */
  cycleAt(slice: number): number {
    const hz = this.bus?.core.clockHz ?? 0;
    return Math.round((slice * hz) / SLICES_PER_SECOND);
  }

  /** Advances exactly one 1 ms slice. */
  step(): void {
    const next = this.sliceCount + 1;
    if (this.bus) {
      this.sliceEdges.clear();
      this.bus.core.run(this.cycleAt(next));
      if (this.bus.readOutputs()) this.dirty = true;
    }
    this.solveIfDirty();

    for (const c of this.components) c.model.step(SLICE_S, this.io);
    if (this.world && next % SLICES_PER_PHYS_STEP === 0) this.world.step(PHYS_DT_S);

    // Components that changed their stamp (sensors, user input) are visible to the MCU in the same slice.
    this.solveIfDirty();
    this.bus?.applyInputs(this.solution, this.bus.core.cycle);

    this.sliceCount = next;
    const ctx: SliceContext = {
      slice: this.sliceCount,
      simTime: this.simTime,
      solution: this.solution,
      components: this.components,
      bus: this.bus,
    };
    for (const o of this.observers) o.afterSlice(ctx);
  }

  /** Runs `count` slices; used headless (grader, tests) and by the pacer. */
  run(count: number): void {
    for (let i = 0; i < count; i++) this.step();
  }

  snapshot(): SimulationSnapshot {
    return {
      slice: this.sliceCount,
      simTime: this.simTime,
      cycle: this.bus ? this.bus.core.cycle : null,
      components: this.components.map((c) => ({ id: c.id, type: c.model.type, state: c.model.snapshot() })),
      bodies: this.world ? this.world.bodies() : [],
      faults: this.components.flatMap((c) => c.model.faults()),
    };
  }

  private solveIfDirty(): void {
    if (!this.dirty) return;
    this.dirty = false;
    const pwm = this.bus?.pwmPins() ?? [];
    const base = this.solveWith(new Set());
    this.solution =
      pwm.length === 0
        ? base
        : new AveragedSolution(
            base,
            pwm.map(({ pin, duty }) => ({ solution: this.solveWith(new Set([pin])), duty })),
          );
  }

  private solveWith(pwmHigh: ReadonlySet<string>): MnaSolution {
    this.circuit.clear();
    this.bus?.stamp(this.circuit, pwmHigh);
    for (const c of this.components) c.model.stamp(this.circuit);
    return this.circuit.solve();
  }
}
