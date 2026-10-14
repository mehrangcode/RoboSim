import { Injectable } from '@nestjs/common';
import type { Tx } from '../../db/client.js';
import { auditLogs } from '../../db/schema.js';

export interface AuditEntry {
  actorId?: string | null;
  actorKind: 'user' | 'staff' | 'system' | 'scim' | 'lti';
  workspaceId?: string | null;
  action: string;
  targetKind: string;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
  requestId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

/** Writes audit records inside the caller's transaction so the record commits with the change it describes. */
@Injectable()
export class AuditService {
  async record(tx: Tx, entry: AuditEntry): Promise<void> {
    await tx.insert(auditLogs).values({
      actorId: entry.actorId ?? null,
      actorKind: entry.actorKind,
      workspaceId: entry.workspaceId ?? null,
      action: entry.action,
      targetKind: entry.targetKind,
      targetId: entry.targetId ?? null,
      before: entry.before ?? null,
      after: entry.after ?? null,
      requestId: entry.requestId ?? null,
      ip: entry.ip ?? null,
      userAgent: entry.userAgent ?? null,
    });
  }
}
