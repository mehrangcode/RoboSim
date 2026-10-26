import { contentVersionId, guidedStepSchema, type GuidedProject, type GuidedSummary } from '@robosim/shared';
import { lineFollower } from './line-follower.js';
import { obstacleAvoider } from './obstacle-avoider.js';
import type { GuidedContent } from './types.js';

export type { GuidedContent } from './types.js';

/**
 * Built-in guided projects (FR-LRN-01, P2 set), in catalogue order. Kept off the package root so the web
 * bundle never carries paid content: browsers get it from the API, which applies the plan.
 */
export const GUIDED_PROJECTS: readonly GuidedContent[] = [lineFollower, obstacleAvoider];

export const findGuided = (slug: string): GuidedContent | undefined =>
  GUIDED_PROJECTS.find((p) => p.slug === slug);

export function guidedSummary(c: GuidedContent, locked: boolean): GuidedSummary {
  return {
    slug: c.slug,
    version: c.version,
    contentVersionId: contentVersionId(c.slug, c.version),
    title: c.title,
    summary: c.summary,
    minutes: c.minutes,
    free: c.free,
    stepCount: c.steps.length,
    arenaId: c.arenaId,
    cover: c.cover,
    locked,
  };
}

export function guidedProject(c: GuidedContent): GuidedProject {
  return {
    ...guidedSummary(c, false),
    steps: c.steps.map((s) => guidedStepSchema.parse(s)),
    starter: c.starter,
    assets: { ...c.assets },
  };
}
