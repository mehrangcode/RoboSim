import { validateManifest, type I2cDevice, type SpiDevice } from '@robosim/sim-core';
import { bench, dcSupply } from '@robosim/test-fixtures';
import { describe, expect, it } from 'vitest';
import {
  compensatePressure,
  compensateTemperature,
  definition,
  manifest,
  rawPressureFor,
  rawTemperatureFor,
} from './index.js';

function writeReg(dev: I2cDevice, reg: number, value: number, t: number): void {
  dev.begin(false, t);
  dev.write(reg, t);
  dev.write(value, t);
  dev.end(t);
}

function readRegs(dev: I2cDevice, reg: number, n: number, t: number): number[] {
  dev.begin(false, t);
  dev.write(reg, t);
  dev.end(t);
  dev.begin(true, t);
  const out = [...Array(n).keys()].map((i) => dev.read(i < n - 1, t));
  dev.end(t);
  return out;
}

/** Datasheet integer compensation of a burst read of 0xF7..0xFC. */
function decode(r: number[]): { c: number; pa: number } {
  const w = (i: number) => ((r[i] ?? 0) << 12) | ((r[i + 1] ?? 0) << 4) | ((r[i + 2] ?? 0) >> 4);
  const t = compensateTemperature(w(3));
  return { c: t.centiC / 100, pa: compensatePressure(w(0), t.tFine) / 256 };
}

function sensor(opts: { volts?: number; sdoHigh?: boolean } = {}) {
  const b = bench({
    parts: {
      src: { def: dcSupply, props: { volts: opts.volts ?? 3.3, ohms: 0.01 } },
      s: { def: definition },
    },
    wires: [['src.pos', 's.vcc'], ...(opts.sdoHigh ? ([['src.pos', 's.sdo']] as const) : [])],
    ground: ['src.neg', 's.gnd'],
  });
  b.run(0.002);
  const dev = b.models['s']?.i2c?.() as I2cDevice;
  const t = () => b.sim.now;
  return { b, dev, t };
}

describe('sensor.bmp280', () => {
  it('has a valid manifest', () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it('inverts the datasheet compensation (worked example: 25.08 °C, 100653 Pa)', () => {
    const ex = compensateTemperature(519888);
    expect(ex.centiC).toBe(2508);
    expect(compensatePressure(415148, ex.tFine) / 256).toBeCloseTo(100653.27, 1);
    const raw = rawTemperatureFor(-12.34);
    expect(compensateTemperature(raw).centiC).toBe(-1234);
    const tFine = compensateTemperature(raw).tFine;
    expect(compensatePressure(rawPressureFor(90000, tFine), tFine) / 256).toBeCloseTo(90000, 0);
  });

  it('answers at 0x76 (0x77 with SDO high) with chip id 0x58 and the trimming words', () => {
    const { b, dev, t } = sensor();
    expect(dev.address()).toBe(0x76);
    expect(readRegs(dev, 0xd0, 1, t())).toEqual([0x58]);
    expect(readRegs(dev, 0x88, 2, t())).toEqual([27504 & 0xff, 27504 >> 8]);
    expect(b.volts('s.sda')).toBeCloseTo(3.3, 2);
    expect(sensor({ sdoHigh: true }).dev.address()).toBe(0x77);
  });

  it('runs a forced conversion: busy flag for the conversion time, then the bench values', () => {
    const { b, dev, t } = sensor();
    b.input('s', 'temperatureC', 31.5);
    b.input('s', 'altitudeM', 1000);
    writeReg(dev, 0xf4, (1 << 5) | (5 << 2) | 1, t()); // T ×1, P ×16, forced: 1 + 2 + 32.5 = 35.5 ms
    expect(readRegs(dev, 0xf3, 1, t())[0]).toBe(0x08);
    b.run(0.03);
    expect(readRegs(dev, 0xf3, 1, t())[0]).toBe(0x08);
    b.run(0.01);
    expect(readRegs(dev, 0xf3, 1, t())[0]).toBe(0);
    expect((readRegs(dev, 0xf4, 1, t())[0] ?? -1) & 0x03).toBe(0); // back to sleep
    const { c, pa } = decode(readRegs(dev, 0xf7, 6, t()));
    expect(c).toBeCloseTo(31.5, 1);
    expect(Math.abs(pa - 89875)).toBeLessThan(10); // ISA at 1000 m
  });

  it('reports 0x80000 for skipped measurements and filters normal-mode samples', () => {
    const { b, dev, t } = sensor();
    expect(readRegs(dev, 0xf7, 6, t())).toEqual([0x80, 0, 0, 0x80, 0, 0]);
    writeReg(dev, 0xf5, (0 << 5) | (4 << 2), t()); // 0.5 ms standby, IIR 16
    writeReg(dev, 0xf4, (2 << 5) | (5 << 2) | 3, t()); // normal mode
    b.run(0.5);
    const first = decode(readRegs(dev, 0xf7, 6, t())).pa;
    b.input('s', 'altitudeM', 100); // ≈ −1200 Pa step
    b.run(0.05); // ≈ 1 conversion: the filter only moves ~1/16 of the way
    const partial = decode(readRegs(dev, 0xf7, 6, t())).pa;
    expect(first - partial).toBeGreaterThan(30);
    expect(first - partial).toBeLessThan(400);
    b.run(5); // IIR 16 at ≈ 38 ms per conversion
    expect(Math.abs(decode(readRegs(dev, 0xf7, 6, t())).pa - 100129)).toBeLessThan(10);
  });

  it('switches to SPI for good once CSB is held low', () => {
    const b = bench({
      parts: { src: { def: dcSupply, props: { volts: 3.3, ohms: 0.01 } }, s: { def: definition } },
      wires: [['src.pos', 's.vcc']],
      ground: ['src.neg', 's.gnd', 's.csb'],
    });
    b.run(0.002);
    expect((b.models['s']?.i2c?.() as I2cDevice).address()).toBeNull();
    const spi = b.models['s']?.spi?.() as SpiDevice;
    expect(spi.transfer(0xd0, b.sim.now)).toBe(0xff); // read 0xD0
    expect(spi.transfer(0x00, b.sim.now)).toBe(0x58);
    expect(b.state('s')).toMatchObject({ interface: 'spi' });
  });

  it('flags a 5 V supply as over-voltage', () => {
    const { b } = sensor({ volts: 5 });
    expect(b.models['s']?.faults().map((f) => f.code)).toContain('OVER_VOLTAGE');
  });
});
