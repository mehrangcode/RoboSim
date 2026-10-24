// Bootstraps back-office access (`pnpm admin:grant <email> <role> [--revoke]`): staff roles are otherwise granted by
// a platform admin. Audited as a system action.
import { staffRoleSchema } from '@robosim/shared';
import { and, eq } from 'drizzle-orm';
import { loadEnv } from '../config/env.js';
import { auditLogs, staffRoles, users } from '../db/schema.js';
import { openDatabase } from '../db/open.js';
import { withSystem } from '../db/scope.js';

const [email, roleArg] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const revoke = process.argv.includes('--revoke');
const role = staffRoleSchema.safeParse(roleArg);
if (!email || !role.success) {
  console.error(`Usage: pnpm admin:grant <email> <${staffRoleSchema.options.join('|')}> [--revoke]`);
  process.exit(2);
}

const env = loadEnv();
const database = await openDatabase(env);
if (database.driver === 'pglite') await database.migrate();
try {
  await withSystem(database.db, async (tx) => {
    const [user] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email.trim().toLowerCase()));
    if (!user) throw new Error(`No account with email ${email}; create it first (sign up or pnpm db:seed).`);
    if (revoke)
      await tx.delete(staffRoles).where(and(eq(staffRoles.userId, user.id), eq(staffRoles.role, role.data)));
    else await tx.insert(staffRoles).values({ userId: user.id, role: role.data }).onConflictDoNothing();
    await tx.insert(auditLogs).values({
      actorKind: 'system',
      action: revoke ? 'staff_role.revoked' : 'staff_role.granted',
      targetKind: 'user',
      targetId: user.id,
      after: { role: role.data, via: 'admin:grant' },
    });
  });
  console.warn(`${revoke ? 'Revoked' : 'Granted'} ${role.data} ${revoke ? 'from' : 'to'} ${email}.`);
} finally {
  await database.close();
}
