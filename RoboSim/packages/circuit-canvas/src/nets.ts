import { internalConnectionsOf } from '@robosim/catalog/manifests';
import { BOARD_PART, type PinRef, type ProjectDocument } from '@robosim/shared';

const key = (r: PinRef): string => `${r.part}\u0000${r.pin}`;
const ref = (k: string): PinRef => {
  const [part = '', pin = ''] = k.split('\u0000');
  return { part, pin };
};

/** The board's ground pins are one conductor on the PCB. */
const BOARD_GROUND = ['GND1', 'GND2', 'GND3'] as const;

/**
 * Nets of the drawn circuit (FR-CIR-04): wires, legs seated in breadboard holes, breadboard strips
 * and the board's common ground, merged with union-find. Used to highlight everything connected to
 * a pin; the simulator builds its own netlist from the same document.
 */
export class CircuitNets {
  readonly #parent = new Map<string, string>();
  readonly #members = new Map<string, PinRef[]>();

  constructor(doc: ProjectDocument) {
    for (const pin of BOARD_GROUND)
      this.#union(key({ part: BOARD_PART, pin: BOARD_GROUND[0] }), key({ part: BOARD_PART, pin }));
    for (const c of doc.components) {
      for (const [a, b] of internalConnectionsOf(c.type))
        this.#union(key({ part: c.id, pin: a }), key({ part: c.id, pin: b }));
      for (const [pin, hole] of Object.entries(c.seats ?? {}))
        this.#union(key({ part: c.id, pin }), key(hole));
    }
    for (const w of doc.wires) this.#union(key(w.from), key(w.to));
    for (const k of this.#parent.keys()) {
      const root = this.#find(k);
      let list = this.#members.get(root);
      if (!list) this.#members.set(root, (list = []));
      list.push(ref(k));
    }
  }

  /** Every pin on the same net as `pin` (itself included). */
  connectedTo(pin: PinRef): readonly PinRef[] {
    return this.#parent.has(key(pin)) ? (this.#members.get(this.#find(key(pin))) ?? [pin]) : [pin];
  }

  sameNet(a: PinRef, b: PinRef): boolean {
    return this.#find(key(a)) === this.#find(key(b));
  }

  #find(k: string): string {
    let root = this.#parent.get(k) ?? k;
    while (root !== (this.#parent.get(root) ?? root)) root = this.#parent.get(root) ?? root;
    if (this.#parent.has(k)) this.#parent.set(k, root);
    return root;
  }

  #union(a: string, b: string): void {
    if (!this.#parent.has(a)) this.#parent.set(a, a);
    if (!this.#parent.has(b)) this.#parent.set(b, b);
    const ra = this.#find(a);
    const rb = this.#find(b);
    if (ra !== rb) this.#parent.set(rb, ra);
  }
}
