import { z } from 'zod';
import { BUILD_BOARDS } from './build-schema.js';
import { ageBandSchema } from './workspace.js';

/** Server-enforced entitlements (PRD §3, Technical Design §9.1, FR-BIL-04). Shared by the API, web and admin. */

export const FEATURE_ENTITLEMENTS = [
  'export.csv',
  'export.pdf',
  'collab.realtime',
  'community.publish',
  'ai.byok',
  'hwb.upload',
  'arena.custom',
  'org.classes',
  'org.verified_grading',
  'org.sso',
  'org.scim',
  'org.lti',
  'org.analytics',
  'org.audit_export',
] as const;

export const QUOTA_ENTITLEMENTS = [
  'projects.cloud_max',
  'projects.version_retention_days',
  'build.daily_quota',
  'ai.platform_credits_monthly',
] as const;

export const SETTING_ENTITLEMENTS = [
  'boards.allowed',
  'components.tier',
  'build.priority',
  'learning.guided_projects',
  'learning.courses',
] as const;

export type FeatureEntitlement = (typeof FEATURE_ENTITLEMENTS)[number];
export type QuotaEntitlement = (typeof QUOTA_ENTITLEMENTS)[number];
export type SettingEntitlement = (typeof SETTING_ENTITLEMENTS)[number];
export type EntitlementKey = FeatureEntitlement | QuotaEntitlement | SettingEntitlement;
export const ENTITLEMENT_KEYS: readonly EntitlementKey[] = [
  ...FEATURE_ENTITLEMENTS,
  ...QUOTA_ENTITLEMENTS,
  ...SETTING_ENTITLEMENTS,
];

/**
 * Ordered settings: a later value includes the earlier ones, so grants (and the merge below) take the higher.
 * `components.tier` `all` = basic + pro parts; `learning.courses` `all` = public + organization courses.
 */
export const COMPONENT_TIERS = ['basic', 'all'] as const;
export const BUILD_PRIORITIES = ['low', 'normal', 'high'] as const;
export const GUIDED_PROJECT_ACCESS = ['first', 'all'] as const;
export const COURSE_ACCESS = ['none', 'public', 'all'] as const;
export type ComponentTier = (typeof COMPONENT_TIERS)[number];
export type BuildPriority = (typeof BUILD_PRIORITIES)[number];

/** Queue weight of each `build.priority` in the build service's deficit round robin. */
export const BUILD_PRIORITY_WEIGHT: Record<BuildPriority, number> = { low: 1, normal: 2, high: 4 };

/** A count or day limit; `null` is unlimited. */
export const quotaLimitSchema = z.number().int().min(0).max(1_000_000_000).nullable();
export type QuotaLimit = z.infer<typeof quotaLimitSchema>;

const settingSchemas = {
  'boards.allowed': z.array(z.enum(BUILD_BOARDS)).min(1),
  'components.tier': z.enum(COMPONENT_TIERS),
  'build.priority': z.enum(BUILD_PRIORITIES),
  'learning.guided_projects': z.enum(GUIDED_PROJECT_ACCESS),
  'learning.courses': z.enum(COURSE_ACCESS),
} satisfies Record<SettingEntitlement, z.ZodType>;

const shape = {
  ...(Object.fromEntries(FEATURE_ENTITLEMENTS.map((k) => [k, z.boolean()])) as Record<
    FeatureEntitlement,
    z.ZodBoolean
  >),
  ...(Object.fromEntries(QUOTA_ENTITLEMENTS.map((k) => [k, quotaLimitSchema])) as Record<
    QuotaEntitlement,
    typeof quotaLimitSchema
  >),
  ...settingSchemas,
};

/** A complete entitlement set, as stored on a plan version. */
export const entitlementValuesSchema = z.strictObject(shape);
export type EntitlementValues = z.infer<typeof entitlementValuesSchema>;

/** Some keys of a set, as granted by an override. */
export const entitlementGrantSchema = z.strictObject(shape).partial();
export type EntitlementGrant = z.infer<typeof entitlementGrantSchema>;

/** The value schema of one key, for validating a single override. */
export function entitlementValueSchema(key: EntitlementKey): z.ZodType {
  return shape[key];
}

export function isEntitlementKey(key: string): key is EntitlementKey {
  return (ENTITLEMENT_KEYS as readonly string[]).includes(key);
}

const ORDERED: Partial<Record<EntitlementKey, readonly string[]>> = {
  'components.tier': COMPONENT_TIERS,
  'build.priority': BUILD_PRIORITIES,
  'learning.guided_projects': GUIDED_PROJECT_ACCESS,
  'learning.courses': COURSE_ACCESS,
};

/**
 * `base ⊕ grants` (TD §9.1): quotas add (unlimited wins), booleans OR, ordered settings take the higher value and
 * allowed boards are united. Grants only ever raise what the plan gives. Org policy and age-band restrictions (⊓)
 * arrive with organizations (P3); they would narrow the result here.
 */
export function mergeEntitlements(
  base: EntitlementValues,
  grants: readonly EntitlementGrant[],
): EntitlementValues {
  const out: Record<string, unknown> = { ...base };
  for (const grant of grants) {
    for (const [key, value] of Object.entries(grant) as [EntitlementKey, unknown][]) {
      if (value === undefined) continue;
      const current = out[key];
      if ((FEATURE_ENTITLEMENTS as readonly string[]).includes(key))
        out[key] = current === true || value === true;
      else if ((QUOTA_ENTITLEMENTS as readonly string[]).includes(key))
        out[key] = current === null || value === null ? null : (current as number) + (value as number);
      else if (key === 'boards.allowed')
        out[key] = [...new Set([...(current as string[]), ...(value as string[])])];
      else {
        const order = ORDERED[key] ?? [];
        out[key] = order.indexOf(value as string) > order.indexOf(current as string) ? value : current;
      }
    }
  }
  return out as EntitlementValues;
}

/** Whether `have` includes `need` for an ordered setting (e.g. tier `all` includes `basic`). */
export function settingIncludes(key: SettingEntitlement, have: string, need: string): boolean {
  const order = ORDERED[key] ?? [];
  return order.indexOf(have) >= order.indexOf(need);
}

// ── Plans ────────────────────────────────────────────────────────────────────────────────────────────────────────

export const PLAN_CODES = ['free', 'maker', 'classroom', 'institution', 'private_cloud'] as const;
export const planCodeSchema = z.enum(PLAN_CODES);
export type PlanCode = z.infer<typeof planCodeSchema>;

export const PLAN_INTERVALS = ['month', 'year', 'term'] as const;
export const planIntervalSchema = z.enum(PLAN_INTERVALS);
export type PlanInterval = z.infer<typeof planIntervalSchema>;

const NO_FEATURES = Object.fromEntries(FEATURE_ENTITLEMENTS.map((k) => [k, false])) as Record<
  FeatureEntitlement,
  boolean
>;

/**
 * Plan defaults from PRD §3, seeded as each plan's first version; staff change them by publishing new versions.
 * Classroom values are per seat. `ai.platform_credits_monthly` is plan-configured (0 until AI ships).
 */
export const DEFAULT_PLAN_ENTITLEMENTS: Record<Exclude<PlanCode, 'private_cloud'>, EntitlementValues> = {
  free: {
    ...NO_FEATURES,
    'export.csv': true,
    'hwb.upload': true,
    'boards.allowed': ['avr-uno'],
    'components.tier': 'basic',
    'projects.cloud_max': 3,
    'projects.version_retention_days': 7,
    'build.daily_quota': 30,
    'build.priority': 'low',
    'learning.guided_projects': 'first',
    'learning.courses': 'none',
    'ai.platform_credits_monthly': 0,
  },
  maker: {
    ...NO_FEATURES,
    'export.csv': true,
    'export.pdf': true,
    'collab.realtime': true,
    'community.publish': true,
    'ai.byok': true,
    'hwb.upload': true,
    'arena.custom': true,
    'boards.allowed': [...BUILD_BOARDS],
    'components.tier': 'all',
    'projects.cloud_max': null,
    'projects.version_retention_days': 365,
    'build.daily_quota': 500,
    'build.priority': 'normal',
    'learning.guided_projects': 'all',
    'learning.courses': 'public',
    'ai.platform_credits_monthly': 0,
  },
  classroom: {
    ...NO_FEATURES,
    'export.csv': true,
    'export.pdf': true,
    'collab.realtime': true,
    'community.publish': true,
    'ai.byok': true,
    'hwb.upload': true,
    'arena.custom': true,
    'org.classes': true,
    'org.verified_grading': true,
    'org.analytics': true,
    'boards.allowed': [...BUILD_BOARDS],
    'components.tier': 'all',
    'projects.cloud_max': null,
    'projects.version_retention_days': 365,
    'build.daily_quota': 300,
    'build.priority': 'normal',
    'learning.guided_projects': 'all',
    'learning.courses': 'all',
    'ai.platform_credits_monthly': 0,
  },
  institution: {
    ...(Object.fromEntries(FEATURE_ENTITLEMENTS.map((k) => [k, true])) as Record<
      FeatureEntitlement,
      boolean
    >),
    'boards.allowed': [...BUILD_BOARDS],
    'components.tier': 'all',
    'projects.cloud_max': null,
    'projects.version_retention_days': null,
    'build.daily_quota': 300,
    'build.priority': 'high',
    'learning.guided_projects': 'all',
    'learning.courses': 'all',
    'ai.platform_credits_monthly': 0,
  },
};

/** Guests have Free entitlements but nothing server-side, and a smaller build quota per address (PRD §3). */
export const GUEST_BUILD_DAILY_QUOTA = 10;

/** A plan as `GET /plans` lists it (public, self-serve plans only). */
export const publicPlanSchema = z.object({
  code: planCodeSchema,
  version: z.number().int(),
  interval: planIntervalSchema,
  /** Price per interval in IRR; null until finance sets it. */
  priceIrr: z.number().int().nullable(),
  entitlements: entitlementValuesSchema,
});
export type PublicPlan = z.infer<typeof publicPlanSchema>;
export const planListSchema = z.object({ items: z.array(publicPlanSchema) });
export type PlanList = z.infer<typeof planListSchema>;

export const SUBSCRIPTION_STATUSES = ['trialing', 'active', 'expired', 'canceled'] as const;
export const subscriptionStatusSchema = z.enum(SUBSCRIPTION_STATUSES);
export type SubscriptionStatus = z.infer<typeof subscriptionStatusSchema>;

export const quotaUsageSchema = z.object({
  limit: quotaLimitSchema,
  /** Absent for limits that are not consumed (retention days). */
  used: z.number().int().optional(),
  resetsAt: z.string().optional(),
});
export type QuotaUsage = z.infer<typeof quotaUsageSchema>;

/** `GET /me/entitlements` (API Spec §4.1): the caller's effective entitlements in the current workspace. */
export const meEntitlementsSchema = z.object({
  plan: z.object({
    code: planCodeSchema,
    version: z.number().int(),
    status: subscriptionStatusSchema,
    trialEndsAt: z.string().nullable(),
    /** End of the paid or granted period; null when open-ended (Free, contracts without an end). */
    periodEnd: z.string().nullable(),
  }),
  features: z.record(z.string(), z.boolean()),
  quotas: z.record(z.string(), quotaUsageSchema),
  settings: z.object(settingSchemas),
  restrictions: z.object({ ageBand: ageBandSchema, policy: z.null() }),
});
export type MeEntitlements = z.infer<typeof meEntitlementsSchema>;

// ── Quota days ───────────────────────────────────────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
/** Iran has kept UTC+03:30 all year since 2022, so a fixed offset gives the local day without a time-zone database. */
const TEHRAN_OFFSET_MS = 210 * 60_000;

/** Daily quotas reset at 00:00 Asia/Tehran (TD §9.1). Returns the day's key and when the next day starts. */
export function quotaDay(now: Date | number = Date.now()): { day: number; resetsAt: Date } {
  const t = typeof now === 'number' ? now : now.getTime();
  const day = Math.floor((t + TEHRAN_OFFSET_MS) / DAY_MS);
  return { day, resetsAt: new Date((day + 1) * DAY_MS - TEHRAN_OFFSET_MS) };
}
