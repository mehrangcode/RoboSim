import { parseFlagOverrides, type FlagOverrides } from '@robosim/shared';
import { z } from 'zod';

export const DEV_SHARE_LINK_SECRET = 'robosim-development-share-link-secret-not-for-production';

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
    // Build service (Technical Design §6, ADR-022). `local` = avr-gcc in a Linux namespace sandbox on this host.
    COMPILER_RUNTIME: z.enum(['local']).default('local'),
    COMPILER_TOOLCHAIN_DIR: z.string().optional(),
    COMPILER_CACHE_DIR: z.string().optional(),
    COMPILER_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(2),
    BUILD_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(20),
    BUILD_GUEST_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(5),
    // Stand-ins for the `build.daily_quota` entitlement and TD §6's per-user concurrency until plans land (P2).
    BUILD_DAILY_QUOTA: z.coerce.number().int().min(1).default(200),
    BUILD_USER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
    // Firmware store (filesystem adapter of the object-storage port); default `.local/artifacts`.
    ARTIFACT_STORE_DIR: z.string().optional(),
    // Opt-in for tests and scripts: requests without a session act as a fixed development user (X-Dev-User
    // overrides it). Off by default; refused in staging and production.
    DEV_IDENTITY: bool.default(false),
    DEV_IDENTITY_EMAIL: z.email().default('learner@dev.local'),
    // Authentication (API Spec §2, Security §4). Auth endpoints share one per-IP budget.
    AUTH_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(10),
    // Where links in emails point (the web app's origin).
    PUBLIC_APP_URL: z.url().default('http://localhost:5173'),
    // `dev` keeps messages in memory and serves them at GET /dev/mail (local and test only). SMTP lands with staging.
    MAIL_TRANSPORT: z.enum(['dev']).default('dev'),
    // Signs share links (FR-PRJ-04); changing it retires every link. Must be set outside local and test.
    SHARE_LINK_SECRET: z.string().min(32).default(DEV_SHARE_LINK_SECRET),
    SHARED_LINK_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(60),
  })
  .superRefine((env, ctx) => {
    if (env.DATABASE_DRIVER === 'postgres' && !env.DATABASE_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: 'required when DATABASE_DRIVER=postgres',
      });
    }
    if ((env.APP_ENV === 'production' || env.APP_ENV === 'staging') && env.COMPILER_RUNTIME === 'local') {
      ctx.addIssue({
        code: 'custom',
        path: ['COMPILER_RUNTIME'],
        message:
          'the local build runtime is for development only; staging/production need the gVisor sandbox',
      });
    }
    if ((env.APP_ENV === 'production' || env.APP_ENV === 'staging') && env.DEV_IDENTITY) {
      ctx.addIssue({
        code: 'custom',
        path: ['DEV_IDENTITY'],
        message: 'the development identity is for local and test environments only',
      });
    }
    if ((env.APP_ENV === 'production' || env.APP_ENV === 'staging') && env.MAIL_TRANSPORT === 'dev') {
      ctx.addIssue({
        code: 'custom',
        path: ['MAIL_TRANSPORT'],
        message: 'the development mail sink is for local and test environments only',
      });
    }
    if (
      (env.APP_ENV === 'production' || env.APP_ENV === 'staging') &&
      env.SHARE_LINK_SECRET === DEV_SHARE_LINK_SECRET
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['SHARE_LINK_SECRET'],
        message: 'set a private secret of at least 32 characters',
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

export type Env = z.infer<typeof envSchema> & {
  flagOverrides: FlagOverrides;
  /** Whether requests without a session act as the development identity (`DEV_IDENTITY`). */
  devIdentity: boolean;
  /** Whether development-only endpoints (`/dev/*`) are served. */
  devEndpoints: boolean;
};

/** Validates configuration at startup and fails fast with every problem listed. */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${problems}`);
  }
  return {
    ...parsed.data,
    flagOverrides: parseFlagOverrides(parsed.data.FEATURE_FLAGS_OVERRIDE),
    devIdentity: parsed.data.DEV_IDENTITY,
    devEndpoints: parsed.data.APP_ENV === 'local' || parsed.data.APP_ENV === 'test',
  };
}

export const ENV = Symbol('ENV');
