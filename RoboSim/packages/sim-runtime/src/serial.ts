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
function reframe(
  bytes: Uint8Array,
  txBaud: number,
  rxBaud: number,
): { bytes: Uint8Array; from: number[] | null } {
  // `from: null`: every received byte is the sent byte at the same index.
  if (txBaud <= 0 || rxBaud <= 0 || framesExactly(txBaud, rxBaud)) return { bytes, from: null };
  return reframeBits(bytes, txBaud, rxBaud);
}

/**
 * True when a receiver at `rxBaud` reads back-to-back frames sent at `txBaud` unchanged: every
 * mid-bit sample of a frame falls in the same sent bit (with a margin for float rounding) and the
 * next start-edge search begins at the next frame's start bit.
 */
export function framesExactly(txBaud: number, rxBaud: number): boolean {
  const r = txBaud / rxBaud;
  const MARGIN = 1e-3;
  for (let k = -1; k < 8; k++) {
    const at = (k + 1.5) * r; // sent bit (from the start edge) the receiver samples for bit k
    if (Math.floor(at) !== k + 1 || at - (k + 1) < MARGIN || k + 2 - at < MARGIN) return false;
  }
  const next = 9.5 * r; // the search resumes at ceil(next); it must not pass the next start bit
  return next <= 10 - MARGIN && next >= 9 + MARGIN;
}

/** The bit-level receiver behind {@link reframe} (exported for the equivalence test). */
export function reframeBits(
  bytes: Uint8Array,
  txBaud: number,
  rxBaud: number,
): { bytes: Uint8Array; from: number[] } {
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
  /** Standard rate the sketch sent the line's first byte at (0 before `Serial.begin`). */
  readonly baud: number;
}

export interface DecodedSerial {
  readonly lines: readonly SerialLine[];
  /** Standard rate the sketch last transmitted at (null before `Serial.begin`). */
  readonly sketchBaud: number | null;
  /** True when that rate differs from the monitor's, so the output is garbled. */
  readonly mismatch: boolean;
  /** The last line has no line ending yet (more of it may still arrive). */
  readonly partial: boolean;
}

/**
 * Decodes UART output as a monitor set to `monitorBaud` sees it: bytes are re-framed when the rates
 * differ, decoded as UTF-8 and split into lines (CR/LF/CRLF), each stamped with its first slice.
 */
export function decodeSerial(chunks: readonly SerialChunk[], monitorBaud: number): DecodedSerial {
  const utf8 = new TextDecoder();
  const lines: SerialLine[] = [];
  let open: { slice: number; text: string; baud: number } | null = null;
  let pendingCr = false;
  let sketchBaud: number | null = null;
  // Chunks that follow each other without an idle gap at one baud are one bit stream: re-framing
  // must see them joined. Each byte keeps the slice it was sent in.
  const runs: { baud: number; chunks: SerialChunk[]; size: number; end: number }[] = [];
  for (const c of chunks) {
    const ms = c.baud > 0 ? (c.bytes.length * 10_000) / c.baud : 0;
    let run = runs.at(-1);
    if (run && run.baud === c.baud && c.slice <= run.end + 1) {
      run.chunks.push(c);
      run.size += c.bytes.length;
      run.end = Math.max(run.end, c.slice) + ms;
    } else {
      run = { baud: c.baud, chunks: [c], size: c.bytes.length, end: c.slice + ms };
      runs.push(run);
    }
    if (c.baud > 0) sketchBaud = standardBaud(c.baud) ?? Math.round(c.baud);
  }
  // Bytes still owed to a multi-byte UTF-8 character: those go through the stream decoder.
  let owed = 0;
  const take = (ch: string, slice: number, baud: number) => {
    if (ch === '\n' && pendingCr) {
      pendingCr = false;
      return;
    }
    pendingCr = ch === '\r';
    if (ch === '\n' || ch === '\r') {
      lines.push(open ?? { slice, text: '', baud });
      open = null;
    } else {
      open ??= { slice, text: '', baud };
      open.text += ch;
    }
  };
  for (const run of runs) {
    const sent = new Uint8Array(run.size);
    const slices = new Float64Array(run.size);
    let at = 0;
    for (const c of run.chunks) {
      sent.set(c.bytes, at);
      slices.fill(c.slice, at, at + c.bytes.length);
      at += c.bytes.length;
    }
    const { bytes, from } = reframe(sent, run.baud, monitorBaud);
    const baud = run.baud > 0 ? (standardBaud(run.baud) ?? Math.round(run.baud)) : 0;
    // Decode byte by byte so every character knows the slice of the byte that completed it.
    for (let i = 0; i < bytes.length; i++) {
      const slice = slices[from ? (from[i] ?? 0) : i] ?? 0;
      const b = bytes[i] ?? 0;
      if (b < 0x80 && owed === 0) {
        if (b === 10 || b === 13) {
          take(b === 10 ? '\n' : '\r', slice, baud);
          continue;
        }
        // An ASCII span up to the next line ending is appended at once (the line keeps its first slice).
        let j = i + 1;
        for (; j < bytes.length && j - i < 4096; j++) {
          const c = bytes[j] ?? 0;
          if (c >= 0x80 || c === 10 || c === 13) break;
        }
        pendingCr = false;
        open ??= { slice, text: '', baud };
        open.text += String.fromCharCode(...bytes.subarray(i, j));
        i = j - 1;
        continue;
      }
      if (b >= 0xc0) owed = b >= 0xf0 ? 3 : b >= 0xe0 ? 2 : 1;
      else if (b >= 0x80 && owed > 0) owed--;
      else owed = 0; // a stray continuation or an ASCII byte ends the sequence
      for (const ch of utf8.decode(bytes.subarray(i, i + 1), { stream: true })) take(ch, slice, baud);
    }
  }
  if (open) lines.push(open);
  return {
    lines,
    sketchBaud,
    mismatch: sketchBaud !== null && sketchBaud !== monitorBaud,
    partial: open !== null,
  };
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

/** Serial output kept for export and diff (FR-SIM-21): the same cap as the grader's `MAX_SERIAL_CHARS`. */
export const SERIAL_ARCHIVE_BYTES = 1 << 20;

/**
 * The whole UART output of a run up to {@link SERIAL_ARCHIVE_BYTES}; past the cap the rest is dropped
 * and `truncated` is set (the first part is kept, like the grader).
 */
export class SerialArchive {
  readonly chunks: SerialChunk[] = [];
  bytes = 0;
  truncated = false;
  version = 0;

  append(chunks: readonly SerialChunk[]): void {
    for (const c of chunks) {
      if (this.truncated) return;
      const room = SERIAL_ARCHIVE_BYTES - this.bytes;
      const kept = c.bytes.length > room ? { ...c, bytes: c.bytes.slice(0, room) } : c;
      if (kept.bytes.length) this.chunks.push(kept);
      this.bytes += kept.bytes.length;
      this.truncated = c.bytes.length > room;
      this.version++;
    }
  }
}

/**
 * Lines of an archived run as a monitor at `monitorBaud` shows them, each stamped with the slice of
 * its first byte (1 slice = 1 ms, so `t_ms = slice`) and the rate it was sent at.
 */
export function serialLines(chunks: readonly SerialChunk[], monitorBaud: number): readonly SerialLine[] {
  return decodeSerial(chunks, monitorBaud).lines;
}
