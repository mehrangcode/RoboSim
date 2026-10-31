import {
  AnthropicProvider,
  FakeProvider,
  GeminiProvider,
  OpenAICompatibleProvider,
  ProviderError,
  type LLMProvider,
} from '@robosim/ai-providers';
import {
  AI_PROVIDERS,
  DomainError,
  type AiKey,
  type AiKeyScope,
  type AiModel,
  type AiProvider,
  type AiProviderConfig,
  type AiProviderId,
  type PutAiKeyRequest,
  type UpdateAiProviderConfig,
} from '@robosim/shared';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, or } from 'drizzle-orm';
import { isIP } from 'node:net';
import { ENV, type Env } from '../../config/env.js';
import { DATABASE, type Database } from '../../db/client.js';
import { aiKeys, aiProviderConfigs, memberships, workspaces } from '../../db/schema.js';
import { withSystem } from '../../db/scope.js';
import { AuditService } from '../audit/index.js';
import { EntitlementsService } from '../entitlements/index.js';
import type { Caller, Staff } from '../iam/index.js';
import { decryptSecret, encryptSecret, KEY_WRAPPER, last4, type KeyWrapper } from './key-vault.js';

/** Builds an adapter for a provider. */
export type ProviderFactory = (spec: {
  provider: AiProviderId;
  baseUrl: string | null;
  apiKey: string | null;
}) => LLMProvider;
/** Holder of the factory; HTTP tests replace `create` after `createApp` to stay off the network. */
export interface ProviderFactoryHolder {
  create: ProviderFactory;
}
export const PROVIDER_FACTORY = Symbol('PROVIDER_FACTORY');

const DEFAULT_BASE: Partial<Record<AiProviderId, string>> = {
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
};

export function defaultProviderFactory(env: Env): ProviderFactory {
  return ({ provider, baseUrl, apiKey }) => {
    const key = apiKey ?? undefined;
    switch (provider) {
      case 'platform': {
        if (env.AI_DEFAULT_PROVIDER === 'fake') return new FakeProvider();
        const base =
          baseUrl ??
          (env.AI_DEFAULT_PROVIDER === 'vllm' ? (env.VLLM_BASE_URL ?? '') : `${env.OLLAMA_BASE_URL}/v1`);
        // A CPU model can take a while before the first token.
        return new OpenAICompatibleProvider({ baseUrl: base, timeoutMs: 180_000 });
      }
      case 'anthropic':
        return new AnthropicProvider({ apiKey: key, ...(baseUrl ? { baseUrl } : {}) });
      case 'gemini':
        return new GeminiProvider({ apiKey: key, ...(baseUrl ? { baseUrl } : {}) });
      default:
        return new OpenAICompatibleProvider({
          apiKey: key,
          baseUrl: baseUrl ?? DEFAULT_BASE[provider] ?? '',
        });
    }
  };
}

type ConfigRow = typeof aiProviderConfigs.$inferSelect;
type KeyRow = typeof aiKeys.$inferSelect;

export interface ResolvedProvider {
  id: AiProviderId;
  platform: boolean;
  llm: LLMProvider;
  model: string;
}

/** Callers that may only use the platform model: minors (Security §6.4). */
export interface CallerPolicy {
  minor: boolean;
  byok: boolean;
}

/** Hosts a user-supplied base URL may not point at (no requests into the deployment's own network). */
function privateHost(url: string): boolean {
  const host = new URL(url).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return true;
  }
  if (isIP(host) === 4) {
    const [a = 0, b = 0] = host.split('.').map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (isIP(host) === 6)
    return host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80');
  return false;
}

@Injectable()
export class AiProvidersService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(ENV) private readonly env: Env,
    @Inject(KEY_WRAPPER) private readonly wrapper: KeyWrapper,
    @Inject(PROVIDER_FACTORY) private readonly providerFactory: ProviderFactoryHolder,
    private readonly entitlements: EntitlementsService,
    private readonly audit: AuditService,
  ) {}

  private factory(spec: Parameters<ProviderFactory>[0]): LLMProvider {
    return this.providerFactory.create(spec);
  }

  private async configs(): Promise<Map<AiProviderId, ConfigRow>> {
    const rows = await withSystem(this.database.db, (tx) => tx.select().from(aiProviderConfigs));
    return new Map(rows.map((r) => [r.provider, r]));
  }

  /** The platform model is served only when the deployment has one and staff have not switched it off. */
  private platformAvailable(cfg: ConfigRow | undefined): boolean {
    return this.env.AI_DEFAULT_PROVIDER !== 'none' && (cfg?.enabled ?? false);
  }

  private platformModel(cfg: ConfigRow | undefined): string {
    return (
      cfg?.defaultModel ?? (this.env.AI_DEFAULT_PROVIDER === 'fake' ? 'fake-1' : this.env.AI_PLATFORM_MODEL)
    );
  }

  private async keyRows(caller: Caller): Promise<KeyRow[]> {
    return withSystem(this.database.db, (tx) =>
      tx
        .select()
        .from(aiKeys)
        .where(
          or(
            and(eq(aiKeys.ownerKind, 'user'), eq(aiKeys.ownerId, caller.userId)),
            and(eq(aiKeys.ownerKind, 'workspace'), eq(aiKeys.ownerId, caller.workspaceId)),
          ),
        ),
    );
  }

  private toKey(row: KeyRow): AiKey {
    return {
      provider: row.provider,
      scope: row.ownerKind,
      last4: row.keyLast4,
      status: row.status,
      baseUrl: row.baseUrl,
      error: row.lastError,
      validatedAt: row.validatedAt?.toISOString() ?? null,
    };
  }

  async policy(caller: Caller, minor: boolean): Promise<CallerPolicy> {
    const { values } = await this.entitlements.resolve(caller.workspaceId, caller.userId);
    return { minor, byok: values['ai.byok'] };
  }

  /** `GET /ai/providers`: platform first, then the BYOK providers this deployment enabled. */
  async list(caller: Caller, policy: CallerPolicy): Promise<AiProvider[]> {
    const [configs, keys] = await Promise.all([this.configs(), this.keyRows(caller)]);
    const out: AiProvider[] = [];
    const platform = configs.get('platform');
    if (this.platformAvailable(platform)) {
      out.push({
        id: 'platform',
        platform: true,
        usable: true,
        blockedBy: null,
        defaultModel: this.platformModel(platform),
        keys: [],
      });
    }
    for (const id of AI_PROVIDERS) {
      const cfg = configs.get(id);
      if (id === 'platform' || !cfg?.enabled) continue;
      const own = keys
        .filter((k) => k.provider === id)
        .sort((a, b) => (a.ownerKind === 'user' ? -1 : 1) - (b.ownerKind === 'user' ? -1 : 1))
        .map((k) => this.toKey(k));
      const blockedBy = policy.minor
        ? 'minor_platform_only'
        : !policy.byok
          ? 'byok_not_in_plan'
          : own.some((k) => k.status === 'active')
            ? null
            : own.length
              ? 'key_invalid'
              : 'key_missing';
      out.push({
        id,
        platform: false,
        usable: blockedBy === null,
        blockedBy,
        defaultModel: cfg.defaultModel,
        keys: own,
      });
    }
    return out;
  }

  private async requireKeyOwner(caller: Caller, scope: AiKeyScope): Promise<string> {
    if (scope === 'user') return caller.userId;
    const allowed = await withSystem(this.database.db, async (tx) => {
      const [ws] = await tx
        .select({ owner: workspaces.ownerUserId })
        .from(workspaces)
        .where(eq(workspaces.id, caller.workspaceId));
      if (ws?.owner === caller.userId) return true;
      const [m] = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(
            eq(memberships.workspaceId, caller.workspaceId),
            eq(memberships.userId, caller.userId),
            eq(memberships.status, 'active'),
            inArray(memberships.role, ['org_owner', 'org_admin']),
          ),
        );
      return m !== undefined;
    });
    if (!allowed) throw new DomainError('forbidden', { need: 'workspace_admin' });
    return caller.workspaceId;
  }

  private checkBaseUrl(provider: AiProviderId, url: string | undefined, cfg: ConfigRow): string | null {
    if (!url) {
      if (provider === 'compatible' && !cfg.baseUrl) {
        throw new DomainError('validation_failed', {
          errors: [{ path: 'baseUrl', message: 'required for this provider' }],
        });
      }
      return null;
    }
    // A deployment that pins the endpoint (egress allow-list) only accepts URLs under it.
    if (cfg.baseUrl && !url.startsWith(cfg.baseUrl)) {
      throw new DomainError('validation_failed', {
        errors: [{ path: 'baseUrl', message: `must start with ${cfg.baseUrl}` }],
      });
    }
    const local = this.env.APP_ENV === 'local' || this.env.APP_ENV === 'test';
    if (!local && (!url.startsWith('https://') || privateHost(url))) {
      throw new DomainError('validation_failed', {
        errors: [{ path: 'baseUrl', message: 'must be a public https address' }],
      });
    }
    return url;
  }

  /** `PUT /ai/keys/:provider`: test call first; a refused key is stored as `invalid` with the provider's message. */
  async putKey(
    caller: Caller,
    policy: CallerPolicy,
    provider: AiProviderId,
    body: PutAiKeyRequest & { scope: AiKeyScope },
  ): Promise<AiKey> {
    if (provider === 'platform')
      throw new DomainError('validation_failed', {
        errors: [{ path: 'provider', message: 'the platform model needs no key' }],
      });
    const cfg = (await this.configs()).get(provider);
    if (!cfg?.enabled) throw new DomainError('policy_restricted', { reason: 'provider_disabled', provider });
    if (policy.minor) throw new DomainError('policy_restricted', { reason: 'minor_platform_only' });
    if (!policy.byok)
      throw new DomainError('entitlement_required', { entitlement: 'ai.byok', suggestedPlan: 'maker' });
    const ownerId = await this.requireKeyOwner(caller, body.scope);
    const baseUrl = this.checkBaseUrl(provider, body.baseUrl, cfg);

    let status: 'active' | 'invalid' = 'active';
    let error: string | null = null;
    try {
      await this.factory({ provider, baseUrl: baseUrl ?? cfg.baseUrl, apiKey: body.key }).validate(
        AbortSignal.timeout(20_000),
      );
    } catch (e) {
      if (!(e instanceof ProviderError)) throw e;
      if (!e.unauthorized && e.status !== 400 && e.status !== 404) {
        throw new DomainError('provider_error', { provider, message: e.message });
      }
      status = 'invalid';
      error = e.message.replaceAll(body.key, '****');
    }
    const sealed = await encryptSecret(this.wrapper, body.key);
    const now = new Date();
    const row = await withSystem(this.database.db, async (tx) => {
      const values = {
        ownerKind: body.scope,
        ownerId,
        provider,
        ...sealed,
        keyLast4: last4(body.key),
        baseUrl,
        status,
        lastError: error,
        validatedAt: status === 'active' ? now : null,
        createdBy: caller.userId,
      };
      const [saved] = await tx
        .insert(aiKeys)
        .values(values)
        .onConflictDoUpdate({
          target: [aiKeys.ownerKind, aiKeys.ownerId, aiKeys.provider],
          set: { ...values, updatedAt: now },
        })
        .returning();
      await this.audit.record(tx, {
        actorId: caller.userId,
        actorKind: 'user',
        workspaceId: caller.workspaceId,
        action: 'ai_key.set',
        targetKind: 'ai_key',
        targetId: saved?.id ?? null,
        after: { provider, scope: body.scope, last4: values.keyLast4, status },
      });
      return saved;
    });
    if (!row) throw new Error('key not saved');
    return this.toKey(row);
  }

  async deleteKey(caller: Caller, provider: AiProviderId, scope: AiKeyScope): Promise<void> {
    const ownerId = await this.requireKeyOwner(caller, scope);
    await withSystem(this.database.db, async (tx) => {
      const gone = await tx
        .delete(aiKeys)
        .where(and(eq(aiKeys.ownerKind, scope), eq(aiKeys.ownerId, ownerId), eq(aiKeys.provider, provider)))
        .returning({ id: aiKeys.id });
      if (!gone.length) throw new DomainError('not_found');
      await this.audit.record(tx, {
        actorId: caller.userId,
        actorKind: 'user',
        workspaceId: caller.workspaceId,
        action: 'ai_key.deleted',
        targetKind: 'ai_key',
        targetId: gone[0]?.id ?? null,
        before: { provider, scope },
      });
    });
  }

  /** The adapter, model and key for one chat request; refuses what policy, plan or keys do not allow. */
  async resolve(
    caller: Caller,
    policy: CallerPolicy,
    requested: AiProviderId | undefined,
    model: string | undefined,
  ): Promise<ResolvedProvider> {
    const configs = await this.configs();
    const id = requested ?? 'platform';
    if (id === 'platform') {
      const cfg = configs.get('platform');
      if (!this.platformAvailable(cfg))
        throw new DomainError('policy_restricted', { reason: 'provider_disabled', provider: id });
      const allowed = cfg?.models ?? [];
      const chosen =
        model && (allowed.length === 0 || allowed.includes(model)) ? model : this.platformModel(cfg);
      return {
        id,
        platform: true,
        llm: this.factory({ provider: id, baseUrl: cfg?.baseUrl ?? null, apiKey: null }),
        model: chosen,
      };
    }
    if (policy.minor) throw new DomainError('policy_restricted', { reason: 'minor_platform_only' });
    const cfg = configs.get(id);
    if (!cfg?.enabled)
      throw new DomainError('policy_restricted', { reason: 'provider_disabled', provider: id });
    if (!policy.byok)
      throw new DomainError('entitlement_required', { entitlement: 'ai.byok', suggestedPlan: 'maker' });
    const key = (await this.keyRows(caller))
      .filter((k) => k.provider === id && k.status === 'active')
      .sort((a) => (a.ownerKind === 'user' ? -1 : 1))[0];
    if (!key) throw new DomainError('policy_restricted', { reason: 'key_missing', provider: id });
    const apiKey = await decryptSecret(this.wrapper, key);
    const chosen = model ?? cfg.defaultModel;
    if (!chosen)
      throw new DomainError('validation_failed', { errors: [{ path: 'model', message: 'choose a model' }] });
    if (cfg.models.length && !cfg.models.includes(chosen)) {
      throw new DomainError('validation_failed', {
        errors: [{ path: 'model', message: 'model not enabled' }],
      });
    }
    return {
      id,
      platform: false,
      llm: this.factory({ provider: id, baseUrl: key.baseUrl ?? cfg.baseUrl, apiKey }),
      model: chosen,
    };
  }

  /** `GET /ai/models`: the provider's list, narrowed to what staff enabled. */
  async models(caller: Caller, policy: CallerPolicy, provider: AiProviderId): Promise<AiModel[]> {
    const cfg = (await this.configs()).get(provider);
    if (provider === 'platform' && cfg?.models.length) return cfg.models.map((id) => ({ id, label: id }));
    const resolved = await this.resolve(
      caller,
      policy,
      provider,
      provider === 'platform' ? undefined : (cfg?.defaultModel ?? 'any'),
    );
    try {
      const all = await resolved.llm.models(AbortSignal.timeout(15_000));
      return cfg?.models.length ? all.filter((m) => cfg.models.includes(m.id)) : all;
    } catch (e) {
      if (e instanceof ProviderError)
        throw new DomainError('provider_error', { provider, message: e.message });
      throw e;
    }
  }

  // ---- Back office (FR-ADM-08) ----

  private toConfig(row: ConfigRow): AiProviderConfig {
    return {
      provider: row.provider,
      enabled: row.enabled,
      baseUrl: row.baseUrl,
      models: row.models,
      defaultModel: row.defaultModel,
      legalRef: row.legalRef,
      legalApprovedAt: row.legalApprovedAt?.toISOString() ?? null,
      priceInIrr: row.priceInIrr,
      priceOutIrr: row.priceOutIrr,
      check: row.checkedAt
        ? { at: row.checkedAt.toISOString(), ok: row.checkOk ?? false, error: row.checkError }
        : null,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async adminList(): Promise<AiProviderConfig[]> {
    const configs = await this.configs();
    return AI_PROVIDERS.flatMap((p) => {
      const row = configs.get(p);
      return row ? [this.toConfig(row)] : [];
    });
  }

  /**
   * Reachability check (BR-15): the platform must list its models; an external endpoint must answer at all
   * (a 401 without a key counts as reachable).
   */
  async check(staff: Staff, provider: AiProviderId): Promise<AiProviderConfig> {
    const cfg = (await this.configs()).get(provider);
    if (!cfg) throw new DomainError('not_found');
    let ok = true;
    let error: string | null = null;
    try {
      await this.factory({ provider, baseUrl: cfg.baseUrl, apiKey: null }).models(
        AbortSignal.timeout(15_000),
      );
    } catch (e) {
      if (!(e instanceof ProviderError)) throw e;
      if (provider === 'platform' || e.status === 0) {
        ok = false;
        error = e.message;
      }
    }
    const [row] = await withSystem(this.database.db, async (tx) => {
      const saved = await tx
        .update(aiProviderConfigs)
        .set({ checkedAt: new Date(), checkOk: ok, checkError: error, updatedBy: staff.userId })
        .where(eq(aiProviderConfigs.provider, provider))
        .returning();
      return saved;
    });
    if (!row) throw new DomainError('not_found');
    return this.toConfig(row);
  }

  async update(
    staff: Staff,
    provider: AiProviderId,
    input: UpdateAiProviderConfig,
  ): Promise<AiProviderConfig> {
    const before = (await this.configs()).get(provider);
    if (!before) throw new DomainError('not_found');
    const legalRef = input.legalRef === undefined ? before.legalRef : input.legalRef;
    if (input.enabled && provider !== 'platform' && !legalRef) {
      throw new DomainError('validation_failed', {
        errors: [
          {
            path: 'legalRef',
            message: 'a legal review reference is required to enable an external provider',
          },
        ],
      });
    }
    const patch = {
      enabled: input.enabled,
      ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
      ...(input.models !== undefined ? { models: input.models } : {}),
      ...(input.defaultModel !== undefined ? { defaultModel: input.defaultModel } : {}),
      ...(input.priceInIrr !== undefined ? { priceInIrr: input.priceInIrr } : {}),
      ...(input.priceOutIrr !== undefined ? { priceOutIrr: input.priceOutIrr } : {}),
      legalRef,
      legalApprovedAt: legalRef === before.legalRef ? before.legalApprovedAt : legalRef ? new Date() : null,
      updatedBy: staff.userId,
    };
    const row = await withSystem(this.database.db, async (tx) => {
      const [saved] = await tx
        .update(aiProviderConfigs)
        .set(patch)
        .where(eq(aiProviderConfigs.provider, provider))
        .returning();
      await this.audit.record(tx, {
        actorId: staff.userId,
        actorKind: 'staff',
        action: 'ai_provider.updated',
        targetKind: 'ai_provider',
        targetId: provider,
        before: this.toConfig(before),
        after: saved ? this.toConfig(saved) : null,
      });
      return saved;
    });
    if (!row) throw new DomainError('not_found');
    // Enabling must pass the reachability check; a failed check leaves the provider off.
    if (input.enabled && !before.enabled) {
      const checked = await this.check(staff, provider);
      if (!checked.check?.ok) {
        await withSystem(this.database.db, (tx) =>
          tx
            .update(aiProviderConfigs)
            .set({ enabled: false })
            .where(eq(aiProviderConfigs.provider, provider)),
        );
        return { ...checked, enabled: false };
      }
      return checked;
    }
    return this.toConfig(row);
  }

  /** Platform models for the admin catalogue (from the model server, whatever is enabled). */
  async platformModels(): Promise<AiModel[]> {
    try {
      return await this.factory({
        provider: 'platform',
        baseUrl: (await this.configs()).get('platform')?.baseUrl ?? null,
        apiKey: null,
      }).models(AbortSignal.timeout(15_000));
    } catch (e) {
      if (e instanceof ProviderError)
        throw new DomainError('provider_error', { provider: 'platform', message: e.message });
      throw e;
    }
  }

  prices(): Promise<Map<AiProviderId, ConfigRow>> {
    return this.configs();
  }
}
