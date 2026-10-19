import { validateManifest, type I2cDevice } from '@robosim/sim-core';
import { TestArena, bench, dcSupply } from '@robosim/test-fixtures';
import { describe, expect, it } from 'vitest';
import { REG, definition, manifest } from './index.js';

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

const s16 = (hi: number, lo: number) => (((hi << 8) | lo) << 16) >> 16;

function imu(opts: { ad0High?: boolean; world?: TestArena } = {}) {
  const b = bench({
    parts: { src: { def: dcSupply, props: { volts: 5, ohms: 0.01 } }, m: { def: definition } },
    wires: [['src.pos', 'm.vcc'], ...(opts.ad0High ? ([['src.pos', 'm.ad0']] as const) : [])],
    ground: ['src.neg', 'm.gnd'],
    ...(opts.world ? { world: opts.world } : {}),
  });
  b.run(0.002);
  const dev = b.models['m']?.i2c?.() as I2cDevice;
  const t = () => b.sim.now;
  const wake = () => writeReg(dev, REG.PWR_MGMT_1, 0x01, t());
  const read = () => {
    const r = readRegs(dev, REG.ACCEL_XOUT_H, 14, t());
    const v = (i: number) => s16(r[i] ?? 0, r[i + 1] ?? 0);
    return { ax: v(0), ay: v(2), az: v(4), temp: v(6), gx: v(8), gy: v(10), gz: v(12) };
  };
  return { b, dev, t, wake, read };
}

describe('sensor.mpu6050', () => {
  it('has a valid manifest', () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it('identifies itself at 0x68, or 0x69 with AD0 high, and pulls the bus up to 3.3 V', () => {
    const { b, dev, t } = imu();
    expect(dev.address()).toBe(0x68);
    expect(readRegs(dev, REG.WHO_AM_I, 1, t())).toEqual([0x68]);
    expect(b.volts('m.sda')).toBeCloseTo(3.3, 2);
    expect(imu({ ad0High: true }).dev.address()).toBe(0x69);
  });

  it('reads zeros while asleep after power-on, then +1 g on Z once woken (±2 g range)', () => {
    const { b, wake, read } = imu();
    b.run(0.01);
    expect(read()).toMatchObject({ ax: 0, az: 0 });
    wake();
    b.run(0.02);
    const r = read();
    expect(Math.abs(r.az - 16384)).toBeLessThan(500); // seeded offset ≤ 20 mg ≈ 330 LSB, plus noise
    expect(Math.abs(r.ax)).toBeLessThan(500);
    expect(r.temp / 340 + 36.53).toBeCloseTo(29, 0);
  });

  it('measures a bench tilt, and full-scale settings change the LSB/g', () => {
    const { b, dev, t, wake, read } = imu();
    wake();
    b.input('m', 'tiltX', 30);
    b.run(0.05);
    expect(read().ax / 16384).toBeCloseTo(0.5, 1);
    writeReg(dev, REG.ACCEL_CONFIG, 0x18, t()); // ±16 g: 2048 LSB/g
    b.run(0.02);
    expect(read().ax / 2048).toBeCloseTo(0.5, 1);
  });

  it('on a robot, reads its yaw rate and forward acceleration in the sensor frame', () => {
    const world = new TestArena({ mounts: { m: { xMm: 0, yMm: 0, heightMm: 30 } } });
    const { b, dev, t, wake, read } = imu({ world });
    wake();
    writeReg(dev, REG.GYRO_CONFIG, 0x08, t()); // ±500 °/s: 65.5 LSB/(°/s)
    world.setMotion(0, 0, 1); // 1 rad/s counter-clockwise
    b.run(0.05);
    expect(read().gz / 65.5).toBeCloseTo(57.3, -1);
    // Speeding up at 2 m/s² along +x (the way the robot and sensor face).
    world.setMotion(0, 0, 0);
    for (let i = 1; i <= 60; i++) {
      world.setMotion(2 * i * 0.001, 0, 0);
      b.run(0.001);
    }
    expect(read().ax / 16384).toBeCloseTo(2 / 9.80665, 1);
  });

  it('latches data-ready on INT until INT_STATUS is read', () => {
    const { b, dev, t, wake } = imu();
    wake();
    writeReg(dev, REG.INT_PIN_CFG, 0x20, t()); // LATCH_INT_EN, active high
    writeReg(dev, REG.INT_ENABLE, 0x01, t());
    b.run(0.005);
    expect(b.volts('m.int')).toBeCloseTo(3.3, 1);
    readRegs(dev, REG.INT_STATUS, 1, t());
    writeReg(dev, REG.SMPLRT_DIV, 99, t()); // 10 Hz: no new sample for a while
    b.run(0.003);
    expect(b.volts('m.int')).toBeLessThan(0.1);
  });
});
