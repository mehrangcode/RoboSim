import { describe, expect, it } from 'vitest';
import { ConditionTree, computeScore, type TickState } from './evaluate.js';
import { isSafePattern, validateChallenge, type ConditionSpec } from './spec.js';

const ARENA = {
  zones: [
    { id: 'start', kind: 'start' },
    { id: 'a', kind: 'checkpoint' },
    { id: 'b', kind: 'checkpoint' },
    { id: 'goal', kind: 'goal' },
  ],
};

interface Tick {
  t: number;
  zone?: string;
  collisions?: number;
  onLine?: number;
  serial?: string;
  pin?: 0 | 1;
  objectIn?: boolean;
}

/** Feeds a scripted run into a compiled tree; returns status after each tick. */
function run(spec: ConditionSpec, ticks: readonly Tick[], finish = false) {
  const tree = new ConditionTree(spec, ARENA);
  const trace: string[] = [];
  let version = 0;
  for (const k of ticks) {
    const s: TickState = {
      simTime: k.t,
      robot: { x: 0, y: 0 },
      inZone: (id) => id === k.zone,
      objectInZone: () => k.objectIn ?? true,
      collisions: k.collisions ?? 0,
      onLineRatio: k.onLine ?? 1,
      serialTail: k.serial ?? '',
      serialVersion: k.serial ? ++version : version,
      pinLevel: () => k.pin ?? null,
    };
    tree.update(s);
    trace.push(`${tree.status}${tree.final ? '!' : ''}`);
  }
  if (finish) {
    tree.finish();
    trace.push(`${tree.status}${tree.final ? '!' : ''}`);
  }
  return { tree, trace, last: trace.at(-1) };
}

describe('condition tree', () => {
  it('reachZone latches once the robot enters the zone', () => {
    expect(
      run({ type: 'reachZone', zone: 'goal' }, [{ t: 1 }, { t: 2, zone: 'goal' }, { t: 3 }]).trace,
    ).toEqual(['pending', 'met!', 'met!']);
  });

  it('a lap needs every checkpoint in order, then the start zone', () => {
    const lap: ConditionSpec = { type: 'laps', count: 1 };
    expect(
      run(lap, [
        { t: 0, zone: 'start' },
        { t: 1, zone: 'b' },
        { t: 2, zone: 'start' },
      ]).last,
    ).toBe('pending'); // skipped a
    const ok = run(lap, [
      { t: 0, zone: 'start' },
      { t: 1, zone: 'a' },
      { t: 2, zone: 'b' },
      { t: 3, zone: 'start' },
    ]);
    expect(ok.last).toBe('met!');
    expect(ok.tree.view().params).toMatchObject({ laps: 1, count: 1 });
  });

  it('US-ARN-08: "1 lap in < 60 s" succeeds inside the limit and fails after it', () => {
    const spec: ConditionSpec = {
      all: [
        { type: 'laps', count: 1 },
        { type: 'timeLimit', seconds: 60 },
      ],
    };
    const lap = (t0: number) => [
      { t: t0, zone: 'a' },
      { t: t0 + 1, zone: 'b' },
      { t: t0 + 2, zone: 'start' },
    ];
    expect(run(spec, lap(10)).last).toBe('met!');
    expect(run(spec, [{ t: 30 }, { t: 61 }]).last).toBe('failed!');
    expect(run(spec, lap(59)).last).toBe('failed!'); // completed at 61 s
  });

  it('noCollision fails as soon as the tolerance is exceeded', () => {
    const spec: ConditionSpec = {
      all: [
        { type: 'reachZone', zone: 'goal' },
        { type: 'noCollision', tolerance: 1 },
      ],
    };
    expect(
      run(spec, [
        { t: 1, collisions: 1 },
        { t: 2, collisions: 1, zone: 'goal' },
      ]).last,
    ).toBe('met!');
    expect(run(spec, [{ t: 1, collisions: 2 }]).last).toBe('failed!');
  });

  it('onLineRatio is provisional and judged when the goals are met', () => {
    const spec: ConditionSpec = {
      all: [
        { type: 'reachZone', zone: 'goal' },
        { type: 'onLineRatio', min: 0.85 },
      ],
    };
    // dips below during the run, but recovered by the time the goal is reached
    expect(
      run(spec, [
        { t: 1, onLine: 0.5 },
        { t: 2, onLine: 0.9, zone: 'goal' },
      ]).trace,
    ).toEqual(['pending', 'met!']);
    expect(
      run(spec, [
        { t: 1, onLine: 0.9 },
        { t: 2, onLine: 0.8, zone: 'goal' },
      ]).last,
    ).toBe('failed!');
  });

  it('any / not combine outcomes', () => {
    const any: ConditionSpec = {
      any: [
        { type: 'reachZone', zone: 'goal' },
        { type: 'reachZone', zone: 'a' },
      ],
    };
    expect(run(any, [{ t: 1, zone: 'a' }]).last).toBe('met!');
    const not: ConditionSpec = { not: { type: 'reachZone', zone: 'goal' } };
    expect(run(not, [{ t: 1, zone: 'goal' }]).last).toBe('failed!');
    expect(run(not, [{ t: 1 }], true).last).toBe('met!'); // never entered by the end of the run
  });

  it('serialMatches, pinState and pushOut goals', () => {
    expect(
      run({ type: 'serialMatches', pattern: 'distance=\\d+' }, [
        { t: 1, serial: 'boot\n' },
        { t: 2, serial: 'boot\ndistance=42\n' },
      ]).last,
    ).toBe('met!');
    const pin: ConditionSpec = { type: 'pinState', pin: 'D13', level: 1, forS: 0.5 };
    expect(
      run(pin, [
        { t: 1, pin: 1 },
        { t: 1.2, pin: 0 },
        { t: 1.3, pin: 1 },
        { t: 1.7, pin: 1 },
      ]).last,
    ).toBe('pending');
    expect(
      run(pin, [
        { t: 1, pin: 1 },
        { t: 1.5, pin: 1 },
      ]).last,
    ).toBe('met!');
    expect(
      run({ type: 'pushOut', object: 'can', zone: 'goal' }, [
        { t: 1, objectIn: true },
        { t: 2, objectIn: false },
      ]).last,
    ).toBe('met!');
  });

  it('stayInZone holds while the robot is inside and latches failed when it leaves', () => {
    const sumo: ConditionSpec = {
      all: [
        { type: 'pushOut', object: 'can', zone: 'goal' },
        { type: 'stayInZone', zone: 'goal' },
      ],
    };
    expect(
      run(sumo, [
        { t: 1, zone: 'goal', objectIn: true },
        { t: 2, zone: 'goal', objectIn: false },
      ]).trace,
    ).toEqual(['pending', 'met!']);
    expect(
      run(sumo, [
        { t: 1, zone: 'goal' },
        { t: 2 }, // robot left the ring
        { t: 3, zone: 'goal', objectIn: false },
      ]).trace,
    ).toEqual(['pending', 'failed!', 'failed!']);
    expect(run({ type: 'stayInZone', zone: 'goal' }, [{ t: 1, zone: 'goal' }], true).last).toBe('met!');
    expect(
      validateChallenge(
        { id: 'x', condition: { type: 'stayInZone', zone: 'ring' } },
        { ...ARENA, objects: [] },
      ),
    ).toEqual(["condition: unknown zone 'ring'"]);
  });

  it('finish() fails pending goals at the end of a graded run', () => {
    expect(run({ type: 'reachZone', zone: 'goal' }, [{ t: 1 }], true).last).toBe('failed!');
  });
});

describe('score', () => {
  const m = {
    lapsDone: 1,
    lapsRequired: 1,
    checkpointsPassed: 2,
    checkpointsTotal: 2,
    timeLimitS: 60,
    collisions: 0,
    collisionTolerance: 0,
    onLineRatio: 0.9,
  };
  const terms = [
    { type: 'laps', weight: 60 },
    { type: 'timeBonus', under: 45, weight: 25 },
    { type: 'onLineRatio', weight: 15 },
  ] as const;

  it('adds weighted fractions (Technical Design §5.7 example)', () => {
    expect(computeScore(terms, m, true, 40).total).toBe(60 + 25 + 13.5);
    expect(computeScore(terms, m, true, 52.5).lines[1]?.fraction).toBeCloseTo(0.5, 12); // halfway 45 → 60 s
    expect(computeScore(terms, { ...m, lapsDone: 0 }, false, 60).total).toBe(13.5); // no time bonus without success
  });
});

describe('validation', () => {
  it('rejects unknown zones, bad numbers and unsafe regexes', () => {
    const errors = validateChallenge(
      {
        id: 'x',
        condition: {
          all: [
            { type: 'reachZone', zone: 'nowhere' },
            { type: 'timeLimit', seconds: 0 },
            { type: 'serialMatches', pattern: '(a+)+$' },
            { type: 'onLineRatio', min: 2 },
          ],
        },
      },
      { zones: ARENA.zones, objects: [] },
    );
    expect(errors).toHaveLength(4);
  });

  it('flags catastrophic-backtracking shapes but accepts ordinary patterns', () => {
    expect(isSafePattern('(a+)+$')).toBe(false);
    expect(isSafePattern('(\\d*)*x')).toBe(false);
    expect(isSafePattern('distance=\\d+ cm')).toBe(true);
    expect(isSafePattern('x'.repeat(201))).toBe(false);
  });
});
