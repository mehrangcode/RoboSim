#!/usr/bin/env node
// Performance budgets (Technical Design §17) against the built packages (`pnpm test:perf`), the code the
// simulation worker runs. Each figure is the median of several timed runs after a warm-up. Exits 1 when a
// budget is exceeded. ROBOSIM_PERF_SCALE scales every budget for machines slower than the reference.
import { buildNetlist, type NetlistInput } from '@robosim/sim-core';
import type { ProjectDocument } from '@robosim/shared';
import { initCodeAnalysis } from '@robosim/code-analysis';
import { nodeCodeAnalysisWasm } from '@robosim/code-analysis/node';
import { buildRun, builtinSource } from '@robosim/sim-runtime';

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
function lapSliceMs(): number {
  const run = buildRun({ scenario: 'line-follower' });
  let slices = 0;
  const ms = timeMs(() => {
    while (run.challenge?.result().status === 'running' && slices < 60_000) {
      run.circuit.sim.run(100);
      slices += 100;
    }
  });
  return ms / slices;
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
const net = netlistInput();
const budgets = [
  {
    name: 'Simulation slice, line-follower lap average (ms)',
    budget: 0.35,
    measure: () => (lapSliceMs(), median([lapSliceMs(), lapSliceMs(), lapSliceMs()])),
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
