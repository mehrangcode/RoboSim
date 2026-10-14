import type {
  ComponentIO,
  ComponentModel,
  DiodeHandle,
  MnaStamper,
  ModelContext,
  NetId,
} from '@robosim/sim-core';
import { Simulation } from '@robosim/sim-core';
import { describe, expect, it } from 'vitest';
import { UNO_ELECTRICAL, avrUno } from '../src/index.js';
import { firmware } from './firmware.js';

/** Minimal LED / button models; the real catalogue components arrive in the components slice. */
class Led implements ComponentModel<null, { currentMa: number }> {
  readonly type = 'output.led';
  private a: NetId = 0;
  private h = 0 as DiodeHandle;
  private ma = 0;
  init(ctx: ModelContext): void {
    this.a = ctx.net('a');
  }
  stamp(s: MnaStamper): void {
    this.h = s.diode(this.a, 0, { vf: 2, rs: 10 });
  }
  step(_dt: number, io: ComponentIO): void {
    this.ma = io.solution.diodeCurrent(this.h) * 1000;
  }
  faults(): [] {
    return [];
  }
  snapshot(): { currentMa: number } {
    return { currentMa: this.ma };
  }
}

class Button implements ComponentModel<null, null> {
  readonly type = 'input.button';
  private a: NetId = 0;
  pressed = false;
  private changed = false;
  init(ctx: ModelContext): void {
    this.a = ctx.net('a');
  }
  press(p: boolean): void {
    this.changed = p !== this.pressed;
    this.pressed = p;
  }
  stamp(s: MnaStamper): void {
    if (this.pressed) s.conductance(this.a, 0, 20);
  }
  step(_dt: number, io: ComponentIO): void {
    if (this.changed) io.invalidate();
    this.changed = false;
  }
  faults(): [] {
    return [];
  }
  snapshot(): null {
    return null;
  }
}

const resistor = (a: NetId, b: NetId, ohms: number): ComponentModel<null, null> => ({
  type: 'passive.resistor',
  init: () => undefined,
  stamp: (s) => s.conductance(a, b, 1 / ohms),
  step: () => undefined,
  faults: () => [],
  snapshot: () => null,
});

const ON_MA = (3 / (25 + 220 + 10)) * 1000;

describe('Uno + sim-core end to end', () => {
  it('button on D2 (INPUT_PULLUP) lights an LED on D13 through firmware', () => {
    const core = avrUno.createCore(
      firmware(`
        ldi r16, 0x20
        out 0x04, r16
        ldi r17, 0x04
        out 0x0b, r17
      loop:
        sbis 0x09, 2
        sbi 0x05, 5
        sbic 0x09, 2
        cbi 0x05, 5
        rjmp loop
      `),
    );
    const led = new Led();
    const button = new Button();
    // Nets: 1 = D13, 2 = LED anode, 3 = D2
    const sim = new Simulation({
      netCount: 3,
      seed: 1,
      mcu: {
        core,
        electrical: UNO_ELECTRICAL,
        pins: [
          { pin: 'D13', net: 1 },
          { pin: 'D2', net: 3 },
        ],
      },
      components: [
        { id: 'r1', model: resistor(1, 2, 220), pins: {}, props: null },
        { id: 'led', model: led, pins: { a: 2 }, props: null },
        { id: 'btn', model: button, pins: { a: 3 }, props: null },
      ],
    });
    sim.run(5);
    expect(led.snapshot().currentMa).toBeLessThan(1e-3);
    expect(sim.currentSolution.voltage(3)).toBeCloseTo(5, 2);

    button.press(true);
    sim.run(3);
    expect(led.snapshot().currentMa).toBeCloseTo(ON_MA, 6);

    button.press(false);
    sim.run(3);
    expect(led.snapshot().currentMa).toBeLessThan(1e-3);
  });

  it('analogWrite-style timer PWM dims an LED to duty × on-current', () => {
    const core = avrUno.createCore(
      firmware(`
        ldi r16, 0x40
        out 0x0a, r16
        ldi r16, 0x83
        out 0x24, r16
        ldi r16, 63
        out 0x27, r16
        ldi r16, 0x03
        out 0x25, r16
      halt: rjmp halt
      `),
    );
    const led = new Led();
    const sim = new Simulation({
      netCount: 2,
      seed: 1,
      mcu: { core, electrical: UNO_ELECTRICAL, pins: [{ pin: 'D6', net: 1 }] },
      components: [
        { id: 'r1', model: resistor(1, 2, 220), pins: {}, props: null },
        { id: 'led', model: led, pins: { a: 2 }, props: null },
      ],
    });
    sim.run(20);
    expect(led.snapshot().currentMa).toBeCloseTo(0.25 * ON_MA, 6);
  });
});
