import { breadboardLayout, type BreadboardLayout } from '@robosim/catalog/manifests';
import { BOARD_PART, type ComponentInstance, type PinRef, type ProjectDocument } from '@robosim/shared';

/**
 * Canvas geometry. Document coordinates are millimetres; every footprint is drawn on the 0.1"
 * (2.54 mm) grid, so a part snapped to the grid lands its legs exactly on breadboard holes.
 */
export const PITCH = 2.54;

export type Point = readonly [number, number];

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** A part's shape in grid units, relative to its origin (rotation and flip turn around the origin). */
export interface Footprint {
  readonly box: Box;
  readonly pins: Readonly<Record<string, Point>>;
  /** Legs plug into breadboard holes (through-hole parts and modules with male headers). */
  readonly seatable: boolean;
}

const row = (names: readonly string[], y = 0, x0 = 0): Record<string, Point> =>
  Object.fromEntries(names.map((n, i) => [n, [x0 + i, y] as Point]));

/** Breadboard rows top to bottom: rails −/+, a–e, the centre gap (3 rows, DIP width), f–j, rails +/−. */
const BB_ROWS: Readonly<Record<string, number>> = {
  tn: 0,
  tp: 1,
  a: 3,
  b: 4,
  c: 5,
  d: 6,
  e: 7,
  f: 10,
  g: 11,
  h: 12,
  i: 13,
  j: 14,
  bp: 16,
  bn: 17,
};

/** Rail holes come in groups of five with a one-hole gap, centred over the terminal columns. */
export function railHoleX(layout: BreadboardLayout, hole: number): number {
  const span = layout.railHoles + Math.floor((layout.railHoles - 1) / 5);
  const offset = 1 + Math.floor((layout.columns - span) / 2);
  return offset + (hole - 1) + Math.floor((hole - 1) / 5);
}

function breadboardFootprint(layout: BreadboardLayout): Footprint {
  const pins: Record<string, Point> = {};
  for (let c = 1; c <= layout.columns; c++)
    for (const r of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'])
      pins[`${c}${r}`] = [c, BB_ROWS[r] as number];
  for (const rail of ['tn', 'tp', 'bp', 'bn'])
    for (let h = 1; h <= layout.railHoles; h++)
      pins[`${rail}${h}`] = [railHoleX(layout, h), BB_ROWS[rail] as number];
  return { box: { x: -0.2, y: -1.2, w: layout.columns + 1.4, h: 19.4 }, pins, seatable: false };
}

/** Arduino Uno R3 (68.6 × 53.3 mm), USB to the left; header positions rounded to the grid. */
export const BOARD_FOOTPRINT: Footprint = {
  box: { x: 0, y: 0, w: 27, h: 21 },
  pins: {
    GND3: [9, 1],
    ...row(['D13', 'D12', 'D11', 'D10', 'D9', 'D8'], 1, 10),
    ...row(['D7', 'D6', 'D5', 'D4', 'D3', 'D2', 'D1', 'D0'], 1, 17),
    ...row(['3V3', '5V', 'GND1', 'GND2', 'VIN'], 20, 11),
    ...row(['A0', 'A1', 'A2', 'A3', 'A4', 'A5'], 20, 18),
  },
  seatable: false,
};

/**
 * Dual in-line package with pins in datasheet order: pin 1 bottom-left, counting anticlockwise, the two
 * rows `span` grid steps apart (0.3" DIPs straddle the breadboard's centre channel).
 */
function dip(names: readonly string[], span = 3): Footprint {
  const half = names.length / 2;
  const pins: Record<string, Point> = {};
  names.forEach((n, i) => {
    pins[n] = i < half ? [i, span] : [names.length - 1 - i, 0];
  });
  return { box: { x: -0.6, y: -0.4, w: half - 1 + 1.2, h: span + 0.8 }, pins, seatable: true };
}

const QUAD_GATES = ['1a', '1b', '1y', '2a', '2b', '2y', 'gnd', '3y', '3a', '3b', '4y', '4a', '4b', 'vcc'];
const HEX_INVERTERS = ['1a', '1y', '2a', '2y', '3a', '3y', 'gnd', '4y', '4a', '5y', '5a', '6y', '6a', 'vcc'];

/** Three legs on 0.1" pitch, body above them: TO-92 small-signal transistors. */
const TO92 = (legs: readonly [string, string, string]): Footprint => ({
  box: { x: -0.6, y: -2.6, w: 3.2, h: 3 },
  pins: row(legs),
  seatable: true,
});
/** TO-220 power package with its tab above the body. */
const TO220 = (legs: readonly [string, string, string]): Footprint => ({
  box: { x: -0.6, y: -7, w: 3.2, h: 7.4 },
  pins: row(legs),
  seatable: true,
});

/** Axial two-lead part (diodes): anode left, cathode right, 0.4" lead spacing. */
const AXIAL: Footprint = {
  box: { x: -0.4, y: -0.6, w: 4.8, h: 1.2 },
  pins: { a: [0, 0], k: [4, 0] },
  seatable: true,
};

const FOOTPRINTS: Readonly<Record<string, Footprint>> = {
  'passive.resistor': {
    box: { x: -0.4, y: -0.6, w: 4.8, h: 1.2 },
    pins: { a: [0, 0], b: [4, 0] },
    seatable: true,
  },
  'actuator.led': { box: { x: -0.6, y: -3.2, w: 2.2, h: 3.6 }, pins: row(['a', 'k']), seatable: true },
  'passive.potentiometer': {
    box: { x: -0.8, y: -4.4, w: 5.6, h: 4.8 },
    pins: { a: [0, 0], wiper: [2, 0], b: [4, 0] },
    seatable: true,
  },
  'sensor.push-button': {
    box: { x: -0.4, y: -0.4, w: 2.8, h: 3.8 },
    pins: { a1: [0, 0], b1: [2, 0], a2: [0, 3], b2: [2, 3] },
    seatable: true,
  },
  'sensor.ldr': { box: { x: -0.6, y: -2.6, w: 3.2, h: 3 }, pins: { a: [0, 0], b: [2, 0] }, seatable: true },
  'actuator.buzzer-active': {
    box: { x: -1, y: -4.2, w: 5, h: 4.6 },
    pins: { pos: [0, 0], neg: [3, 0] },
    seatable: true,
  },
  'power.switch': {
    box: { x: -0.8, y: -2.4, w: 3.6, h: 2.8 },
    pins: { a: [0, 0], b: [2, 0] },
    seatable: true,
  },
  'sensor.tcrt5000': {
    box: { x: -1.5, y: -12, w: 6, h: 12.4 },
    pins: row(['vcc', 'gnd', 'd0', 'a0']),
    seatable: true,
  },
  'sensor.line-3ch': {
    box: { x: -4, y: -10, w: 12, h: 10.4 },
    pins: row(['vcc', 'gnd', 'left', 'center', 'right']),
    seatable: true,
  },
  'sensor.hc-sr04': {
    box: { x: -7.4, y: -8.2, w: 17.8, h: 8.6 },
    pins: row(['vcc', 'trig', 'echo', 'gnd']),
    seatable: true,
  },
  'driver.l298n': {
    box: { x: 0, y: 0, w: 17, h: 17 },
    pins: {
      out1: [0, 6],
      out2: [0, 8],
      out3: [17, 8],
      out4: [17, 6],
      ...row(['vs', 'gnd', 'v5'], 17, 3),
      ...row(['ena', 'in1', 'in2', 'in3', 'in4', 'enb'], 17, 8),
    },
    seatable: false,
  },
  'actuator.tt-motor': {
    box: { x: -10, y: -3, w: 10, h: 6 },
    pins: { m1: [0, -1], m2: [0, 1] },
    seatable: false,
  },
  'actuator.sg90-servo': {
    box: { x: -10, y: -2, w: 9, h: 6 },
    pins: { signal: [0, 0], vcc: [0, 1], gnd: [0, 2] },
    seatable: false,
  },
  'power.battery-4aa': {
    box: { x: -12, y: -4, w: 11, h: 8 },
    pins: { pos: [0, -1], neg: [0, 1] },
    seatable: false,
  },
  'power.battery-9v': {
    box: { x: -9, y: -4, w: 8, h: 8 },
    pins: { pos: [0, -1], neg: [0, 1] },
    seatable: false,
  },
  'mechanical.chassis-2wd': { box: { x: -30, y: -24, w: 60, h: 48 }, pins: {}, seatable: false },
  // Catalogue expansion Tier A (slice 16a).
  'semiconductor.diode-1n4007': AXIAL,
  // Radial capacitors: a ceramic disc with 0.2" leads, an electrolytic can with 0.1" leads (+ first).
  'passive.capacitor-ceramic': {
    box: { x: -0.4, y: -2.6, w: 2.8, h: 3 },
    pins: { a: [0, 0], b: [2, 0] },
    seatable: true,
  },
  'passive.capacitor-electrolytic': {
    box: { x: -0.7, y: -4, w: 2.4, h: 4.4 },
    pins: { pos: [0, 0], neg: [1, 0] },
    seatable: true,
  },
  'ic.ne555': dip(['gnd', 'trig', 'out', 'reset', 'ctrl', 'thr', 'dis', 'vcc']),
  'semiconductor.diode-1n4148': AXIAL,
  'semiconductor.zener-5v1': AXIAL,
  'semiconductor.lm7805': {
    box: { x: -0.7, y: -7, w: 3.4, h: 7.4 },
    pins: row(['in', 'gnd', 'out']),
    seatable: true,
  },
  // Transistors: legs in the order the real package has them, flat face (or tab) toward the viewer.
  'semiconductor.2n2222': TO92(['e', 'b', 'c']),
  'semiconductor.bc547': TO92(['c', 'b', 'e']),
  'semiconductor.2n3906': TO92(['e', 'b', 'c']),
  'semiconductor.tip120': TO220(['b', 'c', 'e']),
  'semiconductor.irlz44n': TO220(['g', 'd', 's']),
  'driver.irf520-module': {
    box: { x: -0.6, y: -1, w: 12.2, h: 7 },
    pins: {
      sig: [0, 0],
      vcc: [0, 1],
      gnd: [0, 2],
      vin: [11, 0],
      gndIn: [11, 1],
      vplus: [11, 3],
      vminus: [11, 4],
    },
    seatable: false,
  },
  // Catalogue expansion Tier C (P2): I²C breakouts, header along the bottom edge.
  'display.oled-ssd1306': {
    box: { x: -3.8, y: -10.4, w: 10.6, h: 10.8 },
    pins: row(['gnd', 'vcc', 'scl', 'sda']),
    seatable: true,
  },
  // 1602 LCD with the PCF8574 backpack's 4-pin header at its lower left.
  'display.lcd1602-i2c': {
    box: { x: -1, y: -14.6, w: 31.5, h: 15 },
    pins: row(['gnd', 'vcc', 'sda', 'scl']),
    seatable: false,
  },
  'sensor.mpu6050': {
    box: { x: -0.65, y: -6, w: 8.3, h: 6.4 },
    pins: row(['vcc', 'gnd', 'scl', 'sda', 'xda', 'xcl', 'ad0', 'int']),
    seatable: true,
  },
  'sensor.bmp280': {
    box: { x: -0.45, y: -4.6, w: 5.9, h: 5 },
    pins: row(['vcc', 'gnd', 'scl', 'sda', 'csb', 'sdo']),
    seatable: true,
  },
  'sensor.vl53l0x': {
    box: { x: -2.4, y: -4.6, w: 9.8, h: 5 },
    pins: row(['vin', 'gnd', 'scl', 'sda', 'gpio1', 'xshut']),
    seatable: true,
  },
  // Catalogue expansion Tier C (slice C2): single-wire parts.
  'sensor.dht11': {
    box: { x: -1, y: -10.6, w: 4, h: 11 },
    pins: row(['vcc', 'data', 'gnd']),
    seatable: true,
  },
  'sensor.ds18b20': TO92(['gnd', 'dq', 'vdd']),
  // Strip: VCC/DIN/GND wires at the left end, DOUT at the right; LEDs spread along it.
  'actuator.ws2812-strip': {
    box: { x: 0.6, y: -0.7, w: 21.8, h: 3.4 },
    pins: { vcc: [0, 0], din: [0, 1], gnd: [0, 2], dout: [23, 1] },
    seatable: false,
  },
  'semiconductor.ams1117-3v3': {
    box: { x: -0.8, y: -4.4, w: 3.6, h: 4.8 },
    pins: row(['in', 'gnd', 'out']),
    seatable: true,
  },
  'actuator.led-rgb': {
    box: { x: -0.6, y: -3.6, w: 4.2, h: 4 },
    pins: row(['r', 'common', 'g', 'b']),
    seatable: true,
  },
  'actuator.buzzer-passive': {
    box: { x: -1, y: -4.2, w: 5, h: 4.6 },
    pins: { pos: [0, 0], neg: [3, 0] },
    seatable: true,
  },
  // 0.56" digit: pins 10–6 on top (g f com a b), 1–5 below (e d com c dp), rows 0.6" apart.
  'display.seven-segment': {
    box: { x: -0.8, y: -0.6, w: 5.6, h: 7.2 },
    pins: { ...row(['g', 'f', 'com1', 'a', 'b']), ...row(['e', 'd', 'com2', 'c', 'dp'], 6) },
    seatable: true,
  },
  'actuator.relay-module': {
    box: { x: 0, y: 0, w: 20, h: 10.5 },
    pins: { in: [0, 3], vcc: [0, 5], gnd: [0, 7], no: [20, 2], com: [20, 5], nc: [20, 8] },
    seatable: false,
  },
  'actuator.mg996r-servo': {
    box: { x: -17, y: -3, w: 16, h: 9 },
    pins: { signal: [0, 0], vcc: [0, 1], gnd: [0, 2] },
    seatable: false,
  },
  // Catalogue expansion Tier A (slice 16b): DIP chips straddle the channel; modules sit beside it.
  'ic.74hc00': dip(QUAD_GATES),
  'ic.74hc08': dip(QUAD_GATES),
  'ic.74hc32': dip(QUAD_GATES),
  'ic.74hc86': dip(QUAD_GATES),
  'ic.74hc14': dip(HEX_INVERTERS),
  'ic.74hc595': dip([
    'qb',
    'qc',
    'qd',
    'qe',
    'qf',
    'qg',
    'qh',
    'gnd',
    'qh2',
    'srclr',
    'srclk',
    'rclk',
    'oe',
    'ser',
    'qa',
    'vcc',
  ]),
  'ic.cd4017': dip([
    'q5',
    'q1',
    'q0',
    'q2',
    'q6',
    'q7',
    'q3',
    'vss',
    'q8',
    'q4',
    'q9',
    'co',
    'inh',
    'clk',
    'rst',
    'vdd',
  ]),
  'ic.uln2003a': dip([
    'in1',
    'in2',
    'in3',
    'in4',
    'in5',
    'in6',
    'in7',
    'gnd',
    'com',
    'out7',
    'out6',
    'out5',
    'out4',
    'out3',
    'out2',
    'out1',
  ]),
  // Breakout with 0.6" rows: motor side on top, logic below.
  'driver.tb6612fng': {
    box: { x: -0.6, y: -0.6, w: 7.2, h: 7.2 },
    pins: {
      ...row(['vm', 'vcc', 'gnd', 'ao1', 'ao2', 'bo2', 'bo1']),
      ...row(['pwma', 'ain2', 'ain1', 'stby', 'bin1', 'bin2', 'pwmb'], 6),
    },
    seatable: true,
  },
  'driver.l9110s': {
    box: { x: 0, y: 0, w: 11, h: 8 },
    pins: {
      'b-ia': [0, 1],
      'b-ib': [0, 2],
      gnd: [0, 3],
      vcc: [0, 4],
      'a-ia': [0, 5],
      'a-ib': [0, 6],
      oa1: [11, 1],
      oa2: [11, 2],
      ob1: [11, 6],
      ob2: [11, 7],
    },
    seatable: false,
  },
  'actuator.stepper-28byj48': {
    box: { x: -3.5, y: -13, w: 11, h: 13.4 },
    pins: row(['blue', 'pink', 'yellow', 'orange', 'red']),
    seatable: false,
  },
  // Catalogue expansion Tier A (slice 16c): sensor and input modules with male headers.
  'sensor.bump-switch': {
    box: { x: -0.8, y: -4.4, w: 5.6, h: 4.8 },
    pins: { com: [0, 0], nc: [2, 0], no: [4, 0] },
    seatable: true,
  },
  'sensor.line-5ch': {
    box: { x: -3, y: -10, w: 12, h: 10.4 },
    pins: row(['vcc', 'gnd', 's1', 's2', 's3', 's4', 's5']),
    seatable: true,
  },
  'sensor.ir-obstacle': {
    box: { x: -1.5, y: -12, w: 5, h: 12.4 },
    pins: row(['out', 'gnd', 'vcc']),
    seatable: true,
  },
  'sensor.pir': { box: { x: -4, y: -12, w: 10, h: 12.4 }, pins: row(['vcc', 'out', 'gnd']), seatable: true },
  'sensor.sound': {
    box: { x: -1.5, y: -14, w: 6, h: 14.4 },
    pins: row(['ao', 'gnd', 'vcc', 'do']),
    seatable: true,
  },
  'sensor.soil-moisture': {
    box: { x: -1.5, y: -14, w: 6, h: 14.4 },
    pins: row(['vcc', 'gnd', 'do', 'ao']),
    seatable: true,
  },
  'sensor.joystick': {
    box: { x: -3, y: -14, w: 10, h: 14.4 },
    pins: row(['gnd', 'vcc', 'vrx', 'vry', 'sw']),
    seatable: true,
  },
  'sensor.keypad-4x4': {
    box: { x: -10, y: -30, w: 27, h: 30.4 },
    pins: row(['r1', 'r2', 'r3', 'r4', 'c1', 'c2', 'c3', 'c4']),
    seatable: true,
  },
  'sensor.rotary-encoder': {
    box: { x: -1.5, y: -12, w: 7, h: 12.4 },
    pins: row(['gnd', 'vcc', 'sw', 'dt', 'clk']),
    seatable: true,
  },
  'power.lm2596': {
    box: { x: 0, y: 0, w: 17, h: 8.8 },
    pins: { 'in+': [0, 2], 'in-': [0, 6], 'out+': [17, 2], 'out-': [17, 6] },
    seatable: false,
  },
};

const breadboardCache = new Map<string, Footprint>();
const GENERIC: Footprint = { box: { x: -2, y: -2, w: 4, h: 4 }, pins: {}, seatable: false };

/** Footprint of a catalogue type; parts without art get a labelled box with their pins in a row. */
export function footprintOf(type: string, pinNames: readonly string[] = []): Footprint {
  const known = FOOTPRINTS[type];
  if (known) return known;
  const layout = breadboardLayout(type);
  if (layout) {
    let fp = breadboardCache.get(type);
    if (!fp) breadboardCache.set(type, (fp = breadboardFootprint(layout)));
    return fp;
  }
  if (pinNames.length === 0) return GENERIC;
  return { box: { x: -0.5, y: -3, w: pinNames.length, h: 3.4 }, pins: row(pinNames), seatable: false };
}

export function hasArt(type: string): boolean {
  return type in FOOTPRINTS || breadboardLayout(type) !== undefined;
}

export type Placement = Pick<ComponentInstance, 'x' | 'y' | 'rotation' | 'flipped'>;

/** Grid-unit point of a footprint → document mm, applying flip (mirror x), then clockwise rotation. */
export function place(c: Placement, [px, py]: Point): Point {
  const fx = c.flipped ? -px : px;
  const [rx, ry] =
    c.rotation === 90
      ? [-py, fx]
      : c.rotation === 180
        ? [-fx, -py]
        : c.rotation === 270
          ? [py, -fx]
          : [fx, py];
  return [c.x + rx * PITCH, c.y + ry * PITCH];
}

/** Where the board sits: `board.position` (schema v4), else the document origin. It never flips. */
export function boardPlacement(doc: Pick<ProjectDocument, 'board'>): Placement {
  const p = doc.board.position;
  return { x: p?.x ?? 0, y: p?.y ?? 0, rotation: p?.rotation ?? 0, flipped: false };
}

/** Document-space bounding box of a placed footprint. */
export function placedBox(c: Placement, fp: Footprint): Box {
  const { x, y, w, h } = fp.box;
  const corners = [place(c, [x, y]), place(c, [x + w, y + h])];
  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  };
}

export const boardBox = (doc: Pick<ProjectDocument, 'board'>): Box =>
  placedBox(boardPlacement(doc), BOARD_FOOTPRINT);

/** Pin names of a part type, as the footprint knows them. */
export type PinNames = (type: string) => readonly string[];

/** Where a pin is in document mm, or null when the part or pin does not exist. */
export function pinPosition(doc: ProjectDocument, ref: PinRef, pinNames: PinNames): Point | null {
  if (ref.part === BOARD_PART) {
    const p = BOARD_FOOTPRINT.pins[ref.pin];
    return p ? place(boardPlacement(doc), p) : null;
  }
  const c = doc.components.find((v) => v.id === ref.part);
  if (!c) return null;
  const p = footprintOf(c.type, pinNames(c.type)).pins[ref.pin];
  return p ? place(c, p) : null;
}

export const samePin = (a: PinRef | null, b: PinRef | null): boolean =>
  !!a && !!b && a.part === b.part && a.pin === b.pin;

export const snap = (v: number): number => Math.round(v / PITCH) * PITCH;

const gridKey = ([x, y]: Point): string | null => {
  const gx = x / PITCH;
  const gy = y / PITCH;
  const rx = Math.round(gx);
  const ry = Math.round(gy);
  return Math.abs(gx - rx) < 0.01 && Math.abs(gy - ry) < 0.01 ? `${rx},${ry}` : null;
};

/**
 * Which legs sit in a breadboard hole (FR-CIR-03): a seatable part's pin exactly on a hole is plugged
 * in. Returns the document with every component's `seats` recomputed (absent when none).
 */
export function withSeats(doc: ProjectDocument, pinNames: PinNames): ProjectDocument {
  const holes = new Map<string, PinRef>();
  for (const c of doc.components) {
    if (!breadboardLayout(c.type)) continue;
    for (const [pin, p] of Object.entries(footprintOf(c.type).pins)) {
      const key = gridKey(place(c, p));
      if (key && !holes.has(key)) holes.set(key, { part: c.id, pin });
    }
  }
  let changed = false;
  const components = doc.components.map((c) => {
    const fp = footprintOf(c.type, pinNames(c.type));
    const seats: Record<string, PinRef> = {};
    if (fp.seatable && holes.size > 0)
      for (const [pin, p] of Object.entries(fp.pins)) {
        const key = gridKey(place(c, p));
        const hole = key ? holes.get(key) : undefined;
        if (hole && hole.part !== c.id) seats[pin] = hole;
      }
    const next = Object.keys(seats).length > 0 ? seats : undefined;
    if (JSON.stringify(next) === JSON.stringify(c.seats)) return c;
    changed = true;
    const { seats: _old, ...rest } = c;
    return next ? { ...rest, seats: next } : rest;
  });
  return changed ? { ...doc, components } : doc;
}
