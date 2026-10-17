import { UNO_ELECTRICAL, avrUno } from '@robosim/board-avr-uno';
import { validateManifest } from '@robosim/sim-core';
import { bench, firmware } from '@robosim/test-fixtures';
import { describe, expect, it } from 'vitest';
import { definition, keyInput, manifest, type KeypadState } from './index.js';

/**
 * Rows R1–R4 on D2–D5 with pull-ups, column C1 on D6. After 16 ms the firmware makes C1 an output
 * HIGH, then pulls it LOW and reads PIND at the next instruction — the Keypad library's scan step.
 * D13 goes HIGH if R1 read LOW, i.e. the key joined them within that one instruction.
 */
const SCAN = firmware(`
    ldi r16, 0x3C
    out 0x0B, r16          ; PORTD2..5 pull-ups (inputs)
    ldi r16, 0x20
    out 0x04, r16          ; D13 output
    ldi r24, 0x00
    ldi r25, 0x00
  wait:
    sbiw r24, 1
    brne wait
    sbi 0x0B, 6            ; C1 PORT HIGH (still an input)
    sbi 0x0A, 6            ; C1 output HIGH
    cbi 0x0B, 6            ; C1 LOW: an edge, not a mode change
    in r17, 0x09           ; PIND right away
    sbrs r17, 2            ; R1 still HIGH? skip
    sbi 0x05, 5            ; R1 LOW → D13 HIGH
  halt: rjmp halt
`);

function rig(key: string | null) {
  const b = bench({
    parts: { kp: { def: definition } },
    wires: [
      ['mcu.D2', 'kp.r1'],
      ['mcu.D3', 'kp.r2'],
      ['mcu.D4', 'kp.r3'],
      ['mcu.D5', 'kp.r4'],
      ['mcu.D6', 'kp.c1'],
    ],
    mcu: {
      core: avrUno.createCore(SCAN),
      electrical: UNO_ELECTRICAL,
      pins: ['D2', 'D3', 'D4', 'D5', 'D6', 'D13'],
    },
  });
  if (key) b.input('kp', keyInput(key), true);
  return b;
}

describe('sensor.keypad-4x4', () => {
  it('has a valid manifest', () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it('a held key joins its row to its column within one instruction (scan step)', () => {
    const b = rig('1');
    b.run(0.03);
    expect(b.state<KeypadState>('kp').pressed).toEqual(['1']);
    expect(b.sim.mcu?.pinOutputs().get('D13')?.level).toBe(1);
  });

  it('a key in another row or column does not answer', () => {
    for (const key of [null, '4', '2']) {
      const b = rig(key);
      b.run(0.03);
      expect(b.sim.mcu?.pinOutputs().get('D13')?.level, String(key)).toBe(0);
    }
  });
});
