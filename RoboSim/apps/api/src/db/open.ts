import type { Env } from '../config/env.js';
import { createPgliteDatabase, createPostgresDatabase, type Database } from './client.js';

export async function openDatabase(env: Env): Promise<Database> {
  if (env.DATABASE_DRIVER === 'pglite') return createPgliteDatabase(env.PGLITE_DATA_DIR);
  // loadEnv guarantees DATABASE_URL for the postgres driver.
  return createPostgresDatabase(env.DATABASE_URL ?? '');
}
