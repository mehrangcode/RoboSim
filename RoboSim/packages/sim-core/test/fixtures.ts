/** Test doubles for the scheduler: a scriptable MCU, minimal component models, and a counting world. */
import type {
  BodySnapshot,
  ComponentIO,
  ComponentModel,
  DiodeHandle,
  Level,
  McuCore,
  MnaStamper,
  ModelContext,
  NetId,
  PinDrive,
  PinElectrical,
  PinId,
  PinOutput,
  RayHit,
  UartPort,
  Unsubscribe,
  WorldModel,
} from '../src/index.js';

export const UNO_ELECTRICAL: PinElectrical = {
  vcc: 5,
  outputResistance: 25,
  pullupResistance: 35_000,
  vil: 1.5,
  vih: 3,
};

export interface ScheduledInput {
  readonly pin: PinId;
  readonly drive: PinDrive;
  readonly atCycle: number;
}

/**
 * MCU stand-in: `program` runs after each `run()` with the new cycle and the latest applied inputs,
 * and returns the pin outputs — enough to emulate simple sketches without an AVR core.
 */
export class FakeCore implements McuCore {
  cycle = 0;
  readonly inputs: ScheduledInput[] = [];
  private readonly applied = new Map<PinId, PinDrive>();
  private outputs = new Map<PinId, PinOutput>();

  constructor(
    readonly clockHz: number,
    private readonly program: (cycle: number, inputs: ReadonlyMap<PinId, PinDrive>) => Map<PinId, PinOutput>,
  ) {}

  run(untilCycle: number): void {
    for (const i of this.inputs) if (i.atCycle <= untilCycle) this.applied.set(i.pin, i.drive);
    this.inputs.splice(0, this.inputs.length, ...this.inputs.filter((i) => i.atCycle > untilCycle));
    this.cycle = untilCycle;
    this.outputs = this.program(this.cycle, this.applied);
  }

  scheduleInput(pin: PinId, drive: PinDrive, atCycle: number): void {
    this.inputs.push({ pin, drive, atCycle });
  }

  pinOutputs(): ReadonlyMap<PinId, PinOutput> {
    return this.outputs;
  }

  private readonly edgeListeners: ((pin: PinId, level: Level, cycle: number) => void)[] = [];

  onPinEdge(cb: (pin: PinId, level: Level, cycle: number) => void): Unsubscribe {
    this.edgeListeners.push(cb);
    return () => this.edgeListeners.splice(this.edgeListeners.indexOf(cb), 1);
  }

  /** Test hook: report an output edge as a real core would during `run()`. */
  emitEdge(pin: PinId, level: Level, cycle: number): void {
    for (const cb of this.edgeListeners) cb(pin, level, cycle);
  }

  uart(_index: number): UartPort {
    throw new Error('FakeCore has no UART');
  }

  reset(): void {
    this.cycle = 0;
  }
}

export class Resistor implements ComponentModel<{ ohms: number }, null> {
  readonly type = 'passive.resistor';
  private a: NetId = 0;
  private b: NetId = 0;
  private ohms = 1;

  init(ctx: ModelContext, props: { ohms: number }): void {
    this.a = ctx.net('a');
    this.b = ctx.net('b');
    this.ohms = props.ohms;
  }
  stamp(s: MnaStamper): void {
    s.conductance(this.a, this.b, 1 / this.ohms);
  }
  step(): void {}
  faults(): [] {
    return [];
  }
  snapshot(): null {
    return null;
  }
}

export class Led implements ComponentModel<{ vf: number; rs: number }, { currentMa: number; lit: boolean }> {
  readonly type = 'output.led';
  private anode: NetId = 0;
  private cathode: NetId = 0;
  private params = { vf: 2, rs: 10 };
  private handle = 0 as DiodeHandle;
  private currentA = 0;

  init(ctx: ModelContext, props: { vf: number; rs: number }): void {
    this.anode = ctx.net('a');
    this.cathode = ctx.net('k');
    this.params = props;
  }
  stamp(s: MnaStamper): void {
    this.handle = s.diode(this.anode, this.cathode, this.params);
  }
  step(_dt: number, io: ComponentIO): void {
    this.currentA = io.solution.diodeCurrent(this.handle);
  }
  faults(): [] {
    return [];
  }
  snapshot(): { currentMa: number; lit: boolean } {
    return { currentMa: this.currentA * 1000, lit: this.currentA > 1e-3 };
  }
}

/** Push button between 'a' and 'b'; `press()` models a user input arriving between slices. */
export class Button implements ComponentModel<null, { pressed: boolean }> {
  readonly type = 'input.button';
  private a: NetId = 0;
  private b: NetId = 0;
  private pressed = false;
  private changed = false;

  init(ctx: ModelContext): void {
    this.a = ctx.net('a');
    this.b = ctx.net('b');
  }
  press(pressed: boolean): void {
    this.changed = this.changed || pressed !== this.pressed;
    this.pressed = pressed;
  }
  input(name: string, value: number | boolean): void {
    if (name !== 'pressed') throw new Error(`unknown input ${name}`);
    this.pressed = value === true;
  }
  stamp(s: MnaStamper): void {
    if (this.pressed) s.conductance(this.a, this.b, 1 / 0.05);
  }
  step(_dt: number, io: ComponentIO): void {
    if (this.changed) io.invalidate();
    this.changed = false;
  }
  faults(): [] {
    return [];
  }
  snapshot(): { pressed: boolean } {
    return { pressed: this.pressed };
  }
}

/** Analog sensor with seeded noise on its output: exercises per-component PRNG streams. */
export class NoisySensor implements ComponentModel<{ volts: number; noise: number }, { volts: number }> {
  readonly type = 'sensor.noisy';
  private out: NetId = 0;
  private ctx: ModelContext | null = null;
  private base = 0;
  private noise = 0;
  private volts = 0;

  init(ctx: ModelContext, props: { volts: number; noise: number }): void {
    this.ctx = ctx;
    this.out = ctx.net('out');
    this.base = props.volts;
    this.noise = props.noise;
  }
  stamp(s: MnaStamper): void {
    s.voltageSource(this.out, 0, this.volts, 100);
  }
  step(_dt: number, io: ComponentIO): void {
    this.volts = this.base + this.noise * ((this.ctx?.random() ?? 0.5) - 0.5);
    io.invalidate();
  }
  faults(): [] {
    return [];
  }
  snapshot(): { volts: number } {
    return { volts: this.volts };
  }
}

export class CountingWorld implements WorldModel {
  steps: number[] = [];
  step(dt: number): void {
    this.steps.push(dt);
  }
  raycast(): RayHit | null {
    return null;
  }
  sampleFloor(): number {
    return 1;
  }
  bodies(): readonly BodySnapshot[] {
    return [{ id: 'chassis', position: { x: this.steps.length, y: 0 }, angle: 0 }];
  }
}

export const out = (level: Level): PinOutput => ({ mode: 'output', level });
