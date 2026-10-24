import type { AdminPlan, AdminPlanVersion } from '@robosim/shared';

export const PLANS_KEY = ['admin', 'plans'] as const;

/** The version new subscribers get: the one not yet retired (the API lists newest first). */
export function currentVersion(plan: AdminPlan): AdminPlanVersion | undefined {
  return plan.versions.find((v) => v.effectiveTo === null) ?? plan.versions[0];
}
