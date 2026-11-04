import { describe, expect, it } from 'vitest';
import type { SerialChunk } from './protocol.js';
import {
  SERIAL_ARCHIVE_BYTES,
  SERIAL_BAUD_RATES,
  SERIAL_TAIL_BYTES,
  SerialArchive,
  SerialLog,
  decodeSerial,
  framesExactly,
  reframeBits,
  resample,
  serialLines,
  standardBaud,
} from './serial.js';

const ascii = (s: string) => new TextEncoder().encode(s);
const chunk = (slice: number, baud: number, s: string): SerialChunk => ({ slice, baud, bytes: ascii(s) });
// Serial.begin(9600) / (115200) on a 16 MHz Uno (U2X, UBRR rounding).
const UNO_9600 = Math.floor(16e6 / (8 * 208));
const UNO_115200 = Math.floor(16e6 / (8 * 17));

describe('serial decoding (FR-SIM-07)', () => {
  it('maps the real USART rate to the standard rate the sketch asked for', () => {
    expect(standardBaud(UNO_9600)).toBe(9600);
    expect(standardBaud(UNO_115200)).toBe(115200);
    expect(standardBaud(0)).toBeNull();
    expect(standardBaud(12345)).toBeNull();
  });

  it('frames bytes unchanged when the rates match within UART tolerance', () => {
    const bytes = ascii('Hello, Arduino! 0123456789\r\n');
    expect([...resample(bytes, UNO_9600, 9600)]).toEqual([...bytes]);
    expect([...resample(bytes, UNO_115200, 115200)]).toEqual([...bytes]);
  });

  it('garbles deterministically when the monitor runs at another rate, like real hardware', () => {
    const bytes = ascii('tick 1\r\n');
    const fast = resample(bytes, UNO_9600, 115200);
    const slow = resample(bytes, UNO_115200, 9600);
    expect([...fast]).not.toEqual([...bytes]);
    expect([...slow]).not.toEqual([...bytes]);
    expect(fast.length).toBeGreaterThan(bytes.length); // fast receiver sees many frames per byte
    expect(slow.length).toBeLessThan(bytes.length); // slow receiver swallows several bytes per frame
    expect([...resample(bytes, UNO_9600, 115200)]).toEqual([...fast]);
  });

  it('splits lines on CR, LF and CRLF and stamps each with its first slice', () => {
    const d = decodeSerial(
      [
        chunk(3, UNO_9600, 'Robo'),
        chunk(4, UNO_9600, 'Sim ready\r\n'),
        chunk(1000, UNO_9600, 'tick 0\r\nhalf'),
      ],
      9600,
    );
    expect(d.lines).toEqual([
      { slice: 3, text: 'RoboSim ready', baud: 9600 },
      { slice: 1000, text: 'tick 0', baud: 9600 },
      { slice: 1000, text: 'half', baud: 9600 },
    ]);
    expect(d).toMatchObject({ sketchBaud: 9600, mismatch: false });
  });

  it('flags a baud mismatch with the rate the sketch uses', () => {
    const d = decodeSerial([chunk(1, UNO_9600, 'hello\r\n')], 115200);
    expect(d).toMatchObject({ sketchBaud: 9600, mismatch: true });
    expect(d.lines.map((l) => l.text).join('')).not.toContain('hello');
  });

  it('keeps the newest bytes and bumps its version on change', () => {
    const log = new SerialLog();
    log.append([chunk(1, UNO_9600, 'x'.repeat(SERIAL_TAIL_BYTES))]);
    log.append([chunk(2, UNO_9600, 'tail')]);
    expect(log.chunks.map((c) => c.slice)).toEqual([2]);
    expect(log.version).toBe(2);
    log.clear();
    expect(log.chunks).toEqual([]);
    expect(log.version).toBe(3);
  });
});

describe('serial archive and lines (FR-SIM-21)', () => {
  it('keeps the first SERIAL_ARCHIVE_BYTES and marks the archive truncated', () => {
    const a = new SerialArchive();
    const big = new Uint8Array(SERIAL_ARCHIVE_BYTES - 10).fill(65);
    a.append([{ slice: 1, baud: UNO_9600, bytes: big }]);
    expect(a.truncated).toBe(false);
    a.append([chunk(2, UNO_9600, '0123456789ABCDEF'), chunk(3, UNO_9600, 'more')]);
    expect(a.bytes).toBe(SERIAL_ARCHIVE_BYTES);
    expect(a.truncated).toBe(true);
    expect(a.chunks).toHaveLength(2);
    expect(new TextDecoder().decode(a.chunks[1]?.bytes)).toBe('0123456789');
  });

  it('stamps each line with the slice of its first byte across chunk boundaries', () => {
    const lines = serialLines(
      [chunk(5, UNO_9600, 'tick'), chunk(6, UNO_9600, ' 0\r\nti'), chunk(9, UNO_9600, 'ck 1\r\n')],
      9600,
    );
    expect(lines).toEqual([
      { slice: 5, text: 'tick 0', baud: 9600 },
      { slice: 6, text: 'tick 1', baud: 9600 },
    ]);
  });

  it('records the baud each line was sent at and garbles lines sent at another rate', () => {
    const lines = serialLines([chunk(1, UNO_9600, 'slow\n'), chunk(500, UNO_115200, 'fast\n')], 9600);
    expect(lines[0]).toEqual({ slice: 1, text: 'slow', baud: 9600 });
    expect(lines.at(-1)?.baud).toBe(115200);
    expect(lines.map((l) => l.text).join('\n')).not.toContain('fast');
  });

  it('decodes multi-byte UTF-8 split across chunks and invalid bytes like the stream decoder', () => {
    const fa = new TextEncoder().encode('سلام ✓ 😀\n');
    const lines = serialLines(
      [
        { slice: 1, baud: UNO_9600, bytes: fa.subarray(0, 3) },
        { slice: 2, baud: UNO_9600, bytes: fa.subarray(3) },
        { slice: 3, baud: UNO_9600, bytes: Uint8Array.from([0x41, 0x80, 0xc3, 0x42, 0xe2, 0x9c, 0x0a]) },
      ],
      9600,
    );
    expect(lines.map((l) => l.text)).toEqual([
      'سلام ✓ 😀',
      new TextDecoder().decode(Uint8Array.from([0x41, 0x80, 0xc3, 0x42, 0xe2, 0x9c])),
    ]);
  });

  it('skips bit-level re-framing only where it would return the bytes unchanged', () => {
    const bytes = Uint8Array.from({ length: 2048 }, (_, i) => (i * 73 + (i >> 3)) & 0xff);
    // Real 16 MHz USART rates for each standard rate, with and without U2X.
    const ubrr = (rate: number) =>
      [8, 16].map((d) => Math.floor(16e6 / (d * Math.max(1, Math.round(16e6 / (d * rate))))));
    let exact = 0;
    for (const rx of SERIAL_BAUD_RATES)
      for (const std of SERIAL_BAUD_RATES)
        for (const tx of [std, ...ubrr(std)]) {
          if (!framesExactly(tx, rx)) continue;
          exact++;
          const slow = reframeBits(bytes, tx, rx);
          expect([...slow.bytes]).toEqual([...bytes]);
          expect(slow.from).toEqual(Array.from(bytes, (_, i) => i));
        }
    expect(exact).toBeGreaterThan(SERIAL_BAUD_RATES.length * 2);
    expect(framesExactly(UNO_115200, 115200)).toBe(true);
    expect(framesExactly(UNO_9600, 115200)).toBe(false);
  });

  it('decodes 1 MB in a reasonable time', () => {
    const line = ascii('sensor=1023 distance=42.5 cm\r\n');
    const n = Math.floor(SERIAL_ARCHIVE_BYTES / line.length);
    const chunks = Array.from({ length: n }, (_, i): SerialChunk => ({
      slice: i * 3,
      baud: UNO_115200,
      bytes: line,
    }));
    const t0 = performance.now();
    expect(serialLines(chunks, 115200)).toHaveLength(n);
    expect(performance.now() - t0).toBeLessThan(2000); // budget 50 ms is checked by test:perf, CI machines vary
  });
});
