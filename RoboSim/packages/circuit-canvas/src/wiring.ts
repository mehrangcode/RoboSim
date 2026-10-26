import { UNO_PINS } from '@robosim/board-avr-uno/pins';
import { breadboardLayout, findManifest, type ComponentManifest } from '@robosim/catalog/manifests';
import { BOARD_PART, type ComponentInstance, type PinRef, type ProjectDocument } from '@robosim/shared';
import type { JumperType } from '@robosim/shared';
import { jumperOf } from './bom.js';

/**
 * Wiring guide (FR-BOM-04): the drawn circuit as an ordered list of things to do at the desk, grouped
 * by subsystem. Parts that plug into a breadboard come first in their group, then supply wires, then
 * signals; otherwise the order is the drawing order. Every wire appears exactly once.
 */

export const SUBSYSTEMS = ['power', 'motors', 'sensors', 'displays', 'other'] as const;
export type Subsystem = (typeof SUBSYSTEMS)[number];

const SUBSYSTEM_OF: Readonly<Record<ComponentManifest['category'], Subsystem>> = {
  power: 'power',
  driver: 'motors',
  actuator: 'motors',
  sensor: 'sensors',
  display: 'displays',
  comms: 'displays',
  ic: 'other',
  semiconductor: 'other',
  passive: 'other',
  mechanical: 'other',
};
/** When a wire touches parts of several subsystems, the first of these names it. */
const PRECEDENCE: readonly Subsystem[] = ['motors', 'sensors', 'displays', 'other', 'power'];

export interface WireEnd {
  readonly ref: PinRef;
  /** Catalogue type of the part, null for the board. */
  readonly type: string | null;
  /** Pin as printed: board label ('D5', 'GND'), hole id, or the part's pin upper-cased. */
  readonly label: string;
  readonly hole: boolean;
  /** Legs of other parts seated in the same breadboard strip (what the hole leads to). */
  readonly via: readonly PinRef[];
}

export type WiringStep =
  | {
      readonly kind: 'seat';
      readonly id: string;
      readonly subsystem: Subsystem;
      readonly part: string;
      readonly type: string;
      readonly breadboard: string;
      readonly legs: readonly { readonly pin: string; readonly hole: string }[];
    }
  | {
      readonly kind: 'wire';
      readonly id: string;
      readonly subsystem: Subsystem;
      readonly from: WireEnd;
      readonly to: WireEnd;
      readonly color: string;
      readonly jumper: JumperType | null;
      /** Both ends are supply or ground pins. */
      readonly supply: boolean;
    };

export interface WiringGroup {
  readonly subsystem: Subsystem;
  readonly steps: readonly WiringStep[];
}

const boardPins = new Map(UNO_PINS.map((p) => [p.id, p]));
const RAIL = /^(tp|tn|bp|bn)\d+$/;
const STRIP = /^(\d+)([a-j])$/;

/** The conductor a hole belongs to: one 5-hole half-column, or one rail. */
export function stripOf(hole: string): string | null {
  const rail = RAIL.exec(hole);
  if (rail) return rail[1] ?? null;
  const strip = STRIP.exec(hole);
  if (!strip) return null;
  return `${strip[1]}${(strip[2] ?? 'a') <= 'e' ? 'top' : 'bottom'}`;
}

export function wiringGuide(doc: ProjectDocument): WiringGroup[] {
  const byId = new Map(doc.components.map((c) => [c.id, c]));
  const isBreadboard = (part: string) => breadboardLayout(byId.get(part)?.type ?? '') !== undefined;

  // Seated legs per (breadboard, strip).
  const seated = new Map<string, PinRef[]>();
  for (const c of doc.components)
    for (const [pin, hole] of Object.entries(c.seats ?? {})) {
      const strip = stripOf(hole.pin);
      if (!strip) continue;
      const k = `${hole.part}\u0000${strip}`;
      const list = seated.get(k) ?? [];
      list.push({ part: c.id, pin });
      seated.set(k, list);
    }

  const pinKind = (ref: PinRef): string | undefined => {
    if (ref.part === BOARD_PART) return boardPins.get(ref.pin)?.capabilities[0];
    if (isBreadboard(ref.part))
      return RAIL.test(ref.pin) ? (ref.pin[1] === 'n' ? 'ground' : 'power') : undefined;
    return findManifest(byId.get(ref.part)?.type ?? '')?.pins.find((p) => p.name === ref.pin)?.kind;
  };
  const isSupply = (ref: PinRef): boolean => {
    const kind = pinKind(ref);
    return kind === 'power' || kind === 'ground';
  };

  const endOf = (ref: PinRef): WireEnd => {
    if (ref.part === BOARD_PART) {
      // Signal pins by id (D5, A0); supply pins by their silk label (5V, 3.3V, GND).
      const label = isSupply(ref) ? (boardPins.get(ref.pin)?.label ?? ref.pin) : ref.pin;
      return { ref, type: null, label, hole: false, via: [] };
    }
    const c = byId.get(ref.part);
    if (c && breadboardLayout(c.type)) {
      const strip = stripOf(ref.pin);
      const via = strip ? (seated.get(`${ref.part}\u0000${strip}`) ?? []) : [];
      return { ref, type: c.type, label: ref.pin, hole: true, via };
    }
    return { ref, type: c?.type ?? null, label: ref.pin.toUpperCase(), hole: false, via: [] };
  };

  const subsystemOfParts = (parts: readonly ComponentInstance[]): Subsystem => {
    const found = new Set(
      parts.map((c) => {
        const category = findManifest(c.type)?.category;
        return category ? SUBSYSTEM_OF[category] : 'other';
      }),
    );
    return PRECEDENCE.find((s) => found.has(s)) ?? 'power';
  };

  const steps: WiringStep[] = [];
  for (const c of doc.components) {
    const legs = Object.entries(c.seats ?? {});
    if (!legs.length) continue;
    steps.push({
      kind: 'seat',
      id: c.id,
      subsystem: subsystemOfParts([c]),
      part: c.id,
      type: c.type,
      breadboard: legs[0]?.[1].part ?? '',
      legs: legs.map(([pin, hole]) => ({ pin, hole: hole.pin })),
    });
  }
  for (const w of doc.wires) {
    const from = endOf(w.from);
    const to = endOf(w.to);
    const touched = [w.from, w.to, ...from.via, ...to.via]
      .filter((r) => r.part !== BOARD_PART && !isBreadboard(r.part))
      .map((r) => byId.get(r.part))
      .filter((c): c is ComponentInstance => c !== undefined);
    const supplyEnd = (end: WireEnd) => (end.via.length ? end.via.every(isSupply) : isSupply(end.ref));
    const supply = supplyEnd(from) && supplyEnd(to);
    // A supply wire from a battery or regulator is power distribution, whatever it feeds.
    const fromSource = supply && touched.some((c) => findManifest(c.type)?.category === 'power');
    steps.push({
      kind: 'wire',
      id: w.id,
      subsystem: fromSource ? 'power' : subsystemOfParts(touched),
      from,
      to,
      color: w.color,
      jumper: jumperOf(doc, w.from, w.to),
      supply,
    });
  }

  const order = (s: WiringStep) => (s.kind === 'seat' ? 0 : s.supply ? 1 : 2);
  return SUBSYSTEMS.map((subsystem) => ({
    subsystem,
    // Array.prototype.sort is stable, so drawing order breaks ties.
    steps: steps.filter((s) => s.subsystem === subsystem).sort((a, b) => order(a) - order(b)),
  })).filter((g) => g.steps.length > 0);
}

/** Parts and wires a step's diagram shows (FR-BOM-04: a diagram per step). */
export function stepFocus(step: WiringStep): { parts: ReadonlySet<string>; wires: ReadonlySet<string> } {
  if (step.kind === 'seat') return { parts: new Set([step.part, step.breadboard]), wires: new Set() };
  const parts = new Set<string>();
  for (const end of [step.from, step.to]) {
    parts.add(end.ref.part);
    for (const v of end.via) parts.add(v.part);
  }
  return { parts, wires: new Set([step.id]) };
}
