import { UNO_ELECTRICAL, avrUno } from '@robosim/board-avr-uno';
import { validateManifest } from '@robosim/sim-core';
import { bench, dcSupply, firmware } from '@robosim/test-fixtures';
import { describe, expect, it } from 'vitest';
import { isHornActuator } from '@robosim/sim-core';
import { definitions, mg996r, sg90 as definition, type ServoState as Sg90ServoState } from './index.js';
import { SG90, Servo } from './model.js';

/** Timer1 fast PWM (mode 14, /8, ICR1 = 39999 → 50 Hz) on D9 with the given pulse width. */
function servoFirmware(pulseUs: number) {
  const ocr = pulseUs * 2 - 1; // 0.5 µs per tick
  return firmware(`
    ldi r16, 0x02
    out 0x04, r16          ; D9 output
    ldi r16, 0x9C
    sts 0x87, r16          ; ICR1H
    ldi r16, 0x3F
    sts 0x86, r16          ; ICR1L  (39999)
    ldi r16, ${(ocr >> 8) & 0xff}
    sts 0x89, r16          ; OCR1AH
    ldi r16, ${ocr & 0xff}
    sts 0x88, r16          ; OCR1AL
    ldi r16, 0x82
    sts 0x80, r16          ; TCCR1A: COM1A1 | WGM11
    ldi r16, 0x1A
    sts 0x81, r16          ; TCCR1B: WGM13 | WGM12 | CS11
  halt: rjmp halt
  `);
}

function rig(pulseUs: number | null, supplyV = 5, def = definition) {
  return bench({
    parts: { src: { def: dcSupply, props: { volts: supplyV, ohms: 0.05 } }, servo: { def } },
    wires: [['src.pos', 'servo.vcc'], ...(pulseUs === null ? [] : ([['mcu.D9', 'servo.signal']] as const))],
    ground: ['src.neg', 'servo.gnd'],
    ...(pulseUs === null
      ? {}
      : {
          mcu: { core: avrUno.createCore(servoFirmware(pulseUs)), electrical: UNO_ELECTRICAL, pins: ['D9'] },
        }),
  });
}

describe('actuator.sg90-servo', () => {
  it('has valid manifests', () => {
    for (const d of definitions) expect(validateManifest(d.manifest)).toEqual([]);
  });

  it('decodes a 1.5 ms pulse from real timer PWM and holds 90°', () => {
    const b = rig(1500);
    b.run(0.1);
    const s = b.state<Sg90ServoState>('servo');
    expect(s.pulseUs).toBeCloseTo(1500, 0);
    expect(s.targetDeg).toBeCloseTo(90, 1);
    expect(s.angleDeg).toBeCloseTo(90, 1);
    expect(s.moving).toBe(false);
    expect(s.currentMa).toBeCloseTo(10, 0);
  });

  it('slews to 45° at the datasheet speed (~0.1 s / 60° at 4.8 V)', () => {
    const b = rig(1000); // 500 µs → 0°, 2500 µs → 180°
    b.run(0.04); // first pulse arrives within the first 20 ms frame
    const mid = b.state<Sg90ServoState>('servo');
    expect(mid.moving).toBe(true);
    expect(mid.currentMa).toBeGreaterThan(200);
    expect(mid.angleDeg).toBeLessThan(90);
    expect(mid.angleDeg).toBeGreaterThan(45);
    b.run(0.1);
    expect(b.state<Sg90ServoState>('servo').angleDeg).toBeCloseTo(45, 1);
  });

  it('does not move without a signal or below brownout voltage', () => {
    const idle = rig(null);
    idle.run(0.2);
    expect(idle.state<Sg90ServoState>('servo')).toMatchObject({
      angleDeg: 90,
      targetDeg: null,
      moving: false,
    });

    const weak = rig(1000, 3);
    weak.run(0.2);
    expect(weak.state<Sg90ServoState>('servo').angleDeg).toBe(90);
  });

  it('turns parts mounted on its horn: 90° centred, 180° left (counter-clockwise), 0° right', () => {
    const servo = new Servo(SG90);
    expect(isHornActuator(servo)).toBe(true);
    expect(servo.hornAngle()).toBe(0);
    const b = rig(500); // 0°
    b.run(0.3);
    expect(b.state<Sg90ServoState>('servo').angleDeg).toBeCloseTo(0, 1);
    const model = b.sim.model('servo') as Servo;
    expect(model.hornAngle()).toBeCloseTo(-Math.PI / 2, 2);
  });

  it('flags over-voltage', () => {
    expect(
      rig(1500, 9)
        .run(0.05)
        .faults.map((f) => f.code),
    ).toEqual(['OVER_VOLTAGE']);
  });
});

describe('actuator.mg996r-servo', () => {
  it('slews slower than the SG90 (0.17 s / 60° at 4.8 V) and draws more while moving', () => {
    const b = rig(1000, 4.8, mg996r);
    b.run(0.04);
    const s = b.state<Sg90ServoState>('servo');
    expect(s.moving).toBe(true);
    expect(s.currentMa).toBeCloseTo((0.7 / 6) * 4.8 * 1000, -1); // minus supply sag
    // ≈ 353 °/s at 4.8 V: 45° takes ≈ 128 ms after the first pulse.
    b.run(0.06);
    expect(b.state<Sg90ServoState>('servo').angleDeg).toBeGreaterThan(50);
    b.run(0.1);
    expect(b.state<Sg90ServoState>('servo').angleDeg).toBeCloseTo(45, 1);
  });

  it('browns out below 4 V and flags more than 7.2 V', () => {
    const weak = rig(1000, 3.8, mg996r);
    weak.run(0.2);
    expect(weak.state<Sg90ServoState>('servo').angleDeg).toBe(90);
    expect(
      rig(1500, 8.4, mg996r)
        .run(0.05)
        .faults.map((f) => f.code),
    ).toEqual(['OVER_VOLTAGE']);
  });
});
