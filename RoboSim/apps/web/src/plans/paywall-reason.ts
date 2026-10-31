import { ApiError } from '../lib/api.js';

/** Why the server refused (API Spec §3.1 entitlement errors), in the terms the paywall explains (FR-BIL-05). */
export type PaywallReason =
  | { readonly kind: 'cloudMax'; readonly limit: number }
  | { readonly kind: 'locked'; readonly limit: number }
  | { readonly kind: 'parts'; readonly parts: readonly string[] }
  | { readonly kind: 'builds'; readonly limit: number; readonly resetAt: string | null }
  | { readonly kind: 'aiCredits'; readonly resetAt: string | null }
  | { readonly kind: 'feature' };

/** The paywall for an API error, or null when the error is not about the plan. */
export function paywallReason(e: unknown): PaywallReason | null {
  if (!(e instanceof ApiError)) return null;
  const params = e.problem.params ?? {};
  const limit = typeof params['limit'] === 'number' ? params['limit'] : 0;
  switch (e.problem.code) {
    case 'quota_exceeded':
      if (params['quota'] !== 'projects.cloud_max') return null;
      return params['locked'] === true ? { kind: 'locked', limit } : { kind: 'cloudMax', limit };
    case 'build_quota_exceeded':
      return {
        kind: 'builds',
        limit,
        resetAt: typeof params['resetAt'] === 'string' ? params['resetAt'] : null,
      };
    case 'ai_credits_exhausted':
      return { kind: 'aiCredits', resetAt: typeof params['resetAt'] === 'string' ? params['resetAt'] : null };
    case 'entitlement_required':
      return params['entitlement'] === 'components.tier' && Array.isArray(params['parts'])
        ? { kind: 'parts', parts: params['parts'].filter((p): p is string => typeof p === 'string') }
        : { kind: 'feature' };
    default:
      return null;
  }
}
