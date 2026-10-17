import type { ComponentIO, ComponentModel, Fault, MnaStamper, ModelContext, NetId } from '@robosim/sim-core';

export interface SoilMoistureProps {
  /** Comparator threshold on AO (fraction of VCC) set by the trimmer. */
  readonly threshold: number;
}

export interface SoilMoistureState {
  readonly moisture: number;
  readonly ao: number;
  /** DO is LOW once the soil is wetter than the threshold (the module's LED lights). */
  readonly wet: boolean;
}

const MIN_VCC = 3;
/** The probe and a 10 kΩ resistor form a divider: AO ≈ 4.7 kΩ source. */
const AO_OHMS = 4700;
const PULLUP_OHMS = 10_000;
const SINK_OHMS = 50;
const SUPPLY_A = 0.005;
/** Dry air reads ≈ VCC; probe in water ≈ 0.3 VCC (≈ 300 on analogRead). */
const WET_DROP = 0.7;

/**
 * YL-69 probe with YL-38 comparator board: the wetter the soil, the lower AO (dry ≈ 1000 on
 * analogRead, water ≈ 300). DO goes LOW when AO falls below the trimmer's threshold. Moisture is a
 * bench input (0 = dry air, 1 = water).
 */
export class SoilMoisture implements ComponentModel<SoilMoistureProps, SoilMoistureState> {
  readonly type = 'sensor.soil-moisture';
  private vccNet: NetId = 0;
  private gnd: NetId = 0;
  private aoNet: NetId = 0;
  private doNet: NetId = 0;
  private threshold = 0.5;
  private moisture = 0.2;
  private vcc = 0;
  private stampedKey = '';

  init(ctx: ModelContext, props: SoilMoistureProps): void {
    this.vccNet = ctx.net('vcc');
    this.gnd = ctx.net('gnd');
    this.aoNet = ctx.net('ao');
    this.doNet = ctx.net('do');
    this.threshold = props.threshold;
  }

  input(name: string, value: number | boolean): void {
    if (name !== 'moisture' || typeof value !== 'number')
      throw new Error(`${this.type}: bad input '${name}'`);
    this.moisture = Math.min(1, Math.max(0, value));
  }

  stamp(s: MnaStamper): void {
    s.conductance(this.vccNet, this.gnd, SUPPLY_A / 5);
    this.stampedKey = this.key();
    if (this.vcc < MIN_VCC) return;
    s.voltageSource(this.aoNet, this.gnd, this.ao(), AO_OHMS, { supplyFrom: this.vccNet });
    const wet = this.wet();
    s.voltageSource(this.doNet, this.gnd, wet ? 0 : this.vcc, wet ? SINK_OHMS : PULLUP_OHMS, {
      supplyFrom: this.vccNet,
    });
  }

  step(_dt: number, io: ComponentIO): void {
    this.vcc = io.solution.voltage(this.vccNet) - io.solution.voltage(this.gnd);
    if (this.key() !== this.stampedKey) io.invalidate();
  }

  faults(): readonly Fault[] {
    return [];
  }

  snapshot(): SoilMoistureState {
    return { moisture: this.moisture, ao: this.ao(), wet: this.wet() };
  }

  private ao(): number {
    return this.vcc * (1 - WET_DROP * this.moisture);
  }

  private wet(): boolean {
    return this.ao() < this.threshold * this.vcc;
  }

  private key(): string {
    return `${this.vcc.toFixed(3)}|${this.moisture}`;
  }
}
