// Development seed: demo users and feature flags. Idempotent; never run against production.
import { NestFactory } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import 'reflect-metadata';
import { AppModule } from '../app.module.js';
import { loadEnv } from '../config/env.js';
import { UsersService } from '../modules/iam/index.js';
import { featureFlags, staffRoles, users } from './schema.js';
import { openDatabase } from './open.js';
import { withSystem } from './scope.js';

const env = loadEnv();
if (env.APP_ENV === 'production' || env.APP_ENV === 'staging')
  throw new Error(`Refusing to seed ${env.APP_ENV}`);

const database = await openDatabase(env);
if (database.driver === 'pglite') await database.migrate();
const app = await NestFactory.createApplicationContext(AppModule.register(env, database), {
  logger: ['error', 'warn'],
});

try {
  const usersService = app.get(UsersService);
  const demo = [
    { email: 'learner@dev.local', displayName: 'Sara (learner)', locale: 'fa' as const },
    { email: 'teacher@dev.local', displayName: 'Ms. Rezaei (teacher)', locale: 'fa' as const },
    {
      email: 'admin@dev.local',
      displayName: 'Admin',
      locale: 'en' as const,
      staff: 'platform_admin' as const,
    },
  ];
  for (const person of demo) {
    const [existing] = await withSystem(database.db, (tx) =>
      tx.select({ id: users.id }).from(users).where(eq(users.email, person.email)),
    );
    const id = existing?.id ?? (await usersService.createUser(person)).id;
    if (person.staff) {
      await withSystem(database.db, (tx) =>
        tx.insert(staffRoles).values({ userId: id, role: person.staff }).onConflictDoNothing(),
      );
    }
  }
  await withSystem(database.db, (tx) =>
    tx
      .insert(featureFlags)
      .values([
        {
          key: 'workspace.five-pane',
          description: 'P1 editor workspace layout',
          enabled: true,
          rules: [{ environments: ['local'], value: true }],
        },
        { key: 'collab.realtime', description: 'Real-time collaboration (P4)', enabled: false, rules: [] },
      ])
      .onConflictDoNothing(),
  );
  console.warn(`Seeded ${demo.length} users and feature flags (${database.driver}).`);
} finally {
  await app.close();
  await database.close();
}
