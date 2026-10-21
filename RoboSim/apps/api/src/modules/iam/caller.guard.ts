import { DomainError, isUuid } from '@robosim/shared';
import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { ENV, type Env } from '../../config/env.js';
import { DATABASE, type Database } from '../../db/client.js';
import { users } from '../../db/schema.js';
import { withSystem } from '../../db/scope.js';
import { WorkspacesService } from '../org/index.js';
import { normalizeEmail } from './identity-rules.js';
import { UsersService } from './users.service.js';

/** The authenticated caller of a tenant-scoped request: drives `withScope` and RLS. */
export interface Caller {
  userId: string;
  workspaceId: string;
}

type CallerRequest = FastifyRequest & { caller?: Caller };

/**
 * Resolves the caller for tenant-scoped routes (API Spec §2). Sessions arrive in P2; until then local and test
 * runs act as a development user (`DEV_IDENTITY_EMAIL`, or the `X-Dev-User` header), created on first use with
 * a personal workspace, and every other environment answers `401`. `X-Workspace-Id` picks one of the caller's
 * workspaces (default: personal); membership is checked under RLS.
 */
@Injectable()
export class CallerGuard implements CanActivate {
  private readonly known = new Map<string, { userId: string; personalWorkspaceId: string }>();

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(DATABASE) private readonly database: Database,
    private readonly usersService: UsersService,
    private readonly workspaces: WorkspacesService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<CallerRequest>();
    request.caller = await this.resolve(request);
    return true;
  }

  /** The caller of `request`, for routes that are also open to guests (builds). */
  async resolve(request: FastifyRequest): Promise<Caller> {
    if (!this.env.devIdentity) throw new DomainError('unauthenticated');
    const header = request.headers['x-dev-user'];
    const email = normalizeEmail(typeof header === 'string' && header ? header : this.env.DEV_IDENTITY_EMAIL);
    const user = await this.devUser(email);

    const requested = request.headers['x-workspace-id'];
    let workspaceId = user.personalWorkspaceId;
    if (typeof requested === 'string' && requested && requested !== workspaceId) {
      if (!isUuid(requested)) throw new DomainError('validation_failed', { field: 'X-Workspace-Id' });
      const mine = await this.workspaces.listMine({ userId: user.userId });
      if (!mine.some((w) => w.id === requested)) throw new DomainError('forbidden');
      workspaceId = requested;
    }
    return { userId: user.userId, workspaceId };
  }

  private async devUser(email: string): Promise<{ userId: string; personalWorkspaceId: string }> {
    const cached = this.known.get(email);
    if (cached) return cached;
    const [row] = await withSystem(this.database.db, (tx) =>
      tx
        .select({ userId: users.id, personalWorkspaceId: users.personalWorkspaceId })
        .from(users)
        .where(eq(users.email, email)),
    );
    let user: { userId: string; personalWorkspaceId: string };
    if (row?.personalWorkspaceId) user = { userId: row.userId, personalWorkspaceId: row.personalWorkspaceId };
    else {
      const created = await this.usersService.createUser({
        email,
        displayName: email.split('@')[0] ?? email,
      });
      user = { userId: created.id, personalWorkspaceId: created.personalWorkspaceId };
    }
    this.known.set(email, user);
    return user;
  }
}

/** The caller resolved by {@link CallerGuard}; use only on routes guarded by it. */
export const CallerScope = createParamDecorator((_: unknown, context: ExecutionContext): Caller => {
  const caller = context.switchToHttp().getRequest<CallerRequest>().caller;
  if (!caller) throw new DomainError('unauthenticated');
  return caller;
});
