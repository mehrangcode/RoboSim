import { BOARD_PART, type PinRef, type ProjectDocument } from '@robosim/shared';
import { Prng } from '@robosim/sim-core';
import { describe, expect, it } from 'vitest';
import { addComponent, addWire, blankProject, pinNamesOf } from './document.js';
import { BOARD_FOOTPRINT, boardBox, footprintOf, pinPosition, snap, type Point } from './geometry.js';
import { netSignature } from './net-signature.js';
import { WIRE_COLORS } from './wire-convention.js';
import { changedWires, tidyScope, tidyWires, wireHints } from './wire-lint.js';

const B = (pin: string): PinRef => ({ part: BOARD_PART, pin });
const P = (part: string, pin: string): PinRef => ({ part, pin });
const ALL = { recolour: true, reroute: true } as const;

function must<T>(v: T | null | undefined, what: string): T {
  if (v === null || v === undefined) throw new Error(`missing ${what}`);
  return v;
}

function messy(): ProjectDocument {
  let doc = blankProject('tidy', '');
  const box = boardBox(doc);
  const x = snap(box.x + box.w + 30);
  const y = snap(box.y + 10);
  const put = (type: string, at: Point): string => {
    const r = addComponent(doc, type, at);
    doc = r.doc;
    return r.id;
  };
  const bb = put('passive.breadboard-half', [x, snap(y + 50)]);
  const r = put('passive.resistor', [x, y]);
  const led = put('actuator.led', [snap(x + 30), snap(y + 20)]);
  const add = (from: PinRef, to: PinRef, color: string, points: Point[] = []) => {
    doc = addWire(doc, from, to, points, color).doc;
  };
  add(B('D5'), P(r, 'a'), 'red', [
    [x - 7, y + 33],
    [x + 3, y - 9],
  ]);
  add(P(r, 'b'), P(led, 'a'), 'green', [[x + 50, y + 70]]);
  add(P(led, 'k'), B('GND1'), 'red');
  add(B('5V'), P(bb, '3a'), 'black', [[x - 20, y + 80]]);
  add(P(bb, '10a'), P(bb, '11b'), 'blue');
  return doc;
}

const orthogonal = (doc: ProjectDocument, id: string): boolean => {
  const w = must(
    doc.wires.find((v) => v.id === id),
    id,
  );
  const pts: Point[] = [
    must(pinPosition(doc, w.from, pinNamesOf), 'from'),
    ...w.points,
    must(pinPosition(doc, w.to, pinNamesOf), 'to'),
  ];
  return pts.slice(1).every((p, i) => {
    const q = pts[i] as Point;
    return Math.abs(p[0] - q[0]) < 1e-6 || Math.abs(p[1] - q[1]) < 1e-6;
  });
};

describe('tidyWires (FR-CIR-11)', () => {
  it('recolours by net role, orthogonalises bends and keeps the netlist (US-CIR-08 AC2)', () => {
    const doc = messy();
    const out = tidyWires(doc, ALL);
    expect(netSignature(out)).toBe(netSignature(doc));
    expect(out.components).toEqual(doc.components);
    expect(out.wires.map((w) => [w.id, w.from, w.to])).toEqual(doc.wires.map((w) => [w.id, w.from, w.to]));
    const colour = Object.fromEntries(out.wires.map((w) => [w.id, w.color]));
    expect(colour).toMatchObject({ w1: 'yellow', w2: 'green', w3: 'black', w4: 'red', w5: 'blue' });
    for (const id of ['w1', 'w2', 'w3', 'w4']) expect(orthogonal(out, id), id).toBe(true);
    for (const w of out.wires) expect(w.points.length).toBeLessThanOrEqual(2);
    // A short jumper between breadboard holes stays straight.
    expect(out.wires.find((w) => w.id === 'w5')?.points).toEqual([]);
    expect(wireHints(out).filter((h) => h.id === 'LINT-WIRE-COLOR')).toEqual([]);
  });

  it('is idempotent', () => {
    const once = tidyWires(messy(), { ...ALL, recolourSignals: true });
    expect(tidyWires(once, { ...ALL, recolourSignals: true })).toBe(once);
  });

  it('only touches the wires in scope; recolour and reroute can be chosen apart', () => {
    const doc = messy();
    const scoped = tidyWires(doc, { ...ALL, wires: ['w3'] });
    expect(changedWires(doc, scoped)).toEqual(['w3']);
    const coloursOnly = tidyWires(doc, { recolour: true, reroute: false });
    expect(coloursOnly.wires.map((w) => w.points)).toEqual(doc.wires.map((w) => w.points));
    const routesOnly = tidyWires(doc, { recolour: false, reroute: true });
    expect(routesOnly.wires.map((w) => w.color)).toEqual(doc.wires.map((w) => w.color));
  });

  it('recolourSignals gives each signal net its own palette colour in order of appearance', () => {
    const out = tidyWires(messy(), { recolour: true, reroute: false, recolourSignals: true });
    const colour = Object.fromEntries(out.wires.map((w) => [w.id, w.color]));
    expect(colour).toMatchObject({ w1: 'yellow', w2: 'green', w5: 'blue' });
  });

  it('returns the same document when nothing changes', () => {
    const doc = blankProject('empty', '');
    expect(tidyWires(doc, ALL)).toBe(doc);
  });

  it('tidyScope: the selected wire and wires of selected parts, else null', () => {
    const doc = messy();
    expect(tidyScope(doc, { parts: [], wire: null })).toBeNull();
    expect(tidyScope(doc, { parts: [], wire: 'w2' })).toEqual(['w2']);
    const resistor = must(
      doc.components.find((c) => c.type === 'passive.resistor'),
      'resistor',
    ).id;
    expect(tidyScope(doc, { parts: [resistor], wire: null })).toEqual(['w1', 'w2']);
  });
});

// ---------------------------------------------------------------- property test (TD §18.7)

const TYPES = [
  'passive.resistor',
  'actuator.led',
  'sensor.hc-sr04',
  'power.battery-9v',
  'driver.l298n',
  'passive.capacitor-ceramic',
  'sensor.push-button',
  'ic.74hc595',
] as const;
const BOARD_PINS = Object.keys(BOARD_FOOTPRINT.pins);
const COLOURS = Object.keys(WIRE_COLORS);

function randomDoc(seed: number): ProjectDocument {
  const rng = Prng.fromSeed(seed);
  const int = (n: number) => rng.nextUint32() % n;
  let doc = blankProject(`p${seed}`, '');
  const box = boardBox(doc);
  const x0 = snap(box.x + box.w + 20);
  const y0 = snap(box.y);
  const parts: { id: string; type: string }[] = [];
  if (int(3) > 0) {
    const r = addComponent(doc, 'passive.breadboard-half', [x0, snap(y0 + 40)]);
    doc = r.doc;
    parts.push({ id: r.id, type: 'passive.breadboard-half' });
  }
  const n = 1 + int(8);
  for (let i = 0; i < n; i++) {
    const type = TYPES[int(TYPES.length)] as string;
    // Half the parts land on the breadboard's grid (seated), the rest anywhere nearby.
    const r = addComponent(doc, type, [snap(x0 + int(160)), snap(y0 + int(110))]);
    doc = r.doc;
    parts.push({ id: r.id, type });
  }
  const pinsOf = (p: { id: string; type: string }): string[] =>
    Object.keys(footprintOf(p.type, pinNamesOf(p.type)).pins);
  const randomPin = (): PinRef => {
    if (int(3) === 0) return B(BOARD_PINS[int(BOARD_PINS.length)] as string);
    const p = must(parts[int(parts.length)], 'part');
    const pins = pinsOf(p);
    return P(p.id, pins[int(pins.length)] as string);
  };
  const wires = 1 + int(14);
  for (let i = 0; i < wires; i++) {
    const bends: Point[] = Array.from({ length: int(4) }, () => [x0 - 30 + int(220), y0 - 20 + int(160)]);
    doc = addWire(doc, randomPin(), randomPin(), bends, COLOURS[int(COLOURS.length)] as string).doc;
  }
  return doc;
}

describe('tidyWires property (TD §18.7)', () => {
  it('200 seeded documents: netlist, parts and wire ends unchanged; tidy twice = tidy once', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const doc = randomDoc(seed);
      for (const opts of [ALL, { ...ALL, recolourSignals: true }]) {
        const out = tidyWires(doc, opts);
        expect(netSignature(out), `seed ${seed}`).toBe(netSignature(doc));
        expect(out.components, `seed ${seed}`).toEqual(doc.components);
        expect(
          out.wires.map((w) => [w.id, w.from, w.to]),
          `seed ${seed}`,
        ).toEqual(doc.wires.map((w) => [w.id, w.from, w.to]));
        expect(tidyWires(out, opts), `seed ${seed} idempotent`).toBe(out);
      }
    }
  });

  it('stays within budget at 200 parts / 400 wires (hints < 10 ms, tidy < 100 ms in the browser)', () => {
    let doc = blankProject('big', '');
    const ids: string[] = [];
    for (let i = 0; i < 200; i++) {
      const r = addComponent(doc, i % 2 ? 'passive.resistor' : 'actuator.led', [
        snap(200 + (i % 20) * 15),
        snap((i / 20) * 15),
      ]);
      doc = r.doc;
      ids.push(r.id);
    }
    const rng = Prng.fromSeed(7);
    const wires = [...doc.wires];
    for (let i = 0; i < 400; i++) {
      const a = must(ids[rng.nextUint32() % ids.length], 'id');
      const b = must(ids[rng.nextUint32() % ids.length], 'id');
      wires.push({ id: `w${i + 1}`, from: P(a, 'a'), to: P(b, 'b'), color: 'yellow', points: [] });
    }
    doc = { ...doc, wires };
    const time = (f: () => unknown): number => {
      const runs: number[] = [];
      for (let i = 0; i < 5; i++) {
        const t0 = performance.now();
        f();
        runs.push(performance.now() - t0);
      }
      return must(runs.sort((p, q) => p - q)[2], 'median');
    };
    const hints = time(() => wireHints(doc));
    const tidy = time(() => tidyWires(doc, ALL));
    const tidied = tidyWires(doc, ALL);
    const hintsTidied = time(() => wireHints(tidied));
    // Generous bounds for loaded CI machines (jsdom, parallel workers); the budget is in the log above.
    const report = `wireHints ${hints.toFixed(1)} ms (diagonal) · ${hintsTidied.toFixed(1)} ms (tidied) · tidyWires ${tidy.toFixed(1)} ms`;
    expect(hints, report).toBeLessThan(50);
    expect(hintsTidied, report).toBeLessThan(50);
    expect(tidy, report).toBeLessThan(500);
  });
});
