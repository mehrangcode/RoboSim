import { DomainError, isUuid } from '@robosim/shared';
import { sql } from 'drizzle-orm';
import type { Db, Tx } from './client.js';

/** Identity of the caller for one request: drives PostgreSQL row-level security. */
export interface Scope {
  userId?: string | undefined;
  workspaceId?: string | undefined;
}

function checkId(value: string | undefined, field: string): string {
  if (value === undefined) return '';
  if (!isUuid(value)) throw new DomainError('validation_failed', { field });
  return value;
}

/**
 * Runs `fn` in a transaction as the RLS-restricted `robosim_app` role with the caller's user and workspace,
 * so tenant isolation holds even if application checks are wrong (ADR-007, NFR-TEN-01).
 */
export async function withScope<T>(db: Db, scope: Scope, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const userId = checkId(scope.userId, 'userId');
  const workspaceId = checkId(scope.workspaceId, 'workspaceId');
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local role robosim_app`);
    await tx.execute(
      sql`select set_config('app.user_id', ${userId}, true), set_config('app.workspace_id', ${workspaceId}, true)`,
    );
    return fn(tx);
  });
}

/** Trusted system work (outbox relay, seeds, migrations) running as the owning role, outside RLS. */
export function withSystem<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(fn);
}
