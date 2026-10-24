// Runs the version-retention purge once (`pnpm versions:purge [--dry-run]`); the API also runs it daily.
import { NestFactory } from '@nestjs/core';
import 'reflect-metadata';
import { AppModule } from '../app.module.js';
import { loadEnv } from '../config/env.js';
import { openDatabase } from '../db/open.js';
import { VersionRetention } from '../modules/projects/index.js';

const env = loadEnv();
const database = await openDatabase(env);
if (database.driver === 'pglite') await database.migrate();
const app = await NestFactory.createApplicationContext(AppModule.register(env, database), {
  logger: ['error', 'warn'],
});

try {
  const report = await app.get(VersionRetention).purge({ dryRun: process.argv.includes('--dry-run') });
  console.warn(
    `${report.dryRun ? 'Would delete' : 'Deleted'} ${report.versions} versions in ${report.workspaces} workspaces.`,
  );
} finally {
  await app.close();
  await database.close();
}
