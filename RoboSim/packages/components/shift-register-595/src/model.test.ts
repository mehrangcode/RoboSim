import { UNO_ELECTRICAL, avrUno } from '@robosim/board-avr-uno';
import { validateManifest } from '@robosim/sim-core';
import { bench, dcSupply, firmware } from '@robosim/test-fixtures';
import { describe, expect, it } from 'vitest';
import { definition, manifest, type ShiftRegisterState } from './index.js';

/** Bit-bangs `bytes` MSB first on D2 (SER) / D3 (SRCLK), then pulses D4 (RCLK) — what shiftOut() does. */
function shiftFirmware(bytes: readonly number[]) {
  const send = bytes
    .map(
      (b, k) => `
      ldi r18, ${b}
      ldi r19, 8
    bit${k}:
      cbi 0x0B, 2
      sbrc r18, 7
      sbi 0x0B, 2
      sbi 0x0B, 3
      cbi 0x0B, 3
      lsl r18
      dec r19
      brne bit${k}`,
    )
    .join('\n');
  return firmware(`
      ldi r16, 0x1C
      out 0x0A, r16          ; D2, D3, D4 outputs
      ${send}
      sbi 0x0B, 4
      cbi 0x0B, 4
    halt: rjmp halt
  `);
}

function rig(bytes: readonly number[], chips = 1, tie: { oe?: 'vcc'; srclr?: 'gnd' } = {}) {
  const parts: Record<string, unknown> = { vcc: { def: dcSupply, props: { volts: 5, ohms: 0 } } };
  const wires: [string, string][] = [];
  const ground = ['vcc.neg'];
  for (let c = 1; c <= chips; c++) {
    parts[`u${c}`] = { def: definition };
    wires.push(
      ['vcc.pos', `u${c}.vcc`],
      ['mcu.D3', `u${c}.srclk`],
      ['mcu.D4', `u${c}.rclk`],
      [c === 1 ? 'mcu.D2' : `u${c - 1}.qh2`, `u${c}.ser`],
    );
    if (tie.srclr === 'gnd') ground.push(`u${c}.srclr`);
    else wires.push(['vcc.pos', `u${c}.srclr`]);
    ground.push(`u${c}.gnd`);
    if (tie.oe === 'vcc') wires.push(['vcc.pos', `u${c}.oe`]);
    else ground.push(`u${c}.oe`);
  }
  return bench({
    parts: parts as never,
    wires,
    ground,
    mcu: {
      core: avrUno.createCore(shiftFirmware(bytes)),
      electrical: UNO_ELECTRICAL,
      pins: ['D2', 'D3', 'D4'],
    },
  });
}

const byteOf = (s: ShiftRegisterState) => s.outputs.reduce<number>((v, l, i) => v | ((l ?? 0) << i), 0);

describe('ic.74hc595', () => {
  it('has a valid manifest', () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it('latches a byte shifted in MSB first (QA = bit 0)', () => {
    const b = rig([0xb2]);
    b.run(0.005);
    expect(byteOf(b.state<ShiftRegisterState>('u1'))).toBe(0xb2);
    expect(b.volts('u1.qh')).toBeGreaterThan(4.9);
    expect(b.volts('u1.qa')).toBeLessThan(0.1);
  });

  it('chains through QH′: the first byte ends up in the second chip', () => {
    const b = rig([0xb2, 0x0f], 2);
    b.run(0.005);
    expect(byteOf(b.state<ShiftRegisterState>('u1'))).toBe(0x0f);
    expect(byteOf(b.state<ShiftRegisterState>('u2'))).toBe(0xb2);
  });

  it('floats QA–QH while OE is HIGH and stays clear while SRCLR is LOW', () => {
    const off = rig([0xff], 1, { oe: 'vcc' });
    off.run(0.005);
    expect(off.state<ShiftRegisterState>('u1').outputs.every((l) => l === null)).toBe(true);
    const cleared = rig([0xff], 1, { srclr: 'gnd' });
    cleared.run(0.005);
    expect(byteOf(cleared.state<ShiftRegisterState>('u1'))).toBe(0);
  });
});
