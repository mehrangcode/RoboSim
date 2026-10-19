import { validateManifest, type ComponentIO, type Level } from '@robosim/sim-core';
import { bench, dcSupply } from '@robosim/test-fixtures';
import { describe, expect, it } from 'vitest';
import { crc8, definition, manifest, type Ds18b20, type Ds18b20State } from './index.js';

/**
 * A 1-Wire master with OneWire's slot timing, driving the sensors' hooks directly. The bus reads LOW
 * while any sensor pulls it (wired-AND).
 */
function oneWire(count = 1, opts: { parasite?: boolean } = {}) {
  const ids = [...Array(count).keys()].map((i) => `t${i}`);
  const b = bench({
    parts: {
      src: { def: dcSupply, props: { volts: 5, ohms: 0.01 } },
      ...Object.fromEntries(ids.map((id) => [id, { def: definition }])),
    },
    wires: opts.parasite
      ? ids.map((id) => ['src.pos', `${id}.dq`] as const)
      : ids.map((id) => ['src.pos', `${id}.vdd`] as const),
    ground: [
      'src.neg',
      ...ids.map((id) => `${id}.gnd`),
      ...(opts.parasite ? ids.map((id) => `${id}.vdd`) : []),
    ],
    seed: 7,
  });
  b.run(0.002);
  const sensors = ids.map((id) => b.models[id] as Ds18b20);
  const lows: { from: number; to: number }[] = [];
  let pending: number | null = null;
  const io = {
    scheduleMcuInput: (_net: number, level: Level, time: number) => {
      if (level === 0) pending = time;
      else if (pending !== null) {
        lows.push({ from: pending, to: time });
        pending = null;
      }
    },
    solution: { voltage: () => 5 },
  } as unknown as ComponentIO;
  let t = b.sim.now;
  const lowAt = (at: number) => lows.some((l) => l.from <= at && at < l.to);
  const pull = (us: number) => {
    for (const s of sensors) s.mcuMode(0, 'output', 0, t, io);
    t += us * 1e-6;
    for (const s of sensors) s.mcuMode(0, 'input', 0, t, io);
  };
  const reset = () => {
    pull(480);
    const present = lowAt(t + 70e-6);
    t += 480e-6;
    return present;
  };
  const writeBit = (bit: number) => {
    pull(bit ? 10 : 65);
    t += bit ? 55e-6 : 5e-6;
  };
  const readBit = () => {
    pull(3);
    const bit = lowAt(t + 10e-6) ? 0 : 1;
    t += 63e-6;
    return bit;
  };
  const write = (...bytes: number[]) =>
    bytes.forEach((v) => [...Array(8).keys()].forEach((i) => writeBit((v >> i) & 1)));
  const read = (n: number) =>
    [...Array(n).keys()].map(() => [...Array(8).keys()].reduce((v, i) => v | (readBit() << i), 0));
  /** OneWire::search(), all devices. */
  const search = (): number[][] => {
    const found: number[][] = [];
    let lastDiscrepancy = -1;
    for (;;) {
      if (!reset()) return found;
      write(0xf0);
      const rom = Array<number>(8).fill(0);
      let discrepancy = -1;
      for (let bit = 0; bit < 64; bit++) {
        const id = readBit();
        const cmp = readBit();
        if (id && cmp) return found;
        let dir: number;
        if (id !== cmp) dir = id;
        else {
          const prev = found.at(-1);
          dir =
            bit < lastDiscrepancy
              ? ((prev?.[bit >> 3] ?? 0) >> (bit & 7)) & 1
              : bit === lastDiscrepancy
                ? 1
                : 0;
          if (dir === 0) discrepancy = bit;
        }
        rom[bit >> 3] = (rom[bit >> 3] ?? 0) | (dir << (bit & 7));
        writeBit(dir);
      }
      found.push(rom);
      if (discrepancy < 0) return found;
      lastDiscrepancy = discrepancy;
    }
  };
  /** Advances simulated time (sensors finish conversions on their next event or step). */
  const wait = (s: number) => {
    b.run(s);
    t = Math.max(t, b.sim.now);
  };
  return { b, sensors, reset, write, read, readBit, search, wait, now: () => t };
}

const temperature = (pad: number[]) => (((((pad[1] ?? 0) << 8) | (pad[0] ?? 0)) << 16) >> 16) / 16;

describe('sensor.ds18b20', () => {
  it('has a valid manifest', () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it('answers a reset with a presence pulse and reports its ROM code with a valid CRC', () => {
    const bus = oneWire();
    expect(bus.reset()).toBe(true);
    bus.write(0x33);
    const rom = bus.read(8);
    expect(rom[0]).toBe(0x28);
    expect(crc8(rom.slice(0, 7))).toBe(rom[7]);
    expect(bus.b.state<Ds18b20State>('t0').rom).toBe(
      rom.map((x) => x.toString(16).padStart(2, '0')).join(''),
    );
  });

  it('converts in 750 ms at 12 bits (busy until then) and returns the temperature with its CRC', () => {
    const bus = oneWire();
    bus.b.input('t0', 'temperatureC', 23.5);
    bus.reset();
    bus.write(0xcc, 0xbe);
    expect(temperature(bus.read(9))).toBe(85); // power-on value
    bus.reset();
    bus.write(0xcc, 0x44);
    expect(bus.readBit()).toBe(0);
    bus.wait(0.7);
    expect(bus.readBit()).toBe(0);
    bus.wait(0.06);
    expect(bus.readBit()).toBe(1);
    bus.reset();
    bus.write(0xcc, 0xbe);
    const pad = bus.read(9);
    expect(crc8(pad.slice(0, 8))).toBe(pad[8]);
    expect(Math.abs(temperature(pad) - 23.5)).toBeLessThanOrEqual(0.25);
    expect(pad.slice(4, 8)).toEqual([0x7f, 0xff, 0x0c, 0x10]);
  });

  it('at 9 bits converts in 94 ms with 0.5 °C steps', () => {
    const bus = oneWire();
    bus.b.input('t0', 'temperatureC', -10.3);
    bus.reset();
    bus.write(0xcc, 0x4e, 0x4b, 0x46, 0x1f);
    bus.reset();
    bus.write(0xcc, 0x44);
    bus.wait(0.09);
    expect(bus.readBit()).toBe(0);
    bus.wait(0.01);
    expect(bus.readBit()).toBe(1);
    bus.reset();
    bus.write(0xcc, 0xbe);
    const t = temperature(bus.read(9));
    expect(t * 2).toBe(Math.round(t * 2));
    expect(Math.abs(t + 10.3)).toBeLessThanOrEqual(0.75);
  });

  it('shares a bus: SEARCH ROM finds every sensor, MATCH ROM addresses one', () => {
    const bus = oneWire(3);
    const roms = bus.search();
    expect(roms).toHaveLength(3);
    expect(new Set(roms.map((r) => r.join())).size).toBe(3);
    for (const r of roms) expect(crc8(r.slice(0, 7))).toBe(r[7]);
    bus.b.input('t1', 'temperatureC', 40);
    bus.reset();
    bus.write(0xcc, 0x44);
    bus.wait(0.8);
    const rom1 =
      bus.b
        .state<Ds18b20State>('t1')
        .rom.match(/../g)
        ?.map((h) => parseInt(h, 16)) ?? [];
    bus.reset();
    bus.write(0x55, ...rom1, 0xbe);
    expect(Math.abs(temperature(bus.read(9)) - 40)).toBeLessThanOrEqual(0.25);
  });

  it('reports external or parasite power', () => {
    const ext = oneWire();
    ext.reset();
    ext.write(0xcc, 0xb4);
    expect(ext.readBit()).toBe(1);
    const parasite = oneWire(1, { parasite: true });
    expect(parasite.b.state<Ds18b20State>('t0')).toMatchObject({ powered: true, parasite: true });
    parasite.reset();
    parasite.write(0xcc, 0xb4);
    expect(parasite.readBit()).toBe(0);
  });
});
