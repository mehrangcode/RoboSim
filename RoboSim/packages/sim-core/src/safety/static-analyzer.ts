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
import type { BoardInfo, Finding, StaticContext, StaticProbe, StaticRule } from './types.js';

/** Slices to let state-dependent models (regulators, batteries) settle before reading the operating point. */
const SETTLE_SLICES = 20;

/** MCU stand-in with fixed pin outputs: no firmware, exact and instantaneous. */
class FixedCore implements McuCore {
  readonly clockHz = 16_000_000;
  cycle = 0;
  constructor(private readonly outputs: ReadonlyMap<PinId, PinOutput>) {}
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
    return { write: () => undefined, onData: () => () => undefined };
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
  const sim = instantiateCircuit(
    circuit,
    board ? { mcu: { core: new FixedCore(outputs), electrical: board.electrical } } : {},
  );
  sim.run(SETTLE_SLICES);
  const solution = sim.currentSolution;
  return {
    solution,
    volts: (net: NetId) => solution.voltage(net),
    pinCurrentMa: (pin: string) => (sim.mcuBus?.pinCurrent(solution, pin) ?? 0) * 1000,
    faults: sim.snapshot().faults,
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
): Finding[] {
  const inputs = new Map<PinId, PinOutput>(
    circuit.mcuPins.map(({ pin }) => [pin, { mode: 'input', level: 0 }]),
  );
  const idle = probe(circuit, board, inputs);
  const driven = new Map<string, StaticProbe>();
  const ctx: StaticContext = {
    circuit,
    board,
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
