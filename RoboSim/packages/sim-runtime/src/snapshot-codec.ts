/**
 * Binary snapshot codec (Technical Design §5.8, layout-at-load).
 *
 * A plain object (numbers, booleans, null, strings, nested objects and arrays) is flattened into
 * leaf paths. Each path owns a slot: a Float64 value and a tag byte saying what the slot holds.
 * Paths and strings live in an append-only dictionary; the encoder reports the additions so the
 * worker can post them once, and every snapshot after that is just the two typed arrays.
 */

export type PathSegment = string | number;
export type Path = readonly PathSegment[];

/** Slot tags. `ABSENT` = the key does not exist in this snapshot. */
export const TAG = {
  ABSENT: 0,
  NUMBER: 1,
  NULL: 2,
  FALSE: 3,
  TRUE: 4,
  STRING: 5,
  /** Containers are leaves only while empty; otherwise their elements carry them. */
  EMPTY_ARRAY: 6,
  EMPTY_OBJECT: 7,
} as const;

/** Dictionary entries added since the previous encode (post before the snapshot that uses them). */
export interface DictDelta {
  readonly paths: readonly Path[];
  readonly strings: readonly string[];
}

export interface EncodedSnapshot {
  /** Number of slots in use (= dictionary path count after this encode). */
  readonly count: number;
  readonly values: Float64Array;
  readonly tags: Uint8Array;
  /** Additions to the dictionary, or null when nothing was added. */
  readonly delta: DictDelta | null;
}

const key = (path: Path): string => path.map((s) => (typeof s === 'number' ? `#${s}` : `.${s}`)).join('');

/** Worker side: owns the dictionary and the reusable value/tag buffers. */
export class SnapshotEncoder {
  private readonly slotByKey = new Map<string, number>();
  private readonly stringIds = new Map<string, number>();
  private values = new Float64Array(64);
  private tags = new Uint8Array(64);
  private count = 0;

  encode(root: Readonly<Record<string, unknown>>): EncodedSnapshot {
    const newPaths: Path[] = [];
    const newStrings: string[] = [];
    this.tags.fill(TAG.ABSENT, 0, this.count);
    const visit = (value: unknown, path: PathSegment[]): void => {
      if (value === undefined) return;
      const entries: [PathSegment, unknown][] | null =
        value !== null && typeof value === 'object'
          ? Array.isArray(value)
            ? value.map((v, i) => [i, v])
            : Object.entries(value)
          : null;
      if (entries && entries.length > 0) {
        for (const [k, v] of entries) visit(v, [...path, k]);
        return;
      }
      const k = key(path);
      let slot = this.slotByKey.get(k);
      if (slot === undefined) {
        slot = this.count++;
        this.slotByKey.set(k, slot);
        newPaths.push(path);
        this.ensure(this.count);
      }
      if (entries) this.put(slot, Array.isArray(value) ? TAG.EMPTY_ARRAY : TAG.EMPTY_OBJECT, 0);
      else if (value === null) this.put(slot, TAG.NULL, 0);
      else if (typeof value === 'boolean') this.put(slot, value ? TAG.TRUE : TAG.FALSE, 0);
      else if (typeof value === 'number') this.put(slot, TAG.NUMBER, value);
      else if (typeof value === 'string') {
        let id = this.stringIds.get(value);
        if (id === undefined) {
          id = this.stringIds.size;
          this.stringIds.set(value, id);
          newStrings.push(value);
        }
        this.put(slot, TAG.STRING, id);
      } else throw new TypeError(`Snapshot leaf at ${k} has unsupported type ${typeof value}`);
    };
    for (const [k, v] of Object.entries(root)) visit(v, [k]);
    return {
      count: this.count,
      values: this.values,
      tags: this.tags,
      delta: newPaths.length > 0 || newStrings.length > 0 ? { paths: newPaths, strings: newStrings } : null,
    };
  }

  private put(slot: number, tag: number, value: number): void {
    this.tags[slot] = tag;
    this.values[slot] = value;
  }

  private ensure(n: number): void {
    if (n <= this.values.length) return;
    const values = new Float64Array(this.values.length * 2);
    const tags = new Uint8Array(this.tags.length * 2);
    values.set(this.values);
    tags.set(this.tags);
    this.values = values;
    this.tags = tags;
  }
}

/**
 * Main side: rebuilds the object from slots. Slots or strings the decoder has not been told about
 * yet (the dictionary message can arrive after the shared buffer was written) keep the value they
 * had in the previous decode.
 */
export class SnapshotDecoder {
  private readonly paths: Path[] = [];
  private readonly strings: string[] = [];
  private previous: unknown[] = [];

  apply(delta: DictDelta): void {
    this.paths.push(...delta.paths);
    this.strings.push(...delta.strings);
  }

  decode(count: number, values: ArrayLike<number>, tags: ArrayLike<number>): Record<string, unknown> {
    const root: Record<string, unknown> = {};
    const known = Math.min(count, this.paths.length);
    const current: unknown[] = new Array<unknown>(known);
    for (let i = 0; i < known; i++) {
      const tag = tags[i] ?? TAG.ABSENT;
      if (tag === TAG.ABSENT) continue;
      let leaf: unknown;
      if (tag === TAG.NUMBER) leaf = values[i];
      else if (tag === TAG.NULL) leaf = null;
      else if (tag === TAG.FALSE) leaf = false;
      else if (tag === TAG.TRUE) leaf = true;
      else if (tag === TAG.EMPTY_ARRAY) leaf = [];
      else if (tag === TAG.EMPTY_OBJECT) leaf = {};
      else leaf = this.strings[values[i] ?? -1] ?? this.previous[i];
      if (leaf === undefined) continue;
      current[i] = leaf;
      setPath(root, this.paths[i] ?? [], leaf);
    }
    this.previous = current;
    return root;
  }
}

function setPath(root: Record<string, unknown>, path: Path, leaf: unknown): void {
  let node: Record<PathSegment, unknown> = root;
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i] as PathSegment;
    let child = node[seg] as Record<PathSegment, unknown> | undefined;
    if (child === undefined) {
      child = (typeof path[i + 1] === 'number' ? [] : {}) as Record<PathSegment, unknown>;
      node[seg] = child;
    }
    node = child;
  }
  node[path[path.length - 1] as PathSegment] = leaf;
}
