import { csrfResponseSchema, problemDetailsSchema, type ProblemDetails } from '@robosim/shared';

export class ApiError extends Error {
  constructor(readonly problem: ProblemDetails) {
    super(problem.title);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, locale: string, init: RequestInit = {}): Promise<T> {
  return (await send(path, locale, init)).body as T;
}

let csrfToken: Promise<string | undefined> | undefined;

/**
 * The double-submit CSRF token (API Spec §2) for unsafe requests, fetched once per page. A failure is not
 * cached and does not block the request: endpoints that need the token then answer `csrf_failed`.
 */
function csrf(): Promise<string | undefined> {
  csrfToken ??= Promise.resolve()
    .then(() =>
      fetch('/api/v1/auth/csrf', { credentials: 'same-origin', headers: { Accept: 'application/json' } }),
    )
    .then(async (r) => (r.ok ? csrfResponseSchema.parse(await r.json()).token : undefined))
    .catch(() => undefined)
    .then((token) => {
      if (!token) csrfToken = undefined;
      return token;
    });
  return csrfToken;
}

async function send(
  path: string,
  locale: string,
  init: RequestInit = {},
  retried = false,
): Promise<{ status: number; body: unknown }> {
  const unsafe = !!init.method && !['GET', 'HEAD'].includes(init.method);
  const token = unsafe ? await csrf() : undefined;
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Accept-Language': locale,
      ...(token ? { 'X-CSRF-Token': token } : {}),
      ...init.headers,
    },
    credentials: 'same-origin',
  });
  const body: unknown = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const problem = problemDetailsSchema.safeParse(body);
    // The CSRF cookie can be gone (cleared site data, another tab signed out): fetch a new token, try once more.
    if (problem.success && problem.data.code === 'csrf_failed' && !retried) {
      csrfToken = undefined;
      return send(path, locale, init, true);
    }
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

/**
 * POST whose answer is a server-sent event stream (EventSource cannot POST). Refusals before the stream opens
 * are problem documents and throw `ApiError` like the other helpers; the caller reads `response.body`.
 */
export async function apiStream(
  path: string,
  body: unknown,
  locale: string,
  signal?: AbortSignal,
  retried = false,
): Promise<Response> {
  const token = await csrf();
  const response = await fetch(`/api/v1${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      Accept: 'text/event-stream',
      'Accept-Language': locale,
      'Content-Type': 'application/json',
      ...(token ? { 'X-CSRF-Token': token } : {}),
    },
    credentials: 'same-origin',
    ...(signal ? { signal } : {}),
  });
  if (response.ok) return response;
  const problem = problemDetailsSchema.safeParse(await response.json().catch(() => null));
  if (problem.success && problem.data.code === 'csrf_failed' && !retried) {
    csrfToken = undefined;
    return apiStream(path, body, locale, signal, true);
  }
  if (problem.success) throw new ApiError(problem.data);
  throw new Error(`HTTP ${response.status} from ${path}`);
}

/** Server-sent events from a response body, as `{ event, data }` with `data` lines joined. */
export async function* readEvents(response: Response): AsyncGenerator<{ event: string; data: string }> {
  if (!response.body) return;
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let event = 'message';
  let data: string[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (value) buffer += value;
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).replace(/\r$/, '');
      buffer = buffer.slice(nl + 1);
      if (line === '') {
        if (data.length) yield { event, data: data.join('\n') };
        event = 'message';
        data = [];
      } else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      else if (line.startsWith('event:')) event = line.slice(6).trim();
    }
    if (done) break;
  }
  if (data.length) yield { event, data: data.join('\n') };
}
