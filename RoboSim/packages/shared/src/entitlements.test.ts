import { describe, expect, it } from 'vitest';
import { createOverrideSchema } from './admin-api.js';
import {
  DEFAULT_PLAN_ENTITLEMENTS,
  entitlementValuesSchema,
  mergeEntitlements,
  quotaDay,
  settingIncludes,
} from './entitlements.js';

const free = DEFAULT_PLAN_ENTITLEMENTS.free;

describe('plan defaults (PRD §3)', () => {
  it('are complete, valid entitlement sets', () => {
    for (const values of Object.values(DEFAULT_PLAN_ENTITLEMENTS))
      expect(entitlementValuesSchema.parse(values)).toEqual(values);
  });

  it('give Free 3 cloud projects, 30 builds a day, basic parts and 7-day versions', () => {
    expect(free['projects.cloud_max']).toBe(3);
    expect(free['build.daily_quota']).toBe(30);
    expect(free['components.tier']).toBe('basic');
    expect(free['projects.version_retention_days']).toBe(7);
    expect(DEFAULT_PLAN_ENTITLEMENTS.maker['projects.cloud_max']).toBeNull();
  });
});

describe('mergeEntitlements (base ⊕ grants)', () => {
  it('adds quotas, ORs features, takes the higher setting and unites boards', () => {
    const merged = mergeEntitlements(free, [
      { 'projects.cloud_max': 2, 'export.pdf': true, 'components.tier': 'all' },
      { 'build.daily_quota': 10, 'build.priority': 'low' },
    ]);
    expect(merged['projects.cloud_max']).toBe(5);
    expect(merged['build.daily_quota']).toBe(40);
    expect(merged['export.pdf']).toBe(true);
    expect(merged['export.csv']).toBe(true);
    expect(merged['components.tier']).toBe('all');
    expect(merged['build.priority']).toBe('low');
    expect(merged['boards.allowed']).toEqual(['avr-uno']);
  });

  it('never lowers: unlimited stays unlimited and a false grant keeps a true feature', () => {
    const merged = mergeEntitlements(DEFAULT_PLAN_ENTITLEMENTS.maker, [
      { 'projects.cloud_max': 1, 'export.pdf': false, 'components.tier': 'basic' },
    ]);
    expect(merged['projects.cloud_max']).toBeNull();
    expect(merged['export.pdf']).toBe(true);
    expect(merged['components.tier']).toBe('all');
    expect(mergeEntitlements(free, [{ 'projects.cloud_max': null }])['projects.cloud_max']).toBeNull();
  });

  it('leaves the base untouched', () => {
    mergeEntitlements(free, [{ 'projects.cloud_max': 5 }]);
    expect(free['projects.cloud_max']).toBe(3);
  });

  it('orders settings', () => {
    expect(settingIncludes('components.tier', 'all', 'basic')).toBe(true);
    expect(settingIncludes('components.tier', 'basic', 'all')).toBe(false);
  });
});

describe('quotaDay', () => {
  it('starts a new day at 00:00 Asia/Tehran (20:30 UTC)', () => {
    const before = quotaDay(new Date('2026-10-24T20:29:59Z'));
    const after = quotaDay(new Date('2026-10-24T20:30:00Z'));
    expect(after.day).toBe(before.day + 1);
    expect(before.resetsAt.toISOString()).toBe('2026-10-24T20:30:00.000Z');
    expect(after.resetsAt.toISOString()).toBe('2026-10-25T20:30:00.000Z');
  });
});

describe('createOverrideSchema', () => {
  it('validates the value against its key', () => {
    const ok = { key: 'projects.cloud_max', value: 10, reason: 'support ticket 42' };
    expect(createOverrideSchema.safeParse(ok).success).toBe(true);
    expect(createOverrideSchema.safeParse({ ...ok, value: 'ten' }).success).toBe(false);
    expect(createOverrideSchema.safeParse({ ...ok, key: 'nope' }).success).toBe(false);
    expect(
      createOverrideSchema.safeParse({ key: 'components.tier', value: 'all', reason: 'beta tester' }).success,
    ).toBe(true);
  });
});
