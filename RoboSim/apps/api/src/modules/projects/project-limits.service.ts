import { CATALOG_MANIFESTS } from '@robosim/catalog/manifests';
import {
  DomainError,
  settingIncludes,
  type ComponentTier,
  type ProjectDocument,
  type QuotaLimit,
} from '@robosim/shared';
import { Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Tx } from '../../db/client.js';
import { projects } from '../../db/schema.js';
import { EntitlementsService } from '../entitlements/index.js';

/** The entitlements that govern a workspace's projects: its owner's (PRD §3), whoever is editing. */
export interface ProjectRules {
  cap: QuotaLimit;
  tier: ComponentTier;
}

const PRO_PARTS = new Set(CATALOG_MANIFESTS.filter((m) => m.tier === 'pro').map((m) => m.id));

/** Whether a project with `rank` more recently updated siblings is beyond the cap (read-only). */
export function beyondCap(cap: QuotaLimit, rank: number): boolean {
  return cap !== null && rank >= cap;
}

/** Part types in the document that need `components.tier = all`, in order of first use. */
export function proPartsIn(doc: ProjectDocument): string[] {
  return [...new Set(doc.components.map((c) => c.type).filter((t) => PRO_PARTS.has(t)))];
}

/**
 * Project limits from entitlements: `projects.cloud_max` (room for another project; over the cap only the most
 * recently updated projects stay editable) and `components.tier` (pro parts in saved documents). Rules are resolved
 * before a request transaction opens (entitlements are system reads); the checks run inside it.
 */
@Injectable()
export class ProjectLimits {
  constructor(private readonly entitlements: EntitlementsService) {}

  async rules(workspaceId: string, userId: string): Promise<ProjectRules> {
    const { values } = await this.entitlements.resolve(workspaceId, userId);
    return { cap: values['projects.cloud_max'], tier: values['components.tier'] };
  }

  /** `403 quota_exceeded` when the workspace already has `cap` live projects. Runs in the owner's scope. */
  async assertRoom(tx: Tx, rules: ProjectRules, workspaceId: string): Promise<void> {
    if (rules.cap === null) return;
    const [{ n } = { n: 0 }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(projects)
      .where(and(eq(projects.workspaceId, workspaceId), isNull(projects.deletedAt)));
    if (n >= rules.cap)
      throw new DomainError('quota_exceeded', {
        quota: 'projects.cloud_max',
        limit: rules.cap,
        suggestedPlan: 'maker',
      });
  }

  /** Whether a live project is beyond the cap (read-only). */
  async isLocked(tx: Tx, rules: ProjectRules, projectId: string): Promise<boolean> {
    if (rules.cap === null) return false;
    const [row] = await tx
      .select({ rank: sql<number>`app_project_rank(${projects.id})` })
      .from(projects)
      .where(eq(projects.id, projectId));
    return beyondCap(rules.cap, row?.rank ?? 0);
  }

  /** `403 quota_exceeded` (`locked`) for a change to a project beyond the cap. */
  async assertWritable(tx: Tx, rules: ProjectRules, projectId: string): Promise<void> {
    if (await this.isLocked(tx, rules, projectId))
      throw new DomainError('quota_exceeded', {
        quota: 'projects.cloud_max',
        limit: rules.cap,
        locked: true,
        suggestedPlan: 'maker',
      });
  }

  /** `403 entitlement_required` listing the pro parts a basic-tier workspace tried to save (FR-BIL-05). */
  assertParts(rules: ProjectRules, doc: ProjectDocument): void {
    if (settingIncludes('components.tier', rules.tier, 'all')) return;
    const parts = proPartsIn(doc);
    if (parts.length > 0)
      throw new DomainError('entitlement_required', {
        entitlement: 'components.tier',
        suggestedPlan: 'maker',
        parts,
      });
  }
}
