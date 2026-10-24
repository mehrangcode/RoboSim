import type { EntitlementGrant, PlanCode } from '@robosim/shared';
import type { INestApplicationContext } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Database } from '../../src/db/client.js';
import { plans, planVersions, subscriptions, users } from '../../src/db/schema.js';
import { withSystem } from '../../src/db/scope.js';
import { EntitlementsService } from '../../src/modules/entitlements/index.js';

/**
 * Patches the current version of a plan in place (tests only: real changes publish a new version) and drops cached
 * entitlements. Returns a function that puts the previous values back.
 */
export async function patchPlan(
  app: INestApplicationContext,
  database: Database,
  code: PlanCode,
  patch: EntitlementGrant,
): Promise<() => Promise<void>> {
  const current = and(
    isNull(planVersions.effectiveTo),
    sql`${planVersions.planId} = (select ${plans.id} from ${plans} where ${plans.code} = ${code})`,
  );
  const [before] = await withSystem(database.db, (tx) =>
    tx.select({ entitlements: planVersions.entitlements }).from(planVersions).where(current),
  );
  if (!before) throw new Error(`plan ${code} has no current version`);
  const set = async (entitlements: typeof before.entitlements) => {
    await withSystem(database.db, (tx) => tx.update(planVersions).set({ entitlements }).where(current));
    app.get(EntitlementsService).invalidate();
  };
  await set({ ...before.entitlements, ...patch } as typeof before.entitlements);
  return () => set(before.entitlements);
}

/** Puts a user's personal workspace on a plan's current version (as the back office would), open-ended. */
export async function subscribe(
  app: INestApplicationContext,
  database: Database,
  email: string,
  code: Exclude<PlanCode, 'free'>,
): Promise<void> {
  await withSystem(database.db, async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.email, email));
    const [version] = await tx
      .select({ id: planVersions.id })
      .from(planVersions)
      .innerJoin(plans, eq(plans.id, planVersions.planId))
      .where(and(eq(plans.code, code), isNull(planVersions.effectiveTo)));
    if (!user?.personalWorkspaceId || !version) throw new Error(`cannot subscribe ${email} to ${code}`);
    const values = { planVersionId: version.id, status: 'active' as const, source: 'manual' as const };
    await tx
      .insert(subscriptions)
      .values({ workspaceId: user.personalWorkspaceId, ...values })
      .onConflictDoUpdate({ target: subscriptions.workspaceId, set: values });
  });
  app.get(EntitlementsService).invalidate();
}
