import {
  sonarRange,
  type ComponentIO,
  type ComponentModel,
  type Fault,
  type MnaStamper,
  type ModelContext,
  type NetId,
} from '@robosim/sim-core';

export interface IrObstacleProps {
  /** Detection distance set by the module's potentiometer (cm). */
  readonly rangeCm: number;
}

export interface IrObstacleState {
  readonly mounted: boolean;
  readonly obstacle: boolean;
  /** Nearest reflecting surface within 50 cm, or null. */
  readonly distanceCm: number | null;
}

const MIN_VCC = 3;
const PULLUP_OHMS = 10_000;
const SINK_OHMS = 50;
const SUPPLY_A = 0.02; // IR LED + power and obstacle LEDs
/** Narrow IR beam: 3 rays across 20°; reflections are seen up to 50 cm at most. */
const CONE_DEG = 20;
const SEE_M = 0.5;

/**
 * FC-51 IR obstacle sensor: an IR LED and photodiode side by side, with an LM393 comparator. OUT goes
 * LOW (active) when a surface ahead reflects within the range set on its potentiometer, through the
 * module's 10 kΩ pull-up otherwise. On a robot the beam is ray-cast from its mount; on the bench the
 * distance is an input. Unlike the HC-SR04 it only says "something is near", not how far.
 */
export class IrObstacle implements ComponentModel<IrObstacleProps, IrObstacleState> {
  readonly type = 'sensor.ir-obstacle';
  private id = '';
  private vccNet: NetId = 0;
  private gnd: NetId = 0;
  private out: NetId = 0;
  private rangeCm = 10;
  private benchCm = 50;
  private distanceCm: number | null = null;
  private mounted = false;
  private vcc = 0;
  private obstacle = false;
  private stampedKey = '';

  init(ctx: ModelContext, props: IrObstacleProps): void {
    this.id = ctx.id;
    this.vccNet = ctx.net('vcc');
    this.gnd = ctx.net('gnd');
    this.out = ctx.net('out');
    this.rangeCm = props.rangeCm;
  }

  input(name: string, value: number | boolean): void {
    if (name !== 'distanceCm' || typeof value !== 'number')
      throw new Error(`${this.type}: bad input '${name}'`);
    this.benchCm = value;
  }

  stamp(s: MnaStamper): void {
    s.conductance(this.vccNet, this.gnd, SUPPLY_A / 5);
    if (this.vcc >= MIN_VCC)
      s.voltageSource(
        this.out,
        this.gnd,
        this.obstacle ? 0 : this.vcc,
        this.obstacle ? SINK_OHMS : PULLUP_OHMS,
        { supplyFrom: this.vccNet },
      );
    this.stampedKey = this.key();
  }

  step(_dt: number, io: ComponentIO): void {
    const sol = io.solution;
    this.vcc = sol.voltage(this.vccNet) - sol.voltage(this.gnd);
    const pose = io.world?.componentPose(this.id) ?? null;
    this.mounted = pose !== null;
    if (pose && io.world) {
      const m = sonarRange(io.world, pose, { coneDeg: CONE_DEG, rays: 3, minM: 0, maxM: SEE_M });
      this.distanceCm = m === null ? null : m * 100;
    } else this.distanceCm = this.benchCm >= SEE_M * 100 ? null : this.benchCm;
    this.obstacle = this.vcc >= MIN_VCC && this.distanceCm !== null && this.distanceCm <= this.rangeCm;
    if (this.key() !== this.stampedKey) io.invalidate();
  }

  faults(): readonly Fault[] {
    return [];
  }

  snapshot(): IrObstacleState {
    return { mounted: this.mounted, obstacle: this.obstacle, distanceCm: this.distanceCm };
  }

  private key(): string {
    return `${this.vcc.toFixed(3)}|${this.obstacle ? 1 : 0}`;
  }
}
