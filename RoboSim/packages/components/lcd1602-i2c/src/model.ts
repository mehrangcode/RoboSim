import {
  stampPullUp,
  type ComponentIO,
  type ComponentModel,
  type Fault,
  type I2cDevice,
  type MnaStamper,
  type ModelContext,
  type NetId,
} from '@robosim/sim-core';
import { Hd44780 } from './hd44780.js';

export { Hd44780 } from './hd44780.js';

export interface LcdProps {
  readonly address: string;
}

export interface LcdState {
  readonly powered: boolean;
  readonly backlight: boolean;
  readonly displayOn: boolean;
  /** Contrast knob on the backpack (0–1): text shows between about 0.3 and 0.8. */
  readonly contrast: number;
  /** Character codes of the 16×2 window; −1 where the glass shows nothing. */
  readonly rows: readonly (readonly number[])[];
  /** Custom characters 0–7: 8 rows of 5 bits each. */
  readonly cgram: readonly number[];
  readonly cursor: { readonly row: number; readonly col: number } | null;
  readonly cursorOn: boolean;
  /** Blinking block cursor, in its visible phase. */
  readonly blinkVisible: boolean;
  readonly currentMa: number;
}

/** PCF8574 port bits on the common backpack: RS, R/W, E, backlight, then D4–D7. */
const RS = 0x01;
const RW = 0x02;
const EN = 0x04;
const BACKLIGHT = 0x08;
/** The PCF8574 runs from 2.5 V; the 5 V LCD shows nothing below about 4.2 V. */
const MIN_LOGIC_V = 2.5;
const MIN_LCD_V = 4.2;
const MAX_VCC = 6;
/** 4.7 kΩ bus pull-ups to VCC on the backpack. */
const PULLUP_OHMS = 4700;
/** Logic ≈ 1.5 mA; backlight LED ≈ 20 mA through its resistor and transistor. */
const LOGIC_A = 1.5e-3;
const BACKLIGHT_A = 20e-3;
/** The HD44780 blinks the cursor block every 409.6 ms (fosc = 270 kHz). */
const BLINK_HALF_S = 0.4096;

/**
 * 16×2 character LCD with a PCF8574 I²C backpack (Tier C), as LiquidCrystal_I2C drives it: each byte
 * written sets the expander's port, and a falling E latches RS, R/W and D7–D4 into the HD44780.
 * The contrast knob is an input you can turn while it runs (too low: blank, too high: solid blocks).
 */
export class Lcd1602I2c implements ComponentModel<LcdProps, LcdState> {
  readonly type = 'display.lcd1602-i2c';
  private id = '';
  private vccNet: NetId = 0;
  private gnd: NetId = 0;
  private sdaNet: NetId = 0;
  private sclNet: NetId = 0;
  private addr = 0x27;
  private lcd = new Hd44780();
  /** PCF8574 output latch (powers up all high). */
  private port = 0xff;
  private vcc = 0;
  private logicOn = false;
  private contrast = 0.55;
  private stampedA = 0;
  private now = 0;
  private device: I2cDevice | null = null;

  init(ctx: ModelContext, props: LcdProps): void {
    this.id = ctx.id;
    this.vccNet = ctx.net('vcc');
    this.gnd = ctx.net('gnd');
    this.sdaNet = ctx.net('sda');
    this.sclNet = ctx.net('scl');
    this.addr = Number.parseInt(props.address, 16);
    this.device = {
      sda: this.sdaNet,
      scl: this.sclNet,
      address: () => (this.logicOn ? this.addr : null),
      begin: () => true,
      write: (byte, time) => {
        this.writePort(byte, time);
        return true;
      },
      read: (_ack, time) => this.readPort(time),
      end: () => undefined,
    };
  }

  i2c(): I2cDevice | null {
    return this.device;
  }

  input(name: string, value: number | boolean): void {
    if (name !== 'contrast' || typeof value !== 'number')
      throw new Error(`display.lcd1602-i2c: bad input '${name}'`);
    this.contrast = Math.min(1, Math.max(0, value));
  }

  stamp(s: MnaStamper): void {
    stampPullUp(s, this.sdaNet, this.gnd, PULLUP_OHMS, { net: this.vccNet });
    stampPullUp(s, this.sclNet, this.gnd, PULLUP_OHMS, { net: this.vccNet });
    if (this.stampedA > 0) s.currentSource(this.vccNet, this.gnd, this.stampedA);
  }

  step(_dt: number, io: ComponentIO): void {
    const sol = io.solution;
    this.vcc = sol.voltage(this.vccNet) - sol.voltage(this.gnd);
    this.now = io.now;
    const on = this.vcc >= MIN_LOGIC_V;
    if (on !== this.logicOn) {
      this.logicOn = on;
      if (!on) {
        this.lcd = new Hd44780();
        this.port = 0xff;
      }
    }
    const amps = !on ? 0 : LOGIC_A + ((this.port & BACKLIGHT) !== 0 ? BACKLIGHT_A : 0);
    if (amps !== this.stampedA) {
      this.stampedA = amps;
      io.invalidate();
    }
  }

  faults(): readonly Fault[] {
    return this.vcc > MAX_VCC
      ? [{ code: 'OVER_VOLTAGE', componentId: this.id, params: { volts: this.vcc, limitV: MAX_VCC } }]
      : [];
  }

  snapshot(): LcdState {
    const visible = this.logicOn && this.vcc >= MIN_LCD_V;
    const rows = [0, 1].map((r) =>
      [...Array(16).keys()].map((c) => (visible ? (this.lcd.charAt(r, c) ?? -1) : -1)),
    );
    const cursor = visible && this.lcd.displayOn ? this.lcd.cursorCell() : null;
    return {
      powered: visible,
      backlight: this.logicOn && (this.port & BACKLIGHT) !== 0,
      displayOn: visible && this.lcd.displayOn,
      contrast: this.contrast,
      rows,
      cgram: [...this.lcd.cgram],
      cursor,
      cursorOn: this.lcd.cursorOn,
      blinkVisible: this.lcd.blinkOn && Math.floor(this.now / BLINK_HALF_S) % 2 === 0,
      currentMa: this.stampedA * 1000,
    };
  }

  private writePort(byte: number, time: number): void {
    const before = this.port;
    this.port = byte & 0xff;
    // HD44780 latches on the falling edge of E.
    if ((before & EN) !== 0 && (this.port & EN) === 0)
      this.lcd.latch((before & RS) !== 0, (before & RW) !== 0, before & 0xf0, time);
  }

  /** Quasi-bidirectional port: written-high pins read what the LCD drives while it is being read. */
  private readPort(time: number): number {
    if ((this.port & RW) !== 0 && (this.port & EN) !== 0 && (this.port & RS) === 0)
      return (this.port & 0x0f) | (this.lcd.status(time) & 0xf0);
    return this.port;
  }
}
