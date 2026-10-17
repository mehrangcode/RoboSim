import { UNO_ELECTRICAL, avrUno } from '@robosim/board-avr-uno';
import { validateManifest } from '@robosim/sim-core';
import { bench, dcSupply, firmware } from '@robosim/test-fixtures';
import { describe, expect, it } from 'vitest';
import { definition, manifest, type Stepper28byj48State } from './index.js';

/**
 * Two-phase full steps sinking the coils on D8 (blue), D9 (pink), D10 (yellow), D11 (orange), active
 * LOW: orange+yellow → yellow+pink → pink+blue → blue+orange, `loops` × 4 steps, `delayIters` × 4
 * cycles between steps (8000 ≈ 2 ms).
 */
function stepFirmware(loops: number, delayIters: number) {
  const delay = (k: string) => `
      ldi r24, ${delayIters & 0xff}
      ldi r25, ${delayIters >> 8}
    d${k}:
      sbiw r24, 1
      brne d${k}`;
  const step = (pattern: number, k: string) => `
      ldi r16, ${pattern}
      out 0x05, r16${delay(k)}`;
  return firmware(`
      ldi r16, 0x0F
      out 0x05, r16          ; all coils off (HIGH)
      out 0x04, r16          ; D8–D11 outputs
      ldi r20, ${loops}
    loop:
      ${step(0x03, 'a')}
      ${step(0x09, 'b')}
      ${step(0x0c, 'c')}
      ${step(0x06, 'd')}
      dec r20
      brne loop
      ldi r16, 0x0F
      out 0x05, r16
    halt: rjmp halt
  `);
}

function rig(loops: number, delayIters: number) {
  return bench({
    parts: { vcc: { def: dcSupply, props: { volts: 5, ohms: 0 } }, m: { def: definition } },
    wires: [
      ['vcc.pos', 'm.red'],
      ['mcu.D8', 'm.blue'],
      ['mcu.D9', 'm.pink'],
      ['mcu.D10', 'm.yellow'],
      ['mcu.D11', 'm.orange'],
    ],
    ground: ['vcc.neg'],
    mcu: {
      core: avrUno.createCore(stepFirmware(loops, delayIters)),
      electrical: UNO_ELECTRICAL,
      pins: ['D8', 'D9', 'D10', 'D11'],
    },
  });
}

describe('actuator.stepper-28byj48', () => {
  it('has a valid manifest', () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it('turns the output a quarter turn for 512 full steps (2048 per turn) at ≈ 15 rpm', () => {
    const b = rig(128, 8000); // 2 ms per step
    b.run(0.5);
    const mid = b.state<Stepper28byj48State>('m');
    expect(mid.rpm).toBeCloseTo((500 / 2048) * 60, 0);
    expect(mid.energized).toHaveLength(2);
    b.run(1);
    const s = b.state<Stepper28byj48State>('m');
    // The rotor starts aligned with one coil; two-phase steps sit half a step off it.
    expect(s.shaftDeg).toBeCloseTo(90 - 360 / 4096, 6);
    expect(s.missedSteps).toBe(0);
  });

  it('loses steps when driven faster than its pull-in rate', () => {
    const b = rig(128, 1000); // 0.25 ms per step: 4000 steps/s
    b.run(0.5);
    const s = b.state<Stepper28byj48State>('m');
    expect(s.missedSteps).toBeGreaterThan(0);
    expect(Math.abs(s.steps)).toBeLessThan(512);
  });
});
