import { BOARD_PART, type CatalogPrice, type ComponentInstance, type ProjectDocument } from '@robosim/shared';
import { describe, expect, it } from 'vitest';
import { buildBom, connectorOf, jumperOf, priceBom } from './bom.js';
import { blankProject } from './document.js';
import { stepFocus, stripOf, wiringGuide } from './wiring.js';

const part = (
  id: string,
  type: string,
  props: ComponentInstance['props'] = {},
  seats?: ComponentInstance['seats'],
) =>
  ({
    id,
    type,
    typeVersion: '1.0.0',
    x: 0,
    y: 0,
    rotation: 0,
    flipped: false,
    props,
    ...(seats ? { seats } : {}),
  }) as const;
let n = 0;
const wire = (from: string, fromPin: string, to: string, toPin: string, color = 'yellow') => ({
  id: `w${++n}`,
  from: { part: from, pin: fromPin },
  to: { part: to, pin: toPin },
  color,
  points: [],
});

/** A small robot: Uno → L298N → two motors on 4×AA, a line sensor, and an LED with resistor on a breadboard. */
function robot(): ProjectDocument {
  n = 0;
  return {
    ...blankProject('Robot', ''),
    components: [
      part('drv', 'driver.l298n'),
      part('m1', 'actuator.tt-motor'),
      part('m2', 'actuator.tt-motor', { gearRatio: 120 }),
      part('bat', 'power.battery-4aa'),
      part('line', 'sensor.line-3ch'),
      part('bb', 'passive.breadboard-half'),
      part(
        'r1',
        'passive.resistor',
        { ohms: 220 },
        { a: { part: 'bb', pin: '10a' }, b: { part: 'bb', pin: '14a' } },
      ),
      part('r2', 'passive.resistor', { ohms: 10000 }),
      part('r3', 'passive.resistor', {}),
      part(
        'led',
        'actuator.led',
        { color: 'green' },
        { a: { part: 'bb', pin: '14c' }, k: { part: 'bb', pin: '15c' } },
      ),
    ],
    wires: [
      wire(BOARD_PART, 'D5', 'drv', 'in1'), // socket → header: M-F
      wire(BOARD_PART, 'D6', 'drv', 'in2'),
      wire('drv', 'out1', 'm1', 'm1'), // motor lead: no jumper
      wire('bat', 'pos', 'drv', 'vs', 'red'), // battery lead: no jumper
      wire(BOARD_PART, 'GND1', 'drv', 'gnd', 'black'), // socket → terminal: M-M
      wire(BOARD_PART, '5V', 'line', 'vcc', 'red'),
      wire(BOARD_PART, 'A0', 'line', 'left'),
      wire(BOARD_PART, 'D9', 'bb', '10e'), // into r1's strip: M-M
      wire('bb', '15e', 'bb', 'tn1', 'black'), // LED cathode strip to the ground rail
      wire('line', 'right', 'drv', 'in3'), // header → header: F-F
    ],
  };
}

describe('buildBom', () => {
  it('groups parts by type and variant props, ignoring settings', () => {
    const bom = buildBom(robot());
    const qty = Object.fromEntries(bom.map((l) => [l.key, l.quantity]));
    expect(qty).toMatchObject({
      'board:avr-uno': 1,
      'driver.l298n': 1,
      'actuator.tt-motor': 2, // gearRatio is a setting, not a different part
      'passive.resistor?ohms=220': 2, // r3 uses the default 220 Ω
      'passive.resistor?ohms=10000': 1,
      'actuator.led?color=green': 1,
      'passive.breadboard-half': 1,
    });
    expect(bom.find((l) => l.key === 'passive.resistor?ohms=220')?.instances).toEqual(['r1', 'r3']);
    expect(bom[0]?.kind).toBe('board');
  });

  it('counts jumpers by type in packs with spares; leads need none', () => {
    const doc = robot();
    expect(connectorOf(doc, { part: 'drv', pin: 'out1' })).toBe('terminal');
    expect(jumperOf(doc, { part: 'drv', pin: 'out1' }, { part: 'm1', pin: 'm1' })).toBeNull();
    const jumpers = buildBom(doc).filter((l) => l.kind === 'jumper');
    expect(jumpers.map((l) => [l.type, l.wires, l.quantity])).toEqual([
      ['ff', 1, 1], // line sensor → driver header
      ['mf', 4, 1], // D5, D6, 5V, A0 → module headers
      ['mm', 3, 1], // GND → gnd terminal, D9 → hole, hole → rail
    ]);
  });

  it('rounds packs up after the spare allowance', () => {
    const doc = robot();
    const many = Array.from({ length: 9 }, (_, i) => wire(BOARD_PART, `D${i + 2}`, 'line', 'left'));
    const mf = buildBom({ ...doc, wires: many }).find((l) => l.type === 'mf');
    expect(mf?.quantity).toBe(2); // 9 × 1.2 = 10.8 → 2 packs of 10
  });
});

describe('priceBom', () => {
  const price = (
    partKey: string,
    priceIrr: number | null,
    stock: CatalogPrice['stock'] = 'in_stock',
  ): CatalogPrice => ({
    partKey,
    priceIrr,
    stock,
    updatedAt: '2026-10-25T00:00:00Z',
  });

  it('prices exact variants first, then the bare type, and subtracts owned parts', () => {
    const bom = buildBom(robot());
    const priced = priceBom(
      bom,
      [
        price('passive.resistor', 5_000),
        price('passive.resistor?ohms=10000', 7_000),
        price('actuator.tt-motor', 900_000, 'low'),
        price('board:avr-uno', null),
      ],
      { 'actuator.tt-motor': 1, 'passive.resistor?ohms=220': 5 },
    );
    const line = (k: string) => priced.lines.find((l) => l.key === k);
    expect(line('passive.resistor?ohms=220')).toMatchObject({
      unitPriceIrr: 5_000,
      owned: 2,
      toBuy: 0,
      lineTotalIrr: 0,
    });
    expect(line('passive.resistor?ohms=10000')).toMatchObject({ unitPriceIrr: 7_000, lineTotalIrr: 7_000 });
    expect(line('actuator.tt-motor')).toMatchObject({
      owned: 1,
      toBuy: 1,
      lineTotalIrr: 900_000,
      stock: 'low',
    });
    expect(line('driver.l298n')).toMatchObject({ unitPriceIrr: null, stock: 'unknown' });
    expect(priced.totalIrr).toBe(907_000);
    // Unpriced lines still to buy: board, L298N, LED, breadboard, battery, line sensor, three jumper packs.
    expect(priced.unpriced).toBe(9);
  });
});

describe('wiringGuide', () => {
  it('lists every wire once, grouped by subsystem with seats and supply first', () => {
    const doc = robot();
    const groups = wiringGuide(doc);
    expect(groups.map((g) => g.subsystem)).toEqual(['power', 'motors', 'sensors', 'other']);
    const wireIds = groups.flatMap((g) => g.steps.filter((s) => s.kind === 'wire').map((s) => s.id));
    expect(wireIds.sort()).toEqual(doc.wires.map((w) => w.id).sort());

    const ids = (s: string) => groups.find((g) => g.subsystem === s)?.steps.map((step) => step.id);
    expect(ids('power')).toEqual(['w4']); // battery → VS
    // LED seat first, then the supply wire (GND → gnd), then signals in drawing order; the
    // line sensor → driver wire counts as motors.
    expect(ids('motors')).toEqual(['led', 'w5', 'w1', 'w2', 'w3', 'w9', 'w10']);
    expect(ids('sensors')).toEqual(['w6', 'w7']);
    expect(ids('other')).toEqual(['r1', 'w8']); // D9 feeds the resistor's strip
  });

  it('labels board pins like the silk screen and resolves holes to the seated legs', () => {
    const steps = wiringGuide(robot()).flatMap((g) => g.steps);
    const step = (id: string) => steps.find((s) => s.id === id);
    const w5 = step('w5');
    const w8 = step('w8');
    if (w5?.kind !== 'wire' || w8?.kind !== 'wire') throw new Error('expected wires');
    expect(w5.from.label).toBe('GND');
    expect(w5).toMatchObject({ supply: true, jumper: 'mm' });
    expect(w8.from.label).toBe('D9');
    expect(w8.to).toMatchObject({ hole: true, label: '10e', via: [{ part: 'r1', pin: 'a' }] });
    expect(stepFocus(w8).parts).toEqual(new Set([BOARD_PART, 'bb', 'r1']));
  });

  it('puts a lone rail jumper under power', () => {
    n = 0;
    const doc = {
      ...blankProject('t', ''),
      components: [part('bb', 'passive.breadboard-half')],
      wires: [wire('bb', 'tp1', 'bb', 'bp1', 'red')],
    };
    expect(wiringGuide(doc)).toMatchObject([{ subsystem: 'power', steps: [{ id: 'w1', supply: true }] }]);
  });

  it('knows which strip a hole is on', () => {
    expect([stripOf('12c'), stripOf('12f'), stripOf('tn7'), stripOf('x')]).toEqual([
      '12top',
      '12bottom',
      'tn',
      null,
    ]);
  });
});
