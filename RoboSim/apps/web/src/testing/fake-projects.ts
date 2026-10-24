import {
  parseProjectDocument,
  type Project,
  type ProjectDocument,
  type ProjectListQueryInput,
  type ProjectSharing,
  type ShareLinkRequest,
  type ShareRequest,
  type SharedLink,
  type SharedProject,
  type ProjectSummary,
  type ProjectVersion,
} from '@robosim/shared';
import { ApiError } from '../lib/api.js';
import type { ProjectsClient } from '../lib/projects-api.js';

const problem = (
  code: 'not_found' | 'precondition_failed' | 'forbidden',
  status: number,
  params?: Record<string, unknown>,
) =>
  new ApiError({ type: code, title: code, status, code, requestId: 'test', ...(params ? { params } : {}) });

/** In-memory projects API with the server's revision and 412 semantics; every call is recorded. */
export class FakeProjects implements ProjectsClient {
  readonly projects = new Map<string, Project>();
  readonly versionsOf = new Map<string, ProjectVersion[]>();
  readonly calls: { method: string; args: unknown[] }[] = [];
  private seq = 0;
  /** Set to make the next calls fail like a dropped connection. */
  offline = false;
  /** Calls the server refuses (e.g. a plan limit), by method, until removed. */
  readonly refusals = new Map<string, ApiError>();

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
      locked: false,
      document,
      access: 'owner',
      ownerName: 'Sara',
      remixedFrom: null,
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
    const refusal = this.refusals.get(method);
    if (refusal) throw refusal;
  }

  private must(id: string): Project {
    const p = this.projects.get(id);
    if (!p || p.deletedAt) throw problem('not_found', 404);
    return p;
  }

  private check(p: Project, revision: number) {
    if (p.revision !== revision) throw problem('precondition_failed', 412);
  }

  private summary({
    document: _,
    access: _a,
    ownerName: _o,
    remixedFrom: _r,
    ...s
  }: Project): ProjectSummary {
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

  readonly sharingOf = new Map<string, ProjectSharing>();
  shared: SharedProject[] = [];
  /** Share links: token → project id and whether remixes are allowed. */
  readonly links = new Map<string, { id: string; remixable: boolean }>();

  private sharingFor(id: string): ProjectSharing {
    return this.sharingOf.get(id) ?? { link: null, people: [] };
  }

  async sharing(id: string) {
    this.record('sharing', id);
    this.must(id);
    return Promise.resolve(this.sharingFor(id));
  }
  async share(id: string, input: ShareRequest) {
    this.record('share', id, input);
    if (input.email.startsWith('ghost')) throw problem('not_found', 404, { field: 'email' });
    const current = this.sharingFor(id);
    const people = current.people.filter((p) => p.email !== input.email);
    const next = {
      ...current,
      people: [
        ...people,
        {
          userId: `u-${input.email}`,
          email: input.email,
          displayName: input.email.split('@')[0] ?? '',
          role: input.role,
        },
      ],
    };
    this.sharingOf.set(id, next);
    return Promise.resolve(next);
  }
  async unshare(id: string, userId: string) {
    this.record('unshare', id, userId);
    const current = this.sharingFor(id);
    this.sharingOf.set(id, { ...current, people: current.people.filter((p) => p.userId !== userId) });
    this.shared = this.shared.filter((p) => p.id !== id);
    return Promise.resolve();
  }
  async setLink(id: string, input: ShareLinkRequest) {
    this.record('setLink', id, input);
    const current = this.sharingFor(id);
    const token =
      current.link && !input.regenerate
        ? (current.link.url.split('/s/')[1] ?? '')
        : `t${id}${this.calls.length}`.padEnd(43, 'x');
    this.links.set(token, { id, remixable: input.remixable });
    const next = {
      ...current,
      link: { url: `http://localhost:5173/s/${token}`, remixable: input.remixable },
    };
    this.sharingOf.set(id, next);
    return Promise.resolve(next);
  }
  async removeLink(id: string) {
    this.record('removeLink', id);
    const next = { ...this.sharingFor(id), link: null };
    this.sharingOf.set(id, next);
    return Promise.resolve(next);
  }
  async sharedWithMe() {
    this.record('sharedWithMe');
    return Promise.resolve(this.shared);
  }
  async openShared(token: string): Promise<SharedLink> {
    this.record('openShared', token);
    const link = this.links.get(token);
    if (!link) throw problem('not_found', 404);
    const p = this.must(link.id);
    return Promise.resolve({
      project: {
        id: p.id,
        name: p.name,
        updatedAt: p.updatedAt,
        document: p.document,
        remixedFrom: p.remixedFrom,
      },
      ownerName: p.ownerName,
      remixable: link.remixable,
    });
  }
  async remixShared(token: string) {
    this.record('remixShared', token);
    const link = this.links.get(token);
    if (!link) throw problem('not_found', 404);
    if (!link.remixable) throw problem('forbidden', 403);
    const p = this.must(link.id);
    return Promise.resolve(
      this.seed(p.document, {
        remixedFrom: { projectId: p.id, name: p.name, author: p.ownerName },
        ownerName: 'Me',
      }),
    );
  }
}
