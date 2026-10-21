import { AUTH_LIMITS, DomainError, type SessionInfo } from '@robosim/shared';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, isNull, ne } from 'drizzle-orm';
import { DATABASE, type Database } from '../../db/client.js';
import { sessions, users } from '../../db/schema.js';
import { withScope, withSystem } from '../../db/scope.js';
import { describeDevice, hashSecret, randomSecret } from './http-identity.js';

const DAY_MS = 86_400_000;
export const SESSION_IDLE_MS = AUTH_LIMITS.sessionIdleDays * DAY_MS;
/** `last_seen_at` / `expires_at` are written at most this often, not on every request. */
const TOUCH_MS = 60_000;

export interface ClientInfo {
  ip: string | null;
  userAgent: string | undefined;
}

export interface ResolvedSession {
  sessionId: string;
  userId: string;
  personalWorkspaceId: string;
}

/** Server-side sessions (API Spec §2, Security §3): opaque cookie secret, SHA-256 stored, 30 days idle. */
@Injectable()
export class SessionsService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async create(
    userId: string,
    client: ClientInfo,
    now = new Date(),
  ): Promise<{ id: string; secret: string }> {
    const secret = randomSecret();
    const [row] = await withSystem(this.database.db, (tx) =>
      tx
        .insert(sessions)
        .values({
          userId,
          tokenHash: hashSecret(secret),
          createdAt: now,
          lastSeenAt: now,
          expiresAt: new Date(now.getTime() + SESSION_IDLE_MS),
          ip: client.ip,
          userAgent: client.userAgent?.slice(0, 512) ?? null,
        })
        .returning({ id: sessions.id }),
    );
    if (!row) throw new DomainError('internal_error');
    return { id: row.id, secret };
  }

  /**
   * The live session for a cookie secret, sliding its idle expiry. A session used from another browser family
   * than the one that created it is revoked (Security §3: binding to UA family), as is one whose user is no
   * longer active.
   */
  async resolve(secret: string, client: ClientInfo, now = new Date()): Promise<ResolvedSession | undefined> {
    return withSystem(this.database.db, async (tx) => {
      const [row] = await tx
        .select({
          sessionId: sessions.id,
          userId: sessions.userId,
          userAgent: sessions.userAgent,
          lastSeenAt: sessions.lastSeenAt,
          personalWorkspaceId: users.personalWorkspaceId,
          status: users.status,
        })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(
          and(
            eq(sessions.tokenHash, hashSecret(secret)),
            isNull(sessions.revokedAt),
            gt(sessions.expiresAt, now),
          ),
        );
      if (!row?.personalWorkspaceId) return undefined;
      const sameBrowser =
        describeDevice(row.userAgent ?? undefined).family === describeDevice(client.userAgent).family;
      if (!sameBrowser || row.status === 'suspended' || row.status === 'deleted') {
        await tx.update(sessions).set({ revokedAt: now }).where(eq(sessions.id, row.sessionId));
        return undefined;
      }
      if (now.getTime() - row.lastSeenAt.getTime() >= TOUCH_MS) {
        await tx
          .update(sessions)
          .set({ lastSeenAt: now, expiresAt: new Date(now.getTime() + SESSION_IDLE_MS), ip: client.ip })
          .where(eq(sessions.id, row.sessionId));
      }
      return { sessionId: row.sessionId, userId: row.userId, personalWorkspaceId: row.personalWorkspaceId };
    });
  }

  async list(
    scope: { userId: string; workspaceId: string },
    currentId: string | undefined,
    now = new Date(),
  ) {
    const rows = await withScope(this.database.db, scope, (tx) =>
      tx
        .select()
        .from(sessions)
        .where(
          and(eq(sessions.userId, scope.userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, now)),
        )
        .orderBy(desc(sessions.lastSeenAt)),
    );
    return rows.map((s): SessionInfo => ({
      id: s.id,
      current: s.id === currentId,
      createdAt: s.createdAt.toISOString(),
      lastSeenAt: s.lastSeenAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      device: describeDevice(s.userAgent ?? undefined).label,
      ip: s.ip,
    }));
  }

  /** Revokes one of the caller's sessions; another user's session id answers `not_found` (RLS hides it). */
  async revoke(
    scope: { userId: string; workspaceId: string },
    sessionId: string,
    now = new Date(),
  ): Promise<void> {
    const revoked = await withScope(this.database.db, scope, (tx) =>
      tx
        .update(sessions)
        .set({ revokedAt: now })
        .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)))
        .returning({ id: sessions.id }),
    );
    if (revoked.length === 0) throw new DomainError('not_found');
  }

  /** Signs the user out everywhere, optionally keeping one session (the one making the request). */
  async revokeAll(userId: string, keep?: string, now = new Date()): Promise<number> {
    const revoked = await withSystem(this.database.db, (tx) =>
      tx
        .update(sessions)
        .set({ revokedAt: now })
        .where(
          and(
            eq(sessions.userId, userId),
            isNull(sessions.revokedAt),
            ...(keep ? [ne(sessions.id, keep)] : []),
          ),
        )
        .returning({ id: sessions.id }),
    );
    return revoked.length;
  }

  async revokeBySecret(secret: string, now = new Date()): Promise<void> {
    await withSystem(this.database.db, (tx) =>
      tx
        .update(sessions)
        .set({ revokedAt: now })
        .where(and(eq(sessions.tokenHash, hashSecret(secret)), isNull(sessions.revokedAt))),
    );
  }
}
