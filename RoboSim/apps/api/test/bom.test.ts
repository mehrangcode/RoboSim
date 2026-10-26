// Parts list (FR-BOM-02, FR-BOM-03; API Spec §4.3, §4.4, §4.13): the staff price list and owned-parts inventories.
import type {
  AdminPriceList,
  CatalogPrice,
  CatalogPriceList,
  Inventory,
  ProblemDetails,
} from '@robosim/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap.js';
import type { Database } from '../src/db/client.js';
import { auditLogs, staffRoles, userInventory, users } from '../src/db/schema.js';
import { withScope, withSystem } from '../src/db/scope.js';
import { testEnv } from './support/app.js';
import { createTestDatabase } from './support/database.js';

let database: Database;
let app: NestFastifyApplication;

beforeAll(async () => {
  database = await createTestDatabase();
  app = await createApp(testEnv(), database);
});
afterAll(async () => {
  await app.close();
  await database.close();
});

type Method = 'GET' | 'PUT' | 'DELETE';
let seq = 0;
const person = (name: string) => `${name}.${++seq}@dev.local`;
const call = (method: Method, url: string, user?: string, body?: unknown) =>
  app.inject({
    method,
    url: `/api/v1${url}`,
    headers: user ? { 'x-dev-user': user } : {},
    ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
  });

async function userId(email: string): Promise<string> {
  await call('GET', '/me/inventory', email);
  const [row] = await withSystem(database.db, (tx) =>
    tx.select({ id: users.id }).from(users).where(eq(users.email, email)),
  );
  return row?.id ?? '';
}

async function staff(role: 'platform_admin' | 'shop_operator' | 'support_agent'): Promise<string> {
  const email = person(role);
  const id = await userId(email);
  await withSystem(database.db, (tx) => tx.insert(staffRoles).values({ userId: id, role }));
  return email;
}

const key = (k: string) => encodeURIComponent(k);

describe('price list', () => {
  it('lets price staff set, list and remove prices, audited, and publishes them', async () => {
    const operator = await staff('shop_operator');
    const set = await call('PUT', `/admin/catalog/prices/${key('passive.resistor?ohms=220')}`, operator, {
      priceIrr: 5_000,
      stock: 'in_stock',
    });
    expect(set.statusCode).toBe(200);
    expect(set.json<CatalogPrice>()).toMatchObject({ partKey: 'passive.resistor?ohms=220', priceIrr: 5_000 });
    expect(
      (
        await call('PUT', `/admin/catalog/prices/${key('board:avr-uno')}`, operator, {
          priceIrr: null,
          stock: 'low',
        })
      ).statusCode,
    ).toBe(200);

    const admin = await call('GET', '/admin/catalog/prices', operator);
    const list = admin.json<AdminPriceList>();
    expect(list.parts.map((p) => p.key)).toEqual(
      expect.arrayContaining(['board:avr-uno', 'driver.l298n', 'consumable.jumper-mf']),
    );
    expect(list.parts.find((p) => p.key === 'passive.resistor')?.variantProps).toEqual(['ohms']);

    // Public, no sign-in needed.
    const pub = (await call('GET', '/catalog/prices')).json<CatalogPriceList>();
    expect(pub.items.map((p) => p.partKey)).toEqual(['board:avr-uno', 'passive.resistor?ohms=220']);
    expect(pub.asOf).not.toBeNull();

    const [audit] = await withSystem(database.db, (tx) =>
      tx
        .select()
        .from(auditLogs)
        .where(
          and(eq(auditLogs.action, 'catalog_price.set'), eq(auditLogs.targetId, 'passive.resistor?ohms=220')),
        ),
    );
    expect(audit).toMatchObject({ actorKind: 'staff', after: { priceIrr: 5_000, stock: 'in_stock' } });

    expect((await call('DELETE', `/admin/catalog/prices/${key('board:avr-uno')}`, operator)).statusCode).toBe(
      204,
    );
    expect((await call('DELETE', `/admin/catalog/prices/${key('board:avr-uno')}`, operator)).statusCode).toBe(
      404,
    );
  });

  it('rejects unknown parts and variants the part does not have', async () => {
    const admin = await staff('platform_admin');
    for (const bad of ['driver.nope', 'passive.resistor?color=red', 'actuator.led?color=purple', 'BAD KEY']) {
      const res = await call('PUT', `/admin/catalog/prices/${key(bad)}`, admin, {
        priceIrr: 1,
        stock: 'unknown',
      });
      expect(res.statusCode, bad).toBe(400);
    }
  });

  it('keeps other staff and users out', async () => {
    const support = await staff('support_agent');
    expect((await call('GET', '/admin/catalog/prices', support)).statusCode).toBe(403);
    const user = person('user');
    const res = await call('PUT', `/admin/catalog/prices/${key('driver.l298n')}`, user, {
      priceIrr: 1,
      stock: 'low',
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('owned parts', () => {
  it('replaces and reads the caller’s own list only', async () => {
    const ana = person('ana');
    const bo = person('bo');
    const put = await call('PUT', '/me/inventory', ana, {
      items: [
        { partKey: 'actuator.tt-motor', quantity: 2 },
        { partKey: 'passive.resistor?ohms=220', quantity: 10 },
      ],
    });
    expect(put.statusCode).toBe(200);
    expect(put.json<Inventory>().items).toHaveLength(2);
    await call('PUT', '/me/inventory', bo, { items: [{ partKey: 'driver.l298n', quantity: 1 }] });

    expect((await call('GET', '/me/inventory', ana)).json<Inventory>().items).toEqual([
      { partKey: 'actuator.tt-motor', quantity: 2 },
      { partKey: 'passive.resistor?ohms=220', quantity: 10 },
    ]);
    const replaced = await call('PUT', '/me/inventory', ana, {
      items: [{ partKey: 'actuator.tt-motor', quantity: 1 }],
    });
    expect(replaced.json<Inventory>().items).toEqual([{ partKey: 'actuator.tt-motor', quantity: 1 }]);
    expect((await call('GET', '/me/inventory', bo)).json<Inventory>().items).toEqual([
      { partKey: 'driver.l298n', quantity: 1 },
    ]);
  });

  it('validates keys, quantities and duplicates', async () => {
    const ana = person('ana');
    const bad = [
      { items: [{ partKey: 'nope.part', quantity: 1 }] },
      { items: [{ partKey: 'driver.l298n', quantity: 0 }] },
      {
        items: [
          { partKey: 'driver.l298n', quantity: 1 },
          { partKey: 'driver.l298n', quantity: 2 },
        ],
      },
    ];
    for (const body of bad) {
      const res = await call('PUT', '/me/inventory', ana, body);
      expect(res.statusCode).toBe(400);
      expect(res.json<ProblemDetails>().code).toBe('validation_failed');
    }
  });

  it('isolates inventories under RLS', async () => {
    const ana = person('ana');
    const anaId = await userId(ana);
    await call('PUT', '/me/inventory', ana, { items: [{ partKey: 'driver.l298n', quantity: 1 }] });
    const other = await userId(person('eve'));
    const seen = await withScope(database.db, { userId: other }, (tx) =>
      tx.select().from(userInventory).where(eq(userInventory.userId, anaId)),
    );
    expect(seen).toEqual([]);
  });
});
