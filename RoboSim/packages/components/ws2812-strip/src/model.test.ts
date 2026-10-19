import { validateManifest, type ComponentIO, type Level, type PinEdge } from '@robosim/sim-core';
import { bench, dcSupply } from '@robosim/test-fixtures';
import { describe, expect, it } from 'vitest';
import { definition, manifest, type Ws2812State, type Ws2812Strip } from './index.js';

/** 800 kHz WS2812 bits as Adafruit_NeoPixel sends them at 16 MHz: HIGH 5 or 13 cycles of 20. */
function encode(grb: readonly number[], start = 0): PinEdge[] {
  const edges: PinEdge[] = [];
  let t = start;
  for (const word of grb)
    for (let bit = 23; bit >= 0; bit--) {
      edges.push({ level: 1, time: t });
      edges.push({ level: 0, time: t + ((word >> bit) & 1 ? 13 : 5) / 16e6 });
      t += 20 / 16e6;
    }
  return edges;
}

function strip(count: number, volts = 5) {
  const b = bench({
    parts: { src: { def: dcSupply, props: { volts, ohms: 0.01 } }, s: { def: definition, props: { count } } },
    wires: [['src.pos', 's.vcc']],
    ground: ['src.neg', 's.gnd'],
  });
  const model = b.models['s'] as Ws2812Strip;
  const emitted: { level: Level; time: number }[] = [];
  /** Steps the strip with `edges` on DIN at time `now`. */
  const feed = (edges: readonly PinEdge[], now: number) =>
    model.step(0.001, {
      now,
      edges: () => edges,
      emitEdge: (_net: number, level: Level, time: number) => void emitted.push({ level, time }),
      invalidate: () => undefined,
      solution: { voltage: (net: number) => (net === 0 ? 0 : volts) },
    } as unknown as ComponentIO);
  return { b, model, emitted, feed };
}

describe('actuator.ws2812-strip', () => {
  it('has a valid manifest', () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it('decodes GRB words from pulse widths and latches them after 50 µs LOW', () => {
    const { model, feed } = strip(3);
    feed(encode([0xff0000, 0x00ff00, 0x0000ff]), 0.0001); // 30 µs of data, latch not yet due
    expect(model.snapshot().colors).toEqual([0, 0, 0]);
    feed([], 0.001);
    expect(model.snapshot().colors).toEqual([0x00ff00, 0xff0000, 0x0000ff]); // GRB → RGB
  });

  it('passes the bits after its own on from DOUT, for the next strip', () => {
    const { model, emitted, feed } = strip(2);
    feed(encode([0x0000ff, 0x000080, 0xffffff]), 0.001);
    expect(model.snapshot().colors).toEqual([0x0000ff, 0x000080]);
    expect(emitted).toHaveLength(48);
    const widths = [...Array(24).keys()].map(
      (i) => (emitted[2 * i + 1]?.time ?? 0) - (emitted[2 * i]?.time ?? 0),
    );
    expect(widths.every((w) => w > 0.55e-6)).toBe(true); // 0xffffff: all ones
  });

  it('draws supply current with its colours: ≈ 36 mA per LED at full white', () => {
    const { b, model, feed } = strip(8);
    b.run(0.002);
    expect(model.snapshot().currentMa).toBeCloseTo(8 * 0.6, 1);
    feed(encode(Array<number>(8).fill(0xffffff)), 0.001);
    expect(model.snapshot().currentMa).toBeCloseTo(8 * 36.6, 0);
  });

  it('a new frame replaces the old one; data before the latch gap is one frame', () => {
    const { model, feed } = strip(2);
    feed(encode([0x110000, 0x220000]), 0.001);
    feed(encode([0x000033], 0.0012), 0.002);
    expect(model.snapshot().colors).toEqual([0x000033, 0x002200]);
  });

  it('is dark and unpowered below 3.5 V; flags more than 5.5 V', () => {
    const low = strip(2, 3);
    low.feed(encode([0xffffff, 0xffffff]), 0.001);
    expect(low.b.state<Ws2812State>('s')).toMatchObject({ powered: false, colors: [0, 0], currentMa: 0 });
    const high = strip(2, 6);
    high.feed([], 0.001);
    expect(high.model.faults().map((f) => f.code)).toEqual(['OVER_VOLTAGE']);
  });
});
