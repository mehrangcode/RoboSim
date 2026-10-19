import {
  RegisterPort,
  dmath,
  sonarRange,
  stampPullUp,
  type ComponentIO,
  type ComponentModel,
  type Fault,
  type I2cDevice,
  type Level,
  type MnaStamper,
  type ModelContext,
  type NetId,
} from '@robosim/sim-core';

export type Vl53l0xProps = Record<string, never>;

export interface Vl53l0xState {
  readonly powered: boolean;
  /** Current 7-bit address (0x29 after reset; `setAddress` changes it until power-off or XSHUT). */
  readonly address: number;
  readonly mode: 'standby' | 'single' | 'continuous';
  /** Last reported range (mm); 8190 when nothing was in range. */
  readonly rangeMm: number | null;
  readonly timingBudgetUs: number;
}

/** Page-0 registers the Pololu library and ST's API use (names as in VL53L0X.h). */
export const REG = {
  SYSRANGE_START: 0x00,
  SYSTEM_SEQUENCE_CONFIG: 0x01,
  SYSTEM_INTERMEASUREMENT_PERIOD: 0x04,
  SYSTEM_INTERRUPT_CONFIG_GPIO: 0x0a,
  SYSTEM_INTERRUPT_CLEAR: 0x0b,
  RESULT_INTERRUPT_STATUS: 0x13,
  RESULT_RANGE_STATUS: 0x14,
  FINAL_RANGE_CONFIG_MIN_COUNT_RATE_RTN_LIMIT: 0x44,
  MSRC_CONFIG_TIMEOUT_MACROP: 0x46,
  PRE_RANGE_CONFIG_VCSEL_PERIOD: 0x50,
  PRE_RANGE_CONFIG_TIMEOUT_MACROP_HI: 0x51,
  MSRC_CONFIG_CONTROL: 0x60,
  FINAL_RANGE_CONFIG_VCSEL_PERIOD: 0x70,
  FINAL_RANGE_CONFIG_TIMEOUT_MACROP_HI: 0x71,
  GPIO_HV_MUX_ACTIVE_HIGH: 0x84,
  VHV_CONFIG_PAD_SCL_SDA__EXTSUP_HV: 0x89,
  I2C_SLAVE_DEVICE_ADDRESS: 0x8a,
  GLOBAL_CONFIG_SPAD_ENABLES_REF_0: 0xb0,
  IDENTIFICATION_MODEL_ID: 0xc0,
  OSC_CALIBRATE_VAL: 0xf8,
  PAGE: 0xff,
} as const;

const DEFAULT_ADDRESS = 0x29;
/** Range status byte (device range status in bits 6:3): 11 = valid, 4 = phase fail (no target). */
const STATUS_VALID = 11 << 3;
const STATUS_NO_TARGET = 4 << 3;
const OUT_OF_RANGE_MM = 8190;
/** Field of view 25°; default-mode range to a white target 1.2 m, long-range (≤ 0.1 MCPS) 2 m. */
const FOV_DEG = 25;
const MAX_RANGE_M = 1.2;
const LONG_RANGE_M = 2;
/** Ranging noise at the default 33 ms budget: 2 mm + 1.5 % (σ), ∝ 1/√budget. */
const NOISE_MM = 2;
const NOISE_FRACTION = 0.015;
const DEFAULT_BUDGET_US = 33_000;
/** Reference (VHV / phase) calibration duration. */
const REF_CAL_S = 2e-3;
/** Firmware boot after power-up or XSHUT release (datasheet t_BOOT). */
const BOOT_S = 1.2e-3;
/** Breakout (Pololu / GY-530): 2.8 V regulator on VIN, 10 kΩ pull-ups to VIN on SDA, SCL, GPIO1, XSHUT. */
const MIN_VIN = 2.6;
const MAX_VIN = 5.5;
const PULL_OHMS = 10_000;
const XSHUT_HIGH_V = 1.4;
const GPIO_ON_OHMS = 30;
const RANGING_A = 19e-3;
const STANDBY_A = 5e-6;

/**
 * VL53L0X time-of-flight ranger on the common breakout (Technical Design §5.5, Tier C). It speaks the
 * register protocol the Pololu VL53L0X library drives — paged registers, the SPAD-info handshake,
 * reference calibration, single-shot, back-to-back and timed continuous ranging — and measures the
 * nearest surface across a 25° cone from its mounted pose (or the bench distance). The measurement
 * takes the timing budget encoded in its timeout registers; GPIO1 signals new samples; XSHUT holds it
 * in reset so several sensors can be given distinct addresses.
 */
export class Vl53l0x implements ComponentModel<Vl53l0xProps, Vl53l0xState> {
  readonly type = 'sensor.vl53l0x';
  private id = '';
  private vinNet: NetId = 0;
  private gnd: NetId = 0;
  private sclNet: NetId = 0;
  private sdaNet: NetId = 0;
  private gpioNet: NetId = 0;
  private xshutNet: NetId = 0;
  private random: () => number = () => 0.5;
  private pages = new Map<number, Uint8Array>();
  private readonly port = new RegisterPort({
    read: (r, t) => this.readRegister(r, t),
    write: (r, v, t) => this.writeRegister(r, v, t),
  });
  private device: I2cDevice | null = null;
  private vin = 0;
  private on = false;
  private readyAt = 0;
  private benchMm = 300;
  private continuous: 'off' | 'backToBack' | 'timed' = 'off';
  /** Completion of the measurement in progress (s), or -1. */
  private doneAt = -1;
  private rangeMm: number | null = null;
  private lastPose: { distanceM: number | null; mounted: boolean } = { distanceM: null, mounted: false };
  private stampedGpio = false;
  private stampedRanging = false;

  init(ctx: ModelContext): void {
    this.id = ctx.id;
    this.vinNet = ctx.net('vin');
    this.gnd = ctx.net('gnd');
    this.sclNet = ctx.net('scl');
    this.sdaNet = ctx.net('sda');
    this.gpioNet = ctx.net('gpio1');
    this.xshutNet = ctx.net('xshut');
    this.random = () => ctx.random();
    this.reset();
    this.device = {
      sda: this.sdaNet,
      scl: this.sclNet,
      address: () => (this.on ? this.address() : null),
      begin: (read, time) => {
        if (time < this.readyAt) return false; // still booting: NACK
        this.port.begin(read);
        return true;
      },
      write: (byte, time) => this.port.write(byte, time),
      read: (_ack, time) => this.port.read(time),
      end: () => undefined,
    };
  }

  i2c(): I2cDevice | null {
    return this.device;
  }

  input(name: string, value: number | boolean): void {
    if (name !== 'distanceMm' || typeof value !== 'number')
      throw new Error(`sensor.vl53l0x: bad input '${name}'`);
    this.benchMm = value;
  }

  stamp(s: MnaStamper): void {
    const g = this.gnd;
    for (const n of [this.sdaNet, this.sclNet, this.gpioNet, this.xshutNet])
      stampPullUp(s, n, g, PULL_OHMS, { net: this.vinNet });
    this.stampedGpio = this.on && this.gpioAsserted();
    if (this.stampedGpio) s.conductance(this.gpioNet, g, 1 / GPIO_ON_OHMS);
    this.stampedRanging = this.on && this.ranging();
    s.currentSource(this.vinNet, g, !this.on ? 0 : this.stampedRanging ? RANGING_A : STANDBY_A);
  }

  step(_dt: number, io: ComponentIO): void {
    const sol = io.solution;
    const rel = (n: NetId) => sol.voltage(n) - sol.voltage(this.gnd);
    this.vin = rel(this.vinNet);
    const on = this.vin >= MIN_VIN && rel(this.xshutNet) > XSHUT_HIGH_V;
    if (on !== this.on) {
      this.on = on;
      this.reset();
      this.readyAt = io.now + BOOT_S;
      io.invalidate();
    }
    if (!on) return;
    const pose = io.world?.componentPose(this.id) ?? null;
    this.lastPose =
      pose && io.world
        ? {
            mounted: true,
            distanceM: sonarRange(io.world, pose, { coneDeg: FOV_DEG, rays: 5, minM: 0, maxM: 4 }),
          }
        : { mounted: false, distanceM: this.benchMm / 1000 };
    this.update(io.now);
    this.scheduleGpio(io);
    if (this.gpioAsserted() !== this.stampedGpio || this.ranging() !== this.stampedRanging) io.invalidate();
  }

  /** Powered long before the sketch starts: already booted unless XSHUT holds it in reset. */
  powerOn(io: ComponentIO): void {
    this.step(0, io);
    this.readyAt = io.now;
  }

  faults(): readonly Fault[] {
    return this.vin > MAX_VIN
      ? [{ code: 'OVER_VOLTAGE', componentId: this.id, params: { volts: this.vin, limitV: MAX_VIN } }]
      : [];
  }

  snapshot(): Vl53l0xState {
    return {
      powered: this.on,
      address: this.address(),
      mode: this.continuous !== 'off' ? 'continuous' : this.doneAt >= 0 ? 'single' : 'standby',
      rangeMm: this.rangeMm,
      timingBudgetUs: measurementTimingBudgetUs((r) => this.page(0)[r] ?? 0),
    };
  }

  private address(): number {
    return (this.page(0)[REG.I2C_SLAVE_DEVICE_ADDRESS] ?? DEFAULT_ADDRESS) & 0x7f;
  }

  private page(n: number): Uint8Array {
    let p = this.pages.get(n);
    if (!p) {
      p = new Uint8Array(0x100);
      this.pages.set(n, p);
    }
    return p;
  }

  private reset(): void {
    this.pages = new Map();
    const p0 = this.page(0);
    p0[REG.IDENTIFICATION_MODEL_ID] = 0xee;
    p0[0xc1] = 0xaa;
    p0[0xc2] = 0x10; // revision
    p0[REG.I2C_SLAVE_DEVICE_ADDRESS] = DEFAULT_ADDRESS;
    p0[REG.SYSTEM_SEQUENCE_CONFIG] = 0xff;
    p0[REG.GPIO_HV_MUX_ACTIVE_HIGH] = 0x11;
    p0[REG.FINAL_RANGE_CONFIG_MIN_COUNT_RATE_RTN_LIMIT + 1] = 0x20; // 0.25 MCPS (Q9.7)
    // Timeouts the library's tuning settings also load: a 33 ms budget with the sequence enabled.
    p0[REG.MSRC_CONFIG_TIMEOUT_MACROP] = 0x25;
    p0[REG.PRE_RANGE_CONFIG_VCSEL_PERIOD] = 0x06;
    p0[REG.PRE_RANGE_CONFIG_TIMEOUT_MACROP_HI + 1] = 0x96;
    p0[REG.FINAL_RANGE_CONFIG_VCSEL_PERIOD] = 0x04;
    p0[REG.FINAL_RANGE_CONFIG_TIMEOUT_MACROP_HI] = 0x01;
    p0[REG.FINAL_RANGE_CONFIG_TIMEOUT_MACROP_HI + 1] = 0xfe;
    p0.fill(0xff, REG.GLOBAL_CONFIG_SPAD_ENABLES_REF_0, REG.GLOBAL_CONFIG_SPAD_ENABLES_REF_0 + 6);
    this.page(1)[0x91] = 0x3c; // stop variable read during init
    this.page(7)[0x92] = 0x85; // SPAD info: 5 aperture SPADs
    this.continuous = 'off';
    this.doneAt = -1;
    this.rangeMm = null;
  }

  private ranging(): boolean {
    return this.continuous !== 'off' || this.doneAt >= 0;
  }

  private currentPage(): number {
    return this.page(0)[REG.PAGE] ?? 0;
  }

  private budgetS(): number {
    return measurementTimingBudgetUs((r) => this.page(0)[r] ?? 0) / 1e6;
  }

  /** Continuous period: the budget back to back, or the inter-measurement period when longer. */
  private periodS(): number {
    if (this.continuous !== 'timed') return this.budgetS();
    const p0 = this.page(0);
    const r = REG.SYSTEM_INTERMEASUREMENT_PERIOD;
    const ticks =
      (((p0[r] ?? 0) << 24) | ((p0[r + 1] ?? 0) << 16) | ((p0[r + 2] ?? 0) << 8) | (p0[r + 3] ?? 0)) >>> 0;
    const osc = ((p0[REG.OSC_CALIBRATE_VAL] ?? 0) << 8) | (p0[REG.OSC_CALIBRATE_VAL + 1] ?? 0);
    return Math.max(this.budgetS(), (osc > 0 ? ticks / osc : ticks) / 1000);
  }

  /** Completes the measurements due by `t`. */
  private update(t: number): void {
    while (this.doneAt >= 0 && t >= this.doneAt) {
      const at = this.doneAt;
      this.complete();
      this.doneAt = this.continuous !== 'off' ? at + this.periodS() : -1;
    }
  }

  private complete(): void {
    const p0 = this.page(0);
    const limit = (((p0[0x44] ?? 0) << 8) | (p0[0x45] ?? 0)) / 128;
    const maxM = limit > 0 && limit <= 0.1 ? LONG_RANGE_M : MAX_RANGE_M;
    const d = this.lastPose.distanceM;
    let mm = OUT_OF_RANGE_MM;
    if (d !== null && d <= maxM) {
      const sigma =
        (NOISE_MM + NOISE_FRACTION * d * 1000) * Math.sqrt(DEFAULT_BUDGET_US / 1e6 / this.budgetS());
      mm = Math.max(0, Math.min(OUT_OF_RANGE_MM - 1, Math.round(d * 1000 + sigma * this.gaussian())));
    }
    this.rangeMm = mm;
    p0[REG.RESULT_RANGE_STATUS] = mm === OUT_OF_RANGE_MM ? STATUS_NO_TARGET : STATUS_VALID;
    p0[REG.RESULT_RANGE_STATUS + 10] = mm >> 8;
    p0[REG.RESULT_RANGE_STATUS + 11] = mm & 0xff;
    p0[REG.RESULT_INTERRUPT_STATUS] = 0x04; // new sample ready
  }

  private gaussian(): number {
    const u1 = Math.max(1e-12, this.random());
    const u2 = this.random();
    return Math.sqrt(-2 * dmath.log(u1)) * dmath.cos(2 * Math.PI * u2);
  }

  /** GPIO1 (open drain): asserted while an enabled interrupt is pending; polarity from bit 4 of 0x84. */
  private gpioAsserted(): boolean {
    const p0 = this.page(0);
    const pending =
      (p0[REG.SYSTEM_INTERRUPT_CONFIG_GPIO] ?? 0) !== 0 && (p0[REG.RESULT_INTERRUPT_STATUS] ?? 0) !== 0;
    const activeHigh = ((p0[REG.GPIO_HV_MUX_ACTIVE_HIGH] ?? 0) & 0x10) !== 0;
    return pending !== activeHigh; // pulls low when (active low and pending) or (active high and idle)
  }

  /** Sample-ready edges in the next slice reach the MCU at their exact time (the stamp follows). */
  private scheduleGpio(io: ComponentIO): void {
    const p0 = this.page(0);
    if ((p0[REG.SYSTEM_INTERRUPT_CONFIG_GPIO] ?? 0) === 0 || (p0[REG.RESULT_INTERRUPT_STATUS] ?? 0) !== 0)
      return;
    if (this.doneAt < 0 || this.doneAt > io.now + 1e-3) return;
    const activeHigh = ((p0[REG.GPIO_HV_MUX_ACTIVE_HIGH] ?? 0) & 0x10) !== 0;
    io.scheduleMcuInput(this.gpioNet, (activeHigh ? 1 : 0) as Level, this.doneAt);
  }

  private readRegister(reg: number, t: number): number {
    this.update(t);
    const page = this.currentPage();
    if (reg === REG.PAGE) return page;
    const p = this.page(page);
    if (page === 0 && reg === REG.SYSRANGE_START) return (p[reg] ?? 0) & ~0x01; // start bit clears at once
    if (page === 7 && reg === 0x83 && (p[reg] ?? 0) === 0) return 0x10; // SPAD-info handshake done
    return p[reg] ?? 0;
  }

  private writeRegister(reg: number, value: number, t: number): void {
    this.update(t);
    if (reg === REG.PAGE) {
      this.page(0)[REG.PAGE] = value;
      return;
    }
    const page = this.currentPage();
    this.page(page)[reg] = value;
    if (page !== 0) return;
    if (reg === REG.SYSTEM_INTERRUPT_CLEAR && value & 0x01) this.page(0)[REG.RESULT_INTERRUPT_STATUS] = 0;
    if (reg === REG.SYSRANGE_START) this.start(value, t);
  }

  /** SYSRANGE_START: 0x02 back-to-back, 0x04 timed, 0x01 single shot (or stop while continuous). */
  private start(value: number, t: number): void {
    if (value & 0x02 || value & 0x04) {
      this.continuous = value & 0x04 ? 'timed' : 'backToBack';
      this.doneAt = t + this.budgetS();
    } else if (value & 0x01) {
      if (this.continuous !== 'off') {
        this.continuous = 'off';
        this.doneAt = -1;
      } else {
        this.doneAt =
          t +
          (value & 0x40 || this.page(0)[REG.SYSTEM_SEQUENCE_CONFIG] === 0x02 ? REF_CAL_S : this.budgetS());
      }
    }
  }
}

/** Measurement timing budget (µs) encoded in the sequence and timeout registers (Pololu's formula). */
export function measurementTimingBudgetUs(reg: (r: number) => number): number {
  const seq = reg(REG.SYSTEM_SEQUENCE_CONFIG);
  const tcc = (seq >> 4) & 1;
  const dss = (seq >> 3) & 1;
  const msrc = (seq >> 2) & 1;
  const preRange = (seq >> 6) & 1;
  const finalRange = (seq >> 7) & 1;
  const decodeVcsel = (v: number) => (v + 1) << 1;
  const macroNs = (pclks: number) => Math.floor((2304 * pclks * 1655 + 500) / 1000);
  const toUs = (mclks: number, pclks: number) => Math.floor((mclks * macroNs(pclks) + 500) / 1000);
  const decodeTimeout = (v: number) => ((v & 0xff) << ((v >> 8) & 0xff)) + 1;
  const reg16 = (r: number) => (reg(r) << 8) | reg(r + 1);
  const prePclks = decodeVcsel(reg(REG.PRE_RANGE_CONFIG_VCSEL_PERIOD));
  const msrcUs = toUs(reg(REG.MSRC_CONFIG_TIMEOUT_MACROP) + 1, prePclks);
  const preMclks = decodeTimeout(reg16(REG.PRE_RANGE_CONFIG_TIMEOUT_MACROP_HI));
  const preUs = toUs(preMclks, prePclks);
  let finalMclks = decodeTimeout(reg16(REG.FINAL_RANGE_CONFIG_TIMEOUT_MACROP_HI));
  if (preRange) finalMclks -= preMclks;
  const finalUs = toUs(finalMclks, decodeVcsel(reg(REG.FINAL_RANGE_CONFIG_VCSEL_PERIOD)));
  let budget = 1910 + 960;
  if (tcc) budget += msrcUs + 590;
  if (dss) budget += 2 * (msrcUs + 690);
  else if (msrc) budget += msrcUs + 660;
  if (preRange) budget += preUs + 660;
  if (finalRange) budget += finalUs + 550;
  return budget;
}
