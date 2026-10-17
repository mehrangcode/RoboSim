import {
  dmath,
  type ComponentIO,
  type ComponentModel,
  type Fault,
  type MnaStamper,
  type ModelContext,
  type NetId,
} from '@robosim/sim-core';

export interface SoundSensorProps {
  /** Comparator reference (fraction of VCC) set by the module's trimmer. */
  readonly threshold: number;
}

export interface SoundSensorState {
  /** Loudness 0..1 of the sound reaching the microphone. */
  readonly level: number;
  readonly ao: number;
  readonly do: 0 | 1;
}

const MIN_VCC = 3;
const AO_OHMS = 1000;
const PULLUP_OHMS = 10_000;
const SINK_OHMS = 50;
const SUPPLY_A = 0.004;
/** The microphone signal: a 433 Hz tone with an overtone, biased at VCC / 2. */
const TONE_HZ = 433;
const SWING = 0.45;

/**
 * KY-038 sound sensor: an electret microphone biased at VCC / 2 on AO, and an LM393 comparator that
 * pulls DO HIGH whenever AO rises above the trimmer's threshold (its LED blinks with loud sound). AO
 * carries the waveform itself, so `analogRead` sees samples scattered around 512; measure loudness the
 * way real sketches do, as the peak-to-peak over a short window. Loudness is a bench input (0 = quiet).
 */
export class SoundSensor implements ComponentModel<SoundSensorProps, SoundSensorState> {
  readonly type = 'sensor.sound';
  private vccNet: NetId = 0;
  private gnd: NetId = 0;
  private aoNet: NetId = 0;
  private doNet: NetId = 0;
  private threshold = 0.7;
  private level = 0;
  private vcc = 0;
  private ao = 0;
  private digital: 0 | 1 = 0;

  init(ctx: ModelContext, props: SoundSensorProps): void {
    this.vccNet = ctx.net('vcc');
    this.gnd = ctx.net('gnd');
    this.aoNet = ctx.net('ao');
    this.doNet = ctx.net('do');
    this.threshold = props.threshold;
  }

  input(name: string, value: number | boolean): void {
    if (name !== 'level' || typeof value !== 'number') throw new Error(`${this.type}: bad input '${name}'`);
    this.level = Math.min(1, Math.max(0, value));
  }

  stamp(s: MnaStamper): void {
    s.conductance(this.vccNet, this.gnd, SUPPLY_A / 5);
    if (this.vcc < MIN_VCC) return;
    s.voltageSource(this.aoNet, this.gnd, this.ao, AO_OHMS, { supplyFrom: this.vccNet });
    s.voltageSource(
      this.doNet,
      this.gnd,
      this.digital ? this.vcc : 0,
      this.digital ? PULLUP_OHMS : SINK_OHMS,
      {
        supplyFrom: this.vccNet,
      },
    );
  }

  step(dt: number, io: ComponentIO): void {
    const vcc = io.solution.voltage(this.vccNet) - io.solution.voltage(this.gnd);
    const t = io.simTime + dt;
    // dmath keeps the waveform bit-identical across browsers (determinism, §5.9).
    const wave = 0.8 * dmath.sin(2 * Math.PI * TONE_HZ * t) + 0.2 * dmath.sin(2 * Math.PI * 3 * TONE_HZ * t);
    const ao = vcc * (0.5 + SWING * this.level * wave);
    const digital: 0 | 1 = ao > this.threshold * vcc ? 1 : 0;
    if (Math.abs(vcc - this.vcc) > 1e-3 || Math.abs(ao - this.ao) > 1e-4 || digital !== this.digital) {
      this.vcc = vcc;
      this.ao = ao;
      this.digital = digital;
      io.invalidate();
    }
  }

  faults(): readonly Fault[] {
    return [];
  }

  snapshot(): SoundSensorState {
    return { level: this.level, ao: this.ao, do: this.digital };
  }
}
