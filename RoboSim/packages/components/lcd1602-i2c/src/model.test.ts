import { validateManifest, type I2cDevice } from '@robosim/sim-core';
import { bench, dcSupply } from '@robosim/test-fixtures';
import { describe, expect, it } from 'vitest';
import { definition, manifest, type LcdState } from './index.js';

const BL = 0x08;
const EN = 0x04;
const RS = 0x01;

/** LiquidCrystal_I2C's traffic: every expanderWrite is its own I²C transfer of one byte. */
class Driver {
  t = 0;
  constructor(private readonly dev: I2cDevice) {}
  private expander(byte: number): void {
    this.dev.begin(false, this.t);
    this.dev.write(byte | BL, this.t);
    this.dev.end(this.t);
    this.t += 100e-6; // one byte at 100 kHz plus overhead
  }
  write4bits(value: number): void {
    this.expander(value);
    this.expander(value | EN);
    this.expander(value & ~EN);
    this.t += 50e-6;
  }
  send(value: number, mode: number): void {
    this.write4bits((value & 0xf0) | mode);
    this.write4bits(((value << 4) & 0xf0) | mode);
  }
  command(value: number, waitS = 0): void {
    this.send(value, 0);
    this.t += waitS;
  }
  print(text: string): void {
    for (const ch of text) this.send(ch.charCodeAt(0), RS);
  }
  begin(): void {
    this.t += 0.05;
    this.expander(0);
    this.t += 1;
    this.write4bits(0x03 << 4);
    this.t += 4.5e-3;
    this.write4bits(0x03 << 4);
    this.t += 4.5e-3;
    this.write4bits(0x03 << 4);
    this.t += 150e-6;
    this.write4bits(0x02 << 4);
    this.command(0x28); // 4-bit, 2 lines, 5×8
    this.command(0x0c); // display on, cursor off
    this.command(0x01, 2e-3); // clear
    this.command(0x06); // increment, no shift
    this.command(0x02, 2e-3); // home
  }
}

function lcd(volts = 5) {
  const b = bench({
    parts: { src: { def: dcSupply, props: { volts, ohms: 0.01 } }, d: { def: definition } },
    wires: [['src.pos', 'd.vcc']],
    ground: ['src.neg', 'd.gnd'],
  });
  b.run(0.002);
  const dev = b.models['d']?.i2c?.() as I2cDevice;
  return { b, dev, driver: new Driver(dev), state: () => b.state<LcdState>('d') };
}

const text = (s: LcdState, row: number) =>
  String.fromCharCode(...(s.rows[row] ?? []).map((c) => (c < 0 ? 0x20 : c)));

describe('display.lcd1602-i2c', () => {
  it('has a valid manifest', () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it('shows what LiquidCrystal_I2C prints, on both lines, with the backlight on', () => {
    const { b, driver, state } = lcd();
    driver.begin();
    driver.print('Hello, RoboSim!');
    driver.command(0x80 | 0x40); // setCursor(0, 1)
    driver.print('T = 23.5 C');
    b.run(0.002);
    const s = state();
    expect(text(s, 0)).toBe('Hello, RoboSim! ');
    expect(text(s, 1)).toBe('T = 23.5 C      ');
    expect(s).toMatchObject({ powered: true, backlight: true, displayOn: true, cursor: { row: 1, col: 10 } });
    expect(s.currentMa).toBeCloseTo(21.5, 1);
  });

  it('stores and shows a custom character, and scrolls the display', () => {
    const { b, driver, state } = lcd();
    driver.begin();
    driver.command(0x40 | (2 << 3)); // CGRAM address of character 2
    for (const row of [0x00, 0x0a, 0x1f, 0x1f, 0x0e, 0x04, 0x00, 0x00]) driver.send(row, RS);
    driver.command(0x80); // back to DDRAM
    driver.send(2, RS);
    driver.print('love');
    driver.command(0x18); // scrollDisplayLeft
    b.run(0.002);
    const s = state();
    expect(s.cgram.slice(16, 24)).toEqual([0x00, 0x0a, 0x1f, 0x1f, 0x0e, 0x04, 0x00, 0x00]);
    expect(text(s, 0).slice(0, 4)).toBe('love');
  });

  it('ignores instructions sent while it is still busy clearing', () => {
    const { b, driver, state } = lcd();
    driver.begin();
    driver.print('AB');
    driver.command(0x01); // clear, but no 2 ms wait…
    driver.print('C'); // …so this lands while the controller is busy
    b.run(0.002);
    expect(text(state(), 0).trim()).toBe('');
  });

  it('shows nothing on 3.3 V even though the expander answers', () => {
    const { b, dev, driver, state } = lcd(3.3);
    expect(dev.address()).toBe(0x27);
    driver.begin();
    driver.print('Hi');
    b.run(0.002);
    expect(state()).toMatchObject({ powered: false, displayOn: false });
  });
});
