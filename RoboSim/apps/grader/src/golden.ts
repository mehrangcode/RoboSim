import {
  ENGINE_VERSION,
  builtinSource,
  type GradeJob,
  type GradeResult,
  type InputLogEntry,
  type ScenarioId,
} from '@robosim/sim-runtime';

/*
 * Golden traces (Engineering Guide §6): fixture jobs whose verified-run results are committed.
 * Any change to them is a behaviour change of the engine and needs an `engineVersion` bump.
 */

export interface GoldenFixture {
  readonly name: string;
  readonly scenario: ScenarioId;
  readonly maxSimSeconds: number;
  readonly entries: readonly InputLogEntry[];
}

const input = (slice: number, componentId: string, name: string, value: number | boolean): InputLogEntry => ({
  slice,
  kind: 'component',
  componentId,
  name,
  value,
});

export const GOLDEN_FIXTURES: readonly GoldenFixture[] = [
  { name: 'line-follower-lap', scenario: 'line-follower', maxSimSeconds: 60, entries: [] },
  { name: 'blink', scenario: 'blink', maxSimSeconds: 2.5, entries: [] },
  {
    name: 'button-presses',
    scenario: 'button',
    maxSimSeconds: 1.5,
    entries: [
      input(300, 'btn', 'pressed', true),
      input(800, 'btn', 'pressed', false),
      input(1200, 'btn', 'pressed', true),
      input(1210, 'btn', 'pressed', false),
    ],
  },
  {
    name: 'dimmer-knob',
    scenario: 'dimmer',
    maxSimSeconds: 1.5,
    entries: [
      input(200, 'pot', 'position', 0.25),
      input(700, 'pot', 'position', 0.75),
      input(1100, 'pot', 'position', 1),
    ],
  },
  {
    name: 'servo-sweep',
    scenario: 'servo',
    maxSimSeconds: 2,
    entries: [input(100, 'pot', 'position', 0), input(900, 'pot', 'position', 1)],
  },
  {
    name: 'serial-echo',
    scenario: 'serial',
    maxSimSeconds: 3,
    entries: [
      { slice: 1500, kind: 'serial', text: 'hello' },
      { slice: 2100, kind: 'serial', text: 'Ok' },
    ],
  },
  { name: 'motor-on-pin', scenario: 'motor-on-pin', maxSimSeconds: 1, entries: [] },
  { name: 'outputs-fighting', scenario: 'outputs-fighting', maxSimSeconds: 1, entries: [] },
];

/** The fixture as a self-contained job (project + firmware frozen into the committed job file). */
export function fixtureJob(f: GoldenFixture): GradeJob {
  return {
    log: {
      engineVersion: ENGINE_VERSION,
      scenario: f.scenario,
      ...builtinSource(f.scenario),
      seed: 1,
      entries: f.entries,
    },
    maxSimSeconds: f.maxSimSeconds,
  };
}

/** Readable, diff-friendly JSON: one trace sample per line. */
export function formatResult(r: GradeResult): string {
  const { trace, ...rest } = r;
  const field = (k: string, v: unknown) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`;
  return [
    '{',
    ...Object.entries(rest).map(([k, v]) => field(k, v)),
    '  "trace": {',
    `    "intervalSlices": ${trace.intervalSlices},`,
    `    "serial": ${JSON.stringify(trace.serial)},`,
    `    "findings": ${JSON.stringify(trace.findings)},`,
    '    "samples": [',
    trace.samples.map((s) => `      ${JSON.stringify(s)}`).join(',\n'),
    '    ]',
    '  }',
    '}',
    '',
  ].join('\n');
}

/**
 * Where two results first differ, or null when they are bit-identical (JSON numbers round-trip
 * doubles exactly). Samples are compared in order, so the answer names the first diverging slice.
 */
export function firstDifference(expected: GradeResult, actual: GradeResult): string | null {
  const { trace: et, ...e } = expected;
  const { trace: at, ...a } = actual;
  for (const [i, s] of et.samples.entries()) {
    const b = at.samples[i];
    if (JSON.stringify(s) !== JSON.stringify(b))
      return `trace sample ${i} (slice ${s.slice}): expected ${JSON.stringify(s)}, got ${JSON.stringify(b)}`;
  }
  if (at.samples.length !== et.samples.length)
    return `trace has ${at.samples.length} samples, expected ${et.samples.length}`;
  for (const key of ['serial', 'findings', 'intervalSlices'] as const)
    if (JSON.stringify(et[key]) !== JSON.stringify(at[key])) return `trace.${key} differs`;
  for (const key of new Set([...Object.keys(e), ...Object.keys(a)]) as Set<keyof typeof e>)
    if (JSON.stringify(e[key]) !== JSON.stringify(a[key]))
      return `${key}: expected ${JSON.stringify(e[key])}, got ${JSON.stringify(a[key])}`;
  return null;
}
