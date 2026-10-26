import {
  breadboardLayout,
  findManifest,
  variantPropsOf,
  type ComponentManifest,
} from '@robosim/catalog/manifests';
import {
  BOARD_PART,
  JUMPER_TYPES,
  baseKeyOf,
  boardKey,
  jumperKey,
  partKey,
  type CatalogPrice,
  type JumperType,
  type PinRef,
  type ProjectDocument,
  type StockStatus,
  type VariantValue,
} from '@robosim/shared';

/**
 * Bill of materials (FR-BOM-01): what to buy to build the drawn circuit. Pure over the document, so
 * the editor, the print view and exports agree; prices and owned parts are applied by `priceBom`.
 */

/**
 * How a pin takes a jumper: `socket` and `terminal` (screw) take a male end, `header` pins a female
 * end, and a `lead` is the part's own wire, so a connection from it needs no jumper at all.
 */
export type ConnectorKind = 'socket' | 'terminal' | 'header' | 'lead';
const LEAD_PARTS = new Set([
  'power.battery-9v',
  'power.battery-4aa',
  'power.switch',
  'actuator.tt-motor',
  'actuator.stepper-28byj48',
]);
const SOCKET_PARTS = new Set(['actuator.sg90-servo', 'actuator.mg996r-servo']);
const TERMINAL_PINS: Readonly<Record<string, readonly string[]>> = {
  'driver.l298n': ['out1', 'out2', 'out3', 'out4', 'vs', 'gnd', 'v5'],
  'driver.irf520-module': ['vin', 'gndIn', 'vplus', 'vminus'],
  'power.lm2596': ['in+', 'in-', 'out+', 'out-'],
};

export function connectorOf(doc: ProjectDocument, ref: PinRef): ConnectorKind {
  if (ref.part === BOARD_PART) return 'socket';
  const type = doc.components.find((c) => c.id === ref.part)?.type ?? '';
  if (breadboardLayout(type) || SOCKET_PARTS.has(type)) return 'socket';
  if (LEAD_PARTS.has(type)) return 'lead';
  if (TERMINAL_PINS[type]?.includes(ref.pin)) return 'terminal';
  return 'header';
}

/** The jumper a wire needs, or null when one end is a part's own lead. */
export function jumperOf(doc: ProjectDocument, from: PinRef, to: PinRef): JumperType | null {
  const ends = [connectorOf(doc, from), connectorOf(doc, to)];
  if (ends.includes('lead')) return null;
  const male = ends.filter((e) => e === 'socket' || e === 'terminal').length;
  return male === 2 ? 'mm' : male === 1 ? 'mf' : 'ff';
}

/** Jumpers come in packs; a few spares cover a bad crimp or a longer run. */
export const JUMPER_PACK = 10;
export const JUMPER_SPARE = 0.2;

export type BomCategory = ComponentManifest['category'] | 'board' | 'consumable';

export interface BomLine {
  /** Price and inventory key (`partKey`). */
  readonly key: string;
  readonly kind: 'board' | 'part' | 'jumper';
  /** Catalogue type, board id, or jumper type. */
  readonly type: string;
  readonly variant: Readonly<Record<string, VariantValue>>;
  readonly category: BomCategory;
  readonly tier: 'basic' | 'pro';
  /** i18n key in `components` for parts; null for the board and jumpers (named by the app). */
  readonly nameKey: string | null;
  /** Units to have: parts, or packs for jumpers. */
  readonly quantity: number;
  /** Component ids on the canvas this line covers. */
  readonly instances: readonly string[];
  /** Jumpers only: wires drawn of this type. */
  readonly wires?: number;
}

const CATEGORY_ORDER: readonly BomCategory[] = [
  'board',
  'driver',
  'actuator',
  'sensor',
  'display',
  'comms',
  'ic',
  'semiconductor',
  'passive',
  'power',
  'mechanical',
  'consumable',
];

export function variantOf(
  type: string,
  props: Readonly<Record<string, VariantValue>>,
): Record<string, VariantValue> {
  const manifest = findManifest(type);
  const out: Record<string, VariantValue> = {};
  for (const name of variantPropsOf(type)) {
    const value = props[name] ?? manifest?.props[name]?.default;
    if (value !== undefined) out[name] = value;
  }
  return out;
}

export function buildBom(doc: ProjectDocument): BomLine[] {
  const lines = new Map<string, BomLine>();
  lines.set(boardKey(doc.board.id), {
    key: boardKey(doc.board.id),
    kind: 'board',
    type: doc.board.id,
    variant: {},
    category: 'board',
    tier: 'basic',
    nameKey: null,
    quantity: 1,
    instances: [BOARD_PART],
  });
  for (const c of doc.components) {
    const manifest = findManifest(c.type);
    const variant = variantOf(c.type, c.props);
    const key = partKey(c.type, variant);
    const line = lines.get(key);
    lines.set(
      key,
      line
        ? { ...line, quantity: line.quantity + 1, instances: [...line.instances, c.id] }
        : {
            key,
            kind: 'part',
            type: c.type,
            variant,
            category: manifest?.category ?? 'passive',
            tier: manifest?.tier ?? 'basic',
            nameKey: manifest?.nameKey ?? null,
            quantity: 1,
            instances: [c.id],
          },
    );
  }
  const wires = new Map<JumperType, number>();
  for (const w of doc.wires) {
    const t = jumperOf(doc, w.from, w.to);
    if (t) wires.set(t, (wires.get(t) ?? 0) + 1);
  }
  for (const t of JUMPER_TYPES) {
    const n = wires.get(t);
    if (!n) continue;
    lines.set(jumperKey(t), {
      key: jumperKey(t),
      kind: 'jumper',
      type: t,
      variant: {},
      category: 'consumable',
      tier: 'basic',
      nameKey: null,
      quantity: Math.ceil((n * (1 + JUMPER_SPARE)) / JUMPER_PACK),
      instances: [],
      wires: n,
    });
  }
  const rank = (l: BomLine) => CATEGORY_ORDER.indexOf(l.category);
  return [...lines.values()].sort((a, b) => rank(a) - rank(b) || a.key.localeCompare(b.key));
}

export interface PricedBomLine extends BomLine {
  readonly owned: number;
  /** Units still to buy after the owned ones. */
  readonly toBuy: number;
  readonly unitPriceIrr: number | null;
  /** `toBuy × unit price`, null without a price. */
  readonly lineTotalIrr: number | null;
  readonly stock: StockStatus;
}

export interface PricedBom {
  readonly lines: readonly PricedBomLine[];
  /** Sum of priced lines to buy. */
  readonly totalIrr: number;
  /** Lines to buy that have no price, so the total is a lower bound. */
  readonly unpriced: number;
}

/**
 * Applies the price list (exact variant first, then the bare type) and owned quantities (FR-BOM-02/03).
 */
export function priceBom(
  lines: readonly BomLine[],
  prices: readonly CatalogPrice[],
  owned: Readonly<Record<string, number>>,
): PricedBom {
  const byKey = new Map(prices.map((p) => [p.partKey, p]));
  let totalIrr = 0;
  let unpriced = 0;
  const priced = lines.map((l): PricedBomLine => {
    const price = byKey.get(l.key) ?? byKey.get(baseKeyOf(l.key));
    const have = Math.min(owned[l.key] ?? 0, l.quantity);
    const toBuy = l.quantity - have;
    const unit = price?.priceIrr ?? null;
    const lineTotal = unit === null ? null : unit * toBuy;
    if (toBuy > 0) {
      if (lineTotal === null) unpriced++;
      else totalIrr += lineTotal;
    }
    return {
      ...l,
      owned: have,
      toBuy,
      unitPriceIrr: unit,
      lineTotalIrr: lineTotal,
      stock: price?.stock ?? 'unknown',
    };
  });
  return { lines: priced, totalIrr, unpriced };
}
