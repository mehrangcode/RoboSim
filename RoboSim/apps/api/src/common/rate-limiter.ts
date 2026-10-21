/** Fixed-window rate limiter (API Spec §1: RateLimit-* headers, 429 + Retry-After). In-process until Redis lands. */
export interface RateDecision {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  /** Seconds until the window resets. */
  readonly resetSeconds: number;
}

export class FixedWindowRateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  take(key: string, now = Date.now()): RateDecision {
    let w = this.windows.get(key);
    if (!w || now - w.start >= this.windowMs) {
      w = { start: now, count: 0 };
      this.windows.set(key, w);
      if (this.windows.size > 10_000) this.evict(now);
    }
    const allowed = w.count < this.limit;
    if (allowed) w.count++;
    return {
      allowed,
      limit: this.limit,
      remaining: Math.max(0, this.limit - w.count),
      resetSeconds: Math.max(1, Math.ceil((w.start + this.windowMs - now) / 1000)),
    };
  }

  private evict(now: number): void {
    for (const [k, w] of this.windows) if (now - w.start >= this.windowMs) this.windows.delete(k);
  }
}
