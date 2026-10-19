import {
  OpenDrainWatch,
  pullLow,
  type ComponentIO,
  type ComponentModel,
  type Fault,
  type Level,
  type LineEvent,
  type MnaStamper,
  type ModelContext,
  type NetId,
  type PinMode,
} from '@robosim/sim-core';

export type Dht11Props = Record<string, never>;

export interface Dht11State {
  readonly powered: boolean;
  /** Last values sent (°C, %RH), or null before the first reading. */
  readonly temperatureC: number | null;
  readonly humidity: number | null;
  readonly transmitting: boolean;
}

/** Host start signal: LOW for at least 18 ms (datasheet). */
const START_MIN_S = 18e-3;
/** Response after the host releases the line: wait, then 80 µs LOW and 80 µs HIGH. */
const RESPONSE_DELAY_S = 30e-6;
const RESPONSE_S = 80e-6;
/** Each bit: 50 µs LOW, then HIGH for 26–28 µs (0) or 70 µs (1). */
const BIT_LOW_S = 50e-6;
const BIT_HIGH_S = [27e-6, 70e-6] as const;
/** At most one measurement per second; the first one a second after power-up. */
const SAMPLE_PERIOD_S = 1;
/** Seeded calibration error within ±1 °C and ±3 %RH (datasheet ±2 °C, ±5 %RH). */
const TEMP_ERROR_C = 1;
const HUMIDITY_ERROR = 3;
const MIN_VCC = 3;
const MAX_VCC = 5.5;
/** The common 3-pin module's 10 kΩ pull-up on DATA. */
const PULLUP_OHMS = 10_000;
const MEASURING_A = 0.5e-3;
const LOGIC_HIGH_V = 2;

/**
 * DHT11 temperature and humidity sensor on its 3-pin module (Technical Design §5.4, Tier C). It
 * answers the host's start signal on the open-drain DATA line, cycle-exact, with 40 bits: humidity,
 * temperature (1 °C / 1 %RH steps, seeded calibration error) and a checksum, as the Adafruit DHT
 * library reads them. Readings refresh at most once a second, and not in the first second after power-up.
 */
export class Dht11 implements ComponentModel<Dht11Props, Dht11State> {
  readonly type = 'sensor.dht11';
  private id = '';
  private vccNet: NetId = 0;
  private dataNet: NetId = 0;
  private gnd: NetId = 0;
  private vcc = 0;
  private powered = false;
  private poweredAt = 0;
  private readonly watch = new OpenDrainWatch();
  private busyUntil = 0;
  private inputs = { temperatureC: 24, humidity: 55 };
  private offset = { temperatureC: 0, humidity: 0 };
  private sample: { at: number; bytes: readonly number[] } | null = null;
  private sent: { temperatureC: number; humidity: number } | null = null;
  private now = 0;

  init(ctx: ModelContext): void {
    this.id = ctx.id;
    this.vccNet = ctx.net('vcc');
    this.dataNet = ctx.net('data');
    this.gnd = ctx.net('gnd');
    this.offset = {
      temperatureC: (2 * ctx.random() - 1) * TEMP_ERROR_C,
      humidity: (2 * ctx.random() - 1) * HUMIDITY_ERROR,
    };
  }

  input(name: string, value: number | boolean): void {
    if (typeof value !== 'number' || !(name in this.inputs))
      throw new Error(`sensor.dht11: bad input '${name}'`);
    this.inputs = { ...this.inputs, [name]: value };
  }

  logicNets(): { inputs: NetId[]; outputs: NetId[] } {
    return { inputs: [this.dataNet], outputs: [] };
  }

  mcuEdge(_net: NetId, level: Level, time: number, io: ComponentIO): void {
    this.line(this.watch.edge(level, time), io);
  }

  mcuMode(_net: NetId, mode: PinMode, level: Level, time: number, io: ComponentIO): void {
    this.line(this.watch.mode(mode, level, time), io);
  }

  stamp(s: MnaStamper): void {
    s.conductance(this.dataNet, this.vccNet, 1 / PULLUP_OHMS);
    s.currentSource(this.vccNet, this.gnd, this.powered ? MEASURING_A : 0);
  }

  step(_dt: number, io: ComponentIO): void {
    const sol = io.solution;
    this.vcc = sol.voltage(this.vccNet) - sol.voltage(this.gnd);
    this.now = io.now;
    const powered = this.vcc >= MIN_VCC;
    if (powered !== this.powered) {
      this.powered = powered;
      this.poweredAt = io.now;
      this.sample = null;
      io.invalidate();
    }
  }

  faults(): readonly Fault[] {
    return this.vcc > MAX_VCC
      ? [{ code: 'OVER_VOLTAGE', componentId: this.id, params: { volts: this.vcc, limitV: MAX_VCC } }]
      : [];
  }

  snapshot(): Dht11State {
    return {
      powered: this.powered,
      temperatureC: this.sent?.temperatureC ?? null,
      humidity: this.sent?.humidity ?? null,
      transmitting: this.now < this.busyUntil,
    };
  }

  /** A start signal (≥ 18 ms LOW, then released) gets the 40-bit answer. */
  private line(e: LineEvent | null, io: ComponentIO): void {
    if (e?.kind !== 'release' || e.lowFor < START_MIN_S) return;
    const t = e.time;
    if (!this.powered || t < this.poweredAt + SAMPLE_PERIOD_S || t < this.busyUntil) return;
    const bytes = this.measure(t);
    const low = (from: number, length: number) =>
      pullLow(io, this.dataNet, from, from + length, LOGIC_HIGH_V);
    let at = t + RESPONSE_DELAY_S;
    low(at, RESPONSE_S);
    at += 2 * RESPONSE_S;
    for (const byte of bytes)
      for (let bit = 7; bit >= 0; bit--) {
        low(at, BIT_LOW_S);
        at += BIT_LOW_S + ((byte >> bit) & 1 ? BIT_HIGH_S[1] : BIT_HIGH_S[0]);
      }
    low(at, BIT_LOW_S);
    this.busyUntil = at + BIT_LOW_S;
  }

  /** The current sample, refreshed at most once a second. */
  private measure(t: number): readonly number[] {
    if (!this.sample || t - this.sample.at >= SAMPLE_PERIOD_S) {
      const temp = clamp(Math.round(this.inputs.temperatureC + this.offset.temperatureC), 0, 50);
      const hum = clamp(Math.round(this.inputs.humidity + this.offset.humidity), 5, 95);
      const data = [hum, 0, temp, 0];
      this.sample = { at: t, bytes: [...data, data.reduce((a, b) => a + b, 0) & 0xff] };
      this.sent = { temperatureC: temp, humidity: hum };
    }
    return this.sample.bytes;
  }
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
