import { breadboardLayout } from '@robosim/catalog/manifests';
import type { PinRef, ProjectDocument } from '@robosim/shared';
import { CircuitNets } from './nets.js';

const pinKey = (p: PinRef): string => `${p.part}:${p.pin}`;

/**
 * Connectivity of the drawn circuit as one string (FR-CIR-11): every net with two or more pins, pins
 * sorted, nets sorted. Equal strings mean equal netlists; wire colours and bend points do not count.
 */
export function netSignature(doc: ProjectDocument): string {
  const nets = new CircuitNets(doc)
    .nets()
    .map((n) => n.map(pinKey).sort())
    .filter((n) => n.length > 1)
    .sort((a, b) => (a.join() < b.join() ? -1 : a.join() > b.join() ? 1 : 0));
  return JSON.stringify(nets);
}

/**
 * Electrical nets that touch a wire or a seated leg, largest first, as `part:pin` lists. Breadboard holes
 * are wiring, not destinations: they stay only when nothing else names the net (sent to the AI, FR-AI-01).
 */
export function namedNets(doc: ProjectDocument): string[][] {
  const nets = new CircuitNets(doc);
  const boards = new Set(doc.components.filter((c) => breadboardLayout(c.type)).map((c) => c.id));
  const hole = (key: string): boolean => boards.has(key.slice(0, key.indexOf(':')));
  const seen = new Set<string>();
  const out: string[][] = [];
  const ends: PinRef[] = [
    ...doc.wires.flatMap((w) => [w.from, w.to]),
    ...doc.components.flatMap((c) => Object.keys(c.seats ?? {}).map((pin) => ({ part: c.id, pin }))),
  ];
  for (const end of ends) {
    if (seen.has(pinKey(end))) continue;
    const members = [...new Set([end, ...nets.connectedTo(end)].map(pinKey))];
    for (const m of members) seen.add(m);
    const named = members.every(hole) ? members : members.filter((m) => !hole(m));
    if (named.length > 1) out.push(named.sort());
  }
  return out.sort((a, b) => b.length - a.length);
}
