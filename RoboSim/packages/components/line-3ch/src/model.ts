import {
  irReflectance,
  type ComponentIO,
  type ComponentModel,
  type Fault,
  type MnaStamper,
  type ModelContext,
  type NetId,
} from '@robosim/sim-core';

export interface Line3chProps {
  /** Distance between adjacent sensors (mm). */
  readonly spacingMm: number;
  /** Comparator threshold on reflectance (0..1). */
  readonly threshold: number;
}

export type Channel = 'left' | 'center' | 'right';

export interface Line3chState {
  readonly mounted: boolean;
  readonly reflectance: Readonly<Record<Channel, number>>;
  /** Digital outputs: HIGH over black (line), LOW over white. */
  readonly outputs: Readonly<Record<Channel, 0 | 1>>;
}

const CHANNELS: readonly Channel[] = ['left', 'center', 'right'];
const INPUT_OF: Readonly<Record<string, Channel>> = {
  surfaceLeft: 'left',
  surfaceCenter: 'center',
  surfaceRight: 'right',
};
const MIN_VCC = 3;
const PULLUP_OHMS = 10_000;
const SINK_OHMS = 50;
const HYSTERESIS = 0.03;
const SUPPLY_A = 0.05; // three IR LEDs + indicators

/**
 * 3-channel TCRT5000 line module (digital outputs). Sensors sit across the module's +y axis
 * (left = +spacing, right = −spacing) in the robot frame; same optics as the single sensor.
 */
export class Line3ch implements ComponentModel<Line3chProps, Line3chState> {
  readonly type = 'sensor.line-3ch';
  private id = '';
  private nets: Record<'vcc' | 'gnd' | Channel, NetId> = { vcc: 0, gnd: 0, left: 0, center: 0, right: 0 };
  private props: Line3chProps = { spacingMm: 12, threshold: 0.5 };
  private surface: Record<Channel, number> = { left: 1, center: 1, right: 1 };
  private reflect: Record<Channel, number> = { left: 1, center: 1, right: 1 };
  private out: Record<Channel, 0 | 1> = { left: 0, center: 0, right: 0 };
  private mounted = false;
  private vcc = 0;
  private stampedKey = '';

  init(ctx: ModelContext, props: Line3chProps): void {
    this.id = ctx.id;
    this.nets = {
      vcc: ctx.net('vcc'),
      gnd: ctx.net('gnd'),
      left: ctx.net('left'),
      center: ctx.net('center'),
      right: ctx.net('right'),
    };
    this.props = props;
  }

  input(name: string, value: number | boolean): void {
    const ch = INPUT_OF[name];
    if (!ch || typeof value !== 'number') throw new Error(`sensor.line-3ch: bad input '${name}'`);
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
    const offsetY: Record<Channel, number> = {
      left: this.props.spacingMm,
      center: 0,
      right: -this.props.spacingMm,
    };
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

  snapshot(): Line3chState {
    return { mounted: this.mounted, reflectance: { ...this.reflect }, outputs: { ...this.out } };
  }

  private key(): string {
    return `${this.vcc.toFixed(3)}|${this.out.left}${this.out.center}${this.out.right}`;
  }
}
