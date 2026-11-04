#!/usr/bin/env node
// Performance budgets (Technical Design §17) against the built packages (`pnpm test:perf`), the code the
// simulation worker runs. Each figure is the median of several timed runs after a warm-up. Exits 1 when a
// budget is exceeded. ROBOSIM_PERF_SCALE scales every budget for machines slower than the reference.
import { buildNetlist, ohmmeterInstance, type NetlistInput } from '@robosim/sim-core';
import type { ProjectDocument } from '@robosim/shared';
import { initCodeAnalysis } from '@robosim/code-analysis';
import { nodeCodeAnalysisWasm } from '@robosim/code-analysis/node';
import {
  MeasureHub,
  SCENARIOS,
  ScopeRecorder,
  buildRun,
  builtinSource,
  type MeasureProbe,
  type ScenarioId,
} from '@robosim/sim-runtime';

const SCALE = Number(process.env['ROBOSIM_PERF_SCALE'] ?? 1);

await initCodeAnalysis(nodeCodeAnalysisWasm()); // loading a project runs the code-aware safety rules

const median = (samples: number[]): number =>
  [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)] ?? NaN;

function timeMs(fn: () => void): number {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

/** Average slice of a whole line-follower lap (Uno, 7 parts, physics, safety), until the challenge decides. */
function lapSliceMs(instrument: 'none' | 'meter' | 'scope' = 'none'): number {
  const run = buildRun({ scenario: 'line-follower' });
  let drain = () => {};
  if (instrument === 'scope') {
    // 4 channels (FR-SIM-14): 3 net voltages with their envelope + 1 part current, drained like the host.
    const hub = new MeasureHub(run);
    const parts = run.circuit.assembled.parts;
    const pins = parts.flatMap((p) => Object.keys(p.pins).map((pin) => ({ part: p.id, pin })));
    const rec = hub.set('scope', [
      ...pins.slice(0, 3).map((red): MeasureProbe => ({ kind: 'v', red, black: null })),
      { kind: 'i', pins: pins.slice(3, 4), scale: 1 },
    ]);
    run.circuit.sim.addObserver(hub);
    drain = () => void rec?.drain(run.circuit.sim);
  }
  if (instrument === 'meter') {
    // 8 probes of every kind (FR-SIM-13), read after every slice like the live meter.
    const hub = new MeasureHub(run);
    const parts = run.circuit.assembled.parts;
    const pins = parts.flatMap((p) => Object.keys(p.pins).map((pin) => ({ part: p.id, pin })));
    const probes: MeasureProbe[] = [
      ...pins.slice(0, 3).map((red): MeasureProbe => ({ kind: 'v', red, black: null })),
      ...pins.slice(3, 6).map((p): MeasureProbe => ({ kind: 'i', pins: [p], scale: 1 })),
      ...parts.slice(0, 2).map((p): MeasureProbe => ({ kind: 'p', part: p.id })),
    ];
    hub.set('meter', probes);
    run.circuit.sim.addObserver(hub);
  }
  let slices = 0;
  const ms = timeMs(() => {
    while (run.challenge?.result().status === 'running' && slices < 60_000) {
      run.circuit.sim.run(100);
      drain();
      slices += 100;
    }
  });
  return ms / slices;
}

/**
 * Average slice (ms) of `slices` slices of a built-in scenario with the scope on 4 channels (3 net
 * voltages + 1 current, drained every 33 slices like the host's frames), optionally in fine mode.
 */
function scopedSliceMs(id: ScenarioId, fine: boolean | 'none', slices = 2000): number {
  const run = buildRun({ scenario: id });
  const sim = run.circuit.sim;
  let drain = () => {};
  if (fine !== 'none') {
    const hub = new MeasureHub(run);
    hub.setFine(fine);
    const parts = run.circuit.assembled.parts;
    const pins = parts.flatMap((p) => Object.keys(p.pins).map((pin) => ({ part: p.id, pin })));
    const rec = hub.set('scope', [
      ...pins.slice(0, 3).map((red): MeasureProbe => ({ kind: 'v', red, black: null })),
      { kind: 'i', pins: pins.slice(0, 1), scale: 1 },
    ]);
    sim.addObserver(hub);
    drain = () => {
      rec?.drain(sim);
      if (rec instanceof ScopeRecorder) rec.drainFine(sim);
    };
  }
  sim.run(200); // power-on transients
  drain();
  const ms = timeMs(() => {
    for (let done = 0; done < slices; done += 33) {
      sim.run(33);
      drain();
    }
  });
  return ms / slices;
}

/** Real-time check (Release-Plan IT-3 exit): the slowest scenario with the scope on, in ms per slice. */
function slowestScoped(fine: boolean): { id: ScenarioId; ms: number } {
  // One pass over every scenario, then the median of 3 for the three slowest (noise picks the order).
  const first = SCENARIOS.map((id) => ({ id, ms: scopedSliceMs(id, fine, 1000) }));
  const top = first.sort((a, b) => b.ms - a.ms).slice(0, 3);
  return top
    .map(({ id }) => ({ id, ms: median([0, 1, 2].map(() => scopedSliceMs(id, fine))) }))
    .reduce((a, b) => (b.ms > a.ms ? b : a));
}

/** 100 resistor + LED pairs on the digital pins: 200 parts, 300 wires. */
function twoHundredParts(): Parameters<typeof buildRun>[0] {
  const { project, firmware } = builtinSource('blink');
  const pins = ['D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D11', 'D12', 'D13'];
  const part = (id: string, type: string, props: Record<string, unknown>) => ({
    id,
    type,
    typeVersion: '1.0.0',
    x: 0,
    y: 0,
    rotation: 0,
    flipped: false,
    props,
  });
  const wire = (id: string, from: [string, string], to: [string, string], color: string) => ({
    id,
    from: { part: from[0], pin: from[1] },
    to: { part: to[0], pin: to[1] },
    color,
    points: [],
  });
  const components = [];
  const wires = [];
  for (let i = 0; i < 100; i++) {
    components.push(
      part(`r${i}`, 'passive.resistor', { ohms: 1000 }),
      part(`l${i}`, 'actuator.led', { color: 'red' }),
    );
    wires.push(
      wire(`a${i}`, ['board', pins[i % pins.length] ?? 'D13'], [`r${i}`, 'a'], 'yellow'),
      wire(`b${i}`, [`r${i}`, 'b'], [`l${i}`, 'a'], 'yellow'),
      wire(`c${i}`, [`l${i}`, 'k'], ['board', 'GND1'], 'black'),
    );
  }
  return { project: { ...project, components, wires } as ProjectDocument, firmware };
}

function netlistInput(): NetlistInput {
  const terminals: string[] = [];
  const connections: (readonly [string, string])[] = [];
  for (let i = 0; i < 200; i++) {
    terminals.push(`p${i}.a`, `p${i}.b`);
    connections.push([`p${i}.b`, `p${(i + 1) % 200}.a`]);
  }
  return { terminals, connections, ground: ['p0.a'] };
}

const big = twoHundredParts();
const bigRun = buildRun(big);
const net = netlistInput();
const budgets = [
  {
    name: 'Simulation slice, line-follower lap average (ms)',
    budget: 0.35,
    measure: () => (lapSliceMs(), median([lapSliceMs(), lapSliceMs(), lapSliceMs()])),
  },
  {
    name: 'Meter with 8 probes, added time per slice on the lap (µs)',
    budget: 5,
    measure: () => {
      lapSliceMs('meter');
      const runs = [0, 1, 2, 3, 4].map(() => (lapSliceMs('meter') - lapSliceMs()) * 1000);
      return Math.max(0, median(runs));
    },
  },
  {
    name: 'Scope with 4 channels, added time per slice on the lap (µs)',
    budget: 10,
    measure: () => {
      lapSliceMs('scope');
      const runs = [0, 1, 2, 3, 4].map(() => (lapSliceMs('scope') - lapSliceMs()) * 1000);
      return Math.max(0, median(runs));
    },
  },
  {
    // 1 ms of simulated time per slice: below 1 ms of work per slice the run keeps RTF ≥ 1×.
    name: 'Scope with 4 channels, slowest built-in scenario (ms/slice; < 1 = real time)',
    budget: 1,
    measure: () => {
      const w = slowestScoped(false);
      console.warn(`     slowest: ${w.id}`);
      return w.ms;
    },
  },
  {
    name: 'Scope with 4 channels in fine mode, slowest built-in scenario (ms/slice; < 1 = real time)',
    budget: 1,
    measure: () => {
      const w = slowestScoped(true);
      console.warn(`     slowest: ${w.id}`);
      return w.ms;
    },
  },
  {
    name: 'Scope fine mode, extra time on no-flyback (the most sub-steps) (%)',
    budget: 15,
    measure: () => {
      scopedSliceMs('no-flyback', true, 500);
      const runs = [0, 1, 2, 3, 4].map(
        () => (scopedSliceMs('no-flyback', true) / scopedSliceMs('no-flyback', false) - 1) * 100,
      );
      return Math.max(0, median(runs));
    },
  },
  {
    name: 'Ohmmeter, first reading (fresh instance) @ 200 parts (ms)',
    budget: 30,
    measure: () => {
      const { assembled, net } = bigRun.circuit;
      const read = () => ohmmeterInstance(assembled)(net('r0.a'), net('l0.k'));
      read();
      return median([0, 1, 2, 3, 4].map(() => timeMs(read)));
    },
  },
  {
    name: 'Ohmmeter, cached reading @ 200 parts (ms)',
    budget: 2,
    measure: () => {
      const { assembled, net } = bigRun.circuit;
      const read = ohmmeterInstance(assembled);
      read(net('r0.a'), net('r0.b'));
      return median([0, 1, 2, 3, 4].map((i) => timeMs(() => read(net(`r${i}.a`), net(`r${i}.b`)))));
    },
  },
  {
    name: 'Circuit build + static safety pass @ 200 parts (ms)',
    budget: 50,
    measure: () => {
      for (let i = 0; i < 3; i++) buildRun(big);
      return median([0, 1, 2, 3, 4].map(() => timeMs(() => buildRun(big))));
    },
  },
  {
    name: 'Netlist build @ 200 parts (ms)',
    budget: 16,
    measure: () => {
      for (let i = 0; i < 10; i++) buildNetlist(net);
      return median([0, 1, 2, 3, 4].map(() => timeMs(() => buildNetlist(net))));
    },
  },
];

let failed = false;
for (const b of budgets) {
  const value = b.measure();
  const limit = b.budget * SCALE;
  const ok = value < limit;
  failed ||= !ok;
  console.warn(`${ok ? 'ok  ' : 'FAIL'} ${b.name}: ${value.toFixed(3)} (budget ${limit.toFixed(3)})`);
}
process.exitCode = failed ? 1 : 0;
