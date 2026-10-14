import { evaluateFlag, flagDefinitionSchema, type FlagContext, type FlagDefinition } from '@robosim/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV, type Env } from '../../config/env.js';
import { DATABASE, type Database } from '../../db/client.js';
import { featureFlags } from '../../db/schema.js';

/** DB-backed feature flags with a short in-process cache and env overrides (FR-ADM-09). */
@Injectable()
export class FeatureFlagsService {
  private readonly logger = new Logger(FeatureFlagsService.name);
  private cache: { at: number; flags: FlagDefinition[] } | undefined;

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async evaluateAll(
    ctx: Omit<FlagContext, 'environment'> = {},
    now = Date.now(),
  ): Promise<Record<string, boolean>> {
    const flags = await this.definitions(now);
    const context: FlagContext = { ...ctx, environment: this.env.APP_ENV };
    const result: Record<string, boolean> = {};
    for (const flag of flags) result[flag.key] = evaluateFlag(flag, context, this.env.flagOverrides);
    for (const [key, value] of Object.entries(this.env.flagOverrides)) result[key] ??= value;
    return result;
  }

  async isEnabled(key: string, ctx: Omit<FlagContext, 'environment'> = {}): Promise<boolean> {
    return (await this.evaluateAll(ctx))[key] ?? false;
  }

  invalidate(): void {
    this.cache = undefined;
  }

  private async definitions(now: number): Promise<FlagDefinition[]> {
    if (this.cache && now - this.cache.at < this.env.FEATURE_FLAGS_CACHE_MS) return this.cache.flags;
    const rows = await this.database.db.select().from(featureFlags);
    const flags: FlagDefinition[] = [];
    for (const row of rows) {
      const parsed = flagDefinitionSchema.safeParse({ key: row.key, enabled: row.enabled, rules: row.rules });
      // A malformed flag is treated as off rather than taking the API down.
      if (parsed.success) flags.push(parsed.data);
      else this.logger.error(`Ignoring malformed feature flag "${row.key}": ${parsed.error.message}`);
    }
    this.cache = { at: now, flags };
    return flags;
  }
}
