import { DomainError, type AgeBand } from '@robosim/shared';
import { z } from 'zod';

export type SignupSource = 'self_signup' | 'organization';
export type InitialStatus = 'active' | 'pending_consent';

/** Calendar date in Asia/Tehran (business-day boundary, Technical Design §7.2), as YYYY-MM-DD. */
export function tehranToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran' }).format(now);
}

function parseDate(value: string): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const [y, m, d] = match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [NaN, NaN, NaN];
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (!match || probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    throw new DomainError('validation_failed', { field: 'dateOfBirth' });
  }
  return { y, m, d };
}

/** Completed years between `dob` and `today`, mapped to the privacy age bands. */
export function ageBandOn(dob: string | undefined, today: string): AgeBand {
  if (!dob) return 'adult';
  const b = parseDate(dob);
  const t = parseDate(today);
  let age = t.y - b.y;
  if (t.m < b.m || (t.m === b.m && t.d < b.d)) age--;
  if (age < 0) throw new DomainError('validation_failed', { field: 'dateOfBirth' });
  if (age < 13) return 'u13';
  if (age < 16) return '13_15';
  if (age < 18) return '16_17';
  return 'adult';
}

/** Under 13: organization accounts only. 13–15 self-signup waits for guardian consent (FR-IAM-04). */
export function initialStatusFor(band: AgeBand, source: SignupSource): InitialStatus {
  if (band === 'u13' && source === 'self_signup')
    throw new DomainError('policy_restricted', { policy: 'minimum_age' });
  if (band === '13_15' && source === 'self_signup') return 'pending_consent';
  return 'active';
}

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** E.164 normalization; Iranian national format (09…) maps to +98. */
export function normalizePhone(input: string): string {
  let s = [...input]
    .map((c) => {
      const p = PERSIAN_DIGITS.indexOf(c);
      if (p >= 0) return String(p);
      const a = ARABIC_DIGITS.indexOf(c);
      return a >= 0 ? String(a) : c;
    })
    .join('');
  s = s.replace(/[\s\-().]/g, '');
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  else if (/^0\d{10}$/.test(s)) s = `+98${s.slice(1)}`;
  if (!/^\+[1-9]\d{6,14}$/.test(s)) throw new DomainError('validation_failed', { field: 'phone' });
  return s;
}

export function normalizeEmail(input: string): string {
  const email = input.trim().toLowerCase();
  if (!z.email().safeParse(email).success) throw new DomainError('validation_failed', { field: 'email' });
  return email;
}
