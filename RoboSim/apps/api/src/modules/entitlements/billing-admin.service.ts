import {
  DomainError,
  isUuid,
  type AdminOverride,
  type AdminPlan,
  type AdminSubscription,
  type AdminWorkspace,
  type AdminWorkspaceSummary,
  type createOverrideSchema,
  type createPlanVersionSchema,
  type PlanCode,
  type PublicPlan,
  type setSubscriptionSchema,
} from '@robosim/shared';
import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { and, asc, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { DATABASE, type Database, type Tx } from '../../db/client.js';
import {
  entitlementOverrides,
  memberships,
  plans,
  planVersions,
  projects,
  subscriptions,
  users,
  workspaces,
} from '../../db/schema.js';
import { withSystem } from '../../db/scope.js';
import { AuditService } from '../audit/index.js';
import type { Staff } from '../iam/index.js';
import { OutboxService } from '../outbox/index.js';
import { EntitlementsService, planValues } from './entitlements.service.js';

export type CreatePlanVersion = z.output<typeof createPlanVersionSchema>;
export type SetSubscription = z.output<typeof setSubscriptionSchema>;
export type CreateOverride = z.output<typeof createOverrideSchema>;

const SEARCH_LIMIT = 20;

/**
 * Back office for plans, subscriptions and overrides (FR-ADM-02, FR-ADM-06, FR-BIL-01). Staff act outside tenant
 * RLS, so every change is audited as `staff` in the same transaction and invalidates cached entitlements.
 * Until checkout (P2 commerce), a subscription set here is the only way off Free (`source = manual`).
 */
@Injectable()
export class BillingAdminService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly entitlements: EntitlementsService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** `GET /plans`: the current version of every public plan. */
  async publicPlans(): Promise<PublicPlan[]> {
    const rows = await withSystem(this.database.db, (tx) =>
      tx
        .select({
          code: plans.code,
          version: planVersions.version,
          interval: planVersions.interval,
          priceIrr: planVersions.priceIrr,
          entitlements: planVersions.entitlements,
        })
        .from(planVersions)
        .innerJoin(plans, eq(plans.id, planVersions.planId))
        .where(and(eq(plans.public, true), isNull(planVersions.effectiveTo)))
        .orderBy(asc(plans.createdAt)),
    );
    return rows.map((r) => ({ ...r, entitlements: planValues(r.entitlements) }));
  }

  async listPlans(): Promise<AdminPlan[]> {
    return withSystem(this.database.db, async (tx) => {
      const planRows = await tx.select().from(plans).orderBy(asc(plans.createdAt));
      const versionRows = await tx
        .select({
          version: planVersions,
          subscribers: sql<number>`(select count(*)::int from ${subscriptions} where ${subscriptions.planVersionId} = ${planVersions.id})`,
        })
        .from(planVersions)
        .orderBy(desc(planVersions.version));
      return planRows.map((p) => ({
        code: p.code,
        public: p.public,
        versions: versionRows
          .filter((v) => v.version.planId === p.id)
          .map(({ version: v, subscribers }) => ({
            id: v.id,
            version: v.version,
            interval: v.interval,
            priceIrr: v.priceIrr,
            entitlements: planValues(v.entitlements),
            effectiveFrom: v.effectiveFrom.toISOString(),
            effectiveTo: v.effectiveTo?.toISOString() ?? null,
            subscribers,
          })),
      }));
    });
  }

  /**
   * Publishes a new version and retires the current one. Free applies at once to everyone on it; subscribers of a
   * paid plan keep their version until their subscription is set again (renewal, FR-BIL-01).
   */
  async publishVersion(staff: Staff, code: PlanCode, input: CreatePlanVersion): Promise<AdminPlan> {
    const now = new Date();
    await withSystem(this.database.db, async (tx) => {
      const [plan] = await tx.select().from(plans).where(eq(plans.code, code)).for('update');
      if (!plan) throw new DomainError('not_found');
      const [latest] = await tx
        .select({ version: planVersions.version })
        .from(planVersions)
        .where(eq(planVersions.planId, plan.id))
        .orderBy(desc(planVersions.version))
        .limit(1);
      await tx
        .update(planVersions)
        .set({ effectiveTo: now })
        .where(and(eq(planVersions.planId, plan.id), isNull(planVersions.effectiveTo)));
      const version = (latest?.version ?? 0) + 1;
      await tx.insert(planVersions).values({
        planId: plan.id,
        version,
        interval: input.interval,
        priceIrr: input.priceIrr,
        seatBased: code === 'classroom',
        minSeats: code === 'classroom' ? 10 : 1,
        entitlements: input.entitlements,
        effectiveFrom: now,
        createdBy: staff.userId,
      });
      await this.audit.record(tx, {
        actorId: staff.userId,
        actorKind: 'staff',
        action: 'plan.version_published',
        targetKind: 'plan',
        targetId: code,
        after: { version, ...input },
      });
    });
    this.entitlements.invalidate();
    const updated = (await this.listPlans()).find((p) => p.code === code);
    if (!updated) throw new DomainError('not_found');
    return updated;
  }

  /** Workspaces whose name or owner's email or name contains `q`. */
  async searchWorkspaces(q: string): Promise<AdminWorkspaceSummary[]> {
    const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const rows = await withSystem(this.database.db, (tx) =>
      this.workspaceRows(tx)
        .where(
          and(
            isNull(workspaces.deletedAt),
            q
              ? or(
                  ilike(users.email, pattern),
                  ilike(users.displayName, pattern),
                  ilike(workspaces.name, pattern),
                )
              : undefined,
          ),
        )
        .orderBy(desc(workspaces.createdAt))
        .limit(SEARCH_LIMIT),
    );
    return Promise.all(rows.map((r) => this.summary(r)));
  }

  async getWorkspace(id: string): Promise<AdminWorkspace> {
    const row = await this.workspaceRow(id);
    const summary = await this.summary(row);
    const { values } = await this.entitlements.resolve(row.id, row.ownerId);
    const { overrides, liveProjects } = await withSystem(this.database.db, async (tx) => ({
      overrides: await tx
        .select()
        .from(entitlementOverrides)
        .where(eq(entitlementOverrides.workspaceId, id))
        .orderBy(desc(entitlementOverrides.createdAt)),
      liveProjects: (
        await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(projects)
          .where(and(eq(projects.workspaceId, id), isNull(projects.deletedAt)))
      )[0]?.n,
    }));
    return {
      ...summary,
      effective: values,
      overrides: overrides.map(toOverride),
      liveProjects: liveProjects ?? 0,
    };
  }

  /** Puts a workspace on a plan's current version until `periodEnd`; `free` removes the subscription. */
  async setSubscription(staff: Staff, id: string, input: SetSubscription): Promise<AdminWorkspace> {
    await this.workspaceRow(id);
    const periodEnd = input.periodEnd ? new Date(input.periodEnd) : null;
    if (periodEnd && periodEnd <= new Date())
      throw new DomainError('validation_failed', {
        errors: [{ path: 'periodEnd', message: 'must be in the future' }],
      });
    if (input.plan === 'private_cloud')
      throw new DomainError('validation_failed', {
        errors: [{ path: 'plan', message: 'licensed per contract' }],
      });
    await withSystem(this.database.db, async (tx) => {
      const [before] = await tx
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.workspaceId, id))
        .for('update');
      let after: Record<string, unknown> | null = null;
      if (input.plan === 'free') {
        await tx.delete(subscriptions).where(eq(subscriptions.workspaceId, id));
      } else {
        const version = await this.entitlements.currentVersion(tx, input.plan);
        const values = {
          planVersionId: version.id,
          status: 'active' as const,
          source: 'manual' as const,
          trialEndsAt: null,
          currentPeriodStart: new Date(),
          currentPeriodEnd: periodEnd,
          updatedBy: staff.userId,
        };
        await tx
          .insert(subscriptions)
          .values({ workspaceId: id, ...values })
          .onConflictDoUpdate({ target: subscriptions.workspaceId, set: values });
        after = { plan: input.plan, version: version.version, periodEnd: input.periodEnd };
      }
      await this.audit.record(tx, {
        actorId: staff.userId,
        actorKind: 'staff',
        workspaceId: id,
        action: 'subscription.changed',
        targetKind: 'workspace',
        targetId: id,
        before: before ? { planVersionId: before.planVersionId, periodEnd: before.currentPeriodEnd } : null,
        after: { ...(after ?? { plan: 'free' }), reason: input.reason },
      });
      await this.outbox.enqueue(tx, {
        aggregateKind: 'workspace',
        aggregateId: id,
        type: 'bil.subscription_changed',
        payload: { workspaceId: id, plan: input.plan, periodEnd: input.periodEnd },
      });
    });
    this.entitlements.invalidate(id);
    return this.getWorkspace(id);
  }

  async addOverride(staff: Staff, id: string, input: CreateOverride): Promise<AdminWorkspace> {
    await this.workspaceRow(id);
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (expiresAt && expiresAt <= new Date())
      throw new DomainError('validation_failed', {
        errors: [{ path: 'expiresAt', message: 'must be in the future' }],
      });
    await withSystem(this.database.db, async (tx) => {
      if (input.userId) {
        const [member] = await tx
          .select({ id: memberships.id })
          .from(memberships)
          .where(and(eq(memberships.workspaceId, id), eq(memberships.userId, input.userId)));
        if (!member) throw new DomainError('not_found', { field: 'userId' });
      }
      const [created] = await tx
        .insert(entitlementOverrides)
        .values({
          workspaceId: id,
          userId: input.userId,
          key: input.key,
          value: input.value,
          reason: input.reason,
          grantedBy: staff.userId,
          expiresAt,
        })
        .returning();
      await this.audit.record(tx, {
        actorId: staff.userId,
        actorKind: 'staff',
        workspaceId: id,
        action: 'entitlement_override.granted',
        targetKind: 'entitlement_override',
        targetId: created?.id ?? null,
        after: {
          key: input.key,
          value: input.value,
          userId: input.userId,
          expiresAt: input.expiresAt,
          reason: input.reason,
        },
      });
    });
    this.entitlements.invalidate(id);
    return this.getWorkspace(id);
  }

  async removeOverride(staff: Staff, id: string, overrideId: string): Promise<AdminWorkspace> {
    if (!isUuid(overrideId)) throw new DomainError('not_found');
    await withSystem(this.database.db, async (tx) => {
      const [removed] = await tx
        .delete(entitlementOverrides)
        .where(and(eq(entitlementOverrides.id, overrideId), eq(entitlementOverrides.workspaceId, id)))
        .returning();
      if (!removed) throw new DomainError('not_found');
      await this.audit.record(tx, {
        actorId: staff.userId,
        actorKind: 'staff',
        workspaceId: id,
        action: 'entitlement_override.revoked',
        targetKind: 'entitlement_override',
        targetId: overrideId,
        before: { key: removed.key, value: removed.value, userId: removed.userId },
      });
    });
    this.entitlements.invalidate(id);
    return this.getWorkspace(id);
  }

  private workspaceRows(tx: Tx) {
    return tx
      .select({
        id: workspaces.id,
        name: workspaces.name,
        kind: workspaces.kind,
        ownerId: workspaces.ownerUserId,
        ownerEmail: users.email,
        ownerName: users.displayName,
      })
      .from(workspaces)
      .innerJoin(users, eq(users.id, workspaces.ownerUserId));
  }

  private async workspaceRow(id: string) {
    if (!isUuid(id)) throw new DomainError('not_found');
    const [row] = await withSystem(this.database.db, (tx) =>
      this.workspaceRows(tx).where(and(eq(workspaces.id, id), isNull(workspaces.deletedAt))),
    );
    if (!row) throw new DomainError('not_found');
    return row;
  }

  private async summary(row: {
    id: string;
    name: string;
    kind: AdminWorkspaceSummary['kind'];
    ownerId: string;
    ownerEmail: string | null;
    ownerName: string;
  }): Promise<AdminWorkspaceSummary> {
    const { plan } = await this.entitlements.resolve(row.id, row.ownerId);
    const subscription: AdminSubscription = {
      plan: plan.code,
      version: plan.version,
      status: plan.status,
      periodEnd: plan.periodEnd?.toISOString() ?? null,
      source: plan.source,
    };
    return { ...row, subscription };
  }
}

function toOverride(row: typeof entitlementOverrides.$inferSelect): AdminOverride {
  return {
    id: row.id,
    userId: row.userId,
    key: row.key,
    value: row.value,
    reason: row.reason,
    grantedBy: row.grantedBy,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
