import {
  HC_FAMILY,
  HC_SCHMITT,
  isUndefinedLevel,
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

export type GateArrayProps = Record<string, never>;

export interface GateArrayState {
  readonly vcc: number;
  readonly powered: boolean;
  /** Output level per gate (null while unpowered or damaged: high impedance). */
  readonly outputs: readonly (Level | null)[];
  /** Inputs sitting between the thresholds (undefined level; real CMOS also burns current there). */
  readonly undefinedInputs: number;
  readonly damaged: boolean;
}

export interface GateArrayVariant {
  readonly type: string;
  /** Pin names per gate: inputs, then the output. */
  readonly gates: readonly { readonly inputs: readonly string[]; readonly output: string }[];
  readonly logic: (inputs: readonly Level[]) => Level;
  readonly schmitt?: boolean;
}

const quad = (n: number) => ({ inputs: [`${n}a`, `${n}b`], output: `${n}y` });
const QUAD = [1, 2, 3, 4].map(quad);
const HEX = [1, 2, 3, 4, 5, 6].map((n) => ({ inputs: [`${n}a`], output: `${n}y` }));

export const HC00: GateArrayVariant = {
  type: 'ic.74hc00',
  gates: QUAD,
  logic: ([a, b]) => (a && b ? 0 : 1),
};
export const HC08: GateArrayVariant = { type: 'ic.74hc08', gates: QUAD, logic: ([a, b]) => (a && b ? 1 : 0) };
export const HC32: GateArrayVariant = { type: 'ic.74hc32', gates: QUAD, logic: ([a, b]) => (a || b ? 1 : 0) };
export const HC86: GateArrayVariant = {
  type: 'ic.74hc86',
  gates: QUAD,
  logic: ([a, b]) => (a !== b ? 1 : 0),
};
export const HC14: GateArrayVariant = {
  type: 'ic.74hc14',
  gates: HEX,
  logic: ([a]) => (a ? 0 : 1),
  schmitt: true,
};

const RESTAMP_V = 1e-3;
const ABS_MAX_VCC = 7;

interface Gate {
  readonly inputs: readonly NetId[];
  readonly output: NetId;
}

/**
 * A 74HC gate array (Technical Design §5.4, digital timing): CMOS inputs thresholded at 0.3 / 0.7 VCC
 * (Schmitt on the 74HC14) and ≈ 45 Ω push-pull outputs drawing from VCC. Outputs re-evaluate in
 * `settle`, so chained gates resolve within one slice, and in `mcuEdge`, so the firmware reads a gate
 * fed by its own pins at the very next instruction. Unpowered or damaged, the outputs float.
 */
export class GateArray implements ComponentModel<GateArrayProps, GateArrayState>, Damageable {
  readonly type: string;
  private id = '';
  private vccNet: NetId = 0;
  private gnd: NetId = 0;
  private gates: Gate[] = [];
  /** Last level per input, gate by gate. */
  private inputLevels: Level[][] = [];
  private outputs: Level[] = [];
  private handles: SourceHandle[] = [];
  private stampedVcc = 0;
  private vcc = 0;
  private undefinedInputs = 0;
  private currents: number[] = [];

  damaged = false;

  constructor(private readonly variant: GateArrayVariant) {
    this.type = variant.type;
  }

  damage(_reason: string): void {
    this.damaged = true;
  }

  init(ctx: ModelContext): void {
    this.id = ctx.id;
    this.vccNet = ctx.net('vcc');
    this.gnd = ctx.net('gnd');
    this.gates = this.variant.gates.map((g) => ({
      inputs: g.inputs.map((p) => ctx.net(p)),
      output: ctx.net(g.output),
    }));
    this.inputLevels = this.gates.map((g) => g.inputs.map(() => 0 as Level));
    this.outputs = this.gates.map((_, i) => this.variant.logic(this.inputLevels[i] ?? []));
  }

  logicNets(): { inputs: NetId[]; outputs: NetId[] } {
    return { inputs: this.gates.flatMap((g) => g.inputs), outputs: this.gates.map((g) => g.output) };
  }

  stamp(s: MnaStamper): void {
    this.handles = [];
    if (!this.powered()) return;
    this.handles = this.gates.map((g, i) =>
      stampPushPull(s, g.output, this.gnd, this.vccNet, this.outputs[i] ?? 0, this.stampedVcc, HC_FAMILY),
    );
  }

  step(_dt: number, io: ComponentIO): void {
    const { solution } = io;
    this.vcc = solution.voltage(this.vccNet) - solution.voltage(this.gnd);
    this.currents = this.handles.map((h) => solution.sourceCurrent(h));
    if (Math.abs(this.vcc - this.stampedVcc) > RESTAMP_V) {
      this.stampedVcc = this.vcc;
      io.invalidate();
    }
    if (this.evaluate(io)) io.invalidate();
  }

  settle(io: ComponentIO): boolean {
    // Power-up within the slice too: a new supply level changes the stamp before inputs are read.
    const vcc = io.solution.voltage(this.vccNet) - io.solution.voltage(this.gnd);
    if (Math.abs(vcc - this.stampedVcc) > RESTAMP_V) {
      this.stampedVcc = vcc;
      this.evaluate(io);
      return true;
    }
    return this.evaluate(io);
  }

  mcuEdge(net: NetId, level: Level, time: number, io: ComponentIO): void {
    if (!this.powered()) return;
    this.gates.forEach((g, i) => {
      const levels = this.inputLevels[i];
      if (!levels || !g.inputs.includes(net)) return;
      g.inputs.forEach((n, k) => {
        if (n === net) levels[k] = level;
      });
      const out = this.variant.logic(levels);
      if (out === this.outputs[i]) return;
      this.outputs[i] = out;
      io.emitEdge(g.output, out, time);
      io.scheduleMcuInput(g.output, out, time);
      io.invalidate();
    });
  }

  faults(): readonly Fault[] {
    const out: Fault[] = [];
    if (this.vcc > ABS_MAX_VCC)
      out.push({
        code: 'OVER_VOLTAGE',
        componentId: this.id,
        params: { volts: this.vcc, limitV: ABS_MAX_VCC },
      });
    this.currents.forEach((a, i) => {
      if (Math.abs(a) > HC_FAMILY.maxOutputA)
        out.push({
          code: 'OVER_CURRENT',
          componentId: this.id,
          params: { gate: i + 1, currentMa: Math.abs(a) * 1000, limitMa: HC_FAMILY.maxOutputA * 1000 },
        });
    });
    return out;
  }

  snapshot(): GateArrayState {
    const powered = this.powered();
    return {
      vcc: this.vcc,
      powered,
      outputs: this.outputs.map((l) => (powered ? l : null)),
      undefinedInputs: powered ? this.undefinedInputs : 0,
      damaged: this.damaged,
    };
  }

  private powered(): boolean {
    return !this.damaged && this.stampedVcc >= HC_FAMILY.minVcc;
  }

  /** Reads every input from the operating point; true when an output changed. */
  private evaluate(io: ComponentIO): boolean {
    if (!this.powered()) return false;
    const { solution } = io;
    const ground = solution.voltage(this.gnd);
    const schmitt = this.variant.schmitt ? HC_SCHMITT : undefined;
    let changed = false;
    let undefinedInputs = 0;
    this.gates.forEach((g, i) => {
      const levels = this.inputLevels[i] ?? [];
      g.inputs.forEach((n, k) => {
        const v = solution.voltage(n) - ground;
        if (!schmitt && isUndefinedLevel(v, this.stampedVcc, HC_FAMILY)) undefinedInputs++;
        levels[k] = logicLevel(v, this.stampedVcc, levels[k] ?? 0, HC_FAMILY, schmitt);
      });
      const out = this.variant.logic(levels);
      if (out !== this.outputs[i]) {
        this.outputs[i] = out;
        changed = true;
      }
    });
    this.undefinedInputs = undefinedInputs;
    return changed;
  }
}
