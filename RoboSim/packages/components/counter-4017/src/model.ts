import {
  CD4000_FAMILY,
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

export type DecadeCounterProps = Record<string, never>;

export interface DecadeCounterState {
  readonly powered: boolean;
  /** 0–9: the output that is HIGH. */
  readonly count: number;
  readonly carry: Level;
  readonly damaged: boolean;
}

type Input = 'clk' | 'inh' | 'rst';
const INPUTS: readonly Input[] = ['rst', 'clk', 'inh'];
const PRIORITY: Readonly<Record<Input, number>> = { rst: 0, clk: 1, inh: 2 };
const RESTAMP_V = 1e-3;

interface Event {
  readonly time: number;
  readonly input: Input;
  readonly level: Level;
}

/**
 * CD4017B decade counter with ten decoded outputs (Technical Design §5.4): the count advances on a
 * rising CLK while INH is LOW (or a falling INH while CLK is HIGH), RST HIGH returns it to Q0, and CO
 * is HIGH for counts 0–4. CD4000-series outputs are weak (≈ 0.8 kΩ at 5 V), so an LED on an output
 * glows dimly without a driver — as on the real chip. Clocks come from timed edges or DC levels.
 */
export class DecadeCounter implements ComponentModel<DecadeCounterProps, DecadeCounterState>, Damageable {
  readonly type = 'ic.cd4017';
  private id = '';
  private vdd: NetId = 0;
  private vss: NetId = 0;
  private net = {} as Record<Input, NetId>;
  private qNets: NetId[] = [];
  private coNet: NetId = 0;
  private levels: Record<Input, Level> = { clk: 0, inh: 0, rst: 0 };
  private count = 0;
  private stampedCount = -1;
  private stampedVdd = 0;
  private handles: SourceHandle[] = [];
  private currents: number[] = [];

  damaged = false;

  damage(_reason: string): void {
    this.damaged = true;
  }

  init(ctx: ModelContext): void {
    this.id = ctx.id;
    this.vdd = ctx.net('vdd');
    this.vss = ctx.net('vss');
    for (const i of INPUTS) this.net[i] = ctx.net(i);
    this.qNets = Array.from({ length: 10 }, (_, i) => ctx.net(`q${i}`));
    this.coNet = ctx.net('co');
  }

  logicNets(): { inputs: NetId[]; outputs: NetId[] } {
    return { inputs: INPUTS.map((i) => this.net[i]), outputs: [...this.qNets, this.coNet] };
  }

  stamp(s: MnaStamper): void {
    this.handles = [];
    this.stampedCount = this.count;
    if (!this.powered()) return;
    const drive = (net: NetId, level: Level) =>
      this.handles.push(stampPushPull(s, net, this.vss, this.vdd, level, this.stampedVdd, CD4000_FAMILY));
    this.qNets.forEach((n, i) => drive(n, i === this.count ? 1 : 0));
    drive(this.coNet, this.carry());
  }

  step(_dt: number, io: ComponentIO): void {
    const { solution } = io;
    const vdd = solution.voltage(this.vdd) - solution.voltage(this.vss);
    this.currents = this.handles.map((h) => solution.sourceCurrent(h));
    if (Math.abs(vdd - this.stampedVdd) > RESTAMP_V) {
      this.stampedVdd = vdd;
      io.invalidate();
    }
    if (!this.powered()) return;

    const events: Event[] = [];
    for (const input of INPUTS) {
      const edges = io.edges(this.net[input]);
      for (const e of edges) events.push({ time: e.time, input, level: e.level });
      if (edges.length === 0) {
        // A DC level (a button, a tied pin) has held since the slice began.
        const v = solution.voltage(this.net[input]) - solution.voltage(this.vss);
        const level = logicLevel(v, vdd, this.levels[input], CD4000_FAMILY);
        if (level !== this.levels[input]) events.push({ time: io.simTime, input, level });
      }
    }
    events.sort((a, b) => a.time - b.time || PRIORITY[a.input] - PRIORITY[b.input]);
    for (const e of events) this.apply(e);
    if (this.levels.rst === 1) this.count = 0;
    if (this.count !== this.stampedCount) io.invalidate();
  }

  faults(): readonly Fault[] {
    const out: Fault[] = [];
    const { maxVcc, maxOutputA } = CD4000_FAMILY;
    if (this.stampedVdd > maxVcc)
      out.push({
        code: 'OVER_VOLTAGE',
        componentId: this.id,
        params: { volts: this.stampedVdd, limitV: maxVcc },
      });
    const worst = Math.max(0, ...this.currents.map(Math.abs));
    if (worst > maxOutputA)
      out.push({
        code: 'OVER_CURRENT',
        componentId: this.id,
        params: { currentMa: worst * 1000, limitMa: maxOutputA * 1000 },
      });
    return out;
  }

  snapshot(): DecadeCounterState {
    return { powered: this.powered(), count: this.count, carry: this.carry(), damaged: this.damaged };
  }

  private apply(e: Event): void {
    const before = this.levels[e.input];
    this.levels[e.input] = e.level;
    if (this.levels.rst === 1) {
      this.count = 0;
      return;
    }
    const clockRise = e.input === 'clk' && before === 0 && e.level === 1 && this.levels.inh === 0;
    const inhibitFall = e.input === 'inh' && before === 1 && e.level === 0 && this.levels.clk === 1;
    if (clockRise || inhibitFall) this.count = (this.count + 1) % 10;
  }

  private carry(): Level {
    return this.count < 5 ? 1 : 0;
  }

  private powered(): boolean {
    return !this.damaged && this.stampedVdd >= CD4000_FAMILY.minVcc;
  }
}
