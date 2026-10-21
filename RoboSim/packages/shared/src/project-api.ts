import { z } from 'zod';
import { projectDocumentSchema } from './project-schema.js';

/** Projects API contract (API Spec §4.4, Technical Design §8.4). Shared by the API and the web client. */

export const PROJECT_LIMITS = {
  /** Serialized (UTF-8) size of a stored document; the request body limit matches it. */
  maxDocumentBytes: 1_048_576,
  maxNameLength: 200,
  maxTags: 20,
  maxTagLength: 32,
  maxLabelLength: 120,
  /** Sanity cap until plan-based retention (`projects.version_retention_days`) arrives with entitlements. */
  maxVersionsPerProject: 500,
  defaultListLimit: 50,
  maxListLimit: 200,
  /** Soft-deleted projects can be restored for this long (FR-PRJ-01). */
  trashDays: 30,
} as const;

export const PROJECT_SORTS = ['-updatedAt', 'updatedAt', '-createdAt', 'createdAt', 'name', '-name'] as const;
export const projectSortSchema = z.enum(PROJECT_SORTS);
export type ProjectSort = z.infer<typeof projectSortSchema>;

export const PROJECT_VERSION_SOURCES = [
  'manual',
  'auto_build',
  'restore',
  'ai_apply',
  'submission',
  'import',
] as const;
export const projectVersionSourceSchema = z.enum(PROJECT_VERSION_SOURCES);
export type ProjectVersionSource = z.infer<typeof projectVersionSourceSchema>;

const name = z.string().trim().min(1).max(PROJECT_LIMITS.maxNameLength);
const tag = z.string().trim().toLowerCase().min(1).max(PROJECT_LIMITS.maxTagLength);
const tags = z
  .array(tag)
  .max(PROJECT_LIMITS.maxTags)
  .transform((t) => [...new Set(t)]);

export const projectListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  tag: tag.optional(),
  sort: projectSortSchema.default('-updatedAt'),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(PROJECT_LIMITS.maxListLimit)
    .default(PROJECT_LIMITS.defaultListLimit),
  cursor: z.string().max(512).optional(),
  /** `true` lists the trash (soft-deleted projects) instead. */
  deleted: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});
export type ProjectListQuery = z.infer<typeof projectListQuerySchema>;
export type ProjectListQueryInput = z.input<typeof projectListQuerySchema>;

/** The document is validated (and migrated) by the server, so the body carries it as an opaque value. */
export const createProjectSchema = z.strictObject({
  /** Defaults to the document's `meta.title`. */
  name: name.optional(),
  tags: tags.default([]),
  document: z.unknown().refine((d) => d !== undefined, 'document is required'),
});
export type CreateProjectInput = z.input<typeof createProjectSchema>;

export const updateProjectSchema = z
  .strictObject({ name: name.optional(), tags: tags.optional() })
  .refine((v) => v.name !== undefined || v.tags !== undefined, 'nothing to update');
export type UpdateProjectInput = z.input<typeof updateProjectSchema>;

export const createVersionSchema = z.strictObject({
  label: z.string().trim().min(1).max(PROJECT_LIMITS.maxLabelLength),
});
export type CreateVersionInput = z.input<typeof createVersionSchema>;

export const projectSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  boardId: z.string(),
  language: z.enum(['cpp', 'blocks']),
  tags: z.array(z.string()),
  /** Bumped by every change to the project; the ETag is derived from it. */
  revision: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});
export type ProjectSummary = z.infer<typeof projectSummarySchema>;

export const projectSchema = projectSummarySchema.extend({ document: projectDocumentSchema });
export type Project = z.infer<typeof projectSchema>;

export const projectPageSchema = z.object({
  items: z.array(projectSummarySchema),
  nextCursor: z.string().nullable(),
});
export type ProjectPage = z.infer<typeof projectPageSchema>;

export const projectVersionSummarySchema = z.object({
  id: z.string(),
  number: z.number().int(),
  label: z.string().nullable(),
  source: projectVersionSourceSchema,
  /** Content address of the firmware built from this version (auto snapshots). */
  artifactId: z.string().nullable(),
  documentSha256: z.string(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
});
export type ProjectVersionSummary = z.infer<typeof projectVersionSummarySchema>;

export const projectVersionSchema = projectVersionSummarySchema.extend({ document: projectDocumentSchema });
export type ProjectVersion = z.infer<typeof projectVersionSchema>;

/** Strong ETag of a project revision. */
export function projectEtag(revision: number): string {
  return `"r${revision}"`;
}

/** The revision an `If-Match` header names, or undefined when it is missing or not one of ours. */
export function parseIfMatch(header: string | undefined): number | undefined {
  const m = header?.trim().match(/^"r(\d{1,15})"$/);
  return m ? Number(m[1]) : undefined;
}
