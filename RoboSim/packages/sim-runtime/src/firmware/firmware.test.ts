import { toIntelHex } from '@robosim/board-avr-uno';
import { assemble } from 'avr8js/dist/cjs/utils/assembler.js';
import { describe, expect, it } from 'vitest';
import { FIRMWARE_HEX } from './generated.js';
import { FIRMWARE_SOURCES } from './sources.js';

describe('demo firmware', () => {
  it('generated.ts matches the assembly sources (run gen:firmware after editing sources.ts)', () => {
    for (const [id, source] of Object.entries(FIRMWARE_SOURCES)) {
      const { errors, bytes } = assemble(source);
      expect(errors, id).toEqual([]);
      expect(FIRMWARE_HEX[id as keyof typeof FIRMWARE_HEX], id).toBe(toIntelHex(bytes));
    }
  });
});
