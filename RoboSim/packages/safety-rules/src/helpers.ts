import type { AssembledCircuit, AssembledPart, NetId } from '@robosim/sim-core';

export interface NetUser {
  readonly partId: string | null; // null = MCU pin
  readonly pin: string;
}

/** Every terminal on every net, MCU pins included. */
export function netUsers(circuit: AssembledCircuit): Map<NetId, NetUser[]> {
  const users = new Map<NetId, NetUser[]>();
  const add = (net: NetId, u: NetUser): void => {
    users.set(net, [...(users.get(net) ?? []), u]);
  };
  for (const p of circuit.parts)
    for (const [pin, net] of Object.entries(p.pins)) add(net, { partId: p.id, pin });
  for (const m of circuit.mcuPins) add(m.net, { partId: null, pin: m.pin });
  return users;
}

/** MCU pins that are wired to something other than themselves. */
export function wiredMcuPins(circuit: AssembledCircuit): { pin: string; net: NetId }[] {
  const users = netUsers(circuit);
  return circuit.mcuPins.filter((m) => (users.get(m.net)?.length ?? 0) > 1 || m.net === 0);
}

/**
 * Wired MCU pins that firmware could plausibly drive as outputs. A pin sharing a net with a part's
 * `output` pin (a sensor output, a comparator) is an input by design — driving it would fight that
 * output — so worst-case drive probes skip it until code analysis knows the real pin modes (FR-SAF-03).
 */
export function drivableMcuPins(circuit: AssembledCircuit): { pin: string; net: NetId }[] {
  const outputNets = new Set<NetId>();
  for (const p of circuit.parts) {
    for (const pin of p.def.manifest.pins) if (pin.kind === 'output') outputNets.add(p.pins[pin.name] ?? -1);
  }
  return wiredMcuPins(circuit).filter((m) => !outputNets.has(m.net));
}

/** Enabled supply outputs (battery +, regulator out with its jumper fitted). */
export function supplies(
  circuit: AssembledCircuit,
): { part: AssembledPart; pin: string; net: NetId; maxCurrentMa: number }[] {
  const out: { part: AssembledPart; pin: string; net: NetId; maxCurrentMa: number }[] = [];
  for (const part of circuit.parts) {
    for (const sp of part.def.manifest.supplyPins ?? []) {
      if (sp.enabledByProp && part.props[sp.enabledByProp] !== true) continue;
      const net = part.pins[sp.pin];
      if (net !== undefined) out.push({ part, pin: sp.pin, net, maxCurrentMa: sp.maxCurrentMa });
    }
  }
  return out;
}

/** The part's ground-kind pin (negative terminal), if any. */
export function groundPin(part: AssembledPart): string | undefined {
  return part.def.manifest.polarity?.[1] ?? part.def.manifest.pins.find((p) => p.kind === 'ground')?.name;
}

export const hasTrait = (part: AssembledPart, trait: string): boolean =>
  (part.def.manifest.traits as readonly string[] | undefined)?.includes(trait) ?? false;

export const round = (v: number, digits = 1): number => Math.round(v * 10 ** digits) / 10 ** digits;
