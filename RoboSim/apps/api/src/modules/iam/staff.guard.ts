import { DomainError, staffCan, type AdminPermission, type StaffRole } from '@robosim/shared';
import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { DATABASE, type Database } from '../../db/client.js';
import { staffRoles } from '../../db/schema.js';
import { withSystem } from '../../db/scope.js';
import { CallerGuard } from './caller.guard.js';

/** A signed-in member of staff (Security §4.4): the user and their platform roles. */
export interface Staff {
  userId: string;
  roles: StaffRole[];
}

type StaffRequest = FastifyRequest & { staff?: Staff };

/**
 * Back-office routes (FR-ADM-01): the same sessions as the product, plus at least one `staff_roles` row.
 * Signed-out callers get `401`, signed-in non-staff `403`. Each route then checks its permission with
 * {@link requireStaff}. TOTP for staff (Security §4.4) arrives with MFA.
 */
@Injectable()
export class StaffGuard implements CanActivate {
  constructor(
    private readonly callers: CallerGuard,
    @Inject(DATABASE) private readonly database: Database,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<StaffRequest>();
    const { userId } = await this.callers.resolve(request);
    const rows = await withSystem(this.database.db, (tx) =>
      tx.select({ role: staffRoles.role }).from(staffRoles).where(eq(staffRoles.userId, userId)),
    );
    if (rows.length === 0) throw new DomainError('forbidden', { need: 'staff' });
    request.staff = { userId, roles: rows.map((r) => r.role) };
    return true;
  }
}

/** The staff member resolved by {@link StaffGuard}. */
export const StaffScope = createParamDecorator((_: unknown, context: ExecutionContext): Staff => {
  const staff = context.switchToHttp().getRequest<StaffRequest>().staff;
  if (!staff) throw new DomainError('unauthenticated');
  return staff;
});

export function requireStaff(staff: Staff, permission: AdminPermission): void {
  if (!staffCan(staff.roles, permission)) throw new DomainError('forbidden', { need: permission });
}
