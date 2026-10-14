import { describe, expect, it } from 'vitest';
import { TIMER0_KIND, TIMER1_KIND, TIMER2_KIND, pwmFromRegisters } from '../src/index.js';

const CLK = 16_000_000;
const regs = (r: Partial<{ tccra: number; tccrb: number; ocrA: number; ocrB: number; icr: number }>) => ({
  tccra: 0,
  tccrb: 0,
  ocrA: 0,
  ocrB: 0,
  icr: 0,
  ...r,
});

describe('pwmFromRegisters', () => {
  it('timer0 fast PWM, Arduino default (/64): analogWrite(6, 64)', () => {
    const p = pwmFromRegisters(regs({ tccra: 0b1000_0011, tccrb: 0b011, ocrA: 63 }), TIMER0_KIND, 'A', CLK);
    expect(p).toEqual({ dutyRatio: 64 / 256, freqHz: 976.5625 });
  });

  it('timer1 8-bit phase-correct, Arduino default: analogWrite(9, 127)', () => {
    const p = pwmFromRegisters(regs({ tccra: 0b1000_0001, tccrb: 0b011, ocrA: 127 }), TIMER1_KIND, 'A', CLK);
    expect(p?.dutyRatio).toBeCloseTo(127 / 255, 12);
    expect(p?.freqHz).toBeCloseTo(CLK / (2 * 64 * 255), 9);
  });

  it('timer2 uses its own prescaler table (CS=4 → /64)', () => {
    const p = pwmFromRegisters(regs({ tccra: 0b0010_0001, tccrb: 0b100, ocrB: 51 }), TIMER2_KIND, 'B', CLK);
    expect(p?.dutyRatio).toBeCloseTo(0.2, 12);
    expect(p?.freqHz).toBeCloseTo(CLK / (2 * 64 * 255), 9);
  });

  it('timer1 fast PWM with ICR1 TOP (servo-style 50 Hz)', () => {
    // WGM 14: WGM11 in TCCR1A, WGM13|WGM12 in TCCR1B; /8; ICR1 = 39999 → 50 Hz; OCR1A = 2999 → 1.5 ms
    const p = pwmFromRegisters(
      regs({ tccra: 0b1000_0010, tccrb: 0b0001_1010, ocrA: 2999, icr: 39999 }),
      TIMER1_KIND,
      'A',
      CLK,
    );
    expect(p?.freqHz).toBe(50);
    expect(p?.dutyRatio).toBeCloseTo(1.5 / 20, 12);
  });

  it('inverting mode flips the duty', () => {
    const p = pwmFromRegisters(regs({ tccra: 0b1100_0011, tccrb: 0b011, ocrA: 63 }), TIMER0_KIND, 'A', CLK);
    expect(p?.dutyRatio).toBe(1 - 64 / 256);
  });

  it('toggle mode on OCnA with TOP = OCRnA gives 50 % at half frequency', () => {
    const p = pwmFromRegisters(
      regs({ tccra: 0b0100_0011, tccrb: 0b0000_1001, ocrA: 99 }),
      TIMER0_KIND,
      'A',
      CLK,
    );
    expect(p).toEqual({ dutyRatio: 0.5, freqHz: CLK / 100 / 2 });
  });

  it('returns null when stopped, disconnected, or not in a PWM mode', () => {
    expect(
      pwmFromRegisters(regs({ tccra: 0b1000_0011, tccrb: 0, ocrA: 10 }), TIMER0_KIND, 'A', CLK),
    ).toBeNull();
    expect(
      pwmFromRegisters(regs({ tccra: 0b0000_0011, tccrb: 0b011, ocrA: 10 }), TIMER0_KIND, 'A', CLK),
    ).toBeNull();
    expect(
      pwmFromRegisters(regs({ tccra: 0b1000_0010, tccrb: 0b011, ocrA: 10 }), TIMER0_KIND, 'A', CLK),
    ).toBeNull(); // CTC
    expect(pwmFromRegisters(regs({ tccra: 0b0100_0011, tccrb: 0b011 }), TIMER0_KIND, 'B', CLK)).toBeNull();
  });

  it('clamps OCR above TOP to a constant high output', () => {
    const p = pwmFromRegisters(
      regs({ tccra: 0b1000_0011, tccrb: 0b0000_1011, ocrA: 100, ocrB: 200 }),
      TIMER0_KIND,
      'B',
      CLK,
    );
    expect(p).toBeNull(); // COM0B is 0 here
    const q = pwmFromRegisters(
      regs({ tccra: 0b0010_0011, tccrb: 0b0000_1011, ocrA: 100, ocrB: 200 }),
      TIMER0_KIND,
      'B',
      CLK,
    );
    expect(q?.dutyRatio).toBe(1);
  });
});
