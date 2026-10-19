import { UNO_ELECTRICAL, avrUno } from '@robosim/board-avr-uno';
import type { BatteryState } from '@robosim/component-battery';
import type { L298nState } from '@robosim/component-l298n';
import type { TtMotorState } from '@robosim/component-tt-motor';
import { bench, dcSupply, firmware } from '@robosim/test-fixtures';
import { describe, expect, it } from 'vitest';
import { findDefinition } from './index.js';

/**
 * Sketch equivalent: pinMode(7/8/5, OUTPUT); digitalWrite(7, HIGH); digitalWrite(8, LOW); analogWrite(5, duty);
 * D5 is OC0B (timer0 fast PWM, /64 → 976.5625 Hz, duty = (OCR0B + 1) / 256).
 */
function driveFirmware(ocr0b: number) {
  return firmware(`
    ldi r16, 0xA0
    out 0x0a, r16          ; DDRD: D5, D7 outputs
    ldi r16, 0x01
    out 0x04, r16          ; DDRB: D8 output
    ldi r16, 0x80
    out 0x0b, r16          ; PORTD: D7 high (IN1), D8 stays low (IN2)
    ldi r16, ${ocr0b}
    out 0x28, r16          ; OCR0B
    ldi r16, 0x23
    out 0x24, r16          ; TCCR0A: COM0B1 | fast PWM
    ldi r16, 0x03
    out 0x25, r16          ; TCCR0B: /64
  halt: rjmp halt
  `);
}

/**
 * 4×AA (≈ 6.3 V) is below the L298N's 7 V regulator minimum, so the correct wiring removes the
 * regulator jumper and feeds the module's 5 V logic from the Arduino 5 V pin (stand-in supply here).
 */
function robot(ocr0b: number, { regulatorJumper = false } = {}) {
  return bench({
    parts: {
      bat: { def: findDefinition('power.battery-4aa') },
      sw: { def: findDefinition('power.switch') },
      drv: { def: findDefinition('driver.l298n'), props: { enaJumper: false, regulatorJumper } },
      motor: { def: findDefinition('actuator.tt-motor') },
      ...(regulatorJumper ? {} : { uno5v: { def: dcSupply, props: { volts: 5, ohms: 0.1 } } }),
    },
    wires: [
      ['bat.pos', 'sw.a'],
      ['sw.b', 'drv.vs'],
      ...(regulatorJumper ? [] : ([['uno5v.pos', 'drv.v5']] as const)),
      ['mcu.D5', 'drv.ena'],
      ['mcu.D7', 'drv.in1'],
      ['mcu.D8', 'drv.in2'],
      ['drv.out1', 'motor.m1'],
      ['drv.out2', 'motor.m2'],
    ],
    ground: ['bat.neg', 'drv.gnd', ...(regulatorJumper ? [] : ['uno5v.neg'])],
    mcu: {
      core: avrUno.createCore(driveFirmware(ocr0b)),
      electrical: UNO_ELECTRICAL,
      pins: ['D5', 'D7', 'D8'],
    },
  });
}

describe('drive train: Uno → L298N → TT motor on 4×AA', () => {
  it('does nothing until the power switch is on', () => {
    const b = robot(255);
    b.run(0.3);
    expect(b.state<TtMotorState>('motor').rpm).toBeCloseTo(0, 4);
  });

  it('full PWM runs the motor forward at the speed the sagging battery and bridge drop allow', () => {
    const b = robot(255);
    b.input('sw', 'on', true);
    b.run(0.6);
    const motor = b.state<TtMotorState>('motor');
    const drv = b.state<L298nState>('drv');
    const bat = b.state<BatteryState>('bat');
    expect(drv).toMatchObject({ bridgeA: 'forward', enableA: 1 });
    expect(motor.volts).toBeGreaterThan(3.6); // 6.3 V pack − sag − ~2 V bridge drop
    expect(motor.volts).toBeLessThan(4.6);
    expect(motor.rpm).toBeGreaterThan(140);
    expect(motor.rpm).toBeLessThan(200);
    expect(bat.currentMa).toBeGreaterThan(100); // motor + module logic
    expect(bat.volts).toBeLessThan(bat.ocv);
  });

  it('analogWrite(5, 128) roughly halves the speed', () => {
    const full = robot(255);
    const half = robot(127);
    for (const b of [full, half]) {
      b.input('sw', 'on', true);
      b.run(0.6);
    }
    const ratio = half.state<TtMotorState>('motor').rpm / full.state<TtMotorState>('motor').rpm;
    expect(half.state<L298nState>('drv').enableA).toBeCloseTo(0.5, 6);
    expect(ratio).toBeGreaterThan(0.4);
    expect(ratio).toBeLessThan(0.6);
  });

  it('with the regulator jumper on, 4×AA browns out the logic and the motor never starts', () => {
    const b = robot(255, { regulatorJumper: true });
    b.input('sw', 'on', true);
    b.run(0.3);
    const drv = b.state<L298nState>('drv');
    expect(drv.v5).toBeLessThan(4.5);
    expect(drv.bridgeA).toBe('coast');
    expect(b.state<TtMotorState>('motor').rpm).toBeCloseTo(0, 6);
  });

  it('is deterministic run to run', () => {
    const trace = () => {
      const b = robot(200);
      b.input('sw', 'on', true);
      return Array.from({ length: 5 }, () => {
        b.run(0.1);
        return b.state<TtMotorState>('motor');
      });
    };
    expect(trace()).toEqual(trace());
  });
});
