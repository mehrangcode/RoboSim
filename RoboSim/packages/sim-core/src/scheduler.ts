import { McuBus, type McuPinBinding } from './bus.js';
import { I2cRouter, SpiRouter, type BusContext } from './buses.js';
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
import {
  AveragedSolution,
  DC_STEP,
  MnaCircuit,
  WeightedSolution,
  ZERO_SOLUTION,
  shapeOf,
} from './mna/circuit.js';
import { Prng } from './prng.js';

/** MCU ↔ component bus exchange period (Technical Design §5.3). */
export const SLICE_S = 0.001;
export const SLICES_PER_SECOND = 1000;
/** Physics step: every second slice. */
export const PHYS_DT_S = 0.002;
const SLICES_PER_PHYS_STEP = 2;

/** Transient integration (Tier B): sub-step bounds and the step of an "instant" re-solve (s). */
export const MIN_STEP_S = 1e-6;
const MAX_STEP_S = SLICE_S;
const INSTANT_STEP_S = 1e-9;
const TIME_EPS_S = 1e-12;

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
  /**
   * Solve DC operating points only: capacitors open, inductors short, no time steps. Static safety
   * analysis uses it, so a large electrolytic does not look like a short at power-on.
   */
  readonly dcOnly?: boolean;
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

  get now(): number {
    return this.sim.now;
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
  /** Operating point now (instantaneous); MCU inputs and combinational logic read it. */
  private solution: MnaSolution = ZERO_SOLUTION;
  /** What components and observers read: `solution`, or in a reactive circuit the slice's time average. */
  private published: MnaSolution = ZERO_SOLUTION;
  private readonly dcOnly: boolean;
  /** Next sub-step length (s), from the local truncation error of the last one. */
  private hNext = MAX_STEP_S;
  /** True while shrinking steps towards a pending comparator switch (no step growth). */
  private bisecting = false;
  /** Operating point at the present time with the present stamp: the start of the next step. */
  private startSolution: MnaSolution | null = null;
  /** MCU pins whose signal reaches a capacitor or inductor: stamped at their real level between edges. */
  private edgeDriven = new Set<string>();
  private readonly edgeLevel = new Map<string, Level>();
  private readonly edgesUsed = new Map<string, number>();
  /** Lowest / highest voltage per net in the last slice (inductive spikes between sub-steps). */
  private envMin = new Float64Array(0);
  private envMax = new Float64Array(0);
  private envelopeValid = false;
  /** Time of the operating point being evaluated (see ComponentIO.now). */
  private nowS = 0;
  /** Work counters for performance tests: accepted / rejected integration steps and linear solves. */
  readonly stats = { steps: 0, rejected: 0, solves: 0 };
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
    this.dcOnly = options.dcOnly ?? false;
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
      core.onPinModeChange?.((pin, mode, cycle, level) => {
        if (mode === 'output') this.lastDriven.set(pin, this.simTime);
        this.settleInputs();
        for (const w of this.edgeWatchers.get(pin) ?? [])
          w.model.mcuMode?.(w.net, mode, level, cycle / core.clockHz, this.io);
      });
      for (const c of this.components) {
        for (const net of c.model.logicNets?.().inputs ?? [])
          for (const pin of this.signalPinsByNet.get(net) ?? [])
            this.edgeWatchers.set(pin, [...(this.edgeWatchers.get(pin) ?? []), { model: c.model, net }]);
      }
      this.attachBuses(core, options.mcu.electrical);
      core.onPinEdge((pin, level, cycle) => {
        const list = this.sliceEdges.get(pin) ?? [];
        list.push({ level, time: cycle / core.clockHz });
        for (const w of this.edgeWatchers.get(pin) ?? [])
          w.model.mcuEdge?.(w.net, level, cycle / core.clockHz, this.io);
        this.sliceEdges.set(pin, list);
      });
    }
  }

  /** Connects the MCU's I²C and SPI peripherals to the targets in the circuit (Tier C). */
  private attachBuses(core: McuCore, electrical: PinElectrical): void {
    const pins = core.busPins;
    if (!pins) return;
    const i2c = this.components.flatMap((c) => c.model.i2c?.() ?? []);
    const spi = this.components.flatMap((c) => c.model.spi?.() ?? []);
    if (i2c.length === 0 && spi.length === 0) return;
    const ctx: BusContext = {
      pins,
      vil: electrical.vil,
      vih: electrical.vih,
      reaches: (net, pin) => net !== 0 && (this.signalPinsByNet.get(net)?.includes(pin) ?? false),
      volts: (net) => this.published.voltage(net),
      drivenLevel: (net) => {
        const outputs = core.pinOutputs();
        for (const pin of this.signalPinsByNet.get(net) ?? []) {
          const out = outputs.get(pin);
          if (out?.mode === 'output') return out.level;
        }
        return null;
      },
    };
    if (i2c.length > 0) core.attachI2c?.(new I2cRouter(i2c, ctx));
    if (spi.length > 0) core.attachSpi?.(new SpiRouter(spi, ctx));
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

  /** See ComponentIO.now. */
  get now(): number {
    return this.nowS;
  }

  /** The operating point components read (the slice average in a reactive circuit). */
  get currentSolution(): MnaSolution {
    return this.published;
  }

  /** True when the circuit has capacitors or inductors and is integrated in time steps. */
  get transient(): boolean {
    return !this.dcOnly && this.circuit.reactiveCount > 0;
  }

  /**
   * Lowest and highest voltage of `net` during the last slice. Reactive circuits track every sub-step,
   * so an inductive kickback of a few microseconds shows up here although the slice average hides it.
   */
  netEnvelope(net: NetId): { readonly min: number; readonly max: number } {
    if (this.envelopeValid && net > 0 && net < this.envMin.length)
      return { min: this.envMin[net] ?? 0, max: this.envMax[net] ?? 0 };
    const v = this.published.voltage(net);
    return { min: v, max: v };
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
    this.nowS = this.bus.core.cycle / this.bus.core.clockHz;
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
      if (this.bus) this.settleInputs();
      else this.solveIfDirty(); // stamps once, so a reactive circuit integrates from the first slice
      if (this.components.some((c) => c.model.powerOn)) {
        for (const c of this.components) c.model.powerOn?.(this.io);
        if (this.bus) this.settleInputs();
        else this.solveIfDirty();
      }
    }
    this.unsettledSlice = false;
    this.emittedEdges.clear();
    this.sliceEdges.clear();
    this.envelopeValid = false;
    if (this.transient) {
      this.integrateSlice(next);
    } else {
      if (this.bus) {
        this.bus.core.run(this.cycleAt(next));
        if (this.bus.readOutputs()) this.dirty = true;
      }
      this.nowS = next / SLICES_PER_SECOND;
      this.solveIfDirty();
    }
    this.nowS = next / SLICES_PER_SECOND;
    const sliceSolution = this.published;

    for (const c of this.order) c.model.step(SLICE_S, this.io);
    if (this.world && next % SLICES_PER_PHYS_STEP === 0) this.world.step(PHYS_DT_S);

    // Components that changed their stamp (sensors, user input) are visible to the MCU in the same slice.
    this.published = this.solution;
    this.solveIfDirty();
    this.settleLogic();
    this.bus?.applyInputs(this.solution, this.bus.core.cycle);
    if (this.transient) this.published = sliceSolution;

    this.sliceCount = next;
    const ctx: SliceContext = {
      slice: this.sliceCount,
      simTime: this.simTime,
      solution: this.published,
      components: this.components,
      bus: this.bus,
    };
    for (const o of this.observers) o.afterSlice(ctx);
  }

  /**
   * Re-evaluates combinational parts until their outputs stop changing (bounded; see `settle`).
   * Returns true when any output changed (the circuit was re-solved).
   */
  private settleLogic(): boolean {
    if (this.settlers.length === 0) return false;
    for (let pass = 0; ; pass++) {
      let changed = false;
      for (const m of this.settlers) if (m.settle?.(this.io)) changed = true;
      if (!changed) return pass > 0;
      this.dirty = true;
      this.solveIfDirty();
      if (pass + 1 >= MAX_SETTLE_PASSES) {
        this.unsettledSlice = true;
        return true;
      }
    }
  }

  /**
   * One slice of a reactive circuit (Technical Design §5.4, Tier B). The MCU runs in chunks of the
   * current step length, so inputs computed after each chunk reach it within one step. Inside a chunk,
   * edges of pins that drive a reactive net are breakpoints, and backward-Euler steps are sized by
   * their local truncation error (1 µs … 1 ms): a quiet circuit costs one step per slice.
   */
  private integrateSlice(next: number): void {
    const t1 = next / SLICES_PER_SECOND;
    let t = this.simTime;
    if (this.dirty) {
      this.dirty = false;
      this.discontinuity();
    }
    this.edgeDriven = this.findEdgeDriven();
    this.edgesUsed.clear();
    this.envMin = new Float64Array(this.circuit.netCount + 1).fill(Infinity);
    this.envMax = new Float64Array(this.circuit.netCount + 1).fill(-Infinity);
    const acc: { average: WeightedSolution | null } = { average: null };
    while (t1 - t > TIME_EPS_S) {
      let chunkEnd = Math.min(t1, t + this.hNext);
      if (t1 - chunkEnd < MIN_STEP_S) chunkEnd = t1;
      if (this.bus) {
        const core = this.bus.core;
        core.run(chunkEnd === t1 ? this.cycleAt(next) : Math.round(chunkEnd * core.clockHz));
        if (this.bus.readOutputs()) this.discontinuity();
      }
      const from = t;
      t = this.integrate(t, chunkEnd, (s, h) => {
        if (!acc.average) {
          const shape = shapeOf(s);
          if (shape) acc.average = new WeightedSolution(shape);
        }
        acc.average?.add(s, h);
      });
      if (t <= from) break; // defensive: no progress
      this.bus?.applyInputs(this.solution, this.bus.core.cycle);
    }
    this.envelopeValid = true;
    this.published = acc.average && !acc.average.empty ? acc.average : this.solution;
  }

  /** Integrates from `ta` to `tb` with the MCU outputs of this chunk; returns the time reached. */
  private integrate(ta: number, tb: number, accumulate: (s: MnaSolution, h: number) => void): number {
    const edges = this.takeEdges(tb);
    this.reconcileEdgeLevels();
    let k = 0;
    let t = ta;
    const applyEdgesUntil = (time: number): void => {
      while (k < edges.length && (edges[k]?.time ?? Infinity) <= time + TIME_EPS_S) {
        const e = edges[k++];
        if (e && this.edgeLevel.get(e.pin) !== e.level) {
          this.edgeLevel.set(e.pin, e.level);
          this.discontinuity();
        }
      }
    };
    while (tb - t > TIME_EPS_S) {
      applyEdgesUntil(t);
      const segEnd = Math.min(tb, edges[k]?.time ?? tb);
      const rest = segEnd - t;
      let h = Math.min(this.hNext, rest);
      // Never leave a sliver shorter than the minimum step: split what is left into two equal steps,
      // or take it whole. A step stretched to at most two minimum steps is accepted as it is, so
      // the loop always ends; every rejection shrinks the step by at least 10 %.
      let forced = false;
      if (rest - h > 0 && rest - h < MIN_STEP_S) {
        if (rest >= 2 * MIN_STEP_S && rest / 2 <= this.hNext) h = rest / 2;
        else {
          h = rest;
          forced = rest <= 2 * MIN_STEP_S;
        }
      }
      const canShrink = !forced && h > MIN_STEP_S;
      this.startSolution ??= this.solveAt(INSTANT_STEP_S);
      const start = this.startSolution;
      const end = this.solveAt(h);
      const ratio = this.circuit.lteRatio(start, end, h);
      const pending = canShrink && this.settlers.some((m) => m.pendingSwitch?.(end) ?? false);
      if (canShrink && (ratio > 1 || pending)) {
        this.hNext = Math.max(
          MIN_STEP_S,
          pending ? h / 2 : h * Math.min(0.9, Math.max(0.2, 0.9 / Math.sqrt(ratio))),
        );
        this.bisecting = pending;
        this.stats.rejected++;
        continue;
      }
      this.circuit.commit(end, h);
      this.stats.steps++;
      t += h;
      this.nowS = t;
      accumulate(end, h);
      this.track(end);
      this.solution = this.published = end;
      this.startSolution = end;
      if (this.settleLogic()) {
        // A comparator or gate switched: restart small and first order, the circuit just jumped.
        this.circuit.restart();
        this.startSolution = this.solution;
        this.track(this.solution);
        this.bisecting = false;
        this.hNext = 4 * MIN_STEP_S;
      } else {
        if (!canShrink) this.bisecting = false;
        if (!this.bisecting)
          this.hNext = Math.min(MAX_STEP_S, h * Math.min(2, 0.9 / Math.sqrt(Math.max(ratio, 1e-4))));
      }
    }
    applyEdgesUntil(tb); // edges at the very end of the chunk shape the next one
    return t;
  }

  /**
   * An edge-driven pin with no edges left to deliver this slice is at its output level. Cores report
   * every edge, but a core that does not (the static analyzer's fixed outputs) must still switch.
   */
  private reconcileEdgeLevels(): void {
    for (const pin of this.edgeDriven) {
      const pending = (this.sliceEdges.get(pin)?.length ?? 0) > (this.edgesUsed.get(pin) ?? 0);
      const out = this.bus?.outputOf(pin);
      if (pending || out?.mode !== 'output' || out.pwm || this.edgeLevel.get(pin) === out.level) continue;
      this.edgeLevel.set(pin, out.level);
      this.discontinuity();
    }
  }

  /** The stamp changed abruptly: re-solve the start of the next step and integrate it first order. */
  private discontinuity(): void {
    this.startSolution = null;
    this.circuit.restart();
  }

  /** MCU edges up to `tb` on edge-driven pins, in time order, each delivered once per slice. */
  private takeEdges(tb: number): { time: number; pin: string; level: Level }[] {
    const out: { time: number; pin: string; level: Level }[] = [];
    for (const pin of this.edgeDriven) {
      const list = this.sliceEdges.get(pin) ?? [];
      let i = this.edgesUsed.get(pin) ?? 0;
      for (; i < list.length; i++) {
        const e = list[i];
        if (!e || e.time > tb + TIME_EPS_S) break;
        out.push({ time: e.time, pin, level: e.level });
      }
      this.edgesUsed.set(pin, i);
    }
    return out.sort((a, b) => a.time - b.time);
  }

  /**
   * MCU pins whose signal group (direct or through series resistors) touches a reactive net or a
   * transistor's base or gate. Switching an inductive load is integrated edge by edge: averaging the
   * on and off phases would make its freewheeling diode chatter around zero current.
   */
  private findEdgeDriven(): Set<string> {
    const pins = new Set<string>();
    if (!this.bus) return pins;
    for (const net of [...this.circuit.reactiveNets(), ...this.circuit.controlNets()])
      for (const pin of this.signalPinsByNet.get(net) ?? []) pins.add(pin);
    for (const pin of this.edgeLevel.keys()) if (!pins.has(pin)) this.edgeLevel.delete(pin);
    for (const pin of pins)
      if (!this.edgeLevel.has(pin)) this.edgeLevel.set(pin, this.bus.outputOf(pin)?.level ?? 0);
    return pins;
  }

  private track(s: MnaSolution): void {
    for (let n = 1; n < this.envMin.length; n++) {
      const v = s.voltage(n);
      if (v < (this.envMin[n] ?? Infinity)) this.envMin[n] = v;
      if (v > (this.envMax[n] ?? -Infinity)) this.envMax[n] = v;
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

  /**
   * Re-solves the present operating point after a stamp change: DC, or in a reactive circuit an
   * "instant" step that keeps capacitor voltages and inductor currents where they are.
   */
  private solveIfDirty(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.solution = this.published = this.solveAt(null);
    if (this.transient) this.startSolution = this.solution;
  }

  /**
   * Operating point after a step of `h` (null: DC or instant, whichever the circuit needs), with PWM
   * pins averaged over their phases — except pins that reach a reactive net, which are stamped at
   * their real level so an RC filter ripples and a timer sees every edge.
   */
  private solveAt(h: number | null): MnaSolution {
    const pwm = (this.bus?.pwmPins() ?? []).filter((p) => !this.edgeDriven.has(p.pin));
    const base = this.solveWith(new Set(), undefined, h);
    return pwm.length === 0
      ? base
      : new AveragedSolution(
          base,
          pwm.map(({ pin, duty }) => ({ solution: this.solveWith(new Set([pin]), undefined, h), duty })),
        );
  }

  private solveWith(
    pwmHigh: ReadonlySet<string>,
    extra?: (s: MnaCircuit) => void,
    h: number | null = null,
  ): MnaSolution {
    this.circuit.clear();
    this.bus?.stamp(this.circuit, pwmHigh, this.edgeDriven.size > 0 ? this.edgeLevel : undefined);
    for (const c of this.components) c.model.stamp(this.circuit);
    extra?.(this.circuit);
    this.stats.solves++;
    return this.circuit.solve(h ?? (this.transient ? INSTANT_STEP_S : DC_STEP));
  }

  /**
   * DC resistance from `net` to ground in the present state (Ω): injects 1 µA and measures the
   * voltage shift. A net with no path to any rail reads ~1 TΩ (GMIN only). Used by the
   * floating-input rule; does not change the published operating point.
   */
  netResistance(net: NetId): number {
    if (net === 0) return 0;
    const probeA = 1e-6;
    const base = this.solveWith(new Set(), undefined, DC_STEP);
    const probed = this.solveWith(new Set(), (s) => s.currentSource(0, net, probeA), DC_STEP);
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
