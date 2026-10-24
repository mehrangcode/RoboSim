import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { and, eq, inArray, lt, ne, sql } from 'drizzle-orm';
import { ENV, type Env } from '../../config/env.js';
import { DATABASE, type Database } from '../../db/client.js';
import { projectVersions, workspaces } from '../../db/schema.js';
import { withSystem } from '../../db/scope.js';
import { AuditService } from '../audit/index.js';
import { EntitlementsService } from '../entitlements/index.js';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export interface RetentionReport {
  dryRun: boolean;
  /** Workspaces that had versions past their retention. */
  workspaces: number;
  /** Versions deleted (or, in a dry run, that would be). */
  versions: number;
}

/**
 * `projects.version_retention_days` (FR-PRJ-03, PRD §3): a daily system job deletes automatic and restore versions
 * older than the workspace owner's retention. Named checkpoints (`manual`) and each project's latest version are
 * always kept, so nothing a user saved on purpose disappears. Every purge is audited per workspace.
 */
@Injectable()
export class VersionRetention implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(VersionRetention.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly entitlements: EntitlementsService,
    private readonly audit: AuditService,
  ) {}

  onApplicationBootstrap(): void {
    const hours = this.env.VERSION_RETENTION_INTERVAL_HOURS;
    if (hours <= 0 || this.env.APP_ENV === 'test') return;
    this.timer = setInterval(() => {
      this.purge().catch((e: unknown) =>
        this.logger.error(`version retention failed: ${(e as Error).message}`),
      );
    }, hours * HOUR_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  async purge(opts: { dryRun?: boolean; now?: Date } = {}): Promise<RetentionReport> {
    const now = opts.now ?? new Date();
    const dryRun = opts.dryRun ?? false;
    const owners = await withSystem(this.database.db, (tx) =>
      tx
        .selectDistinct({ workspaceId: workspaces.id, ownerId: workspaces.ownerUserId })
        .from(workspaces)
        .innerJoin(projectVersions, eq(projectVersions.workspaceId, workspaces.id)),
    );
    const report: RetentionReport = { dryRun, workspaces: 0, versions: 0 };
    for (const { workspaceId, ownerId } of owners) {
      const days = (await this.entitlements.resolve(workspaceId, ownerId, now)).values[
        'projects.version_retention_days'
      ];
      if (days === null) continue;
      const removed = await withSystem(this.database.db, async (tx) => {
        const expired = and(
          eq(projectVersions.workspaceId, workspaceId),
          ne(projectVersions.source, 'manual'),
          lt(projectVersions.createdAt, new Date(now.getTime() - days * DAY_MS)),
          sql`${projectVersions.number} < (select max(v.number) from ${projectVersions} v where v.project_id = ${projectVersions.projectId})`,
        );
        const ids = (await tx.select({ id: projectVersions.id }).from(projectVersions).where(expired)).map(
          (r) => r.id,
        );
        if (ids.length === 0 || dryRun) return ids.length;
        await tx.delete(projectVersions).where(inArray(projectVersions.id, ids));
        await this.audit.record(tx, {
          actorKind: 'system',
          workspaceId,
          action: 'project_versions.purged',
          targetKind: 'workspace',
          targetId: workspaceId,
          after: { versions: ids.length, retentionDays: days },
        });
        return ids.length;
      });
      if (removed > 0) {
        report.workspaces++;
        report.versions += removed;
      }
    }
    if (report.versions > 0) this.logger.log(`version retention: ${JSON.stringify(report)}`);
    return report;
  }
}
