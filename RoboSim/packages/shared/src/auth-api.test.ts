import { describe, expect, it } from 'vitest';
import { passwordSchema, registerRequestSchema, updateMeRequestSchema, USER_STATUSES } from './auth-api.js';

describe('auth API contract (API Spec §2, §4.1)', () => {
  it('requires passwords of 10–128 characters without edge spaces or repetition', () => {
    expect(passwordSchema.safeParse('correct horse').success).toBe(true);
    expect(passwordSchema.safeParse('short1!').success).toBe(false);
    expect(passwordSchema.safeParse('aaaaaaaaaaaa').success).toBe(false);
    expect(passwordSchema.safeParse(' padded password ').success).toBe(false);
    expect(passwordSchema.safeParse('x'.repeat(64) + 'abcdefghij'.repeat(7)).success).toBe(false);
  });

  it('needs a date of birth to sign up and defaults the locale', () => {
    const base = { email: 'sara@example.com', password: 'correct horse', displayName: 'Sara' };
    expect(registerRequestSchema.safeParse(base).success).toBe(false);
    expect(registerRequestSchema.parse({ ...base, dateOfBirth: '2000-01-31' }).locale).toBe('en');
    expect(registerRequestSchema.safeParse({ ...base, dateOfBirth: '31/01/2000' }).success).toBe(false);
  });

  it('rejects empty profile updates', () => {
    expect(updateMeRequestSchema.safeParse({}).success).toBe(false);
    expect(updateMeRequestSchema.parse({ locale: 'fa' })).toEqual({ locale: 'fa' });
  });

  it('mirrors the user_status database enum', () => {
    expect(USER_STATUSES).toEqual(['pending_consent', 'active', 'suspended', 'deleted']);
  });
});
