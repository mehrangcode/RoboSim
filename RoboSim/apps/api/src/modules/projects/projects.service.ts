import { createHash } from 'node:crypto';
import {
  DomainError,
  isUuid,
  parseProjectDocument,
  PROJECT_LIMITS,
  ProjectDocumentError,
  type CreateProjectInput,
  type Project,
  type ProjectDocument,
  type ProjectListQuery,
  type ProjectPage,
  type ProjectSummary,
  type ProjectVersion,
  type ProjectVersionSource,
  type ProjectVersionSummary,
  type UpdateProjectInput,
} from '@robosim/shared';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, isNotNull, isNull, lt, sql, type SQL } from 'drizzle-orm';
import { DATABASE, type Database, type Tx } from '../../db/client.js';
import { projects, projectVersions } from '../../db/schema.js';
import { withScope } from '../../db/scope.js';
import { AuditService } from '../audit/index.js';
import type { Caller } from '../iam/index.js';
import { OutboxService } from '../outbox/index.js';

type ProjectRow = typeof projects.$inferSelect;
type VersionRow = typeof projectVersions.$inferSelect;

interface Prepared {
  doc: ProjectDocument;
  sha256: string;
}

const DAY_MS = 86_400_000;

/**
 * Projects (FR-PRJ-01/02/03 thin, API Spec §4.4). Every query runs under the caller's RLS scope, so another
 * workspace's project is indistinguishable from a missing one. Saves overwrite the working document guarded by
 * `revision` (`If-Match`); versions are immutable snapshots numbered per project.
 */
@Injectable()
export class ProjectsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async list(caller: Caller, query: ProjectListQuery): Promise<ProjectPage> {
    const { column, descending } = sortOf(query.sort);
    const where: (SQL | undefined)[] = [
      eq(projects.workspaceId, caller.workspaceId),
      query.deleted ? isNotNull(projects.deletedAt) : isNull(projects.deletedAt),
    ];
    if (query.q) where.push(sql`${projects.name} ilike ${`%${escapeLike(query.q)}%`} escape '\\'`);
    if (query.tag) where.push(sql`${query.tag} = any(${projects.tags})`);
    if (query.cursor) {
      const [value, id] = decodeCursor(query.cursor);
      const key = column === projects.name ? sql`${value}` : sql`${value}::timestamptz`;
      where.push(
        descending
          ? sql`(${column}, ${projects.id}) < (${key}, ${id})`
          : sql`(${column}, ${projects.id}) > (${key}, ${id})`,
      );
    }
    const order = descending ? [desc(column), desc(projects.id)] : [asc(column), asc(projects.id)];
    const rows = await withScope(this.database.db, caller, (tx) =>
      tx
        .select()
        .from(projects)
        .where(and(...where))
        .orderBy(...order)
        .limit(query.limit + 1),
    );
    const items = rows.slice(0, query.limit);
    const last = items.at(-1);
    const more = rows.length > query.limit && last;
    return {
      items: items.map(toSummary),
      nextCursor: more
        ? encodeCursor(column === projects.name ? last.name : stamp(column, last), last.id)
        : null,
    };
  }

  async create(caller: Caller, input: CreateProjectInput & { tags: string[] }): Promise<Project> {
    const prepared = prepare(input.document, input.name);
    const now = new Date();
    const row = await withScope(this.database.db, caller, async (tx) => {
      const [created] = await tx
        .insert(projects)
        .values({
          workspaceId: caller.workspaceId,
          ownerUserId: caller.userId,
          ...columnsOf(prepared),
          tags: input.tags,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!created) throw new Error('insert returned no row');
      await this.recordCreated(tx, caller, created);
      return created;
    });
    return toProject(row);
  }

  async get(caller: Caller, id: string): Promise<Project> {
    return toProject(await withScope(this.database.db, caller, (tx) => this.live(tx, id)));
  }

  async update(
    caller: Caller,
    id: string,
    ifMatch: number | undefined,
    input: UpdateProjectInput,
  ): Promise<Project> {
    return withScope(this.database.db, caller, async (tx) => {
      const current = await this.live(tx, id);
      checkRevision(current, ifMatch);
      const renamed = input.name === undefined ? undefined : prepare(current.document, input.name);
      return toProject(
        await this.write(tx, current, {
          ...(renamed ? columnsOf(renamed) : {}),
          ...(input.tags ? { tags: input.tags } : {}),
        }),
      );
    });
  }

  /** `PUT /projects/:id/document`: validates (and migrates) the document; its `meta.title` names the project. */
  async saveDocument(
    caller: Caller,
    id: string,
    ifMatch: number | undefined,
    document: unknown,
  ): Promise<ProjectSummary> {
    const prepared = prepare(document);
    return withScope(this.database.db, caller, async (tx) => {
      const current = await this.live(tx, id);
      checkRevision(current, ifMatch);
      if (current.documentSha256 === prepared.sha256) return toSummary(current);
      return toSummary(await this.write(tx, current, columnsOf(prepared)));
    });
  }

  /** Soft delete; the project can be restored for {@link PROJECT_LIMITS.trashDays} days. */
  async remove(caller: Caller, id: string, ifMatch: number | undefined): Promise<void> {
    await withScope(this.database.db, caller, async (tx) => {
      const current = await this.live(tx, id);
      if (ifMatch !== undefined) checkRevision(current, ifMatch);
      const now = new Date();
      await this.write(tx, current, { deletedAt: now }, now);
      await this.audit.record(tx, {
        actorId: caller.userId,
        actorKind: 'user',
        workspaceId: caller.workspaceId,
        action: 'project.deleted',
        targetKind: 'project',
        targetId: id,
      });
    });
  }

  async restore(caller: Caller, id: string, now: Date = new Date()): Promise<Project> {
    return withScope(this.database.db, caller, async (tx) => {
      const current = await this.find(tx, id);
      if (
        !current?.deletedAt ||
        now.getTime() - current.deletedAt.getTime() > PROJECT_LIMITS.trashDays * DAY_MS
      )
        throw new DomainError('not_found');
      const restored = await this.write(tx, current, { deletedAt: null }, now);
      await this.audit.record(tx, {
        actorId: caller.userId,
        actorKind: 'user',
        workspaceId: caller.workspaceId,
        action: 'project.restored',
        targetKind: 'project',
        targetId: id,
      });
      return toProject(restored);
    });
  }

  /** A copy of the working document under a new name; versions stay with the original. */
  async duplicate(caller: Caller, id: string, name?: string): Promise<Project> {
    return withScope(this.database.db, caller, async (tx) => {
      const source = await this.live(tx, id);
      const copyName = name ?? `${source.name} (copy)`.slice(0, PROJECT_LIMITS.maxNameLength);
      const prepared = prepare(source.document, copyName);
      const now = new Date();
      const [created] = await tx
        .insert(projects)
        .values({
          workspaceId: caller.workspaceId,
          ownerUserId: caller.userId,
          ...columnsOf(prepared),
          tags: source.tags,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!created) throw new Error('insert returned no row');
      await this.recordCreated(tx, caller, created, id);
      return toProject(created);
    });
  }

  async listVersions(
    caller: Caller,
    id: string,
    limit: number = PROJECT_LIMITS.maxListLimit,
    cursor?: string,
  ): Promise<{ items: ProjectVersionSummary[]; nextCursor: string | null }> {
    const before = cursor === undefined ? undefined : Number(cursor);
    if (before !== undefined && !Number.isInteger(before))
      throw new DomainError('validation_failed', { field: 'cursor' });
    const rows = await withScope(this.database.db, caller, async (tx) => {
      await this.live(tx, id);
      return tx
        .select()
        .from(projectVersions)
        .where(
          and(
            eq(projectVersions.projectId, id),
            before === undefined ? undefined : lt(projectVersions.number, before),
          ),
        )
        .orderBy(desc(projectVersions.number))
        .limit(limit + 1);
    });
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return {
      items: items.map(toVersionSummary),
      nextCursor: rows.length > limit && last ? String(last.number) : null,
    };
  }

  async getVersion(caller: Caller, id: string, versionId: string): Promise<ProjectVersion> {
    return withScope(this.database.db, caller, async (tx) =>
      toVersion(await this.version(tx, id, versionId)),
    );
  }

  /** Named checkpoint of the current working document. */
  async createVersion(caller: Caller, id: string, label: string): Promise<ProjectVersionSummary> {
    return withScope(this.database.db, caller, async (tx) => {
      const current = await this.live(tx, id, true);
      return toVersionSummary(await this.snapshot(tx, caller, current, 'manual', { label }));
    });
  }

  /** Copies a version into the working document and records that as a new `restore` version. */
  async restoreVersion(
    caller: Caller,
    id: string,
    versionId: string,
    ifMatch: number | undefined,
  ): Promise<Project> {
    return withScope(this.database.db, caller, async (tx) => {
      const current = await this.live(tx, id, true);
      checkRevision(current, ifMatch);
      const version = await this.version(tx, id, versionId);
      const prepared = prepare(version.document, current.name);
      const restored =
        current.documentSha256 === prepared.sha256
          ? current
          : await this.write(tx, current, columnsOf(prepared));
      await this.snapshot(tx, caller, restored, 'restore', { label: `v${version.number}`, force: true });
      await this.audit.record(tx, {
        actorId: caller.userId,
        actorKind: 'user',
        workspaceId: caller.workspaceId,
        action: 'project.version_restored',
        targetKind: 'project',
        targetId: id,
        after: { versionNumber: version.number },
      });
      return toProject(restored);
    });
  }

  /**
   * Automatic snapshot after a successful build (FR-PRJ-03), taken only when the built sources are exactly the
   * saved document's code, so the version and its firmware match. Never throws: a build result must not fail
   * because of bookkeeping. Returns whether the built document now has a version.
   */
  async snapshotBuild(
    caller: Caller,
    id: string,
    files: readonly { name: string; content: string }[],
    artifactId: string,
  ): Promise<boolean> {
    try {
      return await withScope(this.database.db, caller, async (tx) => {
        const current = await this.find(tx, id, true);
        if (!current || current.deletedAt) return false;
        const code = (current.document as ProjectDocument).code.files;
        const same =
          code.length === files.length &&
          code.every((f) => files.some((g) => g.name === f.name && g.content === f.content));
        if (!same) return false;
        return (await this.snapshot(tx, caller, current, 'auto_build', { artifactId })) !== undefined;
      });
    } catch {
      return false;
    }
  }

  private async snapshot(
    tx: Tx,
    caller: Caller,
    project: ProjectRow,
    source: ProjectVersionSource,
    opts: { label?: string; artifactId?: string; force?: boolean },
  ): Promise<VersionRow> {
    const [latest] = await tx
      .select()
      .from(projectVersions)
      .where(eq(projectVersions.projectId, project.id))
      .orderBy(desc(projectVersions.number))
      .limit(1);
    // Rebuilding unchanged sources does not pile up identical automatic versions.
    if (source === 'auto_build' && latest?.documentSha256 === project.documentSha256) return latest;
    const [{ count } = { count: 0 }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(projectVersions)
      .where(eq(projectVersions.projectId, project.id));
    if (count >= PROJECT_LIMITS.maxVersionsPerProject && !opts.force)
      throw new DomainError('quota_exceeded', { limit: PROJECT_LIMITS.maxVersionsPerProject });
    const [inserted] = await tx
      .insert(projectVersions)
      .values({
        projectId: project.id,
        workspaceId: project.workspaceId,
        number: (latest?.number ?? 0) + 1,
        label: opts.label ?? null,
        source,
        document: project.document,
        documentSha256: project.documentSha256,
        artifactId: opts.artifactId ?? null,
        createdBy: caller.userId,
        createdAt: new Date(),
      })
      .returning();
    if (!inserted) throw new Error('insert returned no row');
    return inserted;
  }

  /** Bumps `revision` (the ETag) with every change. */
  private async write(
    tx: Tx,
    current: ProjectRow,
    changes: Partial<typeof projects.$inferInsert>,
    now: Date = new Date(),
  ): Promise<ProjectRow> {
    const [row] = await tx
      .update(projects)
      .set({ ...changes, revision: current.revision + 1, updatedAt: now })
      .where(and(eq(projects.id, current.id), eq(projects.revision, current.revision)))
      .returning();
    if (!row) throw new DomainError('precondition_failed', { revision: current.revision });
    return row;
  }

  private async find(tx: Tx, id: string, lock = false): Promise<ProjectRow | undefined> {
    if (!isUuid(id)) return undefined;
    const query = tx.select().from(projects).where(eq(projects.id, id));
    const [row] = await (lock ? query.for('update') : query);
    return row;
  }

  private async live(tx: Tx, id: string, lock = false): Promise<ProjectRow> {
    const row = await this.find(tx, id, lock);
    if (!row || row.deletedAt) throw new DomainError('not_found');
    return row;
  }

  private async version(tx: Tx, id: string, versionId: string): Promise<VersionRow> {
    await this.live(tx, id);
    if (!isUuid(versionId)) throw new DomainError('not_found');
    const [row] = await tx
      .select()
      .from(projectVersions)
      .where(and(eq(projectVersions.id, versionId), eq(projectVersions.projectId, id)));
    if (!row) throw new DomainError('not_found');
    return row;
  }

  private async recordCreated(
    tx: Tx,
    caller: Caller,
    project: ProjectRow,
    duplicateOf?: string,
  ): Promise<void> {
    await this.audit.record(tx, {
      actorId: caller.userId,
      actorKind: 'user',
      workspaceId: caller.workspaceId,
      action: 'project.created',
      targetKind: 'project',
      targetId: project.id,
      after: { name: project.name, ...(duplicateOf ? { duplicateOf } : {}) },
    });
    await this.outbox.enqueue(tx, {
      aggregateKind: 'project',
      aggregateId: project.id,
      type: 'prj.project_created',
      payload: { projectId: project.id, workspaceId: project.workspaceId, ownerUserId: project.ownerUserId },
    });
  }
}

/** Validates, migrates and sizes a document; `name` (when given) becomes its `meta.title`. */
export function prepare(input: unknown, name?: string): Prepared {
  let doc: ProjectDocument;
  try {
    doc = parseProjectDocument(input);
  } catch (e) {
    if (e instanceof ProjectDocumentError)
      throw new DomainError('validation_failed', {
        errors: e.issues.map((issue) => {
          const at = issue.indexOf(': ');
          return at < 0
            ? { path: '', message: issue }
            : { path: issue.slice(0, at), message: issue.slice(at + 2) };
        }),
      });
    throw e;
  }
  if (name !== undefined) doc = { ...doc, meta: { ...doc.meta, title: name } };
  const json = JSON.stringify(doc);
  if (Buffer.byteLength(json, 'utf8') > PROJECT_LIMITS.maxDocumentBytes)
    throw new DomainError('payload_too_large', { limit: PROJECT_LIMITS.maxDocumentBytes });
  return { doc, sha256: createHash('sha256').update(json).digest('hex') };
}

function columnsOf(p: Prepared) {
  return {
    name: p.doc.meta.title,
    boardId: p.doc.board.id,
    language: p.doc.code.language,
    schemaVersion: p.doc.schemaVersion,
    document: p.doc,
    documentSha256: p.sha256,
  };
}

function checkRevision(current: ProjectRow, ifMatch: number | undefined): void {
  if (ifMatch === undefined) throw new DomainError('precondition_failed', { reason: 'if_match_required' });
  if (ifMatch !== current.revision)
    throw new DomainError('precondition_failed', { revision: current.revision });
}

function sortOf(sort: ProjectListQuery['sort']) {
  const descending = sort.startsWith('-');
  const field = descending ? sort.slice(1) : sort;
  const column =
    field === 'name' ? projects.name : field === 'createdAt' ? projects.createdAt : projects.updatedAt;
  return { column, descending };
}

function stamp(column: unknown, row: ProjectRow): string {
  return (column === projects.createdAt ? row.createdAt : row.updatedAt).toISOString();
}

function encodeCursor(value: string, id: string): string {
  return Buffer.from(JSON.stringify([value, id])).toString('base64url');
}

function decodeCursor(cursor: string): [string, string] {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(parsed) && parsed.length === 2) {
      const [value, id]: unknown[] = parsed;
      if (typeof value === 'string' && typeof id === 'string' && isUuid(id)) return [value, id];
    }
  } catch {
    // fall through
  }
  throw new DomainError('validation_failed', { field: 'cursor' });
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function toSummary(row: ProjectRow): ProjectSummary {
  return {
    id: row.id,
    name: row.name,
    boardId: row.boardId,
    language: row.language,
    tags: row.tags,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
  };
}

function toProject(row: ProjectRow): Project {
  return { ...toSummary(row), document: row.document as ProjectDocument };
}

function toVersionSummary(row: VersionRow): ProjectVersionSummary {
  return {
    id: row.id,
    number: row.number,
    label: row.label,
    source: row.source,
    artifactId: row.artifactId,
    documentSha256: row.documentSha256,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

function toVersion(row: VersionRow): ProjectVersion {
  return { ...toVersionSummary(row), document: row.document as ProjectDocument };
}
