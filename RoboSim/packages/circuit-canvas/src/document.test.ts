import { CATALOG_MANIFESTS } from '@robosim/catalog/manifests';
import { parseProjectDocument, type ProjectDocument } from '@robosim/shared';
import { describe, expect, it } from 'vitest';
import {
  HISTORY_LIMIT,
  addComponent,
  alignComponents,
  addWire,
  blankProject,
  commit,
  deleteComponents,
  distributeComponents,
  duplicateComponents,
  flipComponents,
  moveComponents,
  partBox,
  pinNamesOf,
  redo,
  rotateComponents,
  startHistory,
  undo,
} from './document.js';
import { PITCH, boardBox, footprintOf, hasArt, pinPosition, place, withSeats, type Box } from './geometry.js';
import { CircuitNets } from './nets.js';

const at = (gx: number, gy: number) => [gx * PITCH, gy * PITCH] as const;
const pos = (doc: ProjectDocument, part: string, pin: string) => pinPosition(doc, { part, pin }, pinNamesOf);
function boxOf(doc: ProjectDocument, id: string) {
  const box = partBox(doc, id);
  if (!box) throw new Error(`no part ${id}`);
  return box;
}

/** Half breadboard at the origin, a resistor in 10a–14a and an LED in 14c/15c. */
function breadboardCircuit() {
  let doc = blankProject('t', '');
  ({ doc } = addComponent(doc, 'passive.breadboard-half', at(0, 0)));
  ({ doc } = addComponent(doc, 'passive.resistor', at(10, 3)));
  ({ doc } = addComponent(doc, 'actuator.led', at(14, 5)));
  return doc;
}

describe('footprints', () => {
  it('every catalogue part has art with exactly its manifest pins on the grid', () => {
    for (const m of CATALOG_MANIFESTS) {
      expect(hasArt(m.id), m.id).toBe(true);
      const fp = footprintOf(m.id, pinNamesOf(m.id));
      expect(Object.keys(fp.pins).sort(), m.id).toEqual(m.pins.map((p) => p.name).sort());
      for (const [x, y] of Object.values(fp.pins))
        expect(Number.isInteger(x) && Number.isInteger(y), m.id).toBe(true);
    }
  });

  it('rotates clockwise and flips around the origin', () => {
    const c = { x: 10, y: 20, rotation: 0 as const, flipped: false };
    expect(place(c, [1, 0])).toEqual([10 + PITCH, 20]);
    expect(place({ ...c, rotation: 90 }, [1, 0])).toEqual([10, 20 + PITCH]);
    expect(place({ ...c, rotation: 180 }, [1, 0])).toEqual([10 - PITCH, 20]);
    expect(place({ ...c, rotation: 270 }, [1, 0])).toEqual([10, 20 - PITCH]);
    expect(place({ ...c, flipped: true }, [1, 0])).toEqual([10 - PITCH, 20]);
  });
});

describe('editing a project document', () => {
  it('seats legs that land on breadboard holes, and the result is a valid document', () => {
    const doc = breadboardCircuit();
    const [, r1, led] = doc.components;
    expect(r1?.seats).toEqual({ a: { part: 'bb1', pin: '10a' }, b: { part: 'bb1', pin: '14a' } });
    expect(led?.seats).toEqual({ a: { part: 'bb1', pin: '14c' }, k: { part: 'bb1', pin: '15c' } });
    expect(parseProjectDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });

  it('unseats a part moved off the breadboard; breadboard moves carry plugged parts', () => {
    let doc = breadboardCircuit();
    doc = moveComponents(doc, ['led1'], 0, -20 * PITCH);
    expect(doc.components[2]?.seats).toBeUndefined();
    doc = moveComponents(doc, ['bb1'], 5 * PITCH, 0);
    expect(doc.components[1]).toMatchObject({ x: 15 * PITCH, seats: { a: { part: 'bb1', pin: '10a' } } });
    expect(doc.components[2]).toMatchObject({ x: 14 * PITCH });
  });

  it('rotation and flip keep the first leg in its hole', () => {
    let doc = breadboardCircuit();
    const before = pos(doc, 'r1', 'a');
    doc = rotateComponents(doc, ['r1']);
    expect(pos(doc, 'r1', 'a')).toEqual(before);
    expect(doc.components[1]?.seats).toEqual({
      a: { part: 'bb1', pin: '10a' },
      b: { part: 'bb1', pin: '10e' },
    });
    doc = flipComponents(rotateComponents(doc, ['r1']), ['r1']);
    expect(pos(doc, 'r1', 'a')).toEqual(before);
  });

  it('deleting a breadboard removes its wires and every seat in it', () => {
    let doc = breadboardCircuit();
    ({ doc } = addWire(doc, { part: 'board', pin: 'D13' }, { part: 'bb1', pin: '10e' }, [], 'yellow'));
    doc = deleteComponents(doc, ['bb1']);
    expect(doc.wires).toEqual([]);
    expect(doc.components.every((c) => c.seats === undefined)).toBe(true);
  });

  it('a 7-segment digit straddles the channel (rows d and h) and its two commons are one net', () => {
    let doc = blankProject('t', '');
    ({ doc } = addComponent(doc, 'passive.breadboard-half', at(0, 0)));
    ({ doc } = addComponent(doc, 'display.seven-segment', at(20, 6)));
    const seg = doc.components[1];
    expect(Object.keys(seg?.seats ?? {})).toHaveLength(10);
    expect(seg?.seats?.['g']).toEqual({ part: 'bb1', pin: '20d' });
    expect(seg?.seats?.['e']).toEqual({ part: 'bb1', pin: '20h' });
    const nets = new CircuitNets(doc);
    expect(nets.connectedTo({ part: 'seg1', pin: 'com1' })).toContainEqual({ part: 'seg1', pin: 'com2' });
  });

  it('gives new and duplicated parts fresh ids', () => {
    let doc = breadboardCircuit();
    const dup = duplicateComponents(doc, ['r1', 'led1']);
    expect(dup.ids).toEqual(['r2', 'led2']);
    ({ doc } = addComponent(dup.doc, 'passive.resistor', at(40, 40)));
    expect(doc.components.at(-1)?.id).toBe('r3');
    expect(addWire(doc, { part: 'r1', pin: 'a' }, { part: 'r1', pin: 'a' }, [], 'red').id).toBeNull();
  });

  it('duplicates a group with the wires between its parts, and a breadboard with its passengers', () => {
    let doc = breadboardCircuit();
    ({ doc } = addWire(doc, { part: 'r1', pin: 'b' }, { part: 'led1', pin: 'a' }, [[0, 0]], 'green'));
    ({ doc } = addWire(doc, { part: 'board', pin: 'D13' }, { part: 'r1', pin: 'a' }, [], 'yellow'));
    const dup = duplicateComponents(doc, ['r1', 'led1']);
    expect(dup.doc.wires.slice(2)).toEqual([
      {
        id: 'w3',
        from: { part: 'r2', pin: 'b' },
        to: { part: 'led2', pin: 'a' },
        color: 'green',
        points: [[2 * PITCH, 2 * PITCH]],
      },
    ]);
    const whole = duplicateComponents(doc, ['bb1']);
    expect(whole.ids).toEqual(['bb2', 'r2', 'led2']);
    expect(whole.doc.components.find((c) => c.id === 'r2')?.seats?.['a']).toEqual({
      part: 'bb2',
      pin: '10a',
    });
    expect(duplicateComponents(doc, ['board']).ids).toEqual([]);
  });

  it('turns a group as one rigid body around its centre, passengers included', () => {
    let doc = breadboardCircuit();
    const nets = (d: ProjectDocument) => new CircuitNets(d).connectedTo({ part: 'r1', pin: 'b' });
    const before = nets(doc);
    doc = rotateComponents(doc, ['bb1']);
    expect(doc.components.map((c) => c.rotation)).toEqual([90, 90, 90]);
    expect(nets(doc)).toEqual(before);
    doc = rotateComponents(rotateComponents(rotateComponents(doc, ['bb1']), ['bb1']), ['bb1']);
    expect(doc).toEqual(breadboardCircuit());
    let pair = flipComponents(breadboardCircuit(), ['r1', 'led1']);
    expect(pair.components.slice(1).map((c) => c.flipped)).toEqual([true, true]);
    pair = flipComponents(pair, ['r1', 'led1']);
    expect(pair).toEqual(breadboardCircuit());
  });

  it('aligns and distributes parts on the grid; passengers of a selected breadboard ride along', () => {
    let doc = blankProject('t', '');
    for (const [gx, gy] of [
      [0, 0],
      [9, 4],
      [30, 9],
    ] as const)
      ({ doc } = addComponent(doc, 'passive.resistor', at(gx, gy)));
    const top = alignComponents(doc, ['r1', 'r2', 'r3'], 'top');
    expect(new Set(top.components.map((c) => partBox(top, c.id)?.y))).toEqual(
      new Set([partBox(doc, 'r1')?.y]),
    );
    const right = alignComponents(doc, ['r1', 'r2', 'r3'], 'right');
    expect(right.components.map((c) => c.x)).toEqual([30 * PITCH, 30 * PITCH, 30 * PITCH]);
    const spread = distributeComponents(doc, ['r1', 'r2', 'r3'], 'horizontal');
    const [a, b, c] = ['r1', 'r2', 'r3'].map((id) => boxOf(spread, id)) as [Box, Box, Box];
    expect(b.x - (a.x + a.w)).toBeCloseTo(c.x - (b.x + b.w), 5);
    expect(distributeComponents(doc, ['r1', 'r2'], 'vertical')).toBe(doc);

    const bb = alignComponents(breadboardCircuit(), ['bb1', 'r1', 'board'], 'left');
    expect(bb.components.find((v) => v.id === 'r1')?.seats).toEqual(breadboardCircuit().components[1]?.seats);
    expect(Math.abs(boardBox(bb).x - boxOf(bb, 'bb1').x)).toBeLessThanOrEqual(PITCH / 2);
  });

  it('moves and turns the board like a part, but never deletes or mirrors it', () => {
    let doc = breadboardCircuit();
    ({ doc } = addWire(doc, { part: 'board', pin: 'D13' }, { part: 'bb1', pin: '10e' }, [], 'yellow'));
    const [x13, y13] = pos(doc, 'board', 'D13') ?? [NaN, NaN];
    doc = moveComponents(doc, ['board'], 3 * PITCH, -2 * PITCH);
    expect(doc.board.position).toEqual({ x: 3 * PITCH, y: -2 * PITCH, rotation: 0 });
    expect(pos(doc, 'board', 'D13')).toEqual([x13 + 3 * PITCH, y13 - 2 * PITCH]);
    doc = rotateComponents(doc, ['board']);
    expect(doc.board.position?.rotation).toBe(90);
    expect(flipComponents(doc, ['board'])).toBe(doc);
    expect(deleteComponents(doc, ['board'])).toBe(doc);
    expect(parseProjectDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });

  it('keeps at least 100 undo steps and redoes them', () => {
    let h = startHistory(blankProject('t', ''));
    for (let i = 0; i < 150; i++)
      h = commit(h, addComponent(h.present, 'passive.resistor', at(i * 6, 0)).doc);
    for (let i = 0; i < 100; i++) h = undo(h);
    expect(h.present.components).toHaveLength(50);
    expect(h.past.length).toBeGreaterThanOrEqual(0);
    h = redo(h);
    expect(h.present.components).toHaveLength(51);
    expect(HISTORY_LIMIT).toBeGreaterThanOrEqual(100);
  });
});

describe('circuit nets', () => {
  it('joins wires, seated legs, breadboard strips and the board grounds', () => {
    let doc = breadboardCircuit();
    ({ doc } = addWire(doc, { part: 'board', pin: 'D13' }, { part: 'bb1', pin: '10e' }, [], 'yellow'));
    ({ doc } = addWire(doc, { part: 'bb1', pin: '15e' }, { part: 'board', pin: 'GND1' }, [], 'black'));
    const nets = new CircuitNets(doc);
    expect(nets.sameNet({ part: 'board', pin: 'D13' }, { part: 'r1', pin: 'a' })).toBe(true);
    expect(nets.sameNet({ part: 'r1', pin: 'b' }, { part: 'led1', pin: 'a' })).toBe(true);
    expect(nets.sameNet({ part: 'led1', pin: 'k' }, { part: 'board', pin: 'GND3' })).toBe(true);
    expect(nets.sameNet({ part: 'r1', pin: 'a' }, { part: 'r1', pin: 'b' })).toBe(false);
    expect(nets.connectedTo({ part: 'board', pin: 'D13' })).toContainEqual({ part: 'bb1', pin: '10c' });
    expect(nets.connectedTo({ part: 'board', pin: 'A5' })).toEqual([{ part: 'board', pin: 'A5' }]);
  });

  it('rebuilds in < 16 ms for 200 parts and 400 wires (FR-CIR-04)', () => {
    let doc = withSeats(blankProject('t', ''), pinNamesOf);
    for (let i = 0; i < 4; i++) doc = addComponent(doc, 'passive.breadboard-full', at(0, i * 22)).doc;
    for (let i = 0; i < 196; i++)
      doc = addComponent(doc, 'passive.resistor', at(1 + (i % 60), 3 + 22 * (i % 4))).doc;
    for (let i = 0; i < 400; i++)
      doc = addWire(
        doc,
        { part: `r${(i % 196) + 1}`, pin: 'a' },
        { part: `bb${(i % 4) + 1}`, pin: `${(i % 60) + 1}j` },
        [],
        'red',
      ).doc;
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      new CircuitNets(doc);
      times.push(performance.now() - t0);
    }
    expect(Math.min(...times)).toBeLessThan(16);
  });
});
