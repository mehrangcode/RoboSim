import type {
  ComponentIO,
  ComponentModel,
  Fault,
  Level,
  MnaStamper,
  ModelContext,
  NetId,
} from '@robosim/sim-core';

export type KeypadProps = Record<string, never>;

export interface KeypadState {
  /** Keys held down, as printed on them ('1'…'9', '0', 'A'…'D', '*', '#'). */
  readonly pressed: readonly string[];
}

/** Printed legends, row by row (R1 = top row, C1 = left column). */
export const KEYPAD_LAYOUT: readonly (readonly string[])[] = [
  ['1', '2', '3', 'A'],
  ['4', '5', '6', 'B'],
  ['7', '8', '9', 'C'],
  ['*', '0', '#', 'D'],
];

/** Manifest input name of a key: `key1`, `keyA`, `keyStar`, `keyHash`. */
export const keyInput = (legend: string): string =>
  `key${legend === '*' ? 'Star' : legend === '#' ? 'Hash' : legend}`;

/** Membrane contact resistance of a pressed key. */
const KEY_OHMS = 100;

interface Key {
  readonly legend: string;
  readonly row: NetId;
  readonly col: NetId;
}

/**
 * 4×4 membrane keypad: a pressed key connects its row line to its column line. Keypad-library sketches
 * pull one column LOW at a time and read the rows within microseconds, far inside a 1 ms slice; the
 * keypad therefore answers through the MCU-edge fast path — when a line driven by the firmware changes,
 * every line joined to it by a pressed key follows at once (LOW wins, else the pull-up's HIGH).
 */
export class Keypad implements ComponentModel<KeypadProps, KeypadState> {
  readonly type = 'sensor.keypad-4x4';
  private rows: NetId[] = [];
  private cols: NetId[] = [];
  private keys: Key[] = [];
  private held = new Set<string>();
  /** Last known level of every line (from firmware edges, or the operating point at slice end). */
  private levels = new Map<NetId, Level>();

  init(ctx: ModelContext): void {
    this.rows = [1, 2, 3, 4].map((i) => ctx.net(`r${i}`));
    this.cols = [1, 2, 3, 4].map((i) => ctx.net(`c${i}`));
    this.keys = KEYPAD_LAYOUT.flatMap((legends, r) =>
      legends.map((legend, c) => ({ legend, row: this.rows[r] ?? 0, col: this.cols[c] ?? 0 })),
    );
  }

  input(name: string, value: number | boolean): void {
    const key = this.keys.find((k) => keyInput(k.legend) === name);
    if (!key || typeof value !== 'boolean') throw new Error(`${this.type}: bad input '${name}'`);
    if (value) this.held.add(key.legend);
    else this.held.delete(key.legend);
  }

  logicNets(): { inputs: NetId[]; outputs: NetId[] } {
    return { inputs: [...this.rows, ...this.cols], outputs: [] };
  }

  stamp(s: MnaStamper): void {
    for (const k of this.keys) if (this.held.has(k.legend)) s.conductance(k.row, k.col, 1 / KEY_OHMS);
  }

  step(_dt: number, io: ComponentIO): void {
    for (const n of [...this.rows, ...this.cols]) this.levels.set(n, io.solution.voltage(n) > 2.5 ? 1 : 0);
  }

  mcuEdge(net: NetId, level: Level, time: number, io: ComponentIO): void {
    this.levels.set(net, level);
    for (const k of this.keys) {
      if (!this.held.has(k.legend) || (k.row !== net && k.col !== net)) continue;
      const other = k.row === net ? k.col : k.row;
      io.scheduleMcuInput(other, this.joinedLevel(other, net), time);
    }
  }

  faults(): readonly Fault[] {
    return [];
  }

  snapshot(): KeypadState {
    return { pressed: this.keys.filter((k) => this.held.has(k.legend)).map((k) => k.legend) };
  }

  /** Level of `line` through the pressed keys: LOW if any joined line is LOW, else HIGH (pull-up). */
  private joinedLevel(line: NetId, driver: NetId): Level {
    for (const k of this.keys) {
      if (!this.held.has(k.legend)) continue;
      const peer = k.row === line ? k.col : k.col === line ? k.row : null;
      if (peer !== null && (peer === driver ? this.levels.get(driver) : this.levels.get(peer)) === 0)
        return 0;
    }
    return 1;
  }
}
