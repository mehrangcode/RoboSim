import { breadboardLayout, internalConnectionsOf } from '@robosim/catalog/manifests';
import { BOARD_PART, type PinRef, type ProjectDocument } from '@robosim/shared';
import type { CircuitNets } from './nets.js';

/**
 * How to read the current through one wire (FR-SIM-13, TD §18.2 point 3). Wires are merged into nets
 * by the solver, so a wire's current is the sum of the part-pin currents on one side of it:
 * I(from → to) = scale · Σ I_in(side). A wire in a zero-ohm loop has no defined current (the parallel
 * paths split it in a way the solver cannot tell); a side with no electrical pin carries none.
 */
export type WireCut =
  | { readonly kind: 'tree'; readonly side: readonly PinRef[]; readonly scale: 1 | -1 }
  | { readonly kind: 'loop' }
  | { readonly kind: 'floating' };

const key = (r: PinRef): string => `${r.part}\u0000${r.pin}`;
const ref = (k: string): PinRef => {
  const [part = '', pin = ''] = k.split('\u0000');
  return { part, pin };
};

const BOARD_GROUND = new Set(['GND1', 'GND2', 'GND3']);

/** Cut set of `wireId` (null when the document has no such wire). */
export function wireCut(doc: ProjectDocument, wireId: string): WireCut | null {
  const wire = doc.wires.find((w) => w.id === wireId);
  if (!wire) return null;

  const adj = new Map<string, string[]>();
  const edge = (from: string, to: string): void => {
    const list = adj.get(from);
    if (list) list.push(to);
    else adj.set(from, [to]);
  };
  const link = (a: string, b: string): void => {
    edge(a, b);
    edge(b, a);
  };
  const topological = new Set<string>();
  const ground = [...BOARD_GROUND].map((pin) => key({ part: BOARD_PART, pin }));
  for (const g of ground.slice(1)) link(ground[0] ?? '', g);
  for (const c of doc.components) {
    // Breadboard strips and a part's bondedPins: one conductor inside the part. Only a breadboard's
    // holes are non-electrical; a bonded part is simulated.
    if (breadboardLayout(c.type)) topological.add(c.id);
    for (const [a, b] of internalConnectionsOf(c.type))
      link(key({ part: c.id, pin: a }), key({ part: c.id, pin: b }));
    for (const [pin, hole] of Object.entries(c.seats ?? {})) link(key({ part: c.id, pin }), key(hole));
  }
  for (const w of doc.wires) if (w.id !== wireId) link(key(w.from), key(w.to));

  const reach = (start: string): Set<string> => {
    const seen = new Set([start]);
    const queue = [start];
    for (let k = queue.shift(); k !== undefined; k = queue.shift())
      for (const n of adj.get(k) ?? [])
        if (!seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
    return seen;
  };
  const from = reach(key(wire.from));
  if (from.has(key(wire.to))) return { kind: 'loop' };

  const electrical = (side: Set<string>): PinRef[] =>
    [...side].map(ref).filter((r) => r.part === BOARD_PART || !topological.has(r.part));
  const grounded = (pins: readonly PinRef[]) =>
    pins.some((r) => r.part === BOARD_PART && BOARD_GROUND.has(r.pin));

  // Ground has no ledger owner of its own: read the other side when this one touches GND.
  const fromPins = electrical(from);
  if (!grounded(fromPins))
    return fromPins.length ? { kind: 'tree', side: fromPins, scale: -1 } : { kind: 'floating' };
  const toPins = electrical(reach(key(wire.to)));
  return toPins.length ? { kind: 'tree', side: toPins, scale: 1 } : { kind: 'floating' };
}

/**
 * A pin the simulator knows on the same net as `ref` (TD §18.2): itself unless it is a breadboard hole,
 * else any part or board pin connected to the hole. Null for a hole on a net with no electrical pin
 * ("floating"): such a point never reaches the worker.
 */
export function electricalPoint(doc: ProjectDocument, nets: CircuitNets, ref: PinRef): PinRef | null {
  const typeOf = (part: string) => doc.components.find((c) => c.id === part)?.type ?? '';
  const isHole = (r: PinRef) => r.part !== BOARD_PART && breadboardLayout(typeOf(r.part)) !== undefined;
  if (!isHole(ref)) return ref;
  return nets.connectedTo(ref).find((r) => !isHole(r)) ?? null;
}
