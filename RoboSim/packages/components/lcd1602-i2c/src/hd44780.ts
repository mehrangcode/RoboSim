/**
 * Hitachi HD44780 character LCD controller (datasheet ADE-207-272), driven over a 4- or 8-bit bus.
 * `latch` is one falling edge of E with RS, R/W and the data lines of that moment.
 */
export class Hd44780 {
  readonly ddram = new Uint8Array(0x80).fill(0x20);
  readonly cgram = new Uint8Array(64);
  eightBit = true;
  twoLine = false;
  displayOn = false;
  cursorOn = false;
  blinkOn = false;
  increment = true;
  shiftOnWrite = false;
  /** Address counter and which RAM it points into. */
  ac = 0;
  cgMode = false;
  /** Display shift in characters (0 … line length − 1). */
  shift = 0;
  /** Instructions arriving before this time are ignored, as on the real chip while busy (s). */
  private busyUntil = 0;
  /** High nibble of a 4-bit transfer waiting for its low half. */
  private pending: { rs: boolean; nibble: number } | null = null;

  /** One E falling edge: in 4-bit mode `data` carries D7–D4 in its upper nibble. */
  latch(rs: boolean, rw: boolean, data: number, t: number): void {
    if (rw) return; // reads: busy flag / data, nothing changes
    if (this.eightBit) {
      this.execute(rs, data & 0xff, t);
      return;
    }
    const nibble = (data >> 4) & 0x0f;
    if (!this.pending) {
      this.pending = { rs, nibble };
      return;
    }
    const byte = (this.pending.nibble << 4) | nibble;
    const reg = this.pending.rs;
    this.pending = null;
    this.execute(reg, byte, t);
  }

  /** Busy flag and address counter as read with RS = 0, R/W = 1. */
  status(t: number): number {
    return (t < this.busyUntil ? 0x80 : 0) | (this.ac & 0x7f);
  }

  /** Character code shown at a column of a row (16×2 window), or null where the glass shows nothing. */
  charAt(row: number, col: number): number | null {
    if (row === 1 && !this.twoLine) return null;
    const len = this.lineLength();
    const base = row === 0 ? 0 : 0x40;
    return this.ddram[base + ((col + this.shift) % len)] ?? 0x20;
  }

  /** Where the cursor is on the 16×2 window, or null when it is off-screen or in CGRAM. */
  cursorCell(): { row: number; col: number } | null {
    if (this.cgMode) return null;
    const len = this.lineLength();
    const row = this.twoLine && this.ac >= 0x40 ? 1 : 0;
    const offset = this.ac - (row === 1 ? 0x40 : 0);
    const col = (offset - this.shift + len) % len;
    return col < 16 ? { row, col } : null;
  }

  private lineLength(): number {
    return this.twoLine ? 40 : 80;
  }

  private execute(rs: boolean, byte: number, t: number): void {
    // The function-set that selects 4-bit mode is accepted at any time during initialisation.
    const functionSet = !rs && (byte & 0xe0) === 0x20;
    if (t < this.busyUntil && !functionSet) return;
    this.busyUntil = t + 37e-6;
    if (rs) {
      this.writeData(byte);
      return;
    }
    if (byte & 0x80) {
      this.cgMode = false;
      this.ac = byte & 0x7f;
      this.wrapAddress();
    } else if (byte & 0x40) {
      this.cgMode = true;
      this.ac = byte & 0x3f;
    } else if (byte & 0x20) {
      this.eightBit = (byte & 0x10) !== 0;
      this.twoLine = (byte & 0x08) !== 0;
      this.pending = null;
    } else if (byte & 0x10) {
      const display = (byte & 0x08) !== 0;
      const right = (byte & 0x04) !== 0;
      if (display) this.shiftDisplay(right ? -1 : 1);
      else this.moveCursor(right ? 1 : -1);
    } else if (byte & 0x08) {
      this.displayOn = (byte & 0x04) !== 0;
      this.cursorOn = (byte & 0x02) !== 0;
      this.blinkOn = (byte & 0x01) !== 0;
    } else if (byte & 0x04) {
      this.increment = (byte & 0x02) !== 0;
      this.shiftOnWrite = (byte & 0x01) !== 0;
    } else if (byte & 0x02) {
      this.cgMode = false;
      this.ac = 0;
      this.shift = 0;
      this.busyUntil = t + 1.52e-3;
    } else if (byte & 0x01) {
      this.ddram.fill(0x20);
      this.cgMode = false;
      this.ac = 0;
      this.shift = 0;
      this.increment = true;
      this.busyUntil = t + 1.52e-3;
    }
  }

  private writeData(byte: number): void {
    if (this.cgMode) {
      this.cgram[this.ac & 0x3f] = byte & 0x1f;
      this.ac = (this.ac + (this.increment ? 1 : -1)) & 0x3f;
      return;
    }
    this.ddram[this.ac & 0x7f] = byte;
    this.moveCursor(this.increment ? 1 : -1);
    if (this.shiftOnWrite) this.shiftDisplay(this.increment ? 1 : -1);
  }

  private moveCursor(by: number): void {
    if (this.cgMode) {
      this.ac = (this.ac + by) & 0x3f;
      return;
    }
    this.ac += by;
    this.wrapAddress();
  }

  /** DDRAM addresses run 00–27 and 40–67 in two-line mode (the gap wraps), 00–4F in one-line. */
  private wrapAddress(): void {
    if (!this.twoLine) {
      this.ac = ((this.ac % 0x50) + 0x50) % 0x50;
      return;
    }
    if (this.ac === 0x28) this.ac = 0x40;
    else if (this.ac === 0x68) this.ac = 0x00;
    else if (this.ac === -1) this.ac = 0x67;
    else if (this.ac === 0x3f) this.ac = 0x27;
    else if (this.ac > 0x67 || (this.ac > 0x27 && this.ac < 0x40)) this.ac = this.ac & 0x40 ? 0x40 : 0x00;
  }

  private shiftDisplay(by: number): void {
    const len = this.lineLength();
    this.shift = (this.shift + by + len) % len;
  }
}
