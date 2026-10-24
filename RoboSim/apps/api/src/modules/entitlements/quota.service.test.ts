import { describe, expect, it } from 'vitest';
import { QuotaService } from './quota.service.js';

describe('QuotaService', () => {
  it('counts per quota and subject per Tehran day and refills at 00:00 Asia/Tehran', () => {
    const quotas = new QuotaService();
    const noon = Date.UTC(2026, 9, 21, 12);
    expect(quotas.consume('build.daily_quota', 'u', 2, noon)).toMatchObject({ allowed: true, used: 1 });
    expect(quotas.consume('build.daily_quota', 'u', 2, noon).allowed).toBe(true);
    const third = quotas.consume('build.daily_quota', 'u', 2, noon);
    expect(third).toMatchObject({ allowed: false, limit: 2, used: 2 });
    expect(third.resetsAt.toISOString()).toBe('2026-10-21T20:30:00.000Z');
    expect(quotas.consume('build.daily_quota', 'other', 2, noon).allowed).toBe(true);
    expect(quotas.peek('build.daily_quota', 'u', noon).used).toBe(2);
    const nextDay = Date.UTC(2026, 9, 21, 20, 30, 1);
    expect(quotas.peek('build.daily_quota', 'u', nextDay).used).toBe(0);
    expect(quotas.consume('build.daily_quota', 'u', 2, nextDay).allowed).toBe(true);
  });

  it('never refuses an unlimited quota', () => {
    const quotas = new QuotaService();
    for (let i = 0; i < 5; i++) expect(quotas.consume('build.daily_quota', 'u', null).allowed).toBe(true);
    expect(quotas.consume('build.daily_quota', 'u', 0).allowed).toBe(false);
  });
});
