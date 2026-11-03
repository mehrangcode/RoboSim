import type { DiodeHandle, MnaSolution, NetId, SourceHandle, TransistorHandle } from '../contracts.js';

/** Who stamped an element: a component index (≥ 0), the MCU bus, or a probe stamp (ignored). */
export const OWNER_MCU = -1;
export const OWNER_PROBE = -2;

/** One stamped element as the ledger sees it (ADR-026): enough to derive its terminal currents. */
export type LedgerElement =
  | { readonly kind: 'conductance'; readonly a: NetId; readonly b: NetId; readonly g: number }
  | { readonly kind: 'current'; readonly from: NetId; readonly to: NetId; readonly amps: number }
  | {
      readonly kind: 'branch';
      readonly handle: SourceHandle;
      readonly pos: NetId;
      readonly returnNet: NetId;
      readonly control: { readonly pos: NetId; readonly neg: NetId; readonly ratio: number } | null;
    }
  | { readonly kind: 'diode'; readonly handle: DiodeHandle; readonly anode: NetId; readonly cathode: NetId }
  | {
      readonly kind: 'bjt';
      readonly handle: TransistorHandle;
      readonly c: NetId;
      readonly b: NetId;
      readonly e: NetId;
      readonly sign: 1 | -1;
    }
  | {
      readonly kind: 'mosfet';
      readonly handle: TransistorHandle;
      readonly d: NetId;
      readonly s: NetId;
      readonly sign: 1 | -1;
    };

/**
 * Current flowing from each terminal's net into the element (A), reported per terminal through `emit`
 * (Technical Design §18.2 table). Signs follow the stamps in `MnaCircuit.solveLinear`: a branch's
 * `sourceCurrent` is delivered out of `pos`, a current source draws its amps from `from`, transistor
 * readings are in the device frame (N-channel / NPN signs) and are flipped for P / PNP.
 */
export function elementTerminalCurrents(
  el: LedgerElement,
  s: MnaSolution,
  emit: (net: NetId, amps: number) => void,
): void {
  switch (el.kind) {
    case 'conductance': {
      const i = el.g * (s.voltage(el.a) - s.voltage(el.b));
      emit(el.a, i);
      emit(el.b, -i);
      return;
    }
    case 'current':
      emit(el.from, el.amps);
      emit(el.to, -el.amps);
      return;
    case 'branch': {
      const i = s.sourceCurrent(el.handle);
      emit(el.pos, -i);
      emit(el.returnNet, i);
      if (el.control) {
        emit(el.control.pos, el.control.ratio * i);
        emit(el.control.neg, -el.control.ratio * i);
      }
      return;
    }
    case 'diode': {
      const i = s.diodeCurrent(el.handle);
      emit(el.anode, i);
      emit(el.cathode, -i);
      return;
    }
    case 'bjt': {
      const r = s.transistor(el.handle);
      emit(el.c, el.sign * r.main);
      emit(el.b, el.sign * r.control);
      emit(el.e, -el.sign * (r.main + r.control));
      return;
    }
    case 'mosfet': {
      const r = s.transistor(el.handle);
      emit(el.d, el.sign * r.main);
      emit(el.s, -el.sign * r.main);
      return;
    }
  }
}

/** Current from `net` into the given elements (A). */
export function currentInto(elements: readonly LedgerElement[], net: NetId, s: MnaSolution): number {
  let sum = 0;
  for (const el of elements)
    elementTerminalCurrents(el, s, (n, amps) => {
      if (n === net) sum += amps;
    });
  return sum;
}

/** Power absorbed by the given elements (W): Σ V(net)·I_in over every terminal; < 0 when delivering. */
export function powerInto(elements: readonly LedgerElement[], s: MnaSolution): number {
  let sum = 0;
  for (const el of elements) elementTerminalCurrents(el, s, (n, amps) => (sum += s.voltage(n) * amps));
  return sum;
}
