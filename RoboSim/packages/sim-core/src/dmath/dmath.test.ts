import { describe, expect, it } from 'vitest';
import { atan, atan2, cos, exp, log, sin, tan, wrapAngle } from './index.js';

/** Tiny deterministic LCG so the sample set is identical on every run. */
function samples(count: number, lo: number, hi: number): number[] {
  let s = 12345;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    out.push(lo + (hi - lo) * (s / 0x100000000));
  }
  return out;
}

function expectClose(actual: number, expected: number, ulps = 2): void {
  const tol = ulps * Number.EPSILON * Math.max(1, Math.abs(expected));
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);
}

function bits(x: number): string {
  const v = new DataView(new ArrayBuffer(8));
  v.setFloat64(0, x);
  return v.getBigUint64(0).toString(16).padStart(16, '0');
}

describe('dmath accuracy vs host Math', () => {
  it.each([
    ['sin', sin, Math.sin, -100, 100],
    ['cos', cos, Math.cos, -100, 100],
    ['tan', tan, Math.tan, -1.5, 1.5],
    ['atan', atan, Math.atan, -50, 50],
    ['exp', exp, Math.exp, -700, 700],
    ['log', log, Math.log, 1e-6, 1e6],
  ] as const)('%s stays within a few ulps', (_name, f, ref, lo, hi) => {
    for (const x of samples(5000, lo, hi)) expectClose(f(x), ref(x), 4);
  });

  it('log is accurate across the full exponent range', () => {
    for (const e of samples(5000, -1000, 1000)) {
      const x = 2 ** e;
      expectClose(log(x), Math.log(x), 4);
    }
  });

  it('atan2 covers all quadrants', () => {
    const xs = samples(400, -10, 10);
    const ys = samples(400, -10, 10).reverse();
    xs.forEach((x, i) => expectClose(atan2(ys[i] ?? 0, x), Math.atan2(ys[i] ?? 0, x), 4));
  });

  it('handles special values like IEEE-754 / fdlibm', () => {
    expect(sin(0)).toBe(0);
    expect(Object.is(sin(-0), -0)).toBe(true);
    expect(cos(0)).toBe(1);
    expect(sin(Number.POSITIVE_INFINITY)).toBeNaN();
    expect(exp(0)).toBe(1);
    expect(exp(1000)).toBe(Number.POSITIVE_INFINITY);
    expect(exp(-1000)).toBe(0);
    expect(log(1)).toBe(0);
    expect(log(0)).toBe(Number.NEGATIVE_INFINITY);
    expect(log(-1)).toBeNaN();
    expectClose(log(5e-324), Math.log(5e-324));
    expect(atan2(0, -1)).toBe(Math.PI);
    expect(atan2(-0, -1)).toBe(-Math.PI);
    expect(atan2(1, 0)).toBe(Math.PI / 2);
    expect(atan2(Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY)).toBe((3 * Math.PI) / 4);
    expect(atan(Number.POSITIVE_INFINITY)).toBe(Math.PI / 2);
  });

  it('wraps angles to (−π, π]', () => {
    expect(wrapAngle(Math.PI)).toBe(Math.PI);
    expect(wrapAngle(-Math.PI)).toBe(Math.PI);
    expectClose(wrapAngle(3 * Math.PI + 0.5), -Math.PI + 0.5, 16);
  });
});

describe('dmath golden bits', () => {
  // Bit patterns are the engine-independent contract: a change here changes every golden trace.
  it('produces stable bit patterns', () => {
    const results = [
      sin(1),
      cos(1),
      sin(100),
      atan(0.5),
      atan2(-3, -4),
      exp(1),
      exp(-20.5),
      log(10),
      log(1e-10),
    ].map(bits);
    expect(results).toMatchInlineSnapshot(`
      [
        "3feaed548f090cee",
        "3fe14a280fb5068c",
        "bfe03425b78c4db8",
        "3fddac670561bb4f",
        "c003fc176b7a8560",
        "4005bf0a8b14576a",
        "3e157a3afeed00ab",
        "40026bb1bbb55516",
        "c037069e2aa2aa5b",
      ]
    `);
  });
});
