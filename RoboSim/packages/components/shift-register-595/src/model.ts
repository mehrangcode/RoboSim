import {
  HC_FAMILY,
  logicLevel,
  stampPushPull,
  type ComponentIO,
  type ComponentModel,
  type Damageable,
  type Fault,
  type Level,
  type MnaStamper,
  type ModelContext,
  type NetId,
  type SourceHandle,
} from '@robosim/sim-core';

export type ShiftRegisterProps = Record<string, never>;

export interface ShiftRegisterState {
  readonly powered: boolean;
  /** Storage-register outputs QA…QH (null = high impedance: OE high, unpowered or damaged). */
  readonly outputs: readonly (Level | null)[];
  /** Shift register contents, QA = bit 0. */
  readonly shift: number;
  readonly outputsEnabled: boolean;
  readonly damaged: boolean;
}

const OUTPUTS = ['qa', 'qb', 'qc', 'qd', 'qe', 'qf', 'qg', 'qh'] as const;
type Input = 'ser' | 'srclk' | 'rclk' | 'srclr' | 'oe';
const INPUTS: readonly Input[] = ['ser', 'srclk', 'rclk', 'srclr', 'oe'];
/** Equal-time ordering: clocks sample data before it changes (a chained QH′ moves on the same edge). */
const PRIORITY: Readonly<Record<Input, number>> = { srclr: 0, srclk: 1, rclk: 2, oe: 3, ser: 4 };
const RESTAMP_V = 1e-3;
const ABS_MAX_VCC = 7;
/** 74HC595 drives QA–QH up to ±35 mA, but only 70 mA through VCC/GND in total. */
const MAX_OUTPUT_A = 0.035;
const MAX_SUPPLY_A = 0.07;

interface Event {
  readonly time: number;
  readonly input: Input;
  readonly level: Level;
}

/**
 * 74HC595 serial-in, parallel-out shift register with output latch (Technical Design §5.4): SRCLK
 * rising shifts SER into QA, RCLK rising copies the shift register to the outputs, SRCLR LOW clears
 * it, OE HIGH floats QA–QH. Clocks are processed from cycle-stamped edges, so `shiftOut` works, and
 * QH′ publishes its edges (`io.emitEdge`) for a chained 595. Outputs share the 70 mA supply limit.
 */
export class ShiftRegister595 implements ComponentModel<ShiftRegisterProps, ShiftRegisterState>, Damageable {
  readonly type = 'ic.74hc595';
  private id = '';
  private vccNet: NetId = 0;
  private gnd: NetId = 0;
  private net = {} as Record<Input, NetId>;
  private outNets: NetId[] = [];
  private qh2Net: NetId = 0;
  private levels: Record<Input, Level> = { ser: 0, srclk: 0, rclk: 0, srclr: 1, oe: 0 };
  private shift = 0;
  private latch = 0;
  private handles: SourceHandle[] = [];
  private stampedVcc = 0;
  private stamped = { latch: -1, oe: -1, qh2: -1 };
  private currents: number[] = [];

  damaged = false;

  damage(_reason: string): void {
    this.damaged = true;
  }

  init(ctx: ModelContext): void {
    this.id = ctx.id;
    this.vccNet = ctx.net('vcc');
    this.gnd = ctx.net('gnd');
    for (const i of INPUTS) this.net[i] = ctx.net(i);
    this.outNets = OUTPUTS.map((o) => ctx.net(o));
    this.qh2Net = ctx.net('qh2');
  }

  logicNets(): { inputs: NetId[]; outputs: NetId[] } {
    return { inputs: INPUTS.map((i) => this.net[i]), outputs: [...this.outNets, this.qh2Net] };
  }

  stamp(s: MnaStamper): void {
    this.handles = [];
    this.stamped = { latch: this.latch, oe: this.levels.oe, qh2: this.qh2() };
    if (!this.powered()) return;
    const drive = (net: NetId, level: Level) =>
      this.handles.push(stampPushPull(s, net, this.gnd, this.vccNet, level, this.stampedVcc, HC_FAMILY));
    if (this.levels.oe === 0) this.outNets.forEach((n, i) => drive(n, bit(this.latch, i)));
    drive(this.qh2Net, this.qh2());
  }

  step(_dt: number, io: ComponentIO): void {
    const { solution } = io;
    const vcc = solution.voltage(this.vccNet) - solution.voltage(this.gnd);
    this.currents = this.handles.map((h) => solution.sourceCurrent(h));
    if (Math.abs(vcc - this.stampedVcc) > RESTAMP_V) {
      this.stampedVcc = vcc;
      io.invalidate();
    }
    if (!this.powered()) return;

    const events: Event[] = [];
    const start = io.simTime;
    for (const input of INPUTS) {
      const edges = io.edges(this.net[input]);
      for (const e of edges) events.push({ time: e.time, input, level: e.level });
      if (edges.length === 0) {
        // Not driven by timed edges (a button, a tied pin): the operating point's level has held since
        // the slice began (user inputs land between slices).
        const v = solution.voltage(this.net[input]) - solution.voltage(this.gnd);
        const level = logicLevel(v, vcc, this.levels[input], HC_FAMILY);
        if (level !== this.levels[input]) events.push({ time: start, input, level });
      }
    }
    events.sort((a, b) => a.time - b.time || PRIORITY[a.input] - PRIORITY[b.input]);
    for (const e of events) this.apply(e, io);

    const s = this.stamped;
    if (s.latch !== this.latch || s.oe !== this.levels.oe || s.qh2 !== this.qh2()) io.invalidate();
  }

  faults(): readonly Fault[] {
    const out: Fault[] = [];
    const vcc = this.stampedVcc;
    if (vcc > ABS_MAX_VCC)
      out.push({ code: 'OVER_VOLTAGE', componentId: this.id, params: { volts: vcc, limitV: ABS_MAX_VCC } });
    const worst = Math.max(0, ...this.currents.map(Math.abs));
    if (worst > MAX_OUTPUT_A)
      out.push({
        code: 'OVER_CURRENT',
        componentId: this.id,
        params: { currentMa: worst * 1000, limitMa: MAX_OUTPUT_A * 1000 },
      });
    // Sourced current all flows through VCC (and sunk current through GND).
    const sourced = this.currents.reduce((t, a) => t + Math.max(0, a), 0);
    const sunk = this.currents.reduce((t, a) => t + Math.max(0, -a), 0);
    if (Math.max(sourced, sunk) > MAX_SUPPLY_A)
      out.push({
        code: 'OVER_CURRENT',
        componentId: this.id,
        params: { pin: 'vcc', currentMa: Math.max(sourced, sunk) * 1000, limitMa: MAX_SUPPLY_A * 1000 },
      });
    return out;
  }

  snapshot(): ShiftRegisterState {
    const powered = this.powered();
    const enabled = this.levels.oe === 0;
    return {
      powered,
      outputs: OUTPUTS.map((_, i) => (powered && enabled ? bit(this.latch, i) : null)),
      shift: this.shift,
      outputsEnabled: enabled,
      damaged: this.damaged,
    };
  }

  private apply(e: Event, io: ComponentIO): void {
    const rising = e.level === 1 && this.levels[e.input] === 0;
    this.levels[e.input] = e.level;
    if (e.input === 'srclr' && e.level === 0) this.setShift(0, e.time, io);
    else if (e.input === 'srclk' && rising && this.levels.srclr === 1)
      this.setShift(((this.shift << 1) | this.levels.ser) & 0xff, e.time, io);
    else if (e.input === 'rclk' && rising) this.latch = this.shift;
  }

  private setShift(value: number, time: number, io: ComponentIO): void {
    const before = this.qh2();
    this.shift = value;
    if (this.qh2() !== before) io.emitEdge(this.qh2Net, this.qh2(), time);
  }

  private qh2(): Level {
    return bit(this.shift, 7);
  }

  private powered(): boolean {
    return !this.damaged && this.stampedVcc >= HC_FAMILY.minVcc;
  }
}

const bit = (value: number, i: number): Level => ((value >> i) & 1) as Level;
