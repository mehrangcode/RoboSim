import { describe, expect, it } from 'vitest';
import { buildRun, builtinSource } from './scenarios.js';

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

/** Catalogue expansion Tier B (P2): reactive parts, run headless from their compiled sketches. */
describe('catalogue Tier B demos', () => {
  const state = <T>(run: ReturnType<typeof buildRun>, id: string) => run.circuit.models[id]?.snapshot() as T;

  it('555 blinker: the timer free-runs at ≈ 1 Hz and the Uno measures its period with pulseIn()', () => {
    const run = buildRun({ scenario: 'timer-555' });
    expect(run.scene.staticFindings).toEqual([]);
    const { sim } = run.circuit;
    let serial = '';
    sim.mcu?.uart(0).onData((bytes) => (serial += String.fromCharCode(...bytes)));
    const lit = new Set<boolean>();
    for (let i = 0; i < 40; i++) {
      sim.run(100);
      lit.add(state<{ currentMa: number }>(run, 'led').currentMa > 5);
    }
    expect([...lit].sort()).toEqual([false, true]); // it blinks
    const t = state<{ freqHz: number; duty: number }>(run, 'timer');
    const f = 1 / (Math.LN2 * (1000 + 2 * 68_000) * 10e-6); // ≈ 1.05 Hz
    expect(Math.abs(t.freqHz / f - 1)).toBeLessThan(0.03);
    expect(t.duty).toBeCloseTo(69 / 137, 1);
    const period = Number(/period (\d+) ms/.exec(serial)?.[1]);
    expect(Math.abs(period / (1000 / f) - 1)).toBeLessThan(0.03);
    expect(run.safety.findings()).toEqual([]);
  }, 60_000);

  it('RC charge: A0 reads 63 % of 5 V one time constant after D7 goes HIGH, then discharges', () => {
    const run = buildRun({ scenario: 'rc-charge' });
    expect(run.scene.staticFindings).toEqual([]);
    const { sim } = run.circuit;
    const volts = () => state<{ volts: number }>(run, 'c').volts;
    sim.run(1000);
    expect(volts()).toBeCloseTo(5 * (1 - Math.exp(-1)), 1);
    sim.run(3000); // 4 s: nearly full, then D7 goes LOW
    const top = volts();
    expect(top).toBeGreaterThan(4.85);
    sim.run(1000);
    expect(volts()).toBeCloseTo(top * Math.exp(-1), 1);
    expect(run.safety.findings()).toEqual([]);
  }, 60_000);

  it('TIP120 motor: the knob sets the PWM duty, the transistor switches the pack current, the diode clamps', () => {
    const run = buildRun({ scenario: 'transistor-motor' });
    expect(run.scene.staticFindings).toEqual([]);
    const { sim } = run.circuit;
    let serial = '';
    sim.mcu?.uart(0).onData((bytes) => (serial += String.fromCharCode(...bytes)));
    const rpm = () => state<{ rpm: number }>(run, 'motor').rpm;
    sim.input('pot', 'position', 0); // the wiper at the 5 V end: duty 255
    sim.run(800);
    const full = rpm();
    expect(full).toBeGreaterThan(150);
    expect(state<{ region: string }>(run, 'q').region).toBe('saturation');
    sim.input('pot', 'position', 0.6); // duty ≈ 40 %
    sim.run(800);
    expect(rpm()).toBeLessThan(full * 0.85); // unloaded, the coasting back-EMF props the speed up
    expect(rpm()).toBeGreaterThan(full * 0.2);
    sim.input('pot', 'position', 1);
    sim.run(800);
    expect(rpm()).toBeLessThan(5);
    expect(serial).toContain('duty 100 %');
    expect(state<{ avalanche: boolean; damaged: boolean }>(run, 'q')).toMatchObject({
      avalanche: false,
      damaged: false,
    });
    expect(run.safety.findings()).toEqual([]);
  }, 60_000);

  it('MOSFET soft start: the IRLZ44N ramps the motor up and down with PWM on its gate', () => {
    const run = buildRun({ scenario: 'mosfet-ramp' });
    expect(run.scene.staticFindings).toEqual([]);
    const { sim } = run.circuit;
    let serial = '';
    sim.mcu?.uart(0).onData((bytes) => (serial += String.fromCharCode(...bytes)));
    const rpm = () => state<{ rpm: number }>(run, 'motor').rpm;
    sim.run(1000);
    const half = rpm();
    sim.run(2000); // full speed from 2.04 s
    expect(rpm()).toBeGreaterThan(200);
    expect(half).toBeLessThan(rpm() * 0.8);
    expect(state<{ partiallyOn: boolean }>(run, 'q').partiallyOn).toBe(false);
    sim.run(3200); // ramped down by 5.6 s, resting
    expect(rpm()).toBeLessThan(10);
    expect(serial).toContain('ramp up\r\nfull speed\r\nramp down\r\nrest');
    expect(run.safety.findings()).toEqual([]);
  }, 60_000);

  it('no flyback diode: flagged before the run, and the PWM kickbacks destroy the TIP120', () => {
    const run = buildRun({ scenario: 'no-flyback' });
    expect(run.scene.staticFindings.map((f) => f.ruleId)).toContain('SAF-FLYBACK');
    const { sim } = run.circuit;
    sim.run(300);
    expect(state<{ damaged: boolean }>(run, 'q').damaged).toBe(true);
    expect(run.safety.findings().map((f) => f.ruleId)).toContain('SAF-COMPONENT-FAULT');
  }, 60_000);
});

/** Catalogue expansion Tier C (P2): I²C displays and sensors driven by their Arduino libraries. */
describe('catalogue Tier C demos', () => {
  const state = <T>(run: ReturnType<typeof buildRun>, id: string) => run.circuit.models[id]?.snapshot() as T;
  const serialOf = (run: ReturnType<typeof buildRun>) => {
    const out = { text: '' };
    run.circuit.sim.mcu?.uart(0).onData((bytes) => (out.text += String.fromCharCode(...bytes)));
    return out;
  };

  it('OLED: Adafruit_SSD1306 draws the title and a bar as long as the knob is turned', () => {
    const run = buildRun({ scenario: 'oled-knob' });
    expect(run.scene.staticFindings).toEqual([]);
    const { sim } = run.circuit;
    type Oled = { on: boolean; pixels: readonly number[] };
    const lit = (y: number) => {
      const p = state<Oled>(run, 'oled').pixels;
      let n = 0;
      for (let x = 0; x < 128; x++) if (((p[y * 4 + (x >> 5)] ?? 0) >>> (x & 31)) & 1) n++;
      return n;
    };
    sim.input('pot', 'position', 0); // 5 V end: 1023
    sim.run(600);
    expect(state<Oled>(run, 'oled').on).toBe(true);
    expect(lit(46)).toBeGreaterThan(120); // the frame's sides + a full bar
    expect([...Array(16).keys()].reduce((n, y) => n + lit(y), 0)).toBeGreaterThan(150); // "RoboSim", size 2
    sim.input('pot', 'position', 1);
    sim.run(300);
    expect(lit(46)).toBeLessThan(6); // only the frame's sides
    expect(run.safety.findings()).toEqual([]);
  }, 60_000);

  it('LCD: LiquidCrystal_I2C prints a greeting with a custom heart, then the uptime', () => {
    const run = buildRun({ scenario: 'lcd-hello' });
    expect(run.scene.staticFindings).toEqual([]);
    const { sim } = run.circuit;
    sim.run(2600);
    type Lcd = { backlight: boolean; rows: readonly (readonly number[])[]; cgram: readonly number[] };
    const lcd = state<Lcd>(run, 'lcd');
    const text = (row: number) =>
      (lcd.rows[row] ?? []).map((c) => (c < 0 ? ' ' : c < 8 ? '♥' : String.fromCharCode(c))).join('');
    expect(lcd.backlight).toBe(true);
    expect(text(0)).toBe('Hello, RoboSim ♥');
    expect(text(1)).toMatch(/^Uptime: 2 s/);
    expect(lcd.cgram.slice(0, 8)).toEqual([0, 0b01010, 0b11111, 0b11111, 0b01110, 0b00100, 0, 0]);
    expect(run.safety.findings()).toEqual([]);
  }, 60_000);

  it('IMU: Adafruit_MPU6050 reports the tilt and the LED lights past 20°', () => {
    const run = buildRun({ scenario: 'imu-tilt' });
    expect(run.scene.staticFindings).toEqual([]);
    const { sim } = run.circuit;
    const serial = serialOf(run);
    const ledOn = () => state<{ currentMa: number }>(run, 'led').currentMa > 5;
    sim.run(1200);
    expect(ledOn()).toBe(false);
    const flat = Number(/tilt ([\d.]+) deg/.exec(serial.text)?.[1]);
    expect(flat).toBeLessThan(5);
    sim.input('imu', 'tiltX', 35);
    serial.text = '';
    sim.run(1200);
    expect(ledOn()).toBe(true);
    const tilted = [...serial.text.matchAll(/tilt ([\d.]+) deg/g)].map((m) => Number(m[1])).at(-1) ?? 0;
    expect(Math.abs(tilted - 35)).toBeLessThan(4);
    expect(run.safety.findings()).toEqual([]);
  }, 60_000);

  it('weather station: Adafruit_BMP280 on the 3.3 V pin reads the bench temperature, pressure and altitude', () => {
    const run = buildRun({ scenario: 'weather-station' });
    expect(run.scene.staticFindings).toEqual([]);
    const { sim } = run.circuit;
    const serial = serialOf(run);
    sim.input('bmp', 'temperatureC', 26.5);
    sim.input('bmp', 'altitudeM', 500);
    sim.run(4500);
    const last = [...serial.text.matchAll(/([\d.-]+) C {2}([\d.]+) hPa {2}([\d-]+) m/g)].at(-1);
    expect(last).toBeDefined();
    expect(Number(last?.[1])).toBeCloseTo(26.5, 0);
    expect(Math.abs(Number(last?.[2]) - 954.6)).toBeLessThan(1);
    expect(Math.abs(Number(last?.[3]) - 500)).toBeLessThan(15);
    expect(state<{ interface: string }>(run, 'bmp').interface).toBe('i2c');
    expect(run.safety.findings()).toEqual([]);
  }, 60_000);

  it('laser avoider: the VL53L0X sees what is ahead and the robot steers around it to the goal', () => {
    const run = buildRun({ scenario: 'laser-avoider' });
    expect(run.scene.staticFindings).toEqual([]);
    const { sim } = run.circuit;
    const serial = serialOf(run);
    const ranges = new Set<number>();
    for (let s = 0; s < 60 && run.challenge?.result().status === 'running'; s++)
      for (let i = 0; i < 10; i++) {
        sim.run(100);
        const r = state<{ rangeMm: number | null }>(run, 'tof').rangeMm;
        if (r !== null) ranges.add(Math.round(r / 100));
      }
    expect(serial.text).not.toContain('not found');
    expect(ranges.size).toBeGreaterThan(3); // the gap ahead changes as it drives
    expect(run.challenge?.result().status).toBe('success');
    expect(run.safety.findings()).toEqual([]);
  }, 120_000);

  it('maze solver: three HC-SR04s keep its right hand on the wall and it reaches the goal', () => {
    const run = buildRun({ scenario: 'maze-solver' });
    expect(run.scene.staticFindings).toEqual([]);
    const serial = serialOf(run);
    for (let s = 0; s < 240 && run.challenge?.result().status === 'running'; s++) run.circuit.sim.run(1000);
    const result = run.challenge?.result();
    expect(result?.status).toBe('success');
    expect(result?.decidedAt).toBeLessThan(40);
    expect(result?.metrics.collisions).toBe(0);
    expect(serial.text).toMatch(/^right\r?\n/); // the start cell is open to the right
    expect(serial.text).toContain('left');
    expect(run.safety.findings()).toEqual([]);
  }, 180_000);

  it('sumo bot: finds the block from any heading and pushes it out without leaving the ring', () => {
    for (const heading of [0, 90, 180]) {
      const { project, firmware } = builtinSource('sumo-bot');
      const start = project.arena?.startPose;
      if (!project.arena || !start) throw new Error('sumo bot has no arena');
      project.arena.startPose = { ...start, heading };
      const run = buildRun({ project, firmware });
      expect(run.scene.staticFindings).toEqual([]);
      for (let s = 0; s < 60 && run.challenge?.result().status === 'running'; s++) run.circuit.sim.run(1000);
      const result = run.challenge?.result();
      expect(result?.status, `heading ${heading}`).toBe('success');
      const stay = result?.tree.children?.find((c) => c.type === 'stayInZone');
      expect(stay?.status).toBe('met');
      if (heading === 0) expect(result?.score?.total).toBe(100); // facing the block: out in under 15 s
      expect(run.safety.findings()).toEqual([]);
    }
  }, 300_000);

  it('thermometers: DHT11 (Adafruit DHT) and DS18B20 (OneWire + DallasTemperature) report the bench', () => {
    const run = buildRun({ scenario: 'thermometers' });
    expect(run.scene.staticFindings).toEqual([]);
    const { sim } = run.circuit;
    const serial = serialOf(run);
    sim.input('dht', 'temperatureC', 28);
    sim.input('dht', 'humidity', 40);
    sim.input('ds', 'temperatureC', 19.25);
    sim.run(5000);
    expect(serial.text).toContain('1 DS18B20 found');
    expect(serial.text).not.toContain('read failed');
    const dht = [...serial.text.matchAll(/DHT11 (\d+) C (\d+) %/g)].at(-1);
    expect(Math.abs(Number(dht?.[1]) - 28)).toBeLessThanOrEqual(1);
    expect(Math.abs(Number(dht?.[2]) - 40)).toBeLessThanOrEqual(3);
    const ds = [...serial.text.matchAll(/DS18B20 (-?[\d.]+) C/g)].at(-1);
    expect(Math.abs(Number(ds?.[1]) - 19.25)).toBeLessThanOrEqual(0.25);
    expect(run.safety.findings()).toEqual([]);
  }, 120_000);

  it('NeoPixel rainbow: the 800 kHz bits of Adafruit_NeoPixel light the strip; the knob sets the brightness', () => {
    const run = buildRun({ scenario: 'neopixel-rainbow' });
    expect(run.scene.staticFindings).toEqual([]);
    const { sim } = run.circuit;
    type Strip = { colors: readonly number[]; currentMa: number };
    const level = (c: number) => Math.max((c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff);
    sim.input('pot', 'position', 0); // 5 V end: full brightness
    sim.run(300);
    const bright = state<Strip>(run, 'strip');
    expect(new Set(bright.colors).size).toBe(8); // a rainbow: every LED a different colour
    expect(Math.max(...bright.colors.map(level))).toBeGreaterThanOrEqual(250);
    sim.run(200);
    expect(state<Strip>(run, 'strip').colors).not.toEqual(bright.colors); // it moves
    sim.input('pot', 'position', 0.9);
    sim.run(300);
    const dim = state<Strip>(run, 'strip');
    expect(Math.max(...dim.colors.map(level))).toBeLessThan(80);
    expect(dim.currentMa).toBeLessThan(bright.currentMa);
    expect(run.safety.findings()).toEqual([]);
  }, 120_000);
});
