import {
  DEFAULT_PLAN_ENTITLEMENTS,
  DomainError,
  entitlementValueSchema,
  entitlementValuesSchema,
  FEATURE_ENTITLEMENTS,
  isEntitlementKey,
  mergeEntitlements,
  QUOTA_ENTITLEMENTS,
  type EntitlementGrant,
  type EntitlementValues,
  type FeatureEntitlement,
  type MeEntitlements,
  type PlanCode,
  type SubscriptionStatus,
} from '@robosim/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { ENV, type Env } from '../../config/env.js';
import { DATABASE, type Database, type Tx } from '../../db/client.js';
import {
  entitlementOverrides,
  plans,
  planVersions,
  projects,
  subscriptions,
  users,
} from '../../db/schema.js';
import { withSystem } from '../../db/scope.js';
import { QuotaService } from './quota.service.js';

/** The plan a workspace is on, as far as entitlements are concerned. */
export interface ResolvedPlan {
  code: PlanCode;
  version: number;
  versionId: string;
  status: SubscriptionStatus;
  trialEndsAt: Date | null;
  periodEnd: Date | null;
  source: string | null;
}

export interface Resolved {
  plan: ResolvedPlan;
  values: EntitlementValues;
}

/**
 * Effective entitlements per `(workspace, user)` (FR-BIL-04, TD §9.1): the live subscription's plan version — or
 * the current Free version — ⊕ unexpired overrides for the workspace or that member. Every enforcement point asks
 * this service. Results are cached for `ENTITLEMENTS_CACHE_MS` (≤ 60 s); staff changes invalidate in-process, so
 * they apply on the next request. Reads are trusted system queries: they also serve sharees and guests.
 */
@Injectable()
export class EntitlementsService {
  private readonly logger = new Logger(EntitlementsService.name);
  private readonly cache = new Map<string, { at: number; value: Resolved }>();

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly quotas: QuotaService,
  ) {}

  async resolve(workspaceId: string, userId: string, now: Date = new Date()): Promise<Resolved> {
    const key = `${workspaceId}:${userId}`;
    const hit = this.cache.get(key);
    if (hit && now.getTime() - hit.at < this.env.ENTITLEMENTS_CACHE_MS) return hit.value;
    const value = await withSystem(this.database.db, (tx) => this.load(tx, workspaceId, userId, now));
    this.cache.set(key, { at: now.getTime(), value });
    if (this.cache.size > 10_000) this.cache.clear();
    return value;
  }

  /** Drops cached results for one workspace, or all of them (a plan version changed). */
  invalidate(workspaceId?: string): void {
    if (workspaceId === undefined) return this.cache.clear();
    for (const key of this.cache.keys()) if (key.startsWith(`${workspaceId}:`)) this.cache.delete(key);
  }

  /** `403 entitlement_required` unless the feature is on (API Spec §3.1). */
  async requireFeature(workspaceId: string, userId: string, feature: FeatureEntitlement): Promise<void> {
    const { values } = await this.resolve(workspaceId, userId);
    if (!values[feature])
      throw new DomainError('entitlement_required', { entitlement: feature, suggestedPlan: 'maker' });
  }

  /** `GET /me/entitlements`: the caller's entitlements in their current workspace, with today's use. */
  async me(workspaceId: string, userId: string, now: Date = new Date()): Promise<MeEntitlements> {
    const { plan, values } = await this.resolve(workspaceId, userId, now);
    const [counts] = await withSystem(this.database.db, (tx) =>
      tx
        .select({
          projects: sql<number>`(select count(*)::int from ${projects} where ${projects.workspaceId} = ${workspaceId} and ${projects.deletedAt} is null)`,
          ageBand: users.ageBand,
        })
        .from(users)
        .where(eq(users.id, userId)),
    );
    const builds = this.quotas.peek('build.daily_quota', userId, now.getTime());
    const quotas: MeEntitlements['quotas'] = {};
    for (const key of QUOTA_ENTITLEMENTS) quotas[key] = { limit: values[key] };
    quotas['projects.cloud_max'] = { limit: values['projects.cloud_max'], used: counts?.projects ?? 0 };
    quotas['build.daily_quota'] = {
      limit: values['build.daily_quota'],
      used: builds.used,
      resetsAt: builds.resetsAt.toISOString(),
    };
    return {
      plan: {
        code: plan.code,
        version: plan.version,
        status: plan.status,
        trialEndsAt: plan.trialEndsAt?.toISOString() ?? null,
        periodEnd: plan.periodEnd?.toISOString() ?? null,
      },
      features: Object.fromEntries(FEATURE_ENTITLEMENTS.map((k) => [k, values[k]])),
      quotas,
      settings: {
        'boards.allowed': values['boards.allowed'],
        'components.tier': values['components.tier'],
        'build.priority': values['build.priority'],
        'learning.guided_projects': values['learning.guided_projects'],
        'learning.courses': values['learning.courses'],
      },
      restrictions: { ageBand: counts?.ageBand ?? 'adult', policy: null },
    };
  }

  private async load(tx: Tx, workspaceId: string, userId: string, now: Date): Promise<Resolved> {
    const [sub] = await tx
      .select({
        status: subscriptions.status,
        source: subscriptions.source,
        trialEndsAt: subscriptions.trialEndsAt,
        periodEnd: subscriptions.currentPeriodEnd,
        versionId: planVersions.id,
        version: planVersions.version,
        entitlements: planVersions.entitlements,
        code: plans.code,
      })
      .from(subscriptions)
      .innerJoin(planVersions, eq(planVersions.id, subscriptions.planVersionId))
      .innerJoin(plans, eq(plans.id, planVersions.planId))
      .where(eq(subscriptions.workspaceId, workspaceId));
    const live =
      sub &&
      (sub.status === 'active' || sub.status === 'trialing') &&
      (sub.periodEnd === null || sub.periodEnd > now);

    let plan: ResolvedPlan;
    let stored: unknown;
    if (live) {
      plan = {
        code: sub.code,
        version: sub.version,
        versionId: sub.versionId,
        status: sub.status,
        trialEndsAt: sub.trialEndsAt,
        periodEnd: sub.periodEnd,
        source: sub.source,
      };
      stored = sub.entitlements;
    } else {
      const free = await this.currentVersion(tx, 'free');
      plan = {
        code: 'free',
        version: free.version,
        versionId: free.id,
        // A lapsed subscription shows as expired; never having had one is simply Free.
        status: sub ? 'expired' : 'active',
        trialEndsAt: null,
        periodEnd: null,
        source: null,
      };
      stored = free.entitlements;
    }

    const overrides = await tx
      .select({ key: entitlementOverrides.key, value: entitlementOverrides.value })
      .from(entitlementOverrides)
      .where(
        and(
          eq(entitlementOverrides.workspaceId, workspaceId),
          or(isNull(entitlementOverrides.userId), eq(entitlementOverrides.userId, userId)),
          or(isNull(entitlementOverrides.expiresAt), gt(entitlementOverrides.expiresAt, now)),
        ),
      );
    const grants: EntitlementGrant[] = [];
    for (const o of overrides) {
      if (isEntitlementKey(o.key) && entitlementValueSchema(o.key).safeParse(o.value).success)
        grants.push({ [o.key]: o.value });
      else this.logger.warn(`ignoring invalid override ${o.key} on workspace ${workspaceId}`);
    }
    return { plan, values: mergeEntitlements(planValues(stored), grants) };
  }

  /** The plan version new subscriptions get: the highest one not yet replaced. */
  async currentVersion(
    tx: Tx,
    code: PlanCode,
  ): Promise<{ id: string; version: number; entitlements: unknown }> {
    const [row] = await tx
      .select({ id: planVersions.id, version: planVersions.version, entitlements: planVersions.entitlements })
      .from(planVersions)
      .innerJoin(plans, eq(plans.id, planVersions.planId))
      .where(and(eq(plans.code, code), isNull(planVersions.effectiveTo)))
      .orderBy(desc(planVersions.version))
      .limit(1);
    if (!row) throw new Error(`plan ${code} has no current version`);
    return row;
  }
}

/**
 * A stored version's entitlements. Keys added after it was published fall back to Free's default, so old versions
 * stay readable as the key list grows.
 */
export function planValues(stored: unknown): EntitlementValues {
  return entitlementValuesSchema.parse({ ...DEFAULT_PLAN_ENTITLEMENTS.free, ...(stored as object) });
}
