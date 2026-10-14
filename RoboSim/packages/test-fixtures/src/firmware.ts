import { toIntelHex } from '@robosim/board-avr-uno';
import type { FirmwareImage } from '@robosim/sim-core';
// The ESM build lacks "type": "module", so Node can only load the CJS build of this helper.
import { assemble } from 'avr8js/dist/cjs/utils/assembler.js';

/** Assembles an AVR program into Intel HEX firmware for tests (no avr-gcc needed). */
export function firmware(source: string): FirmwareImage {
  const { errors, bytes } = assemble(source);
  if (errors.length > 0) throw new Error(`Assembly failed:\n${errors.join('\n')}`);
  const hex = toIntelHex(bytes);
  return { format: 'ihex', bytes: Uint8Array.from(hex, (c) => c.charCodeAt(0)), sha256: 'test' };
}
