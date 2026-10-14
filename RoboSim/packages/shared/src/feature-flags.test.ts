import { describe, expect, it } from 'vitest';
import { bucketOf, evaluateFlag, parseFlagOverrides, type FlagDefinition } from './feature-flags.js';

const flag = (rules: FlagDefinition['rules'], enabled = true): FlagDefinition => ({
  key: 'collab.realtime',
  enabled,
  rules,
});

describe('FR-ADM-09 feature flag evaluation', () => {
  it('is off when no rule matches', () => {
    expect(evaluateFlag(flag([]), { environment: 'production' })).toBe(false);
  });

  it('matches by environment', () => {
    const f = flag([{ environments: ['staging'], value: true }]);
    expect(evaluateFlag(f, { environment: 'staging' })).toBe(true);
    expect(evaluateFlag(f, { environment: 'production' })).toBe(false);
  });

  it('matches by plan and workspace', () => {
    const f = flag([
      { workspaceIds: ['w-1'], value: true },
      { plans: ['maker'], value: true },
    ]);
    expect(evaluateFlag(f, { environment: 'production', workspaceId: 'w-1', plan: 'free' })).toBe(true);
    expect(evaluateFlag(f, { environment: 'production', workspaceId: 'w-2', plan: 'maker' })).toBe(true);
    expect(evaluateFlag(f, { environment: 'production', workspaceId: 'w-2', plan: 'free' })).toBe(false);
  });

  it('first matching rule wins, so deny rules can precede allow rules', () => {
    const f = flag([
      { userIds: ['u-blocked'], value: false },
      { environments: ['production'], value: true },
    ]);
    expect(evaluateFlag(f, { environment: 'production', userId: 'u-blocked' })).toBe(false);
    expect(evaluateFlag(f, { environment: 'production', userId: 'u-other' })).toBe(true);
  });

  it('disabled flags are off regardless of rules (kill switch)', () => {
    expect(evaluateFlag(flag([{ value: true }], false), { environment: 'production' })).toBe(false);
  });

  it('US-ADM-04 AC1 percentage rollout is sticky and close to the target share', () => {
    const f = flag([{ percentage: 10, value: true }]);
    const users = Array.from({ length: 20_000 }, (_, i) => `user-${i}`);
    const on = users.filter((userId) => evaluateFlag(f, { environment: 'production', userId })).length;
    expect(on / users.length).toBeGreaterThan(0.09);
    expect(on / users.length).toBeLessThan(0.11);
    expect(evaluateFlag(f, { environment: 'production', userId: 'user-42' })).toBe(
      evaluateFlag(f, { environment: 'production', userId: 'user-42' }),
    );
  });

  it('percentage rules never match without a subject', () => {
    expect(evaluateFlag(flag([{ percentage: 100, value: true }]), { environment: 'production' })).toBe(false);
  });

  it('buckets differ per flag so rollouts are independent', () => {
    const differing = Array.from({ length: 1000 }, (_, i) => `u${i}`).filter(
      (u) => bucketOf('flag.a', u) !== bucketOf('flag.b', u),
    ).length;
    expect(differing).toBeGreaterThan(900);
  });

  it('overrides win over rules', () => {
    const overrides = parseFlagOverrides('collab.realtime=off, blocks=on');
    expect(overrides).toEqual({ 'collab.realtime': false, blocks: true });
    expect(evaluateFlag(flag([{ value: true }]), { environment: 'local' }, overrides)).toBe(false);
  });

  it('rejects malformed override strings', () => {
    expect(() => parseFlagOverrides('blocks=maybe')).toThrow(/blocks/);
  });
});
