import { z } from 'zod';

export const flagRuleSchema = z.object({
  environments: z.array(z.string()).optional(),
  plans: z.array(z.string()).optional(),
  workspaceIds: z.array(z.string()).optional(),
  userIds: z.array(z.string()).optional(),
  /** 0–100; sticky per subject (user, else workspace). */
  percentage: z.number().min(0).max(100).optional(),
  value: z.boolean(),
});
export type FlagRule = z.infer<typeof flagRuleSchema>;

export const flagDefinitionSchema = z.object({
  key: z.string().regex(/^[a-z0-9]+([._-][a-z0-9]+)*$/),
  description: z.string().optional(),
  /** Kill switch: when false the flag is off regardless of rules. */
  enabled: z.boolean(),
  rules: z.array(flagRuleSchema),
});
export type FlagDefinition = z.infer<typeof flagDefinitionSchema>;

export interface FlagContext {
  environment: string;
  plan?: string;
  workspaceId?: string;
  userId?: string;
}

export type FlagOverrides = Record<string, boolean>;

/** FNV-1a over `flagKey:subject` → bucket 0..9999, so each flag rolls out to an independent user sample. */
export function bucketOf(flagKey: string, subject: string): number {
  let hash = 0x811c9dc5;
  for (const char of `${flagKey}:${subject}`) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 10_000;
}

function ruleMatches(flagKey: string, rule: FlagRule, ctx: FlagContext): boolean {
  if (rule.environments && !rule.environments.includes(ctx.environment)) return false;
  if (rule.plans && (!ctx.plan || !rule.plans.includes(ctx.plan))) return false;
  if (rule.workspaceIds && (!ctx.workspaceId || !rule.workspaceIds.includes(ctx.workspaceId))) return false;
  if (rule.userIds && (!ctx.userId || !rule.userIds.includes(ctx.userId))) return false;
  if (rule.percentage !== undefined) {
    const subject = ctx.userId ?? ctx.workspaceId;
    if (!subject) return false;
    if (bucketOf(flagKey, subject) >= rule.percentage * 100) return false;
  }
  return true;
}

/** Overrides → kill switch → first matching rule → off. */
export function evaluateFlag(flag: FlagDefinition, ctx: FlagContext, overrides: FlagOverrides = {}): boolean {
  const override = overrides[flag.key];
  if (override !== undefined) return override;
  if (!flag.enabled) return false;
  return flag.rules.find((rule) => ruleMatches(flag.key, rule, ctx))?.value ?? false;
}

/** Parses `FEATURE_FLAGS_OVERRIDE` ("a=on,b=off"). Fails fast on malformed input. */
export function parseFlagOverrides(raw: string | undefined): FlagOverrides {
  const result: FlagOverrides = {};
  for (const entry of (raw ?? '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean)) {
    const [key, value] = entry.split('=').map((s) => s.trim());
    if (!key || (value !== 'on' && value !== 'off')) {
      throw new Error(`Invalid feature flag override "${entry}" (expected key=on|off)`);
    }
    result[key] = value === 'on';
  }
  return result;
}
