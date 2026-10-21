import { describe, expect, it } from 'vitest';
import { shareLinkRequestSchema, shareRequestSchema, shareTokenSchema } from './share-api.js';

describe('sharing contract (FR-PRJ-04, API Spec §4.4)', () => {
  it('offers view and edit roles only (comments arrive in P4)', () => {
    expect(shareRequestSchema.safeParse({ email: 'a@b.co', role: 'edit' }).success).toBe(true);
    expect(shareRequestSchema.safeParse({ email: 'a@b.co', role: 'comment' }).success).toBe(false);
    expect(shareRequestSchema.safeParse({ email: 'a@b.co', role: 'view', extra: 1 }).success).toBe(false);
  });

  it('keeps the link unless asked to regenerate', () => {
    expect(shareLinkRequestSchema.parse({ remixable: true })).toEqual({ remixable: true, regenerate: false });
  });

  it('accepts only well-formed link tokens', () => {
    expect(shareTokenSchema.safeParse('a'.repeat(43)).success).toBe(true);
    expect(shareTokenSchema.safeParse('a'.repeat(42)).success).toBe(false);
    expect(shareTokenSchema.safeParse(`${'a'.repeat(42)}/`).success).toBe(false);
  });
});
