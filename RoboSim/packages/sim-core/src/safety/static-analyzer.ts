import { instantiateCircuit, type AssembledCircuit } from '../circuit.js';
import type {
  Level,
  McuCore,
  NetId,
  PinDrive,
  PinId,
  PinOutput,
  UartPort,
  Unsubscribe,
} from '../contracts.js';
import type {
  BoardInfo,
  CodeFacts,
  Finding,
  StaticContext,
  StaticProbe,
  StaticRule,
  TransitionProbe,
} from './types.js';
import type { Fault } from '../contracts.js';

/** Slices to let state-dependent models (regulators, batteries) settle before reading the operating point. */
const SETTLE_SLICES = 20;
/** Transition probe: time to establish currents before the switch, and the window watched after it. */
const BEFORE_SWITCH_SLICES = 30;
const AFTER_SWITCH_SLICES = 5;

/** MCU stand-in with fixed pin outputs: no firmware, exact and instantaneous. */
class FixedCore implements McuCore {
  readonly clockHz = 16_000_000;
  cycle = 0;
  constructor(private outputs: ReadonlyMap<PinId, PinOutput>) {}
  /** Changes one output; the simulation picks it up at the next slice. */
  set(pin: PinId, out: PinOutput): void {
    this.outputs = new Map(this.outputs).set(pin, out);
  }
  run(untilCycle: number): void {
    this.cycle = untilCycle;
  }
  scheduleInput(_pin: PinId, _drive: PinDrive, _atCycle: number): void {}
  pinOutputs(): ReadonlyMap<PinId, PinOutput> {
    return this.outputs;
  }
  onPinEdge(): Unsubscribe {
    return () => undefined;
  }
  uart(): UartPort {
    return { write: () => undefined, baud: () => 0, onData: () => () => undefined };
  }
  reset(): void {
    this.cycle = 0;
  }
}

function probe(
  circuit: AssembledCircuit,
  board: BoardInfo | null,
  outputs: ReadonlyMap<PinId, PinOutput>,
): StaticProbe {
  // DC operating points: a capacitor is open, as it is once charged, so it neither shorts a supply nor
  // hides a reversed electrolytic behind its charging current.
  const sim = instantiateCircuit(circuit, {
    dcOnly: true,
    ...(board ? { mcu: { core: new FixedCore(outputs), electrical: board.electrical } } : {}),
  });
  sim.run(SETTLE_SLICES);
  const solution = sim.currentSolution;
  return {
    solution,
    volts: (net: NetId) => solution.voltage(net),
    pinCurrentMa: (pin: string) => (sim.mcuBus?.pinCurrent(solution, pin) ?? 0) * 1000,
    faults: sim.snapshot().faults,
    netResistance: (net: NetId) => sim.netResistance(net),
  };
}

/** Time-integrated probe: `pin` at `from` until settled, then `to`; records the window after the switch. */
function transitionProbe(
  circuit: AssembledCircuit,
  board: BoardInfo,
  inputs: ReadonlyMap<PinId, PinOutput>,
  pin: string,
  from: Level,
  to: Level,
): TransitionProbe {
  const core = new FixedCore(new Map(inputs).set(pin, { mode: 'output', level: from }));
  const sim = instantiateCircuit(circuit, { mcu: { core, electrical: board.electrical } });
  sim.run(BEFORE_SWITCH_SLICES);
  core.set(pin, { mode: 'output', level: to });
  const lo = new Float64Array(circuit.netCount + 1).fill(Infinity);
  const hi = new Float64Array(circuit.netCount + 1).fill(-Infinity);
  const faults = new Map<string, Fault>();
  for (let i = 0; i < AFTER_SWITCH_SLICES; i++) {
    sim.step();
    for (let net = 1; net <= circuit.netCount; net++) {
      const env = sim.netEnvelope(net);
      lo[net] = Math.min(lo[net] ?? Infinity, env.min);
      hi[net] = Math.max(hi[net] ?? -Infinity, env.max);
    }
    for (const f of sim.snapshot().faults) faults.set(`${f.componentId}:${f.code}`, f);
  }
  return {
    peak: (net) => (net === 0 ? { min: 0, max: 0 } : { min: lo[net] ?? 0, max: hi[net] ?? 0 }),
    faults: [...faults.values()],
  };
}

/**
 * Static safety analysis (FR-SAF-01): instead of guessing from topology, it solves the circuit with
 * fresh models — at power-on (all MCU pins high-Z) and, on demand, with one pin driven HIGH or LOW —
 * and lets rules read voltages, pin currents and component faults. Probes are memoised per run.
 */
export function analyzeCircuit(
  circuit: AssembledCircuit,
  rules: readonly StaticRule[],
  board: BoardInfo | null,
  code: CodeFacts | null = null,
): Finding[] {
  const inputs = new Map<PinId, PinOutput>(
    circuit.mcuPins.map(({ pin }) => [pin, { mode: 'input', level: 0 }]),
  );
  const idle = probe(circuit, board, inputs);
  const driven = new Map<string, StaticProbe>();
  const transitions = new Map<string, TransitionProbe>();
  const ctx: StaticContext = {
    circuit,
    board,
    code,
    idle,
    drive(pin: string, level: Level): StaticProbe {
      const key = `${pin}:${level}`;
      let p = driven.get(key);
      if (!p) {
        const outputs = new Map(inputs);
        outputs.set(pin, { mode: 'output', level });
        p = probe(circuit, board, outputs);
        driven.set(key, p);
      }
      return p;
    },
    transition(pin: string, from: Level, to: Level): TransitionProbe {
      if (!board) throw new Error('transition probes need a board');
      const key = `${pin}:${from}>${to}`;
      let p = transitions.get(key);
      if (!p) {
        p = transitionProbe(circuit, board, inputs, pin, from, to);
        transitions.set(key, p);
      }
      return p;
    },
  };
  return sortFindings(rules.flatMap((r) => r.check(ctx).map((f) => ({ ...f, kind: 'static' as const }))));
}

export function sortFindings<T extends Finding>(findings: readonly T[]): T[] {
  return [...findings].sort(
    (a, b) =>
      (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1) ||
      a.ruleId.localeCompare(b.ruleId) ||
      a.componentIds.join().localeCompare(b.componentIds.join()) ||
      a.pinIds.join().localeCompare(b.pinIds.join()),
  );
}

/** DMM test current (A), as on a real meter's 2 kΩ range: diodes partly conduct as they do there. */
export const OHMMETER_TEST_A = 1e-3;
/** Above this the meter reads "OL" (Ω). */
export const OHMMETER_OL_OHMS = 40e6;

/** What the user set and broke during a run, re-applied to the ohmmeter's fresh instance. */
export interface OhmmeterState {
  /** Latest value per component input (pot position, switch state…). */
  readonly inputs?: readonly {
    readonly componentId: string;
    readonly name: string;
    readonly value: number | boolean;
  }[];
  /** Components damaged in the run. */
  readonly damaged?: readonly string[];
}

/**
 * Resistance meter on a fresh static instance (FR-SIM-13 Ω mode, ADR-026): the live run is never
 * touched. Power is off (parts with the `source` trait — batteries, board rails — are removed, MCU pins
 * high-Z), inputs and damage are applied, and a 1 mA test current reads R = ΔV / 1 mA. Returns a
 * reusable reader: each call costs one re-stamp and two solves. `null` = OL (open / above 40 MΩ).
 */
export function ohmmeterInstance(
  circuit: AssembledCircuit,
  state: OhmmeterState = {},
): (a: NetId, b: NetId) => number | null {
  const powered: AssembledCircuit = {
    ...circuit,
    parts: circuit.parts.filter((p) => !(p.def.manifest.traits ?? []).includes('source')),
  };
  const sim = instantiateCircuit(powered, { dcOnly: true });
  const present = new Set(powered.parts.map((p) => p.id));
  for (const i of state.inputs ?? [])
    if (present.has(i.componentId)) sim.input(i.componentId, i.name, i.value);
  for (const id of state.damaged ?? [])
    if (present.has(id)) sim.damageComponent(id, 'damaged during the run');
  return (a, b) => {
    if (a === b) return 0;
    const ohms = sim.testCurrentResponse(a, b, OHMMETER_TEST_A) / OHMMETER_TEST_A;
    return Number.isFinite(ohms) && Math.abs(ohms) <= OHMMETER_OL_OHMS ? ohms : null;
  };
}

/** One-shot {@link ohmmeterInstance} reading between nets `a` and `b`. */
export function ohmmeter(circuit: AssembledCircuit, state: OhmmeterState, a: NetId, b: NetId): number | null {
  return ohmmeterInstance(circuit, state)(a, b);
}
