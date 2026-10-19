/** SSD1306 128×64 OLED controller (Solomon Systech datasheet rev 1.1), as seen over I²C. */
export const OLED_WIDTH = 128;
export const OLED_HEIGHT = 64;
const PAGES = OLED_HEIGHT / 8;

/** Arguments each command takes (commands not listed take none). */
const ARGS: Readonly<Record<number, number>> = {
  0x81: 1, // contrast
  0x20: 1, // memory addressing mode
  0x21: 2, // column address
  0x22: 2, // page address
  0x26: 6, // right horizontal scroll setup
  0x27: 6, // left horizontal scroll setup
  0x29: 5, // vertical and right horizontal scroll setup
  0x2a: 5, // vertical and left horizontal scroll setup
  0xa3: 2, // vertical scroll area
  0xa8: 1, // multiplex ratio
  0xd3: 1, // display offset
  0xd5: 1, // clock divide / oscillator
  0xd9: 1, // pre-charge period
  0xda: 1, // COM pins configuration
  0xdb: 1, // VCOMH deselect level
  0x8d: 1, // charge pump
};
/** Frames between horizontal scroll steps, by the 3-bit interval code. */
const SCROLL_FRAMES = [5, 64, 128, 256, 3, 4, 25, 2] as const;
/** Frame rate with the reset oscillator and divide ratio, 64 MUX (≈ 105 Hz). */
const FRAME_HZ = 105;

interface Scroll {
  readonly left: boolean;
  readonly startPage: number;
  readonly endPage: number;
  readonly frames: number;
  /** Rows per step of a vertical + horizontal scroll (0 for horizontal only). */
  readonly vertical: number;
}

/**
 * Controller state and GDDRAM. `write` takes one I²C transfer's bytes after the address (control
 * bytes with Co / D·C# framing included); `frame` renders what the panel shows.
 */
export class Ssd1306 {
  readonly ram = new Uint8Array(PAGES * OLED_WIDTH);
  on = false;
  contrast = 0x7f;
  inverse = false;
  entireOn = false;
  chargePump = false;
  segRemap = false;
  comReversed = false;
  multiplex = 63;
  offset = 0;
  startLine = 0;
  comAlternative = true;
  addressing: 0 | 1 | 2 = 2;
  colStart = 0;
  colEnd = OLED_WIDTH - 1;
  pageStart = 0;
  pageEnd = PAGES - 1;
  private col = 0;
  private page = 0;
  /** Vertical scroll area: fixed top rows and scrolling rows. */
  private scrollAreaTop = 0;
  private scrollAreaRows = OLED_HEIGHT;
  private scrollSetup: Scroll | null = null;
  private scrolling: (Scroll & { readonly since: number }) | null = null;
  /** Bumped on every change that can alter the picture (render cache key). */
  version = 0;

  // Transfer parsing: control byte, then commands or data.
  private expectControl = true;
  private single = false;
  private dataMode = false;
  private command: number | null = null;
  private args: number[] = [];

  beginTransfer(): void {
    this.expectControl = true;
    this.single = false;
  }

  /** One byte of an I²C write transfer at time `t` (s). */
  write(byte: number, t: number): void {
    if (this.expectControl) {
      this.single = (byte & 0x80) !== 0; // Co = 1: one byte follows, then another control byte
      this.dataMode = (byte & 0x40) !== 0;
      this.expectControl = false;
      return;
    }
    if (this.dataMode) this.data(byte);
    else this.commandByte(byte, t);
    if (this.single) this.expectControl = true;
  }

  /** Status byte returned on an I²C read: bit 6 set while the display is off. */
  status(): number {
    return this.on ? 0x00 : 0x40;
  }

  /** Columns a horizontal scroll has moved by `t` (s), and the vertical offset of a diagonal one. */
  scrollAt(t: number): { columns: number; rows: number; scroll: Scroll | null } {
    const s = this.scrolling;
    if (!s) return { columns: 0, rows: 0, scroll: null };
    const steps = Math.floor(((t - s.since) * FRAME_HZ) / s.frames);
    return { columns: steps % OLED_WIDTH, rows: s.vertical === 0 ? 0 : (steps * s.vertical) % 64, scroll: s };
  }

  private data(byte: number): void {
    this.ram[this.page * OLED_WIDTH + this.col] = byte;
    this.version++;
    if (this.addressing === 2) {
      this.col = (this.col + 1) % OLED_WIDTH;
      return;
    }
    if (this.addressing === 0) {
      if (this.col < this.colEnd) this.col++;
      else {
        this.col = this.colStart;
        this.page = this.page < this.pageEnd ? this.page + 1 : this.pageStart;
      }
      return;
    }
    if (this.page < this.pageEnd) this.page++;
    else {
      this.page = this.pageStart;
      this.col = this.col < this.colEnd ? this.col + 1 : this.colStart;
    }
  }

  private commandByte(byte: number, t: number): void {
    if (this.command !== null) {
      this.args.push(byte);
      if (this.args.length < (ARGS[this.command] ?? 0)) return;
      const cmd = this.command;
      this.command = null;
      this.execute(cmd, this.args, t);
      this.args = [];
      return;
    }
    if ((ARGS[byte] ?? 0) > 0) {
      this.command = byte;
      this.args = [];
      return;
    }
    this.execute(byte, [], t);
  }

  private execute(cmd: number, a: readonly number[], t: number): void {
    const arg = (i: number) => a[i] ?? 0;
    this.version++;
    if (cmd <= 0x0f) this.col = (this.col & 0xf0) | cmd;
    else if (cmd <= 0x1f) this.col = ((cmd & 0x07) << 4) | (this.col & 0x0f);
    else if (cmd >= 0x40 && cmd <= 0x7f) this.startLine = cmd & 0x3f;
    else if (cmd >= 0xb0 && cmd <= 0xb7) this.page = cmd & 0x07;
    else
      switch (cmd) {
        case 0x20:
          this.addressing = Math.min(2, arg(0) & 0x03) as 0 | 1 | 2;
          break;
        case 0x21:
          this.colStart = arg(0) & 0x7f;
          this.colEnd = arg(1) & 0x7f;
          this.col = this.colStart;
          break;
        case 0x22:
          // The page fields are 3 bits: Adafruit's "0xFF" end page means page 7.
          this.pageStart = arg(0) & 0x07;
          this.pageEnd = arg(1) & 0x07;
          this.page = this.pageStart;
          break;
        case 0x81:
          this.contrast = arg(0);
          break;
        case 0x8d:
          this.chargePump = (arg(0) & 0x04) !== 0;
          break;
        case 0xa0:
        case 0xa1:
          this.segRemap = cmd === 0xa1;
          break;
        case 0xa4:
        case 0xa5:
          this.entireOn = cmd === 0xa5;
          break;
        case 0xa6:
        case 0xa7:
          this.inverse = cmd === 0xa7;
          break;
        case 0xa8:
          this.multiplex = Math.max(15, arg(0) & 0x3f);
          break;
        case 0xae:
        case 0xaf:
          this.on = cmd === 0xaf;
          break;
        case 0xc0:
        case 0xc8:
          this.comReversed = cmd === 0xc8;
          break;
        case 0xd3:
          this.offset = arg(0) & 0x3f;
          break;
        case 0xda:
          this.comAlternative = (arg(0) & 0x10) !== 0;
          break;
        case 0xa3:
          this.scrollAreaTop = arg(0) & 0x3f;
          this.scrollAreaRows = arg(1) & 0x7f;
          break;
        case 0x26:
        case 0x27:
          this.scrollSetup = {
            left: cmd === 0x27,
            startPage: arg(1) & 0x07,
            endPage: arg(3) & 0x07,
            frames: SCROLL_FRAMES[arg(2) & 0x07] ?? 5,
            vertical: 0,
          };
          break;
        case 0x29:
        case 0x2a:
          this.scrollSetup = {
            left: cmd === 0x2a,
            startPage: arg(1) & 0x07,
            endPage: arg(3) & 0x07,
            frames: SCROLL_FRAMES[arg(2) & 0x07] ?? 5,
            vertical: arg(4) & 0x3f,
          };
          break;
        case 0x2e:
          this.scrolling = null;
          break;
        case 0x2f:
          this.scrolling = this.scrollSetup ? { ...this.scrollSetup, since: t } : null;
          break;
        default:
          break; // timing and analogue settings (D5, D9, DB, E3 NOP) do not change the picture
      }
  }

  /** Vertical scroll area of a diagonal scroll: rows it moves (others stay put). */
  scrollArea(): { top: number; rows: number } {
    return { top: this.scrollAreaTop, rows: this.scrollAreaRows };
  }
}
