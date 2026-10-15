import { describe, expect, it } from 'vitest';
import {
  SharedSnapshotReader,
  SharedSnapshotWriter,
  packSnapshot,
  unpackSnapshot,
} from './snapshot-channel.js';

const data = (n: number, base: number) => ({
  values: Float64Array.from({ length: n }, (_, i) => base + i / 8),
  tags: Uint8Array.from({ length: n }, (_, i) => (i % 7) + 1),
});

describe('shared snapshot channel', () => {
  it('reader sees the latest snapshot once, then nothing until the next write', () => {
    const writer = new SharedSnapshotWriter(16);
    const reader = new SharedSnapshotReader(writer.buffer);
    expect(reader.read()).toBeNull();
    const a = data(5, 1);
    writer.write(5, a.values, a.tags);
    const b = data(3, 100);
    writer.write(3, b.values, b.tags); // the reader skipped a: only the newest matters
    const got = reader.read();
    expect(got?.count).toBe(3);
    expect([...(got?.values ?? [])]).toEqual([...b.values]);
    expect([...(got?.tags ?? [])]).toEqual([...b.tags]);
    expect(reader.read()).toBeNull();
  });

  it('returned data is a copy: later writes do not change it', () => {
    const writer = new SharedSnapshotWriter(4);
    const reader = new SharedSnapshotReader(writer.buffer);
    const a = data(4, 1);
    writer.write(4, a.values, a.tags);
    const got = reader.read();
    for (let i = 0; i < 4; i++) writer.write(4, data(4, 50 + i).values, a.tags);
    expect([...(got?.values ?? [])]).toEqual([...a.values]);
  });

  it('never returns a half written by a writer mid-update (odd sequence)', () => {
    const writer = new SharedSnapshotWriter(4);
    const reader = new SharedSnapshotReader(writer.buffer);
    const a = data(2, 1);
    writer.write(2, a.values, a.tags);
    const control = new Int32Array(writer.buffer, 0, 8);
    const latest = control[2] ?? 0;
    Atomics.add(control, latest, 1); // simulate a writer stuck inside this half
    expect(reader.read()).toBeNull();
    Atomics.add(control, latest, 1);
    expect(reader.read()?.count).toBe(2);
  });

  it('rejects snapshots larger than its capacity', () => {
    const writer = new SharedSnapshotWriter(2);
    const a = data(3, 0);
    expect(() => writer.write(3, a.values, a.tags)).toThrow(RangeError);
  });

  it('transfer fallback packs and unpacks the same data', () => {
    const a = data(9, 7);
    const got = unpackSnapshot(packSnapshot(9, a.values, a.tags));
    expect(got.count).toBe(9);
    expect([...got.values]).toEqual([...a.values]);
    expect([...got.tags]).toEqual([...a.tags]);
  });
});
