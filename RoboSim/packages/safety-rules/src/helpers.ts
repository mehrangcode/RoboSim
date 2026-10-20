import type { AssembledCircuit, AssembledPart, CodeFacts, NetId } from '@robosim/sim-core';

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
export function drivableMcuPins(
  circuit: AssembledCircuit,
  code: CodeFacts | null = null,
): { pin: string; net: NetId }[] {
  const outputNets = new Set<NetId>();
  for (const p of circuit.parts) {
    for (const pin of p.def.manifest.pins) if (pin.kind === 'output') outputNets.add(p.pins[pin.name] ?? -1);
  }
  const outputs = code && codeIsComplete(code) ? codeOutputPins(code) : null;
  return wiredMcuPins(circuit).filter((m) => !outputNets.has(m.net) && (!outputs || outputs.has(m.pin)));
}

/** Libraries whose pin use the analysis sees (`Servo.attach`) or that only use the I²C pins. */
const KNOWN_INCLUDES = new Set(['Arduino.h', 'Servo.h', 'Wire.h', 'EEPROM.h']);

/**
 * True when the sketch names every pin it drives: no unresolved pin calls or port registers, and no
 * library that could drive pins internally (LiquidCrystal, SPI, SoftwareSerial…).
 */
export function codeIsComplete(code: CodeFacts): boolean {
  return code.unresolved.length === 0 && code.includes.every((i) => KNOWN_INCLUDES.has(i));
}

/** Pins the sketch drives as outputs: pinMode(OUTPUT), analogWrite, tone and Servo.attach set the pin to output. */
export function codeOutputPins(code: CodeFacts): Set<string> {
  return new Set(
    code.uses
      .filter((u) => u.mode === 'OUTPUT' || u.use === 'analogWrite' || u.use === 'tone' || u.use === 'servo')
      .map((u) => u.pin),
  );
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

/**
 * Union-find over nets joined inside parts (every pin of a part, or of one of its `isolationGroups`):
 * `find(a) === find(b)` when a conductive path through components links the two nets.
 */
export function circuitDomains(circuit: AssembledCircuit): (net: NetId) => NetId {
  const parent = new Map<NetId, NetId>();
  const find = (n: NetId): NetId => {
    let r = n;
    while ((parent.get(r) ?? r) !== r) r = parent.get(r) as NetId;
    return r;
  };
  for (const part of circuit.parts) {
    const groups = part.def.manifest.isolationGroups ?? [part.def.manifest.pins.map((p) => p.name)];
    for (const group of groups) {
      const nets = group.map((pin) => part.pins[pin]).filter((n): n is NetId => n !== undefined);
      const [first, ...rest] = nets;
      if (first === undefined) continue;
      for (const n of rest) {
        const a = find(first);
        const b = find(n);
        if (a !== b) parent.set(b, a);
      }
    }
  }
  return find;
}

/**
 * Nets joined through `signalPassthrough` pins (series resistors), never through ground: a pin's
 * signal reaches every net of its group, e.g. a transistor base behind its base resistor.
 */
export function signalGroups(circuit: AssembledCircuit): (net: NetId) => NetId {
  const parent = new Map<NetId, NetId>();
  const find = (n: NetId): NetId => {
    let r = n;
    while ((parent.get(r) ?? r) !== r) r = parent.get(r) as NetId;
    return r;
  };
  for (const part of circuit.parts)
    for (const [a, b] of part.def.manifest.signalPassthrough ?? []) {
      const na = part.pins[a];
      const nb = part.pins[b];
      if (na === undefined || nb === undefined || na === 0 || nb === 0) continue;
      const ra = find(na);
      const rb = find(nb);
      if (ra !== rb) parent.set(rb, ra);
    }
  return find;
}

/** Control input of a transistor-like part: BJT base, MOSFET gate, a driver module's signal pin. */
export function controlPin(part: AssembledPart): string | undefined {
  return ['b', 'g', 'sig'].find((p) => part.pins[p] !== undefined);
}

export const hasTrait = (part: AssembledPart, trait: string): boolean =>
  (part.def.manifest.traits as readonly string[] | undefined)?.includes(trait) ?? false;

export const round = (v: number, digits = 1): number => Math.round(v * 10 ** digits) / 10 ** digits;
