import { DomainError, localeSchema, uuidv7, type AgeBand, type Locale } from '@robosim/shared';
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { DATABASE, type Database } from '../../db/client.js';
import { memberships, users, workspaces } from '../../db/schema.js';
import { withScope } from '../../db/scope.js';
import { AuditService } from '../audit/index.js';
import { OutboxService } from '../outbox/index.js';
import {
  ageBandOn,
  initialStatusFor,
  normalizeEmail,
  normalizePhone,
  tehranToday,
  type SignupSource,
} from './identity-rules.js';

export const createUserSchema = z
  .object({
    email: z.string().optional(),
    phone: z.string().optional(),
    displayName: z.string().trim().min(1).max(80),
    locale: localeSchema.default('en'),
    dateOfBirth: z.string().optional(),
    source: z.enum(['self_signup', 'organization']).default('self_signup'),
  })
  .refine((v) => v.email || v.phone, { message: 'email or phone is required', path: ['email'] });
export type CreateUserInput = z.input<typeof createUserSchema>;

export interface CreatedUser {
  id: string;
  personalWorkspaceId: string;
  ageBand: AgeBand;
  status: 'active' | 'pending_consent';
  locale: Locale;
}

@Injectable()
export class UsersService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Creates a user together with their personal workspace and owner membership in one RLS-scoped transaction:
   * every user always owns exactly one personal workspace (ADR-007).
   */
  async createUser(input: CreateUserInput, now: Date = new Date()): Promise<CreatedUser> {
    const parsed = createUserSchema.safeParse(input);
    if (!parsed.success)
      throw new DomainError('validation_failed', {
        errors: parsed.error.issues.map((i) => i.path.join('.')),
      });
    const data = parsed.data;
    const email = data.email ? normalizeEmail(data.email) : null;
    const phone = data.phone ? normalizePhone(data.phone) : null;
    const ageBand = ageBandOn(data.dateOfBirth, tehranToday(now));
    const status = initialStatusFor(ageBand, data.source as SignupSource);
    const userId = uuidv7();
    const workspaceId = uuidv7();

    try {
      await withScope(this.database.db, { userId, workspaceId }, async (tx) => {
        await tx.insert(users).values({
          id: userId,
          email,
          phone,
          displayName: data.displayName,
          locale: data.locale,
          dateOfBirth: data.dateOfBirth ?? null,
          ageBand,
          status,
        });
        await tx.insert(workspaces).values({
          id: workspaceId,
          kind: 'personal',
          name: data.displayName,
          slug: `personal-${workspaceId}`,
          ownerUserId: userId,
        });
        await tx
          .insert(memberships)
          .values({ workspaceId, userId, role: 'org_owner', status: 'active', joinedAt: now });
        await tx.update(users).set({ personalWorkspaceId: workspaceId }).where(eq(users.id, userId));
        await this.audit.record(tx, {
          actorId: userId,
          actorKind: 'user',
          workspaceId,
          action: 'user.created',
          targetKind: 'user',
          targetId: userId,
          after: { ageBand, status, locale: data.locale, source: data.source },
        });
        await this.outbox.enqueue(tx, {
          aggregateKind: 'user',
          aggregateId: userId,
          type: 'iam.user_created',
          payload: { userId, personalWorkspaceId: workspaceId, ageBand, status, locale: data.locale },
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new DomainError('conflict', { field: email ? 'email' : 'phone' });
      throw error;
    }
    return { id: userId, personalWorkspaceId: workspaceId, ageBand, status, locale: data.locale };
  }
}

function isUniqueViolation(error: unknown): boolean {
  for (let e: unknown = error; e && typeof e === 'object'; e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: unknown }).code === '23505') return true;
  }
  return false;
}
