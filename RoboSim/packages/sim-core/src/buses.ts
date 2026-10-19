import type {
  BusPins,
  I2cBusHandler,
  I2cDevice,
  Level,
  NetId,
  PinId,
  SpiBusHandler,
  SpiDevice,
} from './contracts.js';

/** What the routers need to know about the circuit at the moment of a transfer. */
export interface BusContext {
  readonly pins: BusPins;
  /** Input thresholds of the MCU (V). */
  readonly vil: number;
  readonly vih: number;
  /** True when `net` carries MCU pin `pin`'s signal, directly or through series resistors. */
  reaches(net: NetId, pin: PinId): boolean;
  /** Voltage of `net` in the present operating point. */
  volts(net: NetId): number;
  /** Level an MCU output drives onto `net` right now (cycle-exact), or null when none drives it. */
  drivenLevel(net: NetId): Level | null;
}

/**
 * I²C bus between the MCU's TWI master and the targets wired to its SDA/SCL (Technical Design §5.4,
 * Tier C). A target takes part only when both its lines reach the MCU's and the bus idles high (pull-
 * ups present). Every target answering an address receives the transfer; read bytes are wired-AND.
 */
export class I2cRouter implements I2cBusHandler {
  private active: I2cDevice[] = [];

  constructor(
    private readonly devices: readonly I2cDevice[],
    private readonly ctx: BusContext,
  ) {}

  start(_repeated: boolean, time: number): void {
    this.finish(time);
  }

  connect(address: number, read: boolean, time: number): boolean {
    this.finish(time);
    const { ctx } = this;
    if (ctx.volts(this.sdaNet()) < ctx.vih || ctx.volts(this.sclNet()) < ctx.vih) return false;
    const answering = this.devices.filter(
      (d) => ctx.reaches(d.sda, ctx.pins.sda) && ctx.reaches(d.scl, ctx.pins.scl) && d.address() === address,
    );
    this.active = answering.filter((d) => d.begin(read, time));
    return this.active.length > 0;
  }

  write(byte: number, time: number): boolean {
    let ack = false;
    for (const d of this.active) if (d.write(byte, time)) ack = true;
    return ack;
  }

  read(ack: boolean, time: number): number {
    let value = 0xff;
    for (const d of this.active) value &= d.read(ack, time);
    return value;
  }

  stop(time: number): void {
    this.finish(time);
  }

  private finish(time: number): void {
    for (const d of this.active) d.end(time);
    this.active = [];
  }

  /** A net of the MCU's SDA (any target's will do; the bus voltage is the same). */
  private sdaNet(): NetId {
    return this.devices.find((d) => this.ctx.reaches(d.sda, this.ctx.pins.sda))?.sda ?? 0;
  }

  private sclNet(): NetId {
    return this.devices.find((d) => this.ctx.reaches(d.scl, this.ctx.pins.scl))?.scl ?? 0;
  }
}

/**
 * SPI bus between the MCU's master and its targets (Tier C): a target whose SCK and MOSI reach the
 * MCU's is selected while its CS is LOW (driven by an MCU pin, or tied low). Only targets whose MISO
 * reaches the MCU's are heard; several selected at once are wired-AND.
 */
export class SpiRouter implements SpiBusHandler {
  constructor(
    private readonly devices: readonly SpiDevice[],
    private readonly ctx: BusContext,
  ) {}

  transfer(byte: number, time: number): number {
    const { ctx } = this;
    let miso = 0xff;
    for (const d of this.devices) {
      if (!ctx.reaches(d.sck, ctx.pins.sck) || !ctx.reaches(d.mosi, ctx.pins.mosi)) continue;
      const cs = ctx.drivenLevel(d.cs);
      const selected = cs !== null ? cs === 0 : ctx.volts(d.cs) <= ctx.vil;
      if (!selected) continue;
      const out = d.transfer(byte, time);
      if (ctx.reaches(d.miso, ctx.pins.miso)) miso &= out;
    }
    return miso;
  }
}
