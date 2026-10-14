import { describe, expect, it } from 'vitest';
import { Prng } from './prng.js';

describe('Prng (xoshiro128**)', () => {
  it('matches the reference output for state [1, 2, 3, 4]', () => {
    const p = Prng.fromState([1, 2, 3, 4]);
    expect([p.nextUint32(), p.nextUint32(), p.nextUint32()]).toEqual([11520, 0, 5927040]);
  });

  it('is reproducible from a seed and from saved state', () => {
    const a = Prng.fromSeed(42);
    const b = Prng.fromSeed(42);
    const seqA = Array.from({ length: 100 }, () => a.next());
    expect(Array.from({ length: 100 }, () => b.next())).toEqual(seqA);

    const saved = a.state();
    const tail = Array.from({ length: 10 }, () => a.nextUint32());
    const restored = Prng.fromState(saved);
    expect(Array.from({ length: 10 }, () => restored.nextUint32())).toEqual(tail);
  });

  it('produces different streams for different seeds', () => {
    expect(Prng.fromSeed(1).nextUint32()).not.toBe(Prng.fromSeed(2).nextUint32());
  });

  it('keeps next() in [0, 1) with a sane mean', () => {
    const p = Prng.fromSeed(7);
    let sum = 0;
    for (let i = 0; i < 20000; i++) {
      const x = p.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      sum += x;
    }
    expect(sum / 20000).toBeCloseTo(0.5, 1);
  });

  it('int(n) is unbiased and in range', () => {
    const p = Prng.fromSeed(9);
    const counts = [0, 0, 0];
    for (let i = 0; i < 30000; i++) {
      const k = p.int(3);
      counts[k] = (counts[k] ?? 0) + 1;
    }
    for (const c of counts) expect(c).toBeGreaterThan(9500);
    expect(() => p.int(0)).toThrow(RangeError);
  });

  it('normal() has roughly zero mean and unit variance', () => {
    const p = Prng.fromSeed(3);
    const xs = Array.from({ length: 20000 }, () => p.normal());
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
    expect(mean).toBeCloseTo(0, 1);
    expect(variance).toBeCloseTo(1, 1);
  });

  it('fork() is label-dependent and does not advance the parent', () => {
    const parent = Prng.fromSeed(5);
    const before = parent.state();
    const a = parent.fork('motor-1').nextUint32();
    const b = parent.fork('motor-2').nextUint32();
    expect(parent.state()).toEqual(before);
    expect(a).not.toBe(b);
    expect(parent.fork('motor-1').nextUint32()).toBe(a);
  });

  it('rejects an all-zero state', () => {
    expect(() => Prng.fromState([0, 0, 0, 0])).toThrow(RangeError);
  });
});
