import { z } from 'zod';
import { projectDocumentSchema } from './project-schema.js';
import { projectSummarySchema, remixedFromSchema } from './project-api.js';

/** Sharing contract (FR-PRJ-04, US-PRJ-03; API Spec §4.4). Shared by the API and the web client. */

export const SHARE_LIMITS = {
  /** People a single project can be shared with. */
  maxSharesPerProject: 50,
  /** "Shared with me" is one page for now. */
  maxSharedList: 200,
} as const;

/** `comment` exists in the data model (TD §8.4) but is not offered until comments ship (FR-PRJ-05, P4). */
export const SHARE_ROLES = ['view', 'edit'] as const;
export const shareRoleSchema = z.enum(SHARE_ROLES);
export type ShareRole = z.infer<typeof shareRoleSchema>;

export const shareRequestSchema = z.strictObject({
  email: z.string().trim().min(3).max(254),
  role: shareRoleSchema,
});
export type ShareRequest = z.infer<typeof shareRequestSchema>;

export const shareLinkRequestSchema = z.strictObject({
  /** Whether visitors may copy the project into their own workspace (needs sign-in). */
  remixable: z.boolean(),
  /** Issue a new link; the old one stops working. */
  regenerate: z.boolean().default(false),
});
export type ShareLinkRequest = z.input<typeof shareLinkRequestSchema>;

export const projectSharingSchema = z.object({
  link: z.object({ url: z.string(), remixable: z.boolean() }).nullable(),
  people: z.array(
    z.object({
      userId: z.string(),
      email: z.string().nullable(),
      displayName: z.string(),
      role: shareRoleSchema,
    }),
  ),
});
export type ProjectSharing = z.infer<typeof projectSharingSchema>;

export const sharedProjectSchema = projectSummarySchema.extend({
  role: shareRoleSchema,
  ownerName: z.string(),
});
export type SharedProject = z.infer<typeof sharedProjectSchema>;
export const sharedProjectListSchema = z.object({ items: z.array(sharedProjectSchema) });
export type SharedProjectList = z.infer<typeof sharedProjectListSchema>;

/** What a share-link visitor gets (`GET /shared/:token`): enough to run the project, nothing to manage it. */
export const sharedLinkSchema = z.object({
  project: z.object({
    id: z.string(),
    name: z.string(),
    updatedAt: z.string(),
    document: projectDocumentSchema,
    remixedFrom: remixedFromSchema.nullable(),
  }),
  ownerName: z.string(),
  remixable: z.boolean(),
});
export type SharedLink = z.infer<typeof sharedLinkSchema>;

/** Share-link tokens are 43 base64url characters (HMAC-SHA256). */
export const shareTokenSchema = z.string().regex(/^[\w-]{43}$/);
