import {
  assembleCircuit,
  instantiateCircuit,
  type AssembledCircuit,
  type ComponentDefinition,
  type ComponentModel,
  type McuCore,
  type NetId,
  type PinElectrical,
  type PropValue,
  type Simulation,
  type SimulationSnapshot,
  type WorldModel,
} from '@robosim/sim-core';

export interface BenchPart {
  readonly def: ComponentDefinition;
  readonly props?: Readonly<Record<string, PropValue>>;
}

export interface BenchSpec {
  /** Part id → definition + props. */
  readonly parts: Readonly<Record<string, BenchPart>>;
  /** Wires between terminals written `part.pin` (MCU pins: `mcu.D13`). */
  readonly wires?: readonly (readonly [string, string])[];
  /** Terminals tied to ground. */
  readonly ground?: readonly string[];
  readonly mcu?: {
    readonly core: McuCore;
    readonly electrical: PinElectrical;
    readonly pins: readonly string[];
  };
  readonly world?: WorldModel;
  readonly seed?: number;
}

export interface Bench {
  readonly sim: Simulation;
  readonly models: Readonly<Record<string, ComponentModel>>;
  readonly circuit: AssembledCircuit;
  net(terminal: string): NetId;
  volts(terminal: string): number;
  state<T>(partId: string): T;
  input(partId: string, name: string, value: number | boolean): void;
  run(seconds: number): SimulationSnapshot;
}

/**
 * Test bench for component packages: builds the netlist from `part.pin` wiring, instantiates models
 * from their definitions with manifest defaults, and runs the real scheduler.
 */
export function bench(spec: BenchSpec): Bench {
  const circuit = assembleCircuit({
    parts: spec.parts,
    wires: spec.wires ?? [],
    ground: spec.ground ?? [],
    mcuPins: spec.mcu?.pins ?? [],
  });
  const sim = instantiateCircuit(circuit, {
    seed: spec.seed ?? 1,
    ...(spec.world ? { world: spec.world } : {}),
    ...(spec.mcu ? { mcu: { core: spec.mcu.core, electrical: spec.mcu.electrical } } : {}),
  });
  const models: Record<string, ComponentModel> = {};
  for (const p of circuit.parts) {
    const m = sim.model(p.id);
    if (m) models[p.id] = m;
  }
  return {
    sim,
    models,
    circuit,
    net: (t) => circuit.netOf(t),
    volts: (t) => sim.currentSolution.voltage(circuit.netOf(t)),
    state: <T>(id: string) => {
      const model = models[id];
      if (!model) throw new Error(`Unknown part '${id}'`);
      return model.snapshot() as T;
    },
    input: (id, name, value) => sim.input(id, name, value),
    run: (seconds) => {
      sim.run(Math.round(seconds * 1000));
      return sim.snapshot();
    },
  };
}
