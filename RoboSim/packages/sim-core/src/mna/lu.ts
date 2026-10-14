export class SingularMatrixError extends Error {
  constructor(readonly column: number) {
    super(`Singular MNA matrix at column ${column}`);
    this.name = 'SingularMatrixError';
  }
}

const PIVOT_EPSILON = 1e-18;

/**
 * Solves A·x = b in place with dense LU decomposition and partial pivoting.
 * `a` is row-major n×n and is destroyed; `b` is overwritten with x. Circuits stay < 200 nodes,
 * so dense O(n³) is microseconds and keeps the operation order (and results) fully deterministic.
 */
export function luSolveInPlace(a: Float64Array, b: Float64Array, n: number): void {
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
    if (pivotRow !== k) {
      for (let c = 0; c < n; c++) {
        const t = a[k * n + c] ?? 0;
        a[k * n + c] = a[pivotRow * n + c] ?? 0;
        a[pivotRow * n + c] = t;
      }
      const t = b[k] ?? 0;
      b[k] = b[pivotRow] ?? 0;
      b[pivotRow] = t;
    }
    const pivot = a[k * n + k] ?? 0;
    for (let r = k + 1; r < n; r++) {
      const factor = (a[r * n + k] ?? 0) / pivot;
      if (factor === 0) continue;
      a[r * n + k] = 0;
      for (let c = k + 1; c < n; c++) a[r * n + c] = (a[r * n + c] ?? 0) - factor * (a[k * n + c] ?? 0);
      b[r] = (b[r] ?? 0) - factor * (b[k] ?? 0);
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    let sum = b[r] ?? 0;
    for (let c = r + 1; c < n; c++) sum -= (a[r * n + c] ?? 0) * (b[c] ?? 0);
    b[r] = sum / (a[r * n + r] ?? 1);
  }
}
