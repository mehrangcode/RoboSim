import { McuBus, type McuPinBinding } from './bus.js';
import { isDamageable } from './contracts.js';
import type {
  BodySnapshot,
  ComponentIO,
  ComponentModel,
  Fault,
  Level,
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
  /** Manifest `signalPassthrough` pin pairs (series resistors). */
  readonly signalPassthrough?: readonly (readonly [string, string])[];
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

  scheduleMcuInput(net: NetId, level: Level, time: number): void {
    this.sim.scheduleMcuInput(net, level, time);
  }

  emitEdge(net: NetId, level: Level, time: number): void {
    this.sim.emitEdge(net, level, time);
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
  private poweredOn = false;
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
  /** MCU pins whose signal reaches a net directly or through series resistors (`signalPassthrough`). */
  private readonly signalPinsByNet = new Map<NetId, string[]>();
  /** Passthrough group of a net (absent: the net is its own group). */
  private readonly signalGroup = new Map<NetId, NetId>();
  /** Edges parts published this slice (`io.emitEdge`), by passthrough group. */
  private readonly emittedEdges = new Map<NetId, PinEdge[]>();
  /** Parts subscribed to MCU edges per MCU pin, with the net they watch. */
  private readonly edgeWatchers = new Map<string, { model: ComponentModel; net: NetId }[]>();
  /** Step order: logic parts sorted producers-first in the slots they occupy; others unchanged. */
  private readonly order: readonly ComponentInstance[];
  private readonly settlers: readonly ComponentModel[];
  /** The last slice's combinational logic did not settle (a ring oscillator, a latch fighting itself). */
  private unsettledSlice = false;
  /** Simulated time each pin last became an output, even for microseconds (a keypad's scanned columns). */
  private readonly lastDriven = new Map<string, number>();
  private readonly byId = new Map<string, ComponentInstance>();
  private readonly mcuElectrical: PinElectrical | null;

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

    for (const c of this.components) this.byId.set(c.id, c);
    this.order = logicOrder(this.components);
    this.settlers = this.components.filter((c) => c.model.settle).map((c) => c.model);
    this.world?.bind?.((id) => this.byId.get(id)?.model);
    this.io = new SimulationIO(this, this.world);
    this.mcuElectrical = options.mcu?.electrical ?? null;
    if (options.mcu) {
      const { core } = options.mcu;
      for (const { pin, net } of options.mcu.pins)
        this.pinsByNet.set(net, [...(this.pinsByNet.get(net) ?? []), pin]);
      this.linkSignalNets();
      core.onPinModeChange?.((pin, mode) => {
        if (mode === 'output') this.lastDriven.set(pin, this.simTime);
        this.settleInputs();
      });
      for (const c of this.components) {
        for (const net of c.model.logicNets?.().inputs ?? [])
          for (const pin of this.signalPinsByNet.get(net) ?? [])
            this.edgeWatchers.set(pin, [...(this.edgeWatchers.get(pin) ?? []), { model: c.model, net }]);
      }
      core.onPinEdge((pin, level, cycle) => {
        const list = this.sliceEdges.get(pin) ?? [];
        list.push({ level, time: cycle / core.clockHz });
        for (const w of this.edgeWatchers.get(pin) ?? [])
          w.model.mcuEdge?.(w.net, level, cycle / core.clockHz, this.io);
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

  /** Cycle-precise MCU input on every pin wired to `net` (see ComponentIO.scheduleMcuInput). */
  scheduleMcuInput(net: NetId, level: Level, time: number): void {
    if (!this.bus || !this.mcuElectrical) return;
    const core = this.bus.core;
    const cycle = Math.max(core.cycle, Math.round(time * core.clockHz));
    const volts = level === 1 ? this.mcuElectrical.vcc : 0;
    const pins = this.pinsByNet.get(net) ?? [];
    if (pins.length === 0) return;
    // A pin the firmware is driving right now is not an input: a part never overrides it.
    const outputs = core.pinOutputs();
    for (const pin of pins)
      if (outputs.get(pin)?.mode !== 'output') core.scheduleInput(pin, { level, volts }, cycle);
  }

  /** PWM driven onto `net` by an MCU pin (directly or through a series resistor), or null. */
  pwmOn(net: NetId): PwmOutput | null {
    if (!this.bus) return null;
    for (const pin of this.signalPinsByNet.get(net) ?? []) {
      const out = this.bus.outputOf(pin);
      if (out?.mode === 'output' && out.pwm) return out.pwm;
    }
    return null;
  }

  /**
   * Edges reaching `net` this slice, in time order: MCU output edges (directly or through series
   * resistors) and edges parts published with `io.emitEdge`.
   */
  edgesOn(net: NetId): readonly PinEdge[] {
    const pins = this.signalPinsByNet.get(net) ?? [];
    const emitted = this.emittedEdges.get(this.signalGroup.get(net) ?? net);
    if (!emitted && pins.length === 1) return this.sliceEdges.get(pins[0] ?? '') ?? [];
    const all = [...pins.flatMap((p) => this.sliceEdges.get(p) ?? []), ...(emitted ?? [])];
    return all.length === 0 ? all : all.sort((a, b) => a.time - b.time);
  }

  /** See ComponentIO.emitEdge. */
  emitEdge(net: NetId, level: Level, time: number): void {
    if (net === 0) return;
    const key = this.signalGroup.get(net) ?? net;
    this.emittedEdges.set(key, [...(this.emittedEdges.get(key) ?? []), { level, time }]);
  }

  /**
   * Simulated time `pin` last switched to output, or undefined if it never did. A pin the firmware
   * drives part of the time is a multiplexed line (keypad column, LED matrix), not a floating input.
   */
  lastDrivenAt(pin: string): number | undefined {
    return this.lastDriven.get(pin);
  }

  /** True when combinational logic did not settle in the last slice (feeds SAF-LOGIC-OSCILLATION). */
  get logicUnsettled(): boolean {
    return this.unsettledSlice;
  }

  /**
   * Groups nets joined by `signalPassthrough` pin pairs (never through ground) and lists the MCU pins
   * of each group under every member net. Without such parts this equals `pinsByNet`.
   */
  private linkSignalNets(): void {
    const parent = new Map<NetId, NetId>();
    const linked = new Set<NetId>();
    const find = (n: NetId): NetId => {
      let r = n;
      while (parent.has(r) && parent.get(r) !== r) r = parent.get(r) as NetId;
      return r;
    };
    for (const c of this.components)
      for (const [a, b] of c.signalPassthrough ?? []) {
        const na = c.pins[a];
        const nb = c.pins[b];
        if (na === undefined || nb === undefined || na === 0 || nb === 0) continue;
        linked.add(na).add(nb);
        const ra = find(na);
        const rb = find(nb);
        if (ra !== rb) parent.set(ra, rb);
      }
    const nets = new Set<NetId>([...this.pinsByNet.keys(), ...linked]);
    const groupPins = new Map<NetId, string[]>();
    for (const [net, pins] of this.pinsByNet) {
      if (net === 0) continue;
      const root = find(net);
      groupPins.set(root, [...(groupPins.get(root) ?? []), ...pins]);
    }
    for (const net of nets) {
      const pins = net === 0 ? this.pinsByNet.get(0) : groupPins.get(find(net));
      if (pins) this.signalPinsByNet.set(net, pins);
      if (net !== 0 && linked.has(net)) this.signalGroup.set(net, find(net));
    }
  }

  /** Marks the circuit for re-solving (component stamp or user input changed). */
  invalidate(): void {
    this.dirty = true;
  }

  /** Component model by instance id. */
  model(id: string): ComponentModel | undefined {
    return this.byId.get(id)?.model;
  }

  /** The MCU ↔ circuit bus (pin currents, bindings, pin damage), or null without an MCU. */
  get mcuBus(): McuBus | null {
    return this.bus;
  }

  /** Breaks an MCU pin (damage model) and re-solves. */
  damagePin(pin: string): void {
    this.bus?.damagePin(pin);
    this.dirty = true;
  }

  /** Breaks a component (damage model) and re-solves; no-op for models that cannot be damaged. */
  damageComponent(id: string, reason: string): void {
    const model = this.byId.get(id)?.model;
    if (isDamageable(model) && !model.damaged) {
      model.damage(reason);
      this.dirty = true;
    }
  }

  /** The attached MCU core, or null for MCU-less circuits. */
  get mcu(): McuCore | null {
    return this.bus?.core ?? null;
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

  /**
   * Re-solves now and drives MCU inputs at the current cycle: at power-on, and when firmware changes a
   * pin mode (a fresh `INPUT_PULLUP` reads HIGH within microseconds on real hardware, not after 1 ms).
   */
  private settleInputs(): void {
    if (!this.bus) return;
    this.bus.readOutputs();
    this.dirty = true;
    this.solveIfDirty();
    this.settleLogic();
    this.bus.applyInputs(this.solution, this.bus.core.cycle);
  }

  /** Advances exactly one 1 ms slice. */
  step(): void {
    const next = this.sliceCount + 1;
    if (this.sliceCount === 0 && !this.poweredOn) {
      this.poweredOn = true;
      this.settleInputs();
    }
    this.emittedEdges.clear();
    if (this.bus) {
      this.sliceEdges.clear();
      this.bus.core.run(this.cycleAt(next));
      if (this.bus.readOutputs()) this.dirty = true;
    }
    this.solveIfDirty();

    for (const c of this.order) c.model.step(SLICE_S, this.io);
    if (this.world && next % SLICES_PER_PHYS_STEP === 0) this.world.step(PHYS_DT_S);

    // Components that changed their stamp (sensors, user input) are visible to the MCU in the same slice.
    this.solveIfDirty();
    this.settleLogic();
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

  /** Re-evaluates combinational parts until their outputs stop changing (bounded; see `settle`). */
  private settleLogic(): void {
    this.unsettledSlice = false;
    if (this.settlers.length === 0) return;
    for (let pass = 0; ; pass++) {
      let changed = false;
      for (const m of this.settlers) if (m.settle?.(this.io)) changed = true;
      if (!changed) return;
      this.dirty = true;
      this.solveIfDirty();
      if (pass + 1 >= MAX_SETTLE_PASSES) {
        this.unsettledSlice = true;
        return;
      }
    }
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

  private solveWith(pwmHigh: ReadonlySet<string>, extra?: (s: MnaCircuit) => void): MnaSolution {
    this.circuit.clear();
    this.bus?.stamp(this.circuit, pwmHigh);
    for (const c of this.components) c.model.stamp(this.circuit);
    extra?.(this.circuit);
    return this.circuit.solve();
  }

  /**
   * DC resistance from `net` to ground in the present state (Ω): injects 1 µA and measures the
   * voltage shift. A net with no path to any rail reads ~1 TΩ (GMIN only). Used by the
   * floating-input rule; does not change the published operating point.
   */
  netResistance(net: NetId): number {
    if (net === 0) return 0;
    const probeA = 1e-6;
    const base = this.solveWith(new Set());
    const probed = this.solveWith(new Set(), (s) => s.currentSource(0, net, probeA));
    this.dirty = true; // the circuit object now holds probe stamps; re-stamp before the next slice
    return Math.abs(probed.voltage(net) - base.voltage(net)) / probeA;
  }
}

const MAX_SETTLE_PASSES = 16;

/**
 * Step order with logic parts sorted so a part producing a net steps before parts reading it (Kahn's
 * algorithm, ties and feedback loops by document order). Non-logic parts keep their positions, so
 * circuits without logic parts step exactly as before.
 */
function logicOrder(components: readonly ComponentInstance[]): readonly ComponentInstance[] {
  const logic = components
    .map((c, index) => ({ c, index, nets: c.model.logicNets?.() }))
    .filter((e) => e.nets !== undefined);
  if (logic.length < 2) return components;
  const producers = new Map<NetId, number[]>();
  logic.forEach((e, i) => {
    for (const n of e.nets?.outputs ?? []) if (n !== 0) producers.set(n, [...(producers.get(n) ?? []), i]);
  });
  const deps = logic.map((e, i) => {
    const d = new Set<number>();
    for (const n of e.nets?.inputs ?? []) for (const p of producers.get(n) ?? []) if (p !== i) d.add(p);
    return d;
  });
  const placed: number[] = [];
  const done = new Set<number>();
  while (placed.length < logic.length) {
    // The first part whose producers are all placed; on a feedback loop, the first unplaced part.
    let next = logic.findIndex((_, i) => !done.has(i) && [...(deps[i] ?? [])].every((d) => done.has(d)));
    if (next < 0) next = logic.findIndex((_, i) => !done.has(i));
    placed.push(next);
    done.add(next);
  }
  const slots = logic.map((e) => e.index);
  const out = [...components];
  placed.forEach((li, k) => {
    const slot = slots[k];
    const entry = logic[li];
    if (slot !== undefined && entry) out[slot] = entry.c;
  });
  return out;
}
