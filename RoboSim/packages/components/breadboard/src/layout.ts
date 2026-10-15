import type { PinKind } from '@robosim/sim-core';

export interface BreadboardLayout {
  /** Terminal-strip columns (1..columns), rows a–e and f–j. */
  readonly columns: number;
  /** Holes per power rail. */
  readonly railHoles: number;
}

export const HALF: BreadboardLayout = { columns: 30, railHoles: 25 }; // 400 tie points
export const FULL: BreadboardLayout = { columns: 63, railHoles: 50 }; // 830 tie points

const TOP_ROWS = ['a', 'b', 'c', 'd', 'e'] as const;
const BOTTOM_ROWS = ['f', 'g', 'h', 'i', 'j'] as const;
/** Rails: top +/−, bottom +/− (named tp, tn, bp, bn). */
const RAILS = ['tp', 'tn', 'bp', 'bn'] as const;

/** Hole ids: '12c' for terminal strips, 'tp7' for rail holes. */
export function breadboardPins(layout: BreadboardLayout): { name: string; kind: PinKind }[] {
  const pins: { name: string; kind: PinKind }[] = [];
  for (let c = 1; c <= layout.columns; c++) {
    for (const r of [...TOP_ROWS, ...BOTTOM_ROWS]) pins.push({ name: `${c}${r}`, kind: 'passive' });
  }
  for (const rail of RAILS) {
    for (let h = 1; h <= layout.railHoles; h++)
      pins.push({ name: `${rail}${h}`, kind: rail.endsWith('n') ? 'ground' : 'power' });
  }
  return pins;
}

/** Strip conductors as chains of adjacent holes: each 5-hole half-column, each continuous rail. */
export function breadboardConnections(layout: BreadboardLayout): [string, string][] {
  const out: [string, string][] = [];
  const chain = (names: readonly string[]): void => {
    for (let i = 1; i < names.length; i++) out.push([names[i - 1] ?? '', names[i] ?? '']);
  };
  for (let c = 1; c <= layout.columns; c++) {
    chain(TOP_ROWS.map((r) => `${c}${r}`));
    chain(BOTTOM_ROWS.map((r) => `${c}${r}`));
  }
  for (const rail of RAILS) chain(Array.from({ length: layout.railHoles }, (_, i) => `${rail}${i + 1}`));
  return out;
}
