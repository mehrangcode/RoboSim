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
import { OLED_HEIGHT, OLED_WIDTH, Ssd1306 } from './ssd1306.js';

export { OLED_HEIGHT, OLED_WIDTH, Ssd1306 } from './ssd1306.js';

export interface OledProps {
  readonly address: string;
}

export interface OledState {
  readonly powered: boolean;
  /** Panel lit (display on, charge pump enabled). */
  readonly on: boolean;
  /** 0–255. */
  readonly contrast: number;
  /** Visible pixels, 64 rows of 4 × 32-bit words (bit x & 31 of word x >> 5), see {@link pixelAt}. */
  readonly pixels: readonly number[];
  readonly currentMa: number;
}

/** Module regulator (662K LDO) cuts out below this VCC (V). */
const MIN_VCC = 2.8;
const MAX_VCC = 5.5;
/** 4.7 kΩ pull-ups on SDA and SCL to VCC, as on most 0.96" modules. */
const PULLUP_OHMS = 4700;
/** Supply current: logic and charge pump, plus the lit pixels at full contrast (A). */
const IDLE_A = 0.5e-3;
const ON_A = 2e-3;
const ALL_LIT_A = 20e-3;
const RESTAMP_A = 0.05e-3;
const WORDS_PER_ROW = OLED_WIDTH / 32;

/** Whether pixel (x, y) is lit in an {@link OledState.pixels} frame. */
export function pixelAt(pixels: readonly number[], x: number, y: number): boolean {
  return (((pixels[y * WORDS_PER_ROW + (x >> 5)] ?? 0) >>> (x & 31)) & 1) === 1;
}

/**
 * 0.96" 128×64 I²C OLED module (Technical Design §5.4, Tier C): an SSD1306 behind an LDO with bus
 * pull-ups. The controller runs the full command set Adafruit_SSD1306 and other libraries use; the
 * frame shown follows segment remap, COM scan direction and wiring, start line, offset, multiplex,
 * contrast, inverse and scrolling. It forgets everything when it loses power.
 */
export class OledSsd1306 implements ComponentModel<OledProps, OledState> {
  readonly type = 'display.oled-ssd1306';
  private id = '';
  private vccNet: NetId = 0;
  private gnd: NetId = 0;
  private sdaNet: NetId = 0;
  private sclNet: NetId = 0;
  private addr = 0x3c;
  private chip = new Ssd1306();
  private powered = false;
  private vcc = 0;
  private stampedA = 0;
  private now = 0;
  private frame: { key: string; pixels: number[]; lit: number } = { key: '', pixels: [], lit: 0 };
  private device: I2cDevice | null = null;

  init(ctx: ModelContext, props: OledProps): void {
    this.id = ctx.id;
    this.vccNet = ctx.net('vcc');
    this.gnd = ctx.net('gnd');
    this.sdaNet = ctx.net('sda');
    this.sclNet = ctx.net('scl');
    this.addr = Number.parseInt(props.address, 16);
    this.device = {
      sda: this.sdaNet,
      scl: this.sclNet,
      address: () => (this.powered ? this.addr : null),
      begin: (read) => {
        if (!read) this.chip.beginTransfer();
        return true;
      },
      write: (byte, time) => {
        this.chip.write(byte, time);
        return true;
      },
      read: () => this.chip.status(),
      end: () => undefined,
    };
  }

  i2c(): I2cDevice | null {
    return this.device;
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
    const powered = this.vcc >= MIN_VCC;
    if (powered !== this.powered) {
      this.powered = powered;
      if (!powered) this.chip = new Ssd1306(); // power loss clears GDDRAM and every setting
    }
    const lit = this.render().lit;
    const amps = !this.powered
      ? 0
      : this.isOn()
        ? ON_A + (ALL_LIT_A * lit * (this.chip.contrast / 255)) / (OLED_WIDTH * OLED_HEIGHT)
        : IDLE_A;
    if (Math.abs(amps - this.stampedA) > RESTAMP_A) {
      this.stampedA = amps;
      io.invalidate();
    }
  }

  faults(): readonly Fault[] {
    return this.vcc > MAX_VCC
      ? [{ code: 'OVER_VOLTAGE', componentId: this.id, params: { volts: this.vcc, limitV: MAX_VCC } }]
      : [];
  }

  snapshot(): OledState {
    return {
      powered: this.powered,
      on: this.isOn(),
      contrast: this.chip.contrast,
      pixels: this.render().pixels,
      currentMa: this.stampedA * 1000,
    };
  }

  private isOn(): boolean {
    return this.powered && this.chip.on && this.chip.chargePump;
  }

  /** The panel's picture, recomputed only when the controller or the scroll position changed. */
  private render(): { pixels: number[]; lit: number } {
    const c = this.chip;
    const { columns, rows, scroll } = c.scrollAt(this.now);
    const key = `${this.isOn()}:${c.version}:${columns}:${rows}`;
    if (key === this.frame.key) return this.frame;
    const words = new Array<number>(WORDS_PER_ROW * OLED_HEIGHT).fill(0);
    let lit = 0;
    if (this.isOn()) {
      const area = c.scrollArea();
      for (let y = 0; y < OLED_HEIGHT; y++) {
        // COM line driving this physical row: alternative wiring as on 128×64 modules.
        const com = c.comAlternative ? y : y % 2 === 0 ? y / 2 : 32 + (y - 1) / 2;
        if (com > c.multiplex) continue;
        const r = c.comReversed ? com : c.multiplex - com;
        let ramRow = (r + c.startLine + c.offset) & 63;
        if (scroll && scroll.vertical > 0 && ramRow >= area.top && ramRow < area.top + area.rows)
          ramRow = area.top + ((ramRow - area.top + rows) % Math.max(1, area.rows));
        const page = ramRow >> 3;
        const bit = ramRow & 7;
        const scrolled = scroll !== null && page >= scroll.startPage && page <= scroll.endPage;
        for (let x = 0; x < OLED_WIDTH; x++) {
          let col = c.segRemap ? x : OLED_WIDTH - 1 - x;
          if (scrolled) col = (col + (scroll.left ? columns : OLED_WIDTH - columns)) % OLED_WIDTH;
          let on = c.entireOn || ((c.ram[page * OLED_WIDTH + col] ?? 0) >> bit) & 1;
          if (!c.entireOn && c.inverse) on = on ? 0 : 1;
          if (!on) continue;
          lit++;
          const w = y * WORDS_PER_ROW + (x >> 5);
          words[w] = ((words[w] ?? 0) | (1 << (x & 31))) >>> 0;
        }
      }
    }
    this.frame = { key, pixels: words, lit };
    return this.frame;
  }
}
