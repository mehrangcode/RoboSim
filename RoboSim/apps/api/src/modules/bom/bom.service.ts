import { CATALOG_MANIFESTS, findManifest, variantPropsOf } from '@robosim/catalog/manifests';
import {
  BUILD_BOARDS,
  DomainError,
  JUMPER_TYPES,
  baseKeyOf,
  boardKey,
  jumperKey,
  type AdminPriceList,
  type CatalogPrice,
  type CatalogPriceList,
  type Inventory,
  type PriceablePart,
  type UpsertCatalogPriceInput,
} from '@robosim/shared';
import { Inject, Injectable } from '@nestjs/common';
import { asc, eq, sql } from 'drizzle-orm';
import { DATABASE, type Database } from '../../db/client.js';
import { catalogPrices, userInventory } from '../../db/schema.js';
import { withScope, withSystem } from '../../db/scope.js';
import { AuditService } from '../audit/index.js';
import type { Staff } from '../iam/index.js';

/** Everything that can carry a price: boards, catalogue parts (not the chassis-less mechanical extras), jumpers. */
const PRICEABLE: readonly PriceablePart[] = [
  ...BUILD_BOARDS.map((b) => ({
    key: boardKey(b),
    kind: 'board' as const,
    category: null,
    nameKey: null,
    variantProps: [],
  })),
  ...CATALOG_MANIFESTS.map((m) => ({
    key: m.id,
    kind: 'part' as const,
    category: m.category,
    nameKey: m.nameKey,
    variantProps: [...variantPropsOf(m.id)],
  })),
  ...JUMPER_TYPES.map((t) => ({
    key: jumperKey(t),
    kind: 'jumper' as const,
    category: null,
    nameKey: null,
    variantProps: [],
  })),
];
const PRICEABLE_BY_KEY = new Map(PRICEABLE.map((p) => [p.key, p]));

/**
 * A key names a known part, and a variant only uses that part's variant props with valid values (an enum
 * option, a number for a number prop). Keeps typos out of the price list and inventories.
 */
export function checkPartKey(key: string): void {
  const base = PRICEABLE_BY_KEY.get(baseKeyOf(key));
  if (!base) throw new DomainError('validation_failed', { field: 'partKey', reason: 'unknown part' });
  const query = key.slice(baseKeyOf(key).length + 1);
  if (!query) return;
  const manifest = findManifest(base.key);
  for (const pair of query.split('&')) {
    const [prop = '', value = ''] = pair.split('=');
    const spec = manifest?.props[prop];
    const ok =
      base.variantProps.includes(prop) &&
      spec !== undefined &&
      (spec.type === 'enum'
        ? spec.options.includes(value)
        : spec.type === 'number'
          ? Number.isFinite(Number(value))
          : value === 'true' || value === 'false');
    if (!ok)
      throw new DomainError('validation_failed', { field: 'partKey', reason: `bad variant '${pair}'` });
  }
}

const toPrice = (r: typeof catalogPrices.$inferSelect): CatalogPrice => ({
  partKey: r.partKey,
  priceIrr: r.priceIrr,
  stock: r.stock,
  updatedAt: r.updatedAt.toISOString(),
});

/** Parts price list and owned-parts inventories (FR-BOM-02, FR-BOM-03; API Spec §4.3, §4.4). */
@Injectable()
export class BomService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  async prices(): Promise<CatalogPriceList> {
    const rows = await withScope(this.database.db, {}, (tx) =>
      tx.select().from(catalogPrices).orderBy(asc(catalogPrices.partKey)),
    );
    const items = rows.map(toPrice);
    const asOf = items.reduce<string | null>(
      (a, p) => (a === null || p.updatedAt > a ? p.updatedAt : a),
      null,
    );
    return { items, asOf };
  }

  async adminPrices(): Promise<AdminPriceList> {
    return { ...(await this.prices()), parts: [...PRICEABLE] };
  }

  async setPrice(staff: Staff, partKey: string, input: UpsertCatalogPriceInput): Promise<CatalogPrice> {
    checkPartKey(partKey);
    return withSystem(this.database.db, async (tx) => {
      const [before] = await tx.select().from(catalogPrices).where(eq(catalogPrices.partKey, partKey));
      const [row] = await tx
        .insert(catalogPrices)
        .values({ partKey, ...input, updatedBy: staff.userId })
        .onConflictDoUpdate({
          target: catalogPrices.partKey,
          set: { ...input, updatedBy: staff.userId, updatedAt: sql`now()` },
        })
        .returning();
      if (!row) throw new Error('price upsert returned nothing');
      await this.audit.record(tx, {
        actorId: staff.userId,
        actorKind: 'staff',
        action: 'catalog_price.set',
        targetKind: 'catalog_price',
        targetId: partKey,
        before: before ? { priceIrr: before.priceIrr, stock: before.stock } : null,
        after: input,
      });
      return toPrice(row);
    });
  }

  async removePrice(staff: Staff, partKey: string): Promise<void> {
    await withSystem(this.database.db, async (tx) => {
      const [before] = await tx.delete(catalogPrices).where(eq(catalogPrices.partKey, partKey)).returning();
      if (!before) throw new DomainError('not_found');
      await this.audit.record(tx, {
        actorId: staff.userId,
        actorKind: 'staff',
        action: 'catalog_price.removed',
        targetKind: 'catalog_price',
        targetId: partKey,
        before: { priceIrr: before.priceIrr, stock: before.stock },
      });
    });
  }

  async inventory(userId: string): Promise<Inventory> {
    const rows = await withScope(this.database.db, { userId }, (tx) =>
      tx
        .select({ partKey: userInventory.partKey, quantity: userInventory.quantity })
        .from(userInventory)
        .orderBy(asc(userInventory.partKey)),
    );
    return { items: rows };
  }

  /** Replaces the whole list: the client edits it as one set of "I already own" marks. */
  async setInventory(userId: string, input: Inventory): Promise<Inventory> {
    for (const item of input.items) checkPartKey(item.partKey);
    await withScope(this.database.db, { userId }, async (tx) => {
      await tx.delete(userInventory).where(eq(userInventory.userId, userId));
      if (input.items.length)
        await tx.insert(userInventory).values(input.items.map((i) => ({ userId, ...i })));
    });
    return this.inventory(userId);
  }
}
