import { describe, expect, it } from 'vitest';
import { SnapshotDecoder, SnapshotEncoder, TAG } from './snapshot-codec.js';

function roundTrip(enc: SnapshotEncoder, dec: SnapshotDecoder, value: Record<string, unknown>) {
  const e = enc.encode(value);
  if (e.delta) dec.apply(e.delta);
  return dec.decode(e.count, e.values, e.tags);
}

describe('snapshot codec', () => {
  it('round-trips numbers, booleans, null, strings, nesting, arrays and empty containers', () => {
    const value = {
      n: -1.5e-300,
      nan: Number.NaN,
      flags: [true, false],
      none: null,
      text: 'forward',
      nested: { deep: { x: 1 }, list: [{ a: 1 }, { a: 2, b: 'x' }] },
      emptyList: [],
      emptyObject: {},
    };
    expect(roundTrip(new SnapshotEncoder(), new SnapshotDecoder(), value)).toEqual(value);
  });

  it('drops undefined and absent keys; keys can come and go between snapshots', () => {
    const enc = new SnapshotEncoder();
    const dec = new SnapshotDecoder();
    expect(roundTrip(enc, dec, { a: 1, b: undefined, pin: { duty: 0.5 } })).toEqual({
      a: 1,
      pin: { duty: 0.5 },
    });
    expect(roundTrip(enc, dec, { a: 2, pin: { level: 1 } })).toEqual({ a: 2, pin: { level: 1 } });
    expect(roundTrip(enc, dec, { a: 3, pin: { duty: 0.25 } })).toEqual({ a: 3, pin: { duty: 0.25 } });
  });

  it('a leaf may change type (null ↔ number ↔ string) without new slots', () => {
    const enc = new SnapshotEncoder();
    const dec = new SnapshotDecoder();
    for (const v of [null, 4, 'far', false, []]) expect(roundTrip(enc, dec, { d: v })).toEqual({ d: v });
  });

  it('reports only dictionary additions', () => {
    const enc = new SnapshotEncoder();
    expect(enc.encode({ a: 1, s: 'x' }).delta).toEqual({ paths: [['a'], ['s']], strings: ['x'] });
    expect(enc.encode({ a: 2, s: 'x' }).delta).toBeNull();
    expect(enc.encode({ a: 2, s: 'y' }).delta).toEqual({ paths: [], strings: ['y'] });
    expect(enc.encode({ a: 2, s: 'y', list: [0] }).delta).toEqual({ paths: [['list', 0]], strings: [] });
  });

  it('grows past its initial buffer', () => {
    const big = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`k${i}`, i]));
    expect(roundTrip(new SnapshotEncoder(), new SnapshotDecoder(), big)).toEqual(big);
  });

  it('a decoder behind on the dictionary ignores unknown slots and keeps the last known string', () => {
    const enc = new SnapshotEncoder();
    const dec = new SnapshotDecoder();
    expect(roundTrip(enc, dec, { mode: 'input' })).toEqual({ mode: 'input' });
    const e = enc.encode({ mode: 'output', extra: 1 }); // delta deliberately not applied yet
    expect(e.tags[0]).toBe(TAG.STRING);
    expect(dec.decode(e.count, e.values, e.tags)).toEqual({ mode: 'input' });
  });

  it('rejects leaves it cannot carry', () => {
    expect(() => new SnapshotEncoder().encode({ f: () => 1 })).toThrow(/unsupported type function/);
  });
});
