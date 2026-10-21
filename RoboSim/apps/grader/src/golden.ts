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

/** A press held for `holdSlices`, then released. */
const press = (slice: number, componentId: string, name = 'pressed', holdSlices = 60): InputLogEntry[] => [
  input(slice, componentId, name, true),
  input(slice + holdSlices, componentId, name, false),
];

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
  { name: 'led-no-resistor', scenario: 'led-no-resistor', maxSimSeconds: 0.5, entries: [] },
  { name: 'floating-input', scenario: 'floating-input', maxSimSeconds: 0.5, entries: [] },
  { name: 'no-flyback', scenario: 'no-flyback', maxSimSeconds: 0.3, entries: [] },
  // Robots that decide their challenge (obstacle course goal, maze goal, sumo push-out).
  { name: 'bump-avoider', scenario: 'bump-avoider', maxSimSeconds: 60, entries: [] },
  { name: 'laser-avoider', scenario: 'laser-avoider', maxSimSeconds: 60, entries: [] },
  { name: 'maze-solver', scenario: 'maze-solver', maxSimSeconds: 60, entries: [] },
  { name: 'sumo-bot', scenario: 'sumo-bot', maxSimSeconds: 30, entries: [] },
  // Catalogue Tier A demos.
  {
    name: 'rgb-melody',
    scenario: 'rgb-melody',
    maxSimSeconds: 1.5,
    entries: [
      input(0, 'pot', 'position', 0),
      input(300, 'pot', 'position', 0.5),
      input(600, 'btn', 'pressed', true),
      input(1200, 'btn', 'pressed', false),
    ],
  },
  {
    name: 'relay-counter',
    scenario: 'relay-counter',
    maxSimSeconds: 0.8,
    entries: [...press(200, 'btn'), ...press(400, 'btn')],
  },
  {
    name: 'half-adder',
    scenario: 'half-adder',
    maxSimSeconds: 0.4,
    entries: [input(100, 'btnA', 'pressed', true), input(200, 'btnB', 'pressed', true)],
  },
  { name: 'led-bar', scenario: 'led-bar', maxSimSeconds: 0.5, entries: [input(0, 'pot', 'position', 1)] },
  {
    name: 'stepper-knob',
    scenario: 'stepper-knob',
    maxSimSeconds: 2.5,
    entries: [input(0, 'pot', 'position', 0.75)],
  },
  { name: 'motor-driver', scenario: 'motor-driver', maxSimSeconds: 2, entries: [] },
  {
    name: 'keypad-lock',
    scenario: 'keypad-lock',
    maxSimSeconds: 1.2,
    entries: ['9', 'Hash', '1', '2', '3', '4', 'Hash'].flatMap((k, i) =>
      press(50 + 160 * i, 'keys', `key${k}`, 80),
    ),
  },
  {
    name: 'input-devices',
    scenario: 'input-devices',
    maxSimSeconds: 0.4,
    entries: [
      input(50, 'enc', 'detents', 3),
      input(150, 'enc', 'detents', 1),
      input(250, 'joy', 'x', 1),
      input(250, 'joy', 'pressed', true),
    ],
  },
  // Catalogue Tier B demos (reactive elements, transistors).
  { name: 'timer-555', scenario: 'timer-555', maxSimSeconds: 4, entries: [] },
  { name: 'rc-charge', scenario: 'rc-charge', maxSimSeconds: 5, entries: [] },
  {
    name: 'transistor-motor',
    scenario: 'transistor-motor',
    maxSimSeconds: 2.4,
    entries: [
      input(0, 'pot', 'position', 0),
      input(800, 'pot', 'position', 0.6),
      input(1600, 'pot', 'position', 1),
    ],
  },
  { name: 'mosfet-ramp', scenario: 'mosfet-ramp', maxSimSeconds: 6, entries: [] },
  // Catalogue Tier C demos (I²C, SPI, single-wire buses).
  {
    name: 'oled-knob',
    scenario: 'oled-knob',
    maxSimSeconds: 0.9,
    entries: [input(0, 'pot', 'position', 0), input(600, 'pot', 'position', 1)],
  },
  { name: 'lcd-hello', scenario: 'lcd-hello', maxSimSeconds: 2.6, entries: [] },
  { name: 'imu-tilt', scenario: 'imu-tilt', maxSimSeconds: 2.4, entries: [input(1200, 'imu', 'tiltX', 35)] },
  {
    name: 'weather-station',
    scenario: 'weather-station',
    maxSimSeconds: 4.5,
    entries: [input(0, 'bmp', 'temperatureC', 26.5), input(0, 'bmp', 'altitudeM', 500)],
  },
  {
    name: 'thermometers',
    scenario: 'thermometers',
    maxSimSeconds: 5,
    entries: [
      input(0, 'dht', 'temperatureC', 28),
      input(0, 'dht', 'humidity', 40),
      input(0, 'ds', 'temperatureC', 19.25),
    ],
  },
  {
    name: 'neopixel-rainbow',
    scenario: 'neopixel-rainbow',
    maxSimSeconds: 0.8,
    entries: [input(0, 'pot', 'position', 0), input(500, 'pot', 'position', 0.9)],
  },
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
