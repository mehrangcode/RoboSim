import { ENGINE_VERSION, builtinSource, grade, type ScenarioId } from '@robosim/sim-runtime';
import { describe, expect, it } from 'vitest';
import { parseGradeJob } from '../src/job.js';

/**
 * Hostile input at the grader's trust boundary (parseGradeJob → grade): every job either grades or
 * is refused with one of the engine's typed errors — never a TypeError from deep inside the engine.
 */
const REFUSALS = new Set([
  'ZodError',
  'ProjectDocumentError',
  'ProjectLoadError',
  'IntelHexError',
  'InputLogError',
  'EngineVersionMismatchError',
]);

/** A built-in job as plain JSON, as the grader receives it. */
const baseJob = (scenario: ScenarioId, maxSimSeconds: number) =>
  JSON.parse(
    JSON.stringify({
      log: { engineVersion: ENGINE_VERSION, scenario, ...builtinSource(scenario), seed: 1, entries: [] },
      maxSimSeconds,
    }),
  ) as { log: Record<string, unknown>; maxSimSeconds: unknown };

/** Grades raw JSON; returns the refusal's name, or 'graded'. Anything else escapes and fails the test. */
function attempt(json: unknown): string {
  try {
    const r = grade(parseGradeJob(json));
    const bad = nonFinite(r.final);
    if (bad) throw new Error(`graded run has a non-finite value at ${bad}`);
    return 'graded';
  } catch (e) {
    const name = e instanceof Error ? e.name : typeof e;
    if (!REFUSALS.has(name)) throw e;
    expect((e as Error).message).not.toBe('');
    return name;
  }
}

/** Path of the first NaN / ±Infinity in a value, or null. */
function nonFinite(v: unknown, at = ''): string | null {
  if (typeof v === 'number') return Number.isFinite(v) ? null : at || '.';
  if (v !== null && typeof v === 'object')
    for (const [k, x] of Object.entries(v)) {
      const bad = nonFinite(x, `${at}.${k}`);
      if (bad) return bad;
    }
  return null;
}

/** Mulberry32: a tiny seeded PRNG so every fuzz case is reproducible from its index. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

type Path = (string | number)[];
function paths(v: unknown, at: Path = [], out: Path[] = []): Path[] {
  if (at.length > 0) out.push(at);
  if (Array.isArray(v)) v.forEach((x, i) => paths(x, [...at, i], out));
  else if (v !== null && typeof v === 'object')
    for (const [k, x] of Object.entries(v)) paths(x, [...at, k], out);
  return out;
}

const JUNK: unknown[] = [null, -1, 0, 1e308, -1e308, '', 'x', 'D99', [], {}, true, [null], { id: 1 }];

function mutate(root: unknown, path: Path, next: () => number): void {
  let parent = root as Record<string | number, unknown>;
  for (const k of path.slice(0, -1)) {
    parent = parent[k] as Record<string | number, unknown>;
    if (parent === null || typeof parent !== 'object') return; // an earlier mutation removed it
  }
  const key = path.at(-1) as string | number;
  const r = next();
  if (r < 0.2 && !Array.isArray(parent)) Reflect.deleteProperty(parent, key);
  else if (r < 0.3 && Array.isArray(parent)) parent.splice(key as number, 1);
  else if (r < 0.4 && Array.isArray(parent)) parent.push(structuredClone(parent[key]));
  else parent[key] = structuredClone(JUNK[Math.floor(next() * JUNK.length)]);
}

/** A valid Intel HEX image of `bytes` at address 0 (16-byte data records + EOF). */
function ihex(bytes: Uint8Array): string {
  const rec = (addr: number, type: number, data: Uint8Array) => {
    const all = [data.length, addr >> 8, addr & 0xff, type, ...data];
    const sum = -all.reduce((s, b) => s + b, 0) & 0xff;
    return `:${[...all, sum].map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join('')}`;
  };
  const lines: string[] = [];
  for (let a = 0; a < bytes.length; a += 16) lines.push(rec(a, 0, bytes.subarray(a, a + 16)));
  return [...lines, rec(0, 1, new Uint8Array())].join('\n') + '\n';
}

const withFirmware = (scenario: ScenarioId, text: string, maxSimSeconds: number) => {
  const job = baseJob(scenario, maxSimSeconds);
  job.log['firmware'] = { format: 'ihex', text, sha256: 'test' };
  return parseGradeJob(job);
};

describe('grader robustness: corrupted jobs', () => {
  it.each(['blink', 'dimmer', 'line-follower'] as const)(
    'every mutation of a %s job grades or is refused with a typed error',
    (scenario) => {
      const seen = new Map<string, number>();
      for (let i = 0; i < 150; i++) {
        const next = rng(i + 1);
        const job = baseJob(scenario, 0.02);
        const all = paths(job);
        for (let m = 1 + Math.floor(next() * 3); m > 0; m--)
          mutate(job, all[Math.floor(next() * all.length)] as Path, next);
        const verdict = attempt(job);
        seen.set(verdict, (seen.get(verdict) ?? 0) + 1);
      }
      // The fuzz must actually reach the deeper validators, not just bounce off the job schema.
      expect([...seen.keys()]).toEqual(expect.arrayContaining(['ZodError', 'ProjectLoadError']));
    },
    60_000,
  );

  // Well-formed documents with hostile values: extreme numbers, and ids / pins / types swapped for
  // other strings of the same document (self-wires, dangling refs, duplicates). These pass the
  // schema and reach the loader and the engine.
  it.each(['blink', 'dimmer', 'line-follower', 'servo', 'weather-station'] as const)(
    'hostile values in a well-formed %s document grade or are refused with a typed error',
    (scenario) => {
      const NUMBERS = [0, -0, -1, 1e-12, 1e12, 1e308, -1e308, 0.5, 2 ** 31];
      const seen = new Map<string, number>();
      for (let i = 0; i < 120; i++) {
        const next = rng(10_000 + i);
        const job = baseJob(scenario, 0.05);
        const project = job.log['project'];
        const all = paths(project);
        const leaf = (p: Path) =>
          p.reduce<unknown>((v, k) => (v as Record<string | number, unknown>)[k], project);
        const strings = all.map(leaf).filter((v): v is string => typeof v === 'string');
        const leaves = all.filter((p) => ['number', 'string', 'boolean'].includes(typeof leaf(p)));
        for (let m = 1 + Math.floor(next() * 3); m > 0; m--) {
          const p = leaves[Math.floor(next() * leaves.length)] as Path;
          const v = leaf(p);
          const parent = p
            .slice(0, -1)
            .reduce<unknown>((o, k) => (o as Record<string | number, unknown>)[k], project) as Record<
            string | number,
            unknown
          >;
          parent[p.at(-1) as string | number] =
            typeof v === 'number'
              ? NUMBERS[Math.floor(next() * NUMBERS.length)]
              : typeof v === 'string'
                ? strings[Math.floor(next() * strings.length)]
                : !v;
        }
        const verdict = attempt(job);
        seen.set(verdict, (seen.get(verdict) ?? 0) + 1);
      }
      expect(seen.get('graded') ?? 0).toBeGreaterThan(10);
    },
    120_000,
  );

  it('refuses non-object, empty and wrong-typed jobs at the schema', () => {
    for (const bad of [null, 42, 'job', [], {}, { log: null, maxSimSeconds: 1 }])
      expect(attempt(bad)).toBe('ZodError');
  });

  it('refuses corrupted firmware with the line at fault', () => {
    const good = ihex(Uint8Array.of(0xff, 0xcf));
    const cases: [string, RegExp][] = [
      [good.replace(':02', ':03'), /byte count mismatch/],
      [good.replace(/..\n/, '00\n'), /checksum mismatch/],
      [`garbage\n${good}`, /malformed record/],
      [good.replace(/:00000001FF\n$/, ''), /missing EOF/],
      [`${good}${good}`, /data after EOF/],
      [ihex(new Uint8Array(32 * 1024 + 16)), /exceeds/],
    ];
    for (const [text, why] of cases) {
      expect(() => grade(withFirmware('blink', text, 0.01))).toThrow(why);
    }
  });

  it('refuses a bad input log before slice 0, listing every bad entry', () => {
    const job = baseJob('dimmer', 300);
    job.log['entries'] = [
      { slice: 299_000, kind: 'component', componentId: 'pot', name: 'position', value: 0.5 },
      { slice: 5, kind: 'serial', text: 'b' },
      { slice: 299_001, kind: 'component', componentId: 'nope', name: 'position', value: 1 },
      { slice: 299_002, kind: 'component', componentId: 'pot', name: 'nope', value: 1 },
      { slice: 299_003, kind: 'component', componentId: 'pot', name: 'position', value: true },
      { slice: 299_004, kind: 'component', componentId: 'pot', name: 'position', value: 7 },
    ];
    const started = performance.now();
    expect(() => grade(parseGradeJob(job))).toThrow(
      expect.objectContaining({
        name: 'InputLogError',
        issues: [
          'entry 1 (slice 5): not in slice order',
          "entry 2 (slice 299001): no component 'nope'",
          "entry 3 (slice 299002): component 'pot' has no input 'nope' (has position)",
          "entry 4 (slice 299003): component 'pot' input 'position' must be a number",
          "entry 5 (slice 299004): component 'pot' input 'position' = 7 is outside [0, 1]",
        ],
      }),
    );
    expect(performance.now() - started).toBeLessThan(1000); // refused up front, not 299 s into the run
  });

  it('refuses a document whose initial inputs are not declared or out of range', () => {
    const job = baseJob('dimmer', 0.01);
    const project = job.log['project'] as { components: { id: string; inputs?: object }[] };
    const pot = project.components.find((c) => c.id === 'pot');
    if (!pot) throw new Error('dimmer has no pot');
    pot.inputs = { position: 2, spin: true };
    expect(() => grade(parseGradeJob(job))).toThrow(
      /component 'pot': input 'position' = 2 is outside \[0, 1\].*component 'pot': has no input 'spin'/,
    );
  });
});

describe('grader robustness: runaway firmware', () => {
  // AVR words, little-endian: cli = 94F8, rjmp .-2 = CFFF, rcall .-2 = DFFF.
  const words = (...w: number[]) => Uint8Array.from(w.flatMap((x) => [x & 0xff, x >> 8]));

  it.each([
    ['a tight loop with interrupts off', words(0x94f8, 0xcfff)],
    ['unbounded recursion that wraps the stack through the register file and I/O', words(0xdfff)],
    ['an empty program running through erased flash', new Uint8Array()],
  ])('%s ends at the time cap, unresolved, with a bounded trace', (_, image) => {
    const r = grade(withFirmware('blink', ihex(image), 2));
    expect(r).toMatchObject({ outcome: 'unresolved', endSlice: 2000 });
    expect(r.trace.samples).toHaveLength(21);
  });

  it('random flash images never crash the engine (seeded)', () => {
    for (let i = 0; i < 24; i++) {
      const next = rng(1000 + i);
      const image = Uint8Array.from({ length: 2048 }, () => Math.floor(next() * 256));
      const r = grade(withFirmware(i % 2 ? 'dimmer' : 'blink', ihex(image), 0.25));
      expect(r.endSlice).toBe(250);
    }
  }, 60_000);
});
