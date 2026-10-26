import { z } from 'zod';

/**
 * Parts list contract (FR-BOM-01…03, API Spec §4.3, §4.4): the price list staff keep per purchasable part
 * and the parts a user already owns. The BOM itself is computed from the project document in the
 * client; these keys tie its lines to prices and to the owned-parts inventory.
 *
 * A part key is a catalogue type, a board (`board:avr-uno`) or a consumable (`consumable.jumper-mm`),
 * optionally narrowed to a variant by sorted `prop=value` pairs: `passive.resistor?ohms=220`.
 * A price for the bare type applies to every variant without its own price.
 */
const keyPart = '[a-z0-9][a-z0-9._:-]{0,63}';
const variantPart = '[A-Za-z][A-Za-z0-9]{0,31}=[A-Za-z0-9._+-]{1,32}';
export const PART_KEY_PATTERN = new RegExp(`^${keyPart}(\\?${variantPart}(&${variantPart}){0,5})?$`);
export const partKeySchema = z.string().max(200).regex(PART_KEY_PATTERN, 'invalid part key');

export type VariantValue = string | number | boolean;

/** Canonical key for a type and its variant props (sorted, so equal variants share one key). */
export function partKey(type: string, variant: Readonly<Record<string, VariantValue>> = {}): string {
  const pairs = Object.keys(variant)
    .sort()
    .map((k) => `${k}=${String(variant[k])}`);
  return pairs.length ? `${type}?${pairs.join('&')}` : type;
}

/** The type a key belongs to (the key without its variant). */
export function baseKeyOf(key: string): string {
  const q = key.indexOf('?');
  return q < 0 ? key : key.slice(0, q);
}

/** Jumper wires by their ends: male-male, male-female, female-female. */
export const JUMPER_TYPES = ['mm', 'mf', 'ff'] as const;
export type JumperType = (typeof JUMPER_TYPES)[number];
export const jumperKey = (t: JumperType): string => `consumable.jumper-${t}`;
export const boardKey = (boardId: string): string => `board:${boardId}`;

export const STOCK_STATUSES = ['in_stock', 'low', 'out_of_stock', 'unknown'] as const;
export const stockStatusSchema = z.enum(STOCK_STATUSES);
export type StockStatus = z.infer<typeof stockStatusSchema>;

export const catalogPriceSchema = z.object({
  partKey: partKeySchema,
  /** Unit price in rials; null when the part is listed without a price yet. */
  priceIrr: z.number().int().min(0).nullable(),
  stock: stockStatusSchema,
  updatedAt: z.string(),
});
export type CatalogPrice = z.infer<typeof catalogPriceSchema>;

export const catalogPriceListSchema = z.object({
  items: z.array(catalogPriceSchema),
  /** Latest change in the list: the BOM's "price as of" (FR-BOM-02); null for an empty list. */
  asOf: z.string().nullable(),
});
export type CatalogPriceList = z.infer<typeof catalogPriceListSchema>;

/** A purchasable part staff can price: a board, a catalogue type, or a jumper type. */
export const priceablePartSchema = z.object({
  key: partKeySchema,
  kind: z.enum(['board', 'part', 'jumper']),
  /** Manifest category for parts; null for boards and jumpers. */
  category: z.string().nullable(),
  /** i18n key in `components` for catalogue parts; null otherwise. */
  nameKey: z.string().nullable(),
  /** Props whose values make variants that can carry their own price (`passive.resistor` → ohms). */
  variantProps: z.array(z.string()),
});
export type PriceablePart = z.infer<typeof priceablePartSchema>;

/** `GET /admin/catalog/prices`: every priceable part and the rows set so far (variants included). */
export const adminPriceListSchema = catalogPriceListSchema.extend({ parts: z.array(priceablePartSchema) });
export type AdminPriceList = z.infer<typeof adminPriceListSchema>;

/** Staff upsert of one price row (`PUT /admin/catalog/prices/:partKey`). */
export const upsertCatalogPriceSchema = z.strictObject({
  priceIrr: z.number().int().min(0).max(100_000_000_000).nullable(),
  stock: stockStatusSchema,
});
export type UpsertCatalogPriceInput = z.infer<typeof upsertCatalogPriceSchema>;

export const INVENTORY_MAX_ITEMS = 500;
export const inventoryItemSchema = z.strictObject({
  partKey: partKeySchema,
  quantity: z.number().int().min(1).max(10_000),
});
export type InventoryItem = z.infer<typeof inventoryItemSchema>;

/** "I already own" parts of the signed-in user (FR-BOM-03): `GET` and `PUT /me/inventory` replace the list. */
export const inventorySchema = z
  .strictObject({ items: z.array(inventoryItemSchema).max(INVENTORY_MAX_ITEMS) })
  .refine((v) => new Set(v.items.map((i) => i.partKey)).size === v.items.length, {
    message: 'duplicate part key',
    path: ['items'],
  });
export type Inventory = z.infer<typeof inventorySchema>;
