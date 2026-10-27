import { breadboardLayout, findManifest } from '@robosim/catalog/manifests';
import {
  BOARD_PART,
  PROJECT_SCHEMA_VERSION,
  type ComponentInstance,
  type PinRef,
  type ProjectDocument,
  type Wire,
} from '@robosim/shared';
import {
  BOARD_FOOTPRINT,
  PITCH,
  boardPlacement,
  footprintOf,
  place,
  placedBox,
  snap,
  withSeats,
  type Box,
  type Footprint,
  type Placement,
  type Point,
} from './geometry.js';

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
  'passive.capacitor-ceramic': 'c',
  'passive.capacitor-electrolytic': 'c',
  'ic.ne555': 'u',
  'semiconductor.2n2222': 'q',
  'semiconductor.bc547': 'q',
  'semiconductor.2n3906': 'q',
  'semiconductor.tip120': 'q',
  'semiconductor.irlz44n': 'q',
  'driver.irf520-module': 'drv',
  'display.oled-ssd1306': 'oled',
  'display.lcd1602-i2c': 'lcd',
  'sensor.mpu6050': 'imu',
  'sensor.bmp280': 'baro',
  'sensor.vl53l0x': 'tof',
  'sensor.dht11': 'dht',
  'sensor.ds18b20': 'temp',
  'actuator.ws2812-strip': 'strip',
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

/** The board (`board`) or a part, as the canvas places it. */
function placementOf(doc: ProjectDocument, id: string): Placement | undefined {
  return id === BOARD_PART ? boardPlacement(doc) : doc.components.find((c) => c.id === id);
}

function footprintFor(doc: ProjectDocument, id: string): Footprint {
  if (id === BOARD_PART) return BOARD_FOOTPRINT;
  const type = doc.components.find((c) => c.id === id)?.type ?? '';
  return footprintOf(type, pinNamesOf(type));
}

/** Document-space bounding box of the board or a part; null when it does not exist. */
export function partBox(doc: ProjectDocument, id: string): Box | null {
  const at = placementOf(doc, id);
  return at ? placedBox(at, footprintFor(doc, id)) : null;
}

/** Parts plugged only into the given parts (a breadboard's passengers): they travel with them. */
export function passengersOf(doc: ProjectDocument, ids: Iterable<string>): Set<string> {
  const hosts = new Set(ids);
  const riders = new Set<string>();
  for (const c of doc.components) {
    const seats = Object.values(c.seats ?? {});
    if (!hosts.has(c.id) && seats.length > 0 && seats.every((v) => hosts.has(v.part))) riders.add(c.id);
  }
  return riders;
}

/** Writes new placements for parts and the board, then re-seats every leg. */
function placeAll(doc: ProjectDocument, next: ReadonlyMap<string, Placement>): ProjectDocument {
  if (next.size === 0) return doc;
  const board = next.get(BOARD_PART);
  return reseat({
    ...doc,
    board: board
      ? { ...doc.board, position: { x: board.x, y: board.y, rotation: board.rotation } }
      : doc.board,
    components: doc.components.map((c) => {
      const p = next.get(c.id);
      return p ? { ...c, x: p.x, y: p.y, rotation: p.rotation, flipped: p.flipped } : c;
    }),
  });
}

/**
 * Moves each part (or the board) by its own delta, rounded to whole grid steps. A breadboard's passengers
 * move with it when every breadboard they are plugged into moves the same way.
 */
function shiftParts(doc: ProjectDocument, deltas: ReadonlyMap<string, Point>): ProjectDocument {
  const steps = new Map<string, Point>();
  for (const [id, [dx, dy]] of deltas) {
    const sx = snap(dx);
    const sy = snap(dy);
    if (sx !== 0 || sy !== 0) steps.set(id, [sx, sy]);
  }
  for (const c of doc.components) {
    if (steps.has(c.id) || deltas.has(c.id)) continue;
    const hosts = [...new Set(Object.values(c.seats ?? {}).map((v) => v.part))];
    const [first, ...rest] = hosts.map((h) => steps.get(h));
    if (first && rest.every((d) => d && d[0] === first[0] && d[1] === first[1])) steps.set(c.id, first);
  }
  const next = new Map<string, Placement>();
  for (const [id, [dx, dy]] of steps) {
    const at = placementOf(doc, id);
    if (at) next.set(id, { ...at, x: snap(at.x + dx), y: snap(at.y + dy) });
  }
  return placeAll(doc, next);
}

/** Moves parts (and the board) by a whole number of grid steps; breadboards carry their passengers. */
export function moveComponents(
  doc: ProjectDocument,
  ids: readonly string[],
  dx: number,
  dy: number,
): ProjectDocument {
  return shiftParts(doc, new Map(ids.map((id) => [id, [dx, dy] as Point])));
}

/**
 * Turns or mirrors parts as one rigid group, passengers included. One part turns around its first pin,
 * so a leg stays on its hole; a group turns around the grid point nearest the centre of its box. The board
 * turns but never mirrors.
 */
function turnGroup(doc: ProjectDocument, ids: readonly string[], how: 'rotate' | 'flip'): ProjectDocument {
  const own = [...new Set(ids)].filter(
    (id) => placementOf(doc, id) && (how === 'rotate' || id !== BOARD_PART),
  );
  if (own.length === 0) return doc;
  const anchorOf = (id: string): Point => Object.values(footprintFor(doc, id).pins)[0] ?? [0, 0];
  let pivot: Point;
  if (own.length === 1) {
    const [id = ''] = own;
    pivot = place(placementOf(doc, id) as Placement, anchorOf(id));
  } else {
    const b = unionBox(own.map((id) => partBox(doc, id) as Box));
    pivot = [snap(b.x + b.w / 2), snap(b.y + b.h / 2)];
  }
  const [cx, cy] = pivot;
  const map = ([x, y]: Point): Point => (how === 'rotate' ? [cx - (y - cy), cy + (x - cx)] : [2 * cx - x, y]);
  const next = new Map<string, Placement>();
  for (const id of [...own, ...passengersOf(doc, own)]) {
    const at = placementOf(doc, id) as Placement;
    const turned: Placement =
      how === 'rotate'
        ? { ...at, rotation: ((at.rotation + 90) % 360) as Placement['rotation'] }
        : { ...at, flipped: !at.flipped };
    const anchor = anchorOf(id);
    const target = map(place(at, anchor));
    const after = place(turned, anchor);
    next.set(id, {
      ...turned,
      x: snap(turned.x + target[0] - after[0]),
      y: snap(turned.y + target[1] - after[1]),
    });
  }
  return placeAll(doc, next);
}

/** Turns parts 90° clockwise (one part around its first pin, a group around its centre). */
export const rotateComponents = (doc: ProjectDocument, ids: readonly string[]): ProjectDocument =>
  turnGroup(doc, ids, 'rotate');

/** Mirrors parts left–right (one part around its first pin, a group around its centre). */
export const flipComponents = (doc: ProjectDocument, ids: readonly string[]): ProjectDocument =>
  turnGroup(doc, ids, 'flip');

export function unionBox(boxes: readonly Box[]): Box {
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w));
  const y1 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Selected parts that move on their own: a passenger of another selected part rides along instead. */
function alignUnits(doc: ProjectDocument, ids: readonly string[]): { id: string; box: Box }[] {
  const set = new Set(ids);
  const riders = passengersOf(doc, set);
  return [...set]
    .filter((id) => {
      if (riders.has(id)) return false;
      const seats = Object.values(doc.components.find((c) => c.id === id)?.seats ?? {});
      return !(seats.length > 0 && seats.every((v) => set.has(v.part)));
    })
    .flatMap((id) => {
      const box = partBox(doc, id);
      return box ? [{ id, box }] : [];
    });
}

/** How many selected parts align or distribute on their own (passengers ride with their breadboard). */
export const alignableCount = (doc: ProjectDocument, ids: readonly string[]): number =>
  alignUnits(doc, ids).length;

export type Alignment = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

/** Lines up two or more parts' boxes on an edge or centre line; every move stays on the grid. */
export function alignComponents(
  doc: ProjectDocument,
  ids: readonly string[],
  how: Alignment,
): ProjectDocument {
  const units = alignUnits(doc, ids);
  if (units.length < 2) return doc;
  const all = unionBox(units.map((u) => u.box));
  const horizontal = how === 'left' || how === 'center' || how === 'right';
  const delta = ({ x, y, w, h }: Box): number => {
    switch (how) {
      case 'left':
        return all.x - x;
      case 'center':
        return all.x + all.w / 2 - (x + w / 2);
      case 'right':
        return all.x + all.w - (x + w);
      case 'top':
        return all.y - y;
      case 'middle':
        return all.y + all.h / 2 - (y + h / 2);
      case 'bottom':
        return all.y + all.h - (y + h);
    }
  };
  return shiftParts(
    doc,
    new Map(units.map((u) => [u.id, (horizontal ? [delta(u.box), 0] : [0, delta(u.box)]) as Point])),
  );
}

/** Spaces three or more parts evenly between the outermost two (equal gaps between their boxes). */
export function distributeComponents(
  doc: ProjectDocument,
  ids: readonly string[],
  axis: 'horizontal' | 'vertical',
): ProjectDocument {
  const units = alignUnits(doc, ids);
  if (units.length < 3) return doc;
  const start = (b: Box) => (axis === 'horizontal' ? b.x : b.y);
  const size = (b: Box) => (axis === 'horizontal' ? b.w : b.h);
  units.sort((a, b) => start(a.box) + size(a.box) / 2 - (start(b.box) + size(b.box) / 2));
  const first = units[0] as (typeof units)[number];
  const last = units.at(-1) as (typeof units)[number];
  const span = start(last.box) + size(last.box) - start(first.box);
  const gap = (span - units.reduce((sum, u) => sum + size(u.box), 0)) / (units.length - 1);
  const deltas = new Map<string, Point>();
  let cursor = start(first.box) + size(first.box) + gap;
  for (const u of units.slice(1, -1)) {
    const d = cursor - start(u.box);
    deltas.set(u.id, axis === 'horizontal' ? [d, 0] : [0, d]);
    cursor += size(u.box) + gap;
  }
  return shiftParts(doc, deltas);
}

/** Removes parts, their wires, and legs seated in them. The board stays. */
export function deleteComponents(doc: ProjectDocument, ids: readonly string[]): ProjectDocument {
  const gone = new Set(ids.filter((id) => id !== BOARD_PART));
  if (gone.size === 0) return doc;
  return reseat({
    ...doc,
    components: doc.components.filter((c) => !gone.has(c.id)),
    wires: doc.wires.filter((w) => !gone.has(w.from.part) && !gone.has(w.to.part)),
  });
}

/** Parts and the wires between them, cut loose from a document (copy/paste, FR-CIR-09). */
export interface CircuitClip {
  readonly components: readonly ComponentInstance[];
  readonly wires: readonly Wire[];
}

/**
 * The selected parts (with a breadboard's passengers) and the wires that run between them, at their
 * positions; seats are dropped (recomputed where they land). The board is never part of a clip.
 */
export function copySelection(doc: ProjectDocument, ids: readonly string[]): CircuitClip | null {
  const own = new Set(ids.filter((id) => id !== BOARD_PART));
  for (const id of passengersOf(doc, own)) own.add(id);
  if (own.size === 0) return null;
  const components = doc.components
    .filter((c) => own.has(c.id))
    .map(({ seats: _seats, mount: _mount, ...rest }) => rest);
  const wires = doc.wires.filter((w) => own.has(w.from.part) && own.has(w.to.part));
  return { components, wires };
}

/** Bounding box of a clip's parts. */
export const clipBox = (doc: ProjectDocument, clip: CircuitClip): Box =>
  unionBox(clip.components.map((c) => partBox({ ...doc, components: [...clip.components] }, c.id) as Box));

/** Inserts a clip shifted by `offset` (snapped to the grid), with fresh ids. */
export function pasteClip(
  doc: ProjectDocument,
  clip: CircuitClip,
  offset: Point,
): { doc: ProjectDocument; ids: string[] } {
  const [ox, oy] = offset;
  const taken = new Set(doc.components.map((c) => c.id));
  const renamed = new Map<string, string>();
  const copies: ComponentInstance[] = [];
  for (const c of clip.components) {
    const id = nextId(taken, PREFIX[c.type] ?? 'part');
    taken.add(id);
    renamed.set(c.id, id);
    copies.push({ ...c, id, x: snap(c.x + ox), y: snap(c.y + oy) });
  }
  const wireIds = new Set(doc.wires.map((w) => w.id));
  const wires: Wire[] = [];
  for (const w of clip.wires) {
    const from = renamed.get(w.from.part);
    const to = renamed.get(w.to.part);
    if (!from || !to) continue;
    const id = nextId(wireIds, 'w');
    wireIds.add(id);
    wires.push({
      ...w,
      id,
      from: { part: from, pin: w.from.pin },
      to: { part: to, pin: w.to.pin },
      points: w.points.map(([x, y]) => [snap(x + ox), snap(y + oy)] as [number, number]),
    });
  }
  return {
    doc: reseat({ ...doc, components: [...doc.components, ...copies], wires: [...doc.wires, ...wires] }),
    ids: copies.map((c) => c.id),
  };
}

/**
 * Where a pasted clip goes: centred on `at`, then stepped two grid pitches down-right while it would
 * land exactly on parts of the same type (pasting twice, or into the project it came from).
 */
export function pasteOffset(doc: ProjectDocument, clip: CircuitClip, at: Point): Point {
  const box = clipBox(doc, clip);
  let ox = snap(at[0] - (box.x + box.w / 2));
  let oy = snap(at[1] - (box.y + box.h / 2));
  const clash = () =>
    clip.components.some((c) =>
      doc.components.some((d) => d.type === c.type && d.x === snap(c.x + ox) && d.y === snap(c.y + oy)),
    );
  for (let n = 0; n < 50 && clash(); n++) {
    ox += 2 * PITCH;
    oy += 2 * PITCH;
  }
  return [ox, oy];
}

/**
 * Copies parts (and a breadboard's passengers) two grid steps down-right, or below the original when the copy
 * has a breadboard, with the wires that run between copied parts. Wires to anything outside the copy stay with the originals. The board is not copied.
 */
export function duplicateComponents(
  doc: ProjectDocument,
  ids: readonly string[],
): { doc: ProjectDocument; ids: string[] } {
  const clip = copySelection(doc, ids);
  if (!clip) return { doc, ids: [] };
  // A copied breadboard goes below the original: overlapping holes would seat the copies in the old one.
  const boards = clip.components.some((c) => breadboardLayout(c.type));
  const offset: Point = boards ? [0, snap(clipBox(doc, clip).h) + 2 * PITCH] : [2 * PITCH, 2 * PITCH];
  return pasteClip(doc, clip, offset);
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
