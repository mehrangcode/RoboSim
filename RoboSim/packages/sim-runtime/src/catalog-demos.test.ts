import { describe, expect, it } from 'vitest';
import { buildRun } from './scenarios.js';

/** Catalogue expansion demos (slice 16a), run headless from their compiled sketches. */
describe('catalogue Tier A demos', () => {
  const state = <T>(run: ReturnType<typeof buildRun>, id: string) => run.circuit.models[id]?.snapshot() as T;

  it('RGB mood light: the knob walks the hue, the button plays the melody on the passive buzzer', () => {
    const run = buildRun({ scenario: 'rgb-melody' });
    expect(run.scene.staticFindings).toEqual([]);
    const { sim } = run.circuit;
    type Rgb = { brightness: readonly [number, number, number] };

    sim.input('pot', 'position', 0); // hue 0: pure red
    sim.run(100);
    const red = state<Rgb>(run, 'rgb').brightness;
    expect(red[0]).toBeGreaterThan(0.5);
    expect(red[1]).toBeLessThan(0.05);
    expect(red[2]).toBeLessThan(0.05);

    sim.input('pot', 'position', 0.5); // hue ≈ 384: green fading into blue
    sim.run(100);
    const mid = state<Rgb>(run, 'rgb').brightness;
    expect(mid[0]).toBeLessThan(0.05);
    expect(mid[1]).toBeGreaterThan(0.1);
    expect(mid[2]).toBeGreaterThan(0.1);

    type Buzz = { sounding: boolean; toneHz: number };
    expect(state<Buzz>(run, 'buz').sounding).toBe(false);
    sim.input('btn', 'pressed', true);
    sim.run(100);
    expect(state<Buzz>(run, 'buz')).toMatchObject({ sounding: true });
    expect(state<Buzz>(run, 'buz').toneHz).toBeCloseTo(262, -1);
    sim.run(250);
    expect(state<Buzz>(run, 'buz').toneHz).toBeCloseTo(330, -1);
    expect(run.safety.findings()).toEqual([]);
  });

  it('relay counter: each press counts on the 7-segment; even numbers light the 9 V lamp via relay + LM7805', () => {
    const run = buildRun({ scenario: 'relay-counter' });
    expect(run.scene.staticFindings).toEqual([]);
    const { sim } = run.circuit;
    const lit = () =>
      state<{ brightness: readonly number[] }>(run, 'seg')
        .brightness.map((v, i) => (v > 0.3 ? 'abcdefgP'[i] : ''))
        .join('');
    const lamp = () => state<{ currentMa: number }>(run, 'lamp').currentMa;
    const press = () => {
      sim.input('btn', 'pressed', true);
      sim.run(60);
      sim.input('btn', 'pressed', false);
      sim.run(60);
    };

    sim.run(100);
    expect(lit()).toBe('abcdef'); // 0
    expect(lamp()).toBeGreaterThan(5); // relay closed: (5 V − 3.1 V) / 330 Ω ≈ 6 mA
    press();
    expect(lit()).toBe('bc'); // 1
    expect(state<{ energized: boolean }>(run, 'relay').energized).toBe(false);
    expect(lamp()).toBeLessThan(0.01);
    press();
    expect(lit()).toBe('abdeg'); // 2
    expect(state<{ energized: boolean }>(run, 'relay').energized).toBe(true);
    expect(state<{ vout: number }>(run, 'reg').vout).toBeCloseTo(5, 1);
    expect(run.safety.findings()).toEqual([]);
  });

  it('half adder: XOR and AND chips compute sum and carry; the Uno prints them', () => {
    const run = buildRun({ scenario: 'half-adder' });
    expect(run.scene.staticFindings).toEqual([]);
    const { sim } = run.circuit;
    let serial = '';
    sim.mcu?.uart(0).onData((bytes) => (serial += String.fromCharCode(...bytes)));
    const lit = (id: string) => state<{ currentMa: number }>(run, id).currentMa > 5;
    sim.run(50);
    expect([lit('sum'), lit('carry')]).toEqual([false, false]);
    sim.input('btnA', 'pressed', true);
    sim.run(50);
    expect([lit('sum'), lit('carry')]).toEqual([true, false]);
    sim.input('btnB', 'pressed', true);
    sim.run(50);
    expect([lit('sum'), lit('carry')]).toEqual([false, true]);
    expect(serial).toContain('carry=0 sum=1');
    expect(serial).toContain('carry=1 sum=0');
    expect(run.safety.findings()).toEqual([]);
  });

  it('LED bar: shiftOut() into a 74HC595 sweeps one lit LED', () => {
    const run = buildRun({ scenario: 'led-bar' });
    expect(run.scene.staticFindings).toEqual([]);
    const { sim } = run.circuit;
    sim.input('pot', 'position', 1); // A0 at GND side → shortest delay (20 ms)
    const litLeds = () =>
      Array.from({ length: 8 }, (_, i) => i).filter(
        (i) => state<{ currentMa: number }>(run, `led${i}`).currentMa > 5,
      );
    sim.run(30);
    const first = litLeds();
    expect(first).toHaveLength(1);
    sim.run(45);
    const later = litLeds();
    expect(later).toHaveLength(1);
    expect(later).not.toEqual(first);
    expect(run.safety.findings()).toEqual([]);
  });

  it('stepper knob: a quarter knob turn becomes a quarter shaft turn through the ULN2003A', () => {
    const run = buildRun({ scenario: 'stepper-knob' });
    expect(run.scene.staticFindings).toEqual([]);
    const { sim } = run.circuit;
    sim.input('pot', 'position', 0.75); // wiper three quarters from 5 V → A0 ≈ 1.25 V
    sim.run(2500);
    const s = state<{ shaftDeg: number; missedSteps: number }>(run, 'motor');
    expect(Math.abs(s.shaftDeg)).toBeCloseTo(90, -1);
    expect(s.missedSteps).toBe(0);
    expect(run.safety.findings()).toEqual([]);
  });

  it('motor driver: the TB6612FNG spins two TT motors in opposite directions', () => {
    const run = buildRun({ scenario: 'motor-driver' });
    expect(run.scene.staticFindings).toEqual([]);
    const { sim } = run.circuit;
    sim.run(1500); // speed ramps from −255 through 0 at ≈ 2 s
    const rpm = (id: string) => state<{ rpm: number }>(run, id).rpm;
    expect(Math.abs(rpm('motorA'))).toBeGreaterThan(20);
    expect(Math.sign(rpm('motorA'))).toBe(-Math.sign(rpm('motorB')));
    expect(state<{ modeA: string }>(run, 'drv').modeA).toBe('reverse');
    expect(run.safety.findings()).toEqual([]);
  });

  it('keypad lock: the Keypad library scans the matrix; 1234# unlocks', () => {
    const run = buildRun({ scenario: 'keypad-lock' });
    expect(run.scene.staticFindings).toEqual([]);
    const { sim } = run.circuit;
    let serial = '';
    sim.mcu?.uart(0).onData((bytes) => (serial += String.fromCharCode(...bytes)));
    const type = (key: string) => {
      const name = `key${key === '#' ? 'Hash' : key === '*' ? 'Star' : key}`;
      sim.input('keys', name, true);
      sim.run(80);
      sim.input('keys', name, false);
      sim.run(80);
    };
    sim.run(50);
    for (const k of '9#') type(k);
    expect(serial).toContain('9# wrong code');
    for (const k of '1234#') type(k);
    expect(serial).toContain('1234# unlocked');
    expect(state<{ currentMa: number }>(run, 'led').currentMa).toBeGreaterThan(5);
    expect(run.safety.findings()).toEqual([]);
  });

  it('encoder and joystick: quadrature counts and both stick axes reach the sketch', () => {
    const run = buildRun({ scenario: 'input-devices' });
    expect(run.scene.staticFindings).toEqual([]);
    const { sim } = run.circuit;
    let serial = '';
    sim.mcu?.uart(0).onData((bytes) => (serial += String.fromCharCode(...bytes)));
    sim.run(50);
    sim.input('enc', 'detents', 3);
    sim.run(100);
    expect(serial).toContain('count 3');
    sim.input('enc', 'detents', 1);
    sim.run(100);
    expect(
      serial
        .trim()
        .split('\n')
        .filter((l) => l.startsWith('count'))
        .at(-1)
        ?.trim(),
    ).toBe('count 1');
    sim.input('joy', 'x', 1);
    sim.input('joy', 'pressed', true);
    sim.run(50);
    expect(serial).toContain('x 15 y 7 pressed');
    expect(run.safety.findings()).toEqual([]);
  });

  it('bump-and-turn avoider: three lever switches find their way to the goal of the obstacle course', () => {
    const run = buildRun({ scenario: 'bump-avoider' });
    expect(run.scene.staticFindings).toEqual([]);
    let bumped = false;
    run.circuit.sim.addObserver({
      afterSlice: () => {
        bumped ||= ['bumpL', 'bumpC', 'bumpR'].some((id) => state<{ bumped: boolean }>(run, id).bumped);
      },
    });
    for (let s = 0; s < 60 && run.challenge?.result().status === 'running'; s++) run.circuit.sim.run(1000);
    expect(bumped).toBe(true);
    expect(run.challenge?.result().status).toBe('success');
    expect(run.safety.findings()).toEqual([]);
  }, 120_000);
});
