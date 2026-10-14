import { createPgliteDatabase, type Database } from '../../src/db/client.js';

/** Fresh in-memory PostgreSQL (PGlite) with all migrations applied. */
export async function createTestDatabase(): Promise<Database> {
  const database = await createPgliteDatabase('memory://');
  await database.migrate();
  return database;
}
