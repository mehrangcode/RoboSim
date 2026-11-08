import { BOARD_PART, type ComponentInstance, type PinRef, type ProjectDocument } from '@robosim/shared';
import { describe, expect, it } from 'vitest';
import { addComponent, addWire, blankProject, pinNamesOf } from './document.js';
import { PITCH, boardBox, footprintOf, pinPosition, placedBox, snap, type Point } from './geometry.js';
import { wireHints, type WireHint } from './wire-lint.js';

const B = (pin: string): PinRef => ({ part: BOARD_PART, pin });
const P = (part: string, pin: string): PinRef => ({ part, pin });

/** A blank project with a spot to the right of the board (on the grid), and helpers that edit it. */
function setup() {
  const blank = blankProject('lint', '');
  const box = boardBox(blank);
  const c = {
    doc: blank,
    x: snap(box.x + box.w + 30),
    y: snap(box.y + 10),
    put(type: string, at: Point): string {
      const r = addComponent(c.doc, type, [snap(at[0]), snap(at[1])]);
      c.doc = r.doc;
      return r.id;
    },
    wire(from: PinRef, to: PinRef, color: string, points: Point[] = []): void {
      c.doc = addWire(c.doc, from, to, points, color).doc;
    },
  };
  return c;
}

const at = (doc: ProjectDocument, r: PinRef): Point => {
  const p = pinPosition(doc, r, pinNamesOf);
  if (!p) throw new Error(`no pin ${r.part}.${r.pin}`);
  return p;
};

const ids = (hints: readonly WireHint[], id: WireHint['id']) =>
  hints.filter((h) => h.id === id).map((h) => h.wireIds.join(','));

describe('wireHints (FR-CIR-11)', () => {
  it('LINT-WIRE-COLOR: a 5 V wire drawn black and a GND wire drawn red get a hint each (US-CIR-08 AC1)', () => {
    const c = setup();
    const { x, y } = c;
    const led = c.put('actuator.led', [x, y]);
    c.wire(B('5V'), P(led, 'a'), 'black');
    c.wire(B('GND1'), P(led, 'k'), 'red');
    const hints = wireHints(c.doc).filter((h) => h.id === 'LINT-WIRE-COLOR');
    expect(hints).toEqual([
      {
        id: 'LINT-WIRE-COLOR',
        wireIds: ['w1'],
        partIds: [],
        params: { role: 'supply', expected: 'red', color: 'black' },
      },
      {
        id: 'LINT-WIRE-COLOR',
        wireIds: ['w2'],
        partIds: [],
        params: { role: 'ground', expected: 'black', color: 'red' },
      },
    ]);
  });

  it('respects a user convention, and a supply output of a part makes a supply net', () => {
    const c = setup();
    const { x, y } = c;
    const bat = c.put('power.battery-9v', [x, y]);
    const r = c.put('passive.resistor', [x + 30, y]);
    c.wire(P(bat, 'pos'), P(r, 'a'), 'orange');
    c.wire(P(bat, 'neg'), B('GND2'), 'blue');
    const conv = { ground: 'blue', supply: 'orange', signalAvoid: true };
    expect(ids(wireHints(c.doc, conv), 'LINT-WIRE-COLOR')).toEqual([]);
    expect(ids(wireHints(c.doc), 'LINT-WIRE-COLOR')).toEqual(['w1', 'w2']);
  });

  it('LINT-WIRE-COLOR: a signal wire in red or black, unless the convention allows it', () => {
    const c = setup();
    const { x, y } = c;
    const r = c.put('passive.resistor', [x, y]);
    c.wire(B('D5'), P(r, 'a'), 'red');
    expect(wireHints(c.doc).find((h) => h.id === 'LINT-WIRE-COLOR')?.params).toEqual({
      role: 'signal',
      color: 'red',
    });
    expect(
      ids(wireHints(c.doc, { ground: 'black', supply: 'red', signalAvoid: false }), 'LINT-WIRE-COLOR'),
    ).toEqual([]);
  });

  it('a red wire to a sensor VCC that is not yet powered is not called a signal in red', () => {
    const c = setup();
    const { x, y } = c;
    const bb = c.put('passive.breadboard-half', [x, y + 40]);
    const s = c.put('sensor.hc-sr04', [x, y]);
    c.wire(P(s, 'vcc'), P(bb, '30j'), 'red');
    expect(ids(wireHints(c.doc), 'LINT-WIRE-COLOR')).toEqual([]);
  });

  it('LINT-WIRE-LONG: a long detour, but not a short straight wire', () => {
    const c = setup();
    const { x, y } = c;
    const r = c.put('passive.resistor', [x, y]);
    const a = at(c.doc, B('D5'));
    c.wire(B('D5'), P(r, 'a'), 'yellow');
    c.wire(B('D6'), P(r, 'b'), 'green', [
      [a[0], a[1] + 120],
      [x + 40, a[1] + 120],
    ]);
    const long = wireHints(c.doc).filter((h) => h.id === 'LINT-WIRE-LONG');
    expect(long.map((h) => h.wireIds)).toEqual([['w2']]);
    expect(long[0]?.params['length']).toBeGreaterThan(150);
  });

  it('LINT-WIRE-OVER-PART: a wire across a part it does not connect to; its own ends are exempt', () => {
    const c = setup();
    const { x, y } = c;
    const r = c.put('passive.resistor', [x, y + 40]);
    const led = c.put('actuator.led', [x + 60, y]);
    const box = placedBox(
      c.doc.components[0] as ComponentInstance,
      footprintOf('passive.resistor', pinNamesOf('passive.resistor')),
    );
    const cy = box.y + box.h / 2;
    c.wire(B('D5'), P(led, 'a'), 'yellow', [
      [box.x - 10, cy],
      [box.x + box.w + 10, cy],
    ]);
    c.wire(B('D6'), P(r, 'a'), 'green');
    const over = wireHints(c.doc).filter((h) => h.id === 'LINT-WIRE-OVER-PART');
    expect(over).toEqual([{ id: 'LINT-WIRE-OVER-PART', wireIds: ['w1'], partIds: [r], params: {} }]);
  });

  it('LINT-WIRE-OVERLAP: collinear wires of different nets sharing ≥ 2 pitches; same net is fine', () => {
    const c = setup();
    const { x, y } = c;
    const r1 = c.put('passive.resistor', [x, y]);
    const r2 = c.put('passive.resistor', [x, y + 20]);
    const Y = snap(y + 60);
    c.wire(B('D5'), P(r1, 'a'), 'yellow', [
      [x - 20, Y],
      [x + 20, Y],
    ]);
    c.wire(B('D6'), P(r2, 'a'), 'green', [
      [x - 15, Y],
      [x + 25, Y],
    ]);
    // Same net as w1 (D5): overlapping it is not a readability problem.
    c.wire(B('D5'), P(r1, 'b'), 'blue', [
      [x - 18, Y],
      [x + 18, Y],
    ]);
    const overlap = wireHints(c.doc).filter((h) => h.id === 'LINT-WIRE-OVERLAP');
    expect(overlap.map((h) => h.wireIds)).toEqual([
      ['w1', 'w2'],
      ['w2', 'w3'],
    ]);
  });

  it('a short collinear touch below 2 pitches is not an overlap', () => {
    const c = setup();
    const { x, y } = c;
    const r1 = c.put('passive.resistor', [x, y]);
    const r2 = c.put('passive.resistor', [x, y + 20]);
    const Y = snap(y + 60);
    c.wire(B('D5'), P(r1, 'a'), 'yellow', [
      [x - 20, Y],
      [x, Y],
    ]);
    c.wire(B('D6'), P(r2, 'a'), 'green', [
      [x - PITCH, Y],
      [x + 20, Y],
    ]);
    expect(ids(wireHints(c.doc), 'LINT-WIRE-OVERLAP')).toEqual([]);
  });

  it('LINT-RAIL-HINT: three ground wires into terminal strips suggest the rail; rail holes do not count', () => {
    const c = setup();
    const { x, y } = c;
    const bb = c.put('passive.breadboard-half', [x, y]);
    c.wire(B('GND1'), P(bb, '1a'), 'black');
    c.wire(B('GND2'), P(bb, '5a'), 'black');
    expect(ids(wireHints(c.doc), 'LINT-RAIL-HINT')).toEqual([]);
    c.wire(B('GND3'), P(bb, '9a'), 'black');
    c.wire(B('GND1'), P(bb, 'tn1'), 'black');
    const rail = wireHints(c.doc).filter((h) => h.id === 'LINT-RAIL-HINT');
    expect(rail).toEqual([
      {
        id: 'LINT-RAIL-HINT',
        wireIds: ['w1', 'w2', 'w3'],
        partIds: [],
        params: { role: 'ground', count: 3 },
      },
    ]);
  });

  it('a tidy, conventional circuit has no hints', () => {
    const c = setup();
    const { x, y } = c;
    const r = c.put('passive.resistor', [x, y]);
    const led = c.put('actuator.led', [x + 20, y + 20]);
    const d5 = at(c.doc, B('D5'));
    const ra = at(c.doc, P(r, 'a'));
    c.wire(B('D5'), P(r, 'a'), 'yellow', [[d5[0], ra[1]]]);
    const rb = at(c.doc, P(r, 'b'));
    const la = at(c.doc, P(led, 'a'));
    c.wire(P(r, 'b'), P(led, 'a'), 'green', [[la[0], rb[1]]]);
    c.wire(P(led, 'k'), B('GND1'), 'black');
    expect(wireHints(c.doc)).toEqual([]);
  });
});
