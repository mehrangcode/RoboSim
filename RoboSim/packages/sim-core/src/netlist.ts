import type { NetId } from './contracts.js';

/** Terminal address: `<componentId>:<pinName>`, e.g. 'r1:a', 'uno:D13'. */
export type Terminal = string;

export interface NetlistInput {
  /** Every terminal in the circuit, in a stable order (drives net numbering). */
  readonly terminals: readonly Terminal[];
  /** Wires and breadboard strips: each pair is electrically one node. */
  readonly connections: readonly (readonly [Terminal, Terminal])[];
  /** Terminals tied to the reference node (GND pins, battery −). */
  readonly ground: readonly Terminal[];
}

export interface Netlist {
  /** Number of non-ground nets; nets are numbered 1..netCount, ground is 0. */
  readonly netCount: number;
  netOf(terminal: Terminal): NetId;
  /** Terminals per net, index = NetId (index 0 = ground). */
  readonly members: readonly (readonly Terminal[])[];
}

export class NetlistError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetlistError';
  }
}

/** Merges connected terminals into nets with union-find (Technical Design §5.4). */
export function buildNetlist(input: NetlistInput): Netlist {
  const index = new Map<Terminal, number>();
  input.terminals.forEach((t, i) => {
    if (index.has(t)) throw new NetlistError(`Duplicate terminal '${t}'`);
    index.set(t, i);
  });
  const lookup = (t: Terminal): number => {
    const i = index.get(t);
    if (i === undefined) throw new NetlistError(`Unknown terminal '${t}'`);
    return i;
  };

  const parent = input.terminals.map((_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root] ?? root;
    while (parent[i] !== root) {
      const next = parent[i] ?? root;
      parent[i] = root;
      i = next;
    }
    return root;
  };
  // Lower index always becomes the root, so numbering depends only on input order.
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra < rb) parent[rb] = ra;
    else if (rb < ra) parent[ra] = rb;
  };

  for (const [a, b] of input.connections) union(lookup(a), lookup(b));
  const groundIdx = input.ground.map(lookup);
  for (let i = 1; i < groundIdx.length; i++) union(groundIdx[0] ?? 0, groundIdx[i] ?? 0);
  const groundRoot = groundIdx.length > 0 ? find(groundIdx[0] ?? 0) : -1;

  const netByRoot = new Map<number, NetId>();
  const netOfTerminal: NetId[] = [];
  const members: Terminal[][] = [[]];
  input.terminals.forEach((t, i) => {
    const root = find(i);
    let net: NetId;
    if (root === groundRoot) net = 0;
    else {
      net = netByRoot.get(root) ?? members.length;
      if (!netByRoot.has(root)) {
        netByRoot.set(root, net);
        members.push([]);
      }
    }
    netOfTerminal.push(net);
    members[net]?.push(t);
  });

  return {
    netCount: members.length - 1,
    members,
    netOf: (t) => netOfTerminal[lookup(t)] ?? 0,
  };
}
