// P0 baseline of the data model (Technical Design §8.2, §8.9). Tenant-owned tables carry `workspace_id`
// and are protected by row-level security policies defined in the `0001_rls` migration.
import { uuidv7, type EntitlementValues, type FlagRule } from '@robosim/shared';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

const id = () =>
  uuid()
    .primaryKey()
    .$defaultFn(() => uuidv7());
const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const localeEnum = pgEnum('locale', ['fa', 'en']);
export const ageBandEnum = pgEnum('age_band', ['u13', '13_15', '16_17', 'adult']);
export const userStatusEnum = pgEnum('user_status', ['pending_consent', 'active', 'suspended', 'deleted']);
export const workspaceKindEnum = pgEnum('workspace_kind', ['personal', 'organization', 'branch']);
export const membershipRoleEnum = pgEnum('membership_role', [
  'org_owner',
  'org_admin',
  'billing_manager',
  'teacher',
  'assistant_teacher',
  'student',
]);
export const membershipStatusEnum = pgEnum('membership_status', ['invited', 'active', 'deactivated']);
export const staffRoleEnum = pgEnum('staff_role', [
  'platform_admin',
  'content_editor',
  'shop_operator',
  'finance',
  'support_agent',
  'moderator',
]);
export const actorKindEnum = pgEnum('actor_kind', ['user', 'staff', 'system', 'scim', 'lti']);

export const users = pgTable(
  'users',
  {
    id: id(),
    email: text(),
    phone: text(),
    passwordHash: text(),
    displayName: text().notNull(),
    locale: localeEnum().notNull().default('en'),
    // Column-level encryption of DOB/phone (Security §9) arrives with OpenBao Transit in P2.
    dateOfBirth: date({ mode: 'string' }),
    ageBand: ageBandEnum().notNull().default('adult'),
    status: userStatusEnum().notNull().default('active'),
    emailVerifiedAt: timestamp({ withTimezone: true }),
    phoneVerifiedAt: timestamp({ withTimezone: true }),
    // Password lockout (Security §4): consecutive failures since the last success, and the lock they caused.
    failedLoginCount: integer().notNull().default(0),
    lockedUntil: timestamp({ withTimezone: true }),
    personalWorkspaceId: uuid().references((): AnyPgColumn => workspaces.id, { onDelete: 'restrict' }),
    // Editor onboarding tour finished or skipped (FR-WRK-06): it opens once per account.
    editorTourCompletedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex('users_email_key').on(t.email),
    uniqueIndex('users_phone_key').on(t.phone),
    check('users_email_lowercase', sql`${t.email} = lower(${t.email})`),
    check('users_phone_e164', sql`${t.phone} ~ '^\\+[1-9][0-9]{6,14}$'`),
    check('users_has_contact', sql`${t.email} is not null or ${t.phone} is not null`),
  ],
);

export const workspaces = pgTable(
  'workspaces',
  {
    id: id(),
    kind: workspaceKindEnum().notNull(),
    parentId: uuid().references((): AnyPgColumn => workspaces.id, { onDelete: 'restrict' }),
    name: text().notNull(),
    slug: text().notNull(),
    logoKey: text(),
    ownerUserId: uuid()
      .notNull()
      .references((): AnyPgColumn => users.id, { onDelete: 'restrict' }),
    economicCode: text(),
    nationalId: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex('workspaces_slug_key').on(t.slug),
    index('workspaces_owner_idx').on(t.ownerUserId),
    index('workspaces_parent_idx').on(t.parentId),
    check('workspaces_branch_has_parent', sql`(${t.kind} = 'branch') = (${t.parentId} is not null)`),
  ],
);

export const memberships = pgTable(
  'memberships',
  {
    id: id(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: membershipRoleEnum().notNull(),
    status: membershipStatusEnum().notNull().default('active'),
    seatAssigned: boolean().notNull().default(false),
    branchId: uuid().references(() => workspaces.id, { onDelete: 'set null' }),
    joinedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('memberships_workspace_user_key').on(t.workspaceId, t.userId),
    index('memberships_user_idx').on(t.userId),
    index('memberships_branch_idx').on(t.branchId),
  ],
);

export const staffRoles = pgTable(
  'staff_roles',
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: staffRoleEnum().notNull(),
    grantedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    grantedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.role] })],
);

/** Append-only (no UPDATE/DELETE grants + trigger). Monthly partitioning is added when volume warrants it. */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    at: createdAt(),
    actorId: uuid(),
    actorKind: actorKindEnum().notNull(),
    workspaceId: uuid(),
    action: text().notNull(),
    targetKind: text().notNull(),
    targetId: text(),
    ip: text(),
    userAgent: text(),
    requestId: text(),
    before: jsonb(),
    after: jsonb(),
  },
  (t) => [
    index('audit_logs_workspace_at_idx').on(t.workspaceId, t.at),
    index('audit_logs_actor_idx').on(t.actorId),
  ],
);

/** Transactional outbox (Technical Design §7.2). */
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: id(),
    aggregateKind: text().notNull(),
    aggregateId: text().notNull(),
    type: text().notNull(),
    payload: jsonb().notNull(),
    createdAt: createdAt(),
    publishedAt: timestamp({ withTimezone: true }),
    attempts: integer().notNull().default(0),
    lastError: text(),
  },
  (t) => [
    index('outbox_events_unpublished_idx')
      .on(t.createdAt)
      .where(sql`${t.publishedAt} is null`),
  ],
);

export const featureFlags = pgTable('feature_flags', {
  key: text().primaryKey(),
  description: text(),
  enabled: boolean().notNull().default(false),
  rules: jsonb().$type<FlagRule[]>().notNull().default([]),
  updatedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
  updatedAt: updatedAt(),
});

export const projectLanguageEnum = pgEnum('project_language', ['cpp', 'blocks']);
export const projectVisibilityEnum = pgEnum('project_visibility', ['private', 'link', 'workspace']);
export const projectVersionSourceEnum = pgEnum('project_version_source', [
  'manual',
  'auto_build',
  'restore',
  'ai_apply',
  'submission',
  'import',
]);

/**
 * Technical Design §8.4. `document` is the working copy that saves overwrite (guarded by `revision`, the ETag);
 * `project_versions` holds immutable snapshots (checkpoints, builds, restores). Sharing columns arrive in P2.
 */
export const projects = pgTable(
  'projects',
  {
    id: id(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    ownerUserId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    name: text().notNull(),
    boardId: text().notNull(),
    language: projectLanguageEnum().notNull(),
    visibility: projectVisibilityEnum().notNull().default('private'),
    tags: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    schemaVersion: integer().notNull(),
    document: jsonb().notNull(),
    documentSha256: text().notNull(),
    revision: integer().notNull().default(1),
    // Share link (FR-PRJ-04): the token is HMAC(secret, id.nonce), so the owner can see it again; only its
    // SHA-256 is stored for lookup. A new nonce retires the old link.
    shareLinkNonce: text(),
    shareTokenHash: text(),
    linkRemixable: boolean().notNull().default(false),
    // Attribution of a remix or copy (US-CMY-02 AC1); name and author are kept if the source goes away.
    remixedFromId: uuid().references((): AnyPgColumn => projects.id, { onDelete: 'set null' }),
    remixedFromName: text(),
    remixedFromAuthor: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex('projects_share_token_hash_key').on(t.shareTokenHash),
    index('projects_workspace_updated_idx').on(t.workspaceId, t.updatedAt, t.id),
    index('projects_workspace_name_idx').on(t.workspaceId, t.name, t.id),
    index('projects_owner_idx').on(t.ownerUserId),
  ],
);

export const projectVersions = pgTable(
  'project_versions',
  {
    id: id(),
    projectId: uuid()
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    number: integer().notNull(),
    label: text(),
    source: projectVersionSourceEnum().notNull(),
    document: jsonb().notNull(),
    documentSha256: text().notNull(),
    artifactId: text(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('project_versions_project_number_key').on(t.projectId, t.number),
    index('project_versions_workspace_idx').on(t.workspaceId),
  ],
);

// Identity (Technical Design §8.2 `iam`). Sessions and one-time tokens are looked up by the SHA-256 of a secret
// that only the client holds; the secret itself is never stored.
export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text().notNull(),
    createdAt: createdAt(),
    lastSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    revokedAt: timestamp({ withTimezone: true }),
    ip: text(),
    userAgent: text(),
    mfaLevel: integer().notNull().default(1),
  },
  (t) => [uniqueIndex('sessions_token_hash_key').on(t.tokenHash), index('sessions_user_idx').on(t.userId)],
);

export const authTokenPurposeEnum = pgEnum('auth_token_purpose', [
  'email_verify',
  'password_reset',
  'otp_login',
  'guardian_consent',
  'invite',
  'email_change',
]);

export const authTokens = pgTable(
  'auth_tokens',
  {
    id: id(),
    userId: uuid().references(() => users.id, { onDelete: 'cascade' }),
    purpose: authTokenPurposeEnum().notNull(),
    tokenHash: text().notNull(),
    target: text().notNull(),
    attempts: integer().notNull().default(0),
    createdAt: createdAt(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    consumedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex('auth_tokens_token_hash_key').on(t.tokenHash),
    index('auth_tokens_user_purpose_idx').on(t.userId, t.purpose),
  ],
);

// Plans and entitlements (Technical Design §8.7, §9.1). Plans and their versions are a global catalogue; a
// workspace without a live subscription is on Free.
export const planCodeEnum = pgEnum('plan_code', [
  'free',
  'maker',
  'classroom',
  'institution',
  'private_cloud',
]);
export const planIntervalEnum = pgEnum('plan_interval', ['month', 'year', 'term']);
export const subscriptionStatusEnum = pgEnum('subscription_status', [
  'trialing',
  'active',
  'expired',
  'canceled',
]);
export const subscriptionSourceEnum = pgEnum('subscription_source', [
  'self_serve',
  'contract',
  'pilot',
  'manual',
]);

export const plans = pgTable('plans', {
  id: id(),
  code: planCodeEnum().notNull().unique('plans_code_key'),
  /** Listed on the public plans page (self-serve editions). */
  public: boolean().notNull().default(false),
  createdAt: createdAt(),
});

/** Immutable once published: a change is a new version, and subscribers keep theirs until renewal (FR-BIL-01). */
export const planVersions = pgTable(
  'plan_versions',
  {
    id: id(),
    planId: uuid()
      .notNull()
      .references(() => plans.id, { onDelete: 'restrict' }),
    version: integer().notNull(),
    interval: planIntervalEnum().notNull(),
    priceIrr: bigint({ mode: 'number' }),
    seatBased: boolean().notNull().default(false),
    minSeats: integer().notNull().default(1),
    trialDays: integer().notNull().default(0),
    entitlements: jsonb().$type<EntitlementValues>().notNull(),
    effectiveFrom: timestamp({ withTimezone: true }).notNull().defaultNow(),
    effectiveTo: timestamp({ withTimezone: true }),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [uniqueIndex('plan_versions_plan_version_key').on(t.planId, t.version)],
);

/** One subscription per workspace; it no longer counts once `current_period_end` has passed. */
export const subscriptions = pgTable(
  'subscriptions',
  {
    id: id(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    planVersionId: uuid()
      .notNull()
      .references(() => planVersions.id, { onDelete: 'restrict' }),
    status: subscriptionStatusEnum().notNull(),
    seats: integer().notNull().default(1),
    source: subscriptionSourceEnum().notNull(),
    trialEndsAt: timestamp({ withTimezone: true }),
    currentPeriodStart: timestamp({ withTimezone: true }).notNull().defaultNow(),
    currentPeriodEnd: timestamp({ withTimezone: true }),
    autoRenewFromWallet: boolean().notNull().default(false),
    contractRef: text(),
    updatedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('subscriptions_workspace_key').on(t.workspaceId)],
);

/** Staff grants on top of the plan (FR-ADM-02): for the whole workspace, or one member when `user_id` is set. */
export const entitlementOverrides = pgTable(
  'entitlement_overrides',
  {
    id: id(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid().references(() => users.id, { onDelete: 'cascade' }),
    key: text().notNull(),
    value: jsonb().notNull(),
    reason: text().notNull(),
    grantedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    expiresAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('entitlement_overrides_workspace_idx').on(t.workspaceId)],
);

export const sharePrincipalKindEnum = pgEnum('share_principal_kind', ['user', 'workspace']);
export const projectShareRoleEnum = pgEnum('project_share_role', ['view', 'comment', 'edit']);

/** People a project is shared with (FR-PRJ-04). `workspace_id` is the project's, for the owner's RLS scope. */
export const projectShares = pgTable(
  'project_shares',
  {
    projectId: uuid()
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    principalKind: sharePrincipalKindEnum().notNull(),
    principalId: uuid().notNull(),
    role: projectShareRoleEnum().notNull(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.principalKind, t.principalId] }),
    index('project_shares_principal_idx').on(t.principalKind, t.principalId),
  ],
);

export const stockStatusEnum = pgEnum('stock_status', ['in_stock', 'low', 'out_of_stock', 'unknown']);

/**
 * Price list behind the BOM (FR-BOM-02), keyed by part key (`passive.resistor?ohms=220`, `board:avr-uno`).
 * A global catalogue the app reads; staff write it. The shop catalogue (FR-SHP-01) will take it over.
 */
export const catalogPrices = pgTable('catalog_prices', {
  partKey: text().primaryKey(),
  priceIrr: bigint({ mode: 'number' }),
  stock: stockStatusEnum().notNull().default('unknown'),
  updatedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
  updatedAt: updatedAt(),
});

/** Parts a user already owns (FR-BOM-03), excluded from BOM purchase totals. */
export const userInventory = pgTable(
  'user_inventory',
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    partKey: text().notNull(),
    quantity: integer().notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.partKey] }),
    check('user_inventory_quantity_positive', sql`${t.quantity} > 0`),
  ],
);

/**
 * Guided-project progress (FR-LRN-01, TD §8.5): steps a user has completed at least once, per content
 * version (`slug@version`), and when they finished. Step ids rather than indexes, so they survive edits.
 */
export const guidedProgress = pgTable(
  'guided_progress',
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    contentVersionId: text().notNull(),
    /** The workspace the learner was in when they last recorded progress. */
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** The project they are building it in, when it is saved on the server. */
    projectId: uuid(),
    completedSteps: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    completedAt: timestamp({ withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.contentVersionId] })],
);

// ---- AI assistant (FR-AI-01…05, 07…09, FR-ADM-08; TD §8.9, §13) ----

export const aiProviderEnum = pgEnum('ai_provider', [
  'platform',
  'openai',
  'anthropic',
  'gemini',
  'openrouter',
  'compatible',
]);
export const aiKeyOwnerEnum = pgEnum('ai_key_owner', ['user', 'workspace']);
export const aiKeyStatusEnum = pgEnum('ai_key_status', ['pending', 'active', 'invalid']);
export const aiModeEnum = pgEnum('ai_mode', ['full', 'hints']);
export const aiRoleEnum = pgEnum('ai_role', ['user', 'assistant']);

/**
 * Providers enabled for this deployment (BR-15): an external provider is usable only once staff enable it
 * with a legal-review reference. A global catalogue: system code reads it, staff write it.
 */
export const aiProviderConfigs = pgTable('ai_provider_configs', {
  provider: aiProviderEnum().primaryKey(),
  enabled: boolean().notNull().default(false),
  baseUrl: text(),
  /** Models users may pick; empty = every model the provider lists. */
  models: jsonb().$type<string[]>().notNull().default([]),
  defaultModel: text(),
  legalRef: text(),
  legalApprovedAt: timestamp({ withTimezone: true }),
  priceInIrr: bigint({ mode: 'number' }),
  priceOutIrr: bigint({ mode: 'number' }),
  checkedAt: timestamp({ withTimezone: true }),
  checkOk: boolean(),
  checkError: text(),
  updatedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
  updatedAt: updatedAt(),
});

/**
 * Bring-your-own keys (FR-AI-04): envelope-encrypted (AES-256-GCM data key per key, wrapped by the KEK).
 * Only system code reads this table; the app role has no grant.
 */
export const aiKeys = pgTable(
  'ai_keys',
  {
    id: id(),
    ownerKind: aiKeyOwnerEnum().notNull(),
    /** A user id or a workspace id, by `ownerKind`. */
    ownerId: uuid().notNull(),
    provider: aiProviderEnum().notNull(),
    ciphertext: text().notNull(),
    wrappedDek: text().notNull(),
    keyLast4: text().notNull(),
    baseUrl: text(),
    status: aiKeyStatusEnum().notNull().default('pending'),
    lastError: text(),
    validatedAt: timestamp({ withTimezone: true }),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('ai_keys_owner_provider').on(t.ownerKind, t.ownerId, t.provider)],
);

/** Conversations per project (FR-AI-08); `expiresAt` = last activity + 90 days (30 for minors). */
export const aiConversations = pgTable(
  'ai_conversations',
  {
    id: id(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Null for a project that is not saved on the server. */
    projectId: uuid().references(() => projects.id, { onDelete: 'cascade' }),
    title: text().notNull(),
    mode: aiModeEnum().notNull().default('full'),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('ai_conversations_user_project').on(t.userId, t.projectId, t.updatedAt),
    index('ai_conversations_expires').on(t.expiresAt),
  ],
);

export const aiMessages = pgTable(
  'ai_messages',
  {
    id: id(),
    conversationId: uuid()
      .notNull()
      .references(() => aiConversations.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: aiRoleEnum().notNull(),
    content: text().notNull(),
    proposals: jsonb().$type<unknown[]>().notNull().default([]),
    provider: aiProviderEnum(),
    model: text(),
    tokensIn: integer().notNull().default(0),
    tokensOut: integer().notNull().default(0),
    /** The answer was cut by the output filter (FR-AI-07); `content` holds the notice. */
    filtered: boolean().notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('ai_messages_conversation').on(t.conversationId, t.createdAt)],
);

/**
 * Metered usage, one row per answered request: the credit ledger's debits (FR-AI-03). `credits` = platform
 * tokens charged (0 with a BYOK key), so a month's use is a sum.
 */
export const aiUsage = pgTable(
  'ai_usage',
  {
    id: id(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: aiProviderEnum().notNull(),
    model: text().notNull(),
    tokensIn: integer().notNull(),
    tokensOut: integer().notNull(),
    credits: integer().notNull(),
    latencyMs: integer().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('ai_usage_user_month').on(t.workspaceId, t.userId, t.createdAt),
    index('ai_usage_created').on(t.createdAt),
  ],
);
