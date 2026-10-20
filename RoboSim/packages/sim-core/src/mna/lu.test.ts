import { describe, expect, it } from 'vitest';
import { SingularMatrixError, luFactor, luSolveFactored, luSolveInPlace } from './lu.js';

describe('dense LU', () => {
  // Needs a row swap at the first step (|2| < |4|).
  const matrix = () => Float64Array.of(2, 1, 1, 4, -6, 0, -2, 7, 2);

  it('solves A·x = b with partial pivoting', () => {
    const b = Float64Array.of(5, -2, 9);
    luSolveInPlace(matrix(), b, 3);
    expect([...b].map((v) => Math.round(v * 1e12) / 1e12)).toEqual([1, 1, 2]);
  });

  it('reuses one factorisation for several right-hand sides, bit-identically to solving afresh', () => {
    const lu = luFactor(matrix(), 3);
    for (const rhs of [
      [5, -2, 9],
      [1, 0, 0],
      [0.1, 1e-9, -3.7],
    ]) {
      const reused = Float64Array.from(rhs);
      luSolveFactored(lu, reused);
      const fresh = Float64Array.from(rhs);
      luSolveInPlace(matrix(), fresh, 3);
      expect([...reused]).toEqual([...fresh]);
    }
  });

  it('rejects a singular matrix', () => {
    expect(() => luFactor(Float64Array.of(1, 2, 2, 4), 2)).toThrow(SingularMatrixError);
  });
});
