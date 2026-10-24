import type { MeEntitlements, PlanList, PublicPlan } from '@robosim/shared';
import { apiGet } from './api.js';

/** Plans and the caller's entitlements (API Spec §4.1, §4.9); injectable so pages can be tested without HTTP. */
export interface EntitlementsClient {
  me(): Promise<MeEntitlements>;
  plans(): Promise<PublicPlan[]>;
}

/** `locale` may be a getter, so one client follows language switches. */
export function entitlementsApi(locale: string | (() => string)): EntitlementsClient {
  const lang = typeof locale === 'function' ? locale : () => locale;
  return {
    me: () => apiGet('/me/entitlements', lang()),
    plans: async () => (await apiGet<PlanList>('/plans', lang())).items,
  };
}
