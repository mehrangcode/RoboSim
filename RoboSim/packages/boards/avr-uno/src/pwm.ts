import type { PwmOutput } from '@robosim/sim-core';

/** Raw register values of one ATmega328P timer. */
export interface TimerRegisters {
  readonly tccra: number;
  readonly tccrb: number;
  readonly ocrA: number;
  readonly ocrB: number;
  /** Timer1 only. */
  readonly icr: number;
}

export interface TimerKind {
  readonly sixteenBit: boolean;
  /** Clock-select (CS2:0) → prescaler; 0 = stopped, -1 = external clock. */
  readonly prescalers: readonly number[];
}

export const TIMER0_KIND: TimerKind = { sixteenBit: false, prescalers: [0, 1, 8, 64, 256, 1024, -1, -1] };
export const TIMER1_KIND: TimerKind = { sixteenBit: true, prescalers: [0, 1, 8, 64, 256, 1024, -1, -1] };
export const TIMER2_KIND: TimerKind = { sixteenBit: false, prescalers: [0, 1, 8, 32, 64, 128, 256, 1024] };

type Top = number | 'ocrA' | 'icr';
interface WaveMode {
  readonly fast: boolean;
  readonly top: Top;
}

const EIGHT_BIT_MODES: Readonly<Record<number, WaveMode>> = {
  1: { fast: false, top: 0xff },
  3: { fast: true, top: 0xff },
  5: { fast: false, top: 'ocrA' },
  7: { fast: true, top: 'ocrA' },
};

const TIMER1_MODES: Readonly<Record<number, WaveMode>> = {
  1: { fast: false, top: 0xff },
  2: { fast: false, top: 0x1ff },
  3: { fast: false, top: 0x3ff },
  5: { fast: true, top: 0xff },
  6: { fast: true, top: 0x1ff },
  7: { fast: true, top: 0x3ff },
  8: { fast: false, top: 'icr' }, // phase & frequency correct
  9: { fast: false, top: 'ocrA' },
  10: { fast: false, top: 'icr' },
  11: { fast: false, top: 'ocrA' },
  14: { fast: true, top: 'icr' },
  15: { fast: true, top: 'ocrA' },
};

/**
 * Derives PWM duty and frequency for one output-compare channel from timer configuration registers
 * (Technical Design §5.3) — exact for any slice length, unlike sampling edges at 1 ms.
 * Returns null when the channel is not generating PWM (timer stopped, non-PWM mode, pin disconnected).
 * Reads the most recently written OCR; double-buffered updates take effect within one PWM period.
 */
export function pwmFromRegisters(
  regs: TimerRegisters,
  kind: TimerKind,
  channel: 'A' | 'B',
  clockHz: number,
): PwmOutput | null {
  const wgm = (regs.tccra & 0b11) | (((regs.tccrb >> 3) & (kind.sixteenBit ? 0b11 : 0b01)) << 2);
  const mode = (kind.sixteenBit ? TIMER1_MODES : EIGHT_BIT_MODES)[wgm];
  const prescaler = kind.prescalers[regs.tccrb & 0b111] ?? 0;
  if (!mode || prescaler <= 0) return null;

  const top = mode.top === 'ocrA' ? regs.ocrA : mode.top === 'icr' ? regs.icr : mode.top;
  if (top <= 0) return null;
  const com = (regs.tccra >> (channel === 'A' ? 6 : 4)) & 0b11;
  const freqHz = mode.fast ? clockHz / (prescaler * (top + 1)) : clockHz / (2 * prescaler * top);

  if (com === 1) {
    // Only OCnA with TOP = OCRnA toggles on compare match: 50 % duty at half the frequency.
    return channel === 'A' && mode.top === 'ocrA' ? { dutyRatio: 0.5, freqHz: freqHz / 2 } : null;
  }
  if (com === 0) return null;

  const ocr = channel === 'A' ? regs.ocrA : regs.ocrB;
  const high = mode.fast ? Math.min(1, (ocr + 1) / (top + 1)) : Math.min(1, ocr / top);
  return { dutyRatio: com === 2 ? high : 1 - high, freqHz };
}
