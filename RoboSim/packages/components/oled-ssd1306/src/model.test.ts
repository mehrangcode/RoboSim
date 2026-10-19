import { validateManifest, type I2cDevice } from '@robosim/sim-core';
import { bench, dcSupply } from '@robosim/test-fixtures';
import { describe, expect, it } from 'vitest';
import { OLED_WIDTH, definition, manifest, pixelAt, type OledState } from './index.js';

/** One I²C write transfer: control byte + payload. */
function send(dev: I2cDevice, bytes: readonly number[], t = 0): void {
  dev.begin(false, t);
  for (const b of bytes) dev.write(b, t);
  dev.end(t);
}
const commands = (dev: I2cDevice, list: readonly number[], t = 0) => send(dev, [0x00, ...list], t);

/** Adafruit_SSD1306::begin() for 128×64 with the internal charge pump. */
const ADAFRUIT_INIT = [
  0xae, 0xd5, 0x80, 0xa8, 63, 0xd3, 0x00, 0x40, 0x8d, 0x14, 0x20, 0x00, 0xa1, 0xc8, 0xda, 0x12, 0x81, 0xcf,
  0xd9, 0xf1, 0xdb, 0x40, 0xa4, 0xa6, 0x2e, 0xaf,
];

/** Adafruit_SSD1306::display(): window, then the 1024-byte buffer in 32-byte transfers. */
function display(dev: I2cDevice, buffer: Uint8Array, t = 0): void {
  commands(dev, [0x22, 0, 0xff, 0x21, 0, OLED_WIDTH - 1], t);
  for (let i = 0; i < buffer.length; i += 31) send(dev, [0x40, ...buffer.subarray(i, i + 31)], t);
}

/** GFX buffer layout: byte = page × 128 + x, bit = y & 7. */
function frame(points: readonly (readonly [number, number])[]): Uint8Array {
  const buf = new Uint8Array(1024);
  for (const [x, y] of points)
    buf[(y >> 3) * OLED_WIDTH + x] = (buf[(y >> 3) * OLED_WIDTH + x] ?? 0) | (1 << (y & 7));
  return buf;
}

function oled(volts = 5) {
  const b = bench({
    parts: { src: { def: dcSupply, props: { volts, ohms: 0.01 } }, d: { def: definition } },
    wires: [['src.pos', 'd.vcc']],
    ground: ['src.neg', 'd.gnd'],
  });
  const dev = b.models['d']?.i2c?.() as I2cDevice;
  b.run(0.002);
  return { b, dev, state: () => b.state<OledState>('d') };
}

describe('display.oled-ssd1306', () => {
  it('has a valid manifest', () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it('answers at 0x3C once powered, and pulls the bus up to VCC', () => {
    const { b, dev } = oled();
    expect(dev.address()).toBe(0x3c);
    expect(b.volts('d.sda')).toBeCloseTo(5, 3);
  });

  it('shows the frame Adafruit_SSD1306 sends, upright, and draws current for the lit pixels', () => {
    const { b, dev, state } = oled();
    commands(dev, ADAFRUIT_INIT);
    b.run(0.002);
    const dark = state();
    expect(dark.on).toBe(true);
    display(
      dev,
      frame([
        [0, 0],
        [127, 63],
        [10, 20],
      ]),
    );
    b.run(0.002);
    const s = state();
    expect(pixelAt(s.pixels, 0, 0)).toBe(true);
    expect(pixelAt(s.pixels, 127, 63)).toBe(true);
    expect(pixelAt(s.pixels, 10, 20)).toBe(true);
    expect(pixelAt(s.pixels, 11, 20)).toBe(false);
    expect(s.pixels.reduce((n, w) => n + popcount(w), 0)).toBe(3);
    // A full-white frame draws ≈ 2 mA + 20 mA × 0xCF/255.
    display(dev, new Uint8Array(1024).fill(0xff));
    b.run(0.002);
    expect(state().currentMa).toBeCloseTo(2 + (20 * 0xcf) / 255, 0);
  });

  it('stays dark without the charge pump, and inverts or flips with the matching commands', () => {
    const { b, dev, state } = oled();
    commands(dev, [0xaf]); // display on, but no 0x8D 0x14
    b.run(0.002);
    expect(state().on).toBe(false);
    commands(dev, ADAFRUIT_INIT);
    display(dev, frame([[0, 0]]));
    commands(dev, [0xa7]); // inverse
    b.run(0.002);
    expect(pixelAt(state().pixels, 0, 0)).toBe(false);
    expect(pixelAt(state().pixels, 1, 0)).toBe(true);
    commands(dev, [0xa6, 0xa0, 0xc0]); // normal, segment and COM scan not remapped: rotated 180°
    b.run(0.002);
    expect(pixelAt(state().pixels, 127, 63)).toBe(true);
  });

  it('writes in page addressing mode and scrolls a page band to the right over time', () => {
    const { b, dev, state } = oled();
    commands(dev, [...ADAFRUIT_INIT, 0x20, 0x02, 0xb2, 0x05, 0x10]); // page mode, page 2, column 5
    send(dev, [0x40, 0x01]); // pixel (5, 16)
    b.run(0.002);
    expect(pixelAt(state().pixels, 5, 16)).toBe(true);
    // Right scroll of pages 0–7, one column every 2 frames (≈ 52 columns/s).
    commands(dev, [0x26, 0x00, 0x00, 0x07, 0x07, 0x00, 0xff, 0x2f], b.sim.simTime);
    b.run(0.2);
    const moved = [...Array(OLED_WIDTH).keys()].find((x) => pixelAt(state().pixels, x, 16));
    expect(moved).toBeGreaterThan(12);
    expect(moved).toBeLessThan(18);
  });

  it('forgets its picture and settings when power drops', () => {
    const { b, dev, state } = oled();
    commands(dev, ADAFRUIT_INIT);
    display(dev, frame([[3, 3]]));
    b.input('src', 'volts', 0);
    b.run(0.002);
    expect(dev.address()).toBeNull();
    b.input('src', 'volts', 5);
    b.run(0.002);
    expect(state().on).toBe(false);
  });
});

function popcount(w: number): number {
  let n = 0;
  for (let v = w >>> 0; v; v >>>= 1) n += v & 1;
  return n;
}
