import type { SerialChunk } from './protocol.js';

/** Rates offered by the Serial Monitor (Arduino IDE list). */
export const SERIAL_BAUD_RATES = [
  300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 74880, 115200, 230400, 250000, 500000, 1000000, 2000000,
] as const;

/** The Serial Monitor keeps this many bytes of output. */
export const SERIAL_TAIL_BYTES = 16384;

/** Two UARTs within this relative baud error still frame each other's bytes (about half a bit over 10 bits). */
const BAUD_TOLERANCE = 0.03;

/**
 * The standard rate a USART runs at: `Serial.begin(9600)` on a 16 MHz Uno really runs at 9615 baud
 * (UBRR rounding), which the monitor shows as 9600. Null when the transmitter is off or no standard
 * rate is close.
 */
export function standardBaud(baud: number): number | null {
  if (baud <= 0) return null;
  let best: number | null = null;
  for (const rate of SERIAL_BAUD_RATES) {
    const error = Math.abs(baud - rate) / rate;
    if (error <= BAUD_TOLERANCE && (best === null || error < Math.abs(baud - best) / best)) best = rate;
  }
  return best;
}

/**
 * What a receiver at `rxBaud` reads from `bytes` sent back to back at `txBaud` (8N1, idle high):
 * it waits for a falling edge, then samples the middle of each of its own bit periods. Equal rates
 * return the bytes unchanged; mismatched rates give the garbage a real serial monitor shows.
 */
export function resample(bytes: Uint8Array, txBaud: number, rxBaud: number): Uint8Array {
  return reframe(bytes, txBaud, rxBaud).bytes;
}

/** {@link resample} plus, per received byte, the index of the sent byte its start edge fell in. */
function reframe(bytes: Uint8Array, txBaud: number, rxBaud: number): { bytes: Uint8Array; from: number[] } {
  if (txBaud <= 0 || rxBaud <= 0 || Math.abs(txBaud - rxBaud) / rxBaud <= BAUD_TOLERANCE / 10) {
    return { bytes, from: Array.from(bytes, (_, i) => i) };
  }
  const totalBits = bytes.length * 10;
  // Line level at tx bit index n: start 0, data LSB first, stop 1, idle 1 after the last frame.
  const level = (n: number): 0 | 1 => {
    if (n < 0 || n >= totalBits) return 1;
    const within = n % 10;
    if (within === 0) return 0;
    if (within === 9) return 1;
    return (((bytes[(n - within) / 10] ?? 0xff) >> (within - 1)) & 1) as 0 | 1;
  };
  const levelAt = (t: number) => level(Math.floor(t * txBaud));
  const rxBit = 1 / rxBaud;
  const out: number[] = [];
  const from: number[] = [];
  let n = 0; // next tx bit boundary to test for a falling edge
  while (n < totalBits) {
    if (!(level(n - 1) === 1 && level(n) === 0)) {
      n++;
      continue;
    }
    const t0 = n / txBaud;
    if (levelAt(t0 + rxBit / 2) !== 0) {
      n++; // glitch shorter than half a bit: false start
      continue;
    }
    let byte = 0;
    for (let k = 0; k < 8; k++) byte |= levelAt(t0 + rxBit * (k + 1.5)) << k;
    out.push(byte);
    from.push(Math.floor(n / 10));
    // Resume edge search after the stop-bit sample.
    n = Math.max(n + 1, Math.ceil((t0 + rxBit * 9.5) * txBaud));
  }
  return { bytes: Uint8Array.from(out), from };
}

export interface SerialLine {
  /** Slice (ms) the line's first byte was sent in. */
  readonly slice: number;
  readonly text: string;
}

export interface DecodedSerial {
  readonly lines: readonly SerialLine[];
  /** Standard rate the sketch last transmitted at (null before `Serial.begin`). */
  readonly sketchBaud: number | null;
  /** True when that rate differs from the monitor's, so the output is garbled. */
  readonly mismatch: boolean;
}

/**
 * Decodes UART output as a monitor set to `monitorBaud` sees it: bytes are re-framed when the rates
 * differ, decoded as UTF-8 and split into lines (CR/LF/CRLF), each stamped with its first slice.
 */
export function decodeSerial(chunks: readonly SerialChunk[], monitorBaud: number): DecodedSerial {
  const utf8 = new TextDecoder();
  const lines: { slice: number; text: string }[] = [];
  let open: { slice: number; text: string } | null = null;
  let pendingCr = false;
  let sketchBaud: number | null = null;
  // Chunks that follow each other without an idle gap at one baud are one bit stream: re-framing
  // must see them joined. Each byte keeps the slice it was sent in.
  const runs: { baud: number; bytes: number[]; slices: number[]; end: number }[] = [];
  for (const c of chunks) {
    const ms = c.baud > 0 ? (c.bytes.length * 10_000) / c.baud : 0;
    let run = runs.at(-1);
    if (run && run.baud === c.baud && c.slice <= run.end + 1) {
      run.bytes.push(...c.bytes);
      run.end = Math.max(run.end, c.slice) + ms;
    } else {
      run = { baud: c.baud, bytes: [...c.bytes], slices: [], end: c.slice + ms };
      runs.push(run);
    }
    for (let i = 0; i < c.bytes.length; i++) run.slices.push(c.slice);
    if (c.baud > 0) sketchBaud = standardBaud(c.baud) ?? Math.round(c.baud);
  }
  for (const run of runs) {
    const { bytes, from } = reframe(Uint8Array.from(run.bytes), run.baud, monitorBaud);
    // Decode byte by byte so every character knows the slice of the byte that completed it.
    for (let i = 0; i < bytes.length; i++) {
      const slice = run.slices[from[i] ?? 0] ?? 0;
      for (const ch of utf8.decode(bytes.subarray(i, i + 1), { stream: true })) {
        if (ch === '\n' && pendingCr) {
          pendingCr = false;
          continue;
        }
        pendingCr = ch === '\r';
        if (ch === '\n' || ch === '\r') {
          lines.push(open ?? { slice, text: '' });
          open = null;
        } else {
          open ??= { slice, text: '' };
          open.text += ch;
        }
      }
    }
  }
  if (open) lines.push(open);
  return { lines, sketchBaud, mismatch: sketchBaud !== null && sketchBaud !== monitorBaud };
}

/**
 * Bounded store of the raw UART output of a run (keeps the newest {@link SERIAL_TAIL_BYTES}).
 * `version` changes on every append or clear, so views can memoise decoding on it.
 */
export class SerialLog {
  chunks: readonly SerialChunk[] = [];
  version = 0;
  private size = 0;

  append(chunks: readonly SerialChunk[]): void {
    const next = [...this.chunks, ...chunks];
    this.size += chunks.reduce((n, c) => n + c.bytes.length, 0);
    let drop = 0;
    while (this.size > SERIAL_TAIL_BYTES && drop < next.length - 1)
      this.size -= next[drop++]?.bytes.length ?? 0;
    this.chunks = drop ? next.slice(drop) : next;
    this.version++;
  }

  clear(): void {
    this.chunks = [];
    this.size = 0;
    this.version++;
  }
}
