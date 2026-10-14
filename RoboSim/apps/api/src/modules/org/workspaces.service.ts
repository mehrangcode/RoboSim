import { DomainError } from '@robosim/shared';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { DATABASE, type Database } from '../../db/client.js';
import { memberships, workspaces } from '../../db/schema.js';
import { withScope, type Scope } from '../../db/scope.js';

export interface WorkspaceSummary {
  id: string;
  kind: 'personal' | 'organization' | 'branch';
  name: string;
  slug: string;
  role: string;
}

@Injectable()
export class WorkspacesService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  /** Workspaces the caller is an active member of (header workspace switcher, FR-WRK-07). */
  listMine(scope: Scope & { userId: string }): Promise<WorkspaceSummary[]> {
    return withScope(this.database.db, scope, (tx) =>
      tx
        .select({
          id: workspaces.id,
          kind: workspaces.kind,
          name: workspaces.name,
          slug: workspaces.slug,
          role: memberships.role,
        })
        .from(memberships)
        .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
        .where(
          and(
            eq(memberships.userId, scope.userId),
            eq(memberships.status, 'active'),
            isNull(workspaces.deletedAt),
          ),
        )
        .orderBy(asc(workspaces.kind), asc(workspaces.name)),
    );
  }

  /** A workspace visible to the caller; anything else is indistinguishable from non-existent. */
  async get(scope: Scope, id: string): Promise<{ id: string; name: string; kind: string }> {
    const [row] = await withScope(this.database.db, scope, (tx) =>
      tx
        .select({ id: workspaces.id, name: workspaces.name, kind: workspaces.kind })
        .from(workspaces)
        .where(eq(workspaces.id, id)),
    );
    if (!row) throw new DomainError('not_found');
    return row;
  }
}
