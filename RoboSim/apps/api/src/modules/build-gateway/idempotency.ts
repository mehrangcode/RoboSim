import { createHash } from 'node:crypto';
import { DomainError } from '@robosim/shared';

/**
 * Idempotency-Key handling (API Spec §1): a replay returns the original response; the same key with a different
 * body is a conflict. Keys live 24 h. In-process until the shared store (Redis) lands.
 */
export class IdempotencyStore<T> {
  private readonly entries = new Map<string, { bodyHash: string; result: Promise<T>; expires: number }>();

  constructor(private readonly ttlMs = 24 * 60 * 60 * 1000) {}

  run(scope: string, key: string, body: unknown, fn: () => Promise<T>, now = Date.now()): Promise<T> {
    this.evict(now);
    const id = `${scope}\0${key}`;
    const bodyHash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    const existing = this.entries.get(id);
    if (existing) {
      if (existing.bodyHash !== bodyHash) throw new DomainError('idempotency_conflict');
      return existing.result;
    }
    const result = fn();
    this.entries.set(id, { bodyHash, result, expires: now + this.ttlMs });
    // A failed attempt (not a failed build) may be retried with the same key.
    result.catch(() => this.entries.delete(id));
    return result;
  }

  private evict(now: number): void {
    for (const [k, e] of this.entries) if (e.expires <= now) this.entries.delete(k);
  }
}
