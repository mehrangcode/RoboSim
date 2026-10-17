import { describe, expect, it } from 'vitest';
import type { SerialChunk } from './protocol.js';
import { SERIAL_TAIL_BYTES, SerialLog, decodeSerial, resample, standardBaud } from './serial.js';

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
      { slice: 3, text: 'RoboSim ready' },
      { slice: 1000, text: 'tick 0' },
      { slice: 1000, text: 'half' },
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
