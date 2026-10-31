import { z } from 'zod';
import {
  entitlementValuesSchema,
  ENTITLEMENT_KEYS,
  entitlementValueSchema,
  isEntitlementKey,
  planCodeSchema,
  planIntervalSchema,
  subscriptionStatusSchema,
  type EntitlementKey,
} from './entitlements.js';
import { staffRoleSchema, workspaceKindSchema, type StaffRole } from './workspace.js';

/** Back-office contract for plans, subscriptions and overrides (API Spec §4.13; FR-ADM-02, FR-ADM-06, FR-BIL-01). */

/** Who may do what in the back office (Security §4.4): reading is open to these roles; writing needs the listed ones. */
export const ADMIN_PERMISSIONS = {
  read: ['platform_admin', 'finance', 'support_agent'],
  plans: ['platform_admin', 'finance'],
  subscriptions: ['platform_admin', 'finance'],
  overrides: ['platform_admin', 'finance', 'support_agent'],
  /** The parts price list behind the BOM (FR-BOM-02) until the shop catalogue replaces it. */
  prices: ['platform_admin', 'finance', 'shop_operator'],
  /** AI providers, models and usage (FR-ADM-08). */
  ai: ['platform_admin'],
  /** AI usage and cost report, read-only. */
  aiUsage: ['platform_admin', 'finance'],
} as const satisfies Record<string, readonly StaffRole[]>;
export type AdminPermission = keyof typeof ADMIN_PERMISSIONS;

export function staffCan(roles: readonly StaffRole[], permission: AdminPermission): boolean {
  return roles.some((r) => (ADMIN_PERMISSIONS[permission] as readonly StaffRole[]).includes(r));
}

export const staffMeSchema = z.object({
  userId: z.string(),
  email: z.string().nullable(),
  displayName: z.string(),
  roles: z.array(staffRoleSchema),
});
export type StaffMe = z.infer<typeof staffMeSchema>;

export const adminPlanVersionSchema = z.object({
  id: z.string(),
  version: z.number().int(),
  interval: planIntervalSchema,
  priceIrr: z.number().int().nullable(),
  entitlements: entitlementValuesSchema,
  effectiveFrom: z.string(),
  /** Set when a newer version replaced it; existing subscribers keep it until renewal (FR-BIL-01). */
  effectiveTo: z.string().nullable(),
  subscribers: z.number().int(),
});
export type AdminPlanVersion = z.infer<typeof adminPlanVersionSchema>;

export const adminPlanSchema = z.object({
  code: planCodeSchema,
  /** Listed on the public plans page. */
  public: z.boolean(),
  versions: z.array(adminPlanVersionSchema),
});
export type AdminPlan = z.infer<typeof adminPlanSchema>;
export const adminPlanListSchema = z.object({ items: z.array(adminPlanSchema) });
export type AdminPlanList = z.infer<typeof adminPlanListSchema>;

export const createPlanVersionSchema = z.strictObject({
  interval: planIntervalSchema,
  priceIrr: z.number().int().min(0).nullable(),
  entitlements: entitlementValuesSchema,
});
export type CreatePlanVersionInput = z.input<typeof createPlanVersionSchema>;

export const adminSubscriptionSchema = z.object({
  plan: planCodeSchema,
  version: z.number().int(),
  status: subscriptionStatusSchema,
  periodEnd: z.string().nullable(),
  source: z.string().nullable(),
});
export type AdminSubscription = z.infer<typeof adminSubscriptionSchema>;

export const adminWorkspaceSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: workspaceKindSchema,
  ownerId: z.string(),
  ownerEmail: z.string().nullable(),
  ownerName: z.string(),
  subscription: adminSubscriptionSchema,
});
export type AdminWorkspaceSummary = z.infer<typeof adminWorkspaceSummarySchema>;
export const adminWorkspaceListSchema = z.object({ items: z.array(adminWorkspaceSummarySchema) });
export type AdminWorkspaceList = z.infer<typeof adminWorkspaceListSchema>;

export const adminOverrideSchema = z.object({
  id: z.string(),
  /** Null: every member of the workspace. */
  userId: z.string().nullable(),
  key: z.string(),
  value: z.unknown(),
  reason: z.string(),
  grantedBy: z.string().nullable(),
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
});
export type AdminOverride = z.infer<typeof adminOverrideSchema>;

export const adminWorkspaceSchema = adminWorkspaceSummarySchema.extend({
  /** The owner's effective entitlements (plan ⊕ overrides). */
  effective: entitlementValuesSchema,
  overrides: z.array(adminOverrideSchema),
  liveProjects: z.number().int(),
});
export type AdminWorkspace = z.infer<typeof adminWorkspaceSchema>;

const reason = z.string().trim().min(3).max(500);
const futureDate = z.iso.datetime({ offset: true }).nullable().default(null);

export const setSubscriptionSchema = z.strictObject({
  /** `free` ends the subscription: the workspace falls back to Free. */
  plan: planCodeSchema,
  /** End of the granted period; null keeps it open-ended. */
  periodEnd: futureDate,
  reason,
});
export type SetSubscriptionInput = z.input<typeof setSubscriptionSchema>;

export const createOverrideSchema = z
  .strictObject({
    key: z.enum(ENTITLEMENT_KEYS as [EntitlementKey, ...EntitlementKey[]]),
    value: z.unknown(),
    reason,
    expiresAt: futureDate,
    userId: z.uuid().nullable().default(null),
  })
  .superRefine((input, ctx) => {
    if (!isEntitlementKey(input.key)) return;
    const parsed = entitlementValueSchema(input.key).safeParse(input.value);
    if (!parsed.success)
      ctx.addIssue({ code: 'custom', path: ['value'], message: `invalid value for ${input.key}` });
  });
export type CreateOverrideInput = z.input<typeof createOverrideSchema>;
