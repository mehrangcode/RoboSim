import {
  irReflectance,
  type ComponentIO,
  type ComponentModel,
  type Fault,
  type MnaStamper,
  type ModelContext,
  type NetId,
} from '@robosim/sim-core';

export interface Tcrt5000Props {
  /** Comparator threshold (on-board trimmer) as a fraction of VCC on the A0 scale. */
  readonly threshold: number;
  /** Uniform analog noise amplitude as a fraction of VCC (seeded, deterministic). */
  readonly noise: number;
}

export interface Tcrt5000State {
  readonly mounted: boolean;
  /** 0 (black / nothing) .. 1 (white) reflected IR. */
  readonly reflectance: number;
  readonly a0V: number;
  /** Comparator output: HIGH over black (no reflection), LOW over white. */
  readonly d0: 0 | 1;
  /** On-board indicator LED, lit when D0 is LOW (reflection detected). */
  readonly indicator: boolean;
}

const MIN_VCC = 3;
const A0_SPAN = 0.85; // white pulls A0 down to ~15 % of VCC
const A0_OHMS = 2000;
const D0_PULLUP_OHMS = 10_000;
const D0_SINK_OHMS = 50;
const HYSTERESIS = 0.03; // of VCC
const IR_LED_A = 0.017;
const STATUS_LEDS_A = 0.005;
const RESTAMP_EPSILON_V = 1e-3;

/**
 * TCRT5000 reflective line-sensor module with LM393 comparator (Technical Design §5.5). Mounted on a
 * robot it samples the arena floor under its spot (radius grows with mounting height); on the bench
 * the `surface` input stands in. Outputs draw their current from VCC.
 */
export class Tcrt5000 implements ComponentModel<Tcrt5000Props, Tcrt5000State> {
  readonly type = 'sensor.tcrt5000';
  private ctx: ModelContext | null = null;
  private nets = { vcc: 0 as NetId, gnd: 0 as NetId, d0: 0 as NetId, a0: 0 as NetId };
  private props: Tcrt5000Props = { threshold: 0.5, noise: 0.005 };
  private surface = 1;
  private mounted = false;
  private reflectance = 1;
  private vcc = 0;
  private a0V = 0;
  private d0: 0 | 1 = 0;
  private stamped = { a0V: -1, d0: -1 as number, vcc: -1 };

  init(ctx: ModelContext, props: Tcrt5000Props): void {
    this.ctx = ctx;
    this.nets = { vcc: ctx.net('vcc'), gnd: ctx.net('gnd'), d0: ctx.net('d0'), a0: ctx.net('a0') };
    this.props = props;
  }

  input(name: string, value: number | boolean): void {
    if (name !== 'surface' || typeof value !== 'number')
      throw new Error(`sensor.tcrt5000: bad input '${name}'`);
    this.surface = Math.min(1, Math.max(0, value));
  }

  stamp(s: MnaStamper): void {
    const { vcc, gnd, d0, a0 } = this.nets;
    const powered = this.vcc >= MIN_VCC;
    s.conductance(vcc, gnd, (IR_LED_A + STATUS_LEDS_A) / 5);
    if (powered) {
      s.voltageSource(a0, gnd, this.a0V, A0_OHMS, { supplyFrom: vcc });
      s.voltageSource(d0, gnd, this.d0 === 1 ? this.vcc : 0, this.d0 === 1 ? D0_PULLUP_OHMS : D0_SINK_OHMS, {
        supplyFrom: vcc,
      });
    }
    this.stamped = { a0V: this.a0V, d0: this.d0, vcc: this.vcc };
  }

  step(_dt: number, io: ComponentIO): void {
    const sol = io.solution;
    const { vcc, gnd } = this.nets;
    this.vcc = sol.voltage(vcc) - sol.voltage(gnd);
    const pose = io.world?.componentPose(this.ctx?.id ?? '') ?? null;
    this.mounted = pose !== null;
    this.reflectance = pose && io.world ? irReflectance(io.world, pose) : this.surface;

    const powered = this.vcc >= MIN_VCC;
    if (powered) {
      const noise = this.props.noise * ((this.ctx?.random() ?? 0.5) - 0.5) * this.vcc;
      this.a0V = Math.min(this.vcc, Math.max(0, this.vcc * (1 - A0_SPAN * this.reflectance) + noise));
      const th = this.props.threshold * this.vcc;
      const h = (HYSTERESIS * this.vcc) / 2;
      if (this.a0V > th + h) this.d0 = 1;
      else if (this.a0V < th - h) this.d0 = 0;
    } else {
      this.a0V = 0;
      this.d0 = 0;
    }
    if (
      Math.abs(this.a0V - this.stamped.a0V) > RESTAMP_EPSILON_V ||
      this.d0 !== this.stamped.d0 ||
      Math.abs(this.vcc - this.stamped.vcc) > RESTAMP_EPSILON_V
    ) {
      io.invalidate();
    }
  }

  faults(): readonly Fault[] {
    return [];
  }

  snapshot(): Tcrt5000State {
    return {
      mounted: this.mounted,
      reflectance: this.reflectance,
      a0V: this.a0V,
      d0: this.d0,
      indicator: this.vcc >= MIN_VCC && this.d0 === 0,
    };
  }
}
