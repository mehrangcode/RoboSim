import { describe, expect, it } from 'vitest';
import { glyphRows } from './lcd-font.js';

describe('HD44780 character ROM', () => {
  it('draws ASCII from the 5×7 font, with the ROM’s own ¥ and arrows', () => {
    expect(glyphRows(0x41)).toEqual([0b00100, 0b01010, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0]); // A
    expect(glyphRows(0x5c)).toEqual([0b10001, 0b01010, 0b11111, 0b00100, 0b11111, 0b00100, 0b00100, 0]); // ¥
    expect(glyphRows(0x7e)[3]).toBe(0b11111); // →
    expect(glyphRows(0x20).every((r) => r === 0)).toBe(true);
    expect(glyphRows(0xa0).every((r) => r === 0)).toBe(true);
  });
});
