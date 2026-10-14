import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { loadEnv, type Env } from '../../src/config/env.js';
import type { Database } from '../../src/db/client.js';

export function testEnv(overrides: Record<string, string> = {}): Env {
  return loadEnv({
    NODE_ENV: 'test',
    APP_ENV: 'test',
    DATABASE_DRIVER: 'pglite',
    LOG_LEVEL: 'silent',
    ...overrides,
  });
}

/** Nest module graph without HTTP, for service-level tests against a real (PGlite) database. */
export async function createTestingModule(database: Database, env: Env = testEnv()) {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.register(env, database)],
  }).compile();
  await moduleRef.init();
  return moduleRef;
}
