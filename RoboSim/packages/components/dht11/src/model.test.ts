import { validateManifest, type ComponentIO, type Level } from '@robosim/sim-core';
import { bench, dcSupply } from '@robosim/test-fixtures';
import { describe, expect, it } from 'vitest';
import { definition, manifest, type Dht11, type Dht11State } from './index.js';

function rig(volts = 5) {
  const b = bench({
    parts: { src: { def: dcSupply, props: { volts, ohms: 0.01 } }, dht: { def: definition } },
    wires: [['src.pos', 'dht.vcc']],
    ground: ['src.neg', 'dht.gnd'],
  });
  const dht = b.models['dht'] as Dht11;
  /** What the MCU's pin would read: scheduled levels in time order. */
  const scheduled: { level: Level; time: number }[] = [];
  const io = {
    scheduleMcuInput: (_net: number, level: Level, time: number) => void scheduled.push({ level, time }),
    solution: { voltage: () => 5 },
  } as unknown as ComponentIO;
  /** The host start signal of Adafruit's DHT::read(): LOW for `ms`, then INPUT_PULLUP. */
  const start = (ms: number) => {
    const t = b.sim.now;
    dht.mcuMode(0, 'output', 0, t, io);
    dht.mcuMode(0, 'input_pullup', 1, t + ms / 1000, io);
  };
  /** Decodes the answer like the library: HIGH longer than the preceding LOW is a 1. */
  const decode = () => {
    const lows = scheduled.filter((s) => s.level === 0).map((s) => s.time);
    const highs = scheduled.filter((s) => s.level === 1).map((s) => s.time);
    const bits = [...Array(40).keys()].map((i) => {
      const low = (highs[i + 1] ?? 0) - (lows[i + 1] ?? 0);
      const high = (lows[i + 2] ?? 0) - (highs[i + 1] ?? 0);
      return high > low ? 1 : 0;
    });
    return [...Array(5).keys()].map((n) =>
      bits.slice(8 * n, 8 * n + 8).reduce<number>((a, x) => (a << 1) | x, 0),
    );
  };
  return { b, dht, io, scheduled, start, decode };
}

describe('sensor.dht11', () => {
  it('has a valid manifest', () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it('answers an 18 ms start signal with 40 bits: humidity, temperature and their checksum', () => {
    const { b, scheduled, start, decode } = rig();
    b.input('dht', 'temperatureC', 31);
    b.input('dht', 'humidity', 62);
    b.run(1.2);
    start(20);
    const released = b.sim.now + 0.02;
    expect((scheduled[0]?.time ?? 0) - released).toBeCloseTo(30e-6, 9); // response after 30 µs
    expect(scheduled).toHaveLength(2 + 80 + 2);
    const [hum = 0, , temp = 0, , sum] = decode();
    expect(Math.abs(temp - 31)).toBeLessThanOrEqual(1);
    expect(Math.abs(hum - 62)).toBeLessThanOrEqual(3);
    expect(sum).toBe((hum + temp) & 0xff);
    const last = scheduled.at(-1);
    expect(last?.level).toBe(1);
    expect((last?.time ?? 0) - released).toBeGreaterThan(3.5e-3); // 40 bits take about 4 ms
    expect(b.state<Dht11State>('dht')).toMatchObject({ temperatureC: temp, humidity: hum });
  });

  it('ignores a short start pulse, and any request in the first second after power-up', () => {
    const early = rig();
    early.b.run(0.5);
    early.start(20);
    expect(early.scheduled).toEqual([]);
    const short = rig();
    short.b.run(1.2);
    short.start(1.1); // a DHT22's 1.1 ms start
    expect(short.scheduled).toEqual([]);
  });

  it('keeps its reading for a second: a faster poll gets the same sample', () => {
    const { b, scheduled, start, decode } = rig();
    b.run(1.2);
    start(20);
    const first = decode();
    scheduled.length = 0;
    b.input('dht', 'temperatureC', 45);
    b.run(0.1);
    start(20);
    expect(decode()).toEqual(first);
  });

  it('flags more than 5.5 V', () => {
    const { b } = rig(6);
    b.run(0.01);
    expect(b.models['dht']?.faults().map((f) => f.code)).toEqual(['OVER_VOLTAGE']);
  });
});
