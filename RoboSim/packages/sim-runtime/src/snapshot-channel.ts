/**
 * Snapshot transport (Technical Design §5.8): a double-buffered `SharedArrayBuffer` when the page is
 * cross-origin isolated, otherwise one transferable `ArrayBuffer` per snapshot.
 *
 * Shared layout (bytes):
 *   0   Int32 control: [seq half 0, seq half 1, latest half, publish counter, capacity, 3 × pad]
 *   32  half 0: Int32 slot count, 4 pad, Float64 values[capacity], Uint8 tags[capacity] (padded to 8)
 *   …   half 1: same
 *
 * Writer (worker) fills the half the reader is *not* pointed at, bracketing the write with a
 * seqlock (odd = writing), then flips `latest` and bumps the publish counter. The reader retries
 * when the sequence changed under it, so it never returns a torn snapshot.
 */

const CONTROL_BYTES = 32;
const SEQ = 0;
const LATEST = 2;
const PUBLISHED = 3;
const CAPACITY = 4;

const halfBytes = (capacity: number): number => 8 + capacity * 8 + Math.ceil(capacity / 8) * 8;

/** A decoded-ready copy of one snapshot. */
export interface SnapshotData {
  readonly count: number;
  readonly values: Float64Array;
  readonly tags: Uint8Array;
}

interface Half {
  readonly count: Int32Array;
  readonly values: Float64Array;
  readonly tags: Uint8Array;
}

function views(buffer: SharedArrayBuffer | ArrayBuffer, capacity: number, offset: number): Half {
  return {
    count: new Int32Array(buffer, offset, 1),
    values: new Float64Array(buffer, offset + 8, capacity),
    tags: new Uint8Array(buffer, offset + 8 + capacity * 8, capacity),
  };
}

export class SharedSnapshotWriter {
  readonly buffer: SharedArrayBuffer;
  readonly capacity: number;
  private readonly control: Int32Array;
  private readonly halves: readonly [Half, Half];

  constructor(capacity: number) {
    this.capacity = capacity;
    this.buffer = new SharedArrayBuffer(CONTROL_BYTES + 2 * halfBytes(capacity));
    this.control = new Int32Array(this.buffer, 0, CONTROL_BYTES / 4);
    this.control[CAPACITY] = capacity;
    this.halves = [
      views(this.buffer, capacity, CONTROL_BYTES),
      views(this.buffer, capacity, CONTROL_BYTES + halfBytes(capacity)),
    ];
  }

  write(count: number, values: Float64Array, tags: Uint8Array): void {
    if (count > this.capacity)
      throw new RangeError(`Snapshot of ${count} slots exceeds capacity ${this.capacity}`);
    const index = Atomics.load(this.control, LATEST) ^ 1;
    const half = this.halves[index as 0 | 1];
    Atomics.add(this.control, SEQ + index, 1); // odd: writing
    half.count[0] = count;
    half.values.set(values.subarray(0, count));
    half.tags.set(tags.subarray(0, count));
    Atomics.add(this.control, SEQ + index, 1); // even: stable
    Atomics.store(this.control, LATEST, index);
    Atomics.add(this.control, PUBLISHED, 1);
  }
}

export class SharedSnapshotReader {
  private readonly control: Int32Array;
  private readonly halves: readonly [Half, Half];
  private lastPublished = 0;

  constructor(buffer: SharedArrayBuffer) {
    this.control = new Int32Array(buffer, 0, CONTROL_BYTES / 4);
    const capacity = this.control[CAPACITY] ?? 0;
    this.halves = [
      views(buffer, capacity, CONTROL_BYTES),
      views(buffer, capacity, CONTROL_BYTES + halfBytes(capacity)),
    ];
  }

  /** The newest snapshot, or null when nothing was published since the previous read. */
  read(): SnapshotData | null {
    const published = Atomics.load(this.control, PUBLISHED);
    if (published === this.lastPublished) return null;
    for (let attempt = 0; attempt < 8; attempt++) {
      const index = Atomics.load(this.control, LATEST) as 0 | 1;
      const before = Atomics.load(this.control, SEQ + index);
      if (before % 2 === 1) continue;
      const half = this.halves[index];
      const count = half.count[0] ?? 0;
      const values = half.values.slice(0, count);
      const tags = half.tags.slice(0, count);
      if (Atomics.load(this.control, SEQ + index) !== before) continue;
      this.lastPublished = published;
      return { count, values, tags };
    }
    return null; // writer kept overtaking us; the next poll gets a stable copy
  }
}

/** Fallback without cross-origin isolation: one self-contained buffer per snapshot (transferable). */
export function packSnapshot(count: number, values: Float64Array, tags: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(halfBytes(count));
  const half = views(buffer, count, 0);
  half.count[0] = count;
  half.values.set(values.subarray(0, count));
  half.tags.set(tags.subarray(0, count));
  return buffer;
}

export function unpackSnapshot(buffer: ArrayBuffer): SnapshotData {
  const count = new Int32Array(buffer, 0, 1)[0] ?? 0;
  const half = views(buffer, count, 0);
  return { count, values: half.values, tags: half.tags };
}
