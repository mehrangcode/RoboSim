import type { ComponentIO, ComponentModel, Fault, MnaStamper, ModelContext, NetId } from '@robosim/sim-core';

export interface Sg90ServoProps {
  readonly initialAngleDeg: number;
  readonly minPulseUs: number;
  readonly maxPulseUs: number;
}

export interface Sg90ServoState {
  readonly angleDeg: number;
  /** Commanded angle, or null when no valid pulses arrive (servo not holding). */
  readonly targetDeg: number | null;
  readonly pulseUs: number | null;
  readonly moving: boolean;
  readonly currentMa: number;
}

const SPEED_DEG_PER_S_AT_4V8 = 600; // datasheet 0.1 s / 60° at 4.8 V
const BROWNOUT_V = 3.5;
const MAX_V = 6.5;
const SIGNAL_TIMEOUT_S = 0.05; // standard frame is 20 ms
const PULSE_SLACK_US = 100; // accept slightly out-of-range pulses, clamped
const IDLE_A = 0.006;
const HOLD_A = 0.01;
const MOVING_A = 0.25;
const ON_TARGET_DEG = 0.5;

/**
 * SG90 micro servo. Pulse widths are measured from cycle-stamped MCU edges on the signal net
 * (Servo library, timer PWM, or bit-banged), mapped linearly min..max pulse → 0..180°. The horn slews
 * at a voltage-proportional rate; supply current is a behavioural sink per state (idle / hold / moving).
 * Limitation: pulses are seen only when an MCU pin drives the signal net directly.
 */
export class Sg90Servo implements ComponentModel<Sg90ServoProps, Sg90ServoState> {
  readonly type = 'actuator.sg90-servo';
  private id = '';
  private signal: NetId = 0;
  private vccNet: NetId = 0;
  private gnd: NetId = 0;
  private props: Sg90ServoProps = { initialAngleDeg: 90, minPulseUs: 500, maxPulseUs: 2500 };
  private angle = 90;
  private target: number | null = null;
  private pulseUs: number | null = null;
  private riseTime: number | null = null;
  private lastPulseTime = -Infinity;
  private supplyA = IDLE_A;
  private stampedA = -1;
  private volts = 0;

  init(ctx: ModelContext, props: Sg90ServoProps): void {
    this.id = ctx.id;
    this.signal = ctx.net('signal');
    this.vccNet = ctx.net('vcc');
    this.gnd = ctx.net('gnd');
    this.props = props;
    this.angle = props.initialAngleDeg;
  }

  stamp(s: MnaStamper): void {
    // Current sink sized at 5 V; scales with supply like the real motor driver.
    this.stampedA = this.supplyA;
    s.conductance(this.vccNet, this.gnd, this.supplyA / 5);
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

    const powered = this.volts >= BROWNOUT_V;
    let moving = false;
    if (powered && this.target !== null) {
      const error = this.target - this.angle;
      const maxStep = SPEED_DEG_PER_S_AT_4V8 * (this.volts / 4.8) * dt;
      moving = Math.abs(error) > ON_TARGET_DEG;
      this.angle += Math.max(-maxStep, Math.min(maxStep, error));
    }
    this.supplyA = moving ? MOVING_A : this.target !== null && powered ? HOLD_A : IDLE_A;
    if (this.supplyA !== this.stampedA) io.invalidate();
  }

  faults(): readonly Fault[] {
    return this.volts > MAX_V
      ? [{ code: 'OVER_VOLTAGE', componentId: this.id, params: { volts: this.volts, limitV: MAX_V } }]
      : [];
  }

  snapshot(): Sg90ServoState {
    return {
      angleDeg: this.angle,
      targetDeg: this.target,
      pulseUs: this.pulseUs,
      moving: this.supplyA === MOVING_A,
      currentMa: (this.supplyA / 5) * this.volts * 1000,
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
