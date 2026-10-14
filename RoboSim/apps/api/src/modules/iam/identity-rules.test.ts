import { DomainError } from '@robosim/shared';
import { describe, expect, it } from 'vitest';
import { ageBandOn, initialStatusFor, normalizeEmail, normalizePhone } from './identity-rules.js';

describe('FR-IAM-04 age bands (Security §6.2)', () => {
  const today = '2026-10-13';
  it.each([
    ['2014-10-14', 'u13'], // turns 12 tomorrow
    ['2013-10-13', '13_15'], // 13th birthday today
    ['2010-10-14', '13_15'], // still 15
    ['2010-10-13', '16_17'],
    ['2008-10-14', '16_17'],
    ['2008-10-13', 'adult'],
  ])('born %s → %s', (dob, band) => expect(ageBandOn(dob, today)).toBe(band));

  it('treats a missing date of birth as adult (staff and SSO accounts)', () => {
    expect(ageBandOn(undefined, today)).toBe('adult');
  });

  it('rejects future or invalid dates', () => {
    expect(() => ageBandOn('2030-01-01', today)).toThrow(DomainError);
    expect(() => ageBandOn('2010-02-30', today)).toThrow(DomainError);
  });

  it('requires guardian consent for 13–15 self-signup', () => {
    expect(initialStatusFor('13_15', 'self_signup')).toBe('pending_consent');
    expect(initialStatusFor('16_17', 'self_signup')).toBe('active');
  });

  it('allows under-13 accounts only through an organization', () => {
    expect(() => initialStatusFor('u13', 'self_signup')).toThrow(
      expect.objectContaining({ code: 'policy_restricted' }),
    );
    expect(initialStatusFor('u13', 'organization')).toBe('active');
  });
});

describe('contact normalization', () => {
  it.each([
    ['09121234567', '+989121234567'],
    ['+98 912 123 4567', '+989121234567'],
    ['00989121234567', '+989121234567'],
    ['۰۹۱۲۱۲۳۴۵۶۷', '+989121234567'],
    ['+44 20 7946 0958', '+442079460958'],
  ])('phone %s → %s', (input, expected) => expect(normalizePhone(input)).toBe(expected));

  it('rejects malformed phones', () => {
    expect(() => normalizePhone('12')).toThrow(DomainError);
  });

  it('lower-cases and trims email', () => {
    expect(normalizeEmail('  Sara@Example.COM ')).toBe('sara@example.com');
    expect(() => normalizeEmail('not-an-email')).toThrow(DomainError);
  });
});
