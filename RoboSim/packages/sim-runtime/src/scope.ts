/** Oscilloscope sample storage (FR-SIM-14, TD §18.3). */

/** The main thread keeps the last 60 s of scope readings (60 000 slices at 1 kHz). */
export const SCOPE_BUFFER_SLICES = 60_000;
/** Fine mode keeps the last 10 s of sub-step samples, at most this many per channel (≈ 6 MB each). */
export const SCOPE_FINE_SECONDS = 10;
export const SCOPE_FINE_MAX_POINTS = 500_000;

/** Sub-step samples of one channel in time order: `t[i]` (s) and `v[i]` for `from ≤ i < to`. */
export interface FineTrace {
  readonly t: Float64Array;
  readonly v: Float32Array;
  readonly from: number;
  readonly to: number;
}

class FineStore {
  t = new Float64Array(1024);
  v = new Float32Array(1024);
  from = 0;
  to = 0;

  push(t: number, v: number): void {
    if (this.to === this.t.length) {
      const live = this.to - this.from;
      // Compact, and grow when more than half is live.
      const size = live * 2 > this.t.length ? this.t.length * 2 : this.t.length;
      const t2 = new Float64Array(size);
      const v2 = new Float32Array(size);
      t2.set(this.t.subarray(this.from, this.to));
      v2.set(this.v.subarray(this.from, this.to));
      this.t = t2;
      this.v = v2;
      this.from = 0;
      this.to = live;
    }
    this.t[this.to] = t;
    this.v[this.to++] = v;
  }

  trim(before: number, max: number): void {
    while (this.from < this.to && ((this.t[this.from] ?? Infinity) < before || this.to - this.from > max))
      this.from++;
  }

  clear(): void {
    this.from = this.to = 0;
  }
}

/** PWM on a channel from `slice` on (`freqHz` 0: none). */
export interface ScopePwm {
  readonly slice: number;
  readonly freqHz: number;
  readonly duty: number;
}

/**
 * Ring of `[avg, min, max]` per slice and channel, keyed by slice number (reading `k` was taken after
 * slice `k`, at sim time `k` ms). Folded from consecutive `measures` batches of one subscription; a
 * batch that does not continue the ring (a new run) starts it over. `version` changes on every append.
 */
export class ScopeBuffer {
  readonly data: Float32Array;
  /** First slice held (inclusive) and one past the last. */
  start = 0;
  end = 0;
  version = 0;
  private readonly pwm: ScopePwm[][];
  private readonly fineStore: FineStore[];
  /**
   * Fine mode (TD §18.3): null until the worker answers, then whether the circuit has sub-steps at all
   * (false: no capacitor or inductor, nothing finer than the readings).
   */
  reactive: boolean | null = null;

  constructor(
    readonly channels: number,
    readonly unresolved: readonly number[] = [],
    readonly capacity = SCOPE_BUFFER_SLICES,
  ) {
    this.data = new Float32Array(capacity * channels * 3);
    this.pwm = Array.from({ length: channels }, () => []);
    this.fineStore = Array.from({ length: channels }, () => new FineStore());
  }

  get length(): number {
    return this.end - this.start;
  }

  append(fromSlice: number, slices: number, data: Float32Array, pwm?: Float64Array): void {
    if (slices <= 0) return;
    if (this.length === 0 || fromSlice !== this.end) {
      this.start = this.end = fromSlice;
      for (const list of this.pwm) list.length = 0;
      for (const f of this.fineStore) f.clear();
    }
    const row = this.channels * 3;
    for (let k = 0; k < slices; k++) {
      const at = ((fromSlice + k) % this.capacity) * row;
      this.data.set(data.subarray(k * row, (k + 1) * row), at);
    }
    this.end = fromSlice + slices;
    if (this.end - this.start > this.capacity) this.start = this.end - this.capacity;
    if (pwm)
      for (let i = 0; i + 3 < pwm.length; i += 4) {
        const list = this.pwm[pwm[i + 1] ?? -1];
        list?.push({ slice: pwm[i] ?? 0, freqHz: pwm[i + 2] ?? 0, duty: pwm[i + 3] ?? 0 });
      }
    // Keep the last change at or before `start`: it still describes the oldest slices.
    for (const list of this.pwm)
      while (list.length > 1 && (list[1]?.slice ?? Infinity) <= this.start) list.shift();
    this.version++;
  }

  /** Folds a `scopeFine` batch: `[channel, t_s, value]` triples in time order per channel. */
  appendFine(reactive: boolean, data: Float64Array): void {
    this.reactive = reactive;
    for (let i = 0; i + 2 < data.length; i += 3)
      this.fineStore[data[i] ?? -1]?.push(data[i + 1] ?? 0, data[i + 2] ?? NaN);
    const before = Math.max(this.start, this.end - SCOPE_FINE_SECONDS * 1000) / 1000 - 0.001;
    for (const f of this.fineStore) f.trim(before, SCOPE_FINE_MAX_POINTS);
    if (data.length) this.version++;
  }

  /** Sub-step samples of `ch` (empty without fine mode). */
  fine(ch: number): FineTrace {
    const f = this.fineStore[ch];
    return f
      ? { t: f.t, v: f.v, from: f.from, to: f.to }
      : { t: new Float64Array(0), v: new Float32Array(0), from: 0, to: 0 };
  }

  /** `[avg, min, max]` field `f` (0..2) of `ch` after `slice`; NaN outside the ring. */
  value(ch: number, slice: number, f: 0 | 1 | 2 = 0): number {
    if (slice < this.start || slice >= this.end || ch < 0 || ch >= this.channels) return NaN;
    return this.data[((slice % this.capacity) * this.channels + ch) * 3 + f] ?? NaN;
  }

  /** PWM rebuilding `ch` during `slice`, or null. */
  pwmAt(ch: number, slice: number): ScopePwm | null {
    const list = this.pwm[ch];
    if (!list?.length) return null;
    let lo = 0;
    let hi = list.length - 1;
    if ((list[0]?.slice ?? Infinity) > slice) return null;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((list[mid]?.slice ?? Infinity) <= slice) lo = mid;
      else hi = mid - 1;
    }
    const p = list[lo];
    return p && p.freqHz > 0 ? p : null;
  }
}
