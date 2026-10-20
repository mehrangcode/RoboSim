import type { I2cBusHandler } from '@robosim/sim-core';
import { describe, expect, it } from 'vitest';
import { UNO_CLOCK_HZ } from '../../src/index.js';
import { Bench, US, meanPeriod } from './harness.js';

/*
 * Peripheral conformance of the Uno (Engineering Guide §6): real Arduino sketches, compiled by the build
 * service, checked against the ATmega328P datasheet and the Arduino core's own arithmetic. Runs in Node and,
 * via vitest.browser.config.ts, in Chromium and Firefox. avr8js may differ from silicon by one timer tick
 * (Technical Design §5.2), which the PWM checks allow.
 */

const within = (actual: number, expected: number, tolerance: number) =>
  expect(Math.abs(actual - expected), `${actual} vs ${expected} ± ${tolerance}`).toBeLessThanOrEqual(
    tolerance,
  );

describe('timers and PWM (analogWrite)', () => {
  // Timer0: fast PWM, prescaler 64 → 256 × 64 cycles, high for (OCR + 1) ticks. Timer1/Timer2: phase-correct,
  // prescaler 64 → 510 × 64 cycles, high for 2 × OCR ticks.
  const TICK = 64;
  const cases = [
    { pin: 'D5', value: 128, period: 256 * TICK, high: 129 * TICK },
    { pin: 'D6', value: 191, period: 256 * TICK, high: 192 * TICK },
    { pin: 'D9', value: 32, period: 510 * TICK, high: 2 * 32 * TICK },
    { pin: 'D10', value: 224, period: 510 * TICK, high: 2 * 224 * TICK },
    { pin: 'D3', value: 64, period: 510 * TICK, high: 2 * 64 * TICK },
    { pin: 'D11', value: 100, period: 510 * TICK, high: 2 * 100 * TICK },
  ] as const;
  const bench = new Bench('pwm').runTo(0.1);

  it.each(cases)('$pin at $value: edges have the datasheet period and high time', ({ pin, period, high }) => {
    // One timer tick, plus a cycle of edge stamping.
    expect(bench.pinEdges(pin, 1, 0.02).length).toBeGreaterThan(30);
    for (const gap of bench.gaps(pin, 1, 0.02)) within(gap, period, TICK + 2);
    for (const h of bench.highTimes(pin, 0.02)) within(h, high, TICK + 2);
  });

  it.each(cases)('$pin at $value: the register-derived PWM matches the edges', ({ pin, period, high }) => {
    const pwm = bench.core.pinOutputs().get(pin)?.pwm;
    expect(pwm).toBeDefined();
    within(pwm?.freqHz ?? 0, UNO_CLOCK_HZ / period, 0.01 * (UNO_CLOCK_HZ / period));
    within(pwm?.dutyRatio ?? 0, high / period, 1 / 255);
  });
});

describe('time keeping (millis, micros, delayMicroseconds)', () => {
  const bench = new Bench('timing').runTo(1.05);

  it('delayMicroseconds(1000) holds the pin for 1000 µs', () => {
    const [width] = bench.highTimes('D4');
    within((width ?? 0) / US, 1000, 2);
  });

  it('millis() steps of 100 ms land within its 1.024 ms tick and are exact on average', () => {
    const edges = bench.pinEdges('D7');
    expect(edges.length).toBe(10);
    for (const gap of bench.gaps('D7')) within(gap / US, 100_000, 1100);
    within(meanPeriod(edges) / US, 100_000, 150);
  });

  it('micros() steps of 500 µs land within its 4 µs resolution and one loop pass, exact on average', () => {
    const edges = bench.pinEdges('D8', undefined, 0.01);
    expect(edges.length).toBeGreaterThan(1900);
    for (const gap of bench.gaps('D8', undefined, 0.01)) within(gap / US, 500, 16);
    within(meanPeriod(edges) / US, 500, 0.05);
  });
});

describe('tone() and Servo', () => {
  const bench = new Bench('toneServo').runTo(0.25);

  it('tone(440) toggles at OCR2A = 141 with prescaler 128: 440.14 Hz', () => {
    // Arduino picks the smallest prescaler with OCR ≤ 255: 16 MHz / 440 / 2 / 128 − 1 = 141.
    // Hardware CTC keeps the period; the toggling ISR jitters when the Servo or millis ISR runs first.
    const half = 128 * 142;
    for (const gap of bench.gaps('D8', undefined, 0.01)) within(gap, half, 200);
    within(UNO_CLOCK_HZ / (2 * meanPeriod(bench.pinEdges('D8', undefined, 0.01))), 440.14, 0.01);
  });

  it('Servo.writeMicroseconds(1500) sends 1500 µs pulses every 20 ms', () => {
    const widths = bench.highTimes('D9', 0.03);
    expect(widths.length).toBeGreaterThan(8);
    for (const w of widths) within(w / US, 1500, 6);
    for (const gap of bench.gaps('D9', 1, 0.03)) within(gap / US, 20_000, 50);
  });
});

describe('ADC (analogRead)', () => {
  const volts = [0, 1, 2.5, 3.3, 4.99, 5];
  const bench = new Bench('adc');
  volts.forEach((v, i) => bench.drive(`A${i}`, 0, v));
  bench.runTo(0.2);

  it('converts Vin × 1024 / Vref on all six channels (AVcc = 5 V) and against the 1.1 V reference', () => {
    const last = bench.lines().at(-1)?.trim().split(' ').map(Number) ?? [];
    expect(last).toHaveLength(7);
    volts.forEach((v, i) => within(last[i] ?? -1, Math.min(1023, Math.floor((v * 1024) / 5)), 1));
    within(last[6] ?? -1, Math.floor((1 * 1024) / 1.1), 1); // A1 = 1 V, INTERNAL reference
  });

  it('takes 13 ADC clocks at 125 kHz per conversion (≈ 104 µs plus call overhead)', () => {
    const [frame] = bench.highTimes('D8');
    const perConversion = (frame ?? 0) / 10 / US;
    expect(perConversion).toBeGreaterThanOrEqual(104);
    expect(perConversion).toBeLessThan(116);
  });
});

describe('USART (Serial)', () => {
  const bench = new Bench('uart').runTo(0.05);
  const spacing = (from: number, to: number) => {
    const s = bench.serial.slice(from, to);
    return s.slice(1).map((x, i) => x.cycle - (s[i]?.cycle ?? 0));
  };

  it('sends 10-bit frames at 9615 baud for Serial.begin(9600) (U2X, UBRR 207)', () => {
    expect(bench.text().startsWith('0123456789abcdefghij')).toBe(true);
    const frame = (10 * UNO_CLOCK_HZ) / (UNO_CLOCK_HZ / (8 * 208));
    for (const gap of spacing(1, 10)) within(gap, frame, 1);
  });

  it('switches to 117647 baud for Serial.begin(115200) (U2X, UBRR 16)', () => {
    const frame = (10 * UNO_CLOCK_HZ) / (UNO_CLOCK_HZ / (8 * 17));
    // Back to back: the next byte waits in UDR while one shifts out (double-buffered transmitter).
    for (const gap of spacing(11, 20)) within(gap, frame, 1);
    within(bench.core.uart(0).baud(), UNO_CLOCK_HZ / (8 * 17), 1);
  });

  it('receives bytes the firmware echoes back', () => {
    bench.core.uart(0).write(Uint8Array.of(0x41, 0x5a)); // 'AZ'
    bench.runTo(0.06);
    expect(bench.text().endsWith('B[')).toBe(true);
  });
});

describe('interrupts', () => {
  const bench = new Bench('interrupts');
  for (let k = 0; k < 5; k++) {
    const t = 0.01 + 0.002 * k;
    bench
      .pulse('D2', t, 500)
      .pulse('D3', t + 0.0001, 500)
      .pulse('D4', t + 0.0002, 500);
  }
  bench.runTo(0.03);
  bench.core.uart(0).write(Uint8Array.of(0x3f));
  bench.runTo(0.04);

  it('counts INT0 rising, INT1 falling and pin-change edges exactly', () => {
    expect(bench.lines().at(-1)).toBe('5 5 10');
  });

  it('enters the INT0 handler within a few microseconds of the edge', () => {
    const toggles = bench.pinEdges('D13');
    expect(toggles).toHaveLength(5);
    toggles.forEach((e, k) => {
      const latency = e.cycle - Math.round((0.01 + 0.002 * k) * UNO_CLOCK_HZ);
      expect(latency).toBeGreaterThanOrEqual(4);
      expect(latency).toBeLessThan(120);
    });
  });

  it('fires the Timer1 compare ISR every OCR1A + 1 = 1000 ticks of 0.5 µs', () => {
    const edges = bench.pinEdges('D8', undefined, 0.001);
    expect(edges.length).toBeGreaterThan(70);
    // Exact on average; a single toggle waits when the millis ISR is running.
    for (const gap of bench.gaps('D8', undefined, 0.001)) within(gap, 8000, 100);
    within(meanPeriod(edges), 8000, 0.5);
  });
});

describe('pulseIn()', () => {
  const widths = [50, 1234, 20_000];
  const bench = new Bench('pulseIn');
  widths.forEach((w, i) => bench.pulse('D7', 0.15 + 0.03 * i, w));
  bench.runTo(0.3);

  it('times out to 0 without a pulse, then measures each pulse as a real Uno does', () => {
    const values = bench.lines().map(Number);
    expect(values[0]).toBe(0);
    const measured = values.filter((v) => v > 0);
    expect(measured).toHaveLength(widths.length);
    // pulseIn counts 16-cycle loop passes with interrupts on: every 1.024 ms the millis ISR steals its
    // ≈ 6 µs, so long pulses read short (as on the board), never long.
    widths.forEach((w, i) => {
      const v = measured[i] ?? 0;
      expect(v).toBeLessThanOrEqual(w + 3);
      expect(v).toBeGreaterThanOrEqual(w - 3 - (w / 1024) * 7);
    });
  });
});

describe('EEPROM', () => {
  const bench = new Bench('eeprom').runTo(0.05);
  const parse = (line: string | undefined) => {
    const m = /^boot (\d+) len (\d+) f ([\d.]+) us (\d+)$/.exec(line ?? '');
    return m ? { boot: Number(m[1]), len: Number(m[2]), f: Number(m[3]), us: Number(m[4]) } : null;
  };

  it('starts erased (0xFF), is 1 KB, and round-trips a float', () => {
    expect(parse(bench.lines()[0])).toMatchObject({ boot: 255, len: 1024, f: 3.14159 });
  });

  it('takes ≈ 3.4 ms per erase-and-write, as the datasheet says (tWD_EEPROM)', () => {
    const us = parse(bench.lines()[0])?.us ?? 0;
    expect(us / 2).toBeGreaterThan(3200);
    expect(us / 2).toBeLessThan(3800);
  });

  it('keeps its contents across a reset', () => {
    bench.serial.length = 0;
    bench.core.reset();
    bench.runTo(0.05);
    expect(parse(bench.lines()[0])?.boot).toBe(0);
    bench.serial.length = 0;
    bench.core.reset();
    bench.runTo(0.05);
    expect(parse(bench.lines()[0])?.boot).toBe(1);
  });
});

describe('TWI (Wire)', () => {
  const events: { kind: string; value: number; time: number }[] = [];
  let next = 0;
  const device: I2cBusHandler = {
    start: (_repeated, time) => events.push({ kind: 'start', value: 0, time }),
    connect: (address, read, time) => (
      events.push({ kind: read ? 'read' : 'write', value: address, time }),
      address === 0x50
    ),
    write: (byte, time) => (events.push({ kind: 'byte', value: byte, time }), true),
    read: (_ack, time) => (events.push({ kind: 'out', value: 0, time }), [0x11, 0x22, 0x33][next++] ?? 0xff),
    stop: (time) => events.push({ kind: 'stop', value: 0, time }),
  };
  const bench = new Bench('i2c');
  bench.core.attachI2c(device);
  bench.runTo(0.05);

  it('ACKs a present address, reports NACK (2) for an absent one, and reads bytes back', () => {
    expect(bench.lines().at(-1)).toBe('0 2 3 17 34 51');
    expect(events.filter((e) => e.kind === 'byte').map((e) => e.value)).toEqual([
      0x10, 0xab, 0xcd, 0x10, 0xab, 0xcd,
    ]);
  });

  it('clocks 9 bits per byte at the Wire.setClock frequency (100 kHz, then 400 kHz)', () => {
    const byteTimes = events.filter((e) => e.kind === 'byte').map((e) => e.time * 1e6);
    const gap = (i: number) => (byteTimes[i + 1] ?? 0) - (byteTimes[i] ?? 0);
    // 9 / 100 kHz = 90 µs and 9 / 400 kHz = 22.5 µs, plus the Wire library's work between bytes.
    for (const i of [0, 1]) within(gap(i), 90 + 15, 15);
    for (const i of [3, 4]) within(gap(i), 22.5 + 15, 15);
  });
});

describe('SPI', () => {
  const transfers: { byte: number; time: number }[] = [];
  const bench = new Bench('spi');
  bench.core.attachSpi({ transfer: (byte, time) => (transfers.push({ byte, time }), byte ^ 0xff) });
  bench.runTo(0.05);

  it('shifts a byte out and the answer in, full duplex', () => {
    expect(transfers.map((t) => t.byte)).toEqual([0x3c, 0xc3, 0x5a]);
    expect(bench.lines().at(-1)).toBe('195 60 165');
  });

  it('takes 8 SCK periods per byte: 8 µs at 1 MHz, 2 µs at 4 MHz', () => {
    const [a, b, c] = transfers.map((t) => t.time * 1e6);
    expect((b ?? 0) - (a ?? 0)).toBeGreaterThanOrEqual(8);
    expect((b ?? 0) - (a ?? 0)).toBeLessThan(18);
    const csHigh = bench
      .pinEdges('D10', 1)
      .map((e) => e.cycle / US)
      .find((t) => t > (c ?? 0));
    expect((csHigh ?? 0) - (c ?? 0)).toBeGreaterThanOrEqual(2);
    expect((csHigh ?? 0) - (c ?? 0)).toBeLessThan(12);
  });
});
