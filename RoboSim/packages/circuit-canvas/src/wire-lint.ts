import { breadboardLayout, findManifest } from '@robosim/catalog/manifests';
import { BOARD_PART, type PinRef, type ProjectDocument, type Wire } from '@robosim/shared';
import { BOARD_SUPPLY_PINS, pinNamesOf } from './document.js';
import { PITCH, footprintOf, pinPosition, placedBox, type Box, type Point } from './geometry.js';
import { netSignature } from './net-signature.js';
import { CircuitNets } from './nets.js';
import { DEFAULT_WIRE_CONVENTION, WIRE_COLORS, type WireConvention } from './wire-convention.js';

/**
 * Wiring hints and Tidy (FR-CIR-11, TD §18.7): readability lint for wires (colour convention, long,
 * over parts, overlapping, rail suggestion) and a deterministic tidy that only writes `wires[].color`
 * and `wires[].points`. Hints are Info-level and separate from safety findings.
 */

export type NetRole = 'ground' | 'supply' | 'signal';

export type WireLintId =
  'LINT-WIRE-COLOR' | 'LINT-WIRE-LONG' | 'LINT-WIRE-OVER-PART' | 'LINT-WIRE-OVERLAP' | 'LINT-RAIL-HINT';

export interface WireHint {
  readonly id: WireLintId;
  readonly wireIds: readonly string[];
  readonly partIds: readonly string[];
  readonly params: Readonly<Record<string, string | number>>;
}

/** A stable identity of a hint (for dismissing and selecting it). */
export const hintKey = (h: WireHint): string => `${h.id}:${h.wireIds.join(',')}:${h.partIds.join(',')}`;

/** Thresholds of the lint (mm). */
export const LONG_WIRE_MM = 150;
/** A long wire is only a hint when it is this much longer than the shortest orthogonal route. */
const LONG_SLACK = 1.2;
const DETOUR_MIN_MM = 40;
const DETOUR_RATIO = 2.5;
/** Channels tried per orientation when rerouting, nearest the middle first. */
const LANES = 12;
const OVERLAP_MIN_MM = 2 * PITCH;
const RAIL_HINT_WIRES = 3;
/** Breadboard jumpers this short stay straight. */
const SHORT_JUMPER_MM = 3 * PITCH;
const GRID_CELL_MM = 20;
const EPS = 1e-6;

const RAIL = /^(tp|tn|bp|bn)\d+$/;
const STRIP = /^\d+[a-j]$/;

// ---------------------------------------------------------------- net roles

interface NetInfo {
  readonly role: NetRole;
  /** The net has a supply-type pin (a part's power or ground pin, a breadboard rail) even if no source. */
  readonly powerish: boolean;
}
const SIGNAL: NetInfo = { role: 'signal', powerish: false };

/**
 * Role of every net: `ground` when it holds a board GND or a ground pin; `supply` when it holds a board
 * supply pin (5 V, 3.3 V, VIN) or an enabled supply output of a part (battery, regulator, driver 5 V).
 */
function netRoles(doc: ProjectDocument, nets: CircuitNets): (pin: PinRef) => NetInfo {
  const byId = new Map(doc.components.map((c) => [c.id, c]));
  const supplyOut = new Set<string>();
  for (const c of doc.components) {
    const m = findManifest(c.type);
    for (const s of m?.supplyPins ?? []) {
      const enabled =
        !s.enabledByProp || (c.props[s.enabledByProp] ?? m?.props[s.enabledByProp]?.default) === true;
      if (enabled) supplyOut.add(`${c.id}\u0000${s.pin}`);
    }
  }
  const info = new Map<string, NetInfo>();
  for (const net of nets.nets()) {
    let ground = false;
    let supply = false;
    let powerish = false;
    for (const p of net) {
      if (p.part === BOARD_PART) {
        if (p.pin.startsWith('GND')) ground = true;
        else if (BOARD_SUPPLY_PINS.has(p.pin)) supply = true;
        continue;
      }
      const type = byId.get(p.part)?.type ?? '';
      if (breadboardLayout(type)) {
        if (RAIL.test(p.pin)) powerish = true;
        continue;
      }
      const kind = findManifest(type)?.pins.find((x) => x.name === p.pin)?.kind;
      if (kind === 'ground') ground = true;
      if (kind === 'power' || kind === 'ground') powerish = true;
      if (supplyOut.has(`${p.part}\u0000${p.pin}`)) supply = true;
    }
    const first = net[0];
    if (first)
      info.set(nets.netOf(first), {
        role: ground ? 'ground' : supply ? 'supply' : 'signal',
        powerish: powerish || ground || supply,
      });
  }
  return (pin) => info.get(nets.netOf(pin)) ?? SIGNAL;
}

// ---------------------------------------------------------------- geometry

/** The drawn polyline of a wire: from pin, bends, to pin. Null when an end does not exist. */
function routeOf(
  doc: ProjectDocument,
  w: Pick<Wire, 'from' | 'to'>,
  points: readonly Point[],
): Point[] | null {
  const a = pinPosition(doc, w.from, pinNamesOf);
  const b = pinPosition(doc, w.to, pinNamesOf);
  return a && b ? [a, ...points, b] : null;
}

const dist = (a: Point, b: Point): number => Math.hypot(b[0] - a[0], b[1] - a[1]);

function lengthOf(pts: readonly Point[]): number {
  let n = 0;
  for (let i = 1; i < pts.length; i++) n += dist(pts[i - 1] as Point, pts[i] as Point);
  return n;
}

const contains = (b: Box, [x, y]: Point): boolean =>
  x >= b.x - 0.01 && x <= b.x + b.w + 0.01 && y >= b.y - 0.01 && y <= b.y + b.h + 0.01;

/** Does the segment run through the box's interior (Liang–Barsky on a slightly shrunk box)? */
function segmentHitsBox([x0, y0]: Point, [x1, y1]: Point, b: Box): boolean {
  const e = 0.05;
  const xmin = b.x + e;
  const xmax = b.x + b.w - e;
  const ymin = b.y + e;
  const ymax = b.y + b.h - e;
  if (xmax <= xmin || ymax <= ymin) return false;
  const dx = x1 - x0;
  const dy = y1 - y0;
  let t0 = 0;
  let t1 = 1;
  const edges: readonly (readonly [number, number])[] = [
    [-dx, x0 - xmin],
    [dx, xmax - x0],
    [-dy, y0 - ymin],
    [dy, ymax - y0],
  ];
  for (const [p, q] of edges) {
    if (Math.abs(p) < EPS) {
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  return t1 - t0 > EPS;
}

interface Obstacle {
  readonly id: string;
  readonly box: Box;
}

/** Part boxes in a uniform grid of 20 mm cells (breadboards and the board are not obstacles). */
class ObstacleGrid {
  readonly #cells = new Map<string, number[]>();
  readonly #items: Obstacle[];

  constructor(doc: ProjectDocument) {
    this.#items = doc.components
      .filter((c) => !breadboardLayout(c.type))
      .map((c) => ({ id: c.id, box: placedBox(c, footprintOf(c.type, pinNamesOf(c.type))) }));
    this.#items.forEach((o, i) => {
      for (const k of this.#keys(o.box.x, o.box.y, o.box.x + o.box.w, o.box.y + o.box.h)) {
        const list = this.#cells.get(k);
        if (list) list.push(i);
        else this.#cells.set(k, [i]);
      }
    });
  }

  *#keys(x0: number, y0: number, x1: number, y1: number): Generator<string> {
    const c = GRID_CELL_MM;
    for (let gx = Math.floor(Math.min(x0, x1) / c); gx <= Math.floor(Math.max(x0, x1) / c); gx++)
      for (let gy = Math.floor(Math.min(y0, y1) / c); gy <= Math.floor(Math.max(y0, y1) / c); gy++)
        yield `${gx},${gy}`;
  }

  /** Cells a segment passes through, walked along the line (Amanatides–Woo), not its whole bounding box. */
  *#walk([x0, y0]: Point, [x1, y1]: Point): Generator<string> {
    const c = GRID_CELL_MM;
    let gx = Math.floor(x0 / c);
    let gy = Math.floor(y0 / c);
    const ex = Math.floor(x1 / c);
    const ey = Math.floor(y1 / c);
    const dx = x1 - x0;
    const dy = y1 - y0;
    const sx = Math.sign(dx);
    const sy = Math.sign(dy);
    const stepX = dx ? Math.abs(c / dx) : Infinity;
    const stepY = dy ? Math.abs(c / dy) : Infinity;
    let nextX = dx ? (sx > 0 ? (gx + 1) * c - x0 : x0 - gx * c) / Math.abs(dx) : Infinity;
    let nextY = dy ? (sy > 0 ? (gy + 1) * c - y0 : y0 - gy * c) / Math.abs(dy) : Infinity;
    yield `${gx},${gy}`;
    for (let guard = 0; (gx !== ex || gy !== ey) && guard < 100_000; guard++) {
      if (nextX < nextY) {
        nextX += stepX;
        gx += sx;
      } else {
        nextY += stepY;
        gy += sy;
      }
      yield `${gx},${gy}`;
    }
  }

  /** Parts the polyline runs through, except those holding one of its ends (its own part, a chassis…). */
  crossed(pts: readonly Point[]): string[] {
    const start = pts[0];
    const end = pts[pts.length - 1];
    if (!start || !end) return [];
    const hit = new Set<number>();
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1] as Point;
      const b = pts[i] as Point;
      for (const k of this.#walk(a, b))
        for (const j of this.#cells.get(k) ?? []) {
          if (hit.has(j)) continue;
          const o = this.#items[j] as Obstacle;
          if (contains(o.box, start) || contains(o.box, end)) continue;
          if (segmentHitsBox(a, b, o.box)) hit.add(j);
        }
    }
    return [...hit].sort((x, y) => x - y).map((j) => (this.#items[j] as Obstacle).id);
  }
}

interface AxisSegment {
  readonly wire: string;
  readonly net: string;
  readonly lo: number;
  readonly hi: number;
}

/** Horizontal and vertical segments bucketed by their line, to find collinear overlaps fast. */
class SegmentIndex {
  readonly #lines = new Map<string, AxisSegment[]>();

  static *axisSegments(pts: readonly Point[]): Generator<{ line: string; lo: number; hi: number }> {
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1] as Point;
      const [x1, y1] = pts[i] as Point;
      if (Math.abs(y0 - y1) < EPS && Math.abs(x0 - x1) > EPS)
        yield { line: `h${Math.round(y0 * 100)}`, lo: Math.min(x0, x1), hi: Math.max(x0, x1) };
      else if (Math.abs(x0 - x1) < EPS && Math.abs(y0 - y1) > EPS)
        yield { line: `v${Math.round(x0 * 100)}`, lo: Math.min(y0, y1), hi: Math.max(y0, y1) };
    }
  }

  add(pts: readonly Point[], net: string, wire: string): void {
    for (const s of SegmentIndex.axisSegments(pts)) {
      const seg = { wire, net, lo: s.lo, hi: s.hi };
      const list = this.#lines.get(s.line);
      if (list) list.push(seg);
      else this.#lines.set(s.line, [seg]);
    }
  }

  /** Indexed segments of other nets that share at least `min` mm of a line with the polyline. */
  overlaps(pts: readonly Point[], net: string, min: number): AxisSegment[] {
    const out: AxisSegment[] = [];
    for (const s of SegmentIndex.axisSegments(pts))
      for (const o of this.#lines.get(s.line) ?? [])
        if (o.net !== net && Math.min(s.hi, o.hi) - Math.max(s.lo, o.lo) >= min - EPS) out.push(o);
    return out;
  }
}

// ---------------------------------------------------------------- hints

/**
 * A wire much longer than it needs to be: a detour (> 2.5 × the straight distance, past 40 mm), or over
 * 150 mm and 20 % longer than the shortest orthogonal route. A far-apart pair of pins on its shortest
 * orthogonal route is not a hint: Tidy could not shorten it (TD §18.7 refined in IT-7).
 */
function isLong(pts: readonly Point[]): boolean {
  const length = lengthOf(pts);
  const a = pts[0] as Point;
  const b = pts[pts.length - 1] as Point;
  const manhattan = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);
  return (
    (length > DETOUR_MIN_MM && length > DETOUR_RATIO * dist(a, b)) ||
    (length > LONG_WIRE_MM && length > LONG_SLACK * manhattan + EPS)
  );
}

/** Readability hints for the drawn wires (Info only; never safety findings). */
export function wireHints(doc: ProjectDocument, conv: WireConvention = DEFAULT_WIRE_CONVENTION): WireHint[] {
  const nets = new CircuitNets(doc);
  const roleOf = netRoles(doc, nets);
  const grid = new ObstacleGrid(doc);
  const index = new SegmentIndex();
  const byId = new Map(doc.components.map((c) => [c.id, c]));
  const hints: WireHint[] = [];
  const pairs = new Set<string>();

  for (const w of doc.wires) {
    const net = nets.netOf(w.from);
    const { role, powerish } = roleOf(w.from);
    const expected = role === 'ground' ? conv.ground : role === 'supply' ? conv.supply : null;
    if (expected !== null && w.color !== expected)
      hints.push({
        id: 'LINT-WIRE-COLOR',
        wireIds: [w.id],
        partIds: [],
        params: { role, expected, color: w.color },
      });
    else if (
      expected === null &&
      conv.signalAvoid &&
      !powerish &&
      (w.color === conv.ground || w.color === conv.supply)
    )
      hints.push({ id: 'LINT-WIRE-COLOR', wireIds: [w.id], partIds: [], params: { role, color: w.color } });

    const pts = routeOf(doc, w, w.points);
    if (!pts) continue;
    if (isLong(pts))
      hints.push({
        id: 'LINT-WIRE-LONG',
        wireIds: [w.id],
        partIds: [],
        params: { length: Math.round(lengthOf(pts)) },
      });

    const over = grid.crossed(pts);
    if (over.length) hints.push({ id: 'LINT-WIRE-OVER-PART', wireIds: [w.id], partIds: over, params: {} });

    for (const o of index.overlaps(pts, net, OVERLAP_MIN_MM)) {
      const key = `${o.wire}\u0000${w.id}`;
      if (pairs.has(key)) continue;
      pairs.add(key);
      hints.push({ id: 'LINT-WIRE-OVERLAP', wireIds: [o.wire, w.id], partIds: [], params: {} });
    }
    index.add(pts, net, w.id);
  }

  // Many supply or ground wires into terminal strips: the − / + rail would be tidier (suggestion only).
  const toStrip = (r: PinRef): boolean => {
    const layout = breadboardLayout(byId.get(r.part)?.type ?? '');
    return !!layout && layout.railHoles > 0 && STRIP.test(r.pin);
  };
  const byNet = new Map<string, { role: NetRole; wires: string[] }>();
  for (const w of doc.wires) {
    const { role } = roleOf(w.from);
    if (role === 'signal' || !(toStrip(w.from) || toStrip(w.to))) continue;
    const net = nets.netOf(w.from);
    const entry = byNet.get(net) ?? { role, wires: [] };
    entry.wires.push(w.id);
    byNet.set(net, entry);
  }
  for (const { role, wires } of byNet.values())
    if (wires.length >= RAIL_HINT_WIRES)
      hints.push({
        id: 'LINT-RAIL-HINT',
        wireIds: wires,
        partIds: [],
        params: { role, count: wires.length },
      });

  return hints;
}

// ---------------------------------------------------------------- tidy

export interface TidyOptions {
  readonly recolour: boolean;
  readonly reroute: boolean;
  /** Give every signal net its own palette colour (otherwise only signals in the supply/ground colour change). */
  readonly recolourSignals?: boolean | undefined;
  /** Wires to tidy; all when absent. */
  readonly wires?: readonly string[] | undefined;
}

/** Tidy changed the netlist: a bug in tidy, never a user error. */
export class TidyInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TidyInvariantError';
  }
}

const round4 = (v: number): number => Math.round(v * 1e4) / 1e4;
const samePoint = (a: Point, b: Point): boolean => Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS;

/** Bend points without repeats or bends on a straight run. */
function cleanBends(a: Point, bends: readonly Point[], b: Point): Point[] {
  const pts: Point[] = [a];
  for (const p of [...bends, b]) if (!samePoint(pts[pts.length - 1] as Point, p)) pts.push(p);
  const out: Point[] = [pts[0] as Point];
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = out[out.length - 1] as Point;
    const [x, y] = pts[i] as Point;
    const [nx, ny] = pts[i + 1] as Point;
    const cross = (x - px) * (ny - y) - (y - py) * (nx - x);
    if (Math.abs(cross) > EPS) out.push(pts[i] as Point);
  }
  return out.slice(1);
}

function isOrthogonal(pts: readonly Point[]): boolean {
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1] as Point;
    const [x1, y1] = pts[i] as Point;
    if (Math.abs(x0 - x1) > EPS && Math.abs(y0 - y1) > EPS) return false;
  }
  return true;
}

/** Grid channels strictly between two coordinates, nearest their middle first (at most `LANES`). */
function lanes(p: number, q: number): number[] {
  const lo = Math.min(p, q);
  const hi = Math.max(p, q);
  const mid = (lo + hi) / 2;
  const out: number[] = [];
  for (let k = Math.floor(lo / PITCH) + 1; k * PITCH < hi - EPS; k++)
    if (k * PITCH > lo + EPS) out.push(k * PITCH);
  return out
    .sort((x, y) => Math.abs(x - mid) - Math.abs(y - mid) || x - y)
    .slice(0, LANES)
    .map(round4);
}

/** Channels just beyond either end (1–4 pitches), for when every channel between them is blocked. */
const outside = (p: number, q: number): number[] =>
  [1, 2, 3, 4].flatMap((k) => [round4(Math.max(p, q) + k * PITCH), round4(Math.min(p, q) - k * PITCH)]);

/**
 * Candidate routes in order: straight if aligned; L horizontal-first, L vertical-first; then Z routes
 * through the grid channels between the ends (horizontal and vertical, from the middle outwards), then
 * through channels just beyond the ends. Channels between the ends keep the route at the orthogonal
 * (Manhattan) length; those beyond cost a short detour, which the length term of the score weighs.
 */
function candidates(a: Point, b: Point): Point[][] {
  const [ax, ay] = a;
  const [bx, by] = b;
  const routes: (readonly Point[])[] = [];
  if (Math.abs(ax - bx) < EPS || Math.abs(ay - by) < EPS) {
    // Straight first, then U detours a few pitches to either side (two bends).
    const vertical = Math.abs(ax - bx) < EPS;
    routes.push([]);
    for (const k of [1, -1, 2, -2, 3, -3, 4, -4]) {
      const o = k * PITCH;
      routes.push(
        vertical
          ? [
              [round4(ax + o), ay],
              [round4(bx + o), by],
            ]
          : [
              [ax, round4(ay + o)],
              [bx, round4(by + o)],
            ],
      );
    }
    return routes.map((bends) => cleanBends(a, bends, b));
  }
  routes.push([[bx, ay]], [[ax, by]]);
  const xs = [...lanes(ax, bx), ...outside(ax, bx)];
  const ys = [...lanes(ay, by), ...outside(ay, by)];
  for (let i = 0; i < Math.max(xs.length, ys.length); i++) {
    const x = xs[i];
    const y = ys[i];
    if (x !== undefined)
      routes.push([
        [x, ay],
        [x, by],
      ]);
    if (y !== undefined)
      routes.push([
        [ax, y],
        [bx, y],
      ]);
  }
  return routes.map((bends) => cleanBends(a, bends, b));
}

/** Wires a selection covers: the selected wire and every wire ending on a selected part. Null when none. */
export function tidyScope(
  doc: ProjectDocument,
  selection: { readonly parts: readonly string[]; readonly wire: string | null },
): string[] | null {
  const parts = new Set(selection.parts);
  const ids = doc.wires
    .filter((w) => w.id === selection.wire || parts.has(w.from.part) || parts.has(w.to.part))
    .map((w) => w.id);
  return ids.length ? ids : null;
}

/**
 * Tidies wires in one pure, deterministic pass: recolour by net role, then reroute each wire with at most
 * two orthogonal bends, scored by part crossings × 1000 + overlaps × 100 + length. Wires are routed in
 * document order against the untouched wires and those already routed, so running it twice changes
 * nothing more. Throws `TidyInvariantError` if connectivity would change.
 */
export function tidyWires(
  doc: ProjectDocument,
  opts: TidyOptions,
  conv: WireConvention = DEFAULT_WIRE_CONVENTION,
): ProjectDocument {
  const scope = opts.wires ? new Set(opts.wires) : null;
  const inScope = (w: Wire): boolean => !scope || scope.has(w.id);
  const nets = new CircuitNets(doc);
  const roleOf = netRoles(doc, nets);
  const byId = new Map(doc.components.map((c) => [c.id, c]));
  const colour = new Map<string, string>();
  const bends = new Map<string, Point[]>();

  if (opts.recolour) {
    const palette = Object.keys(WIRE_COLORS).filter((c) => c !== conv.ground && c !== conv.supply);
    const signalColour = new Map<string, string>();
    for (const w of doc.wires) {
      if (!inScope(w)) continue;
      const { role, powerish } = roleOf(w.from);
      if (role === 'ground') colour.set(w.id, conv.ground);
      else if (role === 'supply') colour.set(w.id, conv.supply);
      else if (!powerish) {
        const offending = conv.signalAvoid && (w.color === conv.ground || w.color === conv.supply);
        if (!opts.recolourSignals && !offending) continue;
        const net = nets.netOf(w.from);
        let c = signalColour.get(net);
        if (!c) {
          c = palette[signalColour.size % palette.length] ?? 'yellow';
          signalColour.set(net, c);
        }
        colour.set(w.id, c);
      }
    }
  }

  if (opts.reroute) {
    const grid = new ObstacleGrid(doc);
    const index = new SegmentIndex();
    const hole = (r: PinRef): boolean => !!breadboardLayout(byId.get(r.part)?.type ?? '');
    for (const w of doc.wires) {
      if (inScope(w)) continue;
      const pts = routeOf(doc, w, w.points);
      if (pts) index.add(pts, nets.netOf(w.from), w.id);
    }
    for (const w of doc.wires) {
      if (!inScope(w)) continue;
      const ends = routeOf(doc, w, []);
      if (!ends) continue;
      const [a, b] = ends as [Point, Point];
      const net = nets.netOf(w.from);
      let best: Point[] = [];
      if (!(hole(w.from) && hole(w.to) && dist(a, b) <= SHORT_JUMPER_MM + EPS)) {
        let bestScore = Infinity;
        // A route that is already orthogonal (≤ 2 bends) competes first, so tidy wires stay as drawn.
        const own = cleanBends(a, w.points, b);
        const tidyNow = own.length <= 2 && isOrthogonal([a, ...own, b]);
        for (const c of tidyNow ? [own, ...candidates(a, b)] : candidates(a, b)) {
          const pts = [a, ...c, b];
          const score =
            grid.crossed(pts).length * 1000 +
            index.overlaps(pts, net, PITCH / 2).length * 100 +
            lengthOf(pts);
          if (score < bestScore - EPS) {
            bestScore = score;
            best = c;
          }
        }
      }
      bends.set(w.id, best);
      index.add([a, ...best, b], net, w.id);
    }
  }

  let changed = false;
  const wires = doc.wires.map((w) => {
    const c = colour.get(w.id) ?? w.color;
    const p = bends.get(w.id);
    const samePoints =
      !p || (p.length === w.points.length && p.every((q, i) => samePoint(q, w.points[i] as Point)));
    if (c === w.color && samePoints) return w;
    changed = true;
    return {
      ...w,
      color: c,
      points: p && !samePoints ? p.map(([x, y]) => [x, y] as [number, number]) : w.points,
    };
  });
  if (!changed) return doc;
  const out = { ...doc, wires };
  if (netSignature(out) !== netSignature(doc)) throw new TidyInvariantError('tidy changed the netlist');
  return out;
}

/** Ids of wires whose colour or route differs between two versions of a document. */
export function changedWires(before: ProjectDocument, after: ProjectDocument): string[] {
  const old = new Map(before.wires.map((w) => [w.id, w]));
  return after.wires.filter((w) => old.get(w.id) !== w).map((w) => w.id);
}
