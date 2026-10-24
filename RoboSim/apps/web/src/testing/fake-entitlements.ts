import {
  DEFAULT_PLAN_ENTITLEMENTS,
  FEATURE_ENTITLEMENTS,
  type MeEntitlements,
  type PlanCode,
  type PublicPlan,
} from '@robosim/shared';
import { ApiError } from '../lib/api.js';
import type { EntitlementsClient } from '../lib/entitlements-api.js';

/** A plan-limit refusal as the API sends it (API Spec §3.1). */
export function planError(
  code: 'quota_exceeded' | 'entitlement_required' | 'build_quota_exceeded',
  params: Record<string, unknown>,
): ApiError {
  const status = code === 'build_quota_exceeded' ? 429 : 403;
  return new ApiError({ type: code, title: code, status, code, requestId: 'test', params });
}

/** In-memory `GET /me/entitlements` and `GET /plans` with PRD §3's Free and Maker. */
export class FakeEntitlements implements EntitlementsClient {
  plan: Exclude<PlanCode, 'classroom' | 'institution' | 'private_cloud'> = 'free';
  projectsUsed = 0;
  buildsUsed = 0;

  me(): Promise<MeEntitlements> {
    const values = DEFAULT_PLAN_ENTITLEMENTS[this.plan];
    return Promise.resolve({
      plan: { code: this.plan, version: 1, status: 'active', trialEndsAt: null, periodEnd: null },
      features: Object.fromEntries(FEATURE_ENTITLEMENTS.map((k) => [k, values[k]])),
      quotas: {
        'projects.cloud_max': { limit: values['projects.cloud_max'], used: this.projectsUsed },
        'projects.version_retention_days': { limit: values['projects.version_retention_days'] },
        'build.daily_quota': {
          limit: values['build.daily_quota'],
          used: this.buildsUsed,
          resetsAt: '2026-10-24T20:30:00.000Z',
        },
        'ai.platform_credits_monthly': { limit: 0 },
      },
      settings: {
        'boards.allowed': values['boards.allowed'],
        'components.tier': values['components.tier'],
        'build.priority': values['build.priority'],
        'learning.guided_projects': values['learning.guided_projects'],
        'learning.courses': values['learning.courses'],
      },
      restrictions: { ageBand: 'adult', policy: null },
    });
  }

  plans(): Promise<PublicPlan[]> {
    return Promise.resolve(
      (['free', 'maker'] as const).map((code) => ({
        code,
        version: 1,
        interval: 'month' as const,
        priceIrr: code === 'maker' ? 2_500_000 : null,
        entitlements: DEFAULT_PLAN_ENTITLEMENTS[code],
      })),
    );
  }
}
