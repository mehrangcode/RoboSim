import {
  aiModelListSchema,
  aiProviderConfigListSchema,
  aiProviderConfigSchema,
  aiUsageReportSchema,
  adminPriceListSchema,
  adminPlanListSchema,
  catalogPriceSchema,
  adminPlanSchema,
  adminWorkspaceListSchema,
  adminWorkspaceSchema,
  staffMeSchema,
  type AdminPlan,
  type AdminPriceList,
  type CatalogPrice,
  type AdminWorkspace,
  type AdminWorkspaceSummary,
  type CreateOverrideInput,
  type CreatePlanVersionInput,
  type LoginRequest,
  type PlanCode,
  type SetSubscriptionInput,
  type StaffMe,
  type UpsertCatalogPriceInput,
  type AiModel,
  type AiProviderConfig,
  type AiProviderId,
  type AiUsageReport,
  type UpdateAiProviderConfig,
} from '@robosim/shared';
import { apiGet, apiSend } from './api.js';

/** The back-office API (API Spec §4.12) as the admin app uses it; injectable so pages can be tested without HTTP. */
export interface AdminClient {
  /** The signed-in staff member; rejects with an `ApiError` (401 signed out, 403 not staff). */
  me(): Promise<StaffMe>;
  login(input: LoginRequest): Promise<void>;
  logout(): Promise<void>;
  plans(): Promise<AdminPlan[]>;
  publishPlanVersion(code: PlanCode, input: CreatePlanVersionInput): Promise<AdminPlan>;
  searchWorkspaces(q: string): Promise<AdminWorkspaceSummary[]>;
  workspace(id: string): Promise<AdminWorkspace>;
  setSubscription(id: string, input: SetSubscriptionInput): Promise<AdminWorkspace>;
  grantOverride(id: string, input: CreateOverrideInput): Promise<AdminWorkspace>;
  removeOverride(id: string, overrideId: string): Promise<AdminWorkspace>;
  prices(): Promise<AdminPriceList>;
  setPrice(partKey: string, input: UpsertCatalogPriceInput): Promise<CatalogPrice>;
  removePrice(partKey: string): Promise<void>;
  /** AI providers, models and usage (FR-ADM-08). */
  aiProviders(): Promise<AiProviderConfig[]>;
  updateAiProvider(provider: AiProviderId, input: UpdateAiProviderConfig): Promise<AiProviderConfig>;
  checkAiProvider(provider: AiProviderId): Promise<AiProviderConfig>;
  aiPlatformModels(): Promise<AiModel[]>;
  aiUsage(days: number): Promise<AiUsageReport>;
}

/** `locale` is a getter, so one client follows language switches (problem titles come back localized). */
export function adminApi(locale: () => string): AdminClient {
  const get = (path: string) => apiGet(path, locale());
  const id = encodeURIComponent;
  return {
    me: async () => staffMeSchema.parse(await get('/admin/me')),
    login: async (input) => void (await apiSend('POST', '/auth/login', input, locale())),
    logout: async () => void (await apiSend('POST', '/auth/logout', undefined, locale())),
    plans: async () => adminPlanListSchema.parse(await get('/admin/plans')).items,
    publishPlanVersion: async (code, input) =>
      adminPlanSchema.parse(await apiSend('POST', `/admin/plans/${id(code)}/versions`, input, locale())),
    searchWorkspaces: async (q) =>
      adminWorkspaceListSchema.parse(await get(`/admin/workspaces${q ? `?q=${id(q)}` : ''}`)).items,
    workspace: async (ws) => adminWorkspaceSchema.parse(await get(`/admin/workspaces/${id(ws)}`)),
    setSubscription: async (ws, input) =>
      adminWorkspaceSchema.parse(
        await apiSend('PUT', `/admin/workspaces/${id(ws)}/subscription`, input, locale()),
      ),
    grantOverride: async (ws, input) =>
      adminWorkspaceSchema.parse(
        await apiSend('POST', `/admin/workspaces/${id(ws)}/overrides`, input, locale()),
      ),
    removeOverride: async (ws, overrideId) =>
      adminWorkspaceSchema.parse(
        await apiSend(
          'DELETE',
          `/admin/workspaces/${id(ws)}/overrides/${id(overrideId)}`,
          undefined,
          locale(),
        ),
      ),
    prices: async () => adminPriceListSchema.parse(await get('/admin/catalog/prices')),
    setPrice: async (key, input) =>
      catalogPriceSchema.parse(await apiSend('PUT', `/admin/catalog/prices/${id(key)}`, input, locale())),
    removePrice: async (key) =>
      void (await apiSend('DELETE', `/admin/catalog/prices/${id(key)}`, undefined, locale())),
    aiProviders: async () => aiProviderConfigListSchema.parse(await get('/admin/ai/providers')).items,
    updateAiProvider: async (provider, input) =>
      aiProviderConfigSchema.parse(
        await apiSend('PUT', `/admin/ai/providers/${id(provider)}`, input, locale()),
      ),
    checkAiProvider: async (provider) =>
      aiProviderConfigSchema.parse(
        await apiSend('POST', `/admin/ai/providers/${id(provider)}/check`, undefined, locale()),
      ),
    aiPlatformModels: async () => aiModelListSchema.parse(await get('/admin/ai/platform-models')).items,
    aiUsage: async (days) => aiUsageReportSchema.parse(await get(`/admin/ai/usage?days=${days}`)),
  };
}
