import { describe, expect, it } from 'vitest';
import type { AvrUnoCore } from '../src/index.js';
import { avrUno } from '../src/index.js';
import { firmware } from './firmware.js';

// I/O-space addresses (data address − 0x20) for in/out/sbi/cbi; data addresses for lds/sts.
const PINB = 0x03,
  DDRB = 0x04,
  PORTB = 0x05,
  PIND = 0x09,
  DDRD = 0x0a,
  PORTD = 0x0b;

function core(source: string): AvrUnoCore {
  return avrUno.createCore(firmware(source)) as AvrUnoCore;
}

describe('AvrUnoCore', () => {
  it('drives D13 high and reports every pin mode', () => {
    const c = core(`
      ldi r16, 0x20
      out ${DDRB}, r16
      out ${PORTB}, r16
    halt: rjmp halt
    `);
    c.run(100);
    const pins = c.pinOutputs();
    expect(pins.get('D13')).toEqual({ mode: 'output', level: 1 });
    expect(pins.get('D12')).toEqual({ mode: 'input', level: 0 });
    expect(pins.size).toBe(20);
  });

  it('reports output edges with exact cycle stamps', () => {
    const c = core(`
      ldi r16, 0x20
      out ${DDRB}, r16
    loop:
      out ${PINB}, r16   ; writing 1 to PINx toggles the pin (1 cycle)
      rjmp loop          ; 2 cycles
    `);
    const edges: [string, number, number][] = [];
    c.onPinEdge((pin, level, cycle) => edges.push([pin, level, cycle]));
    c.run(40);
    expect(edges.length).toBeGreaterThan(8);
    expect(edges.every(([pin]) => pin === 'D13')).toBe(true);
    expect(edges.map(([, level]) => level)).toEqual(edges.map((_, i) => (i % 2 === 0 ? 1 : 0)));
    const gaps = edges.slice(1).map(([, , cy], i) => cy - (edges[i]?.[2] ?? 0));
    expect(new Set(gaps)).toEqual(new Set([3]));
  });

  it('reports driven input level changes at the cycle they take effect (logic analyzer)', () => {
    const c = core('halt: rjmp halt');
    const seen: [string, number, number][] = [];
    const off = c.onPinInput((pin, level, cycle) => seen.push([pin, level, cycle]));
    c.scheduleInput('D2', { level: 1, volts: 5 }, 10);
    c.scheduleInput('D2', { level: 1, volts: 4.9 }, 20); // same level: not a change
    c.scheduleInput('D2', { level: 0, volts: 0 }, 30);
    c.scheduleInput('A0', { level: 1, volts: 3 }, 30);
    c.run(50);
    expect(seen).toEqual([
      ['D2', 1, 10],
      ['D2', 0, 30],
      ['A0', 1, 30],
    ]);
    off();
    c.scheduleInput('D2', { level: 1, volts: 5 }, 60);
    c.run(80);
    expect(seen).toHaveLength(3);
  });

  it('applies scheduled inputs at their exact cycle (button echo with pull-up)', () => {
    const c = core(`
      ldi r16, 0x20
      out ${DDRB}, r16
      ldi r17, 0x04
      out ${PORTD}, r17      ; INPUT_PULLUP on D2
    loop:
      sbis ${PIND}, 2        ; pressed (low) → LED on
      sbi ${PORTB}, 5
      sbic ${PIND}, 2        ; released (high) → LED off
      cbi ${PORTB}, 5
      rjmp loop
    `);
    c.scheduleInput('D2', { level: 1, volts: 5 }, 0);
    c.run(1000);
    expect(c.pinOutputs().get('D2')?.mode).toBe('input_pullup');
    expect(c.pinOutputs().get('D13')?.level).toBe(0);

    c.scheduleInput('D2', { level: 0, volts: 0 }, 1500);
    c.run(1490);
    expect(c.pinOutputs().get('D13')?.level).toBe(0); // not yet
    c.run(1600);
    expect(c.pinOutputs().get('D13')?.level).toBe(1);
  });

  it('derives PWM duty from timer0 registers and matches the generated waveform', () => {
    const c = core(`
      ldi r16, 0x40
      out ${DDRD}, r16       ; D6 output
      ldi r16, 0x83
      out 0x24, r16          ; TCCR0A: COM0A1 | fast PWM
      ldi r16, 63
      out 0x27, r16          ; OCR0A
      ldi r16, 0x03
      out 0x25, r16          ; TCCR0B: /64
    halt: rjmp halt
    `);
    let high = 0;
    let lastRise = -1;
    c.onPinEdge((pin, level, cycle) => {
      if (pin !== 'D6') return;
      if (level === 1) lastRise = cycle;
      else if (lastRise >= 0) high = cycle - lastRise;
    });
    c.run(16_384 * 5);
    expect(c.pinOutputs().get('D6')?.pwm).toEqual({ dutyRatio: 0.25, freqHz: 976.5625 });
    // Datasheet: OCR+1 = 64 ticks × 64 cycles high; avr8js's waveform may differ by one timer tick.
    expect(Math.abs(high - 64 * 64)).toBeLessThanOrEqual(64);
  });

  it('derives PWM from 16-bit timer1 (phase-correct 8-bit, Arduino default on D9)', () => {
    const c = core(`
      ldi r16, 0x02
      out ${DDRB}, r16       ; D9 output
      ldi r16, 0
      sts 0x89, r16          ; OCR1AH (high byte first)
      ldi r16, 127
      sts 0x88, r16          ; OCR1AL
      ldi r16, 0x81
      sts 0x80, r16          ; TCCR1A: COM1A1 | WGM10
      ldi r16, 0x03
      sts 0x81, r16          ; TCCR1B: /64
    halt: rjmp halt
    `);
    c.run(100);
    const pwm = c.pinOutputs().get('D9')?.pwm;
    expect(pwm?.dutyRatio).toBeCloseTo(127 / 255, 12);
    expect(pwm?.freqHz).toBeCloseTo(16e6 / (2 * 64 * 255), 6);
  });

  it('transmits and receives over USART0', () => {
    const c = core(`
      ldi r16, 0x18
      sts 0xC1, r16          ; UCSR0B: RXEN0 | TXEN0
    loop:
      lds r17, 0xC0          ; UCSR0A
      sbrs r17, 7            ; RXC0?
      rjmp loop
      lds r18, 0xC6          ; UDR0
      inc r18
      sts 0xC6, r18          ; echo byte + 1
      rjmp loop
    `);
    const received: number[] = [];
    const uart = c.uart(0);
    uart.onData((bytes) => received.push(...bytes));
    uart.write(Uint8Array.of(0x41, 0x61));
    c.run(20_000);
    expect(received).toEqual([0x42, 0x62]);
    expect(() => c.uart(1)).toThrow();
  });

  it('reports the USART baud rate from UBRR0 and U2X0 (0 while TX is off)', () => {
    const c = core(`
      ldi r16, 207
      sts 0xC4, r16          ; UBRR0L (Serial.begin(9600) at 16 MHz)
      ldi r16, 0x02
      sts 0xC0, r16          ; UCSR0A: U2X0
    wait: dec r17
      brne wait
      ldi r16, 0x08
      sts 0xC1, r16          ; UCSR0B: TXEN0
    halt: rjmp halt
    `);
    expect(c.uart(0).baud()).toBe(0);
    c.run(20);
    expect(c.uart(0).baud()).toBe(0);
    c.run(2_000);
    expect(c.uart(0).baud()).toBe(Math.floor(16e6 / (8 * 208)));
  });

  it('feeds scheduled analog voltages into the ADC', () => {
    const c = core(`
      ldi r16, 0x40
      sts 0x7C, r16          ; ADMUX: AVcc reference, channel 0
      ldi r16, 0x3F
      out ${DDRB}, r16       ; D8–D13 outputs
      ldi r16, 0xC7
      sts 0x7A, r16          ; ADCSRA: enable, start, /128
    wait:
      lds r17, 0x7A
      sbrc r17, 6            ; ADSC still set?
      rjmp wait
      lds r18, 0x78          ; ADCL
      out ${PORTB}, r18      ; expose low 6 bits on D8–D13
    halt: rjmp halt
    `);
    c.scheduleInput('A0', { level: 0, volts: 1 }, 0);
    c.run(10_000);
    const pins = ['D8', 'D9', 'D10', 'D11', 'D12', 'D13'];
    const low6 = pins.reduce((v, p, i) => v | ((c.pinOutputs().get(p)?.level ?? 0) << i), 0);
    const expected = Math.floor((1 / 5) * 1024); // 204
    expect([expected & 0x3f, (expected + 1) & 0x3f]).toContain(low6);
  });

  it('is deterministic and resets to power-on state', () => {
    const src = `
      ldi r16, 0x20
      out ${DDRB}, r16
    loop:
      out ${PINB}, r16
      nop
      rjmp loop
    `;
    const trace = (c: AvrUnoCore): number[] => {
      const t: number[] = [];
      c.onPinEdge((_p, level, cycle) => t.push(level, cycle));
      c.run(500);
      return t;
    };
    const a = core(src);
    const first = trace(a);
    expect(trace(core(src))).toEqual(first);

    a.reset();
    expect(a.cycle).toBe(0);
    expect(a.pinOutputs().get('D13')?.mode).toBe('input');
    a.run(500);
    expect(a.cycle).toBeGreaterThanOrEqual(500);
  });

  it('rejects unknown pins and non-HEX firmware', () => {
    const c = core('halt: rjmp halt');
    expect(() => c.scheduleInput('D99', { level: 0, volts: 0 }, 0)).toThrow(/Unknown Uno pin/);
    expect(() => avrUno.createCore({ format: 'elf', bytes: new Uint8Array(), sha256: '' })).toThrow(
      /Intel HEX/,
    );
  });
});

describe('AvrUnoCore serial input', () => {
  it('accepts a megabyte pasted at once without blowing the stack', () => {
    const c = avrUno.createCore(firmware('halt: rjmp halt'));
    expect(() => c.uart(0).write(new Uint8Array(1 << 20))).not.toThrow();
    c.run(16_000);
  });
});
