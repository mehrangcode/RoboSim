import type { ComponentDefinition, McuCore, NetId, PinElectrical, WorldModel } from './contracts.js';
import { resolveProps, type PropValue } from './manifest.js';
import { buildNetlist } from './netlist.js';
import { Simulation, type ComponentInstance } from './scheduler.js';

export interface CircuitPartSpec {
  readonly def: ComponentDefinition;
  readonly props?: Readonly<Record<string, PropValue>>;
}

/** A project's circuit: parts, wires written `part.pin` (MCU pins as `mcu.D13`), ground terminals. */
export interface CircuitSpec {
  readonly parts: Readonly<Record<string, CircuitPartSpec>>;
  readonly wires?: readonly (readonly [string, string])[];
  readonly ground?: readonly string[];
  /** MCU pins that appear in the wiring. */
  readonly mcuPins?: readonly string[];
}

export interface AssembledPart {
  readonly id: string;
  readonly def: ComponentDefinition;
  /** Manifest defaults merged with the given props, validated. */
  readonly props: Readonly<Record<string, PropValue>>;
  /** Pin name → net. */
  readonly pins: Readonly<Record<string, NetId>>;
}

/** Topology of a circuit, independent of any running simulation (shared by the engine and safety analysis). */
export interface AssembledCircuit {
  readonly netCount: number;
  readonly parts: readonly AssembledPart[];
  readonly mcuPins: readonly { readonly pin: string; readonly net: NetId }[];
  netOf(terminal: string): NetId;
}

const toNetlistTerminal = (t: string): string => {
  const dot = t.indexOf('.');
  if (dot < 0) throw new Error(`Terminal '${t}' must be written 'part.pin'`);
  return `${t.slice(0, dot)}:${t.slice(dot + 1)}`;
};

/** Builds the netlist (wires + internal part conductors) and resolves every part's props and pin nets. */
export function assembleCircuit(spec: CircuitSpec): AssembledCircuit {
  const terminals: string[] = [];
  const internal: (readonly [string, string])[] = [];
  for (const [id, part] of Object.entries(spec.parts)) {
    for (const pin of part.def.manifest.pins) terminals.push(`${id}:${pin.name}`);
    for (const [a, b] of [
      ...(part.def.internalConnections?.() ?? []),
      ...(part.def.manifest.bondedPins ?? []),
    ])
      internal.push([`${id}:${a}`, `${id}:${b}`]);
  }
  for (const pin of spec.mcuPins ?? []) terminals.push(`mcu:${pin}`);
  const netlist = buildNetlist({
    terminals,
    connections: [
      ...internal,
      ...(spec.wires ?? []).map(([a, b]) => [toNetlistTerminal(a), toNetlistTerminal(b)] as const),
    ],
    ground: (spec.ground ?? []).map(toNetlistTerminal),
  });
  return {
    netCount: netlist.netCount,
    parts: Object.entries(spec.parts).map(([id, part]) => ({
      id,
      def: part.def,
      props: resolveProps(part.def.manifest, part.props),
      pins: Object.fromEntries(part.def.manifest.pins.map((p) => [p.name, netlist.netOf(`${id}:${p.name}`)])),
    })),
    mcuPins: (spec.mcuPins ?? []).map((pin) => ({ pin, net: netlist.netOf(`mcu:${pin}`) })),
    netOf: (t) => netlist.netOf(toNetlistTerminal(t)),
  };
}

export interface InstantiateOptions {
  readonly mcu?: { readonly core: McuCore; readonly electrical: PinElectrical };
  readonly world?: WorldModel;
  readonly seed?: number;
}

/** Creates fresh component models for an assembled circuit and wires them into a Simulation. */
export function instantiateCircuit(circuit: AssembledCircuit, options: InstantiateOptions = {}): Simulation {
  const components: ComponentInstance[] = circuit.parts.map((p) => ({
    id: p.id,
    model: p.def.create(),
    pins: p.pins,
    props: p.props,
    ...(p.def.manifest.signalPassthrough ? { signalPassthrough: p.def.manifest.signalPassthrough } : {}),
  }));
  return new Simulation({
    netCount: circuit.netCount,
    seed: options.seed ?? 1,
    components,
    ...(options.world ? { world: options.world } : {}),
    ...(options.mcu
      ? { mcu: { core: options.mcu.core, electrical: options.mcu.electrical, pins: circuit.mcuPins } }
      : {}),
  });
}
