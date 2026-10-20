export class SingularMatrixError extends Error {
  constructor(readonly column: number) {
    super(`Singular MNA matrix at column ${column}`);
    this.name = 'SingularMatrixError';
  }
}

const PIVOT_EPSILON = 1e-18;

/**
 * Dense LU factors of an n×n matrix with partial pivoting, reusable for several right-hand sides. It keeps
 * every elimination step (pivot row and multipliers) so solving replays exactly the operations, in the
 * order, that eliminating together with b would have done: results are bit-identical either way.
 */
export interface LuFactors {
  readonly n: number;
  /** Upper triangle U, row-major. */
  readonly upper: Float64Array;
  /** Row swapped with row k at step k. */
  readonly pivots: Int32Array;
  /** Multiplier of row r at step k, at `k * n + r` (0: no update). */
  readonly factors: Float64Array;
}

/**
 * Factors A (row-major n×n, destroyed). Circuits stay < 200 nodes, so dense O(n³) is microseconds and
 * keeps the operation order (and results) fully deterministic.
 */
export function luFactor(a: Float64Array, n: number): LuFactors {
  const pivots = new Int32Array(n);
  const factors = new Float64Array(n * n);
  for (let k = 0; k < n; k++) {
    let pivotRow = k;
    let pivotAbs = Math.abs(a[k * n + k] ?? 0);
    for (let r = k + 1; r < n; r++) {
      const v = Math.abs(a[r * n + k] ?? 0);
      if (v > pivotAbs) {
        pivotAbs = v;
        pivotRow = r;
      }
    }
    if (pivotAbs < PIVOT_EPSILON) throw new SingularMatrixError(k);
    pivots[k] = pivotRow;
    if (pivotRow !== k) {
      for (let c = 0; c < n; c++) {
        const t = a[k * n + c] ?? 0;
        a[k * n + c] = a[pivotRow * n + c] ?? 0;
        a[pivotRow * n + c] = t;
      }
    }
    const pivot = a[k * n + k] ?? 0;
    for (let r = k + 1; r < n; r++) {
      const factor = (a[r * n + k] ?? 0) / pivot;
      if (factor === 0) continue;
      factors[k * n + r] = factor;
      a[r * n + k] = 0;
      for (let c = k + 1; c < n; c++) a[r * n + c] = (a[r * n + c] ?? 0) - factor * (a[k * n + c] ?? 0);
    }
  }
  return { n, upper: a, pivots, factors };
}

/** Solves A·x = b for factored A; `b` is overwritten with x. */
export function luSolveFactored(lu: LuFactors, b: Float64Array): void {
  const { n, upper, pivots, factors } = lu;
  for (let k = 0; k < n; k++) {
    const pivotRow = pivots[k] ?? k;
    if (pivotRow !== k) {
      const t = b[k] ?? 0;
      b[k] = b[pivotRow] ?? 0;
      b[pivotRow] = t;
    }
    for (let r = k + 1; r < n; r++) {
      const factor = factors[k * n + r] ?? 0;
      if (factor === 0) continue;
      b[r] = (b[r] ?? 0) - factor * (b[k] ?? 0);
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    let sum = b[r] ?? 0;
    for (let c = r + 1; c < n; c++) sum -= (upper[r * n + c] ?? 0) * (b[c] ?? 0);
    b[r] = sum / (upper[r * n + r] ?? 1);
  }
}

/** Solves A·x = b in place: `a` (row-major n×n) is destroyed, `b` is overwritten with x. */
export function luSolveInPlace(a: Float64Array, b: Float64Array, n: number): void {
  luSolveFactored(luFactor(a, n), b);
}
