import { createHmac, randomBytes } from 'node:crypto';
import {
  DomainError,
  isUuid,
  SHARE_LIMITS,
  type Locale,
  type Project,
  type ProjectDocument,
  type ProjectSharing,
  type QuotaLimit,
  type ShareLinkRequest,
  type ShareRequest,
  type SharedLink,
  type SharedProject,
} from '@robosim/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { i18nFor } from '../../common/i18n.js';
import { ENV, type Env } from '../../config/env.js';
import { DATABASE, type Database, type Tx } from '../../db/client.js';
import { projects, projectShares, users } from '../../db/schema.js';
import { withScope, withSystem } from '../../db/scope.js';
import { AuditService } from '../audit/index.js';
import { hashSecret, MAILER, normalizeEmail, type Caller, type Mailer } from '../iam/index.js';
import { beyondCap, ProjectLimits } from './project-limits.service.js';
import { ProjectsService, remixedFromOf } from './projects.service.js';

type ProjectRow = typeof projects.$inferSelect;
interface Collected {
  row: ProjectRow;
  shares: { userId: string; role: 'view' | 'comment' | 'edit' }[];
}

/**
 * Sharing (FR-PRJ-04, US-PRJ-03; API Spec §4.4). People shares live in `project_shares` under RLS. A share
 * link's token is HMAC(SHARE_LINK_SECRET, id.nonce): the owner can be shown it again, the database holds only
 * its SHA-256, and a new nonce retires it. Sharing changes do not bump the project revision, so an open editor
 * keeps saving.
 */
@Injectable()
export class SharingService {
  private readonly logger = new Logger(SharingService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(ENV) private readonly env: Env,
    @Inject(MAILER) private readonly mailer: Mailer,
    private readonly projectsService: ProjectsService,
    private readonly limits: ProjectLimits,
    private readonly audit: AuditService,
  ) {}

  async sharing(caller: Caller, id: string): Promise<ProjectSharing> {
    return this.describe(
      await withScope(this.database.db, caller, async (tx) =>
        this.collect(tx, await this.owned(tx, caller, id)),
      ),
    );
  }

  /** Shares with an existing account, or changes its role; the recipient is told by email the first time. */
  async share(caller: Caller, id: string, body: ShareRequest): Promise<ProjectSharing> {
    const email = normalizeEmail(body.email);
    const [recipient] = await withSystem(this.database.db, (tx) =>
      tx
        .select({ id: users.id, displayName: users.displayName, locale: users.locale, status: users.status })
        .from(users)
        .where(eq(users.email, email)),
    );
    if (!recipient || recipient.status === 'deleted') throw new DomainError('not_found', { field: 'email' });
    if (recipient.id === caller.userId)
      throw new DomainError('validation_failed', { errors: [{ path: 'email', message: 'self' }] });

    const { result, added, project } = await withScope(this.database.db, caller, async (tx) => {
      const row = await this.owned(tx, caller, id);
      const [existing] = await tx
        .select({ role: projectShares.role })
        .from(projectShares)
        .where(this.shareOf(row.id, recipient.id));
      if (!existing) {
        const [{ count } = { count: 0 }] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(projectShares)
          .where(eq(projectShares.projectId, row.id));
        if (count >= SHARE_LIMITS.maxSharesPerProject)
          throw new DomainError('quota_exceeded', { limit: SHARE_LIMITS.maxSharesPerProject });
        await tx.insert(projectShares).values({
          projectId: row.id,
          principalKind: 'user',
          principalId: recipient.id,
          role: body.role,
          workspaceId: row.workspaceId,
          createdBy: caller.userId,
        });
      } else if (existing.role !== body.role) {
        await tx.update(projectShares).set({ role: body.role }).where(this.shareOf(row.id, recipient.id));
      }
      await this.record(tx, caller, row.id, existing ? 'project.share_changed' : 'project.shared', {
        userId: recipient.id,
        role: body.role,
      });
      return { result: await this.collect(tx, row), added: !existing, project: row };
    });
    if (added) await this.notify(caller, project, { email, ...recipient }, body.role);
    return this.describe(result);
  }

  /** The owner removes someone, or a sharee leaves (RLS allows both, nobody else). */
  async unshare(caller: Caller, id: string, userId: string): Promise<void> {
    if (!isUuid(id) || !isUuid(userId)) throw new DomainError('not_found');
    await withScope(this.database.db, caller, async (tx) => {
      const removed = await tx
        .delete(projectShares)
        .where(this.shareOf(id, userId))
        .returning({ projectId: projectShares.projectId });
      if (removed.length === 0) throw new DomainError('not_found');
      await this.record(
        tx,
        caller,
        id,
        userId === caller.userId ? 'project.share_left' : 'project.unshared',
        {
          userId,
        },
      );
    });
  }

  /** Turns the link on (or updates it). The same link is kept unless `regenerate` asks for a new one. */
  async setLink(caller: Caller, id: string, body: ShareLinkRequest): Promise<ProjectSharing> {
    const collected = await withScope(this.database.db, caller, async (tx) => {
      const row = await this.owned(tx, caller, id);
      const nonce =
        row.shareLinkNonce && !body.regenerate ? row.shareLinkNonce : randomBytes(16).toString('base64url');
      const [updated] = await tx
        .update(projects)
        .set({
          visibility: 'link',
          shareLinkNonce: nonce,
          shareTokenHash: hashSecret(this.token(row.id, nonce)),
          linkRemixable: body.remixable,
        })
        .where(eq(projects.id, row.id))
        .returning();
      if (!updated) throw new DomainError('not_found');
      const action = !row.shareLinkNonce
        ? 'project.link_enabled'
        : body.regenerate
          ? 'project.link_regenerated'
          : 'project.link_changed';
      await this.record(tx, caller, row.id, action, { remixable: body.remixable });
      return this.collect(tx, updated);
    });
    return this.describe(collected);
  }

  async removeLink(caller: Caller, id: string): Promise<ProjectSharing> {
    const collected = await withScope(this.database.db, caller, async (tx) => {
      const row = await this.owned(tx, caller, id);
      const [updated] = await tx
        .update(projects)
        .set({ visibility: 'private', shareLinkNonce: null, shareTokenHash: null, linkRemixable: false })
        .where(eq(projects.id, row.id))
        .returning();
      if (!updated) throw new DomainError('not_found');
      if (row.shareLinkNonce) await this.record(tx, caller, row.id, 'project.link_disabled');
      return this.collect(tx, updated);
    });
    return this.describe(collected);
  }

  /** Projects other people shared with the caller, most recently changed first. */
  async sharedWithMe(caller: Caller): Promise<SharedProject[]> {
    const rows = await withScope(this.database.db, caller, (tx) =>
      tx
        .select({
          project: projects,
          role: projectShares.role,
          rank: sql<number>`app_project_rank(${projects.id})`,
        })
        .from(projectShares)
        .innerJoin(projects, eq(projects.id, projectShares.projectId))
        .where(
          and(
            eq(projectShares.principalKind, 'user'),
            eq(projectShares.principalId, caller.userId),
            isNull(projects.deletedAt),
          ),
        )
        .orderBy(desc(projects.updatedAt))
        .limit(SHARE_LIMITS.maxSharedList),
    );
    const names = await this.namesOf(rows.map((r) => r.project.ownerUserId));
    // Each owner's cap decides which of their projects are read-only (entitlements are cached).
    const caps = new Map<string, QuotaLimit>();
    for (const { project } of rows)
      caps.set(project.workspaceId, (await this.limits.rules(project.workspaceId, project.ownerUserId)).cap);
    return rows.map(({ project, role, rank }) => ({
      id: project.id,
      name: project.name,
      boardId: project.boardId,
      language: project.language,
      tags: project.tags,
      revision: project.revision,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
      deletedAt: null,
      locked: beyondCap(caps.get(project.workspaceId) ?? null, rank),
      role: role === 'edit' ? 'edit' : 'view',
      ownerName: names.get(project.ownerUserId) ?? '',
    }));
  }

  /** `GET /shared/:token` (public): the project behind a live link. Unknown and retired links look the same. */
  async open(token: string): Promise<SharedLink> {
    const row = await this.byToken(token);
    return {
      project: {
        id: row.id,
        name: row.name,
        updatedAt: row.updatedAt.toISOString(),
        document: row.document as ProjectDocument,
        remixedFrom: remixedFromOf(row),
      },
      ownerName: await this.projectsService.ownerName(row),
      remixable: row.linkRemixable,
    };
  }

  /** Copies a remixable linked project into the caller's workspace with attribution (US-PRJ-03 AC1). */
  async remix(caller: Caller, token: string): Promise<Project> {
    const row = await this.byToken(token);
    if (!row.linkRemixable) throw new DomainError('forbidden', { reason: 'not_remixable' });
    const author = await this.projectsService.ownerName(row);
    return this.projectsService.createCopy(
      caller,
      { document: row.document, name: row.name, tags: [] },
      row.workspaceId === caller.workspaceId ? null : { projectId: row.id, name: row.name, author },
      row.id,
    );
  }

  private async byToken(token: string): Promise<ProjectRow> {
    const [row] = await withSystem(this.database.db, (tx) =>
      tx
        .select()
        .from(projects)
        .where(
          and(
            eq(projects.shareTokenHash, hashSecret(token)),
            eq(projects.visibility, 'link'),
            isNull(projects.deletedAt),
          ),
        ),
    );
    if (!row) throw new DomainError('not_found');
    return row;
  }

  /** The project, if it is in the caller's own workspace; sharees and strangers get `forbidden` / `not_found`. */
  private async owned(tx: Tx, caller: Caller, id: string): Promise<ProjectRow> {
    if (!isUuid(id)) throw new DomainError('not_found');
    const [row] = await tx.select().from(projects).where(eq(projects.id, id));
    if (!row || row.deletedAt) throw new DomainError('not_found');
    if (row.workspaceId !== caller.workspaceId) throw new DomainError('forbidden', { need: 'owner' });
    return row;
  }

  /** The project's shares, read inside the caller's transaction. */
  private async collect(tx: Tx, row: ProjectRow): Promise<Collected> {
    const shares = await tx
      .select({ userId: projectShares.principalId, role: projectShares.role })
      .from(projectShares)
      .where(and(eq(projectShares.projectId, row.id), eq(projectShares.principalKind, 'user')))
      .orderBy(projectShares.createdAt);
    return { row, shares };
  }

  /** Adds names and emails after the transaction: they need a system read (one connection at a time). */
  private async describe({ row, shares }: Collected): Promise<ProjectSharing> {
    const people = await this.peopleOf(shares.map((s) => s.userId));
    return {
      link: row.shareLinkNonce
        ? {
            url: `${this.env.PUBLIC_APP_URL}/s/${this.token(row.id, row.shareLinkNonce)}`,
            remixable: row.linkRemixable,
          }
        : null,
      people: shares.map((s) => ({
        userId: s.userId,
        email: people.get(s.userId)?.email ?? null,
        displayName: people.get(s.userId)?.displayName ?? '',
        role: s.role === 'edit' ? 'edit' : 'view',
      })),
    };
  }

  private token(projectId: string, nonce: string): string {
    return createHmac('sha256', this.env.SHARE_LINK_SECRET)
      .update(`${projectId}.${nonce}`)
      .digest('base64url');
  }

  private shareOf(projectId: string, userId: string) {
    return and(
      eq(projectShares.projectId, projectId),
      eq(projectShares.principalKind, 'user'),
      eq(projectShares.principalId, userId),
    );
  }

  /** Names and emails of sharees: users outside the owner's workspace are invisible under RLS, so a system read. */
  private async peopleOf(ids: string[]): Promise<Map<string, { email: string | null; displayName: string }>> {
    if (ids.length === 0) return new Map();
    const rows = await withSystem(this.database.db, (tx) =>
      tx
        .select({ id: users.id, email: users.email, displayName: users.displayName })
        .from(users)
        .where(inArray(users.id, ids)),
    );
    return new Map(rows.map((r) => [r.id, r]));
  }

  private async namesOf(ids: string[]): Promise<Map<string, string>> {
    const people = await this.peopleOf([...new Set(ids)]);
    return new Map([...people].map(([id, p]) => [id, p.displayName]));
  }

  private record(tx: Tx, caller: Caller, projectId: string, action: string, after?: unknown): Promise<void> {
    return this.audit.record(tx, {
      actorId: caller.userId,
      actorKind: 'user',
      workspaceId: caller.workspaceId,
      action,
      targetKind: 'project',
      targetId: projectId,
      after,
    });
  }

  /** A failed email must not undo the share; the recipient still finds it under "Shared with me". */
  private async notify(
    caller: Caller,
    project: ProjectRow,
    to: { email: string; displayName: string; locale: Locale },
    role: 'view' | 'edit',
  ): Promise<void> {
    try {
      const { t } = await i18nFor(to.locale);
      const sharer = await this.projectsService.ownerName({ ownerUserId: caller.userId });
      const link = `${this.env.PUBLIC_APP_URL}/editor/${project.id}`;
      const roleText = role === 'edit' ? t('share:role.edit') : t('share:role.view');
      await this.mailer.send({
        to: to.email,
        subject: t('share:mail.subject', { sharer, project: project.name }),
        text: t('share:mail.body', {
          name: to.displayName,
          sharer,
          project: project.name,
          role: roleText,
          link,
        }),
        link,
      });
    } catch (error) {
      this.logger.error({ err: error }, 'Share notification failed');
    }
  }
}
