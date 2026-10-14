import {
  assembleCircuit,
  instantiateCircuit,
  type AssembledCircuit,
  type CircuitSpec as CoreCircuitSpec,
  type ComponentModel,
  type McuCore,
  type NetId,
  type PinElectrical,
  type Simulation,
  type WorldModel,
} from '@robosim/sim-core';

export interface CircuitSpec extends Omit<CoreCircuitSpec, 'mcuPins'> {
  readonly mcu: {
    readonly core: McuCore;
    readonly electrical: PinElectrical;
    readonly pins: readonly string[];
  };
  readonly world?: WorldModel;
  readonly seed?: number;
}

export interface Circuit {
  readonly sim: Simulation;
  readonly assembled: AssembledCircuit;
  readonly models: Readonly<Record<string, ComponentModel>>;
  net(terminal: string): NetId;
}

/** Wires a scenario circuit into the engine (precursor of the project loader). */
export function buildCircuit(spec: CircuitSpec): Circuit {
  const assembled = assembleCircuit({ ...spec, mcuPins: spec.mcu.pins });
  const sim = instantiateCircuit(assembled, {
    mcu: { core: spec.mcu.core, electrical: spec.mcu.electrical },
    seed: spec.seed ?? 1,
    ...(spec.world ? { world: spec.world } : {}),
  });
  const models: Record<string, ComponentModel> = {};
  for (const p of assembled.parts) {
    const m = sim.model(p.id);
    if (m) models[p.id] = m;
  }
  return { sim, assembled, models, net: (t) => assembled.netOf(t) };
}
