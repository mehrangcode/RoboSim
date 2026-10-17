import {
  dmath,
  type ComponentIO,
  type ComponentModel,
  type Fault,
  type MnaStamper,
  type ModelContext,
  type NetId,
  type PinEdge,
} from '@robosim/sim-core';

export type PassiveBuzzerProps = Record<string, never>;

export interface PassiveBuzzerState {
  readonly sounding: boolean;
  /** Drive frequency (Hz) while sounding, else 0. */
  readonly toneHz: number;
  /** 0..1 loudness for the audio renderer: drive amplitude × the transducer's response at toneHz. */
  readonly loudness: number;
  readonly volts: number;
  readonly currentMa: number;
}

/** 12 mm magnetic transducer: 42 Ω coil, ≈ 8 mH, loudest at its 2.7 kHz resonance. */
const COIL_OHMS = 42;
const COIL_HENRY = 0.008;
const RESONANT_HZ = 2700;
const MIN_TONE_HZ = 20;
const MAX_TONE_HZ = 20000;
/** Silence after this many missing periods (or 20 ms, whichever is longer). */
const TIMEOUT_PERIODS = 3;
const RESTAMP_RATIO = 1e-3;

/**
 * Passive buzzer: no oscillator inside, so it sounds only when driven with a square wave — `tone()`
 * (timer-toggled pin, measured from cycle-stamped edges) or hardware PWM (`analogWrite`, read from the
 * timer registers). Electrically the coil's impedance √(R² + (2πfL)²): leaving the pin HIGH draws the
 * DC coil current, a real way to overload an Arduino pin.
 */
export class PassiveBuzzer implements ComponentModel<PassiveBuzzerProps, PassiveBuzzerState> {
  readonly type = 'actuator.buzzer-passive';
  private pos: NetId = 0;
  private neg: NetId = 0;
  private toneHz = 0;
  private lastRise: number | null = null;
  private period: number | null = null;
  private stampedOhms = COIL_OHMS;
  private volts = 0;

  init(ctx: ModelContext): void {
    this.pos = ctx.net('pos');
    this.neg = ctx.net('neg');
  }

  stamp(s: MnaStamper): void {
    this.stampedOhms = impedance(this.toneHz);
    s.conductance(this.pos, this.neg, 1 / this.stampedOhms);
  }

  step(dt: number, io: ComponentIO): void {
    this.volts = io.solution.voltage(this.pos) - io.solution.voltage(this.neg);
    const pwm = io.pwm(this.pos) ?? io.pwm(this.neg);
    if (pwm && pwm.dutyRatio > 0 && pwm.dutyRatio < 1) {
      this.toneHz = pwm.freqHz;
    } else {
      this.measure([...io.edges(this.pos), ...io.edges(this.neg)].sort((a, b) => a.time - b.time));
      const now = io.simTime + dt;
      const timeout = Math.max(0.02, (this.period ?? 0) * TIMEOUT_PERIODS);
      const alive = this.lastRise !== null && this.period !== null && now - this.lastRise <= timeout;
      this.toneHz = alive && this.period ? 1 / this.period : 0;
      if (!alive) this.period = null;
    }
    if (this.toneHz < MIN_TONE_HZ || this.toneHz > MAX_TONE_HZ) this.toneHz = 0;
    if (Math.abs(impedance(this.toneHz) / this.stampedOhms - 1) > RESTAMP_RATIO) io.invalidate();
  }

  faults(): readonly Fault[] {
    return [];
  }

  snapshot(): PassiveBuzzerState {
    const sounding = this.toneHz > 0;
    // Square-wave amplitude: the solved level while high; a toggling pin is sampled at either phase.
    const amplitude = Math.min(1, Math.abs(this.volts) / 5);
    // Octaves away from resonance, via dmath so traces stay bit-identical across browsers.
    const octaves = sounding ? dmath.log(this.toneHz / RESONANT_HZ) / Math.LN2 : 0;
    const response = sounding ? 1 / (1 + Math.abs(octaves)) : 0;
    return {
      sounding,
      toneHz: this.toneHz,
      loudness: sounding ? Math.max(0.2, amplitude) * response : 0,
      volts: this.volts,
      currentMa: (Math.abs(this.volts) / this.stampedOhms) * 1000,
    };
  }

  /** Period between rising edges (either terminal may be the driven one). */
  private measure(edges: readonly PinEdge[]): void {
    for (const e of edges) {
      if (e.level !== 1) continue;
      if (this.lastRise !== null && e.time > this.lastRise) this.period = e.time - this.lastRise;
      this.lastRise = e.time;
    }
  }
}

function impedance(hz: number): number {
  const xl = 2 * Math.PI * hz * COIL_HENRY;
  return Math.sqrt(COIL_OHMS * COIL_OHMS + xl * xl);
}
