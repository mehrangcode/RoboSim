import type { CircuitChange, CodeEdit } from './ai-api.js';
import {
  BOARD_PART,
  type ComponentInstance,
  type PinRef,
  type ProjectDocument,
  type Wire,
} from './project-schema.js';

/**
 * Pure helpers behind AI proposals (FR-AI-05): the server validates a proposal with them before sending it,
 * and the editor re-applies it to the project as it is when the user presses Apply.
 */

export class ProposalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProposalError';
  }
}

/** Apply exact find/replace edits in order. A `find` must occur exactly once; an empty `find` appends. */
export function applyCodeEdits(content: string, edits: readonly CodeEdit[]): string {
  let out = content;
  for (const [i, e] of edits.entries()) {
    if (e.find === '') {
      out = out.length === 0 || out.endsWith('\n') ? out + e.replace : `${out}\n${e.replace}`;
      continue;
    }
    const at = out.indexOf(e.find);
    if (at < 0) throw new ProposalError(`edit ${i + 1}: text to replace not found`);
    if (out.indexOf(e.find, at + 1) >= 0)
      throw new ProposalError(`edit ${i + 1}: text to replace is not unique`);
    out = out.slice(0, at) + e.replace + out.slice(at + e.find.length);
  }
  return out;
}

export type DiffLine = { readonly kind: 'same' | 'add' | 'del'; readonly text: string };

/** Line diff (LCS; the shared prefix and suffix are trimmed first so typical edits stay cheap). */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const x = a.slice(start, endA);
  const y = b.slice(start, endB);
  if (x.length * y.length > 4_000_000) throw new ProposalError('change too large to show');
  const w = y.length + 1;
  const lcs = new Uint32Array((x.length + 1) * w);
  const at = (i: number, j: number): number => lcs[i * w + j] ?? 0;
  for (let i = x.length - 1; i >= 0; i--) {
    for (let j = y.length - 1; j >= 0; j--) {
      lcs[i * w + j] = x[i] === y[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  const out: DiffLine[] = a.slice(0, start).map((text) => ({ kind: 'same', text }));
  let i = 0;
  let j = 0;
  while (i < x.length || j < y.length) {
    const xi = x[i];
    const yj = y[j];
    if (xi !== undefined && xi === yj) {
      out.push({ kind: 'same', text: xi });
      i++;
      j++;
    } else if (xi !== undefined && (yj === undefined || at(i + 1, j) >= at(i, j + 1))) {
      out.push({ kind: 'del', text: xi });
      i++;
    } else if (yj !== undefined) {
      out.push({ kind: 'add', text: yj });
      j++;
    }
  }
  for (const text of a.slice(endA)) out.push({ kind: 'same', text });
  return out;
}

/** Unified diff with `context` lines around each change. */
export function unifiedDiff(file: string, before: string, after: string, context = 3): string {
  const lines = diffLines(before, after);
  // Old/new line numbers before each diff line.
  const oldNo: number[] = [];
  const newNo: number[] = [];
  let o = 1;
  let n = 1;
  for (const l of lines) {
    oldNo.push(o);
    newNo.push(n);
    if (l.kind !== 'add') o++;
    if (l.kind !== 'del') n++;
  }
  const hunks: [number, number][] = [];
  lines.forEach((l, i) => {
    if (l.kind === 'same') return;
    const lo = Math.max(0, i - context);
    const hi = Math.min(lines.length - 1, i + context);
    const last = hunks.at(-1);
    if (last && lo <= last[1] + 1) last[1] = hi;
    else hunks.push([lo, hi]);
  });
  if (hunks.length === 0) return '';
  const out = [`--- a/${file}`, `+++ b/${file}`];
  for (const [lo, hi] of hunks) {
    const body = lines.slice(lo, hi + 1);
    const oldLen = body.filter((l) => l.kind !== 'add').length;
    const newLen = body.filter((l) => l.kind !== 'del').length;
    const oldStart = oldNo[lo] ?? 1;
    const newStart = newNo[lo] ?? 1;
    out.push(
      `@@ -${oldLen ? oldStart : oldStart - 1},${oldLen} +${newLen ? newStart : newStart - 1},${newLen} @@`,
    );
    for (const l of body) out.push(`${l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '}${l.text}`);
  }
  return `${out.join('\n')}\n`;
}

/** What a circuit change needs to know about parts and the board (the catalogue lives outside `shared`). */
export interface PartResolver {
  part(
    type: string,
  ):
    | { version: string; pins: readonly string[]; props: Readonly<Record<string, string | number | boolean>> }
    | undefined;
  boardPins: readonly string[];
}

const sameEnd = (a: PinRef, b: PinRef): boolean => a.part === b.part && a.pin === b.pin;
const sameWire = (w: Wire, from: PinRef, to: PinRef): boolean =>
  (sameEnd(w.from, from) && sameEnd(w.to, to)) || (sameEnd(w.from, to) && sameEnd(w.to, from));

function wireColor(a: PinRef, b: PinRef): string {
  const pins = [a.pin, b.pin].map((p) => p.toUpperCase());
  if (pins.some((p) => p.startsWith('GND'))) return 'black';
  if (pins.some((p) => ['5V', 'VIN', '3V3', 'VCC', '+'].includes(p))) return 'red';
  return 'green';
}

/** Apply circuit changes; throws `ProposalError` naming the first change that does not fit the document. */
export function applyCircuitChanges(
  doc: ProjectDocument,
  changes: readonly CircuitChange[],
  parts: PartResolver,
): ProjectDocument {
  let components = [...doc.components];
  let wires = [...doc.wires];
  const find = (id: string): ComponentInstance | undefined => components.find((c) => c.id === id);
  const checkEnd = (end: PinRef, n: number): void => {
    if (end.part === BOARD_PART) {
      if (!parts.boardPins.includes(end.pin))
        throw new ProposalError(`change ${n}: the board has no pin ${end.pin}`);
      return;
    }
    const c = find(end.part);
    if (!c) throw new ProposalError(`change ${n}: no part ${end.part}`);
    const known = parts.part(c.type);
    if (known && !known.pins.includes(end.pin)) {
      throw new ProposalError(`change ${n}: ${end.part} (${c.type}) has no pin ${end.pin}`);
    }
  };
  for (const [i, ch] of changes.entries()) {
    const n = i + 1;
    switch (ch.op) {
      case 'add_component': {
        if (ch.id === BOARD_PART || find(ch.id)) throw new ProposalError(`change ${n}: id ${ch.id} is taken`);
        const known = parts.part(ch.type);
        if (!known) throw new ProposalError(`change ${n}: unknown part type ${ch.type}`);
        for (const [k, v] of Object.entries(ch.props ?? {})) checkProp(known.props, k, v, n);
        const right = components.reduce((m, c) => Math.max(m, c.x), 0);
        const top = components.length ? Math.min(...components.map((c) => c.y)) : 0;
        components.push({
          id: ch.id,
          type: ch.type,
          typeVersion: known.version,
          x: right + 25,
          y: top,
          rotation: 0,
          flipped: false,
          props: { ...known.props, ...ch.props },
        });
        break;
      }
      case 'remove_component': {
        if (!find(ch.id)) throw new ProposalError(`change ${n}: no part ${ch.id}`);
        components = components
          .filter((c) => c.id !== ch.id)
          .map((c) => {
            if (!c.seats || !Object.values(c.seats).some((s) => s.part === ch.id)) return c;
            const seats = Object.fromEntries(Object.entries(c.seats).filter(([, s]) => s.part !== ch.id));
            return { ...c, seats };
          });
        wires = wires.filter((w) => w.from.part !== ch.id && w.to.part !== ch.id);
        break;
      }
      case 'set_prop': {
        const c = find(ch.id);
        if (!c) throw new ProposalError(`change ${n}: no part ${ch.id}`);
        const known = parts.part(c.type);
        if (known) checkProp(known.props, ch.prop, ch.value, n);
        components = components.map((x) =>
          x.id === ch.id ? { ...x, props: { ...x.props, [ch.prop]: ch.value } } : x,
        );
        break;
      }
      case 'add_wire': {
        checkEnd(ch.from, n);
        checkEnd(ch.to, n);
        if (sameEnd(ch.from, ch.to)) throw new ProposalError(`change ${n}: a wire needs two different pins`);
        if (wires.some((w) => sameWire(w, ch.from, ch.to)))
          throw new ProposalError(`change ${n}: that wire exists`);
        let k = wires.length + 1;
        while (wires.some((w) => w.id === `w${k}`)) k++;
        wires.push({ id: `w${k}`, from: ch.from, to: ch.to, color: wireColor(ch.from, ch.to), points: [] });
        break;
      }
      case 'remove_wire': {
        if (!wires.some((w) => sameWire(w, ch.from, ch.to))) {
          throw new ProposalError(`change ${n}: no wire between ${end(ch.from)} and ${end(ch.to)}`);
        }
        wires = wires.filter((w) => !sameWire(w, ch.from, ch.to));
        break;
      }
    }
  }
  return { ...doc, components, wires };
}

const end = (p: PinRef): string => `${p.part}:${p.pin}`;

function checkProp(
  props: Readonly<Record<string, string | number | boolean>>,
  key: string,
  value: string | number | boolean,
  n: number,
): void {
  if (!(key in props)) throw new ProposalError(`change ${n}: unknown property ${key}`);
  if (typeof props[key] !== typeof value)
    throw new ProposalError(`change ${n}: ${key} must be a ${typeof props[key]}`);
}
