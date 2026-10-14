import { describe, expect, it } from 'vitest';
import { DomainError, ERROR_STATUS, problemDetailsSchema } from './errors.js';

describe('API errors (API Spec §3)', () => {
  it('maps every error code to an HTTP status', () => {
    expect(ERROR_STATUS.entitlement_required).toBe(403);
    expect(ERROR_STATUS.build_quota_exceeded).toBe(429);
    expect(ERROR_STATUS.validation_failed).toBe(400);
  });

  it('DomainError carries code, status, and params', () => {
    const err = new DomainError('quota_exceeded', { quota: 'projects.cloud_max', limit: 3 });
    expect(err.status).toBe(403);
    expect(err.params).toEqual({ quota: 'projects.cloud_max', limit: 3 });
    expect(err).toBeInstanceOf(Error);
  });

  it('validates problem details documents', () => {
    const doc = {
      type: 'https://docs.robosim.example/errors/not_found',
      title: 'Not found',
      status: 404,
      code: 'not_found',
      requestId: 'r1',
    };
    expect(problemDetailsSchema.parse(doc)).toMatchObject(doc);
    expect(() => problemDetailsSchema.parse({ ...doc, code: 'made_up' })).toThrow();
  });
});
