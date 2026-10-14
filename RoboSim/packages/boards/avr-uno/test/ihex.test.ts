import { describe, expect, it } from 'vitest';
import { IntelHexError, parseIntelHex, toIntelHex } from '../src/index.js';

describe('Intel HEX', () => {
  it('round-trips bytes and leaves the rest erased (0xFF)', () => {
    const data = Uint8Array.from({ length: 40 }, (_, i) => i * 3);
    const image = parseIntelHex(toIntelHex(data), 64);
    expect(Array.from(image.subarray(0, 40))).toEqual(Array.from(data));
    expect(image[40]).toBe(0xff);
  });

  it('parses a real avr-gcc style record with extended addressing', () => {
    const hex = [':020000040000FA', ':0400100001020304E2', ':00000001FF'].join('\r\n');
    const image = parseIntelHex(hex, 32);
    expect(Array.from(image.subarray(16, 20))).toEqual([1, 2, 3, 4]);
  });

  it('rejects bad checksums, overflow, garbage and missing EOF', () => {
    expect(() => parseIntelHex(':0400100001020304E3\n:00000001FF', 32)).toThrow(/checksum/);
    expect(() => parseIntelHex(':0400100001020304E2\n:00000001FF', 16)).toThrow(/exceeds/);
    expect(() => parseIntelHex('hello\n:00000001FF', 16)).toThrow(IntelHexError);
    expect(() => parseIntelHex(':0400100001020304E2', 32)).toThrow(/EOF/);
  });
});
