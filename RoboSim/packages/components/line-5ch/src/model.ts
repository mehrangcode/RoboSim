import {
  irReflectance,
  type ComponentIO,
  type ComponentModel,
  type Fault,
  type MnaStamper,
  type ModelContext,
  type NetId,
} from '@robosim/sim-core';

export interface Line5chProps {
  /** Distance between adjacent sensors (mm). */
  readonly spacingMm: number;
  /** Comparator threshold on reflectance (0..1). */
  readonly threshold: number;
}

export type Channel = 's1' | 's2' | 's3' | 's4' | 's5';

export interface Line5chState {
  readonly mounted: boolean;
  readonly reflectance: Readonly<Record<Channel, number>>;
  /** Digital outputs: HIGH over black (line), LOW over white. */
  readonly outputs: Readonly<Record<Channel, 0 | 1>>;
}

/** S1 is the leftmost sensor, S5 the rightmost (seen from above, facing forward). */
const CHANNELS: readonly Channel[] = ['s1', 's2', 's3', 's4', 's5'];
const INPUT_OF: Readonly<Record<string, Channel>> = {
  surface1: 's1',
  surface2: 's2',
  surface3: 's3',
  surface4: 's4',
  surface5: 's5',
};
const MIN_VCC = 3;
const PULLUP_OHMS = 10_000;
const SINK_OHMS = 50;
const HYSTERESIS = 0.03;
const SUPPLY_A = 0.08; // five IR LEDs + indicators

/**
 * 5-channel TCRT5000 line array (digital outputs). Sensors sit across the module's +y axis, S3 in the
 * middle (S1 = +2 × spacing on the left, S5 = −2 × spacing on the right); same optics as the single
 * sensor. Five sensors tell how far off the line the robot is, for proportional steering.
 */
export class Line5ch implements ComponentModel<Line5chProps, Line5chState> {
  readonly type = 'sensor.line-5ch';
  private id = '';
  private nets: Record<'vcc' | 'gnd' | Channel, NetId> = {
    vcc: 0,
    gnd: 0,
    s1: 0,
    s2: 0,
    s3: 0,
    s4: 0,
    s5: 0,
  };
  private props: Line5chProps = { spacingMm: 15, threshold: 0.5 };
  private surface: Record<Channel, number> = { s1: 1, s2: 1, s3: 1, s4: 1, s5: 1 };
  private reflect: Record<Channel, number> = { s1: 1, s2: 1, s3: 1, s4: 1, s5: 1 };
  private out: Record<Channel, 0 | 1> = { s1: 0, s2: 0, s3: 0, s4: 0, s5: 0 };
  private mounted = false;
  private vcc = 0;
  private stampedKey = '';

  init(ctx: ModelContext, props: Line5chProps): void {
    this.id = ctx.id;
    this.nets = {
      vcc: ctx.net('vcc'),
      gnd: ctx.net('gnd'),
      s1: ctx.net('s1'),
      s2: ctx.net('s2'),
      s3: ctx.net('s3'),
      s4: ctx.net('s4'),
      s5: ctx.net('s5'),
    };
    this.props = props;
  }

  input(name: string, value: number | boolean): void {
    const ch = INPUT_OF[name];
    if (!ch || typeof value !== 'number') throw new Error(`sensor.line-5ch: bad input '${name}'`);
    this.surface[ch] = Math.min(1, Math.max(0, value));
  }

  stamp(s: MnaStamper): void {
    const { vcc, gnd } = this.nets;
    s.conductance(vcc, gnd, SUPPLY_A / 5);
    if (this.vcc >= MIN_VCC) {
      for (const ch of CHANNELS) {
        const high = this.out[ch] === 1;
        s.voltageSource(this.nets[ch], gnd, high ? this.vcc : 0, high ? PULLUP_OHMS : SINK_OHMS, {
          supplyFrom: vcc,
        });
      }
    }
    this.stampedKey = this.key();
  }

  step(_dt: number, io: ComponentIO): void {
    const sol = io.solution;
    this.vcc = sol.voltage(this.nets.vcc) - sol.voltage(this.nets.gnd);
    const pose = io.world?.componentPose(this.id) ?? null;
    this.mounted = pose !== null;
    const d = this.props.spacingMm;
    const offsetY: Record<Channel, number> = { s1: 2 * d, s2: d, s3: 0, s4: -d, s5: -2 * d };
    for (const ch of CHANNELS) {
      this.reflect[ch] =
        pose && io.world ? irReflectance(io.world, pose, { x: 0, y: offsetY[ch] }) : this.surface[ch];
      if (this.vcc < MIN_VCC) this.out[ch] = 0;
      else if (this.reflect[ch] < this.props.threshold - HYSTERESIS) this.out[ch] = 1;
      else if (this.reflect[ch] > this.props.threshold + HYSTERESIS) this.out[ch] = 0;
    }
    if (this.key() !== this.stampedKey) io.invalidate();
  }

  faults(): readonly Fault[] {
    return [];
  }

  snapshot(): Line5chState {
    return { mounted: this.mounted, reflectance: { ...this.reflect }, outputs: { ...this.out } };
  }

  private key(): string {
    return `${this.vcc.toFixed(3)}|${CHANNELS.map((c) => this.out[c]).join('')}`;
  }
}
