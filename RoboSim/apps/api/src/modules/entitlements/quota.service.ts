import { quotaDay, type QuotaEntitlement, type QuotaLimit } from '@robosim/shared';
import { Injectable } from '@nestjs/common';

/** Outcome of consuming one unit of a daily quota. */
export interface QuotaDecision {
  readonly allowed: boolean;
  readonly limit: QuotaLimit;
  readonly used: number;
  /** 00:00 Asia/Tehran of the next day, when the quota refills (TD §9.1). */
  readonly resetsAt: Date;
}

const MAX_SUBJECTS = 10_000;

/**
 * Daily counters for consumable quotas (`QuotaService.consume`, TD §9.1), keyed by quota and subject (a user, or a
 * guest's address). In-process until the shared store (Redis Lua) arrives with the deployment track, so a restart
 * refills every quota. The limit is passed in, because it comes from the subject's entitlements at that moment.
 */
@Injectable()
export class QuotaService {
  private readonly used = new Map<string, { day: number; count: number }>();

  consume(quota: QuotaEntitlement, subject: string, limit: QuotaLimit, now = Date.now()): QuotaDecision {
    const { day, resetsAt } = quotaDay(now);
    const key = `${quota}:${subject}`;
    let u = this.used.get(key);
    if (!u || u.day !== day) {
      u = { day, count: 0 };
      this.used.set(key, u);
      if (this.used.size > MAX_SUBJECTS) this.evict(day);
    }
    const allowed = limit === null || u.count < limit;
    if (allowed) u.count++;
    return { allowed, limit, used: u.count, resetsAt };
  }

  /** Today's use without consuming. */
  peek(quota: QuotaEntitlement, subject: string, now = Date.now()): { used: number; resetsAt: Date } {
    const { day, resetsAt } = quotaDay(now);
    const u = this.used.get(`${quota}:${subject}`);
    return { used: u?.day === day ? u.count : 0, resetsAt };
  }

  private evict(day: number): void {
    for (const [k, u] of this.used) if (u.day !== day) this.used.delete(k);
  }
}
