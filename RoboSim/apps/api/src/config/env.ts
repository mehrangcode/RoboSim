import { parseFlagOverrides, type FlagOverrides } from '@robosim/shared';
import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_ENV: z.enum(['local', 'test', 'preview', 'staging', 'production']).default('local'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    API_HOST: z.string().default('0.0.0.0'),
    TRUST_PROXY: bool.default(false),
    DATABASE_DRIVER: z.enum(['postgres', 'pglite']).default('postgres'),
    DATABASE_URL: z.string().optional(),
    PGLITE_DATA_DIR: z.string().default('memory://'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    PUBLIC_DOCS_URL: z.url().default('https://docs.robosim.example'),
    FEATURE_FLAGS_OVERRIDE: z.string().default(''),
    FEATURE_FLAGS_CACHE_MS: z.coerce.number().int().min(0).default(30_000),
  })
  .superRefine((env, ctx) => {
    if (env.DATABASE_DRIVER === 'postgres' && !env.DATABASE_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: 'required when DATABASE_DRIVER=postgres',
      });
    }
    if (env.APP_ENV === 'production' && env.DATABASE_DRIVER === 'pglite') {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_DRIVER'],
        message: 'pglite is for development and tests only',
      });
    }
  });

export type Env = z.infer<typeof envSchema> & { flagOverrides: FlagOverrides };

/** Validates configuration at startup and fails fast with every problem listed. */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${problems}`);
  }
  return { ...parsed.data, flagOverrides: parseFlagOverrides(parsed.data.FEATURE_FLAGS_OVERRIDE) };
}

export const ENV = Symbol('ENV');
