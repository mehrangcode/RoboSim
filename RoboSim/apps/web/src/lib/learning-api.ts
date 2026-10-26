import {
  guidedProgressSchema,
  guidedProjectSchema,
  guidedSummarySchema,
  type GuidedProgress,
  type GuidedProjectResponse,
  type GuidedSummary,
  type PutGuidedProgressInput,
} from '@robosim/shared';
import { apiGet, apiSend } from './api.js';

const list = (body: unknown): unknown[] => (Array.isArray(body) ? body : []);

/** A locked project comes back as its summary only. */
function response(body: unknown): GuidedProjectResponse {
  const full = guidedProjectSchema.safeParse(body);
  return full.success ? full.data : guidedSummarySchema.parse(body);
}

/** Guided projects and progress (API Spec §4.6); injectable so pages can be tested without HTTP. */
export interface LearningClient {
  /** Catalogue, with `locked` set by the caller's plan (guests: Free). */
  list(): Promise<GuidedSummary[]>;
  /** The full project, or its summary when locked. */
  get(slug: string): Promise<GuidedProjectResponse>;
  /** The signed-in learner's progress. */
  progress(): Promise<GuidedProgress[]>;
  putProgress(contentVersionId: string, input: PutGuidedProgressInput): Promise<GuidedProgress>;
}

export function learningApi(locale: () => string): LearningClient {
  return {
    list: async () =>
      list(await apiGet('/guided-projects', locale())).map((p) => guidedSummarySchema.parse(p)),
    get: async (slug) => response(await apiGet(`/guided-projects/${encodeURIComponent(slug)}`, locale())),
    progress: async () =>
      list(await apiGet('/progress/guided', locale())).map((p) => guidedProgressSchema.parse(p)),
    putProgress: async (id, input) =>
      guidedProgressSchema.parse(
        await apiSend('PUT', `/progress/guided/${encodeURIComponent(id)}`, input, locale()),
      ),
  };
}
