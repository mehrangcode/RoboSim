import { problemDetailsSchema, type ProblemDetails } from '@robosim/shared';

export class ApiError extends Error {
  constructor(readonly problem: ProblemDetails) {
    super(problem.title);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, locale: string, init: RequestInit = {}): Promise<T> {
  return (await send(path, locale, init)).body as T;
}

async function send(
  path: string,
  locale: string,
  init: RequestInit = {},
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    headers: { Accept: 'application/json', 'Accept-Language': locale, ...init.headers },
    credentials: 'same-origin',
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const problem = problemDetailsSchema.safeParse(body);
    if (problem.success) throw new ApiError(problem.data);
    throw new Error(`HTTP ${response.status} from ${path}`);
  }
  return { status: response.status, body };
}

/** JSON fetch against `/api/v1` that turns RFC 9457 responses into typed `ApiError`s. */
export function apiGet<T>(path: string, locale: string, init?: RequestInit): Promise<T> {
  return request<T>(path, locale, init);
}

/** JSON POST against `/api/v1`; `idempotencyKey` is required by the API for builds, orders and payments. */
export function apiPost<T>(path: string, body: unknown, locale: string, idempotencyKey?: string): Promise<T> {
  return request<T>(path, locale, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
  });
}

/** Like {@link apiPost}, but also returns the status code, for endpoints that answer `200` or `202`. */
export function apiPostWithStatus(
  path: string,
  body: unknown,
  locale: string,
  idempotencyKey: string,
): Promise<{ status: number; body: unknown }> {
  return send(path, locale, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
  });
}

/** JSON request with any method; `headers` carries `If-Match` for optimistic concurrency (API Spec §1). */
export function apiSend<T>(
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body: unknown,
  locale: string,
  headers: Record<string, string> = {},
): Promise<T> {
  return request<T>(path, locale, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
  });
}
