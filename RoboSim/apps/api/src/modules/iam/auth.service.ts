import {
  AUTH_LIMITS,
  DomainError,
  type ChangePasswordRequest,
  type LoginRequest,
  type Me,
  type PasswordResetConfirm,
  type RegisterRequest,
  type UpdateMeRequest,
} from '@robosim/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { ENV, type Env } from '../../config/env.js';
import { DATABASE, type Database, type Tx } from '../../db/client.js';
import { authTokens, users } from '../../db/schema.js';
import { withScope, withSystem } from '../../db/scope.js';
import { AuditService } from '../audit/index.js';
import type { Caller } from './caller.guard.js';
import {
  passwordChangedMessage,
  passwordResetMessage,
  verifyEmailMessage,
  type MailRecipient,
} from './auth-mail.js';
import { hashSecret, randomSecret } from './http-identity.js';
import { normalizeEmail } from './identity-rules.js';
import { MAILER, type Mailer, type MailMessage } from './mailer.js';
import {
  assertAcceptablePassword,
  decoyHash,
  hashPassword,
  needsRehash,
  verifyPassword,
} from './password.js';
import { SessionsService, type ClientInfo } from './sessions.service.js';
import { UsersService } from './users.service.js';

type UserRow = typeof users.$inferSelect;
type TokenPurpose = 'email_verify' | 'password_reset';

export interface SignedIn {
  me: Me;
  session: { id: string; secret: string };
}

const MINUTE_MS = 60_000;

/**
 * Email + password authentication (FR-IAM-01, FR-IAM-03; Security §3). Sign-in never reveals whether an email
 * is registered: unknown emails spend the same argon2 time and answer the same `invalid_credentials`.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(ENV) private readonly env: Env,
    @Inject(MAILER) private readonly mailer: Mailer,
    private readonly usersService: UsersService,
    private readonly sessions: SessionsService,
    private readonly audit: AuditService,
  ) {}

  async register(body: RegisterRequest, client: ClientInfo, now = new Date()): Promise<SignedIn> {
    const email = normalizeEmail(body.email);
    assertAcceptablePassword(body.password, email);
    const passwordHash = await hashPassword(body.password);
    const created = await this.usersService.createUser(
      {
        email,
        displayName: body.displayName,
        dateOfBirth: body.dateOfBirth,
        locale: body.locale ?? 'en',
        source: 'self_signup',
      },
      now,
      { passwordHash },
    );
    const user = await this.userById(created.id);
    await this.sendVerification(user, now);
    const session = await this.sessions.create(user.id, client, now);
    await this.record(user, 'auth.registered', client);
    return { me: toMe(user), session };
  }

  async login(body: LoginRequest, client: ClientInfo, now = new Date()): Promise<SignedIn> {
    let email: string;
    try {
      email = normalizeEmail(body.email);
    } catch {
      await verifyPassword(body.password, await decoyHash());
      throw new DomainError('invalid_credentials');
    }
    const [user] = await withSystem(this.database.db, (tx) =>
      tx.select().from(users).where(eq(users.email, email)),
    );
    if (!user?.passwordHash || user.status === 'deleted') {
      await verifyPassword(body.password, await decoyHash());
      throw new DomainError('invalid_credentials');
    }
    if (user.lockedUntil && user.lockedUntil > now) {
      throw new DomainError('account_locked', {
        retryAfterSeconds: Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 1000),
      });
    }
    if (!(await verifyPassword(body.password, user.passwordHash))) {
      await this.recordFailure(user, client, now);
      throw new DomainError('invalid_credentials');
    }
    if (user.status === 'suspended') throw new DomainError('forbidden', { reason: 'suspended' });

    const rehash = needsRehash(user.passwordHash) ? await hashPassword(body.password) : undefined;
    await withSystem(this.database.db, (tx) =>
      tx
        .update(users)
        .set({ failedLoginCount: 0, lockedUntil: null, ...(rehash ? { passwordHash: rehash } : {}) })
        .where(eq(users.id, user.id)),
    );
    const session = await this.sessions.create(user.id, client, now);
    await this.record(user, 'auth.login', client);
    return { me: toMe(user), session };
  }

  /** Five consecutive failures lock password sign-in for 15 minutes (Security §3); the count then restarts. */
  private async recordFailure(user: UserRow, client: ClientInfo, now: Date): Promise<void> {
    const failures = user.failedLoginCount + 1;
    const lock = failures >= AUTH_LIMITS.maxFailedLogins;
    await withSystem(this.database.db, async (tx) => {
      await tx
        .update(users)
        .set(
          lock
            ? {
                failedLoginCount: 0,
                lockedUntil: new Date(now.getTime() + AUTH_LIMITS.lockoutMinutes * MINUTE_MS),
              }
            : { failedLoginCount: failures },
        )
        .where(eq(users.id, user.id));
      await this.auditIn(tx, user, lock ? 'auth.locked' : 'auth.login_failed', client, { failures });
    });
  }

  async logout(secret: string | undefined, now = new Date()): Promise<void> {
    if (secret) await this.sessions.revokeBySecret(secret, now);
  }

  async verifyEmail(secret: string, now = new Date()): Promise<void> {
    const token = await this.consume(secret, 'email_verify', now);
    const user = await this.userById(token.userId);
    if (user.email !== token.target) throw new DomainError('gone');
    await withSystem(this.database.db, (tx) =>
      tx.update(users).set({ emailVerifiedAt: now }).where(eq(users.id, user.id)),
    );
    await this.record(user, 'auth.email_verified', { ip: null, userAgent: undefined });
  }

  /** Sends a fresh verification link; earlier links stop working. A verified address is left alone. */
  async resendVerification(caller: Caller, now = new Date()): Promise<void> {
    const user = await this.userById(caller.userId);
    if (user.email && !user.emailVerifiedAt) await this.sendVerification(user, now);
  }

  /** Always succeeds from the client's view, so the endpoint cannot be used to probe for accounts. */
  async requestPasswordReset(rawEmail: string, now = new Date()): Promise<void> {
    let email: string;
    try {
      email = normalizeEmail(rawEmail);
    } catch {
      return;
    }
    const [user] = await withSystem(this.database.db, (tx) =>
      tx.select().from(users).where(eq(users.email, email)),
    );
    if (!user || user.status === 'deleted' || !user.email) return;
    const secret = await this.issue(
      user.id,
      'password_reset',
      user.email,
      AUTH_LIMITS.passwordResetMinutes,
      now,
    );
    const link = `${this.env.PUBLIC_APP_URL}/reset-password?token=${secret}`;
    await this.deliver(await passwordResetMessage(recipient(user), link, AUTH_LIMITS.passwordResetMinutes));
  }

  /**
   * Sets a new password from a reset link. The link proves control of the inbox, so the email counts as
   * verified; every session is signed out and the lockout is cleared.
   */
  async confirmPasswordReset(body: PasswordResetConfirm, now = new Date()): Promise<void> {
    const token = await this.consume(body.token, 'password_reset', now);
    const user = await this.userById(token.userId);
    if (!user.email || user.email !== token.target) throw new DomainError('gone');
    assertAcceptablePassword(body.password, user.email);
    const passwordHash = await hashPassword(body.password);
    await withSystem(this.database.db, async (tx) => {
      await tx
        .update(users)
        .set({
          passwordHash,
          failedLoginCount: 0,
          lockedUntil: null,
          emailVerifiedAt: user.emailVerifiedAt ?? now,
        })
        .where(eq(users.id, user.id));
      await this.auditIn(tx, user, 'auth.password_reset', { ip: null, userAgent: undefined });
    });
    await this.sessions.revokeAll(user.id, undefined, now);
    await this.deliver(await passwordChangedMessage(recipient(user)));
  }

  /** Changes the password and signs out every other session; the current one is replaced (rotation). */
  async changePassword(
    caller: Caller,
    body: ChangePasswordRequest,
    client: ClientInfo,
    now = new Date(),
  ): Promise<{ id: string; secret: string } | undefined> {
    const user = await this.userById(caller.userId);
    if (!user.passwordHash || !(await verifyPassword(body.currentPassword, user.passwordHash)))
      throw new DomainError('invalid_credentials');
    assertAcceptablePassword(body.newPassword, user.email ?? '');
    const passwordHash = await hashPassword(body.newPassword);
    await withSystem(this.database.db, async (tx) => {
      await tx.update(users).set({ passwordHash }).where(eq(users.id, user.id));
      await this.auditIn(tx, user, 'auth.password_changed', client);
    });
    await this.sessions.revokeAll(user.id, undefined, now);
    if (user.email) await this.deliver(await passwordChangedMessage(recipient(user)));
    return caller.sessionId ? this.sessions.create(user.id, client, now) : undefined;
  }

  async me(caller: Caller): Promise<Me> {
    const [user] = await withScope(this.database.db, caller, (tx) =>
      tx.select().from(users).where(eq(users.id, caller.userId)),
    );
    if (!user) throw new DomainError('unauthenticated');
    return toMe(user);
  }

  async updateMe(caller: Caller, patch: UpdateMeRequest): Promise<Me> {
    const [user] = await withScope(this.database.db, caller, (tx) =>
      tx.update(users).set(patch).where(eq(users.id, caller.userId)).returning(),
    );
    if (!user) throw new DomainError('unauthenticated');
    return toMe(user);
  }

  private async sendVerification(user: UserRow, now: Date): Promise<void> {
    if (!user.email) return;
    const secret = await this.issue(
      user.id,
      'email_verify',
      user.email,
      AUTH_LIMITS.emailVerifyHours * 60,
      now,
    );
    const link = `${this.env.PUBLIC_APP_URL}/verify-email?token=${secret}`;
    await this.deliver(await verifyEmailMessage(recipient(user), link, AUTH_LIMITS.emailVerifyHours));
  }

  /** Issues a one-time link secret; any earlier unused token of the same purpose is retired. */
  private async issue(
    userId: string,
    purpose: TokenPurpose,
    target: string,
    ttlMinutes: number,
    now: Date,
  ): Promise<string> {
    const secret = randomSecret();
    await withSystem(this.database.db, async (tx) => {
      await tx
        .update(authTokens)
        .set({ consumedAt: now })
        .where(
          and(eq(authTokens.userId, userId), eq(authTokens.purpose, purpose), isNull(authTokens.consumedAt)),
        );
      await tx.insert(authTokens).values({
        userId,
        purpose,
        target,
        tokenHash: hashSecret(secret),
        createdAt: now,
        expiresAt: new Date(now.getTime() + ttlMinutes * MINUTE_MS),
      });
    });
    return secret;
  }

  /** Marks a token used, atomically: a link works once. Unknown, used and expired links are all `gone`. */
  private async consume(
    secret: string,
    purpose: TokenPurpose,
    now: Date,
  ): Promise<{ userId: string; target: string }> {
    const [row] = await withSystem(this.database.db, (tx) =>
      tx
        .update(authTokens)
        .set({ consumedAt: now })
        .where(
          and(
            eq(authTokens.tokenHash, hashSecret(secret)),
            eq(authTokens.purpose, purpose),
            isNull(authTokens.consumedAt),
            gt(authTokens.expiresAt, now),
          ),
        )
        .returning({ userId: authTokens.userId, target: authTokens.target }),
    );
    if (!row?.userId) throw new DomainError('gone');
    return { userId: row.userId, target: row.target };
  }

  /** Mail failures must not undo a sign-up or reveal anything; they are logged for the operator. */
  private async deliver(message: MailMessage): Promise<void> {
    try {
      await this.mailer.send(message);
    } catch (error) {
      this.logger.error({ err: error }, 'Mail delivery failed');
    }
  }

  private async userById(id: string): Promise<UserRow> {
    const [user] = await withSystem(this.database.db, (tx) =>
      tx.select().from(users).where(eq(users.id, id)),
    );
    if (!user) throw new DomainError('gone');
    return user;
  }

  private record(user: UserRow, action: string, client: ClientInfo): Promise<void> {
    return withSystem(this.database.db, (tx) => this.auditIn(tx, user, action, client));
  }

  private auditIn(tx: Tx, user: UserRow, action: string, client: ClientInfo, after?: unknown): Promise<void> {
    return this.audit.record(tx, {
      actorId: user.id,
      actorKind: 'user',
      workspaceId: user.personalWorkspaceId,
      action,
      targetKind: 'user',
      targetId: user.id,
      after,
      ip: client.ip,
      userAgent: client.userAgent?.slice(0, 512) ?? null,
    });
  }
}

function recipient(user: UserRow): MailRecipient {
  return { email: user.email ?? '', displayName: user.displayName, locale: user.locale };
}

export function toMe(user: UserRow): Me {
  if (!user.personalWorkspaceId) throw new DomainError('internal_error');
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerifiedAt !== null,
    displayName: user.displayName,
    locale: user.locale,
    ageBand: user.ageBand,
    status: user.status,
    personalWorkspaceId: user.personalWorkspaceId,
    createdAt: user.createdAt.toISOString(),
  };
}
