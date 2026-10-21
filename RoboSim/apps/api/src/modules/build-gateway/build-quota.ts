/** Outcome of taking one build from a daily quota. */
export interface QuotaDecision {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  /** Start of the next UTC day, when the quota refills. */
  readonly resetAt: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * `build.daily_quota` (API Spec §4.5): compiled builds per caller per UTC day; cache hits are free. In-process until
 * the shared store (Redis) lands, so a restart refills every quota.
 */
export class DailyBuildQuota {
  private readonly used = new Map<string, { day: number; count: number }>();

  constructor(private readonly limit: number) {}

  take(key: string, now = Date.now()): QuotaDecision {
    const day = Math.floor(now / DAY_MS);
    let u = this.used.get(key);
    if (!u || u.day !== day) {
      u = { day, count: 0 };
      this.used.set(key, u);
      if (this.used.size > 10_000) this.evict(day);
    }
    const allowed = u.count < this.limit;
    if (allowed) u.count++;
    return {
      allowed,
      limit: this.limit,
      remaining: Math.max(0, this.limit - u.count),
      resetAt: new Date((day + 1) * DAY_MS),
    };
  }

  private evict(day: number): void {
    for (const [k, u] of this.used) if (u.day !== day) this.used.delete(k);
  }
}
