import {
  Simulation,
  buildNetlist,
  resolveProps,
  type ComponentDefinition,
  type ComponentInstance,
  type ComponentModel,
  type McuCore,
  type NetId,
  type PinElectrical,
  type PropValue,
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
  const toNl = (t: string): string => {
    const dot = t.indexOf('.');
    if (dot < 0) throw new Error(`Terminal '${t}' must be written 'part.pin'`);
    return `${t.slice(0, dot)}:${t.slice(dot + 1)}`;
  };
  const terminals: string[] = [];
  for (const [id, part] of Object.entries(spec.parts)) {
    for (const pin of part.def.manifest.pins) terminals.push(`${id}:${pin.name}`);
  }
  for (const pin of spec.mcu?.pins ?? []) terminals.push(`mcu:${pin}`);
  const internal = Object.entries(spec.parts).flatMap(([id, part]) =>
    (part.def.internalConnections?.() ?? []).map(([a, b]) => [`${id}:${a}`, `${id}:${b}`] as const),
  );
  const netlist = buildNetlist({
    terminals,
    connections: [...internal, ...(spec.wires ?? []).map(([a, b]) => [toNl(a), toNl(b)] as const)],
    ground: (spec.ground ?? []).map(toNl),
  });

  const models: Record<string, ComponentModel> = {};
  const components: ComponentInstance[] = Object.entries(spec.parts).map(([id, part]) => {
    const model = part.def.create();
    models[id] = model;
    const pins = Object.fromEntries(
      part.def.manifest.pins.map((p) => [p.name, netlist.netOf(`${id}:${p.name}`)]),
    );
    return { id, model, pins, props: resolveProps(part.def.manifest, part.props) };
  });

  const sim = new Simulation({
    netCount: netlist.netCount,
    seed: spec.seed ?? 1,
    components,
    ...(spec.world ? { world: spec.world } : {}),
    ...(spec.mcu
      ? {
          mcu: {
            core: spec.mcu.core,
            electrical: spec.mcu.electrical,
            pins: spec.mcu.pins.map((pin) => ({ pin, net: netlist.netOf(`mcu:${pin}`) })),
          },
        }
      : {}),
  });

  return {
    sim,
    models,
    net: (t) => netlist.netOf(toNl(t)),
    volts: (t) => sim.currentSolution.voltage(netlist.netOf(toNl(t))),
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
