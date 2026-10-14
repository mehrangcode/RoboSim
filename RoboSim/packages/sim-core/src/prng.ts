import { cos, log } from './dmath/index.js';

/** splitmix32 — expands a 32-bit seed into well-mixed state words. */
function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/**
 * xoshiro128** (Blackman & Vigna) — the only randomness source in the engine (Technical Design §5.9).
 * 32-bit integer arithmetic only, so every JavaScript engine yields the same stream.
 */
export class Prng {
  private readonly s = new Uint32Array(4);

  private constructor() {}

  static fromSeed(seed: number): Prng {
    const p = new Prng();
    const next = splitmix32(seed);
    for (let i = 0; i < 4; i++) p.s[i] = next();
    if (p.s.every((w) => w === 0)) p.s[0] = 1; // all-zero state is a fixed point
    return p;
  }

  static fromState(state: readonly number[]): Prng {
    if (state.length !== 4 || state.every((w) => w === 0))
      throw new RangeError('Prng state must be 4 words, not all zero');
    const p = new Prng();
    p.s.set(state);
    return p;
  }

  state(): number[] {
    return Array.from(this.s);
  }

  nextUint32(): number {
    const [s0 = 0, s1 = 0, s2 = 0, s3 = 0] = this.s;
    const result = Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0;
    const n2 = s2 ^ s0;
    const n3 = s3 ^ s1;
    this.s[0] = s0 ^ n3;
    this.s[1] = s1 ^ n2;
    this.s[2] = n2 ^ (s1 << 9);
    this.s[3] = rotl(n3 >>> 0, 11);
    return result;
  }

  /** Uniform in [0, 1) with 53 bits of precision. */
  next(): number {
    const hi = this.nextUint32() >>> 5; // 27 bits
    const lo = this.nextUint32() >>> 6; // 26 bits
    return (hi * 67108864 + lo) / 9007199254740992;
  }

  /** Uniform integer in [0, n) without modulo bias. */
  int(n: number): number {
    if (!Number.isInteger(n) || n <= 0 || n > 0x100000000)
      throw new RangeError(`int(n) needs 1 ≤ n ≤ 2^32, got ${n}`);
    const limit = 0x100000000 - (0x100000000 % n);
    for (;;) {
      const x = this.nextUint32();
      if (x < limit) return x % n;
    }
  }

  /** Standard normal sample (Box–Muller on deterministic math). */
  normal(mean = 0, stdDev = 1): number {
    const u1 = 1 - this.next(); // (0, 1]
    const u2 = this.next();
    return mean + stdDev * Math.sqrt(-2 * log(u1)) * cos(2 * Math.PI * u2);
  }

  /**
   * Independent child stream derived from the current state and a label without advancing this stream,
   * so adding a component never shifts the random numbers of the others.
   */
  fork(label: string): Prng {
    let h = 0x811c9dc5; // FNV-1a over label + state
    for (let i = 0; i < label.length; i++) h = Math.imul(h ^ label.charCodeAt(i), 0x01000193);
    for (const w of this.s) h = Math.imul(h ^ w, 0x01000193);
    return Prng.fromSeed(h >>> 0);
  }
}
