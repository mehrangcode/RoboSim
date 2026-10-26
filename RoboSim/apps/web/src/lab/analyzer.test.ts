import type { PinTrace } from '@robosim/sim-runtime/client';
import { describe, expect, it } from 'vitest';
import { durationParts, levelAt, measureAt, nearestEdge, tracePath } from './analyzer.js';

/** 1 kHz, 25 % duty at 16 MHz: high 4000 cycles, low 12000, starting low. */
const pwm: PinTrace = {
  pin: 'D9',
  initial: 0,
  cycles: [1000, 5000, 17000, 21000, 33000, 37000],
  levels: [1, 0, 1, 0, 1, 0],
};

describe('logic analyzer measurements (FR-SIM-08)', () => {
  it('reads levels between edges', () => {
    expect(levelAt(pwm, 0)).toBe(0);
    expect(levelAt(pwm, 1000)).toBe(1);
    expect(levelAt(pwm, 4999)).toBe(1);
    expect(levelAt(pwm, 5000)).toBe(0);
    expect(levelAt(pwm, 99_999)).toBe(0);
  });

  it('measures width, period and duty of the pulse under the cursor (US-SIM-02 AC2)', () => {
    expect(measureAt(pwm, 3000)).toEqual({ level: 1, width: 4000, period: 16000, duty: 0.25 });
    expect(measureAt(pwm, 10_000)).toEqual({ level: 0, width: 12000, period: 16000, duty: 0.25 });
    // Without the closing edges only what is known is reported.
    expect(measureAt(pwm, 34_000)).toEqual({ level: 1, width: 4000 });
    expect(measureAt(pwm, 40_000)).toEqual({ level: 0 });
    expect(measureAt(pwm, 10)).toEqual({ level: 0 });
    // 4000 cycles at 16 MHz is 250 µs, resolved to the cycle (62.5 ns).
    expect(durationParts(4000 / 16e6)).toEqual({ value: 250, unit: 'us' });
    expect(durationParts(1 / 16e6)).toEqual({ value: 62.5, unit: 'ns' });
  });

  it('snaps to the nearest edge on any pin', () => {
    const other: PinTrace = { pin: 'D10', initial: 1, cycles: [3000], levels: [0] };
    expect(nearestEdge([pwm, other], 1000, 1)).toBe(3000);
    expect(nearestEdge([pwm, other], 3000, -1)).toBe(1000);
    expect(nearestEdge([pwm, other], 40_000, 1)).toBeNull();
  });

  it('draws steps, collapsing edges that share a pixel column', () => {
    const y = (l: 0 | 1) => (l ? 0 : 10);
    expect(tracePath(pwm, 0, 20_000, (c) => c / 1000, y)).toBe('M0.0 10H1V0H5V10H17V0H20.0');
    // Zoomed far out the edges fall on pixels 0 and 1: one vertical stroke per column, ending at
    // the column's last level.
    expect(tracePath(pwm, 0, 40_000, (c) => c / 40_000, y)).toBe('M0.0 10H0V0H1V10H1.0');
    // A pulse inside one column still shows (up and back down), and the pen stays low after it.
    const blip: PinTrace = { pin: 'D2', initial: 0, cycles: [100, 200], levels: [1, 0] };
    expect(tracePath(blip, 0, 10_000, (c) => c / 1000, y)).toBe('M0.0 10H0V0V10H10.0');
  });
});
