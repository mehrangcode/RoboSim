import type { ProjectDocument } from '@robosim/shared';
import { pinNamesOf } from './document.js';
import { boardBox, footprintOf, placedBox, type Box } from './geometry.js';

/** MIME type of a library drag (the catalogue type id). */
export const PART_DRAG_TYPE = 'application/x-robosim-part';

export interface View {
  readonly x: number;
  readonly y: number;
  /** Pixels per millimetre. */
  readonly k: number;
}

export const MIN_K = 0.6;
export const MAX_K = 40;

export const WIRE_COLORS: Readonly<Record<string, string>> = {
  red: '#dc2626',
  black: '#111827',
  yellow: '#eab308',
  green: '#16a34a',
  blue: '#2563eb',
  orange: '#ea580c',
  white: '#e5e7eb',
  purple: '#9333ea',
};

/** Bounding box of the board and every part (document mm). */
export function contentBox(doc: ProjectDocument): Box {
  const boxes = [
    boardBox(),
    ...doc.components.map((c) => placedBox(c, footprintOf(c.type, pinNamesOf(c.type)))),
  ];
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w));
  const y1 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function fitView(box: Box, width: number, height: number): View {
  const pad = 24;
  const k = Math.min(MAX_K, Math.max(MIN_K, Math.min((width - 2 * pad) / box.w, (height - 2 * pad) / box.h)));
  return { k, x: width / 2 - (box.x + box.w / 2) * k, y: height / 2 - (box.y + box.h / 2) * k };
}
