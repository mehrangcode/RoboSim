import {
  projectEtag,
  type CreateProjectInput,
  type Project,
  type ProjectDocument,
  type ProjectListQueryInput,
  type ProjectPage,
  type ProjectSummary,
  type ProjectVersion,
  type ProjectVersionSummary,
  type UpdateProjectInput,
} from '@robosim/shared';
import { apiGet, apiSend } from './api.js';

/** The projects API (API Spec §4.4) as the web app uses it; injectable so pages can be tested without HTTP. */
export interface ProjectsClient {
  list(query: ProjectListQueryInput): Promise<ProjectPage>;
  create(input: CreateProjectInput): Promise<Project>;
  get(id: string): Promise<Project>;
  update(id: string, revision: number, input: UpdateProjectInput): Promise<Project>;
  save(id: string, revision: number, document: ProjectDocument): Promise<ProjectSummary>;
  remove(id: string): Promise<void>;
  restore(id: string): Promise<Project>;
  duplicate(id: string): Promise<Project>;
  versions(id: string): Promise<{ items: ProjectVersionSummary[]; nextCursor: string | null }>;
  checkpoint(id: string, label: string): Promise<ProjectVersionSummary>;
  version(id: string, versionId: string): Promise<ProjectVersion>;
  restoreVersion(id: string, versionId: string, revision: number): Promise<Project>;
}

const ifMatch = (revision: number) => ({ 'If-Match': projectEtag(revision) });

/** `locale` may be a getter, so one client follows language switches. */
export function projectsApi(locale: string | (() => string)): ProjectsClient {
  const lang = typeof locale === 'function' ? locale : () => locale;
  const p = (id: string) => `/projects/${encodeURIComponent(id)}`;
  return {
    list: (query) => {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') params.set(k, String(v));
      const qs = params.toString();
      return apiGet(`/projects${qs ? `?${qs}` : ''}`, lang());
    },
    create: (input) => apiSend('POST', '/projects', input, lang()),
    get: (id) => apiGet(p(id), lang()),
    update: (id, revision, input) => apiSend('PATCH', p(id), input, lang(), ifMatch(revision)),
    save: (id, revision, document) =>
      apiSend('PUT', `${p(id)}/document`, document, lang(), ifMatch(revision)),
    remove: (id) => apiSend('DELETE', p(id), undefined, lang()),
    restore: (id) => apiSend('POST', `${p(id)}/restore`, undefined, lang()),
    duplicate: (id) => apiSend('POST', `${p(id)}/duplicate`, undefined, lang()),
    versions: (id) => apiGet(`${p(id)}/versions`, lang()),
    checkpoint: (id, label) => apiSend('POST', `${p(id)}/versions`, { label }, lang()),
    version: (id, versionId) => apiGet(`${p(id)}/versions/${encodeURIComponent(versionId)}`, lang()),
    restoreVersion: (id, versionId, revision) =>
      apiSend(
        'POST',
        `${p(id)}/versions/${encodeURIComponent(versionId)}/restore`,
        undefined,
        lang(),
        ifMatch(revision),
      ),
  };
}
