// P0 baseline of the data model (Technical Design §8.2, §8.9). Tenant-owned tables carry `workspace_id`
// and are protected by row-level security policies defined in the `0001_rls` migration.
import { uuidv7, type FlagRule } from '@robosim/shared';
import { sql } from 'drizzle-orm';
import {
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
    personalWorkspaceId: uuid().references((): AnyPgColumn => workspaces.id, { onDelete: 'restrict' }),
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
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
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
