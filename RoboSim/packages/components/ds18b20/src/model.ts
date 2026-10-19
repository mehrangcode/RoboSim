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

export type Ds18b20Props = Record<string, never>;

export interface Ds18b20State {
  readonly powered: boolean;
  readonly parasite: boolean;
  /** 64-bit ROM code as hex, family code first (28 …). */
  readonly rom: string;
  /** Temperature register (°C): 85 until the first conversion. */
  readonly temperatureC: number;
  readonly resolutionBits: number;
  readonly converting: boolean;
}

/** 1-Wire timing (datasheet): reset ≥ 480 µs; a slot LOW shorter than 15 µs writes a 1 (or reads). */
const RESET_MIN_S = 400e-6;
const WRITE_ONE_MAX_S = 15e-6;
/** Presence pulse 15–60 µs after the reset ends, 60–240 µs long. */
const PRESENCE_DELAY_S = 30e-6;
const PRESENCE_S = 120e-6;
/** A 0 read slot: held LOW until 45 µs after the master's falling edge (the master samples at ≈ 13 µs). */
const READ_ZERO_S = 45e-6;
/** Conversion time by resolution (9–12 bits). */
const CONVERSION_S: Readonly<Record<number, number>> = { 9: 0.09375, 10: 0.1875, 11: 0.375, 12: 0.75 };
const COPY_S = 10e-3;
/** Power-on temperature register: +85 °C. */
const POWER_ON_RAW = 0x0550;
/** Seeded calibration error within ±0.2 °C (datasheet ±0.5 °C from −10 to +85 °C). */
const ERROR_C = 0.2;
const MIN_VDD = 3;
const MAX_VDD = 5.5;
/** Parasite power: VDD at ground, the chip runs from the pulled-up DQ line. */
const PARASITE_VDD = 1;
const LOGIC_HIGH_V = 2;
const CONVERTING_A = 1e-3;
const IDLE_A = 1e-6;

type Phase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'romCommand' | 'functionCommand' }
  | { readonly kind: 'match'; readonly bytes: number[] }
  | { readonly kind: 'search'; bit: number; step: 0 | 1 | 2 }
  | { readonly kind: 'writeScratchpad'; readonly bytes: number[] }
  | { readonly kind: 'transmit'; readonly bits: number[]; readonly then: 'idle' | 'functionCommand' }
  | { readonly kind: 'busy'; readonly until: number };

/**
 * DS18B20 digital thermometer in TO-92 (Technical Design §5.4, Tier C). A 1-Wire slave with its
 * seeded 64-bit ROM code: reset/presence, READ/MATCH/SKIP/SEARCH ROM (several sensors share one bus,
 * wired-AND), CONVERT T with the datasheet conversion time per resolution, scratchpad read/write
 * with CRC, EEPROM copy/recall and power-supply readout (parasite mode when VDD is grounded). It
 * needs the 4.7 kΩ pull-up on DQ; every slot is answered cycle-exact from the MCU's edges and modes.
 */
export class Ds18b20 implements ComponentModel<Ds18b20Props, Ds18b20State> {
  readonly type = 'sensor.ds18b20';
  private id = '';
  private gnd: NetId = 0;
  private dqNet: NetId = 0;
  private vddNet: NetId = 0;
  private vdd = 0;
  private powered = false;
  private parasite = false;
  private rom: readonly number[] = [];
  private offsetC = 0;
  private temperatureC = 22;
  private readonly watch = new OpenDrainWatch();
  private phase: Phase = { kind: 'idle' };
  private rx = { byte: 0, bits: 0 };
  /** Scratchpad bytes 0–4 (temperature, TH, TL, config) and the EEPROM copy of TH, TL, config. */
  private scratch = [POWER_ON_RAW & 0xff, POWER_ON_RAW >> 8, 0x4b, 0x46, 0x7f];
  private eeprom = [0x4b, 0x46, 0x7f];
  private conversion: { until: number } | null = null;
  private now = 0;

  init(ctx: ModelContext): void {
    this.id = ctx.id;
    this.gnd = ctx.net('gnd');
    this.dqNet = ctx.net('dq');
    this.vddNet = ctx.net('vdd');
    const serial = [...Array(6).keys()].map(() => Math.floor(ctx.random() * 256));
    const body = [0x28, ...serial];
    this.rom = [...body, crc8(body)];
    this.offsetC = (2 * ctx.random() - 1) * ERROR_C;
  }

  input(name: string, value: number | boolean): void {
    if (name !== 'temperatureC' || typeof value !== 'number')
      throw new Error(`sensor.ds18b20: bad input '${name}'`);
    this.temperatureC = value;
  }

  logicNets(): { inputs: NetId[]; outputs: NetId[] } {
    return { inputs: [this.dqNet], outputs: [] };
  }

  mcuEdge(_net: NetId, level: Level, time: number, io: ComponentIO): void {
    this.slot(this.watch.edge(level, time), io);
  }

  mcuMode(_net: NetId, mode: PinMode, level: Level, time: number, io: ComponentIO): void {
    this.slot(this.watch.mode(mode, level, time), io);
  }

  stamp(s: MnaStamper): void {
    const busy = this.conversion !== null && this.now < this.conversion.until;
    s.currentSource(
      this.vddNet,
      this.gnd,
      this.powered && !this.parasite ? (busy ? CONVERTING_A : IDLE_A) : 0,
    );
  }

  step(_dt: number, io: ComponentIO): void {
    const sol = io.solution;
    const rel = (n: NetId) => sol.voltage(n) - sol.voltage(this.gnd);
    this.vdd = rel(this.vddNet);
    this.now = io.now;
    const parasite = this.vdd < PARASITE_VDD;
    const powered = parasite ? rel(this.dqNet) >= MIN_VDD : this.vdd >= MIN_VDD;
    if (powered !== this.powered) {
      this.powered = powered;
      this.scratch = [POWER_ON_RAW & 0xff, POWER_ON_RAW >> 8, ...this.eeprom];
      this.conversion = null;
      this.phase = { kind: 'idle' };
      io.invalidate();
    }
    this.parasite = parasite;
    this.finishConversion(io.now);
  }

  faults(): readonly Fault[] {
    return this.vdd > MAX_VDD
      ? [{ code: 'OVER_VOLTAGE', componentId: this.id, params: { volts: this.vdd, limitV: MAX_VDD } }]
      : [];
  }

  snapshot(): Ds18b20State {
    const raw = ((this.scratch[1] ?? 0) << 8) | (this.scratch[0] ?? 0);
    return {
      powered: this.powered,
      parasite: this.parasite,
      rom: this.rom.map((b) => b.toString(16).padStart(2, '0')).join(''),
      temperatureC: ((raw << 16) >> 16) / 16,
      resolutionBits: this.resolution(),
      converting: this.conversion !== null && this.now < this.conversion.until,
    };
  }

  private resolution(): number {
    return 9 + (((this.scratch[4] ?? 0x7f) >> 5) & 0x03);
  }

  private finishConversion(t: number): void {
    if (!this.conversion || t < this.conversion.until) return;
    const bits = this.resolution();
    const raw = Math.round((this.temperatureC + this.offsetC) * 16) & ~((1 << (12 - bits)) - 1) & 0xffff;
    this.scratch[0] = raw & 0xff;
    this.scratch[1] = raw >> 8;
    this.conversion = null;
  }

  /** One master action on DQ: a reset, or a time slot that writes a bit or reads one. */
  private slot(e: LineEvent | null, io: ComponentIO): void {
    if (e?.kind !== 'release' || !this.powered) return;
    this.finishConversion(e.time);
    if (e.lowFor >= RESET_MIN_S) {
      pullLow(
        io,
        this.dqNet,
        e.time + PRESENCE_DELAY_S,
        e.time + PRESENCE_DELAY_S + PRESENCE_S,
        LOGIC_HIGH_V,
      );
      this.phase = { kind: 'romCommand' };
      this.rx = { byte: 0, bits: 0 };
      return;
    }
    const fall = e.time - e.lowFor;
    const send = (bit: number) => {
      if (bit === 0) pullLow(io, this.dqNet, e.time, fall + READ_ZERO_S, LOGIC_HIGH_V);
    };
    const written = e.lowFor < WRITE_ONE_MAX_S ? 1 : 0;
    const p = this.phase;
    switch (p.kind) {
      case 'idle':
        return;
      case 'transmit': {
        send(p.bits.shift() ?? 1);
        if (p.bits.length === 0) this.phase = { kind: p.then };
        return;
      }
      case 'busy':
        send(e.time < p.until ? 0 : 1);
        return;
      case 'search': {
        const romBit = ((this.rom[p.bit >> 3] ?? 0) >> (p.bit & 7)) & 1;
        if (p.step === 0) send(romBit);
        else if (p.step === 1) send(romBit ^ 1);
        else if (written !== romBit)
          this.phase = { kind: 'idle' }; // the master took the other branch
        else if (++p.bit === 64) this.phase = { kind: 'functionCommand' };
        if (p.step < 2) p.step = (p.step + 1) as 1 | 2;
        else p.step = 0;
        return;
      }
      default:
        this.receive(written, e.time);
    }
  }

  /** A bit the master wrote, LSB first; whole bytes go to the command decoder. */
  private receive(bit: number, t: number): void {
    this.rx.byte |= bit << this.rx.bits;
    if (++this.rx.bits < 8) return;
    const byte = this.rx.byte;
    this.rx = { byte: 0, bits: 0 };
    this.command(byte, t);
  }

  private command(byte: number, t: number): void {
    const p = this.phase;
    if (p.kind === 'romCommand') {
      if (byte === 0x33) this.phase = { kind: 'transmit', bits: bitsOf(this.rom), then: 'functionCommand' };
      else if (byte === 0x55) this.phase = { kind: 'match', bytes: [] };
      else if (byte === 0xcc) this.phase = { kind: 'functionCommand' };
      else if (byte === 0xf0 || (byte === 0xec && this.alarm()))
        this.phase = { kind: 'search', bit: 0, step: 0 };
      else this.phase = { kind: 'idle' };
    } else if (p.kind === 'match') {
      p.bytes.push(byte);
      if (p.bytes.length === 8)
        this.phase = p.bytes.every((b, i) => b === this.rom[i])
          ? { kind: 'functionCommand' }
          : { kind: 'idle' };
    } else if (p.kind === 'writeScratchpad') {
      p.bytes.push(byte);
      if (p.bytes.length === 3) {
        const [th = 0, tl = 0, config = 0] = p.bytes;
        this.scratch = [this.scratch[0] ?? 0, this.scratch[1] ?? 0, th, tl, (config & 0x60) | 0x1f];
        this.phase = { kind: 'idle' };
      }
    } else if (p.kind === 'functionCommand') {
      this.function(byte, t);
    }
  }

  private function(byte: number, t: number): void {
    switch (byte) {
      case 0x44: {
        const until = t + (CONVERSION_S[this.resolution()] ?? 0.75);
        this.conversion = { until };
        this.phase = { kind: 'busy', until };
        return;
      }
      case 0xbe: {
        const pad = [...this.scratch, 0xff, 0x0c, 0x10];
        this.phase = { kind: 'transmit', bits: bitsOf([...pad, crc8(pad)]), then: 'idle' };
        return;
      }
      case 0x4e:
        this.phase = { kind: 'writeScratchpad', bytes: [] };
        return;
      case 0x48:
        this.eeprom = this.scratch.slice(2, 5);
        this.phase = { kind: 'busy', until: t + COPY_S };
        return;
      case 0xb8:
        this.scratch = [this.scratch[0] ?? 0, this.scratch[1] ?? 0, ...this.eeprom];
        this.phase = { kind: 'busy', until: t };
        return;
      case 0xb4:
        this.phase = { kind: 'transmit', bits: [this.parasite ? 0 : 1], then: 'idle' };
        return;
      default:
        this.phase = { kind: 'idle' };
    }
  }

  /** Alarm flag: the last temperature is above TH or below TL (whole degrees, signed). */
  private alarm(): boolean {
    const t = ((((this.scratch[1] ?? 0) << 8) | (this.scratch[0] ?? 0)) << 16) >> 16;
    const signed = (b: number) => (b << 24) >> 24;
    return t / 16 > signed(this.scratch[2] ?? 0) || t / 16 < signed(this.scratch[3] ?? 0);
  }
}

/** Bits of bytes, LSB first, as 1-Wire sends them. */
const bitsOf = (bytes: readonly number[]): number[] =>
  bytes.flatMap((b) => [0, 1, 2, 3, 4, 5, 6, 7].map((i) => (b >> i) & 1));

/** Dallas/Maxim CRC-8 (x⁸ + x⁵ + x⁴ + 1), as OneWire::crc8 computes it. */
export function crc8(bytes: readonly number[]): number {
  let crc = 0;
  for (const byte of bytes) {
    let b = byte;
    for (let i = 0; i < 8; i++) {
      const mix = (crc ^ b) & 1;
      crc >>= 1;
      if (mix) crc ^= 0x8c;
      b >>= 1;
    }
  }
  return crc;
}
