import { validateManifest, type ComponentDefinition, type I2cDevice } from '@robosim/sim-core';
import { TestArena, bench, dcSupply } from '@robosim/test-fixtures';
import { describe, expect, it } from 'vitest';
import { REG, definition, manifest, measurementTimingBudgetUs, type Vl53l0xState } from './index.js';

/** Bus access as the Pololu library performs it (Wire transactions on the device). */
function lib(dev: I2cDevice, now: () => number) {
  const w = (reg: number, ...bytes: number[]) => {
    expect(dev.begin(false, now())).toBe(true);
    dev.write(reg, now());
    for (const b of bytes) dev.write(b, now());
    dev.end(now());
  };
  const r = (reg: number, n = 1) => {
    dev.begin(false, now());
    dev.write(reg, now());
    dev.end(now());
    dev.begin(true, now());
    const out = [...Array(n).keys()].map((i) => dev.read(i < n - 1, now()));
    dev.end(now());
    return out.reduce((acc, b) => (acc << 8) | b, 0);
  };
  return { w, r };
}

function ranger(opts: { world?: TestArena; volts?: number; xshut?: boolean } = {}) {
  const b = bench({
    parts: {
      src: { def: dcSupply, props: { volts: opts.volts ?? 5, ohms: 0.01 } },
      tof: { def: definition },
    },
    wires: [['src.pos', 'tof.vin']],
    ground: ['src.neg', 'tof.gnd', ...(opts.xshut === false ? ['tof.xshut'] : [])],
    ...(opts.world ? { world: opts.world } : {}),
  });
  b.run(0.003); // past the 1.2 ms boot
  const dev = b.models['tof']?.i2c?.() as I2cDevice;
  const io = lib(dev, () => b.sim.now);
  /** Polls a condition like the library's busy-wait loops, advancing simulated time. */
  const until = (cond: () => boolean, maxS = 0.2) => {
    for (let t = 0; t < maxS; t += 0.001) {
      if (cond()) return true;
      b.run(0.001);
    }
    return false;
  };
  /** The parts of VL53L0X::init() that read back or wait on the device. */
  const init = () => {
    if (io.r(REG.IDENTIFICATION_MODEL_ID) !== 0xee) return false;
    io.w(0x88, 0x00);
    io.w(0x80, 0x01);
    io.w(0xff, 0x01);
    io.w(0x00, 0x00);
    const stop = io.r(0x91);
    io.w(0x00, 0x01);
    io.w(0xff, 0x00);
    io.w(0x80, 0x00);
    io.w(REG.MSRC_CONFIG_CONTROL, io.r(REG.MSRC_CONFIG_CONTROL) | 0x12);
    io.w(REG.FINAL_RANGE_CONFIG_MIN_COUNT_RATE_RTN_LIMIT, 0x00, 0x20);
    io.w(REG.SYSTEM_SEQUENCE_CONFIG, 0xff);
    // getSpadInfo()
    io.w(0x80, 0x01);
    io.w(0xff, 0x01);
    io.w(0x00, 0x00);
    io.w(0xff, 0x06);
    io.w(0x83, io.r(0x83) | 0x04);
    io.w(0xff, 0x07);
    io.w(0x81, 0x01);
    io.w(0x80, 0x01);
    io.w(0x94, 0x6b);
    io.w(0x83, 0x00);
    if (!until(() => io.r(0x83) !== 0)) return false;
    io.w(0x83, 0x01);
    const spad = io.r(0x92);
    io.w(0x81, 0x00);
    io.w(0xff, 0x06);
    io.w(0x83, io.r(0x83) & ~0x04);
    io.w(0xff, 0x01);
    io.w(0x00, 0x01);
    io.w(0xff, 0x00);
    io.w(0x80, 0x00);
    io.w(REG.SYSTEM_INTERRUPT_CONFIG_GPIO, 0x04);
    io.w(REG.GPIO_HV_MUX_ACTIVE_HIGH, io.r(REG.GPIO_HV_MUX_ACTIVE_HIGH) & ~0x10);
    io.w(REG.SYSTEM_INTERRUPT_CLEAR, 0x01);
    io.w(REG.SYSTEM_SEQUENCE_CONFIG, 0xe8);
    for (const [seq, vhv] of [
      [0x01, 0x40],
      [0x02, 0x00],
    ] as const) {
      io.w(REG.SYSTEM_SEQUENCE_CONFIG, seq);
      io.w(REG.SYSRANGE_START, 0x01 | vhv);
      if (!until(() => (io.r(REG.RESULT_INTERRUPT_STATUS) & 0x07) !== 0)) return false;
      io.w(REG.SYSTEM_INTERRUPT_CLEAR, 0x01);
      io.w(REG.SYSRANGE_START, 0x00);
    }
    io.w(REG.SYSTEM_SEQUENCE_CONFIG, 0xe8);
    return { stop, spad };
  };
  const readContinuous = () => {
    if (!until(() => (io.r(REG.RESULT_INTERRUPT_STATUS) & 0x07) !== 0)) return 65535;
    const mm = io.r(REG.RESULT_RANGE_STATUS + 10, 2);
    io.w(REG.SYSTEM_INTERRUPT_CLEAR, 0x01);
    return mm;
  };
  const readSingle = () => {
    io.w(REG.SYSRANGE_START, 0x01);
    if (!until(() => (io.r(REG.SYSRANGE_START) & 0x01) === 0)) return 65535;
    return readContinuous();
  };
  return { b, dev, io, init, readSingle, readContinuous };
}

describe('sensor.vl53l0x', () => {
  it('has a valid manifest', () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it('passes the library init (model id, SPAD handshake, reference calibrations) at 0x29', () => {
    const { dev, init } = ranger();
    expect(dev.address()).toBe(0x29);
    expect(init()).toEqual({ stop: 0x3c, spad: 0x85 });
  });

  it('is booted when the sketch starts; after an XSHUT release it NACKs for its 1.2 ms boot', () => {
    expect(ranger().dev.begin(false, 0)).toBe(true); // powered ~65 ms before the Uno runs setup()
    expect(ranger({ xshut: false }).dev.address()).toBeNull();
    /** XSHUT to GND through a switch the test opens. */
    let closed = true;
    const hold: ComponentDefinition = {
      manifest: { ...dcSupply.manifest, id: 'test.switch', traits: [], supplyPins: [] },
      create: () => {
        let a = 0;
        let b = 0;
        return {
          type: 'test.switch',
          init: (ctx) => {
            a = ctx.net('pos');
            b = ctx.net('neg');
          },
          stamp: (s) => s.conductance(a, b, closed ? 1 : 1e-9),
          step: () => undefined,
          faults: () => [],
          snapshot: () => null,
        };
      },
    };
    const b = bench({
      parts: {
        src: { def: dcSupply, props: { volts: 5, ohms: 0.01 } },
        sw: { def: hold },
        tof: { def: definition },
      },
      wires: [
        ['src.pos', 'tof.vin'],
        ['sw.pos', 'tof.xshut'],
      ],
      ground: ['src.neg', 'tof.gnd', 'sw.neg'],
    });
    b.run(0.002);
    const dev = b.models['tof']?.i2c?.() as I2cDevice;
    expect(dev.address()).toBeNull();
    closed = false;
    b.sim.invalidate();
    b.run(0.001);
    expect(dev.address()).toBe(0x29);
    expect(dev.begin(false, b.sim.now)).toBe(false);
    b.run(0.002);
    expect(dev.begin(false, b.sim.now)).toBe(true);
  });

  it('measures the bench distance in one ≈ 33 ms timing budget, single-shot', () => {
    const { b, init, readSingle } = ranger();
    init();
    b.input('tof', 'distanceMm', 420);
    b.run(0.001);
    const start = b.sim.now;
    const mm = readSingle();
    expect(b.sim.now - start).toBeGreaterThan(0.025);
    expect(b.sim.now - start).toBeLessThan(0.04);
    expect(Math.abs(mm - 420)).toBeLessThan(25);
    expect(Math.abs(b.state<Vl53l0xState>('tof').timingBudgetUs - 33_000)).toBeLessThan(3000);
  });

  it('reports 8190 beyond 1.2 m in the default mode', () => {
    const { b, init, readSingle } = ranger();
    init();
    b.input('tof', 'distanceMm', 1800);
    b.run(0.001);
    expect(readSingle()).toBe(8190);
  });

  it('ranges continuously and signals each sample on GPIO1 (active low)', () => {
    const { b, io, init, readContinuous } = ranger();
    init();
    b.run(0.001); // the pin follows the cleared interrupt at the next slice
    expect(b.volts('tof.gpio1')).toBeCloseTo(5, 1);
    io.w(REG.SYSRANGE_START, 0x02);
    b.run(0.04);
    expect(b.volts('tof.gpio1')).toBeLessThan(0.1);
    expect(Math.abs(readContinuous() - 300)).toBeLessThan(20);
    b.run(0.001);
    expect(b.volts('tof.gpio1')).toBeCloseTo(5, 1);
    expect(b.state<Vl53l0xState>('tof').mode).toBe('continuous');
  });

  it('takes a new address until reset', () => {
    const { b, dev, io, init } = ranger();
    init();
    io.w(REG.I2C_SLAVE_DEVICE_ADDRESS, 0x30);
    expect(dev.address()).toBe(0x30);
    expect(b.state<Vl53l0xState>('tof').address).toBe(0x30);
  });

  it('mounted on a robot it ranges the wall ahead', () => {
    const world = new TestArena({
      walls: [
        [
          { x: 0.6, y: -1 },
          { x: 0.6, y: 1 },
        ],
      ],
      mounts: { tof: { xMm: 100, yMm: 0, heightMm: 40 } },
    });
    const { init, readSingle } = ranger({ world });
    init();
    expect(Math.abs(readSingle() - 500)).toBeLessThan(25);
  });

  it('computes the timing budget from the timeout registers like the Pololu library', () => {
    const regs = new Map<number, number>([
      [REG.SYSTEM_SEQUENCE_CONFIG, 0xe8],
      [REG.MSRC_CONFIG_TIMEOUT_MACROP, 0x25],
      [REG.PRE_RANGE_CONFIG_VCSEL_PERIOD, 0x06],
      [REG.PRE_RANGE_CONFIG_TIMEOUT_MACROP_HI + 1, 0x96],
      [REG.FINAL_RANGE_CONFIG_VCSEL_PERIOD, 0x04],
      [REG.FINAL_RANGE_CONFIG_TIMEOUT_MACROP_HI, 0x01],
      [REG.FINAL_RANGE_CONFIG_TIMEOUT_MACROP_HI + 1, 0xfe],
    ]);
    const us = measurementTimingBudgetUs((r) => regs.get(r) ?? 0);
    expect(us).toBeGreaterThan(30_000);
    expect(us).toBeLessThan(36_000);
  });

  it('flags more than 5.5 V on VIN', () => {
    const { b } = ranger({ volts: 6 });
    expect(b.models['tof']?.faults().map((f) => f.code)).toEqual(['OVER_VOLTAGE']);
  });
});
