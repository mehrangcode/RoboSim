import {
  RegisterPort,
  dmath,
  stampPullUp,
  type ComponentIO,
  type ComponentModel,
  type Fault,
  type I2cDevice,
  type Level,
  type MnaStamper,
  type ModelContext,
  type NetId,
  type SpiDevice,
} from '@robosim/sim-core';
import { CALIBRATION, compensateTemperature, rawPressureFor, rawTemperatureFor } from './compensation.js';

export {
  CALIBRATION,
  compensatePressure,
  compensateTemperature,
  rawPressureFor,
  rawTemperatureFor,
} from './compensation.js';

export type Bmp280Props = Record<string, never>;

export interface Bmp280State {
  readonly powered: boolean;
  readonly interface: 'i2c' | 'spi';
  readonly mode: 'sleep' | 'forced' | 'normal';
  readonly temperatureC: number;
  readonly pressurePa: number;
}

const REG = {
  CALIB: 0x88,
  CHIP_ID: 0xd0,
  RESET: 0xe0,
  STATUS: 0xf3,
  CTRL_MEAS: 0xf4,
  CONFIG: 0xf5,
  PRESS: 0xf7,
  TEMP: 0xfa,
} as const;
const CHIP_ID = 0x58;
const SKIPPED = 0x80000;
/** Oversampling counts by the 3-bit osrs field (5–7 mean ×16). */
const OVERSAMPLING = [0, 1, 2, 4, 8, 16, 16, 16] as const;
/** Pressure noise (Pa RMS) by oversampling, from the datasheet's noise table. */
const PRESSURE_NOISE: Readonly<Record<number, number>> = { 1: 3.3, 2: 2.6, 4: 2.1, 8: 1.6, 16: 1.3 };
const TEMPERATURE_NOISE_C = 0.005;
/** Standby times of normal mode by t_sb (ms). */
const STANDBY_MS = [0.5, 62.5, 125, 250, 500, 1000, 2000, 4000] as const;
/** IIR coefficient by the filter field. */
const FILTER = [1, 2, 4, 8, 16, 16, 16, 16] as const;
/** The module has no regulator: VDD 1.71–3.6 V, absolute maximum 4.25 V. */
const MIN_VDD = 1.71;
const MAX_VDD = 3.6;
const ABS_MAX_VDD = 4.25;
/** 10 kΩ pull-ups on SDA, SCL and CSB, and a 10 kΩ pull-down on SDO (address 0x76). */
const PULL_OHMS = 10_000;
const SPI_SELECT_V = 0.3;
const SUPPLY_A = 0.3e-3;
const SLEEP_A = 1e-6;

/**
 * BMP280 pressure and temperature sensor on the common 3.3 V breakout (Technical Design §5.5,
 * Tier C). It reports raw ADC words that the datasheet compensation (which Adafruit_BMP280 runs on
 * the Uno) turns into the bench or arena temperature and the pressure at its altitude, with
 * oversampling noise, the IIR filter, conversion time and the measuring flag. The interface follows
 * the chip: I²C (SDO picks 0x76 / 0x77) until CSB is pulled low once, then SPI until power-off.
 */
export class Bmp280 implements ComponentModel<Bmp280Props, Bmp280State> {
  readonly type = 'sensor.bmp280';
  private id = '';
  private vccNet: NetId = 0;
  private gnd: NetId = 0;
  private sclNet: NetId = 0;
  private sdaNet: NetId = 0;
  private csbNet: NetId = 0;
  private sdoNet: NetId = 0;
  private random: () => number = () => 0.5;
  private regs = defaults();
  private readonly port = new RegisterPort({
    read: (r, t) => this.readRegister(r, t),
    write: (r, v, t) => this.writeRegister(r, v, t),
  });
  private i2cDevice: I2cDevice | null = null;
  private spiDevice: SpiDevice | null = null;
  private vdd = 0;
  private powered = false;
  private spiMode = false;
  private sdoHigh = false;
  private inputs = { temperatureC: 22, altitudeM: 0 };
  /** Conversion in progress: when it ends (s); start of the normal-mode schedule. */
  private busyUntil = -1;
  private cycleStart = 0;
  private filteredT: number | null = null;
  private filteredP: number | null = null;
  /** SPI frame: expecting the control byte, or reading / writing from a register. */
  private spiFrame: { phase: 'control' | 'read' | 'writeData'; reg: number } = { phase: 'control', reg: 0 };

  init(ctx: ModelContext): void {
    this.id = ctx.id;
    this.vccNet = ctx.net('vcc');
    this.gnd = ctx.net('gnd');
    this.sclNet = ctx.net('scl');
    this.sdaNet = ctx.net('sda');
    this.csbNet = ctx.net('csb');
    this.sdoNet = ctx.net('sdo');
    this.random = () => ctx.random();
    this.i2cDevice = {
      sda: this.sdaNet,
      scl: this.sclNet,
      address: () => (this.powered && !this.spiMode ? (this.sdoHigh ? 0x77 : 0x76) : null),
      begin: (read) => {
        this.port.begin(read);
        return true;
      },
      write: (byte, time) => this.port.write(byte, time),
      read: (_ack, time) => this.port.read(time),
      end: () => undefined,
    };
    this.spiDevice = {
      sck: this.sclNet,
      mosi: this.sdaNet,
      miso: this.sdoNet,
      cs: this.csbNet,
      transfer: (byte, time) => this.spiTransfer(byte, time),
    };
  }

  i2c(): I2cDevice | null {
    return this.i2cDevice;
  }

  spi(): SpiDevice | null {
    return this.spiDevice;
  }

  /** CSB edges frame SPI transfers (and the first LOW selects SPI for good). */
  logicNets(): { inputs: NetId[]; outputs: NetId[] } {
    return { inputs: [this.csbNet], outputs: [] };
  }

  mcuEdge(net: NetId, level: Level): void {
    if (net !== this.csbNet || !this.powered) return;
    if (level === 0) this.spiMode = true;
    this.spiFrame = { phase: 'control', reg: 0 };
  }

  input(name: string, value: number | boolean): void {
    if (typeof value !== 'number' || !(name in this.inputs))
      throw new Error(`sensor.bmp280: bad input '${name}'`);
    this.inputs = { ...this.inputs, [name]: value };
  }

  stamp(s: MnaStamper): void {
    const g = this.gnd;
    for (const n of [this.sdaNet, this.sclNet, this.csbNet])
      stampPullUp(s, n, g, PULL_OHMS, { net: this.vccNet });
    s.conductance(this.sdoNet, g, 1 / PULL_OHMS);
    const normal = (this.regs[REG.CTRL_MEAS] ?? 0) & 0x03;
    s.currentSource(this.vccNet, g, !this.powered ? 0 : normal === 3 ? SUPPLY_A : SLEEP_A);
  }

  step(_dt: number, io: ComponentIO): void {
    const sol = io.solution;
    const rel = (n: NetId) => sol.voltage(n) - sol.voltage(this.gnd);
    this.vdd = rel(this.vccNet);
    const powered = this.vdd >= MIN_VDD;
    if (powered !== this.powered) {
      this.powered = powered;
      this.regs = defaults();
      this.spiMode = false;
      this.busyUntil = -1;
      this.filteredT = null;
      this.filteredP = null;
      io.invalidate();
    }
    if (!powered) return;
    this.sdoHigh = rel(this.sdoNet) > 0.5 * this.vdd;
    if (rel(this.csbNet) < SPI_SELECT_V * this.vdd) this.spiMode = true; // CSB tied or held low
    this.update(io.now);
  }

  /** Powered long before the sketch starts: past its 2 ms start-up. */
  powerOn(io: ComponentIO): void {
    this.step(0, io);
  }

  faults(): readonly Fault[] {
    return this.vdd > MAX_VDD
      ? [
          {
            code: 'OVER_VOLTAGE',
            componentId: this.id,
            params: { volts: this.vdd, limitV: this.vdd > ABS_MAX_VDD ? ABS_MAX_VDD : MAX_VDD },
          },
        ]
      : [];
  }

  snapshot(): Bmp280State {
    const mode = (this.regs[REG.CTRL_MEAS] ?? 0) & 0x03;
    return {
      powered: this.powered,
      interface: this.spiMode ? 'spi' : 'i2c',
      mode: mode === 0 ? 'sleep' : mode === 3 ? 'normal' : 'forced',
      temperatureC: this.inputs.temperatureC,
      pressurePa: this.truePressure(),
    };
  }

  /** International standard atmosphere: pressure at the sensor's altitude (Pa). */
  private truePressure(): number {
    return 101325 * dmath.exp(5.25588 * dmath.log(1 - 2.25577e-5 * this.inputs.altitudeM));
  }

  private oversampling(): { t: number; p: number } {
    const ctrl = this.regs[REG.CTRL_MEAS] ?? 0;
    return { t: OVERSAMPLING[(ctrl >> 5) & 0x07] ?? 0, p: OVERSAMPLING[(ctrl >> 2) & 0x07] ?? 0 };
  }

  /** Typical conversion time (datasheet §3.8.1): 1 + 2·T_os + 2·P_os + 0.5 ms. */
  private measurementS(): number {
    const { t, p } = this.oversampling();
    return (1 + 2 * t + (p > 0 ? 2 * p + 0.5 : 0)) / 1000;
  }

  /** Completes conversions due by `t`: forced mode once, normal mode every conversion + standby. */
  private update(t: number): void {
    const mode = (this.regs[REG.CTRL_MEAS] ?? 0) & 0x03;
    if (mode === 3) {
      const cycle =
        this.measurementS() + (STANDBY_MS[((this.regs[REG.CONFIG] ?? 0) >> 5) & 0x07] ?? 0.5) / 1000;
      while (this.cycleStart + this.measurementS() <= t) {
        this.convert();
        this.cycleStart += cycle;
      }
      this.busyUntil = this.cycleStart + this.measurementS();
    } else if (this.busyUntil >= 0 && t >= this.busyUntil) {
      this.convert();
      this.busyUntil = -1;
      this.regs[REG.CTRL_MEAS] = (this.regs[REG.CTRL_MEAS] ?? 0) & ~0x03; // back to sleep
    }
  }

  /** One conversion: true values + noise, through the IIR filter, as raw words for the compensation. */
  private convert(): void {
    const { t: osT, p: osP } = this.oversampling();
    const coeff = FILTER[((this.regs[REG.CONFIG] ?? 0) >> 2) & 0x07] ?? 1;
    const iir = (prev: number | null, x: number) => (prev === null ? x : (prev * (coeff - 1) + x) / coeff);
    const tempC =
      this.inputs.temperatureC + (osT > 0 ? (TEMPERATURE_NOISE_C / Math.sqrt(osT)) * this.gaussian() : 0);
    const press = this.truePressure() + (osP > 0 ? (PRESSURE_NOISE[osP] ?? 1.3) * this.gaussian() : 0);
    this.filteredT = iir(this.filteredT, tempC);
    this.filteredP = iir(this.filteredP, press);
    const rawT = osT > 0 ? rawTemperatureFor(this.filteredT) : SKIPPED;
    const rawP =
      osP > 0 && osT > 0 ? rawPressureFor(this.filteredP, compensateTemperature(rawT).tFine) : SKIPPED;
    this.put20(REG.TEMP, rawT);
    this.put20(REG.PRESS, rawP);
  }

  private put20(reg: number, raw: number): void {
    this.regs[reg] = (raw >> 12) & 0xff;
    this.regs[reg + 1] = (raw >> 4) & 0xff;
    this.regs[reg + 2] = (raw & 0x0f) << 4;
  }

  private gaussian(): number {
    const u1 = Math.max(1e-12, this.random());
    const u2 = this.random();
    return Math.sqrt(-2 * dmath.log(u1)) * dmath.cos(2 * Math.PI * u2);
  }

  private readRegister(reg: number, t: number): number {
    this.update(t);
    if (reg === REG.STATUS) return t < this.busyUntil ? 0x08 : 0x00;
    return this.regs[reg] ?? 0;
  }

  private writeRegister(reg: number, value: number, t: number): void {
    if (reg === REG.RESET) {
      if (value === 0xb6) {
        this.regs = defaults();
        this.busyUntil = -1;
        this.filteredT = null;
        this.filteredP = null;
      }
      return;
    }
    if (reg !== REG.CTRL_MEAS && reg !== REG.CONFIG) return; // everything else is read-only
    this.update(t);
    this.regs[reg] = value;
    if (reg !== REG.CTRL_MEAS) return;
    const mode = value & 0x03;
    if (mode === 1 || mode === 2) this.busyUntil = t + this.measurementS();
    else if (mode === 3) this.cycleStart = t;
    else this.busyUntil = -1;
  }

  /** SPI frame: a control byte (bit 7 = read, 7-bit register | 0x80), then data. */
  private spiTransfer(byte: number, t: number): number {
    if (!this.powered || !this.spiMode) return 0xff;
    if (this.spiFrame.phase === 'control') {
      const reg = (byte & 0x7f) | 0x80;
      this.spiFrame = { phase: byte & 0x80 ? 'read' : 'writeData', reg };
      return 0xff;
    }
    if (this.spiFrame.phase === 'read') {
      const value = this.readRegister(this.spiFrame.reg, t);
      this.spiFrame = { phase: 'read', reg: (this.spiFrame.reg + 1) & 0xff };
      return value;
    }
    this.writeRegister(this.spiFrame.reg, byte, t);
    this.spiFrame = { phase: 'control', reg: 0 }; // writes alternate control and data bytes
    return 0xff;
  }
}

function defaults(): Uint8Array {
  const regs = new Uint8Array(0x100);
  regs[REG.CHIP_ID] = CHIP_ID;
  const words: readonly (readonly [number, boolean])[] = [
    [CALIBRATION.T1, false],
    [CALIBRATION.T2, true],
    [CALIBRATION.T3, true],
    [CALIBRATION.P1, false],
    [CALIBRATION.P2, true],
    [CALIBRATION.P3, true],
    [CALIBRATION.P4, true],
    [CALIBRATION.P5, true],
    [CALIBRATION.P6, true],
    [CALIBRATION.P7, true],
    [CALIBRATION.P8, true],
    [CALIBRATION.P9, true],
  ];
  words.forEach(([value], i) => {
    const v = value & 0xffff; // little-endian, two's complement for the signed words
    regs[REG.CALIB + 2 * i] = v & 0xff;
    regs[REG.CALIB + 2 * i + 1] = v >> 8;
  });
  regs[REG.PRESS] = 0x80;
  regs[REG.TEMP] = 0x80;
  return regs;
}
