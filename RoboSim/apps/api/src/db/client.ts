import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import pg from 'pg';
import * as schema from './schema.js';

export type Schema = typeof schema;
export type Db = PgDatabase<PgQueryResultHKT, Schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface Database {
  readonly db: Db;
  readonly driver: 'postgres' | 'pglite';
  migrate(): Promise<void>;
  ping(): Promise<void>;
  close(): Promise<void>;
}

export const DATABASE = Symbol('DATABASE');

const MIGRATIONS_FOLDER = resolve(import.meta.dirname, '../../drizzle/migrations');

export function createPostgresDatabase(url: string): Database {
  const pool = new pg.Pool({ connectionString: url, max: 10, idleTimeoutMillis: 30_000 });
  const db = drizzlePg({ client: pool, schema, casing: 'snake_case' });
  return {
    db: db as unknown as Db,
    driver: 'postgres',
    migrate: () => migratePg(db, { migrationsFolder: MIGRATIONS_FOLDER }),
    ping: async () => void (await pool.query('select 1')),
    close: () => pool.end(),
  };
}

/** In-process PostgreSQL (WASM) for local development without Docker and for tests. */
export async function createPgliteDatabase(dataDir = 'memory://'): Promise<Database> {
  const client = await PGlite.create(dataDir);
  const db = drizzlePglite({ client, schema, casing: 'snake_case' });
  return {
    db: db as unknown as Db,
    driver: 'pglite',
    migrate: () => migratePglite(db, { migrationsFolder: MIGRATIONS_FOLDER }),
    ping: async () => void (await client.query('select 1')),
    close: () => client.close(),
  };
}
