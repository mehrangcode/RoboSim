import {
  GUIDED_PROJECTS,
  findGuided,
  guidedProject,
  guidedSummary,
  type GuidedContent,
} from '@robosim/content/guided';
import {
  DEFAULT_PLAN_ENTITLEMENTS,
  DomainError,
  contentVersionId,
  type GuidedProgress,
  type GuidedProjectResponse,
  type GuidedSummary,
  type PutGuidedProgressInput,
} from '@robosim/shared';
import { Inject, Injectable } from '@nestjs/common';
import { asc, eq, sql } from 'drizzle-orm';
import { DATABASE, type Database } from '../../db/client.js';
import { guidedProgress } from '../../db/schema.js';
import { withScope } from '../../db/scope.js';
import { EntitlementsService } from '../entitlements/index.js';
import type { Caller } from '../iam/index.js';

const toProgress = (r: typeof guidedProgress.$inferSelect): GuidedProgress => ({
  contentVersionId: r.contentVersionId,
  projectId: r.projectId,
  completedSteps: r.completedSteps,
  completedAt: r.completedAt?.toISOString() ?? null,
  updatedAt: r.updatedAt.toISOString(),
});

/** Built-in content by `slug@version`: progress is only recorded against content that exists. */
const BY_VERSION = new Map(GUIDED_PROJECTS.map((c) => [contentVersionId(c.slug, c.version), c]));

/**
 * Guided projects (FR-LRN-01; API Spec §4.6). Content is built in (`@robosim/content/guided`); the caller's
 * `learning.guided_projects` decides what is open: `first` opens the free project, `all` every one. Guests get
 * Free's value. Progress is the learner's own record, not a grade, so the browser's checks are trusted for it.
 */
@Injectable()
export class LearningService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly entitlements: EntitlementsService,
  ) {}

  private async access(caller: Caller | null): Promise<(c: GuidedContent) => boolean> {
    const level = caller
      ? (await this.entitlements.resolve(caller.workspaceId, caller.userId)).values[
          'learning.guided_projects'
        ]
      : DEFAULT_PLAN_ENTITLEMENTS.free['learning.guided_projects'];
    return (c) => level === 'all' || c.free;
  }

  async list(caller: Caller | null): Promise<GuidedSummary[]> {
    const open = await this.access(caller);
    return GUIDED_PROJECTS.map((c) => guidedSummary(c, !open(c)));
  }

  /** The full project, or only its summary (`locked`) when the plan does not include it. */
  async get(caller: Caller | null, slug: string): Promise<GuidedProjectResponse> {
    const content = findGuided(slug);
    if (!content) throw new DomainError('not_found');
    const open = await this.access(caller);
    return open(content) ? guidedProject(content) : guidedSummary(content, true);
  }

  async progress(caller: Caller): Promise<GuidedProgress[]> {
    const rows = await withScope(this.database.db, { userId: caller.userId }, (tx) =>
      tx.select().from(guidedProgress).orderBy(asc(guidedProgress.contentVersionId)),
    );
    return rows.map(toProgress);
  }

  /**
   * Records steps completed (added to those already recorded: a step once done stays done, and guest
   * progress merges in) and, once, the completion time.
   */
  async putProgress(
    caller: Caller,
    versionId: string,
    input: PutGuidedProgressInput,
  ): Promise<GuidedProgress> {
    const content = BY_VERSION.get(versionId);
    if (!content) throw new DomainError('not_found');
    if (!(await this.access(caller))(content))
      throw new DomainError('entitlement_required', {
        entitlement: 'learning.guided_projects',
        suggestedPlan: 'maker',
      });
    const ids = new Set(content.steps.map((s) => s.id));
    const unknown = input.completedSteps.find((s) => !ids.has(s));
    if (unknown)
      throw new DomainError('validation_failed', {
        field: 'completedSteps',
        reason: `unknown step '${unknown}'`,
      });

    return withScope(this.database.db, { userId: caller.userId }, async (tx) => {
      const [before] = await tx
        .select()
        .from(guidedProgress)
        .where(eq(guidedProgress.contentVersionId, versionId));
      const steps = content.steps
        .map((s) => s.id)
        .filter((id) => input.completedSteps.includes(id) || before?.completedSteps.includes(id));
      if (input.completed && steps.length < ids.size)
        throw new DomainError('validation_failed', { field: 'completed', reason: 'steps left' });
      const values = {
        workspaceId: caller.workspaceId,
        completedSteps: steps,
        ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
        ...(input.completed && !before?.completedAt ? { completedAt: new Date() } : {}),
      };
      const [row] = await tx
        .insert(guidedProgress)
        .values({ userId: caller.userId, contentVersionId: versionId, ...values })
        .onConflictDoUpdate({
          target: [guidedProgress.userId, guidedProgress.contentVersionId],
          set: { ...values, updatedAt: sql`now()` },
        })
        .returning();
      if (!row) throw new Error('progress upsert returned nothing');
      return toProgress(row);
    });
  }
}
