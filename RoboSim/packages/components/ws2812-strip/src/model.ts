import type {
  ComponentIO,
  ComponentModel,
  Fault,
  MnaStamper,
  ModelContext,
  NetId,
  PinEdge,
} from '@robosim/sim-core';

export interface Ws2812Props {
  readonly count: number;
}

export interface Ws2812State {
  readonly powered: boolean;
  /** Latched colour of each LED as 0xRRGGBB. */
  readonly colors: readonly number[];
  readonly currentMa: number;
}

/** A HIGH shorter than this is a 0 bit (T0H 0.25–0.55 µs), longer a 1 (T1H 0.65–0.95 µs). */
const BIT_THRESHOLD_S = 0.55e-6;
/** LOW for at least 50 µs latches the received colours (RES). */
const LATCH_S = 50e-6;
/** Reshaped bits leave DOUT this much later. */
const FORWARD_DELAY_S = 0.2e-6;
/** Per LED: ≈ 0.6 mA quiescent, ≈ 12 mA per colour channel at full brightness. */
const IDLE_A = 0.6e-3;
const CHANNEL_A = 12e-3;
const MIN_VDD = 3.5;
const MAX_VDD = 5.5;

/**
 * WS2812B LED strip (Technical Design §5.4, Tier C). Each LED takes the first 24 bits (GRB, MSB first)
 * it sees, measured from the HIGH time of each pulse at 800 kHz, and passes the rest on from DOUT;
 * 50 µs LOW latches the new colours. Supply current follows the colours (≈ 36 mA per LED at full
 * white), so a long strip on the Uno's 5 V pin overloads it.
 */
export class Ws2812Strip implements ComponentModel<Ws2812Props, Ws2812State> {
  readonly type = 'actuator.ws2812-strip';
  private id = '';
  private vccNet: NetId = 0;
  private gnd: NetId = 0;
  private dinNet: NetId = 0;
  private doutNet: NetId = 0;
  private count = 8;
  private vcc = 0;
  private powered = false;
  /** Bits received since the last latch; each LED's 24 bits in GRB order. */
  private frame: number[] = [];
  private shown: number[] = [];
  private stampedA = 0;
  private high: number | null = null;
  private lastFall = 0;
  private bits = 0;

  init(ctx: ModelContext, props: Ws2812Props): void {
    this.id = ctx.id;
    this.vccNet = ctx.net('vcc');
    this.gnd = ctx.net('gnd');
    this.dinNet = ctx.net('din');
    this.doutNet = ctx.net('dout');
    this.count = Math.max(1, Math.min(60, Math.round(props.count)));
    this.shown = Array<number>(this.count).fill(0);
  }

  logicNets(): { inputs: NetId[]; outputs: NetId[] } {
    return { inputs: [this.dinNet], outputs: [this.doutNet] };
  }

  stamp(s: MnaStamper): void {
    this.stampedA = this.powered ? this.supplyA() : 0;
    s.currentSource(this.vccNet, this.gnd, this.stampedA);
  }

  step(_dt: number, io: ComponentIO): void {
    const sol = io.solution;
    this.vcc = sol.voltage(this.vccNet) - sol.voltage(this.gnd);
    const powered = this.vcc >= MIN_VDD;
    if (powered !== this.powered) {
      this.powered = powered;
      this.shown = Array<number>(this.count).fill(0); // power-on: dark
      this.frame = [];
      this.bits = 0;
    }
    if (powered) {
      for (const e of io.edges(this.dinNet)) this.edge(e, io);
      if (this.high === null && this.bits > 0 && io.now - this.lastFall >= LATCH_S) this.latch();
    }
    if (Math.abs((this.powered ? this.supplyA() : 0) - this.stampedA) > 1e-6) io.invalidate();
  }

  faults(): readonly Fault[] {
    return this.vcc > MAX_VDD
      ? [{ code: 'OVER_VOLTAGE', componentId: this.id, params: { volts: this.vcc, limitV: MAX_VDD } }]
      : [];
  }

  snapshot(): Ws2812State {
    return {
      powered: this.powered,
      colors: this.powered ? [...this.shown] : Array<number>(this.count).fill(0),
      currentMa: (this.powered ? this.supplyA() : 0) * 1000,
    };
  }

  private supplyA(): number {
    let a = this.count * IDLE_A;
    for (const c of this.shown)
      a += (((c >> 16) & 0xff) + ((c >> 8) & 0xff) + (c & 0xff)) * (CHANNEL_A / 255);
    return a;
  }

  private edge(e: PinEdge, io: ComponentIO): void {
    if (e.level === 1) {
      if (this.high !== null) return;
      if (this.bits > 0 && e.time - this.lastFall >= LATCH_S) this.latch();
      this.high = e.time;
      return;
    }
    if (this.high === null) return;
    const width = e.time - this.high;
    const rise = this.high;
    this.high = null;
    this.lastFall = e.time;
    if (this.bits < this.count * 24) {
      const led = Math.floor(this.bits / 24);
      const bit = 23 - (this.bits % 24);
      if (width >= BIT_THRESHOLD_S) this.frame[led] = (this.frame[led] ?? 0) | (1 << bit);
      this.bits++;
    } else {
      // Not ours: regenerated on DOUT for the next strip.
      io.emitEdge(this.doutNet, 1, rise + FORWARD_DELAY_S);
      io.emitEdge(this.doutNet, 0, e.time + FORWARD_DELAY_S);
    }
  }

  /** RES: the received GRB words become the LEDs' colours (LEDs that got no data keep theirs). */
  private latch(): void {
    const leds = Math.ceil(Math.min(this.bits, this.count * 24) / 24);
    for (let i = 0; i < leds; i++) {
      const grb = this.frame[i] ?? 0;
      this.shown[i] = (((grb >> 8) & 0xff) << 16) | (((grb >> 16) & 0xff) << 8) | (grb & 0xff);
    }
    this.frame = [];
    this.bits = 0;
  }
}
