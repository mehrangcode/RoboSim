import {
  parseProjectDocument,
  type Project,
  type ProjectDocument,
  type ProjectListQueryInput,
  type ProjectSummary,
  type ProjectVersion,
} from '@robosim/shared';
import { ApiError } from '../lib/api.js';
import type { ProjectsClient } from '../lib/projects-api.js';

const problem = (code: 'not_found' | 'precondition_failed', status: number) =>
  new ApiError({ type: code, title: code, status, code, requestId: 'test' });

/** In-memory projects API with the server's revision and 412 semantics; every call is recorded. */
export class FakeProjects implements ProjectsClient {
  readonly projects = new Map<string, Project>();
  readonly versionsOf = new Map<string, ProjectVersion[]>();
  readonly calls: { method: string; args: unknown[] }[] = [];
  private seq = 0;
  /** Set to make the next calls fail like a dropped connection. */
  offline = false;

  seed(document: ProjectDocument, over: Partial<Project> = {}): Project {
    const n = ++this.seq;
    const id = over.id ?? `p${n}`;
    const project: Project = {
      id,
      name: document.meta.title,
      boardId: document.board.id,
      language: document.code.language,
      tags: [],
      revision: 1,
      createdAt: new Date(Date.UTC(2026, 9, 21, 9, n)).toISOString(),
      updatedAt: new Date(Date.UTC(2026, 9, 21, 9, n)).toISOString(),
      deletedAt: null,
      document,
      ...over,
    };
    this.projects.set(id, project);
    return project;
  }

  /** Simulates a save from another tab or device. */
  saveElsewhere(id: string, document: ProjectDocument): void {
    const p = this.must(id);
    this.projects.set(id, { ...p, document, name: document.meta.title, revision: p.revision + 1 });
  }

  private record(method: string, ...args: unknown[]) {
    this.calls.push({ method, args });
    if (this.offline) throw new TypeError('Failed to fetch');
  }

  private must(id: string): Project {
    const p = this.projects.get(id);
    if (!p || p.deletedAt) throw problem('not_found', 404);
    return p;
  }

  private check(p: Project, revision: number) {
    if (p.revision !== revision) throw problem('precondition_failed', 412);
  }

  private summary({ document: _, ...s }: Project): ProjectSummary {
    return s;
  }

  async list(query: ProjectListQueryInput) {
    this.record('list', query);
    const trash = query.deleted === 'true';
    const items = [...this.projects.values()]
      .filter((p) => (p.deletedAt !== null) === trash)
      .filter((p) => !query.q || p.name.toLowerCase().includes(query.q.toLowerCase()))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((p) => this.summary(p));
    return Promise.resolve({ items, nextCursor: null });
  }
  async create(input: { name?: string; document: unknown }) {
    this.record('create', input);
    const document = parseProjectDocument(input.document);
    return Promise.resolve(
      this.seed(input.name ? { ...document, meta: { ...document.meta, title: input.name } } : document),
    );
  }
  async get(id: string) {
    this.record('get', id);
    return Promise.resolve(this.must(id));
  }
  async update(id: string, revision: number, input: { name?: string }) {
    this.record('update', id, revision, input);
    const p = this.must(id);
    this.check(p, revision);
    const name = input.name ?? p.name;
    const next = {
      ...p,
      name,
      document: { ...p.document, meta: { ...p.document.meta, title: name } },
      revision: p.revision + 1,
    };
    this.projects.set(id, next);
    return Promise.resolve(next);
  }
  async save(id: string, revision: number, document: ProjectDocument) {
    this.record('save', id, revision, document);
    const p = this.must(id);
    this.check(p, revision);
    const next = { ...p, document, name: document.meta.title, revision: p.revision + 1 };
    this.projects.set(id, next);
    return Promise.resolve(this.summary(next));
  }
  async remove(id: string) {
    this.record('remove', id);
    const p = this.must(id);
    this.projects.set(id, { ...p, deletedAt: new Date().toISOString(), revision: p.revision + 1 });
    return Promise.resolve();
  }
  async restore(id: string) {
    this.record('restore', id);
    const p = this.projects.get(id);
    if (!p?.deletedAt) throw problem('not_found', 404);
    const next = { ...p, deletedAt: null, revision: p.revision + 1 };
    this.projects.set(id, next);
    return Promise.resolve(next);
  }
  async duplicate(id: string) {
    this.record('duplicate', id);
    const p = this.must(id);
    return Promise.resolve(
      this.seed({ ...p.document, meta: { ...p.document.meta, title: `${p.name} (copy)` } }),
    );
  }
  async versions(id: string) {
    this.record('versions', id);
    this.must(id);
    const items = [...(this.versionsOf.get(id) ?? [])].reverse().map(({ document: _, ...v }) => v);
    return Promise.resolve({ items, nextCursor: null });
  }
  async checkpoint(id: string, label: string) {
    this.record('checkpoint', id, label);
    const { document: _, ...v } = this.addVersion(id, label, 'manual');
    return Promise.resolve(v);
  }
  async version(id: string, versionId: string) {
    this.record('version', id, versionId);
    const v = this.versionsOf.get(id)?.find((x) => x.id === versionId);
    if (!v) throw problem('not_found', 404);
    return Promise.resolve(v);
  }
  async restoreVersion(id: string, versionId: string, revision: number) {
    this.record('restoreVersion', id, versionId, revision);
    const p = this.must(id);
    this.check(p, revision);
    const v = this.versionsOf.get(id)?.find((x) => x.id === versionId);
    if (!v) throw problem('not_found', 404);
    const document = { ...v.document, meta: { ...v.document.meta, title: p.name } };
    const next = { ...p, document, revision: p.revision + 1 };
    this.projects.set(id, next);
    this.addVersion(id, `v${v.number}`, 'restore');
    return Promise.resolve(next);
  }

  addVersion(
    id: string,
    label: string | null,
    source: ProjectVersion['source'],
    document?: ProjectDocument,
  ): ProjectVersion {
    const list = this.versionsOf.get(id) ?? [];
    const v: ProjectVersion = {
      id: `${id}-v${list.length + 1}`,
      number: list.length + 1,
      label,
      source,
      artifactId: null,
      documentSha256: 'x',
      createdBy: null,
      createdAt: new Date(Date.UTC(2026, 9, 21, 10, list.length)).toISOString(),
      document: document ?? this.must(id).document,
    };
    this.versionsOf.set(id, [...list, v]);
    return v;
  }
}
