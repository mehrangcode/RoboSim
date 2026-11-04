/**
 * Line diff of two serial logs (FR-SIM-21, Technical Design §18.5). DOM-free so sketch tests
 * (IT-14) and the A/B panel (IT-10) can reuse it.
 */

/** A log line; `slice` is absent for untimed sources (an imported .txt). */
export interface DiffLine {
  readonly text: string;
  readonly slice?: number;
}

export type DiffOp =
  | { readonly kind: 'equal'; readonly a: number; readonly b: number; readonly timing?: true }
  | { readonly kind: 'removed'; readonly a: number }
  | { readonly kind: 'added'; readonly b: number };

export interface FirstDivergence {
  /** Line index in `a` (`a.length` when `a` ended first). */
  readonly lineA: number;
  /** Line index in `b` (`b.length` when `b` ended first). */
  readonly lineB: number;
  /** First differing UTF-16 index for `text`; 0 otherwise. */
  readonly column: number;
  readonly reason: 'text' | 'timing' | 'length';
}

export interface SerialDiff {
  /** Aligned lines, or null when the logs are over the caps (`tooLarge`). */
  readonly ops: readonly DiffOp[] | null;
  readonly firstDivergence: FirstDivergence | null;
  readonly counts: { readonly added: number; readonly removed: number; readonly timing: number };
  readonly tooLarge: boolean;
}

export interface DiffOptions {
  /** Compare text only (default false; timing is compared only when both sides are timed). */
  readonly ignoreTiming?: boolean;
  /** Allowed |t_a − t_b| in ms (default 0: a deterministic replay must be exact). */
  readonly timingToleranceMs?: number;
  /** Edit-distance cap (default {@link DIFF_MAX_D}). */
  readonly maxD?: number;
}

export const DIFF_MAX_LINES = 20_000;
export const DIFF_MAX_D = 2_000;

const commonPrefix = (x: string, y: string): number => {
  const n = Math.min(x.length, y.length);
  let i = 0;
  while (i < n && x.charCodeAt(i) === y.charCodeAt(i)) i++;
  return i;
};

/**
 * Splits already-decoded text chunks (the grader's `trace.serial`) into lines on CR, LF and CRLF,
 * each stamped with the slice of the chunk holding its first character.
 */
export function textLines(chunks: readonly { readonly slice: number; readonly text: string }[]): DiffLine[] {
  const lines: DiffLine[] = [];
  let open: { slice: number; text: string } | null = null;
  let pendingCr = false;
  for (const c of chunks) {
    let start = 0;
    for (let i = 0; i < c.text.length; i++) {
      const ch = c.text.charCodeAt(i);
      if (ch !== 10 && ch !== 13) continue;
      if (ch === 10 && pendingCr && i === start && !open) {
        pendingCr = false;
        start = i + 1;
        continue;
      }
      pendingCr = ch === 13;
      const piece = c.text.slice(start, i);
      lines.push(open ? { slice: open.slice, text: open.text + piece } : { slice: c.slice, text: piece });
      open = null;
      start = i + 1;
    }
    if (start < c.text.length) {
      pendingCr = false;
      const piece = c.text.slice(start);
      if (open) open.text += piece;
      else open = { slice: c.slice, text: piece };
    }
  }
  if (open) lines.push(open);
  return lines;
}

/**
 * Lines of a verified run's `trace.serial`, on the live clock. The grader stamps output after the
 * slice it was sent in (the slice count once the step ends); the live host stamps the slice it was
 * sent in, so grader stamps are one higher (Technical Design §18.5).
 */
export function verifiedLines(
  serial: readonly { readonly slice: number; readonly text: string }[],
): DiffLine[] {
  return textLines(serial.map((c) => ({ slice: c.slice - 1, text: c.text })));
}

/**
 * Myers O((N+M)·D) line diff. Yields now and then (each `checkEvery` rounds of D) so a caller can
 * spread the worst case over several tasks; returns the diff.
 */
export function* diffSerialSteps(
  a: readonly DiffLine[],
  b: readonly DiffLine[],
  opts: DiffOptions = {},
  checkEvery = 64,
): Generator<void, SerialDiff, void> {
  const timed =
    !opts.ignoreTiming && a.every((l) => l.slice !== undefined) && b.every((l) => l.slice !== undefined);
  const tol = opts.timingToleranceMs ?? 0;
  const timingOff = (i: number, j: number) =>
    timed && Math.abs((a[i]?.slice ?? 0) - (b[j]?.slice ?? 0)) > tol;
  const maxD = opts.maxD ?? DIFF_MAX_D;
  const N = a.length;
  const M = b.length;

  // Lines as ints so the inner loop compares numbers.
  const ids = new Map<string, number>();
  const id = (l: DiffLine) => {
    let v = ids.get(l.text);
    if (v === undefined) ids.set(l.text, (v = ids.size));
    return v;
  };
  const A = Int32Array.from(a, id);
  const B = Int32Array.from(b, id);

  let pre = 0;
  while (pre < N && pre < M && A[pre] === B[pre]) pre++;
  let suf = 0;
  while (suf < N - pre && suf < M - pre && A[N - 1 - suf] === B[M - 1 - suf]) suf++;
  const n = N - pre - suf;
  const m = M - pre - suf;

  const fallback = (): SerialDiff => {
    let i = 0;
    while (i < N && i < M && A[i] === B[i] && !timingOff(i, i)) i++;
    const first: FirstDivergence | null =
      i < N && i < M
        ? A[i] === B[i]
          ? { lineA: i, lineB: i, column: 0, reason: 'timing' }
          : { lineA: i, lineB: i, column: commonPrefix(a[i]?.text ?? '', b[i]?.text ?? ''), reason: 'text' }
        : i < N || i < M
          ? { lineA: i, lineB: i, column: 0, reason: 'length' }
          : null;
    return { ops: null, firstDivergence: first, counts: { added: 0, removed: 0, timing: 0 }, tooLarge: true };
  };
  if (N > DIFF_MAX_LINES || M > DIFF_MAX_LINES) return fallback();

  // Forward Myers on the trimmed middle, keeping each round's V for the backtrack.
  const max = n + m;
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let D = -1;
  search: for (let d = 0; d <= max; d++) {
    if (d > maxD) return fallback();
    if (d > 0 && d % checkEvery === 0) yield;
    trace.push(v.slice(off - d - 1, off + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && (v[off + k - 1] ?? 0) < (v[off + k + 1] ?? 0))
          ? (v[off + k + 1] ?? 0)
          : (v[off + k - 1] ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && A[pre + x] === B[pre + y]) {
        x++;
        y++;
      }
      v[off + k] = x;
      if (x >= n && y >= m) {
        D = d;
        break search;
      }
    }
  }

  // Backtrack: trace[d] holds V before round d, indexed from k = -d - 1.
  const mid: DiffOp[] = [];
  let x = n;
  let y = m;
  for (let d = D; d > 0; d--) {
    const V = trace[d] as Int32Array;
    const at = (k: number) => V[k + d + 1] ?? 0;
    const k = x - y;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const pk = down ? k + 1 : k - 1;
    const px = at(pk);
    const py = px - pk;
    while (x > px + (down ? 0 : 1) && y > py + (down ? 1 : 0)) {
      x--;
      y--;
      mid.push({ kind: 'equal', a: pre + x, b: pre + y });
    }
    if (down) mid.push({ kind: 'added', b: pre + --y });
    else mid.push({ kind: 'removed', a: pre + --x });
  }
  while (x > 0 && y > 0) {
    x--;
    y--;
    mid.push({ kind: 'equal', a: pre + x, b: pre + y });
  }
  mid.reverse();

  const ops: DiffOp[] = [];
  const counts = { added: 0, removed: 0, timing: 0 };
  let first: FirstDivergence | null = null;
  let ia = 0;
  let ib = 0;
  const push = (op: DiffOp) => {
    if (op.kind === 'equal') {
      if (timingOff(op.a, op.b)) {
        counts.timing++;
        first ??= { lineA: op.a, lineB: op.b, column: 0, reason: 'timing' };
        ops.push({ ...op, timing: true });
      } else ops.push(op);
      ia = op.a + 1;
      ib = op.b + 1;
      return;
    }
    if (!first) {
      first =
        ia < N && ib < M
          ? {
              lineA: ia,
              lineB: ib,
              column: commonPrefix(a[ia]?.text ?? '', b[ib]?.text ?? ''),
              reason: 'text',
            }
          : { lineA: ia, lineB: ib, column: 0, reason: 'length' };
    }
    if (op.kind === 'added') counts.added++;
    else counts.removed++;
    ops.push(op);
  };
  for (let i = 0; i < pre; i++) push({ kind: 'equal', a: i, b: i });
  for (const op of mid) push(op);
  for (let i = 0; i < suf; i++) push({ kind: 'equal', a: N - suf + i, b: M - suf + i });
  return { ops, firstDivergence: first, counts, tooLarge: false };
}

/** {@link diffSerialSteps} run to completion. */
export function diffSerial(
  a: readonly DiffLine[],
  b: readonly DiffLine[],
  opts: DiffOptions = {},
): SerialDiff {
  const steps = diffSerialSteps(a, b, opts);
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}
