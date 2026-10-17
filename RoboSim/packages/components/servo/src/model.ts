import type {
  ComponentIO,
  ComponentModel,
  Damageable,
  Fault,
  MnaStamper,
  ModelContext,
  NetId,
} from '@robosim/sim-core';

export interface ServoProps {
  readonly initialAngleDeg: number;
  readonly minPulseUs: number;
  readonly maxPulseUs: number;
}

export interface ServoState {
  readonly angleDeg: number;
  /** Commanded angle, or null when no valid pulses arrive (servo not holding). */
  readonly targetDeg: number | null;
  readonly pulseUs: number | null;
  readonly moving: boolean;
  readonly currentMa: number;
  readonly damaged: boolean;
}

export interface ServoVariant {
  readonly type: string;
  /** Slew rate at 4.8 V (°/s); scales with supply voltage like the real motor. */
  readonly speedDegPerSAt4v8: number;
  readonly brownoutV: number;
  readonly maxV: number;
  /** Behavioural supply current per state (A) at `ratedV`. */
  readonly idleA: number;
  readonly holdA: number;
  readonly movingA: number;
  readonly ratedV: number;
}

/** SG90: 0.1 s / 60° at 4.8 V, 650 mA stall, 3.5–6.5 V. */
export const SG90: ServoVariant = {
  type: 'actuator.sg90-servo',
  speedDegPerSAt4v8: 600,
  brownoutV: 3.5,
  maxV: 6.5,
  idleA: 0.006,
  holdA: 0.01,
  movingA: 0.25,
  ratedV: 5,
};

/** MG996R: 0.17 s / 60° at 4.8 V (0.14 s at 6 V), 500–900 mA running, 2.5 A stall, 4.8–7.2 V. */
export const MG996R: ServoVariant = {
  type: 'actuator.mg996r-servo',
  speedDegPerSAt4v8: 353,
  brownoutV: 4,
  maxV: 7.2,
  idleA: 0.01,
  holdA: 0.05,
  movingA: 0.7,
  ratedV: 6,
};

const SIGNAL_TIMEOUT_S = 0.05; // standard frame is 20 ms
const PULSE_SLACK_US = 100; // accept slightly out-of-range pulses, clamped
const ON_TARGET_DEG = 0.5;

/**
 * Hobby servo (SG90, MG996R). Pulse widths are measured from cycle-stamped MCU edges on the signal net
 * (Servo library, timer PWM, or bit-banged), mapped linearly min..max pulse → 0..180°. The horn slews
 * at a voltage-proportional rate; supply current is a behavioural sink per state (idle / hold / moving).
 * Limitation: pulses are seen only when an MCU pin drives the signal net directly.
 */
export class Servo implements ComponentModel<ServoProps, ServoState>, Damageable {
  readonly type: string;
  private id = '';
  private signal: NetId = 0;
  private vccNet: NetId = 0;
  private gnd: NetId = 0;
  private props: ServoProps = { initialAngleDeg: 90, minPulseUs: 500, maxPulseUs: 2500 };
  private angle = 90;
  private target: number | null = null;
  private pulseUs: number | null = null;
  private riseTime: number | null = null;
  private lastPulseTime = -Infinity;
  private supplyA: number;
  private stampedA = -1;
  private volts = 0;

  damaged = false;

  constructor(private readonly variant: ServoVariant = SG90) {
    this.type = variant.type;
    this.supplyA = variant.idleA;
  }

  damage(_reason: string): void {
    this.damaged = true; // driver IC dead: no movement, no draw
  }

  init(ctx: ModelContext, props: ServoProps): void {
    this.id = ctx.id;
    this.signal = ctx.net('signal');
    this.vccNet = ctx.net('vcc');
    this.gnd = ctx.net('gnd');
    this.props = props;
    this.angle = props.initialAngleDeg;
  }

  stamp(s: MnaStamper): void {
    if (this.damaged) return;
    // Current sink sized at the rated voltage; scales with supply like the real motor driver.
    this.stampedA = this.supplyA;
    s.conductance(this.vccNet, this.gnd, this.supplyA / this.variant.ratedV);
  }

  step(dt: number, io: ComponentIO): void {
    this.volts = io.solution.voltage(this.vccNet) - io.solution.voltage(this.gnd);
    for (const e of io.edges(this.signal)) {
      if (e.level === 1) this.riseTime = e.time;
      else if (this.riseTime !== null) {
        this.acceptPulse((e.time - this.riseTime) * 1e6, e.time);
        this.riseTime = null;
      }
    }
    const now = io.simTime + dt;
    if (now - this.lastPulseTime > SIGNAL_TIMEOUT_S) {
      this.target = null;
      this.pulseUs = null;
    }

    const { brownoutV, speedDegPerSAt4v8, idleA, holdA, movingA } = this.variant;
    const powered = !this.damaged && this.volts >= brownoutV;
    let moving = false;
    if (powered && this.target !== null) {
      const error = this.target - this.angle;
      const maxStep = speedDegPerSAt4v8 * (this.volts / 4.8) * dt;
      moving = Math.abs(error) > ON_TARGET_DEG;
      this.angle += Math.max(-maxStep, Math.min(maxStep, error));
    }
    this.supplyA = moving ? movingA : this.target !== null && powered ? holdA : idleA;
    if (this.supplyA !== this.stampedA) io.invalidate();
  }

  faults(): readonly Fault[] {
    const { maxV } = this.variant;
    return this.volts > maxV
      ? [{ code: 'OVER_VOLTAGE', componentId: this.id, params: { volts: this.volts, limitV: maxV } }]
      : [];
  }

  snapshot(): ServoState {
    return {
      angleDeg: this.angle,
      targetDeg: this.target,
      pulseUs: this.pulseUs,
      moving: this.supplyA === this.variant.movingA,
      currentMa: this.damaged ? 0 : (this.supplyA / this.variant.ratedV) * this.volts * 1000,
      damaged: this.damaged,
    };
  }

  private acceptPulse(widthUs: number, at: number): void {
    const { minPulseUs, maxPulseUs } = this.props;
    if (widthUs < minPulseUs - PULSE_SLACK_US || widthUs > maxPulseUs + PULSE_SLACK_US) return; // glitch / not a servo frame
    const clamped = Math.min(maxPulseUs, Math.max(minPulseUs, widthUs));
    this.pulseUs = widthUs;
    this.target = ((clamped - minPulseUs) / (maxPulseUs - minPulseUs)) * 180;
    this.lastPulseTime = at;
  }
}
