import { z } from 'zod';

/** Stable machine-readable error codes (API Spec §3.1). Clients branch on these, never on message text. */
export const ERROR_STATUS = {
  validation_failed: 400,
  unauthenticated: 401,
  mfa_required: 401,
  forbidden: 403,
  entitlement_required: 403,
  quota_exceeded: 403,
  policy_restricted: 403,
  consent_pending: 403,
  not_found: 404,
  conflict: 409,
  idempotency_conflict: 409,
  gone: 410,
  precondition_failed: 412,
  payload_too_large: 413,
  safety_errors_present: 422,
  build_failed: 422,
  compiler_unavailable: 503,
  rate_limited: 429,
  build_quota_exceeded: 429,
  ai_credits_exhausted: 429,
  internal_error: 500,
  provider_error: 502,
  maintenance: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;
export const ERROR_CODES = Object.keys(ERROR_STATUS) as [ErrorCode, ...ErrorCode[]];
export const errorCodeSchema = z.enum(ERROR_CODES);

export type ErrorParams = Record<string, unknown>;

/** RFC 9457 problem details as returned by every RoboSim API error. */
export const problemDetailsSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: errorCodeSchema,
  detail: z.string().optional(),
  instance: z.string().optional(),
  requestId: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
});
export type ProblemDetails = z.infer<typeof problemDetailsSchema>;

export class DomainError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    readonly params: ErrorParams = {},
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'DomainError';
    this.status = ERROR_STATUS[code];
  }
}
