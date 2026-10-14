import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/db/client.js';
import { createTestDatabase } from './support/database.js';

let database: Database;
beforeAll(async () => {
  database = await createTestDatabase();
});
afterAll(() => database.close());

describe('migrations on PGlite', () => {
  it('applies baseline + RLS and switches to the restricted role', async () => {
    const rows = await database.db.transaction(async (tx) => {
      await tx.execute(sql`set local role robosim_app`);
      return tx.execute(
        sql`select current_user as role, (select rolbypassrls from pg_roles where rolname = current_user) as bypass`,
      );
    });
    const row = (rows as unknown as { rows: { role: string; bypass: boolean }[] }).rows[0];
    expect(row).toEqual({ role: 'robosim_app', bypass: false });
  });
});
