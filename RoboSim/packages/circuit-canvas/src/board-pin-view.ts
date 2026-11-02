import { UNO_PINS } from '@robosim/board-avr-uno/pins';
import { breadboardLayout, findManifest } from '@robosim/catalog/manifests';
import type { BoardPinView, PinPeer } from '@robosim/safety-rules/consistency';
import { BOARD_PART, type PinRef, type ProjectDocument } from '@robosim/shared';
import type { PinKind, SignalDirection } from '@robosim/sim-core';
import { CircuitNets } from './nets.js';

/** The MCU pins a sketch can name (D0–D13, A0–A5). */
const MCU_PINS = UNO_PINS.filter((p) => p.capabilities.includes('digital'));

/** Direction of a pin without a manifest `signalDirection` entry (ADR-028). */
const DEFAULT_DIRECTION: Readonly<Record<PinKind, SignalDirection>> = {
  digital: 'in',
  output: 'out',
  analog: 'out',
  passive: 'none',
  power: 'none',
  ground: 'none',
};

const key = (r: PinRef): string => `${r.part}\u0000${r.pin}`;

/**
 * What the drawn circuit connects to each MCU pin (FR-SAF-08): input to the wiring ↔ sketch check.
 * Topology only, from the same nets the canvas highlights (`CircuitNets`): wires, breadboard strips and
 * seated legs. A series resistor (`signalPassthrough`) is followed to the part behind it, unless that
 * side reaches the board (a supply rail, ground or another MCU pin).
 */
export function boardPinView(doc: ProjectDocument, nets: CircuitNets = new CircuitNets(doc)): BoardPinView[] {
  const types = new Map(doc.components.map((c) => [c.id, c.type]));
  const isHole = (r: PinRef): boolean => breadboardLayout(types.get(r.part) ?? '') !== undefined;

  return MCU_PINS.map((def) => {
    const self: PinRef = { part: BOARD_PART, pin: def.id };
    const net = nets.connectedTo(self);
    const onNet = new Set<string>();
    const peers: PinPeer[] = [];
    const seen = new Set<string>();
    const visit = (members: readonly PinRef[]): void => {
      for (const m of members) {
        onNet.add(key(m));
        if (m.part === BOARD_PART || isHole(m) || seen.has(key(m))) continue;
        seen.add(key(m));
        const type = types.get(m.part) ?? '';
        const manifest = findManifest(type);
        const pass = manifest?.signalPassthrough?.find(([a, b]) => a === m.pin || b === m.pin);
        if (pass) {
          const other: PinRef = { part: m.part, pin: pass[0] === m.pin ? pass[1] : pass[0] };
          seen.add(key(other));
          const behind = nets.connectedTo(other);
          if (!behind.some((r) => r.part === BOARD_PART)) visit(behind);
          continue;
        }
        const kind = manifest?.pins.find((p) => p.name === m.pin)?.kind ?? 'passive';
        peers.push({
          partId: m.part,
          type,
          pin: m.pin,
          direction: manifest?.signalDirection?.[m.pin] ?? DEFAULT_DIRECTION[kind],
        });
      }
    };
    visit(net);
    const touches = (w: ProjectDocument['wires'][number]) => onNet.has(key(w.from)) || onNet.has(key(w.to));
    const atPin = (r: PinRef) => r.part === BOARD_PART && r.pin === def.id;
    return {
      pin: def.id,
      capabilities: def.capabilities,
      wireIds: doc.wires.filter(touches).map((w) => w.id),
      boardWireIds: doc.wires.filter((w) => atPin(w.from) || atPin(w.to)).map((w) => w.id),
      connected: net.some((r) => (r.part === BOARD_PART ? r.pin !== def.id : !isHole(r))),
      peers,
    };
  });
}
