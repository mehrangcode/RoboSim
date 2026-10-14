import { z } from 'zod';

export const workspaceKindSchema = z.enum(['personal', 'organization', 'branch']);
export type WorkspaceKind = z.infer<typeof workspaceKindSchema>;

/** Workspace roles (PRD §4.2). Personal workspaces have a single `org_owner` membership. */
export const membershipRoleSchema = z.enum([
  'org_owner',
  'org_admin',
  'billing_manager',
  'teacher',
  'assistant_teacher',
  'student',
]);
export type MembershipRole = z.infer<typeof membershipRoleSchema>;

export const staffRoleSchema = z.enum([
  'platform_admin',
  'content_editor',
  'shop_operator',
  'finance',
  'support_agent',
  'moderator',
]);
export type StaffRole = z.infer<typeof staffRoleSchema>;

export const ageBandSchema = z.enum(['u13', '13_15', '16_17', 'adult']);
export type AgeBand = z.infer<typeof ageBandSchema>;
