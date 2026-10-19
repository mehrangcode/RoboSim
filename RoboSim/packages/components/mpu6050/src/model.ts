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
  type SourceHandle,
  type Vec2,
} from '@robosim/sim-core';

export type Mpu6050Props = Record<string, never>;

export interface Mpu6050State {
  readonly powered: boolean;
  readonly sleeping: boolean;
  readonly address: number;
  /** Specific force on the sensor axes (g) and rotation rates (°/s), before offsets and noise. */
  readonly accelG: readonly [number, number, number];
  readonly gyroDps: readonly [number, number, number];
  readonly temperatureC: number;
}

/** Register addresses (MPU-6000/6050 register map, rev 4.2). */
export const REG = {
  SMPLRT_DIV: 0x19,
  CONFIG: 0x1a,
  GYRO_CONFIG: 0x1b,
  ACCEL_CONFIG: 0x1c,
  INT_PIN_CFG: 0x37,
  INT_ENABLE: 0x38,
  INT_STATUS: 0x3a,
  ACCEL_XOUT_H: 0x3b,
  TEMP_OUT_H: 0x41,
  GYRO_XOUT_H: 0x43,
  SIGNAL_PATH_RESET: 0x68,
  PWR_MGMT_1: 0x6b,
  WHO_AM_I: 0x75,
} as const;

const G = 9.80665;
const DEG = 180 / Math.PI;
/** DLPF corner frequencies by DLPF_CFG (accelerometer, gyroscope) in Hz. */
const ACCEL_BW = [260, 184, 94, 44, 21, 10, 5, 260] as const;
const GYRO_BW = [256, 188, 98, 42, 20, 10, 5, 256] as const;
/** Noise densities: accelerometer 400 µg/√Hz, gyroscope 0.005 °/s/√Hz. */
const ACCEL_NOISE = 400e-6;
const GYRO_NOISE = 0.005;
/** Seeded factory offsets: accelerometer ±20 mg, gyroscope ±2 °/s (the reason gyro readings drift). */
const ACCEL_OFFSET_G = 0.02;
const GYRO_OFFSET_DPS = 2;
/** The die runs a few degrees above ambient when awake. */
const AMBIENT_C = 25;
const SELF_HEATING_C = 4;
/** GY-521: LDO from 3.3–5 V; 2.2 kΩ bus pull-ups and a 4.7 kΩ AD0 pull-down. */
const MIN_VCC = 3;
const MAX_VCC = 6;
const LDO_V = 3.3;
const PULLUP_OHMS = 2200;
const AD0_PULLDOWN_OHMS = 4700;
const AD0_HIGH_V = 0.7 * LDO_V;
const SUPPLY_A = 3.9e-3;
const SLEEP_A = 10e-6;
const INT_OHMS = 100;
/** Data-ready pulse width on INT when not latched (s). */
const INT_PULSE_S = 50e-6;

/**
 * MPU-6050 6-axis IMU on a GY-521 breakout (Technical Design §5.5, Tier C). The register map covers
 * what Adafruit_MPU6050 and raw-Wire sketches use: reset and sleep, sample rate, DLPF, ranges, data
 * and temperature registers, data-ready status and the INT pin. Mounted on a robot it measures the
 * body's acceleration (plus 1 g up) and yaw rate; on the bench its tilt and turn-rate inputs do.
 * Each sensor has its own seeded offsets and noise, so an uncalibrated gyro drifts.
 */
export class Mpu6050 implements ComponentModel<Mpu6050Props, Mpu6050State> {
  readonly type = 'sensor.mpu6050';
  private id = '';
  private vccNet: NetId = 0;
  private gnd: NetId = 0;
  private sdaNet: NetId = 0;
  private sclNet: NetId = 0;
  private ad0Net: NetId = 0;
  private intNet: NetId = 0;
  private random: () => number = () => 0.5;
  private regs = defaults();
  private readonly port = new RegisterPort({
    read: (r, t) => this.readRegister(r, t),
    write: (r, v, t) => this.writeRegister(r, v, t),
  });
  private device: I2cDevice | null = null;
  private vcc = 0;
  private powered = false;
  private ad0High = false;
  private intHandle: SourceHandle | null = null;
  private stampedInt: Level = 0;
  private bench = { tiltX: 0, tiltY: 0, turnRate: 0 };
  /** True signal (sensor frame): specific force (g), rates (°/s). */
  private accel: [number, number, number] = [0, 0, 1];
  private gyro: [number, number, number] = [0, 0, 0];
  private readonly accelOffset: [number, number, number] = [0, 0, 0];
  private readonly gyroOffset: [number, number, number] = [0, 0, 0];
  /** DLPF outputs and when sampling last ran. */
  private filtered = [0, 0, 1, 0, 0, 0];
  /** Last internal clock tick, internal ticks since the last output sample, and that sample's time. */
  private lastTick = 0;
  private tickCount = 0;
  private lastSample = 0;
  private velocities: (Vec2 | null)[] = [null, null, null];
  private now = 0;

  init(ctx: ModelContext): void {
    this.id = ctx.id;
    this.vccNet = ctx.net('vcc');
    this.gnd = ctx.net('gnd');
    this.sdaNet = ctx.net('sda');
    this.sclNet = ctx.net('scl');
    this.ad0Net = ctx.net('ad0');
    this.intNet = ctx.net('int');
    this.random = () => ctx.random();
    for (let i = 0; i < 3; i++) {
      this.accelOffset[i] = (2 * ctx.random() - 1) * ACCEL_OFFSET_G;
      this.gyroOffset[i] = (2 * ctx.random() - 1) * GYRO_OFFSET_DPS;
    }
    this.device = {
      sda: this.sdaNet,
      scl: this.sclNet,
      address: () => (this.powered ? this.address() : null),
      begin: (read) => {
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
    if (typeof value !== 'number' || !(name in this.bench))
      throw new Error(`sensor.mpu6050: bad input '${name}'`);
    this.bench = { ...this.bench, [name]: value };
  }

  stamp(s: MnaStamper): void {
    const g = this.gnd;
    s.conductance(this.ad0Net, g, 1 / AD0_PULLDOWN_OHMS);
    s.currentSource(this.vccNet, g, this.powered ? (this.sleeping() ? SLEEP_A : SUPPLY_A) : 0);
    this.intHandle = null;
    if (!this.powered) return;
    stampPullUp(s, this.sdaNet, g, PULLUP_OHMS, { volts: LDO_V });
    stampPullUp(s, this.sclNet, g, PULLUP_OHMS, { volts: LDO_V });
    this.stampedInt = this.intLevel();
    this.intHandle = s.voltageSource(this.intNet, g, this.stampedInt ? LDO_V : 0, INT_OHMS);
  }

  step(dt: number, io: ComponentIO): void {
    const sol = io.solution;
    this.vcc = sol.voltage(this.vccNet) - sol.voltage(this.gnd);
    this.now = io.now;
    const powered = this.vcc >= MIN_VCC;
    if (powered !== this.powered) {
      this.powered = powered;
      this.regs = defaults(); // power-on reset: asleep, every register at its default
      io.invalidate();
    }
    this.ad0High = sol.voltage(this.ad0Net) - sol.voltage(this.gnd) > AD0_HIGH_V;
    this.measure(dt, io);
    this.sample(io.now);
    if (this.powered && this.intLevel() !== this.stampedInt) io.invalidate();
    this.scheduleDataReadyPulses(io);
  }

  faults(): readonly Fault[] {
    return this.vcc > MAX_VCC
      ? [{ code: 'OVER_VOLTAGE', componentId: this.id, params: { volts: this.vcc, limitV: MAX_VCC } }]
      : [];
  }

  snapshot(): Mpu6050State {
    return {
      powered: this.powered,
      sleeping: this.sleeping(),
      address: this.address(),
      accelG: [...this.accel],
      gyroDps: [...this.gyro],
      temperatureC: this.temperature(),
    };
  }

  private address(): number {
    return this.ad0High ? 0x69 : 0x68;
  }

  private sleeping(): boolean {
    return ((this.regs[REG.PWR_MGMT_1] ?? 0) & 0x40) !== 0;
  }

  private temperature(): number {
    return AMBIENT_C + (this.powered && !this.sleeping() ? SELF_HEATING_C : 0);
  }

  /** The motion the sensor experiences: from the robot when mounted, else from the bench inputs. */
  private measure(dt: number, io: ComponentIO): void {
    const pose = io.world?.componentPose(this.id) ?? null;
    const motion = io.world?.componentMotion?.(this.id) ?? null;
    if (pose && motion) {
      // Acceleration over the last two slices (physics steps every 2 ms), in the sensor's frame.
      this.velocities = [this.velocities[1] ?? null, this.velocities[2] ?? null, motion.velocity];
      const old = this.velocities[0];
      const ax = old ? (motion.velocity.x - old.x) / (2 * dt) : 0;
      const ay = old ? (motion.velocity.y - old.y) / (2 * dt) : 0;
      const c = dmath.cos(pose.angle);
      const s = dmath.sin(pose.angle);
      this.accel = [(c * ax + s * ay) / G, (-s * ax + c * ay) / G, 1];
      this.gyro = [0, 0, motion.yawRate * DEG];
      return;
    }
    const x = dmath.sin(this.bench.tiltX / DEG);
    const y = dmath.sin(this.bench.tiltY / DEG);
    this.accel = [x, y, Math.sqrt(Math.max(0, 1 - x * x - y * y))];
    this.gyro = [0, 0, this.bench.turnRate];
  }

  /** Internal sample clock: 8 kHz without the DLPF, 1 kHz with it. */
  private clockHz(): number {
    const dlpf = (this.regs[REG.CONFIG] ?? 0) & 0x07;
    return dlpf === 0 || dlpf === 7 ? 8000 : 1000;
  }

  /** Output data rate: the internal clock divided by 1 + SMPLRT_DIV. */
  private sampleRate(): number {
    return this.clockHz() / (1 + (this.regs[REG.SMPLRT_DIV] ?? 0));
  }

  /**
   * Runs the sensor up to `t`: the DLPF at the internal clock, and every (1 + SMPLRT_DIV) ticks the
   * data registers (offsets, noise, range scaling) and the data-ready flag.
   */
  private sample(t: number): void {
    if (!this.powered || this.sleeping()) {
      this.lastTick = t;
      return;
    }
    const dlpf = (this.regs[REG.CONFIG] ?? 0) & 0x07;
    const fs = this.clockHz();
    const divider = 1 + (this.regs[REG.SMPLRT_DIV] ?? 0);
    const alphaA = 1 - dmath.exp((-2 * Math.PI * (ACCEL_BW[dlpf] ?? 260)) / fs);
    const alphaG = 1 - dmath.exp((-2 * Math.PI * (GYRO_BW[dlpf] ?? 256)) / fs);
    let ticks = 0;
    let output = false;
    while (this.lastTick + 1 / fs <= t + 1e-12 && ticks < 256) {
      this.lastTick += 1 / fs;
      ticks++;
      for (let i = 0; i < 3; i++) {
        const fa = this.filtered[i] ?? 0;
        const fg = this.filtered[3 + i] ?? 0;
        this.filtered[i] = fa + alphaA * ((this.accel[i] ?? 0) - fa);
        this.filtered[3 + i] = fg + alphaG * ((this.gyro[i] ?? 0) - fg);
      }
      this.tickCount = (this.tickCount + 1) % divider;
      if (this.tickCount === 0) {
        output = true;
        this.lastSample = this.lastTick;
      }
    }
    if (this.lastTick + 1 / fs <= t) this.lastTick = t; // far behind (a long gap): resynchronise
    if (!output) return;
    const afs = ((this.regs[REG.ACCEL_CONFIG] ?? 0) >> 3) & 0x03;
    const gfs = ((this.regs[REG.GYRO_CONFIG] ?? 0) >> 3) & 0x03;
    const accelLsb = 16384 / (1 << afs);
    const gyroLsb = 131 / (1 << gfs);
    const sigmaA = ACCEL_NOISE * Math.sqrt(1.57 * (ACCEL_BW[dlpf] ?? 260));
    const sigmaG = GYRO_NOISE * Math.sqrt(1.57 * (GYRO_BW[dlpf] ?? 256));
    for (let i = 0; i < 3; i++) {
      const a = (this.filtered[i] ?? 0) + (this.accelOffset[i] ?? 0) + sigmaA * this.gaussian();
      const w = (this.filtered[3 + i] ?? 0) + (this.gyroOffset[i] ?? 0) + sigmaG * this.gaussian();
      this.put16(REG.ACCEL_XOUT_H + 2 * i, a * accelLsb);
      this.put16(REG.GYRO_XOUT_H + 2 * i, w * gyroLsb);
    }
    this.put16(REG.TEMP_OUT_H, (this.temperature() - 36.53) * 340);
    this.regs[REG.INT_STATUS] = (this.regs[REG.INT_STATUS] ?? 0) | 0x01; // DATA_RDY
  }

  private put16(reg: number, value: number): void {
    const v = Math.max(-32768, Math.min(32767, Math.round(value))) & 0xffff;
    this.regs[reg] = v >> 8;
    this.regs[reg + 1] = v & 0xff;
  }

  /** Box–Muller with deterministic maths, from this sensor's seeded stream. */
  private gaussian(): number {
    const u1 = Math.max(1e-12, this.random());
    const u2 = this.random();
    return Math.sqrt(-2 * dmath.log(u1)) * dmath.cos(2 * Math.PI * u2);
  }

  private readRegister(reg: number, t: number): number {
    this.sample(t);
    const value = this.regs[reg] ?? 0;
    if (reg === REG.INT_STATUS) this.regs[reg] = 0; // cleared by reading it
    return value;
  }

  private writeRegister(reg: number, value: number, t: number): void {
    if (reg === REG.WHO_AM_I || reg === REG.INT_STATUS || (reg >= 0x3b && reg <= 0x48)) return; // read-only
    if (reg === REG.PWR_MGMT_1 && value & 0x80) {
      this.regs = defaults(); // DEVICE_RESET: back to defaults; the bit clears itself
      return;
    }
    if (reg === REG.SIGNAL_PATH_RESET) {
      if (value & 0x07) this.filtered = [0, 0, 1, 0, 0, 0];
      return;
    }
    const wasAsleep = this.sleeping();
    this.regs[reg] = value;
    if (wasAsleep && !this.sleeping()) {
      this.lastTick = t;
      this.lastSample = t;
      this.tickCount = 0;
    }
  }

  /** INT pin level: active high (or low when INT_LEVEL is set); latched data-ready holds it asserted. */
  private intLevel(): Level {
    const cfg = this.regs[REG.INT_PIN_CFG] ?? 0;
    const activeLow = (cfg & 0x80) !== 0;
    const latched = (cfg & 0x20) !== 0;
    const asserted =
      latched &&
      ((this.regs[REG.INT_ENABLE] ?? 0) & 0x01) !== 0 &&
      ((this.regs[REG.INT_STATUS] ?? 0) & 0x01) !== 0;
    return (asserted !== activeLow ? 1 : 0) as Level;
  }

  /** Unlatched data-ready interrupts: a 50 µs pulse per sample in the next slice, cycle-exact. */
  private scheduleDataReadyPulses(io: ComponentIO): void {
    const cfg = this.regs[REG.INT_PIN_CFG] ?? 0;
    if (!this.powered || this.sleeping() || (cfg & 0x20) !== 0) return;
    if (((this.regs[REG.INT_ENABLE] ?? 0) & 0x01) === 0) return;
    const active: Level = cfg & 0x80 ? 0 : 1;
    const idle: Level = active ? 0 : 1;
    const period = 1 / this.sampleRate();
    for (let t = this.lastSample + period; t <= io.now + 1e-3; t += period) {
      io.scheduleMcuInput(this.intNet, active, t);
      io.scheduleMcuInput(this.intNet, idle, t + INT_PULSE_S);
    }
  }
}

function defaults(): Uint8Array {
  const regs = new Uint8Array(0x80);
  regs[REG.PWR_MGMT_1] = 0x40; // asleep after power-on
  regs[REG.WHO_AM_I] = 0x68;
  return regs;
}
