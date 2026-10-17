import { UNO_ELECTRICAL, avrUno } from '@robosim/board-avr-uno';
import { validateManifest } from '@robosim/sim-core';
import { bench, firmware } from '@robosim/test-fixtures';
import { describe, expect, it } from 'vitest';
import { definition, manifest, type PassiveBuzzerState } from './index.js';

/** D9 (OC1A) setups: CTC toggle at 1 kHz like tone(), 8-bit fast PWM like analogWrite(), or held HIGH. */
const SETUP = {
  tone1k: `
    ldi r16, 0x03
    sts 0x89, r16          ; OCR1AH
    ldi r16, 0xE7
    sts 0x88, r16          ; OCR1AL = 999
    ldi r16, 0x40
    sts 0x80, r16          ; TCCR1A: COM1A0 (toggle)
    ldi r16, 0x0A
    sts 0x81, r16          ; TCCR1B: WGM12 (CTC) | CS11 (/8)`,
  pwm: `
    ldi r16, 0x00
    sts 0x89, r16
    ldi r16, 0x7F
    sts 0x88, r16          ; OCR1A = 127
    ldi r16, 0x81
    sts 0x80, r16          ; TCCR1A: COM1A1 | WGM10
    ldi r16, 0x0B
    sts 0x81, r16          ; TCCR1B: WGM12 | CS11 | CS10 (/64)`,
  high: `
    ldi r16, 0x02
    out 0x05, r16          ; PORTB1 high`,
};

function rig(mode: keyof typeof SETUP) {
  const fw = firmware(`
    ldi r16, 0x02
    out 0x04, r16          ; D9 output
    ${SETUP[mode]}
  halt: rjmp halt
  `);
  return bench({
    parts: { bz: { def: definition } },
    wires: [['mcu.D9', 'bz.pos']],
    ground: ['bz.neg'],
    mcu: { core: avrUno.createCore(fw), electrical: UNO_ELECTRICAL, pins: ['D9'] },
  });
}

describe('actuator.buzzer-passive', () => {
  it('has a valid manifest', () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it('sounds at the tone() frequency measured from pin edges', () => {
    const b = rig('tone1k');
    b.run(0.05);
    const s = b.state<PassiveBuzzerState>('bz');
    expect(s.sounding).toBe(true);
    expect(s.toneHz).toBeCloseTo(1000, 0);
    expect(s.loudness).toBeGreaterThan(0);
  });

  it('buzzes at the timer PWM frequency under analogWrite', () => {
    const b = rig('pwm');
    b.run(0.01);
    expect(b.state<PassiveBuzzerState>('bz').toneHz).toBeCloseTo(16e6 / (64 * 256), 1);
  });

  it('stays silent on DC and draws the 42 Ω coil current from the pin', () => {
    const b = rig('high');
    b.run(0.05);
    const s = b.state<PassiveBuzzerState>('bz');
    expect(s.sounding).toBe(false);
    expect(s.currentMa).toBeCloseTo((5 / (UNO_ELECTRICAL.outputResistance + 42)) * 1000, 0);
  });
});
