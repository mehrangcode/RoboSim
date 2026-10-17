import { findManifest } from '@robosim/catalog/manifests';
import {
  BOARD_PART,
  PROJECT_SCHEMA_VERSION,
  type ComponentInstance,
  type PinRef,
  type ProjectDocument,
  type Wire,
} from '@robosim/shared';
import { PITCH, footprintOf, place, snap, withSeats, type Point } from './geometry.js';

/*
 * Editing operations on a project document (FR-CIR-01/02/05). Every operation is pure and returns
 * a new document with legs re-seated, so undo/redo is a stack of documents.
 */

export const pinNamesOf = (type: string): readonly string[] =>
  findManifest(type)?.pins.map((p) => p.name) ?? [];

/** Short id prefixes for new parts (`r1`, `led2`, `bb1`…). */
const PREFIX: Readonly<Record<string, string>> = {
  'passive.resistor': 'r',
  'passive.potentiometer': 'pot',
  'passive.breadboard-half': 'bb',
  'passive.breadboard-full': 'bb',
  'actuator.led': 'led',
  'actuator.buzzer-active': 'buz',
  'actuator.tt-motor': 'motor',
  'actuator.sg90-servo': 'servo',
  'sensor.push-button': 'btn',
  'sensor.ldr': 'ldr',
  'sensor.tcrt5000': 'ir',
  'sensor.line-3ch': 'line',
  'sensor.hc-sr04': 'sonar',
  'driver.l298n': 'drv',
  'power.battery-4aa': 'bat',
  'power.battery-9v': 'bat',
  'power.switch': 'sw',
  'mechanical.chassis-2wd': 'chassis',
  'semiconductor.diode-1n4007': 'd',
  'semiconductor.diode-1n4148': 'd',
  'semiconductor.zener-5v1': 'zd',
  'semiconductor.lm7805': 'reg',
  'semiconductor.ams1117-3v3': 'reg',
  'actuator.led-rgb': 'rgb',
  'actuator.buzzer-passive': 'buz',
  'actuator.relay-module': 'relay',
  'actuator.mg996r-servo': 'servo',
  'display.seven-segment': 'seg',
  'power.lm2596': 'buck',
  'ic.74hc00': 'u',
  'ic.74hc08': 'u',
  'ic.74hc32': 'u',
  'ic.74hc86': 'u',
  'ic.74hc14': 'u',
  'ic.74hc595': 'u',
  'ic.cd4017': 'u',
  'ic.uln2003a': 'u',
  'actuator.stepper-28byj48': 'step',
  'driver.tb6612fng': 'drv',
  'driver.l9110s': 'drv',
  'sensor.bump-switch': 'bump',
  'sensor.line-5ch': 'line',
  'sensor.ir-obstacle': 'ir',
  'sensor.pir': 'pir',
  'sensor.sound': 'mic',
  'sensor.soil-moisture': 'soil',
  'sensor.joystick': 'joy',
  'sensor.keypad-4x4': 'keys',
  'sensor.rotary-encoder': 'enc',
};

function nextId(taken: ReadonlySet<string>, prefix: string): string {
  for (let n = 1; ; n++) if (!taken.has(`${prefix}${n}`)) return `${prefix}${n}`;
}

const reseat = (doc: ProjectDocument): ProjectDocument => withSeats(doc, pinNamesOf);

/** An empty bench project for the Uno. */
export function blankProject(title: string, sketch: string): ProjectDocument {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    board: { id: 'avr-uno', version: '1.0.0' },
    components: [],
    wires: [],
    code: { language: 'cpp', files: [{ name: 'sketch.ino', content: sketch }] },
    libraries: [],
    meta: { title },
  };
}

export function addComponent(
  doc: ProjectDocument,
  type: string,
  at: Point,
): { doc: ProjectDocument; id: string } {
  const manifest = findManifest(type);
  if (!manifest) throw new Error(`Unknown component type '${type}'`);
  const id = nextId(new Set(doc.components.map((c) => c.id)), PREFIX[type] ?? 'part');
  const part: ComponentInstance = {
    id,
    type,
    typeVersion: manifest.version,
    x: snap(at[0]),
    y: snap(at[1]),
    rotation: 0,
    flipped: false,
    props: {},
  };
  return { doc: reseat({ ...doc, components: [...doc.components, part] }), id };
}

/**
 * Moves parts by a whole number of grid steps. Parts plugged into a moving breadboard move with it.
 */
export function moveComponents(
  doc: ProjectDocument,
  ids: readonly string[],
  dx: number,
  dy: number,
): ProjectDocument {
  const sx = snap(dx);
  const sy = snap(dy);
  if (sx === 0 && sy === 0) return doc;
  const moving = new Set(ids);
  for (const c of doc.components) {
    const seats = Object.values(c.seats ?? {});
    if (seats.length > 0 && seats.every((s) => moving.has(s.part))) moving.add(c.id);
  }
  return reseat({
    ...doc,
    components: doc.components.map((c) =>
      moving.has(c.id) ? { ...c, x: snap(c.x + sx), y: snap(c.y + sy) } : c,
    ),
  });
}

/** Turns parts 90° clockwise around their first pin, so a leg stays on its hole. */
export function rotateComponents(doc: ProjectDocument, ids: readonly string[]): ProjectDocument {
  return transform(doc, ids, (c) => ({
    ...c,
    rotation: ((c.rotation + 90) % 360) as ComponentInstance['rotation'],
  }));
}

/** Mirrors parts left–right around their first pin. */
export function flipComponents(doc: ProjectDocument, ids: readonly string[]): ProjectDocument {
  return transform(doc, ids, (c) => ({ ...c, flipped: !c.flipped }));
}

function transform(
  doc: ProjectDocument,
  ids: readonly string[],
  change: (c: ComponentInstance) => ComponentInstance,
): ProjectDocument {
  const set = new Set(ids);
  return reseat({
    ...doc,
    components: doc.components.map((c) => {
      if (!set.has(c.id)) return c;
      const fp = footprintOf(c.type, pinNamesOf(c.type));
      const anchor = Object.values(fp.pins)[0] ?? ([0, 0] as Point);
      const before = place(c, anchor);
      const next = change(c);
      const after = place(next, anchor);
      return { ...next, x: snap(next.x + before[0] - after[0]), y: snap(next.y + before[1] - after[1]) };
    }),
  });
}

/** Removes parts, their wires, and legs seated in them. */
export function deleteComponents(doc: ProjectDocument, ids: readonly string[]): ProjectDocument {
  const gone = new Set(ids);
  return reseat({
    ...doc,
    components: doc.components.filter((c) => !gone.has(c.id)),
    wires: doc.wires.filter((w) => !gone.has(w.from.part) && !gone.has(w.to.part)),
  });
}

/** Copies parts two grid steps down-right (wires stay with the originals). */
export function duplicateComponents(
  doc: ProjectDocument,
  ids: readonly string[],
): { doc: ProjectDocument; ids: string[] } {
  const taken = new Set(doc.components.map((c) => c.id));
  const copies: ComponentInstance[] = [];
  for (const c of doc.components.filter((v) => ids.includes(v.id))) {
    const id = nextId(taken, PREFIX[c.type] ?? 'part');
    taken.add(id);
    const { seats: _seats, mount: _mount, ...rest } = c;
    copies.push({ ...rest, id, x: snap(c.x + 2 * PITCH), y: snap(c.y + 2 * PITCH) });
  }
  return {
    doc: reseat({ ...doc, components: [...doc.components, ...copies] }),
    ids: copies.map((c) => c.id),
  };
}

export function setProp(
  doc: ProjectDocument,
  id: string,
  key: string,
  value: number | boolean | string,
): ProjectDocument {
  return {
    ...doc,
    components: doc.components.map((c) => (c.id === id ? { ...c, props: { ...c.props, [key]: value } } : c)),
  };
}

const samePin = (a: PinRef, b: PinRef) => a.part === b.part && a.pin === b.pin;

/** Wire colour by convention: black to ground, red to 5 V, otherwise the given default. */
export function conventionalColor(from: PinRef, to: PinRef, fallback: string): string {
  const pins = [from, to].filter((p) => p.part === BOARD_PART).map((p) => p.pin);
  if (pins.some((p) => p.startsWith('GND'))) return 'black';
  if (pins.includes('5V')) return 'red';
  return fallback;
}

export function addWire(
  doc: ProjectDocument,
  from: PinRef,
  to: PinRef,
  points: readonly Point[],
  color: string,
): { doc: ProjectDocument; id: string | null } {
  if (samePin(from, to)) return { doc, id: null };
  const id = nextId(new Set(doc.wires.map((w) => w.id)), 'w');
  const wire: Wire = { id, from, to, color, points: points.map(([x, y]) => [x, y] as [number, number]) };
  return { doc: { ...doc, wires: [...doc.wires, wire] }, id };
}

export function deleteWires(doc: ProjectDocument, ids: readonly string[]): ProjectDocument {
  const gone = new Set(ids);
  return { ...doc, wires: doc.wires.filter((w) => !gone.has(w.id)) };
}

export function setWireColor(doc: ProjectDocument, id: string, color: string): ProjectDocument {
  return { ...doc, wires: doc.wires.map((w) => (w.id === id ? { ...w, color } : w)) };
}

export function moveWirePoint(doc: ProjectDocument, id: string, index: number, to: Point): ProjectDocument {
  return {
    ...doc,
    wires: doc.wires.map((w) =>
      w.id === id
        ? {
            ...w,
            points: w.points.map((p, i) =>
              i === index ? ([snap(to[0]), snap(to[1])] as [number, number]) : p,
            ),
          }
        : w,
    ),
  };
}

/** Undo/redo stacks of whole documents (FR-CIR-01: at least 100 steps). */
export interface History {
  readonly past: readonly ProjectDocument[];
  readonly present: ProjectDocument;
  readonly future: readonly ProjectDocument[];
}

export const HISTORY_LIMIT = 200;

export const startHistory = (doc: ProjectDocument): History => ({ past: [], present: doc, future: [] });

export function commit(h: History, doc: ProjectDocument): History {
  if (doc === h.present) return h;
  return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: doc, future: [] };
}

export function undo(h: History): History {
  const prev = h.past.at(-1);
  return prev ? { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] } : h;
}

export function redo(h: History): History {
  const [next, ...future] = h.future;
  return next ? { past: [...h.past, h.present], present: next, future } : h;
}
